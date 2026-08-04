import { HistoryOutlined, PlayCircleOutlined } from '@ant-design/icons'
import {
  Button,
  Card,
  Progress,
  Table,
  Typography,
  type TableColumnsType,
} from 'antd'
import { useEffect } from 'react'
import { type Check, type EvalRun } from '../api/client'
import { useEvalsStore } from '../store/telemetryStore'
import ApiErrorAlert from '../components/ApiErrorAlert'
import NoSourceConnected from '../components/NoSourceConnected'
import PageHeader from '../components/PageHeader'
import StatCards from '../components/StatCards'
import StatusTag from '../components/StatusTag'
import { SP, STATUS } from '../theme'

const rateColor = (r: number) =>
  r >= 95 ? STATUS.good : r >= 80 ? STATUS.warn : STATUS.crit

const runColumns: TableColumnsType<EvalRun> = [
  {
    title: 'Suite',
    dataIndex: 'suite',
    render: (suite: string, row) => (
      <>
        <Typography.Text strong style={{ display: 'block' }}>
          {suite}
        </Typography.Text>
        <Typography.Text type="secondary">{row.target}</Typography.Text>
      </>
    ),
  },
  {
    title: 'Result',
    dataIndex: 'status',
    render: (status: string, row) => <StatusTag tone={row.tone}>{status}</StatusTag>,
  },
  {
    title: 'Checks',
    dataIndex: 'checks',
    align: 'right',
    render: (n: number) => n.toLocaleString(),
  },
  {
    title: 'Pass rate',
    dataIndex: 'passRate',
    width: 190,
    render: (rate: number) => (
      <Progress
        percent={rate}
        size="small"
        strokeColor={rateColor(rate)}
        format={(p) => `${p?.toFixed(1)}%`}
      />
    ),
  },
  { title: 'Ran', dataIndex: 'ranAt', align: 'right' },
]

const checkColumns: TableColumnsType<Check> = [
  {
    title: 'Result',
    dataIndex: 'result',
    render: (result: string, row) => <StatusTag tone={row.tone}>{result}</StatusTag>,
  },
  {
    title: 'Check',
    dataIndex: 'name',
    render: (name: string) => <Typography.Text code>{name}</Typography.Text>,
  },
  { title: 'Target', dataIndex: 'dataset' },
  {
    title: 'Detail',
    dataIndex: 'detail',
    render: (detail: string) => (
      <Typography.Text type="secondary">{detail}</Typography.Text>
    ),
  },
]

export default function ValidationPage() {
  const { data, error, loading, load } = useEvalsStore()

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <PageHeader
        title="Validation & Evals"
        subtitle="Data contracts and model evals on one scoreboard — what passed, what regressed."
        actions={
          <>
            <Button icon={<HistoryOutlined />}>View history</Button>
            <Button type="primary" icon={<PlayCircleOutlined />}>
              Run suite
            </Button>
          </>
        }
      />

      {error ? (
        <ApiErrorAlert error={error} onRetry={() => void load()} />
      ) : !loading && (data?.connected_sources ?? 0) === 0 ? (
        <NoSourceConnected detail="Data contracts and evals run against connected sources. Connect one and its suite results will be scored here." />
      ) : (
        <>
          <StatCards stats={data?.stats ?? []} />

          <Card
            title="Latest runs"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                {data?.run_trigger ?? ''}
              </Typography.Text>
            }
            style={{ marginBottom: SP.lg }}
          >
            <Table
              columns={runColumns}
              dataSource={data?.runs ?? []}
              rowKey="suite"
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
            />
          </Card>

          <Card
            title="Open failures & warnings"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                {data?.failure_summary ?? ''}
              </Typography.Text>
            }
          >
            <Table
              columns={checkColumns}
              dataSource={data?.checks ?? []}
              rowKey="name"
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
            />
          </Card>
        </>
      )}
    </>
  )
}
