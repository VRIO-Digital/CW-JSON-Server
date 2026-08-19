import { ArrowUpOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { Button, Input, Select, Spin, Tabs, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import AnswerBlocks from '../components/ask/AnswerBlocks'
// Commented with the tab it renders — see the note beside the hooks below.
// import AnswerRequirementsPanel from '../components/ask/AnswerRequirementsPanel'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import AskAnswerView from '../components/ask/AskAnswerView'
import AskChatRail from '../components/ask/AskChatRail'
import NoPublishedGraph from '../components/common/NoPublishedGraph'
import PageHeader from '../components/common/PageHeader'
import {
  selectActiveChat,
  selectAskGraphs,
  selectChats,
  selectCurrentGraph,
  // selectCitations and selectRequirementOptions are the Answer requirements tab's, and
  // commented with it. They are still exported and still the single definitions.
  useAskStore,
} from '../store/askStore'
import { useAuthStore } from '../store/authStore'
import type { AskTurn } from '../data/askChats'
import './AskPage.css'

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toISOString().slice(0, 10) : null

/** Stable reference for a thread with nothing in it yet. */
const EMPTY_TURNS: AskTurn[] = []

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
  /*
   * The history panel starts **shut**, so the thread has the whole width — an answer's charts
   * and tables are what the page is for, and a 260px column standing open to show a list a
   * reader consults occasionally costs them a quarter of it. The toggle carries the count, so
   * nothing is hidden without a trace. Page state rather than the store's: this is which
   * furniture is open, not anything about the conversation.
   */
  const [historyOpen, setHistoryOpen] = useState(false)

  const data = useAskStore((s) => s.data)
  const loading = useAskStore((s) => s.loading)
  const error = useAskStore((s) => s.error)
  const asking = useAskStore((s) => s.asking)
  /* The question in flight. Held in the store rather than here, because the thread it
     belongs to is the store's: two places holding "what was just asked" is how the
     streaming turn ends up under the wrong question. */
  const askedNow = useAskStore((s) => s.askedNow)
  const useCaseId = useAskStore((s) => s.useCaseId)
  const load = useAskStore((s) => s.load)
  const select = useAskStore((s) => s.select)
  const ask = useAskStore((s) => s.ask)

  /* The conversation: this session's chats, and the turns of the one on screen. */
  const chats = useAskStore(selectChats)
  const activeChat = useAskStore(selectActiveChat)
  /* Oldest first: a conversation reads down the page. `EMPTY_TURNS` is module-level so an
     empty thread hands out the same reference every render, the rule every selector here
     follows. */
  const turns = activeChat?.turns ?? EMPTY_TURNS
  const activeChatId = useAskStore((s) => s.activeChatId)
  const newChat = useAskStore((s) => s.newChat)
  const openChat = useAskStore((s) => s.openChat)
  const deleteChat = useAskStore((s) => s.deleteChat)
  const clearHistory = useAskStore((s) => s.clearHistory)
  const syncHistory = useAskStore((s) => s.syncHistory)
  /* Whose history it is. The identity is client-held, so the *store* reads it at call time
     and the page only has to notice when it changes. */
  const signedInAs = useAuthStore((s) => s.identity?.email ?? null)
  const graphs = useAskStore(selectAskGraphs)
  const graph = useAskStore(selectCurrentGraph)
  /*
   * The Answer requirements tab is **switched off** — the tab item is commented out at the
   * bottom of this file, and these five hooks are commented with it because
   * `noUnusedLocals` fails the build over a binding nothing reads.
   *
   * Nothing behind it was removed: the panel, the served pool, `POST /ask`'s `citations` and
   * `formats` and the per-answer `requirements` verdict are all still there, and every answer
   * is asked with the **served default** (`required`) while this is off. Uncommenting both
   * blocks is the whole of turning it back on.
   *
   * The pool is served and `selectCitations` is the one place the effective value is decided,
   * so the control could not show one value while the request carried another.
   */
  // const requirementOptions = useAskStore(selectRequirementOptions)
  // const citations = useAskStore(selectCitations)
  // const formatIds = useAskStore((s) => s.formatIds)
  // const setCitations = useAskStore((s) => s.setCitations)
  // const toggleFormat = useAskStore((s) => s.toggleFormat)
  // Selected one at a time: a block arriving must not re-render the picker.
  const streamedSteps = useAskStore((s) => s.streamedSteps)
  const streamedBlocks = useAskStore((s) => s.streamedBlocks)
  const streamedSummary = useAskStore((s) => s.streamedSummary)
  /* The server said how many paragraphs are coming; the shimmers are the ones still out. */
  const streamedBlockCount = useAskStore((s) => s.streamedBlockCount)

  useEffect(() => {
    void load()
  }, [load])

  /*
   * Re-read the history whenever the signed-in address changes.
   *
   * The chats live under a key that includes the address, so signing in as somebody else
   * must not leave the previous reader's questions on screen — and the previous reader's
   * chats are still theirs, under their own key, for as long as the tab lives.
   */
  useEffect(() => {
    syncHistory()
  }, [signedInAs, syncHistory])

  async function onAsk(text: string) {
    if (!text.trim()) {
      message.warning('Ask a question first.')
      return
    }
    // Cleared here, so the box is empty while the answer streams — the text is echoed
    // above the streaming reply from the store's `askedNow` rather than disappearing.
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
              label: 'Chat',
              children: (
            <div className="ask-shell">
              {/* New chat, and this session's history. Its own component: a list behind a
                  page's state cannot be asserted on. */}
              <AskChatRail
                chats={chats}
                activeChatId={activeChatId}
                asking={asking}
                collapsed={!historyOpen}
                onToggle={() => setHistoryOpen((open) => !open)}
                onNewChat={() => {
                  newChat()
                  /* Starting a thread is the one act that closes the panel behind itself: the
                     next thing the reader does is type, and the width belongs to that. */
                  setHistoryOpen(false)
                }}
                onOpen={(chatId) => {
                  openChat(chatId)
                  /* Same reason: picking a thread means reading it, and reading wants the
                     width. The panel is a step away, not a place to stay. */
                  setHistoryOpen(false)
                }}
                onDelete={deleteChat}
                onClear={clearHistory}
              />

              <div className="ask-main">
                <div className="ask-thread">
                  {/*
                   * The thread: one turn per question, oldest first, the way a conversation
                   * reads. Before this, Ask kept a single `answer` and replaced it — so the
                   * question before last was simply gone, and there was nothing for a history
                   * to be a history *of*.
                   */}
                  {turns.map((turn) => (
                    <div className="ask-turn" key={turn.turnId}>
                      <div className="ask-asked">
                        <QuestionCircleOutlined aria-hidden="true" />
                        <span>{turn.question}</span>
                      </div>
                      {turn.answer ? <AskAnswerView answer={turn.answer} /> : null}
                    </div>
                  ))}

                  {turns.length === 0 && !asking ? (
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
                  ) : null}

                  {/*
                    The answer as it composes — the agent working, in its own words.

                    Every line here has already arrived from the server: the stages it took,
                    then the summary, then each block, paced between the pieces
                    (`ASK_STAGE_MS`, `ASK_BLOCK_MS`) so a five-block answer legitimately takes
                    longer than a one-line abstention. Nothing is animated ahead of the
                    response — the same distinction the consent panel draws between a stage and
                    a timer, applied to one streaming call. A stage appears because a stage
                    happened.
                  */}
                  {asking ? (
                    <div className="ask-turn is-streaming">
                      <div className="ask-asked">
                        <QuestionCircleOutlined aria-hidden="true" />
                        <span>{askedNow}</span>
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

                        {/* One shimmer per paragraph the summary promised and the stream has
                            not delivered yet — a paragraph lands every 5s, and an empty gap
                            that long reads as a page that stopped. */}
                        <AnswerBlocks
                          blocks={streamedBlocks}
                          streaming
                          pending={streamedBlockCount - streamedBlocks.length}
                        />

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
                   *
                   * Hidden once a thread is under way: they are a starting point, and a
                   * standing row of openers under a conversation reads as the app not having
                   * noticed it began.
                   */}
                  {graph.suggestedQuestions.length > 0 && turns.length === 0 ? (
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
            </div>
              ),
            },
            // {
            //   key: 'requirements',
            //   label: 'Answer requirements',
            //   children: requirementOptions ? (
            //     /* The pool is served, so this renders nothing until the list lands: a
            //        control offering options the API has not confirmed is the mistake a
            //        client-side copy of the consent scopes already made once. */
            //     <AnswerRequirementsPanel
            //       options={requirementOptions}
            //       citations={citations}
            //       onCitations={setCitations}
            //       formatIds={formatIds}
            //       onToggleFormat={toggleFormat}
            //     />
            //   ) : (
            //     <Spin />
            //   ),
            // },
          ]}
        />
      )}
    </>
  )
}
