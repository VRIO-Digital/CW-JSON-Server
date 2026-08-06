import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Col,
  Input,
  Progress,
  Row,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { CanvasNode, PublishedVersion, ReviewChoice } from '../api/client'
import ApiErrorAlert from '../components/ApiErrorAlert'
import GraphCanvas from '../components/GraphCanvas'
import PageHeader from '../components/PageHeader'
import ReviewQueueItem from '../components/ReviewQueueItem'
import StatCards from '../components/StatCards'
import StatusTag from '../components/StatusTag'
import { selectMustReview, useGraphStudioStore } from '../store/graphStudioStore'
import { SP } from '../theme'
import type { Stat } from '../types'
import './GraphStudioPage.css'

/** The inspector: what one node on the canvas actually is. */
function Inspector({
  node,
  onReview,
}: {
  node: CanvasNode | null
  onReview: () => void
}) {
  if (!node) {
    return (
      <div className="gs-inspector">
        <div className="gs-inspector-title">Inspector</div>
        <div className="gs-inspector-empty">Select a node on the canvas</div>
      </div>
    )
  }
  return (
    <div className="gs-inspector">
      <div className="gs-inspector-title">Inspector</div>
      <div className="gs-inspector-name">{node.label}</div>
      <div className="gs-inspector-sub">{node.sublabel}</div>

      <dl className="gs-inspector-facts">
        <dt>Confidence</dt>
        <dd>{node.confidence.toFixed(2)}</dd>
        <dt>Group</dt>
        <dd>{node.group}</dd>
        <dt>Origin</dt>
        <dd>{node.origin}</dd>
        <dt>State</dt>
        <dd>
          <StatusTag tone={node.proposed ? 'warn' : 'good'}>
            {node.proposed ? 'under review' : 'confirmed'}
          </StatusTag>
        </dd>
      </dl>

      {/* A proposed node exists because a row in the queue is open. Saying so,
          and linking there, is what keeps the two tabs one truth. */}
      {node.proposed ? (
        <>
          <div className="gs-inspector-note">
            This is proposed because its review item is still open. Decide it in
            the review queue and the node stops being provisional.
          </div>
          <Button size="small" onClick={onReview}>
            Open in review queue
          </Button>
        </>
      ) : null}
    </div>
  )
}

