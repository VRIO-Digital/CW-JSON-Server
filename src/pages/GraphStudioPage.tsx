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
  Tabs,
  Tag,
  Typography,
} from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { ReviewChoice } from '../api/client'
import ApiErrorAlert from '../components/ApiErrorAlert'
import BuildTab from '../components/BuildTab'
import GraphCanvas from '../components/GraphCanvas'
import NodeInspector from '../components/NodeInspector'
import PageHeader from '../components/PageHeader'
import ReviewQueueItem from '../components/ReviewQueueItem'
import StatCards from '../components/StatCards'
import StatusTag from '../components/StatusTag'
import VersionsTab from '../components/VersionsTab'
import {
  selectMustReview,
  useGraphBuildStore,
  useGraphStudioStore,
} from '../store/graphStudioStore'
import { SP } from '../theme'
import type { Stat } from '../types'
import './GraphStudioPage.css'

export default function GraphStudioPage() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  /* Named, because `location` is also a global and reading that one would silently
     return undefined instead of the router's state. */
  const routerLocation = useLocation()
  const { useCaseId } = useParams<{ useCaseId: string }>()

  const data = useGraphStudioStore((s) => s.data)
  const loading = useGraphStudioStore((s) => s.loading)
  const error = useGraphStudioStore((s) => s.error)
  const pending = useGraphStudioStore((s) => s.pending)
  const checking = useGraphStudioStore((s) => s.checking)
  const report = useGraphStudioStore((s) => s.report)
  const canvas = useGraphStudioStore((s) => s.canvas)
  const canvasLoading = useGraphStudioStore((s) => s.canvasLoading)
  const answer = useGraphStudioStore((s) => s.answer)
  const asking = useGraphStudioStore((s) => s.asking)
  const loadCanvas = useGraphStudioStore((s) => s.loadCanvas)
  const ask = useGraphStudioStore((s) => s.ask)
  const open = useGraphStudioStore((s) => s.open)
  const decide = useGraphStudioStore((s) => s.decide)
  const choosePivot = useGraphStudioStore((s) => s.choosePivot)
  const check = useGraphStudioStore((s) => s.check)
  const publish = useGraphStudioStore((s) => s.publish)
  const unpublish = useGraphStudioStore((s) => s.unpublish)
  const mustReview = useGraphStudioStore(selectMustReview)

  /*
   * Land on Build when arriving from the wizard's "Save & build graph" — the run
   * it just started is the thing to watch. Every other arrival lands on the queue,
   * which is what the studio is for.
   */
  const [tab, setTab] = useState(
    () => (routerLocation.state as { tab?: string } | null)?.tab ?? 'queue',
  )
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [question, setQuestion] = useState('')

  const builds = useGraphBuildStore((s) => s.history)
  const shownBuild = useGraphBuildStore((s) => s.shown)
  const buildsLoading = useGraphBuildStore((s) => s.loading)
  const buildStarting = useGraphBuildStore((s) => s.starting)
  const loadBuilds = useGraphBuildStore((s) => s.load)
  const triggerBuild = useGraphBuildStore((s) => s.start)
  const showBuild = useGraphBuildStore((s) => s.show)
  const pollBuild = useGraphBuildStore((s) => s.poll)

  useEffect(() => {
    if (useCaseId) void open(useCaseId)
  }, [useCaseId, open])

  // The canvas is a second request, so it is fetched when its tab is first
  // opened rather than on every page load.
  useEffect(() => {
    if ((tab === 'canvas' || tab === 'query') && useCaseId) void loadCanvas()
  }, [tab, useCaseId, loadCanvas])

  /* The history is loaded on arrival rather than on first opening the tab: a build
     started by the wizard is already running, and it should be found in flight. */
  useEffect(() => {
    if (useCaseId) void loadBuilds(useCaseId)
  }, [useCaseId, loadBuilds])

  // Polls only while a run is in flight, at half its stage interval so no stage
  // is missed; the poll that sees it land stops.
  useEffect(() => {
    if (shownBuild?.status !== 'running') return
    const id = window.setInterval(() => void pollBuild(), 350)
    return () => window.clearInterval(id)
  }, [shownBuild?.status, pollBuild])

  /*
   * A finished build has produced a version, and the version rows live in the
   * studio payload — which is otherwise fetched once, on arrival. Without this
   * the build you just watched would not appear on Versions until the page was
   * reloaded: the run says "complete" and the list still shows the ones before it.
   *
   * Keyed on the build id so it refreshes once per run, not on every render while
   * a completed run is on screen.
   */
  const refreshedForBuild = useRef<string | null>(null)
  useEffect(() => {
    if (!useCaseId || shownBuild?.status !== 'complete') return
    if (refreshedForBuild.current === shownBuild.buildId) return
    refreshedForBuild.current = shownBuild.buildId
    void open(useCaseId)
  }, [useCaseId, shownBuild?.status, shownBuild?.buildId, open])

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

  /*
   * Publishing names a version, so it happens on that version's row. There is no
   * header publish button any more: "publish" without saying *which build* is the
   * ambiguity this list exists to remove.
   */
  async function onPublish(sha256: string) {
    const result = await publish(sha256)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success('Published — Ask now queries this version.')
  }

  async function onUnpublish(sha256: string) {
    const result = await unpublish(sha256)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success('Unpublished — Ask no longer serves this graph.')
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
          {/* Why it is a pivot and not a queue row. The server's sentence, because
              this is the whole justification for the extra gate. */}
          <div className="gs-pivot-why">{pivot.whyPivot}</div>
          {/* Same evidence a queue row carries — a pivot is a review decision with a
              wider blast radius, not a different kind of claim. */}
          {pivot.evidence.length > 0 ? (
            <ul className="gs-pivot-evidence">
              {pivot.evidence.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
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

  /* `asked` is passed by a chip, which must not wait for the state it just set —
     setQuestion is asynchronous, so reading `question` here would ask the previous
     one. Typing still falls through to the box's value. */
  async function onAsk(asked?: string) {
    const text = (asked ?? question).trim()
    if (!text) {
      message.warning('Type a question to ask the draft graph.')
      return
    }
    const result = await ask(text)
    if (!result.ok) message.error(result.error)
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
            /* The canvas shares this tab with the inspector and the studio's own
               chrome, and 189 nodes want the window. The full view is the same
               component on the same data — a bigger frame, not a second drawing. */
            fullViewHref={`/graph-studio/${encodeURIComponent(useCaseId ?? '')}/canvas`}
          />
        </Col>
        <Col xs={24} xl={7}>
          <NodeInspector
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

          {/* The brief's own hero questions, as chips. Each one is a recorded
              sanity check, so a chip is a promise the use case already made rather
              than a suggestion written on this page. */}
          {data.sanityChecks.length > 0 ? (
            <div className="gs-query-chips">
              {data.sanityChecks.map((c) => (
                <Button
                  key={c.checkId}
                  size="small"
                  disabled={asking}
                  onClick={() => {
                    setQuestion(c.question)
                    void onAsk(c.question)
                  }}
                >
                  <span className="gs-chip-label">{c.question}</span>
                </Button>
              ))}
            </div>
          ) : null}

          {answer ? (
            <div className="gs-answer">
              <Space size={SP.sm} wrap>
                <StatusTag tone={answer.answerable ? 'good' : 'crit'}>
                  {answer.answerable
                    ? `answered over ${answer.hops} hop(s)`
                    : 'cannot be answered'}
                </StatusTag>
                {/* Which route answered. A written verdict must never be read as
                    something the walk derived, so the provenance is on the answer
                    and not in a tooltip. Neutral: "recorded" is not a state. */}
                {answer.recorded ? (
                  <Tag variant="outlined">
                    recorded check {answer.checkId}
                    {answer.heroQuestionId ? ` · ${answer.heroQuestionId}` : ''}
                  </Tag>
                ) : (
                  <Tag variant="outlined">derived from the draft</Tag>
                )}
                {answer.costUsd !== null ? (
                  <Tag variant="outlined">
                    ${answer.costUsd.toFixed(2)} of ${answer.budgetUsd?.toFixed(2)} budget
                  </Tag>
                ) : null}
              </Space>

              <div className="gs-answer-reason">{answer.reason}</div>
              {answer.verdictBody ? (
                <div className="gs-answer-body">{answer.verdictBody}</div>
              ) : null}
              {/* How a recorded check was matched, because "the same question" and
                  "it shared four words" are different claims. */}
              {answer.matchedHow ? (
                <div className="gs-answer-match">Matched: {answer.matchedHow}</div>
              ) : null}

              {/* Context the check states beside its verdict. `ok: false` is a
                  caveat rather than a confirmation, and reads as one. */}
              {answer.context.length > 0 ? (
                <ul className="gs-answer-context">
                  {answer.context.map((c) => (
                    <li key={`${c.chip}:${c.label}`} className={c.ok ? '' : 'is-pending'}>
                      <span className="gs-context-chip">{c.chip}</span>
                      <span className="gs-context-label">{c.label}</span>
                      <span className="gs-context-meta">{c.meta}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* A chain only where the walk found one. A recorded traversal is a
                  sub-graph, so its hops are listed instead of arrow-joined — three
                  generators meeting at one TSDF is not a route. */}
              {answer.pathLabels.length > 0 ? (
                <div className="gs-answer-path">{answer.pathLabels.join('  →  ')}</div>
              ) : null}
              {answer.edgesUsed.length > 0 ? (
                <ul className="gs-answer-hops">
                  {answer.edgesUsed.map((h) => (
                    <li key={h.edgeId} className={h.proposed ? 'is-proposed' : ''}>
                      {h.fromLabel} <span className="gs-hop-rel">{h.label}</span>{' '}
                      {h.toLabel}
                    </li>
                  ))}
                </ul>
              ) : null}

              {/* What the engine would run. Shown because a plan nobody can read is
                  an answer taken on trust. */}
              {answer.plan ? (
                <pre className="gs-answer-plan">{answer.plan}</pre>
              ) : null}

              {/* An answer resting on an undecided edge is answerable *and*
                  provisional. Publishing would change it — and a recorded check is
                  not exempt: it is flagged from the edges it actually used. */}
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
              * Nothing else in this header.
              *
              * No quality-check button — it lives on the Quality report tab, where
              * its result appears. And **no publish button**: publishing names a
              * specific build, so it belongs on that build's row in Versions.
              * A header "Publish v2…" could not say which of six builds it meant.
              *
              * What is here instead is the build the page is showing, so the run
              * and the graph are never separated.
              */}
            {shownBuild ? (
              <span className="gs-job">
                job <code>{shownBuild.buildId.slice(0, 8)}…</code> ·{' '}
                {shownBuild.status}
              </span>
            ) : null}
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
            key: 'build',
            label: 'Build',
            children: (
              <BuildTab
                graphName={`${data.graphName}${data.domainId ? ` · ${data.domainId}` : ''}`}
                liveVersion={data.liveVersion}
                builds={builds}
                shown={shownBuild}
                starting={buildStarting}
                loading={buildsLoading}
                onTrigger={() => {
                  if (!useCaseId) return
                  void triggerBuild(useCaseId).then((r) => {
                    if (!r.ok) message.error(r.error)
                  })
                }}
                onShow={showBuild}
                onReload={() => {
                  if (useCaseId) void loadBuilds(useCaseId)
                }}
              />
            ),
          },
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
              <VersionsTab
                versions={data.versions}
                graphName={data.graphName}
                loadedJob={shownBuild?.buildId ?? null}
                pending={pending}
                gateBlocked={gate.blocked}
                gateReasons={gate.reasons}
                onPublish={(sha) => void onPublish(sha)}
                onUnpublish={(sha) => void onUnpublish(sha)}
                onLoadJob={(buildId) => {
                  // Show that run on the Build tab and go there — "load this
                  // version's job" is a navigation, so it navigates.
                  showBuild(buildId)
                  setTab('build')
                }}
              />
            ),
          },
        ]}
      />
    </>
  )
}
