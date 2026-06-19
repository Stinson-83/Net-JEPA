from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Iterator


@dataclass
class PacketRecord:
    ts: float
    src_ip: str
    dst_ip: str
    src_port: int
    dst_port: int
    proto: str        # "TCP", "UDP", or "QUIC"
    size: int         # bytes (full frame length, len(pkt))
    direction: int    # +1 outbound, -1 inbound
    # TCP flags + TLS handshake markers — populated from the pcap so the live
    # feature path can reuse the training extractor at full fidelity. Sources
    # that can't provide them (e.g. a minimal live sniffer) leave them False.
    is_syn: bool = False
    is_ack: bool = False
    is_syn_ack: bool = False
    is_fin: bool = False
    is_rst: bool = False
    is_client_hello: bool = False
    is_server_hello: bool = False


class PacketSource(ABC):
    @abstractmethod
    def stream(self) -> Iterator[PacketRecord]:
        ...
