import { motion, AnimatePresence } from 'motion/react';
import { Radar, Locate, ArrowRight } from 'lucide-react';
import { useStore, useActiveSession, EMPTY_CLASSES } from '../../state/store';
import { ACCENT, classColor } from '../../data/classColors';
import { DirectionStrip, EmptyState, Section, Sparkline, Stat } from './primitives';

/** "Injected" tab — the active PCAP-injection session: parsed flow, live projection status, features. */
export default function InjectedFlowPanel() {
  const session = useActiveSession();
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);
  const setFocusPoint = useStore((s) => s.setFocusPoint);

  if (!session) {
    return (
      <EmptyState
        icon={Radar}
        title="No injected flows yet"
        body="drop a .pcap to begin"
      />
    );
  }

  const { flow, projection, fileName } = session;
  const { tuple } = flow;
  const projHue = projection ? classColor(classes, projection.label) : null;

  return (
    <div className="flex flex-col gap-3.5">
      <header className="flex items-start gap-2.5">
        <Radar size={14} className="mt-0.5 shrink-0 text-[var(--nj-accent)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-ui text-[12px] font-medium text-[var(--nj-text-bright)]">{fileName}</div>
          <div className="truncate font-mono text-[10px] text-[var(--nj-text-faint)]">
            {tuple.srcIp}:{tuple.srcPort}
            <ArrowRight size={9} className="mx-1 inline align-[-1px] text-[var(--nj-text-faint)]" />
            {tuple.dstIp}:{tuple.dstPort} · {tuple.protocol}
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {projection && projHue ? (
          <motion.div
            key="projected"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex items-center gap-2.5 rounded-md border border-[var(--nj-border)] bg-black/20 px-2.5 py-2"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: projHue.hex, boxShadow: `0 0 10px 2px ${projHue.hex}` }} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-ui text-[12px] font-medium text-[var(--nj-text-bright)]">{projection.label}</div>
              <div className="font-mono text-[9px] text-[var(--nj-text-faint)]">
                {(projection.confidence * 100).toFixed(1)}% confidence · landed on the manifold
              </div>
            </div>
            <button
              onClick={() =>
                setFocusPoint({ id: `${session.id}::projection`, x: projection.x, y: projection.y, label: projection.label, confidence: projection.confidence })
              }
              title="Locate on map"
              className="shrink-0 cursor-pointer rounded border border-[var(--nj-border)] p-1 text-[var(--nj-text-dim)] transition-colors hover:border-[var(--nj-accent)]/50 hover:text-[var(--nj-accent)]"
            >
              <Locate size={12} />
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="pending"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2.5 rounded-md border border-dashed border-[var(--nj-border)] px-2.5 py-2"
          >
            <motion.span
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--nj-accent)]"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.15, 0.8] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="font-mono text-[10px] text-[var(--nj-text-dim)]">running through the pipeline…</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2">
        <Stat label="Duration" value={`${flow.durationS.toFixed(2)} s`} />
        <Stat label="Packets" value={flow.packetCount.toLocaleString()} />
        <Stat label="Avg size" value={`${flow.avgPacketSize.toFixed(0)} B`} />
        <Stat label="RTT" value={flow.rttMs !== null ? `${flow.rttMs.toFixed(1)} ms` : '—'} />
        <Stat label="Jitter" value={`${flow.jitterMs.toFixed(1)} ms`} />
        <Stat label="Rate" value={`${flow.packetRate.toFixed(1)} pkt/s`} />
      </div>

      <Section label="Packet sizes (bytes)">
        <Sparkline values={flow.packetSizes} color={ACCENT} kind="bars" />
      </Section>
      <Section label="Inter-arrival time (ms)">
        <Sparkline values={flow.iat} color={ACCENT} kind="line" />
      </Section>
      <Section label="Direction">
        <DirectionStrip direction={flow.direction} outColor={ACCENT} inColor="var(--nj-text-faint)" />
      </Section>
    </div>
  );
}
