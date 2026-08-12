import { Button, Card, Tag } from 'antd'
import { useState } from 'react'
import type { AuthRole, SavedReport } from '../api/client'
import AudiencePicker from './AudiencePicker'
import '../pages/ReportsPage.css'

/*
 * One report someone composed and kept.
 *
 * A card rather than a row, because it is the same kind of thing as a written report — and it
 * carries what a saved report *is*: the question, the frame it was asked under, who kept it and
 * when, the graph that answered it, and **who it is for** — the last of those through
 * `AudiencePicker`, which is its own component because it renders behind this card's one
 * `useState` and could not otherwise be asserted on.
 */
export default function SavedReportCard({
  saved,
  roles,
  onOpen,
  onEdit,
  onRemove,
  onAudience,
  busy,
}: {
  saved: SavedReport
  /** Every role this tenant has, for the checklist. */
  roles: AuthRole[]
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
  /** Called with the full set of role ids that may view it. */
  onAudience: (roleIds: string[]) => void
  busy?: boolean
}) {
  const [audienceOpen, setAudienceOpen] = useState(false)
  const chosen = saved.viewerRoles.map((r) => r.roleId)
  const everyRole = roles.length > 0 && chosen.length === roles.length

  /* A click anywhere on the card opens it, so every control inside stops the event — a
     checkbox that also navigated away would be a control nobody could use. */
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return (
    <Card
      className="rp-saved"
      onClick={onOpen}
      title={
        <div className="rp-saved-head">
          <span className="rp-saved-tag">
            <Tag className="rp-chip">{saved.reportTag}</Tag>
          </span>
          <span className="rp-saved-name">{saved.name}</span>
        </div>
      }
    >
      {saved.question ? <p className="rp-saved-q">{saved.question}</p> : null}

      {/* The frame, which is all a saved report stores. */}
      <div className="rp-chips rp-saved-frame">
        <Tag className="rp-chip">{saved.scopeLabel}</Tag>
        <Tag className="rp-chip">by {saved.measureLabel}</Tag>
        <Tag className="rp-chip">{saved.horizonLabel}</Tag>
        {saved.filters.map((f) => (
          <Tag key={f.key} className="rp-chip">
            {f.label}: {f.valueLabel}
          </Tag>
        ))}
      </div>

      {/*
       * Its provenance, as a two-column list so the labels line up down the card rather than
       * running together in one grey sentence.
       */}
      <dl className="rp-saved-meta">
        <dt>Saved by</dt>
        <dd>
          {saved.savedBy ?? 'unknown'} · {new Date(saved.savedAt).toLocaleString()}
        </dd>
        {saved.graph ? (
          <>
            <dt>Asked of</dt>
            <dd>
              {saved.graph.name}
              {saved.graph.version ? ` ${saved.graph.version}` : ''}
              {saved.graph.live ? '' : ' — not published now'}
            </dd>
          </>
        ) : null}
        <dt>Visible to</dt>
        <dd>
          {everyRole
            ? 'every role'
            : saved.viewerRoles.map((r) => r.label).join(', ') || 'no role'}
        </dd>
      </dl>

      {/*
       * One action row, in the order they are reached for: open it, then decide who sees it,
       * then change it, then be rid of it. `Open` is the primary because the card is a way in;
       * `Remove` is a quiet danger button, so the destructive one is neither loud nor hidden.
       */}
      <div className="rp-saved-foot">
        <Button size="small" type="primary" onClick={stop(onOpen)}>
          Open
        </Button>
        <Button
          size="small"
          onClick={stop(() => setAudienceOpen((open) => !open))}
          aria-expanded={audienceOpen}
        >
          Who can view
        </Button>
        <Button size="small" onClick={stop(onEdit)}>
          Edit
        </Button>
        <Button
          size="small"
          type="text"
          danger
          className="rp-saved-remove"
          onClick={stop(onRemove)}
          aria-label={`Remove ${saved.name}`}
        >
          Remove
        </Button>
      </div>

      {audienceOpen ? (
        /* The click guard stays here: the whole card opens the report, and a checkbox that also
           navigated away would be a control nobody could use. */
        <div onClick={(e) => e.stopPropagation()}>
          <AudiencePicker roles={roles} chosen={chosen} onChange={onAudience} busy={busy} />
        </div>
      ) : null}
    </Card>
  )
}
