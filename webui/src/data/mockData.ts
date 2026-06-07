// ───────────────────────────────────────────────────────────────────────────
// Procedural mock dataset — boots the UI on "day 0" before any real training
// artifacts exist in /public/data/. Everything here is generated from a fixed
// seed so the layout is stable across reloads (judges see the same demo twice)
// while still looking organic: Gaussian clusters with deliberate overlap,
// log-normal packet timing, decaying-with-noise loss curves, and a confusion
// matrix whose off-diagonal mass is biased toward *visually nearby* clusters
// (so the heatmap and the UMAP tell the same story).
//
// None of this is a stand-in for real numbers — it exists purely so the demo
// never looks empty. The moment manifest.json appears in /public/data/, this
// module is bypassed entirely (see loader.ts).
// ───────────────────────────────────────────────────────────────────────────

import type {
  ClassStat,
  ConfusionMatrix,
  DatasetBundle,
  FlowFeatureDetail,
  Manifest,
  MetricsData,
  TrainingCurvePoint,
  UmapPoint,
} from './types';
import { mulberry32, gaussian, logNormal, clamp, type Rng } from './rng';

export const MOCK_DATASET_ID = 'mock_demo';
export const MOCK_CLASSES = ['Streaming', 'Gaming', 'Conferencing', 'XR', 'IoT', 'FileTransfer'];
const N_POINTS = 6000;
const SEED = 0xC0FFEE;

// Cluster layout in UMAP-ish coordinate space (roughly -14..14 on each axis).
// Streaming↔Conferencing centroids sit closer together than Streaming↔Gaming,
// per the brief — and IoT/FileTransfer occupy their own quadrant, mirroring
// how distinct their packet-size & cadence profiles are from media traffic.
interface ClusterSpec {
  label: string;
  center: [number, number, number];
  spread: number;
  weight: number;
  // per-class plausible flow profiles (used for both points & class_stats)
  pktSizeRange: [number, number];
  durationRange: [number, number];
  rttRange: [number, number];
}

const CLUSTERS: ClusterSpec[] = [
  { label: 'Streaming',     center: [-4.5,  3.0,  2.5], spread: 2.0, weight: 1.15, pktSizeRange: [900, 1350], durationRange: [45, 320], rttRange: [18, 65] },
  { label: 'Gaming',        center: [ 7.5, -4.5, -3.0], spread: 1.7, weight: 1.0,  pktSizeRange: [110, 420],  durationRange: [20, 180], rttRange: [12, 48] },
  { label: 'Conferencing',  center: [-1.0,  4.8,  5.5], spread: 1.9, weight: 0.95, pktSizeRange: [260, 620],  durationRange: [60, 400], rttRange: [25, 90] },
  { label: 'XR',            center: [ 5.5,  6.2, -1.0], spread: 1.6, weight: 0.7,  pktSizeRange: [480, 980],  durationRange: [30, 240], rttRange: [15, 55] },
  { label: 'IoT',           center: [-7.5, -6.0,  0.5], spread: 1.4, weight: 0.65, pktSizeRange: [48, 180],   durationRange: [4, 65],   rttRange: [6, 35] },
  { label: 'FileTransfer',  center: [ 2.0, -7.5, -5.0], spread: 1.8, weight: 0.85, pktSizeRange: [1100, 1500], durationRange: [10, 220], rttRange: [10, 60] },
];

function buildManifest(): Manifest {
  return {
    datasets: [
      { id: MOCK_DATASET_ID, name: 'Procedural Demo (no artifacts loaded)', trained_on: 'n/a — synthetic', n_flows: N_POINTS },
    ],
    active_dataset: MOCK_DATASET_ID,
    classes: MOCK_CLASSES,
    embedding_dim: 128,
    model_version: 'net-jepa-vMOCK',
    training_phases: [
      { id: 'pretrain',  label: 'Pretrain',  epochs: 30, status: 'done' },
      { id: 'jepa',      label: 'JEPA',      epochs: 40, status: 'done' },
      { id: 'vicreg',    label: 'VICReg',    epochs: 20, status: 'done' },
      { id: 'supcon',    label: 'SupCon',    epochs: 80, status: 'current', current_epoch: 50 },
      { id: 'distill',   label: 'Distill',   epochs: 20, status: 'pending' },
    ],
  };
}

