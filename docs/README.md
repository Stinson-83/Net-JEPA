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
| **Technical architecture** | [architecture.md](architecture.md) |
| **Implementation details** (code, shapes, hyper-params, serving internals) | [implementation.md](implementation.md) |
| **Technical stack & list of OSS libraries** (with links) | [tech-stack.md](tech-stack.md) |
| Datasets, sources, licenses, preprocessing | [datasets.md](datasets.md) |
| **Installation instructions** (install · fetch · train · run) | [install.md](install.md) |
| **User guide** (operating the web app) | [user-guide.md](user-guide.md) |
| **Salient features** (the "Signal Atlas") | [features.md](features.md) |
| Results & KPIs (per-class, generalization, efficiency) | [results.md](results.md) |
| Hugging Face model card | [model-card.md](model-card.md) |
| Agentic-AI build write-up (Claude Code) | [ax.md](ax.md) |
| **Attributions & references** (methods, datasets, software) | [attributions.md](attributions.md) |
| Experimentation log (bugs, dead ends, fixes) | [experiments.md](experiments.md) |

Suggested reading order: overview → architecture → implementation → datasets → results.
Everything needed to run it is in install.md + user-guide.md.

## TL;DR — the result

| Benchmark KPI | Target | Achieved |
|---|---|---|
| Intra-class cosine | > 0.7 | **0.87** ✓ |
| Inter-class cosine | < 0.3 | **0.13** ✓ |
| Classification accuracy | ≥ 90% | **75.3%** ✗ |
| Generalization (few-shot, η=7) | ≥ 85% | **77.3%** ✗ |
| Real-time latency / flow | < 100 ms | **6.5 ms** (CPU) ✓ |

macro-F1 **0.680** · weighted-F1 **0.729** · silhouette **0.475** · 8 traffic types · 128-D embedding · self-supervised
on 29k flows · runs on CPU.
