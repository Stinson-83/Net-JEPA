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

- **75 Wireshark CSV files** across 15 apps in 6 categories
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
   Split on 30s idle gap · discard <10 packets · truncate to 64 packets
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

DBSCAN Contrastive  (starts epoch 20)
  Pseudo-labels via DBSCAN on 2% embedding subsample every 10 epochs
  Margin loss: push same-cluster closer, different-cluster apart (m = 0.5)

CompositeLoss
  Normalise each loss by its 100-step running mean (prevents scale dominance)
  total = λ₁ · norm(VICReg) + λ₂ · norm(Contrastive)
          λ₁ = 1.0              λ₂ = 0.3
```

---

## Three-Phase Training — `netjepa/training/`

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
    6. Epoch ≥20: DBSCAN refresh every 10 epochs → contrastive loss
    7. EMA update: momentum 0.99 → 0.999 (linear over 100 epochs)
  Checkpoints every 25 epochs + final

PHASE 2 — Embedding Refinement  (50 epochs)
  Loads Phase 1 checkpoint
  Target encoder FROZEN (momentum fixed at 0.999, no EMA updates)
  DBSCAN refresh every 5 epochs
  Early-stop signal: silhouette score > 0.5

PHASE 3 — Downstream Classification  (50 epochs)
  Loads Phase 2 checkpoint
  FREEZE: all encoders, fusion, EMA target
  TRAIN:  DownstreamPoolingB + classifier heads

  Three classifiers:
    A. k-NN (k=5, cosine)     → knn.joblib  ← loaded by live server
    B. Linear probe            Linear(143, 14)
    C. Shallow MLP             Linear(143,64) → ReLU → Dropout → Linear(64,14)

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

**KPIs:** intra cosine > 0.7 · inter cosine < 0.3 · accuracy ≥ 90% · few-shot η=7 ≥ 85% · CPU p95 < 100ms

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
| `PCAP_PATH` | *(required)* | Path to .pcap file for replay |
| `NETJEPA_CKPT` | `checkpoints/phase3/final.pt` | Trained NetJEPA checkpoint |
| `KNN_PATH` | *(auto-detected)* | `knn.joblib` next to checkpoint |
| `REPLAY_SPEED` | `1.0` | Replay speed multiplier |

---

## End-to-End Run Order

```bash
# 1. Preprocess (one-time, ~10-20 min for all 75 CSVs)
python3 netjepa/scripts/preprocess_kaggle.py

# 2. Phase 1 — self-supervised pretraining (~150 epochs, GPU recommended)
python3 netjepa/scripts/train_phase1.py --device cuda

# 3. Phase 2 — embedding refinement (~50 epochs)
python3 netjepa/scripts/train_phase2.py \
    --phase1_ckpt checkpoints/phase1/final.pt

# 4. Phase 3 — classification heads; also saves knn.joblib
python3 netjepa/scripts/train_phase3.py \
    --phase2_ckpt checkpoints/phase2/final.pt

# 5. Full evaluation against test split
python3 netjepa/scripts/evaluate.py \
    --checkpoint checkpoints/phase3/final.pt

# 6. Live dashboard
PCAP_PATH=capture.pcap \
NETJEPA_CKPT=checkpoints/phase3/final.pt \
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
| DBSCAN pseudo-labels | Provides class structure signal before any labels are used |
| 143-dim embedding (128+15) | Residual connection of raw flow_ctx preserves interpretable stats |
| 500k row cap per CSV | Keeps parse time < 5s per file; still yields ~800 flows per file |
