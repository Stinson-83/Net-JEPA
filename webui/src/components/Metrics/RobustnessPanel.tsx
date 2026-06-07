import { motion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import { useStore } from '../../state/store';
import { EmptyState } from '../shared/EmptyState';
import { ACCENT, WARNING } from '../../data/classColors';

/** "Robustness" tab — accuracy under perturbation conditions (packet loss, jitter, truncation, …). */
export default function RobustnessPanel() {
  const robustness = useStore((s) => s.bundle?.metrics?.robustness ?? null);

  if (!robustness || robustness.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No robustness sweep"
        body="Add a `robustness` array to metrics.json — [{ condition, accuracy }] — to chart how classification degrades under packet loss, jitter, truncation, and similar perturbations."
      />
    );
  }

  const baseline = robustness[0].accuracy;
  const max = Math.max(...robustness.map((r) => r.accuracy), 0.01);

  return (
    <div className="flex flex-col gap-3 pr-1">
      {robustness.map((r, i) => {
        const drop = baseline - r.accuracy;
        const color = drop > 0.08 ? WARNING : ACCENT;
        return (
          <div key={r.condition}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-[10px] text-[var(--nj-text)]">{r.condition}</span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--nj-text-dim)]">
                {(r.accuracy * 100).toFixed(1)}%
                {i > 0 && (
                  <span className="ml-1.5" style={{ color: drop > 0.005 ? 'var(--nj-bad)' : 'var(--nj-good)' }}>
                    {drop > 0.005 ? `▼ ${(drop * 100).toFixed(1)}` : '— baseline'}
                  </span>
                )}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
              <motion.div
                className="h-full rounded-full"
                style={{ background: color, boxShadow: `0 0 8px 0 ${color}55` }}
                initial={{ width: 0 }}
                animate={{ width: `${(r.accuracy / max) * 100}%` }}
                transition={{ duration: 0.55, delay: i * 0.06, ease: 'easeOut' }}
              />
            </div>
          </div>
        );
      })}
      <p className="mt-1 font-mono text-[8px] leading-relaxed text-[var(--nj-text-faint)]">
        first row is treated as the clean-input baseline · drop highlighted in {' '}
        <span style={{ color: WARNING }}>amber</span> beyond 8 points
      </p>
    </div>
  );
}
