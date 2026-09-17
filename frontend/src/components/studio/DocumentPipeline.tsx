import { CheckOutlined, LoadingOutlined } from '@ant-design/icons'
import { Progress, Space, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import type { DgbJob } from '../../api/client'
import { SP } from '../../theme'
import './DocumentPipeline.css'

/**
 * The document lane's run, stage by stage.
 *
 * **The stage list is the server's** — handed over on the job payload — so adding a stage adds a row
 * here and a list held in this component could not go stale. Every state on screen derives from the
 * run's own cursor rather than from a timer: a bar filling on a clock is an operation narrating work
 * nobody did.
 *
 * **The long stages report a phrase, not a percentage.** Extraction and canonicalisation have no
 * honest denominator — nothing counts what fraction of "resolving entities across the corpus" is
 * done — so each says what it is doing and how long it has been doing it. The bar above them is over
 * *stages*, which is a denominator that exists.
 */

const { Text } = Typography

/** Ticks once a second so the elapsed label advances between polls. The phase itself only changes
 *  when the server says so — this clock moves the *label*, never the state. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

const elapsed = (sinceSeconds: number, now: number) => {
  const s = Math.max(0, Math.round(now / 1000 - sinceSeconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m${s % 60 ? ` ${s % 60}s` : ''}`
}

export default function DocumentPipeline({ job }: { job: DgbJob }) {
  const running = job.status === 'running'
  const now = useNow(running)

  const done = job.stages.filter((s) => s.state === 'complete').length
  const percent = job.stages.length === 0 ? 0 : Math.round((done / job.stages.length) * 100)
  const current = job.stages.find((s) => s.state === 'running') ?? null

  return (
    <Space direction="vertical" size={SP.sm} style={{ width: '100%' }}>
      <Progress
        percent={percent}
        size="small"
        status={running ? 'active' : 'success'}
        style={{ marginBottom: 0 }}
      />

      {/* What is happening and how much of the corpus it has been through — the two figures a reader
          checks first, on one line above the detail. */}
      <Text type="secondary" style={{ fontSize: 12 }}>
        {running
          ? `${current?.label ?? 'Starting'} · ${job.documentsProcessed} of ${job.documentTotal} processed`
          : `Complete · ${job.documentsProcessed} of ${job.documentTotal} document${job.documentTotal === 1 ? '' : 's'} processed`}
      </Text>

      <div className="dp-stages">
        {job.stages.map((stage) => {
          const isRunning = stage.state === 'running'
          return (
            <div key={stage.stage} className={`dp-stage dp-${stage.state}`}>
              <div className="dp-row">
                <span className="dp-mark" aria-hidden="true">
                  {stage.state === 'complete' ? (
                    <CheckOutlined />
                  ) : isRunning ? (
                    <Spin indicator={<LoadingOutlined spin />} size="small" />
                  ) : (
                    <span className="dp-dot" />
                  )}
                </span>
                <Text className="dp-label">{stage.label}</Text>
              </div>
              {/*
                * The phase line, under the stage it belongs to and only while that stage runs. It says
                * what the stage is *doing* rather than repeating its own heading, because a line that
                * restates the label above it tells a reader nothing they cannot already see.
                */}
              {isRunning && job.phase && job.phase.stage === stage.stage ? (
                <Text type="secondary" className="dp-phase">
                  {`${job.phase.phase} · ${elapsed(job.phase.since, now)}`}
                </Text>
              ) : null}
            </div>
          )
        })}
      </div>
    </Space>
  )
}
