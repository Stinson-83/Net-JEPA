# User Guide — the "Signal Atlas"

How to operate the web application once it is running. To install and launch it, see
[install.md](install.md); for what each feature is and why it exists, see [features.md](features.md).

## Launching

```bash
make demo          # installs (first run), starts the server, opens the UI at http://localhost:5173
```

The UI auto-detects the inference server: a **"LIVE MODEL"** indicator lights up when it is
reachable. If no server is running, the UI still works **fully offline** off the committed static
export (uploads are then projected by a client-side heuristic instead of the live model).

## Core interactions

| Action | How |
|---|---|
| Navigate the embedding view | drag = orbit · scroll = zoom |
| Inspect a flow | **click any point** → packet "heartbeat", model prediction, k-NN neighbours |
| Isolate a class | click it in the legend (left); hover for its packet signature |
| Classify your own traffic | **Upload a `.pcap`** in the bottom Inject Dock (live inference if the server is running) |
| Demonstrate without a pcap | click a **"simulate &lt;class&gt;"** chip to run a representative flow through the pipeline |
| View the model | top-bar **Model** tab — interactive JEPA, "Explain simply ↔ Show the math" |
| Verify the KPIs on your captures | **Model** tab → **Proof Lab** (intra / inter / degraded — see below) |
| View the results | **Proof** tab — KPIs, cosine separation, confusion matrix, per-class F1 |

## Scenes

A top bar switches between three scenes; number keys `1`, `2`, `3` switch them live:

1. **Atlas** — the embedding view + Flow Inspector + Inject Dock.
2. **Model** — the interactive architecture diagram and the **Proof Lab**.
3. **Proof** — the KPI results and plots.

## Using the Proof Lab (Model scene)

The Proof Lab verifies the three problem-statement KPIs on captures you upload:

- **Intra-class** — upload two captures of the *same* type (e.g. Netflix and YouTube). The panel
  reports the cosine of their representative embeddings against the **> 0.7** target.
- **Inter-class** — upload two captures of *different* types (e.g. a streaming capture and a
  gaming capture). Cosine is reported against the **< 0.3** target.
- **Degraded** — upload a *single* capture. The server applies the JEPA degradation (RTT change,
  time shift, packet loss) and re-classifies; the predicted class should be unchanged.

Quick-fill chips load the bundled sample captures so the demo works without your own files.

## Uploading a `.pcap` (Atlas scene)

Drop a `.pcap`/`.pcapng` into the **Inject Dock** at the bottom. With the server running, each
pipeline stage (parse → flows → embed → classify → project) is streamed over the WebSocket and
animated, and the new flow lands in the embedding view at the model-assigned position, with a
per-class breakdown for multi-flow captures. The dock stays locked until the capture has been
classified, then re-enables for the next upload.

## Kiosk / presentation deep-links

| URL / key | Effect |
|---|---|
| `?skipintro` | Jump straight to the Atlas (skip the cinematic intro) |
| `?scene=proof` / `?scene=model` | Open directly in a specific scene |
| keys `1` / `2` / `3` | Switch scenes live |

## Troubleshooting

- **No "LIVE MODEL" indicator** — the server isn't reachable. Check `curl localhost:8000/api/health`;
  the UI still runs offline in the meantime.
- **Port `:8000` already in use** — run `make demo PORT=<free>`; the Vite proxy follows automatically.
- **A single-flow `.pcap` misclassifies** — this is the known limitation (degenerate per-capture
  host stats); use a real multi-flow capture. See [results.md](results.md).
- **Remote demo** — only the UI port (5173) needs tunnelling; the API is reached same-origin via
  the Vite proxy (see [install.md](install.md)).
