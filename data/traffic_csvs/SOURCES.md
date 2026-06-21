# Traffic CSVs — provenance and attribution

The files in this directory are **derived, metadata-only feature tables** produced by
`src/netjepa/scripts/build_traffic_dataset.py` from publicly available network-traffic
captures. Each row is one flow described by **statistical metadata only** — per-packet
sizes, inter-arrival times, and direction, plus aggregate counters (SYN/FIN/RST counts,
host-fan-out stats, RTT). **No packet payloads, IP addresses, ports, or hostnames are
present.** The raw captures themselves are *not* redistributed here.

These derived CSVs are committed for reproducibility. The **original datasets remain under
their own licenses**; consult each source below before reusing. For the Kaggle 5G dataset in
particular the license is listed as "Unknown" — see the note under that source.

## Sources

### 1. 5G Traffic Dataset (Korea) — license: **Unknown**
- Kaggle: https://www.kaggle.com/datasets/kimdaegyeom/5g-traffic-datasets
- Original: IEEE DataPort — https://ieee-dataport.org/documents/5g-traffic-datasets
  (Choi, Kim, Ko — Kwangwoon University; DOI `10.21227/ewhk-n061`)
- License is **listed as "Unknown" on Kaggle**, i.e. no explicit redistribution grant. The
  derived feature rows below are provided here for reproducibility only; anyone reusing them
  should review the original dataset's terms. The raw captures are not redistributed.
- Apps drawn from this source: `Zepeto`, `Teamfight_Tactics`, `Battleground`, `Naver_NOW`,
  `Netflix` (non-VLC), `YouTube_Live`, `YouTube`, `KT_GameBox`, `GeForce_Now`, `AfreecaTV`,
  `Roblox`, `Zoom`, `Google_Meet`, `MS_Teams`.

### 2. VLC / Valencia dataset — license: **CC-BY-4.0**
- Zenodo: https://zenodo.org/records/15121418
- Redistributable with attribution (CC-BY-4.0).
- Apps (prefixed `VLC_`): `VLC_Web`, `VLC_Spotify`, `VLC_Netflix`, `VLC_Prime`,
  `VLC_YouTube`, `VLC_Roblox`, `VLC_Teams`.

### 3. Cloud-gaming network telemetry — license: **BSD-3-Clause**
- Kaggle: https://www.kaggle.com/datasets/carloshfm/cloud-gaming-network-telemetry
- Redistributable with attribution (BSD-3).
- App: `CG_Xbox` (Xbox Cloud Gaming over 5G).

## Columns

`traffic_type, app, split, protocol_id, rtt, rtt_valid, syn_count, fin_count, rst_count,`
`n_dst_ips, n_dst_ports, n_src_ports, conn_per_sec, packet_sizes, iats, directions`

`packet_sizes` / `iats` / `directions` are JSON arrays (one entry per packet, up to 64).
`split` is `train` / `test` from the 70/30 full-supervision fold used to train the model.

## Rebuilding from source

These CSVs can be regenerated end-to-end (they are not required to be committed):

```bash
make fetch-data        # downloads sources + builds   (needs a Kaggle token)
# or directly:
python -m netjepa.scripts.build_traffic_dataset \
    --raw_dir <staged_raw_root> --csv_out data/traffic_csvs --parquet_out data/processed_traffic
```
