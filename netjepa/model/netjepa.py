from __future__ import annotations
import torch
import torch.nn as nn

from .encoders  import TemporalEncoder, ContextEncoder
from .fusion    import CrossAttentionFusionA
from .predictor import MicroPredictor
from .ema       import EMAEncoder
from ..downstream.pooling import DownstreamPoolingB


class NetJEPA(nn.Module):
    def __init__(self, d_model: int = 128, ctx_dim: int = 64,
                 n_heads: int = 4, n_te_layers: int = 4,
                 n_pred_layers: int = 3, dim_ff: int = 256,
                 dropout: float = 0.1, packet_feat_dim: int = 9,
                 flow_ctx_dim: int = 15):
        super().__init__()
        self.flow_ctx_dim = flow_ctx_dim

        # ── Online components ────────────────────────────────────────────
        self.temporal_encoder = TemporalEncoder(
            in_dim=packet_feat_dim, d_model=d_model, n_heads=n_heads,
            n_layers=n_te_layers, dim_ff=dim_ff, dropout=dropout)
        self.context_encoder  = ContextEncoder(
            in_dim=flow_ctx_dim, out_dim=ctx_dim)
        self.fusion_a         = CrossAttentionFusionA(
            d_model=d_model, ctx_dim=ctx_dim, n_heads=n_heads)
        self.predictor        = MicroPredictor(
            d_model=d_model, n_heads=n_heads,
            n_layers=n_pred_layers, dim_ff=dim_ff, dropout=dropout)

        # ── Target (EMA, no grad) ────────────────────────────────────────
        self.target_temporal = EMAEncoder(self.temporal_encoder)
        self.target_context  = EMAEncoder(self.context_encoder)
        self.target_fusion_a = EMAEncoder(self.fusion_a)

        # ── Downstream ───────────────────────────────────────────────────
        self.pooling_b = DownstreamPoolingB(d_model=d_model, n_heads=n_heads)

    # ── Forward helpers ──────────────────────────────────────────────────

    def forward_online(self, packet_seq: torch.Tensor,
                       flow_ctx: torch.Tensor,
                       padding_mask: torch.Tensor) -> torch.Tensor:
        pkt_latents = self.temporal_encoder(packet_seq, padding_mask)
        ctx_latent  = self.context_encoder(flow_ctx)
        fused       = self.fusion_a(pkt_latents, ctx_latent)
        return fused  # (B, 64, 128)

    @torch.no_grad()
    def forward_target(self, packet_seq: torch.Tensor,
                        flow_ctx: torch.Tensor,
                        padding_mask: torch.Tensor) -> torch.Tensor:
        pkt_latents = self.target_temporal(packet_seq, padding_mask)
        ctx_latent  = self.target_context(flow_ctx)
        fused       = self.target_fusion_a(pkt_latents, ctx_latent)
        return fused  # (B, 64, 128)

    def forward_downstream(self, packet_seq: torch.Tensor,
                            flow_ctx: torch.Tensor,
                            padding_mask: torch.Tensor) -> torch.Tensor:
        pkt_latents = self.temporal_encoder(packet_seq, padding_mask)
        flow_vec    = self.pooling_b(pkt_latents)           # (B, 128)
        embedding   = torch.cat([flow_vec, flow_ctx], dim=-1)  # (B, 143)
        return embedding

    def update_target(self, momentum: float) -> None:
        self.target_temporal.update(self.temporal_encoder, momentum)
        self.target_context.update(self.context_encoder,   momentum)
        self.target_fusion_a.update(self.fusion_a,          momentum)
