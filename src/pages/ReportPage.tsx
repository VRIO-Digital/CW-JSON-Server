import { App, Breadcrumb, Button, Spin } from 'antd'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import ApiErrorAlert from '../components/ApiErrorAlert'
import NoPublishedGraph from '../components/NoPublishedGraph'
import PageHeader from '../components/PageHeader'
import ReportView from '../components/ReportView'
import { useReportStore } from '../store/reportsStore'
import { SP } from '../theme'
import './ReportsPage.css'

/*
 * One of the five written reports.
 *
 * **A report is a question re-asked, not a stored table** — its own lead note says so — so
 * everything except its copy was computed by the server on this request: the tiles came
 * from the package's rendered report and are checked against the roster at ingest, and
 * every series, row order and total came off the roster just now. Nothing here sums a
 * column.
 *
 * The page itself is a breadcrumb and a gate; the report is `ReportView`, the one template
 * the wizard and the library also render, so the same document cannot look like two.
 */
export default function ReportPage() {
  const { reportId = '' } = useParams()
  const report = useReportStore((s) => s.report)
  const publishedCount = useReportStore((s) => s.publishedCount)
  const builtCount = useReportStore((s) => s.builtCount)
  const draftCount = useReportStore((s) => s.draftCount)
  const loading = useReportStore((s) => s.loading)
  const error = useReportStore((s) => s.error)
  const load = useReportStore((s) => s.load)
  const slice = useReportStore((s) => s.slice)
  const slicing = useReportStore((s) => s.slicing)
  const { message } = App.useApp()

  async function onSlice(filter: { key: string; value: string } | null) {
    const result = await slice(filter)
    if (!result.ok) message.error(result.error)
  }

  useEffect(() => {
    void load(reportId)
  }, [load, reportId])

  /* The heading is the report's own, so there is nothing to title the page with until it
     arrives — which is also why the breadcrumb sits inside the loaded branch. */
  if (error) {
    return (
      <>
        <PageHeader title="Report" subtitle="" />
        <ApiErrorAlert error={error} onRetry={() => void load(reportId)} />
      </>
    )
  }
  if (loading && !report) return <Spin />
  if (!report) {
    return (
      <>
        <PageHeader
          title="Report"
          subtitle="A report is a question asked of the published graph — its figures are computed on every read."
        />
        {/* Publication is the only precondition: a report is asked of the published
            graph, and a connected source is not a second gate. */}
        {publishedCount === 0 ? (
          <NoPublishedGraph
            detail="This report is asked of the published graph."
            builtCount={builtCount}
            draftCount={draftCount}
          />
        ) : (
          <Spin />
        )}
      </>
    )
  }

  return (
    <>
      <Breadcrumb
        style={{ marginBottom: SP.sm }}
        items={[{ title: <Link to="/reports">Reports</Link> }, { title: report.reportTag }]}
      />
      <ReportView
        report={report}
        /* A chip re-asks this report with that slice; every figure comes back computed
           for it, which is why the page hands the slice up rather than filtering rows. */
        onSlice={(filter) => void onSlice(filter)}
        slicing={slicing}
        /* Re-asking a standard report under other assumptions is what the wizard is for,
           so this hands off rather than growing pickers of its own. */
        actions={
          <Link to={`/reports/new?report=${encodeURIComponent(report.reportId)}`}>
            <Button size="small">Ask this differently</Button>
          </Link>
        }
      />
    </>
  )
}
