# Net-JEPA — Architecture & Workflow

<p align="center">
  <img src="docs/assets/netjepa_logo.png" alt="Net-JEPA logo" width="120"/>
</p>

Net-JEPA is a Joint-Embedding Predictive Architecture for encrypted network traffic
classification. It learns flow embeddings self-supervised (no labels during pretraining)
and uses them to classify traffic into 8 traffic types.

<p align="center">
  <a href="https://pytorch.org"><img src="https://img.shields.io/badge/PyTorch-EE4C2C?style=flat-square&logo=pytorch&logoColor=white" alt="PyTorch"/></a>
  <a href="https://scikit-learn.org"><img src="https://img.shields.io/badge/scikit--learn-F7931E?style=flat-square&logo=scikit-learn&logoColor=white" alt="scikit-learn"/></a>
  <a href="https://numpy.org"><img src="https://img.shields.io/badge/NumPy-013243?style=flat-square&logo=numpy&logoColor=white" alt="NumPy"/></a>
  <a href="https://pandas.pydata.org"><img src="https://img.shields.io/badge/pandas-150458?style=flat-square&logo=pandas&logoColor=white" alt="pandas"/></a>
  <a href="https://fastapi.tiangolo.com"><img src="https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI"/></a>
  <a href="https://scapy.net"><img src="https://img.shields.io/badge/Scapy-007ACC?style=flat-square&logo=python&logoColor=white" alt="Scapy"/></a>
  <a href="https://umap-learn.readthedocs.io"><img src="https://img.shields.io/badge/UMAP-6A0DAD?style=flat-square&logo=python&logoColor=white" alt="UMAP"/></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React"/></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/></a>
  <a href="https://tailwindcss.com"><img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS"/></a>
  <a href="https://vite.dev"><img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite"/></a>
</p>

> This is the deep engineering reference. For the structured docs set (overview, datasets,
> tech-stack, results, features, agentic-AI write-up, presentation), see [`docs/`](docs/README.md).
> For the chronological research log, see [`experimentation_log.md`](experimentation_log.md).

---

## Repository Layout

```
Net-JEPA/
│
├── src/                       ← all Python source (installable: `pip install -e .`)
│   ├── netjepa/               ← core ML package
│   │   ├── data/              ← data pipeline
│   │   ├── model/             ← neural network components
│   │   ├── loss/              ← loss functions
│   │   ├── training/          ← training phases
│   │   ├── downstream/        ← classification heads
│   │   ├── evaluation/        ← metrics & diagnostics
│   │   ├── utils/             ← checkpoints, logging
│   │   ├── configs/           ← YAML hyperparameters
│   │   └── scripts/           ← CLI entry points
│   ├── capture/               ← live packet capture (pcap replay)
│   ├── flows/                 ← flow grouping for live server
│   ├── model/                 ← server-facing classifier adapter
│   └── server/                ← FastAPI + WebSocket dashboard
│
├── webui/                     ← "Signal Atlas" React/WebGL front-end (its own webui/src/)
├── pyproject.toml, setup.py   ← packaging for the src/ layout
├── requirements.txt           ← pinned runtime deps
└── docs/                      ← technical documentation
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

- **~67 Wireshark CSV files** across many apps across 8 traffic types (Amazon_Prime
  removed — yields 0 flows; `youtube` has only 1 flow → forced into pretrain)
- Each CSV: `No., Time, Source, Destination, Protocol, Length, Info`
- Time column: `"2022-06-17 23:48:34.871426"` (datetime string, converted to relative float)
- Largest files: ~4.3M rows / 705 MB — capped at **500k rows per file** during parsing

### Folded-in augmentation datasets

Two public datasets were converted to the same Wireshark-CSV schema (via
`src/netjepa/scripts/convert_vlc_pcap.py`, scapy — no tshark) and added through
`FOLDER_MAP`. To avoid a **domain confound** (a foreign testbed's artifacts
leaking into the labelled set), out-of-domain apps are folded in via
`FOLDER_MAP`; the 8-class model trains on all data **supervised**. See `docs/datasets.md` for licenses.

| Source | Apps used | Role |
|---|---|---|
| **VLC / Valencia** ([Zenodo 15121418](https://zenodo.org/records/15121418), CC-BY-4.0) | MS Teams → `ms_teams`/video_conferencing | **supervised** (recovered the under-represented video-conf class, F1 0.67→0.93) |
| | Netflix / Prime / YouTube / Roblox (`VLC_*`) | **supervised** (representation diversity) |
| **Cloud-gaming telemetry** ([Kaggle `carloshfm/...`](https://www.kaggle.com/datasets/carloshfm/cloud-gaming-network-telemetry), BSD-3) | Xbox Cloud over 5G → `CG_Xbox`/cloud_gaming | **supervised** + point-cloud density (398→739 points) |

Huge cloud-gaming pcaps (~1 GB / millions of packets) are capped at parse time
with `--max_packets 600000`; only the ~5 GB of 5G captures were stream-extracted
from the 28 GB Kaggle archive.

---

## Preprocessing Pipeline — `src/netjepa/data/`

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
   Stratified 70/70/30 split: 70% train (pretrain = downstream, full supervision) / 30% test
   Few-shot subsets: η ∈ {1, 3, 5, 7, 10} labelled samples per class
   Output: data/processed/*.parquet + splits.json
```

