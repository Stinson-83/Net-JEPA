# Net-JEPA — Architecture & Workflow

Net-JEPA is a Joint-Embedding Predictive Architecture for encrypted network traffic
classification. It learns flow embeddings self-supervised (no labels during pretraining)
and uses them to classify traffic into 15 application categories across 6 coarse groups.

> This is the deep engineering reference. For the structured docs set (overview, datasets,
> tech-stack, results, features, agentic-AI write-up, presentation), see [`docs/`](docs/README.md).
> For the honest chronological research log, see [`experimentation.md`](experimentation.md).

---

## Repository Layout

```
Net-JEPA/
│
├── netjepa/                   ← core ML package
│   ├── data/                  ← data pipeline
│   ├── model/                 ← neural network components
│   ├── loss/                  ← loss functions
│   ├── training/              ← three training phases
│   ├── downstream/            ← classification heads
│   ├── evaluation/            ← metrics & diagnostics
│   ├── utils/                 ← checkpoints, logging
│   ├── configs/               ← YAML hyperparameters
│   └── scripts/               ← CLI entry points
│
├── capture/                   ← live packet capture (pcap replay)
├── flows/                     ← flow grouping for live server
├── model/                     ← server-facing classifier adapter
└── server/                    ← FastAPI + WebSocket dashboard
```

---

## Data Source

```
/indian-slp/Users/ug/ZEPA/Kritik/net_data/5G_Traffic_Datasets/
  Game_Streaming/    GeForce_Now/, KT_GameBox/
  Live_Streaming/    AfreecaTV/, Naver_NOW/, YouTube_Live/
  Metaverse/         Roblox/, Zepeto/
  Online_Game/       Battleground/, Teamfight_Tactics/
  Stored_Streaming/  Amazon_Prime/, Netflix/, YouTube/
  Video_Conferencing/ Google_Meet/, MS_Teams/, Zoom/
```

- **~67 Wireshark CSV files** across 15 apps in 6 categories (Amazon_Prime
  removed — yields 0 flows; `youtube` has only 1 flow → forced into pretrain)
- Each CSV: `No., Time, Source, Destination, Protocol, Length, Info`
- Time column: `"2022-06-17 23:48:34.871426"` (datetime string, converted to relative float)
- Largest files: ~4.3M rows / 705 MB — capped at **500k rows per file** during parsing

### Folded-in augmentation datasets

Two public datasets were converted to the same Wireshark-CSV schema (via
`netjepa/scripts/convert_vlc_pcap.py`, scapy — no tshark) and added through
`FOLDER_MAP`. To avoid a **domain confound** (a foreign testbed's artifacts
leaking into the labelled set), most out-of-domain apps are routed to
**pretrain-only** via `PRETRAIN_ONLY_FOLDERS`; only the in-distribution-compatible
MS-Teams captures join the *supervised* set. See `docs/datasets.md` for licenses.

