import { CheckOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Button, Input } from 'antd'
import { useState, type ReactNode } from 'react'
import type { DraftedItem, Suggestion } from '../api/client'
import { LlmRunInline } from './LlmRun'
import { SP } from '../theme'
import '../pages/NewGraphPage.css'

/*
 * The shape steps 2 and 3 of New Graph share: let the AI draft a list, add the
 * ones that fit, type your own, and see at a glance which is which.
 *
 * One component rather than two near-identical blocks — the two steps differ
 * only in their copy, and a later step wanting the same pattern should get it
 * without a third copy of this markup.
 */
export default function DraftedStep({
  intro,
  suggestLabel,
  suggestedLabel,
  addLabel,
  namePlaceholder,
  descriptionPlaceholder,
  listLabel,
  listEmptyText,
  hint,
  items,
  onItems,
  suggestions,
  asked,
  suggesting,
  runStages,
  runCost,
  runCap,
  onSuggest,
  onDismiss,
}: {
  intro?: ReactNode
  /** "Suggest personas (LLM)" — also quoted in the empty state. */
  suggestLabel: string
  suggestedLabel: string
  addLabel: string
  namePlaceholder: string
  descriptionPlaceholder: string
  listLabel: string
  listEmptyText: string
  hint?: ReactNode
  items: DraftedItem[]
  onItems: (items: DraftedItem[]) => void
  suggestions: Suggestion[]
  asked: boolean
  suggesting: boolean
  /** What the last model call was doing and what it cost, when there was one. */
  runStages: string[]
  runCost?: number
  runCap?: number
  onSuggest: () => void
  onDismiss: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const has = (candidate: string) =>
    items.some((i) => i.name.toLowerCase() === candidate.trim().toLowerCase())

  function add(item: DraftedItem) {
    if (!item.name.trim() || has(item.name)) return
    onItems([...items, { ...item, name: item.name.trim() }])
  }

  function submit() {
    if (!name.trim()) return
    add({ name, description: description.trim(), source: 'user' })
    setName('')
    setDescription('')
    setAdding(false)
  }

  function cancel() {
    setName('')
    setDescription('')
    setAdding(false)
  }

  return (
    <>
      {intro}

      <Button
        type="primary"
        icon={<ThunderboltOutlined />}
        loading={suggesting}
        onClick={onSuggest}
        style={{ marginBottom: SP.lg }}
      >
        {suggestLabel}
      </Button>

      {suggesting ? (
        <LlmRunInline
          label={`${suggestLabel.replace(/^Suggest/, 'Drafting').replace(/ \(LLM\)$/, '')} with the LLM…`}
          stages={runStages}
          cost={runCost}
          cap={runCap}
        />
      ) : null}

      <div className="ng-field">
        <span className="ng-label">{suggestedLabel}</span>
        <div className="ng-suggest-box">
          {suggestions.length === 0 ? (
            <span className="ng-empty">
              {asked
                ? `Nothing matched this brief — use ${addLabel} instead.`
                : `No suggestions yet — use ${suggestLabel}.`}
            </span>
          ) : (
            suggestions.map((s) => {
              const added = has(s.name)
              return (
                <div key={s.id} className="ng-suggest-row">
                  <span className="ng-suggest-text">
                    <span className="ng-suggest-name">{s.name}</span>
                    <span className="ng-suggest-focus">{s.detail}</span>
                    {/* Never show a suggestion without saying why. */}
                    <span className="ng-suggest-why">{s.why}</span>
                  </span>
                  <span className="ng-suggest-actions">
                    <span className="ng-ai-tag">AI-DRAFTED</span>
                    <Button
                      type="primary"
                      size="small"
                      disabled={added}
                      onClick={() =>
                        // The detail line already describes it — carry it over
                        // rather than making the user retype it.
                        add({ name: s.name, description: s.detail, source: 'ai' })
                      }
                    >
                      {added ? 'Added' : '+ Add'}
                    </Button>
                    <button
                      type="button"
                      className="ng-x"
                      aria-label={`Dismiss ${s.name}`}
                      onClick={() => onDismiss(s.id)}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Adding sits above the list it adds to, at the same button weight as
          the suggester: typing your own is not a lesser path. */}
      <div className="ng-field">
        {adding ? (
          <div className="ng-add-row">
            <Input
              className="ng-pill"
              autoFocus
              value={name}
              placeholder={namePlaceholder}
              onChange={(e) => setName(e.target.value)}
              onPressEnter={submit}
            />
            <Input
              className="ng-pill"
              value={description}
              placeholder={descriptionPlaceholder}
              onChange={(e) => setDescription(e.target.value)}
              onPressEnter={submit}
            />
            <Button
              type="primary"
              icon={<CheckOutlined />}
              disabled={!name.trim()}
              onClick={submit}
            >
              Add
            </Button>
            <button
              type="button"
              className="ng-x"
              aria-label={`Cancel ${addLabel}`}
              onClick={cancel}
            >
              ✕
            </button>
          </div>
        ) : (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
            {addLabel}
          </Button>
        )}
      </div>

      <div className="ng-field">
        <span className="ng-label">{listLabel}</span>
        <div className="ng-suggest-box">
          {items.length === 0 ? (
            <span className="ng-empty">{listEmptyText}</span>
          ) : (
            items.map((i) => (
              <div key={i.name} className="ng-suggest-row">
                <span className="ng-suggest-text">
                  <span className="ng-suggest-name">{i.name}</span>
                  {i.description ? (
                    <span className="ng-suggest-focus">{i.description}</span>
                  ) : null}
                </span>
                <span className="ng-suggest-actions">
                  {/* Provenance stays visible after adding — otherwise a drafted
                      item and a typed one look identical. */}
                  <span className={`ng-ai-tag${i.source === 'user' ? ' is-user' : ''}`}>
                    {i.source === 'ai' ? 'AI-DRAFTED' : 'USER-DRAFTED'}
                  </span>
                  <button
                    type="button"
                    className="ng-x"
                    aria-label={`Remove ${i.name}`}
                    onClick={() => onItems(items.filter((x) => x.name !== i.name))}
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {hint}
    </>
  )
}
