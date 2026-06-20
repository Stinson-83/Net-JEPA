"""Export a trained checkpoint into the static-file tree the Net-JEPA
live-demo UI (`webui/`) reads from `webui/public/data/<dataset_id>/`.

    python netjepa/scripts/export_artifacts.py \\
        --checkpoint checkpoints/phase3/best.pt \\
        --dataset-id phase3_full \\
        --name "Phase 3 — full run" \\
        --out-dir webui/public/data

Run it again with a different `--dataset-id` after each new run — the
manifest is merged, not overwritten, so old datasets stay selectable in the
switcher. See `webui/README.md` → "The data contract" for the full schema
this writes, and "Exporting real artifacts" for the bigger picture.

This is a *runnable starting point*, not a finished pipeline — the TODOs
below mark the project-specific spots (label naming, nearest-neighbour
search, flow-summary formatting, training-curve sourcing, robustness sweeps)
you'll likely want to adapt to taste.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
import torch
import yaml
from sklearn.metrics import confusion_matrix
from sklearn.neighbors import NearestNeighbors
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from netjepa.model.netjepa import NetJEPA
from netjepa.data.dataset import FlowDataset
from netjepa.data.preprocess import CATEGORY_LABELS
from netjepa.evaluation.embedding import cosine_similarity_distributions, silhouette
from netjepa.evaluation.classification import classification_report
from netjepa.training.phase3 import _collect_embeddings
from netjepa.downstream.classifier import KNNClassifier
from netjepa.utils.io import load_checkpoint

# `protocol_id` → name, matching `PROTOCOL_MAP` in netjepa/data/parser.py
# (anything not TCP/UDP/QUIC collapses to id 3 == 'OTHER').
PROTOCOL_NAMES = ['TCP', 'UDP', 'QUIC', 'OTHER']


# ─────────────────────────────────────────────────────────────────────────
# Undoing the per-column normalisation baked into netjepa/data/features.py.
# The parquet only stores normalised tensors, so reconstructing the
# human-readable series the inspector shows (byte counts, milliseconds,
# +1/-1 direction) means mirroring `compute_packet_sequence` /
# `compute_flow_context` exactly, in reverse. Keep these in sync by hand if
# the feature encoders ever change.
# ─────────────────────────────────────────────────────────────────────────
PACKET_MAX_BYTES = 1500.0   # compute_packet_sequence: size_norm = length / 1500
LOG_SCALE        = 10.0     # compute_packet_sequence: iat_log = log1p(iat) / 10
RTT_MAX_S        = 2.0      # compute_packet_sequence: rtt_norm = min(rtt, 2.0) / 2.0


def _decode_packets(packet_seq: np.ndarray, padding_mask: np.ndarray
                     ) -> tuple[list[int], list[float], list[int], float]:
    """`(size_norm, iat_log, signed, ...onehot4, rtt_norm, rtt_flag)` → human units."""
    real = packet_seq[padding_mask.astype(bool)]
    sizes     = np.round(real[:, 0] * PACKET_MAX_BYTES).astype(int).tolist()
    iat_ms    = (np.expm1(real[:, 1] * LOG_SCALE) * 1000.0).tolist()
    direction = np.sign(real[:, 2]).astype(int).tolist()   # signed = size_norm * (+1 out / -1 in); size_norm > 0 always
    rtt_ms    = float(real[0, 7] * RTT_MAX_S * 1000.0) if len(real) else 0.0
    return sizes, iat_ms, direction, rtt_ms


def _decode_context(flow_ctx: np.ndarray) -> tuple[float, float]:
    """`(proto/3, log1p(duration)/10, ..., log1p(pkts_per_s)/10, ...)` → (duration_s, packet_rate)."""
    duration_s  = float(np.expm1(flow_ctx[1] * LOG_SCALE))
    packet_rate = float(np.expm1(flow_ctx[7] * LOG_SCALE))
    return duration_s, packet_rate


def _jitter_ms(iat_ms: list[float]) -> float:
    """Mean absolute consecutive-delta of inter-arrival times — the same
    RFC-3550-flavoured estimate `src/pcap/extractFlows.ts` uses, so live
    injections and exported flows read on a comparable scale. `iat_ms[0]`
    is always a synthetic `0` (see `compute_packet_sequence`), so it's
    dropped before differencing."""
    if len(iat_ms) < 3:
        return 0.0
    deltas = np.abs(np.diff(iat_ms[1:]))
    return float(deltas.mean()) if len(deltas) else 0.0


def _flow_summary(proto_id: int, sizes: list[int], duration_s: float, rtt_ms: float) -> str:
    # TODO: tune the wording/precision to taste — this mirrors the
    # `flow_summary` shown in the README's `embeddings_umap.json` example
    # ("TCP · 203 pkts · 612 B avg · 41.2s · 38ms rtt").
    proto = PROTOCOL_NAMES[proto_id] if 0 <= proto_id < len(PROTOCOL_NAMES) else 'OTHER'
    avg_size = (sum(sizes) / len(sizes)) if sizes else 0.0
    return f'{proto} · {len(sizes)} pkts · {avg_size:.0f} B avg · {duration_s:.1f}s · {rtt_ms:.0f}ms rtt'


def _project_2d(embeddings: np.ndarray, seed: int = 0):
    """UMAP if available (the real exporter should always have it — it's
    what produced the layouts the README screenshots show), PCA otherwise
    so the script still runs somewhere without it installed.

    Returns ``(coords, reducer)``. ``reducer`` is the *fitted* projector and
    supports ``.transform(new_embeddings)`` — the live server reuses it to
    drop newly-inferred flows into this exact same 2D space (so the cloud can
    grow over time without reshuffling). For UMAP this is a ``umap.UMAP``; for
    the PCA fallback it's an ``sklearn`` ``PCA``; both expose ``.transform``.
    """
    try:
        import umap
        print('  using umap-learn for the 2D projection')
        reducer = umap.UMAP(n_components=2, random_state=seed)
        coords = reducer.fit_transform(embeddings)
        return coords, reducer
    except ImportError:
        print('  umap-learn not installed — falling back to PCA(2) '
              '(pip install umap-learn for a more faithful cluster layout)')
        from sklearn.decomposition import PCA
        reducer = PCA(n_components=2, random_state=seed)
        coords = reducer.fit_transform(embeddings)
        return coords, reducer


def _load_cfg(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def _build_model(model_cfg: dict, device: torch.device) -> NetJEPA:
    return NetJEPA(
        d_model=model_cfg['d_model'],
        n_heads=model_cfg['n_heads'],
        n_te_layers=model_cfg['n_transformer_layers'],
        n_pred_layers=model_cfg['n_predictor_layers'],
        dim_ff=model_cfg['dim_feedforward'],
        dropout=model_cfg['dropout'],
        packet_feat_dim=model_cfg['packet_feature_dim'],
        flow_ctx_dim=model_cfg['flow_context_dim'],
    ).to(device)


def _measure_latency_ms(model: NetJEPA, sample: dict, device: str, trials: int = 200) -> float:
    model = model.to(device)
    pkt = sample['packet_seq'].unsqueeze(0).to(device)
    ctx = sample['flow_ctx'].unsqueeze(0).to(device)
    msk = sample['padding_mask'].unsqueeze(0).to(device)
    times = []
    for _ in range(trials):
        t0 = time.perf_counter()
        with torch.no_grad():
            model.forward_downstream(pkt, ctx, msk)
        times.append((time.perf_counter() - t0) * 1000.0)
    return float(np.percentile(times, 95))


def _merge_manifest(out_root: Path, dataset_id: str, name: str, trained_on: str,
                     n_flows: int, embedding_dim: int, model_version: str) -> None:
    manifest_path = out_root / 'manifest.json'
    manifest: dict = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    datasets = [d for d in manifest.get('datasets', []) if d.get('id') != dataset_id]
    datasets.append({'id': dataset_id, 'name': name, 'trained_on': trained_on, 'n_flows': n_flows})

    manifest.update({
        'datasets':       datasets,
        'active_dataset': dataset_id,
        'classes':        CATEGORY_LABELS,
        'embedding_dim':  embedding_dim,
        'model_version':  model_version,
    })
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f'  wrote {manifest_path}  ({len(datasets)} dataset(s) registered)')


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--config',          default=str(Path(__file__).resolve().parents[2] / 'netjepa/configs/default.yaml'))
    p.add_argument('--checkpoint',      required=True)
    p.add_argument('--processed_dir',   default=None, help='defaults to data.processed_dir from --config')
    p.add_argument('--dataset-id',      required=True, help='sub-directory name; also the manifest entry id')
    p.add_argument('--name',            required=True, help='human-readable label shown in the dataset switcher')
    p.add_argument('--trained-on',      default=None, help='ISO date for the switcher tooltip (default: today)')
    p.add_argument('--model-version',   default=None, help='shown in the top bar (default: derived from the checkpoint epoch)')
    p.add_argument('--out-dir',         default='webui/public/data')
    p.add_argument('--device',          default='cpu')
    p.add_argument('--max-flow-files',  type=int, default=4000,
                   help='cap on per-flow detail JSONs written — by far the slowest artifact to export in bulk')
    p.add_argument('--knn-neighbours',  type=int, default=3,
                   help='how many `knn_ids` chips each exported flow gets')
    args = p.parse_args()

    cfg = _load_cfg(args.config)
    data_cfg, model_cfg, ds_cfg, ev_cfg = cfg['data'], cfg['model'], cfg['downstream'], cfg['evaluation']

    device = torch.device(args.device)
    processed_dir = args.processed_dir or data_cfg['processed_dir']
    # Use the dataset's own class names (labels.json) instead of the built-in
    # 6-category list, so an 8-traffic-type export is labelled correctly.
    global CATEGORY_LABELS
    _labels_json = Path(processed_dir) / 'labels.json'
    if _labels_json.is_file():
        import json as _json
        _d = _json.load(open(_labels_json))
        CATEGORY_LABELS = _d.get('traffic_types', _d) if isinstance(_d, dict) else _d
    out_root = Path(args.out_dir)
    out_dir = out_root / args.dataset_id
    (out_dir / 'flow_features').mkdir(parents=True, exist_ok=True)

    # ── Model + data ──────────────────────────────────────────────────
    model = _build_model(model_cfg, device)
    payload = load_checkpoint(model, None, args.checkpoint, device)
    model.eval()

    ds_test  = FlowDataset(str(Path(processed_dir) / 'test.parquet'))
    ds_train = FlowDataset(str(Path(processed_dir) / 'downstream_train.parquet'))
    test_loader  = DataLoader(ds_test,  batch_size=256, shuffle=False, num_workers=2)
    train_loader = DataLoader(ds_train, batch_size=256, shuffle=False, num_workers=2)

    print(f'Collecting embeddings for {len(ds_test)} test + {len(ds_train)} downstream-train flows…')
    test_embs,  _          = _collect_embeddings(model, test_loader,  device)
    train_embs, _          = _collect_embeddings(model, train_loader, device)
    # `_collect_embeddings` returns the fine-grained `app_label` (15 apps);
    # the demo groups by the coarser *category* (6 classes — see
    # `manifest.classes` / `CATEGORY_LABELS`), which only lives in the
    # dataframe. `shuffle=False` on both loaders keeps row order intact, so
    # this lines up 1:1 with the embeddings collected above.
    test_cats  = ds_test.df['category_label'].to_numpy()
    train_cats = ds_train.df['category_label'].to_numpy()

    # ── KPI metrics — reusing the existing evaluation helpers verbatim ──
    print('Scoring + computing embedding-space metrics…')
    knn = KNNClassifier(k=ds_cfg['knn_k'])
    knn.fit(train_embs, train_cats)
    proba       = knn.clf.predict_proba(test_embs)               # (n_test, n_categories)
    preds       = proba.argmax(axis=1)
    confidences = proba.max(axis=1)

    clf = classification_report(test_cats, preds)
    cm  = confusion_matrix(test_cats, preds, labels=list(range(len(CATEGORY_LABELS))))
    sim = cosine_similarity_distributions(test_embs, test_cats, n_pairs=ev_cfg['cosine_sim_pairs'])
    sil = silhouette(test_embs, test_cats)
    print(f'  accuracy={clf["accuracy"]:.3f}  macro_f1={clf["macro_f1"]:.3f}  silhouette={sil:.3f}')

    print('Measuring inference latency…')
    sample = ds_test[0]
    latency_cpu = _measure_latency_ms(model, sample, 'cpu')
    if torch.cuda.is_available():
        latency_gpu = _measure_latency_ms(model, sample, 'cuda')
    else:
        # `latency_ms_gpu` isn't optional in the contract — duplicate the CPU
        # figure rather than fabricate one. Re-run with --device cuda on a
        # GPU host for a real number.
        print('  no CUDA device available — duplicating the CPU figure for latency_ms_gpu')
        latency_gpu = latency_cpu
    model.to(device)

    print('Projecting test embeddings to 2D…')
    coords, reducer = _project_2d(test_embs)

    # Persist the fitted projector so the live server can place newly-inferred
    # flows into this exact same 2D space via reducer.transform(...).
    import joblib
    joblib.dump(reducer, out_dir / 'umap.joblib')
    print(f'  saved fitted projector → {out_dir / "umap.joblib"}')

    # ── Per-flow decoding (sizes/IATs/direction/RTT/jitter/...) ────────
    print('Decoding per-flow packet series…')
    n = len(ds_test)
    flow_ids = [f'flow_{i:05d}' for i in range(n)]
    decoded = []
    for i in range(n):
        row      = ds_test.df.iloc[i]
        pkt_seq  = np.asarray([list(r) for r in row['packet_sequence']], dtype=np.float32)
        pad_mask = np.asarray(list(row['padding_mask']), dtype=bool)
        ctx_vec  = np.asarray(list(row['flow_context']),  dtype=np.float32)

        sizes, iat_ms, direction, rtt_ms = _decode_packets(pkt_seq, pad_mask)
        duration_s, packet_rate = _decode_context(ctx_vec)
        decoded.append({
            'sizes': sizes, 'iat_ms': iat_ms, 'direction': direction,
            'rtt_ms': rtt_ms, 'jitter_ms': _jitter_ms(iat_ms),
            'duration_s': duration_s, 'packet_rate': packet_rate,
            'proto_id': int(row['protocol_id']) if 'protocol_id' in row else int(np.argmax(pkt_seq[0, 3:7])),
        })

    print(f'Indexing {args.knn_neighbours}-NN neighbours over the embedding space…')
    nn_index = NearestNeighbors(n_neighbors=args.knn_neighbours + 1, metric='cosine').fit(test_embs)
    _, neighbour_idx = nn_index.kneighbors(test_embs)

    # ── embeddings_umap.json + embeddings_raw.bin ─────────────────────
    # NB: `label`/`confidence` are the *model's* prediction, not ground
    # truth — that's what lets the point cloud visually expose where the
    # classifier is (un)confident, which is the whole point of the demo.
    print('Writing embeddings_umap.json + embeddings_raw.bin…')
    points = []
    class_members: dict[str, list[int]] = {c: [] for c in CATEGORY_LABELS}
    for i in range(n):
        d = decoded[i]
        label = CATEGORY_LABELS[int(preds[i])]
        class_members[label].append(i)
        points.append({
            'id': flow_ids[i],
            'x': float(coords[i, 0]),
            'y': float(coords[i, 1]),
            'label': label,
            'confidence': round(float(confidences[i]), 3),
            'flow_summary': _flow_summary(d['proto_id'], d['sizes'], d['duration_s'], d['rtt_ms']),
        })
    (out_dir / 'embeddings_umap.json').write_text(json.dumps(points))
    embedding_dim = int(test_embs.shape[1])
    test_embs.astype('<f4').tofile(out_dir / 'embeddings_raw.bin')

    # ── class_stats.json ───────────────────────────────────────────────
    print('Writing class_stats.json…')
    class_stats = []
    for label, idxs in class_members.items():
        if not idxs:
            continue
        all_sizes = [s for i in idxs for s in decoded[i]['sizes']]
        class_stats.append({
            'label': label,
            'count': len(idxs),
            'avg_packet_size': round(float(np.mean(all_sizes)), 1) if all_sizes else 0.0,
            'avg_duration_s':  round(float(np.mean([decoded[i]['duration_s'] for i in idxs])), 1),
            'avg_rtt_ms':      round(float(np.mean([decoded[i]['rtt_ms']      for i in idxs])), 1),
        })
    (out_dir / 'class_stats.json').write_text(json.dumps(class_stats))

    # ── metrics.json ───────────────────────────────────────────────────
    print('Writing metrics.json…')
    metrics = {
        'accuracy':         clf['accuracy'],
        'macro_f1':         clf['macro_f1'],
        'per_class_f1':     dict(zip(CATEGORY_LABELS, clf['per_class_f1'])),
        'confusion_matrix': {'labels': CATEGORY_LABELS, 'matrix': cm.tolist()},
        'intra_class_cos':  round(sim['intra_mean'], 3),
        'inter_class_cos':  round(sim['inter_mean'], 3),
        'latency_ms_cpu':   round(latency_cpu, 1),
        'latency_ms_gpu':   round(latency_gpu, 1),
        'silhouette':       round(sil, 3),
        # TODO: `robustness` is optional — the panel renders an empty state
        # without it (see webui/README.md). Wire it up by re-encoding
        # `degrade_flow`-perturbed copies of the test set through
        # `model.forward_downstream` and re-scoring with `knn`, one named
        # condition per row, e.g.
        #   [{"condition": "clean",            "accuracy": 0.91},
        #    {"condition": "RTT ×0.5–1.5",     "accuracy": 0.88},
        #    {"condition": "packet loss (w=0.2)", "accuracy": 0.85}]
        # `netjepa.data.augment.degrade_flow` already implements each of
        # these perturbations in isolation (set the others' `*_prob` to 0).
    }
    (out_dir / 'metrics.json').write_text(json.dumps(metrics, indent=2))

    # TODO: `training_curves.json` (the loss-curve panel) needs per-step
    # `{step, total_loss, jepa_loss, vicreg_loss, contrastive_loss}` rows —
    # nothing in this checkpoint format stores that history. If your
    # training run logs to W&B/CSV/etc., export it alongside this script's
    # output as `<out_dir>/training_curves.json`; until then the panel
    # degrades gracefully to a labelled "no data yet" empty state.

    # ── flow_features/<id>.json (lazily fetched on point click) ───────
    n_export = min(n, args.max_flow_files)
    print(f'Writing {n_export}/{n} per-flow detail files (this is the slow part)…')
    for i in range(n_export):
        d = decoded[i]
        order = np.argsort(-proba[i])[:3]
        detail = {
            'id': flow_ids[i],
            'packet_sizes': d['sizes'],
            'iat': [round(v, 2) for v in d['iat_ms']],
            'direction': d['direction'],
            'rtt_ms': round(d['rtt_ms'], 1),
            'jitter_ms': round(d['jitter_ms'], 1),
            'duration_s': round(d['duration_s'], 1),
            'packet_rate': round(d['packet_rate'], 2),
            'predicted_class': CATEGORY_LABELS[int(preds[i])],
            'top3': [{'label': CATEGORY_LABELS[j], 'prob': round(float(proba[i, j]), 3)} for j in order],
            'knn_ids': [flow_ids[j] for j in neighbour_idx[i] if j != i][:args.knn_neighbours],
        }
        (out_dir / 'flow_features' / f'{flow_ids[i]}.json').write_text(json.dumps(detail))
    if n_export < n:
        print(f'  ({n - n_export} flows left without a detail file — they fall back to a '
              'deterministic synthesized placeholder, see loader.ts → loadFlowDetail)')

    # ── manifest.json (merged, not overwritten) ───────────────────────
    print('Updating manifest.json…')
    model_version = args.model_version or f'netjepa-ckpt-e{payload.get("epoch", "?")}'
    _merge_manifest(
        out_root, args.dataset_id, args.name,
        trained_on=args.trained_on or date.today().isoformat(),
        n_flows=n, embedding_dim=embedding_dim, model_version=model_version,
    )

    print(f'\nDone — exported "{args.dataset_id}" → {out_dir}')
    print(f'Drop {out_root} into webui/public/data/ (or point Vite at it) and reload.')


if __name__ == '__main__':
    main()
