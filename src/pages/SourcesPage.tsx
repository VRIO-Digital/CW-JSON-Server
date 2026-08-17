import { PlusOutlined } from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Popconfirm,
  Space,
  Table,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { SourceRow } from '../api/client'
import ApiErrorAlert from '../components/ApiErrorAlert'
import ConnectSourceModal from '../components/ConnectSourceModal'
import EditDatasetsModal from '../components/EditDatasetsModal'
import EditFoldersModal from '../components/EditFoldersModal'
import NoSourceConnected from '../components/NoSourceConnected'
import PageHeader from '../components/PageHeader'
import StatCards from '../components/StatCards'
import StatusTag from '../components/StatusTag'
import { confirmSourceAction } from '../data/sourceActions'
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
  const reconnect = useSourcesStore((s) => s.reconnect)
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
    if (result.ok) {
      message.success(
        `${row.sourceName} disconnected — everything it profiled is kept. Reconnect on its row when you want it back.`,
      )
    } else message.error(result.error)
  }

  async function handleReconnect(row: SourceRow) {
    const result = await reconnect(row.sourceId)
    if (result.ok) {
      message.success(`${row.sourceName} reconnected — its profiled objects are unchanged.`)
    } else message.error(result.error)
  }

  async function handleDelete(row: SourceRow) {
    const result = await remove(row.sourceId)
    if (result.ok) message.success(`${row.sourceName} deleted — connect it again to re-register.`)
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
        row.kind === 'gdrive'
          ? `${row.profiledDocuments ?? 0} doc(s) · ${row.profiledEntities ?? 0} entities`
          : row.kind === 'generic'
            ? '—'
            : `${row.profiledTables} table(s) · ${row.profiledColumns} col(s)`,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, row) => (
        <Space size={SP.sm}>
          {/*
            Disabled while the source is disconnected: it has no credential, so widening what it
            may profile would promise access it cannot make. The tooltip says which of the two
            reasons applies — a control that is greyed out with no explanation reads as broken,
            and the fix here (Reconnect, one button along) is a click away. The server refuses
            the same write, because a disabled button is only a courtesy to whoever is looking
            at it.
          */}
          <Tooltip
            title={
              row.status === 'disconnected'
                ? 'Disconnected — reconnect this source before changing its allowlist.'
                : row.kind !== 'bigquery' && row.kind !== 'gdrive'
                  ? 'This connector has no discovery yet, so there is no allowlist to edit.'
                  : undefined
            }
          >
            {/* A disabled antd button fires no events, so the tooltip needs a wrapper to hover. */}
            <span>
              <Button
                size="small"
                disabled={
                  row.status === 'disconnected' ||
                  (row.kind !== 'bigquery' && row.kind !== 'gdrive')
                }
                onClick={() => setEditing(row)}
              >
                {row.kind === 'gdrive' ? 'Edit folders' : 'Edit datasets'}
              </Button>
            </span>
          </Tooltip>
          {/* A disconnected row offers the undo instead of the act it has already had: two
              buttons where only one can ever apply is a row asking a question it has answered.

              Both confirmations below are a question and nothing else — no `description`. Both
              titles come from `confirmSourceAction`, so neither can word the act the other's
              way. */}
          {row.status === 'disconnected' ? (
            <Button
              size="small"
              onClick={() => void handleReconnect(row)}
              loading={pending === row.sourceId}
            >
              Reconnect
            </Button>
          ) : (
            <Popconfirm
              title={confirmSourceAction('disconnect')}
              okText="Disconnect"
              cancelText="Keep connected"
              onConfirm={() => void handleDisconnect(row)}
            >
              <Button size="small" danger loading={pending === row.sourceId}>
                Disconnect
              </Button>
            </Popconfirm>
          )}
          <Popconfirm
            title={confirmSourceAction('delete')}
            okText="Delete permanently"
            cancelText="Cancel"
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
            title="Connection status updates as soon as a source is registered. Table and column counts remain at 0 until metadata profiling has been completed for that source."
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

      {/* One row is being edited at a time, and its connector decides which
          allowlist that means — datasets for BigQuery, folders for Drive. */}
      <EditDatasetsModal
        source={editing?.kind === 'bigquery' ? editing : null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void load()
        }}
      />

      <EditFoldersModal
        source={editing?.kind === 'gdrive' ? editing : null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void load()
        }}
      />
    </>
  )
}
