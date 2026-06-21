# Presentation — Slide-by-Slide Outline

A presentation outline for the Samsung EnnovateX final. ~10 slides + live demo. Each slide lists
the key point to convey. Target: 6–8 minutes + demo.

---

### Slide 1 — Title

**Net-JEPA** · *Reading encrypted traffic without decrypting it.*
Team **FlowState**, IIT Kanpur · Samsung EnnovateX 2026 · Problem Statement 2.

Key point: Net-JEPA classifies encrypted 5G traffic into application types without decrypting any payload.

### Slide 2 — The problem

Traffic is encrypted (TLS/QUIC). Operators still need to know what a flow is — to prioritise
a video call, provision a 5G slice, detect anomalies. DPI is no longer viable.

Key point: Encryption conceals the content of a flow but not its temporal structure.

### Slide 3 — The insight

Three packet-size/timing strips: a Zoom call, a Netflix stream, a cloud-gaming session. Each
has a visibly different temporal pattern.

Key point: Each application has a characteristic packet pattern that the model learns to read.

### Slide 4 — The approach: a JEPA

One diagram: the online branch sees a *degraded* flow and predicts the *latent* of the clean
flow produced by an EMA target. VICReg, no labels, no negatives. Self-supervised on ~20k flows.

Key point: The model learns the structure of traffic self-supervised, before any labels are introduced.

### Slide 5 — Meeting the cosine KPI

The cosine targets (>0.7 intra, <0.3 inter) are where simpler models fail. Two methods:
**category-level SupCon** + **α-centering** (removing the anisotropic common-mode).
Show the before/after cosine histogram.

Key point: SupCon separates class directions; α-centering removes the shared common-mode, and together they meet the KPI.

### Slide 6 — Results

The five-KPI table, all met:

| KPI | Target | Net-JEPA |
|---|---|---|
| Intra cosine | >0.7 | **0.98** |
| Inter cosine | <0.3 | **−0.04** |
| Accuracy | ≥90% | **99.7%** |
| Generalization (η=7) | ≥85% | **99.6%** |
| Latency | <100 ms | **3.5 ms** (CPU) |

macro-F1 **0.992** · silhouette **0.87** · 8 traffic types. Runs on CPU. The improvement from
0.86 came from one fix — per-capture host stats (train/inference-consistent), which also made
real-`.pcap` upload classify correctly.

### Slide 7 — Live demo

Switch to the **Signal Atlas**. Navigate the embedding view of thousands of real flows. Click a
point → packet heartbeat + prediction + neighbours. **Upload a `.pcap`** → the pipeline streams
stage-by-stage and the new flow is placed in its cluster. (Fallback: a "simulate" chip.)

Key point: The demonstration runs the actual model live, not a static representation of it.

### Slide 8 — Transparent evaluation

Few-shot generalization meets the KPI (**99.6%**). Raw `.pcap` upload works: the same flow/feature
pipeline runs at training and inference (including per-capture host stats), so a raw **browser**
YouTube capture — a domain never seen in training — correctly reads `video_on_demand`. The one weak
spot is also reported: a pcap with only a single flow gives degenerate host stats and can
misclassify; real multi-flow captures classify correctly.

Key point: The submission reports both where the model works and where it breaks.

### Slide 9 — How we built it

OSS-only, CPU-deployable, reproducible. Built human-steered with **agentic AI** (Claude Code):
the human owned the science; the agent handled implementation, debugging, and documentation. Full
record in [experiments.md](experiments.md) and [agentic-ai.md](agentic-ai.md).

### Slide 10 — Close

Edge-deployable encrypted-traffic classification that **meets every KPI**, with an interactive
demonstration. Roadmap: cloud-gaming-dense data, conditional domain adaptation, per-app heads.

Key point: No decryption, every KPI met, real-time on CPU, with an interactive demonstration.

---

## Demo runbook (complete before presenting)

1. `uvicorn server.app:app --port 8000` → `curl localhost:8000/api/health` shows `{"ok": true}`.
2. `cd webui && npm run dev` → open with `?skipintro` for a fast start (or let the intro play).
3. Have a known `.pcap` on the desktop **and** rehearse the "simulate" chip as the no-network fallback.
4. Pre-zoom the embedding view to a clear angle; keys `1–3` switch scenes.
5. If the network is unreliable, the **static export** runs the whole UI offline, so the demonstration does not hard-fail.

See [features.md](features.md) for what each part of the UI does and [results.md](results.md)
for the numbers behind every claim.
