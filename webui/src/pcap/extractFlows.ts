// ───────────────────────────────────────────────────────────────────────────
// extractFlows — turns the flat packet list from `parsePcap` into a ranked
// list of `InjectedFlow`s: bidirectional 5-tuple groups with the same derived
// statistics (size/IAT/direction series, RTT, jitter, rate, …) Net-JEPA's
// real feature-extraction stage would compute from a captured flow.
//
// This is the seam where a production pipeline would hand off to the actual
// encoder; everything below it (featureVector → projectToUMAP) is heuristic
// placeholder until an exported model ships (see mockProjector.ts).
// ───────────────────────────────────────────────────────────────────────────

import type { FiveTuple, InjectedFlow, ParsedPacket } from '../data/types';
import { clamp } from '../data/rng';

/** Cap on how many distinct flows we'll surface in the picker — largest-by-packet-count win. */
const MAX_FLOWS = 24;

function endpointKey(ip: string, port: number): string {
  return `${ip}:${port}`;
}

/**
 * Collapse a directional 5-tuple to a canonical, order-independent form so
 * that A→B and B→A packets land in the same flow. The lexicographically
 * smaller `ip:port` endpoint becomes the canonical "src" — an arbitrary but
 * stable choice, which is all `direction` (relative to it) needs.
 */
function normalizeTuple(t: FiveTuple): FiveTuple {
  if (endpointKey(t.srcIp, t.srcPort) <= endpointKey(t.dstIp, t.dstPort)) return t;
  return { srcIp: t.dstIp, srcPort: t.dstPort, dstIp: t.srcIp, dstPort: t.srcPort, protocol: t.protocol };
}

function tupleKey(t: FiveTuple): string {
  return `${t.protocol}|${endpointKey(t.srcIp, t.srcPort)}|${endpointKey(t.dstIp, t.dstPort)}`;
}

interface RawPacket {
  tsSec: number;
  tsUsec: number;
  length: number;
  /** +1 if this packet travels canonical-src → canonical-dst, else -1 */
  direction: 1 | -1;
}

interface RawFlow {
  tuple: FiveTuple;
  packets: RawPacket[];
}

