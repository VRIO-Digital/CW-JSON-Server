import { CheckCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { Spin } from 'antd'
import './StageList.css'

/**
 * One row per call, with the one in flight spinning.
 *
 * Shared by the Google consent panel and step 3's run panel because it is the
 * same interaction in two places — done · running · not started yet — and a
 * second copy of it could only drift in its marks or its states.
 *
 * `stage` is the index of the call in flight, so everything before it has come
 * back and everything after it has not been asked for. **A row advances when its
 * request returns, never on a timer here**: the pacing lives on the server
 * (`CONSENT_MS`, `CONNECT_STEP_MS`), so this reports progress rather than
 * animating over an answer already in hand.
 */
export default function StageList({
  stages,
  stage,
}: {
  stages: readonly string[]
  stage: number
}) {
  return (
    <ol className="cs-stages">
      {stages.map((label, i) => {
        const state = i < stage ? 'is-done' : i === stage ? 'is-active' : 'is-waiting'
        return (
          <li key={label} className={`cs-stage ${state}`}>
            <span className="cs-stage-mark" aria-hidden="true">
              {i < stage ? (
                <CheckCircleFilled />
              ) : i === stage ? (
                <Spin indicator={<LoadingOutlined spin />} size="small" />
              ) : (
                <span className="cs-stage-dot" />
              )}
            </span>
            {label}
          </li>
        )
      })}
    </ol>
  )
}
