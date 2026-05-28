# Net-JEPA Live — Encrypted Traffic Classifier

Real-time-looking encrypted traffic classifier built on packet **metadata only**
(sizes, timing, direction, 5-tuple — never payload). A `.pcap` is replayed on its
original timeline, grouped into flows, featurised, and classified live in a browser
dashboard.

The architecture has one clean swap point (`model/classifier_base.py`) so the
RandomForest baseline can be replaced with the Net-JEPA encoder + k-NN in Phase 4
without touching any pipeline or UI code.

---

## Project layout

```
netjepa-live/
├── requirements.txt
├── capture/
│   ├── base.py          — PacketRecord dataclass + PacketSource interface
│   └── pcap_replay.py   — Scapy streaming replay with timeline pacing
├── flows/
│   ├── flow_table.py    — Bidirectional flow assembly, windowing, expiry
│   └── features.py      — scalar_vector (10 stats) + per-packet sequence [64,3]
├── model/
│   ├── classifier_base.py   — Classifier / Prediction interface (Phase 4 swap point)
│   ├── simple_baseline.py   — RandomForest implementation
│   └── checkpoints/         — saved .joblib model files go here
├── scripts/
│   ├── gen_demo_pcap.py     — generate a synthetic demo.pcap for testing
│   ├── train_synthetic.py   — train on synthetic data (no Kaggle download needed)
│   ├── train_baseline.py    — train on real 5G Kaggle dataset
│   └── run_demo.py          — Phase 2 CLI: replay → flows → classify → print
└── server/
    ├── app.py               — FastAPI + WebSocket server
    └── static/index.html    — live dashboard (vanilla JS, no build step)
```

---

## Quick start

### 1. Set up the environment

```bash
cd ~/projects/netjepa-live
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Generate a synthetic demo pcap (no Wireshark needed)

```bash
python scripts/gen_demo_pcap.py --out demo.pcap
# Options:
#   --duration 90    simulated seconds of traffic (default: 90)
#   --seed 42        random seed for reproducibility
```

### 3. Train the model

**Option A — synthetic data (instant, no dataset download):**
```bash
python scripts/train_synthetic.py
# saves to model/checkpoints/baseline.joblib
```

**Option B — real 5G Kaggle dataset:**
```bash
# Download kimdaegyeom/5g-traffic-datasets from Kaggle
# and place it at: datasets/5g-traffic/

python scripts/train_baseline.py --data-dir datasets/5g-traffic
# Optional flags:
#   --out model/checkpoints/baseline.joblib   (default)
#   --explore                                 just print the directory structure and exit
```

The training script auto-detects whether the dataset contains CSV files or raw `.pcap`
files and adapts accordingly. CSV columns are matched by synonym (e.g. `flow duration`,
`Flow Duration`, `duration` all map to the same feature).

### 4. Run the terminal demo (Phase 2)

```bash
python scripts/run_demo.py --pcap demo.pcap --model model/checkpoints/baseline.joblib
# Optional flags:
#   --speed 5.0    replay at 5× real time (useful for quick testing)
#   --speed 0.5    replay at half speed (slow motion)
```

Output columns: `FlowID | App | Confidence | Packets | Latency(ms)`

### 5. Start the live dashboard (Phase 3)

```bash
# Environment variables configure the server (all optional):
export PCAP_PATH=demo.pcap
export MODEL_PATH=model/checkpoints/baseline.joblib
export REPLAY_SPEED=1.0

uvicorn server.app:app --host 0.0.0.0 --port 8000
```

Then open **http://localhost:8000** in a browser.

One-liner (no export needed):
```bash
PCAP_PATH=demo.pcap MODEL_PATH=model/checkpoints/baseline.joblib REPLAY_SPEED=2 \
  uvicorn server.app:app --port 8000
```

---

## Using a real pcap

Capture ~2 minutes of traffic with Wireshark (or `tcpdump`), save as `demo.pcap`,
and drop it in the project root. No other changes are needed.

```bash
# tcpdump example (Linux/macOS, requires sudo):
sudo tcpdump -i eth0 -w demo.pcap -G 120 -W 1

