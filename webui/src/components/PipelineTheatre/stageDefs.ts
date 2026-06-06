import type { ReactElement } from 'react';
import {
  Radio,
  Workflow,
  Ruler,
  Clock,
  Network,
  Waves,
  Merge,
  Boxes,
  Orbit,
  type LucideIcon,
} from 'lucide-react';
import type { AnimationStageId } from '../../data/types';
import {
  IngestViz,
  FlowConstructionViz,
  FeatureReprViz,
  TemporalEncoderViz,
  ContextEncoderViz,
  WaveletEncoderViz,
  FusionViz,
  EmbeddingViz,
  ProjectionViz,
  type VizProps,
} from './stages/stageVisuals';

export interface StageDef {
  id: AnimationStageId;
  label: string;
  short: string;
  blurb: string;
  icon: LucideIcon;
}

/**
 * Narrative copy + iconography for each pipeline stage. Purely descriptive —
 * none of this depends on live data, so it's safe to keep static.
 */
export const STAGE_DEFS: Record<AnimationStageId, StageDef> = {
  ingest: {
    id: 'ingest',
    label: 'Raw PCAP Ingest',
    short: 'Ingest',
    blurb: 'Packets parsed in-browser, ordered by capture timestamp.',
    icon: Radio,
  },
  flow_construction: {
    id: 'flow_construction',
    label: 'Flow Construction',
    short: 'Flows',
    blurb: 'Packets grouped into bidirectional flows by 5-tuple.',
    icon: Workflow,
  },
  feature_repr: {
    id: 'feature_repr',
    label: 'Feature Representation',
    short: 'Features',
    blurb: 'Per-packet size, IAT and direction sequences vectorised.',
    icon: Ruler,
  },
  temporal_encoder: {
    id: 'temporal_encoder',
    label: 'Temporal Encoder',
    short: 'Temporal',
    blurb: 'Sequential attention over inter-arrival dynamics.',
    icon: Clock,
  },
  context_encoder: {
    id: 'context_encoder',
    label: 'Context Encoder',
    short: 'Context',
    blurb: 'Cross-flow relational context within the capture window.',
    icon: Network,
  },
  wavelet_encoder: {
    id: 'wavelet_encoder',
    label: 'Wavelet Encoder',
    short: 'Wavelet',
    blurb: 'Multi-resolution decomposition of burst structure.',
    icon: Waves,
  },
  fusion: {
    id: 'fusion',
    label: 'Cross-Attention Fusion',
    short: 'Fusion',
    blurb: 'Encoder streams merged via learned cross-attention.',
    icon: Merge,
  },
  embedding: {
    id: 'embedding',
    label: 'Embedding',
    short: 'Embedding',
    blurb: 'Flow collapsed to a single dense representation vector.',
    icon: Boxes,
  },
  projection: {
    id: 'projection',
    label: 'UMAP Projection',
    short: 'Projection',
    blurb: 'Embedding projected into 2D and placed on the live manifold.',
    icon: Orbit,
  },
};

export type LayoutNode =
  | { kind: 'single'; stage: AnimationStageId }
  | { kind: 'parallel'; stages: AnimationStageId[] };

/** Visual grouping — the three context encoders run concurrently on real input, so they render as one lane. */
export const PIPELINE_LAYOUT: LayoutNode[] = [
  { kind: 'single', stage: 'ingest' },
  { kind: 'single', stage: 'flow_construction' },
  { kind: 'single', stage: 'feature_repr' },
  { kind: 'parallel', stages: ['temporal_encoder', 'context_encoder', 'wavelet_encoder'] },
  { kind: 'single', stage: 'fusion' },
  { kind: 'single', stage: 'embedding' },
  { kind: 'single', stage: 'projection' },
];

/**
 * Lookup from stage id to its mini-viz component. Lives here (rather than
 * alongside the components in stageVisuals.tsx) so that file can stay
 * "components only" — keeping it a clean Fast Refresh boundary.
 */
export const STAGE_VIZ: Record<AnimationStageId, (p: VizProps) => ReactElement> = {
  ingest: IngestViz,
  flow_construction: FlowConstructionViz,
  feature_repr: FeatureReprViz,
  temporal_encoder: TemporalEncoderViz,
  context_encoder: ContextEncoderViz,
  wavelet_encoder: WaveletEncoderViz,
  fusion: FusionViz,
  embedding: EmbeddingViz,
  projection: ProjectionViz,
};
