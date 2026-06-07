import { useEffect, useRef } from 'react';
import { useStore, PIPELINE_STAGES } from '../state/store';

const IDLE_BEFORE_AUTO = 3_000;    // ms idle before first auto-pick
const PAUSE_AFTER_USER = 15_000;   // ms pause after any real user interaction
const GAP_BETWEEN_DEMOS = 4_000;   // ms between completing one auto-demo and starting the next
const STAGE_MS = 460;

/**
 * AutoDemoController — invisible component that, when auto-demo is ON and the
 * app has been idle (no selection, no injection, no user interaction) for >3s,
 * picks a random flow and walks it through the pipeline animation.  Ephemeral
 * — the auto-picked point does NOT persist as a session ring.
 */
export default function AutoDemoController() {
  const autoDemo = useStore((s) => s.autoDemo);
  const points = useStore((s) => s.bundle?.points ?? []);
  const pipelinePlaying = useStore((s) => s.pipelinePlaying);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!autoDemo || points.length === 0) return;

    const scheduleNext = () => {
      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(() => {
        const state = useStore.getState();
        const now = Date.now();
        const timeSinceUser = now - state.lastUserInteraction;

        // Don't run if user interacted recently, or pipeline is already playing,
        // or a flow is selected, or auto-demo was turned off
        if (!state.autoDemo) return;
        if (state.pipelinePlaying) { scheduleNext(); return; }
        if (state.selectedFlowId) { scheduleNext(); return; }
        if (state.sessions.length > 0 && timeSinceUser < PAUSE_AFTER_USER) { scheduleNext(); return; }
        if (timeSinceUser < IDLE_BEFORE_AUTO) { scheduleNext(); return; }

        // Pick a random point and run the pipeline animation
        void runAutoDemo().then(() => {
          if (!cancelledRef.current) {
            timerRef.current = setTimeout(scheduleNext, GAP_BETWEEN_DEMOS);
          }
        });
      }, IDLE_BEFORE_AUTO);
    };

    cancelledRef.current = false;
    scheduleNext();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [autoDemo, points]);

  // Pause auto-demo on any real user interaction
  useEffect(() => {
    const handler = () => {
      useStore.getState().markUserInteraction();
    };
    window.addEventListener('click', handler, true);
    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('click', handler, true);
      window.removeEventListener('keydown', handler, true);
    };
  }, []);

  return null;
}

async function runAutoDemo(): Promise<void> {
  const state = useStore.getState();
  const pts = state.bundle?.points;
  if (!pts || pts.length === 0) return;

  // Pick a random flow
  const point = pts[Math.floor(Math.random() * pts.length)];

  // Highlight it temporarily (select, then deselect after the animation)
  state.selectFlow(point.id);

  // Walk through pipeline stages
  const { setPipelinePlaying, setPipelineStageIndex } = state;
  setPipelinePlaying(true);

  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    // Check if user interrupted
    const cur = useStore.getState();
    if (!cur.autoDemo || cur.lastUserInteraction > Date.now() - 1000) {
      setPipelinePlaying(false);
      return;
    }
    setPipelineStageIndex(i);
    await new Promise((r) => setTimeout(r, STAGE_MS));
  }

  setPipelinePlaying(false);

  // Deselect the auto-demo point (ephemeral — doesn't persist)
  const afterState = useStore.getState();
  if (afterState.selectedFlowId === point.id) {
    afterState.selectFlow(null);
  }
}
