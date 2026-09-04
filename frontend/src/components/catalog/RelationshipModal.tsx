import { Button, Input, Modal, Popconfirm, Select, Typography } from 'antd'
import { useState } from 'react'
import type { ModelEntity } from '../../api/client'
import {
  CARDINALITY_KINDS,
  CARDINALITY_LABELS,
  evidenceKindLabel,
  type CardinalityKind,
  type DeclaredRelationship,
} from '../../data/dataModelRelationships'
import { MT } from '../../data/dataModelTokens'
import { entityForTable, type ModelTable } from '../../store/dataModelStore'
import { ProvenanceBadge } from './ModelMarks'

const { Text } = Typography
const { TextArea } = Input

const CARDINALITY_OPTIONS = CARDINALITY_KINDS.map((value) => ({
  value,
  label: CARDINALITY_LABELS[value],
}))

const nameFor = (table: ModelTable, entities: ModelEntity[]) =>
  entityForTable(entities, table.tableKey)?.entity_name ?? table.tableId

/** What a reviewer changed before confirming a suggestion. */
export interface RelationshipEdit {
  /**
   * The reviewer's own name for it. Always sent when this object is sent at all, whether or not it
   * differs from the suggested one — a name is framing rather than a structural fact, so it is
   * editable without unlocking the columns.
   */
  name: string
  fromTableKey: string
  fromColumn: string
  toTableKey: string
  toColumn: string
  /**
   * The reviewer's own cardinality, carried alongside a column edit.
   *
   * It moves **with** the columns rather than staying locked: the suggested hint was derived from
   * the distinct counts of the *old* pair, and a hint computed against columns that have since
   * changed has no claim to still be right.
   */
  cardinalityKind: CardinalityKind
}

interface RelationshipModalProps {
  /**
   * `null` is closed. A relationship opens in view/edit; a pending one shows why it was suggested
   * and offers Reject / Edit columns / Confirm. The literal `'create'` opens a blank declaration
   * seeded from `createFromTableKey`.
   */
  target: DeclaredRelationship | 'create' | null
  tables: ModelTable[]
  entities: ModelEntity[]
  createFromTableKey?: string | null
  onClose: () => void
  /** `editId` is set when this edits an already-stored declaration, absent for a new one. */
  onSave: (
    input: Pick<
      DeclaredRelationship,
      | 'fromTableKey'
      | 'fromColumn'
      | 'toTableKey'
      | 'toColumn'
      | 'name'
      | 'cardinality'
      | 'cardinalityKind'
      | 'rationale'
    >,
    editId?: string,
  ) => void
  /** `edit` absent means "confirm the suggestion exactly as it stands, nothing touched". */
  onConfirm: (id: string, edit?: RelationshipEdit) => void
  onReject: (id: string) => void
  onDelete: (id: string) => void
  saving?: boolean
}

/**
 * One dialog for three jobs: declaring a relationship, reading a stored one, and reviewing a
 * suggested one.
 *
 * Four labelled fields plus a Name — From, To, Type (the cardinality), and the business rationale.
 * The name is the fifth because the canvas labels its edges with it, so the model genuinely needs
 * one; it is not a big form and should not become one.
 *
 * **A suggestion's From/To and Type stay read-only until the reviewer opts into editing them.**
 * What they are looking at is a derived proposal, and quietly making it editable would blur the line
 * between what this server read and what a person decided.
 */
