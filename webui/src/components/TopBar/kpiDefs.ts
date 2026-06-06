// KPI pill definitions — wires the six headline numbers in the brief
// (Accuracy, Macro F1, Intra-cos, Inter-cos, CPU latency, GPU latency) to the
// `target value` thresholds called out in the project brief's "KPI targets"
// section. `direction` says which side of the target is "good": 'gte' for
// metrics where higher is better, 'lte' where lower is better (latencies,
// inter-class similarity — we *want* different classes to look different).
//
// Macro-F1 has no explicit target in the brief; 0.85 is a reasonable bar for
// a 6-class macro-averaged F1 sitting just under a ~90% accuracy target
// (macro F1 is dragged down by minority classes in a way accuracy isn't).
import type { KpiSpec, MetricsData } from '../../data/types';

export interface KpiDef {
  key: string;
  label: string;
  target: number;
  direction: 'gte' | 'lte';
  format: (v: number) => string;
  extract: (m: MetricsData) => number;
  hint: string;
}

export const KPI_DEFS: KpiDef[] = [
  {
    key: 'accuracy',
    label: 'Accuracy',
    target: 90,
    direction: 'gte',
    format: (v) => `${v.toFixed(1)}%`,
    extract: (m) => m.accuracy * 100,
    hint: 'k-NN downstream classification accuracy on held-out test flows',
  },
  {
    key: 'macro_f1',
    label: 'Macro F1',
    target: 0.85,
    direction: 'gte',
    format: (v) => v.toFixed(3),
    extract: (m) => m.macro_f1,
    hint: 'Unweighted mean F1 across all classes — sensitive to minority-class performance',
  },
  {
    key: 'intra_cos',
    label: 'Intra-cos',
    target: 0.7,
    direction: 'gte',
    format: (v) => v.toFixed(3),
    extract: (m) => m.intra_class_cos,
    hint: 'Mean cosine similarity between embeddings of the same class — higher = tighter clusters',
  },
  {
    key: 'inter_cos',
    label: 'Inter-cos',
    target: 0.3,
    direction: 'lte',
    format: (v) => v.toFixed(3),
    extract: (m) => m.inter_class_cos,
    hint: 'Mean cosine similarity between embeddings of different classes — lower = better separation',
  },
  {
    key: 'cpu_latency',
    label: 'CPU Lat',
    target: 100,
    direction: 'lte',
    format: (v) => `${v.toFixed(0)}ms`,
    extract: (m) => m.latency_ms_cpu,
    hint: 'p95 single-flow inference latency on CPU',
  },
  {
    key: 'gpu_latency',
    label: 'GPU Lat',
    target: 50,
    direction: 'lte',
    format: (v) => `${v.toFixed(0)}ms`,
    extract: (m) => m.latency_ms_gpu,
    hint: 'p95 single-flow inference latency on GPU',
  },
];

export function isMet(def: KpiDef, actual: number): boolean {
  return def.direction === 'gte' ? actual >= def.target : actual <= def.target;
}

/** +1 = improving toward target, -1 = regressing away from it, 0 = flat / no history */
export function deltaSign(def: KpiDef, delta: number): -1 | 0 | 1 {
  if (Math.abs(delta) < 1e-9) return 0;
  const improving = def.direction === 'gte' ? delta > 0 : delta < 0;
  return improving ? 1 : -1;
}

export function buildKpiSpecs(metrics: MetricsData | null, previous: MetricsData | null): KpiSpec[] {
  return KPI_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    unit: '',
    target: def.target,
    direction: def.direction,
    actual: metrics ? def.extract(metrics) : null,
    previous: previous ? def.extract(previous) : null,
    format: def.format,
  }));
}
