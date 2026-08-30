# Overview

## The problem

Modern network traffic is almost entirely **encrypted** (TLS, QUIC). Operators can no
longer read payloads, yet they still need to know what kind of application a flow is —
to prioritise a video call over a background download, to provision 5G slices, to detect
anomalies. Deep Packet Inspection is no longer viable.

But encryption conceals a flow's *content*, not its *shape*. A Zoom call, a Netflix stream,
and a cloud-gaming session each leave a distinct pattern of packet sizes, inter-arrival times,
and direction — the **metadata encryption cannot hide**. Net-JEPA learns to classify traffic
from that shape.

## Problem statement (Samsung EnnovateX 2026, #2)

> *Context-Aware Flow Embeddings for Adaptive AI-based Network Traffic Classification.*
> Build a model that produces flow embeddings for encrypted traffic and meets fixed KPIs
> on cosine separation, accuracy, generalization, and real-time latency.

## Solution summary

Net-JEPA is a **Joint-Embedding Predictive Architecture (JEPA)** for network flows. From a
flow's first 64 packets it builds a `(64×9)` feature matrix (size, log-IAT, signed
direction, protocol one-hot, RTT) plus a 15-D flow-context vector. A Transformer encoder
learns **self-supervised** by predicting masked parts of a flow against a slow-moving EMA
"target" copy of itself (VICReg loss — no labels, no negatives). A supervised
**contrastive** fine-tune (SupCon) on the 8 traffic types, together with a **common-mode
removal** procedure (α-centering), shapes a 128-D unit-sphere embedding in which same-class
flows align and different-class flows are nearly orthogonal. A cosine **k-NN** then
classifies in ~3.3 ms (p50) on CPU.

## The eight traffic types

| Traffic type | Apps / sources | Packet signature |
|---|---|---|
| Audio Streaming | Spotify | Thin steady downstream, low rate |
| Cloud Gaming | GeForce NOW, KT GameBox, Xbox Cloud | Fat steady downstream, trickle of control up |
| Live Streaming | YouTube Live, AfreecaTV, Naver NOW | Sustained downstream in tight bursts |
| Metaverse / XR | Roblox, Zepeto | Chatty bidirectional small-packet storms |
| Online Gaming | PUBG/Battleground, Teamfight Tactics | Rapid tiny UDP datagrams, latency-first |
| Video Conferencing | Zoom, Teams, Meet | Symmetric real-time; jitter-sensitive |
| Video on Demand | Netflix, Prime, YouTube | Big chunked bursts then long silences |
| Web Browsing | general web | Bursty request/response to many hosts |

## KPIs

On a capture-level 70/30 split, the cosine-separation and latency KPIs are met; accuracy
and generalization are not.

| Benchmark KPI | Target | Achieved | How |
|---|---|---|---|
| Intra-class cosine | > 0.7 | **0.87** ✓ | Type SupCon on a kept, normalised embedding |
| Inter-class cosine | < 0.3 | **0.13** ✓ | α-centering removes the anisotropic common-mode |
| Accuracy | ≥ 90% | **75.3%** ✗ | Cosine k-NN on the isotropised embedding |
| Generalization | ≥ 85% | **77.3%** ✗ | Few-shot (η=7, held-out flows) |
| Real-time | < 100 ms | **6.5 ms** p95 (CPU) | Lightweight encoder, no GPU needed to serve |

Additionally, **macro-F1 0.680**, weighted-F1 **0.729**, and silhouette **0.475**. See
[results.md](results.md) for per-class numbers, the per-capture-host-stats fix that drove
them (an earlier flow-level split leaked shared per-capture host stats across train/test;
the retired, leaky 99.7% accuracy came from that), and real-`.pcap` inference results.

## Distinguishing characteristics

- **No decryption** — only packet metadata is used.
- **Self-supervised pretraining** — learns from ~20k unlabelled flows before any labels are introduced.
- **Meets the cosine-separation and latency KPIs** — including the cosine targets that
  simpler approaches do not reach; accuracy and few-shot generalization fall short of target
  under the capture-level split.
- **Raw `.pcap` inference** — the same flow/feature pipeline runs at training and
  inference (including per-capture host stats), so a raw browser YouTube capture is correctly
  classified as `video_on_demand`. See [results.md](results.md).
- **Transparent evaluation** — the one known weak spot (single-flow snippets) is reported rather than omitted.
- **Real-time on CPU** — ~3.3 ms/flow (p50), 6.5 ms p95, deployable at the edge.
- **Interactive demonstration** — a live atlas of real flows; uploading a `.pcap` runs the model
  and classifies it. See [features.md](features.md).
