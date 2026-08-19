import { Card, Col, Row, Statistic, Typography } from 'antd'
import type { Stat } from '../types'
import { SP, STATUS } from '../theme'

const TONE_COLOR = {
  good: STATUS.good,
  warn: STATUS.warn,
  crit: STATUS.crit,
  neutral: undefined,
} as const

/*
 * A headline number is not a chart — antd Statistic in a Card.
 * Four across on desktop, two on tablet, one on phone.
 */
export default function StatCards({ stats }: { stats: Stat[] }) {
  return (
    <Row gutter={[SP.base, SP.base]} style={{ marginBottom: SP.xl }}>
      {stats.map((s) => (
        <Col key={s.label} xs={24} sm={12} xl={6}>
          <Card
            size="small"
            style={{ height: '100%' }}
            styles={{ body: { padding: `${SP.base}px ${SP.lg}px` } }}
          >
            <Statistic
              title={s.label.toUpperCase()}
              value={s.value}
              valueStyle={{
                color: TONE_COLOR[s.tone ?? 'neutral'],
                fontWeight: 600,
                letterSpacing: '-0.5px',
              }}
            />
            {s.note ? (
              <Typography.Text
                type="secondary"
                style={{ display: 'block', marginTop: SP.xs, fontSize: 12.5 }}
              >
                {s.note}
              </Typography.Text>
            ) : null}
          </Card>
        </Col>
      ))}
    </Row>
  )
}
