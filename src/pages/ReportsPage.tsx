import { Spin } from 'antd'
import { useEffect, useMemo } from 'react'
import { getReports } from '../api/client'
import ApiErrorAlert from '../components/ApiErrorAlert'
import NoPublishedGraph from '../components/NoPublishedGraph'
import PageHeader from '../components/PageHeader'
import ReportsApp from '../reports/App'
import { MenuProvider } from '../reports/components/MenuProvider'
import { ToastProvider } from '../reports/components/Toast'
import { useAuthStore } from '../store/authStore'
import { createReadStore } from '../store/asyncState'
import '../reports/reports-prototype.css'
import './ReportsPage.css'

/*
 * The report section — the authoring prototype, imported whole and mounted in the app shell.
 *
 * **It is vendored, not written here.** `src/reports/` is a port of
 * `vls_demo_data_package_2026-08-10/repor code`, carried over with its own types, panes,
 * blocks, dataset and stylesheet. Three things were changed to make it a page rather than an
 * app, and nothing else: its `main.tsx` entry point and its `Sidebar` were dropped (this app
 * already draws a sidebar, and the prototype's named a different persona than the signed-in
 * one), and its stylesheet was scoped — see the header in `reports-prototype.css` for why that
 * one is not optional.
 *
 * **Its providers wrap this page, not the app.** `ToastProvider` and `MenuProvider` are the
 * prototype's own — a toast host and an anchored-popover host — and they were mounted at its
 * root. Mounted at the app's root they would sit above every other page, so they wrap only
 * here. Neither is antd's, and that is deliberate: this is vendored code kept intact rather
 * than a rewrite onto the host's components.
 *
 * **The figures are the prototype's own demo dataset.** Nothing here reads `db.json` or calls
 * `/reports*`. The API is still served and `client.ts` still types it, so wiring this to real
 * data is a later job — but until then nothing on the page should be read as tenant data. The
 * prototype says so itself.
 *
 * **The one thing that is real is the gate.** The section is available once a graph is
 * published, which is the same precondition Ask and the What-if lens have and the same
 * component that states it. `GET /reports` is called for `published_count` alone.
 */

/* One endpoint, no arguments, no state beyond what came back — which is what
   `createReadStore` is for. The full report client is still typed in `client.ts`; this page
   needs one field of it. */
const usePublishGate = createReadStore(getReports)

export default function ReportsPage() {
  const data = usePublishGate((s) => s.data)
  const loading = usePublishGate((s) => s.loading)
  const error = usePublishGate((s) => s.error)
  const load = usePublishGate((s) => s.load)
  /*
   * Who a report saved here is credited to. The identity is client-held, so anything that
   * records *who* has to be told — the rule the consent callback established. Without this the
   * prototype stamps its own demo persona on the reader's own work, and the Library credits
   * someone who is not signed in.
   */
  const identity = useAuthStore((s) => s.identity)

  /*
   * **The graph picker offers the graphs that are actually published.**
   *
   * The vendored dataset ships four, each described as "Published · refreshed today", and none
   * of them exists — so the picker was asserting four live graphs on a tenant that may have
   * none. These come from `GET /reports`, which is `publishedGraphs()`, the same list Ask reads.
   *
   * Every line on an option is a served fact: the graph's name and version, what it holds, and
   * who put it live. Nothing says "refreshed today" — the payload does not report that, and the
   * prototype has no way to know it.
   */
  const graphOptions = useMemo(
    () =>
      (data?.graphs ?? []).map((g) => {
        const size = [
          g.entityCount !== null ? `${g.entityCount.toLocaleString()} entities` : null,
          g.relationshipCount !== null
            ? `${g.relationshipCount.toLocaleString()} relationships`
            : null,
        ].filter(Boolean)
        return {
          value: g.useCaseId,
          /* Reads inside "Using …, rank …", so the version belongs in the label: two builds of
             one brief share a name and are told apart by it. */
          label: g.version ? `${g.name} ${g.version}` : g.name,
          short: g.name,
          d: ['Published', ...size, g.publishedBy ? `published by ${g.publishedBy}` : null]
            .filter(Boolean)
            .join(' · '),
        }
      }),
    [data],
  )

  useEffect(() => {
    void load()
  }, [load])

  /*
   * Three clauses, in the shape every other section header uses: what the page lists, the
   * guarantee behind it, and what an action here sets off. Sources states its own the same way.
   *
   * Each one has to be true of this page. It does not claim the figures are the tenant's —
   * they are the prototype's sample data, and the report itself says so where the numbers are,
   * which is the place a reader needs to be told.
   */
  const header = (
    <PageHeader
      title="Reports"
      subtitle="Governed, re-executable questions — a report is a definition, not a chart with numbers stored inside it. Ask in plain English and the question is read back as one sentence before anything runs. Publishing names an audience, and the report carries the byline of whoever published it."
    />
  )

  if (error) {
    return (
      <>
        {header}
        <ApiErrorAlert error={error} onRetry={() => void load()} />
      </>
    )
  }
  if (loading && !data) {
    return (
      <>
        {header}
        <Spin />
      </>
    )
  }

  /*
   * The gate, and it is the only precondition. A report is asked of the published graph, so a
   * connected source is not a second one — publishing is already downstream of having
   * something to build from. `NoPublishedGraph` names the fix that applies from the two
   * counts, because "publish the build you have" and "finish a draft" are different actions.
   */
  if (data && data.publishedCount === 0) {
    return (
      <>
        {header}
        <NoPublishedGraph
          detail="A report is a question asked of the published graph."
          builtCount={data.builtCount}
          draftCount={data.draftCount}
        />
      </>
    )
  }

  /*
   * The header sits above the prototype, the same one the gated branch shows — so the section
   * names itself and states its premise whichever state it is in, exactly as every other page
   * does. `.rp-host` cancels the shell's side and bottom padding but **not** its top, or the
   * prototype would be pulled up over the header it is meant to sit beneath.
   *
   * The inner wrapper is what scopes the vendored stylesheet.
   */
  return (
    <>
      {header}
      <div className="rp-host">
        <div className="cw-reports">
          <ToastProvider>
            <MenuProvider>
              <ReportsApp
                /* The email, not a display name: the login collects no name field, so
                   inventing one would be a claim. Absent identity leaves the prototype's
                   own fallback. */
                identity={
                  identity ? { name: identity.email, role: identity.roleLabel } : undefined
                }
                graphOptions={graphOptions}
              />
            </MenuProvider>
          </ToastProvider>
        </div>
      </div>
    </>
  )
}
