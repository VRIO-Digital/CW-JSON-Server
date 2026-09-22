import type { SourceRow } from '../api/client'
import { mailProcessCopy } from './mailProcess'

/**
 * The date a reader recognises, not the raw stamp the server sends — the same rendering
 * `ProfiledMailDocumentsPanel`'s own `shortDate` gives a document's date, kept a second small
 * copy here rather than imported: that one takes a full ISO instant and a component import
 * from a data module would run the wrong way, so a one-line formatter is the cheaper coupling.
 */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The "last chunk" tile's value and note, shared by Drive and Gmail rather than written twice —
 * a second copy is how the two connectors' tiles come to word one fact differently.
 *
 * **`lastChunkAt` absent is not "no data", it is "nothing recent"**, per the server's own gate:
 * `chunksTotal` still counts a chunk from eight months ago, so a reader who wants to know
 * whether anything is being kept current needs the two questions kept apart.
 */
const lastChunkValue = (s: SourceRow) =>
  s.lastChunkAt && s.lastChunkCount !== null
    ? `${s.lastChunkCount} chunk${s.lastChunkCount === 1 ? '' : 's'}`
    : '—'
const lastChunkNote = (s: SourceRow) =>
  s.lastChunkAt ? `chunked ${shortDate(s.lastChunkAt)}` : `nothing chunked since ${shortDate(s.lastChunkSince)}`

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
  /**
   * The allowlist tile, **where the connector has an allowlist worth stating**.
   *
   * Optional and grouped, for the reason `extraTile` is: a label with no count is a tile with
   * nothing in it, so absent is the only other state. Declared here rather than tested in the
   * page, which is the connector-name ternary this whole table exists to stop — the page draws
   * the tile it is given and no column where it is given none.
   *
   * **Gmail declares none, on request.** Its labels are not an allowlist a reader assembled: they
   * are settled by the consent, the wizard offers no picker, and the run covers the whole mailbox
   * whatever they are — so *labels allowed · 3 · in the allowlist* described a scope nobody chose
   * and nothing narrows. BigQuery's datasets and Drive's folders are the opposite: both are ticked
   * by hand in the connect wizard and both really do bound what a run reaches.
   */
  scopeTile?: {
    label: string
    count: (s: SourceRow) => number
    note: string
  }
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
  /**
   * A fifth tile, where a connector has a fifth thing to say. Absent for BigQuery and Drive.
   *
   * **One optional object rather than four optional fields**, because the four only ever mean
   * anything together: a `label` with no `value` is a tile with nothing in it, and four
   * independently-optional fields make three-quarters of a tile expressible. Absent is the only
   * other state.
   *
   * **`suffix` is why this is not just another `unitsLabel`.** The strip sets a figure large and
   * its unit small beside it — `79k` then `chars` — which the other four tiles do not need
   * because their unit is in the label (*documents chunked*, *labels allowed*). Here the label is
   * the measure (*chunk size*) and the unit belongs to the number.
   */
  extraTile?: {
    label: string
    value: (s: SourceRow) => string
    /** Set small beside the figure. Absent prints the value alone. */
    suffix?: string
    note: string
  }
  /**
   * A sixth tile: the most recent chunk within a rolling six-month window — `lastChunkAt` on
   * the server, gated there rather than here so a page reading this cannot disagree with a
   * dictionary reading the same field about where "recent" starts.
   *
   * **Declared for Drive and Gmail, both** — the two connectors `chunksTotal` already covers,
   * since a rolling window is the same fact about either one: is anything of this source's own
   * recent, or has nothing landed lately. BigQuery has no chunks at all, so it declares none.
   *
   * **`note` is a function, unlike `extraTile`'s fixed string**, because the one thing this
   * tile states that the others do not is a *date* — when the last one landed, or the boundary
   * nothing has landed since — and a literal here would be the same "for this source" mistake
   * `unitsNote` exists to avoid under a fact that moves.
   */
  lastChunkTile?: {
    label: string
    /** What the tile's big figure reads — the honest "nothing (yet)" included, never a blank. */
    value: (s: SourceRow) => string
    note: (s: SourceRow) => string
  }
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
   * **Which run surface the page draws where `browsePanel` is `null`.**
   *
   * A key, never a component, for the same reason `browsePanel` is one: this module is data and
   * the page owns what a key renders as. It exists because there are now *two* connectors whose
   * first act is a run, and the page was telling them apart with `kind === 'gdrive'` — a connector
   * name written into a component, which is the exact ternary this table was introduced to stop
   * and which a third such connector would have to be added to by hand.
   *
   * Absent wherever `browsePanel` is set: a connector that browses has no run panel to draw.
   */
  runPanel?: 'mail-run' | 'drive-run'
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
    scopeTile: {
      label: 'datasets allowed',
      count: (s) => s.datasets.length,
      note: 'in the allowlist',
    },
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
    scopeTile: {
      label: 'folders allowed',
      count: (s) => s.folders.length,
      note: 'in the allowlist',
    },
    /*
     * **The same three figures a mailbox states, because a run does the same thing to both.**
     *
     * A file somebody filed and a file somebody attached are the same unit — which is why they
     * already share `profiled_documents` — so the strip states what has been *chunked*, how many
     * chunks that came to, and how much text came out. Counted over what has been **processed**,
     * never over what the drive holds: a tile counting the corpus reports work nothing has done.
     *
     * **`entities extracted` moved rather than went.** It is on each document's own row, under the
     * name, which is where a reader looking at a document is looking — the strip answers "what has
     * this run done" and the row answers "what came out of this file".
     */
    objectsLabel: 'documents chunked',
    objectsCount: (s) => s.documentsChunked ?? 0,
    objectsNote: (s) => `${s.chunksTotal ?? 0} chunks in total`,
    unitsLabel: 'chunked today',
    unitsCount: (s) => s.profiledToday,
    unitsNote: (s) => `since ${s.profiledTodayDate}`,
    /* `mailProcessCopy`'s rounding, so this tile and the per-document `size` cells beneath it
       cannot state one unit at two grains — the same reason Gmail's reads it. */
    extraTile: {
      label: 'chunk size',
      value: (s) => mailProcessCopy.sizeValue(s.chunkChars ?? 0),
      suffix: 'chars',
      note: 'of extracted chunk text',
    },
    lastChunkTile: {
      label: 'last chunk (6 mo)',
      value: lastChunkValue,
      note: lastChunkNote,
    },
    /*
     * **One act over the whole drive, asked for directly** — *"it should look like this view, not
     * existing view"*, of Gmail's surface. The browse-and-tick tree and the *View profiled
     * documents* panel are both gone from this surface: the run is the button, and everything it
     * did is listed underneath it.
     *
     * **What that costs is on record.** A drive's folders are a real choice a reader made in the
     * connect wizard — which is precisely why Gmail has no picker and this one did — so picking a
     * subset of documents can no longer be expressed here. The allowlist still bounds every run,
     * `POST …/profile-documents` still takes an explicit `objects` list, and `DocumentBrowsePanel`
     * is still on disk with no caller. Do not delete it to "finish" this.
     */
    browseLabel: 'Process documents',
    /* No second act: the documents are listed on the page itself, under the run that produced
       them, so a button opening a second view of them opens what is already there. */
    dictionaryLabel: '',
    /* A run, not a panel — which is what makes the page draw an action here. */
    browsePanel: null,
    runPanel: 'drive-run',
    dictionaryPanel: null,
    listCount: (s) => `${s.profiledDocuments ?? 0} documents profiled`,
    foot: (s) =>
      (s.profiledDocuments ?? 0) === 0
        ? 'No profiled documents yet for this source. Browse & profile some documents first, then watch the Profiling jobs tab.'
        : `${s.profiledDocuments} document(s) and ${s.profiledEntities} entities profiled. Re-profile any time from Browse documents for profiling.`,
  },
  gmail: {
    accountLabel: 'mailbox',
    accountNote: 'Gmail',
    /*
     * **No allowlist tile — removed on request.**
     *
     * The other two connectors' scopes are choices a reader made in the connect wizard and they
     * really bound what a run reaches. A mailbox's labels are neither: the consent settles them,
     * there is no picker, and *Process documents* covers the whole mailbox regardless — so a tile
     * reading *labels allowed · 3 · in the allowlist* named a scope nobody chose and nothing
     * narrows, which is a stronger claim than the data supports.
     *
     * **`source.labels` is untouched** and still read by the wizard, the preview, the document
     * type chips and `GET …/mail-documents`' own facets. This is one tile removed, not a field.
     */
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
    /*
     * **The extracted text of what has been processed — the figure `chunk_chars` has always
     * carried, and nothing drew.** It was served, validated and documented ("the tiles state
     * chunks … and the *chunk size* the corpus declares") while the strip rendered four tiles, so
     * the one number saying how much text a run actually pulled out was reachable only from the
     * payload.
     *
     * **Summed over what has been processed, never over the mailbox** — the same rule as the two
     * tiles beside it, which is why it reads 0 before a run rather than reporting the corpus.
     *
     * The rounding is `mailProcessCopy`'s, so this tile and the per-document `size` cells beneath
     * it cannot come to state one unit at two grains.
     */
    extraTile: {
      label: 'chunk size',
      value: (s) => mailProcessCopy.sizeValue(s.chunkChars ?? 0),
      suffix: 'chars',
      note: 'of extracted chunk text',
    },
    lastChunkTile: {
      label: 'last chunk (6 mo)',
      value: lastChunkValue,
      note: lastChunkNote,
    },
    browseLabel: 'Process documents',
    /* No second act: the documents are listed on the page itself, under the run that produced
       them, so a button opening a second view of them was opening what is already there. */
    dictionaryLabel: '',
    /* A run, not a panel — see `browsePanel` on the interface above. */
    browsePanel: null,
    runPanel: 'mail-run',
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
