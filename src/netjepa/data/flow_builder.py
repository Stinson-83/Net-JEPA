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


import ipaddress as _ipaddr

_PRIVATE_NETS = [_ipaddr.ip_network(c) for c in (
    '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8',
    '100.64.0.0/10', 'fc00::/7', 'fe80::/10')]


def _is_private(ip: str) -> bool:
    try:
        addr = _ipaddr.ip_address(ip)
        return any(addr in n for n in _PRIVATE_NETS)
    except ValueError:
        return False


def _identify_client(packets: list[dict]) -> str:
    # 1) the side that initiated the TCP handshake (clean captures — same as before)
    for p in packets:
        if p['is_syn'] and not p['is_syn_ack']:
            return p['src_ip']
    # 2) no SYN (UDP/QUIC, or a flow captured mid-stream): the local *device* is the
    #    private endpoint. This keeps direction correct on real pcaps grabbed mid-
    #    connection, where the first packet may be the *server's*. For clean training
    #    captures the first packet is already the private device, so this is a no-op.
    a, b = packets[0]['src_ip'], packets[0]['dst_ip']
    a_priv, b_priv = _is_private(a), _is_private(b)
    if a_priv and not b_priv:
        return a
    if b_priv and not a_priv:
        return b
    # 3) fallback: source of the first packet
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
