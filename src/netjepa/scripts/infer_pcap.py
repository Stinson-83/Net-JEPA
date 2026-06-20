"""Run Net-JEPA inference on a .pcap in the terminal — no UI, no server.

This processes the pcap **identically to how the Kaggle CSV dataset is processed
in training**: parse each packet into the same schema `netjepa/data/parser.py`
produces, group with `netjepa/data/flow_builder.py` (bidirectional 5-tuple flows,
up to 64 packets, 30 s idle split), compute per-host stats across ALL flows, then
the same `netjepa/data/features.py` extractor → 128-D embedding → cosine k-NN.

Every field the CSV path uses is recovered from the pcap (a raw pcap is a superset
of the Wireshark CSV): timing, ports, length, protocol bucket, TCP flags
(SYN/ACK/FIN/RST), and TLS Client/Server-Hello markers.

Usage:
    python src/netjepa/scripts/infer_pcap.py path/to/file.pcap
    python src/netjepa/scripts/infer_pcap.py file.pcap --device cpu --min-packets 5
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # repo/src on sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _resolve(p: str) -> Path:
    pp = Path(p)
    return pp if pp.is_absolute() else (PROJECT_ROOT / pp)


def _ensure_checkpoint(ckpt: Path, knn: Path, repo: str) -> None:
    if ckpt.is_file() and knn.is_file():
        return
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        sys.exit(f"checkpoint not found at {ckpt} and huggingface_hub isn't installed.\n"
                 "Run `make fetch-weights` or `pip install huggingface_hub`.")
    import shutil
    ckpt.parent.mkdir(parents=True, exist_ok=True)
    if not ckpt.is_file():
        print(f"[infer] downloading weights from HF {repo} ...")
        shutil.copy(hf_hub_download(repo, "net_jepa_phase3.pt"), ckpt)
    if not knn.is_file():
        shutil.copy(hf_hub_download(repo, "knn.joblib"), knn)


def _pcap_to_dataframe(path: Path):
    """Parse a pcap into the exact column schema netjepa/data/parser.py emits, so
    flow_builder + features treat it identically to a Kaggle CSV."""
    import pandas as pd
    from scapy.layers.inet import IP, TCP, UDP
    from scapy.layers.inet6 import IPv6
    from scapy.utils import PcapReader

    rows = []
    with PcapReader(str(path)) as reader:
        for pkt in reader:
            layer = pkt.getlayer(IP) or pkt.getlayer(IPv6)
            if layer is None:
                continue
            tcp, udp = pkt.getlayer(TCP), pkt.getlayer(UDP)
            if tcp is None and udp is None:
                continue
            tp = tcp if tcp is not None else udp
            sp, dp = int(tp.sport), int(tp.dport)

            is_syn = is_ack = is_syn_ack = is_fin = is_rst = False
            is_ch = is_sh = False
            if tcp is not None:
                protocol_id = 0                                  # TCP/TLS bucket
                f = tcp.flags
                has_s, has_a = ('S' in f), ('A' in f)
                is_syn = has_s and not has_a
                is_syn_ack = has_s and has_a
                is_ack = has_a and not has_s
                is_fin = 'F' in f
                is_rst = 'R' in f
                payload = bytes(tcp.payload)
                if len(payload) >= 6 and payload[0] == 0x16:     # TLS handshake record
                    if payload[5] == 0x01:   is_ch = True
                    elif payload[5] == 0x02: is_sh = True
            else:
                protocol_id = 2 if 443 in (sp, dp) else 1        # QUIC vs UDP

            rows.append({
                'time': float(pkt.time), 'src_ip': str(layer.src), 'dst_ip': str(layer.dst),
                'src_port': sp, 'dst_port': dp, 'protocol_id': protocol_id, 'length': int(len(pkt)),
                'is_syn': is_syn, 'is_ack': is_ack, 'is_syn_ack': is_syn_ack,
                'is_fin': is_fin, 'is_rst': is_rst,
                'is_client_hello': is_ch, 'is_server_hello': is_sh,
            })
    if not rows:
        return None
    df = pd.DataFrame(rows).sort_values('time').reset_index(drop=True)
    df['time'] = df['time'] - df['time'].iloc[0]                 # relative seconds, like parser._to_float_time
    return df


def main() -> None:
    ap = argparse.ArgumentParser(description="Terminal inference on a .pcap, processed exactly like "
                                             "the Kaggle dataset (parser schema -> flow_builder -> features).")
    ap.add_argument("pcap", help="path to a .pcap / .pcapng file")
    ap.add_argument("--checkpoint", default="checkpoints/phase3/final.pt")
    ap.add_argument("--knn", default=None, help="defaults to knn.joblib next to the checkpoint")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--min-packets", type=int, default=5, help="min packets per flow (training default: 5)")
    ap.add_argument("--max-packets", type=int, default=64, help="max packets per flow (training default: 64)")
    ap.add_argument("--flow-timeout", type=float, default=30.0, help="idle split seconds (training default: 30)")
    ap.add_argument("--hf-repo", default="kritikahd007/net-jepa")
    ap.add_argument("--labels", default=None,
                    help="labels.json (with 'traffic_types') or comma-list, to name the predicted "
                         "classes (default: the built-in 6 categories). Use for the 8-class model.")
    args = ap.parse_args()

    pcap = _resolve(args.pcap)
    if not pcap.is_file():
        sys.exit(f"no such file: {pcap}")
    ckpt = _resolve(args.checkpoint)
    knn = _resolve(args.knn) if args.knn else ckpt.parent / "knn.joblib"
    _ensure_checkpoint(ckpt, knn, args.hf_repo)

    import numpy as np
    import torch
    from netjepa.data.flow_builder import extract_flows
    from netjepa.data.features import (compute_packet_sequence, compute_flow_context,
                                       compute_src_host_stats)
    from netjepa.data.rtt import extract_rtt
    from model.netjepa_classifier import NetJEPAClassifier, CATEGORY_LABELS

    labels = CATEGORY_LABELS
    if args.labels:
        p = _resolve(args.labels)
        if p.suffix == '.json' and p.is_file():
            import json
            d = json.load(open(p)); labels = d.get('traffic_types', d) if isinstance(d, dict) else d
        else:
            labels = [s.strip() for s in args.labels.split(',') if s.strip()]
    print(f"classes ({len(labels)}): {labels}")

    print(f"Loading model: {ckpt}")
    model = NetJEPAClassifier.load(str(ckpt), knn_path=str(knn))

    print(f"Parsing {pcap.name} (Kaggle-identical pipeline) ...")
    df = _pcap_to_dataframe(pcap)
    if df is None or df.empty:
        sys.exit("No IP/TCP/UDP packets found.")
    flows, dropped = extract_flows(df, app_label="?", category_label="?", source_file=str(pcap),
                                   min_packets=args.min_packets, max_packets=args.max_packets,
                                   flow_timeout=args.flow_timeout)
    print(f"  {len(df)} packets -> {len(flows)} flow(s) (>= {args.min_packets} pkts; "
          f"dropped {dropped} shorter), up to {args.max_packets} pkts/flow")
    if not flows:
        sys.exit("No flow met the minimum packet count.")

    host_stats = compute_src_host_stats(flows)                  # across ALL flows, like training

    counts: dict[str, int] = {}
    for i, flow in enumerate(flows, 1):
        pkts, client = flow['packets'], flow['client_ip']
        rtt, rtt_valid = extract_rtt(pkts, client)
        feat, mask = compute_packet_sequence(pkts, client, rtt, rtt_valid, args.max_packets)
        ctx = compute_flow_context(pkts, client, rtt, rtt_valid, host_stats)

        pkt_t = torch.from_numpy(np.asarray(feat, np.float32)).unsqueeze(0).to(model._device)
        ctx_t = torch.from_numpy(np.asarray(ctx, np.float32)).unsqueeze(0).to(model._device)
        mask_t = torch.from_numpy(np.asarray(mask)).unsqueeze(0).to(model._device)
        with torch.no_grad():
            emb = model._model.forward_downstream(pkt_t, ctx_t, mask_t).cpu().numpy()
        proba = model._knn.predict_proba(emb)[0]
        classes = model._knn.classes_
        order = np.argsort(proba)[::-1]
        top3 = [(labels[int(classes[j])] if int(classes[j]) < len(labels) else f"class{int(classes[j])}",
                 float(proba[j])) for j in order[:3] if proba[j] > 0]
        pred = top3[0][0] if top3 else "unknown"
        counts[pred] = counts.get(pred, 0) + 1

        syn = sum(p['is_syn'] for p in pkts); fin = sum(p['is_fin'] for p in pkts); rst = sum(p['is_rst'] for p in pkts)
        dur = pkts[-1]['time'] - pkts[0]['time']
        if len(flows) <= 60 or i <= 40:                          # avoid flooding on huge captures
            print(f"Flow {i}: {client} | {len(pkts)} pkts, {dur:.2f}s, flags S/F/R={syn}/{fin}/{rst}, "
                  f"rtt={'valid' if rtt_valid else 'none'}({rtt:.3f}s)")
            print(f"   => {pred}   (" + ", ".join(f"{c} {p*100:.0f}%" for c, p in top3) + ")")

    print("\nSummary:", ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))


if __name__ == "__main__":
    main()
