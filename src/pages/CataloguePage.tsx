import {
  Alert,
  App,
  Button,
  Col,
  Flex,
  Row,
  Space,
  Spin,
  Tabs,
  Tag,
  Tree,
  Typography,
  type TreeDataNode,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeSignal, SourceRow } from '../api/client'
import { useBrowseStore, useJobsStore, useSignalsStore } from '../store/catalogueStore'
import { selectSources, useSourcesStore } from '../store/sourcesStore'
import ApiErrorAlert from '../components/ApiErrorAlert'
import ConnectorIcon from '../components/ConnectorIcon'
import DocumentBrowsePanel from '../components/DocumentBrowsePanel'
import NoSourceConnected from '../components/NoSourceConnected'
import PageHeader from '../components/PageHeader'
import ProfiledColumnsPanel from '../components/ProfiledColumnsPanel'
import ProfiledDocumentsPanel from '../components/ProfiledDocumentsPanel'
import ProfilingJobsTab from '../components/ProfilingJobsTab'
import StatusTag from '../components/StatusTag'
import { profilingOutcome } from '../data/profilingOutcome'
import { SP } from '../theme'
import './CataloguePage.css'

/* Tree keys encode the pair so a leaf can be turned back into an object. */
const leafKey = (dataset: string, table: string) => `t:${dataset}::${table}`
const parseLeaf = (key: string) => {
  const [dataset_id, table_id] = key.slice(2).split('::')
  return { dataset_id, table_id }
}

function StatBox({
  label,
  value,
  note,
  mono,
}: {
  label: string
  value: string
  note: string
  mono?: boolean
}) {
  return (
    <div className="cat-stat">
      <span className="cat-stat-label">{label}</span>
      <span className={`cat-stat-value${mono ? ' is-mono' : ''}`}>{value}</span>
      <span className="cat-stat-note">{note}</span>
    </div>
  )
}

/* ---------------- Browse & profile panel ---------------- */

function BrowsePanel({
  source,
  onProfiled,
}: {
  source: SourceRow
  onProfiled: () => void
}) {
  const { message, modal } = App.useApp()
  const data = useBrowseStore((s) => s.data)
  const loading = useBrowseStore((s) => s.loading)
  const browseError = useBrowseStore((s) => s.error)
  const running = useBrowseStore((s) => s.starting)
  const loadBrowse = useBrowseStore((s) => s.load)
  const startProfilingRun = useBrowseStore((s) => s.start)
  const [checked, setChecked] = useState<string[]>([])

  const allLeaves = useMemo(
    () =>
      (data?.datasets ?? []).flatMap((d) =>
        d.tables.map((t) => leafKey(d.dataset_id, t.table_id)),
      ),
    [data],
  )

  useEffect(() => {
    void loadBrowse(source.sourceId)
  }, [loadBrowse, source.sourceId])

  useEffect(() => {
    if (browseError) message.error(browseError)
  }, [browseError, message])

  // Everything is in scope by default — the copy says "uncheck to exclude".
  useEffect(() => {
    if (!data) return
    setChecked(
      data.datasets.flatMap((d) =>
        d.tables.map((t) => leafKey(d.dataset_id, t.table_id)),
      ),
    )
  }, [data])

  const treeData: TreeDataNode[] = (data?.datasets ?? []).map((d) => ({
    key: `d:${d.dataset_id}`,
    title: (
      <span className="cat-tree-row">
        <strong className="cat-tree-dataset">{d.dataset_id}</strong>
        <span className="cat-tree-count">{d.table_count} object(s)</span>
      </span>
    ),
    children: d.tables.map((t) => ({
      key: leafKey(d.dataset_id, t.table_id),
      /* The id is what the run acts on, so it leads; the label and the grain
         are what tell a reader whether this is the view they meant. */
      title: (
        <span className="cat-tree-row">
          <span className="cat-tree-lead">
            <span>
              <Tag className="cat-tree-kind">{t.type}</Tag>
              <span className="cat-tree-table">{t.table_id}</span>
              <span className="cat-tree-label">{t.label}</span>
            </span>
            <span className="cat-tree-grain">{t.grain}</span>
          </span>
          <span className="cat-tree-count">
            {t.columns} col(s) · {t.rows.toLocaleString()} rows
            {t.profiled ? ' · profiled' : ''}
          </span>
        </span>
      ),
    })),
  }))

  const selected = checked.filter((k) => k.startsWith('t:'))

  /**
   * Starts a run, and reports what it did.
   *
   * When everything picked was already profiled the run does nothing, and the old message sent the
   * reader to another tab to press Force on the job that had just done nothing — without ever
   * saying *which* objects were already profiled. Both are answered here instead: the objects are
   * named, and re-profiling is offered as the confirm on that same dialog. `force` still only ever
   * leaves this panel as a **deliberate second act**, never on the first click.
   */
  async function startProfiling(force = false) {
    const result = await startProfilingRun(source.sourceId, selected.map(parseLeaf), force)
    if (!result.ok) {
      message.warning(result.error)
      return
    }
    const { job } = result
    const outcome = profilingOutcome(job.objects, 'table', job.short_id)
    if (outcome.kind === 'nothing-to-do') {
      modal.confirm({
        title: outcome.title,
        content: (
          <>
            <Typography.Paragraph>{outcome.detail}</Typography.Paragraph>
            <Typography.Paragraph type="secondary">{outcome.note}</Typography.Paragraph>
          </>
        ),
        okText: outcome.confirmText,
        cancelText: 'Leave them as they are',
        onOk: () => startProfiling(true),
      })
    } else {
      message.success(outcome.text)
    }
    onProfiled()
  }

  return (
    <div className="cat-browse">
      {loading ? (
        <Spin />
      ) : (
        <>
          <Typography.Paragraph className="cat-browse-hint">
            {data?.object_count ?? 0} object(s) across {data?.dataset_count ?? 0}{' '}
            dataset(s). Uncheck any table — or a whole dataset — to exclude it from
            this profiling run.
          </Typography.Paragraph>

          <Tree
            checkable
            blockNode
            selectable={false}
            defaultExpandAll
            treeData={treeData}
            checkedKeys={checked}
            onCheck={(keys) => setChecked(keys as string[])}
          />

          <Flex align="center" justify="space-between" wrap gap={10} className="cat-browse-foot">
            <Space wrap>
              <Button size="small" onClick={() => setChecked(allLeaves)}>
                Select all
              </Button>
              <Button size="small" onClick={() => setChecked([])}>
                Select none
              </Button>
              <Button
                type="primary"
                size="small"
                loading={running}
                onClick={() => void startProfiling()}
              >
                Start Profiling
              </Button>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              {selected.length} of {allLeaves.length} selected
            </Typography.Text>
          </Flex>
        </>
      )}
    </div>
  )
}

