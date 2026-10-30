import { Spin } from 'antd'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { appPath, currentDataset } from '../api/dataset'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import NoPublishedGraph from '../components/common/NoPublishedGraph'
import PageHeader from '../components/common/PageHeader'
import DocumentViewer from '../components/report/DocumentViewer'
import { useReportsStore } from '../store/reportsStore'
import './GoalsSubmissionPage.css'

/**
 * Goals and Submission — two sidebar entries over **one live frame**.
 *
 * Both documents in `src/Keolis/goals-submission/` are the *same* combined prototype build — each
 * carries both screens behind one hash router, and the two files differ only in which hash their
 * bootstrap defaults to when none is set. That matters because the two screens are **connected**: a
 * goal's "Build in Submissions" creates a draft in the prototype's in-memory store and hash-navigates
 * to `/K/submissions/<id>`, so the draft exists only inside the frame that built it. Reloading the
 * frame loses it.
 *
 * So the two entries share one component and one frame, and switching between them is a **hash
 * navigation inside the already-loaded frame**, never a reload: the file and the opening fragment are
 * frozen at first mount (cold entry at `/goals` loads `Keolis_Goals.html`, cold at `/submission`
 * loads `Keolis_Submissions.html` — honouring which file each entry opens — and either serves both
 * screens from there). This leans on the two routes rendering the same component type at the same
 * position, which React reconciles as an update; if that ever stopped holding, the cost is a frame
 * reload and a lost in-memory draft, not a broken page.
 *
 * The sync runs both ways and the **frame is the authority** — the `DatasetPathGate` arrangement, one
 * seam down: a sidebar click sets the frame's hash to that screen; the frame navigating itself (the
 * reader pressed *Build in Submissions* inside a goal) moves the app's route under it, so the sidebar
 * follows the screen the reader is actually on and the draft's own hash is never clobbered. Each side
 * acts only when the screens disagree, which is what keeps the two listeners from feeding each other.
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
 * Both resolve through `reportDocuments.ts`'s `goals-submission` glob, so a missing or renamed file
 * is named by the viewer rather than guessed at.
 */
/* Each dataset ships its own build of the prototype (`src/<Dataset>/goals-submission/`). The dataset is
   fixed per page load — switching it reloads the document — so it is read once. A dataset with no
   build of its own gets KEOLIS's, as every dataset did before the second one arrived. */
const DATASET_FILES: Record<string, { goals: string; submission: string }> = {
  KEOLIS: { goals: 'Keolis_Goals.html', submission: 'Keolis_Submissions.html' },
  CAPEX: { goals: 'Capex-Goals.html', submission: 'Capex-Submission.html' },
  SUPPLYCHAIN: { goals: 'Supply_chain_goals.html', submission: 'Supply_chain_submission.html' },
}
const FILES = DATASET_FILES[currentDataset().toUpperCase()] ?? DATASET_FILES.KEOLIS

const VIEWS = {
  goals: {
    title: '',
    subtitle:
      '',
    file: FILES.goals,
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
    file: FILES.submission,
    fragment: '#/K/submissions',
    gateDetail:
      'A submission draws on goals tracked against the published graph — the submissions and their templates open once one is live.',
  },
} as const

type View = keyof typeof VIEWS

/**
 * Which of the two screens a frame hash is showing. The authority both sync directions compare
 * against: `#/K/submissions` and everything under it is the Submission screen, everything else —
 * `#/K/goals`, a goal's own `#/K/goals/<id>`, the empty hash the bootstrap is about to fill — reads
 * as Goals, which is also the harmless answer while the document is still arriving.
 */
const screenOf = (hash: string): View => (hash.startsWith('#/K/submissions') ? 'submission' : 'goals')

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

/**
 * The build's hub is sized `calc(100vh - 112px)`, and the chrome around it is 122px — the 48px role
 * bar, its content area's 32px top and 48px bottom padding, less the hub's own -6px top margin — so
 * every export of this prototype overflows its viewport by exactly 10px. The content area's vertical
 * padding is also cut to 8px each, so the hub fills the frame instead of leaving a slab of empty
 * ground under it (chrome is then 48 + 8 + 8 - 6 = 58px). Standalone that is a sliver
 * of scroll nobody notices; inside a seamless frame it paints a scrollbar the full height of the
 * frame, which beside the composer panel's own scroller reads as the page scrolling twice (reported
 * from use as two vertical scrollbars). Corrected from the frame for the HIDE_SHELL_CSS reason — the
 * fix belongs in the generator, and until a re-export carries it this rule holds for whatever version
 * is dropped in. Scoped to the widths where the build fixes the hub's height at all: at
 * `width<=1100px` its own media query sets `height: auto` and stacks the columns, and an unscoped
 * `!important` here would override that. The 122 names the build's real chrome the way the selectors
 * name its classes — a re-export that changes a padding makes it visibly wrong (the sliver of
 * scrollbar returns), never silently.
 */
const FIT_HUB_CSS =
  ' @media (min-width: 1101px) {' +
  ' .app-content { padding-top: 8px !important; padding-bottom: 8px !important }' +
  ' .hub { height: calc(100vh - 58px) !important } }'

/**
 * The prototype keeps its goal-list rail's visibility in `localStorage` under this key (default
 * open), and the frame is **same-origin with the app**, so the key is shared with every session and
 * every other framed build of this prototype family. One click on the document's own "Hide the
 * list" toggle therefore persisted, and the Goals entry then opened on a composer with no goals
 * anywhere on screen — which reads as a broken page, not a preference. Reported from use.
 *
 * So arriving from the sidebar re-opens the rail. It is written in an effect on **mount**, never in
 * `enhance`: the build reads the key at its own module init, which runs when the frame loads —
 * after our mount, before `enhance`. The document's toggle still works within the session; this
 * only settles what a reader *arrives* to. `JSON.stringify`'d `true`, because the build reads it
 * back through `JSON.parse`.
 */
const RAIL_KEY = 'cw.hub.rail'

/**
 * Each build's own "new" button — "+ New goal", "+ New submission" — sits in the hub's top bar,
 * beside the open item's title: the middle of the screen. Both were asked for at the top of the left
 * rail instead, by the search box, which is where the list lives. Two halves, both applied from the
 * frame because the document is a generated bundle (the HIDE_SHELL_CSS bargain): the hub-top button
 * is hidden by CSS — hidden, not removed, because it is still the only way into the build's own
 * "start a new one" action — and a button is injected by `.rl-search` that forwards its click to the
 * hidden one. On the fresh composer screen the build draws no `.hub-new` (the composer *is* the new
 * goal or submission), so the forward finds nothing and the click is a no-op on the screen it would
 * have navigated to anyway. The two hubs share the class names, so one rule covers both views; only
 * the label differs, and it is read off the frame's **current hash** rather than the app's view,
 * because with one live frame the screen can change under a route that has not caught up yet.
 */
