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
import { Alert, Button, Tooltip, Typography } from 'antd'
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
}: {
  document: FramedDocument
  /** Absent where the frame *is* the page — the What-if lens has nothing to go back to. */
  onBack?: () => void
  backLabel?: string
  /** Render the document as the page rather than as a framed file. See the note above. */
  seamless?: boolean
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

      {url ? (
        <iframe
          id={FRAME_ID}
          ref={frameRef}
          className={seamless ? 'dvw-frame dvw-frame--seamless' : 'dvw-frame'}
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
            style.textContent =
              '.apiFab, .apiLog { display: none !important }' +
              (seamless ? SEAMLESS_CSS : '')
            inner.head?.appendChild(style)
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
    </div>
  )
}

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
 * What the app paints into a seamless document, and it is a stylesheet and nothing else.
 *
 * Two rules, both asked for, and both applied from here for the reason the mock-API pill's is: the
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
 *
 * These name the document's own classes, which is a real coupling and the same one `.apiFab` already is:
 * it is the price of not editing a generated file, and it fails visibly rather than silently — a renamed
 * class leaves the rule inert and the grey comes back.
 */
const SEAMLESS_CSS =
  ' html, body { background: #fff }' +
  ' .shOv { background: #fff }' +
  ' body:has(.shOv.on) { overflow: hidden }'
