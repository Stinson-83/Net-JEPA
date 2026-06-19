from __future__ import annotations

RTT_MAX = 5.0


def _valid(rtt: float) -> bool:
    return 0.0 < rtt < RTT_MAX


def extract_rtt(packets: list[dict], client_ip: str) -> tuple[float, bool]:
    # Strategy 1: TCP handshake
    syn_time = None
    for p in packets:
        if p['is_syn'] and not p['is_syn_ack'] and p['src_ip'] == client_ip:
            syn_time = p['time']
            break
    if syn_time is not None:
        for p in packets:
            if p['is_syn_ack'] and p['src_ip'] != client_ip:
                rtt = p['time'] - syn_time
                if _valid(rtt):
                    return rtt, True

    # Strategy 2: TLS handshake
    ch_time = None
    for p in packets:
        if p['is_client_hello'] and p['src_ip'] == client_ip:
            ch_time = p['time']
            break
    if ch_time is not None:
        for p in packets:
            if p['is_server_hello'] and p['src_ip'] != client_ip:
                rtt = p['time'] - ch_time
                if _valid(rtt):
                    return rtt, True

    # Strategy 3: First exchange
    first_client_time = None
    for p in packets:
        if p['src_ip'] == client_ip:
            first_client_time = p['time']
            break
    if first_client_time is not None:
        for p in packets:
            if p['src_ip'] != client_ip and p['time'] > first_client_time:
                rtt = p['time'] - first_client_time
                if _valid(rtt):
                    return rtt, True

    return 0.0, False
