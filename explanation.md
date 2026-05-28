# Net-JEPA — Full Repository File-by-File Explanation

## What the project does (in one sentence)
Net-JEPA classifies live (or replayed) network traffic into application categories
(Netflix, Zoom, Gaming, …) by turning raw packets into flow-level feature vectors
and running them through a classifier, with a real-time WebSocket dashboard.

---

## Repository layout

```
netjepa-live/
├── capture/            # Layer 1 – Raw packet abstraction
│   ├── __init__.py
│   ├── base.py
│   └── pcap_replay.py
├── flows/              # Layer 2 – Flow assembly & feature extraction
│   ├── __init__.py
│   ├── flow_table.py
│   └── features.py
├── model/              # Layer 3 – Classifier
│   ├── __init__.py
│   ├── classifier_base.py
│   ├── simple_baseline.py
│   └── checkpoints/
│       └── baseline.joblib
├── server/             # Layer 4 – Live dashboard
│   ├── app.py
│   └── static/
│       └── index.html
├── scripts/            # Utility entry-points
│   ├── gen_demo_pcap.py
│   ├── run_demo.py
│   ├── train_baseline.py
│   └── train_synthetic.py
├── demo.pcap           # Pre-generated synthetic traffic
├── requirements.txt
└── README.md
```

---

## Layer 0 — Root files

### `requirements.txt`
| | |
|---|---|
| **Purpose** | Pins all Python dependencies |
| **Input** | — |
| **Output** | — |
| **Key deps** | `scapy` (pcap parsing), `scikit-learn` (RandomForest), `numpy`, `pandas`, `joblib` (model serialisation), `fastapi` + `uvicorn` (async web server) |
| **Workflow role** | Run `pip install -r requirements.txt` once before anything else |

---

### `README.md`
| | |
|---|---|
| **Purpose** | Hackathon submission template — team info, links to artefacts, video, dataset |
| **Input** | — |
| **Output** | — |
| **Workflow role** | Static documentation only; not imported by any code |

---

### `demo.pcap`
| | |
|---|---|
| **Purpose** | Pre-generated synthetic pcap used for the demo so you don't need a live network capture |
| **Input** | Produced by `scripts/gen_demo_pcap.py` |
| **Output** | Consumed by `scripts/run_demo.py` and `server/app.py` |
| **Workflow role** | Acts as the default traffic source for the entire pipeline |

---

## Layer 1 — `capture/` (Raw Packet Abstraction)

### `capture/base.py`
| | |
|---|---|
| **Purpose** | Defines the **shared data contract** for the rest of the system |
| **Input** | Nothing (pure definitions) |
| **Output** | Two exported types: `PacketRecord` and `PacketSource` |

**`PacketRecord` (dataclass)**  
A single normalised packet snapshot:
```
ts          float  – UNIX timestamp
src_ip      str
dst_ip      str
src_port    int
dst_port    int
proto       str    – "TCP" or "UDP"
size        int    – IP payload bytes
direction   int    – +1 outbound, -1 inbound
```

**`PacketSource` (abstract class)**  
Any class that yields `PacketRecord` objects must implement `.stream() → Iterator[PacketRecord]`.

> **Workflow role**: Every other module uses `PacketRecord` as its currency. `PacketSource` is the plug-in interface — swap `PcapReplay` for a live-capture adapter without changing anything downstream.

---

### `capture/pcap_replay.py`
| | |
|---|---|
| **Purpose** | Reads a `.pcap` / `.pcapng` file and **replays** it as a stream of `PacketRecord` objects, honouring the original inter-packet timing |
| **Input** | A `.pcap` file path + optional `speed` multiplier + optional `local_ip` hint |
| **Output** | `Iterator[PacketRecord]` via `.stream()` |

**Key internals:**

| Helper | What it does |
|---|---|
| `_is_private(ip)` | Returns `True` for RFC-1918 / loopback addresses |
| `_detect_local_ip(pcap, sample=200)` | Sniffs first 200 packets; the most-frequent private IP is declared "local" — used to set `direction` |
| `PcapReplay.stream()` | Walks every packet with Scapy's `PcapReader`; skips non-IP and non-TCP/UDP frames; sleeps `gap` seconds to maintain the replay timeline at `1/speed` rate |

> **Workflow role**: The source of all packet data. Called by `run_demo.py`, `train_baseline.py` (pcap mode), and `server/app.py`.

---

