import { useForceGraph } from "../hooks/useForceGraph";
import type { Graph, LegendEntry } from "../types";
import { Controls } from "./Controls";

type Props = {
  graph: Graph;
  legend: LegendEntry[];
  hiddenTypes: Set<string>;
  query: string;
  selectedId: string | null;
  onQueryChange: (query: string) => void;
  onToggleType: (type: string) => void;
  onSelect: (nodeId: string | null) => void;
  /** The route an answer walked, lit until a node is clicked. See `useForceGraph`. */
  highlight?: { nodes: Set<string>; edges: Set<string> } | null;
};

export const GraphCanvas = ({
  graph,
  legend,
  hiddenTypes,
  query,
  selectedId,
  onQueryChange,
  onToggleType,
  onSelect,
  highlight = null,
}: Props) => {
  const { svgRef, resetView } = useForceGraph({
    graph,
    hiddenTypes,
    query,
    selectedId,
    onSelect,
    highlight,
  });

  return (
    <div className="graph">
      {/* Clicking the empty canvas clears the selected neighbourhood. */}
      <svg ref={svgRef} onClick={() => onSelect(null)} />

      <Controls
        legend={legend}
        hiddenTypes={hiddenTypes}
        query={query}
        onQueryChange={onQueryChange}
        onToggleType={onToggleType}
      />

      <button type="button" className="reset" onClick={resetView}>
        Reset view
      </button>

      <div className="hint">
        Drag · scroll to zoom · click a node to inspect · click legend to filter
      </div>
    </div>
  );
};
