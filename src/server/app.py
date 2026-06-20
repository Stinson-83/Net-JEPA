"""
Net-JEPA inference server — FastAPI + WebSocket live dashboard.

This is the single backend behind the unified web demo. It does two things:

  1. Real end-to-end inference on an uploaded .pcap (POST /api/infer): the
     packets are parsed → grouped into flows → featurised → run through the
     trained NetJEPA encoder → classified, and each flow is projected into the
     *same* 2D UMAP space as the reference cloud via the saved reducer. Every
     stage is streamed over the /ws WebSocket so the webui can animate the
     pipeline live, and every resulting point is appended to a persistent
     server-side store so the cloud grows richer over time.

  2. Serves the (growing) cloud + metrics the webui renders:
       GET /api/cloud    — reference points + everything inferred so far
       GET /api/metrics  — project KPIs / per-class stats

Run (after `pip install -e .` from the repo root):
    uvicorn server.app:app --reload
    uvicorn server.app:app --host 0.0.0.0 --port 8000
Without installing, point uvicorn at the source root instead:
    uvicorn server.app:app --app-dir src --host 0.0.0.0 --port 8000

Environment variables:
    DATASET_ID      — export sub-dir under webui/public/data (default: traffic8)
    NETJEPA_CKPT    — trained NetJEPA checkpoint (default: checkpoints/traffic8/phase3/final.pt)
    NETJEPA_LABELS  — labels.json with the 8 traffic-type names (auto-fetched from HF)
    KNN_PATH        — knn.joblib index (optional, auto-detected from ckpt dir)
    PCAP_PATH       — optional .pcap to auto-replay on startup (legacy live mode)
    REPLAY_SPEED    — float multiplier for replay speed (default: 1.0)
"""
from __future__ import annotations

import asyncio
import functools
import json
import math
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List

import numpy as np

# This file lives at  <repo>/src/server/app.py , so:
#   parents[1] = <repo>/src   — the import root (capture/flows/model/netjepa live here)
#   parents[2] = <repo>       — the project root (webui/, checkpoints/, data/ live here)
IMPORT_ROOT  = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(IMPORT_ROOT))

from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from model.netjepa_classifier import NetJEPAClassifier

# ── Configuration ─────────────────────────────────────────────────────────────
def _resolve(p: str) -> str:
    """Resolve a possibly-relative path against the project root so the server
    behaves the same no matter which directory it is launched from."""
    pp = Path(p)
    return str(pp if pp.is_absolute() else (PROJECT_ROOT / pp))

DATASET_ID   = os.environ.get('DATASET_ID',   'traffic8')
NETJEPA_CKPT = _resolve(os.environ.get('NETJEPA_CKPT', 'checkpoints/traffic8/phase3/final.pt'))
KNN_PATH     = os.environ.get('KNN_PATH', '')
KNN_PATH     = _resolve(KNN_PATH) if KNN_PATH else ''
# The 8 traffic-type names the kNN predicts (auto-downloaded from HF if missing).
NETJEPA_LABELS = _resolve(os.environ.get('NETJEPA_LABELS', 'data/processed_traffic/labels.json'))
PCAP_PATH    = os.environ.get('PCAP_PATH', '')
PCAP_PATH    = _resolve(PCAP_PATH) if PCAP_PATH else ''
REPLAY_SPEED = float(os.environ.get('REPLAY_SPEED', '1.0'))
# Published HF model repo to auto-download weights from if they're missing locally
# (lets a bare clone serve the live demo). Set to '' to disable the fallback.
NETJEPA_HF_REPO = os.environ.get('NETJEPA_HF_REPO', 'kritikahd007/net-jepa')

WEBUI_DATA   = PROJECT_ROOT / 'webui' / 'public' / 'data'
DATASET_DIR  = WEBUI_DATA / DATASET_ID
UMAP_PATH    = DATASET_DIR / 'umap.joblib'

SERVER_DATA  = Path(__file__).parent / 'data'
LIVE_STORE   = SERVER_DATA / f'{DATASET_ID}.live.jsonl'

