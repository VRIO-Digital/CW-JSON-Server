import { InboxOutlined } from '@ant-design/icons'
import { Alert, Button, Modal, Space, Table, Tag, Typography } from 'antd'
import { useRef } from 'react'
import type { SourceRow } from '../../api/client'
import {
  SCHEMA_ACCEPT,
  schemaFileProblem,
  schemaUploadCopy,
} from '../../data/schemaUpload'
import { useSchemaUploadStore } from '../../store/catalogStore'
import { SP } from '../../theme'

const { Paragraph } = Typography

/**
 * Uploading a data dictionary **against one dataset**, from that dataset's own row in the browse
 * tree.
 *
 * **What "combine with the connected source" means here, exactly.** The file's columns become
 * `column_profiles` entries keyed `dataset.table` — the same place a profiling run reads from, and
 * the same place the demo's own 206 columns came from when they were ingested out of a workbook. So
 * the Catalog stops serving synthesised columns for those tables and serves what the file said, the
 * Data Modeling tab draws them, and the graph derives over them. It is the ingest script's act, done
 * through a screen.
 *
 * **It was a source-level panel with a dataset Select in it, and the dataset is what moved.** One
 * upload for a source that may hold three datasets meant the panel had to *ask* which one, from a
 * control the reader met a moment after they had been looking at the list of them — and a Select
 * with one option is the fault this repo refuses everywhere. The act now sits on the row it
 * describes, so there is nothing to pick and nothing to get wrong. That also settles "BigQuery only"
 * by construction rather than by declaration: only the structured browse panel lists datasets, and
 * a drive or a mailbox never reaches it.
 *
 * **Two acts still, and the first one still writes nothing** — what changed is who asks for it.
 * Choosing a file reads it immediately, because a reader who has just picked a dictionary has
 * already asked for it to be read and a second click to make anything appear is a step that says
 * nothing. The write is **Start Profiling**, one control for both halves of what a reader means by
 * it: the dictionary lands and the tables it touched are profiled.
 *
 * **The file is read in the browser.** `File.text()` and a JSON body, so the zero-dependency server
 * needs no multipart parser for what is a text file either way; `schemaFileProblem` checks the
 * extension and the size against the server's own body cap first, so an oversized file is a sentence
 * rather than a request that dies mid-stream.
 */
