# Net-JEPA — Technical Documentation

> **Context-Aware Flow Embeddings for Adaptive AI-based Network Traffic Classification**
> Samsung EnnovateX 2026 · Problem Statement 2 · Team **FlowState** · IIT Kanpur

Net-JEPA classifies **encrypted** 5G network traffic into application categories from
the *shape* of the traffic — packet sizes, timing, and direction — **without ever
decrypting a single byte**. It learns its representation self-supervised (no labels),
then sharpens it with a small amount of supervision.

This folder is the full technical write-up. Read in order, or jump to what you need:

| Doc | What's inside |
|---|---|
| [overview.md](overview.md) | Problem, our solution, and the **benchmark KPIs (all met)** |
| [architecture.md](architecture.md) | The JEPA model, training phases, and the live system |
| [datasets.md](datasets.md) | Datasets used + the two we folded in (VLC, cloud-gaming) |
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
| Intra-class cosine | > 0.7 | **0.81** ✅ |
| Inter-class cosine | < 0.3 | **0.14** ✅ |
| Classification accuracy | ≥ 90% | **92.4%** ✅ |
| Generalization (few-shot CV) | ≥ 85% | **92%** ✅ |
| Real-time latency / flow | < 100 ms | **4.5 ms** (CPU) ✅ |

macro-F1 **0.90** · 6 categories · 128-D embedding · self-supervised on ~18k flows · runs on CPU.
