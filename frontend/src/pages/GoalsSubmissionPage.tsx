import { Spin } from 'antd'
import { useEffect } from 'react'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import NoPublishedGraph from '../components/common/NoPublishedGraph'
import PageHeader from '../components/common/PageHeader'
import DocumentViewer from '../components/report/DocumentViewer'
import { useReportsStore } from '../store/reportsStore'

/**
 * Goals and Submission — two sidebar entries, one framed prototype.
 *
 * The document (`src/Keolis/goals-submission/Keolis_goals_submission.html`) is a standalone bundled
 * build carrying both screens behind its own hash router, so the two nav entries are two views of one
 * file rather than two files: each opens the same document at its own route — `#/K/goals` and
 * `#/K/submissions` — through `DocumentViewer`'s `fragment`. One page component rather than two,
 * because the only thing the entries disagree about is which screen the frame opens on, and switching
 * between them is then a hash navigation inside the already-loaded frame rather than a reload of a
 * 3.8 MB document.
 *
 * **`seamless`, like the What-if lens and AI Submissions**: the document is the whole page, so there
 * is no Back, no Export bar and no label restating a title the page carries itself, and the frame is
 * fitted to what is left of the viewport below the header.
 *
 * **Behind the publish gate, on request — the same reversal AI Submissions, the rendered What-if lens
 * and the CAPEX reports each took.** The prototype asks nothing of the graph — its figures are its
 * own — so it rode ungated at first on exactly that reasoning, and the reasoning produces a *section*
 * where what is wanted is a *sequence*: the graph is released first, and the surfaces that read the
 * tenant's data open after it. The gate is publication, tested on the same counts `AISubmissionsPage`
 * reads (`GET /reports` through `reportsStore` — one store, one path into the counts), and
 * `NoPublishedGraph` is the one screen for the closed branch, forking its action on `builtCount` like
 * every other gated page. Publication lives in the mock server's memory, so a restart closes these
 * two pages again along with the other gated five.
 *
 * It resolves through `reportDocuments.ts`'s `goals-submission` glob, so a missing or renamed file is
 * named by the viewer rather than guessed at.
 */
const FILE = 'Keolis_goals_submission.html'

const VIEWS = {
  goals: {
    title: '',
    subtitle:
      '',
    fragment: '#/K/goals',
    /* The `detail` sentence on the gate — per view, because the title, action and numbered path are
       `NoPublishedGraph`'s own and must not be, or one gate comes to be called two things. */
    gateDetail:
      'A goal is tracked against evidence from the published graph — the goals and the measures behind them open once one is live.',
  },
  submission: {
    title: '',
    subtitle:
      '',
    fragment: '#/K/submissions',
    gateDetail:
      'A submission draws on goals tracked against the published graph — the submissions and their templates open once one is live.',
  },
} as const

/**
 * The prototype draws its own app shell — it is a full build of this app, so inside the frame its
 * antd `Layout.Sider` (wordmark, nav, signed-in card) renders as a second sidebar beside the real
 * one, and its mobile header as a second top bar. Both are hidden **from the frame, never by editing
 * the file**: the document is a generated bundle, so an edit would be lost at the next export, while
 * a rule applied at the frame holds for whatever version is dropped in — the same bargain every
 * other injected rule in `DocumentViewer` strikes. Injected through the viewer's `enhance` seam
 * rather than added to the shared `SEAMLESS_CSS`, because the duplicate shell is *this* document's
 * shape and the other seamless documents (the What-if lens, the governance screen) draw no sider for
 * the rule to be anything but inert noise on. `!important` because antd's own styles are injected
 * into `<head>` at runtime, after this sheet, and the later rule wins at equal specificity.
 */
const HIDE_SHELL_CSS = ' .ant-layout-sider, .mobile-bar { display: none !important }'

export default function GoalsSubmissionPage({ view }: { view: keyof typeof VIEWS }) {
  const { title, subtitle, fragment, gateDetail } = VIEWS[view]

  const index = useReportsStore((s) => s.index)
  const loading = useReportsStore((s) => s.loading)
  const error = useReportsStore((s) => s.error)
  const load = useReportsStore((s) => s.load)

  /* No role: the counts are the same whatever role asks, and the gate reads nothing else. */
  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      {loading && !index ? (
        <Spin />
      ) : error && !index ? (
        <ApiErrorAlert error={error} onRetry={() => void load()} />
      ) : !index ? null : index.publishedCount === 0 ? (
        /* The one precondition, read as `=== 0` on a loaded index — never as falsy, which would
           flash the gate over a tenant that has published. */
        <NoPublishedGraph
          detail={gateDetail}
          builtCount={index.builtCount}
          draftCount={index.draftCount}
        />
      ) : (
        <DocumentViewer
          document={{ file: FILE, title }}
          seamless
          fragment={fragment}
          enhance={(inner) => {
            const style = inner.createElement('style')
            style.textContent = HIDE_SHELL_CSS
            inner.head?.appendChild(style)
          }}
        />
      )}
    </>
  )
}
