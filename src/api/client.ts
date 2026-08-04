/*
 * Client for the JSON server in mock-server/. Vite proxies /api/* to it with
 * the /api prefix stripped, so the paths below mirror the real endpoint names.
 *
 * This is the app's only data source — start it with `npm run mock`.
 */

import type { Stat, Tone } from '../types'
import {
  arrayOf,
  bool,
  nullable,
  num,
  oneOf,
  shape,
  str,
  validate,
} from './validate'

const BASE = '/api'

/* ---------------- Connect-a-source flow ---------------- */

export interface GoogleAccount {
  email: string
  name: string
}

export interface GcpProject {
  project_id: string
  display_name: string
  location: string
  dataset_count: number
  credential_handle: string | null
}

export interface OAuthStart {
  state: string
  auth_url: string
  scopes: string[]
}

export interface OAuthCallback {
  account: GoogleAccount
  projects: GcpProject[]
}

export interface PreviewDataset {
  dataset_id: string
  location: string
  description: string
  table_count: number
  column_count: number
}

export interface PreviewResult {
  project_id: string
  dataset_count: number
  datasets: PreviewDataset[]
  registered: false
}

export interface RegisteredSource {
  source_id: string
  source_name: string
  connector: string
  project_id: string
  credential_handle: string
  datasets: string[]
  status: string
  registered_at: string
  newly_connected: boolean
  dataset_count?: number
  table_count?: number
}

/* ---------------- Sources ---------------- */

export interface SourceRow {
  sourceId: string
  sourceName: string
  connector: string
  status: string
  projectAccount: string
  scope: string
  connectedAt: string
  /** 0 until the Metadata Profiler has run on this source. */
  profiledTables: number
  profiledColumns: number
  /** Drive sources only; null for everything else. */
  profiledDocuments: number | null
  datasets: string[]
  kind: string
}

interface RawSourceRow {
  source_id: string
  source_name: string
  connector: string
  status: string
  project_account: string
  scope: string
  connected_at: string
  profiled_tables: number
  profiled_columns: number
  profiled_documents: number | null
  datasets: string[]
  kind: string
}

/* ---------------- Catalogue: browse & profile ---------------- */

export interface BrowseTable {
  table_id: string
  type: string
  columns: number
  rows: number
  profiled: boolean
}

export interface BrowseDataset {
  dataset_id: string
  table_count: number
  tables: BrowseTable[]
}

export interface BrowseResult {
  source_id: string
  datasets: BrowseDataset[]
  dataset_count: number
  object_count: number
}

export interface JobTable {
  dataset_id: string
  table_id: string
  columns: number
  state: 'pending' | 'profiled' | 'skipped'
}

export interface ProfilingJob {
  job_id: string
  short_id: string
  source_id: string
  status: 'queued' | 'running' | 'complete' | 'cancelled' | 'failed'
  stage_index: number
  stage_total: number
  stage_label: string
  /** Pre-formatted "3/5: Sample rows". */
  pipeline: string
  progress: number
  tables: JobTable[]
  table_count: number
  tables_done: number
  force: boolean
  triggered_at: string
  started_at: string | null
  finished_at: string | null
  elapsed_seconds: number
  triggered_by: string
  error: string | null
}

export interface ProfilingJobsPayload {
  active: ProfilingJob[]
  recent: ProfilingJob[]
  active_count: number
  recent_count: number
  status_line: string
  pipeline: string[]
}

export type ColumnClass =
  | 'identifier'
  | 'dimension'
  | 'entity'
  | 'measure'
  | 'date'
  | 'text'

export interface ProfiledColumn {
  column_id: string
  type: string
  class: ColumnClass
  /** LLM classification confidence, shown beside the class chip. */
  confidence: number
  pii: boolean
  null_pct: number
  distinct: number
  description: string | null
  description_status: 'needs review' | 'described'
}

