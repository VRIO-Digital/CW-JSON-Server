import { create } from 'zustand'
import {
  applySchemaUpload,
  browseDocuments,
  browseSource,
  cancelProfilingJob,
  getProfiledColumns,
  getProfiledDocuments,
  getProfiledMailDocuments,
  listChangeSignals,
  listProfilingJobs,
  profileDocuments,
  getMailRun,
  profileMailDocuments,
  previewSchemaUpload,
  profileTables,
  setColumnDescription,
  setDocumentSummary,
  setMailDocumentSummary,
  type BrowseResult,
  type ChangeSignal,
  type DocumentBrowseResult,
  type ProfiledColumnsPayload,
  type ProfiledDocumentsPayload,
  type ProfiledMailDocumentsPayload,
  type ProfilingJob,
  type ProfilingJobsPayload,
  type SchemaPreviewPayload,
} from '../api/client'
import type { AppliedDictionary } from '../data/schemaUpload'
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

/* ---------------- Process a mailbox's documents ---------------- */

/**
 * Gmail's one act: **Process documents** runs over every attachment under the source's labels.
 *
 * **This replaced a browse-and-tick store**, which held the label → message → document tree, the
 * checkbox selection and a `start` that posted the picked subset. Removed on request. What it
 * leaves is a single call and the flag that says it is in flight — there is no `data`, because
 * nothing is browsed, and no `error` in state, because the one act reports through its `Result`
 * the way every other action here does.
 *
 * `browseMailDocuments` and its endpoint are untouched and now have no caller — the same
 * waiting-for-a-caller state `/change-signals` is in.
 */
interface MailProcessState {
  starting: boolean
  /**
   * The run this surface is watching, or `null` where nothing has been run.
   *
   * **Held here rather than read off the jobs board**, which deliberately excludes `gmail`: a mail
   * run is narrated where it was started and nowhere else, so a row on that board as well would be
   * two places to watch one thing.
   */
  job: ProfilingJob | null
  /** No object list: omitting it is what tells the route "the whole mailbox". */
  process: (
    sourceId: string,
    force: boolean,
  ) => Promise<{ ok: true; job: ProfilingJob } | { ok: false; error: string }>
  /** One read of this source's run. */
  poll: (sourceId: string) => Promise<void>
  reset: () => void
}