### `capture/__init__.py`
Re-exports `PacketRecord` and `PacketSource` so callers can write `from capture import PacketRecord`.

---

## Layer 2 — `flows/` (Flow Assembly & Feature Extraction)

### `flows/flow_table.py`
| | |
|---|---|
| **Purpose** | **Assembles individual packets into bidirectional flows** and emits a flow once it has enough packets |
| **Input** | `Iterable[PacketRecord]` (from any `PacketSource`) |
| **Output** | `Generator[(FlowKey, List[PacketRecord])]` |

**Constants:**
| Constant | Value | Meaning |
|---|---|---|
| `MAX_PACKETS` | 64 | Store at most 64 packets per flow (memory cap) |
| `MIN_PACKETS` | 10 | Emit a flow only after ≥ 10 packets |
| `IDLE_TIMEOUT` | 15 s | Delete a flow that has been silent for 15 seconds |

**`FlowKey`** = `(ip_lo, ip_hi, port_lo, port_hi, proto)` — a canonical tuple where the lower IP/port pair always goes first so both directions of a TCP/UDP session map to the same key.

**`_Flow` (internal)**  
Tracks `packets`, `packet_count`, `first_ts`, `last_ts`, `emitted` flag.

**`FlowTable.process(packets)`**  
1. For each incoming packet, compute its `FlowKey`.  
2. Create or update the matching `_Flow`.  
3. Call `_expire()` to purge timed-out flows.  
4. If the flow just hit `MIN_PACKETS` and hasn't been emitted yet → `yield (key, packets)`.  
5. At end-of-stream, `_flush_all()` yields any remaining un-emitted flows.

> **Workflow role**: The heart of the pipeline. Converts an unstructured packet stream into per-flow batches that can be feature-engineered.

---

### `flows/features.py`
| | |
|---|---|
| **Purpose** | Converts a `List[PacketRecord]` (one flow) into a fixed-size numeric feature vector |
| **Input** | `List[PacketRecord]` |
| **Output** | `FlowFeatures` dataclass containing two arrays |

**`FlowFeatures`:**
| Field | Shape | Description |
|---|---|---|
| `scalar_vector` | `[10]` float32 | Global flow statistics |
| `sequence` | `[64, 3]` float32 | Per-packet sequence (size, IAT, direction), zero-padded |

**The 10 scalar features (`SCALAR_FEATURE_NAMES`):**
```
packet_count    – total packets in the flow
duration        – last_ts − first_ts (seconds)
mean_pkt_size   – mean payload size
std_pkt_size    – std dev of payload size
mean_iat        – mean inter-arrival time
std_iat         – std dev of IAT (jitter proxy)
bytes_up        – total outbound bytes
bytes_down      – total inbound bytes
up_down_ratio   – (up packets) / (down packets)
packet_rate     – packets per second
```

**`extract(packets)`** computes all of the above using NumPy in a single pass.

> **Workflow role**: The feature engineering step. Its `scalar_vector` is fed directly to the RandomForest classifier. The `sequence` array is reserved for the future Net-JEPA transformer encoder.

---

### `flows/__init__.py`
Re-exports `FlowTable`, `FlowFeatures`, and `extract`.

---

## Layer 3 — `model/` (Classifier)

### `model/classifier_base.py`
| | |
|---|---|
| **Purpose** | Abstract base class defining the **classifier interface** |
| **Input** | `FlowFeatures` object |
| **Output** | `Prediction` dataclass |

**`Prediction`:**
```
label       str            – predicted application name
confidence  float          – probability of the top class
embedding   Optional[ndarray]  – latent vector (None for baseline, used by Net-JEPA later)
```

**`Classifier` (ABC)** requires:
- `.predict(feats) → Prediction`
- `.save(path)`
- `.load(path)` (classmethod)

> **Workflow role**: The swap point documented in the code comment: *"Phase 4 swap point: swap RandomForest for Net-JEPA encoder + k-NN here."* Any future model (transformer + k-NN) implements this interface and the rest of the pipeline needs zero changes.

---

### `model/simple_baseline.py`
| | |
|---|---|
| **Purpose** | Concrete classifier — a **scikit-learn RandomForest** wrapped behind the `Classifier` interface |
| **Input** | `FlowFeatures` (uses `scalar_vector` only) |
| **Output** | `Prediction` |

**Key methods:**

