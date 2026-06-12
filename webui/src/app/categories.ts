// ───────────────────────────────────────────────────────────────────────────
// Category metadata — the "human layer".
//
// The model speaks in 6 manifest labels. This turns each into something a
// non-technical judge instantly grasps: a name, the apps it covers, and most
// importantly the *traffic signature* — the rhythm of encrypted packets that
// gives the app away without ever decrypting a byte.
//
// Colors mirror tokens.css --cat-N (manifest order = classColors.ts order).
// ───────────────────────────────────────────────────────────────────────────

export type IconKey = 'cloud-gaming' | 'live' | 'xr' | 'gamepad' | 'film' | 'call';

export interface CategoryMeta {
  id: string;
  name: string;
  short: string;
  tag: string;
  icon: IconKey;
  color: string;
  index: number;
  apps: string[];
  signature: string;
  blurb: string;
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  game_streaming: {
    id: 'game_streaming',
    name: 'Cloud Gaming',
    short: 'Cloud Gaming',
    tag: 'Game in the datacenter',
    icon: 'cloud-gaming',
    color: '#22d3ee',
    index: 0,
    apps: ['GeForce NOW', 'KT GameBox'],
    signature: 'A fat, steady video river downstream — a trickle of controller taps back up.',
    blurb: 'The game runs in a datacenter; only rendered pixels and your inputs cross the network.',
  },
  live_streaming: {
    id: 'live_streaming',
    name: 'Live Streaming',
    short: 'Live',
    tag: 'Broadcast, in real time',
    icon: 'live',
    color: '#f637ec',
    index: 1,
    apps: ['YouTube Live', 'AfreecaTV', 'Naver NOW'],
    signature: 'Sustained downstream delivered in tight, latency-shaped bursts.',
    blurb: 'A live broadcast — the world sends, you receive, with seconds of headroom.',
  },
  metaverse: {
    id: 'metaverse',
    name: 'Metaverse / XR',
    short: 'Metaverse',
    tag: 'Shared 3D worlds',
    icon: 'xr',
    color: '#fbbf24',
    index: 2,
    apps: ['Roblox', 'Zepeto'],
    signature: 'Chatty, bidirectional storms of small packets — constant state sync.',
    blurb: 'Persistent 3D worlds streaming tiny world-state updates in both directions.',
  },
  online_game: {
    id: 'online_game',
    name: 'Online Gaming',
    short: 'Online Game',
    tag: 'Twitch multiplayer',
    icon: 'gamepad',
    color: '#a78bfa',
    index: 3,
    apps: ['PUBG', 'Teamfight Tactics'],
    signature: 'Rapid, tiny UDP datagrams — ruthless, latency-first cadence.',
    blurb: 'Competitive multiplayer where every datagram is a position and every millisecond counts.',
  },
  stored_streaming: {
    id: 'stored_streaming',
    name: 'On-Demand Video',
    short: 'On-Demand',
    tag: 'Pre-recorded video',
    icon: 'film',
    color: '#4ade80',
    index: 4,
    apps: ['Netflix', 'Prime Video', 'YouTube'],
    signature: 'Big chunked bursts as the buffer fills — then long, calm silences.',
    blurb: 'Pre-recorded video: grab a few seconds ahead, pause, repeat. The buffer breathes.',
  },
  video_conferencing: {
    id: 'video_conferencing',
    name: 'Video Conferencing',
    short: 'Video Call',
    tag: 'Two-way, live',
    icon: 'call',
    color: '#f97316',
    index: 5,
    apps: ['Zoom', 'MS Teams', 'Google Meet'],
    signature: 'Symmetric real-time flow — you send and receive in equal measure; jitter is the enemy.',
    blurb: 'A live two-way call: audio and video stream out and in together, every moment.',
  },
};

const FALLBACK: CategoryMeta = {
  id: 'unknown', name: 'Unknown', short: 'Unknown', tag: 'Unclassified',
  icon: 'live', color: '#8ba0bd', index: 6, apps: [],
  signature: 'No signature available.', blurb: 'Outside the trained taxonomy.',
};

export function categoryMeta(label: string | undefined | null): CategoryMeta {
  if (!label) return FALLBACK;
  return CATEGORY_META[label] ?? { ...FALLBACK, id: label, name: prettify(label), short: prettify(label) };
}

export function prettify(label: string): string {
  return label.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Ordered list for legends/galleries. */
export const CATEGORY_ORDER = [
  'game_streaming', 'live_streaming', 'metaverse',
  'online_game', 'stored_streaming', 'video_conferencing',
];
