import { PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, Modal, Space, Typography } from 'antd'
import { useState } from 'react'
import type { PlaygroundMetric } from '../../api/client'
import {
  manualMetric,
  metricProblem,
  playgroundCopy,
  provenanceTag,
  withMetric,
  withoutMetric,
} from '../../data/playground'
import { SP } from '../../theme'
import PlaygroundRow from './PlaygroundRow'

/**
 * The Playground's Metrics tab — **what this use case accepted, and the query each is answered by.**
 *
 * The rows are the brief's own `metrics`: the ones accepted on step 4 of New Graph. Nothing is
 * copied into a table of its own, so this screen and the wizard cannot come to list different
 * measures — the two-homes-for-one-record fault this repo refuses everywhere.
 *
 * **The list is exported apart from the dialog it opens**, because a `Modal` portals out of
 * `renderToString`: a row assertion written through a component that renders its editor inline would
 * pass over the rows entirely.
 */
export function MetricsPanel({
  metrics,
  cap,
  busy,
  onEdit,
  onDelete,
  onAdd,
}: {
  metrics: PlaygroundMetric[]
  cap: number
  busy: boolean
  onEdit: (metric: PlaygroundMetric) => void
  onDelete: (metric: PlaygroundMetric) => void
  onAdd: () => void
}) {
  return (
    <Space direction="vertical" size={SP.md} style={{ width: '100%' }}>
      <div className="pg-heading">{playgroundCopy.metrics.heading}</div>

      {metrics.length === 0 ? (
        <Alert type="info" showIcon title={playgroundCopy.metrics.empty} />
      ) : (
        metrics.map((metric) => (
          <PlaygroundRow
            key={metric.name}
            title={metric.name}
            tag={provenanceTag(metric)}
            description={metric.description || null}
            sql={metric.sql}
            noSql={playgroundCopy.metrics.noSql}
            /* The server's own reason, where it had one — a row with no query is one nothing in the
               profiled schema matched, which is a different fact from nobody having written one. */
            sqlNote={metric.sqlNote}
            busy={busy}
            onEdit={() => onEdit(metric)}
            onDelete={() => onDelete(metric)}
            deleteConfirm={playgroundCopy.metrics.deleteConfirm}
            deleteDetail={playgroundCopy.metrics.deleteDetail}
          />
        ))
      )}

      {/* Withheld at the cap rather than refusing after the reader has typed — the refusal sentence
          still exists for every other path in, and states the number. */}
      <Space size={SP.sm} wrap align="center">
        <Button icon={<PlusOutlined />} onClick={onAdd} disabled={busy || metrics.length >= cap}>
          {playgroundCopy.metrics.add}
        </Button>
        {metrics.length >= cap ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {`A use case keeps at most ${cap} metrics. Remove one before adding another.`}
          </Typography.Text>
        ) : null}
      </Space>
    </Space>
  )
}

export default function PlaygroundMetrics({
  metrics,
  cap,
  busy,
  onSave,
}: {
  metrics: PlaygroundMetric[]
  cap: number
  busy: boolean
  onSave: (next: PlaygroundMetric[]) => void
}) {
  /** The metric being edited, by name — `null` when the dialog is shut, `''` when it is an add. */
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sql, setSql] = useState('')

  const start = (metric: PlaygroundMetric | null) => {
    setEditing(metric?.name ?? null)
    setName(metric?.name ?? '')
    setDescription(metric?.description ?? '')
    setSql(metric?.sql ?? '')
    setOpen(true)
  }

  const problem = metricProblem(name, metrics, cap, editing)

  const commit = () => {
    if (problem) return
    const previous = metrics.find((m) => m.name === editing) ?? null
    const next: PlaygroundMetric = previous
      ? /*
         * **An edit keeps the row's provenance.** Rewriting a drafted metric's description does not
         * make it something the reader drafted, and marking it MANUAL would credit them with a
         * sentence a pass wrote — the same lie in reverse as crediting a model with one they typed.
         */
        {
          ...previous,
          name: name.trim(),
          description: description.trim(),
          sql: sql.trim() ? sql : null,
        }
      : manualMetric(name, description, sql)
    /* The query for a metric typed with none arrives **on this save's own reply**: the server
       composes it where the brief carries none, so there is nothing for the page to ask for and no
       second press. A query the reader typed is theirs and is never composed over. */
    onSave(withMetric(metrics, next, editing))
    setOpen(false)
  }

  return (
    <>
      <MetricsPanel
        metrics={metrics}
        cap={cap}
        busy={busy}
        onEdit={(metric) => start(metric)}
        onDelete={(metric) => onSave(withoutMetric(metrics, metric.name))}
        onAdd={() => start(null)}
      />

      <Modal
        open={open}
        title={editing === null ? playgroundCopy.metrics.addTitle : playgroundCopy.metrics.editTitle}
        onCancel={() => setOpen(false)}
        onOk={commit}
        okButtonProps={{ disabled: problem !== null, loading: busy }}
        okText="Save"
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label={playgroundCopy.metrics.nameLabel}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={playgroundCopy.metrics.namePlaceholder}
            />
          </Form.Item>
          <Form.Item label={playgroundCopy.metrics.descriptionLabel}>
            <Input.TextArea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={playgroundCopy.metrics.descriptionPlaceholder}
            />
          </Form.Item>
          <Form.Item label={playgroundCopy.metrics.sqlLabel}>
            <Input.TextArea
              rows={6}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder={playgroundCopy.metrics.sqlPlaceholder}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
            />
          </Form.Item>
          {/* The refusal is shown rather than only disabling OK: a greyed button with no sentence
              leaves the reader to guess which field it is unhappy about. */}
          {problem ? <Alert type="warning" showIcon title={problem} /> : null}
        </Form>
      </Modal>
    </>
  )
}
