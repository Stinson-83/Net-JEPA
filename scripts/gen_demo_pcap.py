#!/usr/bin/env python3
"""
Generate a synthetic demo.pcap that mimics 3 apps (Netflix, Zoom, Gaming)
so Phases 2–3 can be tested without a real capture.

Usage:
    python scripts/gen_demo_pcap.py --out demo.pcap
"""
from __future__ import annotations

import argparse
import os
import random
import struct
import sys
import time

# Write a pcap file manually (no scapy write dependency issues)

PCAP_GLOBAL_HDR = struct.pack(
    "<IHHiIII",
    0xA1B2C3D4,  # magic
    2, 4,        # ver major/minor
    0,           # thiszone
    0,           # sigfigs
    65535,       # snaplen
    1,           # network = LINKTYPE_ETHERNET
)

ETH_HDR = b"\xff\xff\xff\xff\xff\xff" + b"\x00\x11\x22\x33\x44\x55" + b"\x08\x00"  # EtherType IPv4


def _ip_hdr(src: bytes, dst: bytes, proto: int, payload_len: int) -> bytes:
    total_len = 20 + payload_len
    hdr = struct.pack(
        ">BBHHHBBH4s4s",
        0x45,       # version + IHL
        0,          # DSCP
        total_len,
        0,          # ID
        0,          # flags + frag offset
        64,         # TTL
        proto,      # 6=TCP, 17=UDP
        0,          # checksum (0 = skip)
        src,
        dst,
    )
    return hdr


def _udp_hdr(sport: int, dport: int, payload_len: int) -> bytes:
    length = 8 + payload_len
    return struct.pack(">HHHH", sport, dport, length, 0)


def _tcp_hdr(sport: int, dport: int) -> bytes:
    return struct.pack(">HHIIBBHHH",
        sport, dport,
        0, 0,           # seq, ack
        0x50, 0x18,     # data offset, ACK|PSH
        65535, 0, 0,    # window, checksum, urgent
    )


def _pkt_record(ts: float, frame: bytes) -> bytes:
    sec = int(ts)
    usec = int((ts - sec) * 1_000_000)
    n = len(frame)
    return struct.pack("<IIII", sec, usec, n, n) + frame


def _ip_bytes(s: str) -> bytes:
    return bytes(int(x) for x in s.split("."))


def build_pcap(out_path: str, duration: float = 90.0, seed: int = 42) -> None:
    rng = random.Random(seed)

    apps = [
        # (name, local_ip, remote_ip, remote_port, proto, pkt_sizes, iat_mean, n_flows)
        ("Netflix", "192.168.1.10", "52.1.1.1",  443, "UDP",
         (800, 1400), 0.008, 15),
        ("Zoom",    "192.168.1.10", "52.2.2.2",  8801,"UDP",
         (100,  600), 0.020, 8),
        ("Gaming",  "192.168.1.10", "52.3.3.3",  7777,"UDP",
         (60,   200), 0.005, 12),
    ]

    frames: list[tuple[float, bytes]] = []

    t_base = 1700000000.0  # fixed epoch so pcap is deterministic

    for label, local_ip, remote_ip, rport, proto, sz_range, iat_mu, n_flows in apps:
        for fid in range(n_flows):
            lport = rng.randint(40000, 60000)
            t = t_base + rng.uniform(0, duration * 0.7)
            # Each flow: 30–80 packets
            n_pkts = rng.randint(30, 80)
            for i in range(n_pkts):
                iat = rng.expovariate(1 / iat_mu)
                t += iat
                if t - t_base > duration:
                    break
                size = rng.randint(*sz_range)
                out = rng.random() > 0.3  # 70% outbound
                src_ip, dst_ip = (local_ip, remote_ip) if out else (remote_ip, local_ip)
                sport, dport = (lport, rport) if out else (rport, lport)

                payload = bytes(rng.randint(0, 255) for _ in range(max(1, size - 20 - 8)))

                if proto == "UDP":
                    transport = _udp_hdr(sport, dport, len(payload)) + payload
                    ip_proto = 17
                else:
                    transport = _tcp_hdr(sport, dport) + payload
                    ip_proto = 6

                ip = _ip_hdr(_ip_bytes(src_ip), _ip_bytes(dst_ip), ip_proto, len(transport))
                frame = ETH_HDR + ip + transport
                frames.append((t, frame))

    frames.sort(key=lambda x: x[0])

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True) if os.path.dirname(out_path) else None
    with open(out_path, "wb") as f:
        f.write(PCAP_GLOBAL_HDR)
        for ts, frame in frames:
            f.write(_pkt_record(ts, frame))

    print(f"Written {len(frames)} packets → {out_path}")
    print("Apps: Netflix (flows=15), Zoom (flows=8), Gaming (flows=12)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="demo.pcap")
    parser.add_argument("--duration", type=float, default=90.0, help="Simulated duration (seconds)")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    build_pcap(args.out, args.duration, args.seed)


if __name__ == "__main__":
    main()
