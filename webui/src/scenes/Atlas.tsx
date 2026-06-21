import { useRef, useState } from 'react';
import Galaxy from '../galaxy/Galaxy';
import type { HoverInfo } from '../galaxy/Galaxy';
import type { Camera } from '../galaxy/camera';
import { useStore, EMPTY_POINTS } from '../app/store';
import { categoryMeta } from '../app/categories';
import { CategoryIcon, IconSparkle } from '../ui/icons';
import { Bar } from '../ui/primitives';
import Legend from '../panels/Legend';
import InjectDock from '../panels/InjectDock';
import FlowInspector from '../panels/FlowInspector';

function Tooltip({ info }: { info: HoverInfo }) {
  const meta = categoryMeta(info.point.label);
  return (
    <div className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+14px)]"
      style={{ left: info.screen.x, top: info.screen.y }}>
      <div className="nj-glass rounded-[10px] px-2.5 py-1.5" style={{ boxShadow: `0 8px 30px -10px ${meta.color}88` }}>
        <div className="flex items-center gap-1.5">
          <span style={{ color: meta.color }}><CategoryIcon icon={meta.icon} size={13} /></span>
          <span className="text-[11.5px] font-semibold" style={{ color: meta.color }}>{meta.name}</span>
          <span className="nj-num text-[10px] text-[var(--nj-text-faint)]">{(info.point.confidence * 100).toFixed(0)}%</span>
        </div>
        {info.point.flow_summary && <div className="nj-num mt-0.5 text-[9.5px] text-[var(--nj-text-muted)]">{info.point.flow_summary}</div>}
      </div>
    </div>
  );
}

function AtlasContext() {
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const metrics = useStore((s) => s.bundle?.metrics ?? null);
  const selectFlow = useStore((s) => s.selectFlow);
  const setFocus = useStore((s) => s.setFocusPoint);

  const surprise = () => {
    if (points.length === 0) return;
    const p = points[Math.floor(Math.random() * points.length)];
    selectFlow(p.id);
    setFocus(p);
  };

  return (
    <div className="nj-glass flex h-full w-[360px] flex-col rounded-[var(--nj-r)] p-4 nj-rise">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--nj-text-faint)]">The Atlas</span>
      <h2 className="mt-2 text-[19px] font-bold leading-tight text-[var(--nj-text-bright)]">
        Every star is one <span className="nj-sheen">encrypted flow</span>.
      </h2>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--nj-text-muted)]">
        {points.length.toLocaleString()} real 5G flows, each placed by the <em>shape</em> of its packets —
        sizes, timing, direction. Apps of the same kind drift together. <strong className="text-[var(--nj-text)]">No payload is ever decrypted.</strong>
      </p>

      {metrics && (
        <div className="mt-4 rounded-[var(--nj-r-sm)] p-3 nj-glass-soft">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--nj-text-faint)]">Cluster separation</div>
          <div className="space-y-2.5">
            <div>
              <div className="mb-1 flex justify-between text-[11px]"><span className="text-[var(--nj-text-muted)]">Same class (intra)</span><span className="nj-num" style={{ color: 'var(--nj-good)' }}>{metrics.intra_class_cos.toFixed(2)}</span></div>
              <Bar pct={metrics.intra_class_cos} color="var(--nj-good)" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px]"><span className="text-[var(--nj-text-muted)]">Different class (inter)</span><span className="nj-num" style={{ color: 'var(--nj-accent)' }}>{metrics.inter_class_cos.toFixed(2)}</span></div>
              <Bar pct={metrics.inter_class_cos} color="var(--nj-accent)" />
            </div>
          </div>
          <div className="mt-2 text-[10.5px] text-[var(--nj-text-faint)]">High intra, low inter = tight, well-separated clusters. Target: &gt;0.7 / &lt;0.3.</div>
        </div>
      )}

      <div className="mt-auto space-y-2 pt-4">
        <button onClick={surprise}
          className="flex w-full items-center justify-center gap-2 rounded-[var(--nj-r-sm)] py-2.5 text-[12px] font-semibold transition-all hover:brightness-110"
          style={{ color: '#04060d', background: 'linear-gradient(120deg, var(--nj-accent-2), var(--nj-accent))' }}>
          <IconSparkle size={15} /> Surprise me — inspect a flow
        </button>
        <div className="text-center text-[10.5px] text-[var(--nj-text-faint)]">drag to orbit · scroll to zoom · click a star</div>
      </div>
    </div>
  );
}

export default function Atlas() {
  const cameraRef = useRef<Camera | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const selectedId = useStore((s) => s.selectedId);
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Galaxy cameraRef={cameraRef} onHover={setHover} />
      {hover && <Tooltip info={hover} />}

      {/* top caption */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-[10.5px] nj-glass-soft">
        <span className="nj-num text-[var(--nj-text-muted)]">{points.length.toLocaleString()} flows</span>
        <span className="px-1.5 opacity-30">·</span>
        <span className="text-[var(--nj-text-muted)]">6 classes</span>
        <span className="px-1.5 opacity-30">·</span>
        <span className="nj-num text-[var(--nj-text-muted)]">128-D → 2-D</span>
      </div>

      {/* legend */}
      <div className="absolute left-3 top-3 z-10"><Legend /></div>

      {/* right panel */}
      <div className="absolute right-3 top-3 bottom-3 z-10">
        {selectedId ? <FlowInspector /> : <AtlasContext />}
      </div>

      {/* inject dock */}
      <div className="absolute bottom-3 left-3 right-[384px] z-10"><InjectDock /></div>
    </div>
  );
}
