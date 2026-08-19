import { Spin } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deleteGovernedReport,
  getReports,
  getReportsPrototypeDataset,
  listAuthRoles,
  setReportAudience,
} from '../api/client'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import NoPublishedGraph from '../components/common/NoPublishedGraph'
import PageHeader from '../components/common/PageHeader'
import PublishedReportPane from '../components/report/PublishedReportPane'
import ReportsApp from '../reports/App'
import { hydrate as hydratePrototype, isHydrated } from '../reports/data'
import { MenuProvider } from '../reports/components/MenuProvider'
import { ToastProvider } from '../reports/components/Toast'
import { useAuthStore } from '../store/authStore'
import { useReportsStore } from '../store/reportsStore'
import { reportActionsFor, useSettingsStore } from '../store/settingsStore'
import { createReadStore, toMessage } from '../store/asyncState'
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
 * **The figures are the prototype's own demo dataset.** Nothing here reads `db.json` for a
 * *figure* — the blocks, the charts and the rosters are all the prototype's own, so nothing among
 * them should be read as tenant data, and it says so itself. Wiring those to `/reports*` is still
 * a later job.
 *
 * **Two things on the page are the tenant's, and both are governance rather than measurement.**
 * The publish gate below, and the Library's lifecycle states — `governance.statuses` and
 * `governance.reports` from `GET /reports`, which is where the tenant's five report definitions
 * and their states live. They are passed down rather than fetched in the prototype, so the
 * vendored code keeps standing alone with no host: absent, the Library is exactly what it was.
 *
 * **The one thing that is real is the gate.** The section is available once a graph is
 * published, which is the same precondition Ask and the What-if lens have and the same
 * component that states it. `GET /reports` is called for `published_count` alone.
 */

/* One endpoint, no arguments, no state beyond what came back — which is what
   `createReadStore` is for. The full report client is still typed in `client.ts`; this page
   needs one field of it. */
const usePublishGate = createReadStore(getReports)

/*
 * The role pool the Share picker offers, **served rather than held here**.
 *
 * `db.auth_roles` is the one place the personas are declared and `GET /auth/roles` is how they
 * reach a client — the login already reads it. A list of four roles written into the picker would
 * be a second answer to "who exists" and could offer one the API refuses, which is exactly what a
 * client-side copy of the consent scopes did.
 */
const useShareRoles = createReadStore(listAuthRoles)

/**
 * The prototype's own dataset, which is a document in the bucket rather than a bundled import.
 *
 * `createReadStore` for the same reason the publish gate uses it: one read-only GET, no writes, no
 * derived state. The prototype's module-level exports are hydrated from it *before* the prototype is
 * rendered — its consumers read live bindings, so one call reaches all of them, and rendering first
 * would draw a register with no rows.
 */
const usePrototypeDataset = createReadStore(getReportsPrototypeDataset)

