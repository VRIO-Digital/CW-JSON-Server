/**
 * Which tenant dataset the app is reading — EPA, CAPEX, or both.
 *
 * **This is not in a store, and it has to not be.** Every request carries the selection as a header,
 * and `request()` in `client.ts` is the one place that happens — so the value has to be readable
 * from module scope at the moment a call is made, including the very first call, which happens
 * before any component has mounted or any store has hydrated. A zustand store read from inside
 * `request()` would also make the API layer depend on the state layer, which is backwards: the
 * stores are built on `client.ts`, not the other way round.
 *
 * So the selection lives here, beside the fetcher that sends it, and `datasetStore` is a thin
 * subscribable wrapper for the components that need to *render* it.
 *
 * **Persisted, and to `localStorage`, for the reason the identity is.** A refresh must not silently
 * move the reader back to EPA while every figure on screen was CAPEX's — the pages would all
 * repopulate with different numbers under the same heading. It is a view preference rather than a
 * credential, and the server treats it as one: it is validated against the served pool on arrival,
 * and an unknown value is refused rather than honoured.
 */

/** The value sent when nothing has been chosen — the server's primary, and its own default. */
export const DEFAULT_DATASET = 'EPA'

/** The merged reading view. Named here because the UI has to know it is read-only. */
export const BOTH_DATASET = 'both'

const KEY = 'contextweave.dataset'

let current = read()

function read(): string {
  try {
    const stored = window.localStorage.getItem(KEY)
    return stored && stored.trim() ? stored : DEFAULT_DATASET
  } catch {
    /* Private-mode or a blocked store — an in-memory selection is still a working app. */
    return DEFAULT_DATASET
  }
}

/** The dataset every request carries. Read by `client.ts`, never by a component. */
export const currentDataset = (): string => current

/**
 * Forget a persisted selection the server does not recognise, and say whether there was one.
 *
 * **A persisted selection can outlive the dataset it names, and that bricked the app.** `CAPEX` was
 * seeded and then removed; a browser that had selected it kept sending `x-dataset: CAPEX` on every
 * request, and the server — correctly — refused each one with *"CAPEX" is not a dataset*. Correct on
 * both sides and unusable in the middle: the refusal is what a wrong dataset *should* get, but
 * nothing ever cleared the value, so every page failed identically forever and the only cure was
 * editing `localStorage` by hand. A stale view preference must not be a dead end.
 *
 * **This is still not a second answer to "what datasets exist".** The pool stays the server's, and
 * that is the point: nothing here decides whether `CAPEX` is a dataset. The server decides, refuses,
 * and this discards the value *because it was refused* — recovery from an answer, not a check that
 * pre-empts it. The distinction matters, because a list held here could refuse a dataset the server
 * has, which is the failure the consent screen's client-side scope list was.
 *
 * It resets to `DEFAULT_DATASET` rather than to nothing: the primary is what a caller naming no
 * dataset gets anyway, so the next request succeeds instead of repeating the refusal.
 */
export function resetDatasetIfRefused(): boolean {
  if (current === DEFAULT_DATASET) return false
  current = DEFAULT_DATASET
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* Same as `read()`: an in-memory reset still un-sticks this session. */
  }
  return true
}

/**
 * Change it, and persist it.
 *
 * Returns nothing and validates nothing: the pool is the server's, served on `GET /datasets`, so a
 * value this function has not heard of is refused by the API naming the ones that exist. Checking
 * against a list held here would be a second answer to "what datasets exist" — the mistake the
 * consent screen made with its scope list.
 */
export function setCurrentDataset(next: string): void {
  current = next
  try {
    window.localStorage.setItem(KEY, next)
  } catch {
    /* Same as above: the selection still applies to this session's requests. */
  }
}

/* ---------------- the dataset in the URL ---------------- */

/**
 * The URL segment for a dataset — its first letter, capitalised. `EPA` → `E`, `CAPEX` → `C`.
 *
 * **Derived, never stored.** The selection above is the authority and this is a rendering of it, which
 * is the opposite of what a URL usually is — and deliberate, because changing dataset signs the reader
 * out. If the segment were authoritative, typing `/C/sources` would switch datasets silently, skipping
 * the confirmation and the sign-out that make the switch safe. So a URL naming the wrong dataset is
 * *corrected* to the selected one rather than obeyed; `DatasetPathGate` is where that happens.
 *
 * **One letter is what was asked for, and it is only unambiguous while the initials differ.** `EPA`,
 * `CAPEX` and `both` give `E`, `C` and `B`. A third dataset starting with one of those would produce
 * two datasets with one address, and the URL would name neither — so `check-docs` asserts the segments
 * are distinct, rather than leaving it to be discovered when the collision arrives.
 */
export const datasetSegment = (name: string = current): string =>
  name.slice(0, 1).toUpperCase()

/**
 * An in-app path with the current dataset's segment on the front.
 *
 * Every `navigate`, `Link` and `href` that points inside the app goes through this, so the prefix
 * cannot be forgotten on one route and present on the others. `NAV_ITEMS` keeps its canonical paths
 * (`/sources`) and the sidebar prefixes them at render time — a prefix baked into the nav table would
 * be a second place the dataset lives, and it would be stale the moment the selection changed.
 */
export const appPath = (path: string): string => `/${datasetSegment()}${path}`

/**
 * Split a pathname into its dataset segment and the route beneath it.
 *
 * **A single-character first segment is the dataset segment; anything longer means there is none.** No
 * route here is one character, so the test is unambiguous — and treating a missing prefix as "no
 * segment, all route" is what lets an old unprefixed bookmark (`/sources`) be redirected to
 * `/E/sources` rather than 404 on a dataset called "sources".
 */
export function splitDatasetPath(pathname: string): { segment: string | null; rest: string } {
  const match = /^\/([^/]+)(\/.*)?$/.exec(pathname)
  if (!match) return { segment: null, rest: pathname }
  const [, first, tail] = match
  if (first.length !== 1) return { segment: null, rest: pathname }
  return { segment: first.toUpperCase(), rest: tail ?? '/' }
}

/**
 * The URL a location should be corrected to, or `null` if it is already right.
 *
 * **Pure, and separate from `DatasetPathGate`, because a redirect cannot be asserted through a
 * render.** `<Navigate>` performs its navigation in a `useLayoutEffect`, which `renderToString` never
 * runs — so a test that mounts the route table and reads the router's location sees every redirect
 * fail, including the ones that have always worked. The same reason a `Modal`'s copy lives in
 * `src/data/`: what cannot be observed where it happens gets moved somewhere it can be.
 *
 * Search and hash ride along because they belong to the page rather than to the prefix.
 */
export function datasetPathFix(
  pathname: string,
  search = '',
  hash = '',
  expected: string = datasetSegment(),
): string | null {
  const { segment, rest } = splitDatasetPath(pathname)
  if (segment === expected) return null
  return `/${expected}${rest}${search}${hash}`
}
