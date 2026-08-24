import { App, Button, Space, Spin } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiBase, getHealth, getReports, listAuthRoles, listDatasets } from '../api/client'
import type { DatasetsPayload, ServerHealth } from '../api/client'
import { appPath, currentDataset } from '../api/dataset'
import PageHeader from '../components/common/PageHeader'
import StatusTag from '../components/common/StatusTag'
import { diagnose, doctorReport, overallTone, type DoctorInput } from '../data/doctor'
import { toMessage } from '../store/asyncState'
import { useAuthStore } from '../store/authStore'
import './DoctorPage.css'

/*
 * `/doctor` — what this browser is talking to, and why a page is empty.
 *
 * **It is the frontend's answer to `GET /health`, and it exists for the same reason.** That route was
 * added because a load balancer reading the dispatcher's 404 called a healthy application dead; this
 * page is for the other end of the same problem — a console showing blank pages with nothing on screen
 * saying whether the API is unreachable, pointed somewhere else, refusing this dataset, or simply
 * reporting a tenant who has not published a graph yet. Those four look identical and have four fixes.
 *
 * **Outside `RequireAuth` and outside the dataset prefix, deliberately.** A diagnostics page that
 * needed a working sign-in could not report a broken one, and the sign-in is the first thing an
 * unreachable API breaks — so it sits beside `/login` and `/login/data` rather than under `/:ds`,
 * where `DatasetPathGate` would rewrite its address on the way in. It is URL-only, with no `NAV_ITEMS`
 * entry, by the same rule as `/db`.
 *
 * **Every call is made independently and every failure is kept.** `Promise.allSettled`, not `all`: the
 * dataset check is exactly what a reader needs when `/reports` is refusing, and one rejection taking
 * the others down with it would leave this page as blank as the page they came from. A check whose
 * call failed says so in place, which is why `diagnose` takes an error string per call rather than one
 * for the page.
 *
 * **It decides nothing.** The verdicts are `src/data/doctor.ts`'s, because a rule inside a component
 * is a rule that cannot be asserted without rendering the component's own state — the same split
 * `datasetPathFix` keeps.
 */
export default function DoctorPage() {
  const { message } = App.useApp()
  const identity = useAuthStore((s) => s.identity)

  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState<ServerHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [datasets, setDatasets] = useState<DatasetsPayload | null>(null)
  const [datasetsError, setDatasetsError] = useState<string | null>(null)
  const [roleIds, setRoleIds] = useState<string[] | null>(null)
  const [gate, setGate] = useState<DoctorInput['gate']>(null)
  const [gateError, setGateError] = useState<string | null>(null)
  /* When the diagnosis was taken. On the page as well as in the pasted report, because a stale tab is
     one of the things a reader is here to rule out. */
  const [at, setAt] = useState('')

  const run = useCallback(async () => {
    setLoading(true)
    const [h, d, r, g] = await Promise.allSettled([
      getHealth(),
      listDatasets(),
      listAuthRoles(),
      getReports(),
    ])

    setHealth(h.status === 'fulfilled' ? h.value : null)
    setHealthError(h.status === 'rejected' ? toMessage(h.reason) : null)
    setDatasets(d.status === 'fulfilled' ? d.value : null)
    setDatasetsError(d.status === 'rejected' ? toMessage(d.reason) : null)
    /* The persona pool only feeds one check, and its failure is already reported by the two calls
       above — so a rejection here means "cannot tell", which is `null` rather than an empty list. An
       empty list would say every persona had been deleted. */
    setRoleIds(r.status === 'fulfilled' ? r.value.roles.map((role) => role.roleId) : null)
    setGate(
      g.status === 'fulfilled'
        ? {
            connectedSources: g.value.connectedSources,
            publishedCount: g.value.publishedCount,
            builtCount: g.value.builtCount,
            draftCount: g.value.draftCount,
          }
        : null,
    )
    setGateError(g.status === 'rejected' ? toMessage(g.reason) : null)
    setAt(new Date().toLocaleString())
    setLoading(false)
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  const checks = diagnose({
    apiBase: apiBase(),
    mode: import.meta.env.MODE,
    /* `globalThis.location`, not `window.location`: this page is asserted with `renderToString`, where
       there is no window, and a diagnostics page that cannot be rendered in a test is one whose rows
       nobody checks. An absent protocol simply means the mixed-content check cannot fire, which is the
       safe direction — it can only miss, never invent. */
    pageProtocol: globalThis.location?.protocol ?? '',
    health,
    healthError,
    datasets,
    datasetsError,
    sending: currentDataset(),
    identity: identity ? { email: identity.email, roleId: identity.roleId } : null,
    roleIds,
    gate,
    gateError,
  })
  const tone = overallTone(checks)

  const copy = () => {
    void navigator.clipboard
      ?.writeText(doctorReport(checks, at))
      .then(() => message.success('Diagnostics copied.'))
      .catch(() => message.error('Could not copy. Read the rows above instead.'))
  }

  return (
    <div className="doc">
      <PageHeader
        title="Diagnostics"
        subtitle="What this browser is talking to, and why a page is empty. Nothing here changes anything."
        actions={
          <Space>
            <Button onClick={() => void run()} loading={loading}>
              Re-run
            </Button>
            <Button onClick={copy} disabled={loading}>
              Copy report
            </Button>
          </Space>
        }
      />

      <div className="doc-lead">
        <StatusTag tone={tone}>
          {tone === 'good'
            ? 'Everything this page can check is in order'
            : tone === 'warn'
              ? 'Working, with a step not taken yet'
              : 'Something is broken'}
        </StatusTag>
        {at ? <span className="doc-at">checked {at}</span> : null}
      </div>

      {loading && checks.length === 0 ? (
        <Spin />
      ) : (
        <ul className="doc-rows">
          {checks.map((c) => (
            <li className={`doc-row is-${c.tone}`} key={c.key}>
              <div className="doc-head">
                <span className="doc-label">{c.label}</span>
                <StatusTag tone={c.tone}>{c.tone === 'good' ? 'ok' : c.tone}</StatusTag>
              </div>
              {/* The value first, because it is the evidence; the fix under it, only where there is
                  one. A row with no fix is a fact, not a silent pass. */}
              <div className="doc-value">{c.value}</div>
              {c.fix ? <p className="doc-fix">{c.fix}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {/* Where the fixes above are carried out. Prefixed like every other in-app link, so
          this page cannot be the one place that drops the dataset segment. */}
      <div className="doc-links">
        <Link to={appPath('/sources')}>Sources</Link>
        <Link to={appPath('/graph-studio')}>Graph Studio</Link>
        <Link to={appPath('/settings')}>Settings</Link>
        <Link to="/login">Sign in</Link>
      </div>
    </div>
  )
}
