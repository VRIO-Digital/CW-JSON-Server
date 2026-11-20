import { Spin } from 'antd'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { appPath } from '../api/dataset'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import NoPublishedGraph from '../components/common/NoPublishedGraph'
import PageHeader from '../components/common/PageHeader'
import DocumentViewer from '../components/report/DocumentViewer'
import { useReportsStore } from '../store/reportsStore'
import './GoalsSubmissionPage.css'

/**
 * Contract Risk Analyst — one live frame behind three *views* (Ask, Goals, Submissions), though
 * RISK's own sidebar only reaches two of them here now — see below.
 *
 * A vendored reference prototype (`src/ContractRisk/goals-submission/ContractRisk.html`), the same
 * kind of self-contained build as Keolis's / CAPEX's / Arcwood's Goals-and-Submissions pages, except
 * this one bundles its **own Ask** behind the same hash router too — so this component generalises
 * `GoalsSubmissionPage`'s two-screen sync to three, rather than being a third case bolted onto that
 * file: the two components share no state, and a role with three screens is not a reason to touch the
 * four datasets that already work with two.
 *
 * **Self-contained, but not ungated.** The package's own README states it plainly: "Nothing is
 * connected. The data is generated in the file" — the scorecard, the 300 contracts, the readings, the
 * morning check are all baked into the bundle rather than drawn from a published graph. That is true
 * regardless of what this gate reads; it never stopped being true.
 *
 * **It gates on the published graph, not a connected source — reversed on request, the same move
 * `GoalsSubmissionPage` and `AISubmissionsPage` each took.** Their own reasoning is the reasoning
 * here too: a prototype asking nothing of the graph produces a *section* on the obvious gate
 * (connect a source first) where what is wanted is a *sequence* — the graph is released first, and
 * the surfaces that read the tenant's data open after it. So this reads the same counts those two
 * pages do, `GET /reports` through `useReportsStore` (one store, one path into the numbers, rather
 * than a fourth copy of the fetch), and renders the shared `NoPublishedGraph` — the same title, the
 * same three steps, the same "Open Graph Studio" — across all three routes, forking its own action on
 * `builtCount` exactly as every other gated page does. `useSourcesStore`/`NoSourceConnected` are gone
 * from this file along with the source-connected reading of the gate.
 *
 * **RISK's own sidebar reaches this component for Goals and Submission only — Ask goes through the
 * real `AskPage` now, like every other dataset.** `routes.tsx`'s `ask` route used to swap in
 * `view="ask"` here for RISK, on the reasoning that RISK was seeded with nothing to ever build a
 * graph from; that stopped being true once it got a real source, profiled columns and Data Modeling
 * relations, so Ask gets the real graph selector, Chat/History and composer instead of a reskinned
 * reading of this frame's own, unconnected one. `view="ask"` on this component itself is not dead —
 * `/contract-risk/ask` below still opens it — it is simply no longer how RISK's own sidebar reaches
 * Ask.
 *
 * **The three `/contract-risk/*` routes are reachable by URL only, like `/trace` and `/validation`** —
 * no `NAV_ITEMS` entry. The prototype is Northline Water Group's (CAPEX's tenant) regardless of which
 * dataset is actually selected when a reader opens one of those routes directly; there is no
 * per-dataset nav filter in this app to gate it on, so until that is built (or the entries are added
 * unconditionally) they stay off the sidebar rather than showing Northline content under an unrelated
 * tenant's dataset.
 */
const FILE = 'ContractRisk.html'

const VIEWS = {
  ask: { fragment: '#/K/ask', title: 'Contract Risk Analyst — Ask' },
  goals: { fragment: '#/K/goals', title: 'Contract Risk Analyst — Goals' },
  submission: { fragment: '#/K/submissions', title: 'Contract Risk Analyst — Submissions' },
} as const

type View = keyof typeof VIEWS

/** Which screen a frame hash is showing — mirrors `screenOf` in `GoalsSubmissionPage`, generalised to three. */
const screenOf = (hash: string): View =>
  hash.startsWith('#/K/submissions') ? 'submission' : hash.startsWith('#/K/goals') ? 'goals' : 'ask'

/**
 * This build renders its own `.ant-layout-sider` / `.mobile-bar`, exactly like the other vendored
 * prototypes — confirmed from the running frame rather than assumed, since this build's markup
 * otherwise differs from Keolis's (no `#/K/ask` equivalent there, different page components). Hidden
 * from the frame, never by editing the generated file.
 */
