import { useEffect, useRef } from 'react';
import { useStore, EMPTY_POINTS, EMPTY_CLASSES } from '../../state/store';
import { classHex } from '../../data/classColors';
import type { Camera } from './camera';

const W = 168;
const H = 112;

interface Bounds { minX: number; maxX: number; minY: number; maxY: number; }

/**
 * Bottom-right minimap: a once-rendered raster of the whole cloud (cached to
 * an offscreen canvas — redrawing 6–50k points every frame on Canvas2D would
 * blow the budget) with a live viewport rectangle drawn on top each frame.
 * Click or drag to fly the main camera to that location.
 */
export default function Minimap({ cameraRef }: { cameraRef: React.RefObject<Camera | null> }) {
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const boundsRef = useRef<Bounds | null>(null);
  const draggingRef = useRef(false);

  // Rebuild the cached raster whenever the point cloud changes (dataset switch / load).
  useEffect(() => {
    if (points.length === 0) {
      staticRef.current = null;
      boundsRef.current = null;
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const mx = (maxX - minX) * 0.08 || 1;
    const my = (maxY - minY) * 0.08 || 1;
    const bounds: Bounds = { minX: minX - mx, maxX: maxX + mx, minY: minY - my, maxY: maxY + my };
    boundsRef.current = bounds;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const off = document.createElement('canvas');
    off.width = W * dpr;
    off.height = H * dpr;
    const ctx = off.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#07090d';
    ctx.fillRect(0, 0, W, H);

    const spanX = bounds.maxX - bounds.minX || 1;
    const spanY = bounds.maxY - bounds.minY || 1;
    ctx.globalAlpha = 0.6;
    for (const p of points) {
      ctx.fillStyle = classHex(classes, p.label);
      const mxp = ((p.x - bounds.minX) / spanX) * W;
      const myp = (1 - (p.y - bounds.minY) / spanY) * H;
      ctx.fillRect(mxp, myp, 1.3, 1.3);
    }
    ctx.globalAlpha = 1;
    staticRef.current = off;
  }, [points, classes]);

  // Live overlay loop: blit the cached raster + draw the current viewport rectangle.
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const camera = cameraRef.current;
      const off = staticRef.current;
      const bounds = boundsRef.current;
      if (!canvas || !camera || !off || !bounds) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(off, 0, 0, W, H);

      const spanX = bounds.maxX - bounds.minX || 1;
      const spanY = bounds.maxY - bounds.minY || 1;
      const toMini = (x: number, y: number) => ({
        mx: ((x - bounds.minX) / spanX) * W,
        my: (1 - (y - bounds.minY) / spanY) * H,
      });
      // For 3D, the viewport rect is approximate (top-down projection of the visible area)
      const vr = 1 / camera.zoom;
      const cx = camera.cx;
      const cy = camera.cy;
      const halfW = camera.baseExtent * vr;
      const halfH = halfW * (camera.height / Math.max(camera.width, 1));
      const tl = toMini(cx - halfW, cy + halfH);
      const br = toMini(cx + halfW, cy - halfH);
      ctx.strokeStyle = 'rgba(125,211,252,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(tl.mx + 0.5, tl.my + 0.5, Math.max(br.mx - tl.mx, 1), Math.max(br.my - tl.my, 1));
      ctx.fillStyle = 'rgba(125,211,252,0.07)';
      ctx.fillRect(tl.mx, tl.my, br.mx - tl.mx, br.my - tl.my);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cameraRef]);

  const navigateTo = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    const bounds = boundsRef.current;
    if (!canvas || !camera || !bounds) return;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    const dataX = bounds.minX + px * (bounds.maxX - bounds.minX);
    const dataY = bounds.maxY - py * (bounds.maxY - bounds.minY);
    camera.flyTo(dataX, dataY, camera.zoom, 420);
  };

  if (points.length === 0) return null;

  return (
    <div className="nj-bracket nj-bracket-active !absolute left-4 top-16 z-20 w-48 overflow-hidden rounded-md border border-[var(--nj-border)] bg-[var(--nj-surface)] backdrop-blur-sm">
      <div className="border-b border-[var(--nj-border)] px-2 py-1 font-ui text-[9px] uppercase tracking-[0.18em] text-[var(--nj-text-dim)]">
        Minimap
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: W, height: H, cursor: 'crosshair', display: 'block' }}
        onMouseDown={(e) => { draggingRef.current = true; navigateTo(e.clientX, e.clientY); }}
        onMouseMove={(e) => { if (draggingRef.current) navigateTo(e.clientX, e.clientY); }}
        onMouseUp={() => { draggingRef.current = false; }}
        onMouseLeave={() => { draggingRef.current = false; }}
      />
    </div>
  );
}
