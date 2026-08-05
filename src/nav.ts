import {
  ApartmentOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  LineChartOutlined,
  SafetyCertificateOutlined,
  TableOutlined,
  BranchesOutlined,
  BuildOutlined,
  ClusterOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import type { ComponentType } from 'react'

export type NavKey =
  | 'graphs'
  | 'ask'
  | 'reports'
  | 'sources'
  | 'catalogue'
  | 'graph-builds'
  | 'graph-studio'
  | 'what-if'
  | 'trace'
  | 'validation'
  | 'feedback'
  | 'audit'

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
  {
    key: 'graph-builds',
    label: 'Graph Builds',
    path: '/graph-builds',
    icon: BuildOutlined,
  },
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
  {
    key: 'trace',
    label: 'Trace & Observability',
    path: '/trace',
    icon: LineChartOutlined,
  },
  {
    key: 'validation',
    label: 'Validation & Evals',
    path: '/validation',
    icon: CheckCircleOutlined,
  },
  {
    key: 'feedback',
    label: 'Feedback & Learning',
    path: '/feedback',
    icon: ApartmentOutlined,
  },
  {
    key: 'audit',
    label: 'Audit & Governance',
    path: '/audit',
    icon: SafetyCertificateOutlined,
  },

  // Dev tool
  // { key: 'db', label: 'Mock Data', path: '/db', icon: CodeOutlined },
]