import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, FileWarning, Loader2, Network, UploadCloud, X } from 'lucide-react';
import { useStore } from '../../state/store';
import { parsePcap, PcapParseError } from '../../pcap/parsePcap';
import { extractFlows } from '../../pcap/extractFlows';
import { injectFlow } from '../../pcap/injection';
import type { InjectedFlow } from '../../data/types';

type Phase =
  | { kind: 'drop' }
  | { kind: 'busy'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'pick'; fileName: string; flows: InjectedFlow[]; truncated: boolean };

/** Wait two animation frames — long enough for React to paint the "busy" label before a synchronous parse blocks the main thread. */
function paint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

const ACCEPTED = ['.pcap', '.cap'];

/**
 * "Inject .pcap" modal — drag-and-drop (or browse) a classic libpcap capture,
 * watch it get parsed and reconstructed into flows entirely client-side, then
 * pick one to send through the live pipeline. Closing resets the picker so a
 * re-open always starts from a clean dropzone.
 */
export default function PcapModal() {
  const open = useStore((s) => s.modalOpen);
  const closeModal = useStore((s) => s.closeModal);
  const [phase, setPhase] = useState<Phase>({ kind: 'drop' });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) return;
    const t = window.setTimeout(() => {
      setPhase({ kind: 'drop' });
      setDragOver(false);
    }, 200); // outlast the exit animation so the reset isn't visible
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeModal]);

  const handleFile = useCallback(async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!ACCEPTED.some((ext) => lower.endsWith(ext))) {
      setPhase({ kind: 'error', message: `"${file.name}" doesn't look like a .pcap/.cap capture.` });
      return;
    }
    try {
      setPhase({ kind: 'busy', label: 'Reading capture…' });
      await paint();
      const buffer = await file.arrayBuffer();

      setPhase({ kind: 'busy', label: 'Parsing packet records…' });
      await paint();
      const { packets, truncated } = parsePcap(buffer);

      setPhase({ kind: 'busy', label: 'Reconstructing flows…' });
      await paint();
      const flows = extractFlows(packets);
      if (flows.length === 0) {
        setPhase({
          kind: 'error',
          message: `Parsed ${packets.length.toLocaleString()} packets but found no multi-packet TCP/UDP flow to inject — try a capture with a complete session in it.`,
        });
        return;
      }
      setPhase({ kind: 'pick', fileName: file.name, flows, truncated });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof PcapParseError ? err.message : 'Could not parse this file as a .pcap capture.' });
    }
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFile(file);
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const browsable = phase.kind === 'drop' || phase.kind === 'error';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="flex max-h-[80vh] w-[540px] flex-col overflow-hidden rounded-lg border border-[var(--nj-border-hi)] bg-[var(--nj-surface-solid)] shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
          >
            <header className="flex shrink-0 items-center gap-2 border-b border-[var(--nj-border)] px-4 py-3">
              <UploadCloud size={14} className="text-[var(--nj-accent)]" />
              <h2 className="font-ui text-[12px] uppercase tracking-[0.2em] text-[var(--nj-text-bright)]">Inject a capture</h2>
              <button
                onClick={closeModal}
                title="Close (Esc)"
                className="ml-auto cursor-pointer rounded p-1 text-[var(--nj-text-faint)] transition-colors hover:text-[var(--nj-text-bright)]"
              >
                <X size={14} />
              </button>
            </header>

            <div className="nj-scroll min-h-0 flex-1 overflow-y-auto p-4">
              {browsable && (
                <>
                  <label
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    className={[
                      'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
                      dragOver ? 'border-[var(--nj-accent)] bg-[var(--nj-accent)]/[0.06]' : 'border-[var(--nj-border)] hover:border-[var(--nj-text-faint)]',
                    ].join(' ')}
                  >
                    <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} className="hidden" onChange={onInputChange} />
                    <UploadCloud size={22} className="text-[var(--nj-text-faint)]" />
                    <div className="font-ui text-[12px] text-[var(--nj-text-dim)]">Drop a .pcap here, or click to browse</div>
                    <div className="max-w-[320px] font-mono text-[9px] leading-relaxed text-[var(--nj-text-faint)]">
                      classic libpcap format · parsed entirely in your browser — the file never leaves this tab
                    </div>
                  </label>

                  {phase.kind === 'error' && (
                    <div className="mt-3 flex items-start gap-2 rounded-md border border-[var(--nj-bad)]/30 bg-[var(--nj-bad)]/[0.07] px-3 py-2">
                      <FileWarning size={13} className="mt-0.5 shrink-0 text-[var(--nj-bad)]" />
                      <p className="font-mono text-[10px] leading-relaxed text-[var(--nj-text-dim)]">{phase.message}</p>
                    </div>
                  )}

                  <p className="mt-3 font-mono text-[9px] leading-relaxed text-[var(--nj-text-faint)]">
                    No capture handy? Any tcpdump/Wireshark export works — the parser reconstructs flows from IPv4 + TCP/UDP frames
                    (Ethernet, raw-IP, and Linux "cooked" link layers all supported). pcapng exports need converting first:{' '}
                    <code className="text-[var(--nj-text-dim)]">editcap -F pcap in.pcapng out.pcap</code>.
                  </p>
                </>
              )}

              {phase.kind === 'busy' && (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <Loader2 size={20} className="animate-spin text-[var(--nj-accent)]" />
                  <span className="font-mono text-[11px] text-[var(--nj-text-dim)]">{phase.label}</span>
                </div>
              )}

              {phase.kind === 'pick' && <FlowPicker fileName={phase.fileName} flows={phase.flows} truncated={phase.truncated} />}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FlowPicker({ fileName, flows, truncated }: { fileName: string; flows: InjectedFlow[]; truncated: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex flex-col gap-2.5">
      <div className="font-mono text-[10px] text-[var(--nj-text-dim)]">
        <span className="text-[var(--nj-text-bright)]">{flows.length}</span> flow{flows.length === 1 ? '' : 's'} reconstructed from{' '}
        <span className="text-[var(--nj-text)]">{fileName}</span> — pick one to send through the pipeline
      </div>

      {truncated && (
        <div className="flex items-center gap-1.5 rounded-md border border-[var(--nj-warning)]/30 bg-[var(--nj-warning)]/[0.07] px-2.5 py-1.5 font-mono text-[9px] text-[var(--nj-text-dim)]">
          <FileWarning size={11} className="shrink-0 text-[var(--nj-warning)]" />
          Large capture — sampled the first 20,000 packet records.
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {flows.map((flow) => (
          <li key={flow.flowId}>
            <button
              onClick={() => void injectFlow(flow, fileName)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-md border border-[var(--nj-border)] bg-black/15 px-3 py-2 text-left transition-colors hover:border-[var(--nj-accent)]/50 hover:bg-[var(--nj-accent)]/[0.05]"
            >
              <Network size={13} className="shrink-0 text-[var(--nj-text-faint)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[10px] text-[var(--nj-text)]">
                  {flow.tuple.srcIp}:{flow.tuple.srcPort}
                  <ArrowRight size={9} className="mx-1 inline align-[-1px] text-[var(--nj-text-faint)]" />
                  {flow.tuple.dstIp}:{flow.tuple.dstPort}
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-[var(--nj-text-faint)]">
                  {flow.tuple.protocol} · {flow.packetCount.toLocaleString()} pkts · {flow.avgPacketSize.toFixed(0)} B avg · {flow.durationS.toFixed(2)}s
                  {flow.rttMs !== null && ` · ${flow.rttMs.toFixed(0)}ms rtt`}
                </div>
              </div>
              <ArrowRight size={13} className="shrink-0 text-[var(--nj-text-faint)]" />
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
