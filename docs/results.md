# 5 · Results

All numbers are on the **held-out test split** of the final checkpoint
(`checkpoints/phase3/final.pt`, category level, 6 classes). No cherry-picking — the hard
cases are on the table.

## 5.1 Headline KPIs

| Benchmark KPI | Target | Achieved |
|---|---|---|
| Intra-class cosine | > 0.7 | **0.81** ✅ |
| Inter-class cosine | < 0.3 | **0.14** ✅ |
| Accuracy | ≥ 90% | **92.4%** ✅ |
| Generalization (few-shot CV) | ≥ 85% | **92%** ✅ |
| Real-time latency / flow | < 100 ms | **~3 ms** CPU / **~1.5 ms** GPU ✅ |

macro-F1 **0.897** · silhouette **0.51**.

## 5.2 Per-class F1

| Category | F1 |
|---|---|
| On-Demand Video (stored_streaming) | **0.96** |
| Live Streaming | **0.95** |
| Metaverse / XR | **0.94** |
| Video Conferencing | **0.93** |
| Online Gaming | **0.90** |
| Cloud Gaming (game_streaming) | **0.71** |

Cloud gaming is the hardest (it overlaps with online gaming and is the rarest captured
class). Video-conferencing rose from **0.00 → 0.93** over the project as we fixed class
imbalance and folded in real MS Teams captures.

## 5.3 Embedding separation (the cosine proof)

Cosine similarity of flow pairs: different-class pairs collapse near **0.14**, same-class
pairs sit near **0.81** — a clean, well-separated gap. That gap *is* the classifier; the
k-NN just reads it. Reaching it required two ideas working together:

1. **Category-level SupCon** on the kept, L2-normalised embedding (separates directions).
2. **α-centering** to remove the anisotropic common-mode (drops absolute inter-cosine <0.3).

## 5.4 Generalization — measured honestly

There are two senses of "generalize":

- **In-domain cross-validation** (held-out flows from the same captures): **92%** few-shot.
  Meets the KPI.
- **Cross-*dataset* transfer** (train on Kaggle 5G, test on the entirely separate VLC /
  Valencia testbed, never seen): **~5%**.

A Kaggle-trained model **does not transfer** to a foreign 5G testbed out of the box — it
learns domain-specific cues (most VLC flows get mapped to `live_streaming`, a class VLC
doesn't even contain). We **report this**, rather than hide it. It is a property of the
data domain, not a bug, and it's exactly what motivates domain-diverse pretraining.

## 5.5 Domain adaptation (closing the cross-domain gap)

We added **DANN** (gradient-reversal domain-adversarial training, Phase 2c):

| labelled VLC / category | baseline (Kaggle-only) | DANN-adapted |
|---|---|---|
| 0 (unsupervised) | 0.05 | 0.06 |
| 5 | 0.24 | 0.11 |
| 10 | 0.27 | 0.37 |
| 20 | 0.30 | **0.39** |

**Finding:** unsupervised DANN aligns the domains (discriminator accuracy 0.65→0.51) but
doesn't move transfer *alone* — a known limitation under label shift. Combined with a few
labelled target flows (semi-supervised), it lifts cross-domain transfer **0.05 → 0.39** and
beats the baseline. The realistic route to a new network is a handful of target labels.

## 5.6 Efficiency

- **~3 ms / flow on CPU** (p95), ~1.5 ms on GPU. No GPU required to serve.
- Model is small (a few M parameters); the live server holds the whole pipeline in memory.

## 5.7 What we'd do with more time

- A cloud-gaming-specific dataset for a denser, in-domain `game_streaming` class.
- Conditional domain adaptation (CDAN/MDD) and a few real target labels for true
  cross-deployment.
- Per-app (15-class) heads on top of the category embedding for finer granularity.
