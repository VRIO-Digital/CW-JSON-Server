/**
 * Where a dataset's rendered report documents actually live, as URLs the browser can load.
 *
 * The server lists a document by **filename** — `R1_variance_report.html` — because that is what the
 * ingest read off disk and because the server has no idea how the client bundles its assets. This module
 * is the other half: it turns that filename into a URL.
 *
 * **`import.meta.glob` with `?url`, so there is exactly one copy of each file.** The obvious alternative
 * is to copy them into `public/`, which serves them at a stable path with no bundler involvement — and
 * that is how `/login/data` frames its document. It was rejected here for one reason: a copy in `public/`
 * beside the original in `src/Capex/Report/` is two answers to what the report says, and the one nobody
 * edits goes stale silently. These files are 2.5 MB each and are re-exported as a whole; a stale copy
 * would be a whole report out of date, not a detail. So the files stay where they were authored and Vite
 * emits them as assets.
 *
 * **The glob is written per-dataset-folder rather than naming CAPEX**, so a second dataset that ships
 * rendered reports is a folder drop and an ingest run rather than an edit here. `eager` because the map
 * is a lookup table of URLs, not the documents themselves — nothing 2.5 MB is pulled into the bundle
 * graph by asking for its address.
 *
 * **A rendered What-if lens resolves through here too, and through the same map.** A dataset can ship its
 * What-if as a finished page rather than a traversal to compute — CAPEX does — and that page needs exactly
 * what a report needs: a filename turned into a URL, from one copy, with a missing file named rather than
 * guessed. Two modules would be two copies of that machinery and two places for the duplicate-basename
 * throw below to live. **A second glob rather than a widened one**, because the folder is what says which
 * kind of document a file is: `Report/` holds reports and `what-if-lens/` holds a lens, and a pattern
 * loose enough to catch both would also catch the next folder somebody drops beside them.
 *
 * **And a third, for a dataset whose Audit & Governance screen is a rendered page.** Same reasoning
 * again, and the folder name is again what classifies the file: `audit-governance/` holds that screen.
 * Three globs feeding one lookup is three lines; one loose pattern is a rule nobody can read off the
 * tree, and the duplicate-basename throw below has to see every candidate whichever way they arrive.
 */

/*
 * Vite rewrites this at build time into a map of module path -> emitted asset URL. Typed explicitly
 * because `?url` on `.html` is not one of the extensions `vite/client` declares.
 */
const modules = import.meta.glob('../*/Report/*.html', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

/* The same, for a dataset that ships its What-if lens as a rendered page. Both maps feed one lookup. */
const lensModules = import.meta.glob('../*/what-if-lens/*.html', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

/* And for a dataset that ships its Audit & Governance screen the same way. */
const governanceModules = import.meta.glob('../*/audit-governance/*.html', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

/*
 * And a fourth, for the specification behind each rendered report — what a reader sees while the
 * report is being built, in place of narrated steps.
 *
 * The same reasoning a fourth time, and the folder is again what classifies the file:
 * `Steps-building-report/` holds the specs, `Report/` the reports they describe. It feeds the one
 * lookup below, so a spec is resolved by the module every other framed document goes through and the
 * duplicate-basename throw sees it too — which matters here more than anywhere, since a spec and the
 * report it describes are two documents about one thing and a collision would frame the wrong one.
 */
const specModules = import.meta.glob('../*/Steps-building-report/*.html', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Filename -> URL, keyed on the basename because that is what the payload carries.
 *
 * A duplicate basename across two dataset folders would make one of them unreachable, so it is a
 * **throw at module load** rather than a silent overwrite: the alternative is a Library row that opens
 * the wrong dataset's report, which looks like a working page. Module load is the right moment — this is
 * a build-time fact, so it cannot depend on which dataset a reader happens to select.
 */
const byName = new Map<string, string>()
for (const [path, url] of Object.entries({
  ...modules,
  ...lensModules,
  ...governanceModules,
  ...specModules,
})) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const seen = byName.get(name)
  if (seen && seen !== url) {
    throw new Error(
      `two documents are called "${name}" (${seen} and ${url}) — ` +
        'a Library row or a framed lens would open whichever won, so rename one',
    )
  }
  byName.set(name, url)
}

/**
 * The URL for one document, or `null` when the bundle has no such file.
 *
 * `null` rather than a guessed path, because a guess produces an iframe that loads the SPA's own
 * `index.html` — the router then renders the app inside the report frame, which reads as a broken report
 * rather than as a missing file. The caller says so in words instead.
 */
export const reportDocumentUrl = (file: string): string | null => byName.get(file) ?? null

/** Every document filename the bundle carries, for the "which files are here" half of a diagnosis. */
export const reportDocumentFiles = (): string[] => [...byName.keys()].sort()
