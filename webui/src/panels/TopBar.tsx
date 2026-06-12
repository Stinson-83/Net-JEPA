import { useStore } from '../app/store';
import type { Scene } from '../app/store';
import { cx } from '../ui/primitives';
import { IconLayers, IconCpu, IconTarget, IconBook } from '../ui/icons';

const SCENES: { id: Scene; label: string; icon: React.FC<{ size?: number }> }[] = [
  { id: 'atlas', label: 'Atlas', icon: IconLayers },
  { id: 'model', label: 'Model', icon: IconCpu },
  { id: 'proof', label: 'Proof', icon: IconTarget },
  { id: 'journey', label: 'Journey', icon: IconBook },
];

function Kpi({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex flex-col items-end leading-none">
      <span className="nj-num text-[13px] font-semibold" style={{ color: ok ? 'var(--nj-good)' : 'var(--nj-text-bright)' }}>{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-[var(--nj-text-faint)]">{label}</span>
    </div>
  );
}

export default function TopBar() {
  const scene = useStore((s) => s.scene);
  const setScene = useStore((s) => s.setScene);
  const metrics = useStore((s) => s.bundle?.metrics ?? null);
  const serverLive = useStore((s) => s.serverLive);
  const liveConnected = useStore((s) => s.liveConnected);

  const online = serverLive || liveConnected;

  return (
    <header className="relative z-30 flex h-[60px] shrink-0 items-center gap-4 px-5">
      {/* wordmark */}
      <button onClick={() => setScene('atlas')} className="group flex items-center gap-3">
        <div className="relative grid h-9 w-9 place-items-center rounded-[11px]"
          style={{ background: 'linear-gradient(140deg, #4fd6ff22, #7c5cff22)', border: '1px solid var(--nj-border-hi)' }}>
          <span className="absolute inset-0 rounded-[11px]" style={{ boxShadow: 'inset 0 0 16px -4px var(--nj-accent-glow)' }} />
          <NetGlyph />
        </div>
        <div className="leading-none">
          <div className="nj-display text-[15px] font-bold tracking-tight">
            <span className="nj-sheen">NET-JEPA</span>
          </div>
          <div className="text-[10px] tracking-wide text-[var(--nj-text-faint)]">The shape of encrypted traffic</div>
        </div>
      </button>

      {/* scene tabs */}
      <nav className="ml-3 flex items-center gap-1 rounded-full p-1 nj-glass-soft">
        {SCENES.map((s) => {
          const Icon = s.icon;
          const active = scene === s.id;
          return (
            <button key={s.id} onClick={() => setScene(s.id)}
              className={cx('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
                active ? 'text-[var(--nj-text-bright)]' : 'text-[var(--nj-text-muted)] hover:text-[var(--nj-text)]')}
              style={active ? { background: 'var(--nj-glass-hi)', border: '1px solid var(--nj-border-hi)' } : undefined}>
              <Icon size={14} /> {s.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* live KPIs */}
      {metrics && (
        <div className="hidden items-center gap-5 lg:flex">
          <Kpi label="Accuracy" value={`${(metrics.accuracy * 100).toFixed(1)}%`} ok={metrics.accuracy >= 0.9} />
          <Kpi label="Inter-cos" value={metrics.inter_class_cos.toFixed(2)} ok={metrics.inter_class_cos < 0.3} />
          <Kpi label="Latency" value={`${metrics.latency_ms_cpu.toFixed(1)}ms`} ok={metrics.latency_ms_cpu < 100} />
          <div className="h-7 w-px" style={{ background: 'var(--nj-border)' }} />
        </div>
      )}

      {/* server status */}
      <div className="flex items-center gap-2 rounded-full px-3 py-1.5 nj-glass-soft">
        <span className="relative flex h-2 w-2">
          {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: 'var(--nj-good)' }} />}
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: online ? 'var(--nj-good)' : 'var(--nj-text-faint)' }} />
        </span>
        <span className="text-[11px] font-medium" style={{ color: online ? 'var(--nj-good)' : 'var(--nj-text-muted)' }}>
          {online ? 'LIVE MODEL' : 'STATIC'}
        </span>
      </div>

      {/* hackathon badge */}
      <div className="hidden items-center gap-2 rounded-full px-3 py-1.5 nj-glass-soft md:flex">
        <span className="text-[10px] font-semibold tracking-wide" style={{ color: '#7cc4ff' }}>SAMSUNG</span>
        <span className="text-[10px] tracking-wide text-[var(--nj-text-faint)]">EnnovateX ’26</span>
      </div>
    </header>
  );
}

function NetGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="2" fill="var(--nj-accent)" />
      <circle cx="18" cy="7" r="1.6" fill="var(--nj-accent-2)" />
      <circle cx="7" cy="18" r="1.6" fill="#f637ec" />
      <circle cx="17" cy="17" r="2.2" fill="#4ade80" />
      <path d="M6 6 18 7M6 6 7 18M18 7 17 17M7 18 17 17M6 6 17 17" stroke="var(--nj-border-hi)" strokeWidth="1" />
    </svg>
  );
}
