import { DeleteOutlined, EditOutlined, InfoCircleOutlined, KeyOutlined } from '@ant-design/icons'
import { App, Button, Input, Modal, Select, Tag, Tooltip, Typography } from 'antd'
import { useState } from 'react'
import type { ModelCrossAttribute, ModelEntity } from '../../api/client'
import { confirmedIdentifier } from '../../data/dataModelRelationships'
import { MT } from '../../data/dataModelTokens'
import { entityForTable, useDataModelStore, type ModelTable } from '../../store/dataModelStore'
import { ProvenanceBadge } from './ModelMarks'

const { Text } = Typography

interface EntityColumnsPanelProps {
  table: ModelTable
  tables: ModelTable[]
  entities: ModelEntity[]
  entity: ModelEntity | null
  sourceId: string
}

const nameFor = (tableKey: string, tables: ModelTable[], entities: ModelEntity[]) => {
  const table = tables.find((t) => t.tableKey === tableKey)
  if (!table) return tableKey
  return entityForTable(entities, tableKey)?.entity_name ?? table.tableId
}

/**
 * The description editor, in its own dialog.
 *
 * A `Modal` portals out of `renderToString`, which is why this is a component of its own rather than
 * markup inside the panel: a body written inline could not be asserted at all.
 */
function DescriptionModal({
  column,
  onClose,
  onSave,
  saving,
}: {
  column: { columnId: string; description: string } | null
  onClose: () => void
  onSave: (text: string) => void
  saving: boolean
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  /* Re-seeded whenever a different column opens — adjust-state-during-render, keyed on its id. */
  const [lastColumnId, setLastColumnId] = useState<string | null>(null)
  const openId = column?.columnId ?? null
  if (openId !== lastColumnId) {
    setLastColumnId(openId)
    setText(column?.description ?? '')
    setError(null)
  }

  return (
    <Modal
      open={column !== null}
      title={
        column ? (
          <span>
            Edit description ·{' '}
            <span style={{ fontFamily: MT.mono }}>{column.columnId}</span>
          </span>
        ) : (
          'Edit description'
        )
      }
      onCancel={onClose}
      onOk={() => {
        const trimmed = text.trim()
        if (!trimmed) {
          setError('A description cannot be empty — clear it another way if that is the intent.')
          return
        }
        onSave(trimmed)
      }}
      okText="Save"
      confirmLoading={saving}
      destroyOnHidden
    >
      <Input.TextArea
        rows={4}
        placeholder="What this column means, in the words a question would use…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        status={error ? 'error' : undefined}
      />
      {error ? (
        <div style={{ color: MT.red, fontSize: 12, marginTop: 6 }}>{error}</div>
      ) : null}
    </Modal>
  )
}

/**
 * Declares that a column stored on **another** table means something for this entity.
 *
 * Its own component for the reason above: it is a `Modal`.
 */
function ReassignModal({
  open,
  ownerName,
  tables,
  onClose,
  onSave,
  saving,
}: {
  open: boolean
  ownerName: string
  tables: ModelTable[]
  onClose: () => void
  onSave: (attr: { source_table_key: string; source_column: string; description: string }) => void
  saving: boolean
}) {
  const [tableKey, setTableKey] = useState<string | undefined>(undefined)
  const [column, setColumn] = useState<string | undefined>(undefined)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setTableKey(undefined)
      setColumn(undefined)
      setDescription('')
      setError(null)
    }
  }

  const sourceTable = tables.find((t) => t.tableKey === tableKey)

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`Declare a column owned by ${ownerName}`}
      okText="Save"
      confirmLoading={saving}
      onOk={() => {
        if (!tableKey || !column || !description.trim()) {
          setError('Pick a table, a column, and write what it means for this entity.')
          return
        }
        onSave({
          source_table_key: tableKey,
          source_column: column,
          description: description.trim(),
        })
      }}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Pick any profiled column in this source — including one stored on a different table —
          and declare that its business meaning belongs to <b>{ownerName}</b>.
        </Text>
        <div>
          <Text
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: MT.mut,
              display: 'block',
              marginBottom: 4,
            }}
          >
            Table
          </Text>
          <Select
            style={{ width: '100%' }}
            placeholder="The table the column is stored on"
            value={tableKey}
            onChange={(v) => {
              setTableKey(v)
              setColumn(undefined)
            }}
            options={tables.map((t) => ({ value: t.tableKey, label: t.tableKey }))}
            showSearch
            optionFilterProp="label"
          />
        </div>
        <div>
          <Text
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: MT.mut,
              display: 'block',
              marginBottom: 4,
            }}
          >
            Column
          </Text>
          <Select
            style={{ width: '100%' }}
            placeholder="Column"
            value={column}
            disabled={!sourceTable}
            onChange={setColumn}
            options={(sourceTable?.columns ?? []).map((c) => ({
              value: c.column_id,
              label: c.column_id,
            }))}
            showSearch
            optionFilterProp="label"
          />
        </div>
        <div>
          <Text
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: MT.mut,
              display: 'block',
              marginBottom: 4,
            }}
          >
            What does it mean for this entity?
          </Text>
          <Input.TextArea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Whether this facility is an active, permitted TSDF — non-blank means active."
          />
        </div>
        {error ? (
          <Text type="danger" style={{ fontSize: 12 }}>
            {error}
          </Text>
        ) : null}
      </div>
    </Modal>
  )
}