/* ---------------- Catalogue tab ---------------- */

function CatalogueTab({
  sources,
  loading,
  onChanged,
}: {
  sources: SourceRow[]
  loading: boolean
  onChanged: () => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panel, setPanel] = useState<
    'none' | 'browse' | 'columns' | 'browse-documents' | 'documents'
  >('none')

  const selected =
    sources.find((s) => s.sourceId === activeId) ?? sources[0] ?? null
  const isDrive = selected?.kind === 'gdrive'

  /* Which of the two actions is currently showing its panel. Derived from `panel`
     rather than tracked beside it: two pieces of state for one fact is how a button
     comes to look pressed with nothing open under it. */
  const browseOpen = panel === (isDrive ? 'browse-documents' : 'browse')
  const dictionaryOpen = panel === (isDrive ? 'documents' : 'columns')

  // Keep the selection valid when the list changes underneath.
  useEffect(() => {
    if (selected && selected.sourceId !== activeId) setActiveId(selected.sourceId)
  }, [selected, activeId])

  if (!loading && sources.length === 0) {
    return (
      <NoSourceConnected detail="Datasets and documents are discovered from connected sources. Connect a BigQuery project or a Google Drive and its tables or files will be browsable here." />
    )
  }

  return (
    <Row gutter={[SP.lg, SP.lg]} align="top">
      <Col xs={24} xl={9} xxl={8}>
        <div className="cat-list">
          {sources.map((s) => (
            <button
              type="button"
              key={s.sourceId}
              className={`cat-source${s.sourceId === selected?.sourceId ? ' is-active' : ''}`}
              onClick={() => {
                setActiveId(s.sourceId)
                setPanel('none')
              }}
            >
              <span className="cat-source-icon">
                <ConnectorIcon connector={s.connector} size={20} />
              </span>
              <span className="cat-source-body">
                {/* The id leads because it is what every action acts on; the name
                    the user typed is what they recognise, so it rides beside it as
                    a tag. Neutral — a name is not a state. */}
                <span className="cat-source-head">
                  <span className="cat-source-id">{s.sourceId}</span>
                  <span className="cat-source-name">{s.sourceName}</span>
                </span>
                <span className="cat-source-meta">
                  {s.projectAccount} ·{' '}
                  {s.kind === 'gdrive'
                    ? `${s.profiledDocuments ?? 0} documents profiled`
                    : `${s.profiledTables} tables profiled`}{' '}
                  · {s.status}
                </span>
              </span>
            </button>
          ))}
          <Typography.Text className="cat-list-note">
            Connecting a new source is an Admin action.
          </Typography.Text>
        </div>
      </Col>

      <Col xs={24} xl={15} xxl={16}>
        {selected ? (
        <div className="cat-detail">
          <Flex align="center" gap={SP.md} wrap className="cat-detail-head">
            <Typography.Text className="cat-detail-id">
              {selected.sourceId}
            </Typography.Text>
            <span className="cat-source-name">{selected.sourceName}</span>
            <StatusTag tone={selected.status === 'connected' ? 'good' : 'neutral'}>
              {selected.status}
            </StatusTag>
          </Flex>

          <Row gutter={[SP.base, SP.base]} style={{ marginBottom: SP.lg }}>
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label={isDrive ? 'drive' : 'project'}
                value={selected.projectAccount}
                note={isDrive ? 'Google Drive' : 'GCP project'}
                mono
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label={isDrive ? 'folders allowed' : 'datasets allowed'}
                value={String(
                  isDrive ? selected.folders.length : selected.datasets.length,
                )}
                note="in the allowlist"
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label={isDrive ? 'documents profiled' : 'tables profiled'}
                value={String(
                  isDrive ? (selected.profiledDocuments ?? 0) : selected.profiledTables,
                )}
                note="for this source"
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label={isDrive ? 'entities extracted' : 'columns profiled'}
                value={String(
                  isDrive ? (selected.profiledEntities ?? 0) : selected.profiledColumns,
                )}
                note="for this source"
              />
            </Col>
          </Row>

          {/* Same two moves either way — browse and profile, then read the
              dictionary — in the unit the connector actually holds.

              Both are toggles, and the fill *is* the state: the one whose panel is
              open is the brand orange, the other is white. Neither is permanently
              the primary — that ranking was wrong in both directions, since on a
              source with nothing profiled the browse panel is the only way forward
              and on a profiled one the dictionary is what you came for.

              This carries weight it did not before: the panel no longer has a close
              button, so this is the only thing saying which one is open and the only
              way to close it. Colour never does that alone — `aria-pressed` says the
              same thing to a screen reader, and the note below says it in words. */}
          <Space wrap size={SP.sm} className="cat-actions">
            <Button
              type={browseOpen ? 'primary' : 'default'}
              aria-pressed={browseOpen}
              disabled={selected.kind !== 'bigquery' && !isDrive}
              onClick={() =>
                setPanel(
                  browseOpen ? 'none' : isDrive ? 'browse-documents' : 'browse',
                )
              }
            >
              {isDrive ? 'Browse documents for profiling' : 'Browse table for profiling'}
            </Button>
            <Button
              type={dictionaryOpen ? 'primary' : 'default'}
              aria-pressed={dictionaryOpen}
              disabled={selected.kind !== 'bigquery' && !isDrive}
              onClick={() =>
                setPanel(
                  dictionaryOpen ? 'none' : isDrive ? 'documents' : 'columns',
                )
              }
            >
              {isDrive ? 'View profiled documents' : 'View profiled columns'}
            </Button>
          </Space>

          {/* Said once, where the panels open. The ✕ that used to sit inside each panel is gone,
              so the way back has to be stated somewhere — and only while something is open, or it
              is an instruction for a state the reader is not in. */}
          {browseOpen || dictionaryOpen ? (
            <Typography.Paragraph className="cat-actions-hint">
              Click the same button again to close the panel.
            </Typography.Paragraph>
          ) : null}

          {/* No panel takes an `onClose`: the button that opened it is the control
              that closes it, and a panel with its own ✕ meant two controls for one
              piece of state, only one of which showed what that state was. */}
          {panel === 'browse' ? (
            <BrowsePanel
              key={selected.sourceId}
              source={selected}
              onProfiled={onChanged}
            />
          ) : null}

          {panel === 'columns' ? (
            <ProfiledColumnsPanel key={`${selected.sourceId}-cols`} source={selected} />
          ) : null}

          {panel === 'browse-documents' ? (
            <DocumentBrowsePanel
              key={`${selected.sourceId}-docs-browse`}
              source={selected}
              onProfiled={onChanged}
            />
          ) : null}

          {panel === 'documents' ? (
            <ProfiledDocumentsPanel key={`${selected.sourceId}-docs`} source={selected} />
          ) : null}

          <Typography.Paragraph className="cat-detail-foot">
            {isDrive
              ? (selected.profiledDocuments ?? 0) === 0
                ? 'No profiled documents yet for this source. Browse & profile some documents first, then watch the Profiling jobs tab.'
                : `${selected.profiledDocuments} document(s) and ${selected.profiledEntities} entities profiled. Re-profile any time from Browse documents for profiling.`
              : selected.profiledTables === 0
                ? 'No profiled tables yet for this source. Browse & profile some tables first, then watch the Profiling jobs tab.'
                : `${selected.profiledTables} table(s) and ${selected.profiledColumns} column(s) profiled. Re-profile any time from Browse table for profiling.`}
          </Typography.Paragraph>
        </div>
        ) : null}
      </Col>
    </Row>
  )
}

