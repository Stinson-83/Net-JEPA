// ───────────────────────────────────────────────────────────────────────────
// server.ts — optional live backend (server/app.py).
//
// When the Net-JEPA inference server is reachable, the webui sources the point
// cloud + metrics from it (so the cloud grows as flows are inferred) and runs
// real end-to-end inference on uploaded pcaps via POST /api/infer — replacing
// the heuristic mockProjector. When it's NOT reachable every call here returns
// null, and the caller transparently falls back to the static export / mock.
//
// Point at a different host with VITE_SERVER_URL (default http://localhost:8000).
// ───────────────────────────────────────────────────────────────────────────

import type { MetricsData, UmapPoint } from './types';

const SERVER_URL = (
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? 'http://localhost:8000'
).replace(/\/+$/, '');

export function serverUrl(): string {
  return SERVER_URL;
}

// Health is cached for a short window so we don't probe on every fetch, but a
// fresh upload re-checks (force=true) in case the server just came up.
let _healthCache: { ok: boolean; at: number } | null = null;
const HEALTH_TTL_MS = 5_000;

export async function serverHealthy(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && _healthCache && now - _healthCache.at < HEALTH_TTL_MS) {
    return _healthCache.ok;
  }
  let ok = false;
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    if (res.ok) {
      const body = (await res.json()) as { ok?: boolean };
      ok = Boolean(body.ok);
    }
  } catch {
    ok = false;
  }
  _healthCache = { ok, at: now };
  return ok;
}

interface CloudResponse {
  seed: UmapPoint[];
  live: UmapPoint[];
  classes: string[];
}

/** Reference cloud + everything inferred so far, merged. null if server down. */
export async function fetchServerCloud(): Promise<UmapPoint[] | null> {
  if (!(await serverHealthy())) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/cloud`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as CloudResponse;
    return [...(data.seed ?? []), ...(data.live ?? [])];
  } catch {
    return null;
  }
}

/** Project KPIs/metrics from the server. null if server down or absent. */
export async function fetchServerMetrics(): Promise<MetricsData | null> {
  if (!(await serverHealthy())) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/metrics`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { metrics?: MetricsData };
    return data.metrics && Object.keys(data.metrics).length > 0 ? data.metrics : null;
  } catch {
    return null;
  }
}

/**
 * Run real inference on an uploaded pcap. The server parses it, classifies +
 * projects every flow, appends each to its persistent store, and returns the
 * points it just added. null if the server is unavailable or errored — caller
 * falls back to the heuristic projector.
 */
export async function inferPcapOnServer(file: File): Promise<UmapPoint[] | null> {
  if (!(await serverHealthy(true))) return null;
  try {
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch(`${SERVER_URL}/api/infer`, { method: 'POST', body: form });
    if (!res.ok) return null;
    const data = (await res.json()) as { added?: UmapPoint[] };
    return data.added ?? [];
  } catch {
    return null;
  }
}
