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
    p.add_argument('--pretrain', type=float, default=_defaults.get('pretrain_split', 0.70))
    p.add_argument('--downstream', type=float, default=_defaults.get('downstream_split', 0.15))
    p.add_argument('--min_packets',  type=int,   default=_defaults.get('min_packets', 5),
                   help='flows with fewer real packets are discarded (lower = more, shorter flows)')
    p.add_argument('--max_packets',  type=int,   default=_defaults.get('max_packets', 64))
    p.add_argument('--flow_timeout', type=float, default=_defaults.get('flow_timeout_seconds', 30))
    p.add_argument('--seed',     type=int,   default=42)
    args = p.parse_args()

    run_pipeline(args.raw_dir, args.out_dir,
                 pretrain_frac=args.pretrain,
                 downstream_frac=args.downstream,
                 min_packets=args.min_packets,
                 max_packets=args.max_packets,
                 flow_timeout=args.flow_timeout,
                 seed=args.seed)


if __name__ == '__main__':
    main()
