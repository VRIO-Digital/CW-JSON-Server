/**
 * How a table's row count reads when the catalogue has one, and when it does not.
 *
 * **`null` is a real value here, and it means "catalogued but never profiled".** The CAPEX dataset says
 * so in its own provenance: *"rows is null for the 60 tables the package catalogued but did not profile —
 * that is the honest value, not zero."* 62 of its 64 tables are in that state, because a Table Catalog
 * lists what exists while profiling is what counts rows.
 *
 * So this exists to stop the obvious wrong answer. `t.rows ?? 0` renders **"0 rows"**, which is a claim:
 * it says the table is empty when the truth is that nobody has looked. That is the same mistake the
 * What-if lens avoids by reporting `null` rather than `0` for a facility with no baseline, and the same
 * one the profiler avoids by leaving counts at 0 *only* until a run has happened. An unknown is not a
 * zero.
 *
 * **One definition because two panels print it.** The Catalog's browse tree and the profiled-columns
 * panel both state a table's size, and two copies of a sentence drift — this repo has had one fact worded
 * two ways more than once. `sourceActions.ts` and `connectSteps.ts` are here for the same reason.
 */

/** What the two panels print for a table's size. `null` says nobody has counted, not that it is empty. */
export function rowCountLabel(rows: number | null): string {
  return rows === null ? 'row count not profiled' : `${rows.toLocaleString()} rows`
}

/**
 * The same fact with the profiler's `~`, for the panel that shows *profiled* objects.
 *
 * The tilde belongs there because a profiled count is a sample-time figure rather than a live one; it
 * would be nonsense in front of "not profiled", which is why this is a second function rather than a
 * prefix the caller sticks on.
 */
export function profiledRowCountLabel(rows: number | null): string {
  return rows === null ? 'row count not profiled' : `~${rows.toLocaleString()} rows`
}
