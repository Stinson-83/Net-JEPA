import { useEffect, useRef } from 'react';
import { useStore, useActiveSession, EMPTY_CLASSES } from '../../state/store';
import { classHex } from '../../data/classColors';
import { mulberry32, seedFromString } from '../../data/rng';
import type { Camera } from './camera';

const TRAIL_LEN = 16;
const FLIGHT_MS = 1500;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * "A bright comet flies from off-canvas to the projected (x,y) on the UMAP."
 *
 * Flies through *data space* (not screen space): the start point is placed
 * far outside the cloud in a direction derived deterministically from the
 * session id, then both head and trail are projected to screen pixels each
 * frame via the live camera. Two payoffs: (1) the flight automatically
 * tracks the simultaneous camera.flyTo() auto-pan with zero extra code, and
 * (2) "Replay last injection" reproduces an identical flight path, because
 * the seed — and therefore the start point — is a pure function of the
 * session id rather than Math.random().
 */
export default function InjectionComet({ cameraRef }: { cameraRef: React.RefObject<Camera | null> }) {
  const session = useActiveSession();
  const replayToken = useStore((s) => s.replayToken);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);
  const headRef = useRef<HTMLDivElement | null>(null);
  const trailRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | undefined>(undefined);

  const projection = session?.projection;

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera || !session || !projection) return;

    const rng = mulberry32(seedFromString(session.id));
    const angle = rng() * Math.PI * 2;
    const angle2 = rng() * Math.PI * 2;
    const dist = camera.baseExtent * (2.4 + rng() * 0.8);
    const target = { x: projection.x, y: projection.y, z: 0 };
    const start = {
      x: target.x + Math.cos(angle) * dist,
      y: target.y + Math.sin(angle) * dist * 0.5,
      z: Math.sin(angle2) * dist * 0.4,
    };

    const trail: { x: number; y: number; z: number }[] = [];
    let cancelled = false;
    const t0 = performance.now();

    // Gently auto-pan/zoom toward the new point while the comet is in flight.
    camera.flyTo(target.x, target.y, Math.max(camera.zoom, 2.4), FLIGHT_MS - 80);

    const showEl = (el: HTMLDivElement | null, x: number, y: number, opacity: number, scale: number) => {
      if (!el) return;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.opacity = String(opacity);
      el.style.setProperty('--nj-comet-scale', String(scale));
    };

    const step = () => {
      if (cancelled) return;
      const now = performance.now();
      const t = Math.min(1, (now - t0) / FLIGHT_MS);
      const e = easeOutCubic(t);
      const cx = start.x + (target.x - start.x) * e;
      const cy = start.y + (target.y - start.y) * e;
      const cz = start.z + (target.z - start.z) * e;

      trail.unshift({ x: cx, y: cy, z: cz });
      if (trail.length > TRAIL_LEN) trail.length = TRAIL_LEN;

      const head = camera.dataToScreen(cx, cy, cz);
      showEl(headRef.current, head.x, head.y, 1, 1);

      for (let i = 0; i < TRAIL_LEN; i++) {
        const p = trail[i];
        const el = trailRefs.current[i];
        if (!p) {
          if (el) el.style.opacity = '0';
          continue;
        }
        const sp = camera.dataToScreen(p.x, p.y, p.z);
        const fade = (1 - i / TRAIL_LEN) ** 1.4;
        showEl(el, sp.x, sp.y, fade * 0.6, 1 - (i / TRAIL_LEN) * 0.75);
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        // settle: fade the comet out, leaving the persistent session ring (rendered by UMAPCanvas) behind
        window.setTimeout(() => {
          if (cancelled) return;
          if (headRef.current) headRef.current.style.opacity = '0';
          trailRefs.current.forEach((el) => { if (el) el.style.opacity = '0'; });
        }, 320);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, [session, projection, replayToken, cameraRef]);

  if (!projection) return null;
  const color = classHex(classes, projection.label);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: TRAIL_LEN }).map((_, i) => (
        <div
          key={i}
          ref={(el) => { trailRefs.current[i] = el; }}
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 blur-[1.5px] transition-opacity duration-300 ease-out"
          style={{
            background: color,
            boxShadow: `0 0 10px 2px ${color}`,
            transform: 'translate(-50%, -50%) scale(var(--nj-comet-scale, 1))',
          }}
        />
      ))}
      <div
        ref={headRef}
        className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity duration-300 ease-out"
        style={{ background: '#ffffff', boxShadow: `0 0 8px 2px #ffffff, 0 0 32px 10px ${color}` }}
      />
    </div>
  );
}
