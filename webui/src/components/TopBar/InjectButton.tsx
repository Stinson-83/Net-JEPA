import { Radar, RotateCcw, UploadCloud } from 'lucide-react';
import { useStore } from '../../state/store';
import { replayInjection } from '../../pcap/injection';

/** "Inject .pcap" + "Replay last injection" — the demo centerpiece triggers. */
export default function InjectButton() {
  const openModal = useStore((s) => s.openModal);
  const sessionCount = useStore((s) => s.sessions.length);
  const playing = useStore((s) => s.pipelinePlaying);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={replayInjection}
        disabled={sessionCount === 0 || playing}
        title={sessionCount === 0 ? 'Inject a .pcap first' : 'Replay last injection (Space)'}
        className={[
          'flex items-center gap-1.5 rounded-md border border-[var(--nj-border)] bg-[var(--nj-bg-raised)] px-2.5 py-1.5',
          'font-ui text-[11px] text-[var(--nj-text-dim)] transition-colors',
          sessionCount === 0 || playing
            ? 'cursor-not-allowed opacity-40'
            : 'cursor-pointer hover:border-[var(--nj-accent)]/50 hover:text-[var(--nj-text-bright)]',
        ].join(' ')}
      >
        <RotateCcw size={13} />
        <span>Replay</span>
      </button>

      <button
        onClick={openModal}
        disabled={playing}
        title={playing ? 'A flow is already running through the pipeline…' : 'Inject a .pcap into the live pipeline'}
        className={[
          'group relative flex items-center gap-2 overflow-hidden rounded-md border px-3 py-1.5',
          'border-[var(--nj-accent)]/50 bg-[var(--nj-accent)]/[0.08] font-ui text-[11px] font-medium text-[var(--nj-accent)]',
          'transition-colors hover:bg-[var(--nj-accent)]/[0.16]',
          playing ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        ].join(' ')}
      >
        <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
        {playing ? <Radar size={14} className="animate-spin [animation-duration:1.6s]" /> : <UploadCloud size={14} />}
        <span>{playing ? 'Processing…' : 'Inject .pcap'}</span>
      </button>
    </div>
  );
}
