import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useStore } from '../../state/store';
import { KPI_DEFS, isMet, deltaSign } from './kpiDefs';

/**
 * Six pill-shaped KPI readouts. Each shows actual vs. target, a met/missed
 * glow (green/red, slow 2s sine pulse via the `nj-glow-*` CSS classes so the
 * animation stays off the JS thread), and a delta arrow comparing against the
 * previously-active dataset's metrics (when one exists).
 */
export default function KPIStrip() {
  const metrics = useStore((s) => s.bundle?.metrics ?? null);
  const previous = useStore((s) => s.previousMetrics);
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {KPI_DEFS.map((def) => {
        const actual = metrics ? def.extract(metrics) : null;
        const prevVal = previous ? def.extract(previous) : null;
        const met = actual !== null ? isMet(def, actual) : null;
        const delta = actual !== null && prevVal !== null ? actual - prevVal : null;
        const sign = delta !== null ? deltaSign(def, delta) : 0;

        return (
          <div
            key={def.key}
            className="relative"
            onMouseEnter={() => setHovered(def.key)}
            onMouseLeave={() => setHovered((h) => (h === def.key ? null : h))}
          >
            <div
              className={[
                'flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] leading-none',
                'border-[var(--nj-border)] bg-[var(--nj-bg-raised)]',
                actual === null ? 'opacity-40' : met ? 'nj-glow-good' : 'nj-glow-bad',
              ].join(' ')}
            >
              <span className="font-ui text-[10px] uppercase tracking-wider text-[var(--nj-text-dim)]">
                {def.label}
              </span>
              <span
                className={actual === null ? 'text-[var(--nj-text-faint)]' : met ? 'text-[var(--nj-good)]' : 'text-[var(--nj-bad)]'}
              >
                {actual === null ? '——' : def.format(actual)}
              </span>
              <span className="text-[var(--nj-text-faint)]">/</span>
              <span className="text-[var(--nj-text-dim)]">
                {def.direction === 'gte' ? '≥' : '≤'}
                {def.format(def.target)}
              </span>
              {sign !== 0 && (
                <span className={sign > 0 ? 'text-[var(--nj-good)]' : 'text-[var(--nj-bad)]'}>
                  {sign > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                </span>
              )}
              {sign === 0 && delta !== null && <Minus size={10} className="text-[var(--nj-text-faint)]" />}
            </div>

            <AnimatePresence>
              {hovered === def.key && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.14 }}
                  className="absolute left-1/2 top-[calc(100%+8px)] z-50 w-56 -translate-x-1/2 rounded-md border border-[var(--nj-border)] bg-[var(--nj-surface-solid)] p-2.5 text-[11px] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                >
                  <div className="mb-1 font-ui font-semibold text-[var(--nj-text-bright)]">{def.label}</div>
                  <p className="mb-1.5 leading-snug text-[var(--nj-text-dim)]">{KPI_DEFS.find(d=>d.key===def.key)?.hint}</p>
                  <div className="flex justify-between font-mono text-[10px]">
                    <span className="text-[var(--nj-text-dim)]">target</span>
                    <span className="text-[var(--nj-text)]">
                      {def.direction === 'gte' ? '≥ ' : '≤ '}
                      {def.format(def.target)}
                    </span>
                  </div>
                  {actual !== null && (
                    <div className="flex justify-between font-mono text-[10px]">
                      <span className="text-[var(--nj-text-dim)]">gap to target</span>
                      <span className={met ? 'text-[var(--nj-good)]' : 'text-[var(--nj-bad)]'}>
                        {met ? 'met · ' : 'short by '}
                        {def.format(Math.abs(actual - def.target))}
                      </span>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
