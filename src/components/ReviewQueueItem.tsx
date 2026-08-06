import { BarChartOutlined } from '@ant-design/icons'
import { Button, Input, Space, Tag } from 'antd'
import { useState } from 'react'
import type { ReviewChoice, ReviewItem } from '../api/client'
import { SP } from '../theme'
import './ReviewQueueItem.css'

/*
 * The buttons a row offers come from its `actionSet`, not from the page.
 *
 * A causal claim is approved *as causal* or downgraded to correlational —
 * "Approve" would hide which of the two happened, and only one of them keeps
 * the causal edge. Adding a set means adding it here *and* to the server's
 * `allowed` list, which is what refuses anything else.
 */
const ACTIONS: Record<string, { choice: ReviewChoice; label: string }[]> = {
  standard: [
    { choice: 'approve', label: 'Approve' },
    { choice: 'correct', label: 'Correct…' },
    { choice: 'reject', label: 'Reject' },
  ],
  causal: [
    { choice: 'approve-causal', label: 'Approve as causal' },
    { choice: 'downgrade-correlational', label: 'Downgrade to correlational' },
    { choice: 'reject', label: 'Reject' },
  ],
}

const DECIDED: Record<string, string> = {
  approve: 'Approved',
  correct: 'Corrected',
  reject: 'Rejected',
  'approve-causal': 'Approved as causal',
  'downgrade-correlational': 'Downgraded to correlational',
}

export default function ReviewQueueItem({
  item,
  pending,
  onDecide,
}: {
  item: ReviewItem
  pending: boolean
  onDecide: (choice: ReviewChoice, justification: string) => void
}) {
  const [justification, setJustification] = useState('')
  const actions = ACTIONS[item.actionSet] ?? ACTIONS.standard

  return (
    <div className={`rq-item${item.decision ? ' is-decided' : ''}`}>
      <div className="rq-top">
        <span className="rq-kind">{item.kind}</span>
        <span className="rq-title">{item.title}</span>
        {/* Confidence and the floor travel together: the number alone does not
            say why a human is being asked. */}
        <span className="rq-score">
          <BarChartOutlined aria-hidden="true" /> {item.confidence.toFixed(2)}
          {item.floor ? ` · floor: ${item.floor}` : ''}
        </span>
      </div>

      <div className="rq-detail">{item.detail}</div>

      {item.decision ? (
        <div className="rq-decided">
          <Tag color="success" variant="filled">
            {DECIDED[item.decision.choice] ?? item.decision.choice}
          </Tag>
          {item.decision.justification ? (
            <span className="rq-decided-why">“{item.decision.justification}”</span>
          ) : null}
        </div>
      ) : (
        <div className="rq-actions">
          <Space size={SP.sm} wrap>
            {actions.map((a) => (
              <Button
                key={a.choice}
                size="small"
                loading={pending}
                onClick={() => onDecide(a.choice, justification)}
              >
                {a.label}
              </Button>
            ))}
          </Space>
          {/* Only where the floor demands a reason — the server refuses the
              decision without one, so the field is not decoration. */}
          {item.justification ? (
            <Input
              className="rq-justify"
              size="small"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="justification (recorded)"
              aria-label={`Justification for ${item.title}`}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
