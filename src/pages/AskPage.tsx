import { ArrowUpOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { Alert, Button, Input, Select, Spin, Tabs, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import AnswerBlocks from '../components/AnswerBlocks'
import AnswerRequirementsPanel from '../components/AnswerRequirementsPanel'
import ApiErrorAlert from '../components/ApiErrorAlert'
import NoPublishedGraph from '../components/NoPublishedGraph'
import PageHeader from '../components/PageHeader'
import StatusTag from '../components/StatusTag'
import {
  selectAskGraphs,
  selectCitations,
  selectCurrentGraph,
  selectRequirementOptions,
  useAskStore,
} from '../store/askStore'
import { SP } from '../theme'
import './AskPage.css'

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
  const [question, setQuestion] = useState('')
  /* The question stays on screen while its answer streams in beneath it — the
     input is cleared on send, so the text has to be held somewhere. */
  const [asked, setAsked] = useState('')

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
  /* The Answer requirements tab. The pool is served; the pick is the reader's, and
     `selectCitations` is the one place the effective value is decided — so the control
     cannot show one value while the request carries another. */
  const requirementOptions = useAskStore(selectRequirementOptions)
  const citations = useAskStore(selectCitations)
  const formatIds = useAskStore((s) => s.formatIds)
  const setCitations = useAskStore((s) => s.setCitations)
  const toggleFormat = useAskStore((s) => s.toggleFormat)
  // Selected one at a time: a block arriving must not re-render the picker.
  const streamedSteps = useAskStore((s) => s.streamedSteps)
  const streamedBlocks = useAskStore((s) => s.streamedBlocks)
  const streamedSummary = useAskStore((s) => s.streamedSummary)

  useEffect(() => {
    void load()
  }, [load])

  async function onAsk(text: string) {
    if (!text.trim()) {
      message.warning('Ask a question first.')
      return
    }
    // Cleared here, so the box is empty while the answer streams — and the text
    // moves to `asked`, above the answer, rather than disappearing.
    setAsked(text.trim())
    setQuestion('')
    const result = await ask(text)
    if (!result.ok) message.error(result.error)
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
         * The shared gate, not a private one. Ask had its own `EmptyState` here — same
         * precondition, different title, different steps and its own "Open Graph Studio"
         * button — so the four pages that need a published graph described it two ways. The
         * only Ask-specific parts are the sentence and the closing line, which are what the
         * component takes as props.
         */
        <NoPublishedGraph
          detail="Ask queries the published version of a graph — a draft has no version to hold an answer."
          builtCount={data?.builtCount ?? 0}
          draftCount={data?.draftCount ?? 0}
          footnote="A draft cannot be asked — there is no version to hold the answer to."
        />
      ) : (
        /*
         * Two tabs, both behind the one gate.
         *
         * Asking is the page's job; **Answer requirements** is what a reader wants an
         * answer to carry — which was step 6 of the New Graph wizard, declared once per
         * brief for every answer it would ever give. It sits beside the question box
         * instead, because the reader asking is the one who knows what this answer has
         * to be, and the choice travels with the question rather than with the graph.
         */
        <Tabs
          defaultActiveKey="ask"
          items={[
            {
              key: 'ask',
              label: 'Ask',
              children: (
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
                        {answer.answered ? (answer.summary ?? answer.answer) : answer.reason}
                      </p>

                      {/* The body of a recorded answer: prose, figures, chart, table,
                          in the order it was written. Empty when the graph walk
                          answered — a walk produces a sentence, not blocks. */}
                      <AnswerBlocks blocks={answer.blocks} />

                      {answer.answered && answer.path.length > 0 ? (
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

                      {/*
                       * Every claim names what it rests on, or the list says so — and what
                       * was *required* of this answer is the reader's own pick on the Answer
                       * requirements tab, reported back by the server rather than restated
                       * here. `satisfied` is computed: citations required plus an answer
                       * carrying none is a fact, and it is not dressed up as met.
                       *
                       * One expression, because `renderToString` splits
                       * `text {expr} text` into separate nodes and the sentence is asserted
                       * on as the sentence it renders as.
                       */}
                      <div className="ask-section-title">
                        Evidence{' '}
                        <em>
                          {`${answer.citations.length} citation(s) · citations ${answer.requirements.citations} for this question`}
                        </em>
                      </div>
                      {answer.requirements.satisfied ? null : (
                        <StatusTag tone="warn">requirement not met</StatusTag>
                      )}
                      <div className="ask-note">{answer.requirements.note}</div>
                      {answer.citations.length > 0 ? (
                        <ul className="ask-citations">
                          {answer.citations.map((c) => (
                            <li key={c.label}>
                              <span className="ask-cite-label">{c.label}</span>
                              <span className="ask-cite-detail">{c.detail}</span>
                              {/* Only where there is a number. A recorded answer's
                                  evidence rows have none, and a placeholder would be
                                  an invented score. */}
                              {c.confidence !== null ? (
                                <span className="ask-cite-conf">{c.confidence.toFixed(2)}</span>
                              ) : null}
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

                {/*
                  The answer as it composes.
                  Every line here has already arrived from the server — the steps it
                  took, then the summary, then each block. Nothing is animated ahead
                  of the response: this is the same distinction the consent panel
                  draws between a stage and a timer, applied to one streaming call.
                */}
                {asking ? (
                  <div className="ask-turn is-streaming">
                    <div className="ask-asked">
                      <QuestionCircleOutlined aria-hidden="true" />
                      <span>{asked}</span>
                    </div>

                    <div className="ask-reply" aria-live="polite" aria-busy="true">
                      {streamedSteps.length > 0 ? (
                        <ol className="ask-steps is-live">
                          {streamedSteps.map((s) => (
                            <li key={s.step}>
                              <strong>{s.step}</strong>
                              <span>{s.detail}</span>
                            </li>
                          ))}
                        </ol>
                      ) : null}

                      {streamedSummary ? (
                        <p className="ask-answer">{streamedSummary.text}</p>
                      ) : null}

                      <AnswerBlocks blocks={streamedBlocks} streaming />

                      <div className="ask-working">
                        <Spin size="small" />
                        <span>
                          {streamedSummary
                            ? 'Composing the rest of the answer…'
                            : `Grounding the question in ${graph.name} ${graph.version}…`}
                        </span>
                      </div>
                    </div>
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
              ),
            },
            {
              key: 'requirements',
              label: 'Answer requirements',
              children: requirementOptions ? (
                /* The pool is served, so this renders nothing until the list lands: a
                   control offering options the API has not confirmed is the mistake a
                   client-side copy of the consent scopes already made once. */
                <AnswerRequirementsPanel
                  options={requirementOptions}
                  citations={citations}
                  onCitations={setCitations}
                  formatIds={formatIds}
                  onToggleFormat={toggleFormat}
                />
              ) : (
                <Spin />
              ),
            },
          ]}
        />
      )}
    </>
  )
}