export interface ProfiledTable {
  table_id: string
  type: string
  rows: number
  column_count: number
  columns: ProfiledColumn[]
}

export interface ProfiledDataset {
  dataset_id: string
  table_count: number
  column_count: number
  tables: ProfiledTable[]
}

export interface ColumnFacets {
  all: number
  needs_review: number
  pii: number
  ids: number
  measures: number
  dates: number
  text: number
}

export interface ProfiledColumnsPayload {
  source_id: string
  profiled_tables: number
  dataset_count: number
  facets: ColumnFacets
  datasets: ProfiledDataset[]
}

export interface ChangeSignal {
  signal_id: string
  kind: string
  severity: string
  dataset: string
  table: string
  detail: string
  action: string
  detected: string
}

/* ---------------- Audit & Governance ---------------- */

export interface AuditEvent {
  actor: string
  action: string
  resource: string
  severity: string
  tone: Tone
  at: string
}

export interface Policy {
  name: string
  desc: string
  status: string
  tone: Tone
}

export interface AuditPayload {
  stats: Stat[]
  events: AuditEvent[]
  policies: Policy[]
  event_window: string
  policy_total: number
  connected_sources: number
}

/* ---------------- Trace & Observability ---------------- */

export interface Trace {
  id: string
  operation: string
  service: string
  duration: number
  spans: number
  status: string
  tone: Tone
  at: string
}

export interface Span {
  name: string
  start: number
  duration: number
}

export interface TracesPayload {
  stats: Stat[]
  items: Trace[]
  sampling: string
  connected_sources: number
  waterfall: {
    trace_id: string
    operation: string
    total_ms: number
    spans: Span[]
  } | null
}

/* ---------------- Validation & Evals ---------------- */

export interface EvalRun {
  suite: string
  target: string
  checks: number
  passRate: number
  status: string
  tone: Tone
  ranAt: string
}

export interface Check {
  name: string
  dataset: string
  result: string
  tone: Tone
  detail: string
}

export interface EvalsPayload {
  stats: Stat[]
  runs: EvalRun[]
  checks: Check[]
  run_trigger: string
  failure_summary: string
  connected_sources: number
}

interface RawEvalsPayload {
  stats: Stat[]
  runs: (Omit<EvalRun, 'passRate' | 'ranAt'> & { pass_rate: number; ran_at: string })[]
  checks: Check[]
  run_trigger: string
  failure_summary: string
  connected_sources: number
}

/* ---------------- db.json editor ---------------- */

export interface DbSection {
  key: string
  kind: string
  count: number
  /** Required keys cannot be removed — the server rejects a document without them. */
  required: boolean
}

export interface DbPayload {
  path: string
  bytes: number
  sections: DbSection[]
  required: string[]
  db: Record<string, unknown>
}

/* ---------------- Response schemas ---------------- */

const STAT = shape({ label: str, value: str, note: nullable(str), tone: nullable(str) })

const SOURCE_ROW = shape({
  source_id: str,
  source_name: str,
  connector: str,
  status: str,
  project_account: str,
  scope: str,
  connected_at: str,
  profiled_tables: num,
  profiled_columns: num,
  profiled_documents: nullable(num),
  datasets: arrayOf(str),
  kind: str,
})

const SOURCES_PAYLOAD = shape({
  sources: arrayOf(SOURCE_ROW),
  registered_count: num,
  connected_sources: num,
  profiled_tables: num,
  profiled_columns: num,
  profiled_documents: num,
})

const BROWSE_PAYLOAD = shape({
  source_id: str,
  dataset_count: num,
  object_count: num,
  datasets: arrayOf(
    shape({
      dataset_id: str,
      table_count: num,
      tables: arrayOf(
        shape({ table_id: str, type: str, columns: num, rows: num, profiled: bool }),
      ),
    }),
  ),
})

