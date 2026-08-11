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
} as const

export const CONSENT_SCOPES = {
  bigquery: 'bigquery.readonly',
  drive: 'drive.metadata.readonly',
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
}

export type ConsentProvider = keyof typeof CONSENT_STAGES
