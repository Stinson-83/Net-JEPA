import { motion } from 'motion/react';
import { BarChart3 } from 'lucide-react';
import { useStore, EMPTY_CLASS_STATS, EMPTY_CLASSES } from '../../state/store';
import { classColor } from '../../data/classColors';
import { EmptyState } from './primitives';

/** "Class Stats" tab — per-class traffic profile (count + averaged flow features). */
export default function ClassStatsPanel() {
  const classStats = useStore((s) => s.bundle?.classStats ?? EMPTY_CLASS_STATS);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);

  if (classStats.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No class statistics"
        body="Export class_stats.json alongside the manifest to populate this view with per-class traffic profiles (avg packet size, duration, RTT)."
      />
    );
  }

  const maxSize = Math.max(...classStats.map((c) => c.avg_packet_size), 1);
  const maxDuration = Math.max(...classStats.map((c) => c.avg_duration_s), 1);
  const maxRtt = Math.max(...classStats.map((c) => c.avg_rtt_ms), 1);

  return (
    <div className="flex flex-col gap-2">
      {classStats.map((c) => {
        const hue = classColor(classes, c.label);
        return (
          <div key={c.label} className="rounded-md border border-[var(--nj-border)]/60 bg-black/15 px-2.5 py-2">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hue.hex, boxShadow: `0 0 6px 1px ${hue.hex}` }} />
              <span className="truncate font-ui text-[11px] text-[var(--nj-text-bright)]">{c.label}</span>
              <span className="ml-auto shrink-0 font-mono text-[9px] text-[var(--nj-text-faint)]">{c.count.toLocaleString()} flows</span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <StatBar label="avg size" value={`${c.avg_packet_size.toFixed(0)} B`} fraction={c.avg_packet_size / maxSize} color={hue.hex} />
              <StatBar label="avg dur." value={`${c.avg_duration_s.toFixed(2)} s`} fraction={c.avg_duration_s / maxDuration} color={hue.hex} />
              <StatBar label="avg RTT" value={`${c.avg_rtt_ms.toFixed(1)} ms`} fraction={c.avg_rtt_ms / maxRtt} color={hue.hex} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatBar({ label, value, fraction, color }: { label: string; value: string; fraction: number; color: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--nj-text-faint)]">{label}</div>
      <div className="truncate font-mono text-[10px] text-[var(--nj-text)]">{value}</div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[0.05]">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(fraction, 1) * 100}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
