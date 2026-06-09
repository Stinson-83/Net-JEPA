"""Full evaluation suite."""
import argparse
import sys
import time
from pathlib import Path

import numpy as np
import torch
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from netjepa.model.netjepa        import NetJEPA
from netjepa.data.dataset          import FlowDataset
from netjepa.evaluation.embedding  import cosine_similarity_distributions, silhouette
from netjepa.evaluation.classification import classification_report
from netjepa.evaluation.fewshot    import few_shot_eval
from netjepa.training.phase3       import _collect_embeddings
from netjepa.downstream.classifier import KNNClassifier
from netjepa.utils.io              import load_checkpoint
from torch.utils.data import DataLoader


def _load_cfg(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--config',        default='netjepa/configs/default.yaml')
    p.add_argument('--checkpoint',    required=True)
    p.add_argument('--processed_dir', default=None)
    p.add_argument('--out_dir',       default='eval_results')
    p.add_argument('--device',        default='cpu')
    args = p.parse_args()

    cfg = _load_cfg(args.config)
    data_cfg  = cfg['data']
    model_cfg = cfg['model']
    ds_cfg    = cfg['downstream']
    ev_cfg    = cfg['evaluation']

    device = torch.device(args.device)
    processed_dir = args.processed_dir or data_cfg['processed_dir']
    out_dir = args.out_dir
    Path(out_dir).mkdir(parents=True, exist_ok=True)

    model = NetJEPA(
        d_model=model_cfg['d_model'],
        n_heads=model_cfg['n_heads'],
        n_te_layers=model_cfg['n_transformer_layers'],
        n_pred_layers=model_cfg['n_predictor_layers'],
        dim_ff=model_cfg['dim_feedforward'],
        dropout=model_cfg['dropout'],
        packet_feat_dim=model_cfg['packet_feature_dim'],
        flow_ctx_dim=model_cfg['flow_context_dim'],
    ).to(device)
    load_checkpoint(model, None, args.checkpoint, device)
    model.eval()

    ds_test = FlowDataset(str(Path(processed_dir) / 'test.parquet'))
    ds_train = FlowDataset(str(Path(processed_dir) / 'downstream_train.parquet'))
    test_loader  = DataLoader(ds_test,  batch_size=256, shuffle=False, num_workers=2)
    train_loader = DataLoader(ds_train, batch_size=256, shuffle=False, num_workers=2)

    print('Collecting embeddings...')
    test_embs,  test_labels  = _collect_embeddings(model, test_loader,  device)
    train_embs, train_labels = _collect_embeddings(model, train_loader, device)

    # Cosine similarity distributions
    print('Computing cosine similarity distributions...')
    sim_metrics = cosine_similarity_distributions(
        test_embs, test_labels,
        n_pairs=ev_cfg['cosine_sim_pairs'], out_dir=out_dir)
    print(f'  intra_mean={sim_metrics["intra_mean"]:.4f}  '
          f'inter_mean={sim_metrics["inter_mean"]:.4f}')
    print(f'  intra_frac>0.7={sim_metrics["intra_frac_gt07"]:.4f}  '
          f'inter_frac<0.3={sim_metrics["inter_frac_lt03"]:.4f}')

    # Silhouette score
    sil = silhouette(test_embs, test_labels)
    print(f'  silhouette score: {sil:.4f}')

    # kNN classification
    knn = KNNClassifier(k=ds_cfg['knn_k'])
    knn.fit(train_embs, train_labels)
    knn_preds = knn.predict(test_embs)
    clf_metrics = classification_report(test_labels, knn_preds, out_dir=out_dir)
    print(f'  kNN accuracy: {clf_metrics["accuracy"]:.4f}  macro_f1: {clf_metrics["macro_f1"]:.4f}')

    # Few-shot
    print('Few-shot evaluation...')
    fs_results = few_shot_eval(
        train_embs, train_labels, test_embs, test_labels,
        eta_values=ev_cfg['fewshot_eta_values'],
        repeats=ev_cfg['fewshot_repeats'],
        num_classes=ds_cfg['num_categories'],
        embedding_dim=ds_cfg['embedding_dim'],
    )

    # CPU latency
    print('Measuring CPU inference latency...')
    model.to('cpu')
    sample = ds_test[0]
    pkt = sample['packet_seq'].unsqueeze(0)
    ctx = sample['flow_ctx'].unsqueeze(0)
    msk = sample['padding_mask'].unsqueeze(0)
    latencies = []
    for _ in range(ev_cfg['latency_trials']):
        t0 = time.perf_counter()
        with torch.no_grad():
            model.forward_downstream(pkt, ctx, msk)
        latencies.append((time.perf_counter() - t0) * 1000)
    latencies = np.array(latencies)
    print(f'  p50={np.percentile(latencies,50):.2f}ms  '
          f'p95={np.percentile(latencies,95):.2f}ms  '
          f'p99={np.percentile(latencies,99):.2f}ms')

    print('\n=== KPI Summary ===')
    print(f'  intra cosine > 0.7: {sim_metrics["intra_mean"]:.3f} (target > 0.7)')
    print(f'  inter cosine < 0.3: {sim_metrics["inter_mean"]:.3f} (target < 0.3)')
    print(f'  kNN accuracy:       {clf_metrics["accuracy"]:.3f} (target >= 0.85)')
    eta7 = fs_results.get(7, {})
    print(f'  few-shot eta=7:     {eta7.get("mean",0):.3f} (target >= 0.80)')
    print(f'  latency p95:        {np.percentile(latencies,95):.1f}ms (target < 100ms)')


if __name__ == '__main__':
    main()
