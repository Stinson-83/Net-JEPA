import { Activity } from 'lucide-react';
import { useStore, PIPELINE_STAGES } from '../../state/store';
import PipelineGraph from './PipelineGraph';
import LiveStream from './LiveStream';

type Status = 'idle' | 'running' | 'complete';

const STATUS_STYLE: Record<Status, { border: string; text: string }> = {
  idle: { border: 'var(--nj-border)', text: 'var(--nj-text-faint)' },
  running: { border: 'var(--nj-accent)', text: 'var(--nj-accent)' },
  complete: { border: 'var(--nj-good)', text: 'var(--nj-good)' },
};

/**
 * Right-rail panel (≈45% of the rail height): the always-visible pipeline
 * stepper plus a status pill and — before the first injection — a CTA
 * inviting the viewer to feed it a .pcap. The diagram itself never depends on
 * whether anything has been injected; it simply sits "pending" until then.
 */
export default function PipelineTheatre() {
  const playing = useStore((s) => s.pipelinePlaying);
  const stageIndex = useStore((s) => s.pipelineStageIndex);
  const sessions = useStore((s) => s.sessions);
  const autoDemo = useStore((s) => s.autoDemo);
  const collapsed = useStore((s) => s.theatreCollapsed);
  const setCollapsed = useStore((s) => s.setTheatreCollapsed);
  const openModal = useStore((s) => s.openModal);

  const status: Status = playing ? 'running' : stageIndex === PIPELINE_STAGES.length - 1 ? 'complete' : 'idle';
  const style = STATUS_STYLE[status];

  // Auto-collapse when idle if auto-demo is off
  if (!playing && !autoDemo && !collapsed && sessions.length === 0) {
    // Only auto-collapse once to not fight the user
  }

  return (
    <div 
      className="flex h-full flex-col rounded-lg border border-[var(--nj-border)] bg-[var(--nj-surface)] transition-all overflow-hidden"
      style={{
        padding: collapsed ? '0 12px' : '12px',
        cursor: collapsed ? 'pointer' : 'default',
      }}
      onClick={() => collapsed && setCollapsed(false)}
    >
      <header className="flex h-12 shrink-0 items-center gap-2">
        <Activity size={13} className={playing ? 'animate-pulse text-[var(--nj-accent)]' : 'text-[var(--nj-text-dim)]'} />
        <h2 className="font-ui text-[11px] uppercase tracking-[0.2em] text-[var(--nj-text-dim)]">Pipeline Theatre</h2>
        {collapsed && (
          <div className="ml-2 flex items-center gap-1.5 text-[var(--nj-text-faint)]">
            {PIPELINE_STAGES.map((_, i) => (
              <span key={i} className="text-[14px] leading-none">●</span>
            ))}
          </div>
        )}

        {!collapsed && (
          <span
            className="ml-auto rounded-full border px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider transition-colors duration-300"
            style={{ borderColor: style.border, color: style.text }}
          >
            {status}
          </span>
        )}
        
        {!collapsed && !autoDemo && !playing && (
          <button 
            onClick={(e) => { e.stopPropagation(); setCollapsed(true); }}
            className="ml-2 px-1 font-mono text-[9px] text-[var(--nj-text-faint)] hover:text-[var(--nj-text-dim)] uppercase tracking-widest border border-transparent hover:border-[var(--nj-border)] rounded-sm transition-colors"
          >
            collapse
          </button>
        )}
      </header>
      {!collapsed && (
        <div className="nj-scroll min-h-0 flex-1 overflow-y-auto pr-1">
        <PipelineGraph />
        <LiveStream />
        {sessions.length === 0 && (
          <button
            onClick={openModal}
            className="mt-2 shrink-0 cursor-pointer rounded-md border border-dashed border-[var(--nj-border)] px-2.5 py-1.5 text-left font-mono text-[9px] leading-relaxed text-[var(--nj-text-faint)] transition-colors hover:border-[var(--nj-accent)]/50 hover:text-[var(--nj-text-dim)]"
          >
            Inject a .pcap to watch a flow travel through every stage, live →
          </button>
        )}
        </div>
      )}
    </div>
  );
}
