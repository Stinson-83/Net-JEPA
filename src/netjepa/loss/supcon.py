"""Supervised Contrastive Loss (Khosla et al., 2020)."""
from __future__ import annotations
import torch
import torch.nn.functional as F


def supcon_loss(embeddings: torch.Tensor, labels: torch.Tensor,
                temperature: float = 0.07) -> torch.Tensor:
    """
    embeddings: (N, D) — L2-normalised before calling
    labels:     (N,)   — integer class IDs
    """
    device = embeddings.device
    N = embeddings.size(0)

    # L2 normalise
    z = F.normalize(embeddings, dim=1)

    # (N, N) similarity matrix scaled by temperature
    sim = torch.mm(z, z.T) / temperature

    # Mask: positive pairs share the same label (excluding self)
    labels = labels.view(-1, 1)
    pos_mask = (labels == labels.T).float().to(device)
    self_mask = torch.eye(N, dtype=torch.bool, device=device)
    pos_mask.masked_fill_(self_mask, 0.0)

    # Rows with no positives (singleton classes in batch) — skip
    has_pos = pos_mask.sum(dim=1) > 0

    # Log-sum-exp denominator: all pairs except self
    sim.masked_fill_(self_mask, -1e9)
    log_denom = torch.logsumexp(sim, dim=1)  # (N,)

    # Mean log-prob over positives per anchor
    log_num = (sim * pos_mask).sum(dim=1) / pos_mask.sum(dim=1).clamp(min=1)
    per_sample = -(log_num - log_denom)

    return per_sample[has_pos].mean()
