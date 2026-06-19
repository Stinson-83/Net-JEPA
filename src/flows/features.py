from __future__ import annotations

from dataclasses import dataclass
from typing import List

import numpy as np

from capture.base import PacketRecord

MAX_PACKETS = 64

SCALAR_FEATURE_NAMES = [
    "packet_count",
    "duration",
    "mean_pkt_size",
    "std_pkt_size",
    "mean_iat",
    "std_iat",       # jitter proxy
    "bytes_up",
    "bytes_down",
    "up_down_ratio",
    "packet_rate",
]


@dataclass
class FlowFeatures:
    scalar_vector: np.ndarray   # shape [len(SCALAR_FEATURE_NAMES)]
    sequence: np.ndarray        # shape [MAX_PACKETS, 3] = [size, IAT, direction]


def extract(packets: List[PacketRecord]) -> FlowFeatures:
    n = len(packets)
    sizes = np.array([p.size for p in packets], dtype=np.float32)
    dirs = np.array([p.direction for p in packets], dtype=np.float32)
    ts = np.array([p.ts for p in packets], dtype=np.float64)

    duration = float(ts[-1] - ts[0]) if n > 1 else 0.0

    iats = np.diff(ts).astype(np.float32) if n > 1 else np.array([0.0], dtype=np.float32)
    mean_iat = float(iats.mean())
    std_iat = float(iats.std()) if len(iats) > 1 else 0.0

    bytes_up = float(sizes[dirs > 0].sum())
    bytes_down = float(sizes[dirs < 0].sum())
    up_count = int((dirs > 0).sum())
    down_count = int((dirs < 0).sum())
    up_down_ratio = up_count / max(down_count, 1)
    packet_rate = n / max(duration, 1e-6)

    scalar = np.array([
        n,
        duration,
        float(sizes.mean()),
        float(sizes.std()) if n > 1 else 0.0,
        mean_iat,
        std_iat,
        bytes_up,
        bytes_down,
        up_down_ratio,
        packet_rate,
    ], dtype=np.float32)

    # Build per-packet sequence [size, IAT, direction], padded to MAX_PACKETS
    seq = np.zeros((MAX_PACKETS, 3), dtype=np.float32)
    full_iats = np.concatenate([[0.0], iats])  # first packet has IAT 0
    end = min(n, MAX_PACKETS)
    seq[:end, 0] = sizes[:end]
    seq[:end, 1] = full_iats[:end]
    seq[:end, 2] = dirs[:end]

    return FlowFeatures(scalar_vector=scalar, sequence=seq)
