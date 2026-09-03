/**
 * One rendered document, framed — a report from the Library, or a dataset’s own What-if lens.
 *
 * **An iframe, because the document is a whole page.** Each of these files is a standalone 2.5 MB
 * document with its own `<!DOCTYPE>`, its own `<head>`, its own `data-theme` on `<html>` and its own
 * inline scripts. Injecting the body into this app's tree would mean dropping the `<head>` — losing the
 * styling the report *is* — and scoping every remaining selector, which is the problem that forced
 * `.cw-reports` on the vendored prototype's sheet, only with 2.5 MB of markup and live script. The frame
 * is a real boundary: nothing in the document can restyle the app and nothing in the app can restyle the
 * document.
 *
 * **What that boundary costs, stated rather than glossed.** The app cannot see inside: a click on a
 * button *within* the document reaches nothing here, so anything the document offers to save or share is
 * its own and does not reach this app's Library. The buttons that do work are the ones around the frame.
 * The document also loads its own webfonts from the network, which is its business rather than this
 * app's — but it means a report renders unstyled text offline, and that is the frame's doing, not a
 * broken report.
 *
 * **Two callers, one component.** The Library frames a rendered report, and the What-if page frames a
 * rendered lens for a dataset that ships one instead of a traversal to compute. They need the same four
 * things — one copy of the file resolved to a URL, a real boundary around it, the document's own print
 * path, and a missing file named rather than guessed — so a second viewer would be a second copy of all
 * of that, and the `.apiFab` rule below would then hold for whichever of the two somebody remembered.
 * What differs is only what sits around the frame, which is why the back action is a prop.
 *
 * **`seamless` renders the document *as the page* rather than as a file being viewed**, which is what the
 * What-if lens is: the frame is the whole of that page, so viewer furniture around it — a Back to
 * somewhere it did not come from, an Export button, a bar restating a title the document prints itself —
 * announces an embedded HTML file instead of a page of this app. It drops all three, drops the frame's
 * border and radius, and paints the document's own page background white so it does not read as a panel
 * floating on the app's. **What it costs is the print button**, stated rather than glossed: nothing else
 * offers to print a framed lens, and the browser's own Print on this page prints the app around it,
 * because this stylesheet deliberately narrows nothing for print.
 *
 * **The frame is not auto-sized to its content, and that is a decision.** Matching the iframe's height to
 * `scrollHeight` would put the document in the app's own scroll and remove the inner scrollbar — the last
 * cue that this is a frame. It would also break the document: this lens positions its publish overlay
 * (`.shOv`, `inset: 0`) and its toast (`.shToast`, `bottom: 26px`) with `position: fixed`, which is
 * relative to the **iframe's** viewport. Make that viewport as tall as the document and a reader scrolled
 * past the top clicks Publish and sees nothing happen, because the dialog opened a thousand pixels above
 * them. A fixed-height frame keeps the viewport the document was authored against.
 *
 * **But it is measured rather than guessed, because a guess gave two scrollbars.** `82vh` plus the page
 * header plus the shell's padding is taller than the viewport, so the *app* scrolled as well as the
 * document — two vertical scrollbars side by side, and a reader who drags the outer one moves the frame
 * instead of the report. Reported, and the fix is to make the frame exactly fill what is left of the
 * viewport: then the app has nothing to scroll and the document's own bar is the only one. It is
 * **measured** — the page header's height is not a number this component may assume, and a `calc()` with
 * a hardcoded offset is that assumption with extra steps. The space *below* the frame is measured too, so
 * the shell's bottom padding is accounted for without naming the shell.
 *
 * This also puts the fixed-position overlay exactly over the visible frame, which is a second reason to
 * fit rather than overflow: with a 82vh frame in a scrolled page, `inset: 0` covered a region partly off
 * screen.
 *
 * **Its own component, so it can be asserted on** — the same reason `PublishedReportPane` is one.
 */

