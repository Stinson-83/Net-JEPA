import { motion, AnimatePresence } from 'motion/react';
import { useStore, EMPTY_CLASSES } from '../../state/store';
import { classColor } from '../../data/classColors';
import type { HoverInfo } from './UMAPCanvas';

/** Floating hover card that follows the nearest point under the cursor. */
export default function Tooltip({ info }: { info: HoverInfo | null }) {
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);

  return (
    <AnimatePresence>
      {info && (
        <motion.div
          key={info.point.id}
          initial={{ opacity: 0, y: 4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="nj-bracket pointer-events-none absolute z-30 min-w-[150px] rounded-md border border-[var(--nj-border-hi)] bg-[var(--nj-surface)]/95 px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-md"
          style={{ left: info.screen.x, top: info.screen.y - 16, transform: 'translate(-50%, -100%)' }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{
                background: classColor(classes, info.point.label).hex,
                boxShadow: `0 0 8px 1px ${classColor(classes, info.point.label).hex}`,
              }}
            />
            <span className="font-ui text-[12px] font-medium text-[var(--nj-text-bright)]">{info.point.label}</span>
            <span className="ml-auto font-mono text-[10px] text-[var(--nj-text-dim)]">
              {(info.point.confidence * 100).toFixed(1)}%
            </span>
          </div>
          {info.point.flow_summary && (
            <div className="mt-1 max-w-[230px] truncate font-mono text-[10px] text-[var(--nj-text-faint)]">
              {info.point.flow_summary}
            </div>
          )}
          <div className="mt-0.5 font-mono text-[9px] text-[var(--nj-text-faint)]">{info.point.id}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
