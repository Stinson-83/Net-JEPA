"""Fetch the assets a fresh clone needs to run Net-JEPA end-to-end.

Everything is fetched from its **licensed source** (nothing is re-redistributed):

  * weights — `net_jepa_phase3.pt` + `knn.joblib` ← the published Hugging Face
    model repo (default: kritikahd007/net-jepa, Apache-2.0). No token needed.

  * data — `data/processed/*.parquet`. The raw captures are pulled from their
    sources and preprocessed locally:
      - 5G base (Kaggle `kimdaegyeom/5g-traffic-datasets`, license "Unknown" —
        used under Kaggle's terms, not redistributed by us). Needs Kaggle creds.
      - optional fold-ins (`--with-foldins`) that reproduce the *published*
        checkpoint exactly:
          · VLC / Valencia (Zenodo 15121418, CC-BY-4.0) — MS Teams (supervised)
            + Netflix/Prime/YouTube/Roblox (pretrain-only)
          · cloud-gaming (Kaggle `carloshfm/cloud-gaming-network-telemetry`,
            BSD-3) — Xbox Cloud over 5G (pretrain-only)
    Both fold-in sources are LARGE (VLC ≈24 GB, cloud-gaming ≈28 GB); pick a
    subset with `--foldin-apps` (e.g. just `teams` for the video-conf F1 boost).

Kaggle creds for `--data`: set KAGGLE_USERNAME / KAGGLE_KEY, or place
~/.kaggle/kaggle.json, and accept each dataset's terms on its Kaggle page.

Usage
-----
    pip install -r requirements.txt && pip install -e .

    python src/netjepa/scripts/fetch_assets.py                  # weights + 5G base
    python src/netjepa/scripts/fetch_assets.py --with-foldins   # + VLC + cloud-gaming (exact published config)
    python src/netjepa/scripts/fetch_assets.py --with-foldins --foldin-apps teams   # just the MS-Teams boost
    python src/netjepa/scripts/fetch_assets.py --weights-only   # for the live demo
    python src/netjepa/scripts/fetch_assets.py --data-only --with-foldins
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

# repo root = .../Net-JEPA  (this file is at src/netjepa/scripts/fetch_assets.py)
PROJECT_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_DIR = Path(__file__).resolve().parent

# Which fold-in apps live where. VLC apps come from Zenodo; xbox from Kaggle.
VLC_APPS = {"teams", "netflix", "prime", "youtube", "roblox"}
ZENODO_VLC_RECORD = "15121418"
CLOUD_GAMING_KAGGLE = "carloshfm/cloud-gaming-network-telemetry"


def _abs(p: str) -> Path:
    pp = Path(p)
    return pp if pp.is_absolute() else (PROJECT_ROOT / pp)


# ── weights ─────────────────────────────────────────────────────────────────
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
        shutil.copy(hf_hub_download(repo_id=repo, filename=remote), dst)
        print(f"    → {dst}")


# ── fold-ins (convert raw pcaps → VLC_*/CG_Xbox CSV folders next to the 5G data) ──
def _convert(raw_pcaps: Path, raw_root: Path, max_packets: int) -> None:
    subprocess.check_call([
        sys.executable, str(SCRIPTS_DIR / "convert_vlc_pcap.py"),
        "--vlc_dir", str(raw_pcaps), "--out_dir", str(raw_root),
        "--max_packets", str(max_packets),
    ])


def _download(url: str, dst: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "net-jepa-fetch/1.0"})
    with urllib.request.urlopen(req) as r, dst.open("wb") as f:
        shutil.copyfileobj(r, f, length=1 << 20)


def _foldin_vlc(raw_root: Path, apps: set[str], max_packets: int) -> None:
    want = apps & VLC_APPS
    if not want:
        return
    print(f"  VLC (Zenodo {ZENODO_VLC_RECORD}, CC-BY-4.0) — apps: {sorted(want)}")
    meta_url = f"https://zenodo.org/api/records/{ZENODO_VLC_RECORD}"
    with urllib.request.urlopen(urllib.request.Request(
            meta_url, headers={"User-Agent": "net-jepa-fetch/1.0"})) as r:
        files = json.load(r).get("files", [])
    picked = [f for f in files if any(w in f["key"].lower() for w in want)]
    if not picked:
        print("    (no matching VLC files found — skipping)")
        return
    total_mb = sum(f.get("size", 0) for f in picked) / 1e6
    print(f"    {len(picked)} files, ~{total_mb:.0f} MB total — downloading …")
    tmp = Path(tempfile.mkdtemp(prefix="vlc_"))
    try:
        for f in picked:
            key = f["key"]
            url = f"https://zenodo.org/api/records/{ZENODO_VLC_RECORD}/files/{key}/content"
            print(f"      {key} ({f.get('size', 0) / 1e6:.0f} MB)")
            _download(url, tmp / key)
        _convert(tmp, raw_root, max_packets)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _foldin_cloud_gaming(raw_root: Path, max_packets: int) -> None:
    try:
        import kagglehub
    except ImportError:
        sys.exit("kagglehub is not installed. Run:  pip install kagglehub")
    print(f"  cloud-gaming (Kaggle {CLOUD_GAMING_KAGGLE}, BSD-3) — ⚠ LARGE (~28 GB) download")
    cg = kagglehub.dataset_download(CLOUD_GAMING_KAGGLE)
    # convert_vlc_pcap maps the 'xbox' filename substring → CG_Xbox; it rglobs all
    # .pcap/.pcapng under the dir. (Captures other than the 5G Xbox set, if any,
    # are matched only if their name contains 'xbox'.)
    _convert(Path(cg), raw_root, max_packets)


# ── data (5G base + optional fold-ins → preprocess) ──────────────────────────
def fetch_data(kaggle_id: str, out_dir: Path, *, with_foldins: bool,
               foldin_apps: set[str], max_packets: int) -> None:
    try:
        import kagglehub
    except ImportError:
        sys.exit("kagglehub is not installed. Run:  pip install kagglehub  "
                 "(and set Kaggle API creds: KAGGLE_USERNAME/KAGGLE_KEY or ~/.kaggle/kaggle.json)")
    print(f"  downloading raw 5G dataset {kaggle_id} via kagglehub …")
    try:
        raw_root = Path(kagglehub.dataset_download(kaggle_id))
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"Kaggle download failed ({exc}).\n"
                 "Set Kaggle credentials (KAGGLE_USERNAME/KAGGLE_KEY or ~/.kaggle/kaggle.json) "
                 "and accept the dataset's terms on its Kaggle page, then retry.")
    print(f"    raw 5G dataset at: {raw_root}")

    if with_foldins:
        # convert writes VLC_*/CG_Xbox CSV folders INTO raw_root so the single
        # preprocess pass below picks them up via FOLDER_MAP (rglob by name).
        print("  folding in extra datasets (writes VLC_*/CG_Xbox next to the 5G folders) …")
        _foldin_vlc(raw_root, foldin_apps, max_packets)
        if "xbox" in foldin_apps:
            _foldin_cloud_gaming(raw_root, max_packets)

    print("  running preprocess_kaggle.py (raw → parquet splits) …")
    subprocess.check_call([
        sys.executable, str(SCRIPTS_DIR / "preprocess_kaggle.py"),
        "--raw_dir", str(raw_root), "--out_dir", str(out_dir),
    ])
    print(f"    → {out_dir}")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Fetch pretrained weights (HF) and build the preprocessed data "
                    "(raw download + preprocess), optionally with the published fold-ins.")
    ap.add_argument("--hf-repo", default="kritikahd007/net-jepa",
                    help="published HF model repo for the weights (default: %(default)s)")
    ap.add_argument("--kaggle-dataset", default="kimdaegyeom/5g-traffic-datasets",
                    help="Kaggle dataset id for the raw 5G captures (default: %(default)s)")
    ap.add_argument("--ckpt-dir", default="checkpoints/phase3",
                    help="where to place final.pt + knn.joblib (default: %(default)s)")
    ap.add_argument("--out-dir", default="data/processed",
                    help="where preprocess writes the parquet splits (default: %(default)s)")
    ap.add_argument("--with-foldins", action="store_true",
                    help="also fold in VLC (Zenodo, CC-BY-4.0) + cloud-gaming (Kaggle, BSD-3) "
                         "to reproduce the published checkpoint exactly (LARGE downloads)")
    ap.add_argument("--foldin-apps", default="teams,netflix,prime,youtube,roblox,xbox",
                    help="comma-list of fold-in apps to include (default: the published set). "
                         "e.g. 'teams' for just the video-conf boost")
    ap.add_argument("--max-packets", type=int, default=600000,
                    help="cap packets per converted fold-in capture (default: %(default)s)")
    ap.add_argument("--weights-only", action="store_true", help="fetch only the model weights")
    ap.add_argument("--data-only", action="store_true", help="fetch/build only the data")
    args = ap.parse_args()

    if args.weights_only and args.data_only:
        sys.exit("--weights-only and --data-only are mutually exclusive.")

    ckpt_dir, out_dir = _abs(args.ckpt_dir), _abs(args.out_dir)
    foldin_apps = {a.strip().lower() for a in args.foldin_apps.split(",") if a.strip()}

    if not args.data_only:
        print("== weights (Hugging Face) ==")
        fetch_weights(args.hf_repo, ckpt_dir)
    if not args.weights_only:
        print("== data (raw download → preprocess) ==")
        fetch_data(args.kaggle_dataset, out_dir, with_foldins=args.with_foldins,
                   foldin_apps=foldin_apps, max_packets=args.max_packets)

    print("\n✅ done.")
    if not args.data_only:
        print(f"   weights → {ckpt_dir}")
    if not args.weights_only:
        print(f"   data    → {out_dir}"
              + ("  (with VLC + cloud-gaming fold-ins)" if args.with_foldins else "  (5G base only)"))


if __name__ == "__main__":
    main()
