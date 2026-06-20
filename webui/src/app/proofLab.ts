// ───────────────────────────────────────────────────────────────────────────
// proofLab.ts — orchestrates the 3 KPI "proof" runs that map directly onto the
// problem-statement targets, using the bundled REAL demo captures in
// webui/public/demo/ and the live server.
//
//   ① Intra : Netflix vs YouTube  → both video_on_demand, cosine > 0.7
//   ② Inter : Streaming vs Gaming → different classes,    cosine < 0.3
//   ③ Degraded: a flow + a degraded copy → same class (robust to RTT/jitter/loss)
// ───────────────────────────────────────────────────────────────────────────

import { inferPcapOnServer, type InferSummary } from '../data/server';
import { useStore } from './store';

export async function fetchDemoPcap(name: string): Promise<File> {
  const res = await fetch(`${import.meta.env.BASE_URL}demo/demo_${name}.pcap`);
  const buf = await res.arrayBuffer();
  return new File([buf], `demo_${name}.pcap`, { type: 'application/octet-stream' });
}

/** Cosine similarity of two L2-normalised embeddings (rep_embedding from the server). */
export function cosine(a?: number[] | null, b?: number[] | null): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? dot / d : null;
}

export async function inferDemo(
  name: string, degrade?: Record<string, number>): Promise<InferSummary | null> {
  const file = await fetchDemoPcap(name);
  const r = await inferPcapOnServer(file, degrade);
  await useStore.getState().refreshBundle();   // pull the newly-landed points into the galaxy
  return r?.summary ?? null;
}

export const DEMO_LABELS: Record<string, string> = {
  netflix: 'Netflix', youtube: 'YouTube', gaming: 'Cloud Gaming',
};
