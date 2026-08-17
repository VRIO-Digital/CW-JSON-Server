import { Typography } from 'antd'
import type { SourceRow } from '../api/client'
import './SourceImpactNotice.css'

/**
 * What disconnecting or deleting a source actually does, stated before it is done.
 *
 * Both acts used to be one line each — "the credential is revoked but the registration is kept",
 * "registration and its catalogue entries are removed" — which says what happens to the *row* and
 * nothing about what happens to the app. Deleting the last connected source closes five pages, and
 * a reader finding that out afterwards has no way to tell whether they broke something.
 *
 * Three rules the copy has to keep, because a warning that overstates is as bad as one that is
 * missing:
 *
 * - **It says which pages, and it is right about them.** The Data Catalogue, Profiling jobs,
 *   Change signals, Traces and Validation gate on a *connected source*. Ask, Reports, Graph Studio,
 *   the What-if lens and Audit & Governance gate on a *published graph* — they keep answering,
 *   because they read published content rather than this source. Telling somebody Ask will go dark
 *   would be a claim this app disproves the moment they look.
 * - **It counts rather than asserts.** "The last connected source" is true or false per row, so the
 *   page passes the number of others that stay connected and the notice branches on it.
 * - **Reversible and irreversible are said in those words.** Disconnect has an undo — the
 *   Reconnect button on the row, which keeps every profiled object. Delete does not: the profiled
 *   tables, columns, documents and the notes typed against them live in the mock server's memory,
 *   and profiling them again is the only way back.
 *
 * Its own component rather than a string inside the page: a Popconfirm renders through a portal
 * that `renderToString` will not traverse, so copy written inline there cannot be asserted on.
 */
export default function SourceImpactNotice({
  action,
  source,
  /** Connected sources *other than* this one. 0 means this is the last one. */
  othersConnected,
}: {
  action: 'disconnect' | 'delete'
  source: SourceRow
  othersConnected: number
}) {
  const isDrive = source.kind === 'gdrive'
  const profiled = isDrive
    ? `${source.profiledDocuments ?? 0} profiled document(s)`
    : `${source.profiledTables} profiled table(s) · ${source.profiledColumns} column(s)`

  /* The pages that gate on a connected source, named because "some features stop working" is not
     something a reader can check. Only shown when this is the last one — with another source
     connected, none of them close, and a list of pages that are fine is noise. */
  const gated =
    'Data Catalogue, Profiling jobs, Change signals, Traces and Validation close.'

  const stillLive =
    'Ask, Reports, Graph Studio, the What-if lens and Audit & Governance keep working.'

  /* One line about the rest of the app, and only when there is something to say. Three sentences
     of consequence for a routine disconnect is how a warning gets skipped. */
  const scope =
    othersConnected > 0
      ? `${othersConnected} other source(s) stay connected, so no page closes.`
      : `It is the only connected source: ${gated} ${stillLive}`

  return (
    <div className="src-impact">
      {action === 'disconnect' ? (
        <>
          <Typography.Paragraph className="src-impact-lead">
            {`${source.sourceName} stops counting as connected. Its allowlist and ${profiled} are kept.`}
          </Typography.Paragraph>
          <Typography.Paragraph className="src-impact-good">
            {'Reconnect on this row undoes it — nothing profiled is lost.'}
          </Typography.Paragraph>
          <Typography.Paragraph className="src-impact-note">{scope}</Typography.Paragraph>
        </>
      ) : (
        <>
          <Typography.Paragraph className="src-impact-lead">
            {`Deletes ${source.sourceName} and its ${profiled}, with any notes on them.`}
          </Typography.Paragraph>
          <Typography.Paragraph className="src-impact-crit">
            {'This cannot be undone — connecting it again starts from nothing profiled. Disconnect only revokes the credential.'}
          </Typography.Paragraph>
          <Typography.Paragraph className="src-impact-note">{scope}</Typography.Paragraph>
        </>
      )}
    </div>
  )
}
