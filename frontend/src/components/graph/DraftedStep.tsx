import { CheckOutlined, EditOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Button, Input } from 'antd'
import { useState, type ReactNode } from 'react'
import type { DraftedItem, Suggestion } from '../../api/client'
import { LlmRunInline } from './LlmRun'
import { SP } from '../../theme'
import '../../pages/NewGraphPage.css'

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
  emptyReason,
  suggesting,
  runStages,
  runCost,
  runCap,
  onSuggest,
  onDismiss,
  onEdit,
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
  /** Why the last draft came back empty, when it did — the server's sentence, or null. */
  emptyReason: string | null
  suggesting: boolean
  /** What the last model call was doing and what it cost, when there was one. */
  runStages: string[]
  runCost?: number
  runCap?: number
  onSuggest: () => void
  onDismiss: (id: string) => void
  /**
   * Correct a suggestion's title and description in the pool it was drafted from.
   *
   * **Absent means the step has no Edit button**, rather than a disabled one: only the metric pool
   * has a write route behind it, and a control that cannot carry out its act is worse than one
   * that is not there — the rule the report Library's four acts already keep. It resolves to
   * whether the write landed, so a refusal (an empty title, a title another metric already has)
   * keeps the row open on what the reader typed instead of closing over a change that was not made.
   */
  onEdit?: (input: {
    id: string
    name: string
    detail: string
  }) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  /*
   * Which suggestion is open for correction, and what has been typed into it. One row at a time:
   * two open editors would be two unsaved drafts of the same pool with nothing saying which the
   * Save button belonged to.
   */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDetail, setEditDetail] = useState('')
  const [saving, setSaving] = useState(false)

  function openEdit(s: Suggestion) {
    setEditingId(s.id)
    setEditName(s.name)
    setEditDetail(s.detail)
  }

  function closeEdit() {
    setEditingId(null)
    setEditName('')
    setEditDetail('')
  }

  async function saveEdit(s: Suggestion) {
    if (!onEdit || !editName.trim() || saving) return
    setSaving(true)
    const result = await onEdit({
      id: s.id,
      name: editName.trim(),
      detail: editDetail.trim(),
    })
    setSaving(false)
    /* A refused write leaves the editor open on what was typed — the page shows the server's
       sentence, and closing the row would hide the text the reader has to correct. */
    if (!result.ok) return
    /*
     * A row already accepted carries a *copy* of the old title, and the accepted list is keyed by
     * name — so without this the reader sees the corrected suggestion still marked Accepted while
     * the list below it holds the name they just replaced.
     */
    onItems(
      items.map((i) =>
        i.name === s.name ? { ...i, name: editName.trim(), description: editDetail.trim() } : i,
      ),
    )
    closeEdit()
  }

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
                ? /*
                   * **The server's sentence, because only it knows which empty this is.** This
                   * read `Nothing matched this brief` for every empty draft — right for a brief
                   * the ranking could not place, and wrong for a domain the tenant has written no
                   * personas or metrics against at all, where it blames the reader's words for a
                   * gap in the pool and sends them to re-word a business need that was never the
                   * problem. CAPEX has two such domains of four. The fallback is the old wording,
                   * for a mock server that predates the field — never a reason composed here.
                   */
                  (emptyReason ?? `Nothing matched this brief — use ${addLabel} instead.`)
                : `No suggestions yet — use ${suggestLabel}.`}
            </span>
          ) : (
            suggestions.map((s) => {
              const added = has(s.name)

              /*
               * The correction form, in the row's own place. Two fields, because a suggestion is
               * two columns: the title and what it means — a metric's calculation, a persona's
               * focus. The description is a textarea rather than an input because one of these is
               * a sixteen-line DAX measure, and a formula in a one-line box cannot be checked
               * against the sheet it came from.
               */
              if (editingId === s.id) {
                return (
                  <div key={s.id} className="ng-suggest-row is-editing">
                    <span className="ng-suggest-edit">
                      <Input
                        autoFocus
                        value={editName}
                        placeholder={namePlaceholder}
                        disabled={saving}
                        onChange={(e) => setEditName(e.target.value)}
                        onPressEnter={() => void saveEdit(s)}
                      />
                      <Input.TextArea
                        value={editDetail}
                        placeholder={descriptionPlaceholder}
                        disabled={saving}
                        autoSize={{ minRows: 2, maxRows: 14 }}
                        onChange={(e) => setEditDetail(e.target.value)}
                      />
                      <span className="ng-suggest-edit-actions">
                        <Button
                          type="primary"
                          size="small"
                          icon={<CheckOutlined />}
                          loading={saving}
                          disabled={!editName.trim()}
                          onClick={() => void saveEdit(s)}
                        >
                          Save
                        </Button>
                        <Button size="small" disabled={saving} onClick={closeEdit}>
                          Cancel
                        </Button>
                        {/* Says where it lands, because unlike Accept and Dismiss this one
                            writes the document every later brief drafts from. */}
                        <span className="ng-suggest-why">
                          Saves to this dataset's metric pool.
                        </span>
                      </span>
                    </span>
                  </div>
                )
              }

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
                      {added ? 'Accepted' : 'Accept'}
                    </Button>
                    {/* Offered only where the pool can be written back — see `onEdit`. */}
                    {onEdit ? (
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        disabled={editingId !== null}
                        onClick={() => openEdit(s)}
                      >
                        Edit
                      </Button>
                    ) : null}
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
