"""Full preprocessing pipeline: raw CSVs → Parquet splits."""
from __future__ import annotations
import json
import random
from pathlib import Path
from collections import defaultdict

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from tqdm import tqdm

from .parser       import parse_csv
from .flow_builder import extract_flows
from .rtt          import extract_rtt
from .features     import (compute_packet_sequence, compute_flow_context,
                           compute_src_host_stats)

APP_LABELS = [
    'geforce_now', 'kt_gamebox', 'afreecatv', 'naver_now', 'youtube_live',
    'roblox', 'zepeto', 'battleground', 'tft', 'amazon_prime',
    'netflix', 'youtube', 'google_meet', 'ms_teams', 'zoom',
]
CATEGORY_LABELS = [
    'game_streaming', 'live_streaming', 'metaverse',
    'online_game', 'stored_streaming', 'video_conferencing',
]

FOLDER_MAP = {
    'GeForce_Now':        ('geforce_now',  'game_streaming'),
    'KT_GameBox':         ('kt_gamebox',   'game_streaming'),
    'AfreecaTV':          ('afreecatv',    'live_streaming'),
    'Naver_NOW':          ('naver_now',    'live_streaming'),
    'YouTube_Live':       ('youtube_live', 'live_streaming'),
    'Roblox':             ('roblox',       'metaverse'),
    'Zepeto':             ('zepeto',       'metaverse'),
    'Battleground':       ('battleground', 'online_game'),
    'Teamfight_Tactics':  ('tft',          'online_game'),
    'Amazon_Prime':       ('amazon_prime', 'stored_streaming'),
    'Netflix':            ('netflix',      'stored_streaming'),
    'YouTube':            ('youtube',      'stored_streaming'),
    'Google_Meet':        ('google_meet',  'video_conferencing'),
    'MS_Teams':           ('ms_teams',     'video_conferencing'),
    'Zoom':               ('zoom',         'video_conferencing'),
}

APP2ID  = {a: i for i, a in enumerate(APP_LABELS)}
CAT2ID  = {c: i for i, c in enumerate(CATEGORY_LABELS)}


