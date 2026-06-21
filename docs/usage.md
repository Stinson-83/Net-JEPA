# 6 · Installation & Usage

## 6.1 Prerequisites

- Python 3.10+ and Node 20+
- (Optional) an NVIDIA GPU for faster training — **not** required for inference/serving
- `tshark` is **not** required (pcap conversion uses scapy)

> **Quick start (one command):** `make reproduce` → install → fetch weights+data → reproduce the KPIs.
> `make help` lists every shortcut; the explicit steps below are what each target runs.

## 6.2 Install

```bash
pip install -r requirements.txt   # runtime deps (torch, scapy, fastapi, umap-learn, …)
pip install -e .                  # register the src/ packages (netjepa, server, capture, flows, model)
cd webui && npm install && cd ..  # front-end deps
```

These commands are not normally run by hand: every `make` target (e.g. `make demo`, `make reproduce`)
installs automatically on first run and caches the result. The commands above are the manual equivalent
of `make install`.

All Python source lives under `src/` (see [architecture.md §2.6](architecture.md)). `pip install -e .`
makes `netjepa`, `server`, etc. importable from any directory. This step is optional: the
training/eval scripts self-bootstrap their import path, and the server can be launched with
`--app-dir src` (shown below).

## 6.3 Get the model + data, then run

