from __future__ import annotations
import torch
import torch.nn as nn
import numpy as np
from sklearn.neighbors import KNeighborsClassifier


class LinearProbe(nn.Module):
    def __init__(self, in_dim: int = 143, num_classes: int = 15):
        super().__init__()
        self.fc = nn.Linear(in_dim, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.fc(x)


class ShallowMLP(nn.Module):
    def __init__(self, in_dim: int = 143, hidden: int = 64,
                 num_classes: int = 15, dropout: float = 0.3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class KNNClassifier:
    def __init__(self, k: int = 5):
        self.clf = KNeighborsClassifier(n_neighbors=k, metric='cosine')

    def fit(self, embeddings: np.ndarray, labels: np.ndarray) -> None:
        self.clf.fit(embeddings, labels)

    def predict(self, embeddings: np.ndarray) -> np.ndarray:
        return self.clf.predict(embeddings)