export default function ReportsPage() {
  const data = usePublishGate((s) => s.data)
  const loading = usePublishGate((s) => s.loading)
  const error = usePublishGate((s) => s.error)
  const load = usePublishGate((s) => s.load)
  const roles = useShareRoles((s) => s.data)
  const loadRoles = useShareRoles((s) => s.load)
  const prototypePayload = usePrototypeDataset((s) => s.data)
  const prototypeError = usePrototypeDataset((s) => s.error)
  const loadPrototype = usePrototypeDataset((s) => s.load)

  /*
   * Whether the prototype's data module has been filled in. It mirrors that module's own `isHydrated`,
   * and it exists because a module-level `let` is not React state: assigning it reaches every consumer
   * but tells React nothing, so without this the page would hold a dataset nobody had re-rendered to see.
   */
  const [hydrated, setHydrated] = useState(isHydrated)
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

  /*
   * The section is read **as the signed-in role**, which narrows the *saved* rows to the ones that
   * name it and lets the payload report how many definitions it is not on. It no longer decides what
   * a row may do: a per-row access state used to gate the actions on this, and it was removed with
   * the pending-approval flow. Read with no role, nothing is narrowed — which is the honest default,
   * since the role is client-held and the API serves every row to a caller that names none.
   */
  const asRole = useAuthStore((s) => s.identity?.roleId ?? null)

  /*
   * ---------------- the published report opens out of the Library ----------------
   *
   * **One list, and it is the Library's.** This was a switch at the top of the page between a card grid
   * of the five reports and the prototype — two lists of the same definitions, which is two answers to
   * "what reports exist". The Library already lists them with an **Open report** button; that button now
   * hands the id here and the rendered report replaces the prototype until Back.
   *
   * `openId` lives in `reportsStore` rather than in this component, because the store is also what drops
   * a slow reply that is no longer the report being asked for.
   */
  const openReportId = useReportsStore((s) => s.openId)
  const openReport = useReportsStore((s) => s.open)

  useEffect(() => {
    void load(asRole)
  }, [load, asRole])

  useEffect(() => {
    void loadRoles()
  }, [loadRoles])

  /*
   * Fetch the prototype's dataset, then publish it to the prototype's data module.
   *
   * Hydrating in the effect rather than in the store keeps the store a plain reader: what arrives is the
   * payload, and what the prototype needs is that payload *validated and assigned*, which is
   * `hydrate`'s job. `validateDataset` throws on a malformed one, so this reports it the way every other
   * failure on this page is reported rather than letting it escape as an unhandled error.
   */
  useEffect(() => {
    void loadPrototype()
  }, [loadPrototype])

  const [hydrationError, setHydrationError] = useState<string | null>(null)

  useEffect(() => {
    if (!prototypePayload || isHydrated) return
    try {
      hydratePrototype(prototypePayload.dataset)
      /* Force one re-render now that the module's bindings hold data. */
      setHydrationError(null)
      setHydrated(true)
    } catch (e) {
      setHydrationError(toMessage(e))
    }
  }, [prototypePayload])

  /*
   * The three acts, handed to the prototype as `Result`-returning callbacks.
   *
   * Each re-reads the section rather than patching the copy it just changed — one GET, and the
   * state on screen is always what the server last said. A write's own reply carries the governance
   * view too, but adopting it would mean two paths into the same state and one of them untested.
   */
  const share = useCallback(
    async (reportId: string, audience: string[]) => {
      try {
        await setReportAudience(reportId, audience, asRole)
        await load(asRole)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: toMessage(e) }
      }
    },
    [asRole, load],
  )

  const remove = useCallback(
    async (reportId: string) => {
      try {
        await deleteGovernedReport(reportId, asRole)
        await load(asRole)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: toMessage(e) }
      }
    },
    [asRole, load],
  )

  const actions = useMemo(() => ({ share, remove }), [share, remove])

  /*
   * Which of a governed row's acts this persona is offered.
   *
   * **Read from the same store the sidebar reads**, which is already loaded app-wide — the Sidebar
   * fetches `GET /settings` on mount — so this page adds no fetch of its own and cannot show a stale
   * answer beside a fresh sidebar. `reportActionsFor` is the one place the rule lives; memoised because
   * it builds a fresh object and a new one every render would defeat the prototype's own memos.
   */
  const settings = useSettingsStore((s) => s.data)
  const activePersonaId = useSettingsStore((s) => s.activePersonaId)
  const reportActions = useMemo(
    () => reportActionsFor(settings, activePersonaId),
    [settings, activePersonaId],
  )

  const shareRoles = useMemo(
    () =>
      (roles?.roles ?? []).map((r) => ({
        roleId: r.roleId,
        label: r.label,
        accessNote: r.accessNote,
      })),
    [roles],
  )

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

      {/*
        * One or the other, never both mounted. The prototype installs a toast host and a popover host
        * that portal to `document.body`; a second copy behind a hidden panel would leave a menu opening
        * against the wrong one — which is how Delete came to look like a dead button once already.
        */}
      {openReportId ? <PublishedReportPane /> : null}

      {/*
        * The prototype renders only once its dataset has arrived and been validated.
        *
        * Its figures are a served document now, so there is a moment before they exist — and the three
        * states are told apart rather than collapsed: a failed fetch says the section could not be
        * reached, a failed *validation* says the document is malformed and names the file, and neither is
        * a spinner that never ends. Mounting first would draw a register with no rows, which reads as
        * "nothing ships here".
        */}
      {openReportId || prototypeError || hydrationError ? null : hydrated ? null : <Spin />}

      {prototypeError && !openReportId ? (
        <ApiErrorAlert error={prototypeError} onRetry={() => void loadPrototype()} />
      ) : null}

      {hydrationError && !openReportId ? (
        <ApiErrorAlert
          error={`db.reports_prototype is malformed, so the authoring tab cannot render: ${hydrationError}`}
          onRetry={() => void loadPrototype()}
        />
      ) : null}

      {openReportId || !hydrated || prototypeError || hydrationError ? null : (
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
                /*
                 * The Library's lifecycle chips and the definitions they count. Passed straight
                 * through: the states, their labels, their tones and every count arrive decided
                 * from `reportGovernanceView`, and a component that recomputed one would be a
                 * second answer to "how many are published".
                 */
                governance={data?.governance}
                shareRoles={shareRoles}
                actions={actions}
                /*
                 * Which of a governed row's three acts this persona is offered, from the one place that
                 * decides it — `reportActionsFor`, the twin of `visibleNavItems`. A second computation
                 * here would be a second answer to whether an Executive may delete.
                 *
                 * Configured on **Settings → Report View**, and it is not access control: the persona is
                 * client-held and the API serves every report to a caller that names no role, which the
                 * tab states in those words.
                 */
                reportActions={reportActions}
                /*
                 * **Open report** reads the published report; **Edit report** still loads the authoring
                 * definition. Two buttons that did the same thing now do what their labels say, and the
                 * one a governed row needs is the one showing the tenant's own figures rather than the
                 * prototype's sample data under a card marked "Published".
                 */
                onOpenPublished={(reportId) => void openReport(reportId)}
              />
            </MenuProvider>
          </ToastProvider>
        </div>
      </div>
      )}
    </>
  )
}