app = FastAPI(title='Net-JEPA Traffic Classifier')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],          # dev: the Vite webui runs on a different port
    allow_methods=['*'],
    allow_headers=['*'],
)

STATIC_DIR = Path(__file__).parent / 'static'
if STATIC_DIR.is_dir():
    app.mount('/static', StaticFiles(directory=str(STATIC_DIR)), name='static')

# ── Shared runtime state ──────────────────────────────────────────────────────
# Populated at startup; guarded by _state_lock for the parts mutated by infer.
_state: Dict[str, Any] = {
    'model':        None,   # NetJEPAClassifier
    'reducer':      None,   # fitted UMAP/PCA with .transform()
    'seed_points':  [],     # reference cloud from the export (read-only)
    'live_points':  [],     # everything inferred since startup (mirrors LIVE_STORE)
    'metrics':      {},     # metrics.json
    'class_stats':  [],     # class_stats.json
    'classes':      [],
    'load_error':   None,
}
_state_lock = asyncio.Lock()

_queue: asyncio.Queue        = asyncio.Queue(maxsize=2000)
_clients: List[WebSocket]    = []
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='infer')


# ── Helpers ───────────────────────────────────────────────────────────────────

_PROTO_NAME = {0: 'TCP', 1: 'UDP', 2: 'QUIC'}


def _flow_summary(packets) -> str:
    if not packets:
        return 'OTHER · 0 pkts · 0 B avg · 0.0s'
    p0 = packets[0]
    if isinstance(p0, dict):                       # flow_builder packet dicts
        sizes = [p['length'] for p in packets]
        times = [p['time'] for p in packets]
        proto = _PROTO_NAME.get(p0.get('protocol_id', 3), 'OTHER')
    else:                                          # PacketRecord
        sizes = [p.size for p in packets]
        times = [p.ts for p in packets]
        proto = p0.proto.upper()
    avg = sum(sizes) / len(sizes)
    dur = max(times[-1] - times[0], 0.0)
    return f'{proto} · {len(sizes)} pkts · {avg:.0f} B avg · {dur:.1f}s'


def _load_jsonl(path: Path) -> List[dict]:
    if not path.is_file():
        return []
    out = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out


def _append_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a') as f:
        f.write(json.dumps(record) + '\n')


def _maybe_fetch_weights() -> None:
    """If the checkpoint / k-NN are missing locally, download them from the
    published Hugging Face model repo (NETJEPA_HF_REPO) so a bare clone can serve
    the live demo. Best-effort — any failure is surfaced later via /api/health."""
    global KNN_PATH
    if not NETJEPA_HF_REPO:
        return
    ckpt = Path(NETJEPA_CKPT)
    knn = Path(KNN_PATH) if KNN_PATH else (ckpt.parent / 'knn.joblib')
    if ckpt.is_file() and knn.is_file():
        return
    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        return  # huggingface_hub not installed → leave it to the FileNotFoundError below
    import shutil
    ckpt.parent.mkdir(parents=True, exist_ok=True)
    if not ckpt.is_file():
        print(f'[net-jepa] weights missing locally → fetching from HF {NETJEPA_HF_REPO} …')
        shutil.copy(hf_hub_download(NETJEPA_HF_REPO, 'net_jepa_phase3.pt'), ckpt)
    if not knn.is_file():
        shutil.copy(hf_hub_download(NETJEPA_HF_REPO, 'knn.joblib'), knn)
        KNN_PATH = str(knn)
    labels = Path(NETJEPA_LABELS)
    if not labels.is_file():
        try:
            labels.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(hf_hub_download(NETJEPA_HF_REPO, 'labels.json'), labels)
        except Exception:
            pass  # fall back to labels.json next to the ckpt / built-in names