Two things are **not** committed to the repo and must be fetched: the trained **weights**
(published on Hugging Face) and the **preprocessed data** (rebuilt from the raw 5G dataset on
Kaggle — its license is *"Unknown"*, so we don't redistribute it; you pull it from the source).
One command gets both:

```bash
python src/netjepa/scripts/fetch_assets.py            # weights (HF) + data (Kaggle → preprocess)
#   --weights-only   just the model (enough for the live demo)
#   --data-only      just the data (needed to evaluate / train)
```

- **Weights** come from `kritikahd007/net-jepa` — **no token needed** (public).
- **Data** uses `kagglehub`, so set Kaggle API creds (`KAGGLE_USERNAME`/`KAGGLE_KEY` or
  `~/.kaggle/kaggle.json`) and accept the dataset's terms on its Kaggle page first.
- The published checkpoint also folds in **VLC** (CC-BY-4.0) + **cloud-gaming** (BSD-3) captures on
  top of the 5G base. Add them with `--with-foldins` to match it exactly — **LARGE** (VLC ≈23 GB +
  cloud-gaming ≈28 GB), or grab just the high-value MS-Teams boost (≈2.6 GB) with
  `--with-foldins --foldin-apps teams`. Details: [datasets.md §3.6](datasets.md).

### Way 1 — pretrained (fast): reproduce the KPIs without training

```bash
python src/netjepa/scripts/fetch_assets.py                                    # weights + data
python -m netjepa.scripts.evaluate --config src/netjepa/configs/traffic.yaml \
    --checkpoint checkpoints/traffic8/phase3/final.pt
#   → prints the KPI summary: intra/inter cosine, kNN accuracy, few-shot, latency
```

**Or just `make reproduce`** (= `make install fetch evaluate`).

### Way 2 — from scratch: train everything → see §6.4.

### Run the live demo (either way)

```bash
# Terminal A — inference server (auto-downloads the weights from HF on first run if missing)
uvicorn server.app:app --host 0.0.0.0 --port 8000
#   if you skipped `pip install -e .`, add  --app-dir src  to the line above
#   sanity check:  curl localhost:8000/api/health   → {"ok": true, ...}

# Terminal B — the Signal Atlas web UI
cd webui && npm run dev          # → http://localhost:5173
```

**One command instead:** `make demo` — installs (first run), starts the server (weights auto-download
from Hugging Face), waits for it, then opens the UI. `make stop` stops the server afterwards. (Two
terminals if you prefer: `make serve` + `make webui`.)

Open the printed URL. The UI auto-detects the server ("LIVE MODEL" lights up) and also
works **fully offline** off the committed static export.

**Kiosk / demo deep-links:** `?skipintro` jumps straight to the Atlas; `?scene=proof`
(or `model`) opens a specific scene; keys `1–3` switch scenes.

## 6.4 Train from scratch (Way 2) — the 8-traffic-type model

Shortcut: **`make train DEVICE=cuda`** (run `make fetch-data` first). The 8-class pipeline uses
`src/netjepa/configs/traffic.yaml` (sets `processed_dir=data/processed_traffic`,
`num_categories=8`) and writes to `checkpoints/traffic8/`.

```bash
CFG=src/netjepa/configs/traffic.yaml

# 1. Stage raw data (Kaggle 5G + VLC + cloud-gaming) then BUILD the 8-class dataset.
python src/netjepa/scripts/fetch_assets.py --data-only --with-foldins   # stage raw captures
python -m netjepa.scripts.build_traffic_dataset \
    --raw_dir <5G_dataset_root> \
    --csv_out data/traffic_csvs --parquet_out data/processed_traffic
#    → per-type CSVs + {pretrain,downstream_train,test,fewshot_eta*}.parquet + labels.json
#      (host stats computed PER capture — see datasets.md §3.3)

# 2. Phase 1 — self-supervised pretraining (~15 min on GPU)
python -m netjepa.scripts.train_phase1  --config $CFG --ckpt_dir checkpoints/traffic8/phase1 --device cuda

# 3. Phase 2b — traffic-type SupCon + α-centering (inits from Phase 1)
python -m netjepa.scripts.train_phase2b --config $CFG \
    --init_ckpt checkpoints/traffic8/phase1/final.pt --ckpt_dir checkpoints/traffic8/phase2b --device cuda

# 4. Phase 3 — heads + k-NN (saves knn.joblib)
python -m netjepa.scripts.train_phase3  --config $CFG \
    --phase2_ckpt checkpoints/traffic8/phase2b/final.pt --ckpt_dir checkpoints/traffic8/phase3 --device cuda

# 5. Evaluate against the test split  → kNN ~0.997, macro-F1 ~0.992, all KPIs
python -m netjepa.scripts.evaluate --config $CFG \
    --checkpoint checkpoints/traffic8/phase3/final.pt --device cuda

# 6. Export metrics + reducer + galaxy cloud for the UI
python -m netjepa.scripts.export_artifacts --config $CFG \
    --checkpoint checkpoints/traffic8/phase3/final.pt --dataset-id traffic8 --name "Traffic-8" --device cuda
python -m netjepa.scripts.export_cloud --config $CFG \
    --checkpoint checkpoints/traffic8/phase3/final.pt --dataset-id traffic8 --cap 1500 --device cuda
```

### Classify a raw `.pcap` from the terminal

```bash
python -m netjepa.scripts.infer_pcap /path/to/capture.pcap \
    --checkpoint checkpoints/traffic8/phase3/final.pt \
    --labels data/processed_traffic/labels.json
#   → per-flow predictions + flow-count / packet-weighted / confidence summaries
#     + the DOMINANT traffic type by packets (the headline read on a capture)
#   (or:  make infer PCAP=/path/to/capture.pcap )
```

### Optional — fold in a new dataset

```bash
# convert raw captures → Wireshark CSV (add a FOLDER_MAP entry for the new app/category)
python src/netjepa/scripts/convert_vlc_pcap.py --vlc_dir <raw_dir> \
    --out_dir <5G_dataset_root> --max_packets 600000
# then re-run steps 1–6 above
```

### Optional — cross-domain adaptation (DANN)

```bash
# build a Kaggle-train / target-holdout split, then domain-adversarially adapt
python src/netjepa/scripts/preprocess_kaggle.py --out_dir data/processed_gen \
    --holdout_folders VLC_Teams,VLC_Netflix,VLC_Prime,VLC_YouTube,VLC_Roblox
python src/netjepa/scripts/train_phase2c.py --processed_dir data/processed_gen \
    --target_parquet data/processed_gen/vlc_adapt.parquet \
    --init_ckpt checkpoints/gen_phase2b/final.pt --ckpt_dir checkpoints/gen_phase2c
python src/netjepa/scripts/evaluate.py --processed_dir data/processed_gen \
    --checkpoint checkpoints/gen_phase2c/final.pt --test_parquet vlc_test.parquet
```

### Optional — publish the model to Hugging Face

The trained model is Apache-2.0 and tiny (~7 MB checkpoint + ~1.5 MB k-NN). Publish it under
your own namespace with one command (needs a write token from
https://huggingface.co/settings/tokens):

```bash
pip install huggingface_hub
HF_TOKEN=hf_xxx python src/netjepa/scripts/publish_hf.py --repo-id <your-username>/net-jepa
```

This uploads the Phase-3 checkpoint, the fitted cosine k-NN, the config, and the model card
([`docs/hf_model_card.md`](hf_model_card.md) → the repo's `README.md`). Then paste the printed
URL into the top-level README ("Models Published") and [tech-stack.md §4.4](tech-stack.md).

## 6.5 User guide — the Signal Atlas

| Action | How |
|---|---|
| Navigate the embedding view | drag = orbit · scroll = zoom |
| Inspect a flow | **click any point** → packet "heartbeat", model prediction, k-NN neighbours |
| Isolate a class | click it in the legend (left); hover for its packet signature |
| Classify your own traffic | **Upload .pcap** in the bottom dock (live inference if the server is running) |
| Demonstrate without a pcap | click a **"simulate <class>"** chip to run a representative flow through the pipeline |
| View the model | top-bar **Model** tab — interactive JEPA, "Explain simply ↔ Show the math" |
| View the results | **Proof** tab — KPIs, cosine separation, confusion matrix, per-class F1 |

## 6.6 Environment variables (server)

| Variable | Default | Description |
|---|---|---|
| `NETJEPA_CKPT` | `checkpoints/traffic8/phase3/final.pt` | Trained 8-class checkpoint |
| `NETJEPA_LABELS` | `data/processed_traffic/labels.json` | the 8 traffic-type names |
| `DATASET_ID` | `traffic8` | Export dir under `webui/public/data` (cloud + reducer + metrics) |
| `KNN_PATH` | auto-detected | `knn.joblib` next to the checkpoint |
| `NETJEPA_HF_REPO` | `kritikahd007/net-jepa` | HF repo the server auto-downloads weights from if the checkpoint is missing |
| `VITE_PROXY_TARGET` (web) | `http://localhost:8000` | inference server the Vite proxy forwards `/api`+`/ws` to; `make demo` sets it to `:$(PORT)` |
| `VITE_SERVER_URL` (web) | *(same-origin)* | override only to call the API at an absolute host instead of via the proxy |

The UI talks to the API at the **same origin** (relative `/api`+`/ws`) and Vite proxies it to the
server, so for a remote demo you only need to tunnel the **UI port (5173)** — not `:8000`. If `:8000`
is taken on your host, run `make demo PORT=<free>` (the proxy follows automatically).

## 6.7 Command cheat-sheet — 5 common use cases

**No manual setup needed** — every `make` target below installs dependencies automatically on first
run (and caches it). The non-`make` variants assume you've run `make install` once (or
`pip install -r requirements.txt && pip install -e .`).

Use `--device cpu` instead of `cuda` if you have no GPU (training is slower but works;
evaluation/inference are fine on CPU). `make help` lists every shortcut.

### 1 · Load weights + data, run the data through the pretrained model, evaluate

```bash
make reproduce
# — or explicitly —
python src/netjepa/scripts/fetch_assets.py                                      # weights (HF) + data (Kaggle→preprocess)
python -m netjepa.scripts.evaluate --config src/netjepa/configs/traffic.yaml \
    --checkpoint checkpoints/traffic8/phase3/final.pt --device cpu
```
Add `--with-foldins` to `fetch_assets.py` to match the published checkpoint exactly.

### 2 · Load only the weights, then classify a capture (prediction)

```bash
python src/netjepa/scripts/fetch_assets.py --weights-only      # just the model, no Kaggle
make serve                                                     # = uvicorn server.app:app --app-dir src
# in another shell, predict on a pcap → category + confidence + 2-D coords:
curl -F "file=@/path/to/your.pcap" http://localhost:8000/api/infer
```
Or use the GUI: `make webui` → drag a `.pcap` into the Inject Dock. (`make serve` even
auto-downloads the weights from HF if you skip the fetch step.)

### 3 · Fetch the data, train from scratch, evaluate

```bash
python src/netjepa/scripts/fetch_assets.py --data-only         # data from Kaggle (training needs no weights)
#   add --with-foldins to match the published config exactly
make train DEVICE=cuda                                         # build 8-class data → phase1→2b→3 → evaluate
# — or explicitly: see §6.4 (build_traffic_dataset + traffic.yaml + checkpoints/traffic8) —
```
The dataset comes from **Kaggle**, not HF — we don't republish it (license "Unknown").

### 4 · No downloads — build from local raw data, train from scratch, evaluate

```bash
CFG=src/netjepa/configs/traffic.yaml
python -m netjepa.scripts.build_traffic_dataset --raw_dir <path-to-5G_Traffic_Datasets> \
    --csv_out data/traffic_csvs --parquet_out data/processed_traffic
python -m netjepa.scripts.train_phase1  --config $CFG --ckpt_dir checkpoints/traffic8/phase1 --device cuda
python -m netjepa.scripts.train_phase2b --config $CFG --init_ckpt checkpoints/traffic8/phase1/final.pt --ckpt_dir checkpoints/traffic8/phase2b --device cuda
python -m netjepa.scripts.train_phase3  --config $CFG --phase2_ckpt checkpoints/traffic8/phase2b/final.pt --ckpt_dir checkpoints/traffic8/phase3 --device cuda
python -m netjepa.scripts.evaluate --config $CFG --checkpoint checkpoints/traffic8/phase3/final.pt --device cuda
```
`--raw_dir` points at your folder containing `GeForce_Now/`, `MS_Teams/`, `VLC_*/`, `CG_Xbox/`, …

### 5 · Run the frontend / UI (one command)

```bash
make demo             # install (first run) → start server (weights auto-download from HF) → open the UI
#   Ctrl-C stops the UI; then `make stop` stops the server.
```
This launches the full live system: uploading a `.pcap` in the UI runs the trained model and
classifies it. The server fetches the weights from Hugging Face automatically, and no dataset is
required (the embedding view runs off the committed embeddings). For two terminals, use `make serve`
+ `make webui`. The UI also works **fully offline** off the committed static export if no server is
running.
