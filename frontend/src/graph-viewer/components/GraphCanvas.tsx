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
  /**
   * Clear everything the reader narrowed — the selection, the search and the type filters.
   *
   * **Passed in, because those three are React state one level up** and this component holds only
   * the camera. Together they are what *Reset view* means; see the button below for why splitting
   * them made it a dead control.
   */
  onClearView: () => void;
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
  onClearView,
  highlight = null,
}: Props) => {
  const { svgRef, resetCamera } = useForceGraph({
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

      {/*
        * **Reset view is both halves, and it used to be one.** It called the camera reset alone, so
        * pressing it with a node selected re-centred a graph that stayed dimmed around that node,
        * with the Inspect panel still on it — a button that visibly does nothing, which is how it
        * was reported. Everything that changed what is on screen is undone together: the zoom and
        * pan, the layout's drift, the selected neighbourhood, the search and the hidden types.
        *
        * The camera is this component's and the other three are the page's, which is why it is two
        * calls rather than one. Neither half is a view reset on its own.
        */}
      <button
        type="button"
        className="reset"
        onClick={() => {
          resetCamera();
          onClearView();
        }}
      >
        Reset view
      </button>

      <div className="hint">
        Drag · scroll to zoom · click a node to inspect · click legend to filter
      </div>
    </div>
  );
};
