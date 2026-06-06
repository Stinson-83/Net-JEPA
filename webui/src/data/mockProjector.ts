// ───────────────────────────────────────────────────────────────────────────
// mockProjector — deterministic feature → (x,y) UMAP placeholder.
//
// Net-JEPA's real projection path is: encoder → embedding z ∈ R^d → UMAP
// transform(z) → (x,y). We don't ship a UMAP transformer (or the encoder) to
// the browser, so until an ONNX export exists we approximate the *shape* of
// that pipeline with something that:
//
//   1. is a pure function of the flow's derived features (same pcap → same
//      point, every time — "Replay last injection" must be reproducible),
//   2. lands the point inside a class cluster that is plausible given the
//      flow's coarse statistics (so it doesn't look random next to the real
//      embeddings), and
//   3. reports a confidence that degrades the further the synthetic point
//      sits from its assigned cluster's centroid — mirroring how a real
//      k-NN / softmax head would behave near decision boundaries.
//
// Swap this out for real inference later by giving `projectToUMAP` the same
// signature backed by `onnxruntime-web`: run the exported encoder, run the
// exported UMAP `transform`, return {x, y, label, confidence} from the model
// instead of from heuristics. Every call site already awaits a Promise.
// ───────────────────────────────────────────────────────────────────────────

import type { InjectedFlow, ProjectionResult, UmapPoint } from './types';
import { mulberry32, gaussian, seedFromString, clamp } from './rng';

export interface ProjectorContext {
  points: UmapPoint[];
  classes: string[];
}

interface Centroid {
  label: string;
  cx: number;
  cy: number;
  spread: number;
  n: number;
}

function computeCentroids(points: UmapPoint[], classes: string[]): Centroid[] {
  return classes.map((label) => {
    const members = points.filter((p) => p.label === label);
    if (members.length === 0) return { label, cx: 0, cy: 0, spread: 1, n: 0 };
    const cx = members.reduce((s, p) => s + p.x, 0) / members.length;
    const cy = members.reduce((s, p) => s + p.y, 0) / members.length;
    const variance = members.reduce((s, p) => s + (p.x - cx) ** 2 + (p.y - cy) ** 2, 0) / members.length;
    return { label, cx, cy, spread: Math.sqrt(variance) || 1, n: members.length };
  }).filter((c) => c.n > 0);
}

/**
 * Cheap, order-stable "feature score" used to rank which cluster a flow most
 * resembles. Not a real classifier — just enough structure that, e.g., a
 * bursty-small-packet flow tends toward the Gaming/IoT side of the space and
 * a steady-large-packet flow tends toward Streaming/FileTransfer, so the demo
 * "makes sense" to someone watching over your shoulder.
 */
function featureScore(flow: InjectedFlow, centroid: Centroid, rng: () => number): number {
  const sizeTerm = -Math.abs(flow.avgPacketSize - (300 + centroid.cx * 40));
  const rateTerm = -Math.abs(flow.packetRate - (8 + Math.abs(centroid.cy) * 1.5));
  const jitterTerm = -Math.abs(flow.jitterMs - (10 + centroid.spread * 6));
  return sizeTerm * 0.6 + rateTerm * 4 + jitterTerm * 1.2 + gaussian(rng, 0, 18);
}

export async function projectToUMAP(
  flow: InjectedFlow,
  ctx: ProjectorContext,
): Promise<ProjectionResult> {
  // Deterministic seed from the flow's *content* (not its random id) so the
  // same pcap always lands in the same place — "Replay" must be exact.
  const contentKey = `${flow.tuple.srcIp}:${flow.tuple.srcPort}>${flow.tuple.dstIp}:${flow.tuple.dstPort}` +
    `|${flow.packetCount}|${flow.avgPacketSize.toFixed(2)}|${flow.durationS.toFixed(3)}|${flow.rttMs ?? -1}`;
  const rng = mulberry32(seedFromString(contentKey));

  const centroids = computeCentroids(ctx.points, ctx.classes);
  if (centroids.length === 0) {
    // No reference cloud yet (e.g. manifest present but embeddings missing) —
    // place the point near the origin with low confidence.
    return { x: gaussian(rng, 0, 3), y: gaussian(rng, 0, 3), label: ctx.classes[0] ?? 'unknown', confidence: 0.4 };
  }

  let best = centroids[0];
  let bestScore = -Infinity;
  for (const c of centroids) {
    const s = featureScore(flow, c, rng);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }

  // Sample a point inside (mostly) the chosen cluster — slightly tighter than
  // the training cloud's spread so injected points read as "a single sample"
  // rather than "another whole cluster".
  const radius = best.spread * (0.35 + rng() * 0.55);
  const angle = rng() * Math.PI * 2;
  const x = best.cx + Math.cos(angle) * radius + gaussian(rng, 0, best.spread * 0.12);
  const y = best.cy + Math.sin(angle) * radius + gaussian(rng, 0, best.spread * 0.12);

  const distNorm = Math.hypot(x - best.cx, y - best.cy) / Math.max(best.spread, 1e-6);
  const confidence = clamp(0.95 - distNorm * 0.22 + gaussian(rng, 0, 0.03), 0.42, 0.99);

  // Simulate "model latency" so the Pipeline Theatre's projection stage has
  // something to resolve toward — mirrors the async ONNX path this will become.
  await new Promise((r) => setTimeout(r, 220 + rng() * 180));

  return { x, y, label: best.label, confidence: Number(confidence.toFixed(4)) };
}
