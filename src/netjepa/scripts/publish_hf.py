"""Publish the trained Net-JEPA model to the Hugging Face Hub.

This uploads the Phase-3 checkpoint, the fitted cosine k-NN classifier, the
config, and the model card (docs/hf_model_card.md → the repo's README.md) to a
Hugging Face *model* repo under YOUR namespace.

You need a Hugging Face account and a write token (https://huggingface.co/settings/tokens).
The model is Apache-2.0 and tiny (~7 MB checkpoint + ~1.5 MB k-NN).

Usage
-----
    pip install huggingface_hub                      # if not already installed
    export HF_TOKEN=hf_xxx                            # a *write* token
    python src/netjepa/scripts/publish_hf.py --repo-id <your-username>/net-jepa

    # or pass the token explicitly, and/or make the repo private first:
    python src/netjepa/scripts/publish_hf.py --repo-id me/net-jepa --token hf_xxx --private

After it runs, paste the printed URL into README.md ("Models Published") and
docs/tech-stack.md §4.4.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# repo root = .../Net-JEPA  (this file is at src/netjepa/scripts/publish_hf.py)
PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _resolve(p: str) -> Path:
    pp = Path(p)
    return pp if pp.is_absolute() else (PROJECT_ROOT / pp)


def main() -> None:
    ap = argparse.ArgumentParser(description="Publish Net-JEPA to the Hugging Face Hub.")
    ap.add_argument("--repo-id", required=True,
                    help="Target HF model repo, e.g. your-username/net-jepa")
    ap.add_argument("--token", default=None,
                    help="HF write token (else uses $HF_TOKEN or a cached login)")
    ap.add_argument("--checkpoint", default="checkpoints/traffic8/phase3/final.pt",
                    help="Trained Net-JEPA checkpoint (default: %(default)s)")
    ap.add_argument("--knn", default="checkpoints/traffic8/phase3/knn.joblib",
                    help="Fitted cosine k-NN classifier (default: %(default)s)")
    ap.add_argument("--config", default="src/netjepa/configs/traffic.yaml",
                    help="Config to publish as config.yaml (default: %(default)s)")
    ap.add_argument("--labels", default="data/processed_traffic/labels.json",
                    help="labels.json with the traffic-type names (default: %(default)s)")
    ap.add_argument("--card", default="docs/hf_model_card.md",
                    help="Model card → uploaded as README.md (default: %(default)s)")
    ap.add_argument("--umap", default="webui/public/data/traffic8/umap.joblib",
                    help="UMAP reducer for the 2-D atlas (uploaded only with --with-umap)")
    ap.add_argument("--with-umap", action="store_true",
                    help="Also upload the UMAP reducer (umap.joblib) for atlas-projection reproducibility")
    ap.add_argument("--private", action="store_true",
                    help="Create the repo as private (default: public)")
    args = ap.parse_args()

    try:
        from huggingface_hub import HfApi, create_repo
    except ImportError:
        sys.exit("huggingface_hub is not installed. Run:  pip install huggingface_hub")

    import os
    token = args.token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if not token:
        sys.exit("No token. Set $HF_TOKEN or pass --token "
                 "(create one at https://huggingface.co/settings/tokens).")

    # ── validate the files exist before touching the network ──────────────────
    uploads = [
        (_resolve(args.card),       "README.md"),
        (_resolve(args.checkpoint), "net_jepa_phase3.pt"),
        (_resolve(args.knn),        "knn.joblib"),
        (_resolve(args.config),     "config.yaml"),
        (_resolve(args.labels),     "labels.json"),
    ]
    if args.with_umap:
        uploads.append((_resolve(args.umap), "umap.joblib"))
    missing = [str(src) for src, _ in uploads if not src.is_file()]
    if missing:
        sys.exit("Missing files (train/export first, or pass correct paths):\n  - "
                 + "\n  - ".join(missing))

    print(f"Creating repo (if needed): {args.repo_id}  (private={args.private})")
    create_repo(args.repo_id, token=token, repo_type="model",
                exist_ok=True, private=args.private)

    api = HfApi()
    for src, dst in uploads:
        print(f"  uploading {src.name}  →  {dst}")
        api.upload_file(
            path_or_fileobj=str(src),
            path_in_repo=dst,
            repo_id=args.repo_id,
            repo_type="model",
            token=token,
        )

    url = f"https://huggingface.co/{args.repo_id}"
    print("\n✅ Published.")
    print(f"   {url}")
    print("   → paste this link into README.md ('Models Published') and docs/tech-stack.md §4.4")


if __name__ == "__main__":
    main()
