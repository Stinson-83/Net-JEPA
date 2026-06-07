import { Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { useStore, EMPTY_POINTS, EMPTY_CLASSES } from '../../state/store';
import { classColor } from '../../data/classColors';

/**
 * Floating bottom-left legend. Clicking a class toggles its visibility.
 * Alt+click solos that class (hides all others). Eye icon shows visibility
 * state. A proportional bar visualises each class's share of total.
 */
export default function Legend() {
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const hidden = useStore((s) => s.hiddenClasses);
  const toggle = useStore((s) => s.toggleClassVisibility);

  if (classes.length === 0) return null;
  const counts = new Map<string, number>();
  for (const p of points) counts.set(p.label, (counts.get(p.label) ?? 0) + 1);
  const totalCount = points.length || 1;

  const handleClick = (label: string, e: React.MouseEvent) => {
    if (e.altKey) {
      // Solo: hide all others
      const state = useStore.getState();
      const allHidden = classes.filter((c) => c !== label).every((c) => state.hiddenClasses.has(c));
      if (allHidden) {
        // Un-solo: show all
        for (const c of classes) {
          if (state.hiddenClasses.has(c)) toggle(c);
        }
      } else {
        // Solo this class
        for (const c of classes) {
          const isHidden = state.hiddenClasses.has(c);
          if (c === label && isHidden) toggle(c);
          else if (c !== label && !isHidden) toggle(c);
        }
      }
    } else {
      toggle(label);
    }
  };

  return (
    <div className="nj-bracket nj-bracket-active nj-scroll !absolute bottom-4 left-4 z-20 max-h-[55%] overflow-y-auto rounded-md border border-[var(--nj-border)] bg-[var(--nj-surface)] px-2.5 py-2 backdrop-blur-sm">
      <div className="mb-1.5 px-0.5 font-ui text-[9px] uppercase tracking-[0.18em] text-[var(--nj-text-dim)]">
        Classes · click toggle · alt+click solo
      </div>
      <ul className="flex flex-col gap-0.5">
        {classes.map((label, i) => {
          const hue = classColor(classes, label);
          const isHidden = hidden.has(label);
          const count = counts.get(label) ?? 0;
          const share = count / totalCount;
          return (
            <li key={label}>
              <button
                onClick={(e) => handleClick(label, e)}
                className="group flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-white/[0.04] cursor-pointer"
              >
                {/* Eye icon */}
                <span className="flex h-3 w-3 shrink-0 items-center justify-center text-[var(--nj-text-faint)] transition-colors group-hover:text-[var(--nj-text-dim)]">
                  {isHidden ? <EyeOff size={10} /> : <Eye size={10} style={{ color: hue.hex }} />}
                </span>

                {/* Color dot */}
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

                {/* Class name */}
                <span
                  className={`flex-1 font-mono text-[11px] transition-colors ${
                    isHidden ? 'text-[var(--nj-text-faint)] line-through decoration-[var(--nj-text-faint)]' : 'text-[var(--nj-text)]'
                  } group-hover:text-[var(--nj-text-bright)]`}
                >
                  {label}
                </span>

                {/* Count — right-aligned mono column */}
                <span className="w-10 text-right font-mono text-[9px] tabular-nums text-[var(--nj-text-faint)]">
                  {count.toLocaleString()}
                </span>

                {/* Proportional share bar */}
                <span className="h-[3px] w-12 shrink-0 overflow-hidden rounded-full bg-white/[0.05]">
                  <motion.span
                    className="block h-full rounded-full"
                    style={{ background: hue.hex }}
                    initial={{ width: 0 }}
                    animate={{ width: `${share * 100}%`, opacity: isHidden ? 0.2 : 0.7 }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </span>

                {/* Keyboard hint */}
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
