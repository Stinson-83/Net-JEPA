// ───────────────────────────────────────────────────────────────────────────
// Global app store (zustand). Single source of truth for:
//   • the active dataset bundle (and dataset switching)
//   • UMAP selection / hover / legend visibility
//   • the inspector & metrics tab selection
//   • PCAP injection sessions + the pipeline-theatre animation phase
//
// Per-frame camera state (pan/zoom) deliberately lives *outside* this store,
// inside UMAPCanvas — routing 60fps updates through zustand would thrash every
// subscriber. Everything here changes at "user interaction" cadence.
// ───────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import type {
  AnimationStageId,
  ClassStat,
  DatasetBundle,
  FlowFeatureDetail,
  InjectedFlow,
  InjectionSession,
  Manifest,
  MetricsData,
  ProjectionResult,
  TrainingCurvePoint,
  UmapPoint,
} from '../data/types';
import { loadApp, loadDatasetBundle, loadFlowDetail } from '../data/loader';

export type InspectorTab = 'selected' | 'injected' | 'classStats';
export type MetricsTab = 'curves' | 'confusion' | 'robustness';

/**
 * Stable empty fallbacks for `bundle?.x ?? …` / `manifest?.x ?? …` selectors.
 * Returning a fresh `[]` from a zustand selector gives `useSyncExternalStore`
 * a new reference on every call — which it reads as "the store changed" and
 * re-renders forever ("Maximum update depth exceeded"). Sharing one stable
 * array per shape keeps the selector referentially stable while data loads.
 */
export const EMPTY_POINTS: UmapPoint[] = [];
export const EMPTY_CLASSES: string[] = [];
export const EMPTY_CLASS_STATS: ClassStat[] = [];
export const EMPTY_CURVES: TrainingCurvePoint[] = [];

export const PIPELINE_STAGES: AnimationStageId[] = [
  'ingest',
  'flow_construction',
  'feature_repr',
  'temporal_encoder',
  'context_encoder',
  'wavelet_encoder',
  'fusion',
  'embedding',
  'projection',
];

interface AppState {
  // ── data ────────────────────────────────────────────────────────────────
  manifest: Manifest | null;
  bundle: DatasetBundle | null;
  /** metrics from the previously-active dataset — powers the KPI strip's delta arrows */
  previousMetrics: MetricsData | null;
  dataLoading: boolean;
  bootstrap: () => Promise<void>;
  switchDataset: (id: string) => Promise<void>;

  // ── selection / hover ───────────────────────────────────────────────────
  selectedFlowId: string | null;
  selectedFlowDetail: FlowFeatureDetail | null;
  selectedFlowLoading: boolean;
  hoveredFlowId: string | null;
  selectFlow: (id: string | null) => void;
  setHoveredFlow: (id: string | null) => void;
  /** Set to fly the camera to a point (e.g. "locate" from the inspector or session tray); UMAPStage consumes it and clears it back to null. */
  focusPoint: UmapPoint | null;
  setFocusPoint: (p: UmapPoint | null) => void;

  // ── legend visibility ───────────────────────────────────────────────────
  hiddenClasses: Set<string>;
  toggleClassVisibility: (label: string) => void;
  isClassVisible: (label: string) => boolean;

  // ── tabs ────────────────────────────────────────────────────────────────
  inspectorTab: InspectorTab;
  metricsTab: MetricsTab;
  setInspectorTab: (t: InspectorTab) => void;
  setMetricsTab: (t: MetricsTab) => void;

  // ── injection modal & sessions ──────────────────────────────────────────
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  sessions: InjectionSession[];
  activeSessionId: string | null;
  trayCollapsed: boolean;
  toggleTray: () => void;
  setActiveSession: (id: string | null) => void;
  beginInjectionSession: (flow: InjectedFlow, fileName: string) => string;
  completeInjectionProjection: (sessionId: string, projection: ProjectionResult) => void;
  replayLast: () => void;
  replayToken: number; // increment to signal "replay the active session's animation"

  // ── pipeline-theatre animation ──────────────────────────────────────────
  pipelinePlaying: boolean;
  pipelineStageIndex: number; // -1 = idle
  setPipelinePlaying: (v: boolean) => void;
  setPipelineStageIndex: (i: number) => void;
  resetPipeline: () => void;