const RAIL_NEW_CSS =
  ' .hub-top .hub-new { display: none !important }' +
  ' .cw-rail-new { width: 100%; box-sizing: border-box; display: flex; align-items: center;' +
  ' gap: 8px; margin: 12px 0 2px; padding: 10px 12px; background: #fff;' +
  ' border: 1px dashed #cfd3da; border-radius: 10px; font: inherit; font-size: 13.5px;' +
  ' font-weight: 600; color: #3f4654; cursor: pointer; text-align: left }' +
  ' .cw-rail-new:hover { border-color: #b4bac4; background: #fafbfc }' +
  ' .cw-rail-new .cw-plus { font-size: 15px; font-weight: 500; line-height: 1 }'

/**
 * The start screen's "Answer once / Keep watching" switch is a soft pill with no outline, so it reads
 * as a segmented control rather than as two tabs. Asked for a border so it looks like a tab: the strip
 * gets a hairline frame and each button its own border, the active one white with the brand colour on
 * its edge and its label. Applied from the frame for the HIDE_SHELL_CSS reason; `!important` because
 * the build's own `.ns-toggle` rules are declared later in the document than this sheet's insertion.
 */
const TOGGLE_TAB_CSS =
  ' .ns-toggle { border: 1px solid #dfe3ea !important; background: #fff !important }' +
  ' .ns-toggle button { border: 1px solid transparent !important }' +
  ' .ns-toggle button.is-on { border-color: #f4562b !important; color: #f4562b !important;' +
  ' font-weight: 600 !important; box-shadow: none !important }'

/**
 * A suggestion chip on the start screen ("Use the Q3 committee pack example") fills the composer with
 * its text **and** attaches the example's documents. Asked for the text alone: the chip should only
 * bring in the paragraph. The build's chip handler is `setStart({ prompt, files })` and the file is
 * generated, so the attachments are taken back out from the frame — a delegated click listener lets
 * the build apply the chip, then presses each attachment's own Remove button. One per tick, because
 * every Remove closes over the file list it rendered with, so pressing several in one tick would
 * leave only the last removal standing. Keyed on the Remove buttons' `aria-label` (`Remove <name>`),
 * the build's own accessible name for them; a re-export renaming it leaves the files attached, which
 * is visible, never a broken page.
 */
function dropChipAttachments(inner: Document) {
  inner.addEventListener('click', (ev) => {
    if (!(ev.target as Element | null)?.closest?.('.ns-ex .gc-chip')) return
    const win = inner.defaultView
    if (!win) return
    let guard = 20
    const next = () => {
      const btn = inner.querySelector<HTMLElement>('.nstart button[aria-label^="Remove "]')
      if (!btn || guard-- <= 0) return
      btn.click()
      win.setTimeout(next, 0)
    }
    win.setTimeout(next, 0)
  })
}

/**
 * "Simulate the 22 September snapshot" fires the standing goal and runs its steps by itself, but a few
 * things still need the reader: an acknowledgement of the breach note and an action on the missing
 * directory link. The build already has a bell and a notices list, and exposes its store as
 * `window.__cwJourney.useGoalStore`, so the two notices are pushed into that list (the bell's badge
 * and its bottom-right toast then follow from the build's own code). Applied from the frame, never by
 * editing the generated file.
 */
type SimNotice = [number, string, string, string]

const KEOLIS_NOTICES: SimNotice[] = [
  [1200, 'Acknowledge the breach note', 'P-VM-046 is 12.4% over its approved budget. Review the note and acknowledge it.', 'plan'],
  [1500, 'Action needed: connect the directory', 'Connect the directory so the project manager can be told by name.', 'plan'],
  [3000, 'Add your working forecast', 'Four projects have no September forecast, so their figures are not checked yet. Add the forecast to include them.', 'plan'],
  [4500, 'Add the Q2 minutes', "The Metropolitan Board's decision on tranche 3 is not on file. Add the Q2 minutes so it can be cited.", 'plan'],
  [22000, 'Choose a recommendation', 'Findings are ready, with one preferred option. Review them and choose before anything is sent.', 'findings'],
  [24000, 'Approve the note before it goes out', 'The note to the project manager is drafted and waits for your approval. Nothing is sent until you approve it.', 'findings'],
]

const CAPEX_NOTICES: SimNotice[] = [
  [1200, 'Review the off-framework orders', '14 of 31 new lines are off a framework that covers the item: $3.86M ordered, $0.55M above framework prices.', 'plan'],
  [2500, 'Decide on the nine unconfirmed lines', 'Nine of the 14 lines are not yet confirmed by the supplier and can still be cancelled at no cost. Decide whether to re-place them on the frameworks.', 'plan'],
  [4000, 'Review the catalogue change request', 'The catalogue default that sent these orders off-framework needs a change request to IT. Review it before it is raised.', 'plan'],
  [22000, 'Choose a recommendation', 'Findings are ready, with one preferred option. Review them and choose before anything is sent.', 'findings'],
  [24000, 'Review the note before it goes out', 'The note to the controller is drafted and waits for your review. Nothing is sent until you do.', 'findings'],
]

/* SUPPLYCHAIN has none yet: its scenario is a different load (the Bramwell nightly one) and the
   Keolis notices name projects it does not have, so an empty list beats a foreign one. */
const SIM_NOTICES: SimNotice[] =
  { CAPEX: CAPEX_NOTICES, SUPPLYCHAIN: [] as SimNotice[] }[currentDataset().toUpperCase()] ?? KEOLIS_NOTICES

/* The bell's own antd badge never drew, so this frame paints a count of its own. It is a fixed element
   on the document body, placed from the bell's bounding box, rather than a child of the button: the
   button belongs to React and its ancestors clip. The original `sup` is hidden, React owning it. */
const BELL_BADGE_CSS =
  ' .ant-badge:has(> button[aria-label="Notifications"]) > sup { display: none !important }' +
  ' .cw-bell-count { position: fixed; z-index: 2147483000; min-width: 18px; height: 18px; padding: 0 5px;' +
  ' border-radius: 9px; background: #f04438; color: #fff; font: 600 11px/18px system-ui, sans-serif;' +
  ' text-align: center; box-shadow: 0 0 0 2px #fff; pointer-events: none; box-sizing: border-box }'

function badgeNotices(inner: Document) {
  const win = inner.defaultView as (Window & { __cwJourney?: { useGoalStore?: { getState: () => { notices: { read: boolean }[] } } } }) | null
  if (!win) return
  const paint = () => {
    const btn = inner.querySelector<HTMLElement>('button[aria-label="Notifications"]')
    const n = win.__cwJourney?.useGoalStore?.getState().notices.filter((x) => !x.read).length ?? 0
    let badge = inner.querySelector<HTMLElement>('.cw-bell-count')
    const rect = btn?.getBoundingClientRect()
    if (!btn || !rect || !rect.width || !n) return void badge?.remove()
    if (!badge) {
      badge = inner.createElement('span')
      badge.className = 'cw-bell-count'
      inner.body.appendChild(badge)
    }
    const text = n > 99 ? '99+' : String(n)
    if (badge.textContent !== text) badge.textContent = text
    badge.style.left = `${Math.round(rect.right - 14)}px`
    badge.style.top = `${Math.max(1, Math.round(rect.top - 2))}px`
  }
  new MutationObserver(paint).observe(inner.body, { childList: true, subtree: true })
  win.addEventListener('resize', paint)
  win.setInterval(paint, 500)
}

