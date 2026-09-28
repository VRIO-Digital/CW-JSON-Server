import { DeleteOutlined, PaperClipOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { Alert, Button, Checkbox, Form, Input, Modal, Popconfirm, Space, Tag, Typography } from 'antd'
import { useRef, useState } from 'react'
import type { GoldenQuery, PlaygroundFile } from '../../api/client'
import {
  fileProblem,
  manualQuery,
  playgroundCopy,
  provenanceTag,
  queryProblem,
  uploadedByLabel,
  withoutFile,
  withoutQuery,
  withQuery,
} from '../../data/playground'
import { SP } from '../../theme'
import PlaygroundRow from './PlaygroundRow'

/**
 * The Playground's Golden Queries tab — **the hero questions this use case accepted, and the SQL
 * that answers each.**
 *
 * The rows are the brief's own `hero_questions`: the ones accepted on step 5 of New Graph, carrying
 * the `sql` that step already composes for them. So a query written on step 5 is the query on this
 * screen, and neither is a copy of the other.
 *
 * **A file can be attached, and only its name travels.** No parser reads it and no question is added
 * from it — questions invented out of a file are exactly what this list must not hold — so the panel
 * says that in words rather than leaving a reader waiting for rows that are never coming.
 */
export function GoldenQueriesPanel({
  queries,
  files,
  queryCap,
  fileCap,
  busy,
  onEdit,
  onDelete,
  onAdd,
  onUpload,
  onRemoveFile,
}: {
  queries: GoldenQuery[]
  files: PlaygroundFile[]
  queryCap: number
  fileCap: number
  busy: boolean
  onEdit: (query: GoldenQuery) => void
  onDelete: (query: GoldenQuery) => void
  onAdd: () => void
  onUpload: () => void
  onRemoveFile: (file: PlaygroundFile) => void
}) {
  return (
    <Space direction="vertical" size={SP.md} style={{ width: '100%' }}>
      <div className="pg-heading">{playgroundCopy.queries.heading}</div>

      {queries.length === 0 ? (
        <Alert type="info" showIcon title={playgroundCopy.queries.empty} />
      ) : (
        queries.map((query) => (
          <PlaygroundRow
            key={query.text}
            title={query.text}
            tag={provenanceTag(query)}
            /* High is a flag the brief carries, and it is the one thing on this row that is a
               *state* rather than a provenance — so it wears a tag and the provenance does not. */
            marks={query.priority === 'high' ? <Tag color="orange">HIGH</Tag> : null}
            description={null}
            sql={query.sql}
            noSql={playgroundCopy.queries.noSql}
            busy={busy}
            onEdit={() => onEdit(query)}
            onDelete={() => onDelete(query)}
            deleteConfirm={playgroundCopy.queries.deleteConfirm}
            deleteDetail={playgroundCopy.queries.deleteDetail}
          />
        ))
      )}

      <Space size={SP.sm} wrap align="center">
        <Button icon={<PlusOutlined />} onClick={onAdd} disabled={busy || queries.length >= queryCap}>
          {playgroundCopy.queries.add}
        </Button>
        <Button icon={<UploadOutlined />} onClick={onUpload} disabled={busy || files.length >= fileCap}>
          {playgroundCopy.files.add}
        </Button>
        {queries.length >= queryCap ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {`A use case keeps at most ${queryCap} golden queries. Remove one before adding another.`}
          </Typography.Text>
        ) : null}
      </Space>

      <div className="pg-heading" style={{ marginTop: SP.sm }}>
        {playgroundCopy.files.heading}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {playgroundCopy.files.note}
      </Typography.Text>
      {files.length === 0 ? (
        <Typography.Text type="secondary" italic style={{ fontSize: 12.5 }}>
          {playgroundCopy.files.empty}
        </Typography.Text>
      ) : (
        files.map((file) => (
          <div className="pg-file" key={file.name}>
            <PaperClipOutlined />
            <span className="pg-file-name">{file.name}</span>
            <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
              {`${new Date(file.uploadedAt).toLocaleDateString()} · ${uploadedByLabel(file)}`}
            </Typography.Text>
            <Popconfirm
              title={playgroundCopy.files.deleteConfirm}
              okText="Remove"
              okButtonProps={{ danger: true }}
              onConfirm={() => onRemoveFile(file)}
              placement="topRight"
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={busy} />
            </Popconfirm>
          </div>
        ))
      )}
    </Space>
  )
}