---

## Model Architecture — `src/netjepa/model/`

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

## Augmentation / Degradation — `src/netjepa/data/augment.py`

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

## Loss Functions — `src/netjepa/loss/`

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

## Training Phases — `src/netjepa/training/`

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
  Loads Phase 2b checkpoint (--phase2_ckpt default checkpoints/phase2b/final.pt)
  FREEZE: all encoders, fusion, EMA target
  TRAIN:  DownstreamPoolingB + classifier heads

  Three classifiers (num_categories = 8 traffic types — the KPI level):
    A. k-NN (k=5, cosine)     → knn.joblib  ← loaded by live server
                                (indexed on the real label distribution)
    B. Linear probe            Linear(128, 8)
    C. Shallow MLP             Linear(128,64) → ReLU → Dropout → Linear(64,8)
  CE heads use class-weighted CrossEntropyLoss (inverse-frequency) with
  normal shuffle — NOT balanced sampling (combining both over-corrects and
  collapses the heads onto minority predictions).

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

**Measured (test set, category-level — all benchmark KPIs met):**

| Benchmark KPI | Target | Result |
|---|---|---|
| Intra-class cosine | > 0.7 | **0.98** |
| Inter-class cosine | < 0.3 | **−0.04** |
| Classification accuracy | ≥ 90% | **0.997** (kNN) |
| Generalization (few-shot η≥3) | ≥ 85% | **0.996** |
| Real-time per flow | < 100 ms | **3.5 ms** |

macro-F1 **0.992**, silhouette **0.87**. Reaching the cosine targets required two
methods together: (1) **category-level SupCon** — the KPI defines class at the
category level ("Youtube and Netflix" = intra), so app-level contrast would
oppose it; and (2) **common-mode removal** — SupCon separates class *directions*
(silhouette ↑) but leaves them in a shared cone (inter-cosine pinned ~0.7);
subtracting α·mean (α≈0.65, `embed_head` + `set_centering`) isotropises the space
so absolute inter-cosine drops below 0.3 while intra stays above 0.7.

### Generalization & real-`.pcap` inference

In the 8-traffic-type model **all sources are supervised and mixed into one
leak-free split** (Kaggle 5G + VLC + Xbox cloud-gaming), so there is no
held-out "foreign testbed" — generalization is measured two ways:

- **In-domain few-shot** (η=7 labelled/class, held-out flows): **0.996**.
- **Real captures of the trained types**, run end-to-end through `infer_pcap.py`
  (the identical parse→flow→features→kNN path as training):

```
  netflix_linux_20m_01.pcapng   → video_on_demand  99%
  spotify_windows_30m_02.pcapng → audio_streaming   97%
  xbox_fortnite_*.pcap          → cloud_gaming      89%
  youtube_video.pcap (browser QUIC, never in training) → video_on_demand
```

The last row is the strongest evidence of generalization: a Chrome-native QUIC capture — a
different capture domain from the VLC/Kaggle testbeds — still resolves correctly.

**What made this work: per-capture host stats.** Host-behaviour features
(`n_dst_ips/n_dst_ports/n_src_ports/conn_per_sec`) are computed **per capture**
(per `source_file` at train time, per uploaded pcap at inference) instead of
globally over the whole dataset. Globally, a reused testbed client IP merged its
destinations across every app → inflated values inference could never reproduce,
which made real pcaps collapse to the wrong class. Switching to per-capture took
the model **0.86 → 0.997** *and* fixed `.pcap` upload — both from one change
(verified genuine: same-capture-excluded kNN = 0.9967).

**Known limitation:** a pcap with only a single flow yields
degenerate host stats (`n_dst_ips=1`) unlike any multi-flow training capture and
can misclassify. Real multi-flow captures classify correctly.

### Optional — domain adaptation (DANN), `src/netjepa/training/phase2c.py`

