import { Button, Col, Row, Typography } from 'antd'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { SP } from '../theme'
import { BigQueryIcon } from './ConnectorIcon'
import './NoSourceConnected.css'

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
 */
export default function NoSourceConnected({
  detail,
  action,
}: {
  /** What specifically will appear here once a source is connected. */
  detail: string
  /** Overrides the default "go to Sources" link — used on Sources itself. */
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <span className="empty-state-badge" aria-hidden="true">
          <BigQueryIcon size={30} />
        </span>

        <Typography.Title level={4} className="empty-state-title">
          No data source is connected
        </Typography.Title>

        <Typography.Paragraph className="empty-state-detail">
          {detail}
        </Typography.Paragraph>

        <div className="empty-state-action">
          {action ?? (
            <Link to="/sources">
              <Button type="primary" size="large">
                Connect a source
              </Button>
            </Link>
          )}
        </div>

        <Row gutter={[SP.md, SP.md]} className="empty-state-steps">
          {STEPS.map((step, i) => (
            <Col xs={24} sm={8} key={step.title}>
              <div className="empty-state-step">
                <span className="empty-state-step-num">{i + 1}</span>
                <span>
                  <strong>{step.title}</strong>
                  <em>{step.detail}</em>
                </span>
              </div>
            </Col>
          ))}
        </Row>

        <Typography.Text className="empty-state-footnote">
          Credentials are held by reference — ContextWeave never stores a raw secret.
        </Typography.Text>
      </div>
    </div>
  )
}