const JOB = shape({
  job_id: str,
  short_id: str,
  source_id: str,
  status: oneOf(['queued', 'running', 'complete', 'cancelled', 'failed']),
  stage_index: num,
  stage_total: num,
  stage_label: str,
  pipeline: str,
  progress: num,
  table_count: num,
  tables_done: num,
  force: bool,
  triggered_at: str,
  elapsed_seconds: num,
  triggered_by: str,
  tables: arrayOf(
    shape({
      dataset_id: str,
      table_id: str,
      columns: num,
      state: oneOf(['pending', 'profiled', 'skipped']),
    }),
  ),
})

const JOBS_PAYLOAD = shape({
  active: arrayOf(JOB),
  recent: arrayOf(JOB),
  active_count: num,
  recent_count: num,
  status_line: str,
})

const COLUMNS_PAYLOAD = shape({
  source_id: str,
  profiled_tables: num,
  dataset_count: num,
  facets: shape({
    all: num,
    needs_review: num,
    pii: num,
    ids: num,
    measures: num,
    dates: num,
    text: num,
  }),
  datasets: arrayOf(
    shape({
      dataset_id: str,
      table_count: num,
      column_count: num,
      tables: arrayOf(
        shape({
          table_id: str,
          type: str,
          rows: num,
          column_count: num,
          columns: arrayOf(
            shape({
              column_id: str,
              type: str,
              class: oneOf([
                'identifier',
                'dimension',
                'entity',
                'measure',
                'date',
                'text',
              ]),
              confidence: num,
              pii: bool,
              null_pct: num,
              distinct: num,
              description: nullable(str),
              description_status: oneOf(['needs review', 'described']),
            }),
          ),
        }),
      ),
    }),
  ),
})

const AUDIT_PAYLOAD = shape({
  stats: arrayOf(STAT),
  events: arrayOf(
    shape({ actor: str, action: str, resource: str, severity: str, tone: str, at: str }),
  ),
  policies: arrayOf(shape({ name: str, desc: str, status: str, tone: str })),
  connected_sources: num,
})

const TRACES_PAYLOAD = shape({
  stats: arrayOf(STAT),
  items: arrayOf(
    shape({
      id: str,
      operation: str,
      service: str,
      duration: num,
      spans: num,
      status: str,
      tone: str,
      at: str,
    }),
  ),
  connected_sources: num,
  waterfall: nullable(
    shape({
      trace_id: str,
      operation: str,
      total_ms: num,
      spans: arrayOf(shape({ name: str, start: num, duration: num })),
    }),
  ),
})

const EVALS_PAYLOAD = shape({
  stats: arrayOf(STAT),
  runs: arrayOf(
    shape({
      suite: str,
      target: str,
      checks: num,
      pass_rate: num,
      status: str,
      tone: str,
      ran_at: str,
    }),
  ),
  checks: arrayOf(
    shape({ name: str, dataset: str, result: str, tone: str, detail: str }),
  ),
  connected_sources: num,
})

const SIGNALS_PAYLOAD = shape({
  signals: arrayOf(
    shape({
      signal_id: str,
      kind: str,
      severity: str,
      dataset: str,
      table: str,
      detail: str,
      action: str,
      detected: str,
    }),
  ),
  count: num,
  connected_sources: num,
})

const PREVIEW_PAYLOAD = shape({
  project_id: str,
  dataset_count: num,
  datasets: arrayOf(
    shape({
      dataset_id: str,
      location: str,
      description: str,
      table_count: num,
      column_count: num,
    }),
  ),
})

const OAUTH_CALLBACK_PAYLOAD = shape({
  account: shape({ email: str, name: str }),
  projects: arrayOf(
    shape({
      project_id: str,
      display_name: str,
      location: str,
      dataset_count: num,
      credential_handle: nullable(str),
    }),
  ),
})

const DB_PAYLOAD = shape({
  path: str,
  bytes: num,
  required: arrayOf(str),
  db: shape({}),
  sections: arrayOf(shape({ key: str, kind: str, count: num, required: bool })),
})

