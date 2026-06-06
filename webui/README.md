# Net-JEPA — Live Demo UI

A single-page, single-screen control room for **Net-JEPA**, a self-supervised,
context-aware encrypted-network-traffic classifier. It renders the model's
learned embedding space as an explorable WebGL point cloud, narrates the
inference pipeline stage by stage, and lets a visitor drop in their own
`.pcap` capture and watch it travel — live, entirely client-side — from raw
packets to a landed point in the UMAP projection.

```
┌──────────────────────────────── Top Bar (~64px) ─────────────────────────────────┐
│  wordmark · KPI strip (acc / F1 / cos-sim / latency) · dataset switcher · inject  │
├───────────────────────────────────────────┬───────────────────────────────────────┤
│                                            │         Pipeline Theatre  (45%)        │
│                                            │   9-stage stepper + live mini-vizs     │
│         Main Stage  (~60% width)           ├───────────────────────────────────────┤
│   WebGL UMAP point cloud (regl)            │            Inspector  (30%)            │
│   pan / zoom / hover / click / legend       │   Selected · Injected · Class stats    │
│   minimap · session tray · injection comet  ├───────────────────────────────────────┤
│                                            │             Metrics  (25%)             │
│                                            │   Curves · Confusion · Robustness       │
└───────────────────────────────────────────┴───────────────────────────────────────┘
```

The 60/40 and 45/30/25 splits are plain flex ratios — no media queries, no
page-level scroll at 1440p. Every panel owns its own internal scroll region.

## Quick start

```bash
npm install
npm run dev      # → http://localhost:5173 (or next free port)
npm run build    # type-check + production build → dist/
npm run lint
```

