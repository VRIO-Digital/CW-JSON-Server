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
const VIEWS = {
  goals: {
    title: '',
    subtitle:
      '',
    file: 'Keolis_Goals.html',
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
    file: 'Keolis_Submissions.html',
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
          document={{ file: entry.file, title }}
          seamless
          fillWindow
          fragment={entry.fragment}
          enhance={(inner) => {
            const style = inner.createElement('style')
            style.textContent = HIDE_SHELL_CSS + FIT_HUB_CSS + RAIL_NEW_CSS + TOGGLE_TAB_CSS
            inner.head?.appendChild(style)
            injectRailNewButton(inner)
            dropChipAttachments(inner)

            const win = inner.defaultView
            if (!win) return
            frameWinRef.current = win
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
