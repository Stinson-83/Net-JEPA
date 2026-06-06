import { useEffect, useRef } from 'react';
import createREGL from 'regl';
import { useStore, EMPTY_POINTS, EMPTY_CLASSES } from '../../state/store';
import { classColor, hexToRgb01 } from '../../data/classColors';
import type { UmapPoint } from '../../data/types';
import { Camera } from './camera';

const MAX_CLASSES = 16;
const MAX_SPRITES = 96;
const SESSION_RING_RGB = hexToRgb01('#7dd3fc');
const HOVER_RGB: [number, number, number] = [1, 1, 1];

// ── Shaders ────────────────────────────────────────────────────────────────
// Both programs transform data-space coordinates straight to clip space via
// `(position - center) / halfExtent` — a cheap two-uniform affine transform
// that keeps the camera math identical (and therefore exactly in sync)
// between the GPU and the CPU-side `Camera` class used by DOM overlays.

const POINT_VERT = `
precision highp float;
attribute vec2 aPosition;
attribute vec3 aColor;
attribute float aClassIndex;
attribute float aConfidence;
uniform vec2 uCenter;
uniform vec2 uHalfExtent;
uniform float uTime;
uniform float uPixelRatio;
uniform float uBaseSize;
uniform float uClassFade[${MAX_CLASSES}];
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 ndc = (aPosition - uCenter) / uHalfExtent;
  gl_Position = vec4(ndc, 0.0, 1.0);

  float fade = 1.0;
  for (int i = 0; i < ${MAX_CLASSES}; i++) {
    if (abs(aClassIndex - float(i)) < 0.5) fade = uClassFade[i];
  }

  // Per-point pulse phase derived from position (no extra attribute needed) —
  // keeps the cloud "breathing" without every point pulsing in lockstep.
  float phase = fract(sin(aPosition.x * 12.9898 + aPosition.y * 78.233) * 43758.5453);
  float pulse = 0.88 + 0.12 * sin(uTime * 1.35 + phase * 6.28318);

  float size = uBaseSize * (0.55 + aConfidence * 0.75) * pulse;
  gl_PointSize = max(size * uPixelRatio, 1.0);

  vColor = aColor;
  vAlpha = fade * (0.32 + aConfidence * 0.62);
}`;

const POINT_FRAG = `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = length(uv);
  if (d > 1.0) discard;
  float core = smoothstep(1.0, 0.1, d);
  float halo = pow(max(1.0 - d, 0.0), 2.4);
  gl_FragColor = vec4(vColor + halo * 0.4, core * vAlpha);
}`;

// Generic "sprite" pass — reused for the selection ring, hover ring, and the
// persistent rings around session-injected points. `aRing` switches between a
// filled glow (0) and a donut outline (1) per-instance, in one draw call.
const SPRITE_VERT = `
precision highp float;
attribute vec2 aPosition;
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aRing;
uniform vec2 uCenter;
uniform vec2 uHalfExtent;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;
varying float vRing;
void main() {
  vec2 ndc = (aPosition - uCenter) / uHalfExtent;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  vColor = aColor;
  vAlpha = aAlpha;
  vRing = aRing;
}`;

