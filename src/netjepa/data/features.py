from __future__ import annotations
import math
import numpy as np
from typing import Any

MAX_PACKETS = 64
PACKET_FEAT_DIM = 9
CONTEXT_DIM = 15


def _onehot4(proto_id: int) -> list[float]:
    oh = [0.0, 0.0, 0.0, 0.0]
    oh[min(proto_id, 3)] = 1.0
    return oh


def compute_packet_sequence(packets: list[dict], client_ip: str,
                             rtt: float, rtt_valid: bool,
                             max_packets: int = MAX_PACKETS
                             ) -> tuple[np.ndarray, np.ndarray]:
    rtt_norm  = min(rtt, 2.0) / 2.0
    rtt_flag  = 1.0 if rtt_valid else 0.0

    seq = []
    prev_time = None
    for pkt in packets[:max_packets]:
        t    = pkt['time']
        iat  = (t - prev_time) if prev_time is not None else 0.0
        prev_time = t

        size_norm = pkt['length'] / 1500.0
        iat_log   = math.log1p(max(iat, 0.0)) / 10.0
        direction = 1.0 if pkt['src_ip'] == client_ip else -1.0
        signed    = size_norm * direction
        oh        = _onehot4(pkt['protocol_id'])

        seq.append([size_norm, iat_log, signed] + oh + [rtt_norm, rtt_flag])

    feat = np.array(seq, dtype=np.float32)           # (n, 9)
    mask = np.ones(len(seq), dtype=bool)

    # pad to max_packets
    if len(seq) < max_packets:
        pad = np.zeros((max_packets - len(seq), PACKET_FEAT_DIM), dtype=np.float32)
        feat = np.vstack([feat, pad])
        mask = np.concatenate([mask, np.zeros(max_packets - len(seq), dtype=bool)])

    return feat, mask   # (64, 9), (64,)


def compute_flow_context(packets: list[dict], client_ip: str,
                          rtt: float, rtt_valid: bool,
                          src_host_stats: dict) -> np.ndarray:
    n = len(packets)
    times = [p['time'] for p in packets]
    t0, t1 = times[0], times[-1]
    duration = max(t1 - t0, 1e-9)

    iats = [times[i] - times[i-1] for i in range(1, n)]
    iat_mean = float(np.mean(iats)) if iats else 0.0
    iat_std  = float(np.std(iats))  if len(iats) > 1 else 0.0

    syn_count = sum(1 for p in packets if p['is_syn'] and not p['is_syn_ack'])
    fin_count = sum(1 for p in packets if p['is_fin'])
    rst_count = sum(1 for p in packets if p['is_rst'])

    proto_id   = packets[0]['protocol_id']
    pkts_per_s = n / duration

    stats = src_host_stats.get(client_ip, {})
    n_dst_ips   = stats.get('n_dst_ips', 1)
    n_dst_ports = stats.get('n_dst_ports', 1)
    n_src_ports = stats.get('n_src_ports', 1)
    conn_per_s  = stats.get('conn_per_sec', 0.0)

    ctx = np.array([
        proto_id / 3.0,
        math.log1p(duration) / 10.0,
        math.log1p(iat_mean) / 10.0,
        math.log1p(iat_std)  / 10.0,
        syn_count / n,
        fin_count / n,
        rst_count / n,
        math.log1p(pkts_per_s)  / 10.0,
        math.log1p(n_dst_ips)   / 10.0,
        math.log1p(n_dst_ports) / 10.0,
        math.log1p(n_src_ports) / 10.0,
        math.log1p(conn_per_s)  / 10.0,
        min(n, 200) / 200.0,
        min(rtt, 2.0) / 2.0,
        1.0 if rtt_valid else 0.0,
    ], dtype=np.float32)
    return ctx


def compute_src_host_stats(all_flows: list[dict[str, Any]]) -> dict[str, dict]:
    from collections import defaultdict
    dst_ips   = defaultdict(set)
    dst_ports = defaultdict(set)
    src_ports = defaultdict(set)
    flow_count = defaultdict(int)
    total_dur  = defaultdict(float)

    for flow in all_flows:
        src = flow['client_ip']
        pkts = flow['packets']
        times = [p['time'] for p in pkts]
        dur = max(times[-1] - times[0], 1e-9) if len(times) > 1 else 1e-9

        for p in pkts:
            if p['src_ip'] == src:
                dst_ips[src].add(p['dst_ip'])
                dst_ports[src].add(p['dst_port'])
                src_ports[src].add(p['src_port'])

        flow_count[src] += 1
        total_dur[src]  += dur

    stats: dict[str, dict] = {}
    for src in flow_count:
        dur = max(total_dur[src], 1e-9)
        stats[src] = {
            'n_dst_ips':   len(dst_ips[src]),
            'n_dst_ports': len(dst_ports[src]),
            'n_src_ports': len(src_ports[src]),
            'conn_per_sec': flow_count[src] / dur,
        }
    return stats