export function DictionaryUploadControl({
  source,
  datasetId,
  onReport,
}: {
  source: SourceRow
  datasetId: string
  /**
   * Show this dataset's report. Called when a read lands — the reader asked for the file to be
   * read and the report is the answer — and again from *View report* for one who has closed it.
   *
   * A callback rather than a `Modal` rendered here: one dialog for the panel, opened by whichever
   * row wants it, because a dialog per dataset row is several ways to be looking at one thing.
   */
  onReport: (datasetId: string) => void
}) {
  const staged = useSchemaUploadStore((s) => s.staged[datasetId])
  const reading = useSchemaUploadStore((s) => s.reading)
  const read = useSchemaUploadStore((s) => s.read)
  const refuse = useSchemaUploadStore((s) => s.refuse)
  const discard = useSchemaUploadStore((s) => s.discard)
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function choose(chosen: File | undefined) {
    if (!chosen) return
    const problem = schemaFileProblem(chosen)
    if (problem) {
      refuse(datasetId, problem)
      return
    }
    /* Read straight away. The refusals below it — the parser's — arrive in the store's `error` and
       print on the panel, where a dialog would have had to be dismissed to reach them. */
    const result = await read(source.sourceId, {
      filename: chosen.name,
      text: await chosen.text(),
      dataset_id: datasetId,
    })
    /* And show what it says. Only on success: there is no report behind a refusal, and opening an
       empty dialog over one would bury the sentence that explains it. */
    if (result.ok) onReport(datasetId)
  }

  return (
    /*
     * **The click is stopped here, and it has to be.** This sits inside a `checkable` `blockNode`
     * tree title, where a click anywhere on the row toggles the checkbox — so without this, opening
     * the file dialog would also uncheck every table in the dataset, and the reader would find their
     * selection changed by a button that said nothing about selection.
     *
     * **`stopPropagation` only, never `preventDefault` — and that one line broke the whole
     * feature.** The hidden `<input type="file">` is a child of this span, so the click
     * `inputRef.current.click()` dispatches bubbles up through here; cancelling it cancels that
     * input's default action, which *is* opening the file picker. The button depressed, nothing
     * opened, and the failure looked like a browser blocking a programmatic file dialog rather
     * than like a handler two elements up. Reported from use.
     */
    <span className="cat-dict" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="file"
        accept={SCHEMA_ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <Space size={SP.xs} wrap>
        {/*
          **The upload button is the empty state's control, and a staged dataset no longer draws
          it.** It used to stay and relabel itself *Replace file*; that was **removed on request**,
          so a row with a file read against it offers its name, *View report* and *Discard* and
          nothing else.

          What it costs is one click: swapping a file is now Discard then Upload rather than
          Replace. That is the honest shape of the act anyway — a replace silently threw away a
          plan the reader may not have read yet, and `staged` is one slot per dataset, so the
          discard was happening either way and only the saying of it was missing.

          The hidden `<input>` stays mounted regardless: it is what this button opens, and
          remounting it per state would lose the ref between renders.
        */}
        {staged ? null : (
          <Button
            size="small"
            icon={<InboxOutlined />}
            loading={reading === datasetId}
            onClick={() => inputRef.current?.click()}
          >
            {reading === datasetId
              ? schemaUploadCopy.readingLabel
              : schemaUploadCopy.uploadLabel}
          </Button>
        )}
        {staged ? (
          <>
            {/* Neutral: a staged file is not a state of the data. */}
            <Tag>{staged.filename}</Tag>
            {/* The way back into the report, for a reader who has closed the one that opened
                itself. A link rather than a second default button, because it opens something to
                read rather than changing anything. */}
            <Button size="small" type="link" onClick={() => onReport(datasetId)}>
              {schemaUploadCopy.reviewLabel}
            </Button>
            <Button size="small" type="text" onClick={() => discard(datasetId)}>
              {schemaUploadCopy.discardLabel}
            </Button>
          </>
        ) : null}
      </Space>
    </span>
  )
}

/**
 * What one staged dictionary would do, per table — the report the reader has to be able to check
 * before Start Profiling writes it.
 *
 * **The body, exported apart from its `Modal`**, which is the rule every dialog here follows: a
 * `Modal` renders through a portal `renderToString` will not traverse, so a table written inside
 * one cannot be asserted at all — the reason `ConnectSourceWizard` is separate from
 * `ConnectSourceModal`. It renders nothing for a dataset with nothing staged.
 */
export function DictionaryPlanReport({ datasetId }: { datasetId: string }) {
  const staged = useSchemaUploadStore((s) => s.staged[datasetId])
  if (!staged) return null
  const plan = staged.plan

  return (
    <div className="cat-dict-report">
      <Alert
        type="success"
        showIcon
        style={{ marginBottom: SP.base }}
        title={`Read ${plan.filename} as ${plan.format.toUpperCase()} — ${plan.table_count} table(s), ${plan.column_count} column(s), into ${plan.dataset_id}.`}
      />
      <Table
        size="small"
        pagination={false}
        rowKey="table_id"
        dataSource={plan.tables}
        columns={[
          {
            title: 'table',
            dataIndex: 'table_id',
            /* `new` marks a table this file *declares*, which is the one thing about a row that
               changes what applying means. The `re-profiled` tag beside it was **removed on
               request**: `profiled` is still served, and every table in a dictionary is re-profiled
               anyway — forced, because the columns are exactly what changed — so the tag marked the
               ordinary case rather than the exceptional one. */
            render: (id: string, row) => (
              <span>
                <span className="cat-tree-table">{id}</span>{' '}
                {row.exists ? null : <Tag color="processing">new</Tag>}
              </span>
            ),
          },
          {
            title: 'columns',
            key: 'columns',
            width: 150,
            /*
             * **The number on screen, then the number this file names.** The before value is the
             * *catalogue's* count rather than the dictionary's previous length, because they are
             * different questions and the first is the one a reader is looking at: a table
             * catalogued with 24 columns and no dictionary yet would otherwise read `0 → 3` while
             * the figure on the Catalog went 24 → 3. Applying replaces both.
             */
            render: (_, row) => (
              <span className="pc-num">
                {row.exists
                  ? `${row.catalogued_column_count} → ${row.column_count}`
                  : row.column_count}
              </span>
            ),
          },
          /*
           * **`added` and `dropped` were the third and fourth columns, and both are gone — removed
           * on request.** What that costs is stated rather than glossed: `dropped` was the only
           * place a reader was told, *by name*, which columns an upload would take out of the
           * dictionary, and an upload **replaces** a table's column list rather than merging into
           * it. Both fields are still computed and still served on the plan — nothing below this
           * component changed — so the report is a narrower reading of the same payload, not a
           * weaker one. Do not restore either without being asked.
           */
        ]}
      />

      {plan.tables.some((t) => t.orphaned_notes.length > 0) ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: SP.base }}
          title={`${plan.tables.reduce((n, t) => n + t.orphaned_notes.length, 0)} curator note(s) are written against columns this file does not name, and stop applying with them: ${plan.tables
            .flatMap((t) => t.orphaned_notes.map((c) => `${t.table_id}.${c}`))
            .join(', ')}`}
        />
      ) : null}

      {/*
        **The stranded-declarations alert stood here and is gone — removed on request.**

        What it said, and what its absence costs: a Data Modeling declaration reads a column *by
        name*, and `POST /data-model/entities` refuses a join on a column `column_profiles` does not
        carry — so an upload leaving one out leaves a declaration the write path will no longer
        accept, findable only by somebody trying to edit that relationship. This alert named each
        one while it was still a choice. CAPEX's own `capex-plan-dictionary.csv` strands three on
        `plan_version_master`, which is deliberate in that sample.

        `stranded_declarations` is still computed in `resolveSchemaUpload` and still on every plan
        row, so nothing below this component changed and re-adding the alert is this block again.
        **Do not restore it without being asked.**
      */}

      {plan.new_table_count > 0 ? (
        <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: SP.base }}>
          {schemaUploadCopy.newTableNote}
        </Paragraph>
      ) : null}
    </div>
  )
}

