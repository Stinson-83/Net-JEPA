// ───────────────────────────────────────────────────────────────────────────
// Category metadata — the "human layer".
//
// The model speaks in 8 manifest labels (the traffic types). This turns each
// into something a non-technical judge instantly grasps: a name, the apps it
// covers, and most importantly the *traffic signature* — the rhythm of
// encrypted packets that gives the app away without ever decrypting a byte.
//
// Colors mirror the position-based NEON_PALETTE (classColors.ts) so a legend
// swatch matches its galaxy points. index = class id from labels.json
// (alphabetical): audio_streaming=0 … web_browsing=7.
// ───────────────────────────────────────────────────────────────────────────

export type IconKey =
  | 'audio' | 'cloud-gaming' | 'live' | 'xr' | 'gamepad' | 'call' | 'film' | 'web';

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
  audio_streaming: {
    id: 'audio_streaming',
    name: 'Audio Streaming',
    short: 'Audio',
    tag: 'Music, on tap',
    icon: 'audio',
    color: '#22d3ee',
    index: 0,
    apps: ['Spotify'],
    signature: 'A thin, steady downstream trickle — small, regular chunks, low rate.',
    blurb: 'Compressed audio fetched a few seconds ahead; a calm, low-bandwidth heartbeat.',
  },
  cloud_gaming: {
    id: 'cloud_gaming',
    name: 'Cloud Gaming',
    short: 'Cloud Gaming',
    tag: 'Game in the datacenter',
    icon: 'cloud-gaming',
    color: '#f637ec',
    index: 1,
    apps: ['GeForce NOW', 'KT GameBox', 'Xbox Cloud'],
    signature: 'A fat, steady video river downstream — a trickle of controller taps back up.',
    blurb: 'The game runs in a datacenter; only rendered pixels and your inputs cross the network.',
  },
  live_streaming: {
    id: 'live_streaming',
    name: 'Live Streaming',
    short: 'Live',
    tag: 'Broadcast, in real time',
    icon: 'live',
    color: '#fbbf24',
    index: 2,
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
    color: '#a78bfa',
    index: 3,
    apps: ['Roblox', 'Zepeto'],
    signature: 'Chatty, bidirectional storms of small packets — constant state sync.',
    blurb: 'Persistent 3D worlds streaming tiny world-state updates in both directions.',
  },
  online_gaming: {
    id: 'online_gaming',
    name: 'Online Gaming',
    short: 'Online Game',
    tag: 'Twitch multiplayer',
    icon: 'gamepad',
    color: '#4ade80',
    index: 4,
    apps: ['PUBG / Battleground', 'Teamfight Tactics'],
    signature: 'Rapid, tiny UDP datagrams — ruthless, latency-first cadence.',
    blurb: 'Competitive multiplayer where every datagram is a position and every millisecond counts.',
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
  video_on_demand: {
    id: 'video_on_demand',
    name: 'Video on Demand',
    short: 'On-Demand',
    tag: 'Pre-recorded video',
    icon: 'film',
    color: '#60a5fa',
    index: 6,
    apps: ['Netflix', 'Prime Video', 'YouTube'],
    signature: 'Big chunked bursts as the buffer fills — then long, calm silences.',
    blurb: 'Pre-recorded video: grab a few seconds ahead, pause, repeat. The buffer breathes.',
  },
  web_browsing: {
    id: 'web_browsing',
    name: 'Web Browsing',
    short: 'Web',
    tag: 'Pages, ads, APIs',
    icon: 'web',
    color: '#fb7185',
    index: 7,
    apps: ['general web'],
    signature: 'Bursty request/response fan-out to many hosts — load, idle, click, repeat.',
    blurb: 'Ordinary browsing: short bursts to lots of servers as a page and its assets load.',
  },
};

const FALLBACK: CategoryMeta = {
  id: 'unknown', name: 'Unknown', short: 'Unknown', tag: 'Unclassified',
  icon: 'live', color: '#8ba0bd', index: 8, apps: [],
  signature: 'No signature available.', blurb: 'Outside the trained taxonomy.',
};

export function categoryMeta(label: string | undefined | null): CategoryMeta {
  if (!label) return FALLBACK;
  return CATEGORY_META[label] ?? { ...FALLBACK, id: label, name: prettify(label), short: prettify(label) };
}

export function prettify(label: string): string {
  return label.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Ordered list for legends/galleries (matches labels.json / class-id order). */
export const CATEGORY_ORDER = [
  'audio_streaming', 'cloud_gaming', 'live_streaming', 'metaverse',
  'online_gaming', 'video_conferencing', 'video_on_demand', 'web_browsing',
];
