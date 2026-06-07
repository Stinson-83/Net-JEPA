// ───────────────────────────────────────────────────────────────────────────
// Net-JEPA demo UI — shared data-contract types.
//
// These mirror the on-disk JSON contract documented in README.md. Every shape
// here is "optional-friendly": loader.ts fills gaps with `null`/`undefined`
// and the UI renders a "no data yet" placeholder rather than crashing.
// ───────────────────────────────────────────────────────────────────────────

export interface DatasetManifestEntry {
  id: string;
  name: string;
  trained_on: string;
  n_flows: number;
}

export interface Manifest {
  datasets: DatasetManifestEntry[];
  active_dataset: string;
  classes: string[];
  embedding_dim: number;
  model_version: string;
  training_phases?: TrainingPhase[];
}

export interface TrainingPhase {
  id: string;
  label: string;
  epochs: number;
  status: 'done' | 'current' | 'pending';
  current_epoch?: number;
}

/** One projected flow in the UMAP point cloud (2D or 3D). */
export interface UmapPoint {
  id: string;
  x: number;
  y: number;
  /** z-coordinate for 3D UMAP. Defaults to 0 if missing (2D fallback). */
  z?: number;
  label: string;
  confidence: number;
  flow_summary?: string;
}

export interface Top3Prob {
  label: string;
  prob: number;
}

/** Lazily-loaded per-flow detail, fetched on point click. */
export interface FlowFeatureDetail {
  id: string;
  packet_sizes: number[];
  iat: number[];
  /** +1 = client→server (outbound), -1 = server→client (inbound) */
  direction: number[];
  rtt_ms: number;
  jitter_ms: number;
  duration_s: number;
  packet_rate: number;
  predicted_class: string;
  top3: Top3Prob[];
  knn_ids: string[];
}

export interface ConfusionMatrix {
  labels: string[];
  matrix: number[][];
}

export interface RobustnessPoint {
  condition: string;
  accuracy: number;
}

export interface MetricsData {
  accuracy: number;
  macro_f1: number;
  per_class_f1: Record<string, number>;
  confusion_matrix: ConfusionMatrix;
  intra_class_cos: number;
  inter_class_cos: number;
  latency_ms_cpu: number;
  latency_ms_gpu: number;
  silhouette: number;
  robustness?: RobustnessPoint[];
  /** Per-KPI context notes, e.g. { macro_f1: "Limited by video_conferencing — only 8 flows." } */
  notes?: Record<string, string>;
}

export interface TrainingCurvePoint {
  step: number;
  total_loss: number;
  jepa_loss: number;
  vicreg_loss: number;
  contrastive_loss: number;
}

export interface ClassStat {
  label: string;
  count: number;
  avg_packet_size: number;
  avg_duration_s: number;
  avg_rtt_ms: number;
}

/** Everything the UI needs for the currently-active dataset. */
export interface DatasetBundle {
  id: string;
  meta: DatasetManifestEntry | null;
  points: UmapPoint[];
  metrics: MetricsData | null;
  curves: TrainingCurvePoint[];
  classStats: ClassStat[];
  /** true when this bundle came from real /data/* artifacts, false = procedural mock */
  isLive: boolean;
}

/** KPI definition used to drive the TopBar strip — target vs. actual. */
export interface KpiSpec {
  key: string;
  label: string;
  unit: string;
  /** target is "met" when actual is on the correct side of this threshold */
  target: number;
  /** 'gte' → actual >= target is good. 'lte' → actual <= target is good. */
  direction: 'gte' | 'lte';
  actual: number | null;
  /** previous value, used to compute the up/down delta arrow */
  previous?: number | null;
  format: (v: number) => string;
}

// ── PCAP injection pipeline ────────────────────────────────────────────────

export interface ParsedPacket {
  tsSec: number;
  tsUsec: number;
  /** wire length in bytes */
  length: number;
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: 'TCP' | 'UDP' | 'OTHER';
  /** TCP flags bitmask, if TCP */
  tcpFlags?: number;
}

export interface FiveTuple {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: 'TCP' | 'UDP' | 'OTHER';
}

/** Derived, ready-to-encode features for one flow extracted from a pcap. */
export interface InjectedFlow {
  flowId: string;
  tuple: FiveTuple;
  packetCount: number;
  packetSizes: number[];
  iat: number[];
  direction: number[];
  rttMs: number | null;
  jitterMs: number;
  durationS: number;
  packetRate: number;
  avgPacketSize: number;
  /** 9-d per-packet feature matrix (size, iat, direction, …) flattened to a summary vector for projection */
  featureVector: number[];
}

export interface ProjectionResult {
  x: number;
  y: number;
  label: string;
  confidence: number;
}

export type AnimationStageId =
  | 'ingest'
  | 'flow_construction'
  | 'feature_repr'
  | 'temporal_encoder'
  | 'context_encoder'
  | 'wavelet_encoder'
  | 'fusion'
  | 'embedding'
  | 'projection';

export interface InjectionSession {
  id: string;
  fileName: string;
  flow: InjectedFlow;
  projection: ProjectionResult | null;
  injectedAt: number;
}