Phase 2c (gradient-reversal domain-adversarial training, `src/netjepa/model/domain.py`)
remains available for *true cross-deployment* to a brand-new network: continue
SupCon on labelled data while a domain discriminator aligns an unlabelled target
distribution. It is **not** part of the default 8-class path and is offered for
future work on networks outside the trained sources.

---

## Live Inference Server — `src/server/` + `src/model/`

*(Paths below are under `src/`; the diagram uses short module names — `capture/`,
`flows/`, `model/`, `server/` — for the data flow.)*

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
                         │  • Galaxy of thousands of     │
                         │    real flows                 │
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
server** when it is up. Full feature description: `docs/features.md`. (A minimal legacy
dashboard under `src/server/static/` is retained as a serverless fallback.)

**Connecting the UI ↔ server (single port).** The webui calls the API at the
**same origin** (relative `/api` + `/ws`); the Vite dev server proxies those to
the inference server (`vite.config.ts`, target `VITE_PROXY_TARGET`, default
`:8000`). So only the **UI port (5173)** needs to be reachable — one SSH tunnel
suffices, no separate `:8000` forward. On first run the server **auto-downloads
the weights from Hugging Face** (`NETJEPA_HF_REPO`) if the checkpoint is missing,
so a bare clone serves the live demo. (If the browser can't reach the server, the
UI silently falls back to the offline static export + mock projector.)

**Full-fidelity live features.** `packets_to_tensors()` doesn't reimplement the
feature math — it reuses the **exact training extractor** (`netjepa/data/features.py`
+ `rtt.py`). `capture/pcap_replay.py` parses TCP flags (SYN/ACK/FIN/RST) and TLS
Client/Server-Hello markers out of each packet, so the live flow gets the same
9-D packet tokens **and** the same 15-D context (syn/fin/rst ratios, handshake
RTT, per-host stats) it would in training — an uploaded flow embeds identically
to a training flow, no zeroed/defaulted dims.

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `DATASET_ID` | `traffic8` | export sub-dir under `webui/public/data` (cloud + reducer + metrics) |
| `NETJEPA_CKPT` | `checkpoints/traffic8/phase3/final.pt` | Trained NetJEPA checkpoint for live inference |
| `NETJEPA_LABELS` | `data/processed_traffic/labels.json` | the 8 traffic-type names (auto-fetched from HF) |
| `KNN_PATH` | *(auto-detected)* | `knn.joblib` next to checkpoint |
| `PCAP_PATH` | *(optional)* | legacy auto-replay on startup; the primary mode is upload → `POST /api/infer` |
| `REPLAY_SPEED` | `1.0` | Replay speed multiplier |
| `NETJEPA_HF_REPO` | `kritikahd007/net-jepa` | HF repo the server auto-downloads weights from if the checkpoint is missing (set empty to disable) |
| `VITE_PROXY_TARGET` (web) | `http://localhost:8000` | inference server the Vite proxy forwards `/api`+`/ws` to; `make demo` sets it to `:$(PORT)` |
| `VITE_SERVER_URL` (web) | *(same-origin)* | override to call the API at an absolute host instead of via the proxy |

> The primary entry point is `POST /api/infer` (upload a .pcap) with every
> pipeline stage streamed over `/ws`; `GET /api/cloud` / `/api/metrics` serve
> the growing point cloud + KPIs. The server defaults to the 8-class model
> (`NETJEPA_CKPT=checkpoints/traffic8/phase3/final.pt`, `DATASET_ID=traffic8`,
> `NETJEPA_LABELS=data/processed_traffic/labels.json`); the export dir holds the
> matching `umap.joblib` reducer + seed cloud.

---

## End-to-End Run Order

