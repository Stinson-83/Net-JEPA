from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional

import numpy as np


@dataclass
class Prediction:
    label: str
    confidence: float
    embedding: Optional[np.ndarray]


class Classifier(ABC):
    """Phase 4 swap point: swap RandomForest for Net-JEPA encoder + k-NN here."""

    @abstractmethod
    def predict(self, feats) -> Prediction:
        ...

    @abstractmethod
    def save(self, path: str) -> None:
        ...

    @classmethod
    @abstractmethod
    def load(cls, path: str) -> "Classifier":
        ...
