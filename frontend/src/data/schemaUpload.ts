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

/**
 * The largest file this will send, and it is the **server's** limit rather than a number chosen
 * here: `readJson` refuses a body over 1 MB, and the file travels inside a JSON body as a string.
 *
 * Checked before sending, so an oversized file is a sentence naming its size rather than a request
 * the server drops mid-stream — which surfaces as "failed to fetch" and sends a reader looking for a
 * server that is fine. A little under 1 MB, because the JSON envelope and the escaping of the text
 * are part of the body too.
 */
export const SCHEMA_MAX_BYTES = 900_000

const kb = (bytes: number) => `${Math.round(bytes / 1000).toLocaleString()} KB`

/**
 * Why this file cannot be sent, or `null`.
 *
 * The two things a browser can know without a round trip: whether the extension is one the reader
 * handles, and whether the body would fit. Everything else about the file is the parser's to say,
 * and the preview is where it says it.
 */
export function schemaFileProblem(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf('.')
  const extension = dot < 0 ? '' : file.name.slice(dot).toLowerCase()
  if (!SCHEMA_EXTENSIONS.includes(extension)) {
    return `${extension || 'A file with no extension'} is not a format this reads. It reads ${SCHEMA_EXTENSIONS.join(', ')} — for a spreadsheet, export the sheet as CSV and upload that.`
  }
  if (file.size > SCHEMA_MAX_BYTES) {
    return `${file.name} is ${kb(file.size)}, over the ${kb(SCHEMA_MAX_BYTES)} a request carries. Split it by dataset, or upload one table's dictionary at a time.`
  }
  if (file.size === 0) return `${file.name} is empty.`
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
  lead:
    'Upload a schema or a data dictionary and it becomes this source’s column dictionary — the ' +
    'same place a profiling run writes to. Read the preview before applying: an upload replaces ' +
    'a table’s column list rather than adding to it, so a file naming 3 columns of a table ' +
    'catalogued with 24 leaves that table with 3. The preview shows both numbers.',

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

  /** What the two acts are, said where the buttons are. */
  previewLabel: 'Read the file',
  applyLabel: 'Apply and profile',
  previewNote: 'Reads the file and reports what it would change. Writes nothing.',
  applyNote:
    'Writes the dictionary and starts a profiling run over the tables it touched — forced, ' +
    'because the columns are exactly what changed.',

  /** A table this upload would add rather than describe. */
  newTableNote:
    'New to this project. The Catalog will list it, and its rows are uncounted until something ' +
    'counts them — a dictionary states no row count.',
} as const
