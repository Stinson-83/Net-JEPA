import { useMemo } from 'react';
import { useStore, EMPTY_POINTS } from '../app/store';
import { categoryMeta } from '../app/categories';
import { CategoryIcon, IconClose, IconLocate } from '../ui/icons';
import { cx, Bar } from '../ui/primitives';
import type { FlowFeatureDetail, UmapPoint } from '../data/types';

/** The packet "heartbeat": each packet a bar placed by inter-arrival time,
    height by size, up = outbound (client→server), down = inbound. */
function PacketWaterfall({ detail, color }: { detail: FlowFeatureDetail; color: string }) {
  const W = 320, H = 96, mid = H / 2;
  const { packet_sizes, direction, iat } = detail;
  const n = packet_sizes.length;
  const cum: number[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) { t += i === 0 ? 0 : (iat[i] || 0); cum.push(t); }
  const span = cum[n - 1] || 1;
  const maxSize = Math.max(...packet_sizes, 1);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <line x1="0" y1={mid} x2={W} y2={mid} stroke="var(--nj-border)" strokeWidth="1" strokeDasharray="2 3" />
      {packet_sizes.map((sz, i) => {
        const x = span > 0 ? (cum[i] / span) * (W - 8) + 4 : (i / Math.max(n - 1, 1)) * (W - 8) + 4;
        const h = (sz / maxSize) * (mid - 6);
        const up = direction[i] >= 0;
        return (
          <rect key={i} x={x - 1.4} width={2.8} y={up ? mid - h : mid} height={Math.max(h, 1.2)} rx={1.2}
            fill={color} opacity={up ? 0.95 : 0.55} />
        );
      })}
      <text x={4} y={11} fontSize={8.5} fill="var(--nj-text-faint)" fontFamily="var(--nj-font-mono)">▲ out</text>
      <text x={4} y={H - 3} fontSize={8.5} fill="var(--nj-text-faint)" fontFamily="var(--nj-font-mono)">▼ in</text>
    </svg>
  );
}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--nj-r-sm)] px-2.5 py-2 nj-glass-soft">
      <div className="text-[9px] uppercase tracking-wider text-[var(--nj-text-faint)]">{label}</div>
      <div className="nj-num mt-0.5 text-[14px] font-semibold text-[var(--nj-text-bright)]">{value}</div>
    </div>
  );
}

