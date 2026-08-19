import type { RouteObject } from 'react-router-dom'
import App from './App'
import DatasetPathGate from './components/shell/DatasetPathGate'
import DatasetRedirect from './components/shell/DatasetRedirect'
import RequireAuth from './components/shell/RequireAuth'
import { LANDING } from './nav'
import AskPage from './pages/AskPage'
import AuditPage from './pages/AuditPage'
import CatalogPage from './pages/CatalogPage'
import DbEditorPage from './pages/DbEditorPage'
import GraphCanvasFullPage from './pages/GraphCanvasFullPage'
import GraphStudioListPage from './pages/GraphStudioListPage'
import GraphStudioPage from './pages/GraphStudioPage'
import LoginPage from './pages/LoginPage'
import NewGraphPage from './pages/NewGraphPage'
import NotFoundPage from './pages/NotFoundPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'
import SourcesPage from './pages/SourcesPage'
import StaticDocPage from './pages/StaticDocPage'
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

  /*
   * The settings/users/connectors description, at a path somebody can type.
   *
   * The document lives in `public/` and Vite already serves it under its own long filename; this is the
   * short address for it. **Reachable signed out**, like `/login` and for the same reason — it is a
   * document to be read, and behind the gate a typed URL would bounce to the login and never show it.
   * Nothing on it is tenant data.
   *
   * A sibling of `/login`, not a child: react-router matches these paths exactly, so `/login` does not
   * swallow `/login/data` and the declaration order does not matter here. That is worth stating because
   * the opposite is true elsewhere in this table — `graph-studio/:useCaseId` *does* match its child's
   * parent segment, which is why the canvas route below has to come first.
   */
  {
    path: '/login/data',
    element: (
      <StaticDocPage
        file="context-weave-settings-users-connectors-use-description.html"
        title="Context Weave — settings, users and connectors"
      />
    ),
  },

  {
    element: <RequireAuth />,

    children: [
      /*
       * ---------------- the dataset is the first segment of every in-app URL ----------------
       *
       * `/E/sources`, `/C/reports` — the selected dataset's first letter, so the address says which
       * dataset the page is showing. `DatasetPathGate` renders at `/:ds` and corrects a URL whose letter
       * is wrong or missing; the selection is the authority and the URL is its rendering, because
       * adopting a typed letter would change dataset without the confirmation and sign-out that make
       * the switch safe.
       *
       * `/` has no segment to match, so it redirects on its own — through a component rather than a
       * `<Navigate>` built here, since the table is constructed once at module load and would freeze
       * the dataset selected at that moment.
       */
      { path: '/', element: <DatasetRedirect to={LANDING} /> },

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
      {
        path: '/:ds',
        element: <DatasetPathGate />,

        children: [
          { path: 'graph-studio/:useCaseId/canvas', element: <GraphCanvasFullPage /> },

          {
            /*
             * Pathless, so its children's paths are relative to `/:ds` and the shell is one level of
             * nesting rather than a second path to keep in step. The same layout-route shape
             * `RequireAuth` uses above.
             */
            element: <App />,

            children: [
          /* The same landing page the login falls back to — Ask, what the console is for. `LANDING` is
             declared once here and imported by `LoginPage`; two answers to "where does no particular page
             go" would send a fresh sign-in and a bare `/` to different places. */
          { index: true, element: <DatasetRedirect to={LANDING} /> },
          { path: 'sources', element: <SourcesPage /> },
          { path: 'new-graph', element: <NewGraphPage /> },
          // The studio lists built graphs; a graph's own review lives under its id.
          { path: 'graph-studio', element: <GraphStudioListPage /> },
          { path: 'graph-studio/:useCaseId', element: <GraphStudioPage /> },
          // Ask queries a *published* graph, so it lists none until one is live.
          { path: 'ask', element: <AskPage /> },
          { path: 'catalog', element: <CatalogPage /> },
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
          /*
           * Users and persona access — the two tabs that configure who sees what.
           *
           * **The route is unconditional, and that is deliberate.** Persona permissions hide a
           * navigation *item*; they do not gate a *page*, so `/settings` answers even for a persona
           * whose sidebar no longer lists it. That is what stops a reader turning Settings off for a
           * persona and losing the only way to turn it back on, and it is the same honesty every
           * other permission surface here states: hiding is not authorising.
           */
          { path: 'settings', element: <SettingsPage /> },
          { path: 'audit', element: <AuditPage /> },
          { path: 'trace', element: <TracePage /> },
          { path: 'validation', element: <ValidationPage /> },
          { path: 'db', element: <DbEditorPage /> },
          { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]
