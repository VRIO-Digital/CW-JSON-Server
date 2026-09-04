import { InboxOutlined } from '@ant-design/icons'
import { Alert, App, Button, Flex, Select, Space, Table, Tag, Typography } from 'antd'
import { useRef, useState } from 'react'
import type { SourceRow } from '../../api/client'
import {
  SCHEMA_ACCEPT,
  schemaFileProblem,
  schemaUploadCopy,
} from '../../data/schemaUpload'
import { useSchemaUploadStore } from '../../store/catalogStore'
import { SP } from '../../theme'

const { Text, Paragraph } = Typography

/**
 * Uploading a schema or a data dictionary into a BigQuery source's own column dictionary.
 *
 * **What "combine with the connected source" means here, exactly.** The file's columns become
 * `column_profiles` entries keyed `dataset.table` — the same place a profiling run reads from, and
 * the same place the demo's own 206 columns came from when they were ingested out of a workbook. So
 * the Catalog stops serving synthesised columns for those tables and serves what the file said, the
 * Data Modeling tab draws them, and the graph derives over them. It is the ingest script's act, done
 * through a screen.
 *
 * **Two buttons, because the first one writes nothing.** An upload *replaces* a table's dictionary,
 * so the preview is the reader's chance to see what a parse understood before it stands as the
 * Catalog's answer — "seed, check the diff, push" with a screen instead of a terminal. The preview
 * names what it would drop, and every table it would add.
 *
 * **The file is read in the browser.** `File.text()` and a JSON body, so the zero-dependency server
 * needs no multipart parser for what is a text file either way; `schemaFileProblem` checks the
 * extension and the size against the server's own body cap first, so an oversized file is a sentence
 * rather than a request that dies mid-stream.
 */
