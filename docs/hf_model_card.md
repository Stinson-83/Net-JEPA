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
flows. It classifies 5G application traffic into 6 categories from the *shape* of the traffic —
packet sizes, inter-arrival timing, and direction — **without decrypting any payload**. It is
trained **from scratch** (no foundation / pre-trained / closed-weight model is used anywhere).

- **Code / full docs:** https://github.com/Stinson-83/Net-JEPA
- **Team:** FlowState (Archisman Dhar, Kritik Gupta), IIT Kanpur — Samsung EnnovateX 2026, PS #2
- **License:** Apache-2.0

## What's in this repository

| File | What it is |
|---|---|
| `net_jepa_phase3.pt` | Trained Net-JEPA checkpoint (Phase 3, epoch 50) — encoder + fusion + downstream embedding head, with α-centering baked in |
| `knn.joblib` | Fitted cosine **k-NN (k=5)** category classifier over the labelled embeddings |
| `config.yaml` | The exact `default.yaml` hyper-parameters used to build the model |

The checkpoint produces a **128-D L2-normalised embedding** per flow; the k-NN reads that
embedding to predict one of 6 categories.

## Model details

- **Input:** a flow's first ≤64 packets as a `(64 × 9)` tensor `[size/1500, log1p(IAT), signed
  direction, protocol one-hot×4, rtt_norm, rtt_flag]` + a `(15,)` flow-context vector + a `(64,)`
  padding mask.
- **Encoder:** 4-layer Temporal Transformer (`d=128`, 4 heads) + cross-attention fusion with the
  flow-context vector.
- **Self-supervised pretraining:** masked-latent prediction against an EMA target branch with a
  **VICReg** loss (no labels, no negatives).
- **Supervised sharpening:** category-level **SupCon** on the kept embedding, then **α-centering**
  (common-mode removal, α≈0.65) to isotropise the space.
- **Classifier:** cosine **k-NN (k=5)**.
- **Size / speed:** a few-M-parameter model; **~4.5 ms / flow on CPU** (no GPU needed to serve).

### The six categories

`game_streaming` (cloud gaming) · `live_streaming` · `metaverse` · `online_game` ·
`stored_streaming` (on-demand video) · `video_conferencing`.

## Evaluation (held-out test split, category level)

| Benchmark KPI | Target | Achieved |
|---|---|---|
| Intra-class cosine | > 0.7 | **0.81** |
| Inter-class cosine | < 0.3 | **0.14** |
| Classification accuracy | ≥ 90% | **92.4%** |
| Generalization (few-shot CV) | ≥ 85% | **92%** |
| Real-time latency / flow | < 100 ms | **4.5 ms** (CPU) |

macro-F1 **0.90** · silhouette **0.51**. Per-class F1 ranges 0.71 (cloud gaming, the rarest /
hardest) to 0.96 (on-demand video). Full numbers: see the repo's `docs/results.md`.

## How to use

The checkpoint needs the `netjepa` code to instantiate the architecture.

```bash
git clone https://github.com/Stinson-83/Net-JEPA && cd Net-JEPA
pip install -r requirements.txt && pip install -e .
pip install huggingface_hub
```

```python
import joblib, torch
from huggingface_hub import hf_hub_download
from netjepa.model.netjepa import NetJEPA
from netjepa.utils.io import load_checkpoint

REPO = "<your-username>/net-jepa"   # this repo id
ckpt = hf_hub_download(REPO, "net_jepa_phase3.pt")
knn  = joblib.load(hf_hub_download(REPO, "knn.joblib"))

model = NetJEPA()
load_checkpoint(model, None, ckpt, torch.device("cpu"))
model.eval()

# pkt: (1,64,9) float, ctx: (1,15) float, mask: (1,64) bool
emb = model.forward_downstream(pkt, ctx, mask).detach().cpu().numpy()  # (1,128)
category_id = int(knn.predict(emb)[0])
```

For live `.pcap` inference end-to-end (parse → flow → embed → classify → 2-D projection), use
the FastAPI server in the repo (`src/server/app.py`) — see `docs/usage.md`.

## Training data

All datasets are **public and permissively licensed**:

- [Kaggle · 5G Traffic Datasets](https://www.kaggle.com/datasets/kimdaegyeom/5g-traffic-datasets) — primary train/test.
- [Zenodo · VLC / Valencia](https://zenodo.org/records/15121418) (**CC-BY-4.0**) — MS Teams used as
  supervised; Netflix/Prime/YouTube/Roblox used **pretrain-only**.
- [Kaggle · Cloud Gaming Network Telemetry](https://www.kaggle.com/datasets/carloshfm/cloud-gaming-network-telemetry) (**BSD-3**) — Xbox Cloud over 5G, **pretrain-only**.

## Intended use & limitations

- **Intended:** QoS / 5G-slice prioritisation, traffic analytics, and anomaly triage on
  **encrypted** flows where DPI is impossible. Operates on metadata only.
- **Out of scope:** identifying individual users or payload content (it cannot — only flow shape
  is modelled).
- **Known limitation (reported honestly):** a model trained on one 5G testbed does **not** transfer
  zero-shot to a *different* testbed (Kaggle→VLC cross-dataset transfer ≈ 5%). A few labelled
  target flows + DANN domain adaptation lift this to ≈ 0.39. Deploying to a new network needs a
  small amount of target labelling. See `docs/results.md`.

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

Conceptually inspired by I-JEPA (Assran et al., 2023), VICReg (Bardes et al., 2022),
SupCon (Khosla et al., 2020), and DANN (Ganin & Lempitsky, 2015); adapted to encrypted
network-flow classification with original contributions (packet-shape encoder + RTT/context
fusion, α-centering, category-level SupCon, pretrain-only data routing).