const HIDE_SHELL_CSS = ' .ant-layout-sider, .mobile-bar { display: none !important }'

/**
 * The Ask screen's own suggested-question library (`.aq-lib`, one bare `<section>` per theme, each
 * holding an `h4` and a run of `button.aq-q`) is the bundle's own 62-question catalogue — asked, over
 * two earlier passes (first trimmed to one theme's first two questions under its heading, then
 * removed entirely), to instead read like this app's own `AskPage`'s short row of opener chips above
 * the composer. `.aq-q` is a full-width list row by the bundle's own CSS
 * (`width:100%;display:block;text-align:left`, inside a bordered card per theme) — restyled here into
 * loose inline pills, the first theme's first three questions, no heading. **The position is not
 * moved**: `AskPage`'s own chips sit directly above its composer, and this build's library renders
 * near the top of the empty state instead — moving it there would mean relocating a node a mounted
 * React tree already manages, which risks the exact "NotFoundError" class of crash a frame-injected
 * rule must never risk causing. Three chips in the wrong spot beats a page that throws.
 *
 * Hidden/restyled at the frame rather than edited into the bundle, for the same reason the shell is:
 * `_meta` on a generated export forbids hand-editing it, and a rule applied here holds for whatever
 * version is dropped in next.
 */
const HIDE_EXTRA_QUESTIONS_CSS =
  ' .aq-lib section:not(:first-of-type) { display: none !important }' +
  ' .aq-lib section:first-of-type h4 { display: none !important }' +
  ' .aq-lib section:first-of-type button.aq-q:nth-of-type(n+4) { display: none !important }' +
  ' .aq-lib { display: block !important }' +
  ' .aq-lib section:first-of-type {' +
  '   background: none !important; border: 0 !important; padding: 0 !important;' +
  '   display: flex !important; flex-wrap: wrap !important; gap: 8px !important;' +
  ' }' +
  ' .aq-lib section:first-of-type button.aq-q {' +
  '   display: inline-block !important; width: auto !important; text-align: center !important;' +
  '   border: 1px solid #e3e6ec !important; border-radius: 999px !important;' +
  '   background: #fff !important; padding: 8px 14px !important; font-size: 13px !important;' +
  ' }'

/**
 * The Ask screen's own empty-state intro (`.aq-empty`'s `h2` — "What do you want to know about your
 * contracts?" — and the paragraph naming the question library beneath it) goes with the library it
 * introduces: a sentence pointing at a box that is no longer there reads as a feature that did not
 * run. `.aq-empty`'s third child is the composer itself, which stays — the rule is scoped to the two
 * text children rather than the whole container, or the composer would disappear with them.
 */
const HIDE_ASK_INTRO_CSS = ' .aq-empty h2, .aq-empty > p { display: none !important }'

/**
 * This screen's own branded header — `h1` ("Ask the Contract Risk Analyst") plus a paragraph naming
 * the live scorecard with an "Open the goal" / "Set up the goal" link (`[data-testid="aq-asof"]`) —
 * asked to read like this app's own Ask page instead: one plain title and one generic subtitle, not a
 * scorecard status line. **Rewritten, not hidden** — there is nothing to fall back to underneath it,
 * and a blank header reads as a page that failed to load rather than as one that was restyled.
 *
 * The subtitle is copied verbatim from `AskPage.tsx`'s own `PageHeader`, which is the one place the
 * two could come to disagree: a real coupling, kept in one place here rather than two, and it fails
 * visibly — the words simply stop matching — rather than silently.
 *
 * Text only. The real Q&A beneath it, grounded in the tenant's own scorecard, is untouched — restyling
 * the one page that answers from real data was never the ask, and this is not that.
 */
const ASK_SUBTITLE =
  'A query engine, not a search box. Ask in plain language — a supervisor agent grounds the question ' +
  'in the knowledge graph, routes to source systems, and returns an evidence-backed answer with the ' +
  'full reasoning open for inspection.'

/**
 * **Applied once, and kept applied, because `enhance` runs once and the document does not.** This
 * build signs in and opens its report *after* the static page has loaded — the same asynchronous
 * boot `DocumentViewer`'s own hold is written around — so the header this function targets is not
 * painted yet when the frame's native `load` event fires `enhance`, and a one-shot rewrite silently
 * finds nothing. A `MutationObserver` re-applies it on every change under `<body>` instead of a timer,
 * for the reason every paced surface here prefers a real signal to a guess at how long something
 * takes; it never disconnects, because the same scorecard status line can legitimately re-render
 * later (a goal published mid-session) and a one-shot observer would let the original text back in
 * exactly then.
 */