def run_pipeline(raw_dir: str, out_dir: str,
                 pretrain_frac: float = 0.70,
                 downstream_frac: float = 0.15,
                 seed: int = 42) -> None:
    raw_path = Path(raw_dir)
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # ── STEP 1+2: parse CSVs and build flows ──────────────────────────────
    # Build a flat name→path index for all sub-directories (any nesting depth)
    _dir_index: dict[str, Path] = {}
    for p in raw_path.rglob('*'):
        if p.is_dir():
            _dir_index[p.name] = p

    all_flows = []
    for app_folder, (app_lbl, cat_lbl) in FOLDER_MAP.items():
        folder = _dir_index.get(app_folder)
        if folder is None or not folder.exists():
            print(f'[WARN] folder not found: {app_folder}')
            continue

        for csv_file in tqdm(sorted(folder.glob('*.csv')),
                             desc=f'{app_lbl}', leave=False):
            try:
                df = parse_csv(csv_file, app_lbl, cat_lbl)
                flows = extract_flows(df, app_lbl, cat_lbl, str(csv_file))
                all_flows.extend(flows)
            except Exception as e:
                print(f'[WARN] {csv_file}: {e}')

    print(f'Total flows (before filter): {len(all_flows)}')

    # ── STEP 3: RTT extraction ─────────────────────────────────────────────
    for flow in tqdm(all_flows, desc='RTT extraction'):
        rtt, valid = extract_rtt(flow['packets'], flow['client_ip'])
        flow['rtt']       = rtt
        flow['rtt_valid'] = valid

    # ── Pre-compute per-source-host stats ──────────────────────────────────
    src_stats = compute_src_host_stats(all_flows)

    # ── STEP 4: feature extraction ─────────────────────────────────────────
    records = []
    for i, flow in enumerate(tqdm(all_flows, desc='Feature extraction')):
        pkt_seq, pad_mask = compute_packet_sequence(
            flow['packets'], flow['client_ip'],
            flow['rtt'], flow['rtt_valid'])
        flow_ctx = compute_flow_context(
            flow['packets'], flow['client_ip'],
            flow['rtt'], flow['rtt_valid'],
            src_stats)
        records.append({
            'packet_sequence': pkt_seq.tolist(),
            'padding_mask':    pad_mask.tolist(),
            'flow_context':    flow_ctx.tolist(),
            'app_label':       APP2ID[flow['app_label']],
            'category_label':  CAT2ID[flow['category_label']],
            'rtt_valid':       flow['rtt_valid'],
            'source_file':     flow['source_file'],
        })

    df_all = pd.DataFrame(records)
    print(f'Total flows (processed): {len(df_all)}')

    # ── STEP 5: stratified splits ──────────────────────────────────────────
    from collections import Counter
    labels = df_all['app_label'].values
    indices = np.arange(len(df_all))

    # Classes with only 1 sample can't be stratified — force them into pretrain
    label_counts = Counter(labels)
    rare_mask = np.array([label_counts[l] < 2 for l in labels])
    rare_indices = indices[rare_mask]
    normal_indices = indices[~rare_mask]
    if len(rare_indices):
        rare_apps = [APP_LABELS[l] for l in set(labels[rare_mask])]
        print(f'[INFO] {len(rare_indices)} flows from under-sampled classes '
              f'forced into pretrain: {rare_apps}')

    normal_labels = labels[normal_indices]
    idx_pre_normal, idx_rest = train_test_split(
        normal_indices, test_size=1 - pretrain_frac,
        stratify=normal_labels, random_state=seed)
    idx_pre = np.concatenate([idx_pre_normal, rare_indices])

    rest_labels = labels[idx_rest]
    rest_label_counts = Counter(rest_labels)
    rare_rest_mask = np.array([rest_label_counts[l] < 2 for l in rest_labels])
    rare_rest = idx_rest[rare_rest_mask]
    normal_rest = idx_rest[~rare_rest_mask]
    if len(rare_rest):
        idx_pre = np.concatenate([idx_pre, rare_rest])

    ds_frac_of_rest = downstream_frac / (1 - pretrain_frac)
    normal_rest_labels = labels[normal_rest]
    idx_ds, idx_test = train_test_split(
        normal_rest, test_size=1 - ds_frac_of_rest,
        stratify=normal_rest_labels, random_state=seed)

    splits = {'pretrain': idx_pre.tolist(),
              'downstream_train': idx_ds.tolist(),
              'test': idx_test.tolist()}

    with open(out_path / 'splits.json', 'w') as f:
        json.dump(splits, f)

    df_all.iloc[idx_pre].reset_index(drop=True).to_parquet(
        out_path / 'pretrain.parquet')
    df_all.iloc[idx_ds].reset_index(drop=True).to_parquet(
        out_path / 'downstream_train.parquet')
    df_all.iloc[idx_test].reset_index(drop=True).to_parquet(
        out_path / 'test.parquet')

    # ── Few-shot subsets ───────────────────────────────────────────────────
    rng = random.Random(seed)
    ds_df = df_all.iloc[idx_ds].reset_index(drop=True)
    for eta in [1, 3, 5, 7, 10]:
        per_class = defaultdict(list)
        for i, row in ds_df.iterrows():
            per_class[row['app_label']].append(i)
        chosen = []
        for cls, idxs in per_class.items():
            chosen.extend(rng.sample(idxs, min(eta, len(idxs))))
        ds_df.iloc[chosen].reset_index(drop=True).to_parquet(
            out_path / f'fewshot_eta{eta}.parquet')

    print(f'Saved splits to {out_path}')
    print(f'  pretrain:          {len(idx_pre)}')
    print(f'  downstream_train:  {len(idx_ds)}')
    print(f'  test:              {len(idx_test)}')