function flowSummary(rng: Rng, cluster: ClusterSpec): string {
  const ports = [443, 8801, 3478, 51820, 19305, 8080, 5223];
  const proto = rng() < 0.78 ? 'TCP' : 'UDP';
  const dport = ports[Math.floor(rng() * ports.length)];
  const pkts = Math.round(10 + rng() * 54);
  const dur = lerpRange(rng, cluster.durationRange);
  return `${proto} :${1024 + Math.floor(rng() * 60000)} → :${dport} · ${pkts} pkts · ${dur.toFixed(1)}s`;
}

function lerpRange(rng: Rng, range: [number, number]): number {
  return range[0] + rng() * (range[1] - range[0]);
}

function buildPoints(rng: Rng): UmapPoint[] {
  const totalWeight = CLUSTERS.reduce((s, c) => s + c.weight, 0);
  const points: UmapPoint[] = [];
  let idx = 0;
  for (const cluster of CLUSTERS) {
    const n = Math.round((cluster.weight / totalWeight) * N_POINTS);
    for (let i = 0; i < n; i++) {
      const x = gaussian(rng, cluster.center[0], cluster.spread);
      const y = gaussian(rng, cluster.center[1], cluster.spread);
      const z = gaussian(rng, cluster.center[2], cluster.spread * 0.8);
      const dx = x - cluster.center[0];
      const dy = y - cluster.center[1];
      const dz = z - cluster.center[2];
      const distNorm = Math.sqrt(dx * dx + dy * dy + dz * dz) / cluster.spread;
      // Points near the centroid are "easy" (high confidence); points out in
      // the overlap tails are "hard" — exactly the ones a classifier would hesitate on.
      const confidence = clamp(0.97 - distNorm * 0.12 + gaussian(rng, 0, 0.04), 0.38, 0.995);
      points.push({
        id: `mock_flow_${String(idx).padStart(5, '0')}`,
        x,
        y,
        z,
        label: cluster.label,
        confidence,
        flow_summary: flowSummary(rng, cluster),
      });
      idx++;
    }
  }
  return points;
}

function buildClassStats(rng: Rng, points: UmapPoint[]): ClassStat[] {
  return CLUSTERS.map((cluster) => {
    const count = points.filter((p) => p.label === cluster.label).length;
    return {
      label: cluster.label,
      count,
      avg_packet_size: Math.round(lerpRange(rng, cluster.pktSizeRange)),
      avg_duration_s: Number(lerpRange(rng, cluster.durationRange).toFixed(1)),
      avg_rtt_ms: Number(lerpRange(rng, cluster.rttRange).toFixed(1)),
    };
  });
}

/** Confusion matrix whose confusions concentrate on geometrically-nearby clusters. */
function buildConfusionMatrix(rng: Rng): ConfusionMatrix {
  const labels = MOCK_CLASSES;
  const n = labels.length;
  const support = CLUSTERS.map((c) => Math.round(280 + c.weight * 80 + rng() * 40));

  // pairwise centroid distances → "confusability" weights (closer = more confusable)
  const dist = (i: number, j: number) => {
    const [ax, ay] = CLUSTERS[i].center;
    const [bx, by] = CLUSTERS[j].center;
    return Math.hypot(ax - bx, ay - by);
  };

  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n).fill(0);
    const total = support[i];
    const baseAcc = clamp(0.875 + gaussian(rng, 0, 0.02), 0.82, 0.96);
    const correct = Math.round(total * baseAcc);
    row[i] = correct;
    let remaining = total - correct;

    // distribute the misclassified mass with weight ∝ 1 / distance²
    const weights = labels.map((_, j) => (j === i ? 0 : 1 / Math.pow(dist(i, j) + 0.6, 2)));
    const wSum = weights.reduce((s, w) => s + w, 0);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const share = j === n - 1
        ? remaining
        : Math.round((weights[j] / wSum) * (total - correct));
      row[j] = Math.max(0, share);
      remaining -= row[j];
    }
    if (remaining !== 0) row[i] += remaining; // absorb rounding drift into the diagonal
    matrix.push(row);
  }
  return { labels, matrix };
}

