import { Button, Card } from 'antd'
import type { GovernedReport } from '../api/client'
import StatusTag from './StatusTag'
import '../pages/ReportsPage.css'

/*
 * One governed report definition, as the Library lists it.
 *
 * **Every line on it is served, not written here.** The question is the report's own sentence in
 * quotes; the paragraph under it is the tenant's; the as-of date, the floor line, the version, the
 * author, the schedule and the entitled count come from the governance payload. A card that
 * paraphrased any of them would be a second account of a governed object.
 *
 * Its own component because the tab renders one per definition and because a card is the thing
 * worth asserting on — a grid built inline could only be reached through the page's state.
 */
export default function ReportLibraryCard({
  report,
  onOpen,
  onAsk,
  actions,
}: {
  report: GovernedReport
  onOpen: () => void
  /** Ask this report's question in Ask, which is the one thing a reader can always do with it. */
  onAsk?: () => void
  /** A composed report's own controls (audience, edit, remove) — absent on a written one. */
  actions?: React.ReactNode
}) {
  return (
    <Card className="rp-lib" onClick={onOpen}>
      <div className="rp-lib-head">
        <span className="rp-lib-title">{report.title}</span>
        {/* State, with an icon and a word — never the pill's colour alone. */}
        <StatusTag tone={report.tone}>{report.statusLabel}</StatusTag>
      </div>

      {report.question ? <p className="rp-lib-q">“{report.question}”</p> : null}
      {report.lead ? <p className="rp-lib-lead">{report.lead}</p> : null}

      {/*
       * A pending or archived definition says why in the tenant's own words. Rendered before the
       * dated lines because it changes how they should be read.
       */}
      {report.note ? <div className="rp-lib-note">{report.note}</div> : null}

      {report.asOf ? (
        <div className="rp-lib-as-of">
          <span className={`rp-dot rp-dot-${report.tone}`} aria-hidden="true" />
          <span className="rp-mono">as-of {report.asOf}</span>
        </div>
      ) : null}

      {report.floor ? <div className="rp-lib-floor rp-mono">· {report.floor}</div> : null}

      {/*
       * The governance footer: which definition, by whom, to how many personas, how often it
       * refreshes, whether it can be sliced, and how it was approved. `parameterized` and the
       * approval are omitted rather than negated — "not parameterized" is not a fact a reader
       * needs, and an absent approval is already reported by the Publish checks tab.
       */}
      <div className="rp-lib-foot">
        {report.version ? <span className="rp-mono">{report.version}</span> : null}
        {report.author ? <span>{report.author}</span> : null}
        <span>
          {report.entitledRoles.length} persona{report.entitledRoles.length === 1 ? '' : 's'}{' '}
          entitled
        </span>
        <span>{report.schedule}</span>
        {report.parameterized ? <span>parameterized</span> : null}
        {onAsk ? (
          <Button
            type="link"
            size="small"
            className="rp-lib-ask"
            onClick={(e) => {
              e.stopPropagation()
              onAsk()
            }}
          >
            ✦ ask
          </Button>
        ) : null}
        {report.approval ? <span className="rp-lib-approval">{report.approval}</span> : null}
      </div>

      {actions ? <div className="rp-lib-actions">{actions}</div> : null}
    </Card>
  )
}
