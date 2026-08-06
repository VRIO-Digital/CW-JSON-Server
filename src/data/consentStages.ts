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

export type ConsentProvider = keyof typeof CONSENT_STAGES
