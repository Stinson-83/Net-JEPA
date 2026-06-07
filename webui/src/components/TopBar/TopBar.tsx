import { useStore } from '../../state/store';
import KPIStrip from './KPIStrip';
import DatasetSwitcher from './DatasetSwitcher';
import InjectButton from './InjectButton';

/**
 * ~64px header: wordmark + version (left), live KPI strip (center),
 * dataset switcher + injection controls (right).
 */
export default function TopBar() {
  const modelVersion = useStore((s) => s.manifest?.model_version);

  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[var(--nj-border)] bg-[var(--nj-bg-raised)]/80 px-5 backdrop-blur-sm">
      {/* wordmark */}
      <div className="flex shrink-0 items-center gap-3">
        <div className="relative flex h-8 w-8 items-center justify-center rounded border border-[var(--nj-accent)]/40 bg-[var(--nj-accent)]/[0.07]">
          <span className="absolute inset-0 animate-pulse rounded bg-[var(--nj-accent)]/10" />
          <span className="relative font-mono text-[13px] font-bold text-[var(--nj-accent)]">N</span>
        </div>
        <div className="flex flex-col">
          <div className="flex items-baseline gap-2">
            <h1 className="font-display text-[15px] tracking-[0.18em] text-[var(--nj-text-bright)]">
              NET-JEP<span className="text-[110%] text-[var(--nj-accent)]">Δ</span>
            </h1>
            {modelVersion && (
              <span className="rounded-sm border border-[var(--nj-border)] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--nj-text-dim)]">
                {modelVersion}
              </span>
            )}
          </div>
          <span className="font-display text-[9px] uppercase tracking-[0.2em] text-[var(--nj-text-dim)]">
            (self-supervised)
          </span>
        </div>
      </div>

      {/* KPI strip */}
      <div className="hidden min-w-0 flex-1 items-center justify-center overflow-x-auto nj-scroll xl:flex">
        <KPIStrip />
      </div>

      {/* controls */}
      <div className="flex shrink-0 items-center gap-3">
        <AutoToggle />
        <div className="h-6 w-px bg-[var(--nj-border)]" />
        <DatasetSwitcher />
        <div className="h-6 w-px bg-[var(--nj-border)]" />
        <InjectButton />
      </div>
    </header>
  );
}

function AutoToggle() {
  const autoDemo = useStore((s) => s.autoDemo);
  const toggle = useStore((s) => s.toggleAutoDemo);
  return (
    <button
      onClick={toggle}
      className={[
        'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
        autoDemo
          ? 'border-[var(--nj-accent)]/40 bg-[var(--nj-accent)]/[0.08] text-[var(--nj-accent)]'
          : 'border-[var(--nj-border)] text-[var(--nj-text-faint)] hover:text-[var(--nj-text-dim)]',
      ].join(' ')}
      title={autoDemo ? 'Auto-demo is running — click to pause' : 'Auto-demo is paused — click to resume'}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${autoDemo ? 'animate-pulse bg-[var(--nj-accent)]' : 'bg-[var(--nj-text-faint)]'}`}
      />
      auto · {autoDemo ? 'on' : 'off'}
    </button>
  );
}
