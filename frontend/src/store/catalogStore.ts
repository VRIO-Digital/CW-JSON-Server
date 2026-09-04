import { create } from 'zustand'
import {
  applySchemaUpload,
  browseDocuments,
  browseMailDocuments,
  browseSource,
  cancelProfilingJob,
  getProfiledColumns,
  getProfiledDocuments,
  getProfiledMailDocuments,
  listChangeSignals,
  listProfilingJobs,
  profileDocuments,
  profileMailDocuments,
  previewSchemaUpload,
  profileTables,
  setColumnDescription,
  setDocumentSummary,
  setMailDocumentSummary,
  type BrowseResult,
  type ChangeSignal,
  type DocumentBrowseResult,
  type MailDocumentBrowseResult,
  type ProfiledColumnsPayload,
  type ProfiledDocumentsPayload,
  type ProfiledMailDocumentsPayload,
  type ProfilingJob,
  type ProfilingJobsPayload,
  type SchemaPreviewPayload,
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

/* ---------------- Browse & profile mail documents ---------------- */

interface MailBrowseState {
  data: MailDocumentBrowseResult | null
  loading: boolean
  error: string | null
  starting: boolean

  load: (sourceId: string) => Promise<void>
  start: (
    sourceId: string,
    objects: { label_id: string; document_id: string }[],
    force: boolean,
  ) => Promise<{ ok: true; job: ProfilingJob } | { ok: false; error: string }>
  reset: () => void
}

/**
 * The Gmail twin of `useBrowseStore`, separate for the reason the Drive one is: the three
 * payloads share no fields, so one `data` would be a union every consumer had to narrow.
 */
export const useMailBrowseStore = create<MailBrowseState>()((set) => ({
  data: null,
  loading: false,
  error: null,
  starting: false,

  load: async (sourceId) => {
    set({ loading: true })
    try {
      set({ data: await browseMailDocuments(sourceId), error: null, loading: false })
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
      const { job } = await profileMailDocuments(sourceId, objects, force)
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

/* ---------------- Profiled mail documents ---------------- */

interface MailDocumentsState {
  data: ProfiledMailDocumentsPayload | null
  loading: boolean
  error: string | null

  load: (sourceId: string) => Promise<void>
  /** The reviewable unit is the document, exactly as it is for a drive's. */
  summarise: (
    sourceId: string,
    input: { label_id: string; document_id: string; summary: string },
  ) => Promise<Result>
  reset: () => void
}

export const useMailDocumentsStore = create<MailDocumentsState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,

  load: async (sourceId) => {
    set({ loading: true })
    try {
      set({
        data: await getProfiledMailDocuments(sourceId),
        error: null,
        loading: false,
      })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  summarise: async (sourceId, input) => {
    if (!input.label_id || !input.document_id) {
      return { ok: false, error: 'Missing the label or document to describe.' }
    }
    try {
      await setMailDocumentSummary(sourceId, input)
      await get().load(sourceId)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    }
  },

  reset: () => set({ data: null, loading: false, error: null }),
}))


/* ---------------- Uploading a schema or data dictionary ---------------- */

interface SchemaUploadState {
  /** What the last preview read, or `null` before one has run. */
  plan: SchemaPreviewPayload | null
  reading: boolean
  applying: boolean
  /** The parser's own refusal, shown verbatim — it is written as a sentence to whoever holds the file. */
  error: string | null

  preview: (
    sourceId: string,
    input: { filename: string; text: string; dataset_id: string },
  ) => Promise<Result>
  apply: (
    sourceId: string,
    input: { filename: string; text: string; dataset_id: string },
  ) => Promise<{ ok: true; job: ProfilingJob } | { ok: false; error: string }>
  reset: () => void
}

/**
 * The two acts of a schema upload.
 *
 * A store rather than calls from the panel, because this is a **write** with two steps: the rule
 * here is that a component may reach `client.ts` directly only for a one-shot read. The refusals are
 * kept in `error` rather than thrown, so the panel prints the parser's sentence where the file was
 * chosen instead of in a toast that outlives the screen.
 *
 * `plan` is cleared by `preview` starting, not just by `reset` — a stale plan under a newly chosen
 * file is the one state this must not show, since Apply acts on the file and the reader would be
 * reading the previous one's report.
 */
export const useSchemaUploadStore = create<SchemaUploadState>()((set) => ({
  plan: null,
  reading: false,
  applying: false,
  error: null,

  preview: async (sourceId, input) => {
    set({ reading: true, error: null, plan: null })
    try {
      set({ plan: await previewSchemaUpload(sourceId, input), reading: false })
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ error: message, reading: false })
      return { ok: false, error: message }
    }
  },

  apply: async (sourceId, input) => {
    set({ applying: true, error: null })
    try {
      const { job } = await applySchemaUpload(sourceId, input)
      /* The plan goes with the apply: it described a change that has now happened, and leaving it on
         screen beside "applied" would read as a change still waiting to be made. */
      set({ applying: false, plan: null })
      return { ok: true, job }
    } catch (error) {
      const message = toMessage(error)
      set({ error: message, applying: false })
      return { ok: false, error: message }
    }
  },

  reset: () => set({ plan: null, reading: false, applying: false, error: null }),
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

  /*
   * One board runs every connector, so a re-run has to go back to the endpoint the job came
   * from — a job's `parent_id`/`object_id` mean a dataset and table, a folder and document,
   * or a label and message, and only its `kind` says which.
   *
   * **Switched on the kind rather than tested for one**, because the `else` here is not a
   * fallback: it names BigQuery's endpoint and its field names specifically. While there were
   * two connectors `kind === 'gdrive'` and "everything else" happened to coincide; mail made
   * them diverge, and a mail job re-run down that branch posted `{dataset_id, table_id}` to
   * `/profile`, which the server refuses with *"holds messages, not tables"* — a Force button
   * that reports a wrong-endpoint error. The same shape as `reportEntitlementCell`'s chain
   * ending at the archived cell. An unhandled kind now says so instead of picking a door.
   */
  rerun: async (job, force) => {
    if (job.objects.length === 0) {
      return { ok: false, error: `That job has no ${job.unit}s to re-profile.` }
    }
    try {
      switch (job.kind) {
        case 'gdrive':
          await profileDocuments(
            job.source_id,
            job.objects.map((o) => ({
              folder_id: o.parent_id,
              document_id: o.object_id,
            })),
            force,
          )
          break
        case 'gmail':
          await profileMailDocuments(
            job.source_id,
            job.objects.map((o) => ({
              label_id: o.parent_id,
              document_id: o.object_id,
            })),
            force,
          )
          break
        case 'bigquery':
          await profileTables(
            job.source_id,
            job.objects.map((o) => ({
              dataset_id: o.parent_id,
              table_id: o.object_id,
            })),
            force,
          )
          break
        default:
          return {
            ok: false,
            error: `This build cannot re-run a ${String(job.kind)} job — reload the page to pick up a newer one.`,
          }
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
