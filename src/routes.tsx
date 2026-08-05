import { Navigate, type RouteObject } from 'react-router-dom'
import App from './App'
import AuditPage from './pages/AuditPage'
import CataloguePage from './pages/CataloguePage'
import DbEditorPage from './pages/DbEditorPage'
import NewGraphPage from './pages/NewGraphPage'
import NotFoundPage from './pages/NotFoundPage'
import SourcesPage from './pages/SourcesPage'
import TracePage from './pages/TracePage'
import ValidationPage from './pages/ValidationPage'

/*
 * Element routes only — no loaders, actions, or SSR. See the ALLOWLIST note in
 * scripts/audit-gate.mjs for why that matters to the audit gate.
 *
 * Kept separate from the history binding in main.tsx so the table can be
 * mounted on a memory router in tests.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,

    children: [
      { index: true, element: <Navigate to="/sources" replace /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'new-graph', element: <NewGraphPage /> },
      { path: 'catalogue', element: <CataloguePage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'trace', element: <TracePage /> },
      { path: 'validation', element: <ValidationPage /> },
      { path: 'db', element: <DbEditorPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