/**
 * The Columns sub-tab: this table's own columns, and the columns from elsewhere whose *meaning*
 * belongs to this entity.
 *
 * Two different things sit here, and they are kept apart because they persist differently. A
 * column's **description** is a curator note on the profile, written to the same endpoint the
 * dictionary's pencil uses — it lives in the mock server's memory, like the registration it belongs
 * to. A **reassigned column** is part of the declaration and is written to the document.
 *
 * A column reassigned *away* from this table stays on the list with a note rather than disappearing
 * from it — a hidden row leaves a reader wondering where a column went.
 */
export default function EntityColumnsPanel({
  table,
  tables,
  entities,
  entity,
  sourceId,
}: EntityColumnsPanelProps) {
  const { message, modal } = App.useApp()
  const describe = useDataModelStore((s) => s.describe)
  const save = useDataModelStore((s) => s.save)
  const saving = useDataModelStore((s) => s.saving)
  const [editing, setEditing] = useState<{ columnId: string; description: string } | null>(
    null,
  )
  const [reassignOpen, setReassignOpen] = useState(false)

  const identifierName = confirmedIdentifier(entity)
  const ownerName = entity?.entity_name ?? table.tableId

  /* Every reassignment declared anywhere in this dataset, so both directions can be stated. */
  const allReassignments = entities.flatMap((e) =>
    e.cross_attributes.map((a) => ({ ...a, ownerTableKey: e.table_key })),
  )
  const awayFromHere = allReassignments.filter(
    (a) => a.source_table_key === table.tableKey && a.ownerTableKey !== table.tableKey,
  )
  const ownedHere: ModelCrossAttribute[] = (entity?.cross_attributes ?? []).filter(
    (a) => a.source_table_key !== table.tableKey,
  )

  const saveNote = async (text: string) => {
    if (!editing) return
    const result = await describe(sourceId, {
      dataset_id: table.datasetId,
      table_id: table.tableId,
      column_id: editing.columnId,
      description: text,
    })
    if (result.ok) {
      message.success('Description saved.')
      setEditing(null)
    } else {
      message.error(result.error)
    }
  }

  const addReassignment = async (attr: {
    source_table_key: string
    source_column: string
    description: string
  }) => {
    const result = await save({
      entity_id: entity?.entity_id,
      table_key: table.tableKey,
      /* A reassignment can be the first thing anybody declares about a table, so the entity is
         anchored in the same write rather than sending the reader to the Overview tab first. */
      entity_name: entity?.entity_name ?? table.tableId,
      description:
        entity?.description ??
        `Entity for ${table.tableId}, created to own a column declared from another table.`,
      cross_attributes: [...(entity?.cross_attributes ?? []), attr],
    })
    if (result.ok) {
      message.success('Column declared.')
      setReassignOpen(false)
    } else {
      message.error(result.error)
    }
  }

  const removeReassignment = (attributeId: string) => {
    modal.confirm({
      title: 'Remove this declaration?',
      content:
        'The column stays where it is and keeps its own description — what goes is the claim that its meaning belongs to this entity.',
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!entity) return
        const result = await save({
          entity_id: entity.entity_id,
          cross_attributes: entity.cross_attributes.filter(
            (a) => a.attribute_id !== attributeId,
          ),
        })
        if (result.ok) message.success('Declaration removed.')
        else message.error(result.error)
      },
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Text strong style={{ fontSize: 12.5, display: 'block', marginBottom: 8 }}>
          This table&rsquo;s columns
        </Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {table.columns.map((c) => {
            const reassigned = awayFromHere.find((a) => a.source_column === c.column_id)
            const isIdentifier = c.column_id === identifierName
            return (
              <div
                key={c.column_id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '6px 0',
                  borderBottom: `1px solid ${MT.line}`,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  {isIdentifier ? (
                    <Tooltip title="Confirmed identifier column">
                      <KeyOutlined
                        style={{ color: MT.orangeHi, fontSize: 12, marginRight: 4 }}
                      />
                    </Tooltip>
                  ) : null}
                  <span style={{ fontFamily: MT.mono, fontSize: 12 }}>{c.column_id}</span>{' '}
                  {c.description ? (
                    <>
                      <Text style={{ fontSize: 12 }}>{c.description}</Text>{' '}
                      {/* The profiler's own account of how it reached the classification, where it
                          recorded one. Never defaulted — a method attributed to a classification
                          nobody described is the same lie as an invented confidence. */}
                      {c.derivation ? <Tag>{c.derivation}</Tag> : null}
                      {c.description_status === 'needs review' ? (
                        <Tag color="orange">needs review</Tag>
                      ) : null}
                    </>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      —
                    </Text>
                  )}
                  {reassigned ? (
                    <div style={{ marginTop: 2 }}>
                      <Tooltip title={reassigned.description}>
                        <span style={{ fontSize: 11, color: MT.amber, cursor: 'help' }}>
                          <InfoCircleOutlined /> meaning reassigned to{' '}
                          {nameFor(reassigned.ownerTableKey, tables, entities)}
                        </span>
                      </Tooltip>
                    </div>
                  ) : null}
                </div>
                <Button
                  type="text"
                  size="small"
                  aria-label={`Edit the description of ${c.column_id}`}
                  icon={<EditOutlined />}
                  onClick={() =>
                    setEditing({ columnId: c.column_id, description: c.description ?? '' })
                  }
                />
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text strong style={{ fontSize: 12.5 }}>
            Columns owned here from other tables
          </Text>
          <Button size="small" onClick={() => setReassignOpen(true)}>
            + Declare
          </Button>
        </div>
        {ownedHere.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
            None yet — declare a column from another table whose meaning belongs to this entity.
          </Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {ownedHere.map((a) => (
              <div
                key={a.attribute_id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  border: `1px solid ${MT.line}`,
                  borderRadius: MT.rS,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontFamily: MT.mono, fontSize: 12 }}>
                      {a.source_column}
                    </span>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      on {a.source_table_key}
                    </Text>
                    <ProvenanceBadge kind="human" />
                  </div>
                  <Text style={{ fontSize: 12 }}>{a.description}</Text>
                </div>
                <Button
                  type="text"
                  size="small"
                  aria-label="Remove this declaration"
                  icon={<DeleteOutlined />}
                  onClick={() => removeReassignment(a.attribute_id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <DescriptionModal
        column={editing}
        onClose={() => setEditing(null)}
        onSave={(text) => void saveNote(text)}
        saving={saving}
      />

      <ReassignModal
        open={reassignOpen}
        ownerName={ownerName}
        tables={tables}
        onClose={() => setReassignOpen(false)}
        onSave={(attr) => void addReassignment(attr)}
        saving={saving}
      />
    </div>
  )
}
