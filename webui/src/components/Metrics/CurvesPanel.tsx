import { LineChart as LineChartIcon } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { useStore, EMPTY_CURVES } from '../../state/store';
import { EmptyState } from '../shared/EmptyState';

const SERIES = [
  { key: 'total_loss', label: 'Total', color: '#7dd3fc' },
  { key: 'jepa_loss', label: 'JEPA', color: '#22d3ee' },
  { key: 'vicreg_loss', label: 'VICReg', color: '#f637ec' },
  { key: 'contrastive_loss', label: 'Contrastive', color: '#fbbf24' },
] as const;

const AXIS_TICK = { fill: 'var(--nj-text-faint)', fontSize: 9, fontFamily: 'var(--nj-font-mono)' };

interface TooltipPayloadItem { dataKey: string; name?: string; value?: number | string; color?: string }
interface CurveTooltipProps { active?: boolean; label?: string | number; payload?: TooltipPayloadItem[] }

function CurveTooltip({ active, label, payload }: CurveTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-[var(--nj-border-hi)] bg-[var(--nj-surface-solid)]/95 px-2.5 py-1.5 font-mono text-[9px] backdrop-blur-md">
      <div className="mb-1 text-[var(--nj-text-faint)]">step {label}</div>
      {payload.map((p) => {
        const series = SERIES.find((s) => s.key === p.dataKey);
        return (
          <div key={p.dataKey} className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
            <span className="text-[var(--nj-text-dim)]">{series?.label ?? p.dataKey}</span>
            <span className="ml-auto pl-3 text-[var(--nj-text)]">{typeof p.value === 'number' ? p.value.toFixed(4) : p.value}</span>
          </div>
        );
      })}
    </div>
  );
}

/** "Curves" tab — multi-series loss decay over training steps. */
export default function CurvesPanel() {
  const curves = useStore((s) => s.bundle?.curves ?? EMPTY_CURVES);

  if (curves.length === 0) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="No training curves"
        body="Export training_curves.json (step, total/jepa/vicreg/contrastive loss) to chart loss decay across training."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curves} margin={{ top: 6, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--nj-border)" strokeDasharray="2 5" vertical={false} opacity={0.6} />
            <XAxis dataKey="step" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--nj-border)' }} minTickGap={28} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={34} />
            <Tooltip content={<CurveTooltip />} cursor={{ stroke: 'var(--nj-border-hi)' }} />
            {SERIES.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={1.4} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 px-1">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded-sm" style={{ background: s.color }} />
            <span className="font-mono text-[9px] text-[var(--nj-text-dim)]">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
