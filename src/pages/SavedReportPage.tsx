import { App, Breadcrumb, Button, Spin } from 'antd'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import ApiErrorAlert from '../components/ApiErrorAlert'
import NoPublishedGraph from '../components/NoPublishedGraph'
import PageHeader from '../components/PageHeader'
import ReportView from '../components/ReportView'
import { useSavedReportStore } from '../store/reportsStore'
import { SP } from '../theme'
import './ReportsPage.css'

/*
 * A report someone composed and kept.
 *
 * **It is re-asked, not recalled.** The library row holds a frame and no figures, so
 * opening it rebuilds the report against the rosters as they are now — which is the whole
 * reason a saved report stores no numbers. That makes "opened" and "generated" the same
 * act, and it is why this page renders `ReportView`, the same template as the five written
 * reports: a saved report is one of those, asked differently.
 *
 * What the figures cannot say is stated beneath them: who saved it, when, and — when the
 * graph it was asked of has since been unpublished — that nothing live answered it.
 */
export default function SavedReportPage() {
  const { savedId = '' } = useParams()
  const saved = useSavedReportStore((s) => s.saved)
  const report = useSavedReportStore((s) => s.report)
  const publishedCount = useSavedReportStore((s) => s.publishedCount)
  const builtCount = useSavedReportStore((s) => s.builtCount)
  const draftCount = useSavedReportStore((s) => s.draftCount)
  const loading = useSavedReportStore((s) => s.loading)
  const error = useSavedReportStore((s) => s.error)
  const load = useSavedReportStore((s) => s.load)
  const slice = useSavedReportStore((s) => s.slice)
  const slicing = useSavedReportStore((s) => s.slicing)
  const { message } = App.useApp()

  async function onSlice(filter: { key: string; value: string } | null) {
    const result = await slice(filter)
    if (!result.ok) message.error(result.error)
  }

  useEffect(() => {
    void load(savedId)
  }, [load, savedId])

  if (error) {
    return (
      <>
        <PageHeader title="Saved report" subtitle="" />
        <ApiErrorAlert error={error} onRetry={() => void load(savedId)} />
      </>
    )
  }
  if (loading && !report) return <Spin />
  if (!report) {
    return (
      <>
        <PageHeader
          title="Saved report"
          subtitle="A saved report is a question and its frame — opening it asks it again."
        />
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
        items={[
          { title: <Link to="/reports">Reports</Link> },
          { title: saved?.name ?? 'Saved report' },
        ]}
      />
      <ReportView
        report={report}
        /* A saved report slices like any other: re-asked with the chip, never row-filtered. */
        onSlice={(filter) => void onSlice(filter)}
        slicing={slicing}
        actions={
          /* Editing is re-opening the wizard on this row's frame — the same flow that
             composed it, so there is no second set of pickers to keep in step. */
          <Link to={`/reports/new?saved=${encodeURIComponent(savedId)}`}>
            <Button size="small" type="primary">
              Edit this report
            </Button>
          </Link>
        }
        provenance={
          saved ? (
            <p className="rp-dim">
              Saved as <b>{saved.name}</b>
              {saved.savedBy ? ` by ${saved.savedBy}` : ''} on{' '}
              {new Date(saved.savedAt).toLocaleString()} — the question and its frame were
              kept, never the figures, so what you are reading was computed just now.
            </p>
          ) : null
        }
      />
    </>
  )
}
