# Implementation Reference

<p align="center">
  <img src="assets/netjepa_logo.png" alt="Net-JEPA logo" width="120"/>
</p>

The engineering-level reference: repository layout, the preprocessing code, exact model and
loss internals, training hyper-parameters, the serving stack, and the key design decisions.

> Companion docs (same folder): conceptual diagrams in [architecture.md](architecture.md);
> data sources and dataset assembly in [datasets.md](datasets.md); how to install and run in
> [install.md](install.md); measured results in [results.md](results.md); the chronological
> research log in [experiments.md](experiments.md). Index: [README.md](README.md).

---

## Repository layout

```
Net-JEPA/
│
├── src/                       ← all Python source (installable: `pip install -e .`)
│   ├── netjepa/               ← core ML package
│   │   ├── data/              ← data pipeline (parser, flow_builder, rtt, features, augment)
│   │   ├── model/             ← neural network components
│   │   ├── loss/              ← loss functions
│   │   ├── training/          ← training phases
│   │   ├── downstream/        ← classification heads
│   │   ├── evaluation/        ← metrics & diagnostics
│   │   ├── utils/             ← checkpoints, logging
│   │   ├── configs/           ← YAML hyperparameters (default.yaml, traffic.yaml)
│   │   └── scripts/           ← CLI entry points
│   ├── capture/               ← live packet capture (pcap replay)
│   ├── flows/                 ← flow grouping for live server
│   ├── model/                 ← server-facing classifier adapter
│   └── server/                ← FastAPI + WebSocket backend
│
├── webui/                     ← "Signal Atlas" React/WebGL front-end (its own webui/src/)
├── data/traffic_csvs/         ← derived metadata-only feature CSVs (committed; see SOURCES.md)
├── pyproject.toml, setup.py   ← packaging for the src/ layout
├── requirements.txt           ← pinned runtime deps
└── docs/                      ← this documentation
```

---

## Preprocessing pipeline — `src/netjepa/data/`

Data sources, licenses, and the type taxonomy are in [datasets.md](datasets.md). The code path
that turns any source into model-ready tensors:

```
Raw CSVs (Kaggle) / converted pcaps (VLC, cloud-gaming)
   │
   ▼  parser.py
   Vectorized Info parsing (ports, TCP flags, TLS markers)
   Datetime → relative float seconds  (explicit format, ~3s per 500k rows)
   Protocol string → 4-class ID
   │
   ▼  flow_builder.py
   Group into bidirectional flows via frozenset{(src_ip,port),(dst_ip,port)} + protocol
   Split on 30s idle gap · discard <5 packets · truncate to 64 packets
   (min_packets / max_packets / flow_timeout configurable in the YAML config;
    min_packets was lowered 10→5 to recover short flows — ~33% more flows)
   Client = SYN initiator, else private/local endpoint, else first packet's source
   │
   ▼  rtt.py
   RTT extraction: TCP handshake → TLS handshake → first exchange (fallback chain)
   │
   ▼  features.py  (two passes)
   Pass 1: per-CAPTURE host statistics (per source_file / per uploaded pcap):
           distinct dst IPs, dst ports, src ports, connections/sec
   Pass 2: per-flow feature extraction
   │
   ├─  packet_sequence  (64 × 9)
   │     [size/1500, log1p(iat)/10, signed direction, proto one-hot×4, rtt_norm, rtt_flag]
   │
   ├─  flow_context     (15,)
   │     [protocol, duration, iat_mean, iat_std, syn/fin/rst ratios,
   │      pkts/sec, host stats×4, pkt_count, rtt_norm, rtt_flag]
   │
   └─  padding_mask     (64,) bool — True = real packet
   │
   ▼  build_traffic_dataset.py
   Stratified 70/70/30 split: 70% train (pretrain = downstream, full supervision) / 30% test
   Few-shot subsets: η ∈ {1, 3, 5, 7, 10} labelled samples per class
   Output: data/traffic_csvs/*.csv + data/processed_traffic/*.parquet + labels.json
```

