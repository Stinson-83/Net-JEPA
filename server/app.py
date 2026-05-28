"""
Phase 3 server: FastAPI + WebSocket live dashboard.

Run:
    uvicorn server.app:app --reload
    uvicorn server.app:app --host 0.0.0.0 --port 8000

Config via env vars (or defaults):
    PCAP_PATH   — path to .pcap file        (default: demo.pcap)
    MODEL_PATH  — path to trained .joblib   (default: model/checkpoints/baseline.joblib)
    REPLAY_SPEED — float multiplier         (default: 1.0)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

# Allow import from project root when running via uvicorn server.app:app
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from capture.pcap_replay import PcapReplay
from flows.features import extract
from flows.flow_table import FlowTable, FlowKey
from model.simple_baseline import RandomForestClassifierModel

# ──────────────────────────────────────────────────────────────────────────────
PCAP_PATH = os.environ.get("PCAP_PATH", "demo.pcap")
MODEL_PATH = os.environ.get("MODEL_PATH", "model/checkpoints/baseline.joblib")
REPLAY_SPEED = float(os.environ.get("REPLAY_SPEED", "1.0"))

app = FastAPI(title="Net-JEPA Live Demo")

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

_queue: asyncio.Queue = asyncio.Queue(maxsize=500)
_clients: list[WebSocket] = []
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="replay")


# ──────────────────────────────────────────────────────────────────────────────
# Background replay task
# ──────────────────────────────────────────────────────────────────────────────

def _replay_worker(loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
    """Runs in a thread; pushes events onto the asyncio queue."""
    if not os.path.isfile(MODEL_PATH):
        asyncio.run_coroutine_threadsafe(
            queue.put({"error": f"Model not found: {MODEL_PATH}"}), loop
        )
        return
    if not os.path.isfile(PCAP_PATH):
        asyncio.run_coroutine_threadsafe(
            queue.put({"error": f"pcap not found: {PCAP_PATH}"}), loop
        )
        return

    model = RandomForestClassifierModel.load(MODEL_PATH)
    replay = PcapReplay(PCAP_PATH, speed=REPLAY_SPEED)
    table = FlowTable()
    flow_idx = 0
    pkt_count = 0
    t_window = time.monotonic()
    pkt_in_window = 0

    for key, pkts in table.process(replay.stream()):
        pkt_count += len(pkts)
        pkt_in_window += len(pkts)

        t0 = time.perf_counter()
        feats = extract(pkts)
        pred = model.predict(feats)
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)

        ip_lo, ip_hi, port_lo, port_hi, proto = key
        now = time.time()

        # Packets/sec over last second window
        elapsed = time.monotonic() - t_window
        if elapsed >= 1.0:
            pps = round(pkt_in_window / elapsed, 1)
            pkt_in_window = 0
            t_window = time.monotonic()
        else:
            pps = None

        event = {
            "flow_id": f"f{flow_idx:04d}",
            "src": f"{ip_lo}:{port_lo}",
            "dst": f"{ip_hi}:{port_hi}",
            "proto": proto,
            "app": pred.label,
            "confidence": round(pred.confidence, 4),
            "packets": len(pkts),
            "latency_ms": latency_ms,
            "ts": now,
            "total_flows": flow_idx + 1,
            "pps": pps,
        }
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)
        flow_idx += 1

    asyncio.run_coroutine_threadsafe(queue.put({"done": True}), loop)


# ──────────────────────────────────────────────────────────────────────────────
# Startup / shutdown
# ──────────────────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, _replay_worker, loop, _queue)

    # Fan-out task: drain queue → broadcast to all connected clients
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


# ──────────────────────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    html = (STATIC_DIR / "index.html").read_text()
    return HTMLResponse(content=html)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    _clients.append(ws)
    try:
        while True:
            await ws.receive_text()  # keep connection alive; client pings
    except WebSocketDisconnect:
        pass
    finally:
        if ws in _clients:
            _clients.remove(ws)
