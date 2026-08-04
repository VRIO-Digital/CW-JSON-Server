import { ClockCircleOutlined, ThunderboltOutlined } from '@ant-design/icons'
import {
  Button,
  Card,
  Table,
  Tooltip,
  Typography,
  type TableColumnsType,
} from 'antd'
import { useEffect } from 'react'
import { type Span, type Trace } from '../api/client'
import { useTracesStore } from '../store/telemetryStore'
import ApiErrorAlert from '../components/ApiErrorAlert'
import NoSourceConnected from '../components/NoSourceConnected'
import PageHeader from '../components/PageHeader'
import StatCards from '../components/StatCards'
import StatusTag from '../components/StatusTag'
import { BRAND, SP, STATUS } from '../theme'

const traceColumns: TableColumnsType<Trace> = [
  {
    title: 'Trace ID',
    dataIndex: 'id',
    render: (id: string) => <Typography.Text code>{id}</Typography.Text>,
  },
  {
    title: 'Operation',
    dataIndex: 'operation',
    render: (operation: string, row) => (
      <>
        <Typography.Text strong style={{ display: 'block' }}>
          {operation}
        </Typography.Text>
        <Typography.Text type="secondary">{row.service}</Typography.Text>
      </>
    ),
  },
  {
    title: 'Status',
    dataIndex: 'status',
    render: (status: string, row) => <StatusTag tone={row.tone}>{status}</StatusTag>,
  },
  {
    title: 'Duration',
    dataIndex: 'duration',
    align: 'right',
    render: (ms: number) => `${ms.toLocaleString()} ms`,
  },
  { title: 'Spans', dataIndex: 'spans', align: 'right' },
  { title: 'Started', dataIndex: 'at', align: 'right' },
]

/*
 * A span waterfall needs an offset bar per row — a data mark antd has no
 * component for, so the bar itself is a plain div inside an antd Table cell.
 * One hue for duration magnitude; the warn hue flags the slow spans.
 */
function spanColumns(totalMs: number): TableColumnsType<Span> {
  return [
    {
      title: 'Span',
      dataIndex: 'name',
      width: 260,
      ellipsis: true,
      render: (name: string) => (
        <Typography.Text type="secondary">{name}</Typography.Text>
      ),
    },
    {
      title: 'Timeline',
      dataIndex: 'start',
      render: (_: number, row) => (
        <Tooltip title={`starts at ${row.start} ms · runs ${row.duration} ms`}>
          <div className="span-track">
            <div
              className="span-bar"
              style={{
                left: `${(row.start / totalMs) * 100}%`,
                width: `${(row.duration / totalMs) * 100}%`,
                background: row.duration > 50 ? STATUS.warn : BRAND,
              }}
            />
          </div>
        </Tooltip>
      ),
    },
    {
      title: 'Duration',
      dataIndex: 'duration',
      align: 'right',
      width: 100,
      render: (ms: number) => `${ms} ms`,
    },
  ]
}

export default function TracePage() {
  const { data, error, loading, load } = useTracesStore()

  useEffect(() => {
    void load()
  }, [load])
  const waterfall = data?.waterfall

  return (
    <>
      <PageHeader
        title="Trace & Observability"
        subtitle="End-to-end latency for every context request, down to the individual span."
        actions={
          <>
            <Button icon={<ClockCircleOutlined />}>Last 15 min</Button>
            <Button type="primary" icon={<ThunderboltOutlined />}>
              Live tail
            </Button>
          </>
        }
      />

      {error ? (
        <ApiErrorAlert error={error} onRetry={() => void load()} />
      ) : !loading && (data?.connected_sources ?? 0) === 0 ? (
        <NoSourceConnected detail="Traces are emitted when context requests hit a connected source. Connect one and its request latency and spans will appear here." />
      ) : (
        <>
          <StatCards stats={data?.stats ?? []} />

          <Card
            title="Recent traces"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                {data?.sampling ?? ''}
              </Typography.Text>
            }
            style={{ marginBottom: SP.lg }}
          >
            <Table
              columns={traceColumns}
              dataSource={data?.items ?? []}
              rowKey="id"
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
            />
          </Card>

          {waterfall ? (
            <Card
              title={`Span waterfall — ${waterfall.trace_id}`}
              extra={
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  {waterfall.operation} · {waterfall.total_ms} ms total
                </Typography.Text>
              }
            >
              <Table
                columns={spanColumns(waterfall.total_ms)}
                dataSource={waterfall.spans}
                rowKey="name"
                pagination={false}
                size="middle"
              />
            </Card>
          ) : null}
        </>
      )}
    </>
  )
}