type GoalStoreLike = {
  getState: () => { notices: unknown[]; goals?: { id: string; status: string }[] }
  setState: (p: object) => void
}

function notifyOnSimulate(inner: Document) {
  const win = inner.defaultView as (Window & { __cwJourney?: { useGoalStore?: GoalStoreLike } }) | null
  if (!win) return
  inner.addEventListener('click', (ev) => {
    const btn = (ev.target as Element | null)?.closest?.('button, a, [role="button"]')
    if (!/Simulate( the (22 September )?snapshot|: run now| tonight’s order load)/.test(btn?.textContent ?? '')) return
    SIM_NOTICES.forEach(([delay, title, text, tab], n) => {
      win.setTimeout(() => {
        const store = win.__cwJourney?.useGoalStore
        if (!store) return
        /* The goal open in the panel has no id in the frame's hash, so it is read off the store: the
           one the press just fired, else the hash's, else the first standing goal. */
        const goals = store.getState().goals ?? []
        const goalId =
          win.location.hash.match(/goals\/([^/?#]+)/)?.[1] ??
          goals.find((g) => g.status === 'fired' || g.status === 'analysing')?.id ??
          goals[0]?.id
        if (!goalId) return
        const held = store.getState().notices as { goalId: string; title: string; read: boolean }[]
        if (held.some((x) => x.goalId === goalId && x.title === title && !x.read)) return
        const stamp = Date.now()
        const id = `n-sim-${goalId}-${n}-${stamp.toString(36)}`
        store.setState({
          notices: [{ id, at: stamp, kind: 'needs-input', goalId, title, text, read: false, tab }, ...store.getState().notices],
        })
        /* The build marks a notice read the moment it arrives for the goal that is open, which is the one
           these are for, so the bell would never count them. They are put back to unread just after. */
        win.setTimeout(() => {
          store.setState({
            notices: (store.getState().notices as { id: string }[]).map((x) => (x.id === id ? { ...x, read: false } : x)),
          })
        }, 100)
      }, delay)
    })
    /* Capture, because the rail's link stops the click's propagation and a bubbling listener on the
       document would never hear it. */
  }, true)
}

/**
 * The build answers almost instantly — each agent message lands a beat after the one before — so the
 * chat reads as an HTML page filling itself in rather than an analyst working. Asked first for a long
 * hold with a loader, then refined: a shimmer, and **each paragraph rendering 10s after the last**
 * (`PARAGRAPH_MS`), the arrangement Ask's answer stream already keeps.
 *
 * Done from the frame, never by editing the generated file: a MutationObserver catches each agent
 * message (`.hub-agent`) as React adds it and hides it with a data attribute (not a class — React
 * rewrites `className` when a message's `is-cont` flag flips, which would un-hide it). Its paragraphs
 * (the children of its text block, and any card beside it) are then revealed one per `PARAGRAPH_MS`,
 * with a shimmering skeleton and a changing status line sitting under whatever has been written so far.
 * Messages are processed **one at a time, in order**, so a flow that pushes five steps in two seconds
 * still plays out as five separate pieces of work.
 *
 * What is held is a message that arrives **because of something the reader just did**: within
 * `ACT_WINDOW_MS` of a click or keypress outside the goal list, or while earlier messages are still
 * queued. Opening a saved goal re-renders its whole history at once and must not be replayed with a
 * wait, so a click in the rail does not arm the hold and a batch of more than `MAX_BATCH` messages is
 * treated as history. The build's own typing bubble is left alone. A held message that React removes
 * (the reader opened another goal) is dropped from the queue rather than waited on.
 */
const PARAGRAPH_MS = 5_000
const PANEL_TOTAL_MS = 5_000
const PANEL_MAX_GAP_MS = 3_000
const PACK_DELAY_MS = 5_000
const TAB_FALLBACK_MS = 5_000
const ACT_WINDOW_MS = 10_000
const MAX_BATCH = 3
const STATUS_STEP_MS = 3_500
const AGENT_STATUS = [
  'Reading the goal and the attached material…',
  'Pulling the matching figures from the connected sources…',
  'Cross-checking the numbers against the approved budgets…',
  'Working out what it means…',
  'Writing it up…',
]

/* The panel's "Build in Submissions" (the Outputs rows, `.out`) drew its label in a muted grey on the
   dark primary fill; the chat's copy of the same button is white. */
const BUILD_BTN_CSS =
  ' .out .ant-btn-primary, .out .ant-btn-primary span { color: #fff !important }'

/* "Browse everything" at the foot of the OneDrive / Outlook picker was asked off the menu. It is the one
   item that follows a `.menu-sep` and is itself a `.mi` (the other separator is followed by the
   "Connected" heading), so the pair is hidden by that adjacency rather than by its label. */
/* The black "Waiting for you · Go to it" dock above the composer was asked off. It is the build's own
   `.dock`, so it is hidden from the frame; the "Needs you" count and the bell still say what waits. */
const NO_DOCK_CSS = ' .dock { display: none !important }'

const NO_BAR_CSS =
  ' [data-cw-restored] .st-bar, [data-cw-restored] > :first-child { display: none !important }'

const NO_BROWSE_CSS =
  ' .menu-sep:has(+ .mi), .menu-sep + .mi { display: none !important }'

const AGENT_HOLD_CSS =
  ' [data-cw-hold] { display: none !important }' +
  ' .cw-shimmer { display: flex; flex-direction: column; gap: 8px; padding: 4px 0 6px; max-width: 520px }' +
  ' .cw-shimmer .cw-status { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #6b7384 }' +
  ' .cw-shimmer .gc-typing { padding: 0 }' +
  ' .cw-shimmer i { display: block; height: 11px; border-radius: 6px; background: linear-gradient(90deg,' +
  ' #eceff4 25%, #f8f9fb 50%, #eceff4 75%); background-size: 200% 100%; animation: cw-shim 1.4s linear infinite }' +
  ' .cw-shimmer i:nth-child(2) { width: 96% } .cw-shimmer i:nth-child(3) { width: 88% }' +
  ' .cw-shimmer i:nth-child(4) { width: 62% }' +
  ' .st-beat.is-pending .st-body { height: 11px; border-radius: 6px; background: linear-gradient(90deg,' +
  ' #eceff4 25%, #f8f9fb 50%, #eceff4 75%); background-size: 200% 100%; animation: cw-shim 1.4s linear infinite }' +
  ' @keyframes cw-shim { from { background-position: 200% 0 } to { background-position: -200% 0 } }' +
  ' @media (prefers-reduced-motion: reduce) { .cw-shimmer i { animation: none } }'

function holdAgentMessages(inner: Document) {
  const win = inner.defaultView
  if (!win) return
  const queue: HTMLElement[] = []
  let running = false
  let lastAct = 0

  const arm = (ev: Event) => {
    /* A click in the rail only opens a saved goal, which must not arm the hold — except the rail's own
       "Simulate the snapshot", which fires the goal and is the same act as the panel's button. */
    const el = ev.target as Element | null
    if (el?.closest?.('.hub-rail') && !el.closest('.rl-mini')) return
    lastAct = Date.now()
  }
  inner.addEventListener('click', arm, true)
  inner.addEventListener('keydown', arm, true)

  /* The paragraphs of a message, in order: each child of the text block, and each other block (a card)
     beside it. A message with neither is one unit — itself. */
  const unitsOf = (el: HTMLElement): HTMLElement[] => {
    const body = el.querySelector<HTMLElement>('.hub-agent-body')
    if (!body) return []
    const out: HTMLElement[] = []
    for (const child of Array.from(body.children) as HTMLElement[]) {
      if (child.classList.contains('hub-text')) out.push(...(Array.from(child.children) as HTMLElement[]))
      else out.push(child)
    }
    return out
  }

  const makeShimmer = (label = AGENT_STATUS[0]) => {
    const box = inner.createElement('div')
    box.className = 'cw-shimmer'
    const status = inner.createElement('div')
    status.className = 'cw-status'
    const dots = inner.createElement('span')
    dots.className = 'gc-typing'
    dots.append(inner.createElement('span'), inner.createElement('span'), inner.createElement('span'))
    const text = inner.createElement('span')
    text.textContent = label
    status.append(dots, text)
    box.appendChild(status)
    for (let i = 0; i < 3; i++) box.appendChild(inner.createElement('i'))
    return { box, text }
  }

  /*
   * The panel's tabs (Plan · Workflow · Data · Log, then Findings and the rest) are chosen by the
   * build from the goal's stage, and a stage moves the instant the chat's state does — so Workflow,
   * Data and Log all appeared at once, ahead of the conversation that is supposed to have produced
   * them. A tab the build adds after the reader has acted is held, and **released by the chat**: each
   * time an agent message finishes writing itself, the oldest held tab appears. `TAB_FALLBACK_MS`
   * chains a release behind each hold as well, so a tab is never stranded when no message is coming.
   * The first tab (Plan) and the selected one are never held, and a tab is held once per goal.
   */
  const heldTabs: HTMLElement[] = []
  const shownTabs = new Set<string>()
  let tabAt = 0
  const releaseTab = (btn: HTMLElement | undefined = heldTabs.shift()) => {
    if (!btn) return
    const i = heldTabs.indexOf(btn)
    if (i >= 0) heldTabs.splice(i, 1)
    btn.removeAttribute('data-cw-hold')
  }
  const holdTab = (btn: HTMLElement) => {
    if (btn.hasAttribute('data-cw-hold') || btn.classList.contains('is-on')) return
    if (btn === btn.parentElement?.firstElementChild) return
    const key = `${win.location.hash}|${(btn.firstChild?.textContent ?? '').trim()}`
    if (shownTabs.has(key)) return
    shownTabs.add(key)
    btn.setAttribute('data-cw-hold', '')
    heldTabs.push(btn)
    tabAt = Math.max(Date.now(), tabAt) + TAB_FALLBACK_MS
    win.setTimeout(() => releaseTab(btn), tabAt - Date.now())
  }

  const pump = () => {
    if (running) return
    const el = queue[0]
    if (!el) return
    const body = el.querySelector<HTMLElement>('.hub-agent-body')
    const units = unitsOf(el)
    if (!el.isConnected || !body || !units.length) {
      el.removeAttribute('data-cw-hold')
      queue.shift()
      pump()
      return
    }
    running = true
    for (const u of units) u.setAttribute('data-cw-hold', '')
    el.removeAttribute('data-cw-hold')
    const { box, text } = makeShimmer()
    body.appendChild(box)
    let step = 0
    const ticker = win.setInterval(() => {
      step = Math.min(step + 1, AGENT_STATUS.length - 1)
      text.textContent = AGENT_STATUS[step]
    }, STATUS_STEP_MS)
    let shown = 0
    const reveal = () => {
      if (!el.isConnected) shown = units.length
      else units[shown].removeAttribute('data-cw-hold')
      shown += 1
      if (shown < units.length) {
        /* Keep the shimmer under whatever has been written so far, and restart its status line. */
        units[shown - 1].after(box)
        step = 0
        text.textContent = AGENT_STATUS[0]
        win.setTimeout(reveal, PARAGRAPH_MS)
        return
      }
      win.clearInterval(ticker)
      box.remove()
      if (el.isConnected) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      releaseTab()
      queue.shift()
      running = false
      pump()
    }
    win.setTimeout(reveal, PARAGRAPH_MS)
  }

  /*
   * The answer story ("Asked · Read · Found · Compared · Therefore") reveals its lines on a timer
   * inside the build, 0.7–1.3s apart. Each line (`.st-beat`) is held and released `PARAGRAPH_MS` after
   * the previous one; the build's own pending beat beneath them is the shimmer. Chained off a running
   * release time rather than a queue so a Replay, which remounts the lines, plays out the same way.
   */
  /*
   * A story ("Why this") is played once per recommendation. Its card remounts whenever the reader
   * leaves the Findings tab and comes back, and the story would replay from line one, progress bar
   * and all — so once a card's story has been opened, that card's own "Why this" button is hidden
   * from then on (hidden by data attribute, the button being React's). Only that button: the card,
   * its figures and its other acts are untouched. Keyed by the goal (frame hash) and the card's
   * heading, scanned on every mutation because the button's label flips in place between
   * "Why this" and "Hide the path" without the card being re-added.
   */
  const playedStories = new Set<string>()
  const recoKey = (reco: Element) => `${win.location.hash}|${reco.querySelector('h3')?.textContent?.trim() ?? ''}`
  const settleStory = (st: HTMLElement) => {
    const reco = st.closest('.reco')
    if (!reco || st.hasAttribute('data-cw-restored') || st.hasAttribute('data-cw-played')) return
    const key = recoKey(reco)
    if (!playedStories.has(key)) {
      playedStories.add(key)
      st.setAttribute('data-cw-played', '')
      return
    }
    /* Seen already and open again (the story's open state outlives the tab): finish it at once and
       drop its progress bar and controls, so nothing replays. */
    st.setAttribute('data-cw-restored', '')
    win.setTimeout(() => {
      for (const b of st.querySelectorAll<HTMLElement>('button')) {
        if (b.textContent?.trim() === 'Show all') b.click()
      }
    }, 0)
  }
  /* Once a recommendation is chosen the build drops *Choose* from the alternatives, and that stays:
     the decision reads as final, so nothing here adds the button back. */
  /* Once a recommendation is chosen its story is finished business: pressing Choose again made the
     story replay with its progress bar running. The card is remembered as chosen and its story is
     settled the way a revisited one is (restored: no bar, no controls, no replay). */
  const chosenRecos = new Set<string>()
  const settleChosen = (reco: Element) => {
    for (const st of reco.querySelectorAll<HTMLElement>('.st')) st.setAttribute('data-cw-restored', '')
  }
  inner.addEventListener(
    'click',
    (ev) => {
      const b = (ev.target as Element | null)?.closest?.('.hc-actions button')
      const reco = b?.closest('.reco')
      if (!b || !reco || b.textContent?.trim() !== 'Choose') return
      chosenRecos.add(recoKey(reco))
      settleChosen(reco)
    },
    true,
  )
  const hideSeenWhy = () => {
    for (const reco of inner.querySelectorAll<HTMLElement>('.reco')) {
      if (chosenRecos.has(recoKey(reco))) settleChosen(reco)
      if (!playedStories.has(recoKey(reco))) continue
      for (const b of reco.querySelectorAll<HTMLElement>('.hc-actions button')) {
        const label = b.textContent?.trim()
        if (label === 'Why this') b.setAttribute('data-cw-hold', '')
        /* "Hide the path" goes only where the story is a restored one; a story being watched live
           keeps its button until the reader is back from another tab. */
        else if (label === 'Hide the path' && reco.querySelector('.st[data-cw-restored]')) b.setAttribute('data-cw-hold', '')
      }
    }
  }

  /*
   * The right-hand plan panel (`.pd`: "The brief", "What I'm working from", …) paints every section at
   * once. Its sections, and the rows of "The brief" (`.bf`), are held and released evenly across
   * `PANEL_TOTAL_MS` — one total rather than a gap per item, since how many there are depends on the
   * goal — with a shimmer at the foot of the panel
   * while anything is still to come. Chained off one running release time, like the story beats.
   *
   * A section or row is held **once per goal**: `shown` remembers it by goal (the frame's hash) and its
   * heading or label, because switching the panel's tabs remounts it and replaying a minute of waiting
   * over something the reader has already watched arrive would be a bug, not an effect. Armed like the
   * chat — only after the reader has acted, so opening a saved goal from the rail shows its panel whole.
   */
  const shown = new Set<string>()
  let panelAt = 0
  let panelPending = 0
  let panelStart = 0
  const panelKey = (el: HTMLElement, goal: string) => {
    const label = el.querySelector('h1,h2,h3,h4,.pd-h,.bf-k')?.textContent ?? el.textContent?.slice(0, 40) ?? ''
    return `${win.location.hash}|${goal}|${label.trim()}`
  }
  /* Sections that are new to a panel — the whole set when the panel mounts, a single one when React
     adds one to a panel that is already there (the panel element itself persists across goals). */
  const holdPanel = (pd: HTMLElement, sections: HTMLElement[]) => {
    const goal = (pd.querySelector('.bf')?.textContent ?? '').slice(0, 80)
    const steps: { el: HTMLElement; key: string }[] = []
    for (const section of sections) {
      if (section.classList.contains('pd-status') || section.classList.contains('cw-shimmer')) continue
      if (section.hasAttribute('data-cw-hold')) continue
      steps.push({ el: section, key: panelKey(section, goal) })
      for (const row of Array.from(section.querySelectorAll<HTMLElement>('.bf > *'))) {
        steps.push({ el: row, key: panelKey(row, goal) })
      }
    }
    const todo = steps.filter((st) => !shown.has(st.key))
    if (!todo.length) return
    /* React may add the sections one call at a time, so the budget belongs to the burst, not to a
       call: a burst starts when nothing is pending, spaces items at most PANEL_MAX_GAP_MS apart, and
       nothing in it is released later than PANEL_TOTAL_MS after it started. */
    if (panelPending <= 0) {
      panelStart = Date.now()
      panelAt = panelStart
    }
    const gap = Math.min(PANEL_TOTAL_MS / todo.length, PANEL_MAX_GAP_MS)
    /* One shimmer per panel, however many sections React adds one at a time. */
    const box = pd.querySelector<HTMLElement>(':scope > .cw-shimmer') ?? makeShimmer('Working on it and analyzing the data…').box
    for (const st of todo) {
      st.el.setAttribute('data-cw-hold', '')
      panelAt = Math.min(Math.max(Date.now(), panelAt) + gap, panelStart + PANEL_TOTAL_MS)
      panelPending += 1
      /* Due at its slot — but never ahead of the conversation: while the chat is still writing
         (a message mid-reveal, or more queued), the panel waits and checks again. */
      const release = () => {
        if (st.el.isConnected && (running || queue.length > 0)) {
          win.setTimeout(release, 1_000)
          return
        }
        shown.add(st.key)
        st.el.removeAttribute('data-cw-hold')
        panelPending -= 1
        if (panelPending <= 0) inner.querySelectorAll('.panel-body .cw-shimmer').forEach((n) => n.remove())
      }
      win.setTimeout(release, panelAt - Date.now())
    }
    pd.appendChild(box)
  }

  /*
   * The Submission's right-hand pack (`.hp`: "Draft · Slide pack", the title, the bar of acts and one
   * `.sd-part` per slide) used to appear whole the instant *Build it* was pressed. Pressing it (the chip,
   * the in-chat button, or typing it and sending) starts `PACK_DELAY_MS`: until it has passed everything
   * in the pack but its head is held and a shimmer says it is being built, then the pack appears whole.
   * Re-applied on every mutation because React re-renders the panel's children, and keyed on the build
   * press rather than on what the panel contains, so opening a saved draft is never held.
   */
  let buildAt = 0
  const isBuildIt = (t: string | null | undefined) => /^build it\.?$/i.test((t ?? '').trim())
  inner.addEventListener(
    'click',
    (ev) => {
      const t = ev.target as Element | null
      const btn = t?.closest?.('button, [role="button"]')
      if (btn && isBuildIt(btn.textContent)) buildAt = Date.now()
      else if (btn?.matches('button.send, .gc-send') && isBuildIt(inner.querySelector<HTMLTextAreaElement>('textarea')?.value)) buildAt = Date.now()
    },
    true,
  )
  inner.addEventListener(
    'keydown',
    (ev) => {
      const k = ev as KeyboardEvent
      const t = k.target as HTMLTextAreaElement | null
      if (k.key === 'Enter' && !k.shiftKey && t?.tagName === 'TEXTAREA' && isBuildIt(t.value)) buildAt = Date.now()
    },
    true,
  )
  const holdPack = () => {
    const left = buildAt + PACK_DELAY_MS - Date.now()
    const pack = inner.querySelector<HTMLElement>('.hp')
    if (!pack) return
    if (left <= 0) {
      pack.querySelectorAll(':scope > [data-cw-hold]').forEach((n) => n.removeAttribute('data-cw-hold'))
      pack.querySelector(':scope > .cw-shimmer')?.remove()
      return
    }
    for (const child of Array.from(pack.children) as HTMLElement[]) {
      if (child.classList.contains('hp-head') || child.classList.contains('cw-shimmer')) continue
      child.setAttribute('data-cw-hold', '')
    }
    if (!pack.querySelector(':scope > .cw-shimmer')) pack.appendChild(makeShimmer('Building the slide pack…').box)
    win.setTimeout(holdPack, Math.min(left, 1_000))
  }

  new MutationObserver((records) => {
    hideSeenWhy()
    if (Date.now() < buildAt + PACK_DELAY_MS) holdPack()
    const fresh: HTMLElement[] = []
    const panelArmed = Date.now() - lastAct < ACT_WINDOW_MS || panelPending > 0
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (!(node instanceof win.HTMLElement)) continue
        if (!panelArmed) continue
        const tabs = node.matches('.tabs > .tab') ? [node] : [...node.querySelectorAll<HTMLElement>('.tabs > .tab')]
        for (const t of tabs) holdTab(t)
        if (node.classList.contains('cw-shimmer')) continue
        /* A panel root is whatever the active tab draws into `.panel-body` — the plan's `.pd`, the
           findings, the outputs, the data view. A node added inside one is a new section of it. */
        const parent = node.parentElement
        if (parent?.matches('.panel-body > *')) holdPanel(parent, [node])
        else {
          const roots = node.matches('.panel-body')
            ? (Array.from(node.children) as HTMLElement[])
            : node.matches('.panel-body > *')
              ? [node]
              : [...node.querySelectorAll<HTMLElement>('.panel-body > *')]
          for (const root of roots) holdPanel(root, Array.from(root.children) as HTMLElement[])
        }
      }
    }
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (!(node instanceof win.HTMLElement)) continue
        for (const st of node.matches('.st') ? [node] : [...node.querySelectorAll<HTMLElement>('.st')]) {
          settleStory(st)
        }
        /* Story beats are not held: "Why this" shows every step at once (asked for). */
      }
    }
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (!(node instanceof win.HTMLElement)) continue
        const found = node.matches('.hub-agent') ? [node] : [...node.querySelectorAll<HTMLElement>('.hub-agent')]
        for (const el of found) {
          if (el.hasAttribute('data-cw-hold') || queue.includes(el)) continue
          if (el.querySelector('.gc-typing') || !el.querySelector('.hub-agent-body')) continue
          if (!fresh.includes(el)) fresh.push(el)
        }
      }
    }
    if (!fresh.length) return
    const armed = Date.now() - lastAct < ACT_WINDOW_MS || queue.length > 0
    if (!armed || fresh.length > MAX_BATCH) return
    for (const el of fresh) {
      el.setAttribute('data-cw-hold', '')
      queue.push(el)
    }
    pump()
  }).observe(inner.body, { childList: true, subtree: true })
}

