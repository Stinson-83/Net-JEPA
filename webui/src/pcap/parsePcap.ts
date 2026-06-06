// ───────────────────────────────────────────────────────────────────────────
// parsePcap — minimal in-browser binary reader for the classic libpcap
// (".pcap") capture format. Everything happens client-side via DataView; no
// bytes ever leave the browser.
//
// We deliberately support only the classic format (global header magic
// 0xa1b2c3d4 family) and reject pcapng (magic 0x0a0d0d0a) with guidance,
// since pcapng's block-based layout is a different parser entirely and the
// vast majority of tcpdump/Wireshark exports can be converted with one
// command (`editcap -F pcap in.pcapng out.pcap`).
//
// Reference: https://wiki.wireshark.org/Development/LibpcapFileFormat
// ───────────────────────────────────────────────────────────────────────────

import type { ParsedPacket } from '../data/types';

export class PcapParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PcapParseError';
  }
}

/** Hard cap so a multi-GB capture can't hang the tab — we only need "a few representative flows". */
const MAX_PACKETS = 20_000;

const GLOBAL_HEADER_LEN = 24;
const RECORD_HEADER_LEN = 16;

// Magic numbers for the four byte-order / timestamp-resolution variants of
// the classic format. `usecScale` converts the header's fractional-second
// field to microseconds (nanosecond captures store 0–999_999_999).
//
// We always read the candidate magic as big-endian first (`magicBE` below).
// A *little-endian* writer stores the canonical 0xa1b2c3d4 LSB-first, i.e. as
// file bytes d4 c3 b2 a1 — which a big-endian read reports as 0xd4c3b2a1 (the
// "swapped" form). So the swapped key is the one that means "this file is
// little-endian" — the overwhelmingly common case (every x86/x86_64/ARM
// capture, i.e. virtually all real tcpdump/Wireshark exports).
const MAGIC_VARIANTS: Record<number, { littleEndian: boolean; usecScale: number }> = {
  0xa1b2c3d4: { littleEndian: false, usecScale: 1 },
  0xd4c3b2a1: { littleEndian: true, usecScale: 1 },
  0xa1b23c4d: { littleEndian: false, usecScale: 1 / 1000 }, // nanosecond-resolution (big-endian writer)
  0x4d3cb2a1: { littleEndian: true, usecScale: 1 / 1000 }, // nanosecond-resolution (little-endian writer)
};

const PCAPNG_MAGIC = 0x0a0d0d0a;

/** Bytes consumed by the link-layer header before the IP packet begins, keyed by `network` (LINKTYPE_*). */
const LINK_HEADER_LENGTH: Record<number, number> = {
  1: 14, // LINKTYPE_ETHERNET
  12: 0, // LINKTYPE_RAW (Linux "raw IP")
  101: 0, // LINKTYPE_RAW (BSD variant some tools emit)
  113: 16, // LINKTYPE_LINUX_SLL ("cooked" capture — e.g. `any` interface)
};

const ETHERTYPE_IPV4 = 0x0800;
const ETHERTYPE_VLAN = 0x8100;
const ETHERTYPE_QINQ = 0x88a8;

function formatIPv4(view: DataView, offset: number): string {
  return `${view.getUint8(offset)}.${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}.${view.getUint8(offset + 3)}`;
}

interface IPv4Info {
  srcIp: string;
  dstIp: string;
  protocol: number;
  /** byte offset of the start of the L4 payload (after the variable-length IHL) */
  l4Offset: number;
  /** total IP packet length, used to bound L4 parsing within the captured slice */
  totalLength: number;
}

function parseIPv4(view: DataView, offset: number, available: number): IPv4Info | null {
  if (available < 20) return null;
  const verIhl = view.getUint8(offset);
  if (verIhl >> 4 !== 4) return null; // not IPv4
  const ihl = (verIhl & 0x0f) * 4;
  if (ihl < 20 || available < ihl) return null;
  return {
    srcIp: formatIPv4(view, offset + 12),
    dstIp: formatIPv4(view, offset + 16),
    protocol: view.getUint8(offset + 9),
    l4Offset: offset + ihl,
    totalLength: view.getUint16(offset + 2, false),
  };
}

interface FrameResult {
  srcIp: string;
  dstIp: string;
  srcPort: number;
  dstPort: number;
  protocol: 'TCP' | 'UDP' | 'OTHER';
  tcpFlags?: number;
}

/**
 * Walk a single captured frame: strip the link-layer header (resolving VLAN
 * tags so 802.1Q-tagged Ethernet still finds its IPv4 ethertype), parse the
 * IPv4 header, then pull ports (+TCP flags) from the L4 header. Returns null
 * for anything that isn't an IPv4/TCP/UDP frame — those packets are still
 * counted toward the capture but don't contribute a flow 5-tuple.
 */
