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
import type { ProfiledEntity, ProfiledMailDocument, SourceRow } from '../../api/client'
import { fileKind } from '../../data/mimeTypes'
import { useMailDocumentsStore } from '../../store/catalogStore'
import './ProfiledColumnsPanel.css'

/*
 * Three chips are this app's — every corpus has documents, some needing review and some holding
 * PII. The rest are the mailbox's own labels and arrive on the payload as `label_facets`.
 *
 * There is no `DOC_TYPE_LABEL` twin here and there does not need to be: a drive document's kind
 * is a slug that has to be given a label somewhere, while a mail document's grouping *is* the
 * label Gmail filed its message under — real data that already carries its own name.
 */
type FixedFacet = 'all' | 'needs_review' | 'pii'
type FacetKey = FixedFacet | string

const FIXED_FACETS: { key: FixedFacet; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'pii', label: 'PII' },
]

/** snake_case → "SIGNATORY EMAIL", matching the column and document dictionaries. */
const displayName = (id: string) => id.replace(/_/g, ' ').toUpperCase()

/** The date a reader recognises, not an ISO stamp. */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

/**
 * Facets filter documents here, not entities — a document is the reviewed unit, as it is for a
 * drive.
 *
 * A label chip's key **is** the label, so this is a comparison rather than a lookup through a
 * table the panel keeps.
 */
function matches(doc: ProfiledMailDocument, facet: FacetKey) {
  if (facet === 'all') return true
  if (facet === 'needs_review') return doc.summary_status === 'needs review'
  if (facet === 'pii') return doc.pii_count > 0
  return doc.label === facet
}

/**
 * The mail document dictionary — grouped label → document → entities.
 *
 * Its one real difference from the drive dictionary is what sits under each row. A drive
 * document states the graph node its entity resolved to, because that resolution is the point of
 * profiling a filing. A mail document states that it resolved *nothing*, on purpose: mail is read
 * at question time, so what comes out of it is a claim about a subject the graph already holds
 * rather than a fact merged into it. That is a sentence rather than a blank, for the reason a
 * drive document that resolved to nothing says so.
 *
 * **Each row names the message the document arrived on.** A document in a mailbox is not
 * self-locating the way one in a folder is: the corpus reuses filename stems, so
 * `signed-agreement.pdf` alone is ambiguous and who sent it is how a reader tells two apart.
 */
export default function ProfiledMailDocumentsPanel({ source }: { source: SourceRow }) {
  const { message } = App.useApp()
  const data = useMailDocumentsStore((s) => s.data)
  const loading = useMailDocumentsStore((s) => s.loading)
  const error = useMailDocumentsStore((s) => s.error)
  const loadDocuments = useMailDocumentsStore((s) => s.load)
  const summarise = useMailDocumentsStore((s) => s.summarise)
  const [facet, setFacet] = useState<FacetKey>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<{
    label_id: string
    document: ProfiledMailDocument
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
        data.labels.flatMap((l) =>
          l.documents.map((d) => `${l.label_id}.${d.document_id}`),
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
      label_id: editing.label_id,
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
      {loading ? (
        <Spin />
      ) : !data || data.profiled_documents === 0 ? (
        <Empty
          image={null}
          description="No documents profiled yet — run Browse documents for profiling first."
        />
      ) : (
        <>
          {/*
            * The three fixed chips carry their count from `facets`; each label chip carries its
            * own, since the served row *is* {key, label, count}.
            */}
          <div className="pc-facets">
            {[
              ...FIXED_FACETS.map((f) => ({
                key: f.key as string,
                label: f.label,
                count: data.facets[f.key],
              })),
              ...data.label_facets,
            ].map((f) => (
              <button
                type="button"
                key={f.key}
                className={`pc-chip${facet === f.key ? ' is-active' : ''}`}
                onClick={() => setFacet(f.key)}
              >
                {f.label} <span className="pc-chip-count">{f.count}</span>
              </button>
            ))}
          </div>

          {/*
            * One sentence, one expression — React splits `text {expr} text` into separate nodes,
            * and this line is asserted on as the sentence it renders as.
            *
            * The profiled count is stated against everything attached under the connected
            * labels, because "5 profiled" leaves a reader to guess whether that is all of it.
            */}
          <Typography.Paragraph className="pc-summary">
            {`${data.profiled_documents} of ${data.document_total} attached document(s) profiled across ${data.label_count} label(s), ${data.entity_count} entities extracted · click a document to see what came out of it`}
          </Typography.Paragraph>

          {data.labels.map((l) => {
            const visible = l.documents.filter((d) => matches(d, facet))
            return (
              <div key={l.label_id} className="pc-dataset">
                <div className="pc-dataset-head">
                  <span className="pc-dataset-name">{l.name}</span>
                  <span className="pc-dataset-meta">
                    {`· ${l.document_count} document(s), ${l.entity_count} entities`}
                  </span>
                </div>

                {visible.length === 0 ? (
                  <Typography.Paragraph className="pc-none">
                    No documents under this label match this filter.
                  </Typography.Paragraph>
                ) : (
                  visible.map((d) => {
                    const key = `${l.label_id}.${d.document_id}`
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
                            <DownOutlined
                              className={`pc-caret${isOpen ? ' is-open' : ''}`}
                            />
                            <Tag className="pc-kind">{fileKind(d.mime_type)}</Tag>
                            <span className="pc-table-name">{d.name}</span>
                            {/* Neutral, not a status colour: the message a document arrived on
                                is a category, not a state. */}
                            <Tag className="pc-class-tag">{d.subject}</Tag>
                            <span className="pc-linked">
                              {d.direction === 'sent'
                                ? `to ${d.to_name}`
                                : `from ${d.from_name}`}
                            </span>
                          </span>
                          <span className="pc-table-meta">
                            {`${d.entity_count} entities · ${shortDate(d.received)} · ${d.size_kb} KB · ${d.chunks} chunks` +
                              (d.pii_count > 0 ? ` · ${d.pii_count} pii` : '')}
                          </span>
                        </button>

                        {/*
                          What this document contributed, and to what. A drive document's twin of
                          this row names the graph node its entity resolved to; a mail document
                          resolves to nothing by design, so the row says that rather than being
                          dropped — otherwise a reader comparing the two dictionaries would read
                          the absence as a resolution that failed.
                        */}
                        <div className="pc-resolution">
                          <span className="pc-res-arrow" aria-hidden="true">
                            ↳
                          </span>
                          <span className="pc-res-meta">
                            Read at question time — these extractions are observations about
                            subjects the graph already holds, and none of them becomes a graph
                            element.
                          </span>
                        </div>

                        {/* The summary sits outside the toggle: it is the note a curator
                            writes, and a button cannot nest in a button. */}
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
                              setEditing({ label_id: l.label_id, document: d })
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
                              d.entities.length > 25
                                ? { pageSize: 25, size: 'small' }
                                : false
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
          {editing?.label_id} ·{' '}
          <Typography.Text code>{editing?.document.message_id}</Typography.Text> ·{' '}
          {editing?.document.chunks} chunk(s) · {editing?.document.entity_count} entities
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