/**
 * "What's missing" lists a box per gap — the four projects with no September forecast (*Add your
 * working forecast*), the Metropolitan Board's decision on tranche 3 (*Add the Q2 minutes*). Adding the
 * document changed nothing there: the box kept saying the thing was missing. Asked for: once it is
 * added the same box turns green and carries an **Added** label, rather than going on reading as a gap.
 *
 * The build's missing-box is driven by the plan's answers, not by what has been attached, so this is
 * done from the frame. Pressing a box's button arms it for that box; choosing a file in the sub-menu it
 * opens (or the build's own *Added by you* document row arriving) is the signal that it happened, and
 * the file's name is read off it. The box is restyled in place by a data attribute, with the original
 * sentence and buttons hidden and a foreign label and note inserted — never removed, since removing a
 * node React still tracks throws on its next render. Remembered per goal and box, so the panel
 * remounting (a tab switch) does not bring the amber box back.
 */
/* KEOLIS's two, then CAPEX's: its Missing boxes carry *Add your working notes* (the nine completed
   projects) and *Add Marc’s thread* (the seven in-service confirmations). Same build, same `.miss`
   box and same sub-menu, so naming the buttons is all a dataset needs. */
const MISSING_ADD_LABELS = [
  'Add your working forecast',
  'Add the Q2 minutes',
  'Add your working notes',
  'Add Marc’s thread',
  'Add the dosing plans',
]