/**
 * The report as a dialog.
 *
 * **Asked for as a popup, and it is one for a reason the inline version made obvious**: drawn under
 * the tree, a twelve-row table and two warnings sat between the dataset rows and the button that
 * acts on them, so a reader scrolled past what they were deciding about to reach Start Profiling.
 * A dialog puts the report in front of the decision instead of below it.
 *
 * **It opens by itself when a read lands**, because that is the answer to the act the reader just
 * performed — the same reasoning that made choosing a file read it. *View report* on the row is the
 * way back in.
 *
 * **Close is its only act.** A *Start Profiling* here as well would be a second control for one
 * write.
 *
 * **The footer used to restate what that button would do, and that line is gone — removed on
 * request.** `schemaUploadCopy.applyNote` is untouched and still printed where the button actually
 * is, on the browse panel beside Start Profiling, so the promise did not disappear with the
 * sentence here: it stopped being said twice.
 */
export function DictionaryPlanModal({
  datasetId,
  onClose,
}: {
  /** The dataset whose report is open, or `null` for none. */
  datasetId: string | null
  onClose: () => void
}) {
  const staged = useSchemaUploadStore((s) => (datasetId ? s.staged[datasetId] : undefined))

  return (
    <Modal
      /* Open only where there is something to show: a dataset whose file has been discarded, or
         whose write has landed, has no report and would open an empty dialog. */
      open={Boolean(datasetId && staged)}
      title={
        staged && datasetId
          ? schemaUploadCopy.reportTitle(datasetId, staged.filename)
          : undefined
      }
      onCancel={onClose}
      width={schemaUploadCopy.reportWidth}
      destroyOnHidden
      footer={
        <Button size="small" onClick={onClose}>
          {schemaUploadCopy.closeLabel}
        </Button>
      }
    >
      {datasetId ? <DictionaryPlanReport datasetId={datasetId} /> : null}
    </Modal>
  )
}
