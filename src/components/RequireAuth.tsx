import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

/**
 * Gates the whole app shell behind sign-in. Wraps the `/` route tree in
 * routes.tsx rather than checking inside `App`, so an unauthenticated visit
 * never mounts the sidebar or fetches a single page's data.
 *
 * The attempted location travels in `state.from` so `LoginPage` can send the
 * user back to where they were headed instead of always landing on Sources.
 */
export default function RequireAuth() {
  const identity = useAuthStore((s) => s.identity)
  const location = useLocation()

  if (!identity) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return <Outlet />
}