export default function RelationshipModal({
  target,
  tables,
  entities,
  createFromTableKey,
  onClose,
  onSave,
  onConfirm,
  onReject,
  onDelete,
  saving = false,
}: RelationshipModalProps) {
  const isCreate = target === 'create'
  const relationship = isCreate ? null : target

  const [name, setName] = useState('')
  const [fromTableKey, setFromTableKey] = useState<string | undefined>(undefined)
  const [fromColumn, setFromColumn] = useState<string | undefined>(undefined)
  const [toTableKey, setToTableKey] = useState<string | undefined>(undefined)
  const [toColumn, setToColumn] = useState<string | undefined>(undefined)
  const [cardinality, setCardinality] = useState<CardinalityKind>('1:N')
  const [rationale, setRationale] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingColumns, setEditingColumns] = useState(false)

  /* Re-seeded whenever a different target opens — adjust-state-during-render, keyed on its id. */
  const targetKey = isCreate
    ? `create:${createFromTableKey ?? ''}`
    : (relationship?.id ?? null)
  const [lastTargetKey, setLastTargetKey] = useState<string | null | undefined>(undefined)
  if (target !== null && targetKey !== lastTargetKey) {
    setLastTargetKey(targetKey)
    setError(null)
    setEditingColumns(false)
    if (relationship) {
      setName(relationship.name)
      setFromTableKey(relationship.fromTableKey)
      setFromColumn(relationship.fromColumn)
      setToTableKey(relationship.toTableKey)
      setToColumn(relationship.toColumn)
      setCardinality(relationship.cardinalityKind)
      setRationale(relationship.rationale)
    } else {
      setName('')
      setFromTableKey(createFromTableKey ?? tables[0]?.tableKey)
      setFromColumn(undefined)
      setToTableKey(undefined)
      setToColumn(undefined)
      setCardinality('1:N')
      setRationale('')
    }
  }

  /* A column select resets when its own table changes — the previous column is not on the new one. */
  const [lastFromTableKey, setLastFromTableKey] = useState(fromTableKey)
  if (fromTableKey !== lastFromTableKey) {
    setLastFromTableKey(fromTableKey)
    setFromColumn(undefined)
  }
  const [lastToTableKey, setLastToTableKey] = useState(toTableKey)
  if (toTableKey !== lastToTableKey) {
    setLastToTableKey(toTableKey)
    setToColumn(undefined)
  }

  if (target === null) return null

  const isPending = relationship?.status === 'pending'
  const columnsLocked = isPending && !editingColumns
  const fromTable = tables.find((t) => t.tableKey === fromTableKey)
  const toTable = tables.find((t) => t.tableKey === toTableKey)
  const entityOptions = tables.map((t) => ({
    value: t.tableKey,
    label: nameFor(t, entities),
  }))

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || !fromTableKey || !fromColumn || !toTableKey || !toColumn) {
      setError('Name, From and To — the entity and the column on both sides — are all required.')
      return
    }
    if (fromTableKey === toTableKey && fromColumn === toColumn) {
      setError('From and To must be different columns.')
      return
    }
    onSave(
      {
        name: trimmed,
        fromTableKey,
        fromColumn,
        toTableKey,
        toColumn,
        cardinality: CARDINALITY_LABELS[cardinality],
        cardinalityKind: cardinality,
        rationale: rationale.trim(),
      },
      isCreate ? undefined : relationship?.id,
    )
    onClose()
  }

  const confirmPending = () => {
    if (!relationship) return
    /* An untouched confirm sends no edit at all — the name is independently editable, so "did the
       reviewer change anything" has to test both it and the column state. */
    const nameChanged = name.trim() !== relationship.name && name.trim().length > 0
    if (!editingColumns && !nameChanged) {
      onConfirm(relationship.id)
    } else if (fromTableKey && fromColumn && toTableKey && toColumn) {
      onConfirm(relationship.id, {
        name: name.trim() || relationship.name,
        fromTableKey,
        fromColumn,
        toTableKey,
        toColumn,
        cardinalityKind: cardinality,
      })
    }
    onClose()
  }

  const fieldLabel = (text: string) => (
    <Text
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        color: MT.mut,
        display: 'block',
        marginBottom: 4,
      }}
    >
      {text}
    </Text>
  )

  return (
    <Modal
      open
      onCancel={onClose}
      width={460}
      title={
        isCreate ? (
          'Declare a relationship the schema does not show'
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {relationship?.name}
            <ProvenanceBadge kind={isPending ? 'derived' : 'human'} full />
          </span>
        )
      }
      footer={
        isCreate ? (
          <Button type="primary" onClick={submit} loading={saving}>
            Save declaration
          </Button>
        ) : isPending ? (
          <>
            <Button
              disabled={saving}
              onClick={() => {
                if (relationship) onReject(relationship.id)
                onClose()
              }}
            >
              Reject
            </Button>
            {!editingColumns ? (
              <Button disabled={saving} onClick={() => setEditingColumns(true)}>
                Edit columns
              </Button>
            ) : null}
            <Button type="primary" onClick={confirmPending} loading={saving}>
              Confirm
            </Button>
          </>
        ) : (
          <>
            <Popconfirm
              title="Delete this relationship?"
              description="Any metric built on it goes with it — a metric whose relationship is gone has no columns to resolve."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => {
                if (relationship) onDelete(relationship.id)
                onClose()
              }}
            >
              <Button danger disabled={saving}>
                Delete
              </Button>
            </Popconfirm>
            <Button type="primary" onClick={submit} loading={saving}>
              Save
            </Button>
          </>
        )
      }
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
        {isPending && relationship?.suggestionReasoning ? (
          <div
            style={{
              background: MT.purpleSoft,
              border: `1px solid ${MT.purple}33`,
              borderRadius: MT.rS,
              padding: 10,
              fontSize: 12,
              color: MT.text,
            }}
          >
            <b>Why this was suggested:</b> {relationship.suggestionReasoning}
            {relationship.confidence != null || relationship.evidenceKind ? (
              <div style={{ marginTop: 4, color: MT.mut, fontSize: 11 }}>
                {relationship.evidenceKind ? (
                  <span>{evidenceKindLabel(relationship.evidenceKind)}</span>
                ) : null}
                {relationship.evidenceKind && relationship.confidence != null ? (
                  <span> · </span>
                ) : null}
                {relationship.confidence != null ? (
                  <span>Classifier confidence: {relationship.confidence.toFixed(2)}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {isPending && editingColumns ? (
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            Editing the columns, and the Type with them — a new column pair can change which
            cardinality is actually correct.
          </Text>
        ) : null}

        <div>
          {fieldLabel('Name')}
          <Input
            placeholder="e.g. LINKED_BY_MANIFEST_TRACKING_NUMBER"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {/* The other names the same run proposed for this join. Always clickable while shown,
              because a name is not gated behind Edit columns; absent once a human has named it,
              since there is then nothing to alternate between. */}
          {isPending && relationship?.nameAlternatives?.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 10.5, marginRight: 2 }}>
                Also derived:
              </Text>
              {relationship.nameAlternatives.map((alt) => (
                <button
                  key={alt}
                  type="button"
                  onClick={() => setName(alt)}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    border: `1px solid ${MT.purple}55`,
                    background: name === alt ? MT.purpleSoft : 'transparent',
                    color: MT.purple,
                    fontSize: 10.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {alt}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          {fieldLabel('From (entity.column)')}
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              style={{ flex: 1 }}
              placeholder="Entity"
              value={fromTableKey}
              disabled={columnsLocked}
              options={entityOptions}
              onChange={setFromTableKey}
              showSearch
              optionFilterProp="label"
            />
            <Select
              style={{ flex: 1 }}
              placeholder="Column"
              value={fromColumn}
              disabled={columnsLocked}
              options={(fromTable?.columns ?? []).map((c) => ({
                value: c.column_id,
                label: c.column_id,
              }))}
              onChange={setFromColumn}
              showSearch
              optionFilterProp="label"
            />
          </div>
        </div>

        <div>
          {fieldLabel('To (entity.column)')}
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              style={{ flex: 1 }}
              placeholder="Entity"
              value={toTableKey}
              disabled={columnsLocked}
              options={entityOptions}
              onChange={setToTableKey}
              showSearch
              optionFilterProp="label"
            />
            <Select
              style={{ flex: 1 }}
              placeholder="Column"
              value={toColumn}
              disabled={columnsLocked}
              options={(toTable?.columns ?? []).map((c) => ({
                value: c.column_id,
                label: c.column_id,
              }))}
              onChange={setToColumn}
              showSearch
              optionFilterProp="label"
            />
          </div>
        </div>

        <div>
          {fieldLabel(
            columnsLocked ? 'Type (the derived cardinality)' : 'Type (cardinality hint)',
          )}
          <Select
            style={{ width: '100%' }}
            value={cardinality}
            disabled={columnsLocked}
            options={CARDINALITY_OPTIONS}
            onChange={setCardinality}
            showSearch
            optionFilterProp="label"
          />
          {!columnsLocked ? (
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
              Advisory — a reviewer&rsquo;s confirmation sets the value, never a hint alone.
            </Text>
          ) : null}
        </div>

        <div>
          {fieldLabel('Description (business rationale)')}
          <TextArea
            rows={2}
            placeholder="Why does this relationship exist?"
            value={rationale}
            /* A suggestion's rationale is this server's own account of the columns it matched on,
               with the figures it read. Editing it here would put the reviewer's words behind a
               statement about what was measured; the reviewer's own reasoning is what the rationale
               becomes once they confirm it. */
            disabled={isPending}
            onChange={(e) => setRationale(e.target.value)}
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
