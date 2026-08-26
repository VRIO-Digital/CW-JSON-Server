import { Alert, App, Col, Row, Spin, Tabs, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { GovernanceView } from '../api/client'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import GovernedArtifactCard from '../components/governance/GovernedArtifactCard'
import NoPublishedGraph from '../components/common/NoPublishedGraph'
import DocumentViewer from '../components/report/DocumentViewer'
import PageHeader from '../components/common/PageHeader'
import { useAuthStore } from '../store/authStore'
import { useGovernanceStore } from '../store/governanceStore'
import { SP } from '../theme'
import './AuditPage.css'

/*
 * Audit & Governance — one page for who sees what.
 *
 * Two gates and a trail, and the page is honest about what each one does:
 *
 *  - **Who can open it** is real. A report's audience is persona ids, a scenario's is addresses,
 *    and both are written by the server through whichever pool that artifact keeps.
 *  - **What they see inside** is an access rule per persona, resolved against the live
 *    36-generator register — and **recorded, not enforced**. No roster in this app is filtered per
 *    persona, so the resolution says what a rule *would* admit, never what a reader saw. That
 *    sentence is served (`copy.notEnforced`) and printed where the rules are, not buried in a doc.
 *  - **The trail** holds what this server has actually seen: rule changes, readers added and
 *    removed, publications withdrawn. Opens are absent because nothing here serves a report to a
 *    reader, and an "opened" row would be an event that never happened.
 *
 * Every string on this page comes from the server. The tenant wrote this copy.
 */
export default function AuditPage() {
  const { message } = App.useApp()
  const view = useGovernanceStore((s) => s.view)
  const loading = useGovernanceStore((s) => s.loading)
  const error = useGovernanceStore((s) => s.error)
  const load = useGovernanceStore((s) => s.load)

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !view) return <Spin />
  if (error && !view) return <ApiErrorAlert error={error} onRetry={() => void load()} />
  if (!view) return null

  return (
    <>
      <PageHeader title={view.copy.title} subtitle={view.copy.lead} />

      {error ? (
        <div className="gv-error">
          <ApiErrorAlert error={error} onRetry={() => void load()} />
        </div>
      ) : null}

      {/*
       * The gate replaces the page rather than sitting under it — the same rule the What-if lens
       * had to be corrected for. Everything below is a claim about published artifacts and a
       * 36-generator register; printing any of it above "nothing is published" describes data the
       * page has just said is not there.
       */}
      {view.publishedCount === 0 ? (
        <NoPublishedGraph
          detail="This page governs published reports and scenarios — there are none until a graph is live."
          builtCount={view.builtCount}
          draftCount={view.draftCount}
        />
      ) : view.document ? (
        /*
         * **A dataset can ship this screen rather than have it computed**, exactly as it can ship its
         * reports and its What-if lens. EPA resolves every rule against its 36-generator register per
         * request; CAPEX ships the finished page — two gates, its directory, its published artifacts
         * and its audit trail, every count resolved against its own 60-project roster by the page itself.
         * Framing it keeps those figures inside the file that computed them: transcribing them into
         * these components would be a second answer to who sees what, and it would look right.
         *
         * **Read after the gate**, because publication is the one precondition and this page governs
         * *published* artifacts. The server agrees rather than being second-guessed here — it sends
         * `document: null` while the gate is closed.
         *
         * `seamless`, because the frame is the page: no bar, no Back to a list this page does not
         * have, and no border making the screen read as a panel dropped onto the app.
         */
        <DocumentViewer document={view.document} seamless />
      ) : (
        <Governance view={view} onMessage={message.error} />
      )}
    </>
  )
}

