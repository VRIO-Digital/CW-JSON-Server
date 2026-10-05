import { Spin } from 'antd'
import { useEffect } from 'react'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import NoPublishedGraph from '../components/common/NoPublishedGraph'
import PageHeader from '../components/common/PageHeader'
import DocumentViewer from '../components/report/DocumentViewer'
import { useReportsStore } from '../store/reportsStore'

/**
 * AI Submissions — a standalone showcase page, framed rather than built.
 *
 * **Not a dataset's, unlike every other framed document in this app.** A report, a What-if lens and
 * an Audit & Governance screen are each *a tenant's own* rendered page, resolved through
 * `reportDocuments.ts`'s per-dataset globs and reached from inside a page that is already reading
 * that tenant's data. This one is a fixed asset the sidebar offers regardless of which dataset is
 * selected — see `aiSubmissionsModules` in `reportDocuments.ts` for the glob that resolves it without
 * a dataset segment in front.
 *
 * **`seamless`, for the same reason the What-if lens is.** The document is the whole page rather than
 * a file being viewed: no Back (there is nowhere this page is opened *from*), no Export PDF, and no
 * bar restating a title the page already carries in its own content. `DocumentViewer` still measures
 * the frame to exactly what is left of the viewport below this header, so the frame fits the screen
 * without a second scrollbar — the same fit-to-viewport machinery the lens and the CAPEX reports use.
 *
 * **Behind the publish gate, on request — the same reversal the What-if lens and the CAPEX reports
 * took.** This page asks nothing of the graph — its figures are the document's own — so it rode
 * ungated for a while on exactly that reasoning, and the reasoning produced a *section* where what
 * is wanted is a *sequence*: the graph is released first, and the surfaces that read the tenant's
 * data open after it. So the gate is publication, tested on the same counts `ReportsPage` reads
 * (`GET /reports` through `reportsStore` — one store, one path into the counts, rather than a second
 * fetch invented for this page), and `NoPublishedGraph` is the one screen for the closed branch,
 * forking its action on `builtCount` like every other gated page. A connected source is deliberately
 * not a second gate, for the reason the Reports section states: publishing is already downstream of
 * having something to build from. Publication lives in the mock server's memory, so a restart closes
 * this page again along with the other four.
 *
 * **The document itself was hand-edited, which the CAPEX and What-if documents never are.** Those
 * carry a generator and a `_meta` forbidding it, so this app reaches them only by injecting CSS at the
 * frame. This file has neither: it was authored once, directly, for this page, so its own duplicate
 * app shell — a second "Context Weave" wordmark, a second signed-in identity, disabled placeholder
 * rows for pages that live outside this frame — was removed in the file itself rather than papered
 * over with an injected rule this app would have to keep in step with a generator it does not own.
 * What is left is the page's own content and the internal navigation between its own screens
 * (Streams, a stream's obligations, a new submission).
 */
/**
 * One file for every dataset, and the per-dataset map is retired.
 *
 * `ai_submissions_demo_final.html` *is* the Keolis Valmont page now — the demo asset was replaced
 * wholesale with the Keolis build, so the KEOLIS override that used to point at the generated
 * `keolis_ai_submissions.html` would only frame a superseded copy of the same tenant's page. The
 * generated file and `backend/scripts/build-keolis-ai-submissions.mjs` are untouched — the usual
 * waiting-for-a-caller state — so re-introducing a per-dataset page is a map keyed by the
 * client-held dataset selection, which is what stood here before.
 */
const FILE = 'ai_submissions_demo_final.html'

export default function AISubmissionsPage() {
  const index = useReportsStore((s) => s.index)
  const loading = useReportsStore((s) => s.loading)
  const error = useReportsStore((s) => s.error)
  const load = useReportsStore((s) => s.load)

  /* No role: the counts are the same whatever role asks, and this page reads nothing else. */
  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <PageHeader
        title="AI Submissions"
        subtitle="Reports you are accountable for — regulatory, internal and lender filings, drafted with evidence and confirmed by you before anything is sent."
      />
      {loading && !index ? (
        <Spin />
      ) : error && !index ? (
        <ApiErrorAlert error={error} onRetry={() => void load()} />
      ) : !index ? null : index.publishedCount === 0 ? (
        /* The one precondition, read as `=== 0` on a loaded index — never as falsy, which would
           flash the gate over a tenant that has published. */
        <NoPublishedGraph
          detail="A submission is drafted with evidence from the published graph — the streams, their obligations and the drafting workspace open once one is live."
          builtCount={index.builtCount}
          draftCount={index.draftCount}
        />
      ) : (
        <DocumentViewer document={{ file: FILE, title: 'AI Submissions' }} seamless />
      )}
    </>
  )
}
