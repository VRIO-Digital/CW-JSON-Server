import { create } from 'zustand'
import { getDb, putDb, putDbSection, type DbPayload } from '../api/client'
import { toMessage, type Result } from './asyncState'

export const WHOLE_FILE = '__whole__'

/** Pretty-print exactly as the server writes the file, so diffs stay small. */
export const formatJson = (value: unknown) => JSON.stringify(value, null, 2)

interface DbState {
  payload: DbPayload | null
  loading: boolean
  saving: boolean
  /** Load failure — replaces the page. Save failures are returned instead. */
  error: string | null

  /** Which top-level key is open, or WHOLE_FILE. */
  section: string
  draft: string

  load: (keepSection?: boolean) => Promise<void>
  select: (section: string) => void
  setDraft: (draft: string) => void
  save: () => Promise<Result>
}

/** Parses the draft, returning the value or a message — never throws. */
export function parseDraft(draft: string):
  | { ok: true; value: unknown }
  | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(draft) as unknown }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid JSON' }
  }
}

export const useDbStore = create<DbState>()((set, get) => ({
  payload: null,
  loading: false,
  saving: false,
  error: null,
  section: WHOLE_FILE,
  draft: '',

  load: async (keepSection = false) => {
    set({ loading: true })
    try {
      const payload = await getDb()
      const section = keepSection ? get().section : WHOLE_FILE
      const value = section === WHOLE_FILE ? payload.db : payload.db[section]
      set({ payload, section, draft: formatJson(value), error: null, loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  select: (section) => {
    const { payload } = get()
    if (!payload) return
    const value = section === WHOLE_FILE ? payload.db : payload.db[section]
    set({ section, draft: formatJson(value) })
  },

  setDraft: (draft) => set({ draft }),

  save: async () => {
    const { draft, section } = get()

    // Validate locally first — no point sending text that is not even JSON.
    const parsed = parseDraft(draft)
    if (!parsed.ok) return { ok: false, error: `Not valid JSON — ${parsed.error}` }

    set({ saving: true })
    try {
      if (section === WHOLE_FILE) await putDb(parsed.value)
      else await putDbSection(section, parsed.value)
      // Re-read so the section list and byte count reflect what is on disk.
      await get().load(true)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ saving: false })
    }
  },
}))