/* ---------------- Transport ---------------- */

/** Thrown with the server's own error text so the UI can surface it verbatim. */
export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const UNREACHABLE =
  'Cannot reach the JSON server. Start it with `npm run mock` (port 4000).'

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new ApiError(UNREACHABLE, 0)
  }

  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `request failed (${res.status})`
    throw new ApiError(detail, res.status)
  }
  return payload as T
}

/* ---------------- Endpoints ---------------- */

export const oauthStart = () => request<OAuthStart>('/sources/oauth/start')

export async function oauthCallback(state: string): Promise<OAuthCallback> {
  const raw = await request<unknown>(
    `/sources/oauth/callback?state=${encodeURIComponent(state)}`,
  )
  return validate<OAuthCallback>("The Google sign-in result", raw, OAUTH_CALLBACK_PAYLOAD)
}

export async function previewSource(
  projectId: string,
  credentialHandle: string,
): Promise<PreviewResult> {
  const raw = await request<unknown>('/sources/preview', {
    method: 'POST',
    body: { project_id: projectId, credential_handle: credentialHandle },
  })
  return validate<PreviewResult>("The dataset preview", raw, PREVIEW_PAYLOAD)
}

export const registerSource = (input: {
  projectId: string
  credentialHandle: string
  datasets: string[]
  sourceName: string
}) =>
  request<RegisteredSource>('/sources', {
    method: 'POST',
    body: {
      project_id: input.projectId,
      credential_handle: input.credentialHandle,
      datasets: input.datasets,
      source_name: input.sourceName,
    },
  })

export const registerGenericSource = (input: {
  connector: string
  sourceName: string
  typeLabel: string
  credentialRef?: string
}) =>
  request<RegisteredSource>('/sources/generic', {
    method: 'POST',
    body: {
      connector: input.connector,
      source_name: input.sourceName,
      type_label: input.typeLabel,
      credential_ref: input.credentialRef ?? null,
    },
  })

export async function listSources(): Promise<{
  sources: SourceRow[]
  registeredCount: number
  connectedSources: number
  profiledTables: number
  profiledColumns: number
  profiledDocuments: number
}> {
  const payload = await request<unknown>('/sources')

  /*
   * A mock server started before the row shape changed still answers, but with
   * the old fields — which renders as blank ids, "Invalid Date" and "undefined
   * table(s)". Catch that specific case first so the message names the fix,
   * rather than letting the schema report a wall of field mismatches.
   */
  const rows = (payload as { sources?: unknown[] })?.sources
  if (Array.isArray(rows) && rows.some((s) => typeof (s as RawSourceRow).source_id !== 'string')) {
    throw new ApiError(
      'The JSON server is running an older version of this API (rows have no ' +
        'source_id). Restart it: stop `npm run mock` and start it again.',
      0,
    )
  }

  const raw = validate<{
    sources: RawSourceRow[]
    registered_count: number
    connected_sources: number
    profiled_tables: number
    profiled_columns: number
    profiled_documents: number
  }>('The sources list', payload, SOURCES_PAYLOAD)

  return {
    sources: raw.sources.map((s) => ({
      sourceId: s.source_id,
      sourceName: s.source_name,
      connector: s.connector,
      status: s.status,
      projectAccount: s.project_account,
      scope: s.scope,
      connectedAt: s.connected_at,
      profiledTables: s.profiled_tables,
      profiledColumns: s.profiled_columns,
      profiledDocuments: s.profiled_documents,
      datasets: s.datasets,
      kind: s.kind,
    })),
    registeredCount: raw.registered_count,
    connectedSources: raw.connected_sources,
    profiledTables: raw.profiled_tables,
    profiledColumns: raw.profiled_columns,
    profiledDocuments: raw.profiled_documents,
  }
}

export const disconnectSource = (sourceId: string) =>
  request<RawSourceRow>(`/sources/${encodeURIComponent(sourceId)}/disconnect`, {
    method: 'POST',
  })

