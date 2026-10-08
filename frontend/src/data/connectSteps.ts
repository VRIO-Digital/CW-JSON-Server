/**
 * What step 3's two acts say while they run — one message per call the wizard makes:
 * `/sources/preview` then `/sources` for BigQuery, and their Drive twins.
 *
 * **Two acts, two dialogs, one line each.** A single panel listing both rows
 * described work that was not running — "registering the source" sat on screen
 * while preview was still discovering — so each act says only what it is doing.
 *
 * **And it names what it is doing it to.** `{subject}` is interpolated with the id
 * the request is actually made with — the project for BigQuery, the drive for Drive
 * — the way `runtime.headroom.sentence` interpolates `{room}`. "Discovering the
 * datasets" could be any project the account can read; a five-second wait is worth
 * more when it says which one. There is no subject-less variant: step 2 refuses to
 * advance without an id, so a fallback would only mask a regression.
 *
 * Kept beside the panel rather than inside it — for the reason `CONSENT_STAGES` is
 * — so the copy can be asserted, and so the two connectors are visibly the same
 * pair of acts in different units. **Add an entry only when there is a request
 * behind it.**
 */
import { providerBrand } from './providerBrand'

export const CONNECT_ACT_COPY = {
  bigquery: {
    preview: 'Discovering the datasets in project {subject}',
    finish: 'Registering project {subject} with the datasets you checked.',
  },
  gdrive: {
    preview: 'Discovering the folders in drive {subject}',
    finish: 'Registering drive {subject} with the folders you checked.',
  },
} as const

/**
 * The same two acts under a Microsoft-brand dataset, in that vendor's own units — a server holds
 * databases where a project holds datasets, and a library holds folders the way a drive does. The
 * `{subject}` rule is unchanged: it is the id the request is really made with.
 */
export const CONNECT_ACT_COPY_MICROSOFT = {
  bigquery: {
    preview: 'Discovering the databases on server {subject}',
    finish: 'Registering server {subject} with the databases you checked.',
  },
  gdrive: {
    preview: 'Discovering the folders in {subject}',
    finish: 'Registering {subject} with the folders you checked.',
  },
} as const

export type ConnectStepKind = keyof typeof CONNECT_ACT_COPY
export type ConnectAct = keyof (typeof CONNECT_ACT_COPY)['bigquery']

/** The sentence for one act, under the current brand, with the subject interpolated. */
export const connectActCopy = (
  kind: ConnectStepKind,
  act: ConnectAct,
  subject: string,
): string =>
  (providerBrand() === 'microsoft' ? CONNECT_ACT_COPY_MICROSOFT : CONNECT_ACT_COPY)[kind][
    act
  ].replace('{subject}', subject)
