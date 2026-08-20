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
 * **Its own component, so it can be asserted on** — the same reason `PublishedReportPane` is one.
 */

import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons'
import { Alert, Button, Tooltip, Typography } from 'antd'

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
          className={seamless ? 'dvw-frame dvw-frame--seamless' : 'dvw-frame'}
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
              (seamless ? ' html, body { background: #fff }' : '')
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
