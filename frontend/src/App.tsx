import { MenuOutlined } from '@ant-design/icons'
import { Button, Drawer, Grid, Layout, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './components/shell/Sidebar'
import { splitDatasetPath } from './api/dataset'
import { NAV_ITEMS } from './nav'
import './App.css'

const SIDER_WIDTH = 258
/** antd's own floor for a collapsed `Sider` — the icon rail width, not a number chosen here. */
const SIDER_COLLAPSED_WIDTH = 80

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  /*
   * Desktop only — the mobile `Drawer` already has its own open/closed state, and collapsing to an
   * icon rail is not a thing a drawer that overlays the page needs: closing it already reclaims the
   * width. Local state and no persistence, on request: the ask was a working toggle, not a
   * remembered preference.
   */
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()
  const screens = Grid.useBreakpoint()

  // `md` is undefined on the first paint before antd measures; treat that as
  // desktop so the sider does not flash a drawer-only layout.
  const isMobile = screens.md === false

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  /*
   * The mobile bar names the page you are on, so it looks up **every** nav item rather than the
   * visible ones. A page hidden from the sidebar is still reachable by URL — persona permissions are a
   * navigation preference, not a gate — and a header reading "ContextWeave" over the Reports page
   * because Reports is hidden would be the filter leaking into a label. Visibility is decided in one
   * place, `visibleNavItems`, and this is not it.
   */
  const activeLabel =
    NAV_ITEMS.find((item) => splitDatasetPath(pathname).rest.startsWith(item.path))?.label ??
    'ContextWeave'

  return (
    <div className="app-shell">
      {isMobile ? (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          placement="left"
          size={SIDER_WIDTH}
          closable={false}
          styles={{ body: { padding: 0 } }}
        >
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </Drawer>
      ) : (
        <Layout.Sider
          width={SIDER_WIDTH}
          collapsedWidth={SIDER_COLLAPSED_WIDTH}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          theme="light"
          className="app-sider-card"
        >
          <Sidebar collapsed={collapsed} />
        </Layout.Sider>
      )}

      {/*
        * The content card's own height is fixed to the viewport (via `.app-content-card`), never the
        * sidebar's collapsed width — the two cards are independent panels side by side, not one
        * layout that reflows around the other. Only `.app-content` inside it scrolls, so the card's
        * frame (and anything pinned to its top, like the mobile bar) stays put while a long page
        * scrolls underneath it.
        */}
      <div className="app-content-card">
        {isMobile ? (
          <div className="mobile-bar">
            <Button
              icon={<MenuOutlined />}
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            />
            <Typography.Text strong style={{ fontSize: 15 }}>
              {activeLabel}
            </Typography.Text>
          </div>
        ) : null}

        {/*
          * No dataset key here, deliberately. Changing the dataset signs the reader out and reloads
          * the document (see `datasetStore.switchDataset`), which reconstructs every module — an
          * `<Outlet>` key remounted the components and left the module-level stores holding the
          * previous dataset's rows, which is a mechanism that looks like a guarantee and is not one.
          */}
        <div className="app-content scroll-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
