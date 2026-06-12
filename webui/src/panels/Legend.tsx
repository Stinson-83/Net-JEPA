import { useMemo, useState } from 'react';
import { useStore, EMPTY_POINTS, EMPTY_CLASSES } from '../app/store';
import { categoryMeta } from '../app/categories';
import { CategoryIcon } from '../ui/icons';
import { cx } from '../ui/primitives';

export default function Legend() {
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);
  const hidden = useStore((s) => s.hiddenClasses);
  const soloClass = useStore((s) => s.soloClass);
  const showAll = useStore((s) => s.showAllClasses);
  const [hover, setHover] = useState<string | null>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of points) m.set(p.label, (m.get(p.label) ?? 0) + 1);
    return m;
  }, [points]);
  const total = points.length || 1;
  const anyHidden = hidden.size > 0;

  return (
    <div className="nj-glass w-[252px] rounded-[var(--nj-r)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--nj-text-faint)]">Traffic classes</span>
        <button onClick={showAll} disabled={!anyHidden}
          className={cx('text-[10px] uppercase tracking-wider transition-opacity', anyHidden ? 'text-[var(--nj-accent)] hover:opacity-80' : 'pointer-events-none opacity-30')}>
          reset
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {classes.map((label) => {
          const meta = categoryMeta(label);
          const cnt = counts.get(label) ?? 0;
          const isHidden = hidden.has(label);
          return (
            <button key={label} onClick={() => soloClass(label)}
              onMouseEnter={() => setHover(label)} onMouseLeave={() => setHover(null)}
              className={cx('group flex w-full items-center gap-2.5 rounded-[var(--nj-r-sm)] px-2 py-1.5 text-left transition-all',
                isHidden ? 'opacity-35' : 'hover:bg-[var(--nj-glass)]')}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px]"
                style={{ color: meta.color, background: `${meta.color}14`, border: `1px solid ${meta.color}33` }}>
                <CategoryIcon icon={meta.icon} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between">
                  <span className="truncate text-[12px] font-medium text-[var(--nj-text)]">{meta.name}</span>
                  <span className="nj-num text-[11px] text-[var(--nj-text-faint)]">{cnt}</span>
                </span>
                <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full" style={{ background: 'var(--nj-glass)' }}>
                  <span className="block h-full rounded-full" style={{ width: `${(cnt / total) * 100}%`, background: meta.color }} />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {hover && (
        <div className="mt-2 rounded-[var(--nj-r-sm)] p-2.5 text-[11px] leading-snug nj-glass-soft"
          style={{ borderColor: `${categoryMeta(hover).color}33` }}>
          <div className="mb-1 flex flex-wrap gap-1">
            {categoryMeta(hover).apps.map((a) => (
              <span key={a} className="rounded px-1.5 py-px text-[9.5px]" style={{ color: categoryMeta(hover).color, background: `${categoryMeta(hover).color}14` }}>{a}</span>
            ))}
          </div>
          <div className="text-[var(--nj-text-muted)]">{categoryMeta(hover).signature}</div>
        </div>
      )}
      <div className="mt-2 px-1 text-[10px] text-[var(--nj-text-faint)]">Click a class to solo · hover for its packet signature</div>
    </div>
  );
}
