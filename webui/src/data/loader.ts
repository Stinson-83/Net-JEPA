// ───────────────────────────────────────────────────────────────────────────
// loader.ts — fetches /public/data/* with graceful, file-by-file fallback.
//
// This is the single seam between "real training artifacts" and "the UI".
// Every fetch below is independently optional: a missing file degrades the
// relevant panel to a placeholder rather than breaking the page. Dropping a
// new manifest.json + sibling files into /public/data/ after a retrain is
// the *entire* update mechanism — nothing here needs to change.
//
// See README.md for the full on-disk contract and example payloads.
// ───────────────────────────────────────────────────────────────────────────

import type {
  ClassStat,
  DatasetBundle,
  FlowFeatureDetail,
  Manifest,
  MetricsData,
  TrainingCurvePoint,
  UmapPoint,
} from './types';
import { buildMockFlowDetail, getMockData } from './mockData';

const DATA_ROOT = `${import.meta.env.BASE_URL}data`.replace(/\/+/g, '/');

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function fetchBinary(path: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export function datasetRoot(datasetId: string): string {
  return `${DATA_ROOT}/${datasetId}`;
}

export async function loadManifest(): Promise<Manifest | null> {
  return fetchJson<Manifest>(`${DATA_ROOT}/manifest.json`);
}

interface LoadResult {
  manifest: Manifest;
  bundle: DatasetBundle;
  /** true if every artifact came from disk; false if any part fell back to mock/synthetic */
  isFullyLive: boolean;
}

/**
 * Loads the manifest + the bundle for `datasetId` (or the manifest's
 * `active_dataset` if omitted). Falls back to the procedural mock dataset
 * wholesale when manifest.json is absent, and field-by-field when individual
 * per-dataset files are missing.
 */
export async function loadApp(datasetId?: string): Promise<LoadResult> {
  const manifest = await loadManifest();
  if (!manifest) {
    const mock = getMockData();
    return { manifest: mock.manifest, bundle: mock.bundle, isFullyLive: false };
  }

  const id = datasetId ?? manifest.active_dataset ?? manifest.datasets[0]?.id;
  const bundle = await loadDatasetBundle(manifest, id);
  return { manifest, bundle, isFullyLive: bundle.isLive };
}

export async function loadDatasetBundle(manifest: Manifest, datasetId: string): Promise<DatasetBundle> {
  const root = datasetRoot(datasetId);
  const meta = manifest.datasets.find((d) => d.id === datasetId) ?? null;

  const [points, metrics, curves, classStats] = await Promise.all([
    fetchJson<UmapPoint[]>(`${root}/embeddings_umap.json`),
    fetchJson<MetricsData>(`${root}/metrics.json`),
    fetchJson<TrainingCurvePoint[]>(`${root}/training_curves.json`),
    fetchJson<ClassStat[]>(`${root}/class_stats.json`),
  ]);

  const anyLive = Boolean(points || metrics || curves || classStats);

  // Partial-mock fallback: if this dataset has *some* real artifacts but is
  // missing others (e.g. you exported embeddings before metrics finished
  // computing), backfill only the missing pieces from the mock generator
  // rather than discarding what's real.
  const mock = points && metrics && curves && classStats ? null : getMockData();

  return {
    id: datasetId,
    meta,
    points: points ?? mock!.bundle.points,
    metrics: metrics ?? (anyLive ? null : mock!.bundle.metrics),
    curves: curves ?? (anyLive ? [] : mock!.bundle.curves),
    classStats: classStats ?? (anyLive ? [] : mock!.bundle.classStats),
    isLive: anyLive,
  };
}

/**
 * Lazily loads one flow's detail JSON on point-click. Falls back to a
 * procedurally-synthesized detail (seeded by flow id, so it's stable across
 * clicks) when the per-flow file doesn't exist yet — this is the slowest
 * artifact to export in bulk, so graceful degradation matters most here.
 */
export async function loadFlowDetail(
  datasetId: string,
  flowId: string,
  fallbackPoints: UmapPoint[],
): Promise<FlowFeatureDetail | null> {
  const path = `${datasetRoot(datasetId)}/flow_features/${encodeURIComponent(flowId)}.json`;
  const real = await fetchJson<FlowFeatureDetail>(path);
  if (real) return real;

  const point = fallbackPoints.find((p) => p.id === flowId);
  if (!point) return null;
  return buildMockFlowDetail(point, fallbackPoints);
}

/** Optional Float32Array of full d-dim embeddings — used for cosine-sim queries. Returns null if absent. */
export async function loadRawEmbeddings(datasetId: string, embeddingDim: number): Promise<Float32Array | null> {
  const buf = await fetchBinary(`${datasetRoot(datasetId)}/embeddings_raw.bin`);
  if (!buf) return null;
  if (embeddingDim > 0 && buf.byteLength % (embeddingDim * 4) !== 0) return null;
  return new Float32Array(buf);
}
