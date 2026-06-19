from __future__ import annotations
import copy
import torch
import torch.nn as nn


class EMAEncoder(nn.Module):
    def __init__(self, online_module: nn.Module):
        super().__init__()
        self.target = copy.deepcopy(online_module)
        self.target.requires_grad_(False)

    @torch.no_grad()
    def update(self, online_module: nn.Module, momentum: float) -> None:
        for tp, op in zip(self.target.parameters(),
                          online_module.parameters()):
            tp.data = momentum * tp.data + (1.0 - momentum) * op.data

    def forward(self, *args, **kwargs):
        return self.target(*args, **kwargs)
