// ───────────────────────────────────────────────────────────────────────────
// injection — orchestrates "upload → parse → animate → project → land".
//
// Bridges a chosen flow to the rest of the demo: register the session
// immediately (so the Inspector's "Injected" tab and the session tray populate
// right away), step the Pipeline Theatre through every stage, and kick off the
// UMAP projection once the walk reaches the embedding stage, so the comet's
// launch — driven reactively off `session.projection` inside `InjectionComet` —
// reads as "the model just produced a representation, here's where it landed".
//
// Two pacing modes:
//   • Server up + a raw file: the walk is driven by the REAL pipeline-stage
//     events the server streams over /ws — the animation advances to a stage
//     only once that stage's event has actually occurred (with a watchable
//     minimum dwell so a fast local server doesn't blur past). For a slow or
//     remote server the animation genuinely waits on the backend.
//   • Otherwise: a fixed-cadence walk + heuristic mockProjector, exactly as
//     before (offline / no-file fallback).
//
// `replayInjection` re-runs the fixed stage walk (and bumps `replayToken`,
// which `InjectionComet` watches to relaunch the comet) for the most recent
// session without re-projecting — replays must be exact, and the stored
// projection already is deterministic.
// ───────────────────────────────────────────────────────────────────────────

import { useStore, PIPELINE_STAGES } from '../state/store';
import { projectToUMAP } from '../data/mockProjector';
import { inferPcapOnServer, serverHealthy } from '../data/server';
import type { InjectedFlow, ProjectionResult, ServerStageEvent, UmapPoint } from '../data/types';

const STAGE_MS = 460;
/** Fire the projection once the walk reaches this stage — late enough that "the encoder finished" reads as the cause of "here's the projection". */
const PROJECT_AT: (typeof PIPELINE_STAGES)[number] = 'embedding';

// How each coarse server stage maps onto the 9-stage client animation. The
// server doesn't emit per-encoder-substage events, so `encode` (emitted *after*
// the model runs, so the encoding genuinely happened) unlocks the whole encoder
// block 3→7 and the min-dwell walk animates through them.
const SERVER_STAGE_TO_ANIM: Partial<Record<ServerStageEvent['stage'], number>> = {
  parse: 0, // → ingest
  flow: 1, // → flow_construction
  preprocess: 2, // → feature_repr
  encode: 7, // → temporal/context/wavelet/fusion/embedding
  classify: 7, // (stays in the encoder/embedding region)
  project: 8, // → projection
  done: 8,
};

/** Minimum visible time per stage when /ws-paced — the watchable floor. */
const STREAM_MIN_STAGE_MS = 380;
/** Absolute safety net so the walk always completes even if /ws goes silent. */
const STREAM_MAX_MS = 20_000;

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
 * Drive the stage walk from the live /ws event stream. Advances toward the
 * furthest stage the server has reported (monotonic — never rewinds, so the
 * per-flow event churn of a multi-flow capture doesn't bounce the animation),
 * one stage per `STREAM_MIN_STAGE_MS` at most. Pauses on a stage until the next
 * stage's event arrives; completes when `done` is seen, when the inference
 * settles with no stream (disconnected /ws), or at the absolute timeout.
 */
async function walkStagesViaStream(
  isServerSettled: () => boolean,
  onStage?: (id: (typeof PIPELINE_STAGES)[number]) => void,
): Promise<void> {
  const { setPipelinePlaying, setPipelineStageIndex } = useStore.getState();
  setPipelinePlaying(true);
  setPipelineStageIndex(-1);

  const last = PIPELINE_STAGES.length - 1;
  let current = -1;
  const start = Date.now();

  while (current < last) {
    const events = useStore.getState().liveEvents;
    let target = -1;
    for (const e of events) {
      const mapped = SERVER_STAGE_TO_ANIM[e.stage];
      if (mapped != null && mapped > target) target = mapped;
    }
    // Don't stall: if inference finished but no stage events ever arrived
    // (e.g. the /ws socket is down), run the walk to completion anyway.
    if (isServerSettled() && events.length === 0) target = last;
    if (Date.now() - start > STREAM_MAX_MS) target = last;

    if (current < target) {
      current += 1;
      setPipelineStageIndex(current);
      onStage?.(PIPELINE_STAGES[current]);
    }
    if (current >= last) break;
    await delay(STREAM_MIN_STAGE_MS);
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
 * Begin a brand-new injection session and animate it end to end. Resolves once
 * the pipeline walk completes — the comet flight (triggered the moment the
 * projection resolves, mid-walk) may still be settling in the background.
 *
 * When `file` is supplied and the inference server is reachable, the projection
 * is produced by *real* end-to-end inference (POST /api/infer), the walk is
 * paced by the server's /ws stage events, and the cloud is refreshed so every
 * flow in the capture is appended. Otherwise it falls back to a fixed-cadence
 * walk and the heuristic projector over the in-memory cloud.
 */
export async function injectFlow(flow: InjectedFlow, fileName: string, file?: File): Promise<void> {
  if (useStore.getState().pipelinePlaying) return; // the "Inject" trigger is disabled mid-run; this is just a safety net for programmatic callers
  const sessionId = useStore.getState().beginInjectionSession(flow, fileName);

  // Fast path: if the /ws stream is already connected the server is definitely
  // up, so skip the health probe; otherwise fall back to an explicit check.
  const streamConnected = useStore.getState().liveStreamConnected;
  const useServer = Boolean(file) && (streamConnected || (await serverHealthy()));
  if (useServer) useStore.getState().clearLiveEvents(); // fresh ticker + pacing for this upload

  // Kick off real server inference immediately (in parallel with the walk),
  // tracking when it settles so the walk can complete even if /ws is silent.
  let serverSettled = false;
  const serverInfer: Promise<ProjectionResult | null> = useServer
    ? inferPcapOnServer(file as File)
        .then(async (added) => {
          if (!added) return null;
          await useStore.getState().refreshBundle(); // new points land in the cloud
          const point = matchServerPoint(flow, added);
          return point
            ? { x: point.x, y: point.y, label: point.label, confidence: point.confidence }
            : null;
        })
        .catch(() => null)
        .finally(() => {
          serverSettled = true;
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

  const onStage = (id: (typeof PIPELINE_STAGES)[number]) => {
    if (id === PROJECT_AT) fireProjection();
  };

  if (useServer) {
    await walkStagesViaStream(() => serverSettled, onStage);
  } else {
    await walkStages(onStage);
  }
  fireProjection(); // guarantees the projection still fires even if PROJECT_AT ever drifts out of PIPELINE_STAGES
}

/** Re-run the stage walk (and the comet flight, via replayToken) for the most recent session — deterministic, so it lands in the same place every time. */
export function replayInjection(): void {
  const { sessions, pipelinePlaying, replayLast } = useStore.getState();
  if (sessions.length === 0 || pipelinePlaying) return;
  replayLast();
  void walkStages();
}
