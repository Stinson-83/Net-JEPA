import { TrendingDown, Grid3x3, ShieldCheck } from 'lucide-react';
import { useStore, type MetricsTab } from '../../state/store';
import CurvesPanel from './CurvesPanel';
import ConfusionPanel from './ConfusionPanel';
import RobustnessPanel from './RobustnessPanel';

const TABS: { id: MetricsTab; label: string; icon: typeof TrendingDown }[] = [
  { id: 'curves', label: 'Curves', icon: TrendingDown },
  { id: 'confusion', label: 'Confusion', icon: Grid3x3 },
  { id: 'robustness', label: 'Robustness', icon: ShieldCheck },
];

/** Right-rail panel (≈25% of the rail height): tabbed training/evaluation telemetry. */
export default function Metrics() {
  const tab = useStore((s) => s.metricsTab);
  const setTab = useStore((s) => s.setMetricsTab);

  const hasActiveContent = false; // Training tab is global, not flow-specific, so it's always "inactive" in terms of selection highlights, but we give it the same header treatment.

  return (
    <div 
      className="relative flex h-full flex-col rounded-lg border border-[var(--nj-border)] bg-[var(--nj-surface)] p-3 pt-6 transition-all duration-300"
      style={{
        filter: 'saturate(0.85)',
      }}
    >
      {/* Corner bracket header */}
      <div className="nj-bracket nj-bracket-active pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-1.5 px-1.5 py-0.5">
        <span className="font-ui text-[9px] uppercase tracking-[0.22em] text-[var(--nj-text-faint)]">
          Training
        </span>
      </div>

      <div className="mb-2 mt-2 flex shrink-0 gap-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
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
            </button>
          );
        })}
      </div>
      <div className="nj-scroll min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === 'curves' && <CurvesPanel />}
        {tab === 'confusion' && <ConfusionPanel />}
        {tab === 'robustness' && <RobustnessPanel />}
      </div>
    </div>
  );
}