/* ---------------- Change signals tab ---------------- */

function ChangeSignalsTab({
  data,
  error,
  loading,
  reload,
}: {
  data: { signals: ChangeSignal[]; connected_sources: number } | null
  error: string | null
  loading: boolean
  reload: () => void
}) {
  if (error) return <ApiErrorAlert error={error} onRetry={() => void reload()} />
  if (!loading && (data?.connected_sources ?? 0) === 0) {
    return (
      <NoSourceConnected detail="Change signals are raised when a connected source drifts — a column type changes, or volume moves against its baseline." />
    )
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {(data?.signals ?? []).map((s: ChangeSignal) => (
        <Alert
          key={s.signal_id}
          type={s.severity === 'serious' ? 'error' : 'warning'}
          showIcon
          title={
            <span>
              {s.kind.replace(/_/g, ' ')} — <code>{s.dataset}.{s.table}</code>
            </span>
          }
          description={
            <div style={{ fontSize: 13 }}>
              <div>{s.detail}</div>
              <div style={{ marginTop: 4, opacity: 0.75 }}>
                {s.action} · detected {s.detected}
              </div>
            </div>
          }
        />
      ))}
    </Space>
  )
}

/* ---------------- Page ---------------- */

export default function CataloguePage() {
  const error = useSourcesStore((s) => s.error)
  const loading = useSourcesStore((s) => s.loading)
  const load = useSourcesStore((s) => s.load)
  const sources = useSourcesStore(selectSources)

  /* The board's own loader. A queued run has to tell it, because its poll has stopped by
     then — see `handleQueued`. */
  const loadJobs = useJobsStore((s) => s.load)

  const signalsData = useSignalsStore((s) => s.data)
  const signalsError = useSignalsStore((s) => s.error)
  const signalsLoading = useSignalsStore((s) => s.loading)
  const loadSignals = useSignalsStore((s) => s.load)

  const [tab, setTab] = useState('catalogue')
  const [running, setRunning] = useState(0)

  useEffect(() => {
    void load()
    void loadSignals()
  }, [load, loadSignals])

  // Profiling moves the source counters, so refresh them when a run settles.
  const handleChanged = useCallback(() => {
    void load()
  }, [load])

  /*
   * Starting a run switches to the jobs board — that is where the pipeline is visible, and a
   * queued job is otherwise invisible from the Catalogue tab.
   *
   * **And the board is re-read here, not left to its own poll.** It loads on mount and then
   * polls only while `active_count > 0`, so the poll that sees 0 stops the loop — which is
   * right for a board nobody is adding to, and wrong the moment a second run is queued while
   * the tab is already open. That is exactly the re-profile confirm: the first click switched
   * here with an all-skipped job that completed instantly, the loop stopped, and pressing
   * "Profile 5 table(s) again" then queued a run on the server that this list never asked
   * about. The run was real; the board was stale, which reads as a click that did nothing.
   */
  const handleQueued = useCallback(() => {
    void load()
    void loadSignals()
    void loadJobs()
    setTab('jobs')
  }, [load, loadSignals, loadJobs])

  return (
    <>
      <PageHeader
        title="Data Catalogue"
        subtitle="Browse and curate every source registered across the platform — BigQuery tables and fields, and Google Drive documents — describing, tagging, and keeping metadata accurate."
      />

      {error ? (
        <ApiErrorAlert error={error} onRetry={() => void load()} />
      ) : (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'catalogue',
              label: 'Catalogue',
              children: (
                <CatalogueTab
                  sources={sources}
                  loading={loading}
                  onChanged={handleQueued}
                />
              ),
            },
            {
              key: 'jobs',
              label:
                running > 0 ? `Profiling jobs (${running} running)` : 'Profiling jobs',
              children: (
                <ProfilingJobsTab
                  onChanged={handleChanged}
                  onActiveCount={setRunning}
                />
              ),
            },
            {
              key: 'signals',
              label: `Change signals (${signalsData?.count ?? 0})`,
              children: (
                <ChangeSignalsTab
                  data={signalsData}
                  error={signalsError}
                  loading={signalsLoading}
                  reload={loadSignals}
                />
              ),
            },
          ]}
        />
      )}
    </>
  )
}
