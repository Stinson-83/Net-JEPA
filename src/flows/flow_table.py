from __future__ import annotations

from collections import defaultdict
from typing import Dict, Generator, List, Optional, Tuple

from capture.base import PacketRecord

MAX_PACKETS = 64
MIN_PACKETS = 10
IDLE_TIMEOUT = 15.0  # seconds


FlowKey = Tuple[str, str, int, int, str]  # (ip_lo, ip_hi, port_lo, port_hi, proto)


def _flow_key(pkt: PacketRecord) -> FlowKey:
    """Canonical bidirectional key — both directions map to the same key."""
    ep_a = (pkt.src_ip, pkt.src_port)
    ep_b = (pkt.dst_ip, pkt.dst_port)
    if ep_a > ep_b:
        ep_a, ep_b = ep_b, ep_a
    return (ep_a[0], ep_b[0], ep_a[1], ep_b[1], pkt.proto)


class _Flow:
    def __init__(self) -> None:
        self.packets: List[PacketRecord] = []
        self.packet_count: int = 0
        self.first_ts: float = 0.0
        self.last_ts: float = 0.0
        self.emitted: bool = False

    def add(self, pkt: PacketRecord) -> None:
        if self.packet_count == 0:
            self.first_ts = pkt.ts
        self.last_ts = pkt.ts
        self.packet_count += 1
        if len(self.packets) < MAX_PACKETS:
            self.packets.append(pkt)


class FlowTable:
    def __init__(self) -> None:
        self._flows: Dict[FlowKey, _Flow] = {}

    def process(
        self, packets: "Iterable[PacketRecord]"
    ) -> Generator[Tuple[FlowKey, List[PacketRecord]], None, None]:
        """Consume a stream of PacketRecords; yield (key, packets) when MIN_PACKETS reached."""
        for pkt in packets:
            key = _flow_key(pkt)
            flow = self._flows.get(key)
            if flow is None:
                flow = _Flow()
                self._flows[key] = flow

            flow.add(pkt)
            self._expire(pkt.ts)

            if not flow.emitted and flow.packet_count >= MIN_PACKETS:
                flow.emitted = True
                yield key, list(flow.packets)

        # Flush remaining flows at end of stream
        yield from self._flush_all()

    def _expire(self, now: float) -> None:
        expired = [k for k, f in self._flows.items() if now - f.last_ts > IDLE_TIMEOUT]
        for k in expired:
            del self._flows[k]

    def _flush_all(self) -> Generator[Tuple[FlowKey, List[PacketRecord]], None, None]:
        for key, flow in list(self._flows.items()):
            if not flow.emitted and flow.packets:
                yield key, list(flow.packets)
        self._flows.clear()
