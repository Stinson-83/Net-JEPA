// ───────────────────────────────────────────────────────────────────────────
// ws.ts — live pipeline-stage stream from the inference server (/ws).
//
// While a pcap is being inferred, server/app.py emits one event per stage
// (parse → flow → preprocess → encode → classify → project → done) for every
// flow in the capture. This module keeps a single auto-reconnecting WebSocket
// open and fans those events out to a handler (the store). It's entirely
// optional: if the server is down the socket simply keeps retrying in the
// background and the rest of the UI runs off the static export.
// ───────────────────────────────────────────────────────────────────────────

import { serverUrl } from './server';
import type { ServerStageEvent } from './types';

interface StreamHandlers {
  onEvent: (event: ServerStageEvent) => void;
  onStatus: (connected: boolean) => void;
}

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let shouldRun = false;
let handlers: StreamHandlers | null = null;

const RECONNECT_MS = 3_000;

function wsUrl(): string {
  const base = serverUrl();
  if (base) return `${base.replace(/^http/, 'ws')}/ws`;   // explicit host override
  // same-origin: go through the Vite proxy so only one port needs to be exposed
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function scheduleReconnect(): void {
  if (!shouldRun || reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    open();
  }, RECONNECT_MS);
}

function open(): void {
  if (!shouldRun) return;
  try {
    socket = new WebSocket(wsUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  socket.onopen = () => handlers?.onStatus(true);
  socket.onmessage = (ev) => {
    try {
      const parsed = JSON.parse(ev.data as string) as ServerStageEvent;
      if (parsed && typeof parsed.stage === 'string') {
        handlers?.onEvent({ ...parsed, at: Date.now() });
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  socket.onclose = () => {
    handlers?.onStatus(false);
    scheduleReconnect();
  };
  socket.onerror = () => {
    try {
      socket?.close();
    } catch {
      /* no-op */
    }
  };
}

/** Begin (or re-point) the live stream. Idempotent-ish: safe to call once on boot. */
export function startLiveStream(h: StreamHandlers): void {
  handlers = h;
  shouldRun = true;
  if (!socket || socket.readyState === WebSocket.CLOSED) open();
}

/** Tear the stream down (not currently used — the app keeps it open for its lifetime). */
export function stopLiveStream(): void {
  shouldRun = false;
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  try {
    socket?.close();
  } catch {
    /* no-op */
  }
  socket = null;
}