  // ── auto-demo ───────────────────────────────────────────────────────────
  autoDemo: boolean;
  toggleAutoDemo: () => void;
  lastUserInteraction: number;
  markUserInteraction: () => void;

  // ── layout ──────────────────────────────────────────────────────────────
  theatreCollapsed: boolean;
  setTheatreCollapsed: (v: boolean) => void;
}

let selectGeneration = 0;

export const useStore = create<AppState>((set, get) => ({
  manifest: null,
  bundle: null,
  previousMetrics: null,
  dataLoading: true,

  bootstrap: async () => {
    set({ dataLoading: true });
    const { manifest, bundle } = await loadApp();
    set({ manifest, bundle, dataLoading: false, hiddenClasses: new Set() });
  },

  switchDataset: async (id: string) => {
    const { manifest, bundle } = get();
    if (!manifest) return;
    set({
      dataLoading: true,
      selectedFlowId: null,
      selectedFlowDetail: null,
      hiddenClasses: new Set(),
      previousMetrics: bundle?.metrics ?? get().previousMetrics,
    });
    const next = await loadDatasetBundle(manifest, id);
    set({ bundle: next, dataLoading: false });
  },

  selectedFlowId: null,
  selectedFlowDetail: null,
  selectedFlowLoading: false,
  hoveredFlowId: null,
  focusPoint: null,
  setFocusPoint: (p) => set({ focusPoint: p }),

  selectFlow: (id) => {
    const gen = ++selectGeneration;
    if (id === null) {
      set({ selectedFlowId: null, selectedFlowDetail: null, selectedFlowLoading: false });
      return;
    }
    const { bundle } = get();
    set({ selectedFlowId: id, selectedFlowDetail: null, selectedFlowLoading: true, inspectorTab: 'selected' });
    if (!bundle) return;
    loadFlowDetail(bundle.id, id, bundle.points).then((detail) => {
      if (gen !== selectGeneration) return; // a newer selection superseded this one
      set({ selectedFlowDetail: detail, selectedFlowLoading: false });
    });
  },

  setHoveredFlow: (id) => set({ hoveredFlowId: id }),

  hiddenClasses: new Set(),
  toggleClassVisibility: (label) =>
    set((s) => {
      const next = new Set(s.hiddenClasses);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return { hiddenClasses: next };
    }),
  isClassVisible: (label) => !get().hiddenClasses.has(label),

  inspectorTab: 'selected',
  metricsTab: 'curves',
  setInspectorTab: (t) => set({ inspectorTab: t }),
  setMetricsTab: (t) => set({ metricsTab: t }),

  modalOpen: false,
  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),

  sessions: [],
  activeSessionId: null,
  trayCollapsed: false,
  toggleTray: () => set((s) => ({ trayCollapsed: !s.trayCollapsed })),
  setActiveSession: (id) => set({ activeSessionId: id }),

  beginInjectionSession: (flow, fileName) => {
    const id = `inj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const session: InjectionSession = { id, fileName, flow, projection: null, injectedAt: Date.now() };
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: id,
      modalOpen: false,
      inspectorTab: 'injected',
    }));
    return id;
  },

  completeInjectionProjection: (sessionId, projection) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === sessionId ? { ...sess, projection } : sess)),
    })),

  replayToken: 0,
  replayLast: () => {
    const { sessions } = get();
    if (sessions.length === 0) return;
    set((s) => ({
      activeSessionId: sessions[0].id,
      inspectorTab: 'injected',
      replayToken: s.replayToken + 1,
    }));
  },

  pipelinePlaying: false,
  pipelineStageIndex: -1,
  setPipelinePlaying: (v) => set({ pipelinePlaying: v }),
  setPipelineStageIndex: (i) => set({ pipelineStageIndex: i }),
  resetPipeline: () => set({ pipelinePlaying: false, pipelineStageIndex: -1 }),

  autoDemo: true,
  toggleAutoDemo: () => set((s) => ({ autoDemo: !s.autoDemo })),
  lastUserInteraction: Date.now(),
  markUserInteraction: () => set({ lastUserInteraction: Date.now() }),

  theatreCollapsed: false,
  setTheatreCollapsed: (v) => set({ theatreCollapsed: v }),
}));

/** Convenience selector: the currently-active injection session, if any. */
export function useActiveSession(): InjectionSession | null {
  return useStore((s) => s.sessions.find((sess) => sess.id === s.activeSessionId) ?? null);
}
