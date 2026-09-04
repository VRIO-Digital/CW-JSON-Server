import type { SourceRow } from '../api/client'

/**
 * Which panel the Catalog has open. `none` is closed; the rest are one per connector's two
 * acts, because each act is a different endpoint.
 */
export type CatalogPanel =
  | 'none'
  | 'browse'
  | 'columns'
  /* BigQuery's third act — see `schemaLabel`. Not a connector-shaped panel: a drive and a mailbox
     have no schema, so nothing else declares it. */
  | 'schema'
  | 'browse-documents'
  | 'documents'
  | 'browse-mail-documents'
  | 'mail-documents'

/**
 * What one connector's catalogue is *called*, in that connector's own units.
 *
 * **This exists because `isDrive ? a : b` does not survive a third connector.** The Catalog
 * described itself with nine of those ternaries — the account tile, the allowlist tile, the two
 * count tiles, both button labels, both panel keys and the list row's meta line — which is the
 * same pair of connector names written into a component nine times over, and exactly what
 * `profilable` was introduced to stop. Mail made every one of them wrong in the same direction:
 * a mailbox is not a Drive, so each `false` branch drew it as a BigQuery project, and a reader
 * would have been told a mailbox had "0 tables profiled" in a "GCP project".
 *
 * So the nouns are declared once per kind and the page reads them. A fourth profilable connector
 * is a row here plus its two panels, and nothing in the page changes.
 */
export interface CatalogUnits {
  /** The account tile: what this source connected *as*. */
  accountLabel: string
  accountNote: string
  /** The allowlist tile. */
  scopeLabel: string
  scopeCount: (s: SourceRow) => number
  /** The profiled-objects tile — the unit a run commits. */
  objectsLabel: string
  objectsCount: (s: SourceRow) => number
  /**
   * The fourth tile. Not always "what profiling produced": Gmail states **today's runs** here
   * instead, which is what its reader asked to see, so the note travels with it rather than
   * being a literal in the page — "for this source" is wrong under a date.
   */
  unitsLabel: string
  unitsCount: (s: SourceRow) => number
  unitsNote: (s: SourceRow) => string
  /** The two acts, in this connector's noun. */
  browseLabel: string
  dictionaryLabel: string
  browsePanel: CatalogPanel
  dictionaryPanel: CatalogPanel
  /**
   * A **third** act, where the connector has one — uploading a schema or a data dictionary.
   *
   * **Optional, and only BigQuery declares it**, because it is the one connector whose catalogue is
   * a schema: a drive holds documents and a mailbox holds mail, and neither has columns a dictionary
   * could describe. A field the whole record does not share is not a required field — the What-if
   * authoring steps' `help` learned that once — so the page draws the button only where both halves
   * are declared, and a connector that has no such act simply keeps its two.
   */
  schemaLabel?: string
  schemaPanel?: CatalogPanel
  /** The one-line summary under a row in the source list. */
  listCount: (s: SourceRow) => string
  /**
   * The sentence below the panels: what has been profiled, or what to do first.
   *
   * A function rather than two strings because it interpolates both counts, and one expression
   * rather than a template assembled in the page for the reason the report copy is: React splits
   * `text {expr} text` into separate nodes, and this line is asserted on as the sentence it
   * renders as.
   */
  foot: (s: SourceRow) => string
}

