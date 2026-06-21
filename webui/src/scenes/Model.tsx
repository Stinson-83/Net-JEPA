import { useState } from 'react';
import { Panel, cx } from '../ui/primitives';
import { IconCpu, IconShield, IconZap, IconSparkle } from '../ui/icons';
import ProofLab from '../panels/ProofLab';

type Mode = 'eli5' | 'math';

interface Block { id: string; label: string; sub: string; eli5: string; math: string; tone?: string; }

const B: Record<string, Block> = {
  deg: { id: 'deg', label: 'Degraded view', sub: 'augmented input', tone: '#f637ec',
    eli5: 'We deliberately rough up a copy of the flow — shift timings, drop a burst — so the model learns the essence, not the noise.',
    math: 'Augmentation: RTT scaling α∼U(0.5,1.5), time-shift, packet-loss windows applied to the online input only.' },
  temporal: { id: 'temporal', label: 'Temporal encoder', sub: '4× Transformer', tone: '#22d3ee',
    eli5: 'Reads the packet sequence in order — like reading the rhythm of a song to know the genre.',
    math: 'Linear(9→128) + sinusoidal PE → 4 pre-norm Transformer layers, d=128, 4 heads, over the 64×9 packet matrix.' },
  fusion: { id: 'fusion', label: 'Context fusion', sub: 'cross-attention', tone: '#22d3ee',
    eli5: 'Mixes per-packet detail with whole-flow facts (duration, rates) so context shapes the reading.',
    math: 'Cross-attention: packet tokens = Q, flow-context vector = K,V → context-enriched per-packet latents.' },
  mask: { id: 'mask', label: 'Adaptive mask', sub: 'hide 30–50%', tone: '#a78bfa',
    eli5: 'We hide chunks of the flow and ask the model to imagine what was there — that\'s how it learns without labels.',
    math: 'Mask 30% (short) / 50% (long) of token positions; the predictor must reconstruct their target latents.' },
  predictor: { id: 'predictor', label: 'Predictor', sub: '3× Transformer', tone: '#a78bfa',
    eli5: 'Fills in the hidden parts from what it can see.',
    math: 'concat(visible, sinusoidal PE[masked]) → 3 Transformer layers → predicted latents at masked positions.' },
  clean: { id: 'clean', label: 'Clean view', sub: 'EMA target', tone: '#4ade80',
    eli5: 'A pristine copy of the same flow is the "answer key" — but a slow-moving one, so it can\'t be gamed.',
    math: 'Target branch sees the un-degraded flow; weights are an EMA of the online encoder (momentum 0.99→0.999).' },
  ema: { id: 'ema', label: 'EMA encoder', sub: 'stop-gradient', tone: '#4ade80',
    eli5: 'Same network, frozen and lagging — gives a stable target so the model can\'t collapse to a trivial answer.',
    math: 'θ_target ← m·θ_target + (1−m)·θ_online ; stop-grad. Prevents representation collapse without negatives.' },
  vicreg: { id: 'vicreg', label: 'VICReg loss', sub: 'invariance·variance·covariance', tone: '#4fd6ff',
    eli5: 'Three rules: predictions match the answer key, stay diverse, and don\'t repeat themselves.',
    math: 'L = 25·MSE(pred,target) + 25·hinge-variance + 1·off-diag-covariance. Variance term blocks collapse.' },
  pool: { id: 'pool', label: 'Attention pool', sub: 'learned query', tone: '#fbbf24',
    eli5: 'Squeezes the whole flow into one vector by asking "which packets matter most?"',
    math: 'A learned query attends over the 64 packet latents → a single 128-d flow vector ⊕ raw context.' },
  embed: { id: 'embed', label: 'Embedding head', sub: '→ 128-d sphere', tone: '#fbbf24',
    eli5: 'Maps every flow to a point on a sphere, trained so same-class points point the same way.',
    math: 'MLP(143→256→128) → L2-normalise. Supervised contrastive (SupCon) on category labels shapes the directions.' },
  center: { id: 'center', label: 'α-centering', sub: 'isotropise', tone: '#f97316',
    eli5: 'Removes a shared "common direction" so the cosine actually reflects class — the trick that hit the KPI.',
    math: 'emb ← normalize(emb − α·μ), α≈0.65. Unfolds the embedding cone so inter-class cosine drops below 0.3.' },
  knn: { id: 'knn', label: 'Cosine k-NN', sub: '→ class', tone: '#f97316',
    eli5: 'A new flow is whatever its nearest neighbours are — no heavy classifier needed.',
    math: 'k=5 cosine k-NN over the labelled embedding index → category + confidence, in ~3 ms on CPU.' },
};

