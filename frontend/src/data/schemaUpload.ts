/**
 * The schema-upload panel's rules and its words.
 *
 * **Pure, and in `src/data/` for the reason `profilingOutcome` is:** the size cap and the accepted
 * extensions are read by *two* things — the file picker, which uses them to say what it takes, and
 * the refusal, which uses them to say what went wrong — and two copies of a list like that is how a
 * picker comes to accept a file the next screen rejects.
 */

/**
 * The extensions the server's reader handles, in the order a reader would try them.
 *
 * **The same set `backend/schemaImport.js` declares**, and deliberately not a superset: a picker
 * that offered `.xlsx` would open a file dialog promising something the parse then refuses, which is
 * worse than a dialog that never showed it. `check-docs` asserts the two lists are the same.
 */
export const SCHEMA_EXTENSIONS = ['.json', '.csv', '.tsv', '.sql', '.ddl', '.txt']

/** What the `<input type="file">` filters on. */
export const SCHEMA_ACCEPT = SCHEMA_EXTENSIONS.join(',')

/*
 * **`SCHEMA_MAX_BYTES` and its `kb()` formatter stood here and are gone.** They existed because the
 * file's text was posted inside a JSON body and `readJson` caps that at 1 MB, so an oversized file
 * had to be refused in the browser rather than dropped mid-stream. The upload sends no bytes at
 * all now, so the cap has nothing to cap — and a constant nothing reads is an invitation for the
 * check to come back on a request that could not hit it.
 */

/**
 * Why this file cannot be accepted, or `null`.
 *
 * **One check, and it is about the kind of file rather than its contents.** The extension is all a
 * browser can judge without opening the file, and nothing opens it: the upload is a showcase and
 * the run profiles what the document already holds, so a `.png` is refused because the control says
 * *Upload dictionary*, not because a parser would choke on it.
 *
 * **The size and empty checks went with the parse.** Both existed because the file's bytes were
 * posted in a JSON body and `readJson` caps that at 1 MB — so an oversized file had to become a
 * sentence here rather than a request the server dropped mid-stream. No bytes are sent now, so
 * refusing a large or empty file would be refusing one that works, and the size sentence
 * ("over the … a request carries") would be describing a request that no longer exists.
 */
export function schemaFileProblem(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf('.')
  const extension = dot < 0 ? '' : file.name.slice(dot).toLowerCase()
  if (!SCHEMA_EXTENSIONS.includes(extension)) {
    return `${extension || 'A file with no extension'} is not a dictionary format. This takes ${SCHEMA_EXTENSIONS.join(', ')} — for a spreadsheet, export the sheet as CSV and upload that.`
  }
  return null
}

/**
 * The panel's copy.
 *
 * Out of the component so it can be asserted without rendering the Catalog's own state, and so the
 * two sentences that make a promise — what an upload replaces, and what it does not measure — are
 * written once and read where they are printed.
 */
