from __future__ import annotations
import math
import torch
import torch.nn as nn


def sinusoidal_pe(seq_len: int, d_model: int, device=None) -> torch.Tensor:
    pe = torch.zeros(seq_len, d_model, device=device)
    pos = torch.arange(seq_len, dtype=torch.float, device=device).unsqueeze(1)
    div = torch.exp(torch.arange(0, d_model, 2, dtype=torch.float, device=device)
                    * (-math.log(10000.0) / d_model))
    pe[:, 0::2] = torch.sin(pos * div)
    pe[:, 1::2] = torch.cos(pos * div)[:, :pe[:, 1::2].shape[1]]
    return pe  # (seq_len, d_model)


class TemporalEncoder(nn.Module):
    def __init__(self, in_dim: int = 9, d_model: int = 128,
                 n_heads: int = 4, n_layers: int = 4,
                 dim_ff: int = 256, dropout: float = 0.1):
        super().__init__()
        self.d_model  = d_model
        self.proj     = nn.Linear(in_dim, d_model)
        enc_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads,
            dim_feedforward=dim_ff, dropout=dropout,
            batch_first=True, norm_first=True)
        self.transformer = nn.TransformerEncoder(enc_layer, num_layers=n_layers)

    def forward(self, x: torch.Tensor,
                padding_mask: torch.Tensor | None = None) -> torch.Tensor:
        # x: (B, 64, 9)   padding_mask: (B, 64) True=real, False=pad
        h = self.proj(x)  # (B, 64, 128)
        pe = sinusoidal_pe(h.size(1), self.d_model, device=h.device)
        h = h + pe.unsqueeze(0)

        kpm = None
        if padding_mask is not None:
            kpm = ~padding_mask  # PyTorch: True = ignore

        h = self.transformer(h, src_key_padding_mask=kpm)
        return h  # (B, 64, 128)


class ContextEncoder(nn.Module):
    def __init__(self, in_dim: int = 15, out_dim: int = 64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, 64),
            nn.LayerNorm(64),
            nn.LeakyReLU(0.1),
            nn.Linear(64, out_dim),
            nn.LayerNorm(out_dim),
            nn.LeakyReLU(0.1),
        )

    def forward(self, ctx: torch.Tensor) -> torch.Tensor:
        return self.net(ctx)  # (B, 64)