function parseFrame(view: DataView, frameOffset: number, capturedLength: number, network: number): FrameResult | null {
  const linkLen = LINK_HEADER_LENGTH[network];
  if (linkLen === undefined) return null; // unsupported link-layer type — skip silently

  let offset = frameOffset + linkLen;
  let remaining = capturedLength - linkLen;
  if (remaining < 14) return null;

  // For Ethernet (and SLL), resolve the ethertype/proto-type field, walking past
  // up to two VLAN tags. Ethernet carries it at byte 12 of its 14-byte header
  // (after the 6+6 dst/src MACs); SLL carries it in the last two bytes of its
  // 16-byte header (byte 14). Both computed from `frameOffset` directly — not
  // from the link-length-advanced `offset` — since `linkLen` is the length of
  // the *untagged* header and would put us past the field once VLAN is involved.
  if (network === 1 || network === 113) {
    const ethertypeOffset = network === 1 ? frameOffset + 12 : frameOffset + 14;
    let etOff = ethertypeOffset;
    let ethertype = view.getUint16(etOff, false);
    let guard = 0;
    while ((ethertype === ETHERTYPE_VLAN || ethertype === ETHERTYPE_QINQ) && guard < 2) {
      etOff += 4;
      ethertype = view.getUint16(etOff, false);
      guard++;
    }
    if (ethertype !== ETHERTYPE_IPV4) return null;
    offset = etOff + 2; // the IPv4 packet begins immediately after this ethertype/proto field
    remaining = frameOffset + capturedLength - offset;
  }

  if (remaining < 20) return null;
  const ip = parseIPv4(view, offset, remaining);
  if (!ip) return null;

  const l4Available = Math.min(remaining - (ip.l4Offset - offset), ip.totalLength - (ip.l4Offset - offset));
  if (ip.protocol === 6 /* TCP */ && l4Available >= 20) {
    return {
      srcIp: ip.srcIp,
      dstIp: ip.dstIp,
      srcPort: view.getUint16(ip.l4Offset, false),
      dstPort: view.getUint16(ip.l4Offset + 2, false),
      protocol: 'TCP',
      tcpFlags: view.getUint8(ip.l4Offset + 13),
    };
  }
  if (ip.protocol === 17 /* UDP */ && l4Available >= 8) {
    return {
      srcIp: ip.srcIp,
      dstIp: ip.dstIp,
      srcPort: view.getUint16(ip.l4Offset, false),
      dstPort: view.getUint16(ip.l4Offset + 2, false),
      protocol: 'UDP',
    };
  }
  return {
    srcIp: ip.srcIp,
    dstIp: ip.dstIp,
    srcPort: 0,
    dstPort: 0,
    protocol: 'OTHER',
  };
}

export interface PcapParseResult {
  packets: ParsedPacket[];
  /** true if we stopped early at MAX_PACKETS — the UI should mention the capture was sampled */
  truncated: boolean;
  linkType: number;
}

/**
 * Parse a classic-format `.pcap` ArrayBuffer into a flat list of per-packet
 * 5-tuple + timing records. Throws `PcapParseError` with a UI-friendly
 * message for anything that isn't a classic libpcap capture.
 */
export function parsePcap(buffer: ArrayBuffer): PcapParseResult {
  if (buffer.byteLength < GLOBAL_HEADER_LEN) {
    throw new PcapParseError('File is too small to be a .pcap capture.');
  }
  const view = new DataView(buffer);
  const magicBE = view.getUint32(0, false);

  if (magicBE === PCAPNG_MAGIC) {
    throw new PcapParseError(
      'This is a pcapng capture. Only classic .pcap (libpcap) format is supported — re-export with `editcap -F pcap in.pcapng out.pcap` or "Save As → .pcap" in Wireshark.',
    );
  }
  const variant = MAGIC_VARIANTS[magicBE] ?? MAGIC_VARIANTS[view.getUint32(0, true)];
  if (!variant) {
    throw new PcapParseError('Unrecognised file header — this does not look like a .pcap capture.');
  }
  const le = variant.littleEndian;

  const versionMajor = view.getUint16(4, le);
  const versionMinor = view.getUint16(6, le);
  if (versionMajor !== 2) {
    throw new PcapParseError(`Unsupported pcap version ${versionMajor}.${versionMinor} (expected 2.x).`);
  }
  const network = view.getUint32(20, le);

  const packets: ParsedPacket[] = [];
  let offset = GLOBAL_HEADER_LEN;
  let truncated = false;

  while (offset + RECORD_HEADER_LEN <= buffer.byteLength) {
    const tsSec = view.getUint32(offset, le);
    const tsFrac = view.getUint32(offset + 4, le);
    const capturedLength = view.getUint32(offset + 8, le);
    const wireLength = view.getUint32(offset + 12, le);
    const frameOffset = offset + RECORD_HEADER_LEN;

    if (capturedLength > 262_144 || frameOffset + capturedLength > buffer.byteLength) {
      // A corrupt/truncated record header would otherwise send us off the end
      // of the buffer (or looping on garbage lengths) — stop cleanly here.
      break;
    }

    const frame = parseFrame(view, frameOffset, capturedLength, network);
    packets.push({
      tsSec,
      tsUsec: Math.round(tsFrac * variant.usecScale),
      length: wireLength,
      srcIp: frame?.srcIp ?? '0.0.0.0',
      dstIp: frame?.dstIp ?? '0.0.0.0',
      srcPort: frame?.srcPort ?? 0,
      dstPort: frame?.dstPort ?? 0,
      protocol: frame?.protocol ?? 'OTHER',
      tcpFlags: frame?.tcpFlags,
    });

    offset = frameOffset + capturedLength;
    if (packets.length >= MAX_PACKETS) {
      truncated = offset + RECORD_HEADER_LEN <= buffer.byteLength;
      break;
    }
  }

  if (packets.length === 0) {
    throw new PcapParseError('No packet records found in this capture.');
  }
  return { packets, truncated, linkType: network };
}
