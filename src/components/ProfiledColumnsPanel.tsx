import { DownOutlined, EditOutlined } from '@ant-design/icons'
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Spin,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type {
  ColumnClass,
  ProfiledColumn,
  ProfiledTable,
  SourceRow,
} from '../api/client'
import { useColumnsStore } from '../store/catalogueStore'
import './ProfiledColumnsPanel.css'

type FacetKey =
  | 'all'
  | 'needs_review'
  | 'pii'
  | 'ids'
  | 'measures'
  | 'dates'
  | 'location'
  | 'flags'

const FACETS: { key: FacetKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'pii', label: 'PII' },
  { key: 'ids', label: 'IDs' },
  { key: 'measures', label: 'Measures' },
  { key: 'dates', label: 'Dates' },
  { key: 'location', label: 'Location' },
  { key: 'flags', label: 'Flags' },
]

/**
 * One facet can cover more than one class: `address` and `geo` both answer
 * "where", and splitting them would give two chips nobody picks between. The
 * server folds them the same way — `check-docs` asserts the two agree.
 */
const CLASSES_FOR_FACET: Partial<Record<FacetKey, ColumnClass[]>> = {
  ids: ['identifier'],
  measures: ['measure'],
  dates: ['date'],
  location: ['address', 'geo'],
  flags: ['flag'],
}

/** snake_case → "FOREIGN GENERATOR PROVINCE", for a column with no stated label. */
const displayName = (id: string) => id.replace(/_/g, ' ').toUpperCase()

function matches(column: ProfiledColumn, facet: FacetKey) {
  if (facet === 'all') return true
  if (facet === 'needs_review') return column.description_status === 'needs review'
  if (facet === 'pii') return column.pii
  return (CLASSES_FOR_FACET[facet] ?? []).includes(column.class)
}

