import type {
  ElementClass,
  Graph,
  GraphLink,
  GraphNode,
  LegendEntry,
  RawGraph,
  RawLink,
} from "../types";

/** Colour per concept `type`. Unknown types fall through to the grey default. */
export const TYPE_COLORS: Record<string, string> = {
  Concept: "#3fb950",
  Facility: "#58a6ff",
  Document: "#a371f7",
  Manifest: "#e3b341",
  Evaluation: "#39c5cf",
  Violation: "#f85149",
  Enforcement: "#ff7b72",
  Alias: "#8b949e",
  Measure: "#db61a2",
};

export const DEFAULT_COLOR = "#6e7681";

export const colorFor = (type: string): string => TYPE_COLORS[type] ?? DEFAULT_COLOR;

/** Radius by element class — concepts read as hubs, instances as satellites. */
export const radiusFor = (node: { element_class: ElementClass; degree: number }): number => {
  if (node.element_class === "concept") return 13 + Math.min(6, node.degree * 0.15);
  if (node.element_class === "measure") return 6;
  return 4.5 + Math.min(4, node.degree * 0.4);
};

/** Structural so it accepts both raw (string endpoints) and simulation links. */
type EndpointPair = {
  source: string | { id: string };
  target: string | { id: string };
};

const linkId = (link: EndpointPair): string => {
  const s = typeof link.source === "string" ? link.source : link.source.id;
  const t = typeof link.target === "string" ? link.target : link.target.id;
  return `${s}->${t}`;
};

const predicateOf = (link: RawLink): string =>
  link.label ?? link.predicate ?? link.rel ?? link.kind ?? "";

const isAggregate = (link: RawLink): boolean =>
  link.aggregate === true || link.class === "agg" || link.kind === "aggregate";

/**
 * Turns the exported payload into simulation-ready data: drops edges whose
 * endpoints are missing, computes degree, and normalises the predicate label
 * and aggregate flag across the export's field-name variants.
 */
export const normalizeGraph = (raw: RawGraph): Graph => {
  const byId = new Map<string, GraphNode>();

  for (const node of raw.nodes) {
    byId.set(node.id, { ...node, degree: 0 });
  }

  const links: GraphLink[] = [];
  for (const link of raw.links ?? []) {
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    if (!source || !target) continue;

    source.degree += 1;
    target.degree += 1;
    links.push({
      source: source.id,
      target: target.id,
      label: predicateOf(link),
      aggregate: isAggregate(link),
      provenance: link.provenance,
    });
  }

  return {
    nodes: [...byId.values()],
    links,
    faithful: raw.faithful ?? false,
    subtitle: raw.subtitle,
    note: raw.note,
  };
};

/** Legend rows, ordered by descending count so the dominant types lead. */
export const buildLegend = (nodes: GraphNode[]): LegendEntry[] => {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, color: colorFor(type), count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
};

/** Ids of the clicked node plus everything one hop away. */
export const neighborhoodOf = (nodeId: string, links: GraphLink[]) => {
  const nodes = new Set<string>([nodeId]);
  const edges = new Set<string>();

  for (const link of links) {
    const s = typeof link.source === "string" ? link.source : link.source.id;
    const t = typeof link.target === "string" ? link.target : link.target.id;
    if (s !== nodeId && t !== nodeId) continue;
    nodes.add(s);
    nodes.add(t);
    edges.add(linkId(link));
  }

  return { nodes, edges };
};

export const edgeKey = linkId;

/** Incident edges of a node, resolved to the node on the far end. */
export type Relation = {
  direction: "out" | "in";
  label: string;
  other: GraphNode;
};

export const relationsOf = (
  nodeId: string,
  links: GraphLink[],
  byId: Map<string, GraphNode>,
): Relation[] => {
  const out: Relation[] = [];

  for (const link of links) {
    const s = typeof link.source === "string" ? link.source : link.source.id;
    const t = typeof link.target === "string" ? link.target : link.target.id;

    if (s === nodeId) {
      const other = byId.get(t);
      if (other) out.push({ direction: "out", label: link.label, other });
    } else if (t === nodeId) {
      const other = byId.get(s);
      if (other) out.push({ direction: "in", label: link.label, other });
    }
  }

  return out;
};
