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
