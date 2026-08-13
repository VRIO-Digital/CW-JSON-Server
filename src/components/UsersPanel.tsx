import { Card, Table, Typography } from 'antd'
import type { SettingsUser } from '../api/client'
import { SP } from '../theme'

/**
 * The Add User tab: who exists, and which persona each one is.
 *
 * **Its own component, and a pure one.** Both Settings tabs take their data as props so they can be
 * asserted on under `renderToString` — a store-connected component renders zustand's *initial* state
 * there, and a tab behind a parent's `useState` renders not at all. That is the same rule
 * `SidebarFooter` and `ConnectSourceWizard` follow.
 *
 * **This table is what the login reads.** Signing in takes an email and a password; the persona is the
 * one on this row, which is why the login has no role picker. The rows come from `settings.json` and the
 * role *labels* are resolved server-side from `db.auth_roles`, so no persona name is stored twice.
 */
export default function UsersPanel({
  users,
  signedInEmail,
}: {
  users: SettingsUser[]
  /** Marks the row you are signed in as — the one fact this table can state about the reader. */
  signedInEmail?: string | null
}) {
  return (
    <>
      <Typography.Paragraph type="secondary" style={{ maxWidth: 720, fontSize: 13.5 }}>
        The people this prototype can sign in, one per persona. <b>The login has no role picker:</b> it
        takes an email and a password, and the persona is the one on that user’s row here. There is no
        user-creation endpoint — adding a person is an edit to the settings store, then
        <Typography.Text code>npm run seed:settings</Typography.Text>. What each persona may{' '}
        <em>see</em> is on the Persona Configuration tab.
      </Typography.Paragraph>

      <Card title="Users and roles" style={{ padding: SP.base }}>
        <Table<SettingsUser>
          dataSource={users}
          rowKey="id"
          pagination={false}
          size="middle"
          /* Four columns of names and addresses overflow a phone; the table scrolls inside its own box
             rather than making the page scroll sideways. */
          scroll={{ x: 'max-content' }}
          columns={[
            { title: '#', dataIndex: 'id', width: 56 },
            { title: 'Role', dataIndex: 'roleLabel' },
            {
              title: 'User',
              dataIndex: 'name',
              render: (name: string, row) => (
                <>
                  <Typography.Text strong>{name}</Typography.Text>
                  {signedInEmail && row.email.toLowerCase() === signedInEmail.toLowerCase() ? (
                    <Typography.Text type="secondary" style={{ marginInlineStart: SP.sm }}>
                      (you)
                    </Typography.Text>
                  ) : null}
                </>
              ),
            },
            {
              title: 'Email',
              dataIndex: 'email',
              render: (email: string) => (
                <Typography.Text type="secondary" copyable>
                  {email}
                </Typography.Text>
              ),
            },
          ]}
        />
      </Card>
    </>
  )
}
