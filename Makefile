# Net-JEPA — reproducibility & demo shortcuts.  Run `make` (or `make help`) to list targets.
#
# One-command reproduction (the KPI video):   make reproduce
# Live demo (two terminals):                   make serve   |   make webui
# Train from scratch (GPU recommended):        make fetch && make train DEVICE=cuda
#
# Override vars on the CLI, e.g.:  make train DEVICE=cuda   |   make fetch-foldins FOLDIN_APPS=teams,netflix
PY          ?= python3
DEVICE      ?= cpu
CKPT        ?= checkpoints/phase3/final.pt
DATASET_ID  ?= phase3b_supcon
FOLDIN_APPS ?= teams
PORT        ?= 8000

SCRIPTS := src/netjepa/scripts

.DEFAULT_GOAL := help
.PHONY: help install install-py install-web fetch fetch-weights fetch-foldins \
        reproduce evaluate serve webui train export clean clean-assets

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ── setup ──────────────────────────────────────────────────────────────────
install: install-py install-web ## Install Python (editable) + web deps

install-py: ## Install Python deps and the src/ package (pip install -e .)
	$(PY) -m pip install -r requirements.txt
	$(PY) -m pip install -e .

install-web: ## Install the webui (npm) deps
	cd webui && npm install

# ── fetch assets (weights from HF, data from source) ───────────────────────
fetch: ## Download weights (HF) + build 5G-base data (Kaggle -> preprocess)
	$(PY) $(SCRIPTS)/fetch_assets.py

fetch-weights: ## Download only the pretrained weights from Hugging Face (no Kaggle needed)
	$(PY) $(SCRIPTS)/fetch_assets.py --weights-only

fetch-foldins: ## Add VLC/cloud-gaming fold-ins to the data (FOLDIN_APPS=teams default; LARGE)
	$(PY) $(SCRIPTS)/fetch_assets.py --data-only --with-foldins --foldin-apps $(FOLDIN_APPS)

# ── reproduce / run ────────────────────────────────────────────────────────
reproduce: install fetch evaluate ## One-shot: install -> fetch (weights+data) -> reproduce KPIs

evaluate: ## Evaluate the checkpoint and print the KPI summary (vars: CKPT, DEVICE)
	$(PY) $(SCRIPTS)/evaluate.py --checkpoint $(CKPT) --device $(DEVICE)

serve: ## Run the live inference server (auto-fetches weights from HF if missing)
	$(PY) -m uvicorn server.app:app --app-dir src --host 0.0.0.0 --port $(PORT)

webui: ## Run the Signal Atlas web UI (Vite dev server, http://localhost:5173)
	cd webui && npm run dev

# ── train from scratch (run `make fetch` first; DEVICE=cuda recommended) ────
train: ## Full pipeline: phase1 -> phase2b -> phase3 -> evaluate (needs data; DEVICE=cuda)
	$(PY) $(SCRIPTS)/train_phase1.py  --device $(DEVICE)
	$(PY) $(SCRIPTS)/train_phase2b.py --device $(DEVICE)
	$(PY) $(SCRIPTS)/train_phase3.py  --device $(DEVICE)
	$(PY) $(SCRIPTS)/evaluate.py --checkpoint $(CKPT) --device $(DEVICE)

export: ## Export atlas artifacts + galaxy cloud for the web UI
	$(PY) $(SCRIPTS)/export_artifacts.py --checkpoint $(CKPT) --dataset-id $(DATASET_ID) --name "Phase 3b" --device $(DEVICE)
	$(PY) $(SCRIPTS)/export_cloud.py     --checkpoint $(CKPT) --dataset-id $(DATASET_ID) --cap 1500 --device $(DEVICE)

# ── cleanup ────────────────────────────────────────────────────────────────
clean: ## Remove __pycache__, egg-info, and eval outputs (keeps fetched weights/data)
	find . -path ./webui/node_modules -prune -o -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
	rm -rf eval_results eval_results_check src/*.egg-info *.egg-info

clean-assets: ## Also delete fetched weights + processed data (forces a clean re-fetch)
	rm -rf data/processed checkpoints/phase3/final.pt checkpoints/phase3/knn.joblib