| Method | What it does |
|---|---|
| `fit(X, y)` | Encodes labels with `LabelEncoder`, trains `RandomForestClassifier(n_estimators=200)` |
| `predict(feats)` | Reshapes `scalar_vector` to `[1, 10]`, runs `predict_proba`, returns top label + confidence |
| `save(path)` | Serialises `{rf, le}` to a `.joblib` file |
| `load(path)` | Deserialises and reconstructs the object |

> **Workflow role**: The current production classifier. Used by `run_demo.py`, `train_baseline.py`, `train_synthetic.py`, and `server/app.py`.

---

### `model/checkpoints/baseline.joblib`
| | |
|---|---|
| **Purpose** | Serialised trained model (RandomForest + LabelEncoder) |
| **Input** | Written by `train_baseline.py` or `train_synthetic.py` |
| **Output** | Loaded by `run_demo.py` and `server/app.py` at startup |

---

### `model/__init__.py`
Re-exports `Classifier` and `Prediction`.

---

## Layer 4 — `server/` (Live Dashboard)

### `server/app.py`
| | |
|---|---|
| **Purpose** | **FastAPI + WebSocket server** that ties the entire pipeline together and streams classification events to a browser dashboard |
| **Input** | `PCAP_PATH` (env var, default `demo.pcap`), `MODEL_PATH` (env var), `REPLAY_SPEED` (env var) |
| **Output** | HTTP at `/` (serves HTML), WebSocket at `/ws` (streams JSON events) |

**Architecture — three concurrent parts:**

```
Thread (ThreadPoolExecutor)          asyncio event loop
─────────────────────────────        ──────────────────────────────────
_replay_worker()                     _fanout() coroutine
  PcapReplay.stream()                  reads from asyncio.Queue
  → FlowTable.process()                → broadcasts JSON to all WebSocket clients
  → features.extract()
  → model.predict()
  → asyncio.run_coroutine_threadsafe(queue.put(event))
```

**Each JSON event pushed to clients:**
```json
{
  "flow_id":    "f0001",
  "src":        "192.168.1.10:52341",
  "dst":        "52.1.1.1:443",
  "proto":      "UDP",
  "app":        "Netflix",
  "confidence": 0.94,
  "packets":    10,
  "latency_ms": 0.23,
  "ts":         1700000045.7,
  "total_flows": 12,
  "pps":        87.3
}
```

**Routes:**
| Route | Type | Description |
|---|---|---|
| `GET /` | HTTP | Returns `index.html` |
| `GET /static/*` | HTTP | Serves files from `server/static/` |
| `WS /ws` | WebSocket | Client connects; server pushes flow events |

> **Workflow role**: The "Phase 3" real-time interface. Run with `uvicorn server.app:app`.

---

### `server/static/index.html`
| | |
|---|---|
| **Purpose** | Single-page dashboard that visualises live classifications |
| **Input** | WebSocket messages from `server/app.py` |
| **Output** | Visual table + stats strip in the browser |

**UI sections:**

| Section | What it shows |
|---|---|
| Header | Status dot (green = live), connection state |
| Stats strip | Total Flows / Packets-per-sec / Avg Latency / Top App |
| Flow table | Last 50 flows: Flow ID, Src↔Dst, Proto badge, App name, confidence bar, packet count, latency |

**JS logic:**
- Connects to `ws://{host}/ws` on page load; auto-reconnects after 2 s on disconnect.
- `addRow(ev)` inserts a new `<tr>` at the top, runs a CSS fade-in animation, and caps the table at 50 rows.
- Latency colouring: green < 10 ms, yellow < 50 ms, red ≥ 50 ms.
- 15-second keep-alive ping to prevent WebSocket idle timeout.

---

## Scripts

### `scripts/gen_demo_pcap.py`
| | |
|---|---|
| **Purpose** | **Generates a synthetic `.pcap`** simulating three applications (Netflix, Zoom, Gaming) — no real network needed |
| **Input** | CLI args: `--out` (default `demo.pcap`), `--duration` (90 s), `--seed` (42) |
| **Output** | A valid `.pcap` file with Ethernet/IPv4/UDP frames |

**Simulation parameters:**
| App | Remote IP | Port | Packet sizes | IAT mean | Flows |
|---|---|---|---|---|---|
| Netflix | 52.1.1.1 | 443 | 800–1400 B | 8 ms | 15 |
| Zoom | 52.2.2.2 | 8801 | 100–600 B | 20 ms | 8 |
| Gaming | 52.3.3.3 | 7777 | 60–200 B | 5 ms | 12 |

