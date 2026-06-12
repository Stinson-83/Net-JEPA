// ───────────────────────────────────────────────────────────────────────────
// Atlas store — single source of truth for the new Net-JEPA experience.
// Reuses the proven data layer (loader/server/ws) under a fresh, scene-driven
// surface.
// ───────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import type {
  DatasetBundle, FlowFeatureDetail, Manifest, ProjectionResult, ServerStageEvent, UmapPoint,
} from '../data/types';
import { loadApp, loadDatasetBundle, loadFlowDetail } from '../data/loader';
import { serverHealthy } from '../data/server';
import { startLiveStream } from '../data/ws';

export const EMPTY_POINTS: UmapPoint[] = [];
export const EMPTY_CLASSES: string[] = [];

export type Scene = 'atlas' | 'model' | 'proof' | 'journey';

/** Pipeline stages — faithful to the real model (no fictional blocks). */
export interface PipelineStage { id: string; label: string; sub: string; }
export const PIPELINE: PipelineStage[] = [
  { id: 'ingest',   label: 'Capture',          sub: 'raw encrypted packets' },
  { id: 'flow',     label: 'Flow assembly',    sub: '5-tuple · bidirectional' },
  { id: 'features', label: 'Featurize',        sub: '64×9 sequence + context' },
  { id: 'temporal', label: 'Temporal encoder', sub: '4× Transformer' },
  { id: 'fusion',   label: 'Context fusion',   sub: 'cross-attention' },
  { id: 'pool',     label: 'Attention pool',   sub: 'learned query' },
  { id: 'embed',    label: 'Embedding',        sub: '128-d unit sphere' },
  { id: 'classify', label: 'Classify',         sub: 'cosine k-NN' },
  { id: 'project',  label: 'Project',          sub: 'lands in the atlas' },
];

/** Furthest client stage a coarse server /ws event unlocks. */
export const SERVER_STAGE_TO_IDX: Record<string, number> = {
  parse: 0, flow: 1, preprocess: 2, encode: 6, classify: 7, project: 8, done: 8,
};

export interface InjectSession {
  id: string;
  name: string;
  summary: string;
  projection: ProjectionResult | null;
  at: number;
}

interface AtlasState {
  // data
  manifest: Manifest | null;
  bundle: DatasetBundle | null;
  dataLoading: boolean;
  serverLive: boolean;
  bootstrap: () => Promise<void>;
  refreshBundle: () => Promise<void>;

  // scene + intro
  scene: Scene;
  setScene: (s: Scene) => void;
  introDone: boolean;
  finishIntro: () => void;

  // selection / hover / focus
  selectedId: string | null;
  selectedDetail: FlowFeatureDetail | null;
  selectedLoading: boolean;
  hoveredId: string | null;
  focusPoint: UmapPoint | null;
  selectFlow: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setFocusPoint: (p: UmapPoint | null) => void;

  // legend visibility / solo
  hiddenClasses: Set<string>;
  toggleClass: (label: string) => void;
  soloClass: (label: string) => void;
  showAllClasses: () => void;
  isVisible: (label: string) => boolean;

  // live pipeline + inject sessions
  pipelinePlaying: boolean;
  stageIndex: number; // -1 idle
  setPlaying: (v: boolean) => void;
  setStageIndex: (i: number) => void;
  sessions: InjectSession[];
  activeSessionId: string | null;
  beginSession: (name: string, summary: string) => string;
  completeSession: (id: string, projection: ProjectionResult) => void;
  setActiveSession: (id: string | null) => void;

  // /ws live stream
  liveConnected: boolean;
  liveEvents: ServerStageEvent[];
  pushLiveEvent: (e: ServerStageEvent) => void;
  setLiveConnected: (c: boolean) => void;
  clearLiveEvents: () => void;
}

const MAX_EVENTS = 80;
let selectGen = 0;

export const useStore = create<AtlasState>((set, get) => ({
  manifest: null,
  bundle: null,
  dataLoading: true,
  serverLive: false,

  bootstrap: async () => {
    set({ dataLoading: true });
    const { manifest, bundle } = await loadApp();
    set({ manifest, bundle, dataLoading: false });
    if (await serverHealthy()) {
      set({ serverLive: true });
      startLiveStream({
        onEvent: (e) => get().pushLiveEvent(e),
        onStatus: (c) => get().setLiveConnected(c),
      });
    }
  },

  refreshBundle: async () => {
    const { manifest, bundle } = get();
    if (!manifest || !bundle) return;
    const next = await loadDatasetBundle(manifest, bundle.id);
    set({ bundle: next });
  },

  scene: 'atlas',
  setScene: (s) => set({ scene: s }),
  introDone: false,
  finishIntro: () => set({ introDone: true }),

  selectedId: null,
  selectedDetail: null,
  selectedLoading: false,
  hoveredId: null,
  focusPoint: null,

  selectFlow: (id) => {
    const gen = ++selectGen;
    if (id === null) {
      set({ selectedId: null, selectedDetail: null, selectedLoading: false });
      return;
    }
    const { bundle } = get();
    set({ selectedId: id, selectedDetail: null, selectedLoading: true });
    if (!bundle) return;
    void loadFlowDetail(bundle.id, id, bundle.points).then((detail) => {
      if (gen !== selectGen) return;
      set({ selectedDetail: detail, selectedLoading: false });
    });
  },
  setHovered: (id) => set({ hoveredId: id }),
  setFocusPoint: (p) => set({ focusPoint: p }),

  hiddenClasses: new Set(),
  toggleClass: (label) => set((s) => {
    const next = new Set(s.hiddenClasses);
    if (next.has(label)) next.delete(label); else next.add(label);
    return { hiddenClasses: next };
  }),
  soloClass: (label) => set((s) => {
    const all = s.manifest?.classes ?? [];
    const others = all.filter((c) => c !== label);
    // if already solo'd to this one, clear
    const isSolo = s.hiddenClasses.size === others.length && others.every((c) => s.hiddenClasses.has(c));
    return { hiddenClasses: isSolo ? new Set() : new Set(others) };
  }),
  showAllClasses: () => set({ hiddenClasses: new Set() }),
  isVisible: (label) => !get().hiddenClasses.has(label),

  pipelinePlaying: false,
  stageIndex: -1,
  setPlaying: (v) => set({ pipelinePlaying: v }),
  setStageIndex: (i) => set({ stageIndex: i }),
  sessions: [],
  activeSessionId: null,
  beginSession: (name, summary) => {
    const id = `inj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({
      sessions: [{ id, name, summary, projection: null, at: Date.now() }, ...s.sessions].slice(0, 12),
      activeSessionId: id,
    }));
    return id;
  },
  completeSession: (id, projection) => set((s) => ({
    sessions: s.sessions.map((x) => (x.id === id ? { ...x, projection } : x)),
  })),
  setActiveSession: (id) => set({ activeSessionId: id }),

  liveConnected: false,
  liveEvents: [],
  pushLiveEvent: (e) => set((s) => ({ liveEvents: [e, ...s.liveEvents].slice(0, MAX_EVENTS) })),
  setLiveConnected: (c) => set({ liveConnected: c }),
  clearLiveEvents: () => set({ liveEvents: [] }),
}));

export function activeSession(): InjectSession | null {
  const { sessions, activeSessionId } = useStore.getState();
  return sessions.find((s) => s.id === activeSessionId) ?? null;
}
