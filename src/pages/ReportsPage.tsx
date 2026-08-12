import { FileTextOutlined, PlusOutlined } from '@ant-design/icons'
import { App, Button, Card, Col, Row, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ApiErrorAlert from '../components/ApiErrorAlert'
import EmptyState from '../components/EmptyState'
import NoPublishedGraph from '../components/NoPublishedGraph'
import PageHeader from '../components/PageHeader'
import SavedReportCard from '../components/SavedReportCard'
import { removeSavedReport, setReportAudience, useReportsStore } from '../store/reportsStore'
import { listAuthRoles, type AuthRole } from '../api/client'
import { SP } from '../theme'
import './ReportsPage.css'

/*
 * The report section: **the reports someone here has made.**
 *
 * The five written for this tenant are not cards on this page. They are the starting points
 * *inside* the wizard — take one as it stands, or ask something else — and this section
 * lists what came out of it. Listing both made the page mostly fixed content that nobody
 * had asked for, above the one or two reports that had actually been composed.
 *
 * A card is a *question*, not a saved table: it holds the frame and no figures, so opening
 * one asks it again. `/reports/:reportId` still renders a written report directly, reached
 * from the wizard or by URL.
 *
 * Everything below the header is gated on **one** precondition — a published graph — and
 * the gate serves no copy: a card headed "36 generators" above "No graph has been
 * published" would be a claim about data nothing has answered for.
 */
/** The path from nothing to a report — the wizard's own steps. */
const AUTHOR_STEPS = [
  { title: 'Pick the graph', detail: 'whichever published version answers it' },
  { title: 'Ask, or take a standard report', detail: 'plain English is read back first' },
  { title: 'Name it', detail: 'and it is in this section' },
]

export default function ReportsPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const data = useReportsStore((s) => s.data)
  const loading = useReportsStore((s) => s.loading)
  const error = useReportsStore((s) => s.error)
  const load = useReportsStore((s) => s.load)

  useEffect(() => {
    void load()
  }, [load])

  /*
   * The role pool, for the audience checklist. Fetched once here rather than served on the
   * report payload: it is the tenant's role list, the same one the login dropdown reads, and a
   * second copy of it inside the report section would be a second thing to keep in step.
   */
  const [roles, setRoles] = useState<AuthRole[]>([])
  useEffect(() => {
    listAuthRoles()
      .then((payload) => setRoles(payload.roles))
      .catch(() => setRoles([]))
  }, [])

  const [audienceBusy, setAudienceBusy] = useState<string | null>(null)

  async function onAudience(savedId: string, roleIds: string[]) {
    if (roleIds.length === 0) {
      /* Refused here as well as on the server, because the server's sentence arrives after a
         round trip and the box has already visibly cleared. */
      message.error('A report no role can view is a report you have deleted. Keep at least one.')
      return
    }
    setAudienceBusy(savedId)
    const result = await setReportAudience(savedId, roleIds)
    setAudienceBusy(null)
    if (!result.ok) return message.error(result.error)
    void load()
  }

  async function onForget(savedId: string) {
    const result = await removeSavedReport(savedId)
    if (!result.ok) return message.error(result.error)
    void load()
  }

  /*
   * **Publication is the only gate.** A report is asked of the published graph, so a live
   * version is what activates the section — connecting a source is not a second
   * precondition, because a graph nobody could build has nothing to publish. The source
   * state is therefore not an empty state here.
   */
  const ready = data && data.publishedCount > 0

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="A report here is a re-executable question, not a stored table. Each one states what it asks, the assumptions it was asked under, and the federal records its figures came from — every figure is recomputed from the connected rosters on each read."
        actions={
          ready ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/reports/new')}>
              Author a report
            </Button>
          ) : null
        }
      />

      {error ? <ApiErrorAlert error={error} onRetry={() => void load()} /> : null}

      {loading && !data ? <Spin /> : null}

      {/* The one empty state: nothing is published, and the fix is in Graph Studio. It
          names which fix applies — publish the build you have, or finish a draft. */}
      {data && data.publishedCount === 0 ? (
        <NoPublishedGraph
          detail="Reports are asked of the published graph — the five written ones and any you compose."
          builtCount={data.builtCount}
          draftCount={data.draftCount}
        />
      ) : null}

      {ready ? (
        <>

          {/*
           * **Your reports, as cards** — the same mark as a standard report, because that is
           * what they are: one of the five asked under a different frame. They were a list
           * of rows, which read as a settings pane rather than as reports.
           *
           * Each card holds a **frame, never figures** — opening one re-asks it, which is why
           * it shows the assumptions rather than a number, and why "open" and "generate" are
           * the same act. Written through `commitDb` on the server, so unlike a registered
           * source these survive a restart.
           */}
          {data.saved.length === 0 ? (
            /*
             * A section before its first report. The five written reports are the starting
             * points inside the wizard rather than cards here — this page lists what someone
             * made, so before anyone has made one it says how, in the shell every other
             * empty page uses.
             */
            <EmptyState
              icon={<FileTextOutlined />}
              title="No reports yet"
              detail="A report is a question asked of a published graph. Start from one of the five written for this tenant, or ask in plain English — you name it before it is kept, and it appears here."
              action={
                <Button type="primary" size="large" onClick={() => navigate('/reports/new')}>
                  Author a report
                </Button>
              }
              steps={AUTHOR_STEPS}
              footnote="A saved report holds the question and its frame, never the figures — opening it asks it again."
            />
          ) : (
            <>
              <div className="rp-group">
                <h2>Your reports · {data.saved.length}</h2>
                <span className="rp-dim">
                  the question and its frame are kept, never the figures — opening one asks it
                  again
                </span>
              </div>

              <Row gutter={[SP.base, SP.base]} align="stretch">
                {data.saved.map((s, i) => (
                  <Col
                    key={s.savedId}
                    xs={24}
                    xl={i === data.saved.length - 1 && data.saved.length % 2 === 1 ? 24 : 12}
                  >
                    <SavedReportCard
                      saved={s}
                      roles={roles}
                      busy={audienceBusy === s.savedId}
                      onOpen={() => navigate(`/reports/saved/${encodeURIComponent(s.savedId)}`)}
                      onEdit={() => navigate(`/reports/new?saved=${encodeURIComponent(s.savedId)}`)}
                      onRemove={() => void onForget(s.savedId)}
                      onAudience={(roleIds) => void onAudience(s.savedId, roleIds)}
                    />
                  </Col>
                ))}
              </Row>
            </>
          )}

          {/*
           * What is live, and who put it there. Plural because the wizard asks *one* of
           * these and records which — so the section names them all rather than implying
           * there is only ever one.
           */}
          {data.graphs.length > 0 ? (
            <Card
              size="small"
              className="rp-panel"
              title={`Published graphs · ${data.graphs.length}`}
              extra={
                <span className="rp-dim">a report names the content that answered it</span>
              }
              style={{ marginTop: SP.lg }}
            >
              <ul className="rp-defs">
                {data.graphs.map((g) => (
                  <li key={g.useCaseId}>
                    <b>
                      {g.name} {g.version}
                    </b>
                    <span className="rp-dim">
                      {g.entityCount !== null
                        ? `${g.entityCount.toLocaleString()} entities · `
                        : ''}
                      {g.relationshipCount !== null
                        ? `${g.relationshipCount.toLocaleString()} relationships · `
                        : ''}
                      {g.publishedBy ? `published by ${g.publishedBy}` : 'published'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

        </>
      ) : null}
    </>
  )
}
