import { LoadingOutlined } from '@ant-design/icons'
import { Progress, Spin } from 'antd'
import type { DerivationRun } from '../api/client'
import '../pages/NewGraphPage.css'

const money = (usd: number) => `$${usd.toFixed(2)}`

/*
 * What a model call looks like while it is happening.
 *
 * Two sizes of the same idea: a full panel for the derivation between steps 6
 * and 7, and an inline strip for the "Suggest … (LLM)" buttons. Both say what is
 * being done and what it has cost, because a spinner alone teaches that an LLM
 * call is instant and free, and it is neither.
 */
export function LlmRunPanel({ run }: { run: DerivationRun }) {
  return (
    <div className="ng-run">
      <Spin indicator={<LoadingOutlined spin />} size="large" />

      <div className="ng-run-title">{run.stageLabel}…</div>

      {/* The names stream in as they are derived. */}
      <div className="ng-run-names">
        {run.revealed.length > 0
          ? `${run.revealed.join(', ')}${run.status === 'running' ? '…' : ''}`
          : 'Reading your answers…'}
      </div>

      <Progress
        percent={run.progress}
        showInfo={false}
        strokeColor="#f4562b"
        className="ng-run-bar"
      />

      <div className="ng-run-foot">
        {run.status === 'complete'
          ? `done · ${run.entityTotal} elements derived · run cost ${money(run.costUsd)} of ${money(run.costCapUsd)} cap`
          : `async — safe to leave; you’ll be notified · run cost so far ${money(run.costUsd)} of ${money(run.costCapUsd)} cap`}
      </div>
    </div>
  )
}

/** The same, sized for a button that is waiting on a draft. */
export function LlmRunInline({
  label,
  stages,
  cost,
  cap,
}: {
  label: string
  stages: string[]
  /** Undefined until a run has reported one — never invent a figure. */
  cost?: number
  cap?: number
}) {
  return (
    <div className="ng-run-inline">
      <Spin indicator={<LoadingOutlined spin />} size="small" />
      <span className="ng-run-inline-text">
        <strong>{label}</strong>
        <span className="ng-run-inline-stages">{stages.join(' · ')}</span>
      </span>
      {cost !== undefined && cap !== undefined ? (
        <span className="ng-run-inline-cost">
          last run {money(cost)} of {money(cap)} cap
        </span>
      ) : null}
    </div>
  )
}
