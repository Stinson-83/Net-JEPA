#!/usr/bin/env python3
"""
Train the RandomForest baseline on the 5G Kaggle dataset.

Usage:
    python scripts/train_baseline.py --data-dir datasets/5g-traffic
    python scripts/train_baseline.py --data-dir datasets/5g-traffic --out model/checkpoints/baseline.joblib
"""
from __future__ import annotations

import argparse
import os
import sys

# Allow running from project root without installing the package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split

from flows.features import SCALAR_FEATURE_NAMES, extract
from model.simple_baseline import RandomForestClassifierModel


# ──────────────────────────────────────────────────────────────────────────────
# Dataset loading
# ──────────────────────────────────────────────────────────────────────────────

def _explore_dir(path: str) -> None:
    print(f"\n=== Directory structure under {path} ===")
    for root, dirs, files in os.walk(path):
        depth = root.replace(path, "").count(os.sep)
        indent = "  " * depth
        print(f"{indent}{os.path.basename(root)}/")
        sub = "  " * (depth + 1)
        for f in files[:10]:
            print(f"{sub}{f}")
        if len(files) > 10:
            print(f"{sub}... ({len(files)} total)")


def _load_csvs(data_dir: str) -> tuple[np.ndarray, list[str]]:
    """Load pre-extracted CSV flow stats from the 5G dataset."""
    X_rows, y_rows = [], []

    for root, _, files in os.walk(data_dir):
        for fname in files:
            if not fname.endswith(".csv"):
                continue
            path = os.path.join(root, fname)
            try:
                df = pd.read_csv(path, low_memory=False)
            except Exception as e:
                print(f"  Skip {path}: {e}")
                continue

            # Infer label from filename or a 'Label' column
            label_col = next(
                (c for c in df.columns if c.strip().lower() in ("label", "class", "app", "application")),
                None,
            )
            if label_col:
                labels = df[label_col].astype(str).tolist()
            else:
                # Use filename stem (strip trailing numbers) as class label
                stem = os.path.splitext(fname)[0]
                # e.g. "Netflix_1" → "Netflix"
                label = stem.rstrip("_0123456789").strip() or stem
                labels = [label] * len(df)

            # Try to map columns onto scalar_vector order
            col_map = _build_col_map(df.columns.tolist())
            if col_map is None:
                print(f"  Skip {path}: cannot map columns to features")
                continue

            feat_mat = _extract_features_from_df(df, col_map)
            X_rows.append(feat_mat)
            y_rows.extend(labels)
            print(f"  Loaded {len(df)} rows from {fname} → label={label_col or labels[0]!r}")

    if not X_rows:
        raise ValueError(f"No usable CSV files found in {data_dir}")

    return np.vstack(X_rows).astype(np.float32), y_rows


# Column name synonyms for each scalar feature
_COL_SYNONYMS: dict[str, list[str]] = {
    "packet_count": ["flow packets/s", "tot fwd pkts", "total fwd packets", "packet_count",
                     "flow pkts/s", "total packets"],
    "duration":     ["flow duration", "duration"],
    "mean_pkt_size":["avg pkt size", "average packet size", "mean_pkt_size", "avg fwd segment size"],
    "std_pkt_size": ["pkt size avg", "std_pkt_size"],
    "mean_iat":     ["flow iat mean", "mean iat", "flow_iat_mean"],
    "std_iat":      ["flow iat std", "std iat", "flow_iat_std"],
    "bytes_up":     ["total length of fwd packets", "total fwd bytes", "bytes_up",
                     "fwd header length"],
    "bytes_down":   ["total length of bwd packets", "total bwd bytes", "bytes_down"],
    "up_down_ratio":["down/up ratio", "up_down_ratio"],
    "packet_rate":  ["flow packets/s", "flow pkts/s", "packet_rate"],
}


def _build_col_map(columns: list[str]) -> dict[str, str] | None:
    """Return {feature_name: csv_column} for as many features as possible."""
    lower = {c.strip().lower(): c for c in columns}
    mapping = {}
    for feat, synonyms in _COL_SYNONYMS.items():
        for syn in synonyms:
            if syn.lower() in lower:
                mapping[feat] = lower[syn.lower()]
                break
    if len(mapping) < 4:
        return None
    return mapping


def _extract_features_from_df(df: pd.DataFrame, col_map: dict[str, str]) -> np.ndarray:
    n = len(df)
    mat = np.zeros((n, len(SCALAR_FEATURE_NAMES)), dtype=np.float32)
    for i, feat in enumerate(SCALAR_FEATURE_NAMES):
        if feat in col_map:
            col = col_map[feat]
            mat[:, i] = pd.to_numeric(df[col], errors="coerce").fillna(0).values
    return mat


def _load_pcaps(data_dir: str) -> tuple[np.ndarray, list[str]]:
    """Load pcap files and run them through FlowTable + features.extract."""
    from capture.pcap_replay import PcapReplay
    from flows.flow_table import FlowTable

    X_rows, y_rows = [], []
    for root, _, files in os.walk(data_dir):
        for fname in files:
            if not (fname.endswith(".pcap") or fname.endswith(".pcapng")):
                continue
            path = os.path.join(root, fname)
            label = os.path.splitext(fname)[0].rstrip("_0123456789").strip() or fname
            print(f"  Processing {fname} → label={label!r}")
            try:
                replay = PcapReplay(path, speed=1e9)  # as fast as possible
                table = FlowTable()
                for _, pkts in table.process(replay.stream()):
                    feats = extract(pkts)
                    X_rows.append(feats.scalar_vector)
                    y_rows.append(label)
            except Exception as e:
                print(f"    Error: {e}")

    if not X_rows:
        raise ValueError(f"No usable pcap files found in {data_dir}")
    return np.vstack(X_rows).astype(np.float32), y_rows


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True, help="Path to 5G dataset root")
    parser.add_argument("--out", default="model/checkpoints/baseline.joblib")
    parser.add_argument("--explore", action="store_true", help="Just print directory structure")
    args = parser.parse_args()

    if not os.path.isdir(args.data_dir):
        sys.exit(f"ERROR: data directory not found: {args.data_dir}")

    _explore_dir(args.data_dir)

    if args.explore:
        return

    # Try CSVs first; fall back to pcaps
    try:
        X, y = _load_csvs(args.data_dir)
        print(f"\nLoaded CSV data: {X.shape[0]} flows, {len(set(y))} classes")
    except ValueError:
        print("No CSVs found or mappable — trying pcap files...")
        X, y = _load_pcaps(args.data_dir)
        print(f"\nLoaded pcap data: {X.shape[0]} flows, {len(set(y))} classes")

    # Replace NaN/Inf
    X = np.nan_to_num(X, nan=0.0, posinf=1e6, neginf=0.0)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"Train: {len(X_train)}  Test: {len(X_test)}")

    model = RandomForestClassifierModel(n_estimators=200)
    print("Training RandomForest...")
    model.fit(X_train, y_train)

    # Evaluate
    from sklearn.preprocessing import LabelEncoder
    le = model._le
    y_pred_idx = model._rf.predict(X_test)
    y_pred = le.inverse_transform(y_pred_idx)
    print("\n" + classification_report(y_test, y_pred))

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    model.save(args.out)
    print(f"Model saved → {args.out}")


if __name__ == "__main__":
    main()
