# Net-JEPA — just clone the repo and run these.  `make help` lists everything.
#
#   See it work (UI + live model):   make demo        weights auto-download from Hugging Face
#   Reproduce the KPIs:              make reproduce   installs, fetches weights+data, evaluates
#
# Install happens automatically the first time (cached afterwards). Override vars on the CLI, e.g.
#   make demo PORT=8080   |   make train DEVICE=cuda   |   make fetch-foldins FOLDIN_APPS=teams,netflix
PY          ?= python3
DEVICE      ?= cpu
CKPT        ?= checkpoints/traffic8/phase3/final.pt
CFG         ?= src/netjepa/configs/traffic.yaml
LABELS      ?= data/processed_traffic/labels.json
DATASET_ID  ?= traffic8
FOLDIN_APPS ?= teams,netflix,prime,youtube,roblox,spotify,web,xbox
PORT        ?= 8000

SCRIPTS := src/netjepa/scripts
RUN     := $(PY) -m netjepa.scripts

.DEFAULT_GOAL := help
.PHONY: help install demo stop reproduce serve webui \
        fetch fetch-weights fetch-data fetch-foldins evaluate infer latency train export clean clean-assets

help: ## Show this help
	@awk 'BEGIN{FS=":.*## "} \
	     /^##@/{printf "\n\033[1m%s\033[0m\n", substr($$0,5)} \
	     /^[a-zA-Z_-]+:.*## /{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

##@ Quick start (clone + run)
demo: install ## Run the live demo: inference server (weights auto-download from HF) + Signal Atlas UI
	@echo "→ starting inference server on :$(PORT) — first run downloads the model from Hugging Face…"
	@$(PY) -m uvicorn server.app:app --app-dir src --host 0.0.0.0 --port $(PORT) > netjepa-server.log 2>&1 & echo $$! > .netjepa-server.pid
	@printf "→ waiting for the model to load"; until curl -s --max-time 3 http://localhost:$(PORT)/api/health >/dev/null 2>&1; do printf "."; sleep 1; done; echo " ready (server logs: netjepa-server.log)"
	@echo "→ launching the Signal Atlas UI — Ctrl-C stops the UI, then run 'make stop' to stop the server"
	cd webui && VITE_PROXY_TARGET=http://localhost:$(PORT) npm run dev

stop: ## Stop the inference server started by 'make demo'
	@kill `cat .netjepa-server.pid 2>/dev/null` 2>/dev/null && echo "server stopped" || echo "(no server running)"; rm -f .netjepa-server.pid

reproduce: install fetch evaluate ## Reproduce the KPIs: install -> fetch weights+data -> evaluate

install: .make-installed ## Install Python + web dependencies (auto, cached)
.make-installed: requirements.txt setup.py webui/package.json
	$(PY) -m pip install -r requirements.txt
	-$(PY) -m pip install -e . --no-build-isolation
	cd webui && npm install
	@touch .make-installed

##@ Fetch assets (weights from Hugging Face, data from Kaggle)
fetch-weights: install ## Weights ONLY, from Hugging Face (no token, no Kaggle account needed)
	$(PY) $(SCRIPTS)/fetch_assets.py --weights-only
fetch-data: install ## Data ONLY, from Kaggle + fold-ins -> build 8-class dataset (needs Kaggle token; LARGE)
	$(PY) $(SCRIPTS)/fetch_assets.py --data-only --with-foldins --foldin-apps $(FOLDIN_APPS)
fetch: install ## BOTH weights (HF) + data (Kaggle + fold-ins -> build 8-class dataset)
	$(PY) $(SCRIPTS)/fetch_assets.py --with-foldins --foldin-apps $(FOLDIN_APPS)
fetch-foldins: fetch-data ## Alias of fetch-data (the 8-class build always needs the fold-ins)

##@ Run the pipeline (terminal)
evaluate: install ## Evaluate the checkpoint and print the KPI summary (vars: CKPT, CFG, DEVICE)
	$(RUN).evaluate --config $(CFG) --checkpoint $(CKPT) --device $(DEVICE)
infer: install ## Classify a pcap in the terminal (no UI/server): make infer PCAP=path/to/file.pcap
	@test -n "$(PCAP)" || { echo "usage: make infer PCAP=path/to/file.pcap"; exit 1; }
	$(RUN).infer_pcap "$(PCAP)" --checkpoint $(CKPT) --labels $(LABELS) --device $(DEVICE)
latency: install ## Per-flow latency over all CSV flows (embedding -> classification); vars: CKPT, DEVICE
	$(RUN).latency_per_flow --checkpoint $(CKPT) --device $(DEVICE)
train: install ## Train the 8-class model from scratch: phase1 -> phase2b -> phase3 -> evaluate (run 'make fetch-data' first; DEVICE=cuda)
	$(RUN).train_phase1  --config $(CFG) --ckpt_dir checkpoints/traffic8/phase1 --device $(DEVICE)
	$(RUN).train_phase2b --config $(CFG) --init_ckpt checkpoints/traffic8/phase1/final.pt --ckpt_dir checkpoints/traffic8/phase2b --device $(DEVICE)
	$(RUN).train_phase3  --config $(CFG) --phase2_ckpt checkpoints/traffic8/phase2b/final.pt --ckpt_dir checkpoints/traffic8/phase3 --device $(DEVICE)
	$(RUN).evaluate --config $(CFG) --checkpoint $(CKPT) --device $(DEVICE)
export: install ## Re-export atlas artifacts + galaxy cloud for the UI
	$(RUN).export_artifacts --config $(CFG) --checkpoint $(CKPT) --dataset-id $(DATASET_ID) --name "Traffic-8" --device $(DEVICE)
	$(RUN).export_cloud     --config $(CFG) --checkpoint $(CKPT) --dataset-id $(DATASET_ID) --cap 1500 --device $(DEVICE)

##@ Run UI / server separately (two terminals)
serve: install ## Inference server only (auto-downloads weights from HF if missing)
	$(PY) -m uvicorn server.app:app --app-dir src --host 0.0.0.0 --port $(PORT)
webui: install ## Signal Atlas UI only (Vite dev server -> http://localhost:5173)
	cd webui && VITE_PROXY_TARGET=http://localhost:$(PORT) npm run dev

##@ Utilities
clean: ## Remove caches, eval outputs, server logs (keeps fetched weights/data + installed deps)
	find . -path ./webui/node_modules -prune -o -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
	rm -rf eval_results src/*.egg-info *.egg-info netjepa-server.log .netjepa-server.pid
clean-assets: ## Also delete fetched weights + processed data (forces a clean re-fetch)
	rm -rf data/processed_traffic data/traffic_csvs checkpoints/traffic8/phase3/final.pt checkpoints/traffic8/phase3/knn.joblib
