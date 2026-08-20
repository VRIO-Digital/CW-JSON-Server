import type {
  ElementClass,
  Graph,
  GraphLink,
  GraphNode,
  LegendEntry,
  RawGraph,
  RawLink,
} from "../types";

/**
 * Colour per concept `type`. Unknown types fall through to the grey default.
 *
 * **These are measured against the viewer's ground, and the ground is white.** The nine it was
 * vendored with were GitHub's dark-mode hues — right on `#0d1117`, and every one of them between
 * 1.95:1 and 3.36:1 on a white page, which is a legend nobody can read and a node that dissolves
 * into the paper. So each hue was taken down to its ~5:1 shade on white, and `check-docs` re-measures
 * all nine against whatever `--bg` in `styles.css` actually says: change the ground and the run tells
 * you which marks stopped reading rather than leaving it to be noticed.
 *
 * **They sit in one luminance band on purpose.** Nine categories separated by lightness would collapse
 * the moment a reader has to tell two apart at 4.5px, so all nine land near 5:1 and are separated by
 * *hue* instead. That is also why Enforcement is orange rather than the second red it was: on a dark
 * ground `#f85149` and `#ff7b72` were told apart by being light and lighter, and neither can stay
 * light here.
 */
export const TYPE_COLORS: Record<string, string> = {
  Concept: "#1a7f37",
  Facility: "#0969da",
  Document: "#8250df",
  Manifest: "#a16207",
  Evaluation: "#0e7490",
  Violation: "#cf222e",
  Enforcement: "#c2410c",
  Alias: "#6b7280",
  Measure: "#be185d",

  /*
   * ---------------- the second dataset's ontology ----------------
   *
   * **A palette keyed by type name is per-ontology, and there are two.** The nine above are the primary
   * package's. CAPEX draws **18** types, of which only Concept, Document and Measure overlap — so
   * fifteen of them fell through to `DEFAULT_COLOR` and the legend was fifteen rows of one grey. That is
   * the "honest but silent" failure the palette claim exists to catch, reached for the dataset the claim
   * did not look at; `check-docs` now measures **both** canvases, so a third ontology fails the build
   * rather than drawing grey.
   *
   * **Generated, then written down.** Each hue is its type's rank in this list stepped by the golden
   * angle (137.5°), which is what guarantees separation — a per-name hash was tried first and put
   * `Contract` and `RateJurisdiction` 0.2° apart — and each lightness was then walked down until the
   * colour clears **3.2:1** on the viewer's white ground. They are literals rather than a runtime
   * derivation so a designer can move one, which is what this table is for; the alternative needed the
   * whole type set at every call site, and that meant editing two more files inside a vendored folder.
   *
   * **What this cannot fix, stated rather than glossed.** Eighteen categories do not reliably separate by
   * hue at a 4.5px disc, whatever the values — the note above says nine is already the practical limit.
   * Six of these land in the yellow-green-teal arc because that is what fifteen evenly-spaced hues does.
   * The legend's per-type counts and its filter rows are how a reader isolates one type, and that is the
   * honest answer to a graph with this many; a palette cannot be it.
   */
  BudgetPlanVersion: "#be2d2d",
  BusinessUnit: "#26a14a",
  ChangeOrder: "#812dbe",
  Classification: "#9d8e25",
  Contract: "#2a9bb2",
  InServiceAsset: "#be2d7b",
  Person: "#45a126",
  PlanVintage: "#332dbe",
  Programme: "#be5d2d",
  Project: "#26a173",
  RateJurisdiction: "#b22dbe",
  Region: "#809924",
  RegulatoryDriver: "#2d75be",
  State: "#be2d4b",
  Vendor: "#27a532",
};

export const DEFAULT_COLOR = "#57606a";

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
