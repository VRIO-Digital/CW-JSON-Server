import { Button, Menu, Typography } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import type { SessionIdentity } from '../api/client'
import { NAV_ITEMS } from '../nav'
import { useAuthStore } from '../store/authStore'
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

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const identity = useAuthStore((s) => s.identity)
  const logout = useAuthStore((s) => s.logout)

  const selected = NAV_ITEMS.find((item) => pathname.startsWith(item.path))

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

      <Menu
        mode="inline"
        theme="dark"
        selectedKeys={selected ? [selected.key] : []}
        className="sidebar-menu"
        items={NAV_ITEMS.map(({ key, label, icon: Icon }) => ({
          key,
          icon: <Icon />,
          label,
        }))}
        onClick={({ key }) => {
          const item = NAV_ITEMS.find((i) => i.key === key)
          if (item) navigate(item.path)
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
