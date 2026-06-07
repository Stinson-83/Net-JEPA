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

// ── 3D Shaders ─────────────────────────────────────────────────────────────
// Both programs transform 3D data-space coordinates to clip space via
// the view-projection matrix uniform.

const POINT_VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec3 aColor;
attribute float aClassIndex;
attribute float aConfidence;
uniform mat4 uVP;
uniform float uTime;
uniform float uPixelRatio;
uniform float uBaseSize;
uniform float uClassFade[${MAX_CLASSES}];
uniform float uClassAlpha[${MAX_CLASSES}];
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_Position = uVP * vec4(aPosition, 1.0);

  float fade = 1.0;
  float densityAlpha = 1.0;
  for (int i = 0; i < ${MAX_CLASSES}; i++) {
    if (abs(aClassIndex - float(i)) < 0.5) {
      fade = uClassFade[i];
      densityAlpha = uClassAlpha[i];
    }
  }

  // Subtle per-point shimmer (much gentler than before)
  float phase = fract(sin(aPosition.x * 12.9898 + aPosition.y * 78.233 + aPosition.z * 37.719) * 43758.5453);
  float pulse = 0.94 + 0.06 * sin(uTime * 1.35 + phase * 6.28318);

  // Attenuate size by depth
  float depth = gl_Position.w;
  float depthScale = clamp(18.0 / max(depth, 1.0), 0.4, 2.0);

  // ~2px base, modest confidence scaling
  float size = uBaseSize * (0.7 + aConfidence * 0.3) * pulse * depthScale;
  gl_PointSize = max(size * uPixelRatio, 1.0);

  vColor = aColor;
  // Capped alpha: base ~0.5, confidence adds up to ~0.15, density scales it
  vAlpha = fade * densityAlpha * (0.45 + aConfidence * 0.15);
}`;

const POINT_FRAG = `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = length(uv);
  if (d > 1.0) discard;
  // Hard-ish core with very subtle edge softness — NOT a flare
  float core = smoothstep(1.0, 0.35, d);
  // Tiny halo — just enough to anti-alias, not enough to bloom
  float halo = 0.08 * pow(max(1.0 - d, 0.0), 3.0);
  gl_FragColor = vec4(vColor * (1.0 + halo), core * vAlpha);
}`;

// Sprite pass for selection ring, hover ring, session rings
const SPRITE_VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aRing;
uniform mat4 uVP;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vAlpha;
varying float vRing;
void main() {
  gl_Position = uVP * vec4(aPosition, 1.0);
  float depth = gl_Position.w;
  float depthScale = clamp(18.0 / max(depth, 1.0), 0.4, 2.5);
  gl_PointSize = aSize * uPixelRatio * depthScale;
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

// Thin grid lines on the XY plane for 3D depth reference (dimmed to 50%)
const GRID_VERT = `
precision highp float;
attribute vec3 aPosition;
uniform mat4 uVP;
varying float vAlpha;
void main() {
  gl_Position = uVP * vec4(aPosition, 1.0);
  float dist = length(aPosition.xy);
  vAlpha = 0.06 * smoothstep(20.0, 5.0, dist);
}`;

const GRID_FRAG = `
precision highp float;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(0.3, 0.4, 0.5, vAlpha);
}`;

function baseSizeForZoom(zoom: number): number {
  // ~2px default at zoom=1, scales gently with zoom
  return Math.min(5.5, Math.max(2.0, 2.0 + Math.log2(Math.max(zoom, 1)) * 0.7));
}

export interface HoverInfo {
  point: UmapPoint;
  screen: { x: number; y: number };
}

interface Props {
  cameraRef: React.RefObject<Camera | null>;
  onHover: (info: HoverInfo | null) => void;
  pointSize?: number;
}

/** Build a flat grid of lines on the XZ plane through y=0 */
function buildGridGeometry(extent: number, step: number): Float32Array {
  const lines: number[] = [];
  const n = Math.ceil(extent / step);
  for (let i = -n; i <= n; i++) {
    const v = i * step;
    // Lines along X
    lines.push(-extent, 0, v, extent, 0, v);
    // Lines along Z
    lines.push(v, 0, -extent, v, 0, extent);
  }
  return new Float32Array(lines);
}

/**
 * The WebGL theatre itself — now in 3D! One regl context, three draw passes:
 *   1. `drawGrid`   — subtle reference grid on the ground plane
 *   2. `drawPoints` — the full cloud with 3D perspective
 *   3. `drawSprites` — selection/hover/session rings
 *
 * Camera state lives in the shared `Camera` instance (see camera.ts) so DOM
 * overlays — kNN lines, the comet, the minimap, the tooltip — read the exact
 * same transform the GPU used for that frame.
 */
export default function UMAPCanvas({ cameraRef, onHover, pointSize }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);

  const hiddenRef = useRef<Set<string>>(new Set());
  const fadeRef = useRef<Float32Array>(new Float32Array(MAX_CLASSES).fill(1));
  const selectedIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const sessionPosRef = useRef<{ x: number; y: number; z: number; label: string }[]>([]);
  const pendingHoverRef = useRef<{ mx: number; my: number } | null>(null);

  const hidden = useStore((s) => s.hiddenClasses);
  const selectedFlowId = useStore((s) => s.selectedFlowId);
  const sessions = useStore((s) => s.sessions);

  useEffect(() => { hiddenRef.current = hidden; }, [hidden]);
  useEffect(() => { selectedIdRef.current = selectedFlowId; }, [selectedFlowId]);
  useEffect(() => {
    sessionPosRef.current = sessions
      .filter((s) => s.projection)
      .map((s) => ({ x: s.projection!.x, y: s.projection!.y, z: 0, label: s.projection!.label }));
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
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      const z = p.z ?? 0;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    camera.setViewport(container.clientWidth, container.clientHeight);
    camera.fitToBounds(minX, maxX, minY, maxY, minZ, maxZ);

    const pointById = new Map<string, UmapPoint>();
    for (const p of points) pointById.set(p.id, p);

    // ── regl setup ─────────────────────────────────────────────────────────
    const regl = createREGL({
      canvas,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      attributes: { alpha: true, antialias: true, premultipliedAlpha: false, depth: true },
    });

    const n = points.length;
    const positions = new Float32Array(n * 3);
    const colorsArr = new Float32Array(n * 3);
    const classIdxArr = new Float32Array(n);
    const confArr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z ?? 0;
      const idx = classes.indexOf(p.label);
      classIdxArr[i] = idx === -1 ? 0 : Math.min(idx, MAX_CLASSES - 1);
      const [r, g, b] = hexToRgb01(classColor(classes, p.label).hex);
      colorsArr[i * 3] = r;
      colorsArr[i * 3 + 1] = g;
      colorsArr[i * 3 + 2] = b;
      confArr[i] = p.confidence;
    }

    // Compute per-class density alpha: rare classes brighter, dense classes dimmer
    const classCounts = new Map<string, number>();
    for (const p of points) classCounts.set(p.label, (classCounts.get(p.label) ?? 0) + 1);
    const countValues = [...classCounts.values()];
    countValues.sort((a, b) => a - b);
    const medianCount = countValues[Math.floor(countValues.length / 2)] || 1;
    const classAlphaArr = new Float32Array(MAX_CLASSES);
    for (let i = 0; i < MAX_CLASSES; i++) {
      const label = classes[i];
      if (!label) { classAlphaArr[i] = 1; continue; }
      const cnt = classCounts.get(label) ?? 1;
      classAlphaArr[i] = Math.max(0.25, Math.min(1.0, Math.sqrt(medianCount / cnt)));
    }

    const classFadeUniforms: Record<string, () => number> = {};
    for (let i = 0; i < MAX_CLASSES; i++) {
      classFadeUniforms[`uClassFade[${i}]`] = () => fadeRef.current[i];
      classFadeUniforms[`uClassAlpha[${i}]`] = () => classAlphaArr[i];
    }

    const positionBuffer = regl.buffer(positions);
    const colorBuffer = regl.buffer(colorsArr);
    const classBuffer = regl.buffer(classIdxArr);
    const confBuffer = regl.buffer(confArr);

    // Grid geometry
    const gridExtent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.6;
    const gridStep = Math.max(2, Math.round(gridExtent / 6));
    const gridPositions = buildGridGeometry(gridExtent, gridStep);
    const gridBuffer = regl.buffer(gridPositions);

    // Standard alpha blending — NOT additive. Additive smears clusters into white.
    const STANDARD_BLEND = {
      enable: true,
      func: { src: 'src alpha', dst: 'one minus src alpha' },
    } as const;

    const drawGrid = regl({
      vert: GRID_VERT,
      frag: GRID_FRAG,
      attributes: { aPosition: { buffer: gridBuffer, size: 3 } },
      uniforms: {
        uVP: () => camera!.vpMatrix,
      },
      count: gridPositions.length / 3,
      primitive: 'lines',
      blend: { enable: true, func: { src: 'src alpha', dst: 'one minus src alpha' } },
      depth: { enable: true, mask: false },
    });

    const drawPoints = regl({
      vert: POINT_VERT,
      frag: POINT_FRAG,
      attributes: {
        aPosition: { buffer: positionBuffer, size: 3 },
        aColor: colorBuffer,
        aClassIndex: classBuffer,
        aConfidence: confBuffer,
      },
      uniforms: {
        uVP: () => camera!.vpMatrix,
        uTime: ({ time }) => time,
        uPixelRatio: regl.context('pixelRatio'),
        uBaseSize: () => pointSize ?? baseSizeForZoom(camera!.zoom),
        ...classFadeUniforms,
      },
      count: n,
      primitive: 'points',
      blend: STANDARD_BLEND,
      depth: { enable: true, mask: false },
    });

    // dynamic sprite buffers
    const spritePosArr = new Float32Array(MAX_SPRITES * 3);
    const spriteColorArr = new Float32Array(MAX_SPRITES * 3);
    const spriteSizeArr = new Float32Array(MAX_SPRITES);
    const spriteAlphaArr = new Float32Array(MAX_SPRITES);
    const spriteRingArr = new Float32Array(MAX_SPRITES);
    const spritePosBuf = regl.buffer({ length: MAX_SPRITES * 3 * 4, usage: 'dynamic' });
    const spriteColorBuf = regl.buffer({ length: MAX_SPRITES * 3 * 4, usage: 'dynamic' });
    const spriteSizeBuf = regl.buffer({ length: MAX_SPRITES * 4, usage: 'dynamic' });
    const spriteAlphaBuf = regl.buffer({ length: MAX_SPRITES * 4, usage: 'dynamic' });
    const spriteRingBuf = regl.buffer({ length: MAX_SPRITES * 4, usage: 'dynamic' });
    let spriteCount = 0;

    const drawSprites = regl({
      vert: SPRITE_VERT,
      frag: SPRITE_FRAG,
      attributes: {
        aPosition: { buffer: spritePosBuf, size: 3 },
        aColor: spriteColorBuf,
        aSize: spriteSizeBuf,
        aAlpha: spriteAlphaBuf,
        aRing: spriteRingBuf,
      },
      uniforms: {
        uVP: () => camera!.vpMatrix,
        uPixelRatio: regl.context('pixelRatio'),
      },
      count: () => spriteCount,
      primitive: 'points',
      blend: STANDARD_BLEND,
      depth: { enable: true, mask: false },
    });

    // ── interaction ────────────────────────────────────────────────────────
    const findNearest = (mx: number, my: number): UmapPoint | null => {
      // Project all points to screen and find closest to mouse
      let best: UmapPoint | null = null;
      let bestD2 = 20 * 20; // 20px hit radius
      for (const p of points) {
        if (hiddenRef.current.has(p.label)) continue;
        const s = camera!.dataToScreen(p.x, p.y, p.z ?? 0);
        const dx = s.x - mx;
        const dy = s.y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = p; }
      }
      return best;
    };

    let isDragging = false;
    let isOrbiting = false;
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
      const factor = Math.exp(-e.deltaY * 0.0014);
      camera!.zoomAt(0, 0, factor);
      const { mx, my } = localPos(e);
      pendingHoverRef.current = { mx, my };
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
        // Right-click or shift+click: pan
        isDragging = true;
        isOrbiting = false;
      } else if (e.button === 0) {
        // Left-click: orbit
        isDragging = true;
        isOrbiting = true;
      }
      dragMoved = false;
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      canvas!.style.cursor = isOrbiting ? 'grabbing' : 'move';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - lastClientX;
        const dy = e.clientY - lastClientY;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
        if (isOrbiting) {
          camera!.orbit(dx, dy);
        } else {
          camera!.panByPixels(dx, dy);
        }
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
        const hit = findNearest(mx, my);
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

    const onContextMenu = (e: Event) => {
      e.preventDefault();
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('contextmenu', onContextMenu);

    // ── render loop ────────────────────────────────────────────────────────
    const frameLoop = regl.frame(({ time }) => {
      camera!.setViewport(container!.clientWidth, container!.clientHeight);
      camera!.tick(performance.now());
      camera!.updateMatrices();

      // class-visibility fade
      for (let i = 0; i < MAX_CLASSES; i++) {
        const label = classes[i];
        const target = label && hiddenRef.current.has(label) ? 0 : 1;
        fadeRef.current[i] += (target - fadeRef.current[i]) * 0.12;
      }

      // resolve pending hover
      if (pendingHoverRef.current && !isDragging) {
        const { mx, my } = pendingHoverRef.current;
        pendingHoverRef.current = null;
        const hit = findNearest(mx, my);
        const id = hit?.id ?? null;
        if (id !== hoveredIdRef.current) {
          hoveredIdRef.current = id;
          useStore.getState().setHoveredFlow(id);
        }
        onHover(hit ? { point: hit, screen: camera!.dataToScreen(hit.x, hit.y, hit.z ?? 0) } : null);
      } else if (hoveredIdRef.current) {
        const p = pointById.get(hoveredIdRef.current);
        if (p) onHover({ point: p, screen: camera!.dataToScreen(p.x, p.y, p.z ?? 0) });
      }

      regl.clear({ color: [0, 0, 0, 0], depth: 1 });
      drawGrid();
      drawPoints();

      // ── build sprite list ──
      spriteCount = 0;
      const pushSprite = (x: number, y: number, z: number, color: [number, number, number], size: number, alpha: number, ring: number) => {
        if (spriteCount >= MAX_SPRITES) return;
        const i = spriteCount++;
        spritePosArr[i * 3] = x;
        spritePosArr[i * 3 + 1] = y;
        spritePosArr[i * 3 + 2] = z;
        spriteColorArr[i * 3] = color[0];
        spriteColorArr[i * 3 + 1] = color[1];
        spriteColorArr[i * 3 + 2] = color[2];
        spriteSizeArr[i] = size;
        spriteAlphaArr[i] = alpha;
        spriteRingArr[i] = ring;
      };

      for (const s of sessionPosRef.current) {
        const pulse = 0.55 + 0.35 * Math.sin(time * 1.05 + s.x * 1.7);
        pushSprite(s.x, s.y, s.z, SESSION_RING_RGB, 24 * pulse + 8, 0.5 + 0.25 * pulse, 1);
      }

      const selId = selectedIdRef.current;
      if (selId) {
        const p = pointById.get(selId);
        if (p) {
          const pulse = 0.7 + 0.3 * Math.sin(time * 2.6);
          const [r, g, b] = hexToRgb01(classColor(classes, p.label).hex);
          pushSprite(p.x, p.y, p.z ?? 0, [r, g, b], 30 * pulse + 6, 0.95, 1);
        }
      }
      const hovId = hoveredIdRef.current;
      if (hovId && hovId !== selId) {
        const p = pointById.get(hovId);
        if (p) pushSprite(p.x, p.y, p.z ?? 0, HOVER_RGB, 22, 0.85, 1);
      }

      if (spriteCount > 0) {
        spritePosBuf.subdata(spritePosArr.subarray(0, spriteCount * 3));
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
      canvas.removeEventListener('contextmenu', onContextMenu);
      regl.destroy();
    };
  }, [points, classes, cameraRef, onHover]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
