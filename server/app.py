"""
Net-JEPA inference server — FastAPI + WebSocket live dashboard.

Run:
    uvicorn server.app:app --reload
    uvicorn server.app:app --host 0.0.0.0 --port 8000

Environment variables:
    PCAP_PATH       — path to .pcap file for replay    (required for replay mode)
    NETJEPA_CKPT    — path to trained NetJEPA checkpoint (default: checkpoints/phase3/final.pt)
    KNN_PATH        — path to knn.joblib index          (optional, auto-detected from ckpt dir)
    REPLAY_SPEED    — float multiplier for replay speed (default: 1.0)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from capture.pcap_replay import PcapReplay
from flows.flow_table import FlowTable, FlowKey
from model.netjepa_classifier import NetJEPAClassifier

# ── Configuration ─────────────────────────────────────────────────────────────
PCAP_PATH    = os.environ.get('PCAP_PATH',    '')
NETJEPA_CKPT = os.environ.get('NETJEPA_CKPT', 'checkpoints/phase3/final.pt')
KNN_PATH     = os.environ.get('KNN_PATH',     '')
REPLAY_SPEED = float(os.environ.get('REPLAY_SPEED', '1.0'))

app = FastAPI(title='Net-JEPA Traffic Classifier')

STATIC_DIR = Path(__file__).parent / 'static'
app.mount('/static', StaticFiles(directory=str(STATIC_DIR)), name='static')

_queue: asyncio.Queue   = asyncio.Queue(maxsize=500)
_clients: list[WebSocket] = []
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='replay')


# ── Background replay worker ──────────────────────────────────────────────────

def _replay_worker(loop: asyncio.AbstractEventLoop,
                   queue: asyncio.Queue) -> None:
    def _emit(event: dict) -> None:
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    if not PCAP_PATH or not Path(PCAP_PATH).is_file():
        _emit({'error': f'pcap not found: {PCAP_PATH or "(PCAP_PATH not set)"}. '
                        'Set the PCAP_PATH environment variable.'})
        return

    if not Path(NETJEPA_CKPT).is_file():
        _emit({'error': f'NetJEPA checkpoint not found: {NETJEPA_CKPT}. '
                        'Train the model first (netjepa/scripts/train_phase3.py).'})
        return

    try:
        model = NetJEPAClassifier.load(
            NETJEPA_CKPT,
            knn_path=KNN_PATH or None)
    except Exception as exc:
        _emit({'error': f'Failed to load model: {exc}'})
        return

    replay    = PcapReplay(PCAP_PATH, speed=REPLAY_SPEED)
    table     = FlowTable()
    flow_idx  = 0
    pkt_count = 0
    t_window  = time.monotonic()
    pkt_in_win = 0

    for key, pkts in table.process(replay.stream()):
        pkt_count  += len(pkts)
        pkt_in_win += len(pkts)

        t0      = time.perf_counter()
        pred    = model.predict(pkts)
        latency = round((time.perf_counter() - t0) * 1000, 2)

        ip_lo, ip_hi, port_lo, port_hi, proto = key
        now = time.time()

        elapsed = time.monotonic() - t_window
        if elapsed >= 1.0:
            pps        = round(pkt_in_win / elapsed, 1)
            pkt_in_win = 0
            t_window   = time.monotonic()
        else:
            pps = None

        _emit({
            'flow_id':    f'f{flow_idx:04d}',
            'src':        f'{ip_lo}:{port_lo}',
            'dst':        f'{ip_hi}:{port_hi}',
            'proto':      proto,
            'app':        pred.label,
            'category':   pred.category,
            'confidence': round(pred.confidence, 4),
            'packets':    len(pkts),
            'latency_ms': latency,
            'ts':         now,
            'total_flows': flow_idx + 1,
            'pps':        pps,
        })
        flow_idx += 1

    _emit({'done': True})


# ── Startup / shutdown ────────────────────────────────────────────────────────

@app.on_event('startup')
async def startup() -> None:
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, _replay_worker, loop, _queue)
    asyncio.create_task(_fanout())


async def _fanout() -> None:
    while True:
        event = await _queue.get()
        if _clients:
            data = json.dumps(event)
            dead = []
            for ws in list(_clients):
                try:
                    await ws.send_text(data)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                if ws in _clients:
                    _clients.remove(ws)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get('/', response_class=HTMLResponse)
async def index() -> HTMLResponse:
    html = (STATIC_DIR / 'index.html').read_text()
    return HTMLResponse(content=html)


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
