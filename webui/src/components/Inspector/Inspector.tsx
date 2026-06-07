import { Crosshair, Radar, BarChart3 } from 'lucide-react';
import { useStore, type InspectorTab } from '../../state/store';
import SelectedFlowPanel from './SelectedFlowPanel';
import InjectedFlowPanel from './InjectedFlowPanel';
import ClassStatsPanel from './ClassStatsPanel';

const TABS: { id: InspectorTab; label: string; icon: typeof Crosshair }[] = [
  { id: 'selected', label: 'Selected', icon: Crosshair },
  { id: 'injected', label: 'Injected', icon: Radar },
  { id: 'classStats', label: 'Class Stats', icon: BarChart3 },
];

/** Right-rail panel (≈30% of the rail height): tabbed flow/class detail views. */
export default function Inspector() {
  const tab = useStore((s) => s.inspectorTab);
  const setTab = useStore((s) => s.setInspectorTab);
  const sessionCount = useStore((s) => s.sessions.length);

  const hasActiveContent = (tab === 'selected' && useStore((s) => s.selectedFlowId !== null)) || 
                           (tab === 'injected' && useStore((s) => s.activeSessionId !== null));

  return (
    <div 
      className="relative flex h-full flex-col rounded-lg border bg-[var(--nj-surface)] p-3 pt-6 transition-all duration-300"
      style={{
        borderColor: hasActiveContent ? 'var(--nj-accent)' : 'var(--nj-border)',
        boxShadow: hasActiveContent ? 'inset 0 0 0 1px rgba(125,211,252,0.1)' : 'none',
        filter: hasActiveContent ? 'saturate(1)' : 'saturate(0.7)',
      }}
    >
      {/* Corner bracket header */}
      <div className="nj-bracket nj-bracket-active pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-1.5 px-1.5 py-0.5">
        <span className="font-ui text-[9px] uppercase tracking-[0.22em] text-[var(--nj-text-faint)]">
          Inspector
        </span>
        {hasActiveContent && (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--nj-accent)] shadow-[0_0_6px_var(--nj-accent)]" />
        )}
      </div>

      <div className="mb-2 mt-2 flex shrink-0 gap-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          const badge = id === 'injected' && sessionCount > 0 ? sessionCount : null;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 font-ui text-[10px] uppercase tracking-wider transition-colors ${
                active ? 'bg-white/[0.06] text-[var(--nj-text-bright)]' : 'text-[var(--nj-text-faint)] hover:text-[var(--nj-text-dim)]'
              }`}
            >
              <Icon size={11} />
              {label}
              {badge !== null && (
                <span className="rounded-full bg-[var(--nj-accent)]/15 px-1 font-mono text-[8px] text-[var(--nj-accent)]">{badge}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="nj-scroll min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === 'selected' && <SelectedFlowPanel />}
        {tab === 'injected' && <InjectedFlowPanel />}
        {tab === 'classStats' && <ClassStatsPanel />}
      </div>
    </div>
  );
}
