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
    p.add_argument('--phase2_ckpt',  default='checkpoints/phase2/final.pt')
    p.add_argument('--ckpt_dir',     default='checkpoints/phase2b')
    p.add_argument('--epochs',       type=int,   default=30)
    p.add_argument('--lr_encoder',   type=float, default=1e-5)
    p.add_argument('--lr_head',      type=float, default=1e-3)
    p.add_argument('--temperature',  type=float, default=0.07)
    p.add_argument('--device',       default='cuda')
    p.add_argument('--wandb',        action='store_true')
    args = p.parse_args()

    with open(args.config) as f:
        cfg = yaml.safe_load(f)

    data_cfg  = cfg['data']
    model_cfg = cfg['model']
    ds_cfg    = cfg['downstream']

    train_phase2b(
        processed_dir=args.processed_dir or data_cfg['processed_dir'],
        ckpt_dir=args.ckpt_dir,
        phase2_ckpt=args.phase2_ckpt,
        epochs=args.epochs,
        lr_encoder=args.lr_encoder,
        lr_head=args.lr_head,
        temperature=args.temperature,
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


if __name__ == '__main__':
    main()