export default function GraphStudioPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { useCaseId } = useParams<{ useCaseId: string }>()

  const data = useGraphStudioStore((s) => s.data)
  const loading = useGraphStudioStore((s) => s.loading)
  const error = useGraphStudioStore((s) => s.error)
  const pending = useGraphStudioStore((s) => s.pending)
  const checking = useGraphStudioStore((s) => s.checking)
  const publishing = useGraphStudioStore((s) => s.publishing)
  const report = useGraphStudioStore((s) => s.report)
  const canvas = useGraphStudioStore((s) => s.canvas)
  const canvasLoading = useGraphStudioStore((s) => s.canvasLoading)
  const answer = useGraphStudioStore((s) => s.answer)
  const asking = useGraphStudioStore((s) => s.asking)
  const loadCanvas = useGraphStudioStore((s) => s.loadCanvas)
  const ask = useGraphStudioStore((s) => s.ask)
  const approve = useGraphStudioStore((s) => s.approve)
  const activate = useGraphStudioStore((s) => s.activate)
  const open = useGraphStudioStore((s) => s.open)
  const decide = useGraphStudioStore((s) => s.decide)
  const choosePivot = useGraphStudioStore((s) => s.choosePivot)
  const check = useGraphStudioStore((s) => s.check)
  const publish = useGraphStudioStore((s) => s.publish)
  const mustReview = useGraphStudioStore(selectMustReview)

  const [tab, setTab] = useState('queue')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [question, setQuestion] = useState('')

  useEffect(() => {
    if (useCaseId) void open(useCaseId)
  }, [useCaseId, open])

  // The canvas is a second request, so it is fetched when its tab is first
  // opened rather than on every page load.
  useEffect(() => {
    if ((tab === 'canvas' || tab === 'query') && useCaseId) void loadCanvas()
  }, [tab, useCaseId, loadCanvas])

  const back = (
    <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/graph-studio')}>
      All graphs
    </Button>
  )

  if (error && !data) {
    return (
      <>
        <ApiErrorAlert error={error} onRetry={() => useCaseId && void open(useCaseId)} />
        <div style={{ marginTop: SP.base }}>{back}</div>
      </>
    )
  }
  if (!data) return <Spin />

  const { pivot, publish: gate } = data

  // Every figure is the length of something the server returned, not a headline
  // kept in step by hand.
  const stats: Stat[] = [
    {
      label: 'Must review',
      value: String(data.mustReviewOutstanding),
      tone: data.mustReviewOutstanding > 0 ? 'warn' : 'good',
      note: 'floor items — block publish',
    },
    {
      label: 'Pivot',
      value: String(data.pivotCount),
      tone: data.pivotCount > 0 ? 'crit' : 'good',
      note: pivot.open ? 'blocking the build now' : `settled as ${pivot.chosen}`,
    },
    {
      label: 'Confirmed FYI',
      value: String(data.confirmedCount),
      note: '0.85–0.95 — spot-check',
    },
    {
      label: 'Auto-approved',
      value: String(data.autoApprovedCount),
      note: '≥0.95 — show all',
    },
  ]

  async function onDecide(itemId: string, choice: ReviewChoice, justification: string) {
    const result = await decide({ itemId, choice, justification })
    if (!result.ok) message.error(result.error)
  }

  async function onPivot(optionId: string) {
    const result = await choosePivot(optionId)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success(`Pivot settled as ${optionId}. The queue now means one thing.`)
  }

  async function onCheck() {
    const result = await check()
    if (!result.ok) message.error(result.error)
  }

  async function onPublish() {
    const result = await publish()
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success(`Published ${result.version}.`)
  }

  const reviewQueue = (
    <>
      <StatCards stats={stats} />

      <div className="gs-batch">
        <Progress
          percent={Math.round((data.batchResolved / data.batchTotal) * 100)}
          showInfo={false}
          strokeColor="#0f7b4f"
          className="gs-batch-bar"
        />
        <span className="gs-batch-text">
          batch progress · {data.batchResolved} of {data.batchTotal} resolved · save
          &amp; resume anytime
        </span>
        <Tag className="gs-memory">decision memory · {data.decisionMemory}</Tag>
      </div>

      {/* The pivot sits above the rows because it changes what they mean — it
          cannot be worked around by clearing the queue. */}
      {pivot.open ? (
        <div className="gs-pivot">
          <div className="gs-pivot-head">
            <WarningOutlined aria-hidden="true" />
            <strong>
              Pivot · {pivot.pivotId} / {pivot.alternativeId} — {pivot.title}
            </strong>
          </div>
          <div className="gs-pivot-detail">{pivot.detail}</div>
          <div className="gs-pivot-options">
            {pivot.options.map((o) => (
              <button
                key={o.optionId}
                type="button"
                className="gs-pivot-option"
                onClick={() => void onPivot(o.optionId)}
                disabled={pending === o.optionId}
              >
                <span className="gs-pivot-label">
                  {o.optionId} · {o.label}
                </span>
                <span className="gs-pivot-consequence">{o.consequence}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mustReview.map((item) => (
        <ReviewQueueItem
          key={item.itemId}
          item={item}
          pending={pending === item.itemId}
          onDecide={(choice, justification) =>
            void onDecide(item.itemId, choice, justification)
          }
        />
      ))}

      {gate.blocked ? (
        <Alert
          className="gs-gate"
          type="warning"
          showIcon
          title="Publish is blocked."
          description={`${gate.reasons.join(' · ')}. ${gate.explanation}`}
        />
      ) : (
        <Alert
          className="gs-gate"
          type="success"
          showIcon
          title="Ready to publish."
          description={`Every floor item is decided and the pivot is settled as ${pivot.chosen}.`}
        />
      )}
    </>
  )

  async function onAsk() {
    if (!question.trim()) {
      message.warning('Type a question to ask the draft graph.')
      return
    }
    const result = await ask(question.trim())
    if (!result.ok) message.error(result.error)
  }

  async function onApprove(version: number) {
    const result = await approve(version)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success(`v${version} approved — it can now be made live.`)
  }

  async function onActivate(version: number) {
    const result = await activate(version)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success(`v${version} is now serving.`)
  }

  const canvasTab =
    canvasLoading && !canvas ? (
      <Spin />
    ) : canvas ? (
      <Row gutter={[SP.base, SP.base]}>
        <Col xs={24} xl={17}>
          <GraphCanvas
            canvas={canvas}
            selected={selectedNode}
            onSelect={setSelectedNode}
          />
        </Col>
        <Col xs={24} xl={7}>
          <Inspector
            node={canvas.nodes.find((n) => n.nodeId === selectedNode) ?? null}
            onReview={() => setTab('queue')}
          />
        </Col>
      </Row>
    ) : (
      <div className="gs-todo">The canvas could not be loaded.</div>
    )

  const queryTab = (
    <Row gutter={[SP.base, SP.base]}>
      <Col xs={24} xl={17}>
        <div className="gs-query">
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onPressEnter={() => void onAsk()}
              placeholder="e.g. What did Interruption #88 cost us?"
              aria-label="Ask the draft graph"
            />
            <Button type="primary" loading={asking} onClick={() => void onAsk()}>
              Ask the draft
            </Button>
          </Space.Compact>
          <div className="gs-query-hint">
            Asked of the <strong>draft</strong>, before anyone commits to it. The
            path an answer travels is the answer’s evidence — it lights up on the
            Canvas tab.
          </div>

          {answer ? (
            <div className="gs-answer">
              <StatusTag tone={answer.answerable ? 'good' : 'crit'}>
                {answer.answerable
                  ? `answered over ${answer.hops} hop(s)`
                  : 'cannot be answered'}
              </StatusTag>
              <div className="gs-answer-reason">{answer.reason}</div>

              {answer.answerable ? (
                <div className="gs-answer-path">
                  {answer.pathLabels.join('  →  ')}
                </div>
              ) : null}

              {/* An answer resting on an undecided edge is answerable *and*
                  provisional. Publishing would change it. */}
              {answer.caveats.length > 0 ? (
                <Alert
                  style={{ marginTop: SP.md }}
                  type="warning"
                  showIcon
                  title="This answer rests on decisions you have not taken yet."
                  description={answer.caveats.join(' · ')}
                />
              ) : null}
            </div>
          ) : (
            <div className="gs-todo" style={{ marginTop: SP.base }}>
              <strong>Nothing asked yet</strong>
              <div style={{ marginTop: SP.sm }}>
                A sanity check is one question you already know the answer to. If
                the draft cannot answer it, the graph is not finished — better to
                learn that here than after publishing.
              </div>
            </div>
          )}
        </div>
      </Col>
    </Row>
  )

  const qualityTab = (
    <>
      <div className="gs-quality-head">
        <Button loading={checking} onClick={() => void onCheck()}>
          {report ? 'Re-run quality check' : 'Run quality check'}
        </Button>
        {report ? (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            {report.passed} passed · {report.failed} failed · ran{' '}
            {new Date(report.ranAt).toLocaleString()}
          </Typography.Text>
        ) : null}
      </div>

      {report ? (
        report.checks.map((c) => (
          <div key={c.checkId} className="gs-check">
            {c.passed ? (
              <CheckCircleOutlined style={{ color: '#0f7b4f' }} aria-hidden="true" />
            ) : (
              <CloseCircleOutlined style={{ color: '#b42318' }} aria-hidden="true" />
            )}
            <span className="gs-check-label">{c.label}</span>
            <span className="gs-check-detail">{c.detail}</span>
          </div>
        ))
      ) : (
        <div className="gs-todo">
          <strong>No report yet</strong>
          <div style={{ marginTop: SP.sm }}>
            The check reports against the decisions taken so far, so it is worth
            re-running as the queue clears — it is the same three preconditions
            the publish gate enforces.
          </div>
        </div>
      )}
    </>
  )

  const versionColumns = [
    {
      title: 'Version',
      dataIndex: 'version',
      render: (n: number, v: PublishedVersion) => (
        <Space size={SP.sm}>
          <span style={{ fontWeight: v.isLive ? 600 : 400 }}>{`v${n}`}</span>
          {/* Exactly one row serves, and it says so — "newest" stops being a
              safe guess the moment an older version can be activated. */}
          {v.isLive ? <StatusTag tone="good">live</StatusTag> : null}
        </Space>
      ),
    },
    {
      title: 'Published',
      dataIndex: 'publishedAt',
      render: (iso: string) => new Date(iso).toLocaleString(),
    },
    { title: 'By', dataIndex: 'publishedBy' },
    { title: 'Note', dataIndex: 'note' },
    {
      title: 'Approval',
      key: 'approval',
      // Live and unapproved is a real state, and the gap is the thing worth
      // seeing — so it is a column, not a hidden flag.
      render: (_: unknown, v: PublishedVersion) =>
        v.approval ? (
          <Tooltip
            title={`${v.approval.approvedBy} · ${new Date(
              v.approval.approvedAt,
            ).toLocaleString()}`}
          >
            <span>
              <StatusTag tone="good">approved</StatusTag>
            </span>
          </Tooltip>
        ) : (
          <Space size={SP.sm}>
            <StatusTag tone="warn">awaiting sign-off</StatusTag>
            <Button
              size="small"
              loading={pending === `approve-v${v.version}`}
              onClick={() => void onApprove(v.version)}
            >
              Approve
            </Button>
          </Space>
        ),
    },
    {
      title: 'Serving',
      key: 'serving',
      /*
       * Approval is the gate on going live, so an unapproved version offers no
       * button at all and says why — a disabled control with no reason reads as
       * broken. Rolling back to an older approved version is the same action.
       */
      render: (_: unknown, v: PublishedVersion) =>
        v.isLive ? (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            serving now
          </Typography.Text>
        ) : v.approval ? (
          <Button
            size="small"
            loading={pending === `live-v${v.version}`}
            onClick={() => void onActivate(v.version)}
          >
            Make live
          </Button>
        ) : (
          <Tooltip title="Approve this version before it can serve">
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              approve first
            </Typography.Text>
          </Tooltip>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Graph Studio"
        subtitle="Where the drafted graph becomes the trusted graph. Review what the builder wasn’t sure about, shape the ontology, prove it answers — then publish."
        actions={
          <>
            {back}
            {/* Only what is live. The draft version is on the Publish button,
                which is the one place it means something — two tags for two
                versions read as a version history nobody asked for. */}
            {data.liveVersion ? (
              <Tag color="success">{`live ${data.liveVersion}`}</Tag>
            ) : null}
            {/*
              * No quality-check button here — it lives on the Quality report
              * tab, where its result appears; running it from a header that
              * then shows nothing was the duplicate worth losing.
              *
              * Publish is disabled while the gate is blocked, and the tooltip
              * says why. The server refuses it too, so the two cannot disagree.
              */}
            <Tooltip title={gate.blocked ? gate.reasons.join(' · ') : undefined}>
              <Button
                type="primary"
                loading={publishing}
                disabled={gate.blocked}
                onClick={() => void onPublish()}
              >
                Publish {data.version}…
              </Button>
            </Tooltip>
          </>
        }
      />

      <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginTop: -SP.base }}>
        <strong>{data.graphName}</strong>
        {data.domainId ? ` · ${data.domainId}` : ''} ·{' '}
        {loading ? 'refreshing…' : `${data.queueCount} item(s) still need a human`}
      </Typography.Paragraph>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'queue',
            label: (
              <span>
                Review queue <Tag className="gs-tab-count">{data.queueCount}</Tag>
              </span>
            ),
            children: reviewQueue,
          },
          { key: 'canvas', label: 'Canvas', children: canvasTab },
          { key: 'query', label: 'Query & sanity-check', children: queryTab },
          { key: 'quality', label: 'Quality report', children: qualityTab },
          {
            key: 'versions',
            label: 'Versions',
            children: (
              <Table<PublishedVersion>
                size="small"
                rowKey="version"
                dataSource={data.versions}
                columns={versionColumns}
                pagination={false}
                locale={{
                  emptyText:
                    'Nothing published yet — clear the queue, settle the pivot, then publish.',
                }}
              />
            ),
          },
        ]}
      />
    </>
  )
}