import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons'
import { Alert, Button, Spin, Tooltip, Typography } from 'antd'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { REPORT_EXPORT_HINT } from '../../data/reportExport'
import { reportDocumentFiles, reportDocumentUrl } from '../../data/reportDocuments'
import './DocumentViewer.css'

/**
 * What this component needs of a document, which is less than either payload carries.
 *
 * Declared **structurally** rather than as a union of `ReportDocument | WhatIfDocument`: both satisfy it
 * as they are, so neither call site has to reshape its row on the way in, and a third kind of framed
 * document needs no edit here. The three label fields are optional because they are what the two kinds
 * disagree about — a report states a `category` and a lens states a `stage` — and the bar prints
 * whichever are present rather than an empty separator for one that is not.
 */
/**
 * `useLayoutEffect` in the browser, `useEffect` where there is no layout.
 *
 * The measurement below has to land **before paint** — in a plain effect the first frame is the
 * stylesheet's fallback height and then jumps, which reads as the page settling. But this repo tests
 * components through `renderToString`, and a layout effect there warns on every render ("does nothing
 * on the server"), which is noise that would eventually hide a real warning. The standard alias keeps
 * the pre-paint measurement where it matters and stays quiet where it cannot run.
 */
const useMeasureEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface FramedDocument {
  file: string
  title: string
  version?: string
  category?: string
  stage?: string
}

