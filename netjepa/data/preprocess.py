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
from .flow_builder import extract_flows, MIN_PACKETS, MAX_PACKETS, FLOW_TIMEOUT
from .rtt          import extract_rtt
from .features     import (compute_packet_sequence, compute_flow_context,
                           compute_src_host_stats)
from ..utils.logging import get_logger

_log = get_logger('data.preprocess')

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
    # ── VLC (Valencia) dataset — optional, produced by convert_vlc_pcap.py ──
    # Reuse existing app labels so the 6-category schema is unchanged. Only the
    # apps that map cleanly are included; Roblox is filed under metaverse (our
    # taxonomy, not VLC's "gaming"). Folders absent → preprocess just skips them.
    'VLC_Netflix':        ('netflix',      'stored_streaming'),
    'VLC_Prime':          ('amazon_prime', 'stored_streaming'),
    'VLC_YouTube':        ('youtube',      'stored_streaming'),
    'VLC_Teams':          ('ms_teams',     'video_conferencing'),
    'VLC_Roblox':         ('roblox',       'metaverse'),
}

APP2ID  = {a: i for i, a in enumerate(APP_LABELS)}
CAT2ID  = {c: i for i, c in enumerate(CATEGORY_LABELS)}

# Folders whose flows are used for self-supervised PRETRAINING ONLY — never the
# supervised downstream_train / test sets. The out-of-domain VLC streaming apps
# add useful representation diversity in Phase 1, but putting them in the
# *labelled* set created a domain confound (the model learned VLC-testbed
# artifacts and confused VLC-Teams video-conf with VLC-Netflix stored-streaming).
# VLC_Teams is deliberately NOT here: it splits normally to boost video_conf.
PRETRAIN_ONLY_FOLDERS = {'VLC_Netflix', 'VLC_Prime', 'VLC_YouTube', 'VLC_Roblox'}


def run_pipeline(raw_dir: str, out_dir: str,
                 pretrain_frac: float = 0.70,
                 downstream_frac: float = 0.15,
                 min_packets: int = MIN_PACKETS,
                 max_packets: int = MAX_PACKETS,
                 flow_timeout: float = FLOW_TIMEOUT,
                 seed: int = 42) -> None:
    raw_path = Path(raw_dir)
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    _log.info('flow thresholds: min_packets=%d  max_packets=%d  flow_timeout=%.0fs',
              min_packets, max_packets, flow_timeout)

    # ── STEP 1+2: parse CSVs and build flows ──────────────────────────────
    # Build a flat name→path index for all sub-directories (any nesting depth)
    _dir_index: dict[str, Path] = {}
    for p in raw_path.rglob('*'):
        if p.is_dir():
            _dir_index[p.name] = p

    all_flows = []
    total_dropped = 0
    per_app_kept: dict[str, int] = defaultdict(int)
    for app_folder, (app_lbl, cat_lbl) in FOLDER_MAP.items():
        folder = _dir_index.get(app_folder)
        if folder is None or not folder.exists():
            _log.warning('folder not found: %s', app_folder)
            continue

        for csv_file in tqdm(sorted(folder.glob('*.csv')),
                             desc=f'{app_lbl}', leave=False):
            try:
                df = parse_csv(csv_file, app_lbl, cat_lbl)
                flows, n_dropped = extract_flows(
                    df, app_lbl, cat_lbl, str(csv_file),
                    min_packets=min_packets, max_packets=max_packets,
                    flow_timeout=flow_timeout)
                all_flows.extend(flows)
                total_dropped += n_dropped
                per_app_kept[app_lbl] += len(flows)
            except Exception as e:
                _log.warning('%s: %s', csv_file, e)

    _log.info('Total flows kept: %d  (dropped %d with <%d packets)',
              len(all_flows), total_dropped, min_packets)
    for app in APP_LABELS:
        _log.info('  %-14s %5d flows', app, per_app_kept.get(app, 0))

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
    _log.info('Total flows (processed): %d', len(df_all))

    # ── STEP 5: stratified splits ──────────────────────────────────────────
    from collections import Counter
    labels = df_all['app_label'].values
    indices = np.arange(len(df_all))
    src = df_all['source_file'].astype(str).values

    # Pretrain-only flows (out-of-domain VLC apps): routed entirely to pretrain,
    # excluded from the supervised downstream/test sets to avoid a domain confound.
    pretrain_only_mask = np.array(
        [any(folder in s for folder in PRETRAIN_ONLY_FOLDERS) for s in src])
    pretrain_only_idx = indices[pretrain_only_mask]
    if len(pretrain_only_idx):
        _log.info('%d flows from pretrain-only folders → pretrain (not supervised)',
                  len(pretrain_only_idx))

    # Only the remaining (Kaggle + VLC_Teams) flows are split into the labelled sets.
    splittable = indices[~pretrain_only_mask]
    split_labels = labels[~pretrain_only_mask]

    # Classes with only 1 sample can't be stratified — force them into pretrain
    label_counts = Counter(split_labels)
    rare_mask = np.array([label_counts[l] < 2 for l in split_labels])
    rare_indices = splittable[rare_mask]
    normal_indices = splittable[~rare_mask]
    if len(rare_indices):
        rare_apps = [APP_LABELS[l] for l in set(split_labels[rare_mask])]
        _log.info('%d flows from under-sampled classes forced into pretrain: %s',
                  len(rare_indices), rare_apps)

    normal_labels = labels[normal_indices]
    idx_pre_normal, idx_rest = train_test_split(
        normal_indices, test_size=1 - pretrain_frac,
        stratify=normal_labels, random_state=seed)
    idx_pre = np.concatenate([idx_pre_normal, rare_indices, pretrain_only_idx])

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

    _log.info('Saved splits to %s', out_path)
    _log.info('  pretrain:          %d', len(idx_pre))
    _log.info('  downstream_train:  %d', len(idx_ds))
    _log.info('  test:              %d', len(idx_test))