The decisive correctness property is **per-capture host stats** (computed over one capture, not
globally) — the change that took accuracy 0.86 → 0.997 and made `.pcap` upload work. The full
investigation is in [experiments.md](experiments.md); the measured effect in [results.md](results.md).

---

## Model architecture — `src/netjepa/model/`

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

## Augmentation / degradation — `src/netjepa/data/augment.py`

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

The same `degrade_flow` is reused at serving time by the Proof Lab's "degraded" demo to show
the prediction is unchanged under RTT/jitter/packet-loss.

---

## Loss functions — `src/netjepa/loss/`

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

## Training phases — `src/netjepa/training/`

Recommended path: **Phase 1 → Phase 2b → Phase 3**. (Phase 2 — unsupervised contrastive
refinement — is retained but skipped; it didn't improve class separation.) The commands to run
each phase are in [install.md](install.md).

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
  Checkpoints every 25 epochs + final

PHASE 2b — Supervised Contrastive Fine-tuning  (≈120 epochs)  (recommended)
  Loads Phase 1 checkpoint (init_ckpt, strict=False — embed_head is new).
  SupCon on CATEGORY labels (the KPI's class level: Youtube+Netflix = intra),
  applied directly on the KEPT, L2-normalised embed_head output (the embedding
  itself — not a throwaway projection), so cosine is optimised where it's measured.
  Class-BALANCED sampling so minority categories (video-conferencing, ~69 flows)
  get in-batch positive pairs. Encoder lr 3e-4 / embed_head lr 1e-3, τ=0.05.
  At the end: compute the train-set mean embedding and enable α-centering
  (set_centering, α≈0.65) so absolute inter-cosine drops below 0.3.

PHASE 3 — Downstream Classification  (50 epochs)
  Loads Phase 2b checkpoint. FREEZE: all encoders, fusion, EMA target.
  TRAIN:  DownstreamPoolingB + classifier heads.
  Three classifiers (num_categories = 8 traffic types):
    A. k-NN (k=5, cosine)     → knn.joblib  ← loaded by the live server
    B. Linear probe            Linear(128, 8)
    C. Shallow MLP             Linear(128,64) → ReLU → Dropout → Linear(64,8)
  CE heads use class-weighted CrossEntropyLoss (inverse-frequency) with normal
  shuffle — NOT balanced sampling (combining both over-corrects and collapses
  the heads onto minority predictions).
  Embedding = L2-normalised, α-centered embed_head output = 128-dim
```

---

## Evaluation — `src/netjepa/evaluation/`

| Module | Measures |
|---|---|
| `embedding.py` | Cosine sim distributions (intra > 0.7, inter < 0.3), silhouette score |
| `classification.py` | Accuracy, macro F1/precision/recall, per-class F1, confusion matrix |
| `topk_pairs.py` | Horowicz top-k pairs accuracy (augmented views stay close) |
| `fewshot.py` | η ∈ {1,3,5,7,10} labels per class, 10 repeats, mean ± std accuracy |

The measured KPI numbers these produce are in [results.md](results.md). The optional
domain-adaptation phase (Phase 2c / DANN, `src/netjepa/training/phase2c.py` +
`src/netjepa/model/domain.py`) is not part of the default 8-class path and is offered for
future cross-deployment to networks outside the trained sources.

---

## Live inference server — `src/server/` + `src/model/`

```
                        ┌──────────────────────────────────┐
  .pcap upload          │         server/app.py             │
  (POST /api/infer) ──► │   FastAPI + WebSocket fanout      │
                        │       │                           │
                        │   pcap_to_flows (scapy →          │
                        │     flow_builder.extract_flows)   │
                        │       │                           │
                        │   compute_src_host_stats          │
                        │     over THIS pcap (per-capture)  │
                        │       │                           │
  NETJEPA_CKPT     ───► │   NetJEPAClassifier.predict_flow  │
  KNN_PATH         ───► │     → forward_downstream          │
                        │     → cosine k-NN → type + conf   │
                        │       │                           │
                        │   UMAP.transform (optional) →     │
                        │     2-D point appended to cloud   │
                        │       │                           │
                        │   JSON event over WebSocket /ws   │
                        └──────────────────────────────────┘
                                      │
                                      ▼
                         webui/  ("Signal Atlas" — React 19 + WebGL)
```

**Full-fidelity live features.** `packets_to_tensors()` does not reimplement the feature math —
it reuses the **exact training extractor** (`netjepa/data/features.py` + `rtt.py`).
`capture/pcap_replay.py` parses TCP flags (SYN/ACK/FIN/RST) and TLS Client/Server-Hello markers
out of each packet, so a live flow gets the same 9-D packet tokens **and** the same 15-D context
(syn/fin/rst ratios, handshake RTT, per-capture host stats) it would in training — an uploaded
flow embeds identically to a training flow, with no zeroed/defaulted dimensions.

**Single-port UI ↔ server.** The webui calls the API at the **same origin** (relative `/api` +
`/ws`); the Vite dev server proxies those to the inference server (`vite.config.ts`, target
`VITE_PROXY_TARGET`, default `:8000`). So only the **UI port (5173)** needs to be reachable —
one SSH tunnel suffices. On first run the server **auto-downloads the weights from Hugging
Face** (`NETJEPA_HF_REPO`) if the checkpoint is missing, so a bare clone serves the live demo.
If the browser can't reach the server, the UI silently falls back to the offline static export
+ mock projector.

**Portability.** The UMAP 2-D reducer loads in its own try/except; if its pickle can't be read
(e.g. a different Python than it was fit on), the server falls back to projecting a new flow to
its predicted class's centroid. `/api/health` reports `projection: "umap"` or
`"centroid-fallback"`. Classification is version-portable and never gated on the reducer.

The full set of server environment variables (`NETJEPA_CKPT`, `NETJEPA_LABELS`, `DATASET_ID`,
`KNN_PATH`, `NETJEPA_HF_REPO`, `PCAP_PATH`, `REPLAY_SPEED`, `VITE_PROXY_TARGET`,
`VITE_SERVER_URL`) is documented in [install.md](install.md).

---

## Key design decisions

| Decision | Rationale |
|---|---|
| Degraded online / clean target | Forces the encoder to learn network-condition-invariant representations |
| EMA target encoder | Prevents representation collapse without negative pairs |
| flow_ctx never degraded | Global statistics are stable; only packet timing is noisy |
| VICReg variance term | Prevents dimensional collapse (all embeddings becoming identical) |
| DBSCAN pseudo-labels | Class-structure signal before any labels; clustered on the full set, labels keyed by flow index, contrastive skipped if <2 clusters |
| Category-level SupCon + α-centering | Cosine KPI is category-level (Youtube+Netflix=intra) → supervise on categories; SupCon separates directions but leaves a common-mode cone → subtract α·mean to get inter-cosine < 0.3 while keeping intra > 0.7 |
| Per-capture host stats | Context features computed over the same population at train and serving time — the fix that took accuracy 0.86 → 0.997 and made `.pcap` upload work |
| min_packets = 5 | Lowered from 10 to recover short flows (~33% more data) without going below the ≥2 needed for IAT/RTT features |
| Class-weighted CE, not balanced sampling, in Phase 3 heads | One imbalance correction, not two — combining oversampling + weighting collapses the heads onto minority predictions |
| 143-dim pooled vector (128+15) | Residual connection of raw flow_ctx preserves interpretable stats before the embedding head |
| 500k row cap per CSV | Keeps parse time < 5s per file; still yields ~800 flows per file |