export const schemaUploadCopy = {
  /**
   * Said once, above the tree the per-dataset controls sit in.
   *
   * **It names the dataset rather than the source**, because that is what an upload now describes: a
   * dictionary lands on one dataset's tables, and the control that takes it is on that dataset's own
   * row. While it was a source-level button the panel had to *ask* which dataset, from a Select, a
   * moment after the reader had been looking at the list of them.
   */
  lead:
    'Upload a data dictionary against a dataset and it becomes that dataset’s column dictionary — ' +
    'the same place a profiling run writes to. The file is read the moment you choose it and ' +
    'nothing is written until Start Profiling: applying replaces a table’s column list rather ' +
    'than adding to it, so a file naming 3 columns of a table catalogued with 24 leaves that table ' +
    'with 3. The report under each dataset shows both numbers.',

  /**
   * **The one thing this panel must say out loud.** A dictionary states what a column *means*; it
   * measures nothing. So the null%, distinct and confidence a profiling run produces are absent for
   * every declared column, and the panel says so before the reader wonders why the table is full of
   * em dashes — rather than filling them with figures that would look exactly as plausible.
   */
  measuresNothing:
    'A dictionary states what a column means, and samples nothing — so a declared column carries ' +
    'no null%, no distinct count and no classifier score. Each says “—” rather than a plausible ' +
    'figure. Its class comes from the type where the file names one, and the file it was declared ' +
    'in is recorded against every column.',

  formats:
    'JSON (a document with “tables”, or a flat array of column rows), CSV or TSV (one row per ' +
    'column, with a header), or SQL DDL (CREATE TABLE statements). A spreadsheet is the usual ' +
    'case — export the sheet as CSV.',

  /**
   * **One control, and what it is called on a dataset row.**
   *
   * There is no *Read the file* button any more: choosing a file reads it immediately, because a
   * reader who has just picked a dictionary has already asked for it to be read, and a second click
   * to make anything appear is a step that says nothing. The read still writes nothing — that
   * guarantee is the preview's, and it is unchanged; what moved is only who asks for it.
   *
   * **And the control is the empty state's alone.** It used to stay on a staged row relabelled
   * *Replace file*; that button was **removed on request**, so `replaceLabel` went with it — a
   * label nothing renders is an invitation for the control to come back. Swapping a file is
   * Discard then Upload now, which is one more click and the honest shape of the act: `staged`
   * holds one file per dataset, so a replace was discarding the previous plan either way and only
   * the saying of it was missing.
   */
  uploadLabel: 'Upload dictionary',
  readingLabel: 'Reading…',
  discardLabel: 'Discard',

  /**
   * **The report is a dialog, and these are its words.**
   *
   * It was drawn under the tree, which put a twelve-row table and two warnings between the dataset
   * rows and the button that acts on them — so a reader scrolled past what they were deciding about
   * to reach the control. It opens **by itself** when a file has been read, because that is the
   * answer to the act just performed, and `reviewLabel` is the way back in for a reader who has
   * dismissed it.
   *
   * Its only act is Close. Offering *Start Profiling* here as well would be a second control for
   * one write, and the one on the panel is where every other run starts.
   */
  reportTitle: (datasetId: string, filename: string) =>
    `${filename} — what it would do to ${datasetId}`,
  reviewLabel: 'View report',
  closeLabel: 'Close',
  /** The width the table and its warning sentence need. */
  reportWidth: 900,

  /**
   * What **Start Profiling** does once a dictionary has been read — the second act, and the only
   * one that writes. Said beside that button rather than beside the upload, because it is that
   * button's promise.
   */
  applyNote:
    'Start Profiling writes every dictionary read here, then profiles the tables it touched — ' +
    'forced, because the columns are exactly what changed.',

  /** A table this upload would add rather than describe. */
  newTableNote:
    'New to this project. The Catalog will list it, and its rows are uncounted until something ' +
    'counts them — a dictionary states no row count.',
} as const

/** One dictionary that actually landed — what the sentence below needs, and nothing more. */
export interface AppliedDictionary {
  dataset_id: string
  filename: string
  /** Tables the dictionary described, which are the ones it guarantees will run. */
  table_count: number
}

/**
 * What **Start Profiling** did: which dictionaries landed, and what the run it queued is doing.
 *
 * **One sentence for one act, because it is now one job.** The dictionaries used to queue a run
 * each and the rest of the selection a further one, so there were several jobs to name and this
 * named them; there is a single job over the union now, and `run` is `profilingOutcome`'s own text
 * for it — passed in rather than recomposed, because that outcome *names* the objects the run
 * skipped and summarising it into a count would lose exactly what it exists to say.
 *
 * A pure function rather than a template assembled in the panel, for the reason `profilingOutcome`
 * is one, and composed from what the server *returned* rather than from what was submitted: a
 * settings toggle once reported a write it had not heard back on, and a claim about several writes
 * is unfalsifiable on screen.
 */
export function dictionaryRunSummary(applied: AppliedDictionary[], run: string): string {
  const files = applied
    .map((d) => `${d.filename} applied to ${d.dataset_id} (${d.table_count} table(s))`)
    .join('; ')
  return `${files}. ${run}`
}

/**
 * A write that was refused, which means **nothing was written**.
 *
 * The server resolves every dictionary before it commits anything and lands them in one write, so
 * there is no partial state to describe — every file is still staged and the reader can fix one and
 * press again. That is worth saying, because "the upload failed" leaves open whether some of it took.
 * The server's own sentence is kept verbatim.
 */
export function dictionaryRefused(error: string): string {
  return `Nothing was written — every dictionary is still staged. ${error}`
}
