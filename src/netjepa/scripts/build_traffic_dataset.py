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
from sklearn.model_selection import GroupShuffleSplit

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


def build_parquet_from_csvs(csv_dir: Path, pq_out: Path, seed: int = 42) -> None:
    """Rebuild the parquet tensors + labels.json directly from the committed feature
    CSVs in `csv_dir` — no raw captures, no Kaggle download.

    Each CSV row carries the raw per-flow arrays (packet_sizes / iats / directions),
    the flow scalars, the per-capture host stats, and the leak-free `split`. We
    reconstruct the packet list and recompute the exact same tensors as the raw path
    (`compute_packet_sequence` / `compute_flow_context`), and honour the CSVs' recorded
    split, so the train/test partition matches the published model exactly.
    """
    def _as_bool(v) -> bool:
        return v == 'True' if isinstance(v, str) else bool(v)

    csvs = sorted(csv_dir.glob('*.csv'))
    if not csvs:
        sys.exit(f'no CSVs in {csv_dir} — expected the committed data/traffic_csvs/*.csv')

    records, n_skipped = [], 0
    for f in csvs:
        df = pd.read_csv(f)
        for r in df.itertuples(index=False):
            sizes = json.loads(r.packet_sizes); iats = json.loads(r.iats); dirs = json.loads(r.directions)
            n = len(sizes)
            if n < 5:
                n_skipped += 1; continue
            syn, fin, rst, pid = int(r.syn_count), int(r.fin_count), int(r.rst_count), int(r.protocol_id)
            t, pkts = 0.0, []
            for i in range(n):
                t += float(iats[i])
                pkts.append({
                    'length': int(sizes[i]), 'time': t,
                    'src_ip': 'C' if dirs[i] == 1 else 'S', 'dst_ip': 'S' if dirs[i] == 1 else 'C',
                    'protocol_id': pid,
                    'is_syn': i < syn, 'is_ack': False, 'is_syn_ack': False,
                    'is_fin': i < fin, 'is_rst': i < rst,
                    'is_client_hello': False, 'is_server_hello': False,
                })
            hs = {'C': {'n_dst_ips': int(r.n_dst_ips), 'n_dst_ports': int(r.n_dst_ports),
                        'n_src_ports': int(r.n_src_ports), 'conn_per_sec': float(r.conn_per_sec)}}
            rtt, rv = float(r.rtt), _as_bool(r.rtt_valid)
            seq, mask = compute_packet_sequence(pkts, 'C', rtt, rv)
            ctx = compute_flow_context(pkts, 'C', rtt, rv, hs)
            cid = TYPE2ID[str(r.traffic_type)]
            # Prefer the true per-capture source_file (newer CSVs carry it); older CSVs only
            # stored the folder-level `app`, so fall back to that for the parquet metadata.
            src = str(getattr(r, 'source_file', r.app))
            records.append({'packet_sequence': seq.tolist(), 'padding_mask': mask.tolist(),
                            'flow_context': ctx.tolist(), 'category_label': cid, 'app_label': cid,
                            'rtt_valid': rv, 'source_file': src, 'split': str(r.split)})
    if not records:
        sys.exit('no flows reconstructed from CSVs.')

    df_all = pd.DataFrame(records)
    # Full-supervision 70/70/30: train (pretrain == downstream_train) is the 70% `pretrain`
    # set; the held-out 30% test is EVERYTHING ELSE. The committed CSVs may label that 30%
    # as `test` (current build) or as `downstream_train` + `test` (older 70/15/15 CSVs); both
    # map to the same held-out 30% the published model is evaluated on.
    is_train = df_all['split'] == 'pretrain'
    train_df = df_all[is_train].drop(columns=['split']).reset_index(drop=True)
    test_df  = df_all[~is_train].drop(columns=['split']).reset_index(drop=True)
    if len(train_df) == 0 or len(test_df) == 0:
        sys.exit(f"unexpected split values {sorted(df_all['split'].unique())} — expected a 'pretrain' split.")
    train_df.to_parquet(pq_out / 'pretrain.parquet')
    train_df.to_parquet(pq_out / 'downstream_train.parquet')   # == pretrain (full supervision)
    test_df.to_parquet(pq_out / 'test.parquet')

    rng = random.Random(seed)
    for eta in (1, 3, 5, 7, 10):
        per = defaultdict(list)
        for j, row in train_df.iterrows():
            per[row['category_label']].append(j)
        chosen = [k for _, ix in per.items() for k in rng.sample(ix, min(eta, len(ix)))]
        train_df.iloc[chosen].reset_index(drop=True).to_parquet(pq_out / f'fewshot_eta{eta}.parquet')

    json.dump({'traffic_types': TRAFFIC_TYPES, 'type2id': TYPE2ID},
              open(pq_out / 'labels.json', 'w'), indent=2)
    _log.info('from-csvs: %d flows -> train/downstream %d, test %d (skipped %d <5pkt); wrote parquet + %s',
              len(df_all), len(train_df), len(test_df), n_skipped, pq_out / 'labels.json')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw_dir', default=None,
                    help='raw 5G/VLC/CG capture dir (required unless --from-csvs)')
    ap.add_argument('--from-csvs', action='store_true',
                    help='skip raw parsing: rebuild the parquet tensors + labels.json directly '
                         'from the committed feature CSVs in --csv_out (no Kaggle download). '
                         'Uses the CSVs\' recorded split column, so the train/test partition '
                         'matches the published model exactly.')
    ap.add_argument('--csv_out', default='data/traffic_csvs')
    ap.add_argument('--parquet_out', default='data/processed_traffic')
    ap.add_argument('--min_packets', type=int, default=5)
    ap.add_argument('--max_packets', type=int, default=64)
    ap.add_argument('--flow_timeout', type=float, default=30.0)
    ap.add_argument('--pretrain', type=float, default=0.70)
    ap.add_argument('--downstream', type=float, default=0.15)
    ap.add_argument('--seed', type=int, default=42)
    args = ap.parse_args()

    csv_out = Path(args.csv_out)
    pq_out = Path(args.parquet_out); pq_out.mkdir(parents=True, exist_ok=True)

    # ── CSV-only path: rebuild parquet tensors from the committed feature CSVs ──
    if args.from_csvs:
        build_parquet_from_csvs(csv_out, pq_out, args.seed)
        return

    if not args.raw_dir:
        sys.exit('--raw_dir is required (or pass --from-csvs to rebuild from data/traffic_csvs).')
    raw = Path(args.raw_dir)
    csv_out.mkdir(parents=True, exist_ok=True)

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

    # ── RTT + host stats ──
    for fl in flows:
        fl['rtt'], fl['rtt_valid'] = extract_rtt(fl['packets'], fl['client_ip'])
    # Host stats MUST be computed per-capture (per source_file), exactly like inference
    # computes them over a single uploaded pcap. Computing them globally over every
    # capture merged a reused client IP's destinations across all apps -> inflated
    # n_dst_ips/n_dst_ports the model could never see again at inference (a single pcap),
    # which made real pcaps collapse to the wrong class. Group by source_file so the
    # training host-stat distribution matches what infer_pcap/server produce.
    flows_by_file = defaultdict(list)
    for fl in flows:
        flows_by_file[fl['source_file']].append(fl)
    src_stats_by_file = {sf: compute_src_host_stats(fls) for sf, fls in flows_by_file.items()}

    # ── leak-free split by CAPTURE SESSION (source_file), stratified per class ──
    # The host-behaviour features (n_dst_ips / n_dst_ports / n_src_ports / conn_per_sec in
    # flow_context) are computed PER CAPTURE, so every flow from one source_file shares an
    # identical 4-value fingerprint. A random *flow-level* split therefore leaks: test flows
    # land next to train flows from the SAME capture, and the kNN can match them on that
    # shared fingerprint alone. We split by source_file so all flows from a capture go
    # ENTIRELY to train OR ENTIRELY to test — never both. To keep every class represented
    # and the overall ratio near 70/30, we hold out ~30% of *each class's captures*
    # (GroupShuffleSplit per class, with source_file as the group key). Classes with a single
    # capture can't be held out, so they stay wholly in train (a warning is logged).
    labels = np.array([TYPE2ID[fl['category_label']] for fl in flows])
    groups = np.array([fl['source_file'] for fl in flows])
    idx = np.arange(len(flows))
    test_frac = 1 - args.pretrain
    split_of = {}
    for c in np.unique(labels):
        cls_idx = idx[labels == c]
        cls_groups = groups[cls_idx]
        n_caps = len(np.unique(cls_groups))
        if n_caps < 2:
            for i in cls_idx: split_of[i] = 'pretrain'
            _log.warning('class id %d (%s) has a single capture -> all %d flows kept in train '
                         '(cannot hold any out)', c, TRAFFIC_TYPES[c], len(cls_idx))
            continue
        gss = GroupShuffleSplit(n_splits=1, test_size=test_frac, random_state=args.seed)
        tr_rel, te_rel = next(gss.split(cls_idx, labels[cls_idx], groups=cls_groups))
        for i in cls_idx[tr_rel]: split_of[i] = 'pretrain'    # train (also downstream_train)
        for i in cls_idx[te_rel]: split_of[i] = 'test'        # held-out evaluation only
    n_tr = sum(v == 'pretrain' for v in split_of.values())
    _log.info('capture-level split: %d train / %d test (%.1f%% test) across %d captures',
              n_tr, len(flows) - n_tr, 100 * (len(flows) - n_tr) / len(flows),
              len(np.unique(groups)))

    # ── write per-type raw-array CSVs (with split col) + parquet records ──
    csv_rows = defaultdict(list)
    records = []
    for i, fl in enumerate(flows):
        pkts, client = fl['packets'], fl['client_ip']
        sizes, iats, dirs = _raw_arrays(pkts, client)
        src_stats = src_stats_by_file[fl['source_file']]       # per-capture, matches inference
        st = src_stats.get(client, {})
        ttype = fl['category_label']; split = split_of[i]
        csv_rows[ttype].append({
            'traffic_type': ttype, 'app': fl['app_label'], 'source_file': fl['source_file'],
            'split': split,
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
    # Full supervision: downstream_train (SupCon + kNN) is the SAME set as pretrain.
    train_df = df_all[df_all['split'] == 'pretrain'].drop(columns=['split']).reset_index(drop=True)
    test_df  = df_all[df_all['split'] == 'test'].drop(columns=['split']).reset_index(drop=True)
    train_df.to_parquet(pq_out / 'pretrain.parquet')
    train_df.to_parquet(pq_out / 'downstream_train.parquet')   # == pretrain (full supervision)
    test_df.to_parquet(pq_out / 'test.parquet')
    _log.info('  %-18s %6d flows', 'pretrain/downstream', len(train_df))
    _log.info('  %-18s %6d flows', 'test', len(test_df))
    # few-shot subsets from the train set
    rng = random.Random(args.seed)
    ds_df = train_df
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
