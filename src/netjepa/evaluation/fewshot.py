from __future__ import annotations
import random
from collections import defaultdict

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

from ..downstream.classifier import LinearProbe


def few_shot_eval(train_embs: np.ndarray, train_labels: np.ndarray,
                  test_embs:  np.ndarray, test_labels:  np.ndarray,
                  eta_values: list[int] = (1, 3, 5, 7, 10),
                  repeats: int = 10, num_classes: int = 14,
                  embedding_dim: int = 143, epochs: int = 50,
                  lr: float = 1e-3, seed: int = 42) -> dict[int, dict]:
    rng     = random.Random(seed)
    results = {}

    for eta in eta_values:
        accs = []
        for rep in range(repeats):
            per_class = defaultdict(list)
            for i, lbl in enumerate(train_labels):
                per_class[int(lbl)].append(i)
            chosen = []
            for cls, idxs in per_class.items():
                chosen.extend(rng.sample(idxs, min(eta, len(idxs))))

            X_few = torch.from_numpy(train_embs[chosen].astype(np.float32))
            y_few = torch.from_numpy(train_labels[chosen].astype(np.int64))
            X_tst = torch.from_numpy(test_embs.astype(np.float32))
            y_tst = torch.from_numpy(test_labels.astype(np.int64))

            probe = LinearProbe(embedding_dim, num_classes)
            opt   = optim.AdamW(probe.parameters(), lr=lr)
            crit  = nn.CrossEntropyLoss()
            ds    = TensorDataset(X_few, y_few)
            loader = DataLoader(ds, batch_size=min(32, len(chosen)),
                                shuffle=True, drop_last=False)

            probe.train()
            for _ in range(epochs):
                for xb, yb in loader:
                    loss = crit(probe(xb), yb)
                    opt.zero_grad()
                    loss.backward()
                    opt.step()

            probe.eval()
            with torch.no_grad():
                preds = probe(X_tst).argmax(dim=1)
            acc = float((preds == y_tst).float().mean().item())
            accs.append(acc)

        arr = np.array(accs)
        results[eta] = {'mean': float(arr.mean()), 'std': float(arr.std())}
        print(f'eta={eta}: {arr.mean():.4f} ± {arr.std():.4f}')

    return results
