import { Fragment, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Grid3x3 } from 'lucide-react';
import { useStore, EMPTY_CLASSES } from '../../state/store';
import { classColor, hexToRgb01 } from '../../data/classColors';
import { EmptyState } from '../shared/EmptyState';

/**
 * Smart-truncate class names: keep unique prefix, truncate at word boundary
 * e.g. "video_conferencing" → "video_conf", "online_game" → "online_ga"
 */
function smartTruncate(label: string, max = 10): string {
  if (label.length <= max) return label;
  // Try to break at underscore
  const parts = label.split('_');
  let result = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const next = result + '_' + parts[i];
    if (next.length > max) {
      // Add partial of next part
      const remaining = max - result.length - 1;
      if (remaining > 2) result += '_' + parts[i].slice(0, remaining);
      break;
    }
    result = next;
  }
  return result.length < label.length ? result : label.slice(0, max);
}

/** Compute relative luminance of a hex color to determine text contrast */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb01(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

interface HoverCell { i: number; j: number }

/**
 * "Confusion" tab — each row uses its class's own accent hue as the colormap
 * maximum, so the matrix reads as a per-class heat signature. Diagonal cells
 * get a 1px inner stroke highlight. Raw counts are always visible.
 */
export default function ConfusionPanel() {
  const cm = useStore((s) => s.bundle?.metrics?.confusion_matrix ?? null);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-0.5">
        <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--nj-text-faint)]">rows = true · cols = predicted</span>
      </div>

      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: `minmax(46px,64px) repeat(${n}, minmax(0, 1fr))` }}
      >
        {/* Column headers */}
        <div />
        {cm.labels.map((l, j) => (
          <div
            key={j}
            className="truncate px-0.5 pb-1 text-center font-mono text-[7px] text-[var(--nj-text-faint)]"
            title={l}
          >
            {smartTruncate(l)}
          </div>
        ))}

        {/* Matrix rows */}
        {cm.matrix.map((row, i) => {
          const rowHue = classColor(classes, cm.labels[i]);
          const [hr, hg, hb] = hexToRgb01(rowHue.hex);
          const rowLum = luminance(rowHue.hex);

          return (
            <Fragment key={i}>
              {/* Row label */}
              <div
                className="flex items-center justify-end truncate pr-1.5 font-mono text-[8px] text-[var(--nj-text-faint)]"
                title={cm.labels[i]}
              >
                {smartTruncate(cm.labels[i])}
              </div>

              {/* Cells */}
              {row.map((v, j) => {
                const frac = v / rowTotals[i];
                const isDiag = i === j;
                const isHover = hover?.i === i && hover?.j === j;

                // Per-class hue colormap: #0a0e14 (zero) → class accent (max)
                const bg = `rgba(${Math.round(hr * 255 * frac + 10 * (1 - frac))}, ${Math.round(hg * 255 * frac + 14 * (1 - frac))}, ${Math.round(hb * 255 * frac + 20 * (1 - frac))}, ${(0.15 + frac * 0.85).toFixed(3)})`;

                // Text color: white if cell is dark, dark if cell is light
                const cellBrightness = frac * rowLum;
                const textColor = cellBrightness > 0.35 ? 'rgba(7,9,13,0.9)' : 'rgba(201,209,217,0.85)';

                return (
                  <div
                    key={j}
                    onMouseEnter={() => setHover({ i, j })}
                    onMouseLeave={() => setHover((h) => (h?.i === i && h?.j === j ? null : h))}
                    className="relative flex aspect-square cursor-default items-center justify-center rounded-[2px] font-mono text-[8px] transition-[transform,outline-color] duration-150"
                    style={{
                      background: bg,
                      color: textColor,
                      outline: isHover ? '1.5px solid var(--nj-accent)' : isDiag ? '1px solid #7dd3fc44' : '1.5px solid transparent',
                      transform: isHover ? 'scale(1.12)' : 'scale(1)',
                      zIndex: isHover ? 10 : 0,
                    }}
                    title={`${cm.labels[i]} → ${cm.labels[j]}: ${v} (${(frac * 100).toFixed(1)}%)`}
                  >
                    {/* Always show raw count */}
                    {v > 0 ? v : ''}
                  </div>
                );
              })}
            </Fragment>
          );
        })}
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
