import { useStore } from '../../state/store';
import type { TrainingPhase } from '../../data/types';

const DEFAULT_PHASES: TrainingPhase[] = [
  { id: 'pretrain', label: 'Pretrain', epochs: 30, status: 'done' },
  { id: 'jepa',     label: 'JEPA',     epochs: 40, status: 'done' },
  { id: 'vicreg',   label: 'VICReg',   epochs: 20, status: 'done' },
  { id: 'supcon',   label: 'SupCon',   epochs: 80, status: 'current', current_epoch: 50 },
  { id: 'distill',  label: 'Distill',  epochs: 20, status: 'pending' },
];

/**
 * 24px-tall phase-progress strip below the top bar. Shows the training
 * pipeline as connected segments: completed → current (pulsing) → future.
 */
export default function PhaseStrip() {
  const phases = useStore((s) => s.manifest?.training_phases) ?? DEFAULT_PHASES;

  if (phases.length === 0) return null;

  const totalEpochs = phases.reduce((s, p) => s + p.epochs, 0);

  return (
    <div className="flex h-6 w-full shrink-0 items-center border-b border-[var(--nj-border)] bg-[var(--nj-bg-raised)]/60 px-5">
      <div className="flex h-full flex-1 items-center gap-0">
        {phases.map((phase, i) => {
          const widthPct = (phase.epochs / totalEpochs) * 100;
          const isDone = phase.status === 'done';
          const isCurrent = phase.status === 'current';
          const isPending = phase.status === 'pending';
          const progress = isCurrent && phase.current_epoch != null
            ? phase.current_epoch / phase.epochs
            : isDone ? 1 : 0;

          const epochLabel = isCurrent && phase.current_epoch != null
            ? `E${phase.current_epoch}/${phase.epochs}`
            : isDone
            ? `E${phase.epochs}/${phase.epochs}`
            : `E0/${phase.epochs}`;

          return (
            <div
              key={phase.id}
              className="group relative flex h-full cursor-default items-center"
              style={{ width: `${widthPct}%` }}
              title={`${phase.label}: ${epochLabel} — ${phase.status}`}
            >
              {/* Segment bar */}
              <div className="relative mx-0.5 h-[5px] w-full overflow-hidden rounded-full bg-[#1f2937]">
                <div
                  className={[
                    'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
                    isDone ? 'bg-[#7dd3fc]' : '',
                    isCurrent ? 'bg-[#7dd3fc] animate-pulse' : '',
                    isPending ? 'bg-[#1f2937]' : '',
                  ].join(' ')}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>

              {/* Label overlay */}
              <div className="absolute inset-0 flex items-center justify-center gap-1">
                <span
                  className={[
                    'font-mono text-[8px] uppercase tracking-[0.12em]',
                    isDone ? 'text-[var(--nj-accent)]' : '',
                    isCurrent ? 'text-[var(--nj-accent)] font-medium' : '',
                    isPending ? 'text-[var(--nj-text-faint)]' : '',
                  ].join(' ')}
                >
                  {phase.label}
                </span>
                <span
                  className={[
                    'font-mono text-[7px]',
                    isDone ? 'text-[var(--nj-accent)]/60' : '',
                    isCurrent ? 'text-[var(--nj-accent)]/80' : '',
                    isPending ? 'text-[var(--nj-text-faint)]/60' : '',
                  ].join(' ')}
                >
                  {epochLabel}
                </span>
              </div>

              {/* Connector dot between segments */}
              {i < phases.length - 1 && (
                <div
                  className={[
                    'absolute -right-[3px] top-1/2 z-10 h-[5px] w-[5px] -translate-y-1/2 rounded-full border',
                    isDone || isCurrent ? 'border-[#7dd3fc] bg-[#7dd3fc]' : 'border-[#1f2937] bg-[#1f2937]',
                  ].join(' ')}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
