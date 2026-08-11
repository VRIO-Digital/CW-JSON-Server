import { CheckCircleFilled, LoadingOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Select, Spin, Typography } from 'antd'
import type { GraphBuild } from '../api/client'
import './BuildTab.css'

/*
 * Graph Studio's Build tab: the pipeline, and the runs before it.
 *
 * This is in the studio rather than in the wizard because a graph is built more
 * than once. Settling review rows changes what a build produces, so rebuilding is
 * the normal case — hence a Trigger build button that stays available and a run
 * picker that keeps the earlier ones readable.
 *
 * The server drives the stages and this polls, the same way `ProfilingJobsTab`
 * watches a profiling job: a row turns green when the server says it did, never on
 * a timer of its own. Committing the brief used to *be* the build — instant, with
 * nothing to show — which is the whole reason this exists.
 */

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** "11/08/2026, 14:55 · complete · d2aee040…" — time, state, which run. */
const runLabel = (b: GraphBuild) =>
  `${fmt(b.startedAt)} · ${b.status} · ${b.buildId.slice(0, 8)}…`

export default function BuildTab({
  graphName,
  liveVersion,
  builds,
  shown,
  starting,
  loading,
  onTrigger,
  onShow,
  onReload,
}: {
  graphName: string
  /** What is serving, or null. Shown so a rebuild is not mistaken for a publish. */
  liveVersion: string | null
  builds: GraphBuild[]
  shown: GraphBuild | null
  starting: boolean
  loading: boolean
  onTrigger: () => void
  onShow: (buildId: string) => void
  onReload: () => void
}) {
  const running = shown?.status === 'running'

  return (
    <div className="bt">
      <div className="bt-bar">
        <span className="bt-graph">{graphName}</span>
        <Button
          aria-label="Reload the build history"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={onReload}
        />
        <Button type="primary" loading={starting || running} onClick={onTrigger}>
          {running ? 'Building…' : builds.length > 0 ? 'Rebuild' : 'Trigger build'}
        </Button>

        {builds.length > 0 ? (
          <>
            <span className="bt-or">or</span>
            <Select
              className="bt-runs"
              value={shown?.buildId}
              onChange={onShow}
              options={builds.map((b) => ({ value: b.buildId, label: runLabel(b) }))}
              aria-label="Show an earlier run"
            />
          </>
        ) : null}
      </div>

      <Typography.Paragraph className="bt-note">
        A build replays this graph's committed brief — its sealed coverage evidence
        drives the entity binding and the relationship replay. Rebuilding after
        settling review rows is normal, and every run is kept.{' '}
        {liveVersion
          ? `${liveVersion} is live; building does not change that — publishing does.`
          : 'Nothing is live yet: clear the review queue, settle the pivot, then publish.'}
      </Typography.Paragraph>

      {shown ? (
        <section className="bt-pipe" aria-live="polite" aria-busy={running}>
          <header className="bt-head">
            <h3 className="bt-title">Build pipeline</h3>
            <span className={`bt-status${running ? '' : ' is-done'}`}>
              {running ? (
                <>
                  <Spin indicator={<LoadingOutlined spin />} size="small" />{' '}
                  {shown.stageIndex + 1} of {shown.stageTotal}
                </>
              ) : (
                <>
                  <CheckCircleFilled aria-hidden="true" /> complete
                </>
              )}
            </span>
          </header>

          <ol className="bt-stages">
            {shown.stages.map((stage) => (
              <li key={stage.key} className={`bt-stage is-${stage.state}`}>
                <span className="bt-mark" aria-hidden="true">
                  {stage.state === 'complete' ? (
                    <CheckCircleFilled />
                  ) : stage.state === 'running' ? (
                    <Spin indicator={<LoadingOutlined spin />} size="small" />
                  ) : (
                    <span className="bt-dot" />
                  )}
                </span>
                {/* The platform's own names, verbatim: a row on screen should be
                    greppable in a log, which prettifying would break. */}
                <code className="bt-key">{stage.key}</code>
                <span className="bt-state">
                  {stage.state === 'pending' ? '' : stage.state}
                </span>
              </li>
            ))}
          </ol>

          <footer className="bt-foot">
            <span title={shown.packageId}>package {shown.packageId.slice(0, 8)}…</span>
            <span aria-hidden="true"> · </span>
            <span title={shown.graphVersion}>
              graph version {shown.graphVersion.slice(0, 8)}…
            </span>
            {/* What Publish would make live. Named here so the Build tab and the
                publish button cannot disagree about which version is at stake. */}
            <span aria-hidden="true"> · </span>
            <span>
              {shown.status === 'complete'
                ? `built as ${shown.configVersion} — publish it from Versions`
                : `will build ${shown.configVersion}`}
            </span>
          </footer>
        </section>
      ) : (
        <div className="bt-empty">
          This graph has not been built in this session. Builds live in memory, so
          restarting the mock server clears them — trigger one to see the pipeline.
        </div>
      )}
    </div>
  )
}