const ADDED_BOX_CSS =
  ' .cw-added-box { background: #ecfdf3; border: 1px solid #abefc6; border-radius: 10px; padding: 10px 12px;' +
  ' margin: 8px 0 }' +
  ' .cw-added-box .cw-added-tag { display: inline-block; background: #12b76a; color: #fff; font-size: 11px;' +
  ' font-weight: 600; border-radius: 6px; padding: 1px 8px; margin-bottom: 6px }' +
  ' .cw-added-box b { display: block; color: #067647 }' +
  ' .cw-added-box p { margin: 4px 0 0; font-size: 13px; color: #067647 }'

function trackForecastAdded(inner: Document) {
  const win = inner.defaultView
  if (!win) return
  /* The box whose button was pressed, and when. */
  let armed: { title: string; at: number } | null = null
  const done = new Map<string, string>()

  const titleOf = (miss: Element) => miss.querySelector('b')?.textContent?.trim() ?? ''
  const keyOf = (title: string) => `${win.location.hash}|${title}`

  /* The box leaves "Missing" and a green copy of it stands under an "Added" heading of its own, in
     the same panel, right after the Missing group. The original stays in the DOM (hidden) because
     React owns it; if nothing visible is left in Missing, its heading goes too. */
  const settle = (miss: HTMLElement, name: string) => {
    if (miss.hasAttribute('data-cw-done')) return
    const group = miss.closest<HTMLElement>('.ctx-g')
    if (!group) return
    miss.setAttribute('data-cw-done', '')
    miss.setAttribute('data-cw-hold', '')
    let added = group.nextElementSibling as HTMLElement | null
    if (!added?.classList.contains('cw-added-group')) {
      added = inner.createElement('div')
      added.className = 'ctx-g cw-added-group'
      const head = inner.createElement('div')
      head.className = 'ctx-gh'
      head.textContent = 'Added'
      added.appendChild(head)
      group.after(added)
    }
    const box = inner.createElement('div')
    box.className = 'cw-added-box'
    const tag = inner.createElement('span')
    tag.className = 'cw-added-tag'
    tag.textContent = 'Added'
    const title = inner.createElement('b')
    title.textContent = titleOf(miss)
    const note = inner.createElement('p')
    note.textContent = name ? `Added: ${name}. It is no longer missing.` : 'Added. It is no longer missing.'
    box.append(tag, title, note)
    added.appendChild(box)
    if (![...group.querySelectorAll('.miss')].some((m) => !m.hasAttribute('data-cw-done'))) {
      group.setAttribute('data-cw-hold', '')
    }
  }
  const apply = (name: string) => {
    if (!armed) return
    const title = armed.title
    armed = null
    done.set(keyOf(title), name)
    for (const m of inner.querySelectorAll<HTMLElement>('.miss')) if (titleOf(m) === title) settle(m, name)
  }

  inner.addEventListener(
    'click',
    (ev) => {
      const target = ev.target as Element | null
      const btn = target?.closest?.('button')
      if (!btn) return
      const text = btn.textContent ?? ''
      const miss = btn.closest('.miss')
      if (miss && MISSING_ADD_LABELS.some((l) => text.includes(l))) {
        armed = { title: titleOf(miss), at: Date.now() }
        return
      }
      /* Picking a file in the sub-menu this button opened (a menu with a "‹ Provider" back row). */
      if (armed && btn.classList.contains('mi')) {
        const menu = btn.closest('.cmenu')
        const hasBack = !!menu && [...menu.querySelectorAll('button')].some((b) => b.textContent?.trim().startsWith('‹'))
        if (hasBack && !text.trim().startsWith('‹')) apply(btn.querySelector('b')?.textContent?.trim() ?? '')
      }
    },
    true,
  )

  new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (!(node instanceof win.HTMLElement)) continue
        /* The build's own signal that a document landed, for an add that did not go through the menu. */
        if (armed) {
          const docs = node.matches('.doc-in') ? [node] : [...node.querySelectorAll<HTMLElement>('.doc-in')]
          for (const d of docs) {
            if (d.querySelector('.tag.you')) apply(d.querySelector('b')?.textContent?.trim() ?? '')
          }
        }
        /* A remounted panel: the box is back, and so is the answer to it. */
        const boxes = node.matches('.miss') ? [node] : [...node.querySelectorAll<HTMLElement>('.miss')]
        for (const m of boxes) {
          const name = done.get(keyOf(titleOf(m)))
          if (name !== undefined) settle(m, name)
        }
      }
    }
  }).observe(inner.body, { childList: true, subtree: true })
}

