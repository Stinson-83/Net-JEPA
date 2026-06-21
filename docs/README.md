<p align="center">
  <img src="assets/netjepa_logo.png" alt="Net-JEPA logo" width="120"/>
</p>

# Net-JEPA — Technical Documentation

> **Context-Aware Flow Embeddings for Adaptive AI-based Network Traffic Classification**
> Samsung EnnovateX 2026 · Problem Statement 2 · Team **FlowState** · IIT Kanpur

Net-JEPA classifies **encrypted** 5G traffic into **8 common traffic types** from its *shape* —
packet sizes, timing, and direction — **without decrypting any payload**. It learns that shape
self-supervised (no labels), then sharpens it with supervision.

This folder is the complete technical write-up. Every required topic maps to one document:

| Topic | Document |
|---|---|
| Problem, solution, KPIs at a glance | [overview.md](overview.md) |
| **Technical architecture** (diagrams) | [architecture.md](architecture.md) |
| **Implementation details** (code, shapes, hyper-params, serving internals) | [implementation.md](implementation.md) |
| **Technical stack & list of OSS libraries** (with links) | [tech-stack.md](tech-stack.md) |
| Datasets, sources, licenses, preprocessing | [datasets.md](datasets.md) |
| **Installation instructions** (install · fetch · train · run) | [install.md](install.md) |
| **User guide** (operating the web app) | [user-guide.md](user-guide.md) |
| **Salient features** (the "Signal Atlas") | [features.md](features.md) |
| Results & KPIs (per-class, generalization, efficiency) | [results.md](results.md) |
| Hugging Face model card | [model-card.md](model-card.md) |
| Agentic-AI build write-up (Claude Code) | [agentic-ai.md](agentic-ai.md) |
| Experimentation log (bugs, dead ends, fixes) | [experiments.md](experiments.md) |
| Presentation outline | [presentation.md](presentation.md) |

Suggested reading order: overview → architecture → implementation → datasets → results.
Everything needed to run it is in install.md + user-guide.md.

## TL;DR — the result

| Benchmark KPI | Target | Achieved |
|---|---|---|
| Intra-class cosine | > 0.7 | **0.98** |
| Inter-class cosine | < 0.3 | **−0.04** |
| Classification accuracy | ≥ 90% | **99.7%** |
| Generalization (few-shot, η=7) | ≥ 85% | **99.6%** |
| Real-time latency / flow | < 100 ms | **3.5 ms** (CPU) |

macro-F1 **0.992** · silhouette **0.87** · 8 traffic types · 128-D embedding · self-supervised
on 20k flows · runs on CPU.
