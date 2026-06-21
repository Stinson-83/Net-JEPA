# 7 · The "Signal Atlas" — Salient Features

The front-end is an interactive demonstration rather than a dashboard bolted onto a model. It
is designed to convey what the model does to both technical and non-technical audiences.
Everything below runs in the browser (React 19 + WebGL via regl) and works **fully offline**
off a committed static export, or **live** against the FastAPI inference server.

## 7.1 The embedding view — an interactive map of real flows

The central component. Every encrypted flow the model has processed is rendered as a point,
positioned by its 128-D embedding projected to 2-D (UMAP) and **coloured by its true category**.
Same-category flows form visibly distinct clusters — a direct visualization of the cosine KPI.

- **Drag to orbit, scroll to zoom** — a camera over a point cloud of thousands of points.
- Point size adapts to zoom; percentile-bounded layout keeps every cluster on-screen.
- The view is **balanced and dense** — built from real captures (cloud-gaming and MS-Teams
  data folded in), capped at 1,500/class for a fair representation, with no synthetic data.

## 7.2 Click-to-inspect — the packet heartbeat

Clicking any point opens the **Flow Inspector**:

- the flow's **packet "heartbeat"** — an animated size/timing/direction strip (the raw signal
  the model reads),
- the **model prediction** — predicted category and confidence,
- its **k-NN neighbours** — the flows that contributed to the decision, making the result
  interpretable rather than opaque.

## 7.3 Upload a `.pcap` — live inference, streamed stage-by-stage

The bottom **Inject Dock** accepts a real `.pcap`/`.pcapng`. When the server is running, the
file is parsed → flows built → embedded → classified → projected, and **every stage is streamed
over a WebSocket** (`/ws`). The UI animates the pipeline in real time and **places the new flow
in the embedding view** at the position the model assigned. Without a server, the same interaction
runs on the static export.

## 7.4 "Simulate" chips — an offline demonstration mode

When no pcap or network is available, clicking a **"simulate &lt;class&gt;"** chip runs a
representative flow through the full pipeline animation and places it in the correct cluster. This
provides a reliable, repeatable demonstration for a live presentation.

## 7.5 Four scenes for different audiences

A top-bar switches scenes (keys `1–4`):

| Scene | Audience | What it shows |
|---|---|---|
| **Atlas** | general | the embedding view + inspector + inject dock |
| **Model** | technical | an interactive JEPA diagram with an **"Explain simply ↔ Show the math"** toggle |
| **Proof** | evaluation | the five KPIs, the cosine-separation plot, confusion matrix, per-class F1 |
| **Journey** | overview | the research timeline — the bugs, dead-ends, and fixes |

## 7.6 Intro sequence

A short **cinematic intro** ("Signal Atlas") states the problem — encrypted traffic, no
decryption — and resolves into the **Net-JEPA logo** above the tagline *"The shape of
encrypted traffic"* before transitioning to the embedding view. The same logo persists as the
top-bar wordmark (click it to return to the Atlas). The intro is skippable and bypassable for kiosk mode.

## 7.7 Live-model awareness

The UI auto-detects the inference server and displays a **"LIVE MODEL"** indicator; when the
server is down it falls back to the static export, so the demonstration does not hard-fail
in front of an audience.

## 7.8 Presentation features

- **Deep-links for kiosk mode:** `?skipintro` opens the Atlas directly; `?scene=proof`
  (or `model` / `journey`) opens a specific scene; number keys switch scenes live.
- **Design system:** a token-based design system (`src/styles/tokens.css`), Space Grotesk /
  Inter / JetBrains Mono, hand-rolled inline-SVG icons (no icon-library dependency).
- **Resilient:** an error boundary prevents a render glitch from blanking the screen during a demonstration.

See [usage.md §6.5](usage.md) for the full interaction guide and [architecture.md §2.5](architecture.md)
for how the live system streams each stage.
