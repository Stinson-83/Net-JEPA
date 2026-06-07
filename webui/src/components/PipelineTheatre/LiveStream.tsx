// ───────────────────────────────────────────────────────────────────────────
// LiveStream — renders the real /ws pipeline-stage events from the inference
// server. Visible only when the live server is connected; proves that an
// uploaded pcap is being parsed → classified → projected for real, flow by
// flow, rather than animated heuristically.
// ───────────────────────────────────────────────────────────────────────────

import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '../../state/store';
import type { ServerStageEvent } from '../../data/types';

const STAGE_COLOR: Record<ServerStageEvent['stage'], string> = {
  parse: 'var(--nj-text-dim)',
  flow: 'var(--nj-text-dim)',
  preprocess: 'var(--nj-text-dim)',
  encode: 'var(--nj-accent)',
  classify: 'var(--nj-accent)',
  project: 'var(--nj-good)',
  done: 'var(--nj-good)',
  error: 'var(--nj-bad)',
};

function format(e: ServerStageEvent): string {
  switch (e.stage) {
    case 'parse':
      return `parse · ${e.pcap ?? 'capture'}`;
    case 'flow':
      return `flow ${e.flow_id ?? ''} · ${e.src ?? '?'} → ${e.dst ?? '?'} · ${e.packets ?? '?'} pkts`;
    case 'preprocess':
      return `preprocess ${e.flow_id ?? ''}`;
    case 'encode':
      return `encode ${e.flow_id ?? ''}${e.latency_ms != null ? ` · ${e.latency_ms}ms` : ''}`;
    case 'classify':
      return `classify ${e.flow_id ?? ''} → ${e.label ?? '?'}${
        e.confidence != null ? ` (${(e.confidence * 100).toFixed(0)}%)` : ''
      }`;
    case 'project':
      return `project ${e.flow_id ?? ''} → (${e.x?.toFixed(2) ?? '?'}, ${e.y?.toFixed(2) ?? '?'})`;
    case 'done':
      return `done · +${e.added ?? 0} flow(s) · ${e.total_live ?? '?'} total`;
    case 'error':
      return `error · ${e.error ?? 'unknown'}`;
    default:
      return e.stage;
  }
}

export default function LiveStream() {
  const connected = useStore((s) => s.liveStreamConnected);
  const events = useStore((s) => s.liveEvents);

  if (!connected && events.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-[var(--nj-border)] bg-black/20 p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span
          className={`text-[10px] leading-none ${connected ? 'text-[var(--nj-good)]' : 'text-[var(--nj-text-faint)]'}`}
          style={connected ? { animation: 'pulse 1.6s ease-in-out infinite' } : undefined}
        >
          ●
        </span>
        <span className="font-ui text-[9px] uppercase tracking-[0.18em] text-[var(--nj-text-faint)]">
          {connected ? 'server stream · live' : 'server stream · offline'}
        </span>
      </div>

      {events.length === 0 ? (
        <div className="font-mono text-[9px] text-[var(--nj-text-faint)]">waiting for an injection…</div>
      ) : (
        <ul className="flex max-h-[120px] flex-col gap-0.5 overflow-y-auto nj-scroll">
          <AnimatePresence initial={false}>
            {events.map((e, i) => (
              <motion.li
                key={`${e.at}-${i}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.18 }}
                className="font-mono text-[9px] leading-relaxed"
                style={{ color: STAGE_COLOR[e.stage] ?? 'var(--nj-text-dim)' }}
              >
                {format(e)}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
