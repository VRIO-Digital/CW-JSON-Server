import { ArrowLeftOutlined } from '@ant-design/icons'
import { Spin } from 'antd'
import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import GraphViewer from '../graph-viewer/App'
import { fromCombined } from '../data/studioCanvas'
import { useStudioStore } from '../store/studioStore'
import './GraphCanvasFullPage.css'
import { appPath } from '../api/dataset'

/*
 * The canvas, with the whole window.
 *
 * Reached from the studio's Canvas tab, in a new tab, so the studio keeps its place. It sits
 * *outside* `App` in the route table — the one page besides `/login` that does, and for the opposite
 * reason: `/login` has nothing to navigate to yet, and this has nothing to spare. It stays inside
 * `RequireAuth`, so an unauthenticated URL still redirects.
 *
 * **It is the same component on the same data**, not a second drawing — the vendored viewer in
 * `src/graph-viewer`, which the studio's Canvas tab also renders, over the same `fromCombined`
 * adapter. A full view that built its own graph would be a second truth, which is the thing this
 * whole surface exists to avoid.
 *
 * It draws the **combined** frame, because that is the one a reader opens a whole window for: both
 * lanes and the Bridge between them. The per-lane frames are a segmented control on the tab, where
 * switching between them is the point; here there is nothing to compare against.
 *
 * There is no nav entry, by the same rule as `/db`: it is reachable by URL and by the button, and
 * nothing about it belongs in a sidebar.
 */
export default function GraphCanvasFullPage() {
  const { useCaseId } = useParams<{ useCaseId: string }>()

  const useCases = useStudioStore((s) => s.useCases)
  const selected = useStudioStore((s) => s.useCaseId)
  const sgbGraph = useStudioStore((s) => s.sgbGraph)
  const entities = useStudioStore((s) => s.entities)
  const relations = useStudioStore((s) => s.relations)
  const typeLinks = useStudioStore((s) => s.typeLinks)
  const loading = useStudioStore((s) => s.loading)
  const error = useStudioStore((s) => s.error)
  const load = useStudioStore((s) => s.load)
  const select = useStudioStore((s) => s.select)

  /*
   * A cold start: this tab was opened directly, so nothing is loaded. The list comes first because
   * `select` refuses a use case it cannot find, and selecting is what loads the lanes.
   */
  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!useCaseId || selected === useCaseId) return
    if (!useCases.some((u) => u.useCaseId === useCaseId)) return
    select(useCaseId)
  }, [useCaseId, useCases, selected, select])

  const useCase = useCases.find((u) => u.useCaseId === useCaseId) ?? null
  const graph = useMemo(
    () => fromCombined({ structured: sgbGraph, entities, relations, typeLinks }),
    [sgbGraph, entities, relations, typeLinks],
  )

  const studioHref = appPath(`/graph-studio/${encodeURIComponent(useCaseId ?? '')}`)
  const ready = graph.nodes.length > 0

  return (
    <div className="gcf">
      <header className="gcf-head">
        {/* Back to the studio *in this tab*. The studio is still open in the tab that launched this
            one, but a reader who navigated here directly has no such tab, so the way back cannot be
            assumed. */}
        <Link className="gcf-back" to={studioHref}>
          <ArrowLeftOutlined aria-hidden="true" /> Graph Studio
        </Link>
        <div className="gcf-title">
          {useCase?.name ?? 'Loading…'}
          {useCase ? <span className="gcf-version"> · combined canvas</span> : null}
        </div>
        {ready ? (
          <div className="gcf-counts">
            {graph.nodes.length} elements · {graph.links.length} relationships
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="gcf-error">
          <ApiErrorAlert error={error} onRetry={() => void load()} />
        </div>
      ) : null}

      {loading && !ready ? (
        <div className="gcf-loading">
          <Spin />
        </div>
      ) : ready ? (
        /* One element, not a canvas column beside an inspector column: the viewer draws its own
           sidebar, and two inspectors would say the same things twice. */
        <div className="gcf-body">
          <GraphViewer graph={graph} />
        </div>
      ) : (
        <div className="gcf-loading">
          Nothing has been built for this use case yet — build it in Graph Studio.
        </div>
      )}
    </div>
  )
}
