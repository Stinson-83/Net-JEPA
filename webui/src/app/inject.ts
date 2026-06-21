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

  // Resolve the projection independently of the pipeline animation: real inference
  // if the server is reachable, otherwise the client-side heuristic projector. This
  // guarantees the flow lands (the previous animation-gated path could finish without
  // landing when the server result arrived off-cadence).
  let settled = false;
  const resultP: Promise<ProjectionResult | null> = (async () => {
    if (useServer) {
      try {
        const res = await inferPcapOnServer(file);
        if (res && res.added.length > 0) {
          await useStore.getState().refreshBundle();
          const s = res.summary;
          const pt: UmapPoint = res.added[0];
          // Headline = packet-weighted DOMINANT type over all flows (matches the
          // terminal); landed in that constellation, with the full per-class breakdown.
          const dominant = s?.dominant ?? pt.label;
          const c = classCentroid(dominant);
          const conf = s ? (s.packet_pct[dominant] ?? 0) / 100 : pt.confidence;
          const breakdown = s
            ? { nFlows: s.n_flows, flowCounts: s.flow_counts, packetPct: s.packet_pct, dominant }
            : undefined;
          return { x: c?.x ?? pt.x, y: c?.y ?? pt.y, label: dominant, confidence: conf, breakdown };
        }
      } catch { /* fall through to client-side projection */ }
    }
    if (repFlow) {
      const { bundle, manifest } = useStore.getState();
      return projectToUMAP(repFlow, { points: bundle?.points ?? [], classes: manifest?.classes ?? [] });
    }
    return null;
  })();
  void resultP.finally(() => { settled = true; });

  // Play the pipeline animation for show, then land whatever it produced.
  if (useServer) await streamWalk(() => settled, () => {});
  else await fixedWalk(() => {});
  const result = await resultP;
  if (result) land(sessionId, result);
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
  const proto: InjectedFlow['tuple']['protocol'] = label === 'online_gaming' || label === 'metaverse' ? 'UDP' : 'TCP';
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
