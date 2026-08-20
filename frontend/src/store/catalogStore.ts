import { create } from 'zustand'
import {
  browseDocuments,
  browseSource,
  cancelProfilingJob,
  getProfiledColumns,
  getProfiledDocuments,
  listChangeSignals,
  listProfilingJobs,
  profileDocuments,
  profileTables,
  setColumnDescription,
  setDocumentSummary,
  type BrowseResult,
  type ChangeSignal,
  type DocumentBrowseResult,
  type ProfiledColumnsPayload,
  type ProfiledDocumentsPayload,
  type ProfilingJob,
  type ProfilingJobsPayload,
} from '../api/client'
import { createReadStore, toMessage, type Result } from './asyncState'

export type { Result }

/* ---------------- Browse & profile ---------------- */

interface BrowseState {
  data: BrowseResult | null
  loading: boolean
  error: string | null
  starting: boolean

  load: (sourceId: string) => Promise<void>
  start: (
    sourceId: string,
    objects: { dataset_id: string; table_id: string }[],
    force: boolean,
  ) => Promise<{ ok: true; job: ProfilingJob } | { ok: false; error: string }>
  reset: () => void
}

export const useBrowseStore = create<BrowseState>()((set) => ({
  data: null,
  loading: false,
  error: null,
  starting: false,

  load: async (sourceId) => {
    set({ loading: true })
    try {
      set({ data: await browseSource(sourceId), error: null, loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  start: async (sourceId, objects, force) => {
    if (objects.length === 0) {
      return { ok: false, error: 'Select at least one table to profile.' }
    }
    set({ starting: true })
    try {
      const { job } = await profileTables(sourceId, objects, force)
      return { ok: true, job }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ starting: false })
    }
  },

  reset: () => set({ data: null, loading: false, error: null, starting: false }),
}))

/* ---------------- Browse & profile documents ---------------- */

interface DocumentBrowseState {
  data: DocumentBrowseResult | null
  loading: boolean
  error: string | null
  starting: boolean

  load: (sourceId: string) => Promise<void>
  start: (
    sourceId: string,
    objects: { folder_id: string; document_id: string }[],
    force: boolean,
  ) => Promise<{ ok: true; job: ProfilingJob } | { ok: false; error: string }>
  reset: () => void
}

/**
 * The Drive twin of `useBrowseStore`. Kept separate rather than branching one
 * store on connector: the two payloads have no fields in common, and a shared
 * `data` would be a union every consumer had to narrow.
 */
export const useDocumentBrowseStore = create<DocumentBrowseState>()((set) => ({
  data: null,
  loading: false,
  error: null,
  starting: false,

  load: async (sourceId) => {
    set({ loading: true })
    try {
      set({ data: await browseDocuments(sourceId), error: null, loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  start: async (sourceId, objects, force) => {
    if (objects.length === 0) {
      return { ok: false, error: 'Select at least one document to profile.' }
    }
    set({ starting: true })
    try {
      const { job } = await profileDocuments(sourceId, objects, force)
      return { ok: true, job }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ starting: false })
    }
  },

  reset: () => set({ data: null, loading: false, error: null, starting: false }),
}))

/* ---------------- Profiled columns ---------------- */

interface ColumnsState {
  data: ProfiledColumnsPayload | null
  loading: boolean
  error: string | null

  load: (sourceId: string) => Promise<void>
  describe: (
    sourceId: string,
    input: { dataset_id: string; table_id: string; column_id: string; description: string },
  ) => Promise<Result>
  reset: () => void
}

export const useColumnsStore = create<ColumnsState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,

  load: async (sourceId) => {
    set({ loading: true })
    try {
      set({ data: await getProfiledColumns(sourceId), error: null, loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  describe: async (sourceId, input) => {
    if (!input.dataset_id || !input.table_id || !input.column_id) {
      return { ok: false, error: 'Missing the dataset, table or column to describe.' }
    }
    try {
      await setColumnDescription(sourceId, input)
      await get().load(sourceId)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    }
  },

  reset: () => set({ data: null, loading: false, error: null }),
}))

/* ---------------- Profiled documents ---------------- */

interface DocumentsState {
  data: ProfiledDocumentsPayload | null
  loading: boolean
  error: string | null

  load: (sourceId: string) => Promise<void>
  /** The reviewable unit is the document, so the note is its summary. */
  summarise: (
    sourceId: string,
    input: { folder_id: string; document_id: string; summary: string },
  ) => Promise<Result>
  reset: () => void
}

export const useDocumentsStore = create<DocumentsState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,

  load: async (sourceId) => {
    set({ loading: true })
    try {
      set({ data: await getProfiledDocuments(sourceId), error: null, loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  summarise: async (sourceId, input) => {
    if (!input.folder_id || !input.document_id) {
      return { ok: false, error: 'Missing the folder or document to describe.' }
    }
    try {
      await setDocumentSummary(sourceId, input)
      await get().load(sourceId)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    }
  },

  reset: () => set({ data: null, loading: false, error: null }),
}))

/* ---------------- Profiling jobs ---------------- */

interface JobsState {
  data: ProfilingJobsPayload | null
  loading: boolean
  error: string | null
  cancelling: string | null

  load: () => Promise<void>
  cancel: (jobId: string) => Promise<Result>
  rerun: (job: ProfilingJob, force: boolean) => Promise<Result>
}

export const useJobsStore = create<JobsState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,
  cancelling: null,

  load: async () => {
    set({ loading: true })
    try {
      set({ data: await listProfilingJobs(), error: null, loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  cancel: async (jobId) => {
    set({ cancelling: jobId })
    try {
      await cancelProfilingJob(jobId)
      await get().load()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ cancelling: null })
    }
  },

  // One board runs both connectors, so a re-run has to go back to the endpoint
  // the job came from — its objects mean folders/documents for a Drive job.
  rerun: async (job, force) => {
    if (job.objects.length === 0) {
      return { ok: false, error: `That job has no ${job.unit}s to re-profile.` }
    }
    try {
      if (job.kind === 'gdrive') {
        await profileDocuments(
          job.source_id,
          job.objects.map((o) => ({
            folder_id: o.parent_id,
            document_id: o.object_id,
          })),
          force,
        )
      } else {
        await profileTables(
          job.source_id,
          job.objects.map((o) => ({
            dataset_id: o.parent_id,
            table_id: o.object_id,
          })),
          force,
        )
      }
      await get().load()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    }
  },
}))

/* ---------------- Change signals ---------------- */

export const useSignalsStore = createReadStore<{
  signals: ChangeSignal[]
  count: number
  connected_sources: number
}>(listChangeSignals)
