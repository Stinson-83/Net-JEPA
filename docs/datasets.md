# 3 · Datasets

All datasets used are **public**. No data was fabricated; the unevenness in the cloud
reflects real-world capture sizes.

## 3.1 What the model is trained on — 8 common traffic types

The current model classifies **8 common traffic types**, each built from one or more public
sources. Unlike the earlier 6-category model, **every traffic type is fully supervised** (no
pretrain-only routing): each type becomes one labelled CSV and is used in Phase 1, Phase 2b
and Phase 3 under a single leak-free split.

| Traffic type | Source folders → type (`build_traffic_dataset.py::FOLDER_TO_TYPE`) | flows |
|---|---|---|
| `audio_streaming` | VLC_Spotify | 2,396 |
| `cloud_gaming` | GeForce_Now, KT_GameBox (Kaggle) · CG_Xbox (cloud-gaming telemetry) | 739 |
| `live_streaming` | AfreecaTV, Naver_NOW, YouTube_Live (Kaggle) | 2,449 |
| `metaverse` | Roblox, Zepeto (Kaggle) · VLC_Roblox (VLC) | 10,482 |
| `online_gaming` | Battleground, Teamfight_Tactics (Kaggle) | 5,774 |
| `video_conferencing` | Google_Meet, MS_Teams, Zoom (Kaggle) · VLC_Teams (VLC) | 742 |
| `video_on_demand` | Netflix, YouTube (Kaggle) · VLC_Netflix, VLC_Prime, VLC_YouTube (VLC) | 3,287 |
| `web_browsing` | VLC_Web | 3,023 |

**Total: 28,892 flows** → leak-free **70/70/30 full-supervision split**: **20,224 train** (used
for *both* self-supervised pretraining **and** supervised SupCon + k-NN) and **8,668 test**
(held out for evaluation only). Using all labels for the supervised stages lifts accuracy to
**0.997** (leak-free verified); see [results.md §5.3](results.md).

## 3.2 The three sources

