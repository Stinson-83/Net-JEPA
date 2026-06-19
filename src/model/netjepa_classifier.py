"""
NetJEPA live-inference classifier.

Bridges the existing PacketRecord-based capture pipeline to the
NetJEPA feature format and runs forward_downstream classification.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import List

import numpy as np
import torch

from capture.base import PacketRecord
from model.classifier_base import Classifier, Prediction

# Lazy import to avoid circular import at module load
_NetJEPA = None
_load_checkpoint = None


def _lazy_imports():
    global _NetJEPA, _load_checkpoint
    if _NetJEPA is None:
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from netjepa.model.netjepa import NetJEPA
        from netjepa.utils.io import load_checkpoint
        _NetJEPA = NetJEPA
        _load_checkpoint = load_checkpoint


# ── App / category label maps (must match netjepa/data/preprocess.py) ────────

APP_LABELS = [
    'geforce_now', 'kt_gamebox', 'afreecatv', 'naver_now', 'youtube_live',
    'roblox', 'zepeto', 'battleground', 'tft', 'amazon_prime',
    'netflix', 'youtube', 'google_meet', 'ms_teams', 'zoom',
]
CATEGORY_LABELS = [
    'game_streaming', 'live_streaming', 'metaverse',
    'online_game', 'stored_streaming', 'video_conferencing',
]
APP_TO_CATEGORY = {
    'geforce_now': 'game_streaming',  'kt_gamebox':   'game_streaming',
    'afreecatv':   'live_streaming',  'naver_now':    'live_streaming',
    'youtube_live':'live_streaming',  'roblox':       'metaverse',
    'zepeto':      'metaverse',       'battleground': 'online_game',
    'tft':         'online_game',     'amazon_prime': 'stored_streaming',
    'netflix':     'stored_streaming','youtube':      'stored_streaming',
    'google_meet': 'video_conferencing', 'ms_teams':  'video_conferencing',
    'zoom':        'video_conferencing',
}

MAX_PACKETS = 64
PACKET_FEAT_DIM = 9
CONTEXT_DIM = 15

_PROTO_MAP = {'TCP': 0, 'TLS': 0, 'UDP': 1, 'QUIC': 2}


def _proto_onehot(proto: str) -> list[float]:
    oh = [0.0, 0.0, 0.0, 0.0]
    oh[_PROTO_MAP.get(proto.upper(), 3)] = 1.0
    return oh


def _extract_rtt_live(packets: List[PacketRecord], client_ip: str) -> tuple[float, bool]:
    """First-exchange RTT estimate from PacketRecord stream."""
    first_client_t = None
    for p in packets:
        if p.src_ip == client_ip:
            first_client_t = p.ts
            break
    if first_client_t is None:
        return 0.0, False
    for p in packets:
        if p.src_ip != client_ip and p.ts > first_client_t:
            rtt = p.ts - first_client_t
            if 0.0 < rtt < 5.0:
                return rtt, True
    return 0.0, False


def packets_to_tensors(packets: List[PacketRecord]
                       ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Convert List[PacketRecord] → (packet_seq, flow_ctx, padding_mask) tensors."""
    n = min(len(packets), MAX_PACKETS)
    pkts = packets[:n]

    # Identify client (source of first packet)
    client_ip = pkts[0].src_ip

    rtt, rtt_valid = _extract_rtt_live(pkts, client_ip)
    rtt_norm  = min(rtt, 2.0) / 2.0
    rtt_flag  = 1.0 if rtt_valid else 0.0

    seq = []
    prev_t = None
    for p in pkts:
        t   = p.ts
        iat = (t - prev_t) if prev_t is not None else 0.0
        prev_t = t
        size_norm = p.size / 1500.0
        iat_log   = math.log1p(max(iat, 0.0)) / 10.0
        direction = 1.0 if p.src_ip == client_ip else -1.0
        signed    = size_norm * direction
        oh        = _proto_onehot(p.proto)
        seq.append([size_norm, iat_log, signed] + oh + [rtt_norm, rtt_flag])

    feat = np.array(seq, dtype=np.float32)
    mask = np.ones(n, dtype=bool)
    if n < MAX_PACKETS:
        pad  = np.zeros((MAX_PACKETS - n, PACKET_FEAT_DIM), dtype=np.float32)
        feat = np.vstack([feat, pad])
        mask = np.concatenate([mask, np.zeros(MAX_PACKETS - n, dtype=bool)])

    # Flow context (simplified — src-host stats default to 1 flow / 1 unique addr)
    all_times = [p.ts for p in packets]
    all_pkts  = packets  # use ALL packets for context stats
    total_n   = len(all_pkts)
    t0, t1    = all_times[0], all_times[-1]
    duration  = max(t1 - t0, 1e-9)
    iats_all  = [all_times[i] - all_times[i-1] for i in range(1, total_n)]
    iat_mean  = float(np.mean(iats_all)) if iats_all else 0.0
    iat_std   = float(np.std(iats_all))  if len(iats_all) > 1 else 0.0
    proto_id  = _PROTO_MAP.get(packets[0].proto.upper(), 3)

    ctx = np.array([
        proto_id / 3.0,
        math.log1p(duration) / 10.0,
        math.log1p(iat_mean) / 10.0,
        math.log1p(iat_std)  / 10.0,
        0.0,  # syn_count (not available from PacketRecord)
        0.0,  # fin_count
        0.0,  # rst_count
        math.log1p(total_n / duration) / 10.0,
        math.log1p(1) / 10.0,  # n_dst_ips (1 default)
        math.log1p(1) / 10.0,  # n_dst_ports
        math.log1p(1) / 10.0,  # n_src_ports
        math.log1p(1 / duration) / 10.0,  # conn_per_sec (1 flow)
        min(total_n, 200) / 200.0,
        rtt_norm,
        rtt_flag,
    ], dtype=np.float32)

    pkt_t  = torch.from_numpy(feat).unsqueeze(0)   # (1, 64, 9)
    ctx_t  = torch.from_numpy(ctx).unsqueeze(0)    # (1, 15)
    mask_t = torch.from_numpy(mask).unsqueeze(0)   # (1, 64)
    return pkt_t, ctx_t, mask_t


