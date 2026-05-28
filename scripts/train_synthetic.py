#!/usr/bin/env python3
"""
Train a quick baseline on synthetic features so run_demo works without
the real 5G Kaggle dataset. For testing Phases 2–3 only.

Usage:
    python scripts/train_synthetic.py --out model/checkpoints/baseline.joblib
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

from model.simple_baseline import RandomForestClassifierModel

LABELS = ["Netflix", "Zoom", "Gaming"]
N_PER_CLASS = 500


def _synthetic_features(label: str, rng: np.random.Generator) -> np.ndarray:
    """Returns a (10,) float32 scalar vector with realistic per-class statistics."""
    if label == "Netflix":
        # High throughput video: large packets, consistent IAT
        return rng.normal(
            [40, 2.0, 1200, 150, 0.008, 0.002, 45000, 5000, 8.0, 50],
            [5, 0.5, 100, 30, 0.002, 0.001, 5000, 1000, 1.0, 5],
        ).astype(np.float32)
    elif label == "Zoom":
        # Video+audio: mixed sizes, bursty IAT
        return rng.normal(
            [25, 1.5, 350, 200, 0.020, 0.015, 5000, 3000, 1.5, 17],
            [5, 0.5, 100, 50, 0.005, 0.004, 1000, 800, 0.3, 3],
        ).astype(np.float32)
    else:  # Gaming
        # Small packets, very fast IAT
        return rng.normal(
            [50, 0.8, 120, 40, 0.005, 0.002, 3000, 2500, 1.2, 62],
            [8, 0.2, 30, 10, 0.001, 0.001, 500, 500, 0.2, 8],
        ).astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="model/checkpoints/baseline.joblib")
    args = parser.parse_args()

    rng = np.random.default_rng(42)
    rows = []
    labels = []
    for lbl in LABELS:
        for _ in range(N_PER_CLASS):
            rows.append(_synthetic_features(lbl, rng))
            labels.append(lbl)

    X = np.vstack(rows)
    X = np.clip(X, 0, None)  # no negatives

    X_tr, X_te, y_tr, y_te = train_test_split(X, labels, test_size=0.2, random_state=42)

    model = RandomForestClassifierModel(n_estimators=100)
    model.fit(X_tr, y_tr)

    y_pred_idx = model._rf.predict(X_te)
    y_pred = model._le.inverse_transform(y_pred_idx)
    print(classification_report(y_te, y_pred))

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    model.save(args.out)
    print(f"Saved → {args.out}")


if __name__ == "__main__":
    main()
