import { PlusOutlined } from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Popconfirm,
  Space,
  Table,
  Typography,
  type TableColumnsType,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { SourceRow } from '../api/client'
import ApiErrorAlert from '../components/ApiErrorAlert'
import ConnectSourceModal from '../components/ConnectSourceModal'
import EditDatasetsModal from '../components/EditDatasetsModal'
import NoSourceConnected from '../components/NoSourceConnected'
import PageHeader from '../components/PageHeader'
import StatCards from '../components/StatCards'
import StatusTag from '../components/StatusTag'
import { selectSources, useSourcesStore } from '../store/sourcesStore'
import { SP } from '../theme'
import type { Stat } from '../types'

const STATUS_TONE = {
  connected: 'good',
  syncing: 'info',
  disconnected: 'neutral',
} as const

export default function SourcesPage() {
  const { message } = App.useApp()
  const [connectOpen, setConnectOpen] = useState(false)
  const [editing, setEditing] = useState<SourceRow | null>(null)

  // Individually selected so a change to one field re-renders only what needs it.
  const data = useSourcesStore((s) => s.data)
  const loading = useSourcesStore((s) => s.loading)
  const error = useSourcesStore((s) => s.error)
  const pending = useSourcesStore((s) => s.pending)
  const load = useSourcesStore((s) => s.load)
  const disconnect = useSourcesStore((s) => s.disconnect)
  const remove = useSourcesStore((s) => s.remove)
  const sources = useSourcesStore(selectSources)

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo<Stat[]>(
    () => [
      {
        label: 'Registered sources',
        value: String(data?.registeredCount ?? 0),
        note: 'real, from GET /sources',
      },
      {
        label: 'Profiled tables',
        value: String(data?.profiledTables ?? 0),
        note: 'across all sources',
      },
      {
        label: 'Profiled columns',
        value: String(data?.profiledColumns ?? 0),
        note: 'across all sources',
      },
      {
        label: 'Profiled documents',
        value: String(data?.profiledDocuments ?? 0),
        note: 'across Drive sources',
      },
    ],
    [data],
  )

  async function handleDisconnect(row: SourceRow) {
    const result = await disconnect(row.sourceId)
    if (result.ok) message.success(`${row.sourceId} disconnected — registration kept.`)
    else message.error(result.error)
  }

  async function handleDelete(row: SourceRow) {
    const result = await remove(row.sourceId)
    if (result.ok) message.success(`${row.sourceId} deleted.`)
    else message.error(result.error)
  }

  const columns: TableColumnsType<SourceRow> = [
    {
      title: 'source name',
      dataIndex: 'sourceName',
      render: (sourceName: string, row) => (
        <>
          <Typography.Text strong style={{ display: 'block' }}>
            {sourceName}
          </Typography.Text>
          {/* The id is what Disconnect/Delete act on, so keep it visible. */}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.sourceId}
          </Typography.Text>
        </>
      ),
    },
    {
      title: 'status',
      dataIndex: 'status',
      render: (status: string) => (
        <StatusTag tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? 'neutral'}>
          {status}
        </StatusTag>
      ),
    },
    { title: 'project / account', dataIndex: 'projectAccount' },
    { title: 'scope', dataIndex: 'scope' },
    {
      title: 'connected',
      dataIndex: 'connectedAt',
      render: (iso: string) => new Date(iso).toLocaleString(),
    },
    {
      title: 'profiled',
      key: 'profiled',
      render: (_, row) =>
        row.kind === 'generic'
          ? `${row.profiledDocuments ?? 0} doc(s)`
          : `${row.profiledTables} table(s) · ${row.profiledColumns} col(s)`,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, row) => (
        <Space size={SP.sm}>
          <Button
            size="small"
            disabled={row.kind !== 'bigquery'}
            onClick={() => setEditing(row)}
          >
            Edit datasets
          </Button>
          <Popconfirm
            title="Disconnect this source?"
            description="The credential is revoked but the registration is kept."
            okText="Disconnect"
            onConfirm={() => void handleDisconnect(row)}
          >
            <Button
              size="small"
              danger
              disabled={row.status === 'disconnected'}
              loading={pending === row.sourceId}
            >
              Disconnect
            </Button>
          </Popconfirm>
          <Popconfirm
            title="Delete this source?"
            description="Registration and its catalogue entries are removed."
            okText="Delete"
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleDelete(row)}
          >
            <Button size="small" danger loading={pending === row.sourceId}>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Sources"
        subtitle="Registered source systems and their connection health. Credentials are held by reference — ContextWeave never stores a raw secret. Registering a source kicks off extraction and profiling automatically."
        actions={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setConnectOpen(true)}
          >
            Connect source
          </Button>
        }
      />

      {error ? (
        <ApiErrorAlert error={error} onRetry={() => void load()} />
      ) : (
        <>
          <StatCards stats={stats} />

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: SP.lg }}
            title="Connection status is real, from GET /sources — it shows the instant a source is registered, independent of profiling. Table/column counts come from GET /catalogue and stay 0 until the Metadata Profiler has run on that source."
          />

          {!loading && sources.length === 0 ? (
            <NoSourceConnected
              detail="Register a BigQuery project or a Drive folder and it will appear here the instant it is connected, with extraction and profiling kicked off automatically."
              action={
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setConnectOpen(true)}
                >
                  Connect source
                </Button>
              }
            />
          ) : (
            <Table
              columns={columns}
              dataSource={sources}
              rowKey="sourceId"
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
            />
          )}
        </>
      )}

      <ConnectSourceModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnect={(name) => {
          void load()
          message.success(`${name} registered — profiling started.`)
        }}
        onRegistered={() => void load()}
      />

      <EditDatasetsModal
        source={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void load()
        }}
      />
    </>
  )
}