const SPRITE_FRAG = `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
varying float vRing;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = length(uv);
  if (d > 1.0) discard;
  float a;
  if (vRing > 0.5) {
    a = smoothstep(0.34, 0.0, abs(d - 0.74));
  } else {
    a = pow(max(1.0 - d, 0.0), 1.7);
  }
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

function baseSizeForZoom(zoom: number): number {
  return Math.min(9, Math.max(3.4, 3.4 + Math.log2(Math.max(zoom, 1)) * 1.05));
}

export interface HoverInfo {
  point: UmapPoint;
  screen: { x: number; y: number };
}

interface Props {
  cameraRef: React.RefObject<Camera | null>;
  onHover: (info: HoverInfo | null) => void;
}

/**
 * The WebGL theatre itself. One regl context, two draw passes:
 *   1. `drawPoints`  — the full cloud (static buffers; rebuilt only when the
 *      dataset changes), additive-blended glow circles, class-fade + pulse
 *      computed entirely on the GPU from uniforms so 50k points cost nothing
 *      extra to animate.
 *   2. `drawSprites` — a tiny (≤96-instance) dynamic buffer rebuilt every
 *      frame for the selection ring, hover ring, and session-injection rings.
 *
 * Camera state lives in the shared `Camera` instance (see camera.ts) so DOM
 * overlays — kNN lines, the comet, the minimap, the tooltip — read the exact
 * same transform the GPU used for that frame.
 */
export default function UMAPCanvas({ cameraRef, onHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);

  // Mutable mirrors of store state the render loop needs every frame, kept as
  // refs so changing them doesn't tear down / rebuild the regl context.
  const hiddenRef = useRef<Set<string>>(new Set());
  const fadeRef = useRef<Float32Array>(new Float32Array(MAX_CLASSES).fill(1));
  const selectedIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const sessionPosRef = useRef<{ x: number; y: number; label: string }[]>([]);
  const pendingHoverRef = useRef<{ mx: number; my: number } | null>(null);

  const hidden = useStore((s) => s.hiddenClasses);
  const selectedFlowId = useStore((s) => s.selectedFlowId);
  const sessions = useStore((s) => s.sessions);

  useEffect(() => { hiddenRef.current = hidden; }, [hidden]);
  useEffect(() => { selectedIdRef.current = selectedFlowId; }, [selectedFlowId]);
  useEffect(() => {
    sessionPosRef.current = sessions
      .filter((s) => s.projection)
      .map((s) => ({ x: s.projection!.x, y: s.projection!.y, label: s.projection!.label }));
  }, [sessions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    if (points.length === 0) return;

    let camera = cameraRef.current;
    if (camera === null) {
      camera = new Camera();
      cameraRef.current = camera;
    }

    // ── bounds + initial framing ───────────────────────────────────────────
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    camera.setViewport(container.clientWidth, container.clientHeight);
    camera.fitToBounds(minX, maxX, minY, maxY);

    const pointById = new Map<string, UmapPoint>();
    for (const p of points) pointById.set(p.id, p);

    // ── regl setup ─────────────────────────────────────────────────────────
    const regl = createREGL({
      canvas,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      attributes: { alpha: true, antialias: true, premultipliedAlpha: false, depth: false },
    });

    const n = points.length;
    const positions = new Float32Array(n * 2);
    const colorsArr = new Float32Array(n * 3);
    const classIdxArr = new Float32Array(n);
    const confArr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      positions[i * 2] = p.x;
      positions[i * 2 + 1] = p.y;
      const idx = classes.indexOf(p.label);
      classIdxArr[i] = idx === -1 ? 0 : Math.min(idx, MAX_CLASSES - 1);
      const [r, g, b] = hexToRgb01(classColor(classes, p.label).hex);
      colorsArr[i * 3] = r;
      colorsArr[i * 3 + 1] = g;
      colorsArr[i * 3 + 2] = b;
      confArr[i] = p.confidence;
    }

    // regl has no shorthand for array uniforms — per its docs, each element
    // of `uniform float uClassFade[N]` must be bound under its own bracketed
    // key (`"uClassFade[0]"`, `"uClassFade[1]"`, …), not as a single array.
    const classFadeUniforms: Record<string, () => number> = {};
    for (let i = 0; i < MAX_CLASSES; i++) {
      classFadeUniforms[`uClassFade[${i}]`] = () => fadeRef.current[i];
    }

    const positionBuffer = regl.buffer(positions);
    const colorBuffer = regl.buffer(colorsArr);
    const classBuffer = regl.buffer(classIdxArr);
    const confBuffer = regl.buffer(confArr);

    const ADDITIVE_BLEND = {
      enable: true,
      func: { srcRGB: 'src alpha', srcAlpha: 1, dstRGB: 'one', dstAlpha: 'one minus src alpha' },
    } as const;

    const drawPoints = regl({
      vert: POINT_VERT,
      frag: POINT_FRAG,
      attributes: {
        aPosition: positionBuffer,
        aColor: colorBuffer,
        aClassIndex: classBuffer,
        aConfidence: confBuffer,
      },
      uniforms: {
        uCenter: () => [camera!.cx, camera!.cy],
        uHalfExtent: () => [camera!.halfExtentX, camera!.halfExtentY],
        uTime: ({ time }) => time,
        uPixelRatio: regl.context('pixelRatio'),
        uBaseSize: () => baseSizeForZoom(camera!.zoom),
        ...classFadeUniforms,
      },
      count: n,
      primitive: 'points',
      blend: ADDITIVE_BLEND,
      depth: { enable: false },
    });

    // dynamic sprite buffers (rebuilt every frame; tiny — ≤ MAX_SPRITES instances)
    const spritePosArr = new Float32Array(MAX_SPRITES * 2);
    const spriteColorArr = new Float32Array(MAX_SPRITES * 3);
    const spriteSizeArr = new Float32Array(MAX_SPRITES);
    const spriteAlphaArr = new Float32Array(MAX_SPRITES);
    const spriteRingArr = new Float32Array(MAX_SPRITES);
    const spritePosBuf = regl.buffer({ length: MAX_SPRITES * 2 * 4, usage: 'dynamic' });
    const spriteColorBuf = regl.buffer({ length: MAX_SPRITES * 3 * 4, usage: 'dynamic' });
    const spriteSizeBuf = regl.buffer({ length: MAX_SPRITES * 4, usage: 'dynamic' });
    const spriteAlphaBuf = regl.buffer({ length: MAX_SPRITES * 4, usage: 'dynamic' });
    const spriteRingBuf = regl.buffer({ length: MAX_SPRITES * 4, usage: 'dynamic' });
    let spriteCount = 0;

    const drawSprites = regl({
      vert: SPRITE_VERT,
      frag: SPRITE_FRAG,
      attributes: {
        aPosition: spritePosBuf,
        aColor: spriteColorBuf,
        aSize: spriteSizeBuf,
        aAlpha: spriteAlphaBuf,
        aRing: spriteRingBuf,
      },
      uniforms: {
        uCenter: () => [camera!.cx, camera!.cy],
        uHalfExtent: () => [camera!.halfExtentX, camera!.halfExtentY],
        uPixelRatio: regl.context('pixelRatio'),
      },
      count: () => spriteCount,
      primitive: 'points',
      blend: ADDITIVE_BLEND,
      depth: { enable: false },
    });

    // ── interaction ────────────────────────────────────────────────────────
    const hitRadiusData = () => 9 * ((2 * camera!.halfExtentX) / Math.max(container!.clientWidth, 1));

    const findNearest = (x: number, y: number): UmapPoint | null => {
      const maxD = hitRadiusData();
      const maxD2 = maxD * maxD;
      let best: UmapPoint | null = null;
      let bestD2 = maxD2;
      for (const p of points) {
        if (hiddenRef.current.has(p.label)) continue;
        const dx = p.x - x;
        const dy = p.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = p; }
      }
      return best;
    };

    let isDragging = false;
    let dragMoved = false;
    let lastClientX = 0;
    let lastClientY = 0;

    const localPos = (e: MouseEvent) => {
      const rect = canvas!.getBoundingClientRect();
      return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
    };

    const clearHover = () => {
      if (hoveredIdRef.current !== null) {
        hoveredIdRef.current = null;
        useStore.getState().setHoveredFlow(null);
        onHover(null);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { mx, my } = localPos(e);
      const factor = Math.exp(-e.deltaY * 0.0014);
      camera!.zoomAt(mx, my, factor);
      pendingHoverRef.current = { mx, my };
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDragging = true;
      dragMoved = false;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      canvas!.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - lastClientX;
        const dy = e.clientY - lastClientY;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
        camera!.panByPixels(dx, dy);
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        clearHover();
        pendingHoverRef.current = null;
      } else {
        pendingHoverRef.current = localPos(e);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (isDragging && !dragMoved) {
        const { mx, my } = localPos(e);
        const { x, y } = camera!.screenToData(mx, my);
        const hit = findNearest(x, y);
        useStore.getState().selectFlow(hit ? hit.id : null);
      }
      isDragging = false;
      canvas!.style.cursor = 'grab';
    };

    const onMouseLeave = () => {
      isDragging = false;
      pendingHoverRef.current = null;
      clearHover();
      canvas!.style.cursor = 'grab';
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);

    // ── render loop ────────────────────────────────────────────────────────
    const frameLoop = regl.frame(({ time }) => {
      camera!.setViewport(container!.clientWidth, container!.clientHeight);
      camera!.tick(performance.now());

      // class-visibility fade — smoothly lerp toward 0/1 each frame so
      // toggling a legend entry "breathes" the cloud rather than popping it
      for (let i = 0; i < MAX_CLASSES; i++) {
        const label = classes[i];
        const target = label && hiddenRef.current.has(label) ? 0 : 1;
        fadeRef.current[i] += (target - fadeRef.current[i]) * 0.12;
      }

      // resolve any pending hover hit-test (throttled to once per frame)
      if (pendingHoverRef.current && !isDragging) {
        const { mx, my } = pendingHoverRef.current;
        pendingHoverRef.current = null;
        const { x, y } = camera!.screenToData(mx, my);
        const hit = findNearest(x, y);
        const id = hit?.id ?? null;
        if (id !== hoveredIdRef.current) {
          hoveredIdRef.current = id;
          useStore.getState().setHoveredFlow(id);
        }
        onHover(hit ? { point: hit, screen: camera!.dataToScreen(hit.x, hit.y) } : null);
      } else if (hoveredIdRef.current) {
        const p = pointById.get(hoveredIdRef.current);
        if (p) onHover({ point: p, screen: camera!.dataToScreen(p.x, p.y) });
      }

      regl.clear({ color: [0, 0, 0, 0], depth: 1 });
      drawPoints();

      // ── build this frame's sprite list (selection / hover / session rings) ──
      spriteCount = 0;
      const pushSprite = (x: number, y: number, color: [number, number, number], size: number, alpha: number, ring: number) => {
        if (spriteCount >= MAX_SPRITES) return;
        const i = spriteCount++;
        spritePosArr[i * 2] = x;
        spritePosArr[i * 2 + 1] = y;
        spriteColorArr[i * 3] = color[0];
        spriteColorArr[i * 3 + 1] = color[1];
        spriteColorArr[i * 3 + 2] = color[2];
        spriteSizeArr[i] = size;
        spriteAlphaArr[i] = alpha;
        spriteRingArr[i] = ring;
      };

      for (const s of sessionPosRef.current) {
        const pulse = 0.55 + 0.35 * Math.sin(time * 1.05 + s.x * 1.7);
        pushSprite(s.x, s.y, SESSION_RING_RGB, 24 * pulse + 8, 0.5 + 0.25 * pulse, 1);
      }

      const selId = selectedIdRef.current;
      if (selId) {
        const p = pointById.get(selId);
        if (p) {
          const pulse = 0.7 + 0.3 * Math.sin(time * 2.6);
          const [r, g, b] = hexToRgb01(classColor(classes, p.label).hex);
          pushSprite(p.x, p.y, [r, g, b], 30 * pulse + 6, 0.95, 1);
        }
      }
      const hovId = hoveredIdRef.current;
      if (hovId && hovId !== selId) {
        const p = pointById.get(hovId);
        if (p) pushSprite(p.x, p.y, HOVER_RGB, 22, 0.85, 1);
      }

      if (spriteCount > 0) {
        spritePosBuf.subdata(spritePosArr.subarray(0, spriteCount * 2));
        spriteColorBuf.subdata(spriteColorArr.subarray(0, spriteCount * 3));
        spriteSizeBuf.subdata(spriteSizeArr.subarray(0, spriteCount));
        spriteAlphaBuf.subdata(spriteAlphaArr.subarray(0, spriteCount));
        spriteRingBuf.subdata(spriteRingArr.subarray(0, spriteCount));
        drawSprites();
      }
    });

    return () => {
      frameLoop.cancel();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      regl.destroy();
    };
  }, [points, classes, cameraRef, onHover]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