# Then run:
python scripts/run_demo.py --pcap demo.pcap --model model/checkpoints/baseline.joblib
```

The `local_ip` is auto-detected from the most frequent private-range IP in the first
200 packets. To override it:

```python
# in scripts/run_demo.py or server/app.py:
replay = PcapReplay("demo.pcap", speed=1.0, local_ip="192.168.1.10")
```

---

## Feature reference

`flows/features.py` extracts a 10-element `scalar_vector` used by the baseline, plus a
`sequence` array for the future Net-JEPA encoder.

| Index | Name | Description |
|-------|------|-------------|
| 0 | `packet_count` | packets seen in this flow window |
| 1 | `duration` | seconds from first to last packet |
| 2 | `mean_pkt_size` | mean IP frame size (bytes) |
| 3 | `std_pkt_size` | std dev of packet sizes |
| 4 | `mean_iat` | mean inter-arrival time (s) |
| 5 | `std_iat` | std dev of IAT — used as jitter proxy |
| 6 | `bytes_up` | total bytes in outbound direction |
| 7 | `bytes_down` | total bytes in inbound direction |
| 8 | `up_down_ratio` | outbound / inbound packet count ratio |
| 9 | `packet_rate` | packets per second |

`sequence` shape `[64, 3]` = per-packet `[size, IAT, direction]`, zero-padded to 64
packets. The baseline ignores this; the Net-JEPA encoder (Phase 4) consumes it.

Constants (edit `flows/features.py` and `flows/flow_table.py` to change):
- `MAX_PACKETS = 64` — sequence length cap
- `MIN_PACKETS = 10` — minimum packets before a flow is emitted for classification
- `IDLE_TIMEOUT = 15.0` — seconds of inactivity before a flow is flushed

---

## How to swap the classifier (Phase 4)

The only thing that needs replacing is `model/simple_baseline.py`. Everything else
(capture, flows, features, server, UI) stays identical.

### Steps

1. Create `model/jepa_classifier.py` implementing the `Classifier` interface:

```python
from model.classifier_base import Classifier, Prediction
from flows.features import FlowFeatures

class JEPAClassifier(Classifier):
    def predict(self, feats: FlowFeatures) -> Prediction:
        # feats.sequence  shape [64, 3]  ← feed this to your encoder
        # feats.scalar_vector  shape [10] ← optional auxiliary input
        embedding = self.encoder(feats.sequence)       # your Net-JEPA encoder
        label, conf = self.knn.query(embedding)        # k-NN lookup
        return Prediction(label=label, confidence=conf, embedding=embedding)

    def save(self, path): ...
    @classmethod
    def load(cls, path): ...
```

2. In `scripts/run_demo.py`, change the import and load line:

```python
# Before:
from model.simple_baseline import RandomForestClassifierModel
model = RandomForestClassifierModel.load(args.model)

# After:
from model.jepa_classifier import JEPAClassifier
model = JEPAClassifier.load(args.model)
```

3. Do the same one-line change in `server/app.py`.

That's it. The `Prediction.embedding` field is already wired through the event JSON
(`embedding` is serialisable as a list) so the UI can optionally display it later.

---

## How to add a new app class

When training on real data, just include pcap or CSV files for the new app — the label
is inferred from the filename (e.g. `TikTok_1.csv` → label `TikTok`). Retrain:

```bash
python scripts/train_baseline.py --data-dir datasets/5g-traffic
```

No code changes needed.

---

## How to change replay speed

**CLI:**
```bash
python scripts/run_demo.py --pcap demo.pcap --model model/checkpoints/baseline.joblib --speed 10
```

**Server:**
```bash
REPLAY_SPEED=10 uvicorn server.app:app
```

`speed=1.0` = real time. `speed=100` = 100× faster (useful for testing the full pcap quickly).

---

## How to change the dashboard row limit or WebSocket port

**Row limit** — edit the constant near the top of `server/static/index.html`:
```js
const MAX_ROWS = 50;   // change to whatever you want
```

**Port:**
```bash
uvicorn server.app:app --port 9000
```

---

## How to run on a different pcap / model without restarting

The server reads `PCAP_PATH`, `MODEL_PATH`, and `REPLAY_SPEED` once at startup.
To switch files, restart the server with updated env vars:

```bash
PCAP_PATH=capture2.pcap MODEL_PATH=model/checkpoints/jepa.joblib uvicorn server.app:app
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Model not found` in browser | server started before training | run `train_synthetic.py` or `train_baseline.py` first |
| `pcap not found` in browser | wrong `PCAP_PATH` | set `PCAP_PATH=path/to/your.pcap` |
| No flows appear | pcap has no TCP/UDP/IP packets | verify with `tcpdump -r demo.pcap` |
| All flows show same label | synthetic model trained on toy data | train on real Kaggle data |
| Very high latency (>100ms) | machine under load or debug mode | use `uvicorn server.app:app` (not `--reload`) |
| Dashboard blank after reload | replay finished | restart the server to replay again |

---

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | Done | Offline pipeline: FlowTable → features → RandomForest |
| 2 | Done | Replay engine: pcap → live terminal output with latency |
| 3 | Done | Dashboard: FastAPI + WebSocket + live browser UI |
| 4 | Pending | Net-JEPA encoder + k-NN behind the same Classifier interface |
| 5 | Pending | Docker image, README run instructions, embedding cluster viz |
