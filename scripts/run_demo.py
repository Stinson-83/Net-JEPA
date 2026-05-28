#!/usr/bin/env python3
"""
Phase 2 demo: replay a pcap → FlowTable → features → classify → print results.

Usage:
    python scripts/run_demo.py --pcap demo.pcap --model model/checkpoints/baseline.joblib
    python scripts/run_demo.py --pcap demo.pcap --model model/checkpoints/baseline.joblib --speed 5
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from capture.pcap_replay import PcapReplay
from flows.features import extract
from flows.flow_table import FlowTable
from model.simple_baseline import RandomForestClassifierModel


def _fmt_key(key) -> str:
    ip_lo, ip_hi, port_lo, port_hi, proto = key
    return f"{ip_lo}:{port_lo}↔{ip_hi}:{port_hi}/{proto}"


def run(pcap_path: str, model_path: str, speed: float) -> None:
    model = RandomForestClassifierModel.load(model_path)
    replay = PcapReplay(pcap_path, speed=speed)
    table = FlowTable()

    print(f"{'FlowID':<45} {'App':<20} {'Conf':>6}  {'Pkts':>5}  {'Lat(ms)':>8}")
    print("-" * 92)

    flow_idx = 0
    for key, pkts in table.process(replay.stream()):
        t0 = time.perf_counter()
        feats = extract(pkts)
        pred = model.predict(feats)
        latency_ms = (time.perf_counter() - t0) * 1000

        flow_id = f"f{flow_idx:04d}"
        label = f"{flow_id}  {_fmt_key(key)}"
        print(
            f"{label:<45} {pred.label:<20} {pred.confidence:>5.1%}  {len(pkts):>5}  {latency_ms:>7.2f}ms"
        )
        flow_idx += 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pcap", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--speed", type=float, default=1.0,
                        help="Replay speed multiplier (>1 = faster)")
    args = parser.parse_args()

    for p in (args.pcap, args.model):
        if not os.path.isfile(p):
            sys.exit(f"ERROR: file not found: {p}")

    run(args.pcap, args.model, args.speed)


if __name__ == "__main__":
    main()
