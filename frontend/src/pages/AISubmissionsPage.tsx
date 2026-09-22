import PageHeader from '../components/common/PageHeader'
import DocumentViewer from '../components/report/DocumentViewer'

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
 * **Gated on nothing.** Every other framed document here waits on a precondition — a published graph,
 * a connected source — because its figures are attributed to content that has to exist first. This
 * page asks nothing of the graph and reads nothing from a source: it is a fixed demo asset, so there
 * is no state for a gate to be about. `src/pages/X.tsx → route → nav.ts entry`, the recipe SKILLS.md
 * states for a new page, ends there for exactly this reason — "gate it on `connected_sources` … if
 * its data derives from a source" does not apply, because none of it does.
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
export default function AISubmissionsPage() {
  return (
    <>
      <PageHeader
        title="AI Submissions"
        subtitle="Reports you are accountable for — regulatory, internal and lender filings, drafted with evidence and confirmed by you before anything is sent."
      />
      <DocumentViewer
        document={{ file: 'ai_submissions_demo_final.html', title: 'AI Submissions' }}
        seamless
      />
    </>
  )
}
