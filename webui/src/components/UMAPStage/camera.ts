// ───────────────────────────────────────────────────────────────────────────
// Camera — shared data-space ⇄ screen-space transform for the UMAP theatre.
//
// Lives outside React state on purpose: pan/zoom/animate need to mutate ~60
// times a second, and routing that through useState/zustand would re-render
// the whole stage every frame. Instead this is a plain mutable object that:
//   • the regl render loop reads directly each frame to build its uniforms,
//   • DOM overlays (kNN lines, comet, minimap, tooltip) poll each frame via
//     their own rAF loops to convert data-space coordinates to screen pixels.
//
// `BASE_EXTENT` is the half-width (in UMAP data units) visible at zoom = 1.
// UMAP output scale varies run to run, so on data load the stage calls
// `fitToBounds` once to pick a BASE_EXTENT that frames the whole cloud.
// ───────────────────────────────────────────────────────────────────────────

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 40;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface ScreenPoint { x: number; y: number; }
export interface DataPoint { x: number; y: number; }

interface FlightState {
  fromCx: number; fromCy: number; fromZoom: number;
  toCx: number; toCy: number; toZoom: number;
  start: number; duration: number;
}

export class Camera {
  cx = 0;
  cy = 0;
  zoom = 1;
  width = 1;
  height = 1;
  baseExtent = 12;

  private flight: FlightState | null = null;

  setViewport(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
  }

  /** Frame the camera so [minX,maxX]×[minY,maxY] fits with a margin. Called once on data load. */
  fitToBounds(minX: number, maxX: number, minY: number, maxY: number, margin = 1.25): void {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const halfW = Math.max((maxX - minX) / 2, 0.5) * margin;
    const halfH = Math.max((maxY - minY) / 2, 0.5) * margin;
    this.baseExtent = Math.max(halfW, halfH * (this.width / Math.max(this.height, 1)));
    this.cx = cx;
    this.cy = cy;
    this.zoom = 1;
  }

  get halfExtentX(): number {
    return this.baseExtent / this.zoom;
  }
  get halfExtentY(): number {
    return this.halfExtentX * (this.height / Math.max(this.width, 1));
  }

  dataToScreen(x: number, y: number): ScreenPoint {
    const ndcX = (x - this.cx) / this.halfExtentX;
    const ndcY = (y - this.cy) / this.halfExtentY;
    return {
      x: (ndcX * 0.5 + 0.5) * this.width,
      y: (1 - (ndcY * 0.5 + 0.5)) * this.height,
    };
  }

  screenToData(px: number, py: number): DataPoint {
    const ndcX = (px / this.width) * 2 - 1;
    const ndcY = 1 - (py / this.height) * 2;
    return {
      x: this.cx + ndcX * this.halfExtentX,
      y: this.cy + ndcY * this.halfExtentY,
    };
  }

  panByPixels(dxPx: number, dyPx: number): void {
    this.cancelFlight();
    this.cx -= dxPx * ((2 * this.halfExtentX) / this.width);
    this.cy += dyPx * ((2 * this.halfExtentY) / this.height);
  }

  zoomAt(px: number, py: number, factor: number): void {
    this.cancelFlight();
    const before = this.screenToData(px, py);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const after = this.screenToData(px, py);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  /** Smoothly fly the camera to a new center/zoom. Used by point-focus, minimap clicks, "fit all". */
  flyTo(cx: number, cy: number, zoom: number, durationMs = 650): void {
    this.flight = {
      fromCx: this.cx, fromCy: this.cy, fromZoom: this.zoom,
      toCx: cx, toCy: cy, toZoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
      start: performance.now(), duration: durationMs,
    };
  }

  cancelFlight(): void {
    this.flight = null;
  }

  /** Advance any in-flight camera animation. Call once per render frame. */
  tick(now: number): void {
    const f = this.flight;
    if (!f) return;
    const t = clamp((now - f.start) / f.duration, 0, 1);
    const e = easeInOutCubic(t);
    this.cx = f.fromCx + (f.toCx - f.fromCx) * e;
    this.cy = f.fromCy + (f.toCy - f.fromCy) * e;
    this.zoom = f.fromZoom + (f.toZoom - f.fromZoom) * e;
    if (t >= 1) this.flight = null;
  }
}
