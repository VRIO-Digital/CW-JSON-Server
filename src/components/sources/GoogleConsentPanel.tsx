import {
  CONSENT_GRANT_COPY,
  CONSENT_SCOPE_LABEL,
  CONSENT_SCOPES,
  CONSENT_STAGES,
  type ConsentProvider,
} from '../data/consentStages'
import StageList from './StageList'
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
  /**
   * The scopes `/sources/oauth/start` reported. Empty until that first call
   * returns, which is why `CONSENT_SCOPES` is the fallback rather than the
   * source: a panel that lists a scope before the request naming it has come
   * back is guessing, and Drive asks for two, so the guess would be wrong.
   */
  scopes = [],
}: {
  provider: ConsentProvider
  stage: number
  scopes?: string[]
}) {
  const stages = CONSENT_STAGES[provider]
  const asked = scopes.length > 0 ? scopes : [CONSENT_SCOPES[provider]]

  return (
    <div className="cs-consent" role="status" aria-live="polite">
      <div className="cs-consent-title">Signing in with Google…</div>

      {/* The rows are `StageList`'s — step 3's run panel draws the same ones, and
          done/running/not-yet is one interaction, not two. */}
      <StageList stages={stages} stage={stage} />

      {/*
        The scopes are the promise being made, so every one is stated. Listed from
        what the endpoint reported rather than from a per-provider constant: Drive
        asks for two — metadata to list files, readonly so profiling can read one —
        and naming a single scope understated the grant. See docs/REGRESSIONS.md.
      */}
      <ul className="cs-consent-scopes">
        {asked.map((scope) => (
          <li key={scope}>
            <code>{CONSENT_SCOPE_LABEL(scope)}</code>
            {CONSENT_GRANT_COPY[scope] ? ` — ${CONSENT_GRANT_COPY[scope].title}` : null}
          </li>
        ))}
      </ul>

      <div className="cs-consent-foot">
        Read-only{asked.length > 1 ? ` · ${asked.length} scopes` : ''} · no key file
        is downloaded or stored
      </div>
    </div>
  )
}
