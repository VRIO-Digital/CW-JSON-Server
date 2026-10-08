import { Modal } from 'antd'
import { useState } from 'react'
import type { GoogleSignInAccount } from '../../api/client'
import ConnectorIcon from '../common/ConnectorIcon'
import {
  CONSENT_GRANT_COPY,
  CONSENT_SCOPE_LABEL,
  MICROSOFT_CONSENT,
  MICROSOFT_SIGN_IN,
  avatarTint,
  signInWindowChrome,
  signInWindowCopy,
  type ConsentProvider,
} from '../../data/consentStages'
import { providerBrand } from '../../data/providerBrand'
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

/** Microsoft's four squares, hand-drawn like every other vendor mark here so nothing is fetched. */
function MicrosoftLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 23 23" aria-hidden="true">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  )
}

/**
 * The vendor's own mark, by brand — the Google G everywhere but a Microsoft-brand dataset, whose
 * sign-in this window then stands in for with Microsoft's squares. One component, because the
 * handshake is the same four phases whoever the vendor is; the brand owns the marks and the words.
 */
function VendorLogo({ size = 20 }: { size?: number }) {
  return providerBrand() === 'microsoft' ? (
    <MicrosoftLogo size={size} />
  ) : (
    <GoogleG size={size} />
  )
}

/**
 * The blue glyph against each grant on Microsoft's consent, picked by the scope itself — a person
 * for the profile, an envelope for mail, a folder for files, a padlock for maintained access — so
 * a reader sees what is being opened up before reading the sentence, exactly what the Google
 * screen's product marks do. An unmapped scope gets the neutral key rather than another scope's
 * glyph, the `ConnectorIcon` rule.
 */
