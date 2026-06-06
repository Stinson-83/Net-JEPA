import { motion } from 'motion/react';

// ───────────────────────────────────────────────────────────────────────────
// Tiny (112×32) "mini-viz" panels — one per pipeline stage. Each is a cheap,
// purely-decorative loop that communicates *what kind of computation* is
// happening without trying to be a literal diagram. They animate only while
// `active` is true (the pipeline-theatre orchestrator only marks the current
// stage — and the parallel-encoder trio — active), so idle stages cost
// nothing beyond a few static DOM nodes.
// ───────────────────────────────────────────────────────────────────────────

export interface VizProps {
  active: boolean;
  color: string;
}

const VW = 112;
const VH = 32;
const WRAP = 'relative h-8 w-28 shrink-0 overflow-hidden rounded border border-[var(--nj-border)]/50 bg-black/25';

export function IngestViz({ active, color }: VizProps) {
  return (
    <div className={WRAP}>
      <motion.div
        className="absolute inset-y-0 w-7 blur-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, ${color}66, transparent)` }}
        animate={active ? { x: [-28, VW] } : { x: -28 }}
        transition={{ duration: 1.3, repeat: active ? Infinity : 0, ease: 'linear' }}
      />
      {Array.from({ length: 7 }).map((_, i) => (
        <span
          key={i}
          className="absolute top-1/2 h-1 w-1 -translate-y-1/2 rounded-full transition-opacity duration-500"
          style={{ left: `${8 + i * 13}%`, background: color, opacity: active ? 0.55 : 0.15 }}
        />
      ))}
    </div>
  );
}

export function FlowConstructionViz({ active, color }: VizProps) {
  return (
    <div className={`${WRAP} grid grid-cols-8 grid-rows-3 gap-[2px] p-1`}>
      {Array.from({ length: 24 }).map((_, i) => {
        const col = i % 8;
        const row = Math.floor(i / 8);
        return (
          <motion.span
            key={i}
            className="rounded-[1px]"
            style={{ background: color }}
            animate={active ? { opacity: [0.08, 0.7, 0.08] } : { opacity: 0.08 }}
            transition={{ duration: 1.1, repeat: active ? Infinity : 0, delay: col * 0.06 + row * 0.16, ease: 'easeInOut' }}
          />
        );
      })}
    </div>
  );
}

