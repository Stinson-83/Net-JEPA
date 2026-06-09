# Net-JEPA — Architecture & Workflow

Net-JEPA is a Joint-Embedding Predictive Architecture for encrypted network traffic
classification. It learns flow embeddings self-supervised (no labels during pretraining)
and uses them to classify traffic into 15 application categories across 6 coarse groups.

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
│  │  → (B, 128) flow vector                            │               │
│  │  concat with raw flow_context                      │               │
│  │  → (B, 143) final embedding                        │               │
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
  Real app labels (not pseudo-labels); InfoNCE over a projection head
  Class-balanced sampling so minority classes get in-batch positive pairs
  This is the signal that actually improved class separation (see below)

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

PHASE 2b — Supervised Contrastive Fine-tuning  (30 epochs)  ★ recommended
  Loads Phase 1 checkpoint (init_ckpt); trains encoder + a throwaway
  projection head with SupCon on real app labels.
  Class-BALANCED sampling (make_balanced_sampler) so minority classes
  (e.g. video-conferencing, ~69 flows) get in-batch positive pairs.
  Encoder lr = 1e-4 (raised from 1e-5 so the encoder — which produces the
  downstream embedding — actually moves, not just the discarded head).
  Saves encoder only (projection head discarded).

PHASE 3 — Downstream Classification  (50 epochs)
  Loads Phase 2b checkpoint (--phase2_ckpt default checkpoints/phase2b/final.pt)
  FREEZE: all encoders, fusion, EMA target
  TRAIN:  DownstreamPoolingB + classifier heads

  Three classifiers (num_classes = 15 apps):
    A. k-NN (k=5, cosine)     → knn.joblib  ← loaded by live server
                                (indexed on the real label distribution)
    B. Linear probe            Linear(143, 15)
    C. Shallow MLP             Linear(143,64) → ReLU → Dropout → Linear(64,15)
  CE heads use class-weighted CrossEntropyLoss (inverse-frequency) with
  normal shuffle — NOT balanced sampling (combining both over-corrects and
  collapses the heads onto minority predictions).

  Embedding = concat(flow_vec_128, flow_ctx_15) = 143-dim
```

---

## Evaluation — `netjepa/evaluation/`

| Module | Measures |
|---|---|
| `embedding.py` | Cosine sim distributions (intra > 0.7, inter < 0.3), silhouette score |
| `classification.py` | Accuracy, macro F1/precision/recall, per-class F1, confusion matrix |
| `topk_pairs.py` | Horowicz top-k pairs accuracy (augmented views stay close) |
| `fewshot.py` | η ∈ {1,3,5,7,10} labels per class, 10 repeats, mean ± std accuracy |

**Measured (test set, balanced-SupCon model, category-level):**
accuracy 0.89 · macro-F1 **0.745** · silhouette 0.004 · CPU p95 ≈ 3ms

**On KPIs:** raw inter-class cosine stays high (~0.90) — SupCon sharpens class
*margins* (what classifiers and few-shot exploit) without spreading the globally
concentrated embedding cloud, so `inter cosine < 0.3` is not a meaningful target
for this architecture. **macro-F1 and few-shot are the success metrics**; macro-F1
rose 0.658 → 0.745 and the starved `video_conferencing` class went F1 0.00 → 0.36
once class imbalance was addressed. Latency p95 < 100ms is comfortably met (~3ms).

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
                         server/static/index.html
                         ┌──────────────────────────────┐
                         │  Live dashboard               │
                         │  • Status dot (live/error)    │
                         │  • Stats: flows, pps,         │
                         │    avg latency, top app/cat   │
                         │  • Category distribution bar  │
                         │  • Flow table: src, dst,      │
                         │    proto, app, category,      │
                         │    confidence bar, latency    │
                         └──────────────────────────────┘
```

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `DATASET_ID` | `phase3b_supcon` | export sub-dir under `webui/public/data` (cloud + reducer + metrics) |
| `NETJEPA_CKPT` | `checkpoints/phase3b/final.pt` | Trained NetJEPA checkpoint for live inference |
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

# 6. Export artifacts for the web UI / live server (UMAP, metrics, per-flow)
python3 netjepa/scripts/export_artifacts.py \
    --checkpoint checkpoints/phase3/final.pt \
    --dataset-id phase3b_supcon --name "Phase 3b — SupCon (balanced)" --device cuda

# 7. Live server (upload .pcap via POST /api/infer; stages stream over /ws)
NETJEPA_CKPT=checkpoints/phase3/final.pt DATASET_ID=phase3b_supcon \
uvicorn server.app:app --host 0.0.0.0 --port 8000
```

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
| min_packets = 5 | Lowered from 10 to recover short flows (~33% more data, better class balance) without going below the ≥2 needed for IAT/RTT features |
| Class-weighted CE, not balanced sampling, in Phase 3 heads | One imbalance correction, not two — combining oversampling + weighting collapses the heads onto minority predictions |
| 143-dim embedding (128+15) | Residual connection of raw flow_ctx preserves interpretable stats |
| 500k row cap per CSV | Keeps parse time < 5s per file; still yields ~800 flows per file |
