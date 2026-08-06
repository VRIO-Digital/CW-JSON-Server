import { CheckCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { Spin } from 'antd'
import {
  CONSENT_SCOPES,
  CONSENT_STAGES,
  type ConsentProvider,
} from '../data/consentStages'
import './GoogleConsentPanel.css'

/**
 * What signing in with Google looks like while it is happening.
 *
 * One row per call the wizard actually makes — `/sources/oauth/start`,
 * `/sources/oauth/callback`, then the discovery twin. Every stage advances when
 * its request returns, never on a timer of its own: the pacing lives on the
 * server (`CONSENT_START_MS`, `CONSENT_MS`, `DISCOVERY_MS`) so this panel
 * reports real progress rather than animating over an answer already in hand.
 *
 * A bare button spinner said only "something is happening"; the scope being
 * granted is the one thing a user should see before an account is connected.
 */
export default function GoogleConsentPanel({
  provider,
  /** Index of the stage in flight. Everything before it has finished. */
  stage,
}: {
  provider: ConsentProvider
  stage: number
}) {
  const stages = CONSENT_STAGES[provider]
  const scope = CONSENT_SCOPES[provider]

  return (
    <div className="cs-consent" role="status" aria-live="polite">
      <div className="cs-consent-title">Signing in with Google…</div>

      <ol className="cs-consent-stages">
        {stages.map((label, i) => {
          const state = i < stage ? 'is-done' : i === stage ? 'is-active' : 'is-waiting'
          return (
            <li key={label} className={`cs-consent-stage ${state}`}>
              <span className="cs-consent-mark" aria-hidden="true">
                {i < stage ? (
                  <CheckCircleFilled />
                ) : i === stage ? (
                  <Spin indicator={<LoadingOutlined spin />} size="small" />
                ) : (
                  <span className="cs-consent-dot" />
                )}
              </span>
              {label}
            </li>
          )
        })}
      </ol>

      {/* The scope is the promise being made, so it is stated, not implied. */}
      <div className="cs-consent-foot">
        Read-only · asks for <code>{scope}</code> · no key file is downloaded or
        stored
      </div>
    </div>
  )
}
