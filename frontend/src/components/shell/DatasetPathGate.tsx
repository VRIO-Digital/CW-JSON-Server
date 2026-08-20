/**
 * Keeps the dataset's letter on the front of every in-app URL — `/E/sources`, `/C/reports`.
 *
 * **The selected dataset is the authority; this makes the URL say so.** A layout route at `/:ds`, so it
 * renders before any page below it: if the segment already names the selected dataset it renders the
 * page, and if it does not it redirects rather than rendering. Three cases, one rule:
 *
 * | URL | selected | result |
 * |---|---|---|
 * | `/E/sources` | EPA | renders |
 * | `/C/sources` | EPA | → `/E/sources` |
 * | `/sources` (an old bookmark) | EPA | → `/E/sources` |
 *
 * **The wrong letter is corrected, not obeyed, and that is the point.** Adopting it would make the URL
 * a second way to change dataset — one that skips the confirmation and the sign-out that make the
 * switch safe, and would leave the letter disagreeing with every request's `x-dataset` header until
 * something else resynced them. One authority, one direction.
 *
 * `replace`, so a corrected URL does not put a dead entry in the history that Back returns to and
 * corrects again. Search and hash are carried across: they belong to the page, not to the prefix.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { datasetPathFix } from '../../api/dataset'

export default function DatasetPathGate() {
  const location = useLocation()

  /*
   * The decision is `datasetPathFix`, which is pure and lives beside the selection — a redirect
   * performed by `<Navigate>` happens in a `useLayoutEffect` and so cannot be observed by
   * `renderToString`, which would make every assertion about this gate pass over nothing. What is left
   * here is only the rendering of that decision.
   */
  const fix = datasetPathFix(location.pathname, location.search, location.hash)

  return fix ? <Navigate to={fix} replace /> : <Outlet />
}
