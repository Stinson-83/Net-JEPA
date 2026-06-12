import { useStore, PIPELINE } from '../app/store';
import { cx } from '../ui/primitives';

export default function PipelineTheatre() {
  const stageIndex = useStore((s) => s.stageIndex);
  const playing = useStore((s) => s.pipelinePlaying);
  const events = useStore((s) => s.liveEvents);

  return (
    <div className="w-full">
      <div className="nj-scroll flex items-stretch gap-0 overflow-x-auto pb-1">
        {PIPELINE.map((stage, i) => {
          const done = i < stageIndex;
          const active = i === stageIndex && playing;
          const accent = active ? 'var(--nj-accent)' : done ? 'var(--nj-good)' : 'var(--nj-text-faint)';
          return (
            <div key={stage.id} className="flex items-center">
              <div className={cx('relative flex min-w-[96px] flex-col rounded-[10px] px-2.5 py-1.5 transition-all duration-300',
                  active && 'scale-[1.04]')}
                style={{
                  background: active ? 'var(--nj-glass-hi)' : 'transparent',
                  border: `1px solid ${active ? 'var(--nj-border-hi)' : 'transparent'}`,
                  boxShadow: active ? '0 0 26px -8px var(--nj-accent-glow)' : 'none',
                }}>
                <div className="flex items-center gap-1.5">
                  <span className="grid h-4 w-4 place-items-center rounded-full text-[8.5px] font-bold"
                    style={{ color: done || active ? '#04060d' : 'var(--nj-text-faint)', background: done || active ? accent : 'var(--nj-glass)' }}>
                    {done ? '✓' : i + 1}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: active ? 'var(--nj-text-bright)' : done ? 'var(--nj-text)' : 'var(--nj-text-faint)' }}>
                    {stage.label}
                  </span>
                </div>
                <span className="mt-0.5 pl-[22px] text-[9px] leading-tight text-[var(--nj-text-faint)]">{stage.sub}</span>
                {active && <span className="absolute -bottom-px left-2 right-2 h-px overflow-hidden">
                  <span className="block h-full w-1/2 animate-[nj-scan_1s_linear_infinite]" style={{ background: 'var(--nj-accent)' }} />
                </span>}
              </div>
              {i < PIPELINE.length - 1 && (
                <div className="mx-0.5 h-px w-3 shrink-0" style={{ background: i < stageIndex ? 'var(--nj-good)' : 'var(--nj-border)' }} />
              )}
            </div>
          );
        })}
      </div>

      {/* live ticker */}
      {events.length > 0 && (
        <div className="nj-num mt-1.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-[10px] text-[var(--nj-text-faint)]">
          <span className="shrink-0 rounded px-1.5 py-px" style={{ color: 'var(--nj-accent)', background: 'var(--nj-glass)' }}>/ws</span>
          {events.slice(0, 5).map((e, i) => (
            <span key={(e.at ?? 0) + '-' + i} className="shrink-0">
              <span style={{ color: 'var(--nj-text-muted)' }}>{e.stage}</span>
              {e.label && <span style={{ color: 'var(--nj-good)' }}> {e.label}</span>}
              {e.confidence != null && <span> {(e.confidence * 100).toFixed(0)}%</span>}
              {i < 4 && <span className="px-1 opacity-40">·</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
