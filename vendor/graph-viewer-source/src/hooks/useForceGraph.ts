import { useCallback, useEffect, useRef } from "react";
import * as d3 from "d3";

import { colorFor, edgeKey, neighborhoodOf, radiusFor } from "../lib/graph";
import type { Graph, GraphLink, GraphNode } from "../types";

type Selections = {
  link: d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown>;
  elabel: d3.Selection<SVGTextElement, GraphLink, SVGGElement, unknown>;
  node: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>;
};

type Options = {
  graph: Graph;
  hiddenTypes: Set<string>;
  query: string;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
};

const truncate = (text: string, max = 26) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Owns the d3-force simulation, zoom and drag behaviour for one <svg>.
 * The simulation is rebuilt only when `graph` changes; filtering, search and
 * selection are applied as class toggles on the existing selections so the
 * layout never restarts underneath the user.
 */
export const useForceGraph = ({
  graph,
  hiddenTypes,
  query,
  selectedId,
  onSelect,
}: Options) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const selectionsRef = useRef<Selections | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const onSelectRef = useRef(onSelect);

  onSelectRef.current = onSelect;

  // ── build: simulation, layers, zoom, drag ──────────────
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const root = svg.append("g");
    const linkLayer = root.append("g").attr("class", "links");
    const elabelLayer = root.append("g").attr("class", "elabels");
    const nodeLayer = root.append("g").attr("class", "nodes");

    // d3-force mutates the datums it is given, so hand it copies.
    const nodes: GraphNode[] = graph.nodes.map((n) => ({ ...n }));
    const links: GraphLink[] = graph.links.map((l) => ({ ...l }));

    const link = linkLayer
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links, (d) => edgeKey(d))
      .join("line")
      .attr("class", (d) => `link${d.aggregate ? " agg" : ""}`)
      .attr("stroke-width", (d) => (d.aggregate ? 1.2 : 1));

    const elabel = elabelLayer
      .selectAll<SVGTextElement, GraphLink>("text")
      .data(links, (d) => edgeKey(d))
      .join("text")
      .attr("class", "elabel")
      .text((d) => d.label);

    const node = nodeLayer
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes, (d) => d.id)
      .join("g")
      // `.big` promotes a label to bold white — concepts always, plus any hub
      // instance busy enough to be worth reading at default zoom.
      .attr(
        "class",
        (d) =>
          `node ${d.element_class}${
            d.element_class === "concept" || d.degree >= 8 ? " big" : ""
          }`,
      )
      .on("click", (event: PointerEvent, d) => {
        event.stopPropagation();
        onSelectRef.current(d.id);
      });

    node
      .append("circle")
      .attr("r", (d) => radiusFor(d))
      .attr("fill", (d) => colorFor(d.type));

    node
      .append("text")
      .attr("dy", (d) => -radiusFor(d) - 4)
      .attr("text-anchor", "middle")
      .text((d) => truncate(d.label));

    selectionsRef.current = { link, elabel, node };

    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance((d) => (d.aggregate ? 55 : 90))
          .strength(0.35),
      )
      .force("charge", d3.forceManyBody<GraphNode>().strength((d) => (d.element_class === "concept" ? -900 : -180)))
      .force("collide", d3.forceCollide<GraphNode>((d) => radiusFor(d) + 10))
      .force("center", d3.forceCenter(svgEl.clientWidth / 2, svgEl.clientHeight / 2))
      .on("tick", () => {
        link
          .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
          .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
          .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
          .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

        elabel
          .attr("x", (d) => (((d.source as GraphNode).x ?? 0) + ((d.target as GraphNode).x ?? 0)) / 2)
          .attr("y", (d) => (((d.source as GraphNode).y ?? 0) + ((d.target as GraphNode).y ?? 0)) / 2 - 2);

        node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });

    const drag = d3
      .drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.25).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag);

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 6])
      .on("zoom", (event) => root.attr("transform", event.transform.toString()));

    zoomRef.current = zoom;
    svg.call(zoom);

    return () => {
      simulation.stop();
      svg.on(".zoom", null);
      selectionsRef.current = null;
      zoomRef.current = null;
    };
  }, [graph]);

  // ── paint: type filter, search, selected neighbourhood ─
  useEffect(() => {
    const sel = selectionsRef.current;
    if (!sel) return;

    const needle = query.trim().toLowerCase();
    const hood = selectedId ? neighborhoodOf(selectedId, graph.links) : null;

    const visible = (d: GraphNode) => !hiddenTypes.has(d.type);
    const matches = (d: GraphNode) =>
      !needle ||
      d.label.toLowerCase().includes(needle) ||
      d.id.toLowerCase().includes(needle);
    const inHood = (d: GraphNode) => !hood || hood.nodes.has(d.id);

    sel.node.classed("dim", (d) => !visible(d) || !matches(d) || !inHood(d));

    const linkDimmed = (d: GraphLink) => {
      const s = d.source as GraphNode;
      const t = d.target as GraphNode;
      if (!visible(s) || !visible(t)) return true;
      if (hood) return !hood.edges.has(edgeKey(d));
      return Boolean(needle) && !matches(s) && !matches(t);
    };
    const linkHi = (d: GraphLink) => Boolean(hood) && hood!.edges.has(edgeKey(d));

    sel.link.classed("dim", linkDimmed).classed("hi", linkHi);
    sel.elabel.classed("dim", linkDimmed).classed("hi", linkHi);
  }, [graph, hiddenTypes, query, selectedId]);

  const resetView = useCallback(() => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom) return;
    d3.select(svgEl).transition().duration(400).call(zoom.transform, d3.zoomIdentity);
  }, []);

  return { svgRef, resetView };
};