| Source | Apps used | Role |
|---|---|---|
| **VLC / Valencia** ([Zenodo 15121418](https://zenodo.org/records/15121418), CC-BY-4.0) | MS Teams → `ms_teams`/video_conferencing | **supervised** (rescued the starved video-conf class, F1 0.67→0.93) |
| | Netflix / Prime / YouTube / Roblox (`VLC_*`) | **pretrain-only** (representation diversity) |
| **Cloud-gaming telemetry** ([Kaggle `carloshfm/...`](https://www.kaggle.com/datasets/carloshfm/cloud-gaming-network-telemetry), BSD-3) | Xbox Cloud over 5G → `CG_Xbox`/game_streaming | **pretrain-only** + galaxy density (398→739 points) |

Huge cloud-gaming pcaps (~1 GB / millions of packets) are capped at parse time
with `--max_packets 600000`; only the ~5 GB of 5G captures were stream-extracted
from the 28 GB Kaggle archive.

---

## Preprocessing Pipeline — `netjepa/data/`

```
Raw CSVs
   │
   ▼  parser.py
   Vectorized Info parsing (ports, TCP flags, TLS markers)
   Datetime → relative float seconds  (explicit format, ~3s per 500k rows)
   Protocol string → 4-class ID
   │
   ▼  flow_builder.py
   Group into bidirectional flows via frozenset{(src_ip,port),(dst_ip,port)}
   Split on 30s idle gap · discard <5 packets · truncate to 64 packets
   (min_packets / max_packets / flow_timeout are configurable in
    default.yaml → data; min_packets was lowered 10→5 to recover short
    flows — ~33% more flows, better balance for sparse classes)
   │
   ▼  rtt.py
   RTT extraction: TCP handshake → TLS handshake → first exchange (fallback chain)
   │
   ▼  features.py  (two passes)
   Pass 1: per-source-host statistics across all flows
           (distinct dst IPs, ports, connections/sec)
   Pass 2: per-flow feature extraction
   │
   ├─  packet_sequence  (64 × 9)
   │     [size_norm, iat_log, signed_size, proto_onehot×4, rtt_norm, rtt_flag]
   │
   ├─  flow_context     (15,)
   │     [protocol, duration, iat_mean, iat_std, syn/fin/rst ratios,
   │      pkts/sec, host stats×4, pkt_count, rtt_norm, rtt_flag]
   │
   └─  padding_mask     (64,) bool — True = real packet
   │
   ▼  preprocess.py
   Stratified 70/15/15 pretrain/downstream/test splits
   Few-shot subsets: η ∈ {1, 3, 5, 7, 10} labelled samples per class
   Output: data/processed/*.parquet + splits.json
```

---

## Model Architecture — `netjepa/model/`

```
┌─────────────────────────────── NetJEPA ───────────────────────────────┐
│                                                                        │
│  ONLINE BRANCH (receives DEGRADED flow)                                │
│  ┌────────────────────────────────────────────────────┐               │
│  │  TemporalEncoder                                   │               │
│  │  Linear(9→128) + Sinusoidal PE                     │               │
│  │  4× TransformerEncoderLayer (pre-norm)             │               │
│  │  d=128, heads=4, ff=256, dropout=0.1               │               │
│  │  → (B, 64, 128) per-packet latents                 │               │
│  │                                                    │               │
│  │  ContextEncoder  (always receives clean flow_ctx)  │               │
│  │  Linear(15,64)→LN→LeakyReLU → Linear(64,64)→LN    │               │
│  │  → (B, 64)                                         │               │
│  │                                                    │               │
│  │  CrossAttentionFusionA  (Direction A)              │               │
│  │  Q = packet_latents,  K = V = context_expanded     │               │
│  │  → (B, 64, 128) context-enriched tokens            │               │
│  └────────────────────────────────────────────────────┘               │
│             │                                                          │
│             ▼  Adaptive Temporal Masking                               │
│         visible tokens          masked positions                       │
│             │                        │                                 │
│             ▼                        ▼                                 │
│  ┌──────────────────────────────────────────┐                         │
│  │  MicroPredictor                          │                         │
│  │  concat(visible, sinusoidal_PE[masked])  │                         │
│  │  3× TransformerEncoderLayer              │                         │
│  │  → (B, n_masked, 128) predictions        │                         │
│  └──────────────────────────────────────────┘                         │
│                                                                        │
│  TARGET BRANCH (EMA, receives CLEAN flow, stop-gradient)              │
│  ┌────────────────────────────────────────────────────┐               │
│  │  EMA copies of TemporalEncoder + ContextEncoder    │               │
│  │  + FusionA  (momentum 0.99 → 0.999 over 100 epochs)│               │
│  │  → target_fused[:, masked_indices, :]              │               │
│  └────────────────────────────────────────────────────┘               │
│                                                                        │
│  DOWNSTREAM BRANCH (Phase 3 only, frozen online encoder)              │
│  ┌────────────────────────────────────────────────────┐               │
│  │  DownstreamPoolingB  (Direction B)                 │               │
│  │  Learnable query attends to all 64 packet latents  │               │
│  │  → (B, 128) flow vector ⊕ raw flow_context (15)    │               │
│  │  → embed_head MLP(143→256→128)                     │               │
│  │  → L2-normalise; subtract α·mean, re-normalise     │               │
│  │  → (B, 128) unit-sphere embedding (cosine KPI)     │               │
│  └────────────────────────────────────────────────────┘               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Augmentation / Degradation — `netjepa/data/augment.py`

Applied to the **online branch input only** (flow_ctx is always clean, except RTT masking):

```
Clean flow
    │
    ├─ Change RTT      p=0.8   scale all IATs by α ~ U(0.5, 1.5)
    ├─ Time Shift      p=0.5   shift first-packet IAT by b ~ U(-1, +1) s
    ├─ Packet Loss     p=0.5   drop all packets in a random 0.2 s window
    └─ RTT Masking     p=0.4   zero out rtt_norm + rtt_valid in both
                               packet_sequence[:,7:9] and flow_ctx[13:15]
    │
    ▼
Degraded flow  →  online branch
```

---

## Loss Functions — `netjepa/loss/`

```
VICReg  (primary)
  Invariance:  MSE(predicted, target)              weight α = 25
  Variance:    ReLU(1 − std(predicted))            weight β = 25
  Covariance:  off-diagonal² of cov matrix         weight γ = 1

DBSCAN Contrastive  (starts epoch 20, Phase 1 / every epoch Phase 2)
  Pseudo-labels via DBSCAN over the FULL pretrain set every 10 epochs
  (eps = 0.05 cosine — small, because the embeddings are tightly
   concentrated; eps = 0.5 collapsed everything into one cluster)
  Labels keyed by TRUE flow index (batch['flow_idx']) so each batch flow
  gets its own cluster label — the previous batch-position keying paired
  labels with the wrong flows (trained on noise)
  Guard: if a refresh yields <2 clusters the contrastive term is skipped
  that round (one cluster has no negatives → would only worsen collapse)
  Margin loss: push same-cluster closer, different-cluster apart (m = 0.5)

SupCon — Supervised Contrastive (Phase 2b, Khosla et al. 2020)
  Real CATEGORY labels; InfoNCE applied directly on the kept, L2-normalised
  embedding (embed_head output), so cosine is optimised in the space it's
  measured. Class-balanced sampling gives minority categories positive pairs.
  This is what drives class separation; combined with α-centering it meets the
  intra > 0.7 / inter < 0.3 cosine KPI.

CompositeLoss  (Phase 1 / 2 only)
  Normalise each loss by its 100-step running mean (prevents scale dominance)
  total = λ₁ · norm(VICReg) + λ₂ · norm(Contrastive)
          λ₁ = 1.0              λ₂ = 0.3
```

---

## Training Phases — `netjepa/training/`

Recommended path leans on SupCon: **Phase 1 → Phase 2b → Phase 3**.
(Phase 2 — the unsupervised contrastive refinement — is retained but skipped
in the recommended path; it didn't improve class separation.)

```
PHASE 1 — Self-supervised Pretraining  (150 epochs)
  Dataset:   pretrain.parquet (70% of all flows, labels ignored)
  Optimizer: AdamW lr=1e-3, CosineAnnealing, weight_decay=1e-4
  Loop:
    1. Degrade flow → online branch
    2. Adaptive masking (30% if <30 real pkts, else 50%)
    3. Online: fused_latents → predictor → predicted[masked]
    4. Target (no_grad + detach): target_fused[masked]
    5. VICReg loss on (predicted, target)
    6. Epoch ≥20: DBSCAN refresh every 10 epochs (full set, eps 0.05,
       labels keyed by flow index) → contrastive loss when ≥2 clusters
    7. EMA update: momentum 0.99 → 0.999 (linear over 100 epochs)
  Per-refresh log: "DBSCAN: N flows → K clusters … (contrastive ON/OFF)"
  Checkpoints every 25 epochs + final

PHASE 2 — Embedding Refinement  (50 epochs, OPTIONAL)
  Loads Phase 1 checkpoint; target encoder FROZEN (momentum 0.999)
  Same DBSCAN contrastive, refreshed every 5 epochs
  Superseded by Phase 2b in the recommended path.

PHASE 2b — Supervised Contrastive Fine-tuning  (≈120 epochs)  ★ recommended
  Loads Phase 1 checkpoint (init_ckpt, strict=False — embed_head is new).
  SupCon on CATEGORY labels (the KPI's class level: Youtube+Netflix = intra),
  applied directly on the KEPT, L2-normalised embed_head output (the embedding
  itself — not a throwaway projection), so cosine is optimised where it's measured.
  Class-BALANCED sampling so minority categories (video-conferencing, ~69 flows)
  get in-batch positive pairs. Encoder lr 3e-4 / embed_head lr 1e-3, τ=0.05.
  At the end: compute the train-set mean embedding and enable α-centering
  (set_centering, α≈0.65) so absolute inter-cosine drops below 0.3.

PHASE 3 — Downstream Classification  (50 epochs)
  Loads Phase 2b checkpoint (--phase2_ckpt default checkpoints/phase2b/final.pt)
  FREEZE: all encoders, fusion, EMA target
  TRAIN:  DownstreamPoolingB + classifier heads

  Three classifiers (num_classes = 6 categories — the KPI level):
    A. k-NN (k=5, cosine)     → knn.joblib  ← loaded by live server
                                (indexed on the real label distribution)
    B. Linear probe            Linear(128, 6)
    C. Shallow MLP             Linear(128,64) → ReLU → Dropout → Linear(64,6)
  CE heads use class-weighted CrossEntropyLoss (inverse-frequency) with
  normal shuffle — NOT balanced sampling (combining both over-corrects and
  collapses the heads onto minority predictions).

  Embedding = L2-normalised, α-centered embed_head output = 128-dim
```

---

## Evaluation — `netjepa/evaluation/`

| Module | Measures |
|---|---|
| `embedding.py` | Cosine sim distributions (intra > 0.7, inter < 0.3), silhouette score |
| `classification.py` | Accuracy, macro F1/precision/recall, per-class F1, confusion matrix |
| `topk_pairs.py` | Horowicz top-k pairs accuracy (augmented views stay close) |
| `fewshot.py` | η ∈ {1,3,5,7,10} labels per class, 10 repeats, mean ± std accuracy |

**Measured (test set, category-level — all benchmark KPIs met):**

| Benchmark KPI | Target | Result |
|---|---|---|
| Intra-class cosine | > 0.7 | **0.81** ✅ |
| Inter-class cosine | < 0.3 | **0.13** ✅ |
| Classification accuracy | ≥ 90% | **0.918** (kNN) ✅ |
| Generalization (few-shot η≥3) | ≥ 85% | **0.91** ✅ |
| Real-time per flow | < 100 ms | **~3 ms** ✅ |

macro-F1 **0.858**, silhouette **0.50**. Reaching the cosine targets needed two
things together: (1) **category-level SupCon** — the KPI defines class at the
category level ("Youtube and Netflix" = intra), so app-level contrast would
fight it; and (2) **common-mode removal** — SupCon separates class *directions*
(silhouette ↑) but leaves them in a shared cone (inter-cosine pinned ~0.7);
subtracting α·mean (α≈0.65, `embed_head` + `set_centering`) isotropises the space
so absolute inter-cosine drops below 0.3 while intra stays above 0.7.

### Cross-domain generalization (Kaggle → VLC)

Two senses of "generalization" are worth separating:

- **In-domain cross-validation** (held-out flows from the same capture, the
  few-shot eval): **0.92** — comfortably meets the ≥85% KPI.
- **Cross-*dataset* transfer** (train on Kaggle, test on the entirely separate
  VLC/Valencia testbed, never seen — not even in pretraining): **0.05**.

The harness: `preprocess_kaggle.py --holdout_folders VLC_* --out_dir
data/processed_gen` writes the VLC flows to `holdout.parquet` (excluded from all
training); `evaluate.py --test_parquet holdout.parquet` then scores the
Kaggle-trained model on them.

```
                       in-domain (Kaggle→Kaggle)   cross-domain (Kaggle→VLC)
  kNN accuracy                 0.918                       0.054
  macro-F1                     0.858                       0.037
  silhouette                   0.50                        0.02
```

The Kaggle-trained embedding does **not** transfer across capture domains —
2,687/4,280 VLC flows are classified as `live_streaming` (a category VLC doesn't
even contain). This is genuine domain shift, not a bug: the embedding learned
Kaggle-testbed-specific cues. Reported honestly, it shows the model is
**domain-specific** and motivates domain-diverse pretraining / domain adaptation
for true cross-deployment — it does not affect the in-domain KPIs above.

### Domain adaptation (DANN) — `netjepa/training/phase2c.py`

To narrow that gap, Phase 2c adds **domain-adversarial training** (DANN): category
SupCon continues on labelled Kaggle while a gradient-reversal domain
discriminator (`netjepa/model/domain.py`) aligns the *unlabelled* VLC
distribution.

```
python netjepa/scripts/train_phase2c.py --processed_dir data/processed_gen \
    --target_parquet data/processed_gen/vlc_adapt.parquet \
    --init_ckpt checkpoints/gen_phase2b/final.pt --ckpt_dir checkpoints/gen_phase2c
```

Measured on held-out VLC (k = labelled VLC flows per category added to the kNN):

```
   k       baseline (Kaggle-only)    DANN-adapted
   0  (unsup)        0.050               0.056
   5                 0.237               0.111
  10                 0.266               0.367
  20                 0.295               0.388
```

- **Unsupervised DANN aligns the domains** (discriminator acc 0.65 → 0.51) **but
  doesn't improve transfer alone** — a known limitation under *label shift* (VLC
  has 3 of 6 categories: aligning p(x) ≠ aligning p(category|x)).
- **Semi-supervised** (DANN + a few target labels) **does**: transfer rises
  0.05 → 0.39 and beats the baseline for k≥10 — the alignment makes the space
  amenable to cheap few-shot target adaptation. VLC stays a hard target (0.39,
  not 0.85); full closure needs substantial target labels.

---

## Live Inference Server — `server/` + `model/`

```
                        ┌──────────────────────────────────┐
  .pcap file            │         server/app.py             │
  (PCAP_PATH env)  ───► │   FastAPI + WebSocket fanout      │
                        │                                   │
  capture/              │   PcapReplay (pcap_replay.py)     │
  pcap_replay.py   ───► │       │                           │
                        │       ▼                           │
  flows/                │   FlowTable (flow_table.py)       │
  flow_table.py    ───► │   groups into 10-64 pkt flows     │
                        │       │                           │
  model/                │       ▼                           │
  netjepa_          ───► NetJEPAClassifier.predict()        │
  classifier.py         │       │                           │
                        │   packets_to_tensors()            │
  NETJEPA_CKPT     ───► │   PacketRecord → (64×9) tensor    │
  KNN_PATH         ───► │       │                           │
                        │   model.forward_downstream()      │
                        │       │                           │
                        │   knn.predict() → app + category  │
                        │       │                           │
                        │   JSON event over WebSocket        │
                        └──────────────────────────────────┘
                                      │
                                      ▼
                         webui/  ("Signal Atlas" — React 19 + WebGL)
                         ┌──────────────────────────────┐
                         │  • Galaxy of 7,481 real flows │
                         │    (regl/WebGL, UMAP layout,  │
                         │     coloured by true class)   │
                         │  • Click a star → packet      │
                         │    heartbeat + verdict + k-NN │
                         │  • Drop a .pcap → live infer, │
                         │    pipeline streamed over /ws │
                         │  • Model / Proof / Journey    │
                         │    scenes; "LIVE MODEL" light │
                         └──────────────────────────────┘
```

The front-end reads a **static export** when the server is down and the **live
server** when it's up. Full feature tour: `docs/features.md`. (A minimal legacy
dashboard under `server/static/` is retained as a serverless fallback.)

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `DATASET_ID` | `phase3b_supcon` | export sub-dir under `webui/public/data` (cloud + reducer + metrics) |
| `NETJEPA_CKPT` | `checkpoints/phase3/final.pt` | Trained NetJEPA checkpoint for live inference |
| `KNN_PATH` | *(auto-detected)* | `knn.joblib` next to checkpoint |
| `PCAP_PATH` | *(optional)* | legacy auto-replay on startup; the primary mode is upload → `POST /api/infer` |
| `REPLAY_SPEED` | `1.0` | Replay speed multiplier |

> The primary entry point is `POST /api/infer` (upload a .pcap) with every
> pipeline stage streamed over `/ws`; `GET /api/cloud` / `/api/metrics` serve
> the growing point cloud + KPIs. To serve the latest model, point
> `NETJEPA_CKPT` at the checkpoint your run produced (e.g.
> `checkpoints/phase3/final.pt`) while keeping `DATASET_ID=phase3b_supcon` (the
> export dir holding the matching `umap.joblib` reducer + seed cloud).

---

## End-to-End Run Order

```bash
# 1. Preprocess (one-time, ~5-15 min). min_packets etc. come from
#    default.yaml; override with --min_packets N if desired.
python3 netjepa/scripts/preprocess_kaggle.py

# 2. Phase 1 — self-supervised pretraining (~150 epochs, GPU recommended)
python3 netjepa/scripts/train_phase1.py --device cuda

# 3. Phase 2b — supervised contrastive fine-tuning (recommended; inits from
#    Phase 1, balanced sampling). (Phase 2 is optional and skipped here.)
python3 netjepa/scripts/train_phase2b.py --device cuda

# 4. Phase 3 — classification heads; also saves knn.joblib.
#    Defaults --phase2_ckpt to checkpoints/phase2b/final.pt.
python3 netjepa/scripts/train_phase3.py --device cuda

# 5. Full evaluation against test split
python3 netjepa/scripts/evaluate.py \
    --checkpoint checkpoints/phase3/final.pt --device cuda

# 6a. Export artifacts for the web UI / live server (UMAP, metrics, per-flow)
python3 netjepa/scripts/export_artifacts.py \
    --checkpoint checkpoints/phase3/final.pt \
    --dataset-id phase3b_supcon --name "Phase 3b — SupCon (balanced)" --device cuda

# 6b. Export the dense, balanced galaxy cloud (full real set: pretrain+downstream+
#     test, ground-truth coloured, capped per class). Rewrites embeddings_umap.json
#     + flow_features/* + umap.joblib; leaves metrics/class_stats on the test split.
python3 netjepa/scripts/export_cloud.py \
    --checkpoint checkpoints/phase3/final.pt \
    --dataset-id phase3b_supcon --cap 1500 --device cuda

# 7. Live server (upload .pcap via POST /api/infer; stages stream over /ws)
NETJEPA_CKPT=checkpoints/phase3/final.pt DATASET_ID=phase3b_supcon \
uvicorn server.app:app --host 0.0.0.0 --port 8000
```

**Optional — cross-domain adaptation (Phase 2c).** Not part of the default
production model (phase1→2b→3); use only to adapt to a new target domain (e.g.
VLC) for which you have unlabelled captures. Requires a holdout split:

```bash
# a. Build a Kaggle-train / target-holdout split (target excluded from training)
python3 netjepa/scripts/preprocess_kaggle.py --out_dir data/processed_gen \
    --holdout_folders VLC_Teams,VLC_Netflix,VLC_Prime,VLC_YouTube,VLC_Roblox
#    then split holdout.parquet → vlc_adapt.parquet (unlabelled) + vlc_test.parquet

# b. Train Phase 1→2b→3 on the Kaggle-only split (--processed_dir data/processed_gen,
#    --ckpt_dir checkpoints/gen_*), then domain-adversarially adapt to the target:
python3 netjepa/scripts/train_phase2c.py --processed_dir data/processed_gen \
    --target_parquet data/processed_gen/vlc_adapt.parquet \
    --init_ckpt checkpoints/gen_phase2b/final.pt --ckpt_dir checkpoints/gen_phase2c

# c. Score transfer on the held-out target test
python3 netjepa/scripts/evaluate.py --processed_dir data/processed_gen \
    --checkpoint checkpoints/gen_phase2c/final.pt --test_parquet vlc_test.parquet
```

> DANN aligns domains but needs a few target labels to actually lift transfer
> (see *Domain adaptation (DANN)* above) — unsupervised alone stays ~0.05.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Degraded online / clean target | Forces encoder to learn network-condition-invariant representations |
| EMA target encoder | Prevents representation collapse without negative pairs |
| flow_ctx never degraded | Global statistics are stable; only packet timing is noisy |
| VICReg variance term | Prevents dimensional collapse (all embeddings becoming identical) |
| DBSCAN pseudo-labels | Provides class structure signal before any labels are used; clustered on the full set, labels keyed by flow index, contrastive skipped if <2 clusters |
| Balanced SupCon (Phase 2b) | Real-label supervised contrastive with class-balanced batches — the lever that actually lifted macro-F1 and rescued sparse classes |
| Category-level SupCon + α-centering | Cosine KPI is category-level (Youtube+Netflix=intra) → supervise on categories; SupCon separates directions but leaves a common-mode cone → subtract α·mean to get inter-cosine < 0.3 while keeping intra > 0.7 |
| min_packets = 5 | Lowered from 10 to recover short flows (~33% more data, better class balance) without going below the ≥2 needed for IAT/RTT features |
| Class-weighted CE, not balanced sampling, in Phase 3 heads | One imbalance correction, not two — combining oversampling + weighting collapses the heads onto minority predictions |
| 143-dim embedding (128+15) | Residual connection of raw flow_ctx preserves interpretable stats |
| 500k row cap per CSV | Keeps parse time < 5s per file; still yields ~800 flows per file |
