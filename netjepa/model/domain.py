"""Domain-adversarial components for unsupervised domain adaptation (DANN,
Ganin & Lempitsky 2015).

A gradient-reversal layer between the encoder embedding and a domain
discriminator makes the encoder learn *domain-invariant* features: the
discriminator is trained to tell source (Kaggle) from target (VLC) embeddings,
while the reversal flips the encoder's gradient so it learns to *confuse* the
discriminator. Combined with supervised category SupCon on the source, this
pulls the unlabeled target distribution into the source's class structure —
improving cross-dataset transfer.
"""
from __future__ import annotations
import torch
import torch.nn as nn


class _GradReverse(torch.autograd.Function):
    @staticmethod
    def forward(ctx, x: torch.Tensor, lambd: float) -> torch.Tensor:
        ctx.lambd = lambd
        return x.view_as(x)

    @staticmethod
    def backward(ctx, grad_output):
        return grad_output.neg() * ctx.lambd, None


def grad_reverse(x: torch.Tensor, lambd: float = 1.0) -> torch.Tensor:
    """Identity forward; gradient is negated and scaled by `lambd` on the way back."""
    return _GradReverse.apply(x, lambd)


class DomainDiscriminator(nn.Module):
    """Binary domain classifier on the embedding (source=0 / target=1)."""

    def __init__(self, in_dim: int = 128, hidden: int = 256, dropout: float = 0.3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)  # (B,) logits


def dann_lambda(progress: float, gamma: float = 10.0) -> float:
    """DANN's standard schedule: ramp the reversal strength 0 → 1 over training
    so the discriminator stabilises before it dominates the encoder."""
    return 2.0 / (1.0 + torch.exp(torch.tensor(-gamma * progress)).item()) - 1.0
