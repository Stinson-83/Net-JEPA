"""Launch Phase 3 downstream classification."""
import argparse
import sys
import yaml
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from netjepa.training.phase3 import train_phase3


def _load_cfg(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--config',        default='netjepa/configs/default.yaml')
    p.add_argument('--processed_dir', default=None)
    # Default to the SupCon-refined encoder (Phase 2b) rather than Phase 2.
    p.add_argument('--phase2_ckpt',   default='checkpoints/phase2b/final.pt')
    p.add_argument('--ckpt_dir',      default='checkpoints/phase3')
    p.add_argument('--device',        default='cuda')
    p.add_argument('--wandb',         action='store_true')
    args = p.parse_args()

    cfg = _load_cfg(args.config)
    data_cfg  = cfg['data']
    model_cfg = cfg['model']
    tr_cfg    = cfg['training']
    ds_cfg    = cfg['downstream']

    processed_dir = args.processed_dir or data_cfg['processed_dir']

    results = train_phase3(
        processed_dir=processed_dir,
        ckpt_dir=args.ckpt_dir,
        phase2_ckpt=args.phase2_ckpt,
        epochs=tr_cfg['phase3_epochs'],
        batch_size=64,
        lr=tr_cfg['lr_phase3'],
        weight_decay=tr_cfg['weight_decay'],
        num_classes=ds_cfg['num_categories'],
        embedding_dim=ds_cfg['embedding_dim'],
        device_str=args.device,
        use_wandb=args.wandb,
        d_model=model_cfg['d_model'],
        n_heads=model_cfg['n_heads'],
        n_te_layers=model_cfg['n_transformer_layers'],
        n_pred_layers=model_cfg['n_predictor_layers'],
        dim_ff=model_cfg['dim_feedforward'],
        dropout=model_cfg['dropout'],
        packet_feat_dim=model_cfg['packet_feature_dim'],
        flow_ctx_dim=model_cfg['flow_context_dim'],
    )

    print('\n=== Phase 3 Results ===')
    for k, v in results.items():
        print(f'  {k}: {v:.4f}' if isinstance(v, float) else f'  {k}: {v}')


if __name__ == '__main__':
    main()
