import { DatabaseOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import EmptyState from './EmptyState'
import { appPath } from '../api/dataset'

/** The path from nothing to data — the same three steps wherever this appears. */
const STEPS = [
  { title: 'Pick a connector', detail: 'BigQuery or Google Drive' },
  { title: 'Authorise', detail: 'sign in — no key file to upload' },
  { title: 'Choose datasets', detail: 'profiling starts automatically' },
]

/**
 * Shown wherever a page has nothing to display because no data source is
 * connected. Every figure in this app derives from a registered source, so this
 * stands in place of the cards and tables rather than beside them.
 *
 * The shell is `EmptyState`; this owns the source-specific copy only.
 */
export default function NoSourceConnected({
  detail,
  action,
  bare = false,
}: {
  /** What specifically will appear here once a source is connected. */
  detail: string
  /** Overrides the default "go to Sources" link — used on Sources itself. */
  action?: ReactNode
  /** Drops the dashed frame when this already sits inside a card. */
  bare?: boolean
}) {
  return (
    <EmptyState
      bare={bare}
      /*
       * The Sources nav icon, not a vendor logo. This state covers Drive as
       * much as BigQuery — showing one vendor's mark contradicted the step
       * beneath it ("BigQuery or Google Drive") — and an antd icon inherits the
       * medallion's brand tint instead of fighting it with its own blue.
       */
      icon={<DatabaseOutlined />}
      title="No data source is connected"
      detail={detail}
      action={
        action ?? (
          <Link to={appPath('/sources')}>
            <Button type="primary" size="large">
              Connect a source
            </Button>
          </Link>
        )
      }
      steps={STEPS}
      footnote="Credentials are held by reference — ContextWeave never stores a raw secret."
    />
  )
}