def _load_runtime() -> None:
    """Load model + reducer + reference cloud/metrics. Records any error in
    _state['load_error'] rather than raising, so the server still boots and can
    report the problem over /api/health."""
    try:
        _maybe_fetch_weights()
        if not Path(NETJEPA_CKPT).is_file():
            raise FileNotFoundError(f'checkpoint not found: {NETJEPA_CKPT}')

        import joblib
        _labels = NETJEPA_LABELS if Path(NETJEPA_LABELS).is_file() else None
        _state['model']   = NetJEPAClassifier.load(NETJEPA_CKPT, knn_path=KNN_PATH or None,
                                                   labels=_labels)

        umap_json = DATASET_DIR / 'embeddings_umap.json'
        _state['seed_points'] = json.loads(umap_json.read_text()) if umap_json.is_file() else []

        metrics_json = DATASET_DIR / 'metrics.json'
        _state['metrics'] = json.loads(metrics_json.read_text()) if metrics_json.is_file() else {}

        cs_json = DATASET_DIR / 'class_stats.json'
        _state['class_stats'] = json.loads(cs_json.read_text()) if cs_json.is_file() else []

        manifest = WEBUI_DATA / 'manifest.json'
        if manifest.is_file():
            _state['classes'] = json.loads(manifest.read_text()).get('classes', [])

        # The UMAP reducer is OPTIONAL — it only refines the 2-D galaxy position.
        # Its joblib pickle can be Python-version-specific (e.g. fitted on 3.10,
        # served on 3.13 → "code() argument … must be str, not int"), so a load
        # failure must NOT take down classification. Fall back to class-centroid
        # projection (see _project_xy) when it's missing or unloadable.
        _state['reducer'] = None
        if UMAP_PATH.is_file():
            try:
                _state['reducer'] = joblib.load(UMAP_PATH)
            except Exception as exc:  # noqa: BLE001
                print(f'[net-jepa] UMAP reducer unloadable ({exc}); using centroid '
                      'fallback for 2-D projection. Classification is unaffected.')
        else:
            print(f'[net-jepa] no UMAP reducer at {UMAP_PATH}; using centroid fallback.')

        # Replay any previously-persisted live points back into memory.
        _state['live_points'] = _load_jsonl(LIVE_STORE)

    except Exception as exc:  # noqa: BLE001
        _state['load_error'] = str(exc)


def _emit_threadsafe(loop: asyncio.AbstractEventLoop, event: dict) -> None:
    asyncio.run_coroutine_threadsafe(_queue.put(event), loop)


def _project_xy(emb: 'np.ndarray', label: str, idx: int) -> tuple:
    """Project a 128-D embedding to the galaxy's 2-D space. Uses the fitted UMAP
    reducer when available; otherwise (e.g. the reducer pickle won't load on this
    Python) falls back to the predicted class's centroid in the seed cloud, with a
    small deterministic golden-angle offset so stacked points stay separable."""
    reducer = _state.get('reducer')
    if reducer is not None:
        try:
            xy = reducer.transform(emb)[0]
            return float(xy[0]), float(xy[1])
        except Exception:  # noqa: BLE001
            pass
    pts = [p for p in _state.get('seed_points', []) if p.get('label') == label]
    if pts:
        cx = sum(p['x'] for p in pts) / len(pts)
        cy = sum(p['y'] for p in pts) / len(pts)
    else:
        cx = cy = 0.0
    ang = idx * 2.399963229728653  # golden angle (rad)
    return cx + 0.8 * math.cos(ang), cy + 0.8 * math.sin(ang)


