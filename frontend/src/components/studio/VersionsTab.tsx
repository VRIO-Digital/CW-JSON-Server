import { Button, Tooltip } from 'antd'
import type { GraphVersion } from '../../api/client'
import StatusTag from '../common/StatusTag'
import './VersionsTab.css'

/*
 * Every version of a graph — which is to say, every build of it.
 *
 * **One number per build: v1, v2, v3.** The label is taken when the run starts and never
 * recomputed, so a published `v2` stays `v2` however many builds follow. It used to name the
 * brief's *config* instead, shared by every rebuild of it — so several rows read `v2` and were
 * told apart by hash alone, which is not what a reader means by "version" on a list of builds.
 * The content hash is still the identity; the number is now the build's name for it.
 *
 * Rows, not a table: each one carries an identity (a content hash), what it
 * contains, where it came from, and one action. A table would have needed a column
 * per fact and most of them are hashes.
 *
 * **The rows are immutable.** Publishing points Ask at one of them; it does not
 * rewrite it, and unpublishing puts the pointer back. That sentence is printed on
 * every row because it is the thing that makes the list safe to read: nothing here
 * changes under you except which row is published.
 */

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const short = (s: string) => `${s.slice(0, 8)}…`

export default function VersionsTab({
  graphName,
  versions,
  /** The build currently loaded in the Build tab, if it is one of these. */
  loadedJob,
  /** `publish-<sha>` / `unpublish-<sha>` while one row's action is in flight. */
  pending,
  gateBlocked,
  gateReasons,
  onPublish,
  onUnpublish,
  onLoadJob,
}: {
  graphName: string
  versions: GraphVersion[]
  loadedJob: string | null
  pending: string | null
  gateBlocked: boolean
  gateReasons: string[]
  onPublish: (sha256: string) => void
  onUnpublish: (sha256: string) => void
  onLoadJob: (buildId: string) => void
}) {
  if (versions.length === 0) {
    return (
      <div className="vt-empty">
        No versions yet. A version is a build — trigger one on the Build tab and it
        appears here, content-addressed and immutable. Versions live in memory, so
        restarting the mock server clears them.
      </div>
    )
  }

  return (
    <div className="vt">
      {versions.map((v) => {
        const isLoaded = v.fromJob === loadedJob
        const busy = pending === `publish-${v.sha256}` || pending === `unpublish-${v.sha256}`
        return (
          <article key={v.sha256} className="vt-row">
            <header className="vt-head">
              <span className="vt-name">
                {graphName} · {v.configVersion}
              </span>

              {/* Which one the Build tab is showing — a navigational fact, so a
                  brand tint rather than a STATUS colour: being loaded is not a
                  state of the graph. */}
              {isLoaded ? (
                <span className="vt-chip is-loaded">loaded</span>
              ) : (
                <span className="vt-chip">draft</span>
              )}

              {/*
                The gate as it stood when this build finished. `unknown` is not a
                failure — nobody had reviewed it yet — so it is neutral, and only
                `passed` earns the good tint.
              */}
              {v.gate === 'passed' ? (
                <StatusTag tone="good">gate passed</StatusTag>
              ) : (
                <span className="vt-chip">gate unknown</span>
              )}

              {v.published ? (
                <StatusTag tone="good">published</StatusTag>
              ) : (
                <span className="vt-chip">not published</span>
              )}

              <span className="vt-when">{fmt(v.createdAt)}</span>
            </header>

            <div className="vt-facts">
              {v.entities} entities · {v.relationships} relationships · graph{' '}
              <code title={v.graphId}>{short(v.graphId)}</code> · sha256{' '}
              <code title={v.sha256}>{short(v.sha256)}</code> · from job{' '}
              <code title={v.fromJob}>{short(v.fromJob)}</code>
            </div>

            <div className="vt-actions">
              <Button size="small" onClick={() => onLoadJob(v.fromJob)}>
                Load this version&apos;s job
              </Button>

              {v.published ? (
                <Button size="small" loading={busy} onClick={() => onUnpublish(v.sha256)}>
                  Unpublish
                </Button>
              ) : (
                /* Offered even while the gate is blocked: the refusal names what is
                   outstanding, which is more use than a disabled button with no
                   reason. The tooltip says it before the click. */
                <Tooltip title={gateBlocked ? gateReasons.join(' · ') : undefined}>
                  <Button
                    type="primary"
                    size="small"
                    loading={busy}
                    onClick={() => onPublish(v.sha256)}
                  >
                    Publish
                  </Button>
                </Tooltip>
              )}

              <span className="vt-note">
                immutable — content-addressed; publishing gates Ask access, it does
                not mutate this graph
              </span>
            </div>
          </article>
        )
      })}
    </div>
  )
}
