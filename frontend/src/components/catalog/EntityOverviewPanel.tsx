import { App, Button, Input, Select, Typography } from 'antd'
import { useState } from 'react'
import type { ModelEntity, ModelTableSuggestion } from '../../api/client'
import { confirmedIdentifier } from '../../data/dataModelRelationships'
import { MT } from '../../data/dataModelTokens'
import { useAuthStore } from '../../store/authStore'
import { useDataModelStore, type ModelTable } from '../../store/dataModelStore'

const { Text, Paragraph } = Typography
const { TextArea } = Input

interface EntityOverviewPanelProps {
  table: ModelTable
  /** This table's stored declaration, or `null` where nobody has written one yet. */
  entity: ModelEntity | null
  /**
   * What the suggestions run said about this table, once somebody has run it for this source.
   * `null` until then, and for a table the run had nothing to say about.
   */
  suggestion?: ModelTableSuggestion | null
}

interface FieldState {
  entityName: string
  description: string
  businessPurpose: string
  grainDescription: string
  identifierColumn: string | undefined
}

const seedFields = (
  table: ModelTable,
  entity: ModelEntity | null,
  suggestion: ModelTableSuggestion | null | undefined,
): FieldState => ({
  entityName: entity?.entity_name ?? table.tableId,
  description: entity?.description ?? suggestion?.suggested_description ?? '',
  businessPurpose:
    entity?.business_purpose ?? suggestion?.suggested_business_purpose ?? '',
  grainDescription:
    entity?.grain_description ?? suggestion?.suggested_grain_description ?? '',
  identifierColumn: confirmedIdentifier(entity),
})

/**
 * The Overview sub-tab: what this table *is*, and which column identifies a row.
 *
 * **A field is pre-seeded and directly editable, and Save always writes it as the human's.** Accept
 * a suggestion as it stands or edit it first — either way what lands is a declaration somebody made,
 * which is why the provenance badge flips to *You* the moment there is a stored value.
 *
 * The identifier is a **select over this table's real columns**, so a declaration cannot name a
 * column the profiler never saw — and it is called *confirmed* rather than detected, because nothing
 * here guesses it.
 */
