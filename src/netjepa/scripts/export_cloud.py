"""Re-export ONLY the galaxy point cloud, denser and ground-truth coloured.

The standard export_artifacts.py projects just the test split (~2.8k). This
projects the *full* processed set (pretrain + downstream + test), capped per
category for a balanced, dense galaxy, every point a real captured flow:

    python netjepa/scripts/export_cloud.py \
        --checkpoint checkpoints/phase3/final.pt --dataset-id phase3b_supcon --cap 1500

It rewrites embeddings_umap.json, flow_features/*.json and umap.joblib only —
metrics.json / class_stats.json (the Proof dashboard) stay on the honest test
split. Galaxy points are coloured by GROUND-TRUTH category; the per-flow detail
still records the model's PREDICTION (so the inspector shows the verdict).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.neighbors import NearestNeighbors
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from netjepa.scripts.export_artifacts import (  # reuse the exact decoders
    _decode_packets, _decode_context, _jitter_ms, _flow_summary, _build_model, _load_cfg)
from netjepa.data.preprocess import CATEGORY_LABELS
from netjepa.data.dataset import FlowDataset
from netjepa.training.phase3 import _collect_embeddings
from netjepa.downstream.classifier import KNNClassifier
from netjepa.utils.io import load_checkpoint


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--config', default=str(Path(__file__).resolve().parents[2] / 'netjepa/configs/default.yaml'))
    p.add_argument('--checkpoint', required=True)
    p.add_argument('--processed_dir', default=None)
    p.add_argument('--dataset-id', required=True)
    p.add_argument('--out-dir', default='webui/public/data')
    p.add_argument('--cap', type=int, default=1500, help='max flows per category in the galaxy')
    p.add_argument('--device', default='cpu')
    p.add_argument('--seed', type=int, default=0)
    args = p.parse_args()

    cfg = _load_cfg(args.config)
    device = torch.device(args.device)
    processed = Path(args.processed_dir or cfg['data']['processed_dir'])
    out_dir = Path(args.out_dir) / args.dataset_id
    feat_dir = out_dir / 'flow_features'
    feat_dir.mkdir(parents=True, exist_ok=True)

    model = _build_model(cfg['model'], device)
    load_checkpoint(model, None, args.checkpoint, device)
    model.eval()

    # ── gather full set, cap per category ──────────────────────────────────
    dfs = [pd.read_parquet(processed / f'{s}.parquet') for s in ('pretrain', 'downstream_train', 'test')]
    df_full = pd.concat(dfs, ignore_index=True)
    parts = []
    for _, grp in df_full.groupby('category_label'):
        parts.append(grp.sample(args.cap, random_state=args.seed) if len(grp) > args.cap else grp)
    df_disp = pd.concat(parts).sample(frac=1, random_state=args.seed).reset_index(drop=True)
    print(f'galaxy: {len(df_disp)} flows (capped {args.cap}/class) from {len(df_full)} total')
    for cid, n in df_disp['category_label'].value_counts().sort_index().items():
        print(f'  {CATEGORY_LABELS[int(cid)]:<20} {n}')

    tmp = out_dir / '_cloud_tmp.parquet'
    df_disp.to_parquet(tmp)

    # ── embed displayed flows + the real train set (for the k-NN verdict) ──
    disp_embs, _ = _collect_embeddings(model, DataLoader(FlowDataset(str(tmp)), batch_size=256, num_workers=2), device)
    tr_embs, tr_cats = _collect_embeddings(model, DataLoader(FlowDataset(str(processed / 'downstream_train.parquet')), batch_size=256, num_workers=2), device)
    knn = KNNClassifier(k=cfg['downstream']['knn_k'])
    knn.fit(tr_embs, tr_cats)
    proba = knn.clf.predict_proba(disp_embs)
    classes_ = list(knn.clf.classes_)
    col_of = {int(c): i for i, c in enumerate(classes_)}

    # ── project (fit a fresh reducer the live server will reuse) ───────────
    import umap, joblib  # noqa: E401
    print('projecting to 2-D (UMAP)…')
    reducer = umap.UMAP(n_components=2, random_state=args.seed)
    coords = reducer.fit_transform(disp_embs)
    joblib.dump(reducer, out_dir / 'umap.joblib')

    nn = NearestNeighbors(n_neighbors=4, metric='cosine').fit(disp_embs)
    _, nbr = nn.kneighbors(disp_embs)

    # ── write points + details ─────────────────────────────────────────────
    for f in feat_dir.glob('*.json'):
        f.unlink()
    ids = [f'flow_{i:05d}' for i in range(len(df_disp))]
    points = []
    for i in range(len(df_disp)):
        row = df_disp.iloc[i]
        pkt = np.asarray([list(r) for r in row['packet_sequence']], dtype=np.float32)
        pad = np.asarray(list(row['padding_mask']), dtype=bool)
        ctx = np.asarray(list(row['flow_context']), dtype=np.float32)
        sizes, iat_ms, direction, rtt_ms = _decode_packets(pkt, pad)
        dur, rate = _decode_context(ctx)
        proto_id = int(np.argmax(pkt[0, 3:7]))
        true_cat = int(row['category_label'])
        conf_true = float(proba[i][col_of[true_cat]]) if true_cat in col_of else 0.0
        points.append({
            'id': ids[i], 'x': float(coords[i, 0]), 'y': float(coords[i, 1]),
            'label': CATEGORY_LABELS[true_cat], 'confidence': round(conf_true, 3),
            'flow_summary': _flow_summary(proto_id, sizes, dur, rtt_ms),
        })
        order = np.argsort(-proba[i])[:3]
        detail = {
            'id': ids[i], 'packet_sizes': sizes, 'iat': [round(v, 2) for v in iat_ms],
            'direction': direction, 'rtt_ms': round(rtt_ms, 1), 'jitter_ms': round(_jitter_ms(iat_ms), 1),
            'duration_s': round(dur, 1), 'packet_rate': round(rate, 2),
            'predicted_class': CATEGORY_LABELS[int(classes_[int(np.argmax(proba[i]))])],
            'top3': [{'label': CATEGORY_LABELS[int(classes_[j])], 'prob': round(float(proba[i][j]), 3)} for j in order],
            'knn_ids': [ids[k] for k in nbr[i] if k != i][:3],
        }
        (feat_dir / f'{ids[i]}.json').write_text(json.dumps(detail))

    (out_dir / 'embeddings_umap.json').write_text(json.dumps(points))
    disp_embs.astype('<f4').tofile(out_dir / 'embeddings_raw.bin')
    tmp.unlink(missing_ok=True)

    # keep manifest n_flows honest for this dataset entry
    man_path = Path(args.out_dir) / 'manifest.json'
    if man_path.exists():
        man = json.loads(man_path.read_text())
        for d in man.get('datasets', []):
            if d.get('id') == args.dataset_id:
                d['n_flows'] = len(df_disp)
        man_path.write_text(json.dumps(man, indent=2))

    print(f'done — {len(points)} galaxy points + details → {out_dir}')


if __name__ == '__main__':
    main()
