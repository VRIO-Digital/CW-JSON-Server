import { Card, Table, Tag, Typography } from 'antd'
import type { SettingsUser } from '../../api/client'
import { SP } from '../../theme'

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
    <Card
      className="settings-card settings-table"
      title="Users and roles"
      /*
       * The one sentence a reader needs, in the card's own header rather than as a paragraph above it.
       * This tab had three lines of prose before the table began, and the table is the content.
       */
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          {users.length} people can sign in
        </Typography.Text>
      }
    >
      <Table<SettingsUser>
        dataSource={users}
        rowKey="id"
        pagination={false}
        /* Dense: four rows of names do not need the default row height. */
        size="small"
        /* Names and addresses overflow a phone; the table scrolls inside its own box rather than making
           the page scroll sideways. */
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: 'User',
            dataIndex: 'name',
            render: (name: string, row) => (
              <>
                <Typography.Text strong>{name}</Typography.Text>
                {signedInEmail && row.email.toLowerCase() === signedInEmail.toLowerCase() ? (
                  <Tag style={{ marginInlineStart: SP.sm }}>you</Tag>
                ) : null}
              </>
            ),
          },
          {
            title: 'Persona',
            dataIndex: 'roleLabel',
            /* A category, so a neutral chip — never a status colour, which would read as a state. */
            render: (label: string) => <Tag>{label}</Tag>,
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

      {/*
        * The two facts that are not in the table, once, under it: where the persona comes from, and that
        * adding a person is an edit rather than a form. The `#` column that used to lead the table is
        * gone — row order carries no meaning, so it was a column of decoration.
        */}
      <Typography.Paragraph type="secondary" className="settings-foot" style={{ fontSize: 12.5 }}>
        <b>The email is what you sign in with</b>, and the persona is the one on that row — the login has no
        role picker. There is no user-creation endpoint — add a person by editing the settings store, then{' '}
        <Typography.Text code>npm run seed:settings</Typography.Text>. What each persona may <em>see</em>{' '}
        is on the Persona Configuration tab.
      </Typography.Paragraph>
    </Card>
  )
}
