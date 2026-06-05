from __future__ import annotations
from pathlib import Path
import torch
import torch.nn as nn
import torch.optim as optim


def save_checkpoint(model: nn.Module,
                    optimizer: optim.Optimizer | None,
                    epoch: int,
                    metrics: dict,
                    path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'epoch':       epoch,
        'model_state': model.state_dict(),
        'metrics':     metrics,
    }
    if optimizer is not None:
        payload['optimizer_state'] = optimizer.state_dict()
    torch.save(payload, path)
    print(f'Checkpoint saved → {path}')


def load_checkpoint(model: nn.Module,
                    optimizer: optim.Optimizer | None,
                    path: str | Path,
                    device: torch.device | None = None) -> dict:
    path    = Path(path)
    payload = torch.load(path, map_location=device or 'cpu')
    model.load_state_dict(payload['model_state'])
    if optimizer is not None and 'optimizer_state' in payload:
        optimizer.load_state_dict(payload['optimizer_state'])
    print(f'Checkpoint loaded ← {path}  (epoch {payload.get("epoch", "?")})')
    return payload