export const deleteSource = (sourceId: string) =>
  request<{ deleted: string }>(`/sources/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE',
  })

export const updateSourceDatasets = (sourceId: string, datasets: string[]) =>
  request<RawSourceRow>(`/sources/${encodeURIComponent(sourceId)}/datasets`, {
    method: 'PUT',
    body: { datasets },
  })

export const listProjectDatasets = (projectId: string) =>
  request<{ project_id: string; datasets: { dataset_id: string }[] }>(
    `/projects/${encodeURIComponent(projectId)}/datasets`,
  )

export async function browseSource(sourceId: string): Promise<BrowseResult> {
  const raw = await request<unknown>(
    `/sources/${encodeURIComponent(sourceId)}/browse`,
  )
  return validate<BrowseResult>("The browsable objects", raw, BROWSE_PAYLOAD)
}

export const profileTables = (
  sourceId: string,
  objects: { dataset_id: string; table_id: string }[],
  force: boolean,
) =>
  request<{ job: ProfilingJob }>(
    `/sources/${encodeURIComponent(sourceId)}/profile`,
    { method: 'POST', body: { objects, force } },
  )

export async function getProfiledColumns(
  sourceId: string,
): Promise<ProfiledColumnsPayload> {
  const raw = await request<unknown>(
    `/sources/${encodeURIComponent(sourceId)}/columns`,
  )
  return validate<ProfiledColumnsPayload>("The column dictionary", raw, COLUMNS_PAYLOAD)
}

export const setColumnDescription = (
  sourceId: string,
  input: {
    dataset_id: string
    table_id: string
    column_id: string
    description: string
  },
) =>
  request<{ key: string; description: string | null }>(
    `/sources/${encodeURIComponent(sourceId)}/columns`,
    { method: 'PATCH', body: input },
  )

export const cancelProfilingJob = (jobId: string) =>
  request<ProfilingJob>(
    `/profiling-jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST' },
  )

export async function listProfilingJobs(): Promise<ProfilingJobsPayload> {
  const raw = await request<unknown>('/profiling-jobs')
  return validate<ProfilingJobsPayload>("The profiling jobs", raw, JOBS_PAYLOAD)
}

export async function listChangeSignals(): Promise<{
  signals: ChangeSignal[]
  count: number
  connected_sources: number
}> {
  const raw = await request<unknown>('/change-signals')
  return validate("The change signals", raw, SIGNALS_PAYLOAD)
}

export async function getDb(): Promise<DbPayload> {
  const raw = await request<unknown>('/db')
  return validate<DbPayload>("The db.json document", raw, DB_PAYLOAD)
}

export const putDb = (db: unknown) =>
  request<{ saved: true; sections: DbSection[] }>('/db', {
    method: 'PUT',
    body: { db },
  })

export const putDbSection = (section: string, value: unknown) =>
  request<{ saved: true; section: string; sections: DbSection[] }>(
    `/db/${encodeURIComponent(section)}`,
    { method: 'PUT', body: { value } },
  )

export async function getAudit(): Promise<AuditPayload> {
  const raw = await request<unknown>('/audit')
  return validate<AuditPayload>("The audit data", raw, AUDIT_PAYLOAD)
}

export async function getTraces(): Promise<TracesPayload> {
  const raw = await request<unknown>('/traces')
  return validate<TracesPayload>("The trace data", raw, TRACES_PAYLOAD)
}

export async function getEvals(): Promise<EvalsPayload> {
  const raw = validate<RawEvalsPayload>(
    'The evals data',
    await request<unknown>('/evals'),
    EVALS_PAYLOAD,
  )
  return {
    ...raw,
    runs: raw.runs.map((r) => ({
      suite: r.suite,
      target: r.target,
      checks: r.checks,
      passRate: r.pass_rate,
      status: r.status,
      tone: r.tone,
      ranAt: r.ran_at,
    })),
  }
}
