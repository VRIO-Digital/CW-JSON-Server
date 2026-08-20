import { Modal } from 'antd'
import GoogleConsentPanel from './GoogleConsentPanel'
import {
  CONSENT_GRANT_COPY,
  CONSENT_SCOPE_LABEL,
  type ConsentProvider,
} from '../../data/consentStages'
import './GoogleSignInWindow.css'

/**
 * The Google sign-in window: choose an account, then grant the scopes.
 *
 * This is the click-through a real handshake opens in a popup, drawn in-page because there is no
 * Google to redirect to — the mock server issues the state and resolves the callback. What it must
 * not do is *invent* the handshake it is standing in for:
 *
 * - **The scopes are the ones `/sources/oauth/start` returned**, passed in and rendered from that
 *   list. Drive asks for two and BigQuery for one; a window with a copy of the list can describe
 *   fewer permissions than are being requested, which is the one thing a consent screen exists to
 *   prevent. `CONSENT_GRANT_COPY` supplies wording only, and an unmapped scope still renders.
 * - **The account is the browser's**, because the identity here is client-held (CLAUDE.md
 *   § Identity). The window offers the signed-in user and says plainly that it cannot offer
 *   anybody else — an account chooser listing invented people would be a claim about who has
 *   signed in to Google.
 * - **Allow is what makes the request.** Nothing is granted while this is open; the callback and
 *   the discovery call run when the button is pressed, and the stage rows below are the same
 *   `GoogleConsentPanel` the wizard used before — each row advances when its request returns.
 *
 * Split into a panel plus a modal wrapper on purpose: antd renders a `Modal` through a portal that
 * `renderToString` will not traverse, so everything worth asserting lives in `GoogleSignInPanel`.
 */

/** Google's four-colour G, hand-drawn like every other vendor mark here so nothing is fetched. */
function GoogleG({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  )
}

export type SignInPhase = 'account' | 'consent' | 'granting'

export function GoogleSignInPanel({
  provider,
  /** Who the browser says is signed in. Never guessed, never a list of invented accounts. */
  email,
  name,
  initials,
  phase,
  /** The scopes `/sources/oauth/start` reported. Empty only before that call has returned. */
  scopes,
  /** Index of the stage in flight while `phase === 'granting'`. */
  stage,
  onChooseAccount,
  onAllow,
  onCancel,
}: {
  provider: ConsentProvider
  email: string
  name: string
  initials: string
  phase: SignInPhase
  scopes: string[]
  stage: number
  onChooseAccount: () => void
  onAllow: () => void
  onCancel: () => void
}) {
  const app = 'ContextWeave'

  return (
    <div className="gsi">
      <div className="gsi-head">
        <GoogleG size={22} />
        <span className="gsi-head-text">
          {phase === 'account' ? 'Sign in with Google' : `${app} wants access to your Google Account`}
        </span>
      </div>

      {phase === 'account' ? (
        <>
          <div className="gsi-lead">Choose an account to continue to {app}</div>
          <button type="button" className="gsi-account" onClick={onChooseAccount}>
            <span className="gsi-avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="gsi-account-text">
              <span className="gsi-account-name">{name}</span>
              <span className="gsi-account-email">{email}</span>
            </span>
          </button>
          {/*
            No second account, and it says why rather than offering a greyed-out row that looks
            like a feature that failed to load. The console's identity is the browser's own, so
            this window has exactly one account to offer.
          */}
          <div className="gsi-note">
            This is the account signed in to {app}. Signing in as somebody else means signing out
            of {app} first — this window has no directory of its own to offer.
          </div>
        </>
      ) : (
        <>
          <div className="gsi-lead">
            <strong>{email}</strong>
          </div>
          <div className="gsi-grants-lead">
            {app} will be able to:
          </div>
          {/*
            One row per scope the endpoint returned — not per scope this file knows about. The
            count is stated so a reader can see the list is complete.
          */}
          <ul className="gsi-grants">
            {scopes.map((scope) => {
              const copy = CONSENT_GRANT_COPY[scope]
              return (
                <li key={scope} className="gsi-grant">
                  <span className="gsi-grant-mark" aria-hidden="true" />
                  <span>
                    <span className="gsi-grant-title">
                      {copy ? copy.title : CONSENT_SCOPE_LABEL(scope)}
                    </span>
                    <span className="gsi-grant-detail">
                      {copy ? copy.detail : 'Requested by the connector. No plain-English description is mapped for this scope.'}
                    </span>
                    <code className="gsi-grant-scope">{CONSENT_SCOPE_LABEL(scope)}</code>
                  </span>
                </li>
              )
            })}
          </ul>
          {/* One expression, not `{n} permission{s}` around literal text: React splits an
              interpolation into its own text node, so the sentence a reader sees as one string
              cannot be asserted on as one. */}
          <div className="gsi-note">
            {`${scopes.length} permission${scopes.length === 1 ? '' : 's'}, all read-only. ` +
              'Nothing is written, updated or deleted, and no key file is downloaded or stored. ' +
              'You can remove this access from your Google Account at any time.'}
          </div>

          {phase === 'granting' ? (
            <GoogleConsentPanel provider={provider} stage={stage} scopes={scopes} />
          ) : null}
        </>
      )}

      <div className="gsi-actions">
        <button
          type="button"
          className="gsi-btn gsi-btn-text"
          onClick={onCancel}
          disabled={phase === 'granting'}
        >
          Cancel
        </button>
        {phase === 'consent' || phase === 'granting' ? (
          <button
            type="button"
            className="gsi-btn gsi-btn-primary"
            onClick={onAllow}
            disabled={phase === 'granting'}
          >
            {phase === 'granting' ? 'Signing in…' : 'Allow'}
          </button>
        ) : null}
      </div>

      {/*
        Said plainly, and last: this stands in for Google, it is not Google. The login it sits
        behind authenticates by shape, and so does this.
      */}
      <div className="gsi-foot">
        Demo consent screen — it proves the request is well-formed, not that a real Google account
        is behind it.
      </div>
    </div>
  )
}

export default function GoogleSignInWindow({
  open,
  onCancel,
  ...panel
}: {
  open: boolean
  provider: ConsentProvider
  email: string
  name: string
  initials: string
  phase: SignInPhase
  scopes: string[]
  stage: number
  onChooseAccount: () => void
  onAllow: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      width={460}
      centered
      /* The window cannot be dismissed while a request is in flight: closing it would leave the
         callback running with nothing to report back to. */
      maskClosable={panel.phase !== 'granting'}
      closable={panel.phase !== 'granting'}
      destroyOnHidden
      styles={{ body: { padding: 0 } }}
      className="gsi-modal"
    >
      <GoogleSignInPanel {...panel} onCancel={onCancel} />
    </Modal>
  )
}
