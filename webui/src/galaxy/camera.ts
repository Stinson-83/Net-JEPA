// ───────────────────────────────────────────────────────────────────────────
// Camera — 3D orbit camera for the Galaxy. Lives outside React state: pan/zoom/
// animate mutate ~60×/s and must not re-render. The regl loop reads its matrices
// each frame; DOM overlays poll dataToScreen() to convert data → pixels.
// ───────────────────────────────────────────────────────────────────────────

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 40;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface ScreenPoint { x: number; y: number; }

interface FlightState {
  fromCx: number; fromCy: number; fromCz: number; fromZoom: number;
  toCx: number; toCy: number; toCz: number; toZoom: number;
  start: number; duration: number;
}

function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const out = new Float32Array(16);
  const f = 1.0 / Math.tan(fovY / 2);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function lookAt(eye: [number, number, number], center: [number, number, number], up: [number, number, number]): Float32Array {
  const out = new Float32Array(16);
  let fx = center[0] - eye[0], fy = center[1] - eye[1], fz = center[2] - eye[2];
  const fLen = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  fx /= fLen; fy /= fLen; fz /= fLen;
  let sx = fy * up[2] - fz * up[1];
  let sy = fz * up[0] - fx * up[2];
  let sz = fx * up[1] - fy * up[0];
  const sLen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
  sx /= sLen; sy /= sLen; sz /= sLen;
  const ux = sy * fz - sz * fy;
  const uy = sz * fx - sx * fz;
  const uz = sx * fy - sy * fx;
  out[0] = sx; out[1] = ux; out[2] = -fx; out[3] = 0;
  out[4] = sy; out[5] = uy; out[6] = -fy; out[7] = 0;
  out[8] = sz; out[9] = uz; out[10] = -fz; out[11] = 0;
  out[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2]);
  out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[14] = -(-fx * eye[0] + -fy * eye[1] + -fz * eye[2]);
  out[15] = 1;
  return out;
}

export class Camera {
  cx = 0; cy = 0; cz = 0;
  theta = -Math.PI / 6;
  phi = Math.PI / 5;
  distance = 30;
  zoom = 1;
  width = 1;
  height = 1;
  baseExtent = 12;

  viewMatrix: Float32Array = new Float32Array(16);
  projMatrix: Float32Array = new Float32Array(16);
  vpMatrix: Float32Array = new Float32Array(16);

  private flight: FlightState | null = null;
  lastInteract = 0;

  setViewport(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
  }

  fitToBounds(minX: number, maxX: number, minY: number, maxY: number, minZ = 0, maxZ = 0, margin = 1.12): void {
    this.cx = (minX + maxX) / 2;
    this.cy = (minY + maxY) / 2;
    this.cz = (minZ + maxZ) / 2;
    const halfW = Math.max((maxX - minX) / 2, 0.5) * margin;
    const halfH = Math.max((maxY - minY) / 2, 0.5) * margin;
    const halfZ = Math.max((maxZ - minZ) / 2, 0.5) * margin;
    this.baseExtent = Math.max(halfW, halfH, halfZ);
    this.distance = this.baseExtent * 2.35;
    this.zoom = 1;
    this.theta = -Math.PI / 6;
    this.phi = Math.PI / 5;
  }

  get eye(): [number, number, number] {
    const d = this.distance / this.zoom;
    const cosPhi = Math.cos(this.phi);
    return [
      this.cx + d * cosPhi * Math.sin(this.theta),
      this.cy + d * Math.sin(this.phi),
      this.cz + d * cosPhi * Math.cos(this.theta),
    ];
  }

  updateMatrices(): void {
    const aspect = this.width / Math.max(this.height, 1);
    const fov = Math.PI / 4;
    const d = this.distance / this.zoom;
    const near = d * 0.01;
    const far = d * 10;
    this.projMatrix = perspective(fov, aspect, near, far);
    this.viewMatrix = lookAt(this.eye, [this.cx, this.cy, this.cz], [0, 1, 0]);
    this.vpMatrix = mat4Multiply(this.projMatrix, this.viewMatrix);
  }

  dataToScreen(x: number, y: number, z = 0): ScreenPoint {
    const vp = this.vpMatrix;
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    return {
      x: (ndcX * 0.5 + 0.5) * this.width,
      y: (1 - (ndcY * 0.5 + 0.5)) * this.height,
    };
  }

  orbit(dxPx: number, dyPx: number): void {
    this.cancelFlight();
    this.theta -= dxPx * 0.005;
    this.phi = clamp(this.phi + dyPx * 0.005, -Math.PI / 2.2, Math.PI / 2.2);
    this.lastInteract = performance.now();
  }

  /** gentle idle auto-orbit so the galaxy feels alive */
  autoOrbit(now: number): void {
    if (this.flight) return;
    if (now - this.lastInteract < 4500) return;
    this.theta -= 0.0008;
  }

  panByPixels(dxPx: number, dyPx: number): void {
    this.cancelFlight();
    const d = this.distance / this.zoom;
    const scale = d * 0.002;
    const cosT = Math.cos(this.theta);
    const sinT = Math.sin(this.theta);
    this.cx -= (dxPx * cosT) * scale;
    this.cz += (dxPx * sinT) * scale;
    this.cy += dyPx * scale;
    this.lastInteract = performance.now();
  }

  zoomAt(factor: number): void {
    this.cancelFlight();
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.lastInteract = performance.now();
  }

  flyTo(cx: number, cy: number, cz: number, zoom: number, durationMs = 750): void {
    this.flight = {
      fromCx: this.cx, fromCy: this.cy, fromCz: this.cz, fromZoom: this.zoom,
      toCx: cx, toCy: cy, toCz: cz, toZoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
      start: performance.now(), duration: durationMs,
    };
    this.lastInteract = performance.now();
  }

  cancelFlight(): void { this.flight = null; }

  tick(now: number): void {
    const f = this.flight;
    if (!f) return;
    const t = clamp((now - f.start) / f.duration, 0, 1);
    const e = easeInOutCubic(t);
    this.cx = f.fromCx + (f.toCx - f.fromCx) * e;
    this.cy = f.fromCy + (f.toCy - f.fromCy) * e;
    this.cz = f.fromCz + (f.toCz - f.fromCz) * e;
    this.zoom = f.fromZoom + (f.toZoom - f.fromZoom) * e;
    if (t >= 1) this.flight = null;
  }
}
