# Net-JEPA

- **Problem Statement Number** - 2
- **Problem Statement Title** - Context-Aware Flow Embeddings for Adaptive AI based Network Traffic Classification
- **Team name** - FlowState
- **Team members (Names)** - Archisman Dhar, Kritik Gupta
- **Institute/College Name** - Indian Institute of Technology Kanpur
- **Final Presentation Google Drive Link** - *Upload the PDF presentation for your final submission on Google Drive (It should be openly accessible and not behind any login wall)*
- **Full Submission Demo Video Link** - *(Upload the Demo video on Youtube as a public or unlisted video and share the link. Google Drive uploads for video is not allowed.)*
- **Setup & Result Reproducibility Video Link** - https://youtu.be/9hg59ky33hs
### Project Artefacts

- **Technical Documentation** - The complete technical write-up lives in the
  [**`docs/`**](docs/) folder ([index](docs/README.md)): [overview](docs/overview.md) ·
  [architecture](docs/architecture.md) · [implementation details](docs/implementation.md) ·
  [datasets](docs/datasets.md) · [tech-stack & OSS libraries](docs/tech-stack.md) ·
  [installation](docs/install.md) · [user guide](docs/user-guide.md) ·
  [salient features](docs/features.md) · [results & KPIs](docs/results.md) ·
  [model card](docs/model-card.md) · [attributions & references](docs/attributions.md) ·
  [experimentation log](docs/experiments.md).
- **[Important]** Agentic-AI write-up: [**`docs/ax.md`**](docs/ax.md) — how we
  built this human-steered with Claude Code (Opus 4.8), including **what worked and what did not**.
- **Source Code** - All Python source is under [**`src/`**](src/): `src/netjepa/` (core ML
  package — data, model, loss, training phases, downstream, evaluation, scripts), `src/server/`
  (FastAPI + WebSocket inference server), and `src/capture/` + `src/flows/` + `src/model/` (live
  packet capture, flow grouping, classifier adapter). The web front-end is `webui/` (the "Signal
  Atlas" React/WebGL app, with its own `webui/src/`). The package is installable with
  `pip install -e .`; the training/eval scripts also self-bootstrap, so they run directly with
  `python src/netjepa/scripts/<script>.py`. Install/run steps: [docs/install.md](docs/install.md).
  **Quickstart (clone + run):** `make demo` launches the live application — the Signal Atlas UI plus
  trained-model `.pcap` classification, with the weights **auto-downloaded from Hugging Face** and no
  dataset required (the embedding view runs off committed embeddings). `make reproduce` reproduces the
  KPIs; `make help` lists every target. Installation happens automatically on first run.
- **Models Used** - **None** (no pre-trained / foundation / closed-weight models). Net-JEPA is
  trained **from scratch** on the datasets below. See [docs/tech-stack.md](docs/tech-stack.md).
- **Models Published** - **Hugging Face:
  [`kritikahd007/net-jepa`](https://huggingface.co/kritikahd007/net-jepa)** (**Apache-2.0**) — the
  full trained **8-traffic-type** Net-JEPA model (Phase-3 checkpoint `net_jepa_phase3.pt`, ~1.76M
  params: encoder + fusion + predictor + EMA target + pooling + embedding head + α-centering) plus
  the fitted cosine k-NN (`knn.joblib`), config, `labels.json` (the 8 type names), and model card
  ([`docs/model-card.md`](docs/model-card.md)). Test KPIs: accuracy **99.7%**, macro-F1
  **0.992**. Re-publishable from [`src/netjepa/scripts/publish_hf.py`](src/netjepa/scripts/publish_hf.py)
  (`HF_TOKEN=… python src/netjepa/scripts/publish_hf.py --repo-id <user>/net-jepa`); checkpoint is
  also reproducible end-to-end from the training scripts.
- **Datasets Used** -
  - [Kaggle · 5G Traffic Datasets](https://www.kaggle.com/datasets/kimdaegyeom/5g-traffic-datasets) (`kimdaegyeom/5g-traffic-datasets`) — primary training/test set. **License "Unknown" on Kaggle**, so we use it under Kaggle's terms and **don't redistribute it** — `fetch_assets.py` pulls it from source and preprocesses locally.
  - [Zenodo · VLC / Valencia Flow-Based Traffic Classification](https://zenodo.org/records/15121418) — **CC-BY-4.0** (full VLC set incl. Spotify → audio_streaming, Web → web_browsing, Netflix/Prime/YouTube → VOD, Roblox → metaverse, Teams → video_conferencing — all supervised into the 8 traffic types).
  - [Kaggle · Cloud Gaming Network Telemetry](https://www.kaggle.com/datasets/carloshfm/cloud-gaming-network-telemetry) (`carloshfm/cloud-gaming-network-telemetry`, [GitHub](https://github.com/dcomp-leris/VR-AR-CG-network-telemetry)) — **BSD-3** (Xbox Cloud over 5G → cloud_gaming, supervised).

    The current model classifies **8 common traffic types** (audio_streaming, cloud_gaming,
    live_streaming, metaverse, online_gaming, video_conferencing, video_on_demand,
    web_browsing), all fully supervised. Source→type mapping, licenses, preprocessing, and how
    a raw `.pcap` is processed at inference: [docs/datasets.md](docs/datasets.md).
- **Datasets Published** - No new dataset. The repository commits the **derived, metadata-only
  feature CSVs** (`data/traffic_csvs/`, provenance in `SOURCES.md`): per-flow statistics
  (packet sizes / inter-arrival times / direction + counters) with **no payloads, IPs, ports,
  or hostnames**, and no raw captures. The 5G-derived rows fall under that set's **"Unknown"**
  license (review its terms before reuse); VLC is CC-BY-4.0 and cloud-gaming BSD-3. Everything
  is also **rebuildable from source** — `python src/netjepa/scripts/fetch_assets.py` downloads
  the raw data and preprocesses locally; the processed parquet stays gitignored. See
  [docs/datasets.md](docs/datasets.md).


### Attribution

This project is **original work**, not a fork of an existing codebase. It is conceptually
inspired by published research, which we credit:

- **I-JEPA** (Assran et al., 2023) and **V-JEPA** (2024) — the joint-embedding predictive architecture and masking.
- **VICReg** (Bardes, Ponce, LeCun, 2022) — the variance/invariance/covariance anti-collapse loss.
- **Supervised Contrastive Learning** (Khosla et al., 2020) — the category-level SupCon fine-tune.
- **Horowicz et al.** (IEEE TNSM 2024) — the network-behaviour augmentations (RTT / time-shift / packet-loss) and the few-shot / top-k evaluation.
- **FlowXpert** (Zha et al., 2025) — the flow-context / host-behaviour features, DBSCAN contrastive, and residual fusion.
- **TrafficScope** (Zhao et al., KDD 2025) — the temporal × context cross-attention fusion.
- **DANN** (Ganin & Lempitsky, 2015) — the gradient-reversal domain-adaptation phase.

The full per-method attribution — with the exact file each is used in — is in
[docs/attributions.md](docs/attributions.md).

We adapted these ideas to **encrypted network-flow classification** and added our own
contributions: a packet-shape flow encoder with RTT/context fusion, the α-centering
("isotropisation") trick that meets the inter-class cosine KPI, category-level SupCon on a kept
embedding, **per-capture host-stat features that are train/inference-consistent** (the fix that
took accuracy 0.86 → 0.977 and made real-`.pcap` upload classify correctly; full supervision
then lifted it to 0.997), and the "Signal Atlas" live demo. All OSS libraries we build on are
credited in [docs/tech-stack.md](docs/tech-stack.md).
