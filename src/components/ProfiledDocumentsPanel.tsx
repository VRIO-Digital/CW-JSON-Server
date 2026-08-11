import { CloseOutlined, DownOutlined, EditOutlined } from '@ant-design/icons'
import {
  App,
  Button,
  Empty,
  Flex,
  Input,
  Modal,
  Spin,
  Table,
  Tag,
  Typography,
  type TableColumnsType,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ProfiledDocument, ProfiledEntity, SourceRow } from '../api/client'
import { fileKind } from '../data/mimeTypes'
import { useDocumentsStore } from '../store/catalogueStore'
import './ProfiledColumnsPanel.css'

type FacetKey =
  | 'all'
  | 'needs_review'
  | 'pii'
  | 'consent_decrees'
  | 'complaints'
  | 'settlements'
  | 'cafos'

const FACETS: { key: FacetKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'pii', label: 'PII' },
  { key: 'consent_decrees', label: 'Consent decrees' },
  { key: 'complaints', label: 'Complaints' },
  { key: 'settlements', label: 'Settlements' },
  { key: 'cafos', label: 'CAFOs' },
]

/**
 * Facets filter documents here, not entities — a file is the reviewed unit.
 * They match `doc_type`, the slug, not `doc_type_label`: a consent-decree
 * modification belongs under Consent decrees, and only the label says it is one.
 */
const TYPE_FOR_FACET: Partial<Record<FacetKey, string>> = {
  consent_decrees: 'consent_decree',
  complaints: 'complaint',
  settlements: 'settlement',
  cafos: 'cafo',
}

/** snake_case → "SIGNATORY EMAIL", matching the column dictionary. */
const displayName = (id: string) => id.replace(/_/g, ' ').toUpperCase()

function matches(document: ProfiledDocument, facet: FacetKey) {
  if (facet === 'all') return true
  if (facet === 'needs_review') return document.summary_status === 'needs review'
  if (facet === 'pii') return document.pii_count > 0
  return document.doc_type === TYPE_FOR_FACET[facet]
}

