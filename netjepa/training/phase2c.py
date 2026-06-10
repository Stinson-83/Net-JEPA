"""Phase 2c: Domain-adversarial fine-tuning (DANN) for cross-domain transfer.

Continues category SupCon on the labelled SOURCE (Kaggle) while a
gradient-reversal domain discriminator aligns the unlabelled TARGET (VLC)
distribution to it — improving Kaggle→VLC transfer without VLC labels.
Initialise from the source Phase 2b encoder.
"""
from __future__ import annotations
from itertools import cycle
from pathlib import Path

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from tqdm import tqdm

from ..model.netjepa    import NetJEPA
from ..model.domain     import DomainDiscriminator, grad_reverse, dann_lambda
from ..loss.supcon      import supcon_loss
from ..data.dataset     import FlowDataset, make_balanced_sampler
from ..training.phase1  import _set_seeds
from ..training.phase2b import LABEL_KEY
from ..utils.io         import save_checkpoint, load_checkpoint
from ..utils.logging    import init_wandb, log_metrics, get_logger

_log = get_logger('training.phase2c')


def train_phase2c(processed_dir: str,
                  target_parquet: str,
                  init_ckpt: str,
                  ckpt_dir: str = 'checkpoints/phase2c',
                  epochs: int = 60,
                  batch_size: int = 128,
                  lr_encoder: float = 1e-4,
                  lr_head: float = 1e-3,
                  lr_disc: float = 1e-3,
                  weight_decay: float = 1e-4,
                  temperature: float = 0.05,
                  lambda_domain: float = 1.0,
                  embedding_dim: int = 128,
                  center_alpha: float = 0.65,
                  device_str: str = 'cuda',
                  use_wandb: bool = False,
                  **model_kwargs) -> None:
    _set_seeds()
    device = torch.device(device_str if torch.cuda.is_available() else 'cpu')
    Path(ckpt_dir).mkdir(parents=True, exist_ok=True)
    if use_wandb:
        init_wandb('netjepa-phase2c')

    model = NetJEPA(embed_dim=embedding_dim, **model_kwargs).to(device)
    load_checkpoint(model, None, init_ckpt, device, strict=False)
    model.center_alpha.fill_(0.0)   # train uncentered; re-bake centering at the end
    disc = DomainDiscriminator(in_dim=embedding_dim).to(device)

    enc_params = (list(model.temporal_encoder.parameters())
                  + list(model.context_encoder.parameters())
                  + list(model.fusion_a.parameters())
                  + list(model.pooling_b.parameters()))
    optimizer = optim.AdamW([
        {'params': enc_params,                    'lr': lr_encoder},
        {'params': model.embed_head.parameters(), 'lr': lr_head},
        {'params': disc.parameters(),             'lr': lr_disc},
    ], weight_decay=weight_decay)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    bce = nn.BCEWithLogitsLoss()

    src_ds = FlowDataset(str(Path(processed_dir) / 'downstream_train.parquet'))
    tgt_ds = FlowDataset(target_parquet)
    src_loader = DataLoader(src_ds, batch_size=batch_size,
                            sampler=make_balanced_sampler(src_ds.df[LABEL_KEY].to_numpy()),
                            num_workers=2, pin_memory=True, drop_last=True)
    tgt_loader = DataLoader(tgt_ds, batch_size=batch_size, shuffle=True,
                            num_workers=2, pin_memory=True, drop_last=True)
    _log.info('DANN: source=%d (Kaggle, labelled) | target=%d (VLC, unlabelled)',
              len(src_ds), len(tgt_ds))

    def _emb(batch):
        return model.forward_downstream(batch['packet_seq'].to(device),
                                        batch['flow_ctx'].to(device),
                                        batch['padding_mask'].to(device))

    for epoch in range(epochs):
        lambd = lambda_domain * dann_lambda(epoch / max(epochs - 1, 1))
        model.train(); disc.train()
        tot_sup = tot_dom = dom_acc = 0.0
        n = 0
        tgt_iter = cycle(tgt_loader)
        for src_batch in tqdm(src_loader, desc=f'Phase2c epoch {epoch:03d}', leave=False):
            tgt_batch = next(tgt_iter)
            emb_s = _emb(src_batch)
            emb_t = _emb(tgt_batch)

            sup = supcon_loss(emb_s, src_batch[LABEL_KEY].to(device), temperature=temperature)

            d_in = grad_reverse(torch.cat([emb_s, emb_t], dim=0), lambd)
            d_logits = disc(d_in)
            d_lbl = torch.cat([torch.zeros(emb_s.size(0)), torch.ones(emb_t.size(0))]).to(device)
            dom = bce(d_logits, d_lbl)

            loss = sup + dom
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(list(model.parameters()) + list(disc.parameters()), 1.0)
            optimizer.step()

            tot_sup += sup.item(); tot_dom += dom.item()
            dom_acc += ((d_logits > 0).float() == d_lbl).float().mean().item()
            n += 1

        scheduler.step()
        _log.info('[%03d] supcon=%.4f domain=%.4f disc_acc=%.3f lambda=%.3f',
                  epoch, tot_sup / n, tot_dom / n, dom_acc / n, lambd)
        if use_wandb:
            log_metrics({'phase2c/supcon': tot_sup / n, 'phase2c/domain': tot_dom / n}, step=epoch)

    # Re-bake centering over the (source) training set.
    model.eval()
    means = []
    with torch.no_grad():
        for batch in DataLoader(src_ds, batch_size=256, shuffle=False, num_workers=2):
            means.append(_emb(batch).cpu())
    model.set_centering(torch.cat(means).mean(dim=0), center_alpha)
    _log.info('centering re-enabled (alpha=%.2f)', center_alpha)

    save_checkpoint(model, optimizer, epochs - 1, {}, Path(ckpt_dir) / 'final.pt')
    _log.info('Checkpoint saved → %s', Path(ckpt_dir) / 'final.pt')
