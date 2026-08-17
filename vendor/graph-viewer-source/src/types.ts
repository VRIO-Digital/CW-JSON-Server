import type { SimulationLinkDatum, SimulationNodeDatum } from "d3";

/** Matches the `element_class` discriminator used by the VLS extraction pipeline. */
export type ElementClass = "concept" | "thin_instance" | "measure";

export type SourceKey = {
  field: string;
  value: string;
};

/** Raw node as it appears in the exported `DATA.nodes` array. */
export type RawNode = {
  id: string;
  type: string;
  element_class: ElementClass;
  label: string;
  /** Concepts only. */
  definition?: string;
  members?: number;
  /** Instances only. */
  entity_type?: string;
  source_key?: SourceKey | null;
  subtype?: string;
  event_shape?: string;
  provenance?: string;
  /** Measures only. */
  value?: number | string;
  unit?: string;
  aggregation?: string;
  /** Optional L2 (derived / inferred) commentary rendered in the amber box. */
  l2?: string;
  [extra: string]: unknown;
};

/**
 * Raw edge as exported. The upstream export has used several names for the
 * predicate and for the "aggregate" flag, so all known spellings are accepted
 * and normalised in `normalizeGraph`.
 */
export type RawLink = {
  source: string;
  target: string;
  label?: string;
  predicate?: string;
  rel?: string;
  kind?: string;
  class?: string;
  aggregate?: boolean;
  provenance?: string;
  [extra: string]: unknown;
};

export type RawGraph = {
  nodes: RawNode[];
  links: RawLink[];
  /** When false the sidebar shows the amber "demo data" banner. */
  faithful?: boolean;
  subtitle?: string;
  note?: string;
};

export type GraphNode = RawNode &
  SimulationNodeDatum & {
    /** Degree, used for radius scaling. */
    degree: number;
  };

export type GraphLink = SimulationLinkDatum<GraphNode> & {
  source: GraphNode | string;
  target: GraphNode | string;
  /** Normalised predicate text drawn on the edge. */
  label: string;
  /** True for measure/rollup edges, drawn dashed pink. */
  aggregate: boolean;
  provenance?: string;
};

export type Graph = {
  nodes: GraphNode[];
  links: GraphLink[];
  faithful: boolean;
  subtitle?: string;
  note?: string;
};

export type LegendEntry = {
  type: string;
  color: string;
  count: number;
};

export type SidebarTab = "detail" | "model";
