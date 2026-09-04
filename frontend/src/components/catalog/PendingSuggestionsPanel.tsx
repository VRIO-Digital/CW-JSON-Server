import { Alert, Button, Empty, Modal, Space, Tooltip } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import { MT } from '../../data/dataModelTokens'
import {
  confidenceLabel,
  evidenceKindLabel,
  type DeclaredRelationship,
} from '../../data/dataModelRelationships'
import {
  groupPendingByKind,
  joinEnd,
  pendingSuggestionsCopy as COPY,
} from '../../data/pendingSuggestions'
import { ProvenanceBadge, StatusPill } from './ModelMarks'

/**
 * What is waiting for a decision, and one act that clears all of it.
 *
 * **The body is exported apart from its `Modal` deliberately.** A `Modal` renders through a portal
 * that `renderToString` will not traverse, so a panel written inside one cannot be asserted at all —
 * the reason `ConnectSourceWizard` is separate from `ConnectSourceModal`. Everything decidable here
 * is in `src/data/pendingSuggestions.ts` for the same reason, one level further out.
 *
 * **It reads the rows it is given and counts nothing of its own.** The tile that opens it and this
 * list are handed the same filtered array, so the number on the tile and the number of rows here
 * cannot disagree — there is no second count to keep in step.
 */

interface PendingSuggestionsPanelProps {
  rows: DeclaredRelationship[]
  /** `table_key` → the short label the canvas and the table list use. */
  labelFor: (tableKey: string) => string
  accepting: boolean
  /** Absent while a run is in flight, so a row cannot be acted on twice. */
  onAccept?: (id: string) => void
  onReject?: (id: string) => void
}

function SuggestionRow({
  row,
  labelFor,
  accepting,
  onAccept,
  onReject,
}: {
  row: DeclaredRelationship
  labelFor: (tableKey: string) => string
  accepting: boolean
  onAccept?: (id: string) => void
  onReject?: (id: string) => void
}) {
  return (
    <div
      style={{
        border: `1px solid ${MT.line}`,
        borderRadius: MT.rS,
        padding: '9px 11px',
        background: MT.card,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        {/*
         * The name first, because it is the most informative thing on the row — the correction made
         * when recorded suggestions arrived carrying names like `HAS_COMPLIANCE_HISTORY`, where a
         * row printing only "pending" made the reviewer open a dialog to find out what they were
         * being asked about.
         */}
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
        <StatusPill variant="suggested">pending review</StatusPill>
        <ProvenanceBadge kind={row.provenance} />
        <span style={{ flex: 1 }} />
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            icon={<CheckOutlined />}
            disabled={accepting || !onAccept}
            onClick={() => onAccept?.(row.id)}
          >
            Confirm
          </Button>
          {/*
           * "Reject" rather than "Delete", and the two are deliberately different words on
           * different controls: nothing here is stored yet, so this drops local state where Delete
           * on a confirmed row is a write.
           */}
          <Tooltip title="Drops this suggestion from the run. Nothing is stored, so nothing is deleted.">
            <Button
              size="small"
              icon={<CloseOutlined />}
              disabled={accepting || !onReject}
              onClick={() => onReject?.(row.id)}
            >
              Reject
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

      {/*
       * The evidence and the confidence are labelled by kind, because the same 0.61 means two
       * things: a derived row's is the classifier's score for the weaker column it matched on, a
       * recorded row's is an opinion written down beside it.
       */}
      {row.evidenceKind || row.confidence !== undefined ? (
        <div style={{ fontSize: 10.5, color: MT.mut }}>
          {row.evidenceKind ? (
            <b style={{ color: MT.text }}>{evidenceKindLabel(row.evidenceKind)}</b>
          ) : null}
          {row.evidenceKind && row.confidence !== undefined ? ' · ' : null}
          {row.confidence !== undefined
            ? `${confidenceLabel(row)}: ${row.confidence.toFixed(2)}`
            : null}
        </div>
      ) : null}

      {row.suggestionReasoning ? (
        <div style={{ fontSize: 11, color: MT.mut, lineHeight: 1.45 }}>
          {row.suggestionReasoning}
        </div>
      ) : null}
    </div>
  )
}

export function PendingSuggestionsPanel({
  rows,
  labelFor,
  accepting,
  onAccept,
  onReject,
}: PendingSuggestionsPanelProps) {
  if (rows.length === 0) {
    return (
      <Empty
        image={null}
        description={<span style={{ fontSize: 12 }}>{COPY.empty}</span>}
      />
    )
  }

  const { recorded, derived } = groupPendingByKind(rows)
  const sections: [string, string, DeclaredRelationship[]][] = [
    ['Recorded in this dataset', COPY.kindNote.recorded, recorded],
    ['Curated by AI', COPY.kindNote.derived, derived],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: MT.mut, lineHeight: 1.5 }}>{COPY.lead}</div>

      {sections.map(([heading, note, list]) =>
        /* A kind with nothing in it draws no heading — the rule `connectorPickerNote` keeps for an
           empty group, and the reason a heading over empty space reads as a failed load. */
        list.length === 0 ? null : (
          <div key={heading} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <b style={{ fontSize: 11.5, color: MT.text }}>{heading}</b>
              {/* The count is this section's own length, never a served total: a heading describing
                  a list the reader is not looking at is the fault `ConnectorDirectory` records. */}
              <span style={{ fontSize: 10.5, color: MT.dim }}>{list.length}</span>
            </div>
            <div style={{ fontSize: 10.5, color: MT.dim, lineHeight: 1.45 }}>{note}</div>
            {list.map((row) => (
              <SuggestionRow
                key={row.id}
                row={row}
                labelFor={labelFor}
                accepting={accepting}
                onAccept={onAccept}
                onReject={onReject}
              />
            ))}
          </div>
        ),
      )}
    </div>
  )
}

/**
 * The dialog around it.
 *
 * `Accept all` sits in the footer with the sentence that says what it does, because a run of nine
 * writes that stops at the fourth is the outcome a reader has to be able to expect — stated before
 * the click rather than explained after it.
 */
export default function PendingSuggestionsModal({
  open,
  rows,
  labelFor,
  accepting,
  onAcceptAll,
  onAccept,
  onReject,
  onClose,
}: PendingSuggestionsPanelProps & {
  open: boolean
  onAcceptAll: () => void
  onClose: () => void
}) {
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
            {COPY.acceptAllNote}
          </span>
          <Space size={8}>
            <Button size="small" onClick={onClose} disabled={accepting}>
              {COPY.close}
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              loading={accepting}
              disabled={rows.length === 0}
              onClick={onAcceptAll}
            >
              {accepting ? COPY.accepting : `${COPY.acceptAll} · ${rows.length}`}
            </Button>
          </Space>
        </div>
      }
    >
      {accepting ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 10 }}
          message="Confirming one relationship at a time. Each write hands the server a whole entity, so they cannot go in parallel."
        />
      ) : null}
      <PendingSuggestionsPanel
        rows={rows}
        labelFor={labelFor}
        accepting={accepting}
        onAccept={onAccept}
        onReject={onReject}
      />
    </Modal>
  )
}