# ── Classifier implementation ─────────────────────────────────────────────────

class NetJEPAClassifier(Classifier):
    """
    NetJEPA-backed classifier for live inference via the server.
    Uses k-NN over the downstream embedding space.
    """

    def __init__(self) -> None:
        self._model = None
        self._knn   = None
        self._device = torch.device('cpu')

    def _ensure_loaded(self) -> bool:
        return self._model is not None

    def predict(self, packets: List[PacketRecord]) -> Prediction:
        if not self._ensure_loaded():
            return Prediction(label='unknown', confidence=0.0,
                              embedding=None, category='unknown')

        pkt_t, ctx_t, mask_t = packets_to_tensors(packets)
        with torch.no_grad():
            emb = self._model.forward_downstream(
                pkt_t.to(self._device),
                ctx_t.to(self._device),
                mask_t.to(self._device))

        emb_np = emb.cpu().numpy()

        if self._knn is not None:
            label_id   = int(self._knn.predict(emb_np)[0])
            proba      = self._knn.predict_proba(emb_np)[0]
            confidence = float(proba.max())
        else:
            # Fallback: return unknown
            return Prediction(label='unknown', confidence=0.0,
                              embedding=emb_np[0], category='unknown')

        # The Phase 3 kNN now predicts the 6 coarse CATEGORIES directly (the
        # level the cosine/accuracy KPIs are defined at), not the 15 apps.
        category = (CATEGORY_LABELS[label_id]
                    if 0 <= label_id < len(CATEGORY_LABELS) else 'unknown')
        return Prediction(label=category, confidence=confidence,
                          embedding=emb_np[0], category=category)

    def save(self, path: str) -> None:
        raise NotImplementedError('Use netjepa/utils/io.save_checkpoint instead.')

    @classmethod
    def load(cls, checkpoint_path: str,
             knn_path: str | None = None) -> 'NetJEPAClassifier':
        """Load a trained NetJEPA checkpoint and optional kNN index."""
        _lazy_imports()
        import joblib

        obj = cls()
        obj._model = _NetJEPA()
        _load_checkpoint(obj._model, None, checkpoint_path, obj._device)
        obj._model.eval()

        if knn_path and Path(knn_path).exists():
            obj._knn = joblib.load(knn_path)
        else:
            # Try to find a knn.joblib next to the checkpoint
            ckpt_dir = Path(checkpoint_path).parent
            candidate = ckpt_dir / 'knn.joblib'
            if candidate.exists():
                obj._knn = joblib.load(candidate)

        return obj
