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

/** Which Google consent the wizard is asking for. */
export type OAuthProvider = 'bigquery' | 'drive'

export interface OAuthStart {
  state: string
  provider: OAuthProvider
  auth_url: string
  scopes: string[]
}

export interface OAuthCallback {
  account: GoogleAccount
  projects: GcpProject[]
}

/* ---------------- Connect a Drive source ---------------- */

export interface DriveInfo {
  drive_id: string
  display_name: string
  kind: string
  folder_count: number
  document_count: number
  credential_handle: string | null
}

export interface DriveOAuthCallback {
  account: GoogleAccount
  drives: DriveInfo[]
}

export interface PreviewFolder {
  folder_id: string
  name: string
  path: string
  description: string
  document_count: number
  page_count: number
  file_types: string[]
}

export interface DrivePreviewResult {
  drive_id: string
  display_name: string
  kind: string
  folder_count: number
  document_count: number
  folders: PreviewFolder[]
  registered: false
}

export interface RegisteredDriveSource {
  source_id: string
  source_name: string
  connector: string
  drive_id: string
  display_name: string
  folders: string[]
  status: string
  registered_at: string
  newly_connected: boolean
  folder_count: number
  document_count: number
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
  /** Entities extracted from profiled documents. Drive sources only. */
  profiledEntities: number | null
  datasets: string[]
  /** The folder allowlist. Drive sources only; empty for everything else. */
  folders: string[]
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
  profiled_entities: number | null
  datasets: string[]
  folders: string[]
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

/* ---------------- Catalogue: browse & profile documents ---------------- */

export interface BrowseDocument {
  document_id: string
  name: string
  mime_type: string
  doc_type: string
  pages: number
  size_mb: number
  entities: number
  modified: string
  profiled: boolean
}

export interface BrowseFolder {
  folder_id: string
  name: string
  path: string
  document_count: number
  documents: BrowseDocument[]
}

export interface DocumentBrowseResult {
  source_id: string
  folders: BrowseFolder[]
  folder_count: number
  object_count: number
}

/**
 * One item of a job's work list. A BigQuery job profiles tables and a Drive job
 * profiles documents, so the pair is named generically: `parent_id` is the
 * dataset or folder, `object_id` the table or document, `units` its columns or
 * entities. `unit` on the job says which noun to print.
 */
export interface JobObject {
  parent_id: string
  object_id: string
  label: string
  units: number
  state: 'pending' | 'profiled' | 'skipped'
}

export interface ProfilingJob {
  job_id: string
  short_id: string
  source_id: string
  kind: 'bigquery' | 'gdrive'
  unit: 'table' | 'document'
  status: 'queued' | 'running' | 'complete' | 'cancelled' | 'failed'
  stage_index: number
  stage_total: number
  stage_label: string
  /** Pre-formatted "3/5: Class inference". */
  pipeline: string
  progress: number
  objects: JobObject[]
  object_count: number
  objects_done: number
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

/* ---------------- The document dictionary ---------------- */

export interface ProfiledEntity {
  entity_id: string
  type: string
  class: ColumnClass
  confidence: number
  pii: boolean
  /** How many times the extractor found it in this document. */
  occurrences: number
  /** Share of the document's chunks it appears in. */
  coverage_pct: number
}

export interface ProfiledDocument {
  document_id: string
  name: string
  mime_type: string
  doc_type: string
  pages: number
  size_mb: number
  modified: string
  chunks: number
  entity_count: number
  pii_count: number
  /** Curator-written; the unit under review for an unstructured file. */
  summary: string | null
  summary_status: 'needs review' | 'described'
  entities: ProfiledEntity[]
}

export interface ProfiledFolder {
  folder_id: string
  name: string
  path: string
  document_count: number
  entity_count: number
  documents: ProfiledDocument[]
}

/** Counts documents, not entities — a file is what a curator reviews. */
export interface DocumentFacets {
  all: number
  needs_review: number
  pii: number
  manifests: number
  contracts: number
  reports: number
  notes: number
}

export interface ProfiledDocumentsPayload {
  source_id: string
  profiled_documents: number
  folder_count: number
  entity_count: number
  facets: DocumentFacets
  folders: ProfiledFolder[]
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

/* ---------------- New Graph wizard ---------------- */

/** How well a domain is backed by data that is actually connected. */
export type DomainFit = 'strong' | 'partial' | 'none'

export interface GraphDomain {
  domainId: string
  name: string
  expectedSources: string[]
  fit: DomainFit
  /** Why it ranks where it does — shown under the domain name. */
  note: string
  rank: number
}

export interface GraphDomainsPayload {
  domains: GraphDomain[]
  domainCount: number
  connectedSources: number
  profiledObjects: number
}

export interface GraphUseCase {
  useCaseId: string
  name: string
  status: 'draft' | 'committed'
  domainId: string | null
  businessNeed: string
  step: number
  stepTotal: number
  updatedAt: string | null
}

export interface UseCasesPayload {
  useCases: GraphUseCase[]
  count: number
  draftCount: number
  committedCount: number
  /** Step labels come from the server, so the stepper cannot outgrow it. */
  steps: string[]
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
  profiled_entities: nullable(num),
  datasets: arrayOf(str),
  folders: arrayOf(str),
  kind: str,
})

const SOURCES_PAYLOAD = shape({
  sources: arrayOf(SOURCE_ROW),
  registered_count: num,
  connected_sources: num,
  profiled_tables: num,
  profiled_columns: num,
  profiled_documents: num,
  profiled_entities: num,
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

const DOCUMENT_BROWSE_PAYLOAD = shape({
  source_id: str,
  folder_count: num,
  object_count: num,
  folders: arrayOf(
    shape({
      folder_id: str,
      name: str,
      path: str,
      document_count: num,
      documents: arrayOf(
        shape({
          document_id: str,
          name: str,
          mime_type: str,
          doc_type: str,
          pages: num,
          size_mb: num,
          entities: num,
          modified: str,
          profiled: bool,
        }),
      ),
    }),
  ),
})

const JOB = shape({
  job_id: str,
  short_id: str,
  source_id: str,
  kind: oneOf(['bigquery', 'gdrive']),
  unit: oneOf(['table', 'document']),
  status: oneOf(['queued', 'running', 'complete', 'cancelled', 'failed']),
  stage_index: num,
  stage_total: num,
  stage_label: str,
  pipeline: str,
  progress: num,
  object_count: num,
  objects_done: num,
  force: bool,
  triggered_at: str,
  elapsed_seconds: num,
  triggered_by: str,
  objects: arrayOf(
    shape({
      parent_id: str,
      object_id: str,
      label: str,
      units: num,
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

const DOCUMENTS_PAYLOAD = shape({
  source_id: str,
  profiled_documents: num,
  folder_count: num,
  entity_count: num,
  facets: shape({
    all: num,
    needs_review: num,
    pii: num,
    manifests: num,
    contracts: num,
    reports: num,
    notes: num,
  }),
  folders: arrayOf(
    shape({
      folder_id: str,
      name: str,
      path: str,
      document_count: num,
      entity_count: num,
      documents: arrayOf(
        shape({
          document_id: str,
          name: str,
          mime_type: str,
          doc_type: str,
          pages: num,
          size_mb: num,
          modified: str,
          chunks: num,
          entity_count: num,
          pii_count: num,
          summary: nullable(str),
          summary_status: oneOf(['needs review', 'described']),
          entities: arrayOf(
            shape({
              entity_id: str,
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
              occurrences: num,
              coverage_pct: num,
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

const GRAPH_DOMAINS_PAYLOAD = shape({
  domain_count: num,
  connected_sources: num,
  profiled_objects: num,
  domains: arrayOf(
    shape({
      domain_id: str,
      name: str,
      expected_sources: arrayOf(str),
      fit: oneOf(['strong', 'partial', 'none']),
      note: str,
      rank: num,
    }),
  ),
})

const USE_CASE = shape({
  use_case_id: str,
  name: str,
  status: oneOf(['draft', 'committed']),
  domain_id: nullable(str),
  business_need: str,
  step: num,
  step_total: num,
  updated_at: nullable(str),
})

const USE_CASES_PAYLOAD = shape({
  use_cases: arrayOf(USE_CASE),
  count: num,
  draft_count: num,
  committed_count: num,
  steps: arrayOf(str),
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

const DRIVE_PREVIEW_PAYLOAD = shape({
  drive_id: str,
  display_name: str,
  kind: str,
  folder_count: num,
  document_count: num,
  folders: arrayOf(
    shape({
      folder_id: str,
      name: str,
      path: str,
      description: str,
      document_count: num,
      page_count: num,
      file_types: arrayOf(str),
    }),
  ),
})

const DRIVE_OAUTH_CALLBACK_PAYLOAD = shape({
  account: shape({ email: str, name: str }),
  drives: arrayOf(
    shape({
      drive_id: str,
      display_name: str,
      kind: str,
      folder_count: num,
      document_count: num,
      credential_handle: nullable(str),
    }),
  ),
})

const DRIVE_FOLDERS_PAYLOAD = shape({
  drive_id: str,
  folders: arrayOf(
    shape({ folder_id: str, name: str, path: str, document_count: num }),
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

/** The scope depends on the connector, so the provider goes out with the start. */
export const oauthStart = (provider: OAuthProvider = 'bigquery') =>
  request<OAuthStart>(`/sources/oauth/start?provider=${provider}`)

export async function oauthCallback(state: string): Promise<OAuthCallback> {
  const raw = await request<unknown>(
    `/sources/oauth/callback?state=${encodeURIComponent(state)}&provider=bigquery`,
  )
  return validate<OAuthCallback>("The Google sign-in result", raw, OAUTH_CALLBACK_PAYLOAD)
}

export async function driveOauthCallback(state: string): Promise<DriveOAuthCallback> {
  const raw = await request<unknown>(
    `/sources/oauth/callback?state=${encodeURIComponent(state)}&provider=drive`,
  )
  return validate<DriveOAuthCallback>(
    'The Google Drive sign-in result',
    raw,
    DRIVE_OAUTH_CALLBACK_PAYLOAD,
  )
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

export async function previewDrive(
  driveId: string,
  credentialHandle: string,
): Promise<DrivePreviewResult> {
  const raw = await request<unknown>('/sources/drive/preview', {
    method: 'POST',
    body: { drive_id: driveId, credential_handle: credentialHandle },
  })
  return validate<DrivePreviewResult>('The folder preview', raw, DRIVE_PREVIEW_PAYLOAD)
}

export const registerDriveSource = (input: {
  driveId: string
  credentialHandle: string
  folders: string[]
  sourceName: string
}) =>
  request<RegisteredDriveSource>('/sources/drive', {
    method: 'POST',
    body: {
      drive_id: input.driveId,
      credential_handle: input.credentialHandle,
      folders: input.folders,
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
  profiledEntities: number
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
    profiled_entities: number
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
      profiledEntities: s.profiled_entities,
      datasets: s.datasets,
      folders: s.folders,
      kind: s.kind,
    })),
    registeredCount: raw.registered_count,
    connectedSources: raw.connected_sources,
    profiledTables: raw.profiled_tables,
    profiledColumns: raw.profiled_columns,
    profiledDocuments: raw.profiled_documents,
    profiledEntities: raw.profiled_entities,
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

export const updateSourceFolders = (sourceId: string, folders: string[]) =>
  request<RawSourceRow>(`/sources/${encodeURIComponent(sourceId)}/folders`, {
    method: 'PUT',
    body: { folders },
  })

export const listProjectDatasets = (projectId: string) =>
  request<{ project_id: string; datasets: { dataset_id: string }[] }>(
    `/projects/${encodeURIComponent(projectId)}/datasets`,
  )

export async function listDriveFolders(driveId: string): Promise<{
  drive_id: string
  folders: { folder_id: string; name: string; path: string; document_count: number }[]
}> {
  const raw = await request<unknown>(`/drives/${encodeURIComponent(driveId)}/folders`)
  return validate('The folder list', raw, DRIVE_FOLDERS_PAYLOAD)
}

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

export async function browseDocuments(
  sourceId: string,
): Promise<DocumentBrowseResult> {
  const raw = await request<unknown>(
    `/sources/${encodeURIComponent(sourceId)}/browse-documents`,
  )
  return validate<DocumentBrowseResult>(
    'The browsable documents',
    raw,
    DOCUMENT_BROWSE_PAYLOAD,
  )
}

export const profileDocuments = (
  sourceId: string,
  objects: { folder_id: string; document_id: string }[],
  force: boolean,
) =>
  request<{ job: ProfilingJob }>(
    `/sources/${encodeURIComponent(sourceId)}/profile-documents`,
    { method: 'POST', body: { objects, force } },
  )

export async function getProfiledDocuments(
  sourceId: string,
): Promise<ProfiledDocumentsPayload> {
  const raw = await request<unknown>(
    `/sources/${encodeURIComponent(sourceId)}/documents`,
  )
  return validate<ProfiledDocumentsPayload>(
    'The document dictionary',
    raw,
    DOCUMENTS_PAYLOAD,
  )
}

export const setDocumentSummary = (
  sourceId: string,
  input: { folder_id: string; document_id: string; summary: string },
) =>
  request<{ key: string; summary: string | null }>(
    `/sources/${encodeURIComponent(sourceId)}/documents`,
    { method: 'PATCH', body: input },
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

/* ---------------- New Graph wizard ---------------- */

interface RawGraphDomain {
  domain_id: string
  name: string
  expected_sources: string[]
  fit: DomainFit
  note: string
  rank: number
}

interface RawUseCase {
  use_case_id: string
  name: string
  status: 'draft' | 'committed'
  domain_id: string | null
  business_need: string
  step: number
  step_total: number
  updated_at: string | null
}

const toUseCase = (u: RawUseCase): GraphUseCase => ({
  useCaseId: u.use_case_id,
  name: u.name,
  status: u.status,
  domainId: u.domain_id,
  businessNeed: u.business_need,
  step: u.step,
  stepTotal: u.step_total,
  updatedAt: u.updated_at,
})

export async function listGraphDomains(): Promise<GraphDomainsPayload> {
  const raw = validate<{
    domains: RawGraphDomain[]
    domain_count: number
    connected_sources: number
    profiled_objects: number
  }>('The business domains', await request<unknown>('/graph-domains'), GRAPH_DOMAINS_PAYLOAD)

  return {
    domains: raw.domains.map((d) => ({
      domainId: d.domain_id,
      name: d.name,
      expectedSources: d.expected_sources,
      fit: d.fit,
      note: d.note,
      rank: d.rank,
    })),
    domainCount: raw.domain_count,
    connectedSources: raw.connected_sources,
    profiledObjects: raw.profiled_objects,
  }
}

export async function listUseCases(): Promise<UseCasesPayload> {
  const raw = validate<{
    use_cases: RawUseCase[]
    count: number
    draft_count: number
    committed_count: number
    steps: string[]
  }>('The saved use cases', await request<unknown>('/graph-use-cases'), USE_CASES_PAYLOAD)

  return {
    useCases: raw.use_cases.map(toUseCase),
    count: raw.count,
    draftCount: raw.draft_count,
    committedCount: raw.committed_count,
    steps: raw.steps,
  }
}

/** No `useCaseId` creates a draft; passing one updates it in place. */
export async function saveUseCase(input: {
  useCaseId?: string | null
  name: string
  domainId: string | null
  businessNeed: string
  step: number
  status?: 'draft' | 'committed'
}): Promise<GraphUseCase> {
  const payload = await request<{ use_case: RawUseCase }>('/graph-use-cases', {
    method: 'POST',
    body: {
      use_case_id: input.useCaseId ?? undefined,
      name: input.name,
      domain_id: input.domainId,
      business_need: input.businessNeed,
      step: input.step,
      status: input.status,
    },
  })
  return toUseCase(
    validate<{ use_case: RawUseCase }>(
      'The saved use case',
      payload,
      shape({ use_case: USE_CASE }),
    ).use_case,
  )
}

export const deleteUseCase = (useCaseId: string) =>
  request<{ deleted: string }>(
    `/graph-use-cases/${encodeURIComponent(useCaseId)}`,
    { method: 'DELETE' },
  )

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
