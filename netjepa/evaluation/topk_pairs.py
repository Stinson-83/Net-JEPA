from __future__ import annotations
import torch
import numpy as np
from sklearn.preprocessing import normalize


def topk_pairs_accuracy(embeddings: np.ndarray, k: int = 5) -> float:
    """
    Given paired embeddings (even indices = view A, odd indices = view B),
    check if each pair is within top-k nearest neighbours.
    """
    emb_norm = normalize(embeddings)
    n_pairs  = len(emb_norm) // 2
    if n_pairs == 0:
        return 0.0

    view_a = emb_norm[0::2][:n_pairs]
    view_b = emb_norm[1::2][:n_pairs]

    # Cosine similarity = dot product on unit vectors
    sim_matrix = view_a @ emb_norm.T   # (n_pairs, n_total)

    hit = 0
    for i in range(n_pairs):
        partner_idx = 2 * i + 1
        top_k = np.argsort(sim_matrix[i])[::-1][:k + 1]   # +1 to exclude self
        if partner_idx in top_k:
            hit += 1

    return hit / n_pairs


def topk_pairs_accuracy_torch(embs_a: torch.Tensor, embs_b: torch.Tensor,
                               k: int = 5) -> float:
    """Batch-level top-k accuracy for augmented pairs."""
    a = torch.nn.functional.normalize(embs_a, dim=-1)
    b = torch.nn.functional.normalize(embs_b, dim=-1)
    all_embs = torch.cat([a, b], dim=0)
    sim = a @ all_embs.T   # (B, 2B)

    B = a.size(0)
    hit = 0
    for i in range(B):
        partner = B + i   # b's index in all_embs
        topk = sim[i].topk(k + 1).indices.tolist()
        if partner in topk:
            hit += 1
    return hit / B