export const useMailProcessStore = create<MailProcessState>()((set) => ({
  starting: false,
  job: null,

  process: async (sourceId, force) => {
    set({ starting: true })
    try {
      const { job } = await profileMailDocuments(sourceId, force)
      /* Kept, so the panel narrates from the first frame rather than waiting for the first poll —
         a bar that appears a second after the click reads as a click that did nothing. */
      set({ job })
      return { ok: true, job }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ starting: false })
    }
  },

  /** One read. The panel owns the interval and stops it when the run lands. */
  poll: async (sourceId) => {
    try {
      set({ job: await getMailRun(sourceId) })
    } catch {
      /* A failed poll leaves the last known run rather than blanking a bar mid-flight — the same
         rule the derivation poll keeps. */
    }
  },

  reset: () => set({ starting: false, job: null }),
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


/* ---------------- Uploading a data dictionary ---------------- */

/** A dictionary that has been picked and is waiting for Start Profiling. */
export interface StagedDictionary {
  filename: string
  /**
   * The plan the server answered with — the *dataset's* tables and columns, not the file's.
   *
   * **The file's text used to be staged beside it and is not any anymore.** Nothing reads the
   * file: the upload is a showcase and the run profiles what the document already holds, so
   * carrying a copy of the bytes through the store would be keeping something no request sends.
   * It also lifts the 1 MB body cap off the act — the browser no longer posts the file at all.
   */
  plan: SchemaPreviewPayload
}

interface SchemaUploadState {
  /**
   * What has been read, **keyed by dataset**.
   *
   * A map rather than one plan, because the control is per dataset now: a source with three
   * datasets can have a dictionary staged against each, and one slot would silently replace the
   * previous reader's file with the next one. The dataset id is the key the write is made with, so
   * there is nothing to keep in step.
   */
  staged: Record<string, StagedDictionary>
  /** Which dataset is being read right now, or `null` — one at a time, and named so the row says so. */
  reading: string | null
  applying: boolean
  /** The parser's own refusal, shown verbatim — it is written as a sentence to whoever holds the file. */
  error: string | null

  /**
   * Reads a file against one dataset and stages what it would do. **Writes nothing.**
   *
   * Called the moment a file is chosen rather than from a button, which is the only change to this
   * act: the guarantee that a preview writes nothing is the endpoint's, and it is untouched.
   */
  read: (
    sourceId: string,
    input: { filename: string; dataset_id: string },
  ) => Promise<Result>
  /**
   * Writes every staged dictionary and returns **the one run** it queued.
   *
   * **One request, not one per dataset.** It used to post them one at a time — each apply hands the
   * server a whole document through `commitDb`, so two in parallel would have the second overwrite
   * the first — and each reply carried a job of its own, which is how one press of Start Profiling
   * came to put two pipelines on the board. The dictionaries and the reader's selection travel
   * together now: the server resolves every plan before it writes anything, commits once, and
   * queues a single job over the union.
   *
   * So there is nothing partial left to report. A refusal means **nothing was written** and
   * everything is still staged, which is a stronger guarantee than the loop's "the first two landed"
   * and needs no sentence about what did.
   */
  applyStaged: (
    sourceId: string,
    objects: { dataset_id: string; table_id: string }[],
    force: boolean,
  ) => Promise<
    | { ok: true; applied: AppliedDictionary[]; job: ProfilingJob }
    | { ok: false; error: string }
  >
  /**
   * A file the browser refused before sending it — the wrong extension, or over the body cap.
   *
   * It lands in the same `error` as the parser's own refusal on purpose: from the reader's side both
   * answer one question, *why did my file not take*, and `schemaFileProblem` writes its sentence to
   * the same audience. One field means the panel has one place to look and cannot show a stale
   * refusal beside a fresh one.
   */
  refuse: (datasetId: string, problem: string) => void
  discard: (datasetId: string) => void
  reset: () => void
}

/**
 * Reading a data dictionary, then writing it.
 *
 * A store rather than calls from the panel, because this is a **write**: the rule here is that a
 * component may reach `client.ts` directly only for a one-shot read. The refusals are kept in
 * `error` rather than thrown, so the panel prints the parser's sentence where the file was chosen
 * instead of in a toast that outlives the screen.
 *
 * A dataset's staged entry is cleared when a new file is chosen for it, not only by `discard` — a
 * stale report under a newly chosen file is the one state this must not show, since the write acts
 * on the file and the reader would be reading the previous one's report.
 */
export const useSchemaUploadStore = create<SchemaUploadState>()((set, get) => ({
  staged: {},
  reading: null,
  applying: false,
  error: null,

  read: async (sourceId, input) => {
    const { [input.dataset_id]: _dropped, ...rest } = get().staged
    set({ reading: input.dataset_id, error: null, staged: rest })
    try {
      const plan = await previewSchemaUpload(sourceId, input)
      set((state) => ({
        reading: null,
        staged: {
          ...state.staged,
          [input.dataset_id]: { filename: input.filename, plan },
        },
      }))
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ error: message, reading: null })
      return { ok: false, error: message }
    }
  },

  applyStaged: async (sourceId, objects, force) => {
    /* Read once, into the order they are sent: the reply's `applied` comes back in that order, and
       reading `staged` again afterwards would be reading what this call has just cleared. */
    const entries = Object.entries(get().staged)
    set({ applying: true, error: null })
    try {
      const result = await applySchemaUpload(sourceId, {
        dictionaries: entries.map(([dataset_id, entry]) => ({
          filename: entry.filename,
          dataset_id,
        })),
        objects,
        force,
      })
      /* All of them landed or none did, so the whole staging area clears here. */
      set({ staged: {}, applying: false })
      return {
        ok: true as const,
        /* Paired positionally with what was sent, which is the order the route replies in. */
        applied: entries.map(([dataset_id, entry], i) => ({
          dataset_id,
          filename: entry.filename,
          table_count: result.applied[i]?.table_count ?? entry.plan.table_count,
        })),
        job: result.job,
      }
    } catch (error) {
      const message = toMessage(error)
      /* Nothing was written, so nothing is unstaged: the reader can fix the file and press again. */
      set({ error: message, applying: false })
      return { ok: false as const, error: message }
    }
  },

  refuse: (datasetId, problem) =>
    set((state) => {
      const { [datasetId]: _dropped, ...rest } = state.staged
      return { staged: rest, error: problem, reading: null }
    }),

  discard: (datasetId) =>
    set((state) => {
      const { [datasetId]: _dropped, ...rest } = state.staged
      return { staged: rest, error: null }
    }),

  reset: () => set({ staged: {}, reading: null, applying: false, error: null }),
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
          /* No object list: a mail job *is* the whole mailbox now, so re-running one is running
             the mailbox again — the same set, by the same route, with `force` carried through. */
          await profileMailDocuments(job.source_id, force)
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
