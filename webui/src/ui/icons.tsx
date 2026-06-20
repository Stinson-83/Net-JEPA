// Hand-rolled inline SVG icons — no external icon dependency, full control over
// stroke weight and glow. All inherit currentColor.
import type { IconKey } from '../app/categories';

interface P { size?: number; className?: string; strokeWidth?: number; }

function Svg({ size = 18, className, strokeWidth = 1.6, children }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export function CategoryIcon({ icon, size = 18, className }: { icon: IconKey } & P) {
  switch (icon) {
    case 'cloud-gaming':
      return <Svg size={size} className={className}><path d="M7 16a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.3A3.8 3.8 0 0 1 18 16Z" /><path d="m10.5 11 3 1.5-3 1.5Z" /></Svg>;
    case 'live':
      return <Svg size={size} className={className}><circle cx="12" cy="12" r="2.2" /><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.8 4.8a10 10 0 0 0 0 14.4M19.2 4.8a10 10 0 0 1 0 14.4" /></Svg>;
    case 'xr':
      return <Svg size={size} className={className}><path d="M12 3 4 7v10l8 4 8-4V7Z" /><path d="m4 7 8 4 8-4M12 11v10" /></Svg>;
    case 'gamepad':
      return <Svg size={size} className={className}><path d="M6.5 8h11a4 4 0 0 1 3.9 4.9l-.7 3a3 3 0 0 1-5.3 1.1L14 15h-4l-1.4 2A3 3 0 0 1 3.3 16l-.7-3A4 4 0 0 1 6.5 8Z" /><path d="M7.5 11.5v2M6.5 12.5h2M15.5 11.5h.01M17.5 13.5h.01" /></Svg>;
    case 'film':
      return <Svg size={size} className={className}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></Svg>;
    case 'call':
      return <Svg size={size} className={className}><rect x="2.5" y="6" width="13" height="12" rx="2" /><path d="m15.5 10 6-3.5v11l-6-3.5Z" /></Svg>;
    case 'audio':
      return <Svg size={size} className={className}><path d="M9 18V6l10-2v12" /><circle cx="6" cy="18" r="2.5" /><circle cx="16" cy="16" r="2.5" /></Svg>;
    case 'web':
      return <Svg size={size} className={className}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></Svg>;
  }
}

export const IconClose = (p: P) => <Svg {...p}><path d="m6 6 12 12M18 6 6 18" /></Svg>;
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>;
export const IconUpload = (p: P) => <Svg {...p}><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M5 20h14" /></Svg>;
export const IconPlay = (p: P) => <Svg {...p}><path d="M7 5v14l12-7Z" /></Svg>;
export const IconReplay = (p: P) => <Svg {...p}><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v3.5h3.5" /></Svg>;
export const IconLocate = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></Svg>;
export const IconLayers = (p: P) => <Svg {...p}><path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 13 9 5 9-5M3 16l9 5 9-5" /></Svg>;
export const IconActivity = (p: P) => <Svg {...p}><path d="M3 12h4l3 8 4-16 3 8h4" /></Svg>;
export const IconCpu = (p: P) => <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></Svg>;
export const IconTarget = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></Svg>;
export const IconGauge = (p: P) => <Svg {...p}><path d="M4 18a8 8 0 1 1 16 0" /><path d="m12 14 4-4" /><circle cx="12" cy="14" r="1.2" /></Svg>;
export const IconBook = (p: P) => <Svg {...p}><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2Z" /><path d="M4 19a2 2 0 0 1 2-2h12" /></Svg>;
export const IconArrow = (p: P) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const IconShield = (p: P) => <Svg {...p}><path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6Z" /><path d="m9 12 2 2 4-4" /></Svg>;
export const IconZap = (p: P) => <Svg {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7Z" /></Svg>;
export const IconGlobe = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></Svg>;
export const IconGithub = (p: P) => <Svg {...p}><path d="M9 19c-4 1.2-4-2-5.5-2.5M15 21v-3.2a2.8 2.8 0 0 0-.8-2.2c2.6-.3 5.3-1.3 5.3-5.8a4.5 4.5 0 0 0-1.2-3.1 4.2 4.2 0 0 0-.1-3.1s-1-.3-3.3 1.2a11.4 11.4 0 0 0-6 0C6.6 2.8 5.6 3.1 5.6 3.1a4.2 4.2 0 0 0-.1 3.1A4.5 4.5 0 0 0 4.3 9.3c0 4.5 2.7 5.5 5.3 5.8a2.8 2.8 0 0 0-.8 2.1V21" /></Svg>;
export const IconChevron = (p: P) => <Svg {...p}><path d="m9 6 6 6-6 6" /></Svg>;
export const IconSparkle = (p: P) => <Svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></Svg>;
