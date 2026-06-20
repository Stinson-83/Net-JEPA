# 7 · The "Signal Atlas" — Salient Features

The front-end is not a dashboard bolted onto a model. It is a **playable demo** built to make
both technical and non-technical judges *feel* what the model does in the first ten seconds.
Everything below runs in the browser (React 19 + WebGL via regl) and works **fully offline**
off a committed static export, or **live** against the FastAPI inference server.

## 7.1 The galaxy — thousands of real flows you can fly through

The centrepiece. Every encrypted flow the model has ever seen is a star, positioned by its
128-D embedding projected to 2-D (UMAP) and **coloured by its true category**. Same-category
flows cluster into visibly distinct constellations — *the cosine KPI made literal*.

- **Drag to orbit, scroll to zoom** — a real camera over a real point cloud (thousands of points).
- Point size adapts to zoom; percentile-bounded layout keeps every cluster on-screen.
- The galaxy is **balanced and dense** — built from real captures (cloud-gaming and MS-Teams
  data folded in), capped at 1,500/class for a fair view, never mocked.

## 7.2 Click-to-inspect — the packet heartbeat

Click any star and the **Flow Inspector** opens:

- the flow's **packet "heartbeat"** — an animated size/timing/direction strip (the raw signal
  the model reads),
- the **model verdict** — predicted category + confidence,
- its **k-NN neighbours** — the actual flows that voted, so the decision is legible, not a
  black box.

## 7.3 Drop a `.pcap` — live inference, streamed stage-by-stage

The bottom **Inject Dock** accepts a real `.pcap`/`.pcapng`. When the server is up, the file
is parsed → flows built → embedded → classified → projected, and **every stage is streamed
over a WebSocket** (`/ws`). The UI animates the pipeline in real time and **drops the new flow
into the galaxy** where the model placed it. No server? The same UX runs on the static export.

## 7.4 "Simulate" chips — the demo that always works

No pcap handy (or no network on stage)? One click on a **"simulate &lt;class&gt;"** chip walks a
representative flow through the full pipeline animation and lands it in the right
constellation. A reliable, repeatable money-shot for a live pitch.

## 7.5 Four scenes for four kinds of judge

A top-bar switches scenes (keys `1–4`):

| Scene | For whom | What it shows |
|---|---|---|
| **Atlas** | everyone | the galaxy + inspector + inject dock (the playground) |
| **Model** | technical | an interactive JEPA diagram with an **"Explain simply ↔ Show the math"** toggle |
| **Proof** | judges/rubric | the five KPIs, the cosine-separation plot, confusion matrix, per-class F1 |
| **Journey** | storytellers | the **honest** research timeline — the bugs, dead-ends, and fixes |

## 7.6 Cold open

A short **cinematic intro** ("Signal Atlas") sets the stakes — encrypted traffic, no
decryption — and resolves into the **Net-JEPA logo** above the tagline *"The shape of
encrypted traffic"* before dropping you into the galaxy. The same logo persists as the
top-bar wordmark (click it to return to the Atlas). Skippable, and bypassable for kiosk mode.

## 7.7 Live-model awareness

The UI auto-detects the inference server and lights up a **"LIVE MODEL"** indicator; when the
server is down it falls back seamlessly to the static export, so the demo **never hard-fails**
in front of an audience.

## 7.8 Built for the stage

- **Deep-links for kiosk mode:** `?skipintro` jumps straight to the Atlas; `?scene=proof`
  (or `model` / `journey`) opens a specific scene; number keys switch scenes live.
- **Designed system:** a token-based design system (`src/styles/tokens.css`), Space Grotesk /
  Inter / JetBrains Mono, hand-rolled inline-SVG icons (zero icon-library weight).
- **Resilient:** an error boundary keeps a render glitch from blanking the screen mid-demo.

See [usage.md §6.5](usage.md) for the full interaction guide and [architecture.md §2.5](architecture.md)
for how the live system streams each stage.
