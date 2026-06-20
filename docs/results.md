# 5 · Results

All numbers are on the **held-out test split** of the final 8-class checkpoint
(`checkpoints/traffic8/phase3/final.pt`, 8 common traffic types). The model uses a
**full-supervision 70/70/30 split**: it self-pretrains on the 70% train set and is
supervised (SupCon + k-NN) on that **same** 70%; the held-out **30%** is for evaluation
only. No cherry-picking — the hard cases are on the table.

## 5.1 Headline KPIs

| Benchmark KPI | Target | Achieved |
|---|---|---|
| Intra-class cosine | > 0.7 | **0.98** ✅ |
| Inter-class cosine | < 0.3 | **−0.04** ✅ |
| Accuracy | ≥ 90% | **99.7%** ✅ |
| Macro-F1 | — | **0.992** |
| Generalization (few-shot, η=7) | ≥ 85% | **99.6%** ✅ |
| Real-time latency / flow | < 100 ms | **3.5 ms** CPU (p95) ✅ |

silhouette **0.87** · 8 traffic types · 128-D embedding · 28,892 flows (**20,224 train**
[pretrain = downstream] / **8,668 test**).

## 5.2 Per-class F1 (held-out 30% test, 8,668 flows)

| Traffic type | F1 | precision | recall |
|---|---|---|---|
| Metaverse / XR | **1.000** | 1.000 | 0.999 |
| Audio streaming | **0.998** | 0.996 | 1.000 |
| Live streaming | **0.998** | 0.997 | 0.999 |
| Online gaming | **0.998** | 0.999 | 0.997 |
| Video on demand | **0.993** | 0.992 | 0.995 |
| Web browsing | **0.993** | 0.994 | 0.991 |
| Video conferencing | **0.986** | 0.986 | 0.986 |
| Cloud gaming | **0.971** | 0.969 | 0.973 |

Cloud gaming and video conferencing remain the hardest (they're the two rarest classes,
222 test flows each, overlapping with online gaming / live streaming) — but with full
supervision both now clear **0.97**.

## 5.3 What drove the numbers — two changes

**(a) Per-capture host stats (0.86 → 0.977).** The host-behaviour features
(`n_dst_ips`, `n_dst_ports`, `n_src_ports`, `conn_per_sec` in `flow_context`) were
originally computed *globally* over all flows, which merged a reused testbed client IP's
destinations across every app — making the feature non-discriminative *and* impossible to
reproduce at inference (a single uploaded pcap can't recreate "destinations summed across
every training app"). Computing them **per `source_file`** made the feature both meaningful
and identical between training and inference — and fixed real-`.pcap` upload.

**(b) Full supervision, 70/70/30 (0.977 → 0.997).** Using the **entire** 70% train set for
SupCon + the k-NN (instead of a 15% labeled slice) gives a denser, better-covered embedding —
most of the lift is the two hard classes (cloud_gaming, video_conferencing).

| Metric | Global stats, 70/15/15 | Per-capture, 70/15/15 | **Per-capture, 70/70/30 (final)** |
|---|---|---|---|
| kNN accuracy | 0.860 | 0.977 | **0.997** |
| macro-F1 | 0.791 | 0.954 | **0.992** |
| intra cosine | 0.798 | 0.972 | **0.983** |
| inter cosine | 0.103 | −0.008 | **−0.040** |
| silhouette | 0.374 | 0.703 | **0.872** |

**Verified genuine, not leakage.** A leak-free k-NN that *excludes every same-capture
neighbour* still scores **0.996** (vs naive 0.997) on the same held-out test — so the result
is real generalization to unseen flows, not a per-capture-fingerprint shortcut. 1-shot
accuracy is already **0.97**.

## 5.4 Embedding separation (the cosine proof)

Cosine similarity of flow pairs: different-class pairs collapse near **−0.04** (near
orthogonal), same-class pairs sit near **0.98** — a wide, clean gap. That gap *is* the
classifier; the cosine k-NN just reads it. Reaching it required:

1. **Traffic-type SupCon** on the L2-normalised embedding (separates directions).
2. **α-centering** to remove the anisotropic common-mode (drops absolute inter-cosine < 0.3).
3. **Per-capture, inference-consistent features** (§5.3a) so the geometry the model learns is
   the geometry it sees at serving time.

## 5.5 Real-pcap inference — measured end-to-end

The pipeline that builds flows from a raw `.pcap` is identical to training (§datasets), so
the trained classes transfer to real captures. Running raw captures through
`infer_pcap.py` (packet-weighted dominant class):

| Capture | Result |
|---|---|
| `netflix_linux_20m_01.pcapng` (VOD source) | **video_on_demand 99%** ✅ |
| `spotify_windows_30m_02.pcapng` (audio source) | **audio_streaming 97%** ✅ |
| `xbox_fortnite_*.pcap` (cloud-gaming source) | **cloud_gaming 89%** ✅ |
| `youtube_video.pcap` (**browser QUIC, never in training**) | **video_on_demand** ✅ |

The last row is the important one: a held-out Chrome-native QUIC capture — a different
domain from the VLC/Kaggle testbeds — still resolves to `video_on_demand`, with the
remainder correctly split into `web_browsing` (page loads, thumbnails, ads, telemetry that a
real browser session genuinely produces).

## 5.6 Generalization — measured honestly

- **In-domain few-shot** (held-out flows, η=7 labelled/class): **99.6%**; even η=1 (one
  labelled flow per class) is ~0.97.
- **Leak-free** (same-capture neighbours removed from the k-NN): **0.996** — the gain is real,
  not a capture fingerprint.
- **Real held-out captures** of the same traffic types (§5.5): correct dominant class even
  across a capture-tool/domain shift (browser QUIC vs VLC/Kaggle).
- **Single-flow snippets** are the known weak spot: a pcap with only *one* flow yields
  degenerate host stats (`n_dst_ips=1`) unlike any multi-flow training capture and can
  misclassify. Real captures contain many flows and work; reported rather than hidden.

## 5.7 Efficiency

- **3.5 ms / flow on CPU** (p95; p50 ~3 ms). No GPU required to serve.
- Model is small (~1.76 M parameters); the live server holds the whole pipeline in memory.

## 5.8 What we'd do with more time

- Per-app (finer-grained) heads on top of the 8-type category embedding.
- Domain-diverse pretraining (e.g. CESNET-QUIC22) to further harden *out-of-domain* captures —
  the in-domain task is essentially saturated (0.997); OOD is the remaining frontier.
- Conditional domain adaptation (CDAN/MDD) for true cross-deployment transfer.
