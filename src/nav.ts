import {
  // ApartmentOutlined,
  // CheckCircleOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  // LineChartOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TableOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import type { ComponentType } from 'react'

export type NavKey =
  | 'new-graph'
  | 'ask'
  | 'reports'
  | 'sources'
  | 'catalogue'
  | 'graph-builds'
  | 'graph-studio'
  | 'what-if'
  | 'settings'
  | 'trace'
  | 'validation'
  | 'feedback'
  | 'audit'
  | 'db'

/**
 * The three things a persona comes here to do, in the order it does them.
 *
 * **A group is a heading, never a permission.** `visibleNavItems` still decides item by item what a
 * persona sees, and the sidebar draws a heading only where something under it survived that filter —
 * a lone `EXPLORE` over nothing would read as a section that failed to load rather than as one the
 * persona may not open. Adding a group means adding it here *and* naming it on the items, because
 * an item whose group is not in this list has no heading to sit under and would fall off the menu.
 */
export type NavGroup = 'Explore' | 'Build & Configure' | 'Trust & Operations'

export const NAV_GROUPS: NavGroup[] = [
  'Explore',
  'Build & Configure',
  'Trust & Operations',
]

export interface NavItem {
  key: NavKey
  label: string
  path: string
  icon: ComponentType
  group: NavGroup
}

/*
 * The list is in group order, so the sidebar, the Settings permission rows and the seed's `NAV_KEYS`
 * all read in the order a reader sees on screen. `check-docs` compares this order to the seed's
 * literally, so reordering here means reordering there and re-running `npm run seed:settings`.
 */
export const NAV_ITEMS: NavItem[] = [
  /* ---------- Explore — reading what the graph already answers. ---------- */
  {
    key: 'reports',
    label: 'Reports',
    path: '/reports',
    icon: FileTextOutlined,
    group: 'Explore',
  },
  {
    key: 'ask',
    label: 'Ask',
    path: '/ask',
    icon: QuestionCircleOutlined,
    group: 'Explore',
  },
  {
    key: 'what-if',
    label: 'What-if Lenses',
    path: '/what-if',
    icon: ExperimentOutlined,
    group: 'Explore',
  },

  /* ---------- Build & Configure — everything upstream of a published graph. ---------- */
  {
    key: 'new-graph',
    label: 'New Graph',
    path: '/new-graph',
    icon: PlusOutlined,
    group: 'Build & Configure',
  },
  {
    key: 'sources',
    label: 'Sources',
    path: '/sources',
    icon: DatabaseOutlined,
    group: 'Build & Configure',
  },
  {
    key: 'catalogue',
    label: 'Data Catalogue',
    path: '/catalogue',
    icon: TableOutlined,
    group: 'Build & Configure',
  },
  // Commented out, not deleted — both want BuildOutlined back when they land.
  // { key: 'graph-builds', label: 'Graph Builds', path: '/graph-builds', icon: BuildOutlined, group: 'Build & Configure' },
  {
    key: 'graph-studio',
    label: 'Graph Studio',
    path: '/graph-studio',
    icon: DeploymentUnitOutlined,
    group: 'Build & Configure',
  },

  /* ---------- Trust & Operations — who sees what, and who may change it. ---------- */
  /*
   * Who sees what, and what this server has recorded about it. Sits beside Settings because the two
   * administer different halves of the same question — Settings decides which *pages* a persona
   * reaches, this decides which *rows* it may see and who a published artifact was shared with.
   */
  {
    key: 'audit',
    label: 'Audit & Governance',
    path: '/audit',
    icon: SafetyCertificateOutlined,
    group: 'Trust & Operations',
  },
  /*
   * Users and persona access. Last on purpose — it is the one entry that configures the others, and a
   * sidebar reads better with the thing that changes it at the bottom.
   *
   * **This list is also what Settings configures.** `PERMISSION_KEYS` is derived from it rather than
   * written again, so an entry added here gains a permission row for free, and a permission row can
   * never name an item the sidebar does not have.
   */
  {
    key: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: SettingOutlined,
    group: 'Trust & Operations',
  },
  // {
  //   key: 'trace',
  //   label: 'Trace & Observability',
  //   path: '/trace',
  //   icon: LineChartOutlined,
  //   group: 'Trust & Operations',
  // },
  // {
  //   key: 'validation',
  //   label: 'Validation & Evals',
  //   path: '/validation',
  //   icon: CheckCircleOutlined,
  //   group: 'Trust & Operations',
  // },
  // {
  //   key: 'feedback',
  //   label: 'Feedback & Learning',
  //   path: '/feedback',
  //   icon: ApartmentOutlined,
  //   group: 'Trust & Operations',
  // },

  // Dev tool — routed, reachable by URL only.
  // { key: 'db', label: 'Mock Data', path: '/db', icon: BuildOutlined, group: 'Build & Configure' },
]
