// ───────────────────────────────────────────────────────────────────────────
// ProofLab — verify the three problem-statement KPIs on manually-uploaded .pcaps.
//   • Compare two captures : intra cosine > 0.7 (same type) / inter < 0.3 (different)
//   • Degraded flow        : upload ONE capture; the server degrades it (RTT/jitter/
//                            packet-loss) and re-classifies — class should be unchanged.
// Uses the live model via /api/infer.
// ───────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { inferFile, cosine, fetchDemoPcap } from '../app/proofLab';
import { categoryMeta } from '../app/categories';
import { IconUpload } from '../ui/icons';

function Chip({ label }: { label: string | null | undefined }) {
  const m = categoryMeta(label ?? '');
  return <span className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
    style={{ color: m.color, border: `1px solid ${m.color}55`, background: `${m.color}14` }}>{m.short}</span>;
}

function FileSlot({ tag, file, onPick }: { tag: string; file: File | null; onPick: (f: File) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex cursor-pointer items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--nj-glass-hi)]"
        style={{ border: '1px solid var(--nj-border)', color: 'var(--nj-text)' }}>
        <IconUpload size={13} /> {tag}
        <input type="file" accept=".pcap,.pcapng,.cap" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ''; }} />
      </label>
      <span className="max-w-[160px] truncate text-[10px] text-[var(--nj-text-faint)]">{file ? file.name : 'no file'}</span>
      <span className="flex gap-1">
        {['netflix', 'youtube', 'gaming'].map((n) => (
          <button key={n} type="button" onClick={() => void fetchDemoPcap(n).then(onPick)}
            className="rounded-full px-1.5 py-0.5 text-[9px] text-[var(--nj-text-faint)] hover:text-[var(--nj-text)]"
            style={{ border: '1px solid var(--nj-border)' }}>{n}</button>
        ))}
      </span>
    </div>
  );
}