export default function PlaygroundGoldenQueries({
  queries,
  files,
  queryCap,
  fileCap,
  busy,
  signedInAs,
  onSaveQueries,
  onSaveFiles,
  onError,
}: {
  queries: GoldenQuery[]
  files: PlaygroundFile[]
  queryCap: number
  fileCap: number
  busy: boolean
  signedInAs: string | null
  onSaveQueries: (next: GoldenQuery[]) => void
  onSaveFiles: (next: PlaygroundFile[]) => void
  onError: (message: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sql, setSql] = useState('')
  const [high, setHigh] = useState(false)
  const picker = useRef<HTMLInputElement | null>(null)

  const start = (query: GoldenQuery | null) => {
    setEditing(query?.text ?? null)
    setText(query?.text ?? '')
    setSql(query?.sql ?? '')
    setHigh(query?.priority === 'high')
    setOpen(true)
  }

  const problem = queryProblem(text, queries, queryCap, editing)

  const commit = () => {
    if (problem) return
    const previous = queries.find((q) => q.text === editing) ?? null
    /* An edit keeps who drafted the question; only what it says and how it is answered change. */
    const next: GoldenQuery = previous
      ? {
          ...previous,
          text: text.trim(),
          priority: high ? 'high' : 'normal',
          sql: sql.trim() ? sql : null,
        }
      : manualQuery(text, sql, high)
    onSaveQueries(withQuery(queries, next, editing))
    setOpen(false)
  }

  /*
   * The file is never read — `input.files[0].name` is the whole of what is taken, which is what the
   * note above the list promises. The input is reset afterwards so picking the same file twice still
   * fires a change (a `change` event does not fire for an unchanged value).
   */
  const pick = (chosen: File | null) => {
    if (!chosen) return
    const refusal = fileProblem(chosen.name, files, fileCap)
    if (refusal) return onError(refusal)
    onSaveFiles([
      ...files,
      { name: chosen.name, uploadedAt: new Date().toISOString(), uploadedBy: signedInAs },
    ])
  }

  return (
    <>
      <GoldenQueriesPanel
        queries={queries}
        files={files}
        queryCap={queryCap}
        fileCap={fileCap}
        busy={busy}
        onEdit={(query) => start(query)}
        onDelete={(query) => onSaveQueries(withoutQuery(queries, query.text))}
        onAdd={() => start(null)}
        onUpload={() => picker.current?.click()}
        onRemoveFile={(file) => onSaveFiles(withoutFile(files, file.name))}
      />

      <input
        ref={picker}
        type="file"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />

      <Modal
        open={open}
        title={editing === null ? playgroundCopy.queries.addTitle : playgroundCopy.queries.editTitle}
        onCancel={() => setOpen(false)}
        onOk={commit}
        okButtonProps={{ disabled: problem !== null, loading: busy }}
        okText="Save"
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label={playgroundCopy.queries.textLabel}>
            <Input.TextArea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={playgroundCopy.queries.textPlaceholder}
            />
          </Form.Item>
          <Form.Item label={playgroundCopy.queries.sqlLabel}>
            <Input.TextArea
              rows={6}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder={playgroundCopy.queries.sqlPlaceholder}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
            />
          </Form.Item>
          <Form.Item>
            <Checkbox checked={high} onChange={(e) => setHigh(e.target.checked)}>
              {playgroundCopy.queries.highLabel}
            </Checkbox>
          </Form.Item>
          {problem ? <Alert type="warning" showIcon title={problem} /> : null}
        </Form>
      </Modal>
    </>
  )
}
