# 6 · Installation & Usage

## 6.1 Prerequisites

- Python 3.10+ and Node 20+
- (Optional) an NVIDIA GPU for faster training — **not** required for inference/serving
- `tshark` is **not** required (pcap conversion uses scapy)

## 6.2 Install

```bash
pip install -r requirements.txt   # runtime deps (torch, scapy, fastapi, umap-learn, …)
pip install -e .                  # register the src/ packages (netjepa, server, capture, flows, model)
cd webui && npm install && cd ..  # front-end deps
```

All Python source lives under `src/` (see [architecture.md §2.6](architecture.md)). `pip install -e .`
makes `netjepa`, `server`, etc. importable from any directory. You can skip it if you prefer — the
training/eval scripts self-bootstrap their import path, and the server can be launched with
`--app-dir src` (shown below).

## 6.3 Run the live demo (the fast path)

The trained checkpoints + the exported atlas data are produced by the pipeline. With them
in place you can run the demo directly — two processes:

```bash
# Terminal A — inference server (defaults are already correct)
uvicorn server.app:app --host 0.0.0.0 --port 8000
#   if you skipped `pip install -e .`, add  --app-dir src  to the line above
#   NETJEPA_CKPT=checkpoints/phase3/final.pt   DATASET_ID=phase3b_supcon
#   sanity check:  curl localhost:8000/api/health   → {"ok": true, ...}

# Terminal B — the Signal Atlas web UI
cd webui && npm run dev          # → http://localhost:5173
```

Open the printed URL. The UI auto-detects the server ("LIVE MODEL" lights up) and also
works **fully offline** off the committed static export. Production build: `npm run build`.

**Kiosk / demo deep-links:** `?skipintro` jumps straight to the Atlas; `?scene=proof`
(or `model` / `journey`) opens a specific scene; keys `1–4` switch scenes.

## 6.4 Train from scratch (only if you change data/model)

```bash
# 1. Preprocess (CSVs → parquet). Thresholds come from default.yaml.
python src/netjepa/scripts/preprocess_kaggle.py

# 2. Phase 1 — self-supervised pretraining (~15–25 min on GPU)
python src/netjepa/scripts/train_phase1.py  --device cuda

# 3. Phase 2b — category SupCon + α-centering (recommended; inits from Phase 1)
python src/netjepa/scripts/train_phase2b.py --device cuda

# 4. Phase 3 — heads + k-NN (saves knn.joblib); defaults to Phase 2b checkpoint
python src/netjepa/scripts/train_phase3.py  --device cuda

# 5. Evaluate against the test split
python src/netjepa/scripts/evaluate.py --checkpoint checkpoints/phase3/final.pt --device cuda

# 6a. Export metrics + reducer for the UI
python src/netjepa/scripts/export_artifacts.py --checkpoint checkpoints/phase3/final.pt \
    --dataset-id phase3b_supcon --name "Phase 3b" --device cuda

# 6b. Export the dense, balanced galaxy cloud (full real set, capped per class)
python src/netjepa/scripts/export_cloud.py --checkpoint checkpoints/phase3/final.pt \
    --dataset-id phase3b_supcon --cap 1500 --device cuda
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
| Fly through the galaxy | drag = orbit · scroll = zoom |
| Inspect a flow | **click any star** → packet "heartbeat", model verdict, k-NN neighbours |
| Solo a class | click it in the legend (left); hover for its packet signature |
| Classify your own traffic | **Upload .pcap** in the bottom dock (real inference if server is up) |
| Try without a pcap | click a **"simulate <class>"** chip — watch it walk the pipeline and land |
| See the model | top-bar **Model** tab — interactive JEPA, "Explain simply ↔ Show the math" |
| See the proof | **Proof** tab — KPIs, cosine separation, confusion matrix, per-class F1 |
| See the story | **Journey** tab — the honest research timeline |

## 6.6 Environment variables (server)

| Variable | Default | Description |
|---|---|---|
| `NETJEPA_CKPT` | `checkpoints/phase3/final.pt` | Trained checkpoint |
| `DATASET_ID` | `phase3b_supcon` | Export dir under `webui/public/data` (cloud + reducer + metrics) |
| `KNN_PATH` | auto-detected | `knn.joblib` next to the checkpoint |
| `VITE_SERVER_URL` (web) | `http://localhost:8000` | Where the UI looks for the server |