function f1FromConfusion(cm: ConfusionMatrix): { perClass: Record<string, number>; macro: number; accuracy: number } {
  const n = cm.labels.length;
  const perClass: Record<string, number> = {};
  let macro = 0;
  let totalCorrect = 0;
  let totalCount = 0;
  for (let i = 0; i < n; i++) {
    const tp = cm.matrix[i][i];
    let fp = 0;
    let fn = 0;
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      rowSum += cm.matrix[i][j];
      if (j !== i) {
        fn += cm.matrix[i][j];
        fp += cm.matrix[j][i];
      }
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClass[cm.labels[i]] = Number(f1.toFixed(4));
    macro += f1;
    totalCorrect += tp;
    totalCount += rowSum;
  }
  macro /= n;
  return { perClass, macro: Number(macro.toFixed(4)), accuracy: Number((totalCorrect / totalCount).toFixed(4)) };
}

function buildMetrics(rng: Rng): MetricsData {
  const cm = buildConfusionMatrix(rng);
  const { perClass, macro, accuracy } = f1FromConfusion(cm);
  return {
    accuracy,
    macro_f1: macro,
    per_class_f1: perClass,
    confusion_matrix: cm,
    intra_class_cos: Number(clamp(0.74 + gaussian(rng, 0, 0.015), 0.68, 0.85).toFixed(3)),
    inter_class_cos: Number(clamp(0.21 + gaussian(rng, 0, 0.015), 0.12, 0.32).toFixed(3)),
    latency_ms_cpu: Number(clamp(71 + gaussian(rng, 0, 4), 40, 110).toFixed(1)),
    latency_ms_gpu: Number(clamp(34 + gaussian(rng, 0, 2.5), 18, 60).toFixed(1)),
    silhouette: Number(clamp(0.41 + gaussian(rng, 0, 0.03), 0.2, 0.6).toFixed(3)),
    robustness: [
      { condition: 'clean',       accuracy: accuracy },
      { condition: '5% loss',     accuracy: Number(clamp(accuracy - 0.025 - rng() * 0.02, 0.5, 1).toFixed(4)) },
      { condition: '10% loss',    accuracy: Number(clamp(accuracy - 0.06 - rng() * 0.03, 0.4, 1).toFixed(4)) },
      { condition: 'RTT +50ms',   accuracy: Number(clamp(accuracy - 0.04 - rng() * 0.02, 0.4, 1).toFixed(4)) },
      { condition: 'jitter +20ms', accuracy: Number(clamp(accuracy - 0.05 - rng() * 0.025, 0.4, 1).toFixed(4)) },
    ],
    notes: {
      macro_f1: 'Limited by video_conferencing class — only 8 training flows.',
      inter_cos: 'Cross-class separation improves as SupCon loss converges.',
    },
  };
}

function buildCurves(rng: Rng): TrainingCurvePoint[] {
  const steps = 240;
  const out: TrainingCurvePoint[] = [];
  // (start, floor, decay-rate, noise-amplitude) per loss component
  const profiles = {
    total:        { start: 5.4, floor: 0.62, k: 0.024, noise: 0.10 },
    jepa:         { start: 3.1, floor: 0.35, k: 0.021, noise: 0.07 },
    vicreg:       { start: 1.9, floor: 0.18, k: 0.018, noise: 0.05 },
    contrastive:  { start: 0.9, floor: 0.09, k: 0.026, noise: 0.04 },
  };
  const decay = (p: typeof profiles.total, step: number) =>
    p.floor + (p.start - p.floor) * Math.exp(-p.k * step) + gaussian(rng, 0, p.noise) * Math.exp(-p.k * step * 0.4);

  for (let step = 0; step <= steps; step++) {
    out.push({
      step: step * 50,
      total_loss: Number(Math.max(0.05, decay(profiles.total, step)).toFixed(4)),
      jepa_loss: Number(Math.max(0.03, decay(profiles.jepa, step)).toFixed(4)),
      vicreg_loss: Number(Math.max(0.02, decay(profiles.vicreg, step)).toFixed(4)),
      contrastive_loss: Number(Math.max(0.01, decay(profiles.contrastive, step)).toFixed(4)),
    });
  }
  return out;
}

