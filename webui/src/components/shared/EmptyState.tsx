import type { LucideIcon } from 'lucide-react';

/** Shared "nothing to show yet" placeholder — used by Inspector and Metrics panels alike. */
export function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <Icon size={20} className="text-[var(--nj-text-faint)]" />
      <div className="font-ui text-[11px] text-[var(--nj-text-dim)]">{title}</div>
      <p className="max-w-[230px] font-mono text-[9px] leading-relaxed text-[var(--nj-text-faint)]">{body}</p>
    </div>
  );
}
