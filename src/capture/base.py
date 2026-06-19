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
    proto: str        # "TCP" or "UDP"
    size: int         # bytes (IP payload)
    direction: int    # +1 outbound, -1 inbound


class PacketSource(ABC):
    @abstractmethod
    def stream(self) -> Iterator[PacketRecord]:
        ...
