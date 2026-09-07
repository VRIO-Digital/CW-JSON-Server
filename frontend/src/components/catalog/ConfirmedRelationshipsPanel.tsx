import { Button, Empty, Modal } from 'antd'
import {
  confirmedRelationshipsCopy as COPY,
  groupConfirmedByOwner,
} from '../../data/confirmedRelationships'
import type { DeclaredRelationship } from '../../data/dataModelRelationships'
import { MT } from '../../data/dataModelTokens'
import { joinEnd } from '../../data/pendingSuggestions'
import { ProvenanceBadge, StatusPill } from './ModelMarks'

/**
 * What this source has been told, all of it, on one surface.
 *
 * **The twin of `PendingSuggestionsPanel`, and it exists because the tile beside it did.** The
 * pending count is a control that opens what it counts; the confirmed count printed the same kind of
 * number and opened nothing, so the one question a reader could not answer from this tab was *what
 * are my nineteen* — Entity detail shows one table's at a time, and the canvas draws them as edges
 * with no list behind it.
 *
 * **The body is exported apart from its `Modal` deliberately.** A `Modal` renders through a portal
 * that `renderToString` will not traverse, so a panel written inside one cannot be asserted at all —
 * the reason `ConnectSourceWizard` is separate from `ConnectSourceModal`. Everything decidable is in
 * `src/data/confirmedRelationships.ts`, one level further out.
 *
 * **It reads the rows it is given and counts nothing of its own.** The tile that opens it and this
 * list are handed the same array, so the number a reader clicks and the number of rows they then
 * count cannot disagree — the rule the pending tile already keeps.
 */

interface ConfirmedRelationshipsPanelProps {
  rows: DeclaredRelationship[]
  /** `table_key` → the short label the canvas and the table list use. */
  labelFor: (tableKey: string) => string
  /**
   * Opens the relationship dialog on this row. Absent leaves the list a reading surface — which is
   * what it is either way: the acts belong to that dialog, and a second Delete here would be a
   * second surface for one write.
   */
  onOpen?: (id: string) => void
}

function ConfirmedRow({
  row,
  labelFor,
  onOpen,
}: {
  row: DeclaredRelationship
  labelFor: (tableKey: string) => string
  onOpen?: (id: string) => void
}) {
  const open = onOpen ? () => onOpen(row.id) : undefined
  return (
    <div
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      onClick={open}
      onKeyDown={(ev) => {
        if (open && (ev.key === 'Enter' || ev.key === ' ')) {
          ev.preventDefault()
          open()
        }
      }}
      style={{
        border: `1px solid ${MT.line}`,
        borderRadius: MT.rS,
        padding: '9px 11px',
        background: MT.card,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        cursor: open ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* The name first, for the reason the pending row puts it first: it is the most informative
            thing on the row, and `HAS_COMPLIANCE_HISTORY` says what the join beneath it does not. */}
        <b
          style={{
            fontFamily: MT.mono,
            fontSize: 11,
            color: MT.text,
            wordBreak: 'break-all',
          }}
        >
          {row.name}
        </b>
        <StatusPill variant="confirmed" icon>
          confirmed
        </StatusPill>
        {/* The relationship's own provenance, which for a stored declaration is always `human` —
            drawn rather than assumed, so a row can never say something its own field does not. */}
        <ProvenanceBadge kind={row.provenance} />
      </div>

      <div style={{ fontFamily: MT.mono, fontSize: 10.5, color: MT.mut }}>
        {joinEnd(labelFor(row.fromTableKey), row.fromColumn)}
        <span style={{ color: MT.dim }}> → </span>
        {joinEnd(labelFor(row.toTableKey), row.toColumn)}
        <span style={{ color: MT.dim }}> · </span>
        <span style={{ color: MT.text }}>{row.cardinality}</span>
      </div>

      {/* What a confirmed row stands on, in words — never a confidence: a declaration is somebody's
          decision, and a score under it would put a classifier behind a person's judgement. */}
      {row.evidence ? (
        <div style={{ fontSize: 10.5, color: MT.mut }}>
          Evidence: <b style={{ color: MT.text }}>{row.evidence}</b>
        </div>
      ) : null}

      {row.rationale ? (
        <div style={{ fontSize: 11, color: MT.mut, lineHeight: 1.45 }}>{row.rationale}</div>
      ) : null}
    </div>
  )
}

export function ConfirmedRelationshipsPanel({
  rows,
  labelFor,
  onOpen,
}: ConfirmedRelationshipsPanelProps) {
  if (rows.length === 0) {
    return (
      <Empty image={null} description={<span style={{ fontSize: 12 }}>{COPY.empty}</span>} />
    )
  }

  const groups = groupConfirmedByOwner(rows)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: MT.mut, lineHeight: 1.5 }}>{COPY.lead}</div>

      {groups.map((group) => (
        <div
          key={group.tableKey}
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <div
            style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}
          >
            <b style={{ fontSize: 11.5, color: MT.text }}>{labelFor(group.tableKey)}</b>
            {/* This group's own length, never the total: a heading describing a list the reader is
                not looking at is the fault `ConnectorDirectory` records. */}
            <span style={{ fontSize: 10.5, color: MT.dim }}>{group.rows.length}</span>
          </div>
          <div style={{ fontSize: 10.5, color: MT.dim, lineHeight: 1.45 }}>
            {COPY.ownerNote}
          </div>
          {group.rows.map((row) => (
            <ConfirmedRow key={row.id} row={row} labelFor={labelFor} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * The dialog around it.
 *
 * **No footer act, unlike the pending dialog.** That one carries *Accept all* because there is a
 * bulk decision to make; there is no bulk act on a stored declaration — deleting nineteen at once is
 * not something anybody asked for and would be the least reversible button in the tab. Close is the
 * only thing here.
 */
export default function ConfirmedRelationshipsModal({
  open,
  rows,
  labelFor,
  onOpen,
  onClose,
}: ConfirmedRelationshipsPanelProps & { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      title={`${COPY.title} · ${rows.length}`}
      onCancel={onClose}
      width={720}
      destroyOnHidden
      footer={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            textAlign: 'left',
          }}
        >
          <span style={{ flex: 1, fontSize: 10.5, color: MT.dim, lineHeight: 1.4 }}>
            {COPY.rowHint}
          </span>
          <Button size="small" onClick={onClose}>
            {COPY.close}
          </Button>
        </div>
      }
    >
      <ConfirmedRelationshipsPanel rows={rows} labelFor={labelFor} onOpen={onOpen} />
    </Modal>
  )
}
