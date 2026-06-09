"""Launch Phase 2b supervised contrastive fine-tuning."""
import argparse
import sys
import yaml
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from netjepa.training.phase2b import train_phase2b


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--config',       default='netjepa/configs/default.yaml')
    p.add_argument('--processed_dir', default=None)
    # Lean on SupCon: initialise from the Phase 1 encoder directly (the
    # unsupervised Phase 2 contrastive refinement didn't help separation).
    p.add_argument('--init_ckpt',    default='checkpoints/phase1/final.pt')
    p.add_argument('--ckpt_dir',     default='checkpoints/phase2b')
    p.add_argument('--epochs',       type=int,   default=None)
    p.add_argument('--lr_encoder',   type=float, default=None)
    p.add_argument('--lr_head',      type=float, default=None)
    p.add_argument('--temperature',  type=float, default=None)
    p.add_argument('--center_alpha', type=float, default=None,
                   help='common-mode removal strength (0 disables; ~0.65 hits the cosine KPI)')
    p.add_argument('--no_balanced',  action='store_true',
                   help='disable class-balanced sampling (on by default)')
    p.add_argument('--device',       default='cuda')
    p.add_argument('--wandb',        action='store_true')
    args = p.parse_args()

    with open(args.config) as f:
        cfg = yaml.safe_load(f)

    data_cfg  = cfg['data']
    model_cfg = cfg['model']
    ds_cfg    = cfg['downstream']
    tr_cfg    = cfg.get('training', {})

    train_phase2b(
        processed_dir=args.processed_dir or data_cfg['processed_dir'],
        ckpt_dir=args.ckpt_dir,
        init_ckpt=args.init_ckpt,
        epochs=args.epochs if args.epochs is not None else tr_cfg.get('phase2b_epochs', 30),
        lr_encoder=args.lr_encoder if args.lr_encoder is not None else tr_cfg.get('lr_phase2b_encoder', 1e-4),
        lr_head=args.lr_head if args.lr_head is not None else tr_cfg.get('lr_phase2b_head', 1e-3),
        temperature=args.temperature if args.temperature is not None else tr_cfg.get('supcon_temperature', 0.07),
        center_alpha=args.center_alpha if args.center_alpha is not None else ds_cfg.get('center_alpha', 0.65),
        embedding_dim=ds_cfg['embedding_dim'],
        balanced=not args.no_balanced,
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
