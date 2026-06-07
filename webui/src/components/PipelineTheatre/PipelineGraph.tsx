import { motion, AnimatePresence } from 'motion/react';
import { GitBranch } from 'lucide-react';
import { useStore, PIPELINE_STAGES } from '../../state/store';
import { STAGE_DEFS, STAGE_VIZ, PIPELINE_LAYOUT, type LayoutNode } from './stageDefs';
import { ACCENT } from '../../data/classColors';
import type { AnimationStageId } from '../../data/types';

type NodeStatus = 'pending' | 'active' | 'done';

function stageRange(node: LayoutNode): [number, number] {
  const indices = (node.kind === 'single' ? [node.stage] : node.stages).map((s) => PIPELINE_STAGES.indexOf(s));
  return [Math.min(...indices), Math.max(...indices)];
}

/**
 * `playing` (not just `stageIndex`) has to gate "active" — otherwise the
 * final node's range never satisfies `stageIndex > hi` once the walk finishes
 * sitting on it, so it would read as perpetually "running" (complete with its
 * pulsing glow) instead of settling into "done" alongside everything before it.
 */
function nodeStatus(node: LayoutNode, stageIndex: number, playing: boolean): NodeStatus {
  const [lo, hi] = stageRange(node);
  if (stageIndex < lo) return 'pending';
  if (playing && stageIndex <= hi) return 'active';
  return 'done';
}

const STATUS_COLOR: Record<NodeStatus, string> = {
  pending: 'var(--nj-text-faint)',
  active: ACCENT,
  done: 'var(--nj-good)',
};

/**
 * Vertical stepper diagram of the 7 visual stages (the three context encoders
 * collapse into one "parallel lane", matching how they actually run on real
 * input). Node status derives purely from `pipelineStageIndex` — there is no
 * separate "is this node done" bookkeeping to keep in sync.
 */
export default function PipelineGraph() {
  const stageIndex = useStore((s) => s.pipelineStageIndex);
  const playing = useStore((s) => s.pipelinePlaying);
  const activeDef = stageIndex >= 0 ? STAGE_DEFS[PIPELINE_STAGES[stageIndex]] : null;

  return (
    <div className="flex flex-col">
      <div className="flex-1 pr-1">
        {PIPELINE_LAYOUT.map((node, i) => {
          const status = nodeStatus(node, stageIndex, playing);
          const color = STATUS_COLOR[status];
          const isLast = i === PIPELINE_LAYOUT.length - 1;
          return node.kind === 'single' ? (
            <StageRow key={i} stage={node.stage} status={status} color={color} isLast={isLast} />
          ) : (
            <ParallelLane key={i} stages={node.stages} stageIndex={stageIndex} status={status} color={color} isLast={isLast} />
          );
        })}
      </div>
      <AnimatePresence mode="wait">
        {activeDef && playing && (
          <motion.div
            key={activeDef.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="mt-2 shrink-0 rounded-md border border-[var(--nj-border)] bg-black/20 px-2.5 py-1.5"
          >
            <div className="font-ui text-[10px] font-medium text-[var(--nj-accent)]">{activeDef.label}</div>
            <div className="mt-0.5 font-mono text-[10px] leading-snug text-[var(--nj-text-dim)]">{activeDef.blurb}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NodeBadge({ icon: Icon, status, color }: { icon: typeof GitBranch; status: NodeStatus; color: string }) {
  return (
    <motion.div
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-black/30"
      animate={{
        borderColor: color,
        color,
        boxShadow: status === 'active' ? `0 0 12px 1px ${color}66` : '0 0 0 0 transparent',
        scale: status === 'active' ? [1, 1.08, 1] : 1,
      }}
      transition={{ duration: status === 'active' ? 1.6 : 0.35, repeat: status === 'active' ? Infinity : 0, ease: 'easeInOut' }}
    >
      <Icon size={12} />
    </motion.div>
  );
}

function Rail({ status, color, isLast }: { status: NodeStatus; color: string; isLast: boolean }) {
  if (isLast) return <div className="h-6 w-6 shrink-0" />;
  return (
    <div
      className="mt-1 w-px flex-1 transition-colors duration-500"
      style={{ backgroundColor: status === 'pending' ? 'var(--nj-border)' : color }}
    />
  );
}

function StageRow({ stage, status, color, isLast }: { stage: AnimationStageId; status: NodeStatus; color: string; isLast: boolean }) {
  const def = STAGE_DEFS[stage];
  const Icon = def.icon;
  const Viz = STAGE_VIZ[stage];
  return (
    <div className="flex gap-3">
      <div className="flex w-6 flex-col items-center">
        <NodeBadge icon={Icon} status={status} color={color} />
        <Rail status={status} color={color} isLast={isLast} />
      </div>
      <div className="flex flex-1 items-center justify-between gap-3 pb-4">
        <div className="min-w-0">
          <div className={`truncate font-ui text-[11px] ${status === 'pending' ? 'text-[var(--nj-text-faint)]' : 'text-[var(--nj-text-bright)]'}`}>
            {def.label}
          </div>
          <div className="font-mono text-[8px] uppercase tracking-[0.16em]" style={{ color }}>
            {status === 'active' ? 'running' : status}
          </div>
        </div>
        <Viz active={status === 'active'} color={color} />
      </div>
    </div>
  );
}

function ParallelLane({
  stages, stageIndex, status, color, isLast,
}: { stages: AnimationStageId[]; stageIndex: number; status: NodeStatus; color: string; isLast: boolean }) {
  const current = stageIndex >= 0 ? PIPELINE_STAGES[stageIndex] : null;
  return (
    <div className="flex gap-3">
      <div className="flex w-6 flex-col items-center">
        <NodeBadge icon={GitBranch} status={status} color={color} />
        <Rail status={status} color={color} isLast={isLast} />
      </div>
      <div className="flex-1 pb-4">
        <div className="mb-1.5 font-mono text-[8px] uppercase tracking-[0.16em]" style={{ color }}>
          parallel encoders · {status === 'active' ? 'running' : status}
        </div>
        <div className="flex flex-col gap-1.5">
          {stages.map((s) => {
            const def = STAGE_DEFS[s];
            const Icon = def.icon;
            const Viz = STAGE_VIZ[s];
            const emphasised = status === 'active' && current === s;
            return (
              <div
                key={s}
                className="flex items-center justify-between gap-2 rounded border px-2 py-1 transition-colors duration-300"
                style={{
                  borderColor: emphasised ? color : 'var(--nj-border)',
                  background: emphasised ? `${color}14` : 'rgba(0,0,0,0.18)',
                }}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <Icon size={11} style={{ color: status === 'active' ? color : 'var(--nj-text-faint)' }} />
                  <span className="truncate font-ui text-[10px] text-[var(--nj-text)]">{def.short}</span>
                </div>
                <Viz active={status === 'active'} color={status === 'active' ? color : 'var(--nj-text-faint)'} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
