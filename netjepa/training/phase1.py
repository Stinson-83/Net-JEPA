"""Phase 1: Self-supervised pretraining."""
from __future__ import annotations
import random
import os
from pathlib import Path

import numpy as np
import torch
import torch.optim as optim
from torch.utils.data import DataLoader
from tqdm import tqdm

from ..model.netjepa    import NetJEPA
from ..model.encoders   import sinusoidal_pe
from ..loss.vicreg      import vicreg_loss
from ..loss.contrastive import (generate_pseudo_labels,
                                 dbscan_contrastive_loss)
from ..loss.composite   import CompositeLoss
from ..data.dataset     import FlowDataset
from ..training.scheduler import ema_momentum
from ..utils.io         import save_checkpoint
from ..utils.logging    import init_wandb, log_metrics


def _set_seeds(seed: int = 42) -> None:
    torch.manual_seed(seed)
    np.random.seed(seed)
    random.seed(seed)


def _adaptive_mask(true_len: int, short_thresh: int = 30,
                   short_ratio: float = 0.30,
                   normal_ratio: float = 0.50) -> tuple[list[int], list[int]]:
    ratio    = short_ratio if true_len < short_thresh else normal_ratio
    n_masked = max(1, int(true_len * ratio))
    start    = random.randint(0, true_len - n_masked)
    masked   = list(range(start, start + n_masked))
    visible  = [i for i in range(true_len) if i not in set(masked)]
    return visible, masked


@torch.no_grad()
def _extract_embeddings_subset(model: NetJEPA, dataset: FlowDataset,
                                frac: float, device: torch.device,
                                batch_size: int = 256) -> np.ndarray:
    n      = max(1, int(len(dataset) * frac))
    idxs   = random.sample(range(len(dataset)), n)
    embs   = []
    model.eval()
    for i in range(0, len(idxs), batch_size):
        batch_idxs = idxs[i: i + batch_size]
        samples    = [dataset[j] for j in batch_idxs]
        pkt = torch.stack([s['clean_packet_seq'] for s in samples]).to(device)
        ctx = torch.stack([s['clean_flow_ctx']   for s in samples]).to(device)
        msk = torch.stack([s['clean_padding_mask']for s in samples]).to(device)
        emb = model.forward_downstream(pkt, ctx, msk)
        embs.append(emb.cpu().numpy())
    model.train()
    return np.vstack(embs)


