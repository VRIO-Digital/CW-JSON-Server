import {
  DatabaseOutlined,
  ExpandOutlined,
  LeftOutlined,
  RightOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { Alert, App, Button, Col, Row, Skeleton, Space, Tooltip, Typography } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelTableSuggestion, SourceRow } from '../../api/client'
import {
  CARDINALITY_LABELS,
  cardinalityKindFromHint,
  declaredRelationshipsFrom,
  relationshipToCanvasEdge,
  relationshipWrites,
  removeRelationshipWrite,
  type DeclaredRelationship,
} from '../../data/dataModelRelationships'
import { MT } from '../../data/dataModelTokens'
import { entityForTable, useDataModelStore } from '../../store/dataModelStore'
import ApiErrorAlert from '../common/ApiErrorAlert'
import ConnectorIcon from '../common/ConnectorIcon'
import EntityCanvas from './EntityCanvas'
import EntityColumnsPanel from './EntityColumnsPanel'
import EntityMetricsPanel from './EntityMetricsPanel'
import EntityOverviewPanel from './EntityOverviewPanel'
import EntityRelationshipsPanel from './EntityRelationshipsPanel'
import ModelTableList from './ModelTableList'
import { PanelShell, StatusPill } from './ModelMarks'
import RelationshipModal, { type RelationshipEdit } from './RelationshipModal'

const { Text } = Typography

const DETAIL_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'columns', label: 'Columns' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'metrics', label: 'Metrics' },
] as const
type DetailTabKey = (typeof DETAIL_TABS)[number]['key']

function StatItem({
  value,
  label,
  color,
}: {
  value: number
  label: string
  color?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <b style={{ fontSize: 16, lineHeight: 1.1, color: color ?? MT.text }}>{value}</b>
      <span style={{ fontSize: 10.5, color: MT.dim }}>{label}</span>
    </div>
  )
}

interface DataModelTabProps {
  /**
   * Every connected source. This tab keeps the **structured** ones, because a model is tables,
   * columns, relationships and metrics — all of which come from a profiled schema. A drive or a
   * mailbox holds documents, so selecting one could only ever say "no profiled tables here": a row
   * that exists to be a dead end.
   */
  sources: SourceRow[]
  loading: boolean
}

/**
 * The Data Modeling tab.
 *
 * Three columns, and each answers a different question. **Left**: which source, and which of its
 * profiled tables. **Centre**: what the model looks like — the counts, and the canvas. **Right**:
 * everything declared about the one table in hand, over four sub-tabs.
 *
 * **Selection is one piece of state.** `selectedTableKey` is handed to the table list and to the
 * canvas, and both call the same setter, so the two can never disagree about what is selected —
 * there is nothing to sync because there is only one value.
 *
 * **A confirmed relationship is the server's; a suggestion is this component's.** The declarations
 * come back on the entities the store loaded, so there is one copy of them and a save re-reads it. A
 * suggestion sits in local state until somebody confirms it, and confirming is the act that writes
 * it — a suggestion nobody accepted is not a declaration and must not be stored as one.
 */
