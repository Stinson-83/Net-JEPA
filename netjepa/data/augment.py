from __future__ import annotations
import math
import random
import numpy as np

# Packet sequence indices
IDX_IAT   = 1
IDX_RTT   = 7
IDX_RFLAG = 8

# Flow context indices
CTX_RTT   = 13
CTX_RFLAG = 14


def _scale_iats(seq: np.ndarray, alpha: float) -> np.ndarray:
    seq = seq.copy()
    # scale log-IAT back: iat_log_new = log1p(alpha * expm1(iat_log * 10)) / 10
    raw_iat = np.expm1(seq[:, IDX_IAT] * 10.0)
    new_iat = np.log1p(np.maximum(raw_iat * alpha, 0.0)) / 10.0
    seq[:, IDX_IAT] = new_iat
    return seq


def _change_rtt(seq: np.ndarray, ctx: np.ndarray,
                prob: float, alpha_min: float, alpha_max: float) -> tuple:
    if random.random() >= prob:
        return seq, ctx
    alpha = random.uniform(alpha_min, alpha_max)
    seq = _scale_iats(seq, alpha)
    ctx = ctx.copy()
    ctx[CTX_RTT] = min(ctx[CTX_RTT] * alpha, 1.0)
    return seq, ctx


def _time_shift(seq: np.ndarray, prob: float,
                b_min: float, b_max: float) -> np.ndarray:
    if random.random() >= prob:
        return seq
    b = random.uniform(b_min, b_max)
    seq = seq.copy()
    cur = np.expm1(seq[0, IDX_IAT] * 10.0)
    new_iat = max(cur + b, 0.0)
    seq[0, IDX_IAT] = math.log1p(new_iat) / 10.0
    return seq


def _packet_loss(seq: np.ndarray, mask: np.ndarray,
                 prob: float, window: float) -> tuple:
    if random.random() >= prob:
        return seq, mask
    real_indices = np.where(mask)[0]
    if len(real_indices) < 3:
        return seq, mask

    # Reconstruct approximate cumulative times from log-IATs
    iats = np.expm1(seq[:, IDX_IAT] * 10.0)
    cum_t = np.cumsum(iats)
    flow_start = cum_t[real_indices[0]]
    flow_end   = cum_t[real_indices[-1]]

    if flow_end - flow_start <= 2 * window:
        return seq, mask

    t_center = random.uniform(flow_start + window, flow_end - window)
    drop = np.abs(cum_t - t_center) <= window

    seq  = seq.copy()
    mask = mask.copy()
    seq[drop]  = 0.0
    mask[drop] = False

    # Shift remaining real packets to front
    real_new = np.where(mask)[0]
    new_seq  = np.zeros_like(seq)
    new_mask = np.zeros_like(mask)
    new_seq[:len(real_new)]  = seq[real_new]
    new_mask[:len(real_new)] = True
    return new_seq, new_mask


def _rtt_masking(seq: np.ndarray, ctx: np.ndarray, prob: float) -> tuple:
    if random.random() >= prob:
        return seq, ctx
    seq = seq.copy()
    ctx = ctx.copy()
    seq[:, IDX_RTT]   = 0.0
    seq[:, IDX_RFLAG] = 0.0
    ctx[CTX_RTT]   = 0.0
    ctx[CTX_RFLAG] = 0.0
    return seq, ctx


def degrade_flow(packet_seq: np.ndarray, flow_ctx: np.ndarray,
                 padding_mask: np.ndarray,
                 change_rtt_prob:  float = 0.8,
                 change_rtt_alpha_min: float = 0.5,
                 change_rtt_alpha_max: float = 1.5,
                 time_shift_prob:   float = 0.5,
                 time_shift_b_min:  float = -1.0,
                 time_shift_b_max:  float =  1.0,
                 packet_loss_prob:  float = 0.5,
                 packet_loss_window: float = 0.2,
                 rtt_mask_prob:     float = 0.4,
                 ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    seq  = packet_seq.copy()
    ctx  = flow_ctx.copy()
    mask = padding_mask.copy()

    seq, ctx = _change_rtt(seq, ctx, change_rtt_prob,
                           change_rtt_alpha_min, change_rtt_alpha_max)
    seq      = _time_shift(seq, time_shift_prob,
                           time_shift_b_min, time_shift_b_max)
    seq, mask = _packet_loss(seq, mask, packet_loss_prob, packet_loss_window)
    seq, ctx  = _rtt_masking(seq, ctx, rtt_mask_prob)

    return seq, ctx, mask