def _infer_pcap_worker(loop: asyncio.AbstractEventLoop,
                       pcap_path: str, degrade: dict | None = None) -> List[dict]:
    """Runs in a worker thread. Parses the pcap, classifies + projects every
    flow, streams each stage over /ws, persists + returns the new points."""
    def emit(ev: dict) -> None:
        _emit_threadsafe(loop, ev)

    model = _state['model']
    if model is None:
        emit({'stage': 'error', 'error': _state.get('load_error') or 'model not loaded'})
        return []

    emit({'stage': 'parse', 'pcap': Path(pcap_path).name})

    # Build flows EXACTLY like the training pipeline (parser schema -> flow_builder:
    # up to 64 packets/flow, 30s idle split), and compute src-host stats across ALL
    # flows — so a live flow is featurised identically to a training flow. (The
    # terminal tool src/netjepa/scripts/infer_pcap.py uses the same path.)
    from model.netjepa_classifier import pcap_to_flows
    from netjepa.data.features import compute_src_host_stats
    flows = pcap_to_flows(pcap_path)
    host_stats = compute_src_host_stats(flows)

    added: List[dict] = []
    batch_id = int(time.time())
    for idx, flow in enumerate(flows):
        pkts = flow['packets']
        flow_id = f'live-{batch_id}-{idx:04d}'
        emit({'stage': 'flow', 'flow_id': flow_id,
              'src': f"{flow['src_ip']}:{flow['src_port']}", 'dst': f"{flow['dst_ip']}:{flow['dst_port']}",
              'proto': _PROTO_NAME.get(flow['protocol_id'], 'OTHER'), 'packets': len(pkts)})

        emit({'stage': 'preprocess', 'flow_id': flow_id})
        t0   = time.perf_counter()
        pred = model.predict_flow(flow, host_stats, degrade=degrade)
        latency = round((time.perf_counter() - t0) * 1000, 2)
        emit({'stage': 'encode', 'flow_id': flow_id, 'latency_ms': latency})

        if pred.embedding is None:
            emit({'stage': 'error', 'flow_id': flow_id, 'error': 'no embedding (knn missing?)'})
            continue

        emit({'stage': 'classify', 'flow_id': flow_id,
              'label': pred.category, 'app': pred.label,
              'confidence': round(float(pred.confidence), 4)})

        emb  = np.asarray(pred.embedding, dtype=np.float32).reshape(1, -1)
        x, y = _project_xy(emb, pred.category, idx)

        point = {
            'id':           flow_id,
            'x':            x,
            'y':            y,
            'label':        pred.category,
            'confidence':   round(float(pred.confidence), 3),
            'packets':      len(pkts),
            'flow_summary': _flow_summary(pkts),
            'source':       'live',
            'ts':           time.time(),
            'embedding':    [round(float(v), 5) for v in emb[0]],
        }
        _append_jsonl(LIVE_STORE, point)
        _state['live_points'].append(point)
        added.append(point)

        emit({'stage': 'project', 'flow_id': flow_id, 'x': x, 'y': y,
              'label': pred.category, 'confidence': point['confidence'],
              'flow_summary': point['flow_summary']})

    emit({'stage': 'done', 'added': len(added),
          'total_live': len(_state['live_points'])})
    return added


# ── Legacy pcap-replay worker (only if PCAP_PATH is set) ──────────────────────

def _replay_worker(loop: asyncio.AbstractEventLoop) -> None:
    if not PCAP_PATH or not Path(PCAP_PATH).is_file():
        return  # nothing to replay; the upload path is the primary mode now
    try:
        _infer_pcap_worker(loop, PCAP_PATH)
    except Exception as exc:  # noqa: BLE001
        _emit_threadsafe(loop, {'stage': 'error', 'error': f'replay failed: {exc}'})


# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event('startup')
async def startup() -> None:
    _load_runtime()
    loop = asyncio.get_event_loop()
    asyncio.create_task(_fanout())
    if PCAP_PATH:
        loop.run_in_executor(_executor, _replay_worker, loop)


async def _fanout() -> None:
    while True:
        event = await _queue.get()
        if _clients:
            data = json.dumps(event)
            dead = []
            for ws in list(_clients):
                try:
                    await ws.send_text(data)
                except Exception:  # noqa: BLE001
                    dead.append(ws)
            for ws in dead:
                if ws in _clients:
                    _clients.remove(ws)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get('/api/health')
async def health() -> JSONResponse:
    return JSONResponse({
        'ok':          _state['load_error'] is None and _state['model'] is not None,
        'dataset':     DATASET_ID,
        'error':       _state['load_error'],
        'projection':  'umap' if _state.get('reducer') is not None else 'centroid-fallback',
        'seed_points': len(_state['seed_points']),
        'live_points': len(_state['live_points']),
        'classes':     _state['classes'],
    })


