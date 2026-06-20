"""Fold *unlabeled* .pcap captures into the Phase-1 pretraining set.

Phase 1 (JEPA pretraining) is self-supervised — it never reads the label — so any
extra raw traffic helps it learn better representations without needing
annotations. Point this at QUIC/home-network captures (e.g. CESNET-QUIC22, MIRAGE,
UC-Davis QUIC, or your own home pcaps) to broaden coverage beyond the testbed
domain and improve real-pcap inference.

Each pcap is parsed and flowed EXACTLY like training (pcap_to_flows -> the same
flow_builder + features.py path), then appended to processed_dir/pretrain.parquet
with a sentinel label of -1. Re-running is idempotent: previously-added unlabeled
rows (label -1) are dropped before re-appending, so you can grow the set safely.

    python -m netjepa.scripts.pretrain_add_pcaps ~/quic_caps/ extra.pcap \
        --processed-dir data/processed_traffic

Only Phase 1 reads pretrain.parquet, so this never touches the supervised
downstream_train/test splits used by phases 2b/3.
"""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

UNLABELED = -1                                                   # sentinel; Phase 1 ignores labels


def _resolve(p: str) -> Path:
    q = Path(p).expanduser()
    return q if q.is_absolute() else (Path.cwd() / q)


def _gather_pcaps(args_paths: list[str]) -> list[Path]:
    out: list[Path] = []
    for raw in args_paths:
        p = _resolve(raw)
        if p.is_dir():
            out += sorted(q for ext in ('*.pcap', '*.pcapng')
                          for q in p.rglob(ext))
        elif p.is_file():
            out.append(p)
        else:
            print(f"  skip (not found): {p}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pcaps", nargs="+", help="pcap files and/or directories to fold in")
    ap.add_argument("--processed-dir", default="data/processed_traffic",
                    help="dir holding pretrain.parquet (default: data/processed_traffic)")
    ap.add_argument("--min-packets", type=int, default=5)
    ap.add_argument("--max-packets", type=int, default=64)
    ap.add_argument("--flow-timeout", type=float, default=30.0)
    ap.add_argument("--keep-existing", action="store_true",
                    help="append even if prior unlabeled rows exist (default: replace them)")
    args = ap.parse_args()

    proc = _resolve(args.processed_dir)
    pretrain_path = proc / "pretrain.parquet"
    if not pretrain_path.is_file():
        sys.exit(f"no pretrain.parquet at {pretrain_path} — build the dataset first "
                 f"(see build_traffic_dataset.py)")

    # src/ on path so the training feature code is importable when run as a module
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

    import pandas as pd
    from model.netjepa_classifier import pcap_to_flows
    from netjepa.data.features import (compute_packet_sequence, compute_flow_context,
                                       compute_src_host_stats)
    from netjepa.data.rtt import extract_rtt

    pcaps = _gather_pcaps(args.pcaps)
    if not pcaps:
        sys.exit("no pcap files found.")
    print(f"folding {len(pcaps)} pcap(s) into {pretrain_path}")

    records = []
    for pc in pcaps:
        flows = pcap_to_flows(str(pc), min_packets=args.min_packets,
                              max_packets=args.max_packets, flow_timeout=args.flow_timeout)
        if not flows:
            print(f"  {pc.name}: 0 flows")
            continue
        host_stats = compute_src_host_stats(flows)              # per-capture host context, like training
        for fl in flows:
            pkts, client = fl['packets'], fl['client_ip']
            rtt, rtt_valid = extract_rtt(pkts, client)
            seq, mask = compute_packet_sequence(pkts, client, rtt, rtt_valid, args.max_packets)
            ctx = compute_flow_context(pkts, client, rtt, rtt_valid, host_stats)
            records.append({'packet_sequence': seq.tolist(), 'padding_mask': mask.tolist(),
                            'flow_context': ctx.tolist(), 'category_label': UNLABELED,
                            'app_label': UNLABELED, 'rtt_valid': bool(rtt_valid),
                            'source_file': str(pc)})
        print(f"  {pc.name}: +{len(flows)} flows")

    if not records:
        sys.exit("no flows extracted from the given pcaps.")

    base = pd.read_parquet(pretrain_path)
    n_before = len(base)
    if not args.keep_existing and 'category_label' in base.columns:
        base = base[base['category_label'] != UNLABELED].reset_index(drop=True)
        if len(base) != n_before:
            print(f"  dropped {n_before - len(base)} previously-added unlabeled rows")

    # one-time backup of the original supervised-only pretrain set
    backup = proc / "pretrain.orig.parquet"
    if not backup.is_file():
        pd.read_parquet(pretrain_path).to_parquet(backup)
        print(f"  backed up original -> {backup.name}")

    new = pd.DataFrame(records)[base.columns.tolist()] if len(base.columns) else pd.DataFrame(records)
    out = pd.concat([base, new], ignore_index=True)
    out.to_parquet(pretrain_path)
    print(f"done. pretrain.parquet: {len(base)} labeled + {len(new)} unlabeled = {len(out)} flows")


if __name__ == "__main__":
    main()
