from __future__ import annotations
import random
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
from sklearn.metrics import silhouette_score as sk_silhouette
from sklearn.preprocessing import normalize


def cosine_similarity_distributions(embeddings: np.ndarray, labels: np.ndarray,
                                     n_pairs: int = 10_000,
                                     out_dir: str | None = None
                                     ) -> dict[str, float]:
    emb_norm = normalize(embeddings)
    n = len(emb_norm)
    indices = list(range(n))

    intra_sims, inter_sims = [], []
    for _ in range(n_pairs):
        i, j = random.sample(indices, 2)
        sim = float(np.dot(emb_norm[i], emb_norm[j]))
        if labels[i] == labels[j]:
            intra_sims.append(sim)
        else:
            inter_sims.append(sim)

    intra = np.array(intra_sims)
    inter = np.array(inter_sims)
    metrics = {
        'intra_mean': float(intra.mean()) if len(intra) else 0.0,
        'intra_std':  float(intra.std())  if len(intra) else 0.0,
        'inter_mean': float(inter.mean()) if len(inter) else 0.0,
        'inter_std':  float(inter.std())  if len(inter) else 0.0,
        'intra_frac_gt07': float((intra > 0.7).mean()) if len(intra) else 0.0,
        'inter_frac_lt03': float((inter < 0.3).mean()) if len(inter) else 0.0,
    }

    if out_dir:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        fig, ax = plt.subplots()
        ax.hist(intra, bins=50, alpha=0.6, label='Intra-class')
        ax.hist(inter, bins=50, alpha=0.6, label='Inter-class')
        ax.axvline(0.7, color='green',  linestyle='--', label='intra target 0.7')
        ax.axvline(0.3, color='red',    linestyle='--', label='inter target 0.3')
        ax.legend()
        ax.set_xlabel('Cosine similarity')
        ax.set_title('Embedding similarity distributions')
        fig.savefig(str(Path(out_dir) / 'cosine_distributions.png'))
        plt.close(fig)

    return metrics


def silhouette(embeddings: np.ndarray, labels: np.ndarray) -> float:
    if len(set(labels)) < 2:
        return 0.0
    sample = min(10_000, len(embeddings))
    idx    = random.sample(range(len(embeddings)), sample)
    return float(sk_silhouette(embeddings[idx], labels[idx]))
