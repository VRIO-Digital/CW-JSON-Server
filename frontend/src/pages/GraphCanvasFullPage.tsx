import { ArrowLeftOutlined } from '@ant-design/icons'
import { Spin } from 'antd'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import GraphViewer from '../graph-viewer/App'
import { answerPath, fromCanvas } from '../graph-viewer/fromCanvas'
import { useGraphStudioStore } from '../store/graphStudioStore'
import './GraphCanvasFullPage.css'
import './GraphStudioPage.css'
import { appPath } from '../api/dataset'

/*
 * The canvas, with the whole window.
 *
 * Reached only from the **Full view** button on the studio's Canvas tab, in a new tab,
 * so the studio keeps its place. It sits *outside* `App` in the route table — the one
 * page besides `/login` that does, and for the opposite reason: `/login` has nothing to
 * navigate to yet, and this has nothing to spare. 189 nodes want the sidebar's 240px.
 * It stays inside `RequireAuth`, so an unauthenticated URL still redirects.
 *
 * **It is the same component on the same data**, not a second drawing — the vendored
 * viewer in `src/graph-viewer`, which the studio's Canvas tab also renders. The canvas, its
 * inspector, its legend, its search and its zoom are all the viewer's; what differs here is
 * the frame. A full view that rendered its own graph would be a second truth, which is the
 * thing this whole surface is built to avoid, and after the viewer replaced the
 * hand-written SVG there is only one canvas component left in the app to render.
 *
 * There is no nav entry, by the same rule as `/db`: it is reachable by URL and by the
 * button, and nothing about it belongs in a sidebar.
 */
export default function GraphCanvasFullPage() {
  const { useCaseId } = useParams<{ useCaseId: string }>()
  const data = useGraphStudioStore((s) => s.data)
  const canvas = useGraphStudioStore((s) => s.canvas)
  const canvasLoading = useGraphStudioStore((s) => s.canvasLoading)
  const error = useGraphStudioStore((s) => s.error)
  const open = useGraphStudioStore((s) => s.open)
  const loadCanvas = useGraphStudioStore((s) => s.loadCanvas)

  /*
   * Both calls, and in this order: `open` is what sets the store's `useCaseId`, which
   * `loadCanvas` reads to know which graph to fetch. It also brings the name and the
   * version for the header — this tab is a cold start, so nothing is already loaded.
   */
  useEffect(() => {
    if (!useCaseId) return
    void (async () => {
      await open(useCaseId)
      await loadCanvas()
    })()
  }, [useCaseId, open, loadCanvas])

  const studioHref = appPath(`/graph-studio/${encodeURIComponent(useCaseId ?? '')}`)

  return (
    <div className="gcf">
      <header className="gcf-head">
        {/* Back to the studio *in this tab*. The studio is still open in the tab that
            launched this one, but a reader who navigated here directly has no such
            tab, so the way back cannot be assumed. */}
        <Link className="gcf-back" to={studioHref}>
          <ArrowLeftOutlined aria-hidden="true" /> Graph Studio
        </Link>
        <div className="gcf-title">
          {data?.graphName ?? 'Loading…'}
          {data ? <span className="gcf-version"> · draft {data.version}</span> : null}
        </div>
        {canvas ? (
          <div className="gcf-counts">
            {canvas.nodeCount} elements · {canvas.edgeCount} relationships
            {canvas.facets.needsReview > 0 ? (
              /* Named here because the drawing shows it as dashes, and a reader who
                 opened a full view to study the graph should know part of it is not
                 settled yet. */
              <> · {canvas.facets.needsReview} still under review</>
            ) : null}
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="gcf-error">
          {/* Retry re-runs both loads, because either could have been the one that
              failed and this tab has nothing else to fall back on. */}
          <ApiErrorAlert
            error={error}
            onRetry={() => {
              if (!useCaseId) return
              void (async () => {
                await open(useCaseId)
                await loadCanvas()
              })()
            }}
          />
        </div>
      ) : null}

      {canvasLoading && !canvas ? (
        <div className="gcf-loading">
          <Spin />
        </div>
      ) : canvas ? (
        /* One element, not a canvas column beside an inspector column: the viewer draws
           its own sidebar, and two inspectors would say the same things twice. */
        <div className="gcf-body">
          <GraphViewer
            graph={fromCanvas(canvas, data?.graphName ?? 'This graph')}
            highlight={answerPath(canvas)}
          />
        </div>
      ) : (
        <div className="gcf-loading">The canvas could not be loaded.</div>
      )}
    </div>
  )
}
