"""Phase 3: Downstream classification with frozen encoder."""
from __future__ import annotations
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader

from ..model.netjepa       import NetJEPA
from ..downstream.classifier import LinearProbe, ShallowMLP, KNNClassifier
from ..data.dataset        import FlowDataset
from ..training.phase1     import _set_seeds
from ..utils.io            import save_checkpoint, load_checkpoint
from ..utils.logging       import init_wandb, log_metrics, get_logger

_log = get_logger('training.phase3')


def _freeze_pretrained(model: NetJEPA) -> None:
    for p in model.temporal_encoder.parameters():
        p.requires_grad_(False)
    for p in model.context_encoder.parameters():
        p.requires_grad_(False)
    for p in model.fusion_a.parameters():
        p.requires_grad_(False)
    for p in model.target_temporal.parameters():
        p.requires_grad_(False)
    for p in model.target_context.parameters():
        p.requires_grad_(False)
    for p in model.target_fusion_a.parameters():
        p.requires_grad_(False)


@torch.no_grad()
def _collect_embeddings(model: NetJEPA, loader: DataLoader,
                         device: torch.device) -> tuple[np.ndarray, np.ndarray]:
    embs, labels = [], []
    model.eval()
    for batch in loader:
        pkt = batch['packet_seq'].to(device)
        ctx = batch['flow_ctx'].to(device)
        msk = batch['padding_mask'].to(device)
        emb = model.forward_downstream(pkt, ctx, msk)
        embs.append(emb.cpu().numpy())
        labels.append(batch['category_label'].numpy())
    return np.vstack(embs), np.concatenate(labels)


def train_phase3(processed_dir: str, ckpt_dir: str = 'checkpoints/phase3',
                 phase2_ckpt: str | None = None,
                 epochs: int = 50, batch_size: int = 64,
                 lr: float = 1e-3, weight_decay: float = 1e-4,
                 num_classes: int = 15, embedding_dim: int = 143,
                 device_str: str = 'cuda',
                 use_wandb: bool = False,
                 **model_kwargs) -> dict:
    _set_seeds()
    device = torch.device(device_str if torch.cuda.is_available() else 'cpu')
    Path(ckpt_dir).mkdir(parents=True, exist_ok=True)

    if use_wandb:
        init_wandb('netjepa-phase3')

    model = NetJEPA(**model_kwargs).to(device)
    if phase2_ckpt:
        load_checkpoint(model, None, phase2_ckpt, device)
    _freeze_pretrained(model)

    ds_train = FlowDataset(str(Path(processed_dir) / 'downstream_train.parquet'))
    ds_test  = FlowDataset(str(Path(processed_dir) / 'test.parquet'))

    # Plain loaders for collecting the (un-resampled) embeddings the kNN indexes.
    train_loader = DataLoader(ds_train, batch_size=batch_size,
                              shuffle=False, num_workers=2, pin_memory=True)
    test_loader  = DataLoader(ds_test,  batch_size=batch_size,
                              shuffle=False, num_workers=2, pin_memory=True)
    # Shuffle loader for training the CE heads. Imbalance is handled by the
    # class-weighted loss below (NOT balanced sampling — combining both
    # over-corrects: oversampling the 5-sample classes with replacement and then
    # re-weighting them ~40x collapses the heads onto minority predictions).
    head_loader  = DataLoader(ds_train, batch_size=batch_size, shuffle=True,
                              num_workers=2, pin_memory=True)

    # Collect embeddings for kNN
    train_embs, train_labels = _collect_embeddings(model, train_loader, device)
    test_embs,  test_labels  = _collect_embeddings(model, test_loader,  device)

    results: dict = {}

    # ── kNN ──────────────────────────────────────────────────────────────
    knn = KNNClassifier(k=5)
    knn.fit(train_embs, train_labels)
    knn_preds = knn.predict(test_embs)
    from sklearn.metrics import accuracy_score
    results['knn_accuracy'] = accuracy_score(test_labels, knn_preds)
    _log.info('kNN accuracy: %.4f', results['knn_accuracy'])

    # Persist the fitted kNN for server-side live inference
    import joblib
    joblib.dump(knn.clf, Path(ckpt_dir) / 'knn.joblib')
    _log.info('kNN index saved → %s', Path(ckpt_dir) / 'knn.joblib')

    # Inverse-frequency class weights (sklearn 'balanced' style) so the CE heads
    # don't collapse onto the majority classes under heavy imbalance.
    counts = np.bincount(train_labels, minlength=num_classes)
    class_weight = torch.tensor(
        len(train_labels) / (num_classes * np.maximum(counts, 1)),
        dtype=torch.float32, device=device)
    criterion = nn.CrossEntropyLoss(weight=class_weight)

    def _train_head(head: nn.Module, tag: str) -> float:
        head = head.to(device)
        o    = optim.AdamW(head.parameters(), lr=lr, weight_decay=weight_decay)
        sc   = optim.lr_scheduler.CosineAnnealingLR(o, T_max=epochs, eta_min=1e-5)
        model.eval()
        head.train()
        for ep in range(epochs):
            for batch in head_loader:
                pkt = batch['packet_seq'].to(device)
                ctx = batch['flow_ctx'].to(device)
                msk = batch['padding_mask'].to(device)
                lbl = batch['category_label'].to(device)
                with torch.no_grad():
                    emb = model.forward_downstream(pkt, ctx, msk)
                logits = head(emb)
                loss   = criterion(logits, lbl)
                o.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(head.parameters(), 1.0)
                o.step()
            sc.step()

        # Eval
        head.eval()
        correct = total = 0
        with torch.no_grad():
            for batch in test_loader:
                pkt = batch['packet_seq'].to(device)
                ctx = batch['flow_ctx'].to(device)
                msk = batch['padding_mask'].to(device)
                lbl = batch['category_label'].to(device)
                emb    = model.forward_downstream(pkt, ctx, msk)
                preds  = head(emb).argmax(dim=1)
                correct += (preds == lbl).sum().item()
                total   += lbl.size(0)
        acc = correct / max(total, 1)
        _log.info('%s accuracy: %.4f', tag, acc)
        return acc

    results['linear_probe_accuracy'] = _train_head(
        LinearProbe(embedding_dim, num_classes), 'LinearProbe')
    results['mlp_accuracy'] = _train_head(
        ShallowMLP(embedding_dim, num_classes=num_classes), 'ShallowMLP')

    if use_wandb:
        log_metrics(results, step=0)

    save_checkpoint(model, None, epochs, results,
                    Path(ckpt_dir) / 'final.pt')
    return results
