import { motion } from 'motion/react';
import { useStore, EMPTY_POINTS, EMPTY_CLASSES } from '../../state/store';
import { classColor } from '../../data/classColors';

/**
 * Floating bottom-left legend. Clicking a class toggles its visibility —
 * points are never unmounted, just animated to near-zero opacity (handled in
 * UMAPCanvas via a per-class fade uniform), so the cloud "breathes" rather
 * than popping. Press 1–6 to do the same from the keyboard.
 */
export default function Legend() {
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const hidden = useStore((s) => s.hiddenClasses);
  const toggle = useStore((s) => s.toggleClassVisibility);

  if (classes.length === 0) return null;
  const counts = new Map<string, number>();
  for (const p of points) counts.set(p.label, (counts.get(p.label) ?? 0) + 1);

  return (
    <div className="nj-bracket nj-bracket-active absolute bottom-4 left-4 z-20 rounded-md border border-[var(--nj-border)] bg-[var(--nj-surface)] px-2.5 py-2 backdrop-blur-sm">
      <div className="mb-1.5 px-0.5 font-ui text-[9px] uppercase tracking-[0.18em] text-[var(--nj-text-dim)]">
        Classes · click to isolate
      </div>
      <ul className="flex flex-col gap-0.5">
        {classes.map((label, i) => {
          const hue = classColor(classes, label);
          const isHidden = hidden.has(label);
          const count = counts.get(label) ?? 0;
          return (
            <li key={label}>
              <button
                onClick={() => toggle(label)}
                className="group flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-white/[0.04] cursor-pointer"
              >
                <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                  <motion.span
                    className="absolute inset-0 rounded-full"
                    style={{ background: hue.hex }}
                    animate={{ opacity: isHidden ? 0.18 : 1, scale: isHidden ? 0.6 : 1 }}
                    transition={{ duration: 0.25 }}
                  />
                  {!isHidden && (
                    <motion.span
                      className="absolute inset-[-3px] rounded-full"
                      style={{ background: hue.glow }}
                      animate={{ opacity: [0.5, 0.15, 0.5] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                </span>
                <span
                  className={`font-mono text-[11px] transition-colors ${
                    isHidden ? 'text-[var(--nj-text-faint)] line-through decoration-[var(--nj-text-faint)]' : 'text-[var(--nj-text)]'
                  } group-hover:text-[var(--nj-text-bright)]`}
                >
                  {label}
                </span>
                <span className="ml-auto pl-3 font-mono text-[9px] text-[var(--nj-text-faint)]">
                  {count.toLocaleString()}
                </span>
                <kbd className="rounded-sm border border-[var(--nj-border)] px-1 font-mono text-[8px] text-[var(--nj-text-faint)] opacity-0 group-hover:opacity-100">
                  {i + 1}
                </kbd>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
