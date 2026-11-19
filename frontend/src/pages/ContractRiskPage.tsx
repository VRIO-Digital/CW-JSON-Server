import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { appPath } from '../api/dataset'
import DocumentViewer from '../components/report/DocumentViewer'
import './GoalsSubmissionPage.css'

/**
 * Contract Risk Analyst — one live frame behind three routes (Ask, Goals, Submissions).
 *
 * A vendored reference prototype (`src/ContractRisk/goals-submission/ContractRisk.html`), the same
 * kind of self-contained build as Keolis's / CAPEX's / Arcwood's Goals-and-Submissions pages, except
 * this one bundles its **own Ask** behind the same hash router too — so this page generalises
 * `GoalsSubmissionPage`'s two-screen sync to three, rather than being a third case bolted onto that
 * file: the two components share no state, and a role with three screens is not a reason to touch the
 * four datasets that already work with two.
 *
 * **Entirely self-contained, and deliberately ungated.** The package's own README states it plainly:
 * "Nothing is connected. The data is generated in the file" — the scorecard, the 300 contracts, the
 * readings, the morning check are all baked into the bundle, not drawn from a published graph the way
 * the other Goals/Submissions prototypes' figures are framed as being downstream of. So this page does
 * not read `reportsStore` and does not render `NoPublishedGraph`: there is no graph for it to wait on.
 *
 * **Reachable by URL only, like `/trace` and `/validation`** — no `NAV_ITEMS` entry yet. The prototype
 * is Northline Water Group's (CAPEX's tenant) regardless of which dataset is actually selected when a
 * reader opens one of these routes directly; there is no per-dataset nav filter in this app to gate it
 * on, so until that is built (or the entries are added unconditionally) it stays off the sidebar rather
 * than showing Northline content under an unrelated tenant's dataset.
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
 * holding an `h4` and a run of `button.aq-q`) is the bundle's own 62-question catalogue — asked for
 * narrowed to one or two, which this app's own `AskPage` already keeps to (a short opener row, not a
 * library). Hidden at the frame rather than edited into the bundle, for the same reason the shell is:
 * `_meta` on a generated export forbids hand-editing it, and a rule applied here holds for whatever
 * version is dropped in next. Keeps the first theme's heading and its first two questions; every
 * other theme, and every later question within the first, goes.
 */
const HIDE_EXTRA_QUESTIONS_CSS =
  ' .aq-lib section:not(:first-of-type) { display: none !important }' +
  ' .aq-lib section:first-of-type button.aq-q:nth-of-type(n+3) { display: none !important }'

export default function ContractRiskPage({ view }: { view: View }) {
  const entry = useRef(VIEWS[view]).current
  const frameWinRef = useRef<Window | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  /* App → frame: a sidebar/URL move to a different one of the three routes moves the live frame's
     hash, only when the screens disagree — the same guard `GoalsSubmissionPage` uses, so a hash the
     frame itself just set is never clobbered by the route change that caused it. */
  useEffect(() => {
    const win = frameWinRef.current
    if (!win) return
    try {
      if (screenOf(win.location.hash) !== view) win.location.hash = VIEWS[view].fragment
    } catch {
      /* A frame mid-navigation has no location to read; the next switch lands normally. */
    }
  }, [view])

  return (
    <div className="gs-bleed">
      <DocumentViewer
        document={{ file: FILE, title: entry.title }}
        seamless
        fillWindow
        fragment={entry.fragment}
        enhance={(inner) => {
          const style = inner.createElement('style')
          style.textContent = HIDE_SHELL_CSS + HIDE_EXTRA_QUESTIONS_CSS
          inner.head?.appendChild(style)

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