function MsGrantIcon({ scope }: { scope: string }) {
  const c = '#0078d4'
  const frame = { width: 22, height: 22, viewBox: '0 0 24 24' }
  if (scope.includes('User.Read')) {
    return (
      <svg {...frame} aria-hidden="true">
        <circle cx="12" cy="8" r="3.6" fill={c} />
        <path d="M4.8 19.4c.8-3.6 3.8-5.6 7.2-5.6s6.4 2 7.2 5.6z" fill={c} />
      </svg>
    )
  }
  if (scope.includes('Mail.Read')) {
    return (
      <svg {...frame} aria-hidden="true">
        <rect x="3" y="5.5" width="18" height="13" rx="1.6" fill={c} />
        <path d="M4 7l8 6 8-6" fill="none" stroke="#fff" strokeWidth="1.6" />
      </svg>
    )
  }
  if (scope.includes('Files.Read')) {
    return (
      <svg {...frame} aria-hidden="true">
        <path d="M3 6.2c0-.7.5-1.2 1.2-1.2h5l2 2.2h8.6c.7 0 1.2.5 1.2 1.2v9.4c0 .7-.5 1.2-1.2 1.2H4.2c-.7 0-1.2-.5-1.2-1.2z" fill={c} />
      </svg>
    )
  }
  if (scope.includes('Sites.Read')) {
    return (
      <svg {...frame} aria-hidden="true">
        <circle cx="12" cy="12" r="8.6" fill="none" stroke={c} strokeWidth="1.8" />
        <path d="M3.5 12h17M12 3.5c-5.6 5.4-5.6 11.6 0 17 5.6-5.4 5.6-11.6 0-17z" fill="none" stroke={c} strokeWidth="1.5" />
      </svg>
    )
  }
  if (scope.includes('database.windows.net')) {
    return (
      <svg {...frame} aria-hidden="true">
        <ellipse cx="12" cy="6.4" rx="7" ry="2.8" fill={c} />
        <path d="M5 6.4v11.2c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6.4c0 1.6-3.1 2.8-7 2.8s-7-1.2-7-2.8z" fill={c} opacity="0.85" />
      </svg>
    )
  }
  if (scope === 'offline_access') {
    return (
      <svg {...frame} aria-hidden="true">
        <rect x="5.5" y="10.5" width="13" height="9" rx="1.6" fill={c} />
        <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" fill="none" stroke={c} strokeWidth="1.8" />
      </svg>
    )
  }
  return (
    <svg {...frame} aria-hidden="true">
      <circle cx="9" cy="12" r="3.6" fill="none" stroke={c} strokeWidth="1.8" />
      <path d="M12.5 12h7M17 12v3" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** The app's round mark on Microsoft's consent, as the reference draws it — a badge, not a photo. */
function AppBadge({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="16.5" fill="#fff" stroke="#0067b8" strokeWidth="2.4" />
      <path
        d="M24.5 13.4a7.4 7.4 0 1 0 .4 8.6"
        fill="none"
        stroke="#0067b8"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="25.4" cy="17.4" r="1.7" fill="#0067b8" />
    </svg>
  )
}

/** The verified tick beside the publisher's domain. */
function VerifiedCheck({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#0078d4" />
      <path d="M7 12.4l3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The squares with the wordmark beside them, as Microsoft's own sign-in card draws them. */
function MicrosoftWordmark({ size = 21 }: { size?: number }) {
  return (
    <span className="msi-wordmark">
      <MicrosoftLogo size={size} />
      <span className="msi-wordmark-text">Microsoft</span>
    </span>
  )
}

/**
 * The initials an address wears where the directory has no row for it — the Microsoft screens
 * accept a typed address, so the consent screen may be granting for somebody the served account
 * list does not carry. Derived the way the login's own `emailInitials` derives them.
 */
function initialsFromEmail(email: string): string {
  const parts = email.split('@')[0].split(/[._-]+/).filter(Boolean)
  const letters = parts.length >= 2 ? [parts[0][0], parts[1][0]] : [email[0] ?? '', email[1] ?? '']
  return letters.join('').toUpperCase()
}

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

/**
 * The four screens a real handshake shows, in order.
 *
 * `confirm` is the *"You're signing back in to …"* step between picking an account and seeing the
 * grants — Google's own second screen, which this window skipped. It asks nothing new; it states
 * who is about to be signed in and offers the way out, which is why its affirmative button is
 * **Continue** and not Allow: nothing is granted there.
 */
export type SignInPhase = 'account' | 'confirm' | 'consent' | 'granting'

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
  /*
    `stage` was the index this window drew a tick against. It still travels — the wizard tracks it
    and the prop is still part of the contract — but nothing here renders it now that the stage list
    is gone. Kept on the type rather than dropped, so restoring the panel is one JSX block and not a
    change to every call site.
  */
  onChooseAccount,
  onContinue,
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
  /** Leaves the confirm screen for the grants. Grants nothing. */
  onContinue: () => void
  onAllow: () => void
  onCancel: () => void
}) {
  const app = 'ContextWeave'

  /* The vendor's words — Google's or Microsoft's, by the selected dataset's brand. */
  const copy = signInWindowCopy()
  const isMicrosoft = providerBrand() === 'microsoft'
  const MS = MICROSOFT_SIGN_IN
  const MSC = MICROSOFT_CONSENT

  /*
   * **The Microsoft screen's own state, and it never leaves this component until Next.**
   *
   * Microsoft's sign-in asks you to *type* an address where Google's offers a chooser, so the typed
   * email is local until Next hands it to `onChooseAccount` — the same act a Google row's click is.
   * There is deliberately no password state: the *Enter your password* screen was removed on
   * request (see `MICROSOFT_SIGN_IN`), so Next goes straight to the permissions screen, where the
   * grant was always made.
   */
  const [typedEmail, setTypedEmail] = useState('')
  const [emailError, setEmailError] = useState(false)

  /* The address this handshake is for — the picked row's, or the one typed on the email screen
     (which the served list may not carry, so the pill and the grant row fall back to it). */
  const activeEmail = chosen?.email ?? typedEmail.trim()
  const activeInitials = chosen?.initials ?? initialsFromEmail(activeEmail)

  function submitTypedEmail() {
    const address = typedEmail.trim()
    /* Microsoft's own loose shape check — enough to refuse an empty box or a bare word. */
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setEmailError(true)
      return
    }
    setEmailError(false)
    onChooseAccount(address)
  }

  const chromeBar = signInWindowChrome(phase, app, activeEmail || signedInEmail)

  return (
    <div className="gsi">
      {/*
        **The browser window this stands in for.** The reference screens are a Chrome popup, and the
        title bar and address bar are most of what makes them read as Google's rather than as a
        dialog this app drew. The address changes per screen — `signInWindowChrome` derives it —
        because an address bar that sat unchanged from the chooser through to the consent is the one
        thing a real one never does.

        The minimise and maximise marks are decoration and say so; **the close is real** and is the
        same act as Cancel, because a window control that does nothing is worse than none — the rule
        every withheld control here follows. It is withheld while a request is in flight, for the
        reason the modal's own close was: shutting the window mid-call leaves the callback running
        with nothing to report back to.
      */}
      <div className="gsi-chrome">
        <div className="gsi-chrome-title">
          <VendorLogo size={13} />
          <span className="gsi-chrome-text">{chromeBar.title}</span>
          <span className="gsi-chrome-controls">
            <span aria-hidden="true">&#8211;</span>
            <span aria-hidden="true">&#9633;</span>
            <button
              type="button"
              className="gsi-chrome-close"
              aria-label={copy.closeAria}
              onClick={onCancel}
              disabled={phase === 'granting'}
            >
              &#10005;
            </button>
          </span>
        </div>
        <div className="gsi-chrome-address">
          {/* Chrome's site-information button. Decoration: this window has no site to inspect. */}
          <span className="gsi-chrome-site" aria-hidden="true">&#9737;</span>
          <span className="gsi-chrome-url">{chromeBar.url}</span>
        </div>
      </div>

      {/* Microsoft's screens carry the wordmark inside the card, top-left, so the shared header
          bar is theirs to skip on every phase. */}
      {isMicrosoft ? null : (
        <div className="gsi-head">
          <VendorLogo size={22} />
          {/* The vendor's top bar says the same thing on both screens — it names the mechanism, not
              the step. The app-specific sentence is the *heading* below it, which is where a real
              consent screen puts it. Google writes a sentence here; Microsoft its wordmark. */}
          <span className="gsi-head-text">{copy.headText}</span>
        </div>
      )}

      {isMicrosoft && phase === 'account' ? (
        <>
          {/*
            **Microsoft's Sign in screen, as the reference screenshots draw it.** An email box
            rather than an account chooser — Microsoft's login asks you to type — so the act here
            is Next with a well-formed address, which is exactly what a Google row's click is:
            `onChooseAccount` with the address this handshake will be made as. The two phrases that
            are links on the real screen are marked text, because this window opens nothing.
          */}
          <div className="msi">
            <MicrosoftWordmark />
            <div className="msi-title">{MS.title}</div>
            <input
              className={`msi-email${emailError ? ' is-error' : ''}`}
              type="email"
              value={typedEmail}
              placeholder={MS.emailPlaceholder}
              aria-label={MS.emailPlaceholder}
              autoFocus
              onChange={(e) => {
                setTypedEmail(e.target.value)
                setEmailError(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitTypedEmail()
              }}
            />
            {emailError ? <div className="msi-error">{MS.invalidEmail}</div> : null}
            {/*
              One line of links, not two, and no *Sign-in options* strip below the card — the
              *Can't access your account?* row and the strip were **removed on request**, together
              with the *Enter your password* screen this Next used to lead to: it goes straight to
              the permissions screen now. Do not restore any of the three without being asked.
            */}
            <div className="msi-links">
              <span className="msi-muted">{MS.noAccount}</span>{' '}
              <span className="msi-link">{MS.createOne}</span>
            </div>
            <div className="msi-next-row">
              <button type="button" className="msi-btn" onClick={submitTypedEmail}>
                {MS.next}
              </button>
            </div>
          </div>
        </>
      ) : phase === 'account' ? (
        <>
          {/*
            Google's own arrangement, which the one-line lead did not have: the act is a *heading*
            and the destination is a second line under it, with the app name picked out the way a
            real consent screen picks out the site asking. Two elements rather than one sentence,
            because that is the hierarchy a reader recognises — the question first, then who is
            asking.
          */}
          <div className="gsi-title">{copy.chooserTitle}</div>
          <div className="gsi-lead">
            to continue to <span className="gsi-app">{app}</span>
          </div>
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
                  <span
                    className="gsi-avatar"
                    aria-hidden="true"
                    /* Keyed to the address, so a row keeps its colour whatever the list length. */
                    style={{ background: avatarTint(account.email) }}
                  >
                    {account.initials}
                  </span>
                  <span className="gsi-account-text">
                    <span className="gsi-account-name">{account.name}</span>
                    <span className="gsi-account-email">{account.email}</span>
                    {/*
                      **The "signed in to …" mark is gone — removed on request.** It sat beside the
                      name, then under the address, and is now absent: Google's own chooser marks no
                      row either.

                      **What that costs is stated rather than glossed.** Nothing on this screen now
                      says which of the accounts is the browser's own, so a reader has to recognise
                      their address. The rule it was protecting is untouched and was never carried
                      by the mark: the list is **not reordered** per reader — a chooser that sorted
                      itself would be a different list for each of them — and `signedInEmail` is
                      still what the window is told, so restoring the mark is one element.
                    */}
                  </span>
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
      ) : phase === 'confirm' ? (
        <>
          {/*
            **Google's second screen, which this window used to skip.** Picking a row jumped
            straight to the grants; a real handshake stops here first to say who is being signed in.
            It grants nothing — the scopes are on the next screen — so the button is *Continue*, and
            Cancel is still a full way out.

            The account sits in a rounded pill with a caret, as Google draws it. The caret is
            decoration: this window has one account picked and changing it is Cancel, so a control
            that reopened the chooser would be a second way to do one thing.
          */}
          <div className="gsi-title">
            {`You're signing back in to ${app}`}
          </div>

          <div className="gsi-pill">
            <span
              className="gsi-avatar"
              aria-hidden="true"
              style={{ background: avatarTint(chosen?.email ?? '') }}
            >
              {chosen?.initials ?? ''}
            </span>
            <span className="gsi-pill-email">{chosen?.email ?? ''}</span>
            <span className="gsi-pill-caret" aria-hidden="true">&#9662;</span>
          </div>

          <p className="gsi-trust-note">
            {`Review ${app}'s privacy policy and Terms of Service to understand how ${app} will process and protect your data.`}
          </p>
          <p className="gsi-trust-note">
            {'To make changes at any time, go to your '}
            <span className="gsi-note-mark">{copy.accountNoun}</span>
            {'.'}
          </p>
          <p className="gsi-trust-note">
            {'Learn more about '}
            <span className="gsi-note-mark">{copy.signInName}</span>
            {'.'}
          </p>
        </>
      ) : isMicrosoft ? (
        <>
          {/*
            **Microsoft's consent, as the reference screenshot draws it** — *Let this app access
            your info?* over the app's badge and verified domain, then *This app would like to:*
            with a blue glyph per grant. It replaced the Google-shaped consent wearing Microsoft
            words, on request. The rows are still exactly the scopes `/sources/oauth/start`
            returned — `CONSENT_GRANT_COPY` supplies wording only, and an unmapped scope still
            renders — and Accept is still the one act that spends the consent. The marked phrases
            open nothing, like every policy phrase in this window.
          */}
          <div className="msi msi-consent">
            <MicrosoftWordmark />
            <div className="msi-title">{MSC.title}</div>

            <div className="msi-app-row">
              <AppBadge />
              <span className="msi-app-id">
                <span className="msi-app-name">{MSC.appName}</span>
                <span className="msi-app-domain">
                  {MSC.appDomain} <VerifiedCheck />
                </span>
              </span>
            </div>

            <div className="msi-grants-lead">{MSC.lead}</div>
            <ul className="msi-grants">
              {scopes.map((scope) => {
                const grant = CONSENT_GRANT_COPY[scope]
                return (
                  <li key={scope} className="msi-grant">
                    <span className="msi-grant-icon" aria-hidden="true">
                      <MsGrantIcon scope={scope} />
                    </span>
                    <span className="msi-grant-body">
                      <span className="msi-grant-title">
                        {grant ? grant.title : CONSENT_SCOPE_LABEL(scope)}
                      </span>
                      <span className="msi-grant-detail">
                        {grant
                          ? grant.detail
                          : 'Requested by the connector. No plain-English description is mapped for this scope.'}
                      </span>
                    </span>
                    {/* The reference's caret. Decoration: nothing here expands, so it is
                        aria-hidden rather than a control that does nothing. */}
                    <span className="msi-grant-caret" aria-hidden="true">
                      &#8964;
                    </span>
                  </li>
                )
              })}
            </ul>

            <p className="msi-consent-foot">
              {MSC.footAccepting}
              <span className="msi-link">{MSC.footPrivacy}</span>
              {MSC.footChange}
              <span className="msi-link">{MSC.footAccount}</span>
              {'.'}
            </p>
            <p className="msi-consent-foot">
              <span className="msi-link">{MSC.footLearn}</span>
            </p>

            {/* Microsoft's own pair, right-aligned — Cancel grants nothing, Accept spends the
                consent, and neither can be pressed twice while the calls run. */}
            <div className="msi-consent-actions">
              <button
                type="button"
                className="msi-btn msi-btn-outline"
                onClick={onCancel}
                disabled={phase === 'granting'}
              >
                {MSC.cancel}
              </button>
              <button
                type="button"
                className="msi-btn"
                onClick={onAllow}
                disabled={phase === 'granting'}
              >
                {phase === 'granting' ? MSC.accepting : MSC.accept}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {/*
            Google's own hierarchy: the asking site in blue at heading size, the account it would be
            granted for beneath it, then the grants. The mock had the address alone in bold and the
            sentence folded into the top bar, which is two levels flatter than the screen it stands
            in for.
          */}
          <div className="gsi-title">
            <span className="gsi-app">{app}</span> {copy.consentTitleTail}
          </div>

          <div className="gsi-who">
            {/* The picked row's, or the address typed on the Microsoft email screen — a typed
                address may be one the served account list does not carry. */}
            <span
              className="gsi-avatar"
              aria-hidden="true"
              style={{ background: avatarTint(activeEmail) }}
            >
              {activeInitials}
            </span>
            <span className="gsi-who-email">{activeEmail}</span>
          </div>

          <div className="gsi-grants-lead">
            This will allow <span className="gsi-app">{app}</span> to:
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
                  {/* The product's own mark, as Google draws it — reused from `ConnectorIcon` so
                      this window cannot come to show a different Drive logo from the rest of the
                      app. `drive` is the consent's word and `gdrive` is the connector key. */}
                  <span className="gsi-grant-mark" aria-hidden="true">
                    <ConnectorIcon
                      connector={provider === 'drive' ? 'gdrive' : provider}
                      size={18}
                    />
                  </span>
                  <span className="gsi-grant-body">
                    <span className="gsi-grant-title">
                      {copy ? copy.title : CONSENT_SCOPE_LABEL(scope)}
                    </span>
                    <span className="gsi-grant-detail">
                      {copy ? copy.detail : 'Requested by the connector. No plain-English description is mapped for this scope.'}
                    </span>
                    <code className="gsi-grant-scope">{CONSENT_SCOPE_LABEL(scope)}</code>
                  </span>
                  {/* Google's ⓘ sits at the end of every grant row. Decoration here — it opens
                      nothing, so it is `aria-hidden` rather than a button that does nothing. */}
                  <span className="gsi-grant-info" aria-hidden="true">
                    &#9432;
                  </span>
                </li>
              )
            })}
          </ul>
          {/*
            **The note under the scopes is gone — removed on request.** It read *"N permissions,
            all read-only. Nothing is written, updated or deleted, and no key file is downloaded or
            stored. You can remove this access from your Google Account at any time."*

            **What it said is still on the screen, per scope rather than summarised.** Each row
            above states its own grant in plain English and prints the scope it is asking for —
            `bigquery.readonly` — which is the falsifiable form of "all read-only": a reader can
            see the `.readonly` on every line rather than take a footer's word for the set. The
            count it stated is likewise visible as the length of the list it stood under.

            **The rule it described is untouched and is not carried by this copy.** The scopes are
            the ones `/sources/oauth/start` returned, never a list held here, which is what stops
            this window describing fewer permissions than are being asked for.
          */}

          {/*
            **Google's own trust block, which the mock did not have.** A real consent screen does
            not end at the scope list: it names the site being trusted, then says where the policies
            are and how to withdraw. Restored here to match the screen this window stands in for.

            **It is not the note that was removed.** That one was *ContextWeave's* claim about its
            own behaviour — *"Nothing is written, updated or deleted…"* — and it is still gone. This
            is Google's boilerplate about a grant, and it names no behaviour of this app.

            The policy phrases are marked rather than linked, the same as on the chooser: this app
            publishes no policy page, and a blue underline that goes nowhere is the control-with-no-
            destination refused everywhere else here.
          */}
          <div className="gsi-trust-head">Make sure that you trust {app}</div>

          <div className="gsi-trust-box">
            <span className="gsi-trust-icon" aria-hidden="true">&#9432;</span>
            <span>
              {`Learn why you're not seeing links to ${app}'s Privacy Policy or Terms of Service`}
            </span>
          </div>

          <p className="gsi-trust-note">
            {`Review ${app}'s `}
            <span className="gsi-note-mark">Privacy Policy</span>
            {' and '}
            <span className="gsi-note-mark">Terms of Service</span>
            {` to understand how ${app} will process and protect your data.`}
          </p>
          <p className="gsi-trust-note">
            {'To make changes at any time, go to your '}
            <span className="gsi-note-mark">{copy.accountNoun}</span>
            {'.'}
          </p>

          {/*
            **The stage list is gone from this window — removed on request.** Pressing Allow used to
            draw *"Signing in with Google…"* with a tick per call (*Opening the Google sign-in*,
            *Granting read-only access to BigQuery*, *Reading the projects this account can see*).
            A real consent screen shows none of that; it just goes.

            **The feedback it gave is not lost.** The button itself is the busy state — it reads
            *Signing in…* and is disabled while the calls run, so the window still says something is
            happening and Allow cannot be pressed twice.

            **The pacing and the rule behind it are untouched.** The three calls still run from this
            button and each still advances when its own request returns — `stage` is still tracked
            in the wizard and still passed in. What changed is only that this window no longer draws
            it. `GoogleConsentPanel` keeps its `StageList` rows and is left with no caller here, the
            waiting-for-a-caller state `/change-signals` is in. **Do not restore it without being
            asked.**
          */}
        </>
      )}

      {/*
        **No buttons on the chooser**, which is Google's own arrangement: picking a row *is* the
        act, so there is nothing to confirm, and the way out is the window's close. A lone Cancel
        stretched across the foot of that screen implied the reader had a decision pending when the
        only decision is which row to press.
      */}
      {/* The Microsoft screens draw their own buttons — Next on the email screen, Cancel/Accept
          on the consent — so the shared footer is theirs to skip on every phase. Microsoft's
          `confirm` phase is unreachable: the password screen that lived there was removed on
          request. */}
      {isMicrosoft ? null : (
        <div className={`gsi-actions${phase === 'account' ? ' is-empty' : ''}`}>
          {phase === 'account' ? null : (
            <button
              type="button"
              className="gsi-btn gsi-btn-text"
              onClick={onCancel}
              disabled={phase === 'granting'}
            >
              Cancel
            </button>
          )}
          {/* **Continue on the confirm screen, Allow on the grants** — the words are not
              interchangeable: one moves to the next screen and the other spends the consent. */}
          {phase === 'confirm' ? (
            <button type="button" className="gsi-btn gsi-btn-primary" onClick={onContinue}>
              Continue
            </button>
          ) : phase === 'consent' || phase === 'granting' ? (
            <button
              type="button"
              className="gsi-btn gsi-btn-primary"
              onClick={onAllow}
              disabled={phase === 'granting'}
            >
              {phase === 'granting' ? 'Signing in…' : copy.allowLabel}
            </button>
          ) : null}
        </div>
      )}

      {/*
        The footer every Google screen carries. Static, and marked rather than linked for the
        reason the policy phrases above are: this window opens nothing, and a blue underline that
        goes nowhere is the control-with-no-destination refused everywhere else here.
      */}
      <div className="gsi-foot-bar">
        <span>{copy.footLeft}</span>
        <span className="gsi-foot-links">
          {copy.footLinks.map((link) => (
            <span key={link}>{link}</span>
          ))}
        </span>
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
  onContinue: () => void
  onAllow: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      /* A browser popup's proportions rather than a dialog's: narrow and tall, which is what the
         reference screens are. The height comes from `.gsi`'s own minimum. */
      width={440}
      centered
      /* The window cannot be dismissed while a request is in flight: closing it would leave the
         callback running with nothing to report back to. */
      maskClosable={panel.phase !== 'granting'}
      /* The window draws its own close in its title bar, so antd's would be a second one in the
         corner of a window that already has three controls. */
      closable={false}
      destroyOnHidden
      styles={{
        body: { padding: 0 },
        /*
          **A real scrim over the whole page.** A consent window is modal in the strong sense — the
          wizard behind it is mid-handshake and nothing there may be touched — and antd's default
          wash left the app legible enough to read through, so the window read as a card sitting on
          the page rather than as something in front of it. `position: fixed` with the four insets
          is what makes it the *page's* backdrop rather than the scroll container's, which is the
          same correction the What-if lens's own overlay needed.
        */
        mask: {
          position: 'fixed',
          inset: 0,
          background: 'rgba(32, 33, 36, 0.6)',
        },
        /* The chrome bars run to the edge, so the corners have to clip or the grey title bar
           squares off the rounded window. `container` is antd v6's name for the panel — v5 called
           it `content`, which type-checks as an unknown key and silently styles nothing. */
        container: { padding: 0, overflow: 'hidden', borderRadius: 10 },
      }}
      className="gsi-modal"
    >
      <GoogleSignInPanel {...panel} onCancel={onCancel} />
    </Modal>
  )
}
