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

  return (
    <div className="flex h-full flex-col rounded-lg border border-[var(--nj-border)] bg-[var(--nj-surface)] p-3">
      <div className="mb-2 flex shrink-0 gap-1">
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
      <div className="min-h-0 flex-1">
        {tab === 'curves' && <CurvesPanel />}
        {tab === 'confusion' && <ConfusionPanel />}
        {tab === 'robustness' && <RobustnessPanel />}
      </div>
    </div>
  );
}
