# 4 · Technical Stack & Open-Source Libraries

Everything is open-source. No proprietary services; the model runs and serves on commodity
CPU. Versions are pinned in `requirements.txt` (Python) and `webui/package.json` (web).

## 4.1 Machine-learning core (Python)

| Library | Used for | Link |
|---|---|---|
| **PyTorch** | The entire model — Transformers, EMA, training loops | https://pytorch.org |
| **scikit-learn** | k-NN classifier, DBSCAN pseudo-labels, metrics, splits | https://scikit-learn.org |
| **umap-learn** | 128-D → 2-D projection for the atlas; reusable reducer | https://umap-learn.readthedocs.io |
| **NumPy** | Array math throughout | https://numpy.org |
| **pandas** + **pyarrow** | Data wrangling, Parquet I/O | https://pandas.pydata.org · https://arrow.apache.org |
| **SciPy** | Statistics in evaluation | https://scipy.org |
| **joblib** | Persisting the fitted k-NN + UMAP reducer | https://joblib.readthedocs.io |
| **tqdm** | Training progress | https://github.com/tqdm/tqdm |
| **matplotlib** / **seaborn** | Confusion matrices, distribution plots | https://matplotlib.org · https://seaborn.pydata.org |
| **Weights & Biases** (optional) | Experiment logging | https://wandb.ai |

## 4.2 Packet processing & serving

| Library | Used for | Link |
|---|---|---|
| **Scapy** | Reading pcap/pcapng; pcap→CSV conversion; live replay | https://scapy.net |
| **FastAPI** | REST + WebSocket inference server | https://fastapi.tiangolo.com |
| **Uvicorn** | ASGI server | https://www.uvicorn.org |
| **websockets** | `/ws` live pipeline stream (pinned ≥10) | https://websockets.readthedocs.io |
| **python-multipart** | `.pcap` file uploads | https://github.com/Kludex/python-multipart |
| **stream-unzip** | Stream-extract only the needed files from a 28 GB Kaggle zip | https://pypi.org/project/stream-unzip |

## 4.3 The "Signal Atlas" front-end (TypeScript)

| Library | Used for | Link |
|---|---|---|
| **React 19** | UI | https://react.dev |
| **Vite** | Build tooling / dev server | https://vite.dev |
| **TypeScript** | Type-safe front-end | https://www.typescriptlang.org |
| **Tailwind CSS 4** | Design system / styling | https://tailwindcss.com |
| **regl** | WebGL renderer for the 7,481-point flow galaxy | https://github.com/regl-project/regl |
| **Zustand** | Lightweight state management | https://github.com/pmndrs/zustand |
| **clsx** | Conditional class names | https://github.com/lukeed/clsx |
| ESLint, typescript-eslint | Linting | https://eslint.org |

Icons are hand-rolled inline SVG (no icon-library dependency). Fonts: Space Grotesk, Inter,
JetBrains Mono (Google Fonts).

## 4.4 Models

- **Models used:** none pre-trained / no foundation model. Net-JEPA is trained from scratch
  on the datasets in [datasets.md](datasets.md). No closed-weight models are used anywhere.
- **Models published:** **[`kritikahd007/net-jepa`](https://huggingface.co/kritikahd007/net-jepa)**
  on Hugging Face under **Apache-2.0** — the full trained model (Phase-3 checkpoint, ~1.76M params)
  + fitted cosine k-NN + config + model card ([`hf_model_card.md`](hf_model_card.md)). Re-publishable
  via `src/netjepa/scripts/publish_hf.py` (`HF_TOKEN=… python src/netjepa/scripts/publish_hf.py
  --repo-id <user>/net-jepa`; add `--with-umap` to also ship the 2-D atlas reducer). Checkpoints are
  gitignored due to size and remain reproducible end-to-end from the scripts.

## 4.5 Why this stack

- **CPU-first, edge-deployable** — PyTorch model is tiny; serving needs no GPU (~4.5 ms/flow).
- **No vendor lock-in** — every component is permissively licensed OSS.
- **Reproducible** — one `requirements.txt`, one `npm install`, deterministic seeds.
