# 3 · Datasets

All datasets used are **public** and **permissively licensed**. No data was fabricated;
the unevenness in the cloud reflects real-world capture sizes.

## 3.1 Primary — 5G Traffic Dataset (Korea)

- **Source:** [Kaggle · 5G Traffic Datasets](https://www.kaggle.com/datasets/kimdaegyeom/5g-traffic-datasets) (`kimdaegyeom/5g-traffic-datasets`); original on [IEEE DataPort](https://ieee-dataport.org/documents/5g-traffic-datasets) (Choi, Kim, Ko — Kwangwoon University; DOI `10.21227/ewhk-n061`).
- **License:** **listed as "Unknown" on Kaggle** (and no explicit open license on IEEE DataPort). We therefore **use it from the source under Kaggle's terms but do not redistribute it or any derivative** — `fetch_assets.py` pulls it from Kaggle and preprocesses locally (see §3.7).
- **Format:** Wireshark CSV exports (`No., Time, Source, Destination, Protocol, Length, Info`)
- **Scope:** 15 apps across the 6 categories, captured on 5G.
- **Role:** the core training + test set. ~22,900 flows after flow-building (≥5 packets).

Per-app folders map to `(app, category)` in `src/netjepa/data/preprocess.py::FOLDER_MAP`.

## 3.2 Augmentation — VLC / Valencia dataset

- **Source:** [Zenodo · VLC Data](https://zenodo.org/records/15121418) — *"A Novel Flow-Based
  Online Network Traffic Classification"* — **CC-BY-4.0**
- **Format:** raw `.pcapng` (58 files); we convert to Wireshark CSV with a scapy-based
  converter (`src/netjepa/scripts/convert_vlc_pcap.py` — no Wireshark/tshark needed).
- **What we used:**
  - **MS Teams** (6 files) → `ms_teams` / video_conferencing — **supervised** (boosts the
    starved video-conf class).
  - **Netflix / Prime / YouTube / Roblox** → **pretrain-only** (out-of-domain testbed; used
    for representation diversity but *not* the labelled set, to avoid a domain confound).

## 3.3 Augmentation — Cloud-gaming telemetry

- **Source:** [Kaggle · Cloud Gaming Network Telemetry](https://www.kaggle.com/datasets/carloshfm/cloud-gaming-network-telemetry)
  (`carloshfm/cloud-gaming-network-telemetry`) — companion to the
  [dcomp-leris GitHub repo](https://github.com/dcomp-leris/VR-AR-CG-network-telemetry) — **BSD-3**
- **Format:** raw `.pcap` (Xbox Cloud Gaming over **5G** — Fortnite / Forza / Mortal Kombat).
- **What we used:** the 5 **5G** captures → `CG_Xbox` / game_streaming — **pretrain-only**
  (cross-testbed). We stream-extracted just the 5G subset (~5 GB of the 28 GB record).

## 3.4 The pretrain-only vs supervised decision

Folding *all* of an out-of-domain dataset into the **labelled** set caused a **domain
confound** — the model learned testbed artifacts and confused VLC-Teams with VLC-Netflix.
The fix, encoded in `PRETRAIN_ONLY_FOLDERS`, routes out-of-domain apps to **Phase-1
pretraining only**, while in-distribution-compatible additions (Teams) join the supervised
set. This is the "VLC/cloud-gaming as pretraining augmentation + a targeted supervised
boost" pattern.

## 3.5 How the additions paid off (real flows, real gains)

| Class | Galaxy points before | after | Model F1 before → after |
|---|---|---|---|
| game_streaming | 398 | **739** | 0.72 → 0.71 (galaxy density was the goal) |
| video_conferencing | 510 | **742** | 0.67 → **0.93** |

Total galaxy: **7,481** real flows, capped at 1,500/class for a balanced view (the Proof
dashboard still reports the full, true distribution on the test split).

## 3.6 Reproducing the fold-in

**Automated (recommended).** `fetch_assets.py --with-foldins` downloads the VLC apps from
Zenodo (filtered) + the cloud-gaming captures from Kaggle, converts them, and stages them with
the 5G base for a single preprocess pass:

```bash
# exact published config (LARGE: VLC ≈23 GB + cloud-gaming ≈28 GB)
python src/netjepa/scripts/fetch_assets.py --data-only --with-foldins
# …or just the high-value MS-Teams boost (≈2.6 GB), no cloud-gaming:
python src/netjepa/scripts/fetch_assets.py --data-only --with-foldins --foldin-apps teams
```

**Manual (lower level).** Convert raw captures yourself, then preprocess:

```bash
# convert raw captures → Wireshark CSV (scapy; --max_packets caps huge cloud-gaming files)
python src/netjepa/scripts/convert_vlc_pcap.py --vlc_dir <raw_dir> \
    --out_dir <5G_dataset_root> --max_packets 600000
# then re-run the pipeline (preprocess → phase1 → phase2b → phase3 → export)
```

## 3.7 Datasets we publish (and why we don't republish the processed data)

We publish **no new dataset**. All sources above are already public, and we deliberately do
**not** redistribute our preprocessed parquet: it derives from the primary 5G dataset, whose
license is **"Unknown"** (§3.1), so we have no clear right to re-host a derivative. Instead the
processed data is **rebuilt from source on demand**: `python src/netjepa/scripts/fetch_assets.py`
downloads the raw 5G captures from Kaggle (under your own Kaggle account/terms) and runs
`preprocess_kaggle.py` locally. The processed parquet is gitignored (not shipped). This keeps
reproduction one command away while staying within the source licenses. (The VLC and cloud-gaming
fold-ins **are** permissively licensed — CC-BY-4.0 and BSD-3 — and could be redistributed with
attribution, but for simplicity they too are fetched from source.)
