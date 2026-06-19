"""Fetch the assets a fresh clone needs to run Net-JEPA end-to-end.

Two assets, fetched from their licensed sources (nothing is re-redistributed):

  * weights — `net_jepa_phase3.pt` + `knn.joblib` ← the published Hugging Face
    model repo (default: kritikahd007/net-jepa, Apache-2.0). No token needed
    (public repo).

  * data — `data/processed/*.parquet` ← the **raw 5G dataset is downloaded from
    Kaggle** (its license is "Unknown", so we do NOT redistribute it; you pull it
    from the original source under your own Kaggle account) and then preprocessed
    locally via preprocess_kaggle.py. Needs Kaggle API credentials for `--data`:
    set KAGGLE_USERNAME / KAGGLE_KEY, or place ~/.kaggle/kaggle.json.

Usage
-----
    pip install -r requirements.txt && pip install -e .

    # both (weights from HF + data from Kaggle→preprocess):
    python src/netjepa/scripts/fetch_assets.py

    # just one of them:
    python src/netjepa/scripts/fetch_assets.py --weights-only   # for the live demo
    python src/netjepa/scripts/fetch_assets.py --data-only      # to (re)train / evaluate

Note: the published checkpoint was trained with optional VLC (CC-BY-4.0) and
cloud-gaming (BSD-3) fold-ins on top of the Kaggle 5G base. This script builds
the Kaggle 5G base; see docs/usage.md / docs/datasets.md to add the fold-ins for
the exact published configuration.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

# repo root = .../Net-JEPA  (this file is at src/netjepa/scripts/fetch_assets.py)
PROJECT_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_DIR = Path(__file__).resolve().parent


def _abs(p: str) -> Path:
    pp = Path(p)
    return pp if pp.is_absolute() else (PROJECT_ROOT / pp)


def fetch_weights(repo: str, ckpt_dir: Path) -> None:
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        sys.exit("huggingface_hub is not installed. Run:  pip install huggingface_hub")
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    for remote, local in [("net_jepa_phase3.pt", "final.pt"), ("knn.joblib", "knn.joblib")]:
        dst = ckpt_dir / local
        if dst.is_file():
            print(f"  {local}: already present ✓")
            continue
        print(f"  downloading {remote} from HF {repo} …")
        cached = hf_hub_download(repo_id=repo, filename=remote)
        shutil.copy(cached, dst)
        print(f"    → {dst}")


def fetch_data(kaggle_id: str, out_dir: Path) -> None:
    try:
        import kagglehub
    except ImportError:
        sys.exit("kagglehub is not installed. Run:  pip install kagglehub  "
                 "(and set Kaggle API creds: KAGGLE_USERNAME/KAGGLE_KEY or ~/.kaggle/kaggle.json)")
    print(f"  downloading raw dataset {kaggle_id} via kagglehub …")
    print("  (needs Kaggle API credentials; the dataset is pulled from its original source)")
    try:
        raw = kagglehub.dataset_download(kaggle_id)
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"Kaggle download failed ({exc}).\n"
                 "Set Kaggle credentials (KAGGLE_USERNAME/KAGGLE_KEY or ~/.kaggle/kaggle.json) "
                 "and accept the dataset's terms on its Kaggle page, then retry.")
    print(f"    raw dataset at: {raw}")
    print("  running preprocess_kaggle.py (raw CSVs → parquet splits) …")
    subprocess.check_call([
        sys.executable, str(SCRIPTS_DIR / "preprocess_kaggle.py"),
        "--raw_dir", str(raw), "--out_dir", str(out_dir),
    ])
    print(f"    → {out_dir}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch pretrained weights (HF) and build the "
                                             "preprocessed data (Kaggle download + preprocess).")
    ap.add_argument("--hf-repo", default="kritikahd007/net-jepa",
                    help="published HF model repo for the weights (default: %(default)s)")
    ap.add_argument("--kaggle-dataset", default="kimdaegyeom/5g-traffic-datasets",
                    help="Kaggle dataset id for the raw 5G captures (default: %(default)s)")
    ap.add_argument("--ckpt-dir", default="checkpoints/phase3",
                    help="where to place final.pt + knn.joblib (default: %(default)s)")
    ap.add_argument("--out-dir", default="data/processed",
                    help="where preprocess writes the parquet splits (default: %(default)s)")
    ap.add_argument("--weights-only", action="store_true", help="fetch only the model weights")
    ap.add_argument("--data-only", action="store_true", help="fetch/build only the data")
    args = ap.parse_args()

    if args.weights_only and args.data_only:
        sys.exit("--weights-only and --data-only are mutually exclusive.")

    ckpt_dir, out_dir = _abs(args.ckpt_dir), _abs(args.out_dir)

    if not args.data_only:
        print("== weights (Hugging Face) ==")
        fetch_weights(args.hf_repo, ckpt_dir)
    if not args.weights_only:
        print("== data (Kaggle → preprocess) ==")
        fetch_data(args.kaggle_dataset, out_dir)

    print("\n✅ done.")
    if not args.data_only:
        print(f"   weights → {ckpt_dir}")
    if not args.weights_only:
        print(f"   data    → {out_dir}")


if __name__ == "__main__":
    main()
