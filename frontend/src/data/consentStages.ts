/**
 * The stages of a Google sign-in, one per call the wizard actually makes:
 * `/sources/oauth/start`, `/sources/oauth/callback`, then the connector's
 * discovery twin (`/sources/oauth/projects` or `/sources/oauth/drives`).
 *
 * Kept beside the panel rather than inside it so the labels can be asserted, and
 * so the two connectors are visibly the same list in different units. **Add a
 * stage only when there is a request behind it** — a row that ticks without one
 * claims progress the handshake has not made.
 */
export const CONSENT_STAGES = {
  bigquery: [
    'Opening the Google sign-in',
    'Granting read-only access to BigQuery',
    'Reading the projects this account can see',
  ],
  drive: [
    'Opening the Google sign-in',
    'Granting read-only access to Drive',
    'Reading the drives this account can see',
  ],
  gmail: [
    'Opening the Google sign-in',
    'Granting read-only access to Gmail',
    'Reading the mailbox this account can see',
  ],
} as const

/**
 * A scope URL as it is shown to a reader — the last segment, which is the part that names the
 * permission. Shared by the consent panel and the sign-in window so one cannot abbreviate a scope
 * the other spells out.
 */
export const CONSENT_SCOPE_LABEL = (scope: string): string =>
  scope.replace('https://www.googleapis.com/auth/', '')

/**
 * **What a reader is told when a consent changes who the console is showing.**
 *
 * The sign-in window offers the tenant's directory, so granting a consent as somebody else moves the
 * whole console to them — the sidebar, which pages are listed, what a Library row offers, whose chat
 * history Ask shows. That is not a thing to do silently: it is the same class of act as switching
 * dataset, which this app confirms in words and signs you out for.
 *
 * It names **both** people, for the reason the dataset dialog does: *"now signed in as X"* alone
 * leaves a reader working out what they were before, and the pair is what makes an accidental pick
 * obvious. And it states the remedy, because the persona it lands on may be one with less
 * navigation than the reader started with — `/settings` is routed unconditionally and the sidebar
 * always lists a way out, but "sign out and sign back in" is the sentence that makes that certain.
 *
 * Copy rather than a sentence built where it is printed, for the reason `sourceActions` is: the
 * wizard's own dialog portals out of `renderToString`, so a string written inline cannot be checked.
 */
export const IDENTITY_SWITCH = (from: string, to: string): string =>
  `Signed in as ${to} — this consent was granted by that account, so the console now shows their ` +
  `persona everywhere, not ${from}'s. Sign out and back in to return.`

export const CONSENT_SCOPES = {
  bigquery: 'bigquery.readonly',
  drive: 'drive.metadata.readonly',
  gmail: 'gmail.readonly',
} as const

/**
 * Plain-English copy for a scope, keyed by the scope URL itself.
 *
 * **The consent screen lists the scopes `/sources/oauth/start` returned, not a
 * list kept here** — a screen that says "one permission" while the handshake asks
 * for two is the exact misrepresentation a consent screen exists to prevent.
 * (Drive asks for two.) This map only supplies wording; an unmapped scope still
 * renders, as its bare URL, because showing it unexplained beats not showing it.
 *
 * `check-docs` asserts every scope the server can issue has an entry here.
 */
export const CONSENT_GRANT_COPY: Record<string, { title: string; detail: string }> = {
  'https://www.googleapis.com/auth/bigquery.readonly': {
    title: 'View your data in Google BigQuery',
    detail:
      'Datasets, tables and their schemas. Read-only — nothing is written, updated or deleted.',
  },
  'https://www.googleapis.com/auth/drive.metadata.readonly': {
    title: 'See information about your Google Drive files',
    detail: 'Names, folders, file types and sizes. Not the contents.',
  },
  'https://www.googleapis.com/auth/drive.readonly': {
    title: 'See and download all your Google Drive files',
    detail:
      'Needed to extract text and entities when you profile a document. Read-only — no file is modified.',
  },
  'https://www.googleapis.com/auth/gmail.readonly': {
    title: 'Read your email messages and settings',
    detail:
      'Labels, messages and their attachments. Read-only — ContextWeave can never send, modify or ' +
      'delete mail, and this connector profiles nothing.',
  },
}

export type ConsentProvider = keyof typeof CONSENT_STAGES

/**
 * The browser window this sign-in is pretending to be, as a title and an address.
 *
 * **Asked for: the reference screens are a Chrome popup, not a bare card.** The chrome is most of
 * what makes them read as Google's rather than as a dialog this app drew, so the window carries a
 * title bar and an address bar above the page.
 *
 * **The address is derived from the screen, which is the point of it being here.** A single static
 * URL would sit unchanged while the window moved from the chooser to the consent, which is the one
 * thing a real address bar never does — each of Google's three screens has its own path. It is a
 * pure function so it can be asserted without rendering the window, the reason every other rule in
 * `src/data/` is one.
 *
 * **The opaque token is hashed from the account**, so it is stable across renders rather than
 * re-rolled on every keystroke elsewhere in the wizard — a query string that changed while the
 * reader sat on one screen would be the animated-progress-bar fault in another form. It is
 * deliberately meaningless: it stands in for Google's own state parameter and nothing reads it.
 */
export function signInWindowChrome(
  phase: 'account' | 'confirm' | 'consent' | 'granting',
  app: string,
  email: string,
): { title: string; url: string } {
  let n = 0
  for (let i = 0; i < email.length; i += 1) n = (n * 31 + email.charCodeAt(i)) >>> 0
  const token = String(n).padStart(9, '0').slice(0, 9)

  if (phase === 'account') {
    return {
      title: 'Sign in - Google Accounts - Google Chrome',
      url: 'accounts.google.com/v3/signin/accountchooser?access_type=offline&cli…',
    }
  }
  if (phase === 'confirm') {
    return {
      title: 'Sign in - Google accounts - Google Chrome',
      url: `accounts.google.com/signin/oauth/id?authuser=1&part=AJi8hA${token.slice(0, 6)}…`,
    }
  }
  return {
    title: `${app} wants to access your Google Account - Google Ch…`,
    url: `accounts.google.com/signin/oauth/consent?as=S${token}%3A178999…`,
  }
}

/**
 * The colour Google tints an account's initial with.
 *
 * **Per account, not per position.** A hue keyed to the row index would move when the list
 * reordered — and this window's list does change length, since the reader's own row joins the two
 * declared accounts only when they are neither. A colour that shifted under a reader is worse than
 * one colour for everybody.
 *
 * The palette is Google's own account tints. Pure and here rather than in the component for the
 * reason every other rule in `src/data/` is: it can be asserted without rendering the window.
 */
const AVATAR_TINTS = ['#e8710a', '#5f6368', '#1a73e8', '#188038', '#a142f4', '#d93025']

export function avatarTint(email: string): string {
  /*
   * **Hashed on the local part, not the whole address.** Every account in this tenant ends
   * `@vriodigital.com`, and both a multiply-by-31 and an FNV-1a over the full string are dominated
   * by that shared tail — the two accounts the chooser always shows came out the same colour, which
   * is the one pair this has to separate. The part before the `@` is the part that differs.
   *
   * It is still a hash over a small palette, so a collision between *some* pair is possible; what
   * it guarantees is a stable colour per address, not a unique one. The row is identified by its
   * name and address, and the tint only helps the eye find it again.
   */
  const local = email.split('@')[0]
  let h = 0x811c9dc5
  for (let i = 0; i < local.length; i += 1) {
    h ^= local.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}
