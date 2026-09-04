import { DeleteOutlined } from '@ant-design/icons'
import { Button, Popconfirm, Typography } from 'antd'
import type { ModelEntity } from '../../api/client'
import {
  evidenceKindLabel,
  type DeclaredRelationship,
} from '../../data/dataModelRelationships'
import { MT } from '../../data/dataModelTokens'
import { entityForTable, type ModelTable } from '../../store/dataModelStore'
import { ProvenanceBadge, StatusPill } from './ModelMarks'

const { Text } = Typography

interface EntityRelationshipsPanelProps {
  table: ModelTable
  tables: ModelTable[]
  entities: ModelEntity[]
  relationships: DeclaredRelationship[]
  onOpen: (relationshipId: string) => void
  onCreate: () => void
  /** Deletes a confirmed declaration from its own row; a suggestion is rejected in the dialog. */
  onDelete: (relationshipId: string) => void
}

const nameFor = (tableKey: string, tables: ModelTable[], entities: ModelEntity[]) => {
  const table = tables.find((t) => t.tableKey === tableKey)
  if (!table) return tableKey
  return entityForTable(entities, tableKey)?.entity_name ?? table.tableId
}

/**
 * The Relationships sub-tab: every relationship touching this table, either side.
 *
 * A row opens the same dialog a click on the canvas edge opens, because there is one relationship
 * behind both — three surfaces reading one list rather than three lists.
 *
 * **Delete lives on a confirmed row only.** A suggestion has not been written anywhere, so removing
 * it is *Reject* in the dialog rather than a delete: one is dropping local state and the other is a
 * write, and offering the same word for both would promise the wrong thing on one of them.
 */
export default function EntityRelationshipsPanel({
  table,
  tables,
  entities,
  relationships,
  onOpen,
  onCreate,
  onDelete,
}: EntityRelationshipsPanelProps) {
  const relevant = relationships.filter(
    (r) => r.fromTableKey === table.tableKey || r.toTableKey === table.tableKey,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {relevant.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          No relationships declared or suggested yet for this entity.
        </Text>
      ) : null}
      {relevant.map((r) => {
        const otherKey = r.fromTableKey === table.tableKey ? r.toTableKey : r.fromTableKey
        const confirmed = r.status === 'confirmed'
        const isFrom = table.tableKey === r.fromTableKey
        return (
          <div
            key={r.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(r.id)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault()
                onOpen(r.id)
              }
            }}
            style={{
              border: `1px solid ${confirmed ? MT.line : 'rgba(251,191,36,.4)'}`,
              background: confirmed ? MT.card : MT.amberSoft,
              borderRadius: MT.rM,
              padding: '10px 12px',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <ProvenanceBadge kind={confirmed ? 'human' : 'derived'} full />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <StatusPill variant={confirmed ? 'mut' : 'suggested'}>
                  {confirmed ? r.name : 'pending review'}
                </StatusPill>
                {confirmed ? (
                  <Popconfirm
                    title="Delete this relationship?"
                    description="Any metric built on it goes with it — a metric whose relationship is gone has no columns to resolve."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    onConfirm={(ev) => {
                      /* A popover's clicks bubble through the React tree into the row's own
                         onClick — stopped so confirming never also opens the dialog. */
                      ev?.stopPropagation()
                      onDelete(r.id)
                    }}
                    onCancel={(ev) => ev?.stopPropagation()}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      aria-label="Delete relationship"
                      icon={<DeleteOutlined />}
                      onClick={(ev) => ev.stopPropagation()}
                      onKeyDown={(ev) => ev.stopPropagation()}
                    />
                  </Popconfirm>
                ) : null}
              </div>
            </div>
            <div
              style={{ marginTop: 6, fontFamily: MT.mono, fontSize: 12, color: MT.text }}
            >
              <span style={{ color: MT.orangeHi, fontWeight: 700 }}>
                {nameFor(table.tableKey, tables, entities)}
              </span>
              .{isFrom ? r.fromColumn : r.toColumn}
              <span style={{ color: MT.dim }}> = </span>
              <span style={{ color: MT.orangeHi, fontWeight: 700 }}>
                {nameFor(otherKey, tables, entities)}
              </span>
              .{isFrom ? r.toColumn : r.fromColumn}
            </div>
            {confirmed && r.rationale ? (
              <div style={{ marginTop: 4, fontSize: 11.5, color: MT.mut }}>
                {r.rationale}
              </div>
            ) : null}
            {!confirmed && r.suggestionReasoning ? (
              <div style={{ marginTop: 4, fontSize: 11.5, color: MT.mut }}>
                <b style={{ color: MT.text }}>Why this was suggested:</b>{' '}
                {r.suggestionReasoning}
              </div>
            ) : null}
            <div
              style={{
                display: 'flex',
                gap: 14,
                flexWrap: 'wrap',
                marginTop: 6,
                fontSize: 11,
                color: MT.dim,
              }}
            >
              <span>
                Cardinality: <b style={{ color: MT.text }}>{r.cardinality}</b>
              </span>
              {confirmed ? (
                r.evidence ? (
                  <span>
                    Evidence: <b style={{ color: MT.text }}>{r.evidence}</b>
                  </span>
                ) : null
              ) : (
                <>
                  {r.evidenceKind ? (
                    <span>
                      Source:{' '}
                      <b style={{ color: MT.text }}>{evidenceKindLabel(r.evidenceKind)}</b>
                    </span>
                  ) : null}
                  {r.confidence != null ? (
                    <span>
                      Classifier confidence:{' '}
                      <b style={{ color: MT.text }}>{r.confidence.toFixed(2)}</b>
                    </span>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )
      })}

      <button
        type="button"
        onClick={onCreate}
        style={{
          padding: 10,
          border: `1.5px dashed ${MT.line2}`,
          borderRadius: MT.rM,
          background: 'transparent',
          color: MT.mut,
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        + Declare a relationship the schema does not show
      </button>
    </div>
  )
}
