import {
  ArrowUpOutlined,
  MessageOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import { Alert, Button, Input, Select, Spin, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ApiErrorAlert from '../components/ApiErrorAlert'
import EmptyState from '../components/EmptyState'
import PageHeader from '../components/PageHeader'
import StatusTag from '../components/StatusTag'
import {
  selectAskGraphs,
  selectCurrentGraph,
  useAskStore,
} from '../store/askStore'
import { SP } from '../theme'
import './AskPage.css'

/** The path from nothing to a graph you can ask. */
const LIVE_STEPS = [
  { title: 'Describe the need', detail: 'New Graph — seven steps, no entity names' },
  { title: 'Review the build', detail: 'Graph Studio — settle what the deriver flagged' },
  { title: 'Publish it', detail: 'a published version is what Ask queries' },
]

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toISOString().slice(0, 10) : null

/**
 * Ask — a query engine over a *published* graph.
 *
 * The picker lists what is live, and nothing else: a draft has no version to
 * answer against, and a built-but-unpublished graph is a different problem with
 * a different fix. Both are counted on the empty page so it can name the right
 * one.
 *
 * Everything the grounding note claims comes from the payload — the version,
 * who published it and when, and the standing caveats the brief already
 * accepted. Nothing here narrates a capability the server did not report.
 */
export default function AskPage() {
  const navigate = useNavigate()
  const [question, setQuestion] = useState('')

  const data = useAskStore((s) => s.data)
  const loading = useAskStore((s) => s.loading)
  const error = useAskStore((s) => s.error)
  const asking = useAskStore((s) => s.asking)
  const answer = useAskStore((s) => s.answer)
  const useCaseId = useAskStore((s) => s.useCaseId)
  const load = useAskStore((s) => s.load)
  const select = useAskStore((s) => s.select)
  const ask = useAskStore((s) => s.ask)
  const graphs = useAskStore(selectAskGraphs)
  const graph = useAskStore(selectCurrentGraph)

  useEffect(() => {
    void load()
  }, [load])

  async function onAsk(text: string) {
    const result = await ask(text)
    if (!result.ok) {
      message.error(result.error)
      return
    }
    setQuestion('')
  }

  if (error) return <ApiErrorAlert error={error} onRetry={() => void load()} />

  const picker =
    graphs.length > 0 ? (
      <Select
        value={useCaseId ?? undefined}
        onChange={select}
        style={{ minWidth: 220 }}
        aria-label="Graph to ask"
        options={graphs.map((g) => ({
          value: g.useCaseId,
          // The live version, beside the name — asking a graph without knowing
          // which version answered is asking nothing in particular.
          label: `${g.name} · ${g.version}`,
        }))}
      />
    ) : null

  return (
    <>
      <PageHeader
        title="Ask"
        subtitle="A query engine, not a search box. Ask in plain language — a supervisor agent grounds the question in the knowledge graph, routes to source systems, and returns an evidence-backed answer with the full reasoning open for inspection."
        actions={picker}
      />

      {loading && !data ? (
        <Spin />
      ) : !graph ? (
        /*
         * Nothing is live. Which sentence to show depends on why: a built graph
         * needs publishing and a draft needs finishing, and sending someone to
         * the wrong page is the failure this branch exists to avoid.
         */
        <EmptyState
          icon={<MessageOutlined />}
          title="No graph is live yet"
          detail={
            data?.builtCount
              ? `${data.builtCount} graph(s) have been built but none is published. Ask queries a published version — open one in Graph Studio, clear its review queue and publish it.`
              : data?.draftCount
                ? `${data.draftCount} use case(s) are still in the wizard. Finish one, build it, then publish it in Graph Studio — Ask queries the published version.`
                : 'Ask runs against a published knowledge graph. Describe a business need in New Graph, build it, review it in Graph Studio, and publish — then this page can answer.'
          }
          action={
            <Button
              type="primary"
              size="large"
              onClick={() => navigate(data?.builtCount ? '/graph-studio' : '/new-graph')}
            >
              {data?.builtCount ? 'Open Graph Studio' : 'Describe a business need'}
            </Button>
          }
          steps={LIVE_STEPS}
          footnote="A draft cannot be asked — there is no version to hold the answer to."
        />
      ) : (
        <div className="ask-shell">
          <div className="ask-thread">
            {answer ? (
              <div className="ask-turn">
                <div className="ask-asked">
                  <QuestionCircleOutlined aria-hidden="true" />
                  <span>{answer.question}</span>
                </div>

                <div className="ask-reply">
                  {/*
                   * An abstention is not an error — it is the graph declining to
                   * guess, which is the behaviour the page promises. `warn`,
                   * never `crit`.
                   */}
                  <StatusTag tone={answer.answered ? 'good' : 'warn'}>
                    {answer.answered
                      ? `answered · confidence ${answer.confidence?.toFixed(2)}`
                      : 'abstained'}
                  </StatusTag>

                  <p className="ask-answer">
                    {answer.answered ? answer.answer : answer.reason}
                  </p>

                  {answer.answered ? (
                    <div className="ask-path">{answer.path.join('  →  ')}</div>
                  ) : null}

                  <div className="ask-section-title">Reasoning</div>
                  <ol className="ask-steps">
                    {answer.reasoning.map((s) => (
                      <li key={s.step}>
                        <strong>{s.step}</strong>
                        <span>{s.detail}</span>
                      </li>
                    ))}
                  </ol>

                  {/* Every claim names what it rests on, or the list says so. */}
                  <div className="ask-section-title">
                    Evidence{' '}
                    <em>
                      {answer.citations.length} citation(s) · citations{' '}
                      {graph.citations} for this use case
                    </em>
                  </div>
                  {answer.citations.length > 0 ? (
                    <ul className="ask-citations">
                      {answer.citations.map((c) => (
                        <li key={c.label}>
                          <span className="ask-cite-label">{c.label}</span>
                          <span className="ask-cite-detail">{c.detail}</span>
                          <span className="ask-cite-conf">
                            {c.confidence.toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="ask-note">
                      Nothing was cited, because nothing was answered.
                    </div>
                  )}

                  {answer.caveats.length > 0 ? (
                    <Alert
                      style={{ marginTop: SP.base }}
                      type="warning"
                      showIcon
                      title="What this graph cannot tell you"
                      description={answer.caveats.join(' · ')}
                    />
                  ) : null}
                </div>
              </div>
            ) : (
              /*
               * Before the first question: what this graph is, and what asking
               * it will and will not get you.
               */
              <div className="ask-grounding">
                <Typography.Title level={5} style={{ margin: 0 }}>
                  Ask against {graph.name}
                </Typography.Title>
                <p className="ask-grounding-note">
                  Answers are grounded in graph <strong>{graph.version}</strong>
                  {graph.publishedAt && graph.publishedBy
                    ? `, published ${shortDate(graph.publishedAt)} by ${graph.publishedBy}`
                    : ''}
                  . {graph.entityCount} entities · {graph.relationshipCount}{' '}
                  relationships.
                  {graph.caveats.length > 0 ? ` ${graph.caveats.join('. ')}.` : ''}{' '}
                  Every number carries its source; every answer carries its
                  confidence — or the reason it abstains.
                </p>
              </div>
            )}

            {/* One line, one call. It advances when the answer returns. */}
            {asking ? (
              <div className="ask-working">
                <Spin size="small" />
                <span>
                  Grounding the question in {graph.name} {graph.version}, routing
                  to source systems, composing the answer…
                </span>
              </div>
            ) : null}
          </div>

          <div className="ask-composer">
            <div className="ask-box">
              <Input
                variant="borderless"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onPressEnter={() => void onAsk(question)}
                placeholder="Ask anything about your operations..."
                aria-label={`Ask ${graph.name} ${graph.version}`}
                disabled={asking}
              />
              <Button
                type="primary"
                icon={<ArrowUpOutlined />}
                loading={asking}
                disabled={!question.trim()}
                onClick={() => void onAsk(question)}
              >
                Ask
              </Button>
            </div>

            {/*
             * The chips are this graph's hero questions — the ones the brief
             * said it had to answer. Nothing else belongs here: a suggestion
             * the graph was never built for is a trap.
             */}
            {graph.suggestedQuestions.length > 0 ? (
              <div className="ask-chips">
                {graph.suggestedQuestions.map((q) => (
                  <Button
                    key={q}
                    size="small"
                    shape="round"
                    // Truncated in CSS, so the whole sentence lives here.
                    title={q}
                    disabled={asking}
                    onClick={() => {
                      setQuestion(q)
                      void onAsk(q)
                    }}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
