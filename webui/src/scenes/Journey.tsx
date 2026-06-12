import { Panel } from '../ui/primitives';

interface Step { tag: string; title: string; body: string; color: string; before?: string; after?: string; metric?: string; }

const STEPS: Step[] = [
  { tag: 'The bug', color: '#ff5d7a', title: 'The unsupervised signal was training on noise',
    body: 'The DBSCAN pseudo-label loss keyed cluster labels by batch position, not by flow — pairing every sample with the wrong label. A silent, load-bearing bug.', metric: 'fixed the mapping' },
  { tag: 'The insight', color: '#a78bfa', title: 'Self-supervision gives compactness, not margin',
    body: 'JEPA learned tight same-class blobs, but classes overlapped. Pulling them apart needs a supervised signal — labels, used sparingly.', metric: 'pivot to SupCon' },
  { tag: 'The fix', color: '#22d3ee', title: 'Supervised contrastive on the right label level',
    body: 'SupCon on the kept embedding, supervised at the category level (Youtube & Netflix are the same class), widened the margins the classifier needs.', before: 'silhouette −0.07', after: '+0.53' },
  { tag: 'The wall', color: '#fbbf24', title: 'Separated — but cosine stayed stuck at 0.7',
    body: 'Clusters separated by direction, yet sat in a shared cone, so absolute inter-class cosine wouldn\'t fall. A classic anisotropy trap.', metric: 'inter-cos pinned ~0.71' },
  { tag: 'The breakthrough', color: '#4ade80', title: 'α-centering isotropised the space',
    body: 'Subtracting a fraction of the common-mode direction (α≈0.65) unfolded the cone. Inter-class cosine fell below the KPI while intra stayed high.', before: 'inter 0.71', after: '0.13' },
  { tag: 'The imbalance', color: '#f97316', title: 'Rescuing the starved class',
    body: 'Video-conferencing had 65 flows and F1 of zero. Class-balanced SupCon plus folding in real MS Teams captures from a second dataset brought it back.', before: 'F1 0.00', after: '0.87' },
  { tag: 'The honest test', color: '#ff5d7a', title: 'Train on Kaggle, test on a foreign domain',
    body: 'On a completely separate 5G testbed (VLC/Valencia), accuracy collapsed to 5%. The embedding learned domain-specific cues. We reported it, not buried it.', before: 'in-domain 92%', after: 'cross 5%' },
  { tag: 'The path forward', color: '#4fd6ff', title: 'Domain adaptation closes part of the gap',
    body: 'A gradient-reversal domain discriminator (DANN) plus a handful of labelled target flows lifts cross-domain transfer — the realistic route to a new network.', before: '5%', after: '39%' },
];

export default function Journey() {
  return (
    <div className="nj-scroll h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-[820px]">
        <div className="mb-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--nj-text-faint)]">Research log</div>
          <h1 className="nj-display mt-1 text-[26px] font-bold text-[var(--nj-text-bright)]">How it actually went</h1>
          <p className="mt-1 text-[12.5px] text-[var(--nj-text-muted)]">Eight turning points — bugs, dead ends, and the fixes that hit every KPI. The honest version.</p>
        </div>

        <div className="relative pl-7">
          <div className="absolute bottom-2 left-[9px] top-2 w-px" style={{ background: 'linear-gradient(var(--nj-border), var(--nj-border))' }} />
          <div className="flex flex-col gap-3">
            {STEPS.map((s, i) => (
              <div key={i} className="relative nj-rise" style={{ animationDelay: `${i * 60}ms` }}>
                <span className="absolute -left-[26px] top-3 grid h-[18px] w-[18px] place-items-center rounded-full"
                  style={{ background: '#04060d', border: `2px solid ${s.color}`, boxShadow: `0 0 14px -2px ${s.color}` }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                </span>
                <Panel className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider"
                      style={{ color: s.color, background: `${s.color}18`, border: `1px solid ${s.color}33` }}>{s.tag}</span>
                    {s.before && s.after && (
                      <span className="nj-num flex items-center gap-1.5 text-[11px]">
                        <span className="text-[var(--nj-text-faint)]">{s.before}</span>
                        <span style={{ color: s.color }}>→</span>
                        <span className="font-semibold" style={{ color: s.color }}>{s.after}</span>
                      </span>
                    )}
                    {s.metric && !s.before && <span className="nj-num text-[11px] text-[var(--nj-text-faint)]">{s.metric}</span>}
                  </div>
                  <h3 className="mt-2 text-[14.5px] font-semibold text-[var(--nj-text-bright)]">{s.title}</h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--nj-text-muted)]">{s.body}</p>
                </Panel>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-[var(--nj-r)] p-5 text-center nj-glass">
          <div className="nj-display text-[16px] font-bold text-[var(--nj-text-bright)]">Every benchmark KPI met — and the limits named out loud.</div>
          <div className="mt-1.5 text-[11.5px] text-[var(--nj-text-faint)]">intra 0.83 · inter 0.13 · accuracy 92.6% · few-shot 92% · ~3 ms/flow</div>
        </div>
      </div>
    </div>
  );
}
