import { CheckOutlined, CloseOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Button, Checkbox, Input } from 'antd'
import { useState } from 'react'
import type { HeroQuestion, Suggestion } from '../api/client'
import { LlmRunInline } from './LlmRun'
import { SP } from '../theme'
import '../pages/NewGraphPage.css'

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
  suggestions,
  asked,
  suggesting,
  runStages,
  runCost,
  runCap,
  onSuggest,
  onDismiss,
}: {
  questions: HeroQuestion[]
  onQuestions: (questions: HeroQuestion[]) => void
  suggestions: Suggestion[]
  asked: boolean
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

  function add(question: HeroQuestion) {
    if (!question.text.trim() || has(question.text)) return
    onQuestions([...questions, { ...question, text: question.text.trim() }])
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
                ? 'Nothing matched this brief — write your own below.'
                : 'No suggestions yet — use Suggest questions (LLM).'}
            </span>
          ) : (
            suggestions.map((s) => {
              const added = has(s.name)
              return (
                <div key={s.id} className="ng-question">
                  <div className="ng-question-text">{s.name}</div>
                  <div className="ng-question-foot">
                    <span className="ng-ai-tag">AI-DRAFTED</span>
                    <Checkbox
                      checked={Boolean(highMarks[s.id])}
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
                          priority: highMarks[s.id] ? 'high' : 'normal',
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
                      onQuestions(
                        questions.map((x) =>
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
                      onQuestions(questions.filter((x) => x.text !== q.text))
                    }
                  >
                    ✕
                  </button>
                </span>
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