export default function ProfiledDocumentsPanel({
  source,
  onClose,
}: {
  source: SourceRow
  onClose: () => void
}) {
  const { message } = App.useApp()
  const data = useDocumentsStore((s) => s.data)
  const loading = useDocumentsStore((s) => s.loading)
  const error = useDocumentsStore((s) => s.error)
  const loadDocuments = useDocumentsStore((s) => s.load)
  const summarise = useDocumentsStore((s) => s.summarise)
  const [facet, setFacet] = useState<FacetKey>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{
    folder_id: string
    document: ProfiledDocument
  } | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void loadDocuments(source.sourceId)
  }, [loadDocuments, source.sourceId])

  // Open every document by default so entities are visible as they arrive.
  useEffect(() => {
    if (!data) return
    setOpen(
      new Set(
        data.folders.flatMap((f) =>
          f.documents.map((d) => `${f.folder_id}.${d.document_id}`),
        ),
      ),
    )
  }, [data])

  useEffect(() => {
    if (error) message.error(error)
  }, [error, message])

  const columns: TableColumnsType<ProfiledEntity> = useMemo(
    () => [
      {
        title: 'entity',
        dataIndex: 'entity_id',
        render: (id: string) => <span className="pc-name">{displayName(id)}</span>,
      },
      {
        title: 'type',
        dataIndex: 'type',
        width: 90,
        render: (t: string) => <span className="pc-type">{t}</span>,
      },
      {
        title: 'class',
        key: 'class',
        width: 190,
        render: (_, entity) => (
          <span className="pc-class">
            <Tag className={`pc-class-tag is-${entity.class}`}>{entity.class}</Tag>
            <span className="pc-conf">llm {entity.confidence.toFixed(2)}</span>
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
        title: 'occurrences',
        dataIndex: 'occurrences',
        width: 120,
        render: (v: number) => <span className="pc-num">{v.toLocaleString()}</span>,
      },
      {
        title: 'coverage',
        dataIndex: 'coverage_pct',
        width: 100,
        render: (v: number) => <span className="pc-num">{v.toFixed(1)}%</span>,
      },
    ],
    [],
  )

  async function saveSummary() {
    if (!editing) return
    const result = await summarise(source.sourceId, {
      folder_id: editing.folder_id,
      document_id: editing.document.document_id,
      summary: draft,
    })
    if (!result.ok) {
      message.error(result.error)
      return
    }
    message.success(draft ? 'Summary saved.' : 'Summary cleared.')
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

  return (
    <div className="pc-panel">
      <Flex justify="flex-end">
        <Button type="link" size="small" icon={<CloseOutlined />} onClick={onClose}>
          close
        </Button>
      </Flex>

      {loading ? (
        <Spin />
      ) : !data || data.profiled_documents === 0 ? (
        <Empty
          image={null}
          description="No documents profiled yet — run Browse documents for profiling first."
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
          {`${data.profiled_documents} profiled document(s) across ${data.folder_count} folder(s), ${data.entity_count} entities extracted · click a document to see what came out of it`}
        </Typography.Paragraph>

        {data.folders.map((f) => {
          const visible = f.documents.filter((d) => matches(d, facet))
          return (
            <div key={f.folder_id} className="pc-dataset">
              <div className="pc-dataset-head">
                <span className="pc-dataset-name">{f.name}</span>
                <span className="pc-dataset-meta">
                  {`· ${f.document_count} document(s), ${f.entity_count} entities`}
                </span>
              </div>

              {visible.length === 0 ? (
                <Typography.Paragraph className="pc-none">
                  No documents in this folder match this filter.
                </Typography.Paragraph>
              ) : (
                visible.map((d) => {
                  const key = `${f.folder_id}.${d.document_id}`
                  const isOpen = open.has(key)
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
                          <Tag className="pc-kind">{fileKind(d.mime_type)}</Tag>
                          <span className="pc-table-name">{d.name}</span>
                          {/* Neutral, not a status colour: what a document is
                              and who it is about are categories, not state. */}
                          <Tag className="pc-class-tag">{d.doc_type_label}</Tag>
                          <span className="pc-linked">{d.linked_entity}</span>
                        </span>
                        <span className="pc-table-meta">
                          {`${d.entity_count} entities · ${d.pages} pages · ${d.chunks} chunks` +
                            (d.pii_count > 0 ? ` · ${d.pii_count} pii` : '')}
                        </span>
                      </button>

                      {/*
                        Where this file landed in the graph — the point of
                        profiling it. Real, from the extraction map, so the node
                        id and the manifest count are stated rather than implied;
                        a document that resolved to nothing says so instead of
                        rendering an empty row.
                      */}
                      <div className="pc-resolution">
                        {d.resolution ? (
                          <>
                            <span className="pc-res-arrow" aria-hidden="true">
                              ↳
                            </span>
                            <Tag className="pc-class-tag is-identifier">
                              {d.resolution.resolved_node}
                            </Tag>
                            <span className="pc-res-entity">
                              {d.resolution.resolved_facility}
                            </span>
                            <span className="pc-res-meta">
                              {`${d.resolution.entity_type} · ${d.resolution.state} · ` +
                                `${d.resolution.linked_manifests.toLocaleString()} linked manifest(s) · ` +
                                `extraction ${d.resolution.confidence.toFixed(2)}`}
                            </span>
                          </>
                        ) : (
                          <span className="pc-res-meta">
                            No graph entity resolved from this document yet.
                          </span>
                        )}
                      </div>

                      {/* The summary sits outside the toggle: it is the note a
                          curator writes, and a button cannot nest in a button. */}
                      <div className="pc-desc pc-doc-summary">
                        {d.summary ? (
                          <Typography.Text
                            ellipsis={{ tooltip: d.summary }}
                            style={{ maxWidth: 460 }}
                          >
                            {d.summary}
                          </Typography.Text>
                        ) : (
                          <Tag color="warning" variant="filled">
                            needs review
                          </Tag>
                        )}
                        <Button
                          type="text"
                          size="small"
                          aria-label={`Edit summary for ${d.name}`}
                          icon={<EditOutlined />}
                          onClick={() => {
                            setEditing({ folder_id: f.folder_id, document: d })
                            setDraft(d.summary ?? '')
                          }}
                        />
                      </div>

                      {isOpen ? (
                        <Table
                          className="pc-columns"
                          columns={columns}
                          dataSource={d.entities}
                          rowKey="entity_id"
                          size="small"
                          pagination={
                            d.entities.length > 25 ? { pageSize: 25, size: 'small' } : false
                          }
                          scroll={{ x: 'max-content' }}
                        />
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          )
        })}
        </>
      )}

      <Modal
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void saveSummary()}
        okText="Save"
        title={editing ? editing.document.name : ''}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          {editing?.folder_id} ·{' '}
          <Typography.Text code>{editing?.document.doc_type}</Typography.Text> ·{' '}
          {editing?.document.pages} page(s) · {editing?.document.entity_count} entities
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What this document is, and anything a consumer should know."
        />
      </Modal>
    </div>
  )
}
