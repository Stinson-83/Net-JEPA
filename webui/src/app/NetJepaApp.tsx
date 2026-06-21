import { useEffect } from 'react';
import { useStore } from './store';
import type { Scene } from './store';
import ColdOpen from './ColdOpen';
import TopBar from '../panels/TopBar';
import Atlas from '../scenes/Atlas';
import Model from '../scenes/Model';
import Proof from '../scenes/Proof';

const SCENE_KEYS: Record<string, Scene> = { '1': 'atlas', '2': 'model', '3': 'proof' };

export default function NetJepaApp() {
  const bootstrap = useStore((s) => s.bootstrap);
  const introDone = useStore((s) => s.introDone);
  const dataLoading = useStore((s) => s.dataLoading);
  const scene = useStore((s) => s.scene);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  // Kiosk / deep-link affordance: ?skipintro jumps past the intro; ?scene=proof
  // opens a specific scene.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const sc = q.get('scene') as Scene | null;
    if (q.has('skipintro') || sc) useStore.getState().finishIntro();
    if (sc && ['atlas', 'model', 'proof'].includes(sc)) useStore.getState().setScene(sc);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') { useStore.getState().selectFlow(null); return; }
      const s = SCENE_KEYS[e.key];
      if (s) useStore.getState().setScene(s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden nj-space">
      {!introDone && <ColdOpen />}
      <TopBar />
      <main className="relative min-h-0 flex-1 px-3 pb-3">
        <div key={scene} className="h-full w-full nj-rise">
          {scene === 'atlas' && <Atlas />}
          {scene === 'model' && <Model />}
          {scene === 'proof' && <Proof />}
        </div>
        {dataLoading && (
          <div className="absolute inset-0 z-40 grid place-items-center">
            <div className="flex flex-col items-center gap-3">
              <span className="nj-spin h-7 w-7 rounded-full border-2 border-[var(--nj-accent)] border-t-transparent" />
              <span className="text-[11px] tracking-wide text-[var(--nj-text-faint)]">loading the atlas…</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
