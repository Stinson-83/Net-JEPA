import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, EMPTY_POINTS, EMPTY_CLASSES } from '../../state/store';
import { Camera } from './camera';
import { classColor } from '../../data/classColors';
import UMAPCanvas, { type HoverInfo } from './UMAPCanvas';
import KnnLines from './KnnLines';
import InjectionComet from './InjectionComet';
import Legend from './Legend';
import Minimap from './Minimap';
import SessionTray from './SessionTray';
import Tooltip from './Tooltip';
import SimilarityProbe from './SimilarityProbe';

/**
 * Left "main stage": the WebGL UMAP point-cloud theatre plus its DOM overlays
 * (legend, minimap, kNN constellation, comet, tooltip, session tray). Every
 * overlay shares one `Camera` instance via `cameraRef` so it stays glued to
 * the GPU-rendered cloud through pans, zooms, and fly-to animations.
 */
export default function UMAPStage() {
  // Lazy-init so the Camera is created exactly once and survives re-renders —
  // it's a plain mutable object, not React state (see camera.ts for why).
  const cameraRef = useRef<Camera | null>(null);
  if (cameraRef.current === null) cameraRef.current = new Camera();

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);
  const dataLoading = useStore((s) => s.dataLoading);
  const focusPoint = useStore((s) => s.focusPoint);
  const setFocusPoint = useStore((s) => s.setFocusPoint);

  // "Locate" requests from the inspector / session tray fly the camera in,
  // then self-clear so the same point can be re-focused later.
  useEffect(() => {
    if (!focusPoint) return;
    const camera = cameraRef.current;
    if (camera) camera.flyTo(focusPoint.x, focusPoint.y, Math.max(camera.zoom, 3), 700);
    setFocusPoint(null);
  }, [focusPoint, setFocusPoint]);

  // Digit keys 1..N isolate/restore class N (mirrors the Legend's kbd hints);
  // Escape clears the current selection. Ignored while typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') {
        useStore.getState().selectFlow(null);
        return;
      }
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= classes.length) {
        useStore.getState().toggleClassVisibility(classes[n - 1]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [classes]);

  // Compute per-class centroids for floating labels
  const centroids = useMemo(() => {
    if (points.length === 0 || classes.length === 0) return [];
    return classes.map((label) => {
      const members = points.filter((p) => p.label === label);
      if (members.length === 0) return null;
      const cx = members.reduce((s, p) => s + p.x, 0) / members.length;
      const cy = members.reduce((s, p) => s + p.y, 0) / members.length;
      const cz = members.reduce((s, p) => s + (p.z ?? 0), 0) / members.length;
      return { label, cx, cy, cz, count: members.length };
    }).filter(Boolean) as { label: string; cx: number; cy: number; cz: number; count: number }[];
  }, [points, classes]);

  return (
    <section className="nj-hex-grid relative h-full w-full overflow-hidden rounded-lg border border-[var(--nj-border)] bg-[var(--nj-bg-raised)]" style={{ backgroundSize: '56px 100px' }}>
      {points.length > 0 ? (
        <>
          <UMAPCanvas cameraRef={cameraRef} onHover={setHover} />
          <KnnLines cameraRef={cameraRef} />
          <InjectionComet cameraRef={cameraRef} />
          <Legend />
          <Minimap cameraRef={cameraRef} />
          <SessionTray />
          <Tooltip info={hover} />
          <SimilarityProbe cameraRef={cameraRef} />
          {/* Centroid labels */}
          <CentroidLabels cameraRef={cameraRef} centroids={centroids} classes={classes} />
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
          <div className="font-ui text-[13px] text-[var(--nj-text-dim)]">
            {dataLoading ? 'Loading embedding space…' : 'No embedding data available'}
          </div>
          <div className="font-mono text-[10px] text-[var(--nj-text-faint)]">
            expects <code className="text-[var(--nj-text-dim)]">/public/data/&lt;dataset&gt;/embeddings_umap.json</code>
          </div>
        </div>
      )}
      <div className="nj-bracket nj-bracket-active pointer-events-none absolute left-4 top-4 z-20 px-2 py-1">
        <span className="font-ui text-[9px] uppercase tracking-[0.22em] text-[var(--nj-text-faint)]">
          Embedding Space · UMAP(3)
        </span>
      </div>
      {/* Radial vignette overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 55%, rgba(7,9,13,0.45) 100%)',
        }}
      />
      <div className="nj-scanlines" />
    </section>
  );
}

/** Floating class-name labels anchored to each cluster’s centroid. */
function CentroidLabels({ cameraRef, centroids, classes }: {
  cameraRef: React.RefObject<Camera | null>;
  centroids: { label: string; cx: number; cy: number; cz: number; count: number }[];
  classes: string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement[]>([]);

  useEffect(() => {
    if (centroids.length === 0) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const camera = cameraRef.current;
      if (!camera) return;
      for (let i = 0; i < centroids.length; i++) {
        const c = centroids[i];
        const el = labelsRef.current[i];
        if (!el) continue;
        const s = camera.dataToScreen(c.cx, c.cy, c.cz);
        el.style.transform = `translate(${s.x}px, ${s.y - 16}px)`;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cameraRef, centroids]);

  if (centroids.length === 0) return null;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {centroids.map((c, i) => {
        const hue = classColor(classes, c.label);
        return (
          <div
            key={c.label}
            ref={(el) => { if (el) labelsRef.current[i] = el; }}
            className="absolute left-0 top-0 flex flex-col items-center"
            style={{ willChange: 'transform' }}
          >
            <span
              className="whitespace-nowrap font-mono text-[9px] font-medium tracking-wide"
              style={{
                color: hue.hex,
                textShadow: `0 0 8px rgba(0,0,0,0.8), 0 1px 3px rgba(0,0,0,0.6)`,
              }}
            >
              {c.label}
            </span>
            <span className="mt-px h-[6px] w-px" style={{ background: hue.hex, opacity: 0.5 }} />
          </div>
        );
      })}
    </div>
  );
}
