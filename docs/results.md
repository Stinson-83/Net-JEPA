# 5 · Results

All numbers are on the **held-out test split** of the final 8-class checkpoint
(`checkpoints/traffic8/phase3/final.pt`, 8 common traffic types). No cherry-picking — the
hard cases are on the table.

## 5.1 Headline KPIs

| Benchmark KPI | Target | Achieved |
|---|---|---|
| Intra-class cosine | > 0.7 | **0.94** (97.2% of pairs > 0.7) ✅ |
| Inter-class cosine | < 0.3 | **−0.01** (87.6% of pairs < 0.3) ✅ |
| Accuracy | ≥ 90% | **97.7%** ✅ |
| Macro-F1 | — | **0.954** |
| Generalization (few-shot, η=7) | ≥ 85% | **97.6%** ✅ |
| Real-time latency / flow | < 100 ms | **4.1 ms** CPU (p95) ✅ |

silhouette **0.70** · 8 traffic types · 128-D embedding · 28,892 flows (20,224 pretrain /
4,333 downstream-train / 4,335 test).

## 5.2 Per-class F1

| Traffic type | F1 | precision | recall |
|---|---|---|---|
| Metaverse / XR | **0.995** | 0.993 | 0.997 |
| Online gaming | **0.991** | 0.987 | 0.995 |
| Live streaming | **0.985** | 0.997 | 0.973 |
| Audio streaming | **0.975** | 0.991 | 0.958 |
| Video on demand | **0.959** | 0.954 | 0.963 |
| Web browsing | **0.945** | 0.955 | 0.936 |
| Cloud gaming | **0.899** | 0.843 | 0.964 |
| Video conferencing | **0.885** | 0.906 | 0.865 |

Cloud gaming and video conferencing are the hardest — they are the two rarest captured
classes (111 test flows each) and overlap with online gaming / live streaming respectively.
Every class now clears 0.88.

## 5.3 The fix that drove the numbers: per-capture host stats

The single change that moved the model from **0.86 → 0.977** was making the host-behaviour
features (`n_dst_ips`, `n_dst_ports`, `n_src_ports`, `conn_per_sec` in `flow_context`)
**per-capture** instead of global. Computing them over *all* flows at once merged a reused
testbed client IP's destinations across every app's capture — so the same inflated values
appeared on flows of different classes, making the feature non-discriminative *and*
impossible to reproduce at inference (a single uploaded pcap can't recreate "destinations
summed across every training app"). Computing them per `source_file` made the feature both
meaningful (video-conf contacts ~1 peer; web browsing contacts many) and identical between
training and inference.

| Metric | Global host stats (before) | Per-capture (after) |
|---|---|---|
| kNN accuracy | 0.860 | **0.977** |
| macro-F1 | 0.791 | **0.954** |
| intra cosine (frac > 0.7) | 0.798 | **0.972** |
| inter cosine (mean) | 0.103 | **−0.008** |
| silhouette | 0.374 | **0.703** |

Verified genuine, not leakage: a leak-free kNN that excludes same-capture neighbours still
scores **0.9767**, and 1-shot accuracy is already **0.974**.

## 5.4 Embedding separation (the cosine proof)

Cosine similarity of flow pairs: different-class pairs collapse near **−0.01** (near
orthogonal), same-class pairs sit near **0.94** — a wide, clean gap. That gap *is* the
classifier; the cosine k-NN just reads it. Reaching it required:

1. **Category-level SupCon** on the L2-normalised embedding (separates directions).
2. **α-centering** to remove the anisotropic common-mode (drops absolute inter-cosine < 0.3).
3. **Per-capture, inference-consistent features** (§5.3) so the geometry the model learns is
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

- **In-domain few-shot** (held-out flows, η=7 labelled/class): **97.6%**.
- **Real held-out captures** of the same traffic types (the table above): correct dominant
  class even across a capture-tool/domain shift (browser QUIC vs VLC/Kaggle).
- **Single-flow snippets** are the known weak spot: a pcap with only *one* flow yields
  degenerate host stats (`n_dst_ips=1`) unlike any multi-flow training capture and can
  misclassify. Real captures contain many flows and work; this is a property of the feature,
  reported rather than hidden.

## 5.7 Efficiency

- **4.1 ms / flow on CPU** (p95; p50 3.1 ms, p99 7.6 ms). No GPU required to serve.
- Model is small (~1.76 M parameters); the live server holds the whole pipeline in memory.

## 5.8 What we'd do with more time

- Per-app (finer-grained) heads on top of the 8-type category embedding.
- Domain-diverse pretraining (e.g. CESNET-QUIC22) to further harden out-of-domain captures —
  though the per-capture-host-stats fix already closed the gap that motivated it.
- Conditional domain adaptation (CDAN/MDD) for true cross-deployment transfer.
