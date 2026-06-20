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
_compute_packet_sequence = None
_compute_flow_context = None
_compute_src_host_stats = None
_extract_rtt = None


def _lazy_imports():
    global _NetJEPA, _load_checkpoint
    global _compute_packet_sequence, _compute_flow_context, _compute_src_host_stats, _extract_rtt
    if _NetJEPA is None:
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from netjepa.model.netjepa import NetJEPA
        from netjepa.utils.io import load_checkpoint
        # Reuse the EXACT training feature extractor + RTT logic so live
        # inference is full-fidelity (not a simplified reimplementation).
        from netjepa.data.features import (
            compute_packet_sequence, compute_flow_context, compute_src_host_stats)
        from netjepa.data.rtt import extract_rtt
        _NetJEPA = NetJEPA
        _load_checkpoint = load_checkpoint
        _compute_packet_sequence = compute_packet_sequence
        _compute_flow_context = compute_flow_context
        _compute_src_host_stats = compute_src_host_stats
        _extract_rtt = extract_rtt


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

_PROTO_ID = {'TCP': 0, 'TLS': 0, 'UDP': 1, 'QUIC': 2}


def _records_to_dicts(packets: List[PacketRecord]) -> list[dict]:
    """PacketRecord → the packet-dict schema the training extractor expects
    (the netjepa/data/parser.py output), so live inference can reuse features.py
    verbatim instead of a simplified reimplementation."""
    out = []
    for p in packets:
        out.append({
            'time': p.ts, 'src_ip': p.src_ip, 'dst_ip': p.dst_ip,
            'src_port': p.src_port, 'dst_port': p.dst_port,
            'protocol_id': _PROTO_ID.get(p.proto.upper(), 3),
            'length': p.size,
            'is_syn': p.is_syn, 'is_ack': p.is_ack, 'is_syn_ack': p.is_syn_ack,
            'is_fin': p.is_fin, 'is_rst': p.is_rst,
            'is_client_hello': p.is_client_hello, 'is_server_hello': p.is_server_hello,
        })
    return out


def _identify_client(dicts: list[dict]) -> str:
    """Same rule as netjepa/data/flow_builder._identify_client."""
    for p in dicts:
        if p['is_syn'] and not p['is_syn_ack']:
            return p['src_ip']
    return dicts[0]['src_ip']


