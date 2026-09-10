import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { Button, Menu, Tooltip, Typography } from 'antd'

import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { appPath, splitDatasetPath } from '../../api/dataset'
import type { SessionIdentity } from '../../api/client'
import {
  NAV_COLLAPSE_LABEL,
  NAV_EXPAND_LABEL,
  NAV_GROUPS,
  type NavItem,
} from '../../nav'
import { useAuthStore } from '../../store/authStore'
import { useSettingsStore, visibleNavItems } from '../../store/settingsStore'
import { BRAND, BRAND_INK, BRAND_SOFT } from '../../theme'
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

/**
 * The one control that hides the navigation, and the only thing left when it is hidden.
 *
 * Exported so it can be asserted without rendering the store-connected shell — the reason
 * `SidebarMenu` and `SidebarFooter` are separate — and because the collapsed rail is *nothing but*
 * this button: the label is the whole affordance there, so it has to be checkable.
 *
 * **The fold icons, not a bare chevron.** It was `LeftOutlined`/`RightOutlined`, which says only
 * *a direction* — a reader has to guess what moves. `MenuFoldOutlined` and `MenuUnfoldOutlined` draw
 * a menu with an arrow against it, which is the conventional mark for this act and names the thing
 * being folded. Asked for as "some user friendly icons".
 *
 * **And it is filled rather than a text button, because it had to be found before it could be
 * used.** A grey glyph on white is discoverable only by hovering the exact pixels; this carries the
 * brand tint, the brand border and the brand ink at rest, so it reads as a control at a glance.
 * `BRAND_INK` rather than `BRAND` for the glyph: `BRAND` on `BRAND_SOFT` is 2.91:1 and the darker
 * ink clears 4.5, which is the rule this repo already states for brand-coloured text on a brand
 * wash — and `check-docs` recomputes it rather than trusting this sentence.
 *
 * **The colours are the theme's, inline.** `Sidebar.css` hardcodes an orange of its own, which
 * predates the token; adding a fourth copy of the brand to a stylesheet is what "change the brand
 * in `theme.ts`, not in stylesheets" refuses. Hover is a CSS rule that shifts *brightness* rather
 * than naming a colour, so the feedback needs no second palette.
 */
export function SidebarToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  const label = collapsed ? NAV_EXPAND_LABEL : NAV_COLLAPSE_LABEL
  return (
    <Tooltip title={label} placement="right">
      <Button
        type="text"
        className="sidebar-toggle"
        aria-label={label}
        aria-expanded={!collapsed}
        icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        onClick={onToggle}
        style={{
          background: BRAND_SOFT,
          border: `1px solid ${BRAND}`,
          color: BRAND_INK,
          width: 30,
          height: 30,
        }}
      />
    </Tooltip>
  )
}

export default function Sidebar({
  onNavigate,
  collapsed = false,
  onToggle,
}: {
  onNavigate?: () => void
  /**
   * Whether the navigation is hidden. Absent on the mobile drawer, which hides everything by being
   * shut — a collapse inside a drawer would be two ways to do one thing.
   */
  collapsed?: boolean
  onToggle?: () => void
}) {
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

  /*
   * **Collapsed means *absent*, not narrow.** Asked for as "make sure all the sidebar menu are
   * hidden", and the whole shell returns early rather than rendering an icon-only rail: the items,
   * the brand and the signed-in card are not in the markup at all, which is what the Ask history
   * rail already does and what a screen reader needs — a hidden-by-CSS menu is still announced.
   *
   * What is left is the one control that brings it back. A collapse with no way out would be a
   * one-way door, and this is the place a reader looks for it because it is where the sidebar was.
   */
  if (collapsed && onToggle) {
    return (
      <div className="sidebar is-collapsed">
        <SidebarToggle collapsed onToggle={onToggle} />
      </div>
    )
  }

  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        {onToggle ? <SidebarToggle collapsed={false} onToggle={onToggle} /> : null}
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
