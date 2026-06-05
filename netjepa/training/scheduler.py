from __future__ import annotations


def ema_momentum(epoch: int, start: float = 0.99, end: float = 0.999,
                 warmup_epochs: int = 100) -> float:
    if epoch >= warmup_epochs:
        return end
    return start + (end - start) * epoch / warmup_epochs
