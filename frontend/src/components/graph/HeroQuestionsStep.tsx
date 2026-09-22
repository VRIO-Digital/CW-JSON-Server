import { CheckOutlined, CloseOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Button, Checkbox, Input } from 'antd'
import { useState } from 'react'
import type { HeroQuestion, Suggestion } from '../../api/client'
import { LlmRunInline } from './LlmRun'
import { SP } from '../../theme'
import '../../pages/NewGraphPage.css'

/*
 * Step 5 of New Graph: the questions this graph exists to answer.
 *
 * Not a `DraftedStep`: a hero question is one long sentence, not a name plus a
 * description, and it carries a High flag rather than a second text field. High
 * is what makes it the graph's contract, so the checkbox sits on the suggestion
 * too — you decide it as you accept it, not afterwards.
 */
export default function HeroQuestionsStep({
  questions,
  onQuestions,
  onWriteSql,
  suggestions,
  asked,
  emptyReason,
  suggesting,
  runStages,
  runCost,
  runCap,
  onSuggest,
  onDismiss,
}: {
  questions: HeroQuestion[]
  /**
   * Set the list, or update it from what it currently is.
   *
   * **The updater form is not a convenience here, it is the fix for a real bug.** Composing a query
   * is asynchronous and paced, so the reply lands a second after the question was added — and a
   * handler that closed over `questions` wrote back the array as it stood *before* the add, which
   * deleted the question it was meant to be filling in. Both symptoms at once: nothing added, and no
   * SQL. The page passes React's own setter, so `(prev) => …` is always applied to what is there now.
   */
  onQuestions: (
    questions: HeroQuestion[] | ((previous: HeroQuestion[]) => HeroQuestion[]),
  ) => void
  /**
   * Compose the query for one question.
   *
   * Passed in rather than called here for the reason the suggester is: what this tenant's schema
   * holds is the page's to ask about, and a step that fetched for itself would be a second place
   * deciding which use case is open. Resolves to the query, or to `null` where nothing matched.
   *
   * **This step no longer shows what it resolves to — removed on request — and still calls it.**
   * A saved hero question's `sql` is read directly by Graph Studio's Playground ("Golden
   * Queries"), never re-composed there, so dropping this call along with the box would leave
   * every question this step adds with no query for that tab to show: a silent regression on a
   * screen this component never renders. So composing on add stays exactly as before; only the
   * reader's own view of the result, and the ability to edit or regenerate it here, are gone.
   */
  onWriteSql: (question: string) => Promise<{ sql: string | null; reason: string | null }>
  suggestions: Suggestion[]
  asked: boolean
  /** Why the last draft came back empty, when it did — the server's sentence, or null. */
  emptyReason: string | null
  suggesting: boolean
  runStages: string[]
  runCost?: number
  runCap?: number
  onSuggest: () => void
  onDismiss: (id: string) => void
}) {
  /** High marks staged per suggestion, before it is added. */
  const [highMarks, setHighMarks] = useState<Record<string, boolean>>({})
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftHigh, setDraftHigh] = useState(false)

  const has = (text: string) =>
    questions.some((q) => q.text.toLowerCase() === text.trim().toLowerCase())

  /**
   * Compose the query for one question and put it on the row — silently, for the Playground to
   * read later. See `onWriteSql` above for why this still runs with no box left to show it.
   *
   * **Matched to the row by its text**, which is what identifies a question here — the list is keyed
   * on it and a question is refused as a duplicate on it. Re-read from the callback's own argument
   * rather than closed over, so a compose that lands after the reader edited something else cannot
   * write onto the wrong row.
   */
  async function writeSql(text: string) {
    const out = await onWriteSql(text)
    /* From what the list is *now*, never from what it was when this started — the reply lands a
       second later, and by then the reader may have added another question or the add that
       triggered this may not have been in the array this closure captured. */
    onQuestions((previous) =>
      previous.map((q) => (q.text === text ? { ...q, sql: out.sql } : q)),
    )
  }

  function add(question: HeroQuestion) {
    if (!question.text.trim() || has(question.text)) return
    const text = question.text.trim()
    onQuestions((previous) => [...previous, { ...question, text }])
    /* Composed on add rather than behind a second click: a reader who has just accepted a question
       has already asked for it, and an empty box under every new row would read as a feature that
       did not run. Regenerate is for changing their mind, not for starting. */
    void writeSql(text)
  }

  function submit() {
    if (!draft.trim()) return
    add({
      text: draft,
      priority: draftHigh ? 'high' : 'normal',
      source: 'user',
    })
    setDraft('')
    setDraftHigh(false)
    setAdding(false)
  }

  function cancel() {
    setDraft('')
    setDraftHigh(false)
    setAdding(false)
  }

  return (
    <>
      <div className="ng-ai">
        <span className="ng-ai-mark" aria-hidden="true">
          ✦
        </span>
        <div>
          <strong>Let the AI draft the hero questions this graph should answer.</strong>
          <div className="ng-ai-sub">
            Suggested from your connected data and domain. Mark the ones that matter
            most as High — these become the graph’s contract.
          </div>
        </div>
      </div>

      <Button
        type="primary"
        icon={<ThunderboltOutlined />}
        loading={suggesting}
        onClick={onSuggest}
        style={{ marginBottom: SP.lg }}
      >
        Suggest questions (LLM)
      </Button>

      {suggesting ? (
        <LlmRunInline
          label="Drafting hero questions with the LLM…"
          stages={runStages}
          cost={runCost}
          cap={runCap}
        />
      ) : null}

      <div className="ng-field">
        <span className="ng-label">Suggested questions</span>
        <div className="ng-suggest-box">
          {suggestions.length === 0 ? (
            <span className="ng-empty">
              {asked
                ? /* The server's sentence: it is the only side that knows whether this dataset
                     has any hero questions on this domain at all, and "nothing matched this
                     brief" blames the reader's words when it does not. */
                  (emptyReason ?? 'Nothing matched this brief — write your own below.')
                : 'No suggestions yet — use Suggest questions (LLM).'}
            </span>
          ) : (
            suggestions.map((s) => {
              const added = has(s.name)
              /*
               * A use case that named this question already said whether it is
               * High, so the box arrives ticked rather than making the user
               * re-derive it. An explicit tick or untick still wins — `??`
               * falls through on absence, not on `false`.
               */
              const high = highMarks[s.id] ?? s.priority === 'high'
              return (
                <div key={s.id} className="ng-question">
                  <div className="ng-question-text">{s.name}</div>
                  {/*
                    The same two lines `DraftedStep` gives a persona: what the
                    question is *for*, then why it was drafted. This step showed
                    neither, so a drafted question arrived unexplained while
                    personas and metrics beside it did not — and the brief states a
                    reason for every one of its questions.
                  */}
                  {s.detail ? (
                    <div className="ng-question-detail">{s.detail}</div>
                  ) : null}
                  <div className="ng-question-why">{s.why}</div>
                  <div className="ng-question-foot">
                    <span className="ng-ai-tag">AI-DRAFTED</span>
                    <Checkbox
                      checked={high}
                      disabled={added}
                      onChange={(e) =>
                        setHighMarks({ ...highMarks, [s.id]: e.target.checked })
                      }
                    >
                      High
                    </Checkbox>
                    <Button
                      type="primary"
                      size="small"
                      disabled={added}
                      onClick={() =>
                        add({
                          text: s.name,
                          priority: high ? 'high' : 'normal',
                          source: 'ai',
                        })
                      }
                    >
                      {added ? 'Added' : '+ Add'}
                    </Button>
                    <button
                      type="button"
                      className="ng-x"
                      aria-label={`Dismiss: ${s.name}`}
                      onClick={() => onDismiss(s.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="ng-field">
        <span className="ng-label">Your questions</span>
        <div className="ng-suggest-box">
          {questions.length === 0 ? (
            <span className="ng-empty">
              No questions yet — add one below, or use Suggest questions (LLM).
            </span>
          ) : (
            questions.map((q) => (
              <div key={q.text} className="ng-question is-added">
                {q.priority === 'high' ? (
                  <span className="ng-high-badge">HIGH</span>
                ) : null}
                <span className="ng-question-added-text">{q.text}</span>
                <span className="ng-question-actions">
                  <span
                    className={`ng-ai-tag${q.source === 'user' ? ' is-user' : ''}`}
                  >
                    {q.source === 'ai' ? 'AI-DRAFTED' : 'USER'}
                  </span>
                  {/* High stays editable after adding — the contract is the last
                      thing anyone gets right first time. */}
                  <Checkbox
                    checked={q.priority === 'high'}
                    onChange={(e) =>
                      onQuestions((previous) =>
                        previous.map((x) =>
                          x.text === q.text
                            ? { ...x, priority: e.target.checked ? 'high' : 'normal' }
                            : x,
                        ),
                      )
                    }
                  >
                    High
                  </Checkbox>
                  <button
                    type="button"
                    className="ng-x"
                    aria-label={`Remove: ${q.text}`}
                    onClick={() =>
                      onQuestions((previous) => previous.filter((x) => x.text !== q.text))
                    }
                  >
                    ✕
                  </button>
                </span>
                {/*
                  * **No SQL box here — removed on request.** The query is still composed on add and
                  * carried on the question (`onWriteSql`'s own comment says why); this step simply no
                  * longer shows or edits it, which is what took the "SQL" label, the regenerate
                  * control and the textarea with it.
                  */}
              </div>
            ))
          )}

          {adding ? (
            <div className="ng-question-add">
              <Checkbox
                checked={draftHigh}
                onChange={(e) => setDraftHigh(e.target.checked)}
              >
                High
              </Checkbox>
              <Input
                className="ng-pill"
                autoFocus
                value={draft}
                placeholder="e.g. Which sites are nearing their LQG threshold this quarter?"
                onChange={(e) => setDraft(e.target.value)}
                onPressEnter={submit}
              />
              <Button
                type="primary"
                icon={<CheckOutlined />}
                disabled={!draft.trim()}
                onClick={submit}
              >
                Add
              </Button>
              <Button
                shape="circle"
                icon={<CloseOutlined />}
                aria-label="Cancel adding a question"
                onClick={cancel}
              />
            </div>
          ) : (
            <div className="ng-question-add">
              <Button type="primary" onClick={() => setAdding(true)}>
                + Add question
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="ng-hint">
        <span aria-hidden="true">✦</span>
        <span>
          The High ones become the graph’s contract — what it must be able to answer
          to be considered built. Everything else is a nice-to-have.
        </span>
      </div>
    </>
  )
}
