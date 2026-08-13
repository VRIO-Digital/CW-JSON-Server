import { Navigate, type RouteObject } from 'react-router-dom'
import App from './App'
import RequireAuth from './components/RequireAuth'
import AskPage from './pages/AskPage'
import AuditPage from './pages/AuditPage'
import CataloguePage from './pages/CataloguePage'
import DbEditorPage from './pages/DbEditorPage'
import GraphCanvasFullPage from './pages/GraphCanvasFullPage'
import GraphStudioListPage from './pages/GraphStudioListPage'
import GraphStudioPage from './pages/GraphStudioPage'
import LoginPage from './pages/LoginPage'
import NewGraphPage from './pages/NewGraphPage'
import NotFoundPage from './pages/NotFoundPage'
import ReportsPage from './pages/ReportsPage'
import SourcesPage from './pages/SourcesPage'
import TracePage from './pages/TracePage'
import ValidationPage from './pages/ValidationPage'
import WhatIfPage from './pages/WhatIfPage'

/*
 * Element routes only — no loaders, actions, or SSR. See the ALLOWLIST note in
 * scripts/audit-gate.mjs for why that matters to the audit gate.
 *
 * Kept separate from the history binding in main.tsx so the table can be
 * mounted on a memory router in tests.
 */
export const routes: RouteObject[] = [
  // Outside RequireAuth on purpose: this is the one page reachable while
  // signed out, and the only one with no sidebar to render.
  { path: '/login', element: <LoginPage /> },

  {
    element: <RequireAuth />,

    children: [
      /*
       * The canvas with the whole window, opened in a new tab by the **Full view**
       * button on the studio's Canvas tab.
       *
       * Deliberately a sibling of the `App` tree rather than a child of it: `App`
       * renders the sidebar, and 189 nodes want those 240px. It is the only page
       * besides `/login` outside that shell, and for the opposite reason — `/login`
       * has nothing to navigate to, and this has nothing to spare. Still inside
       * `RequireAuth`, so an unauthenticated URL redirects like everything else, and
       * still URL-only with no `NAV_ITEMS` entry, by the same rule as `/db`.
       *
       * It must sit **before** the `App` route: `graph-studio/:useCaseId` would
       * otherwise match `graph-studio/x/canvas`'s parent segment and the studio page
       * would win.
       */
      { path: '/graph-studio/:useCaseId/canvas', element: <GraphCanvasFullPage /> },

      {
        path: '/',
        element: <App />,

        children: [
          { index: true, element: <Navigate to="/sources" replace /> },
          { path: 'sources', element: <SourcesPage /> },
          { path: 'new-graph', element: <NewGraphPage /> },
          // The studio lists built graphs; a graph's own review lives under its id.
          { path: 'graph-studio', element: <GraphStudioListPage /> },
          { path: 'graph-studio/:useCaseId', element: <GraphStudioPage /> },
          // Ask queries a *published* graph, so it lists none until one is live.
          { path: 'ask', element: <AskPage /> },
          { path: 'catalogue', element: <CataloguePage /> },
          /*
           * The report section — the authoring prototype from the demo package, vendored into
           * `src/reports/` and mounted by this page. **One route, not four**: the prototype
           * owns its own navigation (three tabs) and its own library, so a report is not a URL
           * here the way it was in the React section this replaced.
           *
           * Available once a graph is published, which is the same precondition Ask and the
           * What-if lens have. The `/reports*` API is still served and still typed in
           * `client.ts`, but this page reads one field of it — the publish count — because the
           * prototype's figures are its own demo dataset.
           */
          { path: 'reports', element: <ReportsPage /> },
          /* The What-if lens — a read-only overlay that admits a candidate load
             hypothetically and reports what the facility would inherit. Its nav entry
             already existed as a roadmap placeholder; this is the page behind it. */
          { path: 'what-if', element: <WhatIfPage /> },
          { path: 'audit', element: <AuditPage /> },
          { path: 'trace', element: <TracePage /> },
          { path: 'validation', element: <ValidationPage /> },
          { path: 'db', element: <DbEditorPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]
