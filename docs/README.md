# Net-JEPA — Technical Documentation

> **Context-Aware Flow Embeddings for Adaptive AI-based Network Traffic Classification**
> Samsung EnnovateX 2026 · Problem Statement 2 · Team **FlowState** · IIT Kanpur

Net-JEPA classifies **encrypted** 5G network traffic into **8 common traffic types** from
the *shape* of the traffic — packet sizes, timing, and direction — **without ever
decrypting a single byte**. It learns its representation self-supervised (no labels),
then sharpens it with supervision.

This folder is the full technical write-up. Read in order, or jump to what you need:

| Doc | What's inside |
|---|---|
| [overview.md](overview.md) | Problem, our solution, and the **benchmark KPIs (all met)** |
| [architecture.md](architecture.md) | The JEPA model, training phases, and the live system |
| [datasets.md](datasets.md) | The 8-traffic-type dataset (Kaggle 5G + VLC + cloud-gaming), preprocessing, and pcap inference |
| [tech-stack.md](tech-stack.md) | Every OSS library used, with links |
| [usage.md](usage.md) | Install · train · run the live demo · user guide |
| [features.md](features.md) | Salient features of the "Signal Atlas" web experience |
| [results.md](results.md) | Full results: KPIs, per-class, generalization, domain adaptation |
| [ax.md](ax.md) | **How we used agentic AI tooling** (Claude Code) to build this |
| [presentation.md](presentation.md) | Slide-by-slide outline for the final pitch |

Deeper engineering reference (ASCII diagrams, every module): [`../doc.md`](../doc.md).
Honest chronological research log (bugs, dead ends, fixes): [`../experimentation.md`](../experimentation.md).

## TL;DR — the result

| Benchmark KPI | Target | Achieved |
|---|---|---|
| Intra-class cosine | > 0.7 | **0.98** ✅ |
| Inter-class cosine | < 0.3 | **−0.04** ✅ |
| Classification accuracy | ≥ 90% | **99.7%** ✅ |
| Generalization (few-shot, η=7) | ≥ 85% | **99.6%** ✅ |
| Real-time latency / flow | < 100 ms | **3.5 ms** (CPU) ✅ |

macro-F1 **0.992** · silhouette **0.87** · 8 traffic types · 128-D embedding · self-supervised
on 20k flows · runs on CPU.
