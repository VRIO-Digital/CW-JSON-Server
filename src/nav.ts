import {
  CheckCircleOutlined,
  DatabaseOutlined,
  LineChartOutlined,
  SafetyCertificateOutlined,
  TableOutlined,
} from '@ant-design/icons'
import type { ComponentType } from 'react'

export type NavKey =
  | 'sources'
  | 'catalogue'
  | 'audit'
  | 'trace'
  | 'validation'
// | 'db'

export interface NavItem {
  key: NavKey
  label: string
  path: string
  icon: ComponentType
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'sources', label: 'Sources', path: '/sources', icon: DatabaseOutlined },
  {
    key: 'catalogue',
    label: 'Data Catalogue',
    path: '/catalogue',
    icon: TableOutlined,
  },
  {
    key: 'audit',
    label: 'Audit & Governance',
    path: '/audit',
    icon: SafetyCertificateOutlined,
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
  // Dev tool: edits the mock server's db.json, which backs every page above.
  // { key: 'db', label: 'Mock Data', path: '/db', icon: CodeOutlined },
]
