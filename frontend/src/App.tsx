import { MenuOutlined } from '@ant-design/icons'
import { Button, Drawer, Grid, Layout, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './components/shell/Sidebar'
import { splitDatasetPath } from './api/dataset'
import { NAV_ITEMS } from './nav'
import './App.css'

const SIDER_WIDTH = 258
/**
 * The rail left behind when the navigation is hidden — wide enough for the one control that brings
 * it back, and nothing else.
 *
 * Not 0: a collapse with no way out is a one-way door, and the place a reader looks for the way back
 * is where the sidebar was.
 */
const COLLAPSED_WIDTH = 48

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  /*
   * Whether the navigation is hidden. Component state, not persisted: a reload bringing the
   * navigation back is the safer default for the only way around the app, and this is the
   * "lightweight per-viewer convenience" `localStorage` is for rather than something a page needs.
   */
  const [navCollapsed, setNavCollapsed] = useState(false)
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
    <Layout hasSider={!isMobile} style={{ minHeight: '100vh' }}>
      {isMobile ? (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          placement="left"
          size={SIDER_WIDTH}
          closable={false}
          styles={{ body: { padding: 0 } }}
        >
          {/* No collapse in the drawer: it hides everything by being shut, and two ways to do
              one thing is what this repo refuses everywhere else. */}
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </Drawer>
      ) : (
        <Layout.Sider
          /* antd's own `collapsible` draws an icon-only rail, which is the opposite of what was
             asked for — the width is driven here and the sidebar decides what it renders. */
          width={navCollapsed ? COLLAPSED_WIDTH : SIDER_WIDTH}
          theme="light"
          style={{
            position: 'sticky',
            top: 0,
            height: '100vh',
            borderInlineEnd: '1px solid #e9ecf1',
            transition: 'width .18s ease',
          }}
        >
          <Sidebar
            collapsed={navCollapsed}
            onToggle={() => setNavCollapsed((open) => !open)}
          />
        </Layout.Sider>
      )}

      <Layout style={{ minWidth: 0 }}>
        {isMobile ? (
          <Layout.Header className="mobile-bar">
            <Button
              icon={<MenuOutlined />}
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            />
            <Typography.Text strong style={{ fontSize: 15 }}>
              {activeLabel}
            </Typography.Text>
          </Layout.Header>
        ) : null}

        {/*
          * No dataset key here, deliberately. Changing the dataset signs the reader out and reloads
          * the document (see `datasetStore.switchDataset`), which reconstructs every module — an
          * `<Outlet>` key remounted the components and left the module-level stores holding the
          * previous dataset's rows, which is a mechanism that looks like a guarantee and is not one.
          */}
        <Layout.Content className="app-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
