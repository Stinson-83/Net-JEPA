"""Measure the model's per-flow inference latency over EVERY flow in the per-type CSVs.

For each flow in `data/traffic_csvs/*.csv` the model input is reconstructed from the
flow's raw arrays, then the pipeline is TIMED from embedding through classification
(`encoder.forward_downstream` -> cosine k-NN), one flow at a time (batch size 1, the
real serving condition). The script reports the mean (the headline per-flow latency)
and the p50/p95/p99 distribution.

The timed region starts at the embedding step (features are reconstructed beforehand,
outside the timer), matching "embedding -> classification" — the model's compute for a
single flow.

Usage
-----
    python -m netjepa.scripts.latency_per_flow                 # CPU (the KPI device)
    python -m netjepa.scripts.latency_per_flow --device cuda
    python -m netjepa.scripts.latency_per_flow --max-flows 2000   # quick subset
"""
from __future__ import annotations
import argparse
import glob
import json
import sys
import time
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--csv-dir', default='data/traffic_csvs',
                    help='dir of per-type CSVs from build_traffic_dataset.py (default: %(default)s)')
    ap.add_argument('--checkpoint', default='checkpoints/traffic8/phase3/final.pt')
    ap.add_argument('--knn', default=None, help='defaults to knn.joblib next to the checkpoint')
    ap.add_argument('--device', default='cpu', help='cpu (the KPI device) or cuda')
    ap.add_argument('--warmup', type=int, default=50, help='untimed warm-up flows (default: 50)')
    ap.add_argument('--max-flows', type=int, default=0, help='cap flows for a quick run (0 = all)')
    ap.add_argument('--threads', type=int, default=1,
                    help='CPU torch threads (default: 1 — batch=1 per-flow latency is fastest '
                         'single-threaded; many-core sync overhead inflates a single small forward)')
    args = ap.parse_args()

    import numpy as np
    import pandas as pd
    import torch
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # make src/ importable
    from netjepa.data.features import compute_packet_sequence, compute_flow_context
    from model.netjepa_classifier import NetJEPAClassifier

    ckpt = args.checkpoint
    knn = args.knn or str(Path(ckpt).parent / 'knn.joblib')
    if not Path(ckpt).is_file():
        sys.exit(f'checkpoint not found: {ckpt}')
    print(f'loading model: {ckpt}')
    model = NetJEPAClassifier.load(ckpt, knn_path=knn)
    dev = torch.device(args.device if (args.device == 'cpu' or torch.cuda.is_available()) else 'cpu')
    if dev.type == 'cpu' and args.threads > 0:
        torch.set_num_threads(args.threads)
    model._device = dev
    model._model.to(dev).eval()

    csvs = sorted(glob.glob(str(Path(args.csv_dir) / '*.csv')))
    if not csvs:
        sys.exit(f'no CSVs in {args.csv_dir} — run build_traffic_dataset.py first')

    # ── reconstruct the model input (64x9 packet_sequence + 15-D flow_context + mask)
    #    for every flow, using the SAME feature functions as training ────────────────
    flows: list[tuple] = []
    for f in csvs:
        df = pd.read_csv(f)
        for r in df.itertuples(index=False):
            sizes = json.loads(r.packet_sizes); iats = json.loads(r.iats); dirs = json.loads(r.directions)
            n = len(sizes)
            if n < 5:
                continue
            syn, fin, rst = int(r.syn_count), int(r.fin_count), int(r.rst_count)
            pid = int(r.protocol_id)
            t = 0.0
            pkts = []
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
            rtt, rv = float(r.rtt), bool(r.rtt_valid)
            seq, mask = compute_packet_sequence(pkts, 'C', rtt, rv, 64)
            ctx = compute_flow_context(pkts, 'C', rtt, rv, hs)
            flows.append((np.asarray(seq, np.float32), np.asarray(ctx, np.float32), np.asarray(mask)))
        print(f'  {Path(f).name:24s} cumulative flows: {len(flows)}')
        if args.max_flows and len(flows) >= args.max_flows:
            break
    if args.max_flows:
        flows = flows[:args.max_flows]
    if not flows:
        sys.exit('no flows reconstructed.')
    print(f'reconstructed {len(flows)} flows; timing embedding -> classification per flow on {dev} …')

    def run_one(seq, ctx, mask) -> None:
        pt = torch.from_numpy(seq).unsqueeze(0).to(dev)
        ct = torch.from_numpy(ctx).unsqueeze(0).to(dev)
        mt = torch.from_numpy(mask).unsqueeze(0).to(dev)
        with torch.no_grad():
            emb = model._model.forward_downstream(pt, ct, mt).cpu().numpy()
        model._knn.predict(emb)                                 # classification

    for i in range(min(args.warmup, len(flows))):               # warm caches (untimed)
        run_one(*flows[i])

    lat = np.empty(len(flows), np.float64)
    for i, (seq, ctx, mask) in enumerate(flows):
        t0 = time.perf_counter()
        run_one(seq, ctx, mask)
        lat[i] = (time.perf_counter() - t0) * 1000.0

    print(f'\n=== Per-flow latency (embedding -> classification) · batch=1 · device={dev} ===')
    print(f'  flows            : {len(lat)}')
    print(f'  MEAN             : {lat.mean():.3f} ms   <- average per-flow latency')
    print(f'  median (p50)     : {np.percentile(lat, 50):.3f} ms')
    print(f'  p95              : {np.percentile(lat, 95):.3f} ms')
    print(f'  p99              : {np.percentile(lat, 99):.3f} ms')
    print(f'  min / max        : {lat.min():.3f} / {lat.max():.3f} ms')
    print(f'  KPI (< 100 ms/flow): {"PASS" if lat.mean() < 100 else "FAIL"}')


if __name__ == '__main__':
    main()