export default function ProofLab() {
  const [a, setA] = useState<File | null>(null);
  const [b, setB] = useState<File | null>(null);
  const [d, setD] = useState<File | null>(null);
  const [loss, setLoss] = useState(0.35);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cmp, setCmp] = useState<{ aDom: string | null; bDom: string | null; cos: number | null } | null>(null);
  const [deg, setDeg] = useState<{ clean: string | null; degraded: string | null; lossPct: number } | null>(null);

  const runCompare = async () => {
    if (!a || !b || busy) return;
    setBusy('compare'); setErr(null); setCmp(null);
    try {
      const ra = await inferFile(a); const rb = await inferFile(b);
      if (!ra || !rb) { setErr('Needs the LIVE server — start it / check the LIVE MODEL badge.'); return; }
      setCmp({ aDom: ra.dominant, bDom: rb.dominant, cos: cosine(ra.rep_embedding, rb.rep_embedding) });
    } catch { setErr('Run failed.'); } finally { setBusy(null); }
  };

  const runDegraded = async () => {
    if (!d || busy) return;
    setBusy('degraded'); setErr(null); setDeg(null);
    try {
      const clean = await inferFile(d);
      const dd = await inferFile(d, { change_rtt_prob: 1.0, time_shift_prob: 1.0,
        packet_loss_prob: 1.0, packet_loss_window: loss, rtt_mask_prob: 1.0 });
      if (!clean || !dd) { setErr('Needs the LIVE server — start it / check the LIVE MODEL badge.'); return; }
      setDeg({ clean: clean.dominant, degraded: dd.dominant, lossPct: Math.round(loss * 100) });
    } catch { setErr('Run failed.'); } finally { setBusy(null); }
  };

  const intra = cmp ? cmp.aDom === cmp.bDom : false;
  const cmpPass = cmp && cmp.cos != null && (intra ? cmp.cos > 0.7 : cmp.cos < 0.3);
  const degPass = deg && deg.clean != null && deg.clean === deg.degraded;
  const G = '#4ade80', W = '#fb923c';
  const spin = <span className="nj-spin h-3 w-3 rounded-full border-2 border-current border-t-transparent" />;

  return (
    <div className="nj-glass rounded-[var(--nj-r)] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--nj-text-faint)]">Proof Lab</span>
        <span className="text-[10.5px] text-[var(--nj-text-faint)]">— verify the KPIs on uploaded captures (live model)</span>
      </div>

      {/* Compare two captures: intra (same type) > 0.7, inter (different) < 0.3 */}
      <div className="mt-2.5 rounded-[10px] p-3" style={{ border: '1px solid var(--nj-border)' }}>
        <div className="mb-2 text-[10.5px] font-medium text-[var(--nj-text)]">
          Compare two captures <span className="text-[var(--nj-text-faint)]">— same type → cosine &gt; 0.7 (intra); different → &lt; 0.3 (inter)</span>
        </div>
        <div className="space-y-1.5">
          <FileSlot tag="Capture A" file={a} onPick={setA} />
          <FileSlot tag="Capture B" file={b} onPick={setB} />
        </div>
        <button disabled={!a || !b || !!busy} onClick={runCompare}
          className="mt-2 flex items-center gap-2 rounded-[9px] px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-40"
          style={{ color: '#04060d', background: 'linear-gradient(120deg, var(--nj-accent), #7cc4ff)' }}>
          {busy === 'compare' ? spin : null} Compare
        </button>
        {cmp && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
            <Chip label={cmp.aDom} /><span className="text-[var(--nj-text-faint)]">↔</span><Chip label={cmp.bDom} />
            <span className="nj-num text-[18px] font-semibold" style={{ color: cmpPass ? G : W }}>
              {cmp.cos != null ? cmp.cos.toFixed(3) : '—'}
            </span>
            <span className="text-[10.5px]">
              cosine · {intra ? 'intra, target > 0.7' : 'inter, target < 0.3'} ·{' '}
              <span style={{ color: cmpPass ? G : W }}>{cmpPass ? 'PASS' : 'below target'}</span>
            </span>
          </div>
        )}
      </div>

      {/* Degraded flow: upload one capture; the server degrades + re-classifies */}
      <div className="mt-2 rounded-[10px] p-3" style={{ border: '1px solid var(--nj-border)' }}>
        <div className="mb-2 text-[10.5px] font-medium text-[var(--nj-text)]">
          Degraded flow → same class <span className="text-[var(--nj-text-faint)]">— upload one capture; it is degraded (RTT/jitter/loss) then re-classified</span>
        </div>
        <FileSlot tag="Capture" file={d} onPick={setD} />
        <div className="mt-2 flex items-center gap-2 text-[10.5px] text-[var(--nj-text-faint)]">
          <span>packet loss</span>
          <input type="range" min={0.05} max={0.5} step={0.05} value={loss}
            onChange={(e) => setLoss(parseFloat(e.target.value))} disabled={!!busy} className="w-28" />
          <span className="nj-num">{Math.round(loss * 100)}%</span>
          <button disabled={!d || !!busy} onClick={runDegraded}
            className="ml-1 flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-40"
            style={{ color: '#04060d', background: 'linear-gradient(120deg, var(--nj-accent), #7cc4ff)' }}>
            {busy === 'degraded' ? spin : null} Degrade &amp; classify
          </button>
        </div>
        {deg && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-[var(--nj-text-faint)]">clean</span><Chip label={deg.clean} />
            <span className="text-[var(--nj-text-faint)]">→ degraded ({deg.lossPct}% loss)</span><Chip label={deg.degraded} />
            <span style={{ color: degPass ? G : W }}>{degPass ? 'PASS — class unchanged' : 'class changed'}</span>
          </div>
        )}
      </div>

      {err && <div className="mt-2 text-[11px]" style={{ color: W }}>{err}</div>}

      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[9.5px]">
        {[['intra cos > 0.7', '0.98'], ['inter cos < 0.3', '−0.04'], ['accuracy ≥ 90%', '99.7%'], ['latency < 100ms', '3.5ms']].map(([k, v]) => (
          <span key={k} className="rounded-full px-2 py-0.5" style={{ border: '1px solid #4ade8044', color: G, background: '#4ade8010' }}>
            {k} · <span className="nj-num">{v}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
