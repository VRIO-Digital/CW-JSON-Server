import { Modal } from 'antd'
import type { GoogleSignInAccount } from '../../api/client'
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
 * - **The accounts are the ones `/sources/oauth/start` returned**, for the same reason the scopes
 *   are. It offered exactly one — the browser's own — and said it had no directory to offer; it has
 *   one, `db.settings.users`, which is this app's single answer to who exists. **The objection the
 *   single row was protecting against is unchanged and still met**: an account chooser listing
 *   *invented* people would be a claim about who has signed in to Google, and nobody here is
 *   invented. It is the same pool `/sources/oauth/mailboxes` refuses an unknown address against, so
 *   a row on this screen can never be one the handshake would then turn down.
 * - **The row a reader picks is what the connection is made as.** The identity is still client-held
 *   (CLAUDE.md § Identity) — the server has nothing to look it up from — so the chooser is where the
 *   client says which account, and the signed-in one is only the default. Which row that is is
 *   marked, because a list of colleagues with nothing distinguishing the reader's own is a chooser
 *   that invites the wrong pick.
 * - **There is no *Use another account*.** Google's chooser ends in one; this window cannot create
 *   an account, and a row that opens nothing is worse than no row — the rule every withheld control
 *   here follows. The note says where the list comes from instead.
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
  /** The accounts `/sources/oauth/start` reported. Rendered as returned, never filtered here. */
  accounts,
  /** Which of them is the console's own, so the chooser can mark it. */
  signedInEmail,
  /** The row picked. `null` until one is, which is the account phase. */
  chosen,
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
  accounts: GoogleSignInAccount[]
  signedInEmail: string
  chosen: GoogleSignInAccount | null
  phase: SignInPhase
  scopes: string[]
  stage: number
  onChooseAccount: (email: string) => void
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
          {/*
            One row per account the endpoint returned, in the order it returned them — the reader's
            own marked rather than moved, because a list that reorders itself per reader is a
            different list for each of them, and the mark is what actually answers "which one is
            me". A row is the whole act: picking is signing in as that account, so there is no OK
            to press afterwards, exactly as ticking a connector card in the Ask picker is the act.
          */}
          <ul className="gsi-accounts">
            {accounts.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  className="gsi-account"
                  onClick={() => onChooseAccount(account.email)}
                >
                  <span className="gsi-avatar" aria-hidden="true">
                    {account.initials}
                  </span>
                  <span className="gsi-account-text">
                    <span className="gsi-account-name">{account.name}</span>
                    <span className="gsi-account-email">{account.email}</span>
                  </span>
                  {account.email === signedInEmail ? (
                    /* One expression, never `signed in to {app}`: React splits an interpolation
                        into its own text node, so a sentence a reader sees as one string cannot be
                        asserted on as one — the rule the permission-count note below already keeps. */
                    <span className="gsi-account-mine">{`signed in to ${app}`}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {/*
            The policy line a real consent screen carries under its account list. There is
            deliberately no *Use another account* row: this window cannot create one, and a control
            that opens nothing is worse than an absent one — the rule every withheld act in this
            repo keeps. The two phrases are marked rather than linked for the same reason: this app
            publishes no policy page, so an anchor here could only go nowhere.
          */}
          <div className="gsi-note">
            {`Before using this app, you can review ${app}'s `}
            <span className="gsi-note-mark">Privacy Policy</span>
            {' and '}
            <span className="gsi-note-mark">Terms of Service</span>
            {'.'}
          </div>
        </>
      ) : (
        <>
          <div className="gsi-lead">
            <strong>{chosen?.email ?? ''}</strong>
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
  accounts: GoogleSignInAccount[]
  signedInEmail: string
  chosen: GoogleSignInAccount | null
  phase: SignInPhase
  scopes: string[]
  stage: number
  onChooseAccount: (email: string) => void
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
