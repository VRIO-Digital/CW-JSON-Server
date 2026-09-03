import { Alert, Empty, Table, Typography } from 'antd'
import type { SessionHistoryRow } from '../../data/sessionHistory'
import { sessionHistoryCopy } from '../../data/sessionHistory'
import './SessionHistoryPanel.css'

/*
 * The Session history tab: the Ask threads this browser tab is holding.
 *
 * **Its own component, and it takes rows rather than reading them.** The page loads the chats
 * and `sessionHistoryRows` shapes them; this draws what it is given. That is what makes it
 * assertable — a panel that read `sessionStorage` itself could only be checked by rendering the
 * page's own state, which `renderToString` gives back as the *initial* one.
 *
 * **The disclaimer is above the list, not under it**, and it is the reason this panel is
 * allowed to exist here at all. A list of named sessions on a governance page reads as a
 * server-side record of who was doing what; these are one browser tab's chats, kept in session
 * storage under one address, seen by no server and gone when the tab closes. Under the table it
 * would be a footnote to a conclusion the reader had already drawn.
 *
 * **Nothing here is a count this component worked out.** The turn totals, the subject and the
 * two dates are all on the row. The one thing it decides is how a date is *printed*, which is a
 * rendering choice and belongs where the rendering is.
 */
export default function SessionHistoryPanel({
  rows,
  signedIn,
}: {
  rows: SessionHistoryRow[]
  /** False when nobody is signed in — chats are keyed by address, so there is nothing to key on. */
  signedIn: boolean
}) {
  if (!signedIn) {
    return (
      <div className="sh-empty">
        <Typography.Text strong>{sessionHistoryCopy.signedOutTitle}</Typography.Text>
        <Typography.Paragraph type="secondary" className="sh-note">
          {sessionHistoryCopy.signedOutDetail}
        </Typography.Paragraph>
      </div>
    )
  }

  return (
    <div className="sh">
      <Typography.Title level={5} className="sh-title">
        {sessionHistoryCopy.title}
      </Typography.Title>

      {/*
       * `warning` rather than `info`, and deliberately: on this page an info banner is the house
       * style for "here is how this works", and what this says is "do not read this as the thing
       * everything around it is". It is the same tone the not-enforced notice carries, for the
       * same reason — both exist to stop a reader concluding something the screen implies.
       */}
      <Alert
        className="sh-caveat"
        type="warning"
        showIcon
        title={sessionHistoryCopy.notARecord}
        description={sessionHistoryCopy.cap}
      />

      {rows.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <>
              <div>{sessionHistoryCopy.emptyTitle}</div>
              <Typography.Text type="secondary">{sessionHistoryCopy.emptyDetail}</Typography.Text>
            </>
          }
        />
      ) : (
        <Table<SessionHistoryRow>
          className="sh-table"
          dataSource={rows}
          rowKey="chatId"
          size="small"
          pagination={false}
          columns={[
            {
              title: sessionHistoryCopy.colSession,
              dataIndex: 'name',
              key: 'name',
              render: (name: string) => <span className="sh-name">{name}</span>,
            },
            {
              title: sessionHistoryCopy.colSubject,
              dataIndex: 'subject',
              key: 'subject',
              render: (subject: string) => <span className="sh-subject">{subject}</span>,
            },
            {
              title: sessionHistoryCopy.colTurns,
              key: 'turns',
              align: 'right',
              /* Both numbers, because they are two facts: a turn left unanswered when the tab
                 was closed was still a question that was asked. Printed as one figure only when
                 they agree, so the common case is not a fraction a reader has to parse. */
              render: (_: unknown, r: SessionHistoryRow) => (
                <span className="sh-turns">
                  {r.answered === r.turns ? r.turns : `${r.answered} of ${r.turns}`}
                </span>
              ),
            },
            {
              title: sessionHistoryCopy.colStarted,
              dataIndex: 'createdAt',
              key: 'createdAt',
              render: (at: string) => (
                <span className="sh-at">{new Date(at).toLocaleString()}</span>
              ),
            },
            {
              title: sessionHistoryCopy.colUpdated,
              dataIndex: 'updatedAt',
              key: 'updatedAt',
              render: (at: string) => (
                <span className="sh-at">{new Date(at).toLocaleString()}</span>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}
