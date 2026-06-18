# 1 · Overview

## The problem

Modern network traffic is almost entirely **encrypted** (TLS, QUIC). Operators can no
longer read payloads, yet they still need to know *what kind* of application a flow is —
to prioritise a video call over a background download, to provision 5G slices, to detect
anomalies. Deep Packet Inspection is dead; the question is whether the **metadata that
encryption can't hide** — packet sizes, inter-arrival times, direction — carries enough
signal to classify traffic.

**It does.** Encryption hides *what* you send. It cannot hide *how* you send it. A Zoom
call, a Netflix stream, and a cloud-gaming session each have a distinct *rhythm* of
packets. Net-JEPA learns to read that rhythm.

## Problem statement (Samsung EnnovateX 2026, #2)

> *Context-Aware Flow Embeddings for Adaptive AI-based Network Traffic Classification.*
> Build a model that produces flow embeddings for encrypted traffic and meets fixed KPIs
> on cosine separation, accuracy, generalization, and real-time latency.

## Our solution in one paragraph

Net-JEPA is a **Joint-Embedding Predictive Architecture (JEPA)** for network flows. From a
flow's first 64 packets it builds a `(64×9)` feature matrix (size, log-IAT, signed
direction, protocol one-hot, RTT) plus a 15-D flow-context vector. A Transformer encoder
learns **self-supervised** by predicting masked parts of a flow against a slow-moving EMA
"target" copy of itself (VICReg loss — no labels, no negatives). A short supervised
**contrastive** fine-tune (SupCon) on the 6 coarse categories, plus a **common-mode
removal** (α-centering) trick, shapes a 128-D unit-sphere embedding where same-class flows
point together and different-class flows are nearly orthogonal. A cosine **k-NN** then
classifies in ~4.5 ms on CPU.

## The six categories

| Category | Apps | Packet signature |
|---|---|---|
| ☁️ Cloud Gaming | GeForce NOW, KT GameBox, Xbox Cloud | Fat steady downstream, trickle of control up |
| 📡 Live Streaming | YouTube Live, AfreecaTV, Naver NOW | Sustained downstream in tight bursts |
| 🧊 Metaverse / XR | Roblox, Zepeto | Chatty bidirectional small-packet storms |
| 🎮 Online Gaming | PUBG, Teamfight Tactics | Rapid tiny UDP datagrams, latency-first |
| 🎬 On-Demand Video | Netflix, Prime, YouTube | Big chunked bursts then long silences |
| 🎥 Video Conferencing | Zoom, Teams, Meet | Symmetric real-time; jitter-sensitive |

## KPIs — all met

| Benchmark KPI | Target | Achieved | How |
|---|---|---|---|
| Intra-class cosine | > 0.7 | **0.81** | Category SupCon on a kept, normalised embedding |
| Inter-class cosine | < 0.3 | **0.14** | α-centering removes the anisotropic common-mode |
| Accuracy | ≥ 90% | **92.4%** | Cosine k-NN on the isotropised embedding |
| Generalization | ≥ 85% | **92%** | Few-shot cross-validation (held-out flows) |
| Real-time | < 100 ms | **4.5 ms** (CPU) | Lightweight encoder, no GPU needed to serve |

Plus **macro-F1 0.90**. See [results.md](results.md) for per-class numbers and the honest
cross-*dataset* generalization story (a deliberately reported limitation).

## What makes it stand out

- **No decryption, ever** — only packet metadata is used.
- **Self-supervised first** — learns from ~18k unlabelled flows before any labels.
- **Hits every KPI**, including the hard cosine targets that naïve approaches miss.
- **Honest evaluation** — we report where it *fails* (cross-domain transfer) and the
  domain-adaptation fix, rather than hiding it.
- **Runs in real time on CPU** — ~4.5 ms/flow, deployable at the edge.
- **A demo judges can *play* with** — a live "atlas" of 7,481 real flows; drop in a `.pcap`
  and watch the model classify it. See [features.md](features.md).