/**
 * The rail is React-managed inside the frame, so the button cannot be placed once: opening a goal or
 * a draft re-renders the rail's children and a tight viewport remounts the whole `<aside>`. A
 * MutationObserver re-inserts it whenever a rail is missing one — the `injectSessionTab` precedent,
 * with the observer carrying what that static document did not need. Inserting a foreign node among
 * React's children is safe here because React moves its own nodes by reference, never by position;
 * the worst a re-render can do is drop the button, which is exactly what the observer repairs. The
 * observer dies with the frame's document, so there is nothing to tear down.
 */
function injectRailNewButton(inner: Document) {
  const place = () => {
    const label = screenOf(inner.defaultView?.location.hash ?? '') === 'submission'
      ? 'New submission'
      : 'New goal'
    for (const rail of inner.querySelectorAll('.hub-rail')) {
      /* A button from the other screen — the frame navigated under it — is replaced, not kept. */
      const stale = rail.querySelector(':scope > .cw-rail-new')
      if (stale) {
        if (stale.getAttribute('data-label') === label) continue
        stale.remove()
      }
      const btn = inner.createElement('button')
      btn.type = 'button'
      btn.className = 'cw-rail-new'
      btn.setAttribute('data-label', label)
      const plus = inner.createElement('span')
      plus.className = 'cw-plus'
      plus.setAttribute('aria-hidden', 'true')
      plus.textContent = '+'
      btn.append(plus, inner.createTextNode(' ' + label))
      btn.addEventListener('click', () => {
        inner.querySelector<HTMLElement>('.hub-top .hub-new')?.click()
      })
      const search = rail.querySelector(':scope > .rl-search')
      if (search) search.after(btn)
      else rail.prepend(btn)
    }
  }
  place()
  new MutationObserver(place).observe(inner.body, { childList: true, subtree: true })
  /* The observer sees the rail re-render; this sees a hash move that re-renders nothing it watches. */
  inner.defaultView?.addEventListener('hashchange', place)
}

