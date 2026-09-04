"""Phase 1: Self-supervised pretraining."""
from __future__ import annotations
import random
from pathlib import Path

import numpy as np
import torch
import torch.optim as optim
from torch.utils.data import DataLoader
from tqdm import tqdm

from ..model.netjepa import NetJEPA
from ..loss.vicreg import vicreg_loss
from ..loss.contrastive import (generate_pseudo_labels,
                                 dbscan_contrastive_loss)
from ..loss.composite import CompositeLoss
from ..data.dataset import FlowDataset
from ..training.scheduler import ema_momentum
from ..utils.io import save_checkpoint
from ..utils.logging import init_wandb, log_metrics, get_logger

_log = get_logger('training.phase1')


def _set_seeds(seed: int = 42) -> None:
    import os
    seed = int(os.environ.get('NETJEPA_SEED', seed))   # reproducibility override for seed sweeps
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


def _masked_mean(h: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Mean-pool encoder tokens over valid (non-pad) positions. mask: True=real."""
    w = mask.float().unsqueeze(-1)               # (B, T, 1)
    return (h * w).sum(dim=1) / w.sum(dim=1).clamp(min=1.0)


@torch.no_grad()
def _extract_embeddings_subset(model: NetJEPA, dataset: FlowDataset,
                                frac: float, device: torch.device,
                                batch_size: int = 256
                                ) -> tuple[np.ndarray, list[int]]:
    """Embed a random `frac` of the dataset. Returns ``(embeddings, idxs)``
    where ``idxs[k]`` is the dataset index of ``embeddings[k]`` — the caller
    needs this correspondence to key DBSCAN pseudo-labels by true flow index."""
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
    return np.vstack(embs), idxs


def train_phase1(processed_dir: str, ckpt_dir: str = 'checkpoints/phase1',
                 epochs: int = 150, batch_size: int = 128,
                 lr: float = 1e-3, weight_decay: float = 1e-4,
                 device_str: str = 'cuda',
                 vicreg_alpha: float = 25.0, vicreg_beta: float = 25.0,
                 vicreg_gamma: float = 1.0,
                 align_weight: float = 0.0,
                 lambda1: float = 1.0, lambda2: float = 0.3,
                 dbscan_eps: float = 0.05, dbscan_min_samples: int = 5,
                 dbscan_refresh: int = 10, dbscan_start: int = 20,
                 dbscan_subsample: float = 1.0,
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

    pseudo_global: dict[int, int] = {}
    pseudo_valid  = False

    for epoch in range(epochs):
        mom = ema_momentum(epoch)

        # Refresh DBSCAN pseudo labels — keyed by *true dataset index* so each
        # batch can look its flows up by batch['flow_idx'] (the previous
        # batch-position keying paired labels with the wrong flows).
        if epoch >= dbscan_start and (epoch - dbscan_start) % dbscan_refresh == 0:
            embs, sub_idxs = _extract_embeddings_subset(model, dataset, dbscan_subsample, device)
            pls = generate_pseudo_labels(embs, dbscan_min_samples, dbscan_eps)
            pseudo_global = {sub_idxs[i]: int(pls[i]) for i in range(len(pls))}
            n_clusters = len({l for l in pls if l >= 0})
            n_noise    = int((pls < 0).sum())
            # A single cluster has no negatives — the contrastive loss would just
            # pull everything together (worsening collapse). Skip it until DBSCAN
            # finds real structure; if this keeps logging 1 cluster, lower dbscan_eps.
            pseudo_valid = n_clusters >= 2
            _log.info('[%03d] DBSCAN: %d flows → %d clusters, %d noise (contrastive %s)',
                      epoch, len(pls), n_clusters, n_noise,
                      'ON' if pseudo_valid else 'OFF — need ≥2 clusters')

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

            # ── TWEAK: pooled-encoder alignment term ──
            # Pretrain the exact path the classifier uses (temporal_encoder -> pool):
            # VICReg invariance between the masked/degraded online view and the clean
            # EMA-target view of the mean-pooled encoder output. Off when align_weight=0.
            align_loss = None
            if align_weight > 0.0:
                enc_on = model.temporal_encoder(deg_pkt, deg_msk)
                with torch.no_grad():
                    enc_tg = model.target_temporal(cln_pkt, cln_msk)
                pooled_on = _masked_mean(enc_on, deg_msk).unsqueeze(1)            # (B,1,D)
                pooled_tg = _masked_mean(enc_tg, cln_msk).unsqueeze(1).detach()
                align_loss, _ = vicreg_loss(pooled_on, pooled_tg,
                                            alpha=vicreg_alpha, beta=vicreg_beta,
                                            gamma=vicreg_gamma)

            use_contrast = pseudo_valid and epoch >= dbscan_start
            contrast_val = None
            if use_contrast:
                with torch.no_grad():
                    flow_embs = model.forward_downstream(cln_pkt, cln_ctx, cln_msk)
                # Look each flow's cluster up by its true dataset index; flows
                # not in the clustered subset (or DBSCAN noise) get -1 and are
                # ignored by the contrastive loss.
                batch_pl = torch.tensor(
                    [pseudo_global.get(int(fi), -1) for fi in batch['flow_idx']],
                    dtype=torch.long, device=device)
                contrast_val = dbscan_contrastive_loss(flow_embs, batch_pl)

            total = composite(vic_loss, contrast_val, use_contrast)
            if align_loss is not None:
                total = total + align_weight * align_loss
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

        _log.info('[%03d] loss=%.4f inv=%.4f var=%.4f cov=%.4f mom=%.4f lr=%.2e',
                  epoch, avg_loss,
                  epoch_metrics.get('invariance', 0), epoch_metrics.get('variance', 0),
                  epoch_metrics.get('covariance', 0), mom, epoch_metrics['lr'])

        if use_wandb:
            log_metrics(epoch_metrics, step=epoch)

        if (epoch + 1) % 25 == 0:
            save_checkpoint(model, opt, epoch, epoch_metrics,
                            Path(ckpt_dir) / f'epoch_{epoch}.pt')

    save_checkpoint(model, opt, epochs - 1, epoch_metrics,
                    Path(ckpt_dir) / 'final.pt')
    return model
