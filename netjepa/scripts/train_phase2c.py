"""Launch Phase 2c domain-adversarial (DANN) fine-tuning for cross-domain transfer."""
import argparse
import sys
import yaml
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from netjepa.training.phase2c import train_phase2c


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--config',         default='netjepa/configs/default.yaml')
    p.add_argument('--processed_dir',  required=True, help='source (Kaggle) processed dir')
    p.add_argument('--target_parquet', required=True, help='unlabelled target flows (e.g. vlc_adapt.parquet)')
    p.add_argument('--init_ckpt',      required=True, help='source Phase 2b checkpoint to adapt')
    p.add_argument('--ckpt_dir',       default='checkpoints/phase2c')
    p.add_argument('--epochs',         type=int,   default=60)
    p.add_argument('--lambda_domain',  type=float, default=1.0)
    p.add_argument('--device',         default='cuda')
    p.add_argument('--wandb',          action='store_true')
    args = p.parse_args()

    with open(args.config) as f:
        cfg = yaml.safe_load(f)
    model_cfg, ds_cfg, tr_cfg = cfg['model'], cfg['downstream'], cfg['training']

    train_phase2c(
        processed_dir=args.processed_dir,
        target_parquet=args.target_parquet,
        init_ckpt=args.init_ckpt,
        ckpt_dir=args.ckpt_dir,
        epochs=args.epochs,
        lr_encoder=tr_cfg.get('lr_phase2b_encoder', 1e-4),
        lr_head=tr_cfg.get('lr_phase2b_head', 1e-3),
        temperature=tr_cfg.get('supcon_temperature', 0.05),
        lambda_domain=args.lambda_domain,
        embedding_dim=ds_cfg['embedding_dim'],
        center_alpha=ds_cfg.get('center_alpha', 0.65),
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


if __name__ == '__main__':
    main()
