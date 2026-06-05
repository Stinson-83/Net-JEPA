from __future__ import annotations
import torch
import torch.nn as nn


class DownstreamPoolingB(nn.Module):
    """Direction B: learnable query attends to all packet latents."""

    def __init__(self, d_model: int = 128, n_heads: int = 4):
        super().__init__()
        self.query = nn.Parameter(torch.randn(1, 1, d_model))
        self.attn  = nn.MultiheadAttention(
            embed_dim=d_model, num_heads=n_heads, batch_first=True)

    def forward(self, packet_latents: torch.Tensor) -> torch.Tensor:
        # packet_latents: (B, 64, 128)
        B = packet_latents.size(0)
        q = self.query.expand(B, -1, -1)      # (B, 1, 128)
        out, _ = self.attn(q, packet_latents, packet_latents)
        return out.squeeze(1)                  # (B, 128)