/**
 * "Download → PDF" in the build is `window.print()` over a `.sb-print-target` — the print dialog,
 * where the reader is left to pick "Save as PDF" themselves. Asked for as an actual download.
 *
 * No browser API prints to a file silently, so the page intercepts the frame's `print()` **when and
 * only when the build has just marked a print target** (that mark is the PDF path's own signature;
 * any other print falls through to the real dialog) and downloads a one-page PDF instead:
 *
 * - **The drawing is the build's own pipeline**, not a new renderer: clone the target, inline the
 *   computed styles property-for-property (the same list the build's PNG export uses), serialise
 *   into an SVG `foreignObject`, rasterise through a canvas. What the PNG export already renders
 *   acceptably, this renders identically — and anything it cannot (an external image, a refused
 *   canvas) rejects, and the catch falls back to the real print dialog rather than downloading
 *   nothing.
 * - **The PDF is written by hand** — one page, one JPEG XObject, an xref table — because the
 *   alternative is a PDF library through an audit gate that fails on any advisory, for one page.
 *   The same decision as `sigv4()`.
 * - **The anchor is the app's own document**, not the frame's: the parent is unsandboxed, so the
 *   download rides on nothing the frame's sandbox says.
 * - On success the frame gets a synthetic `afterprint`, which is what runs the build's own cleanup
 *   of the print-target classes (they are `@media print` scoped, so nothing on screen depends on
 *   the timing either way).
 */
const PDF_STYLE_PROPS =
  ('display.position.flex.flex-direction.flex-wrap.justify-content.align-items.gap.' +
    'grid-template-columns.box-sizing.width.min-width.max-width.margin.padding.border.' +
    'border-radius.background.background-color.color.font.font-size.font-weight.font-family.' +
    'line-height.letter-spacing.text-transform.text-align.white-space.word-break.overflow.' +
    'opacity.box-shadow.vertical-align.list-style.border-collapse.border-spacing.text-decoration').split('.')

function inlinePdfStyles(win: Window, src: Element, dst: Element) {
  const computed = win.getComputedStyle(src)
  const style = (dst as HTMLElement).style
  if (style) for (const prop of PDF_STYLE_PROPS) style.setProperty(prop, computed.getPropertyValue(prop))
  for (let i = 0; i < src.children.length && i < dst.children.length; i++) {
    inlinePdfStyles(win, src.children[i], dst.children[i])
  }
}

const PDF_SCALE = 2

async function targetToJpeg(win: Window, el: HTMLElement) {
  const width = Math.ceil(el.getBoundingClientRect().width)
  const height = Math.ceil(el.scrollHeight)
  const clone = el.cloneNode(true) as HTMLElement
  inlinePdfStyles(win, el, clone)
  clone.style.width = `${width}px`
  clone.style.height = 'auto'
  clone.style.margin = '0'
  clone.querySelectorAll('button, .no-print').forEach((n) => n.remove())
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="background:#fff">` +
    new XMLSerializer().serializeToString(clone).replace(/<br>/g, '<br/>') +
    `</div></foreignObject></svg>`
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('render'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
  const canvas = document.createElement('canvas')
  canvas.width = width * PDF_SCALE
  canvas.height = height * PDF_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.scale(PDF_SCALE, PDF_SCALE)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0)
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const raw = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const jpeg = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) jpeg[i] = raw.charCodeAt(i)
  return { jpeg, width: canvas.width, height: canvas.height }
}

/** One page, sized to the drawing (72pt/inch over 96css-px/inch, at PDF_SCALE device px per css px). */
function jpegToPdf(jpeg: Uint8Array, width: number, height: number): Blob {
  const wPt = (width * 72) / (96 * PDF_SCALE)
  const hPt = (height * 72) / (96 * PDF_SCALE)
  const encoder = new TextEncoder()
  const content = `q ${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm /Im0 Do Q`
  const objects: (string | Uint8Array)[][] = [
    ['1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'],
    ['2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'],
    [
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}]` +
        ' /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n',
    ],
    [`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`],
    [
      `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height}` +
        ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      '\nendstream\nendobj\n',
    ],
  ]
  const chunks: Uint8Array[] = [encoder.encode('%PDF-1.4\n')]
  let offset = chunks[0].length
  const offsets: number[] = []
  for (const parts of objects) {
    offsets.push(offset)
    for (const part of parts) {
      const bytes = typeof part === 'string' ? encoder.encode(part) : part
      chunks.push(bytes)
      offset += bytes.length
    }
  }
  const xref =
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  chunks.push(encoder.encode(xref))
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

