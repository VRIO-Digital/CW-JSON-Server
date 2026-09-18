import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { Button, Popconfirm, Space, Typography } from 'antd'
import { SP } from '../../theme'

/**
 * One row on the Playground — **a metric or a golden query, drawn the same way.**
 *
 * They are the same shape on screen because they are the same kind of thing: something this use case
 * asked for, what it means, and the query that answers it. One component rather than two, so the two
 * tabs cannot come to state a provenance tag or a missing query differently — the drift a second copy
 * of a row would introduce one tab apart.
 *
 * **The provenance tag is not a status tag.** It says *who drafted this*, which is never a state, so
 * it is drawn as plain letterspaced text rather than borrowing `STATUS.good`/`warn` — the rule this
 * repo keeps everywhere: a class chip must not be mistakable for a state.
 */
export default function PlaygroundRow({
  title,
  tag,
  marks,
  description,
  sql,
  noSql,
  onEdit,
  onDelete,
  deleteConfirm,
  deleteDetail,
  busy,
}: {
  title: string
  tag: string
  /** Anything the row states beyond its provenance — the High flag on a golden query. */
  marks?: React.ReactNode
  description: string | null
  sql: string | null
  noSql: string
  onEdit: () => void
  onDelete: () => void
  deleteConfirm: string
  deleteDetail: string
  busy: boolean
}) {
  return (
    <div className="pg-row">
      <div className="pg-row-main">
        <Space size={SP.sm} wrap align="center">
          <Typography.Text strong className="pg-row-title">
            {title}
          </Typography.Text>
          <span className="pg-row-tag">{tag}</span>
          {marks}
        </Space>
        {description ? (
          <Typography.Paragraph type="secondary" className="pg-row-detail">
            {description}
          </Typography.Paragraph>
        ) : null}
        {/*
          * The query, or the sentence that says there is none and where to write one. **Never an
          * empty code block** — a blank frame reads as a query that failed to load rather than as
          * one nobody has written.
          */}
        {sql ? (
          <pre className="pg-row-sql">{sql}</pre>
        ) : (
          <Typography.Text type="secondary" italic className="pg-row-nosql">
            {noSql}
          </Typography.Text>
        )}
      </div>
      <Space size={SP.xs} className="pg-row-acts">
        <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} disabled={busy} />
        {/*
          * The confirmation states what removing costs, because this writes to the brief: the
          * wizard stops listing the row too, which is not something the reader can see from here.
          */}
        <Popconfirm
          title={deleteConfirm}
          description={deleteDetail}
          okText="Remove"
          okButtonProps={{ danger: true }}
          onConfirm={onDelete}
        >
          <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={busy} />
        </Popconfirm>
      </Space>
    </div>
  )
}