def packets_to_tensors(packets: List[PacketRecord]
                       ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Convert List[PacketRecord] → (packet_seq, flow_ctx, padding_mask) tensors
    using the **exact training feature extractor** — full fidelity: TCP-flag
    ratios, handshake-based RTT, and per-host connectivity stats (recovered from
    the pcap), so a live flow embeds identically to how it would in training."""
    _lazy_imports()
    dicts = _records_to_dicts(packets[:MAX_PACKETS])
    client_ip = _identify_client(dicts)

    rtt, rtt_valid = _extract_rtt(dicts, client_ip)
    # Host-connectivity stats over this flow (a single uploaded flow yields the
    # same per-flow counts training computes for a one-flow client).
    host_stats = _compute_src_host_stats([{'client_ip': client_ip, 'packets': dicts}])

    feat, mask = _compute_packet_sequence(dicts, client_ip, rtt, rtt_valid, MAX_PACKETS)
    ctx        = _compute_flow_context(dicts, client_ip, rtt, rtt_valid, host_stats)

    pkt_t  = torch.from_numpy(np.asarray(feat, dtype=np.float32)).unsqueeze(0)  # (1, 64, 9)
    ctx_t  = torch.from_numpy(np.asarray(ctx,  dtype=np.float32)).unsqueeze(0)  # (1, 15)
    mask_t = torch.from_numpy(np.asarray(mask)).unsqueeze(0)                    # (1, 64)
    return pkt_t, ctx_t, mask_t


def pcap_to_flows(pcap_path: str, *, min_packets: int = 5, max_packets: int = 64,
                  flow_timeout: float = 30.0) -> list:
    """Parse a pcap and build flows EXACTLY like training: each packet -> the
    netjepa/data/parser.py column schema, then flow_builder.extract_flows
    (bidirectional 5-tuple, up to max_packets, idle split). Returns flow dicts.
    All CSV-path fields are recovered from the pcap (flags + TLS hellos included)."""
    import pandas as pd
    from scapy.layers.inet import IP, TCP, UDP
    from scapy.layers.inet6 import IPv6
    from scapy.utils import PcapReader
    from netjepa.data.flow_builder import extract_flows

    rows = []
    with PcapReader(str(pcap_path)) as reader:
        for pkt in reader:
            layer = pkt.getlayer(IP) or pkt.getlayer(IPv6)
            if layer is None:
                continue
            tcp, udp = pkt.getlayer(TCP), pkt.getlayer(UDP)
            if tcp is None and udp is None:
                continue
            tp = tcp if tcp is not None else udp
            sp, dp = int(tp.sport), int(tp.dport)
            is_syn = is_ack = is_syn_ack = is_fin = is_rst = is_ch = is_sh = False
            if tcp is not None:
                pid = 0
                f = tcp.flags; hs, ha = ('S' in f), ('A' in f)
                is_syn = hs and not ha; is_syn_ack = hs and ha; is_ack = ha and not hs
                is_fin = 'F' in f; is_rst = 'R' in f
                pl = bytes(tcp.payload)
                if len(pl) >= 6 and pl[0] == 0x16:
                    if pl[5] == 0x01:   is_ch = True
                    elif pl[5] == 0x02: is_sh = True
            else:
                pid = 2 if 443 in (sp, dp) else 1
            rows.append({'time': float(pkt.time), 'src_ip': str(layer.src), 'dst_ip': str(layer.dst),
                         'src_port': sp, 'dst_port': dp, 'protocol_id': pid, 'length': int(len(pkt)),
                         'is_syn': is_syn, 'is_ack': is_ack, 'is_syn_ack': is_syn_ack,
                         'is_fin': is_fin, 'is_rst': is_rst,
                         'is_client_hello': is_ch, 'is_server_hello': is_sh})
    if not rows:
        return []
    df = pd.DataFrame(rows).sort_values('time').reset_index(drop=True)
    df['time'] = df['time'] - df['time'].iloc[0]
    flows, _ = extract_flows(df, '?', '?', str(pcap_path),
                             min_packets=min_packets, max_packets=max_packets, flow_timeout=flow_timeout)
    return flows


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

    def predict_flow(self, flow: dict, host_stats: dict) -> Prediction:
        """Classify one flow_builder flow dict (training-identical path): up to 64
        packets, handshake-based RTT, and src-host stats computed across all flows
        of the capture (pass the output of compute_src_host_stats(all_flows))."""
        if not self._ensure_loaded():
            return Prediction(label='unknown', confidence=0.0, embedding=None, category='unknown')
        pkts, client = flow['packets'], flow['client_ip']
        rtt, rtt_valid = _extract_rtt(pkts, client)
        feat, mask = _compute_packet_sequence(pkts, client, rtt, rtt_valid, MAX_PACKETS)
        ctx = _compute_flow_context(pkts, client, rtt, rtt_valid, host_stats)
        pkt_t = torch.from_numpy(np.asarray(feat, np.float32)).unsqueeze(0).to(self._device)
        ctx_t = torch.from_numpy(np.asarray(ctx, np.float32)).unsqueeze(0).to(self._device)
        mask_t = torch.from_numpy(np.asarray(mask)).unsqueeze(0).to(self._device)
        with torch.no_grad():
            emb = self._model.forward_downstream(pkt_t, ctx_t, mask_t)
        emb_np = emb.cpu().numpy()
        if self._knn is None:
            return Prediction(label='unknown', confidence=0.0, embedding=emb_np[0], category='unknown')
        label_id = int(self._knn.predict(emb_np)[0])
        proba = self._knn.predict_proba(emb_np)[0]
        cat = CATEGORY_LABELS[label_id] if 0 <= label_id < len(CATEGORY_LABELS) else 'unknown'
        return Prediction(label=cat, confidence=float(proba.max()), embedding=emb_np[0], category=cat)

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
