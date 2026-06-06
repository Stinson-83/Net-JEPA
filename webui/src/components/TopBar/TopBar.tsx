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
        <div className="flex items-baseline gap-2">
          <h1 className="font-display text-[15px] tracking-[0.18em] text-[var(--nj-text-bright)]">NET-JEPA</h1>
          {modelVersion && (
            <span className="rounded-sm border border-[var(--nj-border)] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--nj-text-dim)]">
              {modelVersion}
            </span>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="hidden min-w-0 flex-1 items-center justify-center overflow-x-auto nj-scroll xl:flex">
        <KPIStrip />
      </div>

      {/* controls */}
      <div className="flex shrink-0 items-center gap-3">
        <DatasetSwitcher />
        <div className="h-6 w-px bg-[var(--nj-border)]" />
        <InjectButton />
      </div>
    </header>
  );
}
