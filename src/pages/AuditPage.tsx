import { PlusOutlined } from '@ant-design/icons'
import {
  Button,
  Card,
  List,
  Table,
  Typography,
  type TableColumnsType,
} from 'antd'
import { useEffect } from 'react'
import { type AuditEvent } from '../api/client'
import { useAuditStore } from '../store/telemetryStore'
import { SP } from '../theme'
import ApiErrorAlert from '../components/ApiErrorAlert'
import NoSourceConnected from '../components/NoSourceConnected'
import PageHeader from '../components/PageHeader'
import StatCards from '../components/StatCards'
import StatusTag from '../components/StatusTag'

const columns: TableColumnsType<AuditEvent> = [
  {
    title: 'Severity',
    dataIndex: 'severity',
    render: (severity: string, row) => (
      <StatusTag tone={row.tone}>{severity}</StatusTag>
    ),
  },
  { title: 'Action', dataIndex: 'action' },
  {
    title: 'Resource',
    dataIndex: 'resource',
    render: (resource: string) => <Typography.Text code>{resource}</Typography.Text>,
  },
  {
    title: 'Actor',
    dataIndex: 'actor',
    render: (actor: string) => <Typography.Text code>{actor}</Typography.Text>,
  },
  { title: 'When', dataIndex: 'at', align: 'right' },
]

export default function AuditPage() {
  const { data, error, loading, load } = useAuditStore()

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <PageHeader
        title="Audit & Governance"
        subtitle="Who touched what, under which policy, and what still needs a decision."
        actions={
          <Button type="primary" icon={<PlusOutlined />}>
            New policy
          </Button>
        }
      />

      {error ? (
        <ApiErrorAlert error={error} onRetry={() => void load()} />
      ) : !loading && (data?.connected_sources ?? 0) === 0 ? (
        <NoSourceConnected detail="Audit events and policy decisions are recorded against connected sources. Connect one and its access, export and masking activity will be logged here." />
      ) : (
        <>
          <StatCards stats={data?.stats ?? []} />

          <Card
            title="Audit trail"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                {data?.event_window ?? ''}
              </Typography.Text>
            }
            style={{ marginBottom: SP.lg }}
          >
            <Table
              columns={columns}
              dataSource={data?.events ?? []}
              rowKey={(row) => `${row.actor}-${row.at}`}
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
            />
          </Card>

          <Card
            title="Governance policies"
            extra={
              <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                {data ? `${data.policies.length} of ${data.policy_total}` : ''}
              </Typography.Text>
            }
          >
            <List
              dataSource={data?.policies ?? []}
              loading={loading}
              renderItem={(policy) => (
                <List.Item
                  style={{ padding: '13px 18px' }}
                  extra={<StatusTag tone={policy.tone}>{policy.status}</StatusTag>}
                >
                  <List.Item.Meta title={policy.name} description={policy.desc} />
                </List.Item>
              )}
            />
          </Card>
        </>
      )}
    </>
  )
}
