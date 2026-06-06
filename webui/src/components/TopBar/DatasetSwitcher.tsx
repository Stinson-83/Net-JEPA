import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Database, Check } from 'lucide-react';
import { useStore } from '../../state/store';

/** Header dropdown for flipping between trained datasets present in manifest.json. */
export default function DatasetSwitcher() {
  const manifest = useStore((s) => s.manifest);
  const bundle = useStore((s) => s.bundle);
  const switchDataset = useStore((s) => s.switchDataset);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!manifest) return null;
  const datasets = manifest.datasets;
  const activeMeta = datasets.find((d) => d.id === bundle?.id) ?? datasets[0];
  const single = datasets.length <= 1;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !single && setOpen((o) => !o)}
        className={[
          'flex items-center gap-2 rounded-md border border-[var(--nj-border)] bg-[var(--nj-bg-raised)] px-2.5 py-1.5',
          'font-mono text-[11px] text-[var(--nj-text)]',
          single ? 'cursor-default' : 'cursor-pointer hover:border-[var(--nj-accent)]/50',
        ].join(' ')}
      >
        <Database size={12} className="text-[var(--nj-accent)]" />
        <span className="max-w-[160px] truncate">{activeMeta?.name ?? '—'}</span>
        {!single && (
          <ChevronDown size={12} className={`text-[var(--nj-text-dim)] transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
        {!bundle?.isLive && (
          <span className="rounded-sm border border-[var(--nj-warning)]/40 bg-[var(--nj-warning)]/10 px-1 text-[9px] uppercase tracking-wide text-[var(--nj-warning)]">
            mock
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-72 overflow-hidden rounded-md border border-[var(--nj-border)] bg-[var(--nj-surface-solid)] shadow-[0_12px_32px_rgba(0,0,0,0.6)]"
          >
            <div className="border-b border-[var(--nj-border)] px-3 py-2 font-ui text-[10px] uppercase tracking-wider text-[var(--nj-text-dim)]">
              Trained datasets · {datasets.length}
            </div>
            <ul className="max-h-72 overflow-y-auto nj-scroll">
              {datasets.map((d) => {
                const active = d.id === bundle?.id;
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => {
                        setOpen(false);
                        if (!active) void switchDataset(d.id);
                      }}
                      className={[
                        'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                        active ? 'bg-[var(--nj-accent)]/10' : 'hover:bg-white/[0.03]',
                      ].join(' ')}
                    >
                      <div className="mt-0.5 w-3.5 shrink-0">
                        {active && <Check size={13} className="text-[var(--nj-accent)]" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-ui text-[12px] text-[var(--nj-text-bright)]">{d.name}</div>
                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-[var(--nj-text-dim)]">
                          <span>{d.id}</span>
                          <span className="text-[var(--nj-text-faint)]">·</span>
                          <span>{d.n_flows.toLocaleString()} flows</span>
                          <span className="text-[var(--nj-text-faint)]">·</span>
                          <span>{d.trained_on}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
