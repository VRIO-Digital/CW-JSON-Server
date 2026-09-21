import { CheckCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { Progress, Table, Typography } from 'antd'
import { useEffect } from 'react'
import type { SourceRow } from '../../api/client'
import { useDocumentsStore, useDriveProcessStore } from '../../store/catalogStore'
import { driveProcessCopy } from '../../data/driveProcess'
import { mailProcessCopy, stageStates } from '../../data/mailProcess'
import { fileKind } from '../../data/mimeTypes'
import './ProfiledColumnsPanel.css'
import './MailProcessPanel.css'

const { Text, Paragraph } = Typography

/** How often a run in flight is re-read. The jobs board's own cadence, so neither is faster. */
const RUN_POLL_MS = 3000

/**
 * A drive's catalogue, on the Catalog surface itself: the run in flight, then what it processed.
 *
 * **The twin of `MailProcessPanel`, asked for in those words** — *"when click on google drive
 * profile it should look like this view, not existing view"*. A drive used to open a
 * *Browse documents for profiling* tree to tick through and a *View profiled documents* panel
 * beside it; both are gone from this surface, and what is left is one button and everything it
 * did underneath.
 *
 * **What that costs is stated rather than glossed.** A drive's folders really are a choice a
 * reader made in the connect wizard — which is the reason Gmail has no such picker and this one
 * did — so picking a subset of documents is no longer expressible here. The allowlist still bounds
 * every run, `POST …/profile-documents` still accepts an explicit `objects` list, and
 * `DocumentBrowsePanel` is still on disk with no caller: the same waiting-for-a-caller state
 * `/change-signals` is in. **Do not delete either to "finish" this, and do not restore the tree
 * without being asked.**
 *
 * **The progress is the server's, stage by stage.** The stage list is the job's own `stages` as
 * `pipelineFor` reports them — never a list held here — so adding a stage on the server adds a row
 * here, and the percentage is the job's position rather than a timer. A bar filling on a clock is
 * an operation narrating work nobody did.
 *
 * **It polls the jobs board rather than a private endpoint**, which is the one way it differs from
 * mail. `GET /profiling-jobs` excludes `gmail` on purpose, so a mail run has exactly one surface; a
 * drive run has always been listed there, and keeping it is what stops this panel becoming a second
 * answer to where a drive run is watched. It polls **only while a run is in flight**.
 */
export default function DriveProcessPanel({
  source,
  onProcessed,
}: {
  source: SourceRow
  /**
   * **A run landed, so the source row is stale.** Everything a run moves — `documents_chunked`,
   * `chunks_total`, `chunk_chars`, `profiled_today`, `profiled_documents` — lives on
   * `GET /sources`, which this panel does not read and cannot refresh on its own.
   *
   * Deliberately *not* the page's `handleQueued`: that switches to the Profiling jobs board, and
   * sending a reader away from the run they are watching is the fault this panel exists to avoid.
   */
  onProcessed: () => void
}) {
  const job = useDriveProcessStore((s) => s.job)
  const pollRun = useDriveProcessStore((s) => s.poll)
  const documents = useDocumentsStore((s) => s.data)
  const loadingDocs = useDocumentsStore((s) => s.loading)
  const docsError = useDocumentsStore((s) => s.error)
  const loadDocs = useDocumentsStore((s) => s.load)

  useEffect(() => {
    void pollRun(source.sourceId)
    void loadDocs(source.sourceId)
  }, [source.sourceId, pollRun, loadDocs])

  /*
   * **Re-read both halves when a run lands** — the table under a finished run is otherwise the one
   * from before it, and the tiles above it are the *row* from before it. Two endpoints, and asking
   * only one again is what left Gmail's tiles at 0 over a list of processed documents.
   *
   * Keyed on `job_id` as well as `status`, so a second run's completion re-reads rather than being
   * swallowed as "status was already complete".
   */
  useEffect(() => {
    if (job?.status !== 'complete') return
    void loadDocs(source.sourceId)
    onProcessed()
  }, [job?.status, job?.job_id, source.sourceId, loadDocs, onProcessed])

  const rows = (documents?.folders ?? []).flatMap((folder) =>
    folder.documents.map((d) => ({ ...d, folder_id: folder.folder_id })),
  )
  const running = job != null && (job.status === 'queued' || job.status === 'running')

  /* The interval, cleared the moment the run lands: a poll that outlives its run is a request
     nobody is waiting on, and one that outlives the component fires into a dead one. */
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
            {driveProcessCopy.caption(job)}
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
        {driveProcessCopy.note}
      </Paragraph>

      {docsError ? (
        <Text type="danger">{docsError}</Text>
      ) : (
        <Table
          size="small"
          rowKey={(r) => `${r.folder_id}/${r.document_id}`}
          loading={loadingDocs}
          pagination={false}
          dataSource={rows}
          locale={{ emptyText: driveProcessCopy.empty }}
          columns={[
            {
              title: 'Document',
              dataIndex: 'name',
              render: (name: string, row) => (
                <span className="cat-mail-doc">
                  <span className="cat-mail-doc-name">
                    {fileKind(row.mime_type)} · {name}
                  </span>
                  {/* What the document is and which entity it maps to — the browse tree's own
                      second line, kept because it is what makes a list of contract filenames
                      readable. The opening line where a run extracted one. */}
                  <span className="cat-mail-doc-snippet">
                    {row.doc_type_label} · {row.linked_entity}
                    {row.snippet ? ` — ${row.snippet}` : ''}
                  </span>
                </span>
              ),
            },
            {
              title: 'Pages',
              dataIndex: 'pages',
              width: 90,
              /* Read from the document rather than from the run, so this one never dashes. */
              render: (pages: number) => <span className="pc-num">{pages}</span>,
            },
            {
              title: 'Chunks',
              dataIndex: 'chunks',
              width: 90,
              /* An em dash, not 0: nothing chunked this document, and 0 would say it produced
                 none. The same rule the mail table keeps for a synthesised row. */
              render: (chunks: number | null) =>
                chunks == null ? (
                  <span className="pc-dash">—</span>
                ) : (
                  <span className="pc-num">{chunks}</span>
                ),
            },
            {
              title: 'Size',
              dataIndex: 'size_chars',
              width: 110,
              render: (chars: number | null) =>
                chars == null ? (
                  <span className="pc-dash">—</span>
                ) : (
                  /* `mailProcessCopy`'s rounding, so the cell and the *chunk size* tile above it
                     cannot state one unit at two grains. */
                  <span className="pc-num">{mailProcessCopy.size(chars)}</span>
                ),
            },
            {
              title: 'Status',
              key: 'status',
              width: 120,
              /* Every row here is a document the run committed, so there is no other state one
                 could be in — the same reasoning as the mail table's own cell. */
              render: () => <span className="cat-mail-status">processed</span>,
            },
          ]}
        />
      )}
    </div>
  )
}
