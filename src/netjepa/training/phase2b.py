"""Phase 2b: Supervised contrastive fine-tuning to improve inter-class margin."""
from __future__ import annotations
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from tqdm import tqdm

from ..model.netjepa import NetJEPA
from ..loss.supcon import supcon_loss
from ..data.dataset import FlowDataset, make_balanced_sampler
from ..training.phase1 import _set_seeds
from ..utils.io import save_checkpoint, load_checkpoint
from ..utils.logging import init_wandb, log_metrics, get_logger

_log = get_logger('training.phase2b')

# The cosine-similarity KPI is defined at the CATEGORY level ("Youtube and
# Netflix" — different apps, same category `stored_streaming` — are intra-class).
# So SupCon is supervised on category_label; app-level would push Youtube and
# Netflix apart, fighting the > 0.7 intra-class target.
LABEL_KEY = 'category_label'


def train_phase2b(processed_dir: str,
                  ckpt_dir: str = 'checkpoints/phase2b',
                  init_ckpt: str | None = None,
                  epochs: int = 30,
                  batch_size: int = 128,
                  lr_encoder: float = 1e-4,
                  lr_head: float = 1e-3,
                  weight_decay: float = 1e-4,
                  temperature: float = 0.07,
                  embedding_dim: int = 128,
                  center_alpha: float = 0.65,
                  balanced: bool = True,
                  device_str: str = 'cuda',
                  use_wandb: bool = False,
                  **model_kwargs) -> None:
    _set_seeds()
    device = torch.device(device_str if torch.cuda.is_available() else 'cpu')
    Path(ckpt_dir).mkdir(parents=True, exist_ok=True)

    if use_wandb:
        init_wandb('netjepa-phase2b')

    model = NetJEPA(embed_dim=embedding_dim, **model_kwargs).to(device)
    if init_ckpt:
        # strict=False: the Phase 1 checkpoint predates embed_head, which is
        # trained fresh here.
        load_checkpoint(model, None, init_ckpt, device, strict=False)

    # SupCon is applied directly on the kept, L2-normalised embedding (model's
    # embed_head) — that's the space the cosine KPI measures, so we separate
    # classes there rather than in a throwaway projection head. embed_head gets
    # the head LR; the pretrained encoder a smaller LR so it's nudged, not wrecked.
    optimizer = optim.AdamW([
        {'params': model.temporal_encoder.parameters(), 'lr': lr_encoder},
        {'params': model.context_encoder.parameters(),  'lr': lr_encoder},
        {'params': model.fusion_a.parameters(),         'lr': lr_encoder},
        {'params': model.pooling_b.parameters(),        'lr': lr_encoder},
        {'params': model.embed_head.parameters(),       'lr': lr_head},
    ], weight_decay=weight_decay)

    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    ds = FlowDataset(str(Path(processed_dir) / 'downstream_train.parquet'))
    if balanced:
        sampler = make_balanced_sampler(ds.df[LABEL_KEY].to_numpy())
        loader = DataLoader(ds, batch_size=batch_size, sampler=sampler,
                            num_workers=2, pin_memory=True, drop_last=True)
        _log.info('class-balanced SupCon over %d categories (encoder lr=%.0e, head lr=%.0e)',
                  ds.df[LABEL_KEY].nunique(), lr_encoder, lr_head)
    else:
        loader = DataLoader(ds, batch_size=batch_size, shuffle=True,
                            num_workers=2, pin_memory=True, drop_last=True)

    for epoch in range(epochs):
        model.train()
        total_loss = 0.0

        for batch in tqdm(loader, desc=f'Phase2b epoch {epoch:03d}', leave=False):
            pkt  = batch['packet_seq'].to(device)
            ctx  = batch['flow_ctx'].to(device)
            msk  = batch['padding_mask'].to(device)
            lbl  = batch[LABEL_KEY].to(device)

            z = model.forward_downstream(pkt, ctx, msk)   # (B, embed_dim), normalised
            loss = supcon_loss(z, lbl, temperature=temperature)

            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total_loss += loss.item()

        scheduler.step()
        avg = total_loss / len(loader)
        _log.info('[%03d] loss=%.4f', epoch, avg)
        if use_wandb:
            log_metrics({'phase2b/loss': avg}, step=epoch)

    # Bake common-mode removal into the model: compute the mean embedding over
    # the training set (centering still off → uncentered) and enable α-centering
    # so the cosine KPI (intra>0.7 / inter<0.3) holds at inference.
    model.eval()
    means = []
    with torch.no_grad():
        for batch in DataLoader(ds, batch_size=256, shuffle=False, num_workers=2):
            e = model.forward_downstream(batch['packet_seq'].to(device),
                                         batch['flow_ctx'].to(device),
                                         batch['padding_mask'].to(device))
            means.append(e.cpu())
    model.set_centering(torch.cat(means).mean(dim=0), center_alpha)
    _log.info('centering enabled (alpha=%.2f) over %d train embeddings', center_alpha, len(ds))

    save_checkpoint(model, optimizer, epoch, {}, Path(ckpt_dir) / 'final.pt')
    _log.info('Checkpoint saved → %s', Path(ckpt_dir) / 'final.pt')