export default function DataModelTab({ sources, loading }: DataModelTabProps) {
  const { message } = App.useApp()
  const tables = useDataModelStore((s) => s.tables)
  const entities = useDataModelStore((s) => s.entities)
  const modelLoading = useDataModelStore((s) => s.loading)
  const modelError = useDataModelStore((s) => s.error)
  const load = useDataModelStore((s) => s.load)
  const save = useDataModelStore((s) => s.save)
  const saveWrites = useDataModelStore((s) => s.saveWrites)
  const suggest = useDataModelStore((s) => s.suggest)
  const saving = useDataModelStore((s) => s.saving)

  const structured = useMemo(
    () => sources.filter((s) => s.kind === 'bigquery' && s.status === 'connected'),
    [sources],
  )
  const skipped = sources.length - structured.length

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTabKey>('overview')
  const [railCollapsed, setRailCollapsed] = useState(false)
  const fitRef = useRef<(() => void) | null>(null)

  /* Suggestions, keyed by source. Local, deliberately — see the component note. */
  const [pendingBySource, setPendingBySource] = useState<
    Record<string, DeclaredRelationship[]>
  >({})
  const [tableSuggestions, setTableSuggestions] = useState<
    Record<string, ModelTableSuggestion>
  >({})
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [suggestDegraded, setSuggestDegraded] = useState(false)
  const [suggestTruncated, setSuggestTruncated] = useState<number | null>(null)

  const [relationshipTarget, setRelationshipTarget] = useState<
    DeclaredRelationship | 'create' | null
  >(null)
  const [createFromTableKey, setCreateFromTableKey] = useState<string | null>(null)

  /* Keep the selection valid as the list arrives or changes underneath. */
  const selectedSource =
    structured.find((s) => s.sourceId === selectedSourceId) ?? structured[0] ?? null
  useEffect(() => {
    if (selectedSource && selectedSource.sourceId !== selectedSourceId) {
      setSelectedSourceId(selectedSource.sourceId)
    }
    if (!selectedSource && selectedSourceId !== null && !loading) {
      setSelectedSourceId(null)
    }
  }, [selectedSource, selectedSourceId, loading])

  useEffect(() => {
    if (selectedSource) void load(selectedSource.sourceId)
  }, [load, selectedSource])

  /*
   * Table and sub-tab selection reset when the source changes — adjust-state-during-render.
   *
   * **The key is normalised before it is compared, not only before it is stored.** Comparing
   * `selectedSource?.sourceId` (`undefined` with nothing selected) against a state initialised to
   * `null` and then writing `?? null` made the two never agree: every render saw a change, set the
   * same `null` back, and re-rendered — *"Too many re-renders"* on the branch where a tenant has no
   * structured source. Found by rendering the tab rather than by reading it.
   */
  const sourceKey = selectedSource?.sourceId ?? null
  const [lastSourceKey, setLastSourceKey] = useState<string | null>(null)
  if (sourceKey !== lastSourceKey) {
    setLastSourceKey(sourceKey)
    setSelectedTableKey(null)
    setDetailTab('overview')
  }

  const tableKeys = useMemo(() => tables.map((t) => t.tableKey), [tables])
  const declared = useMemo(
    () => declaredRelationshipsFrom(entities, tableKeys),
    [entities, tableKeys],
  )
  const pending = useMemo(
    () => (selectedSource ? (pendingBySource[selectedSource.sourceId] ?? []) : []),
    [selectedSource, pendingBySource],
  )
  const relationships = useMemo(() => [...declared, ...pending], [declared, pending])
  const edges = useMemo(
    () => relationships.map(relationshipToCanvasEdge),
    [relationships],
  )

  const selectedTable = useMemo(
    () => tables.find((t) => t.tableKey === selectedTableKey) ?? null,
    [tables, selectedTableKey],
  )
  const selectedEntity = selectedTable
    ? entityForTable(entities, selectedTable.tableKey)
    : null

  const columnsDescribed = useMemo(
    () =>
      tables.reduce((n, t) => n + t.columns.filter((c) => !!c.description).length, 0),
    [tables],
  )
  const confirmedCount = relationships.filter((r) => r.status === 'confirmed').length
  const pendingCount = relationships.filter((r) => r.status === 'pending').length

  const labelFor = (tableKey: string) =>
    tables.find((t) => t.tableKey === tableKey)?.tableId ?? tableKey

  const openRelationship = (id: string) =>
    setRelationshipTarget(relationships.find((r) => r.id === id) ?? null)
  const openCreate = (fromTableKey?: string) => {
    setCreateFromTableKey(fromTableKey ?? selectedTableKey)
    setRelationshipTarget('create')
  }

  /** Persists a declaration, then lets the store's re-read decide what is on screen. */
  const saveRelationship = async (
    input: Pick<
      DeclaredRelationship,
      | 'fromTableKey'
      | 'fromColumn'
      | 'toTableKey'
      | 'toColumn'
      | 'name'
      | 'cardinalityKind'
      | 'rationale'
    >,
    editId?: string,
  ) => {
    const result = await saveWrites(
      relationshipWrites({ rel: input, editId, entities, labelFor }),
    )
    if (result.ok) {
      message.success(editId ? 'Relationship updated.' : 'Relationship declared.')
    } else {
      message.error(result.error)
    }
  }

  /**
   * Confirming a suggestion is what turns it into a declaration: it is written, and only then
   * dropped from the pending list — a failed confirm leaves the suggestion where it can be retried
   * rather than losing it.
   */
  const confirmRelationship = async (id: string, edit?: RelationshipEdit) => {
    if (!selectedSource) return
    const suggestion = pending.find((r) => r.id === id)
    if (!suggestion) return

    const resolved = edit
      ? {
          ...suggestion,
          name: edit.name,
          fromTableKey: edit.fromTableKey,
          fromColumn: edit.fromColumn,
          toTableKey: edit.toTableKey,
          toColumn: edit.toColumn,
          /* Never spread the edit wholesale: the display label has to be re-derived from the kind,
             or it would go stale against the cardinality it is meant to describe. */
          cardinalityKind: edit.cardinalityKind,
          cardinality: CARDINALITY_LABELS[edit.cardinalityKind],
        }
      : suggestion

    const result = await saveWrites(
      relationshipWrites({
        rel: {
          ...resolved,
          /*
           * The run's own account of the columns it matched on becomes the declaration's rationale
           * where the reviewer added none — "why this relationship exists" is exactly what it
           * already explains, with the figures it read.
           */
          rationale: resolved.rationale.trim() || resolved.suggestionReasoning || '',
        },
        entities,
        labelFor,
      }),
    )
    if (!result.ok) {
      message.error(result.error)
      return
    }
    setPendingBySource((prev) => ({
      ...prev,
      [selectedSource.sourceId]: (prev[selectedSource.sourceId] ?? []).filter(
        (r) => r.id !== id,
      ),
    }))
    message.success('Relationship confirmed and saved.')
  }

  /**
   * One remover, two intents. **Reject** drops a suggestion from local state; **Delete** writes the
   * declaration away, and takes the metrics built on it with it — a metric whose relationship is
   * gone has nothing to resolve its columns against. The id decides which of the two this is.
   */
  const removeRelationship = async (id: string) => {
    if (!selectedSource) return
    if (pending.some((r) => r.id === id)) {
      setPendingBySource((prev) => ({
        ...prev,
        [selectedSource.sourceId]: (prev[selectedSource.sourceId] ?? []).filter(
          (r) => r.id !== id,
        ),
      }))
      return
    }
    const write = removeRelationshipWrite(id, entities)
    if (!write) return
    const result = await save(write)
    if (result.ok) message.success('Relationship removed.')
    else message.error(result.error)
  }

  const runSuggestions = async () => {
    if (!selectedSource) return
    setSuggesting(true)
    setSuggestError(null)
    setSuggestDegraded(false)
    setSuggestTruncated(null)
    const result = await suggest(selectedSource.sourceId)
    setSuggesting(false)
    if (!result.ok) {
      setSuggestError(result.error)
      return
    }
    const data = result.data
    setSuggestDegraded(data.degraded)
    setSuggestTruncated(data.truncated ? data.tables_considered : null)
    setTableSuggestions((prev) => {
      const next = { ...prev }
      for (const t of data.tables) next[t.table_key] = t
      return next
    })

    /*
     * A pair already tracked by any existing relationship — stored or pending, in **either
     * direction** — is skipped. A declaration somebody confirmed is ground truth, and a fresh
     * suggestion sitting beside it would imply the question is still open.
     */
    const covered = (r: {
      from_table_key: string
      from_column: string
      to_table_key: string
      to_column: string
    }) =>
      relationships.some(
        (e) =>
          (e.fromTableKey === r.from_table_key &&
            e.fromColumn === r.from_column &&
            e.toTableKey === r.to_table_key &&
            e.toColumn === r.to_column) ||
          (e.fromTableKey === r.to_table_key &&
            e.fromColumn === r.to_column &&
            e.toTableKey === r.from_table_key &&
            e.toColumn === r.from_column),
      )

    setPendingBySource((prev) => {
      const existing = prev[selectedSource.sourceId] ?? []
      const fresh: DeclaredRelationship[] = data.relationships
        .filter((r) => !covered(r))
        .map((r) => {
          const kind = cardinalityKindFromHint(r.cardinality_hint)
          return {
            id: `derived::${r.from_table_key}::${r.from_column}::${r.to_table_key}::${r.to_column}`,
            fromTableKey: r.from_table_key,
            fromColumn: r.from_column,
            toTableKey: r.to_table_key,
            toColumn: r.to_column,
            name: r.relationship_type,
            nameAlternatives: r.relationship_type_alternatives,
            cardinality: CARDINALITY_LABELS[kind],
            cardinalityKind: kind,
            rationale: '',
            status: 'pending' as const,
            provenance: 'derived' as const,
            suggestionReasoning: r.rationale,
            confidence: r.confidence,
            evidenceKind: r.evidence_kind,
          }
        })
      /* Keyed by the column pair, so a second run replaces its own earlier suggestions rather than
         listing each of them twice. */
      const keep = existing.filter((e) => !fresh.some((f) => f.id === e.id))
      if (fresh.length === 0) {
        message.info('Nothing new — every shared identifier is already declared or suggested.')
        return prev
      }
      return { ...prev, [selectedSource.sourceId]: [...keep, ...fresh] }
    })
  }

  if (loading && structured.length === 0) {
    return <Skeleton active paragraph={{ rows: 6 }} />
  }

  if (structured.length === 0) {
    return (
      <div style={{ padding: '4px 0' }}>
        <Alert
          type="info"
          showIcon
          title="No structured source is connected"
          description="A model is tables, columns, relationships and metrics, so it is drawn over a connected BigQuery project. Connect one on Sources, then browse and profile it on the Catalog tab."
        />
        {/* A list that is merely shorter is not a message: a tenant whose only sources are a drive
            and a mailbox would otherwise read "nothing is connected" beside a Sources table
            listing two. */}
        {skipped > 0 ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12.5 }}>
            {`${skipped} connected source${skipped === 1 ? ' is' : 's are'} not modelled here: a drive and a mailbox hold documents rather than tables, so there is no schema to draw. Both are catalogued on the Catalog tab.`}
          </Typography.Paragraph>
        ) : null}
      </div>
    )
  }

  const displayName = selectedEntity?.entity_name ?? selectedTable?.tableId

  return (
    <>
      {modelError ? (
        <ApiErrorAlert
          error={modelError}
          onRetry={() => {
            if (selectedSource) void load(selectedSource.sourceId)
          }}
        />
      ) : null}

      {/*
        `align="top"`, not stretch: each panel sizes to its own content instead of all three being
        forced to the tallest one's height — which left a tall empty gap under the canvas's legend,
        since the detail column is naturally much longer.
      */}
      <Row gutter={[16, 16]} align="top">
        {/* LEFT — sources and their tables. Collapsible, because once a table is picked the canvas
            is worth more than an always-visible list; the slim rail keeps the current selection
            visible, so collapsing loses context rather than state. */}
        <Col xs={24} lg={railCollapsed ? 1 : 4}>
          {railCollapsed ? (
            <PanelShell>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 4px',
                }}
              >
                <Tooltip title="Show sources and tables" placement="right">
                  <Button
                    size="small"
                    type="text"
                    icon={<RightOutlined />}
                    onClick={() => setRailCollapsed(false)}
                    aria-label="Expand the sources panel"
                  />
                </Tooltip>
                <Tooltip
                  title={
                    selectedSource
                      ? `${selectedSource.sourceId}${selectedTable ? ` · ${displayName}` : ''}`
                      : 'No source selected'
                  }
                  placement="right"
                >
                  <span style={{ color: selectedSource ? MT.orangeHi : MT.dim }}>
                    <DatabaseOutlined />
                  </span>
                </Tooltip>
              </div>
            </PanelShell>
          ) : (
            <PanelShell>
              <div
                style={{
                  padding: '12px 15px',
                  borderBottom: `1px solid ${MT.line}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <h3
                  style={{
                    fontSize: 12.5,
                    margin: 0,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: MT.mut,
                    fontWeight: 600,
                  }}
                >
                  Sources · {structured.length}
                </h3>
                <Tooltip title="Collapse this panel">
                  <Button
                    size="small"
                    type="text"
                    icon={<LeftOutlined />}
                    onClick={() => setRailCollapsed(true)}
                    aria-label="Collapse the sources panel"
                  />
                </Tooltip>
              </div>
              <div style={{ padding: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {structured.map((s) => {
                    const active = s.sourceId === selectedSource?.sourceId
                    return (
                      <button
                        type="button"
                        key={s.sourceId}
                        onClick={() => setSelectedSourceId(s.sourceId)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 9,
                          padding: '8px 9px',
                          textAlign: 'left',
                          borderRadius: MT.rS,
                          border: `1px solid ${active ? MT.orangeLine : MT.line}`,
                          background: active ? MT.orangeSoft : MT.card,
                          cursor: 'pointer',
                        }}
                      >
                        <ConnectorIcon connector={s.connector} size={18} />
                        <span style={{ minWidth: 0 }}>
                          <span
                            style={{
                              display: 'block',
                              fontSize: 12.5,
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {s.sourceName}
                          </span>
                          <span style={{ fontSize: 10.5, color: MT.dim }}>
                            {s.profiledTables} table(s) profiled
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div style={{ marginTop: 6 }}>
                  {modelLoading && tables.length === 0 ? (
                    <Skeleton active paragraph={{ rows: 3 }} />
                  ) : (
                    <ModelTableList
                      tables={tables}
                      entities={entities}
                      edges={edges}
                      selectedTableKey={selectedTableKey}
                      onSelect={setSelectedTableKey}
                    />
                  )}
                </div>
              </div>
            </PanelShell>
          )}
        </Col>

        {/* CENTRE — the counts, and the canvas. */}
        <Col xs={24} lg={railCollapsed ? 16 : 13}>
          <PanelShell>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '11px 14px',
                borderBottom: `1px solid ${MT.line}`,
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <StatItem value={tables.length} label="tables" />
                <StatItem
                  value={confirmedCount}
                  label="relationships confirmed"
                  color={MT.green}
                />
                <StatItem value={pendingCount} label="suggested, pending" color={MT.amber} />
                <StatItem value={columnsDescribed} label="columns described" />
              </div>
              <Space size={8}>
                <Tooltip title="Reads this source's profiled columns and offers the joins a shared identifier implies. No model is involved — every suggestion quotes the figures the profiler recorded.">
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    loading={suggesting}
                    disabled={!selectedSource || tables.length === 0}
                    onClick={() => void runSuggestions()}
                  >
                    {suggesting ? 'Reading the schema' : 'Suggest from schema'}
                  </Button>
                </Tooltip>
                <Button
                  size="small"
                  icon={<ExpandOutlined />}
                  onClick={() => fitRef.current?.()}
                >
                  Fit
                </Button>
              </Space>
            </div>

            {suggestError ? (
              <Alert
                type="error"
                showIcon
                closable
                onClose={() => setSuggestError(null)}
                title={`Suggestions failed: ${suggestError}`}
                style={{ margin: '0 14px 10px' }}
              />
            ) : null}
            {/* The server's own `degraded`, in the words it means: this is a structural read, and
                what a reviewer needs in order to weigh a suggestion is knowing that. */}
            {!suggestError && suggestDegraded ? (
              <Alert
                type="info"
                showIcon
                closable
                onClose={() => setSuggestDegraded(false)}
                title="Structural matches only — no model was involved. Every suggestion quotes the distinct counts the profiler recorded."
                style={{ margin: '0 14px 10px' }}
              />
            ) : null}
            {!suggestError && suggestTruncated !== null ? (
              <Alert
                type="warning"
                showIcon
                closable
                onClose={() => setSuggestTruncated(null)}
                title={`Read the first ${suggestTruncated} tables — this source has more, and a pair-wise scan over all of them would offer a list nobody could read.`}
                style={{ margin: '0 14px 10px' }}
              />
            ) : null}

            <EntityCanvas
              tables={tables}
              entities={entities}
              edges={edges}
              selectedTableKey={selectedTableKey}
              onSelect={setSelectedTableKey}
              onSelectEdge={openRelationship}
              onAddRelationshipFor={(tableKey) => {
                setSelectedTableKey(tableKey)
                setDetailTab('relationships')
                openCreate(tableKey)
              }}
              onAddMetricFor={(tableKey) => {
                setSelectedTableKey(tableKey)
                setDetailTab('metrics')
              }}
              fitRef={fitRef}
            />
          </PanelShell>
        </Col>

        {/* RIGHT — everything declared about the table in hand. */}
        <Col xs={24} lg={7}>
          <PanelShell>
            {!selectedTable ? (
              <div style={{ padding: 20 }}>
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  Pick a table on the left, or a card on the canvas, to see its Overview, columns,
                  relationships and metrics.
                </Text>
              </div>
            ) : (
              <>
                <div style={{ padding: '14px 16px 0' }}>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: MT.dim,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      marginBottom: 3,
                    }}
                  >
                    Entity detail
                  </div>
                  <h2
                    style={{
                      fontSize: 17,
                      margin: '0 0 3px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      minWidth: 0,
                    }}
                  >
                    <Tooltip title={displayName}>
                      <span
                        style={{
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          minWidth: 0,
                        }}
                      >
                        {displayName}
                      </span>
                    </Tooltip>
                    {selectedEntity ? (
                      <StatusPill variant="confirmed" icon>
                        Declared
                      </StatusPill>
                    ) : (
                      <StatusPill variant="mut">Not yet declared</StatusPill>
                    )}
                  </h2>
                  <div
                    style={{
                      fontSize: 11,
                      color: MT.dim,
                      fontFamily: MT.mono,
                      marginBottom: 12,
                    }}
                  >
                    {selectedTable.tableKey} · {selectedTable.type}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 2,
                    padding: '0 12px',
                    borderBottom: `1px solid ${MT.line}`,
                  }}
                >
                  {DETAIL_TABS.map((tab) => {
                    const on = detailTab === tab.key
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setDetailTab(tab.key)}
                        style={{
                          padding: '9px 12px',
                          fontSize: 12,
                          fontWeight: 600,
                          color: on ? MT.orangeHi : MT.dim,
                          border: 'none',
                          borderBottom: `2px solid ${on ? MT.orangeHi : 'transparent'}`,
                          background: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        {tab.label}
                      </button>
                    )
                  })}
                </div>

                <div style={{ padding: '15px 16px 18px' }}>
                  {detailTab === 'overview' ? (
                    <EntityOverviewPanel
                      key={`${selectedTable.tableKey}-overview`}
                      table={selectedTable}
                      entity={selectedEntity}
                      suggestion={tableSuggestions[selectedTable.tableKey] ?? null}
                    />
                  ) : null}
                  {detailTab === 'columns' && selectedSource ? (
                    <EntityColumnsPanel
                      key={`${selectedTable.tableKey}-columns`}
                      table={selectedTable}
                      tables={tables}
                      entities={entities}
                      entity={selectedEntity}
                      sourceId={selectedSource.sourceId}
                    />
                  ) : null}
                  {detailTab === 'relationships' ? (
                    <EntityRelationshipsPanel
                      key={`${selectedTable.tableKey}-relationships`}
                      table={selectedTable}
                      tables={tables}
                      entities={entities}
                      relationships={relationships}
                      onOpen={openRelationship}
                      onCreate={() => openCreate(selectedTable.tableKey)}
                      onDelete={(id) => void removeRelationship(id)}
                    />
                  ) : null}
                  {detailTab === 'metrics' ? (
                    <EntityMetricsPanel
                      key={`${selectedTable.tableKey}-metrics`}
                      table={selectedTable}
                      tables={tables}
                      entities={entities}
                      entity={selectedEntity}
                      relationships={relationships}
                    />
                  ) : null}
                </div>
              </>
            )}
          </PanelShell>
        </Col>
      </Row>

      <RelationshipModal
        target={relationshipTarget}
        tables={tables}
        entities={entities}
        createFromTableKey={createFromTableKey}
        onClose={() => setRelationshipTarget(null)}
        onSave={(input, editId) => void saveRelationship(input, editId)}
        onConfirm={(id, edit) => void confirmRelationship(id, edit)}
        onReject={(id) => void removeRelationship(id)}
        onDelete={(id) => void removeRelationship(id)}
        saving={saving}
      />
    </>
  )
}