export default function ProfiledColumnsPanel({
  source,
}: {
  source: SourceRow
}) {
  const { message } = App.useApp()
  const data = useColumnsStore((s) => s.data)
  const loading = useColumnsStore((s) => s.loading)
  const error = useColumnsStore((s) => s.error)
  const loadColumns = useColumnsStore((s) => s.load)
  const describe = useColumnsStore((s) => s.describe)
  const [facet, setFacet] = useState<FacetKey>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{
    dataset_id: string
    table_id: string
    column: ProfiledColumn
  } | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void loadColumns(source.sourceId)
  }, [loadColumns, source.sourceId])

  // Open every table by default so columns are visible as soon as they arrive.
  useEffect(() => {
    if (!data) return
    setOpen(
      new Set(
        data.datasets.flatMap((d) =>
          d.tables.map((t) => `${d.dataset_id}.${t.table_id}`),
        ),
      ),
    )
  }, [data])

  useEffect(() => {
    if (error) message.error(error)
  }, [error, message])

  const columns: TableColumnsType<ProfiledColumn> = useMemo(
    () => [
      {
        title: 'column',
        key: 'column',
        /* The profiler's own label when it has one, so a name it reports is never
           re-derived from the id and quietly changed. */
        render: (_, column) => (
          <span className="pc-name">{column.label || displayName(column.column_id)}</span>
        ),
      },
      {
        title: 'type',
        dataIndex: 'type',
        width: 90,
        render: (t: string) => <span className="pc-type">{t}</span>,
      },
      {
        title: 'description',
        key: 'description',
        width: 240,
        render: (_, col) => (
          <span className="pc-desc">
            {col.description ? (
              <Typography.Text ellipsis={{ tooltip: col.description }} style={{ maxWidth: 170 }}>
                {col.description}
              </Typography.Text>
            ) : null}
            {/* The flag follows the *status*, not the absence of text: a real
                column always has a description, and what makes it reviewable is
                that the profiler was below the High band. */}
            {col.description_status === 'needs review' ? (
              <Tag color="warning" variant="filled">
                needs review
              </Tag>
            ) : null}
            <Button
              type="text"
              size="small"
              aria-label={`Edit description for ${col.column_id}`}
              icon={<EditOutlined />}
              onClick={() => {
                const table = data?.datasets
                  .flatMap((d) =>
                    d.tables.map((t) => ({ dataset_id: d.dataset_id, table: t })),
                  )
                  .find((x) => x.table.columns.some((c) => c.column_id === col.column_id))
                if (!table) return
                setEditing({
                  dataset_id: table.dataset_id,
                  table_id: table.table.table_id,
                  column: col,
                })
                setDraft(col.description ?? '')
              }}
            />
          </span>
        ),
      },
      {
        title: 'class',
        key: 'class',
        width: 190,
        render: (_, col) => (
          <span className="pc-class">
            <Tag className={`pc-class-tag is-${col.class}`}>{col.class}</Tag>
            {/* The derivation is reported, not assumed: today every profiled
                column says `llm`, and a rule-derived one would say so here. */}
            <span className="pc-conf">
              {col.derivation} {col.confidence.toFixed(2)}
            </span>
          </span>
        ),
      },
      {
        title: 'pii',
        dataIndex: 'pii',
        width: 70,
        render: (pii: boolean) =>
          pii ? (
            <Tag color="error" variant="filled">
              pii
            </Tag>
          ) : (
            <span className="pc-dash">—</span>
          ),
      },
      {
        title: 'null%',
        dataIndex: 'null_pct',
        width: 90,
        render: (v: number) => <span className="pc-num">{v.toFixed(1)}%</span>,
      },
      {
        title: 'distinct',
        dataIndex: 'distinct',
        width: 100,
        render: (v: number) => <span className="pc-num">{v.toLocaleString()}</span>,
      },
    ],
    [data],
  )

  async function saveDescription() {
    if (!editing) return
    const result = await describe(source.sourceId, {
      dataset_id: editing.dataset_id,
      table_id: editing.table_id,
      column_id: editing.column.column_id,
      description: draft,
    })
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success(draft ? 'Description saved.' : 'Description cleared.')
    setEditing(null)
  }

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const visible = (table: ProfiledTable) => table.columns.filter((c) => matches(c, facet))

  return (
    <div className="pc-panel">

      {loading ? (
        <Spin />
      ) : !data || data.profiled_tables === 0 ? (
        <Empty
          image={null}
          description="No columns profiled yet — run Browse table for profiling first."
        />
      ) : (
        <>
          <div className="pc-facets">
            {FACETS.map((f) => (
              <button
                type="button"
                key={f.key}
                className={`pc-chip${facet === f.key ? ' is-active' : ''}`}
                onClick={() => setFacet(f.key)}
              >
                {f.label} <span className="pc-chip-count">{data.facets[f.key]}</span>
              </button>
            ))}
          </div>

          <Typography.Paragraph className="pc-summary">
            {data.profiled_tables} profiled table(s) across {data.dataset_count}{' '}
            dataset(s) · click a table to see its columns
          </Typography.Paragraph>

          {data.datasets.map((d) => (
            <div key={d.dataset_id} className="pc-dataset">
              <div className="pc-dataset-head">
                <span className="pc-dataset-name">{d.dataset_id}</span>
                <span className="pc-dataset-meta">
                  · {d.table_count} table(s), {d.column_count} cols
                </span>
              </div>

              {d.tables.map((t) => {
                const key = `${d.dataset_id}.${t.table_id}`
                const isOpen = open.has(key)
                const rows = visible(t)
                return (
                  <div key={key} className="pc-table-card">
                    <button
                      type="button"
                      className="pc-table-head"
                      onClick={() => toggle(key)}
                      aria-expanded={isOpen}
                    >
                      <span className="pc-table-left">
                        <DownOutlined className={`pc-caret${isOpen ? ' is-open' : ''}`} />
                        <Tag className="pc-kind">{t.type}</Tag>
                        <span className="pc-table-name">
                          {d.dataset_id}.{t.table_id}
                        </span>
                        {/* A column list only means something once the row it
                            describes is named — hence the grain, beside it. */}
                        <span className="pc-grain">
                          {t.label} · {t.grain}
                        </span>
                      </span>
                      <span className="pc-table-meta">
                        {t.column_count} cols · ~{t.rows.toLocaleString()} rows
                      </span>
                    </button>

                    {isOpen ? (
                      rows.length === 0 ? (
                        <Typography.Paragraph className="pc-none">
                          No columns match this filter.
                        </Typography.Paragraph>
                      ) : (
                        <Table
                          className="pc-columns"
                          columns={columns}
                          dataSource={rows}
                          rowKey="column_id"
                          size="small"
                          pagination={
                            rows.length > 25 ? { pageSize: 25, size: 'small' } : false
                          }
                          scroll={{ x: 'max-content' }}
                        />
                      )
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}

      <Modal
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void saveDescription()}
        okText="Save"
        title={
          editing ? editing.column.label || displayName(editing.column.column_id) : ''
        }
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          {editing?.dataset_id}.{editing?.table_id} ·{' '}
          <Typography.Text code>{editing?.column.type}</Typography.Text> ·{' '}
          {editing?.column.class}
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What this column means, and anything a consumer should know."
        />
      </Modal>
    </div>
  )
}
