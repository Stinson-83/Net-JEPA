from __future__ import annotations
import numpy as np
import torch
import torch.nn.functional as F
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import normalize


def generate_pseudo_labels(embeddings: np.ndarray,
                            min_samples: int = 5,
                            eps: float = 0.5) -> np.ndarray:
    emb_norm = normalize(embeddings)
    db       = DBSCAN(eps=eps, min_samples=min_samples, metric='cosine')
    return db.fit_predict(emb_norm)


def dbscan_contrastive_loss(embeddings: torch.Tensor,
                             pseudo_labels: torch.Tensor,
                             margin: float = 0.5) -> torch.Tensor:
    dists = torch.cdist(embeddings, embeddings, p=2)

    valid    = pseudo_labels >= 0
    pos_mask = (pseudo_labels.unsqueeze(0) == pseudo_labels.unsqueeze(1))
    pos_mask &= ~torch.eye(len(pseudo_labels), dtype=torch.bool,
                           device=embeddings.device)
    pos_mask &= valid.unsqueeze(0) & valid.unsqueeze(1)

    neg_mask  = (pseudo_labels.unsqueeze(0) != pseudo_labels.unsqueeze(1))
    neg_mask &= valid.unsqueeze(0) & valid.unsqueeze(1)

    pos_loss = (F.relu(dists - margin)[pos_mask]).mean() \
        if pos_mask.any() else torch.tensor(0.0, device=embeddings.device)
    neg_loss = (F.relu(2 * margin - dists)[neg_mask]).mean() \
        if neg_mask.any() else torch.tensor(0.0, device=embeddings.device)

    return pos_loss + neg_loss