Writes raw binary pcap using `struct.pack` (no Scapy write dependency). 70% of packets are outbound.

> **Workflow role**: One-time setup step. Produces `demo.pcap` used by all other scripts.

---

### `scripts/train_synthetic.py`
| | |
|---|---|
| **Purpose** | Trains the **RandomForest on purely synthetic Gaussian feature vectors** — no dataset download required |
| **Input** | CLI arg: `--out` (model save path) |
| **Output** | `model/checkpoints/baseline.joblib` |

Generates 500 samples per class (Netflix / Zoom / Gaming) using per-class Gaussian distributions that encode domain knowledge (e.g., Netflix = large packets, low jitter; Gaming = tiny packets, very fast IAT). Splits 80/20, trains, prints a classification report, saves.

> **Workflow role**: Quickest way to get a working model checkpoint for testing the demo pipeline end-to-end.

---

### `scripts/train_baseline.py`
| | |
|---|---|
| **Purpose** | Trains the **RandomForest on a real dataset** (5G Kaggle traffic CSVs or raw pcap files) |
| **Input** | CLI args: `--data-dir` (path to dataset root), `--out`, `--explore` |
| **Output** | `model/checkpoints/baseline.joblib` |

**Two loading modes (auto-detected):**
1. **CSV mode** (`_load_csvs`): walks `data_dir` for `.csv` files, maps columns to the 10 scalar features using a synonym table (`_COL_SYNONYMS`), infers labels from a `Label` column or filename stem.  
2. **Pcap mode** (`_load_pcaps`): falls back if no CSVs found; runs each `.pcap` through `PcapReplay → FlowTable → extract`, labels from filename.

Minimum 4 matched columns required; NaN/Inf replaced before training.

> **Workflow role**: Production training path. Replaces the synthetic checkpoint with one trained on real 5G traffic data.

---

### `scripts/run_demo.py`
| | |
|---|---|
| **Purpose** | **CLI demo** — replays a pcap, classifies each flow, prints a formatted table to stdout |
| **Input** | CLI args: `--pcap`, `--model`, `--speed` |
| **Output** | Terminal table: FlowID ↔ endpoints / App / Confidence / Packets / Latency |

Wires `PcapReplay → FlowTable → extract → RandomForestClassifierModel.predict` in a simple for-loop, measuring per-flow latency with `time.perf_counter`.

> **Workflow role**: Lightweight sanity check / debugging tool without starting the web server.

---

## End-to-end Workflow

```
                        ┌─────────────────────┐
  (one-time)            │  gen_demo_pcap.py   │──→ demo.pcap
                        └─────────────────────┘

  (one-time)            ┌─────────────────────┐
                        │ train_synthetic.py  │──→ baseline.joblib
                        │  or                 │
                        │ train_baseline.py   │
                        └─────────────────────┘

  ┌──────────────┐   packets   ┌─────────────┐   (key,pkts)  ┌──────────────┐   features   ┌──────────────────┐   Prediction
  │  PcapReplay  │────────────→│  FlowTable  │───────────────→│  features.   │─────────────→│  RandomForest    │───────────→
  │ (capture/)   │             │  (flows/)   │                │  extract()   │              │  Classifier      │
  └──────────────┘             └─────────────┘                └──────────────┘              └──────────────────┘
         ↑                                                                                          │
    demo.pcap                                                                                       ↓
                                                                                         ┌──────────────────────┐
                                                                                         │  server/app.py       │
                                                                                         │  (FastAPI + WS)      │
                                                                                         └──────┬───────────────┘
                                                                                                │  JSON events
                                                                                                ↓
                                                                                         ┌──────────────────┐
                                                                                         │  index.html      │
                                                                                         │  (Dashboard)     │
                                                                                         └──────────────────┘
```

### Phase map (as the codebase itself names them)
| Phase | Files | What happens |
|---|---|---|
| **Phase 1** | `capture/base.py`, `capture/pcap_replay.py` | Packet ingestion & normalisation |
| **Phase 2** | `flows/`, `scripts/run_demo.py` | Flow assembly, feature extraction, CLI classification |
| **Phase 3** | `server/app.py`, `server/static/index.html` | Live WebSocket dashboard |
| **Phase 4** (planned) | `model/classifier_base.py` swap point | Replace RandomForest with Net-JEPA transformer encoder + k-NN |