The app boots immediately with **zero configuration**: see [Graceful
degradation](#graceful-degradation--the-mock-dataset) below.

## Tech stack & key decisions

| Concern | Choice | Why |
|---|---|---|
| App shell | React 19 + Vite + TypeScript | fast HMR, strict types end-to-end |
| Styling | Tailwind CSS v4 | utility-first, CSS custom-property design tokens in `src/index.css` |
| State | Zustand | one small store (`src/state/store.ts`); per-frame camera state deliberately lives *outside* it (see comment at the top of that file) |
| Point cloud | WebGL via `regl` | thousands of points at 60fps; custom shaders for class-colour, hover halo, fade, and size-by-zoom |
| Charts | Recharts | training curves, confusion matrix, robustness |
| Animation | Framer Motion (`motion/react`), wrapped in `<MotionConfig reducedMotion="user">` | every `motion.*` component automatically honours the OS `prefers-reduced-motion` setting with no per-component plumbing |
| Icons | lucide-react | |
| `.pcap` parsing | hand-rolled `DataView` reader (`src/pcap/parsePcap.ts`) | the file **never leaves the browser** — no upload endpoint exists |

## Graceful degradation — the "mock dataset"

This is the single most important architectural property of the app: **the
UI is entirely data-driven from static JSON/binary files under
`/public/data/`, and every one of those files is optional.**

- If `manifest.json` is missing entirely, the app boots into a procedurally
  generated "mock" dataset (`src/data/mockData.ts`, seeded so it's stable
  across reloads) — six clusters with deliberately-overlapping boundaries,
  log-normal packet timing, a confusion matrix whose off-diagonal mass
  favours visually-adjacent clusters, and decaying-with-noise loss curves. A
  `MOCK` badge appears next to the dataset switcher so nobody mistakes it for
  real numbers.
- If the manifest exists but a *dataset's* files don't, each missing piece —
  embeddings, metrics, curves, class stats, a single flow's detail — degrades
  **independently**: the rest of the UI renders from whatever real data *is*
  present, and only the missing piece falls back to a mock-shaped placeholder
  (or an explicit "no data yet" empty state).
- Dropping a freshly-exported `manifest.json` + sibling files into
  `public/data/` after a training run **is the entire update mechanism** —
  nothing in the React code needs to change. `scripts/export_artifacts.py`
  (documented [below](#exporting-real-artifacts)) produces exactly this tree.

All of this fallback logic lives in one seam: `src/data/loader.ts`.

## The data contract

Everything below `public/data/` is plain static files served by Vite (or
whatever serves `dist/` in production) — no backend required for the demo
itself. Paths are relative to `public/data/`.

```
public/data/
├── manifest.json                              ← required to leave "mock" mode
└── <dataset_id>/
    ├── embeddings_umap.json                   ← the point cloud
    ├── embeddings_raw.bin                     ← optional: full-dim Float32 vectors
    ├── metrics.json                           ← KPI strip + confusion + robustness
    ├── training_curves.json                   ← loss curves panel
    ├── class_stats.json                       ← per-class summary table
    └── flow_features/
        └── <flow_id>.json                     ← lazily fetched on point click
```

### `manifest.json`

Top-level index: which datasets exist, which is active, and the global
class/embedding configuration shared by all of them.

```json
{
  "datasets": [
    { "id": "phase3_full",  "name": "Phase 3 — full run",   "trained_on": "2026-05-30", "n_flows": 48213 },
    { "id": "phase2b_supc", "name": "Phase 2b — SupCon",    "trained_on": "2026-05-22", "n_flows": 41870 }
  ],
  "active_dataset": "phase3_full",
  "classes": ["game_streaming", "live_streaming", "metaverse", "online_game", "stored_streaming", "video_conferencing"],
  "embedding_dim": 143,
  "model_version": "netjepa-v0.3.1"
}
```

| Field | Type | Notes |
|---|---|---|
| `datasets[]` | `{id, name, trained_on, n_flows}` | populates the dataset switcher; `id` is the sub-directory name |
| `active_dataset` | `string` | which `id` loads on first boot |
| `classes` | `string[]` | **order is significant** — it's the canonical class order for legend colours, KPI per-class breakdowns, the confusion matrix axes, and the `1`–`9` isolate-class keyboard shortcuts |
| `embedding_dim` | `number` | width of each vector in `embeddings_raw.bin`; `0`/absent ⇒ raw embeddings are skipped |
| `model_version` | `string` | shown in the top bar |

### `<dataset_id>/embeddings_umap.json`

The point cloud — a flat array of `UmapPoint`. This is the one file that
*must* exist for a dataset to render as anything other than mock data.

```json
[
  {
    "id": "flow_00000",
    "x": -3.42, "y": 6.18,
    "label": "video_conferencing",
    "confidence": 0.94,
    "flow_summary": "TCP · 203 pkts · 612 B avg · 41.2s · 38ms rtt"
  }
]
```

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | stable identifier; **must match** the corresponding `flow_features/<id>.json` filename (URI-encoded) |
| `x`, `y` | `number` | 2D projection coordinates — any consistent scale works, the camera auto-fits to the data's bounding box on load |
| `label` | `string` | predicted class — should be one of `manifest.classes` (unknown labels still render, just without a legend entry/colour mapping) |
| `confidence` | `number` | `0..1`, drives point opacity/size and the inspector's confidence stat |
| `flow_summary` | `string?` | optional one-line caption shown under the flow id in the inspector |

### `<dataset_id>/embeddings_raw.bin`

Optional. A flat, **row-major `Float32`** binary blob of shape
`(n_points, manifest.embedding_dim)`, in the *same order* as
`embeddings_umap.json`. Powers cosine-similarity / k-NN queries that need the
full-dimensional representation rather than the 2D projection. If
`embedding_dim` is `0`/absent, or the file's byte length isn't a multiple of
`embedding_dim * 4`, it's silently skipped (`loader.ts → loadRawEmbeddings`).

```python
# writing it from numpy — row-major, float32, no header
embeddings.astype('<f4').tofile('embeddings_raw.bin')
```

### `<dataset_id>/metrics.json`

Backs the KPI strip (with delta arrows vs. the previously-active dataset),
the confusion-matrix heatmap, and the robustness chart.

```json
{
  "accuracy": 0.912,
  "macro_f1": 0.887,
  "per_class_f1": { "game_streaming": 0.91, "live_streaming": 0.84, "...": 0.0 },
  "confusion_matrix": {
    "labels": ["game_streaming", "live_streaming", "..."],
    "matrix": [[182, 4, 1], [6, 170, 9], [0, 11, 165]]
  },
  "intra_class_cos": 0.764,
  "inter_class_cos": 0.221,
  "latency_ms_cpu": 71.4,
  "latency_ms_gpu": 9.8,
  "silhouette": 0.41,
  "robustness": [
    { "condition": "clean",        "accuracy": 0.912 },
    { "condition": "+jitter 20ms", "accuracy": 0.881 },
    { "condition": "packet loss 2%", "accuracy": 0.847 }
  ]
}
```

`robustness` is optional — the panel shows an empty state without it.
`confusion_matrix.labels` may differ in order from `manifest.classes` (the
heatmap renders whatever order is given); everything else assumes
`per_class_f1` keys line up with `manifest.classes`.

### `<dataset_id>/training_curves.json`

Array of `TrainingCurvePoint`, rendered as the multi-series loss chart:

```json
[
  { "step": 0,    "total_loss": 4.81, "jepa_loss": 2.10, "vicreg_loss": 1.90, "contrastive_loss": 0.81 },
  { "step": 1000, "total_loss": 2.34, "jepa_loss": 1.02, "vicreg_loss": 0.88, "contrastive_loss": 0.44 }
]
```

### `<dataset_id>/class_stats.json`

Array of `ClassStat` — backs the inspector's "Class stats" tab table:

```json
[
  { "label": "video_conferencing", "count": 8112, "avg_packet_size": 588.4, "avg_duration_s": 38.2, "avg_rtt_ms": 41.7 }
]
```

### `<dataset_id>/flow_features/<flow_id>.json`

Lazily fetched the moment a point is clicked (and the slowest artifact to
bulk-export, hence per-flow files rather than one giant blob). Powers the
"Selected"/"Injected" inspector tabs: the top-3 prediction bars, the six
stat tiles, the packet-size and inter-arrival sparklines, the
direction strip, and the nearest-neighbour chips.

```json
{
  "id": "flow_00000",
  "packet_sizes": [54, 1380, 1380, 66, 512, "... up to ~64 entries"],
  "iat": [0, 12.4, 0.8, 44.1, "... milliseconds, same length as packet_sizes"],
  "direction": [1, -1, -1, 1, 1, "... +1 = client→server (out), -1 = server→client (in)"],
  "rtt_ms": 38.4,
  "jitter_ms": 6.1,
  "duration_s": 41.2,
  "packet_rate": 4.9,
  "predicted_class": "video_conferencing",
  "top3": [
    { "label": "video_conferencing", "prob": 0.94 },
    { "label": "live_streaming",     "prob": 0.04 },
    { "label": "metaverse",          "prob": 0.01 }
  ],
  "knn_ids": ["flow_00231", "flow_01872", "flow_00098"]
}
```

`knn_ids` are other points' `id`s (resolved against the already-loaded point
cloud — entries that don't resolve are silently skipped, so it's safe to list
neighbours from a different dataset slice). If a flow's file 404s, the UI
synthesizes a deterministic placeholder seeded by the flow id — clicking the
same point twice always shows the same "fake" detail, so the demo never
flickers.

## Exporting real artifacts

`netjepa/scripts/export_artifacts.py` is a runnable starting point that wires
a trained checkpoint to this exact contract: it loads the model, collects
embeddings + labels for the test/downstream-train splits, projects to 2D
(UMAP, with a PCA fallback if `umap-learn` isn't installed), computes the KPI
metrics via the existing `netjepa.evaluation` helpers, reconstructs
human-readable per-flow series from the stored `packet_sequence` /
`flow_context` feature tensors, and writes the whole tree above directly into
`webui/public/data/<dataset_id>/`.

```bash
python netjepa/scripts/export_artifacts.py \
  --checkpoint checkpoints/phase3/best.pt \
  --dataset-id phase3_full \
  --name "Phase 3 — full run" \
  --out-dir webui/public/data
```

Run it again with a different `--dataset-id` after the next training run —
the manifest is merged (not overwritten), so old datasets stay selectable in
the switcher for side-by-side comparison. See the file's module docstring and
inline `TODO`s for the handful of project-specific spots (label naming,
nearest-neighbour search strategy, flow-summary formatting) you'll likely
want to tune to taste.

## The PCAP injection feature

Click **"Inject .pcap"** (top right) or drop a capture onto the dropzone.
Everything happens **in the browser — the file is never uploaded anywhere**:

1. **Parse** (`src/pcap/parsePcap.ts`) — a hand-rolled classic-libpcap reader
   (magic `0xa1b2c3d4` family; pcapng is detected and rejected with a
   conversion hint: `editcap -F pcap in.pcapng out.pcap`). Supports Ethernet,
   raw-IP, and Linux "cooked" (`SLL`) link layers, plus up to two levels of
   802.1Q/QinQ VLAN tagging, IPv4 + TCP/UDP.
2. **Reconstruct flows** (`src/pcap/extractFlows.ts`) — groups packets into
   bidirectional 5-tuples, derives the same kind of summary statistics
   (packet-size/IAT/direction series, RTT via opposite-direction turnaround,
   jitter via RFC-3550-style spacing variance, rate, duration) that a real
   feature-extraction stage would hand to the encoder, and surfaces the
   largest sessions for picking.
3. **Animate** (`src/pcap/injection.ts`) — steps the Pipeline Theatre through
   all nine stages on a fixed cadence, then asks the (heuristic, see
   `src/data/mockProjector.ts`) projector for a 2D landing point once the walk
   reaches the embedding stage.
4. **Land** (`src/components/UMAPStage/InjectionComet.tsx`) — a glowing comet
   flies through *data space* (not screen space) from a seeded off-canvas
   start point to the landing coordinate, with the camera gently auto-panning
   to follow; a persistent ring marks the spot afterward. The flight path is a
   pure function of the session id, so **"Replay last injection"** (`Space`,
   or the tray button) reproduces an identical flight.

> **Heads up:** the *landing coordinate and predicted class* are produced by
> a heuristic placeholder (`mockProjector.ts`) — a small, documented stand-in
> for "run the real encoder + UMAP transform on this flow," which would need
> an exported model running somewhere the browser can reach it (ONNX/WASM, or
> a thin inference endpoint). Swapping it out is the one seam left between
> this demo and a fully-live inference loop; everything upstream of it
> (parsing, flow reconstruction, the pipeline animation, the comet, the
> inspector) is real, general-purpose code that works on *any* `.pcap`.

## Keyboard shortcuts

| Key | Effect |
|---|---|
| `1`–`9` | Toggle visibility of the Nth class in the legend (isolate / restore) |
| `Esc` | Clear the current selection · close the inject modal |
| `Space` | Replay the last injection's pipeline walk + comet flight |
| scroll | Zoom the embedding space toward the cursor |
| drag | Pan the embedding space |
| click a point | Select it (populates the "Selected" inspector tab) |

All shortcuts are ignored while focus is inside a text input, and every
animation respects the OS-level "reduce motion" preference automatically via
`<MotionConfig reducedMotion="user">`.
