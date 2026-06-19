from __future__ import annotations
from collections import deque
import torch


class CompositeLoss:
    def __init__(self, lambda1: float = 1.0, lambda2: float = 0.3,
                 window: int = 100):
        self.lambda1 = lambda1
        self.lambda2 = lambda2
        self.vicreg_history   = deque(maxlen=window)
        self.contrast_history = deque(maxlen=window)

    def _normalize(self, loss: torch.Tensor, history: deque) -> torch.Tensor:
        history.append(loss.item())
        running_mean = sum(history) / len(history)
        return loss / (running_mean + 1e-8)

    def __call__(self, vicreg_loss: torch.Tensor,
                 contrast_loss: torch.Tensor | None = None,
                 use_contrast: bool = False) -> torch.Tensor:
        norm_vicreg = self._normalize(vicreg_loss, self.vicreg_history)
        total       = self.lambda1 * norm_vicreg

        if use_contrast and contrast_loss is not None:
            norm_contrast = self._normalize(contrast_loss, self.contrast_history)
            total = total + self.lambda2 * norm_contrast

        return total