export default function FlowInspector() {
  const selectedId = useStore((s) => s.selectedId);
  const detail = useStore((s) => s.selectedDetail);
  const loading = useStore((s) => s.selectedLoading);
  const points = useStore((s) => s.bundle?.points ?? EMPTY_POINTS);
  const selectFlow = useStore((s) => s.selectFlow);
  const setFocus = useStore((s) => s.setFocusPoint);

  const pointById = useMemo(() => {
    const m = new Map<string, UmapPoint>();
    for (const p of points) m.set(p.id, p);
    return m;
  }, [points]);

  if (!selectedId) return null;
  const point = pointById.get(selectedId) ?? null;
  const label = detail?.predicted_class ?? point?.label ?? 'unknown';
  const meta = categoryMeta(label);
  const conf = point?.confidence ?? detail?.top3?.[0]?.prob ?? 0;

  return (
    <div className="nj-glass flex h-full w-[360px] flex-col rounded-[var(--nj-r)] nj-rise">
      {/* header */}
      <div className="flex items-center justify-between px-4 pt-3.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--nj-text-faint)]">Flow Inspector</span>
        <button onClick={() => selectFlow(null)} className="text-[var(--nj-text-faint)] hover:text-[var(--nj-text)]"><IconClose size={15} /></button>
      </div>

      {/* identity */}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-[12px]"
            style={{ color: meta.color, background: `${meta.color}14`, border: `1px solid ${meta.color}44`, boxShadow: `0 0 28px -6px ${meta.color}66` }}>
            <CategoryIcon icon={meta.icon} size={22} />
          </span>
          <div className="min-w-0">
            <div className="text-[16px] font-semibold leading-tight text-[var(--nj-text-bright)]">{meta.name}</div>
            <div className="nj-num text-[10.5px] text-[var(--nj-text-faint)]">{selectedId}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="nj-num text-[20px] font-bold leading-none" style={{ color: meta.color }}>{(conf * 100).toFixed(0)}%</div>
            <div className="text-[9px] uppercase tracking-wider text-[var(--nj-text-faint)]">confidence</div>
          </div>
        </div>
        {point?.flow_summary && (
          <div className="nj-num mt-2.5 rounded-[var(--nj-r-sm)] px-2.5 py-1.5 text-[11px] text-[var(--nj-text-muted)] nj-glass-soft">{point.flow_summary}</div>
        )}
      </div>

      <div className="nj-scroll mt-3 flex-1 overflow-y-auto px-4 pb-4">
        {loading && <div className="py-10 text-center text-[12px] text-[var(--nj-text-faint)]">Reading packet trace…</div>}

        {detail && (
          <>
            {/* the heartbeat */}
            <div className="mt-1">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--nj-text-faint)]">Packet heartbeat</span>
                <span className="text-[10px] text-[var(--nj-text-faint)]">{detail.packet_sizes.length} packets</span>
              </div>
              <div className="rounded-[var(--nj-r-sm)] p-2 nj-glass-soft">
                <PacketWaterfall detail={detail} color={meta.color} />
              </div>
              <div className="mt-1.5 text-[10.5px] leading-snug text-[var(--nj-text-faint)]">{meta.signature}</div>
            </div>

            {/* vitals */}
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <Vital label="rtt" value={`${detail.rtt_ms.toFixed(0)}ms`} />
              <Vital label="jitter" value={`${detail.jitter_ms.toFixed(0)}ms`} />
              <Vital label="rate" value={`${detail.packet_rate.toFixed(1)}/s`} />
              <Vital label="duration" value={`${detail.duration_s.toFixed(1)}s`} />
              <Vital label="avg size" value={`${Math.round(detail.packet_sizes.reduce((a, b) => a + b, 0) / detail.packet_sizes.length)}B`} />
              <Vital label="out/in" value={`${detail.direction.filter((d) => d > 0).length}/${detail.direction.filter((d) => d < 0).length}`} />
            </div>

            {/* top-3 */}
            <div className="mt-4">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--nj-text-faint)]">Model verdict</div>
              <div className="flex flex-col gap-2">
                {detail.top3.map((t) => {
                  const m = categoryMeta(t.label);
                  return (
                    <div key={t.label} className="flex items-center gap-2">
                      <span className="w-[120px] truncate text-[11.5px] text-[var(--nj-text)]">{m.name}</span>
                      <span className="flex-1"><Bar pct={t.prob} color={m.color} /></span>
                      <span className="nj-num w-9 text-right text-[11px]" style={{ color: m.color }}>{(t.prob * 100).toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* nearest neighbours */}
            {detail.knn_ids.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--nj-text-faint)]">Nearest neighbours</div>
                <div className="flex flex-wrap gap-1.5">
                  {detail.knn_ids.map((id) => {
                    const np = pointById.get(id);
                    const nm = categoryMeta(np?.label);
                    return (
                      <button key={id} onClick={() => { selectFlow(id); if (np) setFocus(np); }}
                        className="nj-num flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] transition-colors hover:bg-[var(--nj-glass-hi)]"
                        style={{ color: nm.color, border: `1px solid ${nm.color}33`, background: `${nm.color}10` }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: nm.color }} />
                        {id.replace('flow_', '#')}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 text-[10px] text-[var(--nj-text-faint)]">The flows this one sits closest to in 128-d space.</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* footer */}
      {point && (
        <div className="border-t px-4 py-3" style={{ borderColor: 'var(--nj-border)' }}>
          <button onClick={() => setFocus(point)}
            className={cx('flex w-full items-center justify-center gap-2 rounded-[var(--nj-r-sm)] py-2 text-[12px] font-medium transition-colors')}
            style={{ color: meta.color, background: `${meta.color}14`, border: `1px solid ${meta.color}33` }}>
            <IconLocate size={14} /> Locate in atlas
          </button>
        </div>
      )}
    </div>
  );
}
