import { Menu, Typography } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { NAV_ITEMS } from '../nav'
import './Sidebar.css'

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()

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
    </div>
  )
}