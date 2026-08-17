import { useCallback, useMemo, useState } from 'react'

import { GraphCanvas } from './components/GraphCanvas'
import { Sidebar } from './components/Sidebar'
import { buildLegend, normalizeGraph } from './lib/graph'
import type { RawGraph, SidebarTab } from './types'
import './styles.css'

/**
 * The vendored graph viewer, root and all.
 *
 * Two things changed on the way in from `src/grap`, and nothing else:
 *
 * - **It takes its graph as a prop** instead of importing `RAW_GRAPH`. The demo dataset
 *   came with the folder; here the graph is the tenant's, adapted from
 *   `GET /graph-studio/:id/canvas` by `fromCanvas`. `main.tsx` and the standalone
 *   `index.html` were dropped for the same reason the report prototype's were: this app
 *   draws the page around it.
 * - **Its root carries `cw-graph`**, the class its stylesheet is scoped under. `.app` was
 *   the original root and set `height: 100vh`; the viewer now renders inside a studio tab
 *   as well as full-window, so the height comes from whatever contains it.
 *
 * Everything below this line is the viewer's own: `useForceGraph` owns the d3 simulation,
 * `lib/graph` owns the palette, the radius rule and the neighbourhood walk, and the
 * sidebar's two panels are its own. That is deliberate — it was vendored rather than
 * reimplemented, so its behaviour is the folder's behaviour.
 */
export const GraphViewer = ({
  graph: raw,
  highlight = null,
}: {
  graph: RawGraph
  /** The route an answer walked, lit until a node is clicked. */
  highlight?: { nodes: Set<string>; edges: Set<string> } | null
}) => {
  const graph = useMemo(() => normalizeGraph(raw), [raw])
  const byId = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph],
  )
  const legend = useMemo(() => buildLegend(graph.nodes), [graph])

  const [query, setQuery] = useState('')
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<SidebarTab>('detail')

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const select = useCallback((nodeId: string | null) => {
    setSelectedId(nodeId)
    if (nodeId) setTab('detail')
  }, [])

  return (
    <div className="cw-graph">
      <GraphCanvas
        graph={graph}
        legend={legend}
        hiddenTypes={hiddenTypes}
        query={query}
        selectedId={selectedId}
        onQueryChange={setQuery}
        onToggleType={toggleType}
        onSelect={select}
        highlight={highlight}
      />

      <Sidebar
        graph={graph}
        byId={byId}
        selected={selectedId ? (byId.get(selectedId) ?? null) : null}
        tab={tab}
        onTabChange={setTab}
        onSelect={select}
      />
    </div>
  )
}

export default GraphViewer