@app.get('/api/cloud')
async def cloud() -> JSONResponse:
    """Reference cloud + everything inferred so far. Live points omit the bulky
    embedding vector (kept only on disk for a future map rebuild)."""
    live = [{k: v for k, v in p.items() if k != 'embedding'}
            for p in _state['live_points']]
    return JSONResponse({
        'seed':    _state['seed_points'],
        'live':    live,
        'classes': _state['classes'],
    })


@app.get('/api/metrics')
async def metrics() -> JSONResponse:
    return JSONResponse({
        'metrics':     _state['metrics'],
        'class_stats': _state['class_stats'],
        'live_count':  len(_state['live_points']),
    })


def _summarize(added: List[dict]) -> dict:
    """Per-pcap class breakdown over ALL classified flows — so a capture that
    contains a mix (e.g. video + the web traffic around it) reports every type,
    not just one. flow_counts + packet-weighted percentages + the dominant type
    (same logic as the terminal infer_pcap.py)."""
    counts: dict = {}
    weighted: dict = {}
    for p in added:
        lab = p.get('label', 'unknown')
        counts[lab] = counts.get(lab, 0) + 1
        weighted[lab] = weighted.get(lab, 0) + int(p.get('packets', 1))
    total = sum(weighted.values()) or 1
    pct = {k: round(100 * v / total, 1)
           for k, v in sorted(weighted.items(), key=lambda kv: -kv[1])}
    dominant = max(weighted.items(), key=lambda kv: kv[1])[0] if weighted else None
    # A per-capture representative embedding = L2-normalised mean of the dominant
    # class's flow embeddings. Two captures' rep_embeddings give the intra/inter
    # cosine the Proof-Lab "compare two flows" overlay reports.
    rep = None
    embs = [p['embedding'] for p in added
            if p.get('label') == dominant and p.get('embedding') is not None]
    if embs:
        m = np.asarray(embs, dtype=np.float32).mean(axis=0)
        n = float(np.linalg.norm(m))
        if n > 0:
            rep = [round(float(v), 5) for v in (m / n)]
    return {'n_flows': len(added), 'flow_counts': counts,
            'packet_pct': pct, 'dominant': dominant, 'rep_embedding': rep}


@app.post('/api/infer')
async def infer(file: UploadFile = File(...),
                degrade: str | None = Form(None)) -> JSONResponse:
    """Classify an uploaded pcap. Optional `degrade` (JSON of degrade_flow kwargs,
    e.g. {"packet_loss_prob":1.0,"packet_loss_window":0.3}) applies the JEPA
    degradation to every flow before embedding — the "degraded flow → still
    correct" demo run."""
    if _state['load_error'] is not None:
        return JSONResponse({'error': _state['load_error']}, status_code=503)

    deg = None
    if degrade:
        try:
            deg = json.loads(degrade)
            if not isinstance(deg, dict):
                deg = None
        except (ValueError, TypeError):
            deg = None

    suffix = Path(file.filename or 'upload.pcap').suffix or '.pcap'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    loop = asyncio.get_event_loop()
    try:
        added = await loop.run_in_executor(
            _executor, functools.partial(_infer_pcap_worker, loop, tmp_path, degrade=deg))
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return JSONResponse({
        'added':      [{k: v for k, v in p.items() if k != 'embedding'} for p in added],
        'count':      len(added),
        'total_live': len(_state['live_points']),
        'summary':    _summarize(added),
    })


@app.get('/', response_class=HTMLResponse)
async def index() -> HTMLResponse:
    idx_file = STATIC_DIR / 'index.html'
    if idx_file.is_file():
        return HTMLResponse(content=idx_file.read_text())
    return HTMLResponse(content='<h1>Net-JEPA server</h1><p>See /api/health</p>')


@app.websocket('/ws')
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    _clients.append(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if ws in _clients:
            _clients.remove(ws)