function BlockCard({ b, active, onHover, mode }: { b: Block; active: boolean; onHover: (id: string | null) => void; mode: Mode }) {
  return (
    <button onMouseEnter={() => onHover(b.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(b.id)}
      className={cx('group relative min-w-[112px] rounded-[11px] px-3 py-2 text-left transition-all', active && 'scale-[1.05]')}
      style={{
        background: active ? `${b.tone}1c` : 'var(--nj-glass)',
        border: `1px solid ${active ? b.tone : 'var(--nj-border)'}`,
        boxShadow: active ? `0 0 26px -8px ${b.tone}` : 'none',
      }}>
      <div className="text-[12px] font-semibold" style={{ color: active ? b.tone : 'var(--nj-text)' }}>{b.label}</div>
      <div className="mt-0.5 text-[9.5px] text-[var(--nj-text-faint)]">{mode === 'math' ? b.sub : b.sub}</div>
    </button>
  );
}

const Arrow = () => <span className="shrink-0 px-1 text-[var(--nj-text-faint)]">→</span>;

export default function Model() {
  const [hover, setHover] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('eli5');
  const active = hover ? B[hover] : null;
  const row = (ids: string[]) => (
    <div className="flex flex-wrap items-center gap-1">
      {ids.map((id, i) => (
        <span key={id} className="flex items-center">
          <BlockCard b={B[id]} active={hover === id} onHover={setHover} mode={mode} />
          {i < ids.length - 1 && <Arrow />}
        </span>
      ))}
    </div>
  );

  return (
    <div className="nj-scroll h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-[1180px]">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--nj-text-faint)]">Architecture</div>
            <h1 className="nj-display mt-1 text-[26px] font-bold text-[var(--nj-text-bright)]">A model that teaches itself</h1>
            <p className="mt-1 max-w-2xl text-[12.5px] text-[var(--nj-text-muted)]">
              Net-JEPA is a Joint-Embedding Predictive Architecture: it learns the structure of traffic by predicting <em>hidden parts of a flow</em> — no labels, no decryption. Labels only fine-tune the final embedding.
            </p>
          </div>
          <div className="flex rounded-full p-1 nj-glass-soft">
            {(['eli5', 'math'] as Mode[]).map((md) => (
              <button key={md} onClick={() => setMode(md)}
                className={cx('rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors', mode === md ? 'text-[var(--nj-text-bright)]' : 'text-[var(--nj-text-muted)]')}
                style={mode === md ? { background: 'var(--nj-glass-hi)', border: '1px solid var(--nj-border-hi)' } : undefined}>
                {md === 'eli5' ? 'Explain simply' : 'Show the math'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
          <Panel className="p-4">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#f637ec' }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#f637ec' }} /> Online branch
            </div>
            {row(['deg', 'temporal', 'fusion', 'mask', 'predictor'])}

            <div className="my-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#4ade80' }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#4ade80' }} /> Target branch (EMA · stop-grad)
            </div>
            {row(['clean', 'ema'])}

            <div className="my-3 flex justify-center">
              <BlockCard b={B.vicreg} active={hover === 'vicreg'} onHover={setHover} mode={mode} />
            </div>

            <div className="my-2 h-px w-full" style={{ background: 'var(--nj-border)' }} />
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#fbbf24' }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#fbbf24' }} /> Downstream (frozen encoder)
            </div>
            {row(['pool', 'embed', 'center', 'knn'])}
          </Panel>

          {/* explanation panel */}
          <Panel className="flex flex-col p-4" glow={active?.tone}>
            {active ? (
              <div className="nj-rise">
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: active.tone }}>{active.label}</div>
                <div className="mt-2 text-[13px] leading-relaxed text-[var(--nj-text)]">
                  {mode === 'eli5' ? active.eli5 : active.math}
                </div>
              </div>
            ) : (
              <div className="text-[12.5px] leading-relaxed text-[var(--nj-text-muted)]">
                <span className="text-[var(--nj-text)]">Hover any block</span> to see what it does — toggle between a plain-English explanation and the actual math.
              </div>
            )}
            <div className="mt-auto grid grid-cols-1 gap-2 pt-4">
              {[
                { icon: IconShield, t: 'Zero decryption', d: 'Only packet metadata — sizes, timing, direction.' },
                { icon: IconCpu, t: 'Self-supervised', d: 'Learns from 13k unlabelled flows before any labels.' },
                { icon: IconZap, t: '~3 ms / flow', d: 'Real-time on CPU. No GPU required to serve.' },
                { icon: IconSparkle, t: 'Anti-collapse', d: 'EMA target + VICReg variance keep it from cheating.' },
              ].map((c) => {
                const Ic = c.icon;
                return (
                  <div key={c.t} className="flex items-start gap-2.5 rounded-[var(--nj-r-sm)] p-2.5 nj-glass-soft">
                    <span className="mt-0.5 text-[var(--nj-accent)]"><Ic size={15} /></span>
                    <div><div className="text-[11.5px] font-semibold text-[var(--nj-text)]">{c.t}</div><div className="text-[10.5px] text-[var(--nj-text-faint)]">{c.d}</div></div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* Proof Lab — verify the problem-statement KPIs on uploaded captures */}
        <div className="mt-3">
          <ProofLab />
        </div>
      </div>
    </div>
  );
}
