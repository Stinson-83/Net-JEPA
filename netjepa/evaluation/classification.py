from __future__ import annotations
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import (accuracy_score, f1_score, precision_score,
                              recall_score, confusion_matrix)


def classification_report(y_true: np.ndarray, y_pred: np.ndarray,
                           class_names: list[str] | None = None,
                           out_dir: str | None = None) -> dict:
    acc  = accuracy_score(y_true, y_pred)
    f1   = f1_score(y_true, y_pred, average='macro', zero_division=0)
    prec = precision_score(y_true, y_pred, average='macro', zero_division=0)
    rec  = recall_score(y_true, y_pred, average='macro', zero_division=0)

    per_class_f1 = f1_score(y_true, y_pred, average=None, zero_division=0).tolist()

    metrics = {
        'accuracy':      float(acc),
        'macro_f1':      float(f1),
        'macro_precision': float(prec),
        'macro_recall':  float(rec),
        'per_class_f1':  per_class_f1,
    }

    if out_dir:
        Path(out_dir).mkdir(parents=True, exist_ok=True)
        cm = confusion_matrix(y_true, y_pred)
        fig, ax = plt.subplots(figsize=(10, 8))
        sns.heatmap(cm, annot=True, fmt='d', ax=ax,
                    xticklabels=class_names, yticklabels=class_names)
        ax.set_xlabel('Predicted')
        ax.set_ylabel('True')
        fig.tight_layout()
        fig.savefig(str(Path(out_dir) / 'confusion_matrix.png'))
        plt.close(fig)

    return metrics
