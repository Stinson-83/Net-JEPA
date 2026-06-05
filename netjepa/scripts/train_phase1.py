"""Launch Phase 1 self-supervised pretraining."""
import argparse
import sys
import yaml
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from netjepa.training.phase1 import train_phase1


def _load_cfg(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--config', default='netjepa/configs/default.yaml')
    p.add_argument('--processed_dir', default=None)
    p.add_argument('--ckpt_dir',      default='checkpoints/phase1')
    p.add_argument('--device',        default='cuda')
    p.add_argument('--wandb',         action='store_true')
    args = p.parse_args()

    cfg = _load_cfg(args.config)
    data_cfg  = cfg['data']
    model_cfg = cfg['model']
    tr_cfg    = cfg['training']
    loss_cfg  = cfg['loss']
    aug_cfg   = cfg.get('augmentation', {})

    processed_dir = args.processed_dir or data_cfg['processed_dir']

    train_phase1(
        processed_dir=processed_dir,
        ckpt_dir=args.ckpt_dir,
        epochs=tr_cfg['phase1_epochs'],
        batch_size=tr_cfg['batch_size'],
        lr=tr_cfg['lr_phase1'],
        weight_decay=tr_cfg['weight_decay'],
        device_str=args.device,
        vicreg_alpha=loss_cfg['vicreg_alpha'],
        vicreg_beta=loss_cfg['vicreg_beta'],
        vicreg_gamma=loss_cfg['vicreg_gamma'],
        lambda1=loss_cfg['lambda1'],
        lambda2=loss_cfg['lambda2'],
        dbscan_eps=tr_cfg['dbscan_eps'],
        dbscan_min_samples=tr_cfg['dbscan_min_samples'],
        dbscan_refresh=tr_cfg['dbscan_refresh_phase1'],
        dbscan_start=tr_cfg['dbscan_start_epoch'],
        dbscan_subsample=tr_cfg['dbscan_subsample_fraction'],
        use_wandb=args.wandb,
        aug_kwargs=aug_cfg,
        # model kwargs
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
