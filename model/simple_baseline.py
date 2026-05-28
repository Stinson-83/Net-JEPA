from __future__ import annotations

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

from .classifier_base import Classifier, Prediction


class RandomForestClassifierModel(Classifier):
    def __init__(self, n_estimators: int = 200, random_state: int = 42) -> None:
        self._rf = RandomForestClassifier(
            n_estimators=n_estimators,
            random_state=random_state,
            n_jobs=-1,
        )
        self._le = LabelEncoder()
        self._fitted = False

    def fit(self, X: np.ndarray, y: list[str]) -> None:
        y_enc = self._le.fit_transform(y)
        self._rf.fit(X, y_enc)
        self._fitted = True

    def predict(self, feats) -> Prediction:
        if not self._fitted:
            raise RuntimeError("Model not fitted or loaded.")
        x = feats.scalar_vector.reshape(1, -1)
        proba = self._rf.predict_proba(x)[0]
        idx = int(proba.argmax())
        label = self._le.inverse_transform([idx])[0]
        return Prediction(label=label, confidence=float(proba[idx]), embedding=None)

    def save(self, path: str) -> None:
        joblib.dump({"rf": self._rf, "le": self._le}, path)

    @classmethod
    def load(cls, path: str) -> "RandomForestClassifierModel":
        data = joblib.load(path)
        obj = cls.__new__(cls)
        obj._rf = data["rf"]
        obj._le = data["le"]
        obj._fitted = True
        return obj