/** Procedurally synthesizes the lazily-loaded per-flow detail for a mock point. */
export function buildMockFlowDetail(point: UmapPoint, allPoints: UmapPoint[]): FlowFeatureDetail {
  const rng = mulberry32(seedFromId(point.id));
  const cluster = CLUSTERS.find((c) => c.label === point.label) ?? CLUSTERS[0];
  const n = 12 + Math.floor(rng() * 52);
  const packet_sizes: number[] = [];
  const iat: number[] = [];
  const direction: number[] = [];
  for (let i = 0; i < n; i++) {
    packet_sizes.push(Math.round(clamp(lerpRange(rng, cluster.pktSizeRange) * (0.5 + rng()), 40, 1500)));
    iat.push(i === 0 ? 0 : Number(clamp(logNormal(rng, -3.4, 0.9), 0.0005, 2.5).toFixed(5)));
    direction.push(rng() < 0.55 ? 1 : -1);
  }
  const rtt = Number(lerpRange(rng, cluster.rttRange).toFixed(2));
  const jitter = Number((rtt * (0.08 + rng() * 0.22)).toFixed(2));
  const duration = Number(lerpRange(rng, cluster.durationRange).toFixed(2));

  // top-3 probs: predicted class gets `confidence`, remainder split with the
  // two geometrically-nearest classes getting the larger residual shares.
  const others = MOCK_CLASSES.filter((c) => c !== point.label);
  const distTo = (label: string) => {
    const oc = CLUSTERS.find((c) => c.label === label)!;
    return Math.hypot(oc.center[0] - cluster.center[0], oc.center[1] - cluster.center[1], oc.center[2] - cluster.center[2]);
  };
  const ranked = [...others].sort((a, b) => distTo(a) - distTo(b));
  const remainder = 1 - point.confidence;
  const second = remainder * (0.6 + rng() * 0.2);
  const third = remainder - second;
  const top3 = [
    { label: point.label, prob: Number(point.confidence.toFixed(4)) },
    { label: ranked[0], prob: Number(second.toFixed(4)) },
    { label: ranked[1], prob: Number(third.toFixed(4)) },
  ];

  const knn_ids = nearestPoints(point, allPoints, 6).map((p) => p.id);

  return {
    id: point.id,
    packet_sizes,
    iat,
    direction,
    rtt_ms: rtt,
    jitter_ms: jitter,
    duration_s: duration,
    packet_rate: Number((n / Math.max(duration, 0.5)).toFixed(2)),
    predicted_class: point.label,
    top3,
    knn_ids,
  };
}

function nearestPoints(origin: UmapPoint, all: UmapPoint[], k: number): UmapPoint[] {
  return [...all]
    .filter((p) => p.id !== origin.id)
    .sort((a, b) => {
      const da = (a.x - origin.x) ** 2 + (a.y - origin.y) ** 2 + ((a.z ?? 0) - (origin.z ?? 0)) ** 2;
      const db = (b.x - origin.x) ** 2 + (b.y - origin.y) ** 2 + ((b.z ?? 0) - (origin.z ?? 0)) ** 2;
      return da - db;
    })
    .slice(0, k);
}

function seedFromId(id: string): number {
  let h = 0x9747b28c;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x85ebca6b);
  }
  return h >>> 0;
}

let _cache: { manifest: Manifest; bundle: DatasetBundle } | null = null;

/** Builds (and memoizes) the full procedural mock manifest + dataset bundle. */
export function getMockData(): { manifest: Manifest; bundle: DatasetBundle } {
  if (_cache) return _cache;
  const rng = mulberry32(SEED);
  const manifest = buildManifest();
  const points = buildPoints(rng);
  const bundle: DatasetBundle = {
    id: MOCK_DATASET_ID,
    meta: manifest.datasets[0],
    points,
    metrics: buildMetrics(rng),
    curves: buildCurves(rng),
    classStats: buildClassStats(rng, points),
    isLive: false,
  };
  _cache = { manifest, bundle };
  return _cache;
}
