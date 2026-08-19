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

import { ArrowLeftOutlined } from '@ant-design/icons'
import { Alert, Button, Spin } from 'antd'

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
      <Button className="prp-back" icon={<ArrowLeftOutlined />} onClick={close} size="small">
        Back to Library
      </Button>

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