async function downloadTargetAsPdf(inner: Document, target: HTMLElement) {
  const win = inner.defaultView
  if (!win) throw new Error('no window')
  const { jpeg, width, height } = await targetToJpeg(win, target)
  const name = `${win.location.hash.match(/submissions\/([^/?#]+)/)?.[1] ?? 'submission'}.pdf`
  const url = URL.createObjectURL(jpegToPdf(jpeg, width, height))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function GoalsSubmissionPage({ view }: { view: View }) {
  const { title, subtitle, gateDetail } = VIEWS[view]

  /*
   * Which file the frame holds and the hash it opened on, frozen at **first mount** — the view the
   * reader entered through, not the one selected now. The frame must never reload on a view switch
   * (see the header comment: a draft built from a goal lives in its memory), and these two are what
   * the iframe's `src` is made of, so they are the two props that must not move. Everything after
   * the first load is a hash write on the live frame.
   */
  const entry = useRef(VIEWS[view]).current

  /* The frame's window, captured in `enhance` — null until the document has loaded. */
  const frameWinRef = useRef<Window | null>(null)
  /* The latest view and navigate, for the frame's own listeners: `enhance` runs once per load, so a
     closure over the mount-time props would compare every later hash move against the first view. */
  const viewRef = useRef(view)
  viewRef.current = view
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  const index = useReportsStore((s) => s.index)
  const loading = useReportsStore((s) => s.loading)
  const error = useReportsStore((s) => s.error)
  const load = useReportsStore((s) => s.load)

  /* No role: the counts are the same whatever role asks, and the gate reads nothing else. */
  useEffect(() => {
    void load()
  }, [load])

  /* Per view, not once: each arrival from the sidebar should find the list open. Wrapped because
     `localStorage` throws in a private window. */
  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, JSON.stringify(true))
    } catch {
      /* The rail then keeps whatever state the browser holds — the page still renders. */
    }
  }, [view])

  /*
   * App → frame: a sidebar click moves the live frame to that screen, by hash. Only when the screens
   * disagree — the frame may already be there because it navigated *itself* and this route change is
   * the sync catching up, and writing the view's bare fragment then would clobber the draft's own
   * `/K/submissions/<id>`. Before the document has loaded there is no window to move; the reconcile
   * in `enhance` covers a sidebar click made while the 4 MB file was still arriving.
   */
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
      {title ? <PageHeader title={title} subtitle={subtitle} /> : null}
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
          document={{ file: entry.file, title: title || (view === 'goals' ? 'Goals' : 'Submission') }}
          seamless
          fillWindow
          noHold={view !== 'goals'}
          fragment={entry.fragment}
          enhance={(inner) => {
            const style = inner.createElement('style')
            style.textContent = HIDE_SHELL_CSS + FIT_HUB_CSS + RAIL_NEW_CSS + TOGGLE_TAB_CSS + AGENT_HOLD_CSS + BUILD_BTN_CSS + NO_BROWSE_CSS + NO_BAR_CSS + NO_DOCK_CSS + ADDED_BOX_CSS + BELL_BADGE_CSS
            inner.head?.appendChild(style)
            injectRailNewButton(inner)
            holdAgentMessages(inner)
            trackForecastAdded(inner)
            dropChipAttachments(inner)
            notifyOnSimulate(inner)
            badgeNotices(inner)

            const win = inner.defaultView
            if (!win) return
            frameWinRef.current = win
            /* Every build of the prototype bootstraps itself with `localStorage.setItem(
               'contextweave.dataset', 'KEOLIS')`, and the frame shares this app's origin and storage — so
               opening Goals or Submission overwrote the reader's selection, and the next reload came
               back on Keolis (`/K/…`). The app's own selection is the authority, so it is written back
               once the document has had its say. The in-memory value never changed, which is why the
               page looked right until the reload. */
            try {
              win.localStorage.setItem('contextweave.dataset', currentDataset())
            } catch {
              /* A blocked store: nothing was overwritten either, since the document's write failed too. */
            }
            /*
             * Frame → app: the document navigating itself — "Build in Submissions" inside a goal is a
             * router move to `/K/submissions/<id>` — pulls the app's route along, so the sidebar names
             * the screen the reader is on. Only when the screens disagree, which is also what stops
             * this and the app → frame effect answering each other: whichever side moved, the other
             * sees agreement and stays put.
             *
             * **Deferred to the next tick**, so the app's router is never driven from inside the
             * frame's own navigation call.
             */
            const sync = () => {
              win.setTimeout(() => {
                const screen = screenOf(win.location.hash)
                if (screen !== viewRef.current) {
                  navigateRef.current(appPath(screen === 'submission' ? '/submission' : '/goals'))
                }
              }, 0)
            }
            /*
             * The prototype's hash router navigates through `history.pushState`, which fires
             * **neither `hashchange` nor `popstate`** — so a listener alone sees a sidebar-driven
             * hash write and misses every navigation the document makes itself, which is exactly the
             * one this sync exists for. Reported from use: Build in Submissions switched the screen
             * and the sidebar stayed on Goals. So both history writers are wrapped — the
             * `injectSessionTab` move, on `pushState` instead of `setTab` — and the two events cover
             * what the wrappers cannot: back/forward (`popstate`) and a plain hash write
             * (`hashchange`). The wrappers die with the frame's document, like its own timers.
             */
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
            /*
             * Download → PDF, as a download — see the block comment on `downloadTargetAsPdf`. The
             * build's PDF path marks a `.sb-print-target` and calls `print()`; that mark is the
             * discriminator, so any print without one (there is none today) still gets the real
             * dialog. A failed render falls back to the dialog too, because the alternative is the
             * chat saying "Downloading the PDF." over nothing arriving — the symptom this fixes.
             */
            const nativePrint = win.print.bind(win)
            win.print = () => {
              const target = inner.querySelector<HTMLElement>('.sb-print-target')
              if (!target) {
                nativePrint()
                return
              }
              downloadTargetAsPdf(inner, target)
                .then(() => win.dispatchEvent(new Event('afterprint')))
                .catch(() => nativePrint())
            }
            /* A sidebar click made while the document was still loading had no window to move. */
            if (screenOf(win.location.hash) !== viewRef.current) {
              win.location.hash = VIEWS[viewRef.current].fragment
            }
          }}
        />
      )}
    </div>
  )
}
