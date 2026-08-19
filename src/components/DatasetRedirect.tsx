/**
 * Redirect to a path under the current dataset's letter.
 *
 * **A component rather than `<Navigate to={appPath('/ask')} />` in the route table.** The table is built
 * once at module load, so an `appPath` call inside it would freeze whichever dataset was selected when
 * the bundle evaluated — and after a switch the root would send the reader to the previous dataset's
 * letter, which the gate would then correct on arrival. Two redirects to reach one page, the first of
 * them wrong. Resolving at render keeps it to one.
 */

import { Navigate } from 'react-router-dom'

import { appPath } from '../api/dataset'

export default function DatasetRedirect({ to }: { to: string }) {
  return <Navigate to={appPath(to)} replace />
}
