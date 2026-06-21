// ───────────────────────────────────────────────────────────────────────────
// proofLab.ts — helpers for the three KPI "proof" runs (manual .pcap upload):
//   • Compare two captures  → intra cosine > 0.7 (same type) / inter < 0.3 (different)
//   • Degraded flow         → upload ONE capture; the server degrades it and re-classifies
// All runs use the live model via /api/infer.
// ───────────────────────────────────────────────────────────────────────────

import { inferPcapOnServer, type InferSummary } from '../data/server';
import { useStore } from './store';

/** Classify one uploaded file via the live server; optionally degrade first.
 *  Returns the per-capture summary (dominant type, breakdown, rep_embedding) or
 *  null if the server is unreachable. */
export async function inferFile(
  file: File, degrade?: Record<string, number>): Promise<InferSummary | null> {
  const r = await inferPcapOnServer(file, degrade);
  await useStore.getState().refreshBundle();   // show the newly-landed points in the galaxy
  return r?.summary ?? null;
}

/** Cosine similarity of two L2-normalised embeddings (rep_embedding from the server). */
export function cosine(a?: number[] | null, b?: number[] | null): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? dot / d : null;
}

/** Convenience: load a bundled sample capture (webui/public/demo) into a slot. */
export async function fetchDemoPcap(name: string): Promise<File> {
  const res = await fetch(`${import.meta.env.BASE_URL}demo/demo_${name}.pcap`);
  const buf = await res.arrayBuffer();
  return new File([buf], `demo_${name}.pcap`, { type: 'application/octet-stream' });
}