export default function SchemaUploadPanel({
  source,
  onProfiled,
}: {
  source: SourceRow
  /** Called once a run is queued — the page re-reads the board and switches to the jobs tab. */
  onProfiled: () => void
}) {
  const { message } = App.useApp()
  const plan = useSchemaUploadStore((s) => s.plan)
  const reading = useSchemaUploadStore((s) => s.reading)
  const applying = useSchemaUploadStore((s) => s.applying)
  const error = useSchemaUploadStore((s) => s.error)
  const preview = useSchemaUploadStore((s) => s.preview)
  const apply = useSchemaUploadStore((s) => s.apply)
  const reset = useSchemaUploadStore((s) => s.reset)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<{ filename: string; text: string } | null>(null)
  /* The reader's own refusal — the extension or the size — kept apart from the server's so the
     panel can show it without a round trip. */
  const [localProblem, setLocalProblem] = useState<string | null>(null)
  /*
   * Which dataset the file's tables belong to. Defaulted to the source's first allowlisted one and
   * offered as a select rather than typed, because the allowlist is the closed set the server will
   * check against — a typed dataset is a refusal waiting to happen. A file that names its own
   * dataset overrides this, and the preview says which one it used.
   */
  const [datasetId, setDatasetId] = useState(source.datasets[0] ?? '')

  async function choose(chosen: File | undefined) {
    reset()
    setFile(null)
    setLocalProblem(null)
    if (!chosen) return
    const problem = schemaFileProblem(chosen)
    if (problem) {
      setLocalProblem(problem)
      return
    }
    setFile({ filename: chosen.name, text: await chosen.text() })
  }

  async function readIt() {
    if (!file) return
    const result = await preview(source.sourceId, { ...file, dataset_id: datasetId })
    /* The store holds the sentence and the panel prints it below — a toast as well would say the
       same thing twice, and the one on screen is the one beside the file. */
    if (!result.ok) return
  }

  async function applyIt() {
    if (!file) return
    const result = await apply(source.sourceId, { ...file, dataset_id: datasetId })
    if (!result.ok) return
    message.success(
      `Dictionary applied — profiling ${result.job.objects.length} table(s) as job ${result.job.short_id}.`,
    )
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
    onProfiled()
  }

  return (
    <div className="cat-browse">
      <Paragraph className="cat-browse-hint">{schemaUploadCopy.lead}</Paragraph>

      {/*
        Said before anything is uploaded, not after. A reader who applies a dictionary and *then*
        finds a table of em dashes where the statistics go has been surprised by the one thing this
        panel could have told them.
      */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: SP.base }}
        title={schemaUploadCopy.measuresNothing}
      />

      <Flex align="center" gap={SP.md} wrap style={{ marginBottom: SP.base }}>
        <Space size={SP.sm} wrap>
          <input
            ref={inputRef}
            type="file"
            accept={SCHEMA_ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <Button icon={<InboxOutlined />} onClick={() => inputRef.current?.click()}>
            {file ? 'Choose a different file' : 'Choose a file'}
          </Button>
          {file ? <Text className="cat-detail-id">{file.filename}</Text> : null}
        </Space>

        <Space size={SP.sm} align="center">
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            dataset
          </Text>
          <Select
            value={datasetId}
            onChange={setDatasetId}
            style={{ minWidth: 200 }}
            options={source.datasets.map((d) => ({ value: d, label: d }))}
            /* One allowlisted dataset is not a choice, and a Select with one option reads as one
               that failed to load its others — the rule the mailbox picker follows. */
            disabled={source.datasets.length < 2}
          />
        </Space>
      </Flex>

      <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
        {schemaUploadCopy.formats}
      </Paragraph>

      {localProblem ? (
        <Alert type="warning" showIcon style={{ marginBottom: SP.base }} title={localProblem} />
      ) : null}
      {error ? (
        <Alert type="error" showIcon style={{ marginBottom: SP.base }} title={error} />
      ) : null}

      {plan ? (
        <>
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
                render: (id: string, row) => (
                  <span>
                    <span className="cat-tree-table">{id}</span>{' '}
                    {row.exists ? null : <Tag color="processing">new</Tag>}
                    {row.profiled ? <Tag>re-profiled</Tag> : null}
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
                 * catalogued with 24 columns and no dictionary yet would otherwise read `0 → 3`
                 * while the figure on the Catalog went 24 → 3. Applying replaces both.
                 */
                render: (_, row) => (
                  <span className="pc-num">
                    {row.exists
                      ? `${row.catalogued_column_count} → ${row.column_count}`
                      : row.column_count}
                  </span>
                ),
              },
              {
                title: 'added',
                dataIndex: 'added',
                width: 90,
                render: (added: string[]) => <span className="pc-num">{added.length}</span>,
              },
              {
                /* Named, not counted: a column about to leave the dictionary is the one thing a
                   reader has to be able to check before applying. */
                title: 'dropped',
                dataIndex: 'dropped',
                render: (dropped: string[]) =>
                  dropped.length === 0 ? (
                    <span className="pc-dash">—</span>
                  ) : (
                    <Text type="warning" style={{ fontSize: 12 }}>
                      {dropped.join(', ')}
                    </Text>
                  ),
              },
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

          {plan.tables.some((t) => t.stranded_declarations.length > 0) ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: SP.base }}
              /* Its own alert rather than a line beside the notes: a declared join on a dropped
                 column is a state the Data Modeling write path refuses, so it is a thing to fix
                 rather than a thing to know. */
              title={`Data Modeling declarations read columns this file does not name, and applying would strand them: ${plan.tables
                .flatMap((t) => t.stranded_declarations.map((d) => `${t.table_id} — ${d}`))
                .join('; ')}`}
            />
          ) : null}

          {plan.new_table_count > 0 ? (
            <Paragraph type="secondary" style={{ fontSize: 12.5, marginTop: SP.base }}>
              {schemaUploadCopy.newTableNote}
            </Paragraph>
          ) : null}
        </>
      ) : null}

      <Flex align="center" justify="space-between" wrap gap={10} className="cat-browse-foot">
        <Space wrap>
          <Button
            size="small"
            disabled={!file}
            loading={reading}
            onClick={() => void readIt()}
          >
            {schemaUploadCopy.previewLabel}
          </Button>
          <Button
            type="primary"
            size="small"
            /* Apply is gated on a preview of *this* file: the store clears the plan when a new file
               is chosen, so the button cannot act on a report the reader has not seen. */
            disabled={!file || !plan}
            loading={applying}
            onClick={() => void applyIt()}
          >
            {schemaUploadCopy.applyLabel}
          </Button>
        </Space>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          {plan ? schemaUploadCopy.applyNote : schemaUploadCopy.previewNote}
        </Text>
      </Flex>
    </div>
  )
}
