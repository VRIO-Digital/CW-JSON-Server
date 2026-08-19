/*
 * What a source name has to be, in one place.
 *
 * Required, and at least `SOURCE_NAME_MIN` characters. The rule is enforced
 * server-side on all three register endpoints (`sourceNameProblem` in
 * `server.mjs`) — this is the client half, so the wizard can refuse before a
 * round trip instead of turning a typed name into a 400. Both halves must agree,
 * and `check-docs` fails if the two numbers drift apart.
 *
 * The floor is not arbitrary politeness: `source_name` is the label in the
 * Sources table, the Data Catalog's tab, and every profiling job row. Nothing
 * downstream can make "db" readable, and the old code fell back to the project id
 * when the field was blank — a row called `vrio-contextweave-demo` that reads as a
 * name and is not one.
 */
export const SOURCE_NAME_MIN = 6

/**
 * The message to show, or null when the name is acceptable.
 *
 * Returns a sentence rather than a boolean because that is what the user reads:
 * "Required" beside an empty box says less than naming the length it needs.
 */
export function sourceNameProblem(value: string): string | null {
  const name = value.trim()
  if (name === '') return 'A source name is required.'
  if (name.length < SOURCE_NAME_MIN) {
    return `Use at least ${SOURCE_NAME_MIN} characters — ${name.length} so far.`
  }
  return null
}

/** True when this name may be submitted. */
export const isSourceNameValid = (value: string) => sourceNameProblem(value) === null