export const CATALOG_UNITS: Record<string, CatalogUnits> = {
  bigquery: {
    accountLabel: 'project',
    accountNote: 'GCP project',
    scopeLabel: 'datasets allowed',
    scopeCount: (s) => s.datasets.length,
    objectsLabel: 'tables profiled',
    objectsCount: (s) => s.profiledTables,
    unitsLabel: 'columns profiled',
    unitsCount: (s) => s.profiledColumns,
    unitsNote: () => 'for this source',
    browseLabel: 'Browse table for profiling',
    dictionaryLabel: 'View profiled columns',
    browsePanel: 'browse',
    dictionaryPanel: 'columns',
    /* "Upload", because what it takes is a file — and "schema or dictionary", because both are the
       same act here: each states what a column is, and both land in the same dictionary a run
       writes to. */
    schemaLabel: 'Upload schema or dictionary',
    schemaPanel: 'schema',
    listCount: (s) => `${s.profiledTables} tables profiled`,
    foot: (s) =>
      s.profiledTables === 0
        ? 'No profiled tables yet for this source. Browse & profile some tables first, then watch the Profiling jobs tab.'
        : `${s.profiledTables} table(s) and ${s.profiledColumns} column(s) profiled. Re-profile any time from Browse table for profiling.`,
  },
  gdrive: {
    accountLabel: 'drive',
    accountNote: 'Google Drive',
    scopeLabel: 'folders allowed',
    scopeCount: (s) => s.folders.length,
    objectsLabel: 'documents profiled',
    objectsCount: (s) => s.profiledDocuments ?? 0,
    unitsLabel: 'entities extracted',
    unitsCount: (s) => s.profiledEntities ?? 0,
    unitsNote: () => 'for this source',
    browseLabel: 'Browse documents for profiling',
    dictionaryLabel: 'View profiled documents',
    browsePanel: 'browse-documents',
    dictionaryPanel: 'documents',
    listCount: (s) => `${s.profiledDocuments ?? 0} documents profiled`,
    foot: (s) =>
      (s.profiledDocuments ?? 0) === 0
        ? 'No profiled documents yet for this source. Browse & profile some documents first, then watch the Profiling jobs tab.'
        : `${s.profiledDocuments} document(s) and ${s.profiledEntities} entities profiled. Re-profile any time from Browse documents for profiling.`,
  },
  gmail: {
    accountLabel: 'mailbox',
    accountNote: 'Gmail',
    scopeLabel: 'labels allowed',
    scopeCount: (s) => s.labels.length,
    /*
     * **Documents, in the same field Drive uses**, because they are the same unit: a file
     * somebody attached and a file somebody filed are both documents. What the mail profiler
     * runs over is the attachment, never the message — the message is the container it arrived
     * in — so a "messages profiled" tile would name something nothing here counts.
     */
    objectsLabel: 'documents profiled',
    objectsCount: (s) => s.profiledDocuments ?? 0,
    /*
     * **Today's runs, where the other two report their second unit.**
     *
     * Asked for as a tile rather than a line under them, so it takes the fourth slot; entities
     * are still extracted and still reported, by the dictionary, which is where a reader is
     * looking at them. Both the figure and the date are the server's — the count is computed
     * against the server's day, and a tile reading "today" over another box's midnight is a
     * claim nobody can check.
     */
    unitsLabel: 'profiled today',
    unitsCount: (s) => s.profiledToday,
    unitsNote: (s) => s.profiledTodayDate,
    browseLabel: 'Browse documents for profiling',
    dictionaryLabel: 'View profiled documents',
    browsePanel: 'browse-mail-documents',
    dictionaryPanel: 'mail-documents',
    listCount: (s) => `${s.profiledDocuments ?? 0} documents profiled`,
    /* Names the graph rule once, where a reader has just watched a run finish and might
       otherwise expect what it landed to turn up on a canvas. */
    foot: (s) =>
      (s.profiledDocuments ?? 0) === 0
        ? 'No profiled documents yet for this source. Browse & profile some attached documents first, then watch the Profiling jobs tab.'
        : `${s.profiledDocuments} document(s) and ${s.profiledEntities} entities profiled from this mailbox's attachments. Re-profile any time from Browse documents for profiling. These extractions are read at question time and never become graph elements.`,
  },
}

/**
 * The nouns for a kind, or `null` where this build has none.
 *
 * **Null rather than a default, because a default here would misidentify.** Falling back to
 * BigQuery's row would label a mailbox a "GCP project" and count its "tables" — the
 * `ConnectorIcon` mistake, which drew five connectors as BigQuery because a fallback asserted
 * something false. A connector this build cannot describe is left out of the list and counted in
 * the sentence below it, which is the honest answer and the one a stale bundle should give.
 */
export const catalogUnitsFor = (kind: string): CatalogUnits | null =>
  CATALOG_UNITS[kind] ?? null
