"""Phase 2b: Supervised contrastive fine-tuning to improve inter-class margin."""
from __future__ import annotations
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from tqdm import tqdm

from ..model.netjepa    import NetJEPA
from ..loss.supcon      import supcon_loss
from ..data.dataset     import FlowDataset
from ..training.phase1  import _set_seeds
from ..utils.io         import save_checkpoint, load_checkpoint
from ..utils.logging    import init_wandb, log_metrics


class _ProjHead(nn.Module):
    """Small projection head used only during Phase 2b; discarded afterwards."""
    def __init__(self, in_dim: int = 143, hidden: int = 256, out_dim: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.BatchNorm1d(hidden),
            nn.ReLU(),
            nn.Linear(hidden, out_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def train_phase2b(processed_dir: str,
                  ckpt_dir: str = 'checkpoints/phase2b',
                  phase2_ckpt: str | None = None,
                  epochs: int = 30,
                  batch_size: int = 128,
                  lr_encoder: float = 1e-5,
                  lr_head: float = 1e-3,
                  weight_decay: float = 1e-4,
                  temperature: float = 0.07,
                  embedding_dim: int = 143,
                  device_str: str = 'cuda',
                  use_wandb: bool = False,
                  **model_kwargs) -> None:
    _set_seeds()
    device = torch.device(device_str if torch.cuda.is_available() else 'cpu')
    Path(ckpt_dir).mkdir(parents=True, exist_ok=True)

    if use_wandb:
        init_wandb('netjepa-phase2b')

    model = NetJEPA(**model_kwargs).to(device)
    if phase2_ckpt:
        load_checkpoint(model, None, phase2_ckpt, device)

    proj = _ProjHead(in_dim=embedding_dim).to(device)

    # Encoder gets a very small LR to nudge representations without destroying them
    optimizer = optim.AdamW([
        {'params': model.temporal_encoder.parameters(), 'lr': lr_encoder},
        {'params': model.context_encoder.parameters(),  'lr': lr_encoder},
        {'params': model.fusion_a.parameters(),         'lr': lr_encoder},
        {'params': model.pooling_b.parameters(),        'lr': lr_encoder},
        {'params': proj.parameters(),                   'lr': lr_head},
    ], weight_decay=weight_decay)

    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    ds = FlowDataset(str(Path(processed_dir) / 'downstream_train.parquet'))
    loader = DataLoader(ds, batch_size=batch_size, shuffle=True,
                        num_workers=2, pin_memory=True, drop_last=True)

    for epoch in range(epochs):
        model.train()
        proj.train()
        total_loss = 0.0

        for batch in tqdm(loader, desc=f'Phase2b epoch {epoch:03d}', leave=False):
            pkt  = batch['packet_seq'].to(device)
            ctx  = batch['flow_ctx'].to(device)
            msk  = batch['padding_mask'].to(device)
            lbl  = batch['app_label'].to(device)

            emb = model.forward_downstream(pkt, ctx, msk)   # (B, 143)
            z   = proj(emb)                                   # (B, 128)
            loss = supcon_loss(z, lbl, temperature=temperature)

            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(
                list(model.parameters()) + list(proj.parameters()), 1.0)
            optimizer.step()
            total_loss += loss.item()

        scheduler.step()
        avg = total_loss / len(loader)
        print(f'[Phase2b {epoch:03d}] loss={avg:.4f}')
        if use_wandb:
            log_metrics({'phase2b/loss': avg}, step=epoch)

    # Save encoder only (projection head is discarded)
    save_checkpoint(model, optimizer, epoch, {}, Path(ckpt_dir) / 'final.pt')
    print(f'Checkpoint saved → {Path(ckpt_dir) / "final.pt"}')
