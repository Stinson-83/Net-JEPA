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
import type { InjectedFlow } from '../data/types';

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
 * Begin a brand-new injection session and animate it end to end. Resolves
 * once the pipeline walk completes — the comet flight (triggered the moment
 * the projection resolves, mid-walk) may still be settling in the background.
 */
export async function injectFlow(flow: InjectedFlow, fileName: string): Promise<void> {
  if (useStore.getState().pipelinePlaying) return; // the "Inject" trigger is disabled mid-run; this is just a safety net for programmatic callers
  const sessionId = useStore.getState().beginInjectionSession(flow, fileName);

  let projectionStarted = false;
  const fireProjection = () => {
    if (projectionStarted) return;
    projectionStarted = true;
    const { manifest, bundle, completeInjectionProjection } = useStore.getState();
    const ctx = { points: bundle?.points ?? [], classes: manifest?.classes ?? [] };
    void projectToUMAP(flow, ctx).then((projection) => completeInjectionProjection(sessionId, projection));
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