```bash
# 0. Install (one-time). Registers the src/ packages so `server` etc. import
#    from anywhere; scripts below also self-bootstrap, so -e is optional.
pip install -r requirements.txt
pip install -e .

# 1. Build the 8-class dataset (one-time). Uses traffic.yaml; reads the staged
#    raw dir (Kaggle 5G + VLC_*/CG_Xbox folders). Host stats are per-capture.
CFG=src/netjepa/configs/traffic.yaml
python3 -m netjepa.scripts.build_traffic_dataset --raw_dir <5G_dataset_root> \
    --csv_out data/traffic_csvs --parquet_out data/processed_traffic

# 2. Phase 1 — self-supervised pretraining (~150 epochs, GPU recommended)
python3 -m netjepa.scripts.train_phase1  --config $CFG --ckpt_dir checkpoints/traffic8/phase1 --device cuda

# 3. Phase 2b — traffic-type SupCon + α-centering (inits from Phase 1)
python3 -m netjepa.scripts.train_phase2b --config $CFG \
    --init_ckpt checkpoints/traffic8/phase1/final.pt --ckpt_dir checkpoints/traffic8/phase2b --device cuda

# 4. Phase 3 — classification heads; also saves knn.joblib.
python3 -m netjepa.scripts.train_phase3  --config $CFG \
    --phase2_ckpt checkpoints/traffic8/phase2b/final.pt --ckpt_dir checkpoints/traffic8/phase3 --device cuda

# 5. Full evaluation against test split  → kNN 0.997, macro-F1 0.992
python3 -m netjepa.scripts.evaluate --config $CFG \
    --checkpoint checkpoints/traffic8/phase3/final.pt --device cuda

# 6. Export artifacts + galaxy cloud for the UI (uses labels.json for class names)
python3 -m netjepa.scripts.export_artifacts --config $CFG \
    --checkpoint checkpoints/traffic8/phase3/final.pt --dataset-id traffic8 --name "Traffic-8" --device cuda
python3 -m netjepa.scripts.export_cloud --config $CFG \
    --checkpoint checkpoints/traffic8/phase3/final.pt --dataset-id traffic8 --cap 1500 --device cuda

# 7. Live server (defaults to the 8-class model; upload .pcap via POST /api/infer).
#    If you skipped `pip install -e .`, add  --app-dir src  to the uvicorn line.
uvicorn server.app:app --host 0.0.0.0 --port 8000
#    …or classify in the terminal:
python3 -m netjepa.scripts.infer_pcap your.pcap \
    --checkpoint checkpoints/traffic8/phase3/final.pt --labels data/processed_traffic/labels.json
```

**Optional — cross-domain adaptation (Phase 2c).** Not part of the default
8-class model (phase1→2b→3); use only to adapt to a brand-new network outside the
trained sources, for which you have unlabelled captures. Requires a holdout split:

```bash
# a. Build a Kaggle-train / target-holdout split (target excluded from training)
python3 src/netjepa/scripts/preprocess_kaggle.py --out_dir data/processed_gen \
    --holdout_folders VLC_Teams,VLC_Netflix,VLC_Prime,VLC_YouTube,VLC_Roblox
#    then split holdout.parquet → vlc_adapt.parquet (unlabelled) + vlc_test.parquet

# b. Train Phase 1→2b→3 on the Kaggle-only split (--processed_dir data/processed_gen,
#    --ckpt_dir checkpoints/gen_*), then domain-adversarially adapt to the target:
python3 src/netjepa/scripts/train_phase2c.py --processed_dir data/processed_gen \
    --target_parquet data/processed_gen/vlc_adapt.parquet \
    --init_ckpt checkpoints/gen_phase2b/final.pt --ckpt_dir checkpoints/gen_phase2c

# c. Score transfer on the held-out target test
python3 src/netjepa/scripts/evaluate.py --processed_dir data/processed_gen \
    --checkpoint checkpoints/gen_phase2c/final.pt --test_parquet vlc_test.parquet
```

> DANN is optional and not part of the default 8-class model; it targets *true
> cross-deployment* to a brand-new network outside the trained sources. It aligns
> domains but generally needs a few target labels to actually lift transfer.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Degraded online / clean target | Forces encoder to learn network-condition-invariant representations |
| EMA target encoder | Prevents representation collapse without negative pairs |
| flow_ctx never degraded | Global statistics are stable; only packet timing is noisy |
| VICReg variance term | Prevents dimensional collapse (all embeddings becoming identical) |
| DBSCAN pseudo-labels | Provides class structure signal before any labels are used; clustered on the full set, labels keyed by flow index, contrastive skipped if <2 clusters |
| Balanced SupCon (Phase 2b) | Real-label supervised contrastive with class-balanced batches — the change that lifted macro-F1 and recovered sparse classes |
| Category-level SupCon + α-centering | Cosine KPI is category-level (Youtube+Netflix=intra) → supervise on categories; SupCon separates directions but leaves a common-mode cone → subtract α·mean to get inter-cosine < 0.3 while keeping intra > 0.7 |
| min_packets = 5 | Lowered from 10 to recover short flows (~33% more data, better class balance) without going below the ≥2 needed for IAT/RTT features |
| Class-weighted CE, not balanced sampling, in Phase 3 heads | One imbalance correction, not two — combining oversampling + weighting collapses the heads onto minority predictions |
| 143-dim embedding (128+15) | Residual connection of raw flow_ctx preserves interpretable stats |
| 500k row cap per CSV | Keeps parse time < 5s per file; still yields ~800 flows per file |
