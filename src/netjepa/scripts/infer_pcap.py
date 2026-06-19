"""Run Net-JEPA inference on a .pcap in the terminal — no UI, no server.

Shows, per flow, exactly how the file is processed by the SAME pipeline the live
server uses: parse (scapy) -> group into 5-tuple flows -> features (full-fidelity
extractor) -> 128-D embedding -> cosine k-NN, and prints the predicted category,
confidence, the top-3 classes, and the key context features that were extracted.

Usage:
    python src/netjepa/scripts/infer_pcap.py path/to/file.pcap
    python src/netjepa/scripts/infer_pcap.py file.pcap --device cpu --checkpoint checkpoints/phase3/final.pt

If the checkpoint isn't present locally it is downloaded from Hugging Face
(--hf-repo, default kritikahd007/net-jepa).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # repo/src on sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _resolve(p: str) -> Path:
    pp = Path(p)
    return pp if pp.is_absolute() else (PROJECT_ROOT / pp)


def _ensure_checkpoint(ckpt: Path, knn: Path, repo: str) -> None:
    if ckpt.is_file() and knn.is_file():
        return
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        sys.exit(f"checkpoint not found at {ckpt} and huggingface_hub isn't installed.\n"
                 "Run `make fetch-weights` or `pip install huggingface_hub`.")
    import shutil
    ckpt.parent.mkdir(parents=True, exist_ok=True)
    if not ckpt.is_file():
        print(f"[infer] downloading weights from HF {repo} ...")
        shutil.copy(hf_hub_download(repo, "net_jepa_phase3.pt"), ckpt)
    if not knn.is_file():
        shutil.copy(hf_hub_download(repo, "knn.joblib"), knn)


def main() -> None:
    ap = argparse.ArgumentParser(description="Terminal inference on a .pcap (no UI/server).")
    ap.add_argument("pcap", help="path to a .pcap / .pcapng file")
    ap.add_argument("--checkpoint", default="checkpoints/phase3/final.pt")
    ap.add_argument("--knn", default=None, help="defaults to knn.joblib next to the checkpoint")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--hf-repo", default="kritikahd007/net-jepa")
    args = ap.parse_args()

    pcap = _resolve(args.pcap)
    if not pcap.is_file():
        sys.exit(f"no such file: {pcap}")
    ckpt = _resolve(args.checkpoint)
    knn = _resolve(args.knn) if args.knn else ckpt.parent / "knn.joblib"
    _ensure_checkpoint(ckpt, knn, args.hf_repo)

    import numpy as np
    import torch
    from capture.pcap_replay import PcapReplay
    from flows.flow_table import FlowTable
    from model.netjepa_classifier import NetJEPAClassifier, packets_to_tensors, CATEGORY_LABELS

    print(f"Loading model: {ckpt}")
    model = NetJEPAClassifier.load(str(ckpt), knn_path=str(knn))

    print(f"Parsing {pcap.name} ...")
    records = list(PcapReplay(str(pcap), speed=1e9).stream())   # 1e9 = as fast as possible
    flows = list(FlowTable().process(iter(records)))
    print(f"  {len(records)} packets -> {len(flows)} flow(s) with >= 10 packets\n")
    if not flows:
        sys.exit("No classifiable flow (need a 5-tuple flow with >= 10 packets). "
                 "Capture a longer steady stream.")

    counts: dict[str, int] = {}
    for i, (key, pkts) in enumerate(flows, 1):
        client = pkts[0].src_ip
        proto = pkts[0].proto
        syn = sum(p.is_syn for p in pkts); fin = sum(p.is_fin for p in pkts); rst = sum(p.is_rst for p in pkts)
        dur = pkts[-1].ts - pkts[0].ts

        pkt_t, ctx_t, mask_t = packets_to_tensors(pkts)
        with torch.no_grad():
            emb = model._model.forward_downstream(
                pkt_t.to(model._device), ctx_t.to(model._device), mask_t.to(model._device)).cpu().numpy()
        proba = model._knn.predict_proba(emb)[0]
        classes = model._knn.classes_
        order = np.argsort(proba)[::-1]
        top3 = [(CATEGORY_LABELS[int(classes[j])], float(proba[j])) for j in order[:3] if proba[j] > 0]
        pred = top3[0][0] if top3 else "unknown"
        counts[pred] = counts.get(pred, 0) + 1
        ctx = ctx_t.numpy()[0]

        print(f"Flow {i}: {client} {proto}  | {len(pkts)} pkts, {dur:.2f}s, "
              f"flags S/F/R={syn}/{fin}/{rst}")
        print(f"   context: proto_id={ctx[0]*3:.0f}  syn_ratio={ctx[4]:.3f} fin_ratio={ctx[5]:.3f} "
              f"rst_ratio={ctx[6]:.3f}  rtt={'valid' if ctx[14] > 0.5 else 'none'}({ctx[13]*2:.3f}s)")
        print(f"   => {pred}   (" + ", ".join(f"{c} {p*100:.0f}%" for c, p in top3) + ")\n")

    print("Summary:", ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) or "(none)")


if __name__ == "__main__":
    main()
