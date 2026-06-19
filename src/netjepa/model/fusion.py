from __future__ import annotations
import torch
import torch.nn as nn


class CrossAttentionFusionA(nn.Module):
    """Direction A: packet tokens (Q) attend to context (K/V)."""

    def __init__(self, d_model: int = 128, ctx_dim: int = 64,
                 n_heads: int = 4):
        super().__init__()
        self.ctx_proj = nn.Linear(ctx_dim, d_model)
        self.attn     = nn.MultiheadAttention(
            embed_dim=d_model, num_heads=n_heads,
            batch_first=True)

    def forward(self, packet_latents: torch.Tensor,
                context_vector: torch.Tensor) -> torch.Tensor:
        # packet_latents: (B, 64, 128)
        # context_vector: (B, 64)  — output of ContextEncoder
        ctx_exp = self.ctx_proj(context_vector).unsqueeze(1)  # (B, 1, 128)
        out, _  = self.attn(packet_latents, ctx_exp, ctx_exp)
        return out  # (B, 64, 128)
