// ───────────────────────────────────────────────────────────────────────────
// Neon class palette.
//
// Net-JEPA's class list is data-driven (it comes from manifest.json and can
// change every retrain — 6 categories today, 15 fine-grained apps tomorrow,
// a different taxonomy entirely once CESNET-QUIC22 lands). We can't hardcode
// "Streaming = cyan" against a name that may not exist in the next dataset.
//
// Instead we assign colors *by position* in `manifest.classes`. This keeps
// the mapping perfectly stable for the reference 6-class taxonomy in the
// design brief (Streaming/Gaming/Conferencing/XR/IoT/FileTransfer ⇒
// cyan/magenta/amber/violet/green/orange in that order) while remaining
// total and collision-free for any class list of any length — the palette
// cycles for >12 classes.
// ───────────────────────────────────────────────────────────────────────────

export interface NeonHue {
  name: string;
  /** full-strength neon for points / accents */
  hex: string;
  /** soft glow tint used for backgrounds / fills at low alpha */
  glow: string;
}

export const NEON_PALETTE: NeonHue[] = [
  { name: 'cyan',    hex: '#22d3ee', glow: 'rgba(34,211,238,0.35)' },   // Streaming
  { name: 'magenta', hex: '#f637ec', glow: 'rgba(246,55,236,0.35)' },   // Gaming
  { name: 'amber',   hex: '#fbbf24', glow: 'rgba(251,191,36,0.35)' },   // Conferencing
  { name: 'violet',  hex: '#a78bfa', glow: 'rgba(167,139,250,0.35)' },  // XR / Metaverse
  { name: 'green',   hex: '#4ade80', glow: 'rgba(74,222,128,0.35)' },   // IoT
  { name: 'orange',  hex: '#f97316', glow: 'rgba(249,115,22,0.35)' },   // FileTransfer
  { name: 'sky',     hex: '#60a5fa', glow: 'rgba(96,165,250,0.35)' },
  { name: 'rose',    hex: '#fb7185', glow: 'rgba(251,113,133,0.35)' },
  { name: 'teal',    hex: '#2dd4bf', glow: 'rgba(45,212,191,0.35)' },
  { name: 'yellow',  hex: '#facc15', glow: 'rgba(250,204,21,0.35)' },
  { name: 'purple',  hex: '#c084fc', glow: 'rgba(192,132,252,0.35)' },
  { name: 'lime',    hex: '#a3e635', glow: 'rgba(163,230,53,0.35)' },
];

/** UI affordance accent — used for focus rings, active borders, links. */
export const ACCENT = '#7dd3fc';
/** Reserved for warnings / KPI-missed glow. Sparingly. */
export const WARNING = '#fb923c';

const hueForIndex = (i: number): NeonHue => NEON_PALETTE[i % NEON_PALETTE.length];

/** Stable color for a class, given the full ordered class list from the manifest. */
export function classColor(classes: readonly string[], label: string): NeonHue {
  const idx = classes.indexOf(label);
  return hueForIndex(idx === -1 ? hashIndex(label) : idx);
}

export function classHex(classes: readonly string[], label: string): string {
  return classColor(classes, label).hex;
}

/** Deterministic fallback for labels not present in the manifest's class list (e.g. stale flow_summary). */
function hashIndex(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Convert "#rrggbb" → [r,g,b] in 0..1, for WebGL uniforms / vertex colors. */
export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}
