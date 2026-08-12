import { PlusOutlined } from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Row,
  Select,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listAuthRoles, type AuthRole, type GovernedReport } from '../api/client'
import ApiErrorAlert from '../components/ApiErrorAlert'
import AudiencePicker from '../components/AudiencePicker'
import NoPublishedGraph from '../components/NoPublishedGraph'
import PageHeader from '../components/PageHeader'
import ReportLibraryCard from '../components/ReportLibraryCard'
import { DataScopeGate, EntitlementGate } from '../components/ReportGates'
import StatusTag from '../components/StatusTag'
import { removeSavedReport, setReportAudience, useReportsStore } from '../store/reportsStore'
import { useAuthStore } from '../store/authStore'
import { SP } from '../theme'
import './ReportsPage.css'

/*
 * The report section, in three tabs.
 *
 * **Library** is every governed definition — the five written for this tenant and anything
 * composed here — as cards carrying their lifecycle state, their version, their author, their
 * as-of date, the floor they stand on and how many personas are entitled to them. **Author** is
 * the wizard's front door, and a permission: a persona that cannot see the underlying figures
 * cannot define what a report asserts about them. **Operations & audience** is the governance
 * itself — two gates, the refresh schedule, the audit and the publish checks.
 *
 * **Nothing on any of the three is written copy pretending to be data.** Every count, every cell
 * and every check comes from `GET /reports`, computed per request; the notes are the tenant's own
 * strings, served rather than held here, so the page cannot print a second version of them.
 *
 * Everything below the header is gated on **one** precondition — a published graph — and the gate
 * serves no copy: a card headed "36 generators" above "No graph has been published" would be a
 * claim about data nothing has answered for.
 */
