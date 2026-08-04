import { create } from 'zustand'
import {
  deleteSource,
  disconnectSource,
  listSources,
  updateSourceDatasets,
  updateSourceFolders,
  type SourceRow,
} from '../api/client'
import { toMessage, type Result } from './asyncState'

export type { Result }

interface SourcesPayload {
  sources: SourceRow[]
  registeredCount: number
  connectedSources: number
  profiledTables: number
  profiledColumns: number
  profiledDocuments: number
  profiledEntities: number
}

interface SourcesState {
  data: SourcesPayload | null
  loading: boolean
  error: string | null
  /** sourceId of the row whose action is in flight, so only its button spins. */
  pending: string | null

  load: () => Promise<void>
  disconnect: (sourceId: string) => Promise<Result>
  remove: (sourceId: string) => Promise<Result>
  setDatasets: (sourceId: string, datasets: string[]) => Promise<Result>
  setFolders: (sourceId: string, folders: string[]) => Promise<Result>
}

const EMPTY: SourceRow[] = []

export const useSourcesStore = create<SourcesState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,
  pending: null,

  load: async () => {
    set({ loading: true })
    try {
      set({ data: await listSources(), error: null, loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  disconnect: async (sourceId) => {
    set({ pending: sourceId })
    try {
      await disconnectSource(sourceId)
      await get().load()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ pending: null })
    }
  },

  remove: async (sourceId) => {
    set({ pending: sourceId })
    try {
      await deleteSource(sourceId)
      await get().load()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ pending: null })
    }
  },

  setDatasets: async (sourceId, datasets) => {
    // Guard before the request: the server rejects this too, but a local check
    // keeps a pointless round-trip out of the way.
    if (datasets.length === 0) {
      return { ok: false, error: 'Keep at least one dataset in the allowlist.' }
    }
    set({ pending: sourceId })
    try {
      await updateSourceDatasets(sourceId, datasets)
      await get().load()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ pending: null })
    }
  },

  /** The Drive allowlist: same contract, folders instead of datasets. */
  setFolders: async (sourceId, folders) => {
    if (folders.length === 0) {
      return { ok: false, error: 'Keep at least one folder in the allowlist.' }
    }
    set({ pending: sourceId })
    try {
      await updateSourceFolders(sourceId, folders)
      await get().load()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ pending: null })
    }
  },
}))

/** Stable empty array so selectors don't churn on every render. */
export const selectSources = (s: SourcesState) => s.data?.sources ?? EMPTY
