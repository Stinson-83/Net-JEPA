# 9 · Presentation — Slide-by-Slide Outline

A pitch outline for the Samsung EnnovateX final. ~10 slides + live demo. Each slide lists the
**one thing** to land and the line to say. Target: 6–8 minutes + demo.

---

### Slide 1 — Title

**Net-JEPA** · *Reading encrypted traffic without decrypting it.*
Team **FlowState**, IIT Kanpur · Samsung EnnovateX 2026 · Problem Statement 2.

> "We classify encrypted 5G traffic into application types — without decrypting a single byte."

### Slide 2 — The problem

Traffic is encrypted (TLS/QUIC). Operators still need to know *what* a flow is — to prioritise
a video call, provision a 5G slice, spot anomalies. DPI is dead.

> "Encryption hides *what* you send. It cannot hide *how* you send it."

### Slide 3 — The insight (show, don't tell)

Three packet-size/timing strips: a Zoom call, a Netflix stream, a cloud-gaming session. Each
has a visibly different **rhythm**.

> "Every app has a heartbeat. We learn to read it."

### Slide 4 — The approach: a JEPA

One clean diagram: online branch sees a *degraded* flow, predicts the *latent* of the clean
flow produced by an EMA target. VICReg, no labels, no negatives. Self-supervised on ~20k flows.

> "It learns the structure of traffic on its own — before it ever sees a label."

### Slide 5 — Winning the hard KPI

The cosine targets (>0.7 intra, <0.3 inter) are where naïve models fail. Two ideas:
**category-level SupCon** + **α-centering** (remove the anisotropic common-mode).
Show the before/after cosine histogram.

> "SupCon separates the *directions*; α-centering removes the shared bias. Both, and the KPI falls."

### Slide 6 — Results (the scoreboard)

The five-KPI table, all ✅:

| KPI | Target | Net-JEPA |
|---|---|---|
| Intra cosine | >0.7 | **0.94** |
| Inter cosine | <0.3 | **−0.01** |
| Accuracy | ≥90% | **97.7%** |
| Generalization (η=7) | ≥85% | **97.6%** |
| Latency | <100 ms | **4.1 ms** (CPU) |

macro-F1 **0.954** · silhouette **0.70** · 8 traffic types. Runs on CPU. The jump from 0.86
came from one fix — per-capture host stats (train/inference-consistent), which also made
real-`.pcap` upload classify correctly.

### Slide 7 — **Live demo** (the centrepiece)

Switch to the **Signal Atlas**. Fly the galaxy of thousands of real flows. Click a star → packet
heartbeat + verdict + neighbours. **Drop a `.pcap`** → watch the pipeline stream stage-by-stage
and the new flow land in its constellation. (Fallback: a "simulate" chip.)

> "This isn't a slide of the model. This *is* the model — running, live."

### Slide 8 — Honesty as a feature

Few-shot generalization meets the KPI (**97.6%**). Crucially, **upload-any-`.pcap` works**:
the same flow/feature pipeline runs at training and inference (incl. per-capture host stats),
so a raw **browser** YouTube capture — a domain never seen in training — correctly reads
`video_on_demand`. We also report the one weak spot: a pcap with only a *single* flow gives
degenerate host stats and can misclassify; real multi-flow captures work.

> "We show you where it breaks — and that uploading a real capture actually works. That's the science."

### Slide 9 — How we built it

OSS-only, CPU-deployable, reproducible. Built human-steered with **agentic AI** (Claude Code):
the human owned the science; the agent owned the plumbing, debugging, and docs. Full paper
trail in `experimentation.md`.

### Slide 10 — Close / ask

Edge-deployable encrypted-traffic classification that **meets every KPI** and a demo judges can
*play* with. Roadmap: cloud-gaming-dense data, conditional domain adaptation, per-app heads.

> "No decryption. Every KPI. Real-time on CPU. And you can fly through it."

---

## Demo runbook (do this before you present)

1. `uvicorn server.app:app --port 8000` → `curl localhost:8000/api/health` shows `{"ok": true}`.
2. `cd webui && npm run dev` → open with `?skipintro` for a fast start (or let the cold-open play).
3. Have a known `.pcap` on the desktop **and** rehearse the "simulate" chip as the no-network fallback.
4. Pre-zoom the galaxy to a flattering angle; keys `1–4` switch scenes without fumbling.
5. If Wi-Fi is hostile, the **static export** runs the whole UX offline — the demo never hard-fails.

See [features.md](features.md) for what each part of the UI does and [results.md](results.md)
for the numbers behind every claim.
