import { Fragment, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Grid3x3 } from 'lucide-react';
import { useStore } from '../../state/store';
import { EmptyState } from '../shared/EmptyState';

const GOOD_RGB = '74,222,128';
const BAD_RGB = '251,113,133';

function shorten(label: string, max = 7): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

interface HoverCell { i: number; j: number }

/**
 * "Confusion" tab — a per-row-normalised heatmap (rows = true class, columns
 * = predicted class). Diagonal cells tint green (correct), off-diagonal tint
 * red (confused), intensity ∝ the row-fraction — so imbalanced classes read
 * just as clearly as balanced ones. Hover any cell for the exact count.
 */
export default function ConfusionPanel() {
  const cm = useStore((s) => s.bundle?.metrics?.confusion_matrix ?? null);
  const [hover, setHover] = useState<HoverCell | null>(null);

  if (!cm || cm.labels.length === 0 || cm.matrix.length === 0) {
    return (
      <EmptyState
        icon={Grid3x3}
        title="No confusion matrix"
        body="Export metrics.json with a confusion_matrix (labels + matrix) to visualise per-class prediction overlap."
      />
    );
  }

  const n = cm.labels.length;
  const rowTotals = cm.matrix.map((row) => row.reduce((a, b) => a + b, 0) || 1);
  const hoverDetail = hover
    ? {
        trueLabel: cm.labels[hover.i],
        predLabel: cm.labels[hover.j],
        value: cm.matrix[hover.i]?.[hover.j] ?? 0,
        frac: (cm.matrix[hover.i]?.[hover.j] ?? 0) / rowTotals[hover.i],
      }
    : null;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between px-0.5">
        <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--nj-text-faint)]">rows = true · cols = predicted</span>
        <div className="flex items-center gap-3">
          <Swatch color={`rgb(${GOOD_RGB})`} label="correct" />
          <Swatch color={`rgb(${BAD_RGB})`} label="confused" />
        </div>
      </div>

      <div className="grid flex-1 content-start gap-[2px]" style={{ gridTemplateColumns: `minmax(46px,64px) repeat(${n}, minmax(0, 1fr))` }}>
        <div />
        {cm.labels.map((l, j) => (
          <div key={j} className="truncate px-0.5 pb-1 text-center font-mono text-[7px] text-[var(--nj-text-faint)]" title={l}>
            {shorten(l)}
          </div>
        ))}
        {cm.matrix.map((row, i) => (
          <Fragment key={i}>
            <div className="flex items-center justify-end truncate pr-1.5 font-mono text-[8px] text-[var(--nj-text-faint)]" title={cm.labels[i]}>
              {cm.labels[i]}
            </div>
            {row.map((v, j) => {
              const frac = v / rowTotals[i];
              const rgb = i === j ? GOOD_RGB : BAD_RGB;
              const isHover = hover?.i === i && hover?.j === j;
              return (
                <div
                  key={j}
                  onMouseEnter={() => setHover({ i, j })}
                  onMouseLeave={() => setHover((h) => (h?.i === i && h?.j === j ? null : h))}
                  className="relative flex aspect-square cursor-default items-center justify-center rounded-[2px] font-mono text-[8px] transition-[transform,outline-color] duration-150"
                  style={{
                    background: `rgba(${rgb}, ${(0.05 + frac * 0.85).toFixed(3)})`,
                    color: frac > 0.42 ? 'rgba(7,9,13,0.8)' : 'var(--nj-text-faint)',
                    outline: isHover ? '1.5px solid var(--nj-accent)' : '1.5px solid transparent',
                    transform: isHover ? 'scale(1.18)' : 'scale(1)',
                    zIndex: isHover ? 10 : 0,
                  }}
                >
                  {frac > 0.1 ? Math.round(frac * 100) : ''}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>

      <div className="h-8 shrink-0">
        <AnimatePresence mode="wait">
          {hoverDetail && (
            <motion.div
              key={`${hoverDetail.trueLabel}-${hoverDetail.predLabel}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="rounded-md border border-[var(--nj-border)] bg-black/20 px-2.5 py-1.5 font-mono text-[9px] text-[var(--nj-text-dim)]"
            >
              <span className="text-[var(--nj-text)]">{hoverDetail.trueLabel}</span> classified as{' '}
              <span className="text-[var(--nj-text)]">{hoverDetail.predLabel}</span> ·{' '}
              <span className="text-[var(--nj-text-bright)]">{hoverDetail.value.toLocaleString()}</span> flows ·{' '}
              {(hoverDetail.frac * 100).toFixed(1)}% of true {hoverDetail.trueLabel}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
      <span className="font-mono text-[8px] text-[var(--nj-text-faint)]">{label}</span>
    </div>
  );
}
