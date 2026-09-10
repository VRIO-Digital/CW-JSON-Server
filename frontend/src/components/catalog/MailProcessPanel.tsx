import { CheckCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { Progress, Table, Typography } from 'antd'
import { useEffect } from 'react'
import type { SourceRow } from '../../api/client'
import { useMailDocumentsStore, useMailProcessStore } from '../../store/catalogStore'
import { mailProcessCopy, stageStates } from '../../data/mailProcess'
import './ProfiledColumnsPanel.css'
import './MailProcessPanel.css'

const { Text, Paragraph } = Typography

/** How often a run in flight is re-read. The jobs board's own cadence, so neither is faster. */
const RUN_POLL_MS = 3000

/**
 * Gmail's catalogue, on the Catalog surface itself: the run in flight, then what it processed.
 *
 * **Asked for as one surface rather than two.** Mail used to be a *Browse documents for profiling*
 * panel that opened a tree to tick through, and a *View profiled documents* panel that opened the
 * dictionary. Both are gone: there is one button, *Process documents*, and everything it does and
 * everything it produced is on this page underneath it.
 *
 * **The progress is the server's, stage by stage.** The stage list is `MAIL_PIPELINE` as the job
 * reports it — never a list held here — so adding a stage on the server adds a row here, and the
 * percentage is derived from the job's own position rather than from a timer. A bar that filled on
 * a clock would be the thing this repo refuses everywhere: an operation narrating work nobody did.
 *
 * **It watches its own run, not the jobs board.** `GET /profiling-jobs` deliberately excludes
 * `gmail` — a mail run is narrated here and nowhere else, and a row on that board as well would be
 * two places to watch one thing. So this polls `GET /sources/:id/mail-run`, and it polls **only
 * while a run is in flight**: an interval that kept ticking over a finished job would be asking a
 * question nobody is waiting on.
 */
export default function MailProcessPanel({ source }: { source: SourceRow }) {
  const job = useMailProcessStore((s) => s.job)
  const pollRun = useMailProcessStore((s) => s.poll)
  const documents = useMailDocumentsStore((s) => s.data)
  const loadingDocs = useMailDocumentsStore((s) => s.loading)
  const docsError = useMailDocumentsStore((s) => s.error)
  const loadDocs = useMailDocumentsStore((s) => s.load)

  useEffect(() => {
    void pollRun(source.sourceId)
    void loadDocs(source.sourceId)
  }, [source.sourceId, pollRun, loadDocs])

  /* Re-read the documents when a run lands, or the table under a finished run is the one from
     before it — the same reason queueing re-reads the board. */
  useEffect(() => {
    if (job?.status === 'complete') void loadDocs(source.sourceId)
  }, [job?.status, job?.job_id, source.sourceId, loadDocs])

  const rows = (documents?.labels ?? []).flatMap((label) => label.documents)
  const running = job != null && (job.status === 'queued' || job.status === 'running')

  /*
   * The interval, owned here and cleared the moment the run lands — a poll that outlives its run is
   * a request nobody is waiting on, and one that outlives the component fires into a dead one.
   * `RUN_POLL_MS` is the board's own cadence, so a mail run refreshes as often as any other.
   */
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => void pollRun(source.sourceId), RUN_POLL_MS)
    return () => window.clearInterval(id)
  }, [running, source.sourceId, pollRun])

  return (
    <div className="cat-mail-process">
      {/* The run, while there is one to watch. A finished job leaves the table below rather than a
          bar sitting at 100% — the result is the report, not the progress. */}
      {running ? (
        <div className="cat-mail-run">
          <Progress
            percent={job.progress}
            status="active"
            /* The figure is the job's own, so the bar and the caption cannot disagree. */
            format={(p) => `${p ?? 0}%`}
          />
          <Text type="secondary" className="cat-mail-run-caption">
            {mailProcessCopy.caption(job)}
          </Text>
          <ul className="cat-mail-stages">
            {stageStates(job).map(({ label, state }) => (
              <li key={label} className={`cat-mail-stage is-${state}`}>
                {/* State is never colour alone: a tick, a spinner or a hollow dot says which. */}
                <span className="cat-mail-stage-mark" aria-hidden="true">
                  {state === 'done' ? (
                    <CheckCircleFilled />
                  ) : state === 'running' ? (
                    <LoadingOutlined spin />
                  ) : (
                    '○'
                  )}
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Paragraph type="secondary" className="cat-mail-note">
        {mailProcessCopy.note}
      </Paragraph>

      {docsError ? (
        <Text type="danger">{docsError}</Text>
      ) : (
        <Table
          size="small"
          rowKey={(r) => `${r.label}/${r.document_id}`}
          loading={loadingDocs}
          pagination={false}
          dataSource={rows}
          locale={{ emptyText: mailProcessCopy.empty }}
          columns={[
            {
              title: 'Document',
              dataIndex: 'name',
              render: (name: string, row) => (
                <span className="cat-mail-doc">
                  <span className="cat-mail-doc-name">{name}</span>
                  {/* The opening line, where the corpus states one. A synthesised document has
                      none and the cell is simply the name — never an invented sentence. */}
                  {row.snippet ? (
                    <span className="cat-mail-doc-snippet">{row.snippet}</span>
                  ) : null}
                </span>
              ),
            },
            {
              title: 'Pages',
              dataIndex: 'pages',
              width: 90,
              /* An em dash, not 0: nothing counted the pages of a synthesised document, and 0
                 would say it has none. */
              render: (pages: number | null) =>
                pages == null ? <span className="pc-dash">—</span> : <span className="pc-num">{pages}</span>,
            },
            {
              title: 'Chunks',
              dataIndex: 'chunks',
              width: 90,
              render: (chunks: number) => <span className="pc-num">{chunks}</span>,
            },
            {
              title: 'Size',
              dataIndex: 'size_chars',
              width: 110,
              render: (chars: number | null) =>
                chars == null ? (
                  <span className="pc-dash">—</span>
                ) : (
                  <span className="pc-num">{mailProcessCopy.size(chars)}</span>
                ),
            },
            {
              title: 'Status',
              key: 'status',
              width: 120,
              /* Every row in this table has been processed — the table lists what the run
                 committed, so there is no other state a row here could be in. */
              render: () => <span className="cat-mail-status">processed</span>,
            },
          ]}
        />
      )}
    </div>
  )
}
