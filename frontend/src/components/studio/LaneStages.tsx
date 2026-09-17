import { CheckCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { Spin, Typography } from 'antd'
import { SP } from '../../theme'
import './LaneStages.css'

export type StageState = 'pending' | 'running' | 'complete'

/**
 * The state mark, **shared by a stage and its substeps** so the two levels cannot come to disagree
 * about what "running" looks like. Decorative and `aria-hidden`: the text beside it carries the
 * state, which is the rule this repo keeps everywhere — state is never colour alone.
 */
export function Mark({ state }: { state: StageState }) {
  return (
    <span className="ls-mark" aria-hidden="true">
      {state === 'complete' ? (
        <CheckCircleFilled />
      ) : state === 'running' ? (
        <Spin indicator={<LoadingOutlined spin />} size="small" />
      ) : (
        <span className="ls-dot" />
      )}
    </span>
  )
}

export interface LaneStage {
  stage: string
  label: string
  state: StageState
  steps?: { step: string; state: StageState }[]
}

/**
 * One lane's pipeline, a stage at a time.
 *
 * **The list is the server's**, handed over on the build payload, so adding a stage on the server
 * adds a row here and a list held in this component could not go stale. The state of every row is
 * derived from the run's own cursor rather than from a timer — a bar filling on a clock is an
 * operation narrating work nobody did.
 */
export default function LaneStages({
  stages,
  note,
}: {
  stages: LaneStage[]
  note?: string
}) {
  return (
    <div className="ls-root">
      {stages.map((stage) => (
        <div key={stage.stage} className={`ls-stage ls-${stage.state}`}>
          <div className="ls-row">
            <Mark state={stage.state} />
            <Typography.Text className="ls-label">{stage.label}</Typography.Text>
            <Typography.Text type="secondary" className="ls-state">
              {stage.state}
            </Typography.Text>
          </div>
          {stage.steps && stage.steps.length > 0 ? (
            <div className="ls-steps">
              {stage.steps.map((step) => (
                <div key={step.step} className="ls-step">
                  <Mark state={step.state} />
                  <Typography.Text type="secondary" className="ls-step-label">
                    {step.step.replace(/_/g, ' ')}
                  </Typography.Text>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      {note ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: SP.sm, fontSize: 12.5 }}>
          {note}
        </Typography.Text>
      ) : null}
    </div>
  )
}