export default function DocumentViewer({
  document: doc,
  onBack,
  backLabel = 'Back to Library',
  seamless = false,
  enhance,
}: {
  document: FramedDocument
  /** Absent where the frame *is* the page — the What-if lens has nothing to go back to. */
  onBack?: () => void
  backLabel?: string
  /** Render the document as the page rather than as a framed file. See the note above. */
  seamless?: boolean
  /**
   * Run against the loaded document, after the stylesheets are in.
   *
   * **The one thing this viewer lets a caller do inside the frame**, and it is a seam rather than a
   * capability: what goes in belongs to the page that framed the document, not to a viewer shared
   * by reports, the What-if lens and this. Audit & Governance uses it to put its Session history tab
   * in the document's own strip — see `injectSessionTab` for why that could not be a tab out here.
   *
   * Optional and absent everywhere else, so nothing reaches into a report or a lens by default.
   */
  enhance?: (inner: Document) => void
}) {
  const url = reportDocumentUrl(doc.file)

  /*
   * How tall the frame is, in seamless mode: exactly the viewport left below it.
   *
   * `null` until measured, which falls back to the stylesheet's height — so a render with no layout
   * (`renderToString`, or the first paint) shows a sensible frame rather than a collapsed one.
   */
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [fitted, setFitted] = useState<number | null>(null)

  /*
   * Before paint, so the first painted frame is already the right size — measuring after it shows one
   * frame at the stylesheet's height and then resizes, which reads as the page settling. Nothing runs
   * under `renderToString`, which is why the stylesheet's fallback exists.
   */
  useMeasureEffect(() => {
    if (!seamless) return
    const el = frameRef.current
    if (!el) return

    const measure = () => {
      const root = window.document.documentElement
      const rect = el.getBoundingClientRect()
      /*
       * What sits *after* the frame in the document — the shell's bottom padding, and anything else a
       * page puts below it. Derived rather than named: reading `.app-content`'s padding would tie this
       * component to the app frame it is rendered inside, and the number would be wrong the first time
       * that padding changed.
       */
      const below = Math.max(
        0,
        root.scrollHeight - (rect.top + window.scrollY + el.offsetHeight),
      )
      /*
       * The frame's top **in the document**, so the fit does not depend on where the page happens to be
       * scrolled when a resize arrives: `rect.top` alone is short by the scroll offset, which fits the
       * frame too tall and puts the outer scrollbar straight back. Once fitted the page cannot scroll,
       * so `scrollY` is 0 from then on — this matters for the one measurement taken before that.
       */
      const top = rect.top + window.scrollY
      /* A floor, so a very short viewport leaves a usable frame and scrolls the page instead. */
      setFitted(Math.max(MIN_FRAME_PX, Math.round(root.clientHeight - top - below)))
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [seamless, url])

  /*
   * Whether the framed document has reached the thing it was opened for.
   *
   * Kept as the URL it is true *of* rather than a boolean, because opening a second report would
   * otherwise be ready for one render on the strength of the first one's load: a `setReady(false)`
   * inside an effect runs after that render, which is one painted frame of the previous document
   * under the new document's name.
   */
  const [openedUrl, setOpenedUrl] = useState<string | null>(null)
  const ready = url !== null && openedUrl === url

  /*
   * **The frame is held until the document has opened its report, and this watches for it.**
   *
   * These documents are the whole prototype app with one report on top, and the parts that make them
   * *a report* are the last lines of a 2.6 MB file: the style that hides the app's own sidebar and
   * topbar, then the script that signs in and calls `repOpen`. So a browser parsing top-down paints
   * that shell and its Knowledge-graphs screen first, for as long as the rest of the file takes —
   * somebody else's app flashing past under this Library's Open button, which reads as the wrong
   * report having opened.
   *
   * It cannot be fixed in the file: its `_meta` says *"never hand-edit this file — change the
   * generator and rebuild"*, the same rule that puts the `.apiFab` and seamless rules in a stylesheet
   * this frame injects. So the frame is held and this app says what it is waiting for instead.
   *
   * **The reveal is observed, not timed.** `go('reports')` puts `on` on the document's own
   * `#v-reports`, so that class *is* the report having been opened — the rule the rest of this app
   * keeps, where a stage advances when its call returns rather than on a timer the client holds. A
   * document that has no such shell — the What-if lens is one page, not an app — is ready once it has
   * finished loading, and a frame this app cannot see into is ready immediately, because a frame it
   * cannot read is one it cannot wait on either.
   *
   * **And the wait is capped, because the alternative to a wrong picture must not be no picture.** A
   * regenerated document that renamed that id would otherwise hold a spinner over a report sitting
   * there fully drawn. Past `REVEAL_CAP_MS` the frame is shown whatever it says — counted from the
   * document *arriving*, not from the frame mounting, so a slow 2.6 MB download does not spend the
   * allowance it exists to cover. A document that never arrives is still opening, and "Opening…" is the
   * true thing to say about it; there would be nothing to reveal in any case.
   */
  useEffect(() => {
    if (!url) return
    const el = frameRef.current
    if (!el) return

    let arrivedAt = 0
    const timer = window.setInterval(() => {
      const inner = el.contentDocument
      /*
       * **`about:blank` is a complete document, and that was this hold's one real bug.** A frame carries
       * its own blank document from the moment it is mounted until the first byte of the response lands,
       * and that placeholder reports `readyState: 'complete'` — so the fallback below fired on the first
       * tick, revealed the frame, and the real document then painted its shell into it, which is the
       * flash this whole effect exists to prevent.
       *
       * It showed on the **first** open only, which is what made it read as a glitch rather than a bug:
       * on a second open the 2.6 MB is in the browser's cache, so the real document is already parsing
       * before the first tick and its `#v-reports` is there to be waited on. A cache is not a hold. So
       * arrival is checked rather than assumed, and only a document that has actually arrived can be
       * complete.
       */
      const arrived = !inner || inner.URL !== 'about:blank'
      if (arrived && !arrivedAt) arrivedAt = Date.now()
      const shell = inner ? inner.getElementById(REPORT_VIEW_ID) : null
      const opened = shell
        ? shell.classList.contains(REPORT_VIEW_OPEN)
        : arrived && (!inner || inner.readyState === 'complete')
      if (opened || (arrivedAt > 0 && Date.now() - arrivedAt > REVEAL_CAP_MS)) {
        window.clearInterval(timer)
        setOpenedUrl(url)
      }
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [url])

  return (
    <div className={seamless ? 'dvw dvw--seamless' : 'dvw'}>
      {/*
        * The bar holds a way back, an export and a label — seamless has none of the three, and an empty
        * flex row with a bottom margin is a gap nobody can account for. So it is not rendered at all
        * rather than rendered empty.
        */}
      {seamless ? null : (
        <div className="dvw-bar">
          {/* Offered only where there is somewhere to go. A framed lens is the page itself, and a Back
              that returned to the same screen would be a control that does nothing. */}
          {onBack ? (
            <Button icon={<ArrowLeftOutlined />} onClick={onBack} size="small">
              {backLabel}
            </Button>
          ) : null}

          {/*
            * Export is the browser's, exactly as it is for an EPA report — and here it is the *document's*
            * own print path, since an iframe prints as its own page. Offered only where there is a document
            * to print: printing a "file is missing" alert is not an export.
            */}
          {url ? (
            <Tooltip title={REPORT_EXPORT_HINT}>
              <Button
                icon={<PrinterOutlined />}
                size="small"
                onClick={() => {
                  /* The frame prints itself, so the app's own print rules never come into it. A frame
                     that has not loaded has no `contentWindow` to ask, which is why this is guarded. */
                  const frame = window.document.getElementById(FRAME_ID) as HTMLIFrameElement | null
                  frame?.contentWindow?.focus()
                  frame?.contentWindow?.print()
                }}
              >
                Export PDF
              </Button>
            </Tooltip>
          ) : null}

          {/*
            * Which document this is, in its own words, so the frame is labelled by the app around it.
            *
            * Built from the fields that are actually present rather than interpolated in a fixed order: a
            * lens states a stage where a report states a category, and `· ${undefined}` renders a
            * separator followed by nothing, which reads as a field that failed to load.
            */}
          <div className="dvw-name">
            <Typography.Text strong>{doc.title}</Typography.Text>
            <Typography.Text type="secondary">
              {[doc.version, doc.category, doc.stage].filter(Boolean).map((fact) => ` · ${fact}`).join('')}
            </Typography.Text>
          </div>
        </div>
      )}

      {/*
        * The frame and what covers it while it boots, in one positioned box.
        *
        * A plain block wrapper on purpose: the seamless fit measures the frame against the document
        * it is in, so a wrapper that grew or added space of its own would put the outer scrollbar
        * back. It contributes no height beyond the frame's and exists only to be what the waiting
        * panel is positioned against.
        */}
      <div className="dvw-stage">
        {url ? (
          <iframe
            id={FRAME_ID}
            ref={frameRef}
            className={
              (seamless ? 'dvw-frame dvw-frame--seamless' : 'dvw-frame') +
              /* Hidden rather than unmounted: a frame that is not in the document is not loading, so
                 there would be nothing to wait for and nothing to measure. */
              (ready ? '' : ' dvw-frame--pending')
            }
            /* The stylesheet's height stands until the measurement lands, and for a framed report always. */
            style={seamless && fitted !== null ? { height: fitted } : undefined}
            src={url}
            title={`${doc.title} — rendered document`}
            /*
             * `same-origin` so the document's own scripts run and so `contentWindow.print()` is reachable;
             * these files are part of this build rather than third-party content. `allow-modals` because
             * the print dialog is one.
             */
            sandbox="allow-same-origin allow-scripts allow-modals allow-popups"
            /*
             * **The document's own mock-API pill is hidden, and hidden rather than deleted.**
             *
             * Each of these files carries a floating `.apiFab` — an `API <count>` badge that toggles a log
             * of the mock calls behind the screen. It is a prototype affordance: useful in the standalone
             * document, noise inside an app that has its own API. Asked to be removed.
             *
             * **Done from here rather than by editing the HTML**, because the document's own `_meta` says
             * *"never hand-edit this file — change the generator and rebuild"*. An edit would be lost at the
             * next export and would silently come back; a rule applied by the frame holds for whatever
             * version of the document is dropped in. It also keeps the file byte-identical to what the
             * generator produced, which is what makes it diffable against its source.
             *
             * The trade is that this is the app reaching into the document — the one place it does. It is a
             * *style* only: nothing is removed from the DOM and no script is touched, so the document still
             * works exactly as it did, and its log is still reachable by anyone who opens the file directly.
             */
            onLoad={(event) => {
              const frame = event.currentTarget
              const inner = frame.contentDocument
              /* Same-origin is a precondition, and a cross-origin document simply has no `contentDocument`
                 — so an absent one is not an error, it is a document this rule cannot apply to. */
              if (!inner) return
              const style = inner.createElement('style')
              /*
               * **And the page background, in seamless mode only.** This document paints `body` with its
               * own `--bg0` (#f3f4f6), which inside a borderless frame on a white page reads as a grey
               * panel with nothing explaining its edges. Overriding `body` rather than the token, because
               * a token name is this document's private vocabulary and the next export may not have it —
               * `background` on `body` is the fact, `--bg0` is one file's way of spelling it.
               *
               * Injected here for the same reason the pill above is: the document's `_meta` says *"never
               * hand-edit this file — change the generator and rebuild"*, so an edit would be lost at the
               * next export and would silently come back, while a rule applied by the frame holds for
               * whatever version is dropped in and keeps the file byte-identical to what produced it.
               */
              /* `PRINT_CSS` rides on every frame, seamless or not: it is `@media print`, so it
                 changes nothing on screen, and a document that can be printed at all — by this app's
                 button or by the reader's own Ctrl-P inside the frame — should print whole. */
              style.textContent = FRAMED_CSS + PRINT_CSS + (seamless ? SEAMLESS_CSS : '')
              inner.head?.appendChild(style)
              /* After the stylesheets, so anything a caller adds is laid out under the same rules
                 the rest of the document is — and never before, or an injected node would paint
                 once unstyled. Guarded because most frames pass none. */
              enhance?.(inner)
            }}
          />
        ) : (
          /*
           * The file the payload names is not in the bundle. Said with both halves — what was asked for
           * and what is actually here — because "report failed to load" sends somebody debugging the
           * report, and the fault is a filename.
           */
          <Alert
            type="error"
            showIcon
            title="That document is not in this build"
            description={
              `The page asks for "${doc.file}", which is not among the documents bundled from ` +
              `src/<dataset>/Report and src/<dataset>/what-if-lens: ` +
              `${reportDocumentFiles().join(', ') || 'none'}. ` +
              'Re-run npm run ingest:capex if the file was renamed.'
            }
          />
        )}

        {/*
          * What the reader waits in front of, named.
          *
          * A spinner over a blank frame is indistinguishable from a report that never arrived, so it
          * says which document is opening and why the frame is empty. Drawn *over* the frame rather
          * than in place of it: the frame has to be mounted and loading for there to be anything to
          * wait for, and for the measurement above to have something to measure.
          */}
        {url && !ready ? (
          <div
            className={seamless ? 'dvw-pending dvw-pending--seamless' : 'dvw-pending'}
            role="status"
            aria-live="polite"
          >
            <Spin />
            <Typography.Text strong>{`Opening ${doc.title}…`}</Typography.Text>
            <Typography.Text type="secondary">{PENDING_NOTE}</Typography.Text>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The document's own report view, and the class it carries once that view is the one on screen.
 *
 * Read rather than timed — see the watcher above. Named here because they are the document's
 * vocabulary and not this app's: the same real coupling as `.apiFab` and the seamless rules, and it
 * fails the same visible way. A regenerated document that renames either leaves the frame revealed
 * by the cap instead of by the signal, which is a slower open rather than a blank page.
 */
const REPORT_VIEW_ID = 'v-reports'
const REPORT_VIEW_OPEN = 'on'

/** How often the frame is asked whether it has got there. Cheap: one `getElementById` on a document
 *  this app already reads to inject a stylesheet. */
const POLL_MS = 120

/**
 * The longest the frame is held.
 *
 * Signing in and running the report inside a 2.6 MB document takes a second or two on a warm cache,
 * and the whole point of the hold is that the shell underneath must not be seen — so this is well
 * past the honest case and exists only so a renamed id cannot hide a report that has already
 * arrived. What it buys is that the failure is a slow open, never an empty one.
 */
const REVEAL_CAP_MS = 15_000

/**
 * Why the frame is empty, in the reader's terms.
 *
 * Not "loading…": what is happening is that the document boots itself and opens the report, and a
 * reader who is told that reads a five-second wait as the document working rather than as this app
 * having stalled. Copy in one place for the reason `reportExport.ts` holds its hint — it is the
 * sentence a test asserts.
 */
const PENDING_NOTE =
  'The document signs in and opens the report itself. Held until it does, so its own app shell does not flash past first.'

/* One frame on screen at a time — the viewer replaces the Library rather than sitting beside it. */
const FRAME_ID = 'cw-report-document-frame'

/**
 * The least a fitted frame may be, so a short window leaves a readable document.
 *
 * Below this the page is allowed to scroll again — one scrollbar too few is worse than two: a frame
 * squeezed to nothing shows no document at all.
 */
const MIN_FRAME_PX = 420

/**
 * What the app paints into **every** framed document, seamless or not.
 *
 * All three are applied from here rather than edited in, for the reason stated at the injection site:
 * these files' `_meta` says *"never hand-edit this file — change the generator and rebuild"*, so an edit
 * would be lost at the next export and silently return, while a rule holds for whatever version is
 * dropped in and keeps the file byte-identical to what produced it.
 *
 * - **The mock-API pill.** A floating `API <count>` badge toggling a log of the calls behind the screen:
 *   useful in the standalone document, noise inside an app that has its own API.
 * - **The embedded *Ask about this report* surface.** A question box bound to the document's own mock
 *   data, inside an app whose Ask page queries the published graph. Two ask boxes on one screen are two
 *   answers to where a question goes, and only one of them reaches this tenant's data — the same
 *   decision as dropping the report prototype's own sidebar and persona when it was vendored. The whole
 *   block goes, not just its input: `.repBlock` is the block frame and carries the *"Ask about this
 *   report"* heading, so hiding the body alone would leave a titled empty panel.
 * - **The trust strip's two drawer buttons** (`.trustBar .tBtn`), *Sources & lineage* and *Limits*. Both
 *   open the document's own drawer over its own mock lineage, which is a second account of where these
 *   figures came from inside an app that answers that question itself — Audit & Governance for who sees
 *   what, and the Catalog for what a source holds. Only the two buttons go: the strip's `.tItem` cells
 *   beside them — *Data as of*, *Covering*, *Confidence* — are statements about the figures on screen
 *   rather than doors out of them, and they stay.
 * - **The document's own *View* chip group.** Four chips that are blank and inert, and the reason is in
 *   the document: its fixture serves `viewTypes` as plain strings (`["Category", "Region", …]`) while
 *   its own `repFilterBar` reads `t.label`, `t.id` and `t.enabled` off each one. So every chip renders
 *   with an empty label and, `t.enabled` being undefined, wears the locked class — four unlabelled pills
 *   that cannot be read or clicked. This is a defect in the export rather than a control anybody chose,
 *   and it cannot be fixed from here: the fix is a generator that serves objects. Hiding a control that
 *   can be neither read nor used is the honest half of that, and the parameter chips beside it —
 *   Region, Executive category, Period, Lifecycle phase — are untouched and still work.
 *
 * `:has()` carries the block rule, because a parent cannot otherwise be styled by a descendant's class.
 * Where it is unsupported the rule is inert and the ask surface returns, which is a visible fallback
 * rather than a broken page — the same trade `body:has(.shOv.on)` makes below.
 *
 * These name the documents' own class names, which is a real coupling: it is the price of not editing a
 * generated file, and it fails visibly rather than silently — a renamed class leaves the rule inert and
 * the thing it hid comes back.
 */
const FRAMED_CSS =
  ' .apiFab, .apiLog { display: none !important }' +
  ' .repBlock:has(.embedAsk) { display: none !important }' +
  ' .filtBar .fgroup.vt { display: none !important }' +
  ' .trustBar .tBtn { display: none !important }'

/**
 * What makes **Export PDF** produce the whole report rather than its first screen.
 *
 * **The bug it fixes, because the symptom names the wrong thing.** These documents are the whole
 * prototype app with one report in it, and an app sizes itself to the window: `.app` is a grid at
 * `height: 100vh` with `overflow: hidden`, `.main` hides its overflow too, and `.content` is the one
 * element that scrolls. On screen that is correct. Printing turns the viewport into the page, so
 * everything past the first one is *clipped* rather than carried onto a second sheet — the print
 * dialog says `1/1` and the report is cut mid-block. Nothing errors, and what a reader sends on is a
 * report that looks complete down to the tear.
 *
 * **So the print job unclips the ancestors and lets the content flow.** Three rules do the work — the
 * shell, its column and the scroller — and the rest are what a clipped print had hidden anyway.
 *
 * - **`page-break-inside: avoid` on a block**, so a card is not sliced across a sheet boundary. The
 *   same rule `reportExport.js` puts in the HTML it writes, for the same reason: a table split across
 *   the fold is read as two tables. Both spellings, because the documents' own vendor prefixes tell
 *   you nothing about which engine prints them.
 * - **`print-color-adjust: exact`**, because a bar chart is drawn with backgrounds and Chrome drops
 *   backgrounds unless the page asks. Without it the money chart prints as empty outlines — figures
 *   with no bars, which is a chart making a claim it cannot support.
 * - **The report head's own actions go** (`.repHead .racts` — Refresh, Export, and the approve/submit
 *   buttons beside them). A control on paper is not a control; the same decision
 *   `PublishedReportPane.css` makes when it prints a computed report without the app around it.
 * - **And the fixed overlays go**, because `position: fixed` resolves against the *page* when
 *   printing: a toast, an open drawer or a hover popover would otherwise be stamped onto sheet one,
 *   over the report. They are chrome for a session, and a printed report has none.
 *
 * **`@media print`, so nothing here touches the screen.** The document renders exactly as it did; this
 * is a second layout that exists only while the frame is being printed, which is also why it can be
 * this blunt about `display` and `overflow` without breaking the app inside the frame.
 *
 * **Injected rather than fixed in the file**, like every other rule here: the documents' `_meta` says
 * *"never hand-edit this file — change the generator and rebuild"*, so an edit would be lost at the
 * next export and the cut would silently return. It also means the fix holds for whatever version of
 * the document is dropped in.
 */
const PRINT_CSS =
  ' @media print {' +
  /* The three that actually unclip it: the shell, its column, and the one element that scrolls. */
  ' html, body { height: auto !important; overflow: visible !important }' +
  ' .app { display: block !important; height: auto !important; overflow: visible !important }' +
  ' .main { display: block !important; height: auto !important; overflow: visible !important }' +
  ' .content { flex: none !important; height: auto !important; max-height: none !important;' +
  ' overflow: visible !important }' +
  /* A card is a unit; a card split across the fold reads as two. */
  ' .repBlock, .card, .ansCard, .note, table, tr {' +
  ' page-break-inside: avoid !important; break-inside: avoid !important }' +
  /* Backgrounds are the bars. Without this the chart prints as figures with no chart. */
  ' body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important }' +
  /* Controls and session chrome are not part of a report. */
  ' .repHead .racts, #toasts, .drawer, .overlay, .pvPop { display: none !important }' +
  ' }'

/**
 * What the app paints into a seamless document, and it is a stylesheet and nothing else.
 *
 * Five rules, each asked for, and all applied from here for the reason the mock-API pill's is: a
 * document's `_meta` says *"never hand-edit this file — change the generator and rebuild"*, so an edit
 * would be lost at the next export and would silently come back. A rule holds for whatever version is
 * dropped in and keeps the file byte-identical to what produced it.
 *
 * - **The page ground.** The document paints `body` with its own `--bg0` (#f3f4f6), which inside a
 *   borderless frame on a white page reads as a grey panel with unexplained edges. `body` is overridden
 *   rather than the token, because a token name is one file's private vocabulary while `background` on
 *   `body` is the fact.
 * - **The publish dialog's scrim, opaque.** `.shOv` washes the page with `rgba(20,25,35,.44)` while
 *   the dialog is open, so opening *Publish this scenario* greyed the whole lens. Asked for white, and
 *   a translucent white was tried first — which was still reported as grey, correctly: at 82% the
 *   sliders, cards and figures behind it read through, and a page seen through a haze is not a white
 *   page. It is flat `#fff` now, so what surrounds the dialog is the colour asked for and nothing
 *   else. The card keeps its own border and `0 14px 40px` shadow, which is what separates it from the
 *   ground — the scrim was never what did that.
 * - **And the page behind that dialog does not scroll.** `.shOv` is `position: fixed` with its own
 *   `overflow: auto`, so a tall dialog scrolls itself *while the document behind still scrolls too* —
 *   two bars again, at the same edge, the moment Publish is opened. Locking the body while the overlay
 *   is on is the modal behaviour the document is missing, and `:has()` is what lets a rule say it from
 *   outside: a parent cannot otherwise be styled by a descendant's class. Where `:has()` is not
 *   supported the rule is inert and the old behaviour returns, which is a visible fallback rather than
 *   a broken page.
 * - **The lens receipt's link out of the app.** *Scenario published* ends in an orange *Open Audit &
 *   Governance →* (`.shGov`), an anchor at `../10_access_publishing/governance_audit_capex.html` — a
 *   sibling of the document in the package it was exported from, and a path no bundle here carries, so
 *   inside the frame it is the most emphatic control on the dialog and it can only 404. The fact it
 *   stated is still on the dialog in words one line above it (*"per-reader scope is managed in Audit &
 *   Governance"*), which is why hiding it loses a broken route rather than the sentence. Its trailing
 *   `<br>` goes with it, or the removed line keeps its blank.
 * - **And a document's own top bar.** The Audit & Governance screen this dataset ships draws one: the
 *   ContextWeave wordmark, a breadcrumb, and an avatar naming *Dana Whitfield, Domain Architect*.
 *   Inside this app that is a second wordmark under the first and a second identity beside the one in
 *   the sidebar, naming somebody the reader is not. It is the decision made when the report prototype
 *   was vendored — its `main.tsx` and its `Sidebar` were dropped because this app draws the frame and
 *   the prototype's named a different persona. `body > .top` rather than `.top`, so it reaches a
 *   document's own chrome and not a `.top` nested somewhere inside its content; the rule is inert for
 *   a document that draws no bar, which the What-if lens does not.
 *
 * **Every declaration is `!important`, and that is load-bearing rather than a shortcut.** These
 * documents carry *two* stylesheets — one in `<head>`, and a second **inside `<body>`**, which is where
 * `.shOv`, `.shGov` and the rest of the publish dialog are declared. A sheet appended to `<head>` is
 * therefore *earlier* in document order than the rules it means to beat, and at equal specificity the
 * later one wins. The failure is half-silent and reads as a selector typo: hiding the receipt's link
 * took its trailing `<br>` (which nothing else styles) and left the link itself, and the white scrim
 * was inert from the day it was written while the ground beside it worked — because `body` is declared
 * in the *head* sheet and `.shOv` is not. Appending the injection to the end of `<body>` would fix it
 * by luck of ordering and break at the next export that moves a block; weight states the intent
 * instead, which is that the frame's rule beats whatever the generator emits, wherever it emits it.
 *
 * These name the documents' own classes, which is a real coupling and the same one `.apiFab` already
 * is: it is the price of not editing a generated file, and it fails visibly rather than silently — a
 * renamed class leaves the rule inert and the grey comes back.
 */
const SEAMLESS_CSS =
  ' html, body { background: #fff !important }' +
  ' .shOv { background: #fff !important }' +
  ' body:has(.shOv.on) { overflow: hidden !important }' +
  ' .shGov, .shGov + br { display: none !important }' +
  ' body > .top { display: none !important }'
