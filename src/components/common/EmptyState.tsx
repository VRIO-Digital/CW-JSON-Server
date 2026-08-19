import { Col, Row, Typography } from 'antd'
import type { ReactNode } from 'react'
import { SP } from '../theme'
import './EmptyState.css'

export interface EmptyStateStep {
  title: string
  detail: string
}

/**
 * A page with nothing to show yet.
 *
 * Not antd's `Empty`: its grey box says "nothing here" and stops. Every empty
 * page in this app is a page *before a step has been taken*, so the shell says
 * what is missing, gives the one action that fixes it, and numbers the path from
 * here to a filled screen. `NoSourceConnected` was the first of these; the shape
 * is shared so the second one does not invent a different look.
 */
export default function EmptyState({
  icon,
  title,
  detail,
  action,
  steps,
  footnote,
  bare = false,
}: {
  /** Sits in the brand medallion — the one spot of colour above the action. */
  icon: ReactNode
  title: string
  /** What specifically will appear here once the step is taken. */
  detail: ReactNode
  action: ReactNode
  /** The path from nothing to something. Omitted when there isn't one. */
  steps?: EmptyStateStep[]
  footnote?: ReactNode
  /**
   * Drops the dashed frame, for when this sits *inside* a card that already has
   * one — two borders around the same emptiness read as a rendering fault, not
   * as a slot waiting to be filled.
   */
  bare?: boolean
}) {
  return (
    <div className={`empty-state${bare ? ' is-bare' : ''}`}>
      <div className="empty-state-inner">
        <span className="empty-state-badge" aria-hidden="true">
          {icon}
        </span>

        <Typography.Title level={4} className="empty-state-title">
          {title}
        </Typography.Title>

        <Typography.Paragraph className="empty-state-detail">
          {detail}
        </Typography.Paragraph>

        <div className="empty-state-action">{action}</div>

        {steps && steps.length > 0 ? (
          <Row gutter={[SP.md, SP.md]} className="empty-state-steps">
            {steps.map((step, i) => (
              <Col xs={24} sm={24 / steps.length} key={step.title}>
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
        ) : null}

        {footnote ? (
          <Typography.Text className="empty-state-footnote">
            {footnote}
          </Typography.Text>
        ) : null}
      </div>
    </div>
  )
}
