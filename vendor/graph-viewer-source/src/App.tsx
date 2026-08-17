import { useCallback, useMemo, useState } from "react";

import { GraphCanvas } from "./components/GraphCanvas";
import { Sidebar } from "./components/Sidebar";
import { RAW_GRAPH } from "./data/graph-data";
import { buildLegend, normalizeGraph } from "./lib/graph";
import type { SidebarTab } from "./types";

export const App = () => {
  const graph = useMemo(() => normalizeGraph(RAW_GRAPH), []);
  const byId = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph],
  );
  const legend = useMemo(() => buildLegend(graph.nodes), [graph]);

  const [query, setQuery] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<SidebarTab>("detail");

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const select = useCallback((nodeId: string | null) => {
    setSelectedId(nodeId);
    if (nodeId) setTab("detail");
  }, []);

  return (
    <div className="app">
      <GraphCanvas
        graph={graph}
        legend={legend}
        hiddenTypes={hiddenTypes}
        query={query}
        selectedId={selectedId}
        onQueryChange={setQuery}
        onToggleType={toggleType}
        onSelect={select}
      />

      <Sidebar
        graph={graph}
        byId={byId}
        selected={selectedId ? byId.get(selectedId) ?? null : null}
        tab={tab}
        onTabChange={setTab}
        onSelect={select}
      />
    </div>
  );
};
