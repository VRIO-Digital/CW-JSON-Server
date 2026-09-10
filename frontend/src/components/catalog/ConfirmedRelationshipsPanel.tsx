import { Button, Empty, Modal, Space, Tooltip } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import {
  confirmedRelationshipsCopy as COPY,
  groupConfirmedByOwner,
  groupCountLabel,
} from '../../data/confirmedRelationships'
import type { DeclaredRelationship } from '../../data/dataModelRelationships'
import { MT } from '../../data/dataModelTokens'
import { joinEnd } from '../../data/pendingSuggestions'
import { ProvenanceBadge } from './ModelMarks'

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
  /** True while a decision is in flight — both acts are writes. */
  deciding?: boolean
  /** Records the row as accepted by the signed-in reader. Offered only where nobody has. */
  onAccept?: (id: string) => void
  /** Removes the declaration and puts the row back with the suggestions, pending. */
  onReject?: (id: string) => void
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
  deciding,
  onAccept,
  onReject,
}: {
  row: DeclaredRelationship
  labelFor: (tableKey: string) => string
  onOpen?: (id: string) => void
  /** True while a decision is in flight, so a row cannot be acted on twice. */
  deciding?: boolean
  onAccept?: (id: string) => void
  onReject?: (id: string) => void
}) {
  const open = onOpen ? () => onOpen(row.id) : undefined
  /* Accept is offered only where nobody has accepted it. Reject stays available either way: it is
     the way back out of a decision, and it is what puts the row into the pending list. */
  const accepted = Boolean(row.confirmedBy)
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
        {/*
          * **One mark reading "Confirmed by you", where there were two.**
          *
          * It was a `confirmed` status pill *and* a short `You` badge — two green marks saying
          * overlapping things about a row where they cannot disagree: a stored declaration is
          * confirmed *because* somebody confirmed it, so `status` and `provenance` are one fact
          * here. Asked for as a single label, and it is the long form of the badge that already
          * existed rather than new copy.
          *
          * **This narrowing stops at the confirmed list.** A pending row keeps both marks, because
          * there the two genuinely differ — `pending review` is the status and `Curated by AI` is
          * where it came from — which is the distinction `ProvenanceBadge` and `StatusPill` are
          * separate components to protect.
          *
          * The kind is still read off the row rather than assumed, so a row can never say
          * something its own field does not.
          */}
        <ProvenanceBadge kind={row.provenance} full />
        <span style={{ flex: 1 }} />
        {/*
          * **The two decisions, on the row.**
          *
          * Asked for here because this is the list where they apply: a relation stored with nobody's
          * name on it is undecided, and the reader needs to be able to say so one row at a time.
          *
          * **The clicks are stopped**, because the row itself is a button into the relationship
          * dialog — without it, accepting would also open that dialog over the list. The same trap
          * the dataset row's upload control fell into, one tab over.
          */}
        <Space size={4} onClick={(e) => e.stopPropagation()}>
          {accepted ? null : (
            <Tooltip title={COPY.acceptNote}>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                disabled={deciding || !onAccept}
                onClick={() => onAccept?.(row.id)}
              >
                {COPY.accept}
              </Button>
            </Tooltip>
          )}
          <Tooltip title={COPY.rejectNote}>
            <Button
              size="small"
              icon={<CloseOutlined />}
              disabled={deciding || !onReject}
              onClick={() => onReject?.(row.id)}
            >
              {COPY.reject}
            </Button>
          </Tooltip>
        </Space>
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
  deciding,
  onAccept,
  onReject,
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
            {/*
             * **Both numbers, labelled, because a bare one collided.** What this group *owns* is
             * what the rows below add up to; the table list and Entity detail count every
             * relationship the table is *involved in*, which is the higher figure. A bare `1` next
             * to a rail reading `2` for the same table read as a miscount — reported as exactly
             * that, and then the labels were reported as unclear, so they say the two words a
             * reader asked for. Never the modal's total: a heading describing a list the reader is
             * not looking at is the fault `ConnectorDirectory` records.
             */}
            <span style={{ fontSize: 10.5, color: MT.dim }}>{groupCountLabel(group)}</span>
          </div>
          <div style={{ fontSize: 10.5, color: MT.dim, lineHeight: 1.45 }}>
            {COPY.ownerNote}
          </div>
          {group.rows.map((row) => (
            <ConfirmedRow
              key={row.id}
              row={row}
              labelFor={labelFor}
              onOpen={onOpen}
              deciding={deciding}
              onAccept={onAccept}
              onReject={onReject}
            />
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
  deciding,
  onAccept,
  onReject,
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
      <ConfirmedRelationshipsPanel
        rows={rows}
        labelFor={labelFor}
        onOpen={onOpen}
        deciding={deciding}
        onAccept={onAccept}
        onReject={onReject}
      />
    </Modal>
  )
}
