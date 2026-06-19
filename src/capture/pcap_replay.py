from __future__ import annotations

import ipaddress
import time
from collections import Counter
from typing import Iterator, Optional

from scapy.layers.inet import IP, TCP, UDP
from scapy.layers.inet6 import IPv6
from scapy.utils import PcapReader

from .base import PacketRecord, PacketSource

_PRIVATE = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
]


def _is_private(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return any(addr in net for net in _PRIVATE)
    except ValueError:
        return False


def _detect_local_ip(pcap_path: str, sample: int = 200) -> Optional[str]:
    counts: Counter[str] = Counter()
    try:
        with PcapReader(pcap_path) as reader:
            for i, pkt in enumerate(reader):
                if i >= sample:
                    break
                layer = pkt.getlayer(IP) or pkt.getlayer(IPv6)
                if layer is None:
                    continue
                src = str(layer.src)
                if _is_private(src):
                    counts[src] += 1
    except Exception:
        pass
    return counts.most_common(1)[0][0] if counts else None


class PcapReplay(PacketSource):
    def __init__(
        self,
        pcap_path: str,
        speed: float = 1.0,
        local_ip: Optional[str] = None,
    ) -> None:
        self.pcap_path = pcap_path
        self.speed = max(speed, 1e-3)
        self._local_ip = local_ip

    def stream(self) -> Iterator[PacketRecord]:
        local_ip = self._local_ip or _detect_local_ip(self.pcap_path)

        wall_start: Optional[float] = None
        pcap_start: Optional[float] = None

        with PcapReader(self.pcap_path) as reader:
            for pkt in reader:
                layer = pkt.getlayer(IP) or pkt.getlayer(IPv6)
                if layer is None:
                    continue

                tcp = pkt.getlayer(TCP)
                udp = pkt.getlayer(UDP)
                if tcp is None and udp is None:
                    continue

                transport = tcp if tcp is not None else udp
                proto = "TCP" if tcp is not None else "UDP"
                src_ip = str(layer.src)
                dst_ip = str(layer.dst)
                src_port = int(transport.sport)
                dst_port = int(transport.dport)

                pkt_ts = float(pkt.time)
                size = len(pkt)

                if local_ip:
                    direction = 1 if src_ip == local_ip else -1
                else:
                    direction = 1 if _is_private(src_ip) else -1

                # Timeline management
                if pcap_start is None:
                    pcap_start = pkt_ts
                    wall_start = time.monotonic()

                elapsed_pcap = (pkt_ts - pcap_start) / self.speed
                elapsed_wall = time.monotonic() - wall_start
                gap = elapsed_pcap - elapsed_wall
                if gap > 0:
                    time.sleep(gap)

                yield PacketRecord(
                    ts=pkt_ts,
                    src_ip=src_ip,
                    dst_ip=dst_ip,
                    src_port=src_port,
                    dst_port=dst_port,
                    proto=proto,
                    size=size,
                    direction=direction,
                )
