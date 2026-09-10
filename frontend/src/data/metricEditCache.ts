/**
 * A local fallback for a metric suggestion's edit, kept for exactly the case the pool write
 * cannot cover: `PATCH /graph-metrics/:id` failing to reach the server at all. The pool is still
 * the source of truth — `edit` in `graphStore.ts` tries the real write first, every time this is
 * read — this only holds a correction in the browser between "the request failed" and the next
 * successful write, so a reader who typed a fix while the mock server was down does not lose it
 * on a reload. Once a write actually lands, the cache entry for that id is cleared: the server's
 * row wins from then on, the same rule `edit`'s own success branch already keeps.
 */

const KEY = 'contextweave.metricEditCache'

export interface CachedMetricEdit {
  name: string
  detail: string
  updatedAt: string
}

type Cache = Record<string, CachedMetricEdit>

function readCache(): Cache {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Cache) : {}
  } catch {
    // A private window, a full quota, or a hand-edited value — the fallback is best-effort,
    // and the real write this exists to cover for is attempted first regardless.
    return {}
  }
}

function writeCache(cache: Cache) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // Nothing to recover into if the browser refuses to store it — the edit still applied to
    // the screen this call, it just will not survive a reload.
  }
}

export function cachedMetricEdit(metricId: string): CachedMetricEdit | null {
  return readCache()[metricId] ?? null
}

export function saveMetricEditLocally(metricId: string, name: string, detail: string) {
  const cache = readCache()
  cache[metricId] = { name, detail, updatedAt: new Date().toISOString() }
  writeCache(cache)
}

export function clearMetricEditLocally(metricId: string) {
  const cache = readCache()
  if (!(metricId in cache)) return
  delete cache[metricId]
  writeCache(cache)
}
