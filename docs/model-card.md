---
license: apache-2.0
library_name: pytorch
pipeline_tag: feature-extraction
tags:
  - network-traffic-classification
  - encrypted-traffic
  - self-supervised-learning
  - jepa
  - vicreg
  - flow-embeddings
  - 5g
---

# Net-JEPA — Context-Aware Flow Embeddings for Encrypted Network Traffic

Net-JEPA is a **Joint-Embedding Predictive Architecture (JEPA)** for **encrypted** network
flows. It classifies traffic into **8 common traffic types** from the *shape* of the traffic —
packet sizes, inter-arrival timing, and direction — **without decrypting any payload**. It is
trained **from scratch** (no foundation / pre-trained / closed-weight model is used anywhere).

- **Code / full docs:** https://github.com/Stinson-83/Net-JEPA
- **Team:** FlowState (Archisman Dhar, Kritik Gupta), IIT Kanpur — Samsung EnnovateX 2026, PS #2
- **License:** Apache-2.0

## What's in this repository

| File | What it is |
|---|---|
| `net_jepa_phase3.pt` | Trained Net-JEPA checkpoint (Phase 3, epoch 50) — encoder + fusion + downstream embedding head, with α-centering baked in (~1.76 M params) |
| `knn.joblib` | Fitted cosine **k-NN (k=5)** traffic-type classifier over the labelled embeddings |
| `labels.json` | The 8 traffic-type names + `type2id` mapping |
| `config.yaml` | The exact `traffic.yaml` hyper-parameters used to build the model |
| `umap.joblib` | *(optional)* Fitted UMAP reducer (128-D → 2-D) for the Signal Atlas visualization — **not needed for classification** |

The checkpoint produces a **128-D L2-normalised embedding** per flow; the k-NN reads that
embedding to predict one of 8 traffic types.

## Model details

- **Input:** a flow's first ≤64 packets as a `(64 × 9)` tensor `[size/1500, log1p(IAT), signed
  direction, protocol one-hot×4, rtt_norm, rtt_flag]` + a `(15,)` flow-context vector (durations,
  flag ratios, **per-capture host stats**, RTT) + a `(64,)` padding mask.
- **Encoder:** 4-layer Temporal Transformer (`d=128`, 4 heads) + cross-attention fusion with the
  flow-context vector.
- **Self-supervised pretraining:** masked-latent prediction against an EMA target branch with a
  **VICReg** loss (no labels, no negatives).
- **Supervised sharpening:** traffic-type-level **SupCon** on the kept embedding, then
  **α-centering** (common-mode removal, α≈0.65) to isotropise the space.
- **Classifier:** cosine **k-NN (k=5)**.
- **Size / speed:** ~1.76 M parameters; **~6.5 ms / flow on CPU (p95)** (no GPU needed to serve).

### The eight traffic types

`audio_streaming` · `cloud_gaming` · `live_streaming` · `metaverse` · `online_gaming` ·
`video_conferencing` · `video_on_demand` · `web_browsing`.

## Evaluation (held-out test split)

| Benchmark KPI | Target | Achieved |
|---|---|---|
| Intra-class cosine | > 0.7 | **0.87** |
| Inter-class cosine | < 0.3 | **0.13** |
| Classification accuracy | ≥ 90% | **75.3%** |
| Generalization (few-shot, η=7) | ≥ 85% | **77.3%** |
| Real-time latency / flow | < 100 ms | **6.5 ms** (CPU, p95) |

macro-F1 **0.680** · weighted-F1 **0.729** · silhouette **0.475**. Per-class F1 ranges from
0.14 (video conferencing, the hardest class) to 0.99 (online gaming). Hard classes:
video_conferencing 0.139, video_on_demand 0.369, web_browsing 0.609. Full numbers: see the
repo's `docs/results.md`.

## How to use

The checkpoint needs the `netjepa` code to instantiate the architecture.

```bash
git clone https://github.com/Stinson-83/Net-JEPA && cd Net-JEPA
pip install -r requirements.txt && pip install -e .
pip install huggingface_hub
```

```python
import joblib, json, torch
from huggingface_hub import hf_hub_download
from netjepa.model.netjepa import NetJEPA
from netjepa.utils.io import load_checkpoint

