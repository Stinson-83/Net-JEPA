// ───────────────────────────────────────────────────────────────────────────
// inject.ts — orchestrates "capture → flow → encode → classify → land".
//
//  • Upload a .pcap: if the inference server is up, REAL end-to-end inference
//    (POST /api/infer), paced by the /ws stage stream; otherwise the capture is
//    parsed client-side and projected by the heuristic mockProjector.
//  • Simulate <category>: synthesizes a flow with that class's packet signature
//    and lands it at the class centroid — a no-pcap way for judges to play.
// ───────────────────────────────────────────────────────────────────────────

import { useStore, PIPELINE, SERVER_STAGE_TO_IDX } from './store';
import { categoryMeta } from './categories';
import { parsePcap } from '../pcap/parsePcap';
import { extractFlows } from '../pcap/extractFlows';
import { projectToUMAP } from '../data/mockProjector';
import { inferPcapOnServer, serverHealthy } from '../data/server';
import type { InjectedFlow, ProjectionResult, UmapPoint } from '../data/types';

const STAGE_MS = 430;
const STREAM_MIN_MS = 360;
const STREAM_MAX_MS = 18_000;
const PROJECT_IDX = PIPELINE.findIndex((s) => s.id === 'project');

const delay = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function summarize(flow: InjectedFlow): string {
  return `${flow.tuple.protocol} · ${flow.packetCount} pkts · ${flow.avgPacketSize} B avg · ${flow.durationS.toFixed(1)}s`;
}

async function fixedWalk(onStage: (i: number) => void): Promise<void> {
  const st = useStore.getState();
  st.setPlaying(true);
  for (let i = 0; i < PIPELINE.length; i++) {
    st.setStageIndex(i);
    onStage(i);
    await delay(STAGE_MS);
  }
  st.setPlaying(false);
}

async function streamWalk(settled: () => boolean, onStage: (i: number) => void): Promise<void> {
  const s0 = useStore.getState();
  s0.setPlaying(true); s0.setStageIndex(-1);
  const last = PIPELINE.length - 1;
  let current = -1;
  const start = Date.now();
  while (current < last) {
    const events = useStore.getState().liveEvents;
    let target = -1;
    for (const e of events) { const m = SERVER_STAGE_TO_IDX[e.stage]; if (m != null && m > target) target = m; }
    if (settled() && events.length === 0) target = last;
    if (Date.now() - start > STREAM_MAX_MS) target = last;
    if (current < target) { current += 1; useStore.getState().setStageIndex(current); onStage(current); }
    if (current >= last) break;
    await delay(STREAM_MIN_MS);
  }
  useStore.getState().setPlaying(false);
}

function land(sessionId: string, p: ProjectionResult): void {
  const st = useStore.getState();
  st.completeSession(sessionId, p);
  st.setFocusPoint({ id: `inj-${sessionId}`, x: p.x, y: p.y, label: p.label, confidence: p.confidence });
}

/** Upload path — real inference if the server is up, else client-side parse + project. */
export async function injectFile(file: File): Promise<void> {
  const st = useStore.getState();
  if (st.pipelinePlaying) return;

  let repFlow: InjectedFlow | null = null;
  try {
    const { packets } = parsePcap(await file.arrayBuffer());
    repFlow = extractFlows(packets)[0] ?? null;
  } catch { /* pcapng / unsupported — server can still handle it */ }

  const summary = repFlow ? summarize(repFlow) : file.name;
  const sessionId = st.beginSession(file.name, summary);

  const useServer = await serverHealthy(true);
  if (useServer) st.clearLiveEvents();

  let settled = false;
  const serverInfer: Promise<ProjectionResult | null> = useServer
    ? inferPcapOnServer(file)
      .then(async (added) => {
        if (!added || added.length === 0) return null;
        await useStore.getState().refreshBundle();
        const pt: UmapPoint = added[0];
        return { x: pt.x, y: pt.y, label: pt.label, confidence: pt.confidence };
      })
      .catch(() => null)
      .finally(() => { settled = true; })
    : Promise.resolve(null);

  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    void serverInfer.then((real) => {
      if (real) { land(sessionId, real); return; }
      const { bundle, manifest } = useStore.getState();
      const ctx = { points: bundle?.points ?? [], classes: manifest?.classes ?? [] };
      if (repFlow) void projectToUMAP(repFlow, ctx).then((p) => land(sessionId, p));
    });
  };

  const onStage = (i: number) => { if (i === PROJECT_IDX) fire(); };
  if (useServer) await streamWalk(() => settled, onStage);
  else await fixedWalk(onStage);
  fire();
}

/** Compute the centroid (+confidence proxy) of a category in the current cloud. */
function classCentroid(label: string): { x: number; y: number } | null {
  const pts = (useStore.getState().bundle?.points ?? []).filter((p) => p.label === label);
  if (pts.length === 0) return null;
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

function synthFlow(label: string): InjectedFlow {
  const cs = useStore.getState().bundle?.classStats?.find((c) => c.label === label);
  const avg = cs?.avg_packet_size ?? 400;
  const dur = cs?.avg_duration_s ?? 8;
  const rtt = cs?.avg_rtt_ms ?? 60;
  const proto: InjectedFlow['tuple']['protocol'] = label === 'online_game' || label === 'metaverse' ? 'UDP' : 'TCP';
  const n = 40;
  const sizes = Array.from({ length: n }, (_, i) => Math.max(40, Math.round(avg * (0.5 + Math.random()) * (i % 5 === 0 ? 1.6 : 0.7))));
  const dir = Array.from({ length: n }, (_, i) => (i % 3 === 0 ? -1 : 1));
  const iat = Array.from({ length: n }, (_, i) => (i === 0 ? 0 : (dur / n) * (0.5 + Math.random())));
  return {
    flowId: `sim_${label}_${Date.now()}`,
    tuple: { srcIp: '10.0.0.7', dstIp: '52.0.0.1', srcPort: 44321, dstPort: proto === 'UDP' ? 443 : 443, protocol: proto },
    packetCount: n, packetSizes: sizes, iat, direction: dir,
    rttMs: rtt, jitterMs: rtt * 0.4, durationS: dur, packetRate: n / Math.max(dur, 1),
    avgPacketSize: Math.round(avg), featureVector: [],
  };
}

/** No-pcap demo: synthesize a class's signature and land it at the class centroid. */
export async function simulateCategory(label: string): Promise<void> {
  const st = useStore.getState();
  if (st.pipelinePlaying) return;
  const flow = synthFlow(label);
  const id = st.beginSession(`${categoryMeta(label).name} · simulated`, `sim · ${summarize(flow)}`);
  const fire = () => {
    const c = classCentroid(label);
    const jitter = () => (Math.random() - 0.5) * 1.6;
    const p: ProjectionResult = c
      ? { x: c.x + jitter(), y: c.y + jitter(), label, confidence: 0.9 + Math.random() * 0.09 }
      : { x: jitter(), y: jitter(), label, confidence: 0.9 };
    land(id, p);
  };
  await fixedWalk((i) => { if (i === PROJECT_IDX) fire(); });
  fire();
}
