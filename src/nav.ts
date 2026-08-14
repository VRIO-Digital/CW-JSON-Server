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
  ClusterOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import type { ComponentType } from 'react'

export type NavKey =
  | 'graphs'
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

export interface NavItem {
  key: NavKey
  label: string
  path: string
  icon: ComponentType
}

export const NAV_ITEMS: NavItem[] = [
  {
    key: 'graphs',
    label: 'Knowledge Graphs',
    path: '/graphs',
    icon: ClusterOutlined,
  },
  {
    key: 'new-graph',
    label: 'New Graph',
    path: '/new-graph',
    icon: PlusOutlined,
  },
  {
    key: 'ask',
    label: 'Ask',
    path: '/ask',
    icon: QuestionCircleOutlined,
  },
  {
    key: 'reports',
    label: 'Reports',
    path: '/reports',
    icon: FileTextOutlined,
  },
  {
    key: 'sources',
    label: 'Sources',
    path: '/sources',
    icon: DatabaseOutlined,
  },
  {
    key: 'catalogue',
    label: 'Data Catalogue',
    path: '/catalogue',
    icon: TableOutlined,
  },
  // Commented out, not deleted — both want BuildOutlined back when they land.
  // { key: 'graph-builds', label: 'Graph Builds', path: '/graph-builds', icon: BuildOutlined },
  {
    key: 'graph-studio',
    label: 'Graph Studio',
    path: '/graph-studio',
    icon: DeploymentUnitOutlined,
  },
  {
    key: 'what-if',
    label: 'What-if Lenses',
    path: '/what-if',
    icon: ExperimentOutlined,
  },
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
  },
  // {
  //   key: 'trace',
  //   label: 'Trace & Observability',
  //   path: '/trace',
  //   icon: LineChartOutlined,
  // },
  // {
  //   key: 'validation',
  //   label: 'Validation & Evals',
  //   path: '/validation',
  //   icon: CheckCircleOutlined,
  // },
  // {
  //   key: 'feedback',
  //   label: 'Feedback & Learning',
  //   path: '/feedback',
  //   icon: ApartmentOutlined,
  // },

  // Dev tool — routed, reachable by URL only.
  // { key: 'db', label: 'Mock Data', path: '/db', icon: BuildOutlined },
]