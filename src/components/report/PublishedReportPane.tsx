/**
 * The report a reader opened from the Library, and the way back.
 *
 * **There is no list here, and that is the point.** This started as a card grid of the five reports
 * beside the prototype's Library — two lists of the same definitions, which is two answers to "what
 * reports exist" and the mistake this repo refuses everywhere else. The Library is the list; **Open
 * report** on a governed row hands the id over and this renders it.
 *
 * **Its own component, so it can be asserted on.** A view behind the page's own state renders as the
 * parent's initial state under `renderToString`, and every check about its contents would pass over
 * nothing.
 */

import { ArrowLeftOutlined, PrinterOutlined } from '@ant-design/icons'
import { Alert, Button, Spin, Tooltip } from 'antd'

import { REPORT_EXPORT_HINT } from '../../data/reportExport'
import { useReportsStore } from '../../store/reportsStore'
import PublishedReport from './PublishedReport'
import './PublishedReportPane.css'

export default function PublishedReportPane() {
  const openId = useReportsStore((s) => s.openId)
  const report = useReportsStore((s) => s.report)
  const loading = useReportsStore((s) => s.reportLoading)
  const error = useReportsStore((s) => s.reportError)
  const open = useReportsStore((s) => s.open)
  const close = useReportsStore((s) => s.close)

  if (!openId) return null

  return (
    <div className="prp">
      <div className="prp-bar">
        <Button icon={<ArrowLeftOutlined />} onClick={close} size="small">
          Back to Library
        </Button>

        {/*
          * **Export as PDF, and the browser is the renderer.**
          *
          * There is no PDF pipeline in this repo, by decision rather than omission: rendering one
          * server-side means a headless browser — some forty transitive packages and a Chromium
          * download — through an audit gate that fails on any advisory at `low`. Every browser already
          * has a renderer, and `PublishedReportPane.css` carries the `@media print` rules that make what
          * it produces the report rather than the application around it.
          *
          * **Offered only once a report is on screen.** Printing while the fetch is in flight would hand
          * the reader a page of chrome with a spinner where the figures go, so the control lives inside
          * the `report` branch rather than beside Back — the same reason a report's own actions are
          * offered only where they can be carried out.
          *
          * The tooltip says what the button does rather than what it is called: "Export PDF" that opens
          * a print dialog is a surprise worth one sentence, and the file the reader saves is the
          * browser's, so nothing here can promise a filename. The sentence lives in `src/data/` because
          * a `Tooltip` portals out of `renderToString` — inline it could not be asserted on.
          */}
        {report ? (
          <Tooltip title={REPORT_EXPORT_HINT}>
            <Button
              className="prp-export"
              icon={<PrinterOutlined />}
              onClick={() => window.print()}
              size="small"
            >
              Export PDF
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          title="Could not open that report"
          description={error}
          action={
            <Button size="small" onClick={() => void open(openId)}>
              Try again
            </Button>
          }
        />
      ) : loading ? (
        <Spin />
      ) : report ? (
        <PublishedReport report={report} />
      ) : (
        /* The server answers `report: null` while nothing is published rather than 404ing. The gate above
           this normally catches that, so arriving here means it closed mid-read. */
        <Alert
          type="warning"
          showIcon
          title="Nothing is published"
          description="A report is asked of the published graph, and none is live. Publish one in Graph Studio."
        />
      )}
    </div>
  )
}