**Primary — 5G Traffic Dataset (Korea).** [Kaggle ·
5g-traffic-datasets](https://www.kaggle.com/datasets/kimdaegyeom/5g-traffic-datasets)
(`kimdaegyeom/5g-traffic-datasets`); original on
[IEEE DataPort](https://ieee-dataport.org/documents/5g-traffic-datasets) (Choi, Kim, Ko —
Kwangwoon University; DOI `10.21227/ewhk-n061`). License **listed as "Unknown" on Kaggle** →
we **use it under Kaggle's terms but do not redistribute it or any derivative**. Format:
Wireshark CSV (`No., Time, Source, Destination, Protocol, Length, Info`).

**VLC / Valencia dataset.** [Zenodo · record 15121418](https://zenodo.org/records/15121418) —
**CC-BY-4.0**. Raw `.pcapng` (58 files) converted to Wireshark CSV by a scapy-based converter
(`src/netjepa/scripts/convert_vlc_pcap.py` — no Wireshark/tshark needed). We use the **full**
VLC set incl. Spotify (→ audio_streaming) and Web (→ web_browsing), plus Netflix/Prime/YouTube
(→ VOD), Roblox (→ metaverse), Teams (→ video_conferencing).

**Cloud-gaming telemetry.** [Kaggle ·
cloud-gaming-network-telemetry](https://www.kaggle.com/datasets/carloshfm/cloud-gaming-network-telemetry)
— **BSD-3**. Raw `.pcap` (Xbox Cloud Gaming over 5G). The 5G captures → `CG_Xbox` →
cloud_gaming.

## 3.3 How the dataset is preprocessed (`build_traffic_dataset.py`)

One script builds everything, identically for Kaggle CSVs and VLC/CG captures:

1. **Parse → packet schema.** Kaggle CSVs via `parser.parse_csv`; VLC/CG raw captures are
   first converted to the same CSV schema by `convert_vlc_pcap.py` (scapy). Both yield the
   columns `time, src_ip, dst_ip, src_port, dst_port, protocol_id, length, is_syn/ack/fin/
   rst/syn_ack, is_client_hello/server_hello`.
2. **Build flows** (`flow_builder.extract_flows`): bidirectional 5-tuple
   (`frozenset{(src_ip,src_port),(dst_ip,dst_port)} + protocol`), 30 s idle split, keep flows
   with **5–64 packets**. The client/device is the SYN initiator, else the **private/local
   endpoint**, else the first packet's source.
3. **RTT** via `rtt.extract_rtt` (first client→server→client exchange).
4. **Host stats — per capture.** `compute_src_host_stats` is run **per `source_file`**
   (one app session), *not* globally. This is the fix that made host-behaviour features
   (`n_dst_ips`, `n_dst_ports`, `n_src_ports`, `conn_per_sec`) both discriminative and
   reproducible at inference (a single uploaded pcap reproduces the same per-capture stats).
   See `docs/results.md §5.3`.
5. **Features** (`features.py`): each flow → a 64×9 `packet_sequence` (size/1500,
   log1p(iat)/10, signed direction, protocol one-hot×4, rtt_norm, rtt_flag) + a 15-D
   `flow_context` (durations, flag ratios, per-capture host stats) + `padding_mask`.
6. **Leak-free split** (stratified **70/70/30** by class — the 70% train set is used for both
   pretraining *and* supervised SupCon + k-NN; 30% held out for test; `split` column recorded)
   and write:
   - `data/traffic_csvs/<type>.csv` — one row per flow with raw arrays (`packet_sizes`,
     `iats`, `directions`) + scalars + `app` reference col + `split` col (human-readable).
   - `data/processed_traffic/{pretrain,downstream_train,test,fewshot_eta*}.parquet` — the
     tensors the trainer consumes, + `labels.json` (the 8 type names + `type2id`).

Both `data/traffic_csvs/` and `data/processed_traffic/` are **gitignored** (Kaggle-derived;
rebuilt from source on demand).

## 3.4 How a raw `.pcap` is processed at inference (identical path)

Uploading a `.pcap` (terminal `infer_pcap.py` or the server `/api/infer`) uses the **same**
flow-building and feature code as training — this is what makes the trained classes transfer:

```
pcap → scapy parse → packet schema (flags + TLS hellos recovered)
     → flow_builder.extract_flows (same 5-tuple / 30 s / 5–64 pkts)
     → compute_src_host_stats over THIS pcap's flows (per-capture, matches training)
     → features.py (same 64×9 packet_sequence + 15-D flow_context)
     → encoder.forward_downstream → 128-D embedding → cosine k-NN → type + confidence
```

`infer_pcap.py` reports per-flow predictions plus three summaries — flow counts,
**packet-weighted** (big flows dominate), confidence-filtered — and the **dominant traffic
type by packets**, the headline read on "what is this capture". See `docs/usage.md`.

## 3.5 Building / reproducing the dataset

```bash
# full 8-class build from the staged raw dir (Kaggle 5G + VLC_* + CG_Xbox folders)
python -m netjepa.scripts.build_traffic_dataset \
    --raw_dir <5G_dataset_root> \
    --csv_out data/traffic_csvs --parquet_out data/processed_traffic
```

To stage the VLC / cloud-gaming fold-ins next to the 5G data, `fetch_assets.py --with-foldins`
downloads VLC from Zenodo (CC-BY-4.0) + cloud-gaming from Kaggle (BSD-3) and converts them
(`convert_vlc_pcap.py`) into `VLC_*` / `CG_Xbox` folders in the 5G raw dir.

## 3.6 What we publish (and why not the processed data)

We publish **no new dataset**. All sources above are already public, and we deliberately do
**not** redistribute the preprocessed parquet/CSVs: they derive from the primary 5G dataset,
whose license is **"Unknown"** (§3.2), so we have no clear right to re-host a derivative.
Instead the processed data is **rebuilt from source on demand** (§3.5), keeping reproduction
one command away while staying within the source licenses. (VLC and cloud-gaming are
permissively licensed — CC-BY-4.0 / BSD-3 — and could be redistributed with attribution, but
for simplicity they too are fetched from source.)
