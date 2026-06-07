import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useStore } from '../../state/store';
import { KPI_DEFS, isMet, deltaSign } from './kpiDefs';

/**
 * Six pill-shaped KPI readouts. Each shows actual vs. target with a clean
 * ✓/✗ indicator (green/amber — never red, which reads as "broken" in demos).
 * Numeric values stay neutral white for legibility. Hover expands a tooltip
 * with actual, target, gap, context note, and (for Macro F1) per-class F1.
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
                actual === null ? 'opacity-40' : '',
              ].join(' ')}
            >
              <span className="font-ui text-[10px] uppercase tracking-wider text-[var(--nj-text-dim)]">
                {def.label}
              </span>
              {/* Actual value — always neutral white, never colored */}
              <span className="text-[var(--nj-text-bright)]">
                {actual === null ? '——' : def.format(actual)}
              </span>
              <span className="text-[var(--nj-text-faint)]">/</span>
              <span className="text-[var(--nj-text-dim)]">
                {def.direction === 'gte' ? '≥' : '≤'}
                {def.format(def.target)}
              </span>
              {/* ✓/✗ glyph — green for met, amber for missed (NOT red) */}
              {actual !== null && (
                <span className={met ? 'text-[var(--nj-good)]' : 'text-[var(--nj-warning)]'}>
                  {met ? '✓' : '✗'}
                </span>
              )}
              {sign !== 0 && (
                <span className={sign > 0 ? 'text-[var(--nj-good)]' : 'text-[var(--nj-warning)]'}>
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
                  className="absolute left-1/2 top-[calc(100%+8px)] z-50 w-64 -translate-x-1/2 rounded-md border border-[var(--nj-border)] bg-[var(--nj-surface-solid)] p-2.5 text-[11px] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                >
                  <div className="mb-1 font-ui font-semibold text-[var(--nj-text-bright)]">{def.label}</div>
                  <p className="mb-1.5 leading-snug text-[var(--nj-text-dim)]">{def.hint}</p>
                  <div className="flex justify-between font-mono text-[10px]">
                    <span className="text-[var(--nj-text-dim)]">actual</span>
                    <span className="text-[var(--nj-text-bright)]">
                      {actual !== null ? def.format(actual) : '——'}
                    </span>
                  </div>
                  <div className="flex justify-between font-mono text-[10px]">
                    <span className="text-[var(--nj-text-dim)]">target</span>
                    <span className="text-[var(--nj-text)]">
                      {def.direction === 'gte' ? '≥ ' : '≤ '}
                      {def.format(def.target)}
                    </span>
                  </div>
                  {actual !== null && (
                    <div className="flex justify-between font-mono text-[10px]">
                      <span className="text-[var(--nj-text-dim)]">gap</span>
                      <span className={met ? 'text-[var(--nj-good)]' : 'text-[var(--nj-warning)]'}>
                        {met ? 'met · ' : 'short by '}
                        {def.format(Math.abs(actual - def.target))}
                      </span>
                    </div>
                  )}
                  {/* Context note from metrics.notes */}
                  {metrics?.notes?.[def.key] && (
                    <div className="mt-1.5 border-t border-[var(--nj-border)] pt-1.5 font-mono text-[9px] leading-snug text-[var(--nj-text-faint)]">
                      {(metrics.notes as Record<string, string>)[def.key]}
                    </div>
                  )}
                  {/* Per-class F1 breakdown for Macro F1 */}
                  {def.key === 'macro_f1' && metrics?.per_class_f1 && (
                    <div className="mt-1.5 border-t border-[var(--nj-border)] pt-1.5">
                      <div className="mb-1 font-ui text-[9px] uppercase tracking-wider text-[var(--nj-text-dim)]">
                        Per-class F1
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {Object.entries(metrics.per_class_f1).map(([cls, f1]) => (
                          <div key={cls} className="flex justify-between font-mono text-[9px]">
                            <span className="truncate text-[var(--nj-text-dim)]">{cls}</span>
                            <span
                              className={
                                (f1 as number) >= 0.5
                                  ? 'text-[var(--nj-text)]'
                                  : 'text-[var(--nj-warning)]'
                              }
                            >
                              {(f1 as number).toFixed(3)}
                            </span>
                          </div>
                        ))}
                      </div>
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