export default function ReportsPage() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const data = useReportsStore((s) => s.data)
  const loading = useReportsStore((s) => s.loading)
  const error = useReportsStore((s) => s.error)
  const load = useReportsStore((s) => s.load)

  /*
   * The section is read **as the signed-in persona**, which is what makes the banner's "N
   * entitled · M not listed" true of the reader rather than of nobody. The role is client-held,
   * so it has to be sent; the server ignores one it does not know.
   */
  const roleId = useAuthStore((s) => s.identity?.roleId ?? null)

  useEffect(() => {
    void load(roleId)
  }, [load, roleId])

  /*
   * The role pool, for the audience checklist. Fetched once here rather than served on the report
   * payload: it is the tenant's role list, the same one the login reads, and a second copy of it
   * inside the report section would be a second thing to keep in step.
   */
  const [roles, setRoles] = useState<AuthRole[]>([])
  useEffect(() => {
    listAuthRoles()
      .then((payload) => setRoles(payload.roles))
      .catch(() => setRoles([]))
  }, [])

  const [audienceBusy, setAudienceBusy] = useState<string | null>(null)
  const [audienceOpen, setAudienceOpen] = useState<string | null>(null)
  /* The Library's two controls. Both narrow what is listed and neither changes a definition. */
  const [status, setStatus] = useState('current')
  const [category, setCategory] = useState<string | null>(null)

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
    void load(roleId)
  }

  async function onForget(savedId: string) {
    const result = await removeSavedReport(savedId)
    if (!result.ok) return message.error(result.error)
    void load(roleId)
  }

  /*
   * **Publication is the only gate.** A report is asked of the published graph, so a live version
   * is what activates the section — connecting a source is not a second precondition, because a
   * graph nobody could build has nothing to publish.
   */
  const governance = data?.governance ?? null
  const ready = data && data.publishedCount > 0 && governance

  const openReport = (report: GovernedReport) =>
    navigate(
      report.kind === 'saved' && report.savedId
        ? `/reports/saved/${encodeURIComponent(report.savedId)}`
        : `/reports/${encodeURIComponent(report.reportId)}`,
    )

  const header = (
    <PageHeader
      title="Reports"
      subtitle="A report here is a saved, governed, re-executable question — not a chart with numbers stored inside it. That is why the same report renders differently for each viewer, why every figure can name its source, and why a refresh changes the answer without changing the definition."
      actions={
        ready && governance.author.mayAuthor ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/reports/new')}>
            Author a report
          </Button>
        ) : null
      }
    />
  )

  if (!ready) {
    return (
      <>
        {header}
        {error ? <ApiErrorAlert error={error} onRetry={() => void load(roleId)} /> : null}
        {loading && !data ? <Spin /> : null}
        {data && data.publishedCount === 0 ? (
          <NoPublishedGraph
            detail="Reports are asked of the published graph — the five written ones and any you compose."
            builtCount={data.builtCount}
            draftCount={data.draftCount}
          />
        ) : null}
      </>
    )
  }

  const shown = governance.reports.filter(
    (r) =>
      (status === 'current' ? r.status !== 'archived' : r.status === status) &&
      (category === null || r.category === category),
  )

  const library = (
    <>
      {/*
       * The entitlement banner. Both halves are the server's arithmetic over this persona: how
       * many definitions name it, how many exist that do not, and the data scope it carries —
       * with the sentence that keeps the two gates apart, because a reader who thinks the scope
       * filtered the *list* has understood the model backwards.
       */}
      <div className="rp-entitle">
        <span>
          <b>
            {governance.viewer.entitledCount} report
            {governance.viewer.entitledCount === 1 ? '' : 's'} entitled to
          </b>{' '}
          <b className="rp-entitle-role">{governance.viewer.label ?? 'every persona'}</b>
          <span className="rp-dim"> · {governance.viewer.notEntitledCount} not entitled</span>
        </span>
        {governance.viewer.scope ? (
          <span className="rp-entitle-scope">
            <span>{governance.viewer.scope.scope}</span>
            <Tag className="rp-chip rp-mono">{governance.viewer.scope.predicate.split(' ')[0]}</Tag>
            <span className="rp-dim">Applied when a report opens, not when it is listed.</span>
          </span>
        ) : null}
      </div>

      <div className="rp-filters">
        <div className="rp-status-chips">
          {governance.statuses.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`rp-status-chip${status === s.key ? ' rp-status-on' : ''}`}
              onClick={() => setStatus(s.key)}
            >
              {s.label} <span className="rp-status-count">{s.count}</span>
            </button>
          ))}
        </div>
        <Select
          className="rp-category"
          value={category}
          onChange={setCategory}
          allowClear
          placeholder="Category: any"
          options={governance.categories.map((c) => ({ value: c, label: c }))}
        />
      </div>

      {shown.length === 0 ? (
        <Alert
          type="info"
          showIcon
          title="Nothing in this slice"
          description="No definition carries that state and category together. Clear the category, or pick another state — the counts on the chips are the whole library."
        />
      ) : (
        <Row gutter={[SP.base, SP.base]}>
          {shown.map((report) => (
            <Col key={report.reportId} xs={24} lg={12} xxl={8}>
              <ReportLibraryCard
                report={report}
                onOpen={() => openReport(report)}
                onAsk={() => navigate('/ask')}
                actions={
                  report.kind === 'saved' && report.savedId ? (
                    <>
                      <Button
                        size="small"
                        type="primary"
                        onClick={(e) => {
                          e.stopPropagation()
                          openReport(report)
                        }}
                      >
                        Open
                      </Button>
                      <Button
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          setAudienceOpen(
                            audienceOpen === report.savedId ? null : (report.savedId ?? null),
                          )
                        }}
                        aria-expanded={audienceOpen === report.savedId}
                      >
                        Who can view
                      </Button>
                      <Button
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/reports/new?saved=${encodeURIComponent(report.savedId!)}`)
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="small"
                        type="text"
                        danger
                        className="rp-saved-remove"
                        onClick={(e) => {
                          e.stopPropagation()
                          void onForget(report.savedId!)
                        }}
                      >
                        Remove
                      </Button>
                      {audienceOpen === report.savedId ? (
                        <div
                          className="rp-audience-holder"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <AudiencePicker
                            roles={roles}
                            chosen={report.entitledRoles.map((r) => r.roleId)}
                            busy={audienceBusy === report.savedId}
                            onChange={(roleIds) => void onAudience(report.savedId!, roleIds)}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : null
                }
              />
            </Col>
          ))}
        </Row>
      )}

      {/*
       * What is live, and who put it there. Plural because the wizard asks *one* of these and
       * records which — so the section names them all rather than implying there is only one.
       */}
      {data.graphs.length > 0 ? (
        <Card
          size="small"
          className="rp-panel"
          title={`Published graphs · ${data.graphs.length}`}
          extra={<span className="rp-dim">a report names the content that answered it</span>}
          style={{ marginTop: SP.lg }}
        >
          <ul className="rp-defs">
            {data.graphs.map((g) => (
              <li key={g.useCaseId}>
                <b>
                  {g.name} {g.version}
                </b>
                <span className="rp-dim">
                  {g.entityCount !== null ? `${g.entityCount.toLocaleString()} entities · ` : ''}
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
  )

  /*
   * The Author tab is the wizard's front door and, for a persona that may not write a definition,
   * a refusal that names who can. The refusal is the served note — the permission and the reason
   * for it are one sentence, and a page that reworded it would be arguing with the server.
   */
  const author = governance.author.mayAuthor ? (
    <Card className="rp-panel" title="Author a report">
      <p className="rp-author-note">{governance.author.note}</p>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/reports/new')}>
        Author a report
      </Button>
      <Typography.Text className="rp-dim rp-author-steps">
        Pick the published graph, ask in plain English or take one of the written reports, confirm
        the frame, then name it — naming is the last step because a report nobody named is a row
        nobody recognises a week later.
      </Typography.Text>
    </Card>
  ) : (
    <Alert
      type="info"
      showIcon
      title={`${governance.viewer.label ?? 'This persona'} cannot author reports`}
      description={
        <>
          <div>{governance.author.note}</div>
          <div className="rp-author-who">
            On this tenant that leaves {governance.author.authors.join(' and ')} — ask one of them
            for the report you need, or ask your question in Ask and keep the answer.
          </div>
        </>
      }
    />
  )

  const operations = (
    <Tabs
      defaultActiveKey="gates"
      className="rp-subtabs"
      items={[
        {
          key: 'gates',
          label: 'The two gates',
          children: (
            <>
              <Alert
                type="info"
                showIcon
                className="rp-note"
                title="Two grids, administered separately, never collapsed into one"
                description={governance.gates.note.split('. ').slice(1).join('. ')}
              />
              <EntitlementGate gate={governance.gates.entitlement} />
              <DataScopeGate gate={governance.gates.dataScope} />
            </>
          ),
        },
        {
          key: 'refresh',
          label: 'Refresh & schedule',
          children: (
            <Card className="rp-panel" title="What runs when, and what it stands on">
              <Table
                rowKey="reportId"
                size="small"
                pagination={false}
                className="rp-table"
                dataSource={governance.schedule}
                columns={[
                  { title: 'Report', dataIndex: 'title', render: (t: string) => <b>{t}</b> },
                  {
                    title: 'State',
                    dataIndex: 'statusLabel',
                    render: (label: string, row) => <StatusTag tone={row.tone}>{label}</StatusTag>,
                  },
                  { title: 'Refresh', dataIndex: 'schedule' },
                  {
                    title: 'As-of',
                    dataIndex: 'asOf',
                    render: (v: string | null) => <span className="rp-mono">{v ?? '—'}</span>,
                  },
                  {
                    title: 'Floor',
                    dataIndex: 'floor',
                    render: (v: string | null) => <span className="rp-mono">{v ?? '—'}</span>,
                  },
                  {
                    title: 'Slices',
                    dataIndex: 'parameterized',
                    render: (v: boolean) => (v ? 'parameterized' : 'fixed frame'),
                  },
                ]}
              />
            </Card>
          ),
        },
        {
          key: 'audit',
          label: 'Report audit',
          children: (
            <Card className="rp-panel" title="Acts this app can account for">
              <Table
                rowKey={(row) => `${row.reportId}:${row.act}`}
                size="small"
                pagination={false}
                className="rp-table"
                dataSource={governance.audit}
                columns={[
                  { title: 'Report', dataIndex: 'title', render: (t: string) => <b>{t}</b> },
                  { title: 'Act', dataIndex: 'act' },
                  { title: 'By', dataIndex: 'actor' },
                  {
                    title: 'At',
                    dataIndex: 'at',
                    render: (v: string | null) => <span className="rp-mono">{v ?? '—'}</span>,
                  },
                  { title: 'Detail', dataIndex: 'detail' },
                ]}
              />
              <Typography.Text className="rp-dim rp-gate-foot">
                Only acts with a record behind them: who wrote a definition and at which version,
                how it was approved, who saved a composed report, and whether the content it was
                asked of is still published. An audit trail with invented rows is worse than a
                short one.
              </Typography.Text>
            </Card>
          ),
        },
        {
          key: 'checks',
          label: 'Publish checks',
          children: (
            <Row gutter={[SP.base, SP.base]}>
              {governance.publishChecks.map((row) => (
                <Col key={row.reportId} xs={24} xl={12}>
                  <Card className="rp-panel" title={row.title}>
                    <ul className="rp-checks">
                      {row.checks.map((check) => (
                        <li key={check.key}>
                          <StatusTag tone={check.pass ? 'good' : 'warn'}>
                            {check.pass ? 'pass' : 'open'}
                          </StatusTag>
                          <span className="rp-check-label">{check.label}</span>
                          <span className="rp-dim">{check.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </Col>
              ))}
            </Row>
          ),
        },
      ]}
    />
  )

  return (
    <>
      {header}
      {error ? <ApiErrorAlert error={error} onRetry={() => void load(roleId)} /> : null}

      <Tabs
        defaultActiveKey="library"
        className="rp-tabs"
        items={[
          { key: 'library', label: 'Library', children: library },
          { key: 'author', label: 'Author', children: author },
          { key: 'operations', label: 'Operations & audience', children: operations },
        ]}
      />
    </>
  )
}
