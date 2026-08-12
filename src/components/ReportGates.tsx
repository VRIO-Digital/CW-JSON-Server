import { Card, Table, Tag, Typography, type TableColumnsType } from 'antd'
import type { ReportGovernance } from '../api/client'
import '../pages/ReportsPage.css'

/*
 * The two gates, as two grids.
 *
 * **Never collapsed into one**, which is the served note's whole point: the first says who may see
 * that a report exists, the second says which rows a viewer's predicate admits, and a single
 * permission built from both is wrong in both directions. Every string here is the payload's — the
 * component decides layout and nothing else.
 *
 * A cell's tint comes from its own `tone` and carries its wording, so no state is colour-only.
 */
export function EntitlementGate({ gate }: { gate: ReportGovernance['gates']['entitlement'] }) {
  return (
    <Card
      className="rp-gate"
      title={
        <div className="rp-gate-head">
          <span>Gate 1 — audience entitlement</span>
          <Tag className="rp-chip">who may see it exists</Tag>
        </div>
      }
    >
      <p className="rp-gate-note">{gate.note}</p>

      {/* Scrolls inside its own container: a column per definition outgrows any page width. */}
      <div className="rp-matrix-scroll">
        <table className="rp-matrix">
          <thead>
            <tr>
              <th className="rp-matrix-role">ROLE</th>
              {gate.columns.map((col) => (
                /* Named columns. A grid whose headers do not say which report a cell is about is
                   a wall of tinted words — the prototype's own headers printed
                   `[object Object]`, which is what this replaces. */
                <th key={col.reportId}>
                  <span className="rp-matrix-col">{col.title}</span>
                  <span className="rp-dim rp-matrix-tag">{col.reportTag}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gate.roles.map((role) => (
              <tr key={role.roleId}>
                <th scope="row" className="rp-matrix-role">
                  {role.label}
                </th>
                {role.cells.map((cell) => (
                  <td key={cell.reportId}>
                    <span className={`rp-cell rp-cell-${cell.tone}`}>{cell.label}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

const scopeColumns: TableColumnsType<ReportGovernance['gates']['dataScope']['rows'][number]> = [
  { title: 'Role', dataIndex: 'label', render: (label: string) => <b>{label}</b> },
  { title: 'Scope', dataIndex: 'scope' },
  {
    title: 'Predicate',
    dataIndex: 'predicate',
    render: (predicate: string) => <span className="rp-mono">{predicate}</span>,
  },
  { title: 'Grain', dataIndex: 'grain' },
  { title: 'Masked', dataIndex: 'masked' },
]

export function DataScopeGate({ gate }: { gate: ReportGovernance['gates']['dataScope'] }) {
  return (
    <Card
      className="rp-gate"
      title={
        <div className="rp-gate-head">
          <span>Gate 2 — data scope</span>
          <Tag className="rp-chip">which rows a predicate admits</Tag>
        </div>
      }
    >
      <p className="rp-gate-note">{gate.note}</p>
      <Table
        rowKey="roleId"
        size="small"
        pagination={false}
        className="rp-table"
        columns={scopeColumns}
        dataSource={gate.rows}
      />
      <Typography.Text className="rp-dim rp-gate-foot">
        Every role above is switchable from the login. The same report opened under two of these
        rows is the demo: one definition, two very different pages.
      </Typography.Text>
    </Card>
  )
}
