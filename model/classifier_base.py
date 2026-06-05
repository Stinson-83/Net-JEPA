from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

import numpy as np


@dataclass
class Prediction:
    label: str
    confidence: float
    embedding: Optional[np.ndarray]
    category: str = field(default='unknown')


class Classifier(ABC):
    @abstractmethod
    def predict(self, packets) -> Prediction:
        ...

    @abstractmethod
    def save(self, path: str) -> None:
        ...

    @classmethod
    @abstractmethod
    def load(cls, path: str) -> 'Classifier':
        ...
