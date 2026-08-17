import type { Graph, GraphNode, SidebarTab } from "../types";
import { Banner } from "./Banner";
import { InspectPanel } from "./InspectPanel";
import { ModelPanel } from "./ModelPanel";

type Props = {
  graph: Graph;
  byId: Map<string, GraphNode>;
  selected: GraphNode | null;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onSelect: (nodeId: string) => void;
};

const TABS: { id: SidebarTab; label: string }[] = [
  { id: "detail", label: "Inspect" },
  { id: "model", label: "How it's built" },
];

export const Sidebar = ({
  graph,
  byId,
  selected,
  tab,
  onTabChange,
  onSelect,
}: Props) => (
  <div className="side">
    <header>
      <h1>VLS Knowledge Graph</h1>
      <div className="sub">
        {graph.subtitle ??
          `${graph.nodes.length} nodes · ${graph.links.length} edges · Context Weave extraction`}
      </div>
    </header>

    <Banner faithful={graph.faithful} note={graph.note} />

    <div className="tabs">
      {TABS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`tab${tab === id ? " on" : ""}`}
          onClick={() => onTabChange(id)}
        >
          {label}
        </button>
      ))}
    </div>

    <div className="side-body">
      {tab === "detail" ? (
        <InspectPanel graph={graph} byId={byId} node={selected} onSelect={onSelect} />
      ) : (
        <ModelPanel />
      )}
    </div>
  </div>
);