function groupFlows(packets: ParsedPacket[]): RawFlow[] {
  const flows = new Map<string, RawFlow>();
  for (const p of packets) {
    if (p.protocol === 'OTHER') continue; // no usable 5-tuple (ICMP, ARP, fragments, …)
    const raw: FiveTuple = { srcIp: p.srcIp, dstIp: p.dstIp, srcPort: p.srcPort, dstPort: p.dstPort, protocol: p.protocol };
    const canonical = normalizeTuple(raw);
    const key = tupleKey(canonical);
    let flow = flows.get(key);
    if (!flow) {
      flow = { tuple: canonical, packets: [] };
      flows.set(key, flow);
    }
    const direction: 1 | -1 = endpointKey(p.srcIp, p.srcPort) === endpointKey(canonical.srcIp, canonical.srcPort) ? 1 : -1;
    flow.packets.push({ tsSec: p.tsSec, tsUsec: p.tsUsec, length: p.length, direction });
  }
  return [...flows.values()];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Coarse RTT/jitter estimate that works without TCP timestamp options or
 * SYN/SYN-ACK pairing (real captures rarely hand you those cleanly):
 *   • RTT  ≈ median gap between a packet and the next one travelling the
 *            *opposite* direction — a request/response "turnaround" proxy.
 *   • Jitter ≈ stddev of inter-arrival times within the dominant direction,
 *              echoing RFC 3550's "variation in packet spacing" definition.
 */
function estimateRttAndJitter(packets: RawPacket[]): { rttMs: number | null; jitterMs: number } {
  const times = packets.map((p) => p.tsSec + p.tsUsec * 1e-6);

  const turnarounds: number[] = [];
  for (let i = 1; i < packets.length; i++) {
    if (packets[i].direction !== packets[i - 1].direction) turnarounds.push(times[i] - times[i - 1]);
  }
  const rttMs = turnarounds.length > 0 ? Number((median(turnarounds) * 1000).toFixed(2)) : null;

  const outCount = packets.reduce((n, p) => n + (p.direction === 1 ? 1 : 0), 0);
  const dominant: 1 | -1 = outCount * 2 >= packets.length ? 1 : -1;
  const sameDirGaps: number[] = [];
  let prevT: number | null = null;
  for (let i = 0; i < packets.length; i++) {
    if (packets[i].direction !== dominant) continue;
    if (prevT !== null) sameDirGaps.push(times[i] - prevT);
    prevT = times[i];
  }
  const jitterMs = Number((stdDev(sameDirGaps) * 1000).toFixed(2));

  return { rttMs, jitterMs };
}

interface FlowStats {
  packetSizes: number[];
  iat: number[];
  direction: number[];
  rttMs: number | null;
  jitterMs: number;
  durationS: number;
  packetRate: number;
  avgPacketSize: number;
}

/**
 * Compress the per-packet series into the same fixed-width summary the demo
 * projector consumes (`featureScore` reads avgPacketSize/packetRate/jitterMs
 * directly; this vector is the placeholder for what a real temporal/context
 * encoder would produce as its pre-projection embedding). Every term is
 * clamped to a small numeric range so the vector stays well-conditioned
 * regardless of how extreme the captured flow is.
 */
function buildFeatureVector(s: FlowStats): number[] {
  const sizeStd = stdDev(s.packetSizes);
  const gaps = s.iat.slice(1); // drop the leading 0 sentinel on the first packet
  const gapMean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const gapStd = stdDev(gaps);
  const outFraction = s.direction.length ? s.direction.filter((d) => d > 0).length / s.direction.length : 0.5;

  return [
    s.avgPacketSize / 1500,
    sizeStd / 1500,
    clamp(gapMean / 0.5, 0, 4),
    clamp(gapStd / 0.5, 0, 4),
    outFraction,
    clamp(s.durationS / 60, 0, 4),
    clamp(s.packetRate / 100, 0, 4),
    clamp((s.rttMs ?? 0) / 200, 0, 4),
    clamp(s.jitterMs / 50, 0, 4),
  ].map((v) => Number(v.toFixed(4)));
}

function buildInjectedFlow(flow: RawFlow, index: number): InjectedFlow {
  const sorted = [...flow.packets].sort((a, b) => a.tsSec - b.tsSec || a.tsUsec - b.tsUsec);
  const times = sorted.map((p) => p.tsSec + p.tsUsec * 1e-6);
  const t0 = times[0];

  const packetSizes = sorted.map((p) => p.length);
  const direction = sorted.map((p) => p.direction);
  const iat = times.map((t, i) => (i === 0 ? 0 : Number((t - times[i - 1]).toFixed(5))));
  const durationS = Number(Math.max(times[times.length - 1] - t0, 0).toFixed(3));
  const packetRate = Number((sorted.length / Math.max(durationS, 0.5)).toFixed(2));
  const avgPacketSize = Math.round(packetSizes.reduce((a, b) => a + b, 0) / packetSizes.length);
  const { rttMs, jitterMs } = estimateRttAndJitter(sorted);

  const stats: FlowStats = { packetSizes, iat, direction, rttMs, jitterMs, durationS, packetRate, avgPacketSize };
  const flowId = `pcap_${tupleKey(flow.tuple).replace(/[^a-zA-Z0-9]+/g, '_')}_${index}`;

  return {
    flowId,
    tuple: flow.tuple,
    packetCount: sorted.length,
    ...stats,
    featureVector: buildFeatureVector(stats),
  };
}

/**
 * Group a capture's packets into bidirectional flows, drop single-packet
 * noise (scans, retransmitted SYNs with no reply, …), and return the largest
 * `MAX_FLOWS` ranked by packet count — the ones most likely to read as a
 * coherent "session" worth animating through the pipeline.
 */
export function extractFlows(packets: ParsedPacket[]): InjectedFlow[] {
  return groupFlows(packets)
    .filter((f) => f.packets.length >= 2)
    .sort((a, b) => b.packets.length - a.packets.length)
    .slice(0, MAX_FLOWS)
    .map((f, i) => buildInjectedFlow(f, i));
}
