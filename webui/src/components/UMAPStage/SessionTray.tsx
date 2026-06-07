import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronUp, Radar } from 'lucide-react';
import { useStore, EMPTY_POINTS, EMPTY_CLASSES } from '../../state/store';
import { classHex } from '../../data/classColors';

/**
 * Collapsible bottom-right tray listing every flow injected this session
 * (newest first). Clicking a row makes it active — re-focusing the comet ring
 * on the UMAP, switching the Inspector to its "Injected" tab, and flying the
 * camera to its projected point.
 */
export default function SessionTray() {
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const collapsed = useStore((s) => s.trayCollapsed);
  const toggle = useStore((s) => s.toggleTray);
  const setActive = useStore((s) => s.setActiveSession);
  const setInspectorTab = useStore((s) => s.setInspectorTab);
  const setFocusPoint = useStore((s) => s.setFocusPoint);
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);

  if (sessions.length === 0) return null;

  const focus = (sessionId: string, projLabel: string | undefined, x?: number, y?: number) => {
    setActive(sessionId);
    setInspectorTab('injected');
    if (x !== undefined && y !== undefined) {
      setFocusPoint({ id: `${sessionId}::projection`, x, y, label: projLabel ?? '', confidence: 1 });
    }
  };

  return (
    <div className="nj-bracket nj-bracket-active !absolute right-4 top-4 z-20 w-64 max-h-[45%] overflow-hidden rounded-md border border-[var(--nj-border)] bg-[var(--nj-surface)] backdrop-blur-sm">
      <button
        onClick={toggle}
        className="flex w-full cursor-pointer items-center gap-2 border-b border-[var(--nj-border)] px-2.5 py-1.5 text-left hover:bg-white/[0.03]"
      >
        <Radar size={11} className="text-[var(--nj-accent)]" />
        <span className="font-ui text-[9px] uppercase tracking-[0.18em] text-[var(--nj-text-dim)]">
          Injected flows · {sessions.length}
        </span>
        {collapsed ? (
          <ChevronDown size={12} className="ml-auto text-[var(--nj-text-faint)]" />
        ) : (
          <ChevronUp size={12} className="ml-auto text-[var(--nj-text-faint)]" />
        )}
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.ul
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="nj-scroll max-h-52 overflow-y-auto"
          >
            {sessions.map((s) => {
              const isActive = s.id === activeSessionId;
              const label = s.projection?.label;
              const point = points.find((p) => p.id === s.flow.flowId);
              return (
                <li key={s.id}>
                  <button
                    onClick={() => focus(s.id, label, s.projection?.x ?? point?.x, s.projection?.y ?? point?.y)}
                    className={`flex w-full items-center gap-2 border-b border-[var(--nj-border)]/60 px-2.5 py-1.5 text-left transition-colors cursor-pointer hover:bg-white/[0.04] ${
                      isActive ? 'bg-white/[0.05]' : ''
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: label ? classHex(classes, label) : 'var(--nj-text-faint)',
                        boxShadow: label ? `0 0 6px 1px ${classHex(classes, label)}` : undefined,
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[10px] text-[var(--nj-text)]">{s.fileName}</div>
                      <div className="truncate font-mono text-[9px] text-[var(--nj-text-faint)]">
                        {s.projection ? `${label} · ${(s.projection.confidence * 100).toFixed(0)}% conf.` : 'projecting…'}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
