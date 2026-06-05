from __future__ import annotations
import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset

from .augment import degrade_flow


class FlowDataset(Dataset):
    def __init__(self, parquet_path: str, augment: bool = False,
                 aug_kwargs: dict | None = None):
        self.df = pd.read_parquet(parquet_path)
        self.augment    = augment
        self.aug_kwargs = aug_kwargs or {}

    def __len__(self) -> int:
        return len(self.df)

    def __getitem__(self, idx: int) -> dict:
        row = self.df.iloc[idx]

        pkt_seq  = np.asarray([list(r) for r in row['packet_sequence']], dtype=np.float32)
        flow_ctx = np.asarray(list(row['flow_context']),                dtype=np.float32)
        pad_mask = np.asarray(list(row['padding_mask']),                dtype=bool)

        app_label      = int(row['app_label'])
        category_label = int(row['category_label'])

        if self.augment:
            deg_seq, _deg_ctx, deg_mask = degrade_flow(
                pkt_seq, flow_ctx, pad_mask, **self.aug_kwargs)
            return {
                'clean_packet_seq':    torch.from_numpy(pkt_seq),
                'clean_flow_ctx':      torch.from_numpy(flow_ctx),
                'clean_padding_mask':  torch.from_numpy(pad_mask),
                'deg_packet_seq':      torch.from_numpy(deg_seq),
                'deg_padding_mask':    torch.from_numpy(deg_mask),
                'app_label':           torch.tensor(app_label,      dtype=torch.long),
                'category_label':      torch.tensor(category_label, dtype=torch.long),
                'flow_idx':            torch.tensor(idx,            dtype=torch.long),
            }

        return {
            'packet_seq':    torch.from_numpy(pkt_seq),
            'flow_ctx':      torch.from_numpy(flow_ctx),
            'padding_mask':  torch.from_numpy(pad_mask),
            'app_label':     torch.tensor(app_label,      dtype=torch.long),
            'category_label':torch.tensor(category_label, dtype=torch.long),
            'flow_idx':      torch.tensor(idx,            dtype=torch.long),
        }
