import type { SourceRow } from '../api/client'

/**
 * Which panel the Catalog has open. `none` is closed; the rest are one per connector's two
 * acts, because each act is a different endpoint.
 */
export type CatalogPanel =
  | 'none'
  | 'browse'
  | 'columns'
  | 'browse-documents'
  | 'documents'
  /* `browse-mail-documents` was here and is gone with `MailBrowsePanel` — Gmail's first act is a
     run, not a panel, so there is no state for it to be in. See `browsePanel` below. */
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
   * The line under that tile, where a connector has a second figure to put there.
   *
   * Optional, and absent means the tile prints its label alone — Gmail states *"N chunks in
   * total"* under its document count, and BigQuery and Drive have nothing to add. A default of
   * "for this source" here would put a note under two tiles that never asked for one.
   */
  objectsNote?: (s: SourceRow) => string
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
  /**
   * Which panel the first act opens — **`null` where that act is a run rather than a panel**.
   *
   * Gmail is the one: its button is *Process documents* and pressing it processes the whole
   * mailbox, so there is nothing to browse and nothing to hold open. Declared here rather than
   * tested in the page with a connector name, which is the ternary this whole table exists to
   * stop; the page reads the `null` and renders an action instead of a toggle.
   *
   * **A mailbox's selection was never a real choice**, which is why this is the connector that
   * lost one: its labels are settled by the consent, its messages arrive rather than being filed,
   * and its documents are whatever somebody attached. Offering to process a subset of somebody's
   * mail is not a decision the Data Catalog is in a position to put to a reader.
   */
  browsePanel: CatalogPanel | null
  /**
   * Which panel the second act opens — **`null` where there is no second act**.
   *
   * Gmail's is: its documents are listed on the Catalog surface itself, under the run that
   * produced them, so *View profiled documents* was a button opening a second view of what is
   * already on the page. Removed on request. The page withholds the control by there being no
   * panel, never by a connector name.
   */
  dictionaryPanel: CatalogPanel | null
  /*
   * **There is no third act here, and its absence is the design.** Uploading a data dictionary used
   * to be a source-level button beside these two, with a dataset picked from a Select inside the
   * panel — one upload for a source that may hold several datasets, and a control asking which one
   * a moment after the reader had already been looking at the list of them.
   *
   * It is a per-dataset control inside the **browse** panel now, on the dataset row itself, and that
   * is why nothing is declared for it: only the structured browse panel lists datasets, and a drive
   * or a mailbox never reaches it. The act is drawn where the datasets are rather than where a
   * connector name says it may be — which is the same guarantee `schemaLabel`/`schemaPanel` bought,
   * by a shorter route and with no field a connector could half-declare.
   */
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
    /*
     * **The tiles state what has been *chunked*, which is what processing a mailbox does.**
     *
     * Counted over what has been processed rather than over what the mailbox holds — the note
     * beneath them says exactly that, because mail is read on demand and nothing is mirrored, so a
     * tile counting the corpus would report work nothing has done.
     */
    objectsLabel: 'documents chunked',
    objectsCount: (s) => s.documentsChunked ?? 0,
    objectsNote: (s) => `${s.chunksTotal ?? 0} chunks in total`,
    /*
     * **Today's runs, where the other two report their second unit.** Both the figure and the date
     * are the server's: a tile reading "today" over a box in another timezone is a claim the
     * reader cannot check, and the date beside it is what makes it checkable.
     */
    unitsLabel: 'chunked today',
    unitsCount: (s) => s.profiledToday,
    unitsNote: (s) => `since ${s.profiledTodayDate}`,
    browseLabel: 'Process documents',
    /* No second act: the documents are listed on the page itself, under the run that produced
       them, so a button opening a second view of them was opening what is already there. */
    dictionaryLabel: '',
    /* A run, not a panel — see `browsePanel` on the interface above. */
    browsePanel: null,
    /* Removed on request, and withheld the same way. */
    dictionaryPanel: null,
    listCount: (s) => `${s.profiledDocuments ?? 0} documents profiled`,
    /* Names the graph rule once, where a reader has just watched a run finish and might
       otherwise expect what it landed to turn up on a canvas. */
    foot: (s) =>
      (s.profiledDocuments ?? 0) === 0
        ? 'No processed documents yet for this source. Press Process documents to run over every attachment under this mailbox’s labels — the run is narrated here, not on the Profiling jobs board.'
        : `${s.profiledDocuments} document(s) and ${s.profiledEntities} entities processed from this mailbox's attachments. Process documents runs the whole mailbox again any time. These extractions are read at question time and never become graph elements.`,
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
