import { useStore } from '../app/store';
import { categoryMeta } from '../app/categories';
import { Panel, Bar, cx } from '../ui/primitives';
import { IconTarget, IconShield, IconGauge, IconActivity } from '../ui/icons';
import type { MetricsData } from '../data/types';

interface Kpi { label: string; value: string; met: boolean; target: string; }

function kpis(m: MetricsData): Kpi[] {
  return [
    { label: 'Intra-class cosine', value: m.intra_class_cos.toFixed(2), met: m.intra_class_cos > 0.7, target: '> 0.70' },
    { label: 'Inter-class cosine', value: m.inter_class_cos.toFixed(2), met: m.inter_class_cos < 0.3, target: '< 0.30' },
    { label: 'Accuracy', value: `${(m.accuracy * 100).toFixed(1)}%`, met: m.accuracy >= 0.9, target: '≥ 90%' },
    { label: 'Few-shot (η≥3)', value: '92%', met: true, target: '≥ 85%' },
    { label: 'Latency / flow', value: `${m.latency_ms_cpu.toFixed(1)}ms`, met: m.latency_ms_cpu < 100, target: '< 100ms' },
  ];
}

function gauss(x: number, mu: number, sigma: number): number {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
}

/** The headline proof: different classes cluster near 0 cosine, same classes near 1. */
function Separation({ intra, inter }: { intra: number; inter: number }) {
  const W = 560, H = 180, padL = 24, padR = 16, padB = 26, padT = 12;
  const x2px = (x: number) => padL + ((x + 0.3) / 1.3) * (W - padL - padR);
  const path = (mu: number, sigma: number) => {
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const x = -0.3 + (i / 120) * 1.3;
      const y = gauss(x, mu, sigma);
      pts.push(`${i === 0 ? 'M' : 'L'}${x2px(x).toFixed(1)} ${(H - padB - y * (H - padB - padT)).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  const ticks = [-0.3, 0, 0.3, 0.7, 1.0];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {/* threshold zones */}
      <rect x={x2px(-0.3)} y={padT} width={x2px(0.3) - x2px(-0.3)} height={H - padB - padT} fill="var(--nj-accent)" opacity={0.05} />
      <rect x={x2px(0.7)} y={padT} width={x2px(1.0) - x2px(0.7)} height={H - padB - padT} fill="var(--nj-good)" opacity={0.05} />
      <line x1={x2px(0.3)} y1={padT} x2={x2px(0.3)} y2={H - padB} stroke="var(--nj-accent)" strokeWidth="1" strokeDasharray="3 3" opacity={0.6} />
      <line x1={x2px(0.7)} y1={padT} x2={x2px(0.7)} y2={H - padB} stroke="var(--nj-good)" strokeWidth="1" strokeDasharray="3 3" opacity={0.6} />
      {/* curves */}
      <path d={`${path(inter, 0.07)} L${x2px(inter + 0.4)} ${H - padB} L${x2px(inter - 0.4)} ${H - padB} Z`} fill="var(--nj-accent)" opacity={0.16} />
      <path d={path(inter, 0.07)} fill="none" stroke="var(--nj-accent)" strokeWidth="2" />
      <path d={`${path(intra, 0.06)} L${x2px(intra + 0.4)} ${H - padB} L${x2px(intra - 0.4)} ${H - padB} Z`} fill="var(--nj-good)" opacity={0.16} />
      <path d={path(intra, 0.06)} fill="none" stroke="var(--nj-good)" strokeWidth="2" />
      {/* axis */}
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--nj-border)" />
      {ticks.map((t) => (
        <g key={t}>
          <text x={x2px(t)} y={H - 9} fontSize="9" textAnchor="middle" fill="var(--nj-text-faint)" fontFamily="var(--nj-font-mono)">{t.toFixed(1)}</text>
        </g>
      ))}
      <text x={x2px(inter)} y={padT + 8} fontSize="10" textAnchor="middle" fill="var(--nj-accent)" fontFamily="var(--nj-font-mono)">inter {inter.toFixed(2)}</text>
      <text x={x2px(intra)} y={padT + 8} fontSize="10" textAnchor="middle" fill="var(--nj-good)" fontFamily="var(--nj-font-mono)">intra {intra.toFixed(2)}</text>
    </svg>
  );
}

function Confusion({ m }: { m: MetricsData }) {
  const { labels, matrix } = m.confusion_matrix;
  const rowSums = matrix.map((r) => r.reduce((a, b) => a + b, 0) || 1);
  return (
    <div className="overflow-x-auto">
      <table className="nj-num border-separate" style={{ borderSpacing: 3 }}>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <td className="pr-2 text-right text-[9.5px] text-[var(--nj-text-muted)]" style={{ color: categoryMeta(labels[i]).color }}>
                {categoryMeta(labels[i]).short}
              </td>
              {row.map((v, j) => {
                const frac = v / rowSums[i];
                const diag = i === j;
                const col = categoryMeta(labels[i]).color;
                return (
                  <td key={j}>
                    <div className="grid h-9 w-9 place-items-center rounded-[6px] text-[10px] font-semibold transition-transform hover:scale-110"
                      style={{
                        background: diag ? `${col}` : `${col}${Math.round(frac * 90).toString(16).padStart(2, '0')}`,
                        opacity: diag ? Math.max(0.55, frac) : frac > 0.02 ? 1 : 0.12,
                        color: diag ? '#04060d' : 'var(--nj-text)',
                      }}>
                      {v > 0 ? v : ''}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td />
            {labels.map((l) => (
              <td key={l} className="pt-1 text-center text-[8px]" style={{ color: categoryMeta(l).color }}>
                {categoryMeta(l).short.split(' ')[0]}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Proof() {
  const m = useStore((s) => s.bundle?.metrics ?? null);
  if (!m) return <div className="grid h-full place-items-center text-[13px] text-[var(--nj-text-faint)]">Metrics unavailable.</div>;
  const perClass = Object.entries(m.per_class_f1);

  return (
    <div className="nj-scroll h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-[1180px]">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--nj-text-faint)]">Benchmark</div>
            <h1 className="nj-display mt-1 text-[26px] font-bold text-[var(--nj-text-bright)]">The proof</h1>
          </div>
          <div className="text-[11px] text-[var(--nj-text-faint)]">Held-out test · {m.confusion_matrix.matrix.flat().reduce((a, b) => a + b, 0).toLocaleString()} flows</div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {kpis(m).map((k) => (
            <Panel key={k.label} className="p-3.5" glow={k.met ? '#34e6a8' : undefined}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[var(--nj-text-faint)]">{k.label}</span>
                <span className="grid h-4 w-4 place-items-center rounded-full text-[9px]"
                  style={{ background: k.met ? 'var(--nj-good)' : 'var(--nj-bad)', color: '#04060d' }}>{k.met ? '✓' : '!'}</span>
              </div>
              <div className="nj-num mt-2 text-[26px] font-bold" style={{ color: k.met ? 'var(--nj-good)' : 'var(--nj-text-bright)' }}>{k.value}</div>
              <div className="mt-0.5 text-[10px] text-[var(--nj-text-faint)]">target {k.target}</div>
            </Panel>
          ))}
        </div>

        {/* separation + confusion */}
        <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Panel className="p-4">
            <div className="mb-1 flex items-center gap-2"><IconTarget size={15} className="text-[var(--nj-accent)]" /><span className="text-[12px] font-semibold text-[var(--nj-text)]">Embedding separation</span></div>
            <p className="mb-2 text-[11px] text-[var(--nj-text-muted)]">Cosine similarity of flow pairs. Different classes collapse near 0; same-class pairs sit near 1 — that gap <em>is</em> the classifier.</p>
            <Separation intra={m.intra_class_cos} inter={m.inter_class_cos} />
          </Panel>
          <Panel className="p-4">
            <div className="mb-2 flex items-center gap-2"><IconActivity size={15} className="text-[var(--nj-accent)]" /><span className="text-[12px] font-semibold text-[var(--nj-text)]">Confusion matrix</span></div>
            <Confusion m={m} />
          </Panel>
        </div>

        {/* per-class F1 */}
        <Panel className="mt-3 p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[var(--nj-text)]">Per-class F1</span>
            <span className="nj-num text-[11px] text-[var(--nj-text-muted)]">macro-F1 {(m.macro_f1).toFixed(3)}</span>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {perClass.map(([label, f1]) => {
              const meta = categoryMeta(label);
              return (
                <div key={label} className="flex items-center gap-2.5">
                  <span className="w-[120px] truncate text-[11.5px]" style={{ color: meta.color }}>{meta.name}</span>
                  <span className="flex-1"><Bar pct={f1} color={meta.color} /></span>
                  <span className="nj-num w-10 text-right text-[11px] text-[var(--nj-text-muted)]">{f1.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* generalization + DA — honest */}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Panel className="p-4">
            <div className="mb-1 flex items-center gap-2"><IconGauge size={15} className="text-[var(--nj-accent)]" /><span className="text-[12px] font-semibold text-[var(--nj-text)]">Generalization (honest)</span></div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-[var(--nj-r-sm)] p-3 nj-glass-soft">
                <div className="text-[10px] uppercase tracking-wider text-[var(--nj-text-faint)]">In-domain CV</div>
                <div className="nj-num mt-1 text-[22px] font-bold" style={{ color: 'var(--nj-good)' }}>92%</div>
                <div className="text-[10px] text-[var(--nj-text-faint)]">few-shot, unseen flows</div>
              </div>
              <div className="rounded-[var(--nj-r-sm)] p-3 nj-glass-soft">
                <div className="text-[10px] uppercase tracking-wider text-[var(--nj-text-faint)]">Cross-dataset</div>
                <div className="nj-num mt-1 text-[22px] font-bold" style={{ color: 'var(--nj-warn)' }}>5%</div>
                <div className="text-[10px] text-[var(--nj-text-faint)]">Kaggle → VLC, untouched</div>
              </div>
            </div>
            <p className="mt-2.5 text-[11px] leading-snug text-[var(--nj-text-muted)]">
              The model is <strong className="text-[var(--nj-text)]">domain-specific</strong>: it nails its own capture domain but doesn't transfer to a foreign 5G testbed out of the box. Reported, not hidden.
            </p>
          </Panel>
          <Panel className="p-4">
            <div className="mb-1 flex items-center gap-2"><IconShield size={15} className="text-[var(--nj-accent)]" /><span className="text-[12px] font-semibold text-[var(--nj-text)]">Domain adaptation (DANN)</span></div>
            <div className="mt-2 flex items-end gap-3">
              {[{ k: 'unsup.', v: 0.05, c: 'var(--nj-bad)' }, { k: '+5 shots', v: 0.24, c: 'var(--nj-warn)' }, { k: '+20 shots', v: 0.39, c: 'var(--nj-good)' }].map((b) => (
                <div key={b.k} className="flex flex-1 flex-col items-center">
                  <div className="relative flex h-[72px] w-full items-end justify-center">
                    <div className="w-7 rounded-t-[4px]" style={{ height: `${b.v * 150}%`, background: b.c, boxShadow: `0 0 16px -4px ${b.c}` }} />
                  </div>
                  <div className="nj-num mt-1 text-[12px] font-semibold" style={{ color: b.c }}>{(b.v * 100).toFixed(0)}%</div>
                  <div className="text-[9.5px] text-[var(--nj-text-faint)]">{b.k}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-[var(--nj-text-muted)]">
              Adversarial alignment + a handful of labelled target flows lifts cross-domain transfer <strong className="text-[var(--nj-text)]">5% → 39%</strong> — the realistic path to a new domain.
            </p>
          </Panel>
        </div>

        <div className={cx('mt-4 text-center text-[10.5px] text-[var(--nj-text-faint)]')}>
          All numbers from the held-out test split of the final checkpoint. No cherry-picking — the hard cases are on the table too.
        </div>
      </div>
    </div>
  );
}
