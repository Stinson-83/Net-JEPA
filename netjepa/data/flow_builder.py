from __future__ import annotations
from pathlib import Path
import pandas as pd
from typing import Any

from ..utils.logging import get_logger

# Defaults — overridable per-call (and from netjepa/configs/default.yaml via
# preprocess.run_pipeline). Lowering MIN_PACKETS recovers the many short flows
# the 10-packet floor used to discard outright.
FLOW_TIMEOUT = 30.0
MIN_PACKETS  = 5
MAX_PACKETS  = 64

_log = get_logger('data.flow_builder')


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
                  source_file: str,
                  min_packets: int = MIN_PACKETS,
                  max_packets: int = MAX_PACKETS,
                  flow_timeout: float = FLOW_TIMEOUT) -> list[dict[str, Any]]:
    records = df.to_dict('records')
    active: dict[tuple, list[dict]] = {}
    last_time: dict[tuple, float] = {}
    completed: list[list[dict]] = []

    for row in records:
        key = _flow_key(row)
        t   = row['time']

        if key in active and (t - last_time[key]) > flow_timeout:
            completed.append(active.pop(key))

        active.setdefault(key, []).append(row)
        last_time[key] = t

    for pkts in active.values():
        completed.append(pkts)

    flows = []
    n_dropped = 0
    for pkts in completed:
        if len(pkts) < min_packets:
            n_dropped += 1
            continue
        pkts = pkts[:max_packets]
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
    if n_dropped:
        _log.debug('%s: kept %d flows, dropped %d with <%d packets',
                   Path(source_file).name, len(flows), n_dropped, min_packets)
    return flows, n_dropped
