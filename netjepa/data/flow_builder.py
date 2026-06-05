from __future__ import annotations
import pandas as pd
from typing import Any

FLOW_TIMEOUT = 30.0
MIN_PACKETS  = 10
MAX_PACKETS  = 64


def _flow_key(row) -> tuple:
    a = (row['src_ip'], row['src_port'])
    b = (row['dst_ip'], row['dst_port'])
    return (frozenset([a, b]), row['protocol_id'])


def _identify_client(packets: list[dict]) -> str:
    for p in packets:
        if p['is_syn'] and not p['is_syn_ack']:
            return p['src_ip']
    # UDP/QUIC fallback: source of first packet
    return packets[0]['src_ip']


def extract_flows(df: pd.DataFrame, app_label: str, category_label: str,
                  source_file: str) -> list[dict[str, Any]]:
    records = df.to_dict('records')
    active: dict[tuple, list[dict]] = {}
    last_time: dict[tuple, float] = {}
    completed: list[list[dict]] = []

    for row in records:
        key = _flow_key(row)
        t   = row['time']

        if key in active and (t - last_time[key]) > FLOW_TIMEOUT:
            completed.append(active.pop(key))

        active.setdefault(key, []).append(row)
        last_time[key] = t

    for pkts in active.values():
        completed.append(pkts)

    flows = []
    for pkts in completed:
        if len(pkts) < MIN_PACKETS:
            continue
        pkts = pkts[:MAX_PACKETS]
        client_ip = _identify_client(pkts)
        first = pkts[0]
        flows.append({
            'src_ip':         first['src_ip'],
            'dst_ip':         first['dst_ip'],
            'src_port':       first['src_port'],
            'dst_port':       first['dst_port'],
            'protocol_id':    first['protocol_id'],
            'client_ip':      client_ip,
            'packets':        pkts,
            'app_label':      app_label,
            'category_label': category_label,
            'source_file':    source_file,
        })
    return flows
