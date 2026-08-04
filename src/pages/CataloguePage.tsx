import { CloseOutlined } from '@ant-design/icons'
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
import { useBrowseStore, useSignalsStore } from '../store/catalogueStore'
import { selectSources, useSourcesStore } from '../store/sourcesStore'
import ApiErrorAlert from '../components/ApiErrorAlert'
import ConnectorIcon from '../components/ConnectorIcon'
import NoSourceConnected from '../components/NoSourceConnected'
import PageHeader from '../components/PageHeader'
import ProfiledColumnsPanel from '../components/ProfiledColumnsPanel'
import ProfilingJobsTab from '../components/ProfilingJobsTab'
import StatusTag from '../components/StatusTag'
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
  onClose,
  onProfiled,
}: {
  source: SourceRow
  onClose: () => void
  onProfiled: () => void
}) {
  const { message } = App.useApp()
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
      title: (
        <span className="cat-tree-row">
          <span>
            <Tag className="cat-tree-kind">{t.type}</Tag>
            <span className="cat-tree-table">{t.table_id}</span>
          </span>
          <span className="cat-tree-count">
            {t.columns} col(s)
            {t.profiled ? ' · profiled' : ''}
          </span>
        </span>
      ),
    })),
  }))

  const selected = checked.filter((k) => k.startsWith('t:'))

  async function startProfiling() {
    // Never forced from here — re-profiling an already-profiled table is done
    // per-job from the Profiling jobs tab, which has its own Force action.
    const result = await startProfilingRun(
      source.sourceId,
      selected.map(parseLeaf),
      false,
    )
    if (!result.ok) {
      message.warning(result.error)
      return
    }
    const { job } = result
    const queued = job.tables.filter((t) => t.state === 'pending').length
    const skipped = job.tables.filter((t) => t.state === 'skipped').length
    message.success(
      queued === 0
        ? `Nothing to profile — ${skipped} table(s) already profiled. Use Force on the run in Profiling jobs to redo them.`
        : `Queued ${queued} table(s) — job ${job.short_id} is starting.` +
            (skipped > 0 ? ` ${skipped} already profiled, skipped.` : ''),
    )
    onProfiled()
  }

  return (
    <div className="cat-browse">
      <Flex justify="flex-end">
        <Button type="link" size="small" icon={<CloseOutlined />} onClick={onClose}>
          close
        </Button>
      </Flex>

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
  const [panel, setPanel] = useState<'none' | 'browse' | 'columns'>('none')

  const selected =
    sources.find((s) => s.sourceId === activeId) ?? sources[0] ?? null

  // Keep the selection valid when the list changes underneath.
  useEffect(() => {
    if (selected && selected.sourceId !== activeId) setActiveId(selected.sourceId)
  }, [selected, activeId])

  if (!loading && sources.length === 0) {
    return (
      <NoSourceConnected detail="Datasets are discovered from connected sources. Connect a BigQuery project and its tables will be browsable here." />
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
                <span className="cat-source-id">{s.sourceId}</span>
                <span className="cat-source-meta">
                  {s.projectAccount} · {s.profiledTables} tables profiled · {s.status}
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
            <StatusTag tone={selected.status === 'connected' ? 'good' : 'neutral'}>
              {selected.status}
            </StatusTag>
          </Flex>

          <Row gutter={[SP.base, SP.base]} style={{ marginBottom: SP.lg }}>
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label="project"
                value={selected.projectAccount}
                note="GCP project"
                mono
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label="datasets allowed"
                value={String(selected.datasets.length)}
                note="in the allowlist"
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label="tables profiled"
                value={String(selected.profiledTables)}
                note="for this source"
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatBox
                label="columns profiled"
                value={String(selected.profiledColumns)}
                note="for this source"
              />
            </Col>
          </Row>

          <Space wrap size={SP.sm} className="cat-actions">
            <Button
              type="primary"
              disabled={selected.kind !== 'bigquery'}
              onClick={() => setPanel(panel === 'browse' ? 'none' : 'browse')}
            >
              Browse table for profiling
            </Button>
            <Button
              disabled={selected.kind !== 'bigquery'}
              onClick={() => setPanel(panel === 'columns' ? 'none' : 'columns')}
            >
              View profiled columns
            </Button>
          </Space>

          {panel === 'browse' ? (
            <BrowsePanel
              key={selected.sourceId}
              source={selected}
              onClose={() => setPanel('none')}
              onProfiled={onChanged}
            />
          ) : null}

          {panel === 'columns' ? (
            <ProfiledColumnsPanel
              key={`${selected.sourceId}-cols`}
              source={selected}
              onClose={() => setPanel('none')}
            />
          ) : null}

          <Typography.Paragraph className="cat-detail-foot">
            {selected.profiledTables === 0
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

  // Starting a run switches to the jobs board — that is where the pipeline is
  // visible, and a queued job is otherwise invisible from the Catalogue tab.
  const handleQueued = useCallback(() => {
    void load()
    void loadSignals()
    setTab('jobs')
  }, [load, loadSignals])

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