function restyleAskHeader(inner: Document) {
  const apply = () => {
    const heading = inner.querySelector('.aq-top h1')
    if (heading && heading.textContent !== 'Ask') heading.textContent = 'Ask'
    const asOf = inner.querySelector('[data-testid="aq-asof"]')
    if (asOf && asOf.textContent !== ASK_SUBTITLE) asOf.textContent = ASK_SUBTITLE
  }
  apply()
  if (!inner.body) return
  new MutationObserver(apply).observe(inner.body, { childList: true, subtree: true, characterData: true })
}

export default function ContractRiskPage({ view }: { view: View }) {
  const entry = useRef(VIEWS[view]).current
  const frameWinRef = useRef<Window | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  const index = useReportsStore((s) => s.index)
  const loading = useReportsStore((s) => s.loading)
  const error = useReportsStore((s) => s.error)
  const load = useReportsStore((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])

  /* App → frame: a sidebar/URL move to a different one of the three routes moves the live frame's
     hash, only when the screens disagree — the same guard `GoalsSubmissionPage` uses, so a hash the
     frame itself just set is never clobbered by the route change that caused it. A no-op while the
     frame below is not even mounted, which is exactly what it should be. */
  useEffect(() => {
    const win = frameWinRef.current
    if (!win) return
    try {
      if (screenOf(win.location.hash) !== view) win.location.hash = VIEWS[view].fragment
    } catch {
      /* A frame mid-navigation has no location to read; the next switch lands normally. */
    }
  }, [view])

  if (loading && !index) {
    return (
      <>
        <PageHeader title={entry.title} subtitle="Grounded in the tenant's own contract risk scorecard, once a graph for this dataset is published." />
        <Spin />
      </>
    )
  }
  if (error && !index) {
    return (
      <>
        <PageHeader title={entry.title} subtitle="Grounded in the tenant's own contract risk scorecard, once a graph for this dataset is published." />
        <ApiErrorAlert error={error} onRetry={() => void load()} />
      </>
    )
  }
  if (!index) return null
  if (index.publishedCount === 0) {
    return (
      <>
        <PageHeader
          title={entry.title}
          subtitle="Grounded in the tenant's own contract risk scorecard, once a graph for this dataset is published."
        />
        <NoPublishedGraph
          detail="The Contract Risk Analyst's Ask, Goals and Submission screens read from a published graph, never from Sources directly."
          builtCount={index.builtCount}
          draftCount={index.draftCount}
        />
      </>
    )
  }

  return (
    <div className="gs-bleed">
      <DocumentViewer
        document={{ file: FILE, title: entry.title }}
        seamless
        fillWindow
        fragment={entry.fragment}
        enhance={(inner) => {
          const style = inner.createElement('style')
          style.textContent = HIDE_SHELL_CSS + HIDE_EXTRA_QUESTIONS_CSS + HIDE_ASK_INTRO_CSS
          inner.head?.appendChild(style)
          restyleAskHeader(inner)

          const win = inner.defaultView
          if (!win) return
          frameWinRef.current = win

          /* Frame → app: the document navigating itself (its own nav, or a saved-plan link) pulls the
             app's route along, so the sidebar — once this has one — agrees with the screen the reader
             is actually on. Deferred to the next tick, so the app's router is never driven from inside
             the frame's own navigation call. See `GoalsSubmissionPage`'s identical comment for why both
             history writers (`pushState`/`replaceState`) and both events (`popstate`/`hashchange`) are
             covered: the hash router here navigates through `pushState`, which fires neither.
          */
          const sync = () => {
            win.setTimeout(() => {
              const screen = screenOf(win.location.hash)
              if (screen !== viewRef.current) {
                navigateRef.current(
                  appPath(screen === 'submission' ? '/contract-risk/submissions' : `/contract-risk/${screen}`),
                )
              }
            }, 0)
          }
          const push = win.history.pushState.bind(win.history)
          win.history.pushState = (...args: Parameters<History['pushState']>) => {
            push(...args)
            sync()
          }
          const replace = win.history.replaceState.bind(win.history)
          win.history.replaceState = (...args: Parameters<History['replaceState']>) => {
            replace(...args)
            sync()
          }
          win.addEventListener('popstate', sync)
          win.addEventListener('hashchange', sync)

          /* A route change made while the document was still loading had no window to move. */
          if (screenOf(win.location.hash) !== viewRef.current) {
            win.location.hash = VIEWS[viewRef.current].fragment
          }
        }}
      />
    </div>
  )
}
