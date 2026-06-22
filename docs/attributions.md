# Attributions & References

Net-JEPA builds on open research, open-source software, and public datasets. This page
credits each. Dataset provenance and licenses are in [datasets.md](datasets.md); the full
software stack in [tech-stack.md](tech-stack.md).

## Methods & research

The table lists only methods used in the **current** pipeline, with the file that uses each.
Common building blocks (Transformer, k-NN, AdamW, UMAP) are not cited as research here — they
appear in [tech-stack.md](tech-stack.md). From the traffic-augmentation work we reuse the
**augmentation strategy**, not a FlowPic image representation; from TrafficScope we use the
cross-attention fusion, **not** its wavelet stream (cut from the current pipeline).

| Component | Role in Net-JEPA (where) | Source |
|---|---|---|
| JEPA architecture — online encoder + predictor + **EMA target** (stop-gradient), mask-position conditioning, latent prediction | the self-supervised core (`model/ema.py`, `model/predictor.py`, `training/phase1.py`) | **I-JEPA** — Assran et al., CVPR 2023 · arXiv:2301.08243 |
| Temporal masking strategy (adapted to packet sequences; lower ratios than video) | adaptive masking in pretraining (`training/phase1.py`) | **V-JEPA** — Bardes et al. (Meta AI), 2024 |
| **VICReg** loss — invariance + variance + covariance; collapse prevention without negatives | primary pretraining objective (`loss/vicreg.py`) | Bardes, Ponce & LeCun, ICLR 2022 · arXiv:2105.04906 |
| **Supervised Contrastive (SupCon)** | traffic-type embedding sharpening, Phase 2b (`loss/supcon.py`) | Khosla et al., NeurIPS 2020 · arXiv:2004.11362 |
| **Network-behaviour augmentations** — Change RTT, Time Shift, Packet Loss (α∈U[0.5,1.5], b∈U[−1,1] s, 0.2 s window); few-shot (η 1–10) & top-k-pairs evaluation | online-branch degradation + eval (`data/augment.py`, `evaluation/fewshot.py`, `evaluation/topk_pairs.py`) | **Horowicz, Shapira & Shavitt** — IEEE TNSM 21(3), 2024 |
| **Flow-context features** incl. source-host behavioural stats (distinct dst IPs/ports, conn/sec); **DBSCAN pseudo-label margin-contrastive**; **residual fusion** (concat raw context + pooled embedding before the head) | feature design + auxiliary loss + downstream fusion (`data/features.py`, `loss/contrastive.py`, `model/netjepa.py`) | **FlowXpert** — Zha et al., 2025 · arXiv:2509.20861 |
| **Temporal × context cross-attention fusion**; sinusoidal positional encoding; 64-packet/flow cap | feature fusion + encoder (`model/fusion.py`, `model/encoders.py`) | **TrafficScope** — Zhao et al., KDD 2025 |
| **Domain-Adversarial Training (DANN)** | optional cross-domain adaptation, Phase 2c (`model/domain.py`) | Ganin & Lempitsky, ICML 2015 · arXiv:1409.7495 |

**Original contributions** (ours, not from the above): **α-centering** (common-mode removal,
to meet the inter-class cosine target); applying SupCon at the **traffic-type** level; and
**per-capture, train/inference-consistent host statistics** — building on FlowXpert's
host-behaviour features, but computing them *per capture* so they reproduce identically at
serving time (the fix that took accuracy 0.86 → 0.977 and made raw-`.pcap` upload work). See
[experiments.md](experiments.md).

## Datasets

All public; full provenance, licenses, and preprocessing in [datasets.md](datasets.md).

- **5G Traffic Dataset** — Choi, Kim & Ko (Kwangwoon University). IEEE DataPort, DOI
  `10.21227/ewhk-n061`; Kaggle `kimdaegyeom/5g-traffic-datasets`. License **"Unknown"** —
  used under Kaggle terms; only derived, metadata-only feature CSVs are redistributed.
- **VLC / Valencia traffic captures** — Zenodo record `15121418`. **CC-BY-4.0**.
- **Cloud-Gaming Network Telemetry** — Kaggle `carloshfm/cloud-gaming-network-telemetry`.
  **BSD-3-Clause**.

## Open-source software

Full pinned list with links in [tech-stack.md](tech-stack.md). Core: PyTorch, scikit-learn,
umap-learn, NumPy, pandas, pyarrow, SciPy (ML); Scapy, FastAPI, Uvicorn (pipeline + serving);
React, Vite, TypeScript, Tailwind CSS, regl (front-end). All permissively licensed.

## Models

- **No pre-trained, foundation, or closed-weight model is used anywhere** — Net-JEPA is
  trained from scratch.
- **Published open-weight:**
  [`kritikahd007/net-jepa`](https://huggingface.co/kritikahd007/net-jepa) on Hugging Face
  under **Apache-2.0** (checkpoint + fitted cosine k-NN + config). See [model-card.md](model-card.md).
- Built **human-steered with Claude Code** (agentic development tooling) — see
  [agentic-ai.md](agentic-ai.md).
