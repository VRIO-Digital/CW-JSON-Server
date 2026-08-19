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

import { useState } from 'react'

import { ArrowLeftOutlined } from '@ant-design/icons'
import { Alert, Button, Spin } from 'antd'

import CapexReport from '../../capex-report/CapexReport'
import { useReportsStore } from '../../store/reportsStore'
import PublishedReport from './PublishedReport'
import './PublishedReportPane.css'

export default function PublishedReportPane() {
  const openId = useReportsStore((s) => s.openId)
  const report = useReportsStore((s) => s.report)
  const resolved = useReportsStore((s) => s.resolved)
  const specs = useReportsStore((s) => s.specs)
  const loading = useReportsStore((s) => s.reportLoading)
  const error = useReportsStore((s) => s.reportError)
  const open = useReportsStore((s) => s.open)
  const close = useReportsStore((s) => s.close)
  /*
   * What the reader asked for when they drilled in, if they did. Held here rather than in the store
   * because it belongs to this pane's navigation rather than to the report — the store already keeps the
   * report and would then have two things to clear in step.
   */
  const [coordinate, setCoordinate] = useState<{ param: string; value: string } | null>(null)

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
      ) : resolved ? (
        /*
         * **A report its own package resolved, drawn by its own renderers.**
         *
         * Two report formats reach this pane and the server says which — exactly one of `report` and
         * `resolved` is ever set. EPA’s five are computed per request from a roster, so
         * `PublishedReport` draws them; CAPEX’s three are a resolver’s output carried verbatim, so the
         * nineteen vendored block renderers in `src/capex-report/` draw those. Forked on the
         * discriminator rather than on the shape, because sniffing is how two formats come to be
         * conflated — and the fork is here rather than inside `PublishedReport`, which knows one format
         * and should keep knowing one.
         */
        <CapexReport
          view={resolved}
          specs={specs}
          /*
           * The calendar drills into Project 360 from a filing month. Routed through the store's own
           * `open()` — the same path the Library's Open button takes — because the host has one
           * `/reports` address rather than a route per report, so the vendored `<Link>` navigated
           * nowhere. The coordinate is recorded, not applied: one resolved run per report is carried, so
           * `ReportView` names the run's own coordinate instead of answering under the wrong project.
           */
          onOpenReport={(reportId, at) => {
            setCoordinate(at)
            void open(reportId)
          }}
          coordinate={coordinate}
        />
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