function Governance({
  view,
  onMessage,
}: {
  view: GovernanceView
  onMessage: (text: string) => void
}) {
  const setScope = useGovernanceStore((s) => s.setScope)
  const addReader = useGovernanceStore((s) => s.addReader)
  const removeReader = useGovernanceStore((s) => s.removeReader)
  const unpublish = useGovernanceStore((s) => s.unpublish)
  const pending = useGovernanceStore((s) => s.pending)
  /* Client-held, so it has to be sent: the server has nothing to look the signed-in user up from,
     which is why every route that records who did something takes `as`. */
  const as = useAuthStore((s) => s.identity?.email ?? null)

  /** Which reader's access panel is open, keyed `artifactId|email`. One at a time. */
  const [openAccess, setOpenAccess] = useState<string | null>(null)
  const [tab, setTab] = useState('report')
  const [category, setCategory] = useState('all')

  const reports = useMemo(() => view.artifacts.filter((a) => a.kind === 'report'), [view.artifacts])
  const scenarios = useMemo(() => view.artifacts.filter((a) => a.kind === 'whatif'), [view.artifacts])
  const events = useMemo(
    () => (category === 'all' ? view.log : view.log.filter((e) => e.category === category)),
    [view.log, category],
  )

  const report = (r: { ok: boolean; error?: string }) => {
    if (!r.ok && r.error) onMessage(r.error)
  }

  const cards = (list: GovernanceView['artifacts']) =>
    list.length === 0 ? (
      <p className="gv-help">Nothing published in this kind yet.</p>
    ) : (
      list.map((artifact) => (
        <GovernedArtifactCard
          key={artifact.artifactId}
          artifact={artifact}
          people={view.people}
          bases={view.bases}
          pending={pending}
          openFor={
            openAccess?.startsWith(`${artifact.artifactId}|`)
              ? openAccess.slice(artifact.artifactId.length + 1)
              : null
          }
          onToggleAccess={(email) =>
            setOpenAccess(email === null ? null : `${artifact.artifactId}|${email}`)
          }
          onAddReader={(email) =>
            void addReader({ artifactId: artifact.artifactId, email, as }).then(report)
          }
          onRemoveReader={(email) =>
            void removeReader({ artifactId: artifact.artifactId, email, as }).then(report)
          }
          onUnpublish={() => void unpublish({ artifactId: artifact.artifactId, as }).then(report)}
          onScope={(roleId, input) => void setScope({ roleId, ...input, as }).then(report)}
        />
      ))
    )

  return (
    <>
      {/* The three gates, each stating what it does — and the second one saying what it does not. */}
      <Row gutter={[SP.base, SP.base]} className="gv-gates">
        {view.copy.gates.map((gate) => (
          <Col key={gate.key} xs={24} lg={8}>
            <div className="gv-gate">
              <div className="gv-gate-title">{gate.title}</div>
              <p className="gv-gate-detail">{gate.detail}</p>
            </div>
          </Col>
        ))}
      </Row>

      {/*
       * The sentence the whole page turns on, stated once and where the rules are. A page that
       * lets somebody author a restriction and stays quiet about enforcement implies one runs.
       */}
      <Alert
        className="gv-not-enforced"
        type="warning"
        showIcon
        title="A rule is recorded, not enforced"
        description={view.copy.notEnforced}
      />

      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setTab(key)
          setOpenAccess(null)
        }}
        items={[
          {
            key: 'report',
            label: (
              <>
                Reports <Tag>{reports.length}</Tag>
              </>
            ),
            children: cards(reports),
          },
          {
            key: 'whatif',
            label: (
              <>
                What-ifs <Tag>{scenarios.length}</Tag>
              </>
            ),
            children: cards(scenarios),
          },
          {
            key: 'log',
            label: (
              <>
                Audit log <Tag>{view.log.length}</Tag>
              </>
            ),
            children: (
              <>
                <div className="gv-filters">
                  {view.logCategories.map((c) => {
                    const count =
                      c.key === 'all'
                        ? view.log.length
                        : view.log.filter((e) => e.category === c.key).length
                    return (
                      <button
                        key={c.key}
                        type="button"
                        className={`gv-chip${category === c.key ? ' is-on' : ''}`}
                        onClick={() => setCategory(c.key)}
                        aria-pressed={category === c.key}
                      >
                        {c.label}
                        <span className="gv-chip-count">{count}</span>
                      </button>
                    )
                  })}
                </div>

                <div className="gv-log">
                  {events.length === 0 ? (
                    <p className="gv-help">{view.copy.emptyLog}</p>
                  ) : (
                    events.map((e) => (
                      <div key={e.eventId} className="gv-event">
                        <div>
                          <div className="gv-event-text">
                            <strong>{e.actor}</strong> {e.text}
                          </div>
                          <div className="gv-event-detail">{e.detail}</div>
                        </div>
                        <span className="gv-event-at">{new Date(e.at).toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>

                {/* Why an "opened" row is not in this list. */}
                <p className="gv-help gv-log-note">{view.copy.logNote}</p>
              </>
            ),
          },
        ]}
      />

      <p className="gv-help gv-basis-note">{view.copy.basisNote}</p>
    </>
  )
}
