import clsx from 'clsx';

export const cx = clsx;

export function Panel({ className, children, glow }: { className?: string; children: React.ReactNode; glow?: string }) {
  return (
    <div className={cx('nj-glass rounded-[var(--nj-r)]', className)}
      style={glow ? { boxShadow: `var(--nj-shadow), 0 0 0 1px ${glow}22, 0 0 38px -8px ${glow}44` } : undefined}>
      {children}
    </div>
  );
}

export function Tag({ children, color, className }: { children: React.ReactNode; color?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wider', className)}
      style={{
        color: color ?? 'var(--nj-text-muted)',
        background: color ? `${color}1a` : 'var(--nj-glass)',
        border: `1px solid ${color ? `${color}44` : 'var(--nj-border)'}`,
      }}>
      {children}
    </span>
  );
}

export function StatTile({ label, value, unit, accent, sub }: {
  label: string; value: string; unit?: string; accent?: string; sub?: string;
}) {
  return (
    <div className="nj-glass-soft rounded-[var(--nj-r-sm)] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-[var(--nj-text-faint)]">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="nj-num text-[22px] font-semibold leading-none" style={{ color: accent ?? 'var(--nj-text-bright)' }}>{value}</span>
        {unit && <span className="nj-num text-[12px] text-[var(--nj-text-muted)]">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[10.5px] text-[var(--nj-text-faint)]">{sub}</div>}
    </div>
  );
}

/** Labeled progress bar. value/target normalized 0..1 expected as `pct`. */
export function Bar({ pct, color, height = 6 }: { pct: number; color: string; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: 'var(--nj-glass)' }}>
      <div className="h-full rounded-full transition-[width] duration-700"
        style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%`, background: color, boxShadow: `0 0 12px -2px ${color}` }} />
    </div>
  );
}

/** SVG sparkline from a numeric series. */
export function Spark({ data, color, width = 120, height = 30, fill }: {
  data: number[]; color: string; width?: number; height?: number; fill?: boolean;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1e-9);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / Math.max(data.length - 1, 1);
  const pts = data.map((v, i) => [i * step, height - ((v - min) / range) * (height - 4) - 2]);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      {fill && <path d={area} fill={`${color}22`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px w-full', className)} style={{ background: 'var(--nj-border)' }} />;
}
