import { ReloadOutlined } from '@ant-design/icons'
import {
  App,
  Badge,
  Button,
  Card,
  Flex,
  Progress,
  Space,
  Table,
  // Tag,
  Typography,
  type TableColumnsType,
} from 'antd'
import { useEffect, useState } from 'react'
import type { ProfilingJob } from '../api/client'
import { useJobsStore } from '../store/catalogStore'
import { SP } from '../theme'
import ApiErrorAlert from '../components/ApiErrorAlert'
import StatusTag from './StatusTag'
import './ProfilingJobsTab.css'

const POLL_MS = 3000

const TONE = {
  queued: 'neutral',
  running: 'info',
  complete: 'good',
  cancelled: 'warn',
  failed: 'crit',
} as const

function elapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  return `${m}m ${seconds % 60}s`
}

const clockTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString() : '—'

/** "table(s)" or "document(s)" — the board carries runs of both. */
const units = (job: ProfilingJob, count: number) =>
  `${count} ${job.unit}${count === 1 ? '' : 's'}`

/** "1: em_import_0" — count plus the object names themselves. */
function ObjectsSelected({ job }: { job: ProfilingJob }) {
  return (
    <span>
      <strong>{units(job, job.object_count)}:</strong>{' '}
      <Typography.Text code className="pj-tables">
        {job.objects.map((o) => o.label).join(', ')}
      </Typography.Text>
    </span>
  )
}

function JobDetail({ job }: { job: ProfilingJob }) {
  const profiled = job.objects.filter((o) => o.state === 'profiled')
  const skipped = job.objects.filter((o) => o.state === 'skipped')

  return (
    <div className="pj-detail">
      <div className="pj-detail-line">
        <strong>Job</strong>{' '}
        <Typography.Text code>{job.job_id}</Typography.Text>
      </div>

      <div className="pj-detail-line">
        <strong>{units(job, job.object_count)}:</strong>{' '}
        <Typography.Text code>
          {job.objects.map((o) => o.label).join(', ')}
        </Typography.Text>
      </div>

      <div className="pj-detail-stage">
        Stage {job.stage_index} of {job.stage_total}: {job.stage_label}
      </div>

      {/* Blue while the pipeline is moving, green once it has landed. */}
      <Progress
        percent={job.progress}
        showInfo={false}
        strokeColor={
          job.status === 'complete'
            ? '#0f7b4f'
            : job.status === 'cancelled'
              ? '#b45309'
              : '#1d4ed8'
        }
      />

      <div className="pj-detail-line">
        <strong>Progress:</strong> {job.objects_done} / {job.object_count}
        {profiled.length > 0 ? (
          <>
            {' · '}
            {profiled.map((o) => `${o.object_id}:profiled`).join(', ')}
          </>
        ) : null}
        {skipped.length > 0 ? (
          <>
            {' · '}
            {skipped.map((o) => `${o.object_id}:skipped`).join(', ')}
          </>
        ) : null}
      </div>

      {/* <div className="pj-detail-line pj-detail-muted">
        <strong>Triggered by:</strong> {job.triggered_by}
        {job.force ? (
          <Tag className="pj-forced" color="warning" variant="filled">
            forced
          </Tag>
        ) : null}
      </div> */}

      {job.error ? (
        <div className="pj-detail-line pj-detail-error">
          <strong>Error:</strong> {job.error}
        </div>
      ) : null}
    </div>
  )
}

