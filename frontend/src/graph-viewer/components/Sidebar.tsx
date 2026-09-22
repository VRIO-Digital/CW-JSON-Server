import type { Graph, GraphNode } from "../types";
import { Banner } from "./Banner";
import { InspectPanel } from "./InspectPanel";

type Props = {
  graph: Graph;
  byId: Map<string, GraphNode>;
  selected: GraphNode | null;
  onSelect: (nodeId: string) => void;
};

/**
 * The viewer's side panel — **one panel now, so no tab bar.**
 *
 * It had two, *Inspect* and *How it's built*, and the second was **removed on request**. Its copy was
 * a reconstruction of one package's extraction passes, naming Facility, Manifest, Evaluation,
 * Violation, Enforcement and `REGISTRY_ID / PGM_SYS_ID` — so under CAPEX, whose graph holds Projects,
 * Contracts, Vendors and Change Orders, it described a pipeline that had not run over entities that
 * do not exist. Authored prose asserting another tenant's graph is the transcribed-figure fault in
 * words, and it is the one thing on this panel a reader could not check against the drawing beside it.
 *
 * **The tab bar went with it rather than being left holding one tab**: a control that switches to
 * nothing is a control, and it would invite the panel back. Inspect is now simply what the side is.
 */
export const Sidebar = ({ graph, byId, selected, onSelect }: Props) => (
  <div className="side">
    <header>
      <h1>Knowledge Graph</h1>
      <div className="sub">
        {graph.subtitle ??
          `${graph.nodes.length} nodes · ${graph.links.length} edges · Context Weave extraction`}
      </div>
    </header>

    <Banner faithful={graph.faithful} note={graph.note} />

    <div className="side-body">
      <InspectPanel graph={graph} byId={byId} node={selected} onSelect={onSelect} />
    </div>
  </div>
);
