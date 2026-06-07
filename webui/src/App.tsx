import { useEffect } from 'react';
import { MotionConfig } from 'motion/react';
import { useStore } from './state/store';
import { replayInjection } from './pcap/injection';
import TopBar from './components/TopBar/TopBar';
import UMAPStage from './components/UMAPStage/UMAPStage';
import PipelineTheatre from './components/PipelineTheatre/PipelineTheatre';
import Inspector from './components/Inspector/Inspector';
import Metrics from './components/Metrics/Metrics';
import PcapModal from './components/PcapModal/PcapModal';
import AutoDemoController from './components/AutoDemoController';
import PhaseStrip from './components/TopBar/PhaseStrip';

/**
 * Single-screen layout — fills the viewport with no page scroll at 1440p:
 *
 *   ┌─────────────────────────── TopBar (~64px) ───────────────────────────┐
 *   │  ┌──────────────── Main Stage (60%) ───────────────┐ ┌ Right Rail ┐  │
 *   │  │                                                  │ │ Pipeline 45│  │
 *   │  │                  UMAPStage (WebGL)               │ │ Inspector30│  │
 *   │  │                                                  │ │ Metrics  25│  │
 *   │  └──────────────────────────────────────────────────┘ └────────────┘  │
 *   └────────────────────────────────────────────────────────────────────────┘
 *
 * The 60/40 and 45/30/25 splits are plain flex-grow ratios — they hold their
 * shape across viewport sizes without any media queries, and every panel
 * manages its own internal scrolling (`.nj-scroll`) so the shell never does.
 */
export default function App() {
  const bootstrap = useStore((s) => s.bootstrap);
  const theatreCollapsed = useStore((s) => s.theatreCollapsed);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Space replays the last injection (mirrors the InjectButton tooltip's
  // "Replay last injection (Space)" hint). Ignored while typing in a field
  // or while the upload modal is open, so it never steals focus from a form.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (useStore.getState().modalOpen) return;
      e.preventDefault();
      replayInjection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-screen flex-col overflow-hidden bg-[var(--nj-bg)]">
        <TopBar />
        <PhaseStrip />
        <main className="flex min-h-0 flex-1 gap-3 p-3">
          <div className="min-h-0 min-w-0" style={{ flex: '3 3 0%' }}>
            <UMAPStage />
          </div>
          <div className="flex min-h-0 min-w-0 flex-col gap-3" style={{ flex: '2 2 0%' }}>
            {theatreCollapsed ? (
              <div className="h-12 shrink-0">
                <PipelineTheatre />
              </div>
            ) : (
              <div className="min-h-0" style={{ flex: '45 45 0%' }}>
                <PipelineTheatre />
              </div>
            )}
            <div className="min-h-0" style={{ flex: theatreCollapsed ? '50 50 0%' : '30 30 0%' }}>
              <Inspector />
            </div>
            <div className="min-h-0" style={{ flex: '25 25 0%' }}>
              <Metrics />
            </div>
          </div>
        </main>
        <PcapModal />
        <AutoDemoController />
      </div>
    </MotionConfig>
  );
}
