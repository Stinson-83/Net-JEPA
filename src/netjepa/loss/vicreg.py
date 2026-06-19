from __future__ import annotations
import torch
import torch.nn.functional as F


def vicreg_loss(z_pred: torch.Tensor, z_target: torch.Tensor,
                alpha: float = 25.0, beta: float = 25.0,
                gamma: float = 1.0) -> tuple[torch.Tensor, dict]:
    B = z_pred.shape[0] * z_pred.shape[1]
    D = z_pred.shape[-1]

    z_pred   = z_pred.reshape(B, D)
    z_target = z_target.reshape(B, D)  # stop_grad already applied upstream

    # Invariance
    inv_loss = F.mse_loss(z_pred, z_target)

    # Variance (on z_pred only)
    z_pred_c = z_pred - z_pred.mean(dim=0)
    std      = torch.sqrt(z_pred_c.var(dim=0) + 1e-4)
    var_loss = torch.mean(F.relu(1.0 - std))

    # Covariance (on z_pred only)
    cov     = (z_pred_c.T @ z_pred_c) / (B - 1)
    eye     = torch.eye(D, dtype=torch.bool, device=cov.device)
    off_diag = cov.masked_fill(eye, 0.0)
    cov_loss = (off_diag ** 2).sum() / D

    total = alpha * inv_loss + beta * var_loss + gamma * cov_loss
    return total, {
        'invariance': inv_loss.item(),
        'variance':   var_loss.item(),
        'covariance': cov_loss.item(),
    }