export function FeatureReprViz({ active, color }: VizProps) {
  const heights = [0.4, 0.7, 0.32, 0.92, 0.5, 0.66, 0.36, 0.8];
  return (
    <div className={`${WRAP} flex items-end gap-[3px] px-2 pb-1.5`}>
      {heights.map((h, i) => (
        <motion.span
          key={i}
          className="w-2 rounded-t-[1px]"
          style={{ background: color }}
          animate={active ? { height: [`${h * 28}%`, `${h * 100}%`, `${h * 55}%`] } : { height: `${h * 22}%` }}
          transition={{ duration: 1.4, repeat: active ? Infinity : 0, delay: i * 0.09, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

export function TemporalEncoderViz({ active, color }: VizProps) {
  return (
    <div className={`${WRAP} flex items-center justify-between px-3`}>
      {Array.from({ length: 6 }).map((_, i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: color }}
          animate={active ? { scale: [1, 1.9, 1], opacity: [0.3, 1, 0.3] } : { scale: 1, opacity: 0.18 }}
          transition={{ duration: 1.2, repeat: active ? Infinity : 0, delay: i * 0.14, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

const CTX_NODES: [number, number][] = [[14, 8], [56, 6], [98, 9], [30, 24], [82, 23]];
const CTX_EDGES: [number, number][] = [[0, 1], [1, 2], [0, 3], [1, 3], [1, 4], [2, 4]];

export function ContextEncoderViz({ active, color }: VizProps) {
  return (
    <div className={WRAP}>
      <svg width={VW} height={VH} className="absolute inset-0">
        {CTX_EDGES.map(([a, b], i) => (
          <motion.line
            key={i}
            x1={CTX_NODES[a][0]} y1={CTX_NODES[a][1]} x2={CTX_NODES[b][0]} y2={CTX_NODES[b][1]}
            stroke={color}
            strokeWidth={1}
            animate={active ? { opacity: [0.08, 0.55, 0.08] } : { opacity: 0.08 }}
            transition={{ duration: 1.6, repeat: active ? Infinity : 0, delay: i * 0.18, ease: 'easeInOut' }}
          />
        ))}
        {CTX_NODES.map(([x, y], i) => (
          <motion.circle
            key={i}
            cx={x} cy={y} r={1.8}
            fill={color}
            animate={active ? { opacity: [0.4, 1, 0.4] } : { opacity: 0.22 }}
            transition={{ duration: 1.6, repeat: active ? Infinity : 0, delay: i * 0.12, ease: 'easeInOut' }}
          />
        ))}
      </svg>
    </div>
  );
}

const WAVELET_BANDS = [
  { freq: 1.6, amp: 6, y: 9 },
  { freq: 3.2, amp: 4, y: 17 },
  { freq: 5.4, amp: 2.4, y: 25 },
];

function wavePath(freq: number, amp: number, baseY: number): string {
  let d = `M 0 ${baseY}`;
  for (let x = 0; x <= VW; x += 4) {
    d += ` L ${x} ${(baseY + Math.sin((x / VW) * Math.PI * 2 * freq) * amp).toFixed(1)}`;
  }
  return d;
}

export function WaveletEncoderViz({ active, color }: VizProps) {
  return (
    <div className={WRAP}>
      <svg width={VW} height={VH} className="absolute inset-0" style={{ opacity: active ? 1 : 0.16 }}>
        {WAVELET_BANDS.map((w, i) => {
          const d = wavePath(w.freq, w.amp, w.y);
          return (
            <motion.g
              key={i}
              animate={active ? { x: [0, -VW] } : { x: 0 }}
              transition={{ duration: 3.2 - i * 0.6, repeat: active ? Infinity : 0, ease: 'linear' }}
            >
              <path d={d} fill="none" stroke={color} strokeWidth={1} opacity={0.78 - i * 0.18} />
              <path d={d} fill="none" stroke={color} strokeWidth={1} opacity={0.78 - i * 0.18} transform={`translate(${VW},0)`} />
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}

export function FusionViz({ active, color }: VizProps) {
  const lanes = [8, 16, 24];
  return (
    <div className={WRAP}>
      <svg width={VW} height={VH} className="absolute inset-0">
        {lanes.map((y, i) => (
          <motion.path
            key={i}
            d={`M 4 ${y} C ${VW * 0.45} ${y}, ${VW * 0.55} ${VH / 2}, ${VW - 6} ${VH / 2}`}
            fill="none"
            stroke={color}
            strokeWidth={1.2}
            animate={active ? { opacity: [0.12, 0.7, 0.12] } : { opacity: 0.1 }}
            transition={{ duration: 1.5, repeat: active ? Infinity : 0, delay: i * 0.22, ease: 'easeInOut' }}
          />
        ))}
        <motion.circle
          cx={VW - 6} cy={VH / 2}
          fill={color}
          initial={{ r: 1.6, opacity: 0.25 }}
          animate={active ? { r: [1.6, 3.6, 1.6], opacity: [0.5, 1, 0.5] } : { r: 1.6, opacity: 0.25 }}
          transition={{ duration: 1.1, repeat: active ? Infinity : 0, ease: 'easeInOut' }}
        />
      </svg>
    </div>
  );
}

export function EmbeddingViz({ active, color }: VizProps) {
  return (
    <div className={`${WRAP} flex items-center gap-[3px] px-2`}>
      {Array.from({ length: 16 }).map((_, i) => (
        <motion.span
          key={i}
          className="w-1 rounded-[1px]"
          style={{ background: color, height: 16 }}
          animate={active ? { opacity: [0.1, 1, 0.6], scaleY: [0.3, 1, 0.82] } : { opacity: 0.12, scaleY: 0.3 }}
          transition={{ duration: 0.9, repeat: active ? Infinity : 0, repeatType: 'reverse', delay: i * 0.05, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

const PROJ_DOTS: [number, number][] = [[20, 10], [34, 22], [50, 14], [66, 24], [80, 9], [94, 18]];

export function ProjectionViz({ active, color }: VizProps) {
  return (
    <div className={WRAP}>
      {PROJ_DOTS.map(([x, y], i) => (
        <span key={i} className="absolute h-1 w-1 rounded-full bg-[var(--nj-text-faint)]" style={{ left: x, top: y }} />
      ))}
      <motion.span
        className="absolute h-1.5 w-1.5 rounded-full"
        style={{ background: color, left: 50, top: 16, boxShadow: `0 0 6px 1px ${color}` }}
        animate={
          active
            ? { left: [50, 50, 98], top: [16, 16, 3], opacity: [0.5, 1, 0], scale: [1, 1.5, 0.4] }
            : { left: 50, top: 16, opacity: 0.4, scale: 1 }
        }
        transition={{ duration: 1.7, repeat: active ? Infinity : 0, times: [0, 0.4, 1], ease: 'easeIn' }}
      />
    </div>
  );
}