REPO = "<your-username>/net-jepa"   # this repo id
ckpt   = hf_hub_download(REPO, "net_jepa_phase3.pt")
knn    = joblib.load(hf_hub_download(REPO, "knn.joblib"))
labels = json.load(open(hf_hub_download(REPO, "labels.json")))["traffic_types"]

model = NetJEPA()
load_checkpoint(model, None, ckpt, torch.device("cpu"))
model.eval()

# pkt: (1,64,9) float, ctx: (1,15) float, mask: (1,64) bool
emb = model.forward_downstream(pkt, ctx, mask).detach().cpu().numpy()  # (1,128)
traffic_type = labels[int(knn.predict(emb)[0])]
```

For end-to-end `.pcap` inference (parse → flow → embed → classify → 2-D projection), use the
terminal tool `python -m netjepa.scripts.infer_pcap your.pcap --checkpoint <ckpt> --labels labels.json`
or the FastAPI server (`src/server/app.py`) — see `docs/install.md`. The flow-building and feature
code is **identical** to training (including per-capture host stats), so real captures classify
correctly (e.g. a browser YouTube capture → `video_on_demand`).

## Training data

All datasets are **public**; the current model trains on **8 labelled traffic types**:

- [Kaggle · 5G Traffic Datasets](https://www.kaggle.com/datasets/kimdaegyeom/5g-traffic-datasets) — primary train/test (license "Unknown" → used under Kaggle terms, not redistributed).
- [Zenodo · VLC / Valencia](https://zenodo.org/records/15121418) (**CC-BY-4.0**) — full VLC set: Spotify → audio_streaming, Web → web_browsing, Netflix/Prime/YouTube → video_on_demand, Roblox → metaverse, Teams → video_conferencing.
- [Kaggle · Cloud Gaming Network Telemetry](https://www.kaggle.com/datasets/carloshfm/cloud-gaming-network-telemetry) (**BSD-3**) — Xbox Cloud over 5G → cloud_gaming.

28,892 flows → 19,620 train (pretrain = downstream) / 9,272 test (~32%), capture-level 70/30 leak-free split (per-class GroupShuffleSplit on `source_file`).

## Intended use & limitations

- **Intended:** QoS / 5G-slice prioritisation, traffic analytics, and anomaly triage on
  **encrypted** flows where DPI is impossible. Operates on metadata only.
- **Out of scope:** identifying individual users or payload content (it cannot — only flow shape
  is modelled).
- **Known limitation:** classification relies on per-capture host-behaviour
  features, so a pcap containing only a **single flow** yields degenerate host stats and may
  misclassify. Real captures contain many flows and classify correctly; multi-flow captures of the
  8 trained types — including out-of-domain browser QUIC — classify correctly. See `docs/results.md`.

## Citation

```bibtex
@misc{netjepa2026,
  title  = {Net-JEPA: Context-Aware Flow Embeddings for Adaptive AI-based Network Traffic Classification},
  author = {Dhar, Archisman and Gupta, Kritik},
  year   = {2026},
  note   = {Samsung EnnovateX 2026, Problem Statement 2},
  url    = {https://github.com/Stinson-83/Net-JEPA}
}
```

Builds on I-JEPA (Assran et al., 2023) and V-JEPA (Bardes et al., 2024) for the
joint-embedding / EMA-target architecture and masking; VICReg (Bardes et al., 2022) and SupCon
(Khosla et al., 2020) for the objectives; Horowicz et al. (IEEE TNSM 2024) for the
network-behaviour augmentations and few-shot / top-k evaluation; FlowXpert (Zha et al., 2025)
for the flow-context / host-behaviour features, DBSCAN contrastive, and residual fusion;
TrafficScope (Zhao et al., KDD 2025) for the cross-attention fusion; and DANN (Ganin &
Lempitsky, 2015) for the optional domain-adaptation phase. Original contributions: α-centering,
traffic-type SupCon, and per-capture train/inference-consistent host stats. Full attribution:
`docs/attributions.md`.
