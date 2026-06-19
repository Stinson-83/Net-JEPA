# Net-JEPA

- **Problem Statement Number** - 2
- **Problem Statement Title** - Context-Aware Flow Embeddings for Adaptive AI based Network Traffic Classification
- **Team name** - FlowState
- **Team members (Names)** - Archisman Dhar, Kritik Gupta
- **Institute/College Name** - Indian Institute of Technology Kanpur
- **Final Presentation Google Drive Link** - *Upload the PDF presentation for your final submission on Google Drive (It should be openly accessible and not behind any login wall)*
- **Full Submission Demo Video Link** - *(Upload the Demo video on Youtube as a public or unlisted video and share the link. Google Drive uploads for video is not allowed.)*
- **Setup & Result Reproducibility Video Link** - *(Upload the Demo video on Youtube as a public or unlisted video and share the link. Google Drive uploads for video is not allowed.)*

### Project Artefacts

- **Technical Documentation** - Full technical write-up is in the [**`docs/`**](docs/) folder
  ([index](docs/README.md)): [overview](docs/overview.md) · [architecture](docs/architecture.md) ·
  [datasets](docs/datasets.md) · [tech-stack & OSS libraries](docs/tech-stack.md) ·
  [installation & usage](docs/usage.md) · [salient features](docs/features.md) ·
  [results & KPIs](docs/results.md) · [presentation outline](docs/presentation.md).
  A deeper engineering reference with ASCII diagrams is in [`doc.md`](doc.md), and an honest
  chronological research log (bugs, dead-ends, fixes) is in [`experimentation.md`](experimentation.md).
- **[Important]** Agentic-AI write-up: [**`docs/ax.md`**](docs/ax.md) — how we built this
  human-steered with Claude Code (Opus 4.8), including **what worked and what did not**.
- **Source Code** - All Python source is under [**`src/`**](src/): `src/netjepa/` (core ML
  package — data, model, loss, training phases, downstream, evaluation, scripts), `src/server/`
  (FastAPI + WebSocket inference server), and `src/capture/` + `src/flows/` + `src/model/` (live
  packet capture, flow grouping, classifier adapter). The web front-end is `webui/` (the "Signal
  Atlas" React/WebGL app, with its own `webui/src/`). The package is installable with
  `pip install -e .`; the training/eval scripts also self-bootstrap, so they run directly with
  `python src/netjepa/scripts/<script>.py`. Install/run steps: [docs/usage.md](docs/usage.md).
- **Models Used** - **None** (no pre-trained / foundation / closed-weight models). Net-JEPA is
  trained **from scratch** on the datasets below. See [docs/tech-stack.md §4.4](docs/tech-stack.md).
- **Models Published** - The trained Net-JEPA model (Phase-3 checkpoint + fitted cosine k-NN) is
  **publishable to Hugging Face with one command** — model card in
  [`docs/hf_model_card.md`](docs/hf_model_card.md), uploader in
  [`src/netjepa/scripts/publish_hf.py`](src/netjepa/scripts/publish_hf.py):
  `HF_TOKEN=… python src/netjepa/scripts/publish_hf.py --repo-id <user>/net-jepa` (Apache-2.0).
  **Hugging Face link:** _‹paste here once published›_. The checkpoint is also fully reproducible
  end-to-end from the scripts (gitignored due to size).
- **Datasets Used** -
  - [Kaggle · 5G Traffic Datasets](https://www.kaggle.com/datasets/kimdaegyeom/5g-traffic-datasets) (`kimdaegyeom/5g-traffic-datasets`) — primary training/test set.
  - [Zenodo · VLC / Valencia Flow-Based Traffic Classification](https://zenodo.org/records/15121418) — **CC-BY-4.0** (MS Teams supervised; Netflix/Prime/YouTube/Roblox pretrain-only).
  - [Kaggle · Cloud Gaming Network Telemetry](https://www.kaggle.com/datasets/carloshfm/cloud-gaming-network-telemetry) (`carloshfm/cloud-gaming-network-telemetry`, [GitHub](https://github.com/dcomp-leris/VR-AR-CG-network-telemetry)) — **BSD-3** (Xbox Cloud over 5G, pretrain-only).

    Details, licenses, and how each was folded in: [docs/datasets.md](docs/datasets.md).
- **Datasets Published** - None. We publish no new dataset; all sources above are already public.
  The converted CSVs / processed parquet are reproducible from the scripts and are gitignored.

#### Final Presentation

Unlike Phase 1 presentation, in Phase 2 you can freely decide the template, flow and content of your technical presentation. Ensure you cover all aspects of your solution - innovation, novelty, architecture, open datasets/models developed and used, final deliverable details, KPIs of your solution, AI/Agent use, any other details. 

#### Full Submission Demo Video

Create a high quality video demonstration your solution in real life and showcasing how it is actually solves the proposed AX Hackathon problem.

#### Setup & Result Reproducibility Video

To ensure reproducibility of results and to verify the presented KPIs, we require you to create a video demonstrating:
- Step by step project installation,
- Data/model download steps, 
- Execution of all required codes to train the developed models (if any)
- Execution of all evaluation codes to reproduce the presented results/KPIs 

### Attribution

This project is **original work**, not a fork of an existing codebase. It is conceptually
inspired by published research, which we credit:

- **JEPA / I-JEPA** (LeCun; Assran et al., 2023) — the joint-embedding predictive idea.
- **VICReg** (Bardes, Ponce, LeCun, 2022) — the variance/invariance/covariance anti-collapse loss.
- **Supervised Contrastive Learning** (Khosla et al., 2020) — the category-level SupCon fine-tune.
- **DANN** (Ganin & Lempitsky, 2015) — the gradient-reversal domain-adaptation phase.

We adapted these ideas to **encrypted network-flow classification** and added our own
contributions: a packet-shape flow encoder with RTT/context fusion, the α-centering
("isotropisation") trick that meets the inter-class cosine KPI, category-level SupCon on a kept
embedding, the pretrain-only vs supervised data-routing that removes a domain confound, and the
"Signal Atlas" live demo. All OSS libraries we build on are credited in
[docs/tech-stack.md](docs/tech-stack.md).
