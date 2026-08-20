import { App, Spin, Tabs } from 'antd'
import { useEffect, useState } from 'react'
import ApiErrorAlert from '../components/common/ApiErrorAlert'
import PageHeader from '../components/common/PageHeader'
import DatasetPanel from '../components/settings/DatasetPanel'
import PersonaPermissionsPanel from '../components/settings/PersonaPermissionsPanel'
import ReportPermissionsPanel from '../components/settings/ReportPermissionsPanel'
import UsersPanel from '../components/settings/UsersPanel'
import { useAuthStore } from '../store/authStore'
import { personaFor, useSettingsStore } from '../store/settingsStore'
import './SettingsPage.css'

/*
 * Settings — the users, and what each persona may see.
 *
 * **Its own small store.** Everything on this page is served from `backend/settings.json`, which is
 * separate from `db.json` on purpose: that file is the tenant's data, this one holds only what this page
 * administers. So a settings write cannot touch a report, and an ingest that rebuilds `db.reports` cannot
 * drop a permission — a hazard that is not hypothetical, since the reports ingest silently dropped
 * `governance` for exactly that reason.
 *
 * **It persists.** A permission survives a restart, because a decision about who sees what is somebody's
 * work rather than session state — the same asymmetry that keeps a graph brief and drops a registered
 * source.
 *
 * **The personas are still `db.auth_roles`.** `settings.json` names `role_id`s and never a label; the
 * server resolves them on the way out. One answer to "who exists", and this page cannot offer a persona
 * the rest of the app does not have.
 *
 * **Settings belongs to Platform Admin.** It is on and *fixed* there — the persona that administers every
 * other one must not be able to remove its own way in — and off but configurable elsewhere, so it can be
 * granted. The lock is enforced by the server, not merely by a disabled switch.
 *
 * **And hiding is not authorising.** The route is unconditional: `/settings` answers whatever the sidebar
 * shows, which is what stops a reader turning it off for a persona and losing the way back.
 */
export default function SettingsPage() {
  const [tab, setTab] = useState('users')
  const { message } = App.useApp()

  const data = useSettingsStore((s) => s.data)
  const loading = useSettingsStore((s) => s.loading)
  const error = useSettingsStore((s) => s.error)
  const load = useSettingsStore((s) => s.load)
  const activePersonaId = useSettingsStore((s) => s.activePersonaId)
  const setActivePersona = useSettingsStore((s) => s.setActivePersona)
  const setPermission = useSettingsStore((s) => s.setPermission)
  const setReportPermission = useSettingsStore((s) => s.setReportPermission)
  const resetPersona = useSettingsStore((s) => s.resetPersona)

  const identity = useAuthStore((s) => s.identity)

  useEffect(() => {
    void load()
  }, [load])

  const header = (
    <PageHeader
      title="Settings"
      subtitle="Who can sign in, and what each persona sees of the console."
    />
  )

  if (error && !data) {
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
   * With nothing selected yet, the first persona the store serves is shown rather than an empty tab — the
   * sidebar is already showing *somebody's* access, so the tab has one to display too. Picking one here is
   * what changes which persona the sidebar shows.
   */
  const personas = data?.personas ?? []
  const selectedId = activePersonaId ?? personas[0]?.roleId ?? null
  const persona = personaFor(data, selectedId)

  return (
    <div className="settings-page">
      {header}

      {/* A failed *reload* keeps the previous data on screen and says so, rather than blanking it. */}
      {error && data ? <ApiErrorAlert error={error} onRetry={() => void load()} /> : null}

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'users',
            label: 'Add User',
            children: (
              <UsersPanel users={data?.users ?? []} signedInEmail={identity?.email ?? null} />
            ),
          },
          {
            /*
             * Which dataset the console reads. In Settings rather than the sidebar because it is not
             * navigation: confirming it signs the reader out, and a control that ends the session does
             * not belong one mis-click away from the page links.
             */
            key: 'dataset',
            label: 'Dataset',
            children: <DatasetPanel />,
          },
          {
            key: 'personas',
            label: 'Persona Configuration',
            children: (
              <PersonaPermissionsPanel
                personas={personas}
                activePersonaId={selectedId}
                permissions={persona?.nav ?? {}}
                onPickPersona={setActivePersona}
                onToggle={async (key, next) => {
                  if (!selectedId) return
                  /* Selecting is what makes a persona the sidebar's; a toggle before that would edit a
                     persona nobody is showing. */
                  if (activePersonaId !== selectedId) setActivePersona(selectedId)
                  const result = await setPermission(selectedId, key, next)
                  /* The server's own sentence — it is the one that knows why, including the fixed key. */
                  if (!result.ok) message.warning(result.error)
                }}
                onReset={async () => {
                  if (!selectedId) return
                  const result = await resetPersona(selectedId)
                  if (!result.ok) message.warning(result.error)
                }}
              />
            ),
          },
          {
            /*
             * What each persona may do to a report — open it, edit its definition, delete its governance
             * row. Beside Persona Configuration rather than folded into it: that tab answers "which pages
             * does this persona see", and this one "what may it do once it is on one of them". One table
             * mixing nine navigation items with three report acts would be two questions in one list.
             *
             * **The audience is not here.** Who is *told* a report exists is the governance row's own
             * audience, managed in Audit & Governance, and this tab does not restate it — two surfaces
             * reporting one record is how they come to disagree.
             */
            key: 'report-view',
            label: 'Report View',
            children: (
              <ReportPermissionsPanel
                personas={personas}
                /* The served list, so a column here cannot be one the PATCH route refuses. */
                actions={data?.reportActions ?? []}
                activePersonaId={selectedId}
                permissions={persona?.reports ?? {}}
                onPickPersona={setActivePersona}
                onToggle={async (action, next) => {
                  if (!selectedId) return
                  /* Same as the navigation tab: selecting is what makes a persona the one being shown,
                     so a toggle before that would edit a persona nobody has picked. */
                  if (activePersonaId !== selectedId) setActivePersona(selectedId)
                  const result = await setReportPermission(selectedId, action, next)
                  /* The server's own sentence — it is the one that knows which actions exist. */
                  if (!result.ok) message.warning(result.error)
                }}
                onReset={async () => {
                  if (!selectedId) return
                  const result = await resetPersona(selectedId)
                  if (!result.ok) message.warning(result.error)
                }}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
