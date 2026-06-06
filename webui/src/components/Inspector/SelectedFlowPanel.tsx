import { Crosshair, Locate } from 'lucide-react';
import { useStore, EMPTY_POINTS, EMPTY_CLASSES } from '../../state/store';
import { ACCENT, classColor } from '../../data/classColors';
import { DirectionStrip, EmptyState, Section, SkeletonLines, Sparkline, Stat, Top3Bars } from './primitives';

/** "Selected" tab — the flow currently clicked in the embedding space. */
export default function SelectedFlowPanel() {
  const id = useStore((s) => s.selectedFlowId);
  const detail = useStore((s) => s.selectedFlowDetail);
  const loading = useStore((s) => s.selectedFlowLoading);
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const classes = useStore((s) => s.manifest?.classes ?? EMPTY_CLASSES);
  const selectFlow = useStore((s) => s.selectFlow);
  const setFocusPoint = useStore((s) => s.setFocusPoint);

  if (!id) {
    return (
      <EmptyState
        icon={Crosshair}
        title="Nothing selected"
        body="Click any point in the embedding space — or press 1–9 to isolate a class — to inspect its features, top-3 prediction, and nearest neighbours."
      />
    );
  }

  const point = points.find((p) => p.id === id) ?? null;
  if (loading || !detail || !point) return <SkeletonLines />;

  const hue = classColor(classes, point.label);

  return (
    <div className="flex flex-col gap-3.5">
      <header className="flex items-start gap-2.5">
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: hue.hex, boxShadow: `0 0 10px 2px ${hue.hex}` }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-ui text-[13px] font-medium text-[var(--nj-text-bright)]">{detail.predicted_class}</div>
          <div className="truncate font-mono text-[10px] text-[var(--nj-text-faint)]">{detail.id}</div>
        </div>
        <button
          onClick={() => setFocusPoint(point)}
          title="Locate on map"
          className="shrink-0 cursor-pointer rounded border border-[var(--nj-border)] p-1 text-[var(--nj-text-dim)] transition-colors hover:border-[var(--nj-accent)]/50 hover:text-[var(--nj-accent)]"
        >
          <Locate size={12} />
        </button>
      </header>

      {point.flow_summary && (
        <p className="-mt-1 font-mono text-[10px] leading-relaxed text-[var(--nj-text-dim)]">{point.flow_summary}</p>
      )}

      <Section label="Top-3 prediction">
        <Top3Bars top3={detail.top3} classes={classes} />
      </Section>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2">
        <Stat label="Confidence" value={`${(point.confidence * 100).toFixed(1)}%`} />
        <Stat label="Duration" value={`${detail.duration_s.toFixed(2)} s`} />
        <Stat label="Packets" value={detail.packet_sizes.length.toLocaleString()} />
        <Stat label="RTT" value={`${detail.rtt_ms.toFixed(1)} ms`} />
        <Stat label="Jitter" value={`${detail.jitter_ms.toFixed(1)} ms`} />
        <Stat label="Rate" value={`${detail.packet_rate.toFixed(1)} pkt/s`} />
      </div>

      <Section label="Packet sizes (bytes)">
        <Sparkline values={detail.packet_sizes} color={hue.hex} kind="bars" />
      </Section>
      <Section label="Inter-arrival time (ms)">
        <Sparkline values={detail.iat} color={ACCENT} kind="line" />
      </Section>
      <Section label="Direction">
        <DirectionStrip direction={detail.direction} outColor={hue.hex} inColor="var(--nj-text-faint)" />
      </Section>

      {detail.knn_ids.length > 0 && (
        <Section label="Nearest neighbours">
          <div className="flex flex-wrap gap-1.5">
            {detail.knn_ids.map((nid) => {
              const np = points.find((p) => p.id === nid);
              if (!np) return null;
              const nh = classColor(classes, np.label);
              return (
                <button
                  key={nid}
                  onClick={() => selectFlow(nid)}
                  className="flex cursor-pointer items-center gap-1.5 rounded border border-[var(--nj-border)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--nj-text-dim)] transition-colors hover:border-[var(--nj-accent)]/40 hover:text-[var(--nj-text)]"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: nh.hex }} />
                  {np.label}
                </button>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
