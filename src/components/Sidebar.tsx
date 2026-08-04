import { Menu, Typography } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { NAV_ITEMS } from '../nav'
import './Sidebar.css'

/**
 * Brand block + antd Menu. Rendered inside Layout.Sider on desktop and inside
 * a Drawer on small screens, so it owns no positioning of its own.
 */
export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const selected = NAV_ITEMS.find((item) => pathname.startsWith(item.path))

  return (
    <>
      <div className="sidebar-brand">
        <Typography.Title level={4} className="wordmark">
          Context<span>Weave</span>
        </Typography.Title>
        <Typography.Text className="tagline">
          From Data to Decisions — With Context.
        </Typography.Text>
      </div>

      <Menu
        mode="inline"
        selectedKeys={selected ? [selected.key] : []}
        style={{ borderInlineEnd: 'none', paddingBlock: 14 }}
        items={NAV_ITEMS.map(({ key, label, icon: NavIcon }) => ({
          key,
          label,
          icon: <NavIcon />,
        }))}
        onClick={({ key }) => {
          const item = NAV_ITEMS.find((n) => n.key === key)
          if (item) navigate(item.path)
          onNavigate?.()
        }}
      />
    </>
  )
}
