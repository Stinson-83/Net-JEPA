from __future__ import annotations
import torch
import torch.nn as nn

from .encoders import sinusoidal_pe


class MicroPredictor(nn.Module):
    def __init__(self, d_model: int = 128, n_heads: int = 4,
                 n_layers: int = 3, dim_ff: int = 256, dropout: float = 0.1):
        super().__init__()
        self.d_model = d_model
        enc_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads,
            dim_feedforward=dim_ff, dropout=dropout,
            batch_first=True, norm_first=True)
        self.transformer = nn.TransformerEncoder(enc_layer, num_layers=n_layers)

    def forward(self, visible_latents: torch.Tensor,
                masked_indices: list[int]) -> torch.Tensor:
        # visible_latents: (B, n_visible, 128)
        # masked_indices: list of ints (global positions of masked tokens)
        n_masked = len(masked_indices)
        device   = visible_latents.device
        B        = visible_latents.size(0)

        mask_pe  = sinusoidal_pe(max(masked_indices) + 1, self.d_model, device)
        mask_pe  = mask_pe[masked_indices]            # (n_masked, 128)
        mask_tok = mask_pe.unsqueeze(0).expand(B, -1, -1)  # (B, n_masked, 128)

        combined = torch.cat([visible_latents, mask_tok], dim=1)
        out      = self.transformer(combined)
        return out[:, -n_masked:, :]  # (B, n_masked, 128)
