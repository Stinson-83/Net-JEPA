"""Preprocess the Kaggle 5G Traffic Dataset into Parquet splits."""
import argparse
import sys
import yaml
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from netjepa.data.preprocess import run_pipeline

_CFG = Path(__file__).resolve().parents[2] / 'netjepa/configs/default.yaml'
with open(_CFG) as _f:
    _defaults = yaml.safe_load(_f)['data']


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raw_dir',  default=_defaults['raw_data_dir'])
    p.add_argument('--out_dir',  default=_defaults['processed_dir'])
    p.add_argument('--pretrain', type=float, default=0.70)
    p.add_argument('--downstream', type=float, default=0.15)
    p.add_argument('--seed',     type=int,   default=42)
    args = p.parse_args()

    run_pipeline(args.raw_dir, args.out_dir,
                 pretrain_frac=args.pretrain,
                 downstream_frac=args.downstream,
                 seed=args.seed)


if __name__ == '__main__':
    main()
