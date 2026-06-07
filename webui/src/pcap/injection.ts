// ───────────────────────────────────────────────────────────────────────────
// injection — orchestrates "upload → parse → animate → project → land".
//
// Bridges a chosen flow to the rest of the demo: register the session
// immediately (so the Inspector's "Injected" tab and the session tray
// populate right away), step the Pipeline Theatre through every stage on a
// fixed cadence, and kick off the (heuristic — see mockProjector.ts) UMAP
// projection once the walk reaches the embedding stage, so the comet's
// launch — driven reactively off `session.projection` inside
// `InjectionComet` — reads as "the model just produced a representation,
// here's where it landed" rather than firing the instant the file is parsed.
//
// `replayInjection` re-runs the same stage walk (and bumps `replayToken`,
// which `InjectionComet` watches to relaunch the comet) for the most recent
// session without re-running the projection — replays must be exact, and the
// result already is deterministic.
// ───────────────────────────────────────────────────────────────────────────

import { useStore, PIPELINE_STAGES } from '../state/store';
import { projectToUMAP } from '../data/mockProjector';
import { inferPcapOnServer } from '../data/server';
import type { InjectedFlow, ProjectionResult, UmapPoint } from '../data/types';

const STAGE_MS = 460;
/** Fire the projection once the walk reaches this stage — late enough that "the encoder finished" reads as the cause of "here's the projection". */
const PROJECT_AT: (typeof PIPELINE_STAGES)[number] = 'embedding';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function walkStages(onStage?: (id: (typeof PIPELINE_STAGES)[number]) => void): Promise<void> {
  const { setPipelinePlaying, setPipelineStageIndex } = useStore.getState();
  setPipelinePlaying(true);
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    setPipelineStageIndex(i);
    onStage?.(PIPELINE_STAGES[i]);
    await delay(STAGE_MS);
  }
  setPipelinePlaying(false);
}

/**
 * Pick, from the points the server just inferred for this pcap, the one that
 * best corresponds to the flow the user chose to watch. The server's
 * flow_summary is `"{proto} · {n} pkts · {avg} B avg · {dur}s"`; we match on
 * protocol + average packet size (robust to the server's 64-packet cap, which
 * makes raw packet counts diverge from the client's full-flow count).
 */
function matchServerPoint(flow: InjectedFlow, added: UmapPoint[]): UmapPoint | null {
  if (added.length === 0) return null;
  if (added.length === 1) return added[0];
  const proto = flow.tuple.protocol.toUpperCase();
  let best = added[0];
  let bestScore = Infinity;
  for (const p of added) {
    const summary = (p.flow_summary ?? '').toUpperCase();
    const avgMatch = summary.match(/·\s*([\d.]+)\s*B\s*AVG/);
    const avg = avgMatch ? parseFloat(avgMatch[1]) : 0;
    const protoPenalty = summary.startsWith(proto) ? 0 : 1_000;
    const score = Math.abs(avg - flow.avgPacketSize) + protoPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/**
 * Begin a brand-new injection session and animate it end to end. Resolves
 * once the pipeline walk completes — the comet flight (triggered the moment
 * the projection resolves, mid-walk) may still be settling in the background.
 *
 * When `file` is supplied and the inference server is reachable, the projection
 * is produced by *real* end-to-end inference (POST /api/infer) and the cloud is
 * refreshed so every flow in the capture is appended. Otherwise it falls back
 * to the heuristic projector (mockProjector) over the in-memory cloud.
 */
export async function injectFlow(flow: InjectedFlow, fileName: string, file?: File): Promise<void> {
  if (useStore.getState().pipelinePlaying) return; // the "Inject" trigger is disabled mid-run; this is just a safety net for programmatic callers
  const sessionId = useStore.getState().beginInjectionSession(flow, fileName);

  // Kick off real server inference immediately (in parallel with the stage
  // walk) when we have the raw file — it parses + classifies the whole capture.
  if (file) useStore.getState().clearLiveEvents(); // fresh ticker for this upload
  const serverInfer: Promise<ProjectionResult | null> = file
    ? inferPcapOnServer(file).then(async (added) => {
        if (!added) return null;
        await useStore.getState().refreshBundle(); // new points land in the cloud
        const point = matchServerPoint(flow, added);
        return point
          ? { x: point.x, y: point.y, label: point.label, confidence: point.confidence }
          : null;
      })
    : Promise.resolve(null);

  let projectionStarted = false;
  const fireProjection = () => {
    if (projectionStarted) return;
    projectionStarted = true;
    const { manifest, bundle, completeInjectionProjection } = useStore.getState();
    void serverInfer.then((real) => {
      if (real) {
        completeInjectionProjection(sessionId, real);
        return;
      }
      // Fallback: heuristic projector over the current cloud.
      const ctx = { points: bundle?.points ?? [], classes: manifest?.classes ?? [] };
      void projectToUMAP(flow, ctx).then((projection) => completeInjectionProjection(sessionId, projection));
    });
  };

  await walkStages((id) => {
    if (id === PROJECT_AT) fireProjection();
  });
  fireProjection(); // guarantees the projection still fires even if PROJECT_AT ever drifts out of PIPELINE_STAGES
}

/** Re-run the stage walk (and the comet flight, via replayToken) for the most recent session — deterministic, so it lands in the same place every time. */
export function replayInjection(): void {
  const { sessions, pipelinePlaying, replayLast } = useStore.getState();
  if (sessions.length === 0 || pipelinePlaying) return;
  replayLast();
  void walkStages();
}
