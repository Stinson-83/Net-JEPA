// ───────────────────────────────────────────────────────────────────────────
// Camera — 3D orbit camera for the UMAP theatre.
//
// Lives outside React state on purpose: pan/zoom/animate need to mutate ~60
// times a second, and routing that through useState/zustand would re-render
// the whole stage every frame. Instead this is a plain mutable object that:
//   • the regl render loop reads directly each frame to build its uniforms,
//   • DOM overlays (kNN lines, comet, minimap, tooltip) poll each frame via
//     their own rAF loops to convert data-space coordinates to screen pixels.
//
// The camera uses spherical coordinates (theta, phi, distance) orbiting
// around a target point, with perspective projection.
// ───────────────────────────────────────────────────────────────────────────

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 40;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface ScreenPoint { x: number; y: number; }
export interface DataPoint { x: number; y: number; }

interface FlightState {
  fromCx: number; fromCy: number; fromCz: number; fromZoom: number;
  fromTheta: number; fromPhi: number;
  toCx: number; toCy: number; toCz: number; toZoom: number;
  toTheta: number; toPhi: number;
  start: number; duration: number;
}

/** 4x4 matrix multiply (column-major, like WebGL) */
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

/** Perspective projection matrix */
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

/** Look-at view matrix */
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
  // Target point (orbit center)
  cx = 0;
  cy = 0;
  cz = 0;

  // Spherical coordinates
  theta = -Math.PI / 6;  // horizontal angle (yaw)
  phi = Math.PI / 5;      // vertical angle (pitch from XY plane)
  distance = 30;          // distance from target

  zoom = 1;
  width = 1;
  height = 1;
  baseExtent = 12;

  // Cached matrices (rebuilt each frame)
  viewMatrix = new Float32Array(16);
  projMatrix = new Float32Array(16);
  vpMatrix = new Float32Array(16);

  private flight: FlightState | null = null;

  setViewport(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
  }

  /** Frame the camera so [minX,maxX]×[minY,maxY] fits with a margin. Called once on data load. */
  fitToBounds(minX: number, maxX: number, minY: number, maxY: number, minZ = 0, maxZ = 0, margin = 1.25): void {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const halfW = Math.max((maxX - minX) / 2, 0.5) * margin;
    const halfH = Math.max((maxY - minY) / 2, 0.5) * margin;
    const halfZ = Math.max((maxZ - minZ) / 2, 0.5) * margin;
    this.baseExtent = Math.max(halfW, halfH, halfZ);
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.distance = this.baseExtent * 2.8;
    this.zoom = 1;
    this.theta = -Math.PI / 6;
    this.phi = Math.PI / 5;
  }

  // Legacy getters for 2D compatibility (used by DOM overlays)
  get halfExtentX(): number {
    return this.baseExtent / this.zoom;
  }
  get halfExtentY(): number {
    return this.halfExtentX * (this.height / Math.max(this.width, 1));
  }

  /** Compute the eye position from spherical coords */
  get eye(): [number, number, number] {
    const d = this.distance / this.zoom;
    const cosPhi = Math.cos(this.phi);
    return [
      this.cx + d * cosPhi * Math.sin(this.theta),
      this.cy + d * Math.sin(this.phi),
      this.cz + d * cosPhi * Math.cos(this.theta),
    ];
  }

  /** Rebuild view/proj matrices. Call once per frame before reading them. */
  updateMatrices(): void {
    const aspect = this.width / Math.max(this.height, 1);
    const fov = Math.PI / 4; // 45° FOV
    const d = this.distance / this.zoom;
    const near = d * 0.01;
    const far = d * 10;
    this.projMatrix = perspective(fov, aspect, near, far);
    this.viewMatrix = lookAt(this.eye, [this.cx, this.cy, this.cz], [0, 1, 0]);
    this.vpMatrix = mat4Multiply(this.projMatrix, this.viewMatrix);
  }

  /** Project a 3D data point → 2D screen pixel. For DOM overlays. */
  dataToScreen(x: number, y: number, z = 0): ScreenPoint {
    const vp = this.vpMatrix;
    // Multiply by VP matrix
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    // Perspective divide → NDC
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    // NDC → screen
    return {
      x: (ndcX * 0.5 + 0.5) * this.width,
      y: (1 - (ndcY * 0.5 + 0.5)) * this.height,
    };
  }

  /** Unproject a screen pixel to a data-space point on the XY plane (z=0). Approximate. */
  screenToData(px: number, py: number): DataPoint {
    // For hit testing, we project a ray from the eye through the pixel
    // and intersect with the z=cz plane. Simplified version:
    const ndcX = (px / this.width) * 2 - 1;
    const ndcY = 1 - (py / this.height) * 2;
    // Use the inverse VP matrix approach (approximation via the old 2D method
    // but adjusted for current view center)
    const fov = Math.PI / 4;
    const aspect = this.width / Math.max(this.height, 1);
    const d = this.distance / this.zoom;
    const halfH = d * Math.tan(fov / 2);
    const halfW = halfH * aspect;
    // Project onto the target plane
    return {
      x: this.cx + ndcX * halfW * Math.cos(this.theta) + ndcY * halfH * Math.sin(this.phi) * Math.sin(this.theta),
      y: this.cy + ndcY * halfH * Math.cos(this.phi),
    };
  }

  /** Orbit the camera by pixel drag amounts */
  orbit(dxPx: number, dyPx: number): void {
    this.cancelFlight();
    this.theta -= dxPx * 0.005;
    this.phi = clamp(this.phi + dyPx * 0.005, -Math.PI / 2.2, Math.PI / 2.2);
  }

  /** Pan the camera target by pixel amounts */
  panByPixels(dxPx: number, dyPx: number): void {
    this.cancelFlight();
    const d = this.distance / this.zoom;
    const scale = d * 0.002;
    // Pan in the camera's local right/up directions
    const cosT = Math.cos(this.theta);
    const sinT = Math.sin(this.theta);
    this.cx -= (dxPx * cosT) * scale;
    this.cz += (dxPx * sinT) * scale;
    this.cy += dyPx * scale;
  }

  zoomAt(_px: number, _py: number, factor: number): void {
    this.cancelFlight();
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  }

  /** Smoothly fly the camera to a new center/zoom. */
  flyTo(cx: number, cy: number, zoom: number, durationMs = 650): void {
    this.flight = {
      fromCx: this.cx, fromCy: this.cy, fromCz: this.cz, fromZoom: this.zoom,
      fromTheta: this.theta, fromPhi: this.phi,
      toCx: cx, toCy: cy, toCz: this.cz, toZoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
      toTheta: this.theta, toPhi: this.phi,
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
    this.cz = f.fromCz + (f.toCz - f.fromCz) * e;
    this.zoom = f.fromZoom + (f.toZoom - f.fromZoom) * e;
    this.theta = f.fromTheta + (f.toTheta - f.fromTheta) * e;
    this.phi = f.fromPhi + (f.toPhi - f.fromPhi) * e;
    if (t >= 1) this.flight = null;
  }
}