export default function EntityOverviewPanel({
  table,
  entity,
  suggestion,
}: EntityOverviewPanelProps) {
  const { message } = App.useApp()
  const save = useDataModelStore((s) => s.save)
  const saving = useDataModelStore((s) => s.saving)
  /* Who is declaring it. Client-held, so this write has to carry it — a route cannot look up who
     is signed in, the rule the consent callback and `saved_by` on a report both established. */
  const signedInAs = useAuthStore((s) => s.identity?.email ?? null)
  const [error, setError] = useState<string | null>(null)

  /*
   * Re-seeded whenever a different table arrives, or this table's own declaration comes back changed
   * — adjust-state-during-render, keyed on the table and the stored record's own timestamp.
   *
   * **Deliberately not keyed on `suggestion`.** A suggestions run finishing mid-typing would
   * otherwise re-seed every field and throw away what somebody was in the middle of writing. A
   * suggestion still reaches a field that is genuinely blank — see the top-up below.
   */
  const seedKey = `${table.tableKey}:${entity?.updated_at ?? 'new'}`
  const [lastSeedKey, setLastSeedKey] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldState>(() =>
    seedFields(table, entity, suggestion),
  )
  if (seedKey !== lastSeedKey) {
    setLastSeedKey(seedKey)
    setFields(seedFields(table, entity, suggestion))
    setError(null)
  }

  /*
   * A run arriving **tops up only the fields still blank at that moment** — never one that already
   * holds content, whether saved, typed, or an earlier suggestion already accepted into the box.
   * This is the one place a derived value reaches an input at all; everywhere else a human's value
   * wins outright.
   */
  const suggestionKey = suggestion ? `${table.tableKey}:${suggestion.table_key}` : null
  const [lastSuggestionKey, setLastSuggestionKey] = useState<string | null>(null)
  if (suggestionKey !== null && suggestionKey !== lastSuggestionKey) {
    setLastSuggestionKey(suggestionKey)
    setFields({
      ...fields,
      description: fields.description || suggestion?.suggested_description || '',
      businessPurpose:
        fields.businessPurpose || suggestion?.suggested_business_purpose || '',
      grainDescription:
        fields.grainDescription || suggestion?.suggested_grain_description || '',
    })
  }

  /*
   * **One flag left of five.** The other four fed a `ProvenanceBadge` beside each field — five
   * marks answering one question five times, on a form whose every field is saved by one button.
   * Removed on request; the question is about the table, so the header answers it once, from
   * `tableDeclarationState`. This one survives because it drives a *hint* rather than a badge: the
   * name box says where its value came from when nobody has saved one.
   */
  const hasHumanName = !!entity

  const submit = async () => {
    const name = fields.entityName.trim()
    const description = fields.description.trim()
    if (!name) {
      setError("Give this table's entity a name before saving.")
      return
    }
    if (!description) {
      setError('Add a description before saving — it is what makes this a declaration.')
      return
    }

    /*
     * Any other declared attribute is preserved; only the identifier flag moves. At most one
     * attribute may carry it — the server refuses two — so a stale flag on the previous column is
     * cleared here rather than left to round-trip alongside the new one.
     */
    const prior = entity?.attributes ?? []
    const attributes = fields.identifierColumn
      ? [
          ...prior
            .filter((a) => a.name !== fields.identifierColumn)
            .map((a) => ({ ...a, is_identifier: false })),
          {
            name: fields.identifierColumn,
            type:
              table.columns.find((c) => c.column_id === fields.identifierColumn)?.type ??
              null,
            is_identifier: true,
          },
        ]
      : prior.map((a) => ({ ...a, is_identifier: false }))

    setError(null)
    const result = await save({
      entity_id: entity?.entity_id,
      table_key: table.tableKey,
      entity_name: name,
      description,
      /*
       * **This button is what makes a table *declared by somebody*.** Every other way an entity
       * comes into existence is machinery — an anchor for a relationship, or fields seeded from the
       * table's own catalogue row — so pressing Save is the one act there is a person behind, and
       * the header's pill is read off this. The address is the browser's, because the identity is
       * client-held and a route cannot look up who is signed in.
       */
      confirmed_by: signedInAs,
      business_purpose: fields.businessPurpose.trim() || null,
      grain_description: fields.grainDescription.trim() || null,
      attributes,
    })
    if (result.ok) message.success('Overview saved.')
    else setError(result.error)
  }

  /*
   * **A label, and nothing beside it.** It took a `badge` node, which is what carried the
   * per-field `ProvenanceBadge`. With the status answered once in the header there is nothing to
   * put on the right, and a parameter no caller passes is a slot inviting one back.
   */
  const fieldLabel = (text: string) => (
    <div
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        color: MT.mut,
        marginBottom: 5,
      }}
    >
      {text}
    </div>
  )
  const inputStyle = {
    background: MT.inset,
    border: `1px solid ${MT.line2}`,
    borderRadius: MT.rS,
    fontSize: 12.5,
    color: MT.text,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 11.5 }}>
        A declaration here belongs to the dataset, not to one graph — every brief built against
        this source reads the same one.
      </Paragraph>

      <div>
        {fieldLabel('Entity name')}
        <Input
          placeholder="e.g. Facility"
          style={inputStyle}
          value={fields.entityName}
          onChange={(e) => setFields((f) => ({ ...f, entityName: e.target.value }))}
        />
        {!hasHumanName ? (
          <div style={{ fontSize: 11, color: MT.dim, marginTop: 5 }}>
            Seeded from the table&rsquo;s own id — edit it, or save as it stands.
          </div>
        ) : null}
      </div>

      <div>
        {fieldLabel('What does this table represent?')}
        <TextArea
          rows={3}
          style={{ ...inputStyle, minHeight: 52, lineHeight: 1.45 }}
          placeholder="e.g. One row per hazardous-waste manifest, tracking a shipment from generator to receiver."
          value={fields.description}
          onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div>
        {fieldLabel('Business purpose')}
        <TextArea
          rows={2}
          style={{ ...inputStyle, minHeight: 52, lineHeight: 1.45 }}
          placeholder="e.g. Anchors facility-level questions about compliance status."
          value={fields.businessPurpose}
          onChange={(e) => setFields((f) => ({ ...f, businessPurpose: e.target.value }))}
        />
        {/* Nothing in the document states what a table is *for*, so this field never arrives
            pre-filled and never carries a derived badge — a sentence composed here would be words
            in the tenant's mouth. */}
        <div style={{ fontSize: 11, color: MT.dim, marginTop: 5 }}>
          Nothing in the catalogue states this, so it is only ever yours to write.
        </div>
      </div>

      <div>
        {fieldLabel('Grain')}
        <TextArea
          rows={2}
          style={{ ...inputStyle, minHeight: 52, lineHeight: 1.45 }}
          placeholder="e.g. One row per facility."
          value={fields.grainDescription}
          onChange={(e) =>
            setFields((f) => ({ ...f, grainDescription: e.target.value }))
          }
        />
        {table.grain ? (
          <div style={{ fontSize: 11, color: MT.dim, marginTop: 5 }}>
            The catalogue states{' '}
            <span style={{ color: MT.text }}>&ldquo;{table.grain}&rdquo;</span> for this table.
          </div>
        ) : null}
      </div>

      <div>
        {fieldLabel('Confirmed identifier')}
        <Select
          style={{ width: '100%' }}
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Select the column that uniquely identifies a row"
          value={fields.identifierColumn}
          onChange={(value) => setFields((f) => ({ ...f, identifierColumn: value }))}
          options={table.columns.map((c) => ({
            label: c.column_id,
            value: c.column_id,
          }))}
        />
        {fields.identifierColumn ? (
          <div style={{ fontSize: 11, color: MT.dim, marginTop: 5 }}>
            <span style={{ fontFamily: MT.mono, color: MT.orangeHi }}>
              {fields.identifierColumn}
            </span>{' '}
            · confirmed, not guessed
          </div>
        ) : null}
      </div>

      {error ? (
        <Text type="danger" style={{ fontSize: 12.5 }}>
          {error}
        </Text>
      ) : null}

      <div>
        <Button type="primary" loading={saving} onClick={() => void submit()}>
          Save Overview
        </Button>
      </div>
    </div>
  )
}