export default function ProfilingJobsTab({
  onChanged,
  onActiveCount,
}: {
  /** Profiling moves the source counters, so the Catalog tab needs a nudge. */
  onChanged: () => void
  /** Lets the tab label read "Profiling jobs (1 running)". */
  onActiveCount: (count: number) => void
}) {
  const { message } = App.useApp()
  const data = useJobsStore((s) => s.data)
  const error = useJobsStore((s) => s.error)
  const loading = useJobsStore((s) => s.loading)
  const cancelling = useJobsStore((s) => s.cancelling)
  const load = useJobsStore((s) => s.load)
  const cancelJob = useJobsStore((s) => s.cancel)
  const rerunJob = useJobsStore((s) => s.rerun)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    void load()
  }, [load])

  const activeCount = data?.active_count ?? 0

  // Poll only while something is in flight; the poll that sees 0 stops the loop.
  useEffect(() => {
    if (activeCount === 0) return
    const id = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(id)
  }, [activeCount, load])

  useEffect(() => {
    onActiveCount(activeCount)
  }, [activeCount, onActiveCount])

  // When the last job finishes, the source counters have changed.
  useEffect(() => {
    if (activeCount === 0) onChanged()
  }, [activeCount, onChanged])

  async function cancel(job: ProfilingJob) {
    const result = await cancelJob(job.job_id)
    if (result.ok) message.warning(`Job ${job.short_id} cancelled.`)
    else message.error(result.error)
  }

  async function rerun(job: ProfilingJob, force: boolean) {
    const result = await rerunJob(job, force)
    if (result.ok)
      message.success(force ? 'Queued a forced re-profile.' : 'Queued a re-profile.')
    else message.error(result.error)
  }

  const shared: TableColumnsType<ProfilingJob> = [
    {
      title: 'job',
      dataIndex: 'short_id',
      width: 130,
      render: (id: string) => <Typography.Text code>{id}</Typography.Text>,
    },
    {
      title: 'pipeline',
      dataIndex: 'pipeline',
      render: (p: string) => <span className="pj-pipeline">{p}</span>,
    },
    {
      title: 'status',
      dataIndex: 'status',
      width: 120,
      render: (s: ProfilingJob['status']) => (
        <StatusTag tone={TONE[s]}>{s}</StatusTag>
      ),
    },
    {
      title: 'selected',
      key: 'objects',
      render: (_, job) => <ObjectsSelected job={job} />,
    },
    {
      title: 'triggered',
      dataIndex: 'triggered_at',
      width: 120,
      render: (iso: string) => clockTime(iso),
    },
    {
      title: 'elapsed',
      dataIndex: 'elapsed_seconds',
      width: 100,
      render: (s: number) => elapsed(s),
    },
  ]

  const activeColumns: TableColumnsType<ProfilingJob> = [
    ...shared,
    {
      title: 'progress / error',
      key: 'progress',
      width: 160,
      render: (_, job) =>
        `${job.objects_done}/${units(job, job.object_count)}`,
    },
    {
      title: '',
      key: 'cancel',
      width: 110,
      render: (_, job) => (
        <Button
          size="small"
          danger
          loading={cancelling === job.job_id}
          onClick={() => void cancel(job)}
        >
          Cancel
        </Button>
      ),
    },
  ]

  const recentColumns: TableColumnsType<ProfilingJob> = [
    ...shared,
    {
      title: 'result / error',
      key: 'result',
      width: 130,
      render: (_, job) =>
        job.error ? (
          <Typography.Text type="danger">{job.error}</Typography.Text>
        ) : (
          `${job.objects_done}/${units(job, job.object_count)}`
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 170,
      render: (_, job) => (
        <Space size={SP.sm}>
          <Button size="small" onClick={() => void rerun(job,true)}>
            Re-profile
          </Button>
          <Button size="small" onClick={() => void rerun(job, true)}>
            Force
          </Button>
        </Space>
      ),
    },
  ]

  if (error) return <ApiErrorAlert error={error} onRetry={() => void load()} />

  return (
    <>
      <Flex align="center" justify="space-between" gap={SP.md} className="pj-bar">
        <Typography.Text className={`pj-status${activeCount > 0 ? ' is-live' : ''}`}>
          {activeCount > 0 ? <Badge status="processing" /> : null}
          {activeCount > 0
            ? `live — ${activeCount} active, refreshing every ${POLL_MS / 1000}s`
            : 'idle — nothing running'}
        </Typography.Text>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          Refresh now
        </Button>
      </Flex>

      <Card
        title={
          <Space size={SP.md}>
            Active now
            <Badge count={activeCount} showZero color={activeCount > 0 ? '#f4562b' : '#d9dee6'} />
          </Space>
        }
        style={{ marginBottom: SP.lg }}
      >
        <Table
          columns={activeColumns}
          dataSource={data?.active ?? []}
          rowKey="job_id"
          pagination={false}
          size="middle"
          scroll={{ x: 'max-content' }}
          expandable={{
            expandedRowRender: (job) => <JobDetail job={job} />,
            /*
             * Active rows are expanded unless the user collapses them. Tracking
             * opt-outs rather than opt-ins means a job that appears mid-poll
             * shows its progress without a click.
             */
            expandedRowKeys: (data?.active ?? [])
              .map((j) => j.job_id)
              .filter((id) => !collapsed.has(id)),
            onExpand: (expanded, job) =>
              setCollapsed((prev) => {
                const next = new Set(prev)
                if (expanded) next.delete(job.job_id)
                else next.add(job.job_id)
                return next
              }),
          }}
          locale={{ emptyText: 'No profiling jobs running right now.' }}
        />
      </Card>

      <Card
        title={
          <Space size={SP.md}>
            Recent jobs
            <Badge count={data?.recent_count ?? 0} showZero color="#d9dee6" />
          </Space>
        }
      >
        <Table
          columns={recentColumns}
          dataSource={data?.recent ?? []}
          rowKey="job_id"
          loading={loading && !data}
          pagination={false}
          size="middle"
          scroll={{ x: 'max-content' }}
          expandable={{
            expandedRowRender: (job) => <JobDetail job={job} />,
            rowExpandable: () => true,
          }}
          locale={{
            emptyText:
              'No finished runs yet. Start one from Browse table for profiling, ' +
              'or Browse documents for profiling on a Drive source.',
          }}
        />
      </Card>
    </>
  )
}
