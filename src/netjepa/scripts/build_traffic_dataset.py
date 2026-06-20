"""Build the common-traffic-type dataset from the FULL Kaggle + VLC + cloud-gaming
flows, with all traffic supervised (no pretrain-only routing).

Outputs two things from the SAME flows (so they never diverge):
  1. csv_out/<traffic_type>.csv  — one CSV per class, one row per flow, with the
     RAW per-flow features (packet_sizes/iats/directions + flow scalars + host
     stats), an `app` reference column, and a `split` column (pretrain/
     downstream_train/test) recording the leak-free per-class split.
  2. parquet_out/{pretrain,downstream_train,test,fewshot_eta*}.parquet — the
     packet_sequence(64x9)+flow_context(15)+padding_mask tensors the training
     phases consume, with category_label = traffic-type id. + labels.json.

Run convert_vlc_pcap.py first so the VLC_*/CG_Xbox/VLC_Spotify/VLC_Web CSV folders
exist under the 5G dataset dir.

Usage:
    python src/netjepa/scripts/build_traffic_dataset.py \
        --raw_dir /indian-slp/Users/ug/ZEPA/Kritik/net_data/5G_Traffic_Datasets \
        --csv_out data/traffic_csvs --parquet_out data/processed_traffic
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from netjepa.data.parser import parse_csv
from netjepa.data.flow_builder import extract_flows
from netjepa.data.rtt import extract_rtt
from netjepa.data.features import (compute_packet_sequence, compute_flow_context,
                                   compute_src_host_stats)
from netjepa.utils.logging import get_logger
from sklearn.model_selection import train_test_split

_log = get_logger('scripts.build_traffic')

# Common traffic type (= one CSV / class) for each source folder. ALL supervised.
FOLDER_TO_TYPE: dict[str, str] = {
    'GeForce_Now': 'cloud_gaming', 'KT_GameBox': 'cloud_gaming', 'CG_Xbox': 'cloud_gaming',
    'AfreecaTV': 'live_streaming', 'Naver_NOW': 'live_streaming', 'YouTube_Live': 'live_streaming',
    'Roblox': 'metaverse', 'Zepeto': 'metaverse', 'VLC_Roblox': 'metaverse',
    'Battleground': 'online_gaming', 'Teamfight_Tactics': 'online_gaming',
    'Netflix': 'video_on_demand', 'YouTube': 'video_on_demand',
    'VLC_Netflix': 'video_on_demand', 'VLC_Prime': 'video_on_demand', 'VLC_YouTube': 'video_on_demand',
    'Google_Meet': 'video_conferencing', 'MS_Teams': 'video_conferencing',
    'Zoom': 'video_conferencing', 'VLC_Teams': 'video_conferencing',
    'VLC_Spotify': 'audio_streaming',
    'VLC_Web': 'web_browsing',
}
TRAFFIC_TYPES = sorted(set(FOLDER_TO_TYPE.values()))
TYPE2ID = {t: i for i, t in enumerate(TRAFFIC_TYPES)}


def _raw_arrays(packets: list[dict], client_ip: str):
    sizes, iats, dirs = [], [], []
    prev = None
    for p in packets:
        sizes.append(int(p['length']))
        iats.append(0.0 if prev is None else round(p['time'] - prev, 6))
        prev = p['time']
        dirs.append(1 if p['src_ip'] == client_ip else -1)
    return sizes, iats, dirs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw_dir', required=True)
    ap.add_argument('--csv_out', default='data/traffic_csvs')
    ap.add_argument('--parquet_out', default='data/processed_traffic')
    ap.add_argument('--min_packets', type=int, default=5)
    ap.add_argument('--max_packets', type=int, default=64)
    ap.add_argument('--flow_timeout', type=float, default=30.0)
    ap.add_argument('--pretrain', type=float, default=0.70)
    ap.add_argument('--downstream', type=float, default=0.15)
    ap.add_argument('--seed', type=int, default=42)
    args = ap.parse_args()

    raw = Path(args.raw_dir)
    csv_out = Path(args.csv_out); csv_out.mkdir(parents=True, exist_ok=True)
    pq_out = Path(args.parquet_out); pq_out.mkdir(parents=True, exist_ok=True)

    # index every sub-dir by leaf name (any depth)
    dir_index = {p.name: p for p in raw.rglob('*') if p.is_dir()}

    # ── parse all source folders -> flows (tagged with traffic_type + app) ──
    import time
    t0 = time.time()
    flows = []
    per_type = Counter()
    items = list(FOLDER_TO_TYPE.items())
    for fi, (folder, ttype) in enumerate(items, 1):
        d = dir_index.get(folder)
        if d is None:
            print(f"[{fi}/{len(items)}] SKIP {folder} (not found)", flush=True); continue
        csvs = sorted(d.glob('*.csv'))
        print(f"[{fi}/{len(items)}] {folder} -> {ttype}: {len(csvs)} files", flush=True)
        for ci, csv_file in enumerate(csvs, 1):
            try:
                df = parse_csv(csv_file, folder, ttype)
                fs, _ = extract_flows(df, folder, ttype, str(csv_file),
                                      min_packets=args.min_packets,
                                      max_packets=args.max_packets,
                                      flow_timeout=args.flow_timeout)
                flows.extend(fs); per_type[ttype] += len(fs)
                print(f"    [{ci}/{len(csvs)}] {csv_file.name}: +{len(fs)} flows "
                      f"(total {len(flows)}, {time.time()-t0:.0f}s)", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"    [{ci}/{len(csvs)}] {csv_file.name}: ERROR {e}", flush=True)
    print(f"parsed {len(flows)} flows in {time.time()-t0:.0f}s", flush=True)
    for t in TRAFFIC_TYPES:
        _log.info('  %-18s %6d flows', t, per_type[t])
    if not flows:
        sys.exit('no flows parsed — did you run convert_vlc_pcap.py / is --raw_dir correct?')

    # ── RTT + cross-flow host stats ──
    for fl in flows:
        fl['rtt'], fl['rtt_valid'] = extract_rtt(fl['packets'], fl['client_ip'])
    src_stats = compute_src_host_stats(flows)

    # ── leak-free per-class split (stratified 70/15/15; rare classes -> pretrain) ──
    labels = np.array([TYPE2ID[fl['category_label']] for fl in flows])
    idx = np.arange(len(flows))
    counts = Counter(labels.tolist())
    rare = np.array([counts[l] < 4 for l in labels])           # need >=4 to split 3 ways
    pre = list(idx[rare])
    normal = idx[~rare]
    tr, rest = train_test_split(normal, test_size=1 - args.pretrain,
                                stratify=labels[normal], random_state=args.seed)
    pre += list(tr)
    ds_frac = args.downstream / (1 - args.pretrain)
    ds, te = train_test_split(rest, test_size=1 - ds_frac,
                              stratify=labels[rest], random_state=args.seed)
    split_of = {}
    for i in pre: split_of[i] = 'pretrain'
    for i in ds:  split_of[i] = 'downstream_train'
    for i in te:  split_of[i] = 'test'

    # ── write per-type raw-array CSVs (with split col) + parquet records ──
    csv_rows = defaultdict(list)
    records = []
    for i, fl in enumerate(flows):
        pkts, client = fl['packets'], fl['client_ip']
        sizes, iats, dirs = _raw_arrays(pkts, client)
        st = src_stats.get(client, {})
        ttype = fl['category_label']; split = split_of[i]
        csv_rows[ttype].append({
            'traffic_type': ttype, 'app': fl['app_label'], 'split': split,
            'protocol_id': int(pkts[0]['protocol_id']),
            'rtt': round(fl['rtt'], 6), 'rtt_valid': bool(fl['rtt_valid']),
            'syn_count': sum(1 for p in pkts if p['is_syn'] and not p['is_syn_ack']),
            'fin_count': sum(1 for p in pkts if p['is_fin']),
            'rst_count': sum(1 for p in pkts if p['is_rst']),
            'n_dst_ips': st.get('n_dst_ips', 1), 'n_dst_ports': st.get('n_dst_ports', 1),
            'n_src_ports': st.get('n_src_ports', 1), 'conn_per_sec': round(st.get('conn_per_sec', 0.0), 6),
            'packet_sizes': json.dumps(sizes), 'iats': json.dumps(iats), 'directions': json.dumps(dirs),
        })
        seq, mask = compute_packet_sequence(pkts, client, fl['rtt'], fl['rtt_valid'])
        ctx = compute_flow_context(pkts, client, fl['rtt'], fl['rtt_valid'], src_stats)
        records.append({'packet_sequence': seq.tolist(), 'padding_mask': mask.tolist(),
                        'flow_context': ctx.tolist(), 'category_label': TYPE2ID[ttype],
                        'app_label': TYPE2ID[ttype], 'rtt_valid': fl['rtt_valid'],
                        'source_file': fl['source_file'], 'split': split})

    for ttype, rows in csv_rows.items():
        pd.DataFrame(rows).to_csv(csv_out / f'{ttype}.csv', index=False)
        _log.info('wrote %s (%d flows)', csv_out / f'{ttype}.csv', len(rows))

    df_all = pd.DataFrame(records)
    for name in ('pretrain', 'downstream_train', 'test'):
        sub = df_all[df_all['split'] == name].drop(columns=['split']).reset_index(drop=True)
        sub.to_parquet(pq_out / f'{name}.parquet')
        _log.info('  %-16s %6d flows', name, len(sub))
    # few-shot subsets from downstream_train
    rng = random.Random(args.seed)
    ds_df = df_all[df_all['split'] == 'downstream_train'].drop(columns=['split']).reset_index(drop=True)
    for eta in (1, 3, 5, 7, 10):
        per = defaultdict(list)
        for j, row in ds_df.iterrows():
            per[row['category_label']].append(j)
        chosen = [k for cls, ix in per.items() for k in rng.sample(ix, min(eta, len(ix)))]
        ds_df.iloc[chosen].reset_index(drop=True).to_parquet(pq_out / f'fewshot_eta{eta}.parquet')

    json.dump({'traffic_types': TRAFFIC_TYPES, 'type2id': TYPE2ID},
              open(pq_out / 'labels.json', 'w'), indent=2)
    _log.info('done. %d traffic types: %s', len(TRAFFIC_TYPES), TRAFFIC_TYPES)


if __name__ == '__main__':
    main()
