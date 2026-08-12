import { create } from 'zustand'
import { ApiError } from '../api/client'
import { ValidationError } from '../api/validate'

/**
 * Turns anything thrown into a sentence worth showing a user.
 *
 * ApiError already carries the server's own wording; ValidationError names the
 * offending field. Anything else is a genuine bug, so it is surfaced rather
 * than swallowed behind a generic message.
 */
export function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof ValidationError) return error.message
  // A thrown Error with an empty message would show an empty toast, which reads
  // as the app doing nothing at all.
  if (error instanceof Error && error.message.trim()) return error.message
  return 'Something went wrong. Try again — if it keeps happening, restart the mock server (npm run mock).'
}

/** Actions report back rather than throwing, so callers need no try/catch. */
export type Result = { ok: true } | { ok: false; error: string }

export interface ReadState<T, A extends unknown[] = []> {
  data: T | null
  loading: boolean
  error: string | null
  /**
   * Resolves to the data, or null when the call failed.
   *
   * Arguments are forwarded to the fetcher, so an endpoint that takes one — the report section
   * is read *as* a persona — needs no store of its own. A fetcher with no parameters keeps the
   * no-argument `load()` it always had.
   */
  load: (...args: A) => Promise<T | null>
  reset: () => void
}

/**
 * A store for one read-only endpoint: `{ data, loading, error, load }`.
 *
 * Every fetch goes through the same try/catch so no page has to remember to
 * handle a rejection, and a failed reload leaves the previous data in place
 * instead of blanking the screen.
 */
export function createReadStore<T, A extends unknown[] = []>(
  fetcher: (...args: A) => Promise<T>,
) {
  return create<ReadState<T, A>>()((set) => ({
    data: null,
    loading: false,
    error: null,

    load: async (...args: A) => {
      set({ loading: true })
      try {
        const data = await fetcher(...args)
        set({ data, error: null, loading: false })
        return data
      } catch (error) {
        set({ error: toMessage(error), loading: false })
        return null
      }
    },

    reset: () => set({ data: null, loading: false, error: null }),
  }))
}
