import { Button, Menu, Typography } from 'antd'

import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { appPath, splitDatasetPath } from '../../api/dataset'
import type { SessionIdentity } from '../../api/client'
import { NAV_GROUPS, type NavItem } from '../../nav'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore, visibleNavItems } from '../../store/settingsStore'
import './Sidebar.css'

/**
 * The signed-in card itself, given its data.
 *
 * Split from `Sidebar` because a store-connected component renders zustand's
 * *initial* state under `renderToString` — it would look unassertable in a
 * headless test even though it is correct in the browser. Passing `identity`
 * in as a prop makes it assertable, the same reason `DocumentDictionary` is
 * split from `ProfiledDocumentsPanel`.
 */
export function SidebarFooter({
  identity,
  onSignOut,
}: {
  identity: SessionIdentity
  onSignOut: () => void
}) {
  return (
    <div className="sidebar-footer">
      <Typography.Text className="sidebar-footer-label">
        SIGNED IN AS
      </Typography.Text>

      <div className="sidebar-identity">
        <span className="sidebar-avatar" aria-hidden="true">
          {identity.initials}
        </span>
        <span className="sidebar-identity-text">
          <span className="sidebar-identity-email">{identity.email}</span>
          <span className="sidebar-identity-role">{identity.roleLabel}</span>
        </span>
      </div>

      <Button block onClick={onSignOut}>
        Sign out
      </Button>
    </div>
  )
}

/**
 * The navigation the active persona may see.
 *
 * **One source, and this is it.** `visibleNavItems` in `settingsStore` is the only thing that decides
 * whether an item appears; a component that also filtered would be a second answer to "can this
 * persona see Reports". The list is read on every render, so a toggle in Settings moves the sidebar
 * without a reload — which is the whole point of the section.
 *
 * Split from the store-connected `Sidebar` for the same reason `SidebarFooter` is: `renderToString`
 * renders zustand's *initial* state, so a filtered list only becomes assertable when the list is
 * passed in.
 */
export function SidebarMenu({
  items,
  pathname,
  onPick,
}: {
  items: NavItem[]
  pathname: string
  onPick: (item: NavItem) => void
}) {
  /*
   * Matched against the route *beneath* the dataset segment. `NAV_ITEMS` holds canonical paths
   * (`/sources`) while the URL is `/E/sources`, so a raw `startsWith` selects nothing and the sidebar
   * highlights no item on every page — a menu that looks broken rather than one pointing somewhere
   * wrong. The prefix belongs to the dataset, not to the nav entry.
   */
  const route = splitDatasetPath(pathname).rest
  const selected = items.find((item) => route.startsWith(item.path))

  /*
   * The headings are built from what survived the filter, not from `NAV_GROUPS` directly: a persona
   * with no Explore item must not be shown an `EXPLORE` heading with nothing under it, which reads as
   * a section that failed to load rather than as one they may not open. The group order is
   * `NAV_GROUPS`', and the order inside a group is `NAV_ITEMS`', so both are stated in one place.
   */
  const grouped = NAV_GROUPS.map((group) => ({
    group,
    members: items.filter((item) => item.group === group),
  })).filter(({ members }) => members.length > 0)

  return (
    <Menu
      mode="inline"
      theme="dark"
      selectedKeys={selected ? [selected.key] : []}
      className="sidebar-menu"
      items={grouped.map(({ group, members }) => ({
        key: `group:${group}`,
        type: 'group' as const,
        label: group,
        children: members.map(({ key, label, icon: Icon }) => ({
          key,
          icon: <Icon />,
          label,
        })),
      }))}
      onClick={({ key }) => {
        const item = items.find((i) => i.key === key)
        if (item) onPick(item)
      }}
    />
  )
}

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const identity = useAuthStore((s) => s.identity)
  const logout = useAuthStore((s) => s.logout)
  const settings = useSettingsStore((s) => s.data)
  const activePersonaId = useSettingsStore((s) => s.activePersonaId)
  const syncActivePersona = useSettingsStore((s) => s.syncActivePersona)
  const loadSettings = useSettingsStore((s) => s.load)

  /*
   * The sidebar starts on the signed-in persona's access, and stays wherever Settings put it after
   * that — `syncActivePersona` adopts a role only when none is active, so previewing another persona
   * is not undone by the next render. Signing out clears it, so the next sign-in adopts theirs.
   */
  useEffect(() => {
    syncActivePersona(identity?.roleId ?? null)
  }, [identity?.roleId, syncActivePersona])

  /*
   * The permissions are fetched here because the sidebar is the thing they change and it is on every
   * page — waiting for someone to open Settings would mean the first render after a reload showed the
   * wrong navigation. Loaded once: `load()` sets `error` in state rather than throwing, and until it
   * returns every item is visible, so a slow or failed fetch never empties the sidebar.
   */
  useEffect(() => {
    if (identity) void loadSettings()
  }, [identity, loadSettings])

  const items = visibleNavItems(settings, activePersonaId)

  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <Typography.Title level={3} className="wordmark">
          Context<span>Weave</span>
        </Typography.Title>

        <Typography.Text className="tagline">
          FROM DATA TO DECISIONS
        </Typography.Text>
      </div>

      <SidebarMenu
        items={items}
        pathname={pathname}
        onPick={(item) => {
          navigate(appPath(item.path))
          onNavigate?.()
        }}
      />

      {/* RequireAuth guarantees this route only mounts once someone has signed
          in, but the check stays defensive rather than assuming that holds. */}
      {identity ? (
        <SidebarFooter
          identity={identity}
          onSignOut={() => {
            logout()
            navigate('/login', { replace: true })
          }}
        />
      ) : null}
    </div>
  )
}