def train_phase1(processed_dir: str, ckpt_dir: str = 'checkpoints/phase1',
                 epochs: int = 150, batch_size: int = 128,
                 lr: float = 1e-3, weight_decay: float = 1e-4,
                 device_str: str = 'cuda',
                 vicreg_alpha: float = 25.0, vicreg_beta: float = 25.0,
                 vicreg_gamma: float = 1.0,
                 lambda1: float = 1.0, lambda2: float = 0.3,
                 dbscan_eps: float = 0.5, dbscan_min_samples: int = 5,
                 dbscan_refresh: int = 10, dbscan_start: int = 20,
                 dbscan_subsample: float = 0.02,
                 use_wandb: bool = False,
                 aug_kwargs: dict | None = None,
                 **model_kwargs) -> NetJEPA:
    _set_seeds()
    device = torch.device(device_str if torch.cuda.is_available() else 'cpu')
    Path(ckpt_dir).mkdir(parents=True, exist_ok=True)

    if use_wandb:
        init_wandb('netjepa-phase1')

    dataset = FlowDataset(
        str(Path(processed_dir) / 'pretrain.parquet'),
        augment=True, aug_kwargs=aug_kwargs or {})
    loader = DataLoader(dataset, batch_size=batch_size,
                        shuffle=True, drop_last=True, num_workers=2,
                        pin_memory=True)

    model = NetJEPA(**model_kwargs).to(device)
    opt   = optim.AdamW(
        [p for n, p in model.named_parameters() if 'target' not in n],
        lr=lr, weight_decay=weight_decay)
    sched = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs, eta_min=1e-5)

    composite = CompositeLoss(lambda1=lambda1, lambda2=lambda2)

    pseudo_labels: dict[int, int] = {}
    pseudo_valid   = False

    for epoch in range(epochs):
        mom = ema_momentum(epoch)

        # Refresh DBSCAN pseudo labels
        if epoch >= dbscan_start and (epoch - dbscan_start) % dbscan_refresh == 0:
            embs = _extract_embeddings_subset(model, dataset, dbscan_subsample, device)
            pls  = generate_pseudo_labels(embs, dbscan_min_samples, dbscan_eps)
            # Re-map to global dataset subsample indices — approximate mapping
            # by storing labels indexed 0..len(embs)-1 directly
            pseudo_global = {i: int(pls[i]) for i in range(len(pls))}
            pseudo_valid  = True

        epoch_metrics: dict[str, float] = {}
        total_loss_accum = 0.0
        n_batches = 0

        model.train()
        for batch in tqdm(loader, desc=f'Phase1 epoch {epoch}', leave=False):
            deg_pkt = batch['deg_packet_seq'].to(device)
            cln_pkt = batch['clean_packet_seq'].to(device)
            cln_ctx = batch['clean_flow_ctx'].to(device)
            cln_msk = batch['clean_padding_mask'].to(device)
            deg_msk = batch['deg_padding_mask'].to(device)

            # Adaptive masking — one mask for whole batch
            true_len = int(cln_msk[0].sum().item())
            true_len = max(true_len, 2)
            visible_idx, masked_idx = _adaptive_mask(true_len)

            # Online forward
            fused = model.forward_online(deg_pkt, cln_ctx, deg_msk)
            vis_latents = fused[:, visible_idx, :]

            # Predictor
            pred_latents = model.predictor(vis_latents, masked_idx)

            # Target forward (no grad)
            with torch.no_grad():
                target_fused = model.forward_target(cln_pkt, cln_ctx, cln_msk)
                tgt_latents  = target_fused[:, masked_idx, :].detach()

            vic_loss, vic_metrics = vicreg_loss(
                pred_latents, tgt_latents,
                alpha=vicreg_alpha, beta=vicreg_beta, gamma=vicreg_gamma)
            epoch_metrics.update(vic_metrics)

            use_contrast = pseudo_valid and epoch >= dbscan_start
            contrast_val = None
            if use_contrast:
                with torch.no_grad():
                    flow_embs = model.forward_downstream(cln_pkt, cln_ctx, cln_msk)
                # Use in-batch pseudo labels from cached dict (approximate)
                batch_pl = torch.full((flow_embs.size(0),), -1,
                                      dtype=torch.long, device=device)
                if pseudo_valid:
                    # Assign labels by position within subsample — approximate
                    for bi in range(min(flow_embs.size(0), len(pseudo_global))):
                        batch_pl[bi] = pseudo_global.get(bi, -1)
                contrast_val = dbscan_contrastive_loss(
                    flow_embs, batch_pl)

            total = composite(vic_loss, contrast_val, use_contrast)
            opt.zero_grad()
            total.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            model.update_target(mom)

            total_loss_accum += total.item()
            n_batches += 1

        sched.step()
        avg_loss = total_loss_accum / max(n_batches, 1)
        epoch_metrics['total_loss'] = avg_loss
        epoch_metrics['ema_momentum'] = mom
        epoch_metrics['lr'] = sched.get_last_lr()[0]

        print(f'[Phase1 {epoch:03d}] loss={avg_loss:.4f} '
              f'inv={epoch_metrics.get("invariance",0):.4f} '
              f'var={epoch_metrics.get("variance",0):.4f} '
              f'mom={mom:.4f}')

        if use_wandb:
            log_metrics(epoch_metrics, step=epoch)

        if (epoch + 1) % 25 == 0:
            save_checkpoint(model, opt, epoch, epoch_metrics,
                            Path(ckpt_dir) / f'epoch_{epoch}.pt')

    save_checkpoint(model, opt, epochs - 1, epoch_metrics,
                    Path(ckpt_dir) / 'final.pt')
    return model
