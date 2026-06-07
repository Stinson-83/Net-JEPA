import { useEffect, useRef, useState } from 'react';
import { useStore, EMPTY_POINTS, EMPTY_CLASSES } from '../../state/store';
import { Camera } from './camera';
import { classColor } from '../../data/classColors';

interface Props {
  cameraRef: React.RefObject<Camera | null>;
}

/**
 * Alt+Hover probe: when holding Alt, cursor becomes a crosshair and
 * casts a web to the nearest point of each class within a radius,
 * showing a tooltip with the physical distances in projection space.
 */
export default function SimilarityProbe({ cameraRef }: Props) {
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);
  const hidden = useStore((s) => s.hiddenClasses);
  
  const [active, setActive] = useState(false);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  
  // Track Alt key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Alt') setActive(true); };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Alt') setActive(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // Also cancel if window loses focus
    window.addEventListener('blur', () => setActive(false));
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', () => setActive(false));
    };
  }, []);

  // Track mouse position over the canvas
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  if (!active || !mouse || !cameraRef.current || points.length === 0) return null;

  // We have screen coordinates. We need to find the nearest points in *3D data space*.
  // A perfect implementation would unproject the ray and do a cylinder/cone intersection.
  // For a fast interactive probe, we can project all points to screen space (expensive if done naively)
  // or use the camera to raycast. Actually, projecting all 6k points to 2D per frame in JS is fast enough.
  const camera = cameraRef.current;
  
  // Find nearest point per class in screen space
  const nearestPerClass = new Map<string, { point: any; distSq: number; screen: { x: number, y: number } }>();
  
  for (const p of points) {
    if (hidden.has(p.label)) continue;
    const s = camera.dataToScreen(p.x, p.y, p.z ?? 0);
    // Screen distance from mouse
    const dx = s.x - mouse.x;
    const dy = s.y - mouse.y;
    const distSq = dx * dx + dy * dy;
    
    // 150px radius limit for probe
    if (distSq > 150 * 150) continue;
    
    const existing = nearestPerClass.get(p.label);
    if (!existing || distSq < existing.distSq) {
      nearestPerClass.set(p.label, { point: p, distSq, screen: s });
    }
  }

  const hits = Array.from(nearestPerClass.values());
  if (hits.length === 0) {
    return (
      <div 
        className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
        style={{ cursor: 'crosshair' }} // Overrides default cursor
      >
        <div 
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--nj-accent)]/30 bg-[var(--nj-accent)]/[0.05]"
          style={{ left: mouse.x, top: mouse.y, width: 300, height: 300 }}
        />
        <div 
          className="absolute h-4 w-px bg-[var(--nj-accent)]/80 -translate-x-1/2 -translate-y-1/2"
          style={{ left: mouse.x, top: mouse.y }}
        />
        <div 
          className="absolute h-px w-4 bg-[var(--nj-accent)]/80 -translate-x-1/2 -translate-y-1/2"
          style={{ left: mouse.x, top: mouse.y }}
        />
      </div>
    );
  }

  // Calculate 3D distances from the nearest point to the other nearest points, or from a fake "center"
  // Actually, let's just use the physical 3D distance from the probe ray.
  // Wait, the prompt says: "showing physical manifold distance ... to the nearest neighbor of each class found in the radius."
  // Distances between the hits themselves, or distance to the camera ray? 
  // Let's pick the closest overall point as the "probe center" in 3D, and measure distances from it.
  hits.sort((a, b) => a.distSq - b.distSq);
  const centerHit = hits[0];
  const centerP = centerHit.point;

  const results = hits.map(hit => {
    const p = hit.point;
    // 3D distance
    const dx = p.x - centerP.x;
    const dy = p.y - centerP.y;
    const dz = (p.z ?? 0) - (centerP.z ?? 0);
    const dist3D = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return { ...hit, dist3D };
  });

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {/* Probe radius ring */}
      <div 
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--nj-accent)]/20 bg-[var(--nj-accent)]/[0.02]"
        style={{ left: mouse.x, top: mouse.y, width: 300, height: 300 }}
      />
      
      {/* Crosshair */}
      <div 
        className="absolute h-4 w-px bg-[var(--nj-accent)] -translate-x-1/2 -translate-y-1/2"
        style={{ left: mouse.x, top: mouse.y }}
      />
      <div 
        className="absolute h-px w-4 bg-[var(--nj-accent)] -translate-x-1/2 -translate-y-1/2"
        style={{ left: mouse.x, top: mouse.y }}
      />

      {/* Spiderweb lines to hits */}
      <svg className="absolute inset-0 h-full w-full">
        {results.map((res, i) => {
          if (i === 0) return null; // Don't draw line to itself
          const hue = classColor(classes, res.point.label);
          return (
            <line
              key={res.point.label}
              x1={centerHit.screen.x}
              y1={centerHit.screen.y}
              x2={res.screen.x}
              y2={res.screen.y}
              stroke={hue.hex}
              strokeWidth="1.5"
              strokeDasharray="4 2"
              opacity="0.6"
            />
          );
        })}
      </svg>

      {/* Hit points */}
      {results.map((res, i) => {
        const hue = classColor(classes, res.point.label);
        const isCenter = i === 0;
        return (
          <div
            key={res.point.label}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ 
              left: res.screen.x, 
              top: res.screen.y,
              width: isCenter ? 8 : 6,
              height: isCenter ? 8 : 6,
              background: hue.hex,
              boxShadow: `0 0 8px ${hue.hex}`
            }}
          />
        );
      })}

      {/* Tooltip */}
      <div 
        className="absolute z-50 rounded-md border border-[var(--nj-border)] bg-[var(--nj-surface-solid)]/95 px-2.5 py-2 shadow-xl backdrop-blur-md"
        style={{ left: mouse.x + 20, top: mouse.y + 20 }}
      >
        <div className="mb-1.5 border-b border-[var(--nj-border)] pb-1.5 font-ui text-[10px] uppercase tracking-wider text-[var(--nj-text-dim)]">
          Probing from <span style={{ color: classColor(classes, centerHit.point.label).hex }}>{centerHit.point.label}</span>
        </div>
        <div className="flex flex-col gap-1">
          {results.slice(1).map(res => {
            const hue = classColor(classes, res.point.label);
            return (
              <div key={res.point.label} className="flex items-center justify-between gap-4 font-mono text-[10px]">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: hue.hex }} />
                  <span className="text-[var(--nj-text)]">{res.point.label}</span>
                </span>
                <span className="text-[var(--nj-text-bright)]">
                  {res.dist3D.toFixed(2)} u
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
