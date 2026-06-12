import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { IconArrow } from '../ui/icons';

const LINES = [
  { t: 'Encryption hides ', em: 'what', after: ' you send.' },
  { t: "It can't hide ", em: 'how', after: ' you send it.' },
];

export default function ColdOpen() {
  const finish = useStore((s) => s.finishIntro);
  const [step, setStep] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);

  const done = () => {
    setLeaving(true);
    window.setTimeout(finish, 620);
  };

  useEffect(() => {
    timers.current = [
      window.setTimeout(() => setStep(1), 2000),
      window.setTimeout(() => setStep(2), 4000),
    ];
    return () => timers.current.forEach(clearTimeout);
  }, []);

  return (
    <div onClick={() => (step >= 2 ? done() : setStep((s) => Math.min(s + 1, 2)))}
      className="fixed inset-0 z-[100] grid cursor-pointer place-items-center nj-space"
      style={{ opacity: leaving ? 0 : 1, transition: 'opacity 0.6s var(--nj-ease)' }}>
      {/* drifting packet field */}
      <PacketField />

      <div className="relative z-10 px-8 text-center">
        {step < 2 ? (
          <div key={step} className="nj-rise">
            <p className="nj-display text-[clamp(26px,4.4vw,52px)] font-semibold leading-tight text-[var(--nj-text-bright)]">
              {LINES[step].t}
              <span className="nj-sheen">{LINES[step].em}</span>
              {LINES[step].after}
            </p>
          </div>
        ) : (
          <div className="nj-rise flex flex-col items-center">
            <div className="nj-display text-[clamp(48px,9vw,118px)] font-bold leading-none tracking-tight">
              <span className="nj-sheen">NET-JEPA</span>
            </div>
            <p className="mt-3 text-[clamp(13px,1.6vw,18px)] tracking-[0.2em] text-[var(--nj-text-muted)]">
              THE SHAPE OF ENCRYPTED TRAFFIC
            </p>
            <button onClick={(e) => { e.stopPropagation(); done(); }}
              className="group mt-9 flex items-center gap-2.5 rounded-full px-6 py-3 text-[14px] font-semibold transition-all hover:gap-3.5"
              style={{ color: '#04060d', background: 'linear-gradient(120deg, var(--nj-accent), var(--nj-accent-2))', boxShadow: '0 0 40px -8px var(--nj-accent-glow)' }}>
              Enter the Atlas <IconArrow size={18} />
            </button>
            <p className="mt-6 text-[11px] tracking-wide text-[var(--nj-text-faint)]">Samsung EnnovateX ’26 · IIT Kanpur · FlowState</p>
          </div>
        )}
      </div>

      <button onClick={(e) => { e.stopPropagation(); done(); }}
        className="absolute bottom-6 right-7 z-10 text-[11px] uppercase tracking-[0.2em] text-[var(--nj-text-faint)] transition-colors hover:text-[var(--nj-text)]">
        skip →
      </button>
    </div>
  );
}

function PacketField() {
  const dots = Array.from({ length: 46 }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {dots.map((i) => {
        const top = (i * 137.5) % 100;
        const size = 1.5 + (i % 4);
        const dur = 9 + (i % 7) * 2;
        const delay = -(i % 11);
        const hue = ['#22d3ee', '#f637ec', '#a78bfa', '#4ade80', '#f97316', '#4fd6ff'][i % 6];
        return (
          <span key={i} className="absolute rounded-full"
            style={{
              top: `${top}%`, left: '-3%', width: size, height: size, background: hue,
              boxShadow: `0 0 8px ${hue}`, opacity: 0.5,
              animation: `nj-drift ${dur}s linear ${delay}s infinite`,
            }} />
        );
      })}
      <style>{`@keyframes nj-drift { to { transform: translateX(108vw); } }`}</style>
    </div>
  );
}
