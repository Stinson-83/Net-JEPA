import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { classColor } from '../../data/classColors';
import type { Top3Prob } from '../../data/types';
import { EmptyState } from '../shared/EmptyState';

// Small shared building blocks used across the Inspector's three tabs
// (Selected / Injected / Class Stats) — kept in one place so the panels read
// as "data + layout" rather than re-deriving the same primitives three times.

export { EmptyState };

export function SkeletonLines({ widths = [55, 85, 40, 70, 60] }: { widths?: number[] }) {
  return (
    <div className="flex animate-pulse flex-col gap-2.5">
      {widths.map((w, i) => (
        <div key={i} className="h-3 rounded bg-white/[0.04]" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--nj-text-faint)]">{label}</div>
      <div className="font-mono text-[12px] text-[var(--nj-text)]">{value}</div>
    </div>
  );
}

export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--nj-text-faint)]">{label}</div>
      {children}
    </div>
  );
}

export function Top3Bars({ top3, classes }: { top3: Top3Prob[]; classes: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      {top3.map((t, i) => {
        const hue = classColor(classes, t.label);
        return (
          <div key={t.label} className="flex items-center gap-2">
            <span className="w-[88px] shrink-0 truncate font-mono text-[9px] text-[var(--nj-text-dim)]">{t.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
              <motion.div
                className="h-full rounded-full"
                style={{ background: hue.hex, boxShadow: `0 0 6px 0 ${hue.glow}` }}
                initial={{ width: 0 }}
                animate={{ width: `${t.prob * 100}%` }}
                transition={{ duration: 0.5, delay: i * 0.06, ease: 'easeOut' }}
              />
            </div>
            <span className="w-9 shrink-0 text-right font-mono text-[9px] text-[var(--nj-text-faint)]">{(t.prob * 100).toFixed(0)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function downsampleAvg(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values;
  const bucket = values.length / maxPoints;
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.max(Math.floor((i + 1) * bucket), start + 1);
    const chunk = values.slice(start, end);
    out.push(chunk.reduce((a, b) => a + b, 0) / chunk.length);
  }
  return out;
}

function downsampleSign(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values;
  const bucket = Math.ceil(values.length / maxPoints);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += bucket) {
    const chunk = values.slice(i, i + bucket);
    out.push(chunk.reduce((a, b) => a + b, 0) >= 0 ? 1 : -1);
  }
  return out;
}

interface SparklineProps {
  values: number[];
  color: string;
  kind?: 'line' | 'bars';
  height?: number;
}

/** Lightweight inline SVG chart — no charting-library overhead for an 8px-tall strip. */
export function Sparkline({ values, color, kind = 'line', height = 26 }: SparklineProps) {
  if (values.length === 0) return <div className="font-mono text-[9px] text-[var(--nj-text-faint)]">no data</div>;
  const vals = downsampleAvg(values, 96);
  const w = 240;
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = max - min || 1;
  const norm = (v: number) => ((v - min) / span) * (height - 3) + 1.5;

  if (kind === 'bars') {
    const bw = w / vals.length;
    return (
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-7 w-full">
        {vals.map((v, i) => {
          const h = norm(v);
          return <rect key={i} x={i * bw} y={height - h} width={Math.max(bw - 0.6, 0.5)} height={h} fill={color} opacity={0.65} rx={0.5} />;
        })}
      </svg>
    );
  }
  const points = vals.map((v, i) => `${(i / Math.max(vals.length - 1, 1)) * w},${height - norm(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-7 w-full">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.1} opacity={0.85} strokeLinejoin="round" />
    </svg>
  );
}

/** Categorical strip for ±1 direction sequences (out vs. in packets). */
export function DirectionStrip({ direction, outColor, inColor }: { direction: number[]; outColor: string; inColor: string }) {
  if (direction.length === 0) return <div className="font-mono text-[9px] text-[var(--nj-text-faint)]">no data</div>;
  const vals = downsampleSign(direction, 96);
  const w = 240;
  const bw = w / vals.length;
  const outCount = direction.filter((d) => d > 0).length;
  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${w} 12`} preserveAspectRatio="none" className="h-3 w-full">
        {vals.map((d, i) => (
          <rect key={i} x={i * bw} y={0} width={Math.max(bw - 0.4, 0.4)} height={12} fill={d > 0 ? outColor : inColor} opacity={d > 0 ? 0.85 : 0.55} />
        ))}
      </svg>
      <div className="flex justify-between font-mono text-[8px] text-[var(--nj-text-faint)]">
        <span style={{ color: outColor }}>↑ out · {outCount}</span>
        <span>↓ in · {direction.length - outCount}</span>
      </div>
    </div>
  );
}
