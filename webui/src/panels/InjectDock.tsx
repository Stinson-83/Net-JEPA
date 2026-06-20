import { useRef, useState } from 'react';
import { useStore } from '../app/store';
import { injectFile, simulateCategory } from '../app/inject';
import { categoryMeta, CATEGORY_ORDER } from '../app/categories';
import { CategoryIcon, IconUpload, IconChevron } from '../ui/icons';
import { cx } from '../ui/primitives';
import PipelineTheatre from './PipelineTheatre';

export default function InjectDock() {
  const playing = useStore((s) => s.pipelinePlaying);
  const sessions = useStore((s) => s.sessions);
  const setFocus = useStore((s) => s.setFocusPoint);
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const onFile = (f: File | undefined | null) => { if (f) void injectFile(f); };

  return (
    <div className={cx('nj-glass rounded-[var(--nj-r)] transition-all', drag && 'ring-2')}
      style={drag ? { boxShadow: '0 0 0 2px var(--nj-accent)' } : undefined}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files?.[0]); }}>
      <div className="flex items-center gap-3 px-4 pt-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--nj-text-faint)]">Inject traffic</span>
        <span className="text-[10.5px] text-[var(--nj-text-faint)]">— watch the model classify it live</span>
        <div className="flex-1" />
        {playing && <span className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--nj-accent)' }}>
          <span className="nj-spin h-3 w-3 rounded-full border-2 border-current border-t-transparent" /> classifying…
        </span>}
        <button onClick={() => setCollapsed((c) => !c)} className="text-[var(--nj-text-faint)] hover:text-[var(--nj-text)]">
          <IconChevron size={15} className={collapsed ? '-rotate-90' : 'rotate-90'} />
        </button>
      </div>

      {!collapsed && (
        <div className="px-4 pb-3 pt-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".pcap,.cap" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <button disabled={playing} onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12px] font-semibold transition-all disabled:opacity-40"
              style={{ color: '#04060d', background: 'linear-gradient(120deg, var(--nj-accent), #7cc4ff)', boxShadow: '0 0 24px -6px var(--nj-accent-glow)' }}>
              <IconUpload size={15} /> Upload .pcap
            </button>
            <span className="text-[10.5px] text-[var(--nj-text-faint)]">or simulate</span>
            {CATEGORY_ORDER.map((label) => {
              const m = categoryMeta(label);
              return (
                <button key={label} disabled={playing} onClick={() => void simulateCategory(label)}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-all hover:bg-[var(--nj-glass-hi)] disabled:opacity-40"
                  style={{ color: m.color, border: `1px solid ${m.color}33`, background: `${m.color}10` }}>
                  <CategoryIcon icon={m.icon} size={13} /> {m.short}
                </button>
              );
            })}
          </div>

          <div className="my-3 h-px w-full" style={{ background: 'var(--nj-border)' }} />
          <PipelineTheatre />

          {(() => {
            const bd = sessions.find((s) => s.projection?.breakdown)?.projection?.breakdown;
            if (!bd) return null;
            const entries = Object.entries(bd.packetPct);   // server pre-sorts desc
            const dom = categoryMeta(bd.dominant ?? '');
            return (
              <div className="mt-2.5">
                <div className="flex items-center gap-2 text-[9.5px] uppercase tracking-wider text-[var(--nj-text-faint)]">
                  <span>Capture breakdown</span>
                  <span className="normal-case tracking-normal">
                    {bd.nFlows} flows · dominant <span style={{ color: dom.color }}>{dom.short}</span>
                  </span>
                </div>
                <div className="mt-1.5 space-y-1">
                  {entries.map(([label, pct]) => {
                    const m = categoryMeta(label);
                    return (
                      <div key={label} className="flex items-center gap-2 text-[10px]">
                        <span className="w-28 shrink-0 truncate" style={{ color: m.color }}>{m.short}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--nj-glass)' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.color }} />
                        </div>
                        <span className="nj-num w-9 text-right opacity-80">{pct.toFixed(0)}%</span>
                        <span className="nj-num w-7 text-right opacity-50">{bd.flowCounts[label] ?? 0}f</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {sessions.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[9.5px] uppercase tracking-wider text-[var(--nj-text-faint)]">Landed</span>
              {sessions.slice(0, 6).map((s) => {
                const m = categoryMeta(s.projection?.label);
                return (
                  <button key={s.id} disabled={!s.projection}
                    onClick={() => s.projection && setFocus({ id: s.id, x: s.projection.x, y: s.projection.y, label: s.projection.label, confidence: s.projection.confidence })}
                    className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] transition-colors hover:bg-[var(--nj-glass)]"
                    style={{ color: s.projection ? m.color : 'var(--nj-text-faint)', border: `1px solid ${s.projection ? `${m.color}33` : 'var(--nj-border)'}` }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.projection ? m.color : 'var(--nj-text-faint)' }} />
                    {s.projection ? m.short : '…'}
                    {s.projection && <span className="nj-num opacity-70">{(s.projection.confidence * 100).toFixed(0)}%</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
