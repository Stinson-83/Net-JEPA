"""Phase 2: Embedding refinement with frozen EMA target."""
from __future__ import annotations
from pathlib import Path

import torch
import torch.optim as optim
from torch.utils.data import DataLoader
from tqdm import tqdm

from ..model.netjepa    import NetJEPA
from ..loss.vicreg      import vicreg_loss
from ..loss.contrastive import generate_pseudo_labels, dbscan_contrastive_loss
from ..loss.composite   import CompositeLoss
from ..data.dataset     import FlowDataset
from ..training.phase1  import _set_seeds, _adaptive_mask, _extract_embeddings_subset
from ..utils.io         import save_checkpoint, load_checkpoint
from ..utils.logging    import init_wandb, log_metrics, get_logger

_log = get_logger('training.phase2')


def train_phase2(processed_dir: str, ckpt_dir: str = 'checkpoints/phase2',
                 phase1_ckpt: str | None = None,
                 epochs: int = 50, batch_size: int = 128,
                 lr: float = 5e-4, weight_decay: float = 1e-4,
                 device_str: str = 'cuda',
                 vicreg_alpha: float = 25.0, vicreg_beta: float = 25.0,
                 vicreg_gamma: float = 1.0,
                 lambda1: float = 1.0, lambda2: float = 0.3,
                 dbscan_eps: float = 0.05, dbscan_min_samples: int = 5,
                 dbscan_refresh: int = 5, dbscan_subsample: float = 1.0,
                 use_wandb: bool = False,
                 aug_kwargs: dict | None = None,
                 **model_kwargs) -> NetJEPA:
    _set_seeds()
    device = torch.device(device_str if torch.cuda.is_available() else 'cpu')
    Path(ckpt_dir).mkdir(parents=True, exist_ok=True)

    if use_wandb:
        init_wandb('netjepa-phase2')

    model = NetJEPA(**model_kwargs).to(device)
    if phase1_ckpt:
        load_checkpoint(model, None, phase1_ckpt, device)

    # Freeze target encoder entirely
    for p in model.target_temporal.parameters():
        p.requires_grad_(False)
    for p in model.target_context.parameters():
        p.requires_grad_(False)
    for p in model.target_fusion_a.parameters():
        p.requires_grad_(False)

    dataset = FlowDataset(
        str(Path(processed_dir) / 'pretrain.parquet'),
        augment=True, aug_kwargs=aug_kwargs or {})
    loader = DataLoader(dataset, batch_size=batch_size,
                        shuffle=True, drop_last=True, num_workers=2,
                        pin_memory=True)

    online_params = [
        p for n, p in model.named_parameters()
        if 'target' not in n and p.requires_grad]
    opt   = optim.AdamW(online_params, lr=lr, weight_decay=weight_decay)
    sched = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs, eta_min=1e-5)
    composite = CompositeLoss(lambda1=lambda1, lambda2=lambda2)

    pseudo_global: dict[int, int] = {}
    pseudo_valid = False

    for epoch in range(epochs):
        # Refresh DBSCAN pseudo labels — keyed by true dataset index (see phase1).
        if epoch % dbscan_refresh == 0:
            embs, sub_idxs = _extract_embeddings_subset(model, dataset, dbscan_subsample, device)
            pls = generate_pseudo_labels(embs, dbscan_min_samples, dbscan_eps)
            pseudo_global = {sub_idxs[i]: int(pls[i]) for i in range(len(pls))}
            n_clusters = len({l for l in pls if l >= 0})
            # Skip the contrastive term on a degenerate single-cluster labelling
            # (see phase1); lower dbscan_eps if this keeps logging 1 cluster.
            pseudo_valid = n_clusters >= 2
            _log.info('[%03d] DBSCAN: %d flows → %d clusters, %d noise (contrastive %s)',
                      epoch, len(pls), n_clusters, int((pls < 0).sum()),
                      'ON' if pseudo_valid else 'OFF')

        model.train()
        total_loss_accum = 0.0
        n_batches = 0
        epoch_metrics: dict[str, float] = {}

        for batch in tqdm(loader, desc=f'Phase2 epoch {epoch}', leave=False):
            deg_pkt = batch['deg_packet_seq'].to(device)
            cln_pkt = batch['clean_packet_seq'].to(device)
            cln_ctx = batch['clean_flow_ctx'].to(device)
            cln_msk = batch['clean_padding_mask'].to(device)
            deg_msk = batch['deg_padding_mask'].to(device)

            true_len = max(int(cln_msk[0].sum().item()), 2)
            visible_idx, masked_idx = _adaptive_mask(true_len)

            fused        = model.forward_online(deg_pkt, cln_ctx, deg_msk)
            vis_latents  = fused[:, visible_idx, :]
            pred_latents = model.predictor(vis_latents, masked_idx)

            with torch.no_grad():
                target_fused = model.forward_target(cln_pkt, cln_ctx, cln_msk)
                tgt_latents  = target_fused[:, masked_idx, :].detach()

            vic_loss, vic_metrics = vicreg_loss(
                pred_latents, tgt_latents,
                alpha=vicreg_alpha, beta=vicreg_beta, gamma=vicreg_gamma)
            epoch_metrics.update(vic_metrics)

            contrast_val = None
            if pseudo_valid:
                with torch.no_grad():
                    flow_embs = model.forward_downstream(cln_pkt, cln_ctx, cln_msk)
                # Look each flow's cluster up by its true dataset index.
                batch_pl = torch.tensor(
                    [pseudo_global.get(int(fi), -1) for fi in batch['flow_idx']],
                    dtype=torch.long, device=device)
                contrast_val = dbscan_contrastive_loss(flow_embs, batch_pl)

            total = composite(vic_loss, contrast_val, pseudo_valid)
            opt.zero_grad()
            total.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            # EMA momentum fixed at 0.999 in Phase 2
            model.update_target(0.999)

            total_loss_accum += total.item()
            n_batches += 1

        sched.step()
        avg_loss = total_loss_accum / max(n_batches, 1)
        epoch_metrics['total_loss'] = avg_loss

        _log.info('[%03d] loss=%.4f inv=%.4f', epoch, avg_loss,
                  epoch_metrics.get('invariance', 0))

        if use_wandb:
            log_metrics(epoch_metrics, step=epoch)

        if (epoch + 1) % 10 == 0:
            save_checkpoint(model, opt, epoch, epoch_metrics,
                            Path(ckpt_dir) / f'epoch_{epoch}.pt')

    save_checkpoint(model, opt, epochs - 1, epoch_metrics,
                    Path(ckpt_dir) / 'final.pt')
    return model
