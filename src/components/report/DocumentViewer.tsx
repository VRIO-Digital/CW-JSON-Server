/**
 * One rendered report document, framed.
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
 * **Its own component, so it can be asserted on** — the same reason `PublishedReportPane` is one.
 */

import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons'
import { Alert, Button, Tooltip, Typography } from 'antd'

import type { ReportDocument } from '../../api/client'
import { REPORT_EXPORT_HINT } from '../../data/reportExport'
import { reportDocumentFiles, reportDocumentUrl } from '../../data/reportDocuments'
import './DocumentViewer.css'

export default function DocumentViewer({
  document: doc,
  onBack,
}: {
  document: ReportDocument
  onBack: () => void
}) {
  const url = reportDocumentUrl(doc.file)

  return (
    <div className="dvw">
      <div className="dvw-bar">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack} size="small">
          Back to Library
        </Button>

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

        {/* Which report this is, in its own words, so the frame is labelled by the app around it. */}
        <div className="dvw-name">
          <Typography.Text strong>{doc.title}</Typography.Text>
          <Typography.Text type="secondary"> · {doc.version} · {doc.category}</Typography.Text>
        </div>
      </div>

      {url ? (
        <iframe
          id={FRAME_ID}
          className="dvw-frame"
          src={url}
          title={`${doc.title} — rendered report`}
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
            style.textContent = '.apiFab, .apiLog { display: none !important }'
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
          title="That report document is not in this build"
          description={
            `The section lists "${doc.file}", which is not among the documents bundled from ` +
            `src/<dataset>/Report: ${reportDocumentFiles().join(', ') || 'none'}. ` +
            'Re-run npm run ingest:capex if the file was renamed.'
          }
        />
      )}
    </div>
  )
}

/* One frame on screen at a time — the viewer replaces the Library rather than sitting beside it. */
const FRAME_ID = 'cw-report-document-frame'
