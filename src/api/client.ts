/*
 * Client for the JSON server in mock-server/. Vite proxies /api/* to it with
 * the /api prefix stripped, so the paths below mirror the real endpoint names.
 *
 * This is the app's only data source — start it with `npm run mock`.
 *
 * Where that server lives is the one thing that differs between environments,
 * and it is decided by `VITE_API_BASE` in the .env files, never here:
 *
 *   development  /api                      → the Vite proxy → localhost:4000
 *   production   http://<host>:4000        → the deployed mock server, directly
 *
 * Relative `/api` is the default when the variable is unset, so a build served
 * behind a proxy that already strips /api (deploy/nginx.conf.template) keeps
 * working untouched. Do not hardcode an origin below — check-docs fails on one.
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

// The trailing slash is stripped because every path below starts with one, and
// `${BASE}${path}` would otherwise ask for //sources.
const BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '')

/* ---------------- Identity ---------------- */

/** One persona the login form's role dropdown offers. */
export interface AuthRole {
  roleId: string
  label: string
  /** What this role can and cannot see — shown again on the signed-in card. */
  accessNote: string
}

export interface AuthRolesPayload {
  roles: AuthRole[]
  count: number
}

/**
 * Who is signed in. This is a persona demo, not a user directory — there is no
 * account store behind it, so the identity is exactly what the login form
 * collected plus what the chosen role implies. Nothing here should be read as
 * real authentication.
 */
export interface SessionIdentity {
  email: string
  roleId: string
  roleLabel: string
  accessNote: string
  /** Derived from the email — there is no name field to draw one from. */
  initials: string
  signedInAt: string
}

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

/**
 * The consent, and only the consent. What the account can *see* is a second
 * call spent with `session` — the same shape a real handshake has, and what
 * gives the wizard a discovery stage backed by a real request.
 */
export interface OAuthCallback {
  account: GoogleAccount
  session: string
  provider: OAuthProvider
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

/** Drive's twin of `OAuthCallback` — its drives come from `/oauth/drives`. */
export type DriveOAuthCallback = OAuthCallback

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

/**
 * A name plus a description, and where it came from. Personas (step 2) and KPIs
 * (step 3) are the same shape, so they share one contract end to end.
 *
 * A persona is lightweight — it shapes questions and tone, never access control.
 */
export interface DraftedItem {
  name: string
  description: string
  source: 'ai' | 'user'
}

export type Persona = DraftedItem
export type Kpi = DraftedItem

/**
 * A hero question — the graph's contract. `priority` is two-valued on purpose:
 * High means "this one matters"; a third tier would invite ranking over choosing.
 */
/**
 * How answers of one question type render. Self-describing so an already-saved
 * brief keeps promising what it promised, even if the pool is edited later.
 */
export interface AnswerFormat {
  formatId: string
  /** The question type — "Cost drivers", "Compliance". */
  name: string
  /** The render recipe — "narrative + drivers table + trend". */
  format: string
}

export type Citations = 'required' | 'optional'

/** A decision the user owes on a gap before the graph can be built. */
export type GapDecision =
  | 'accept permanent'
  | 'drop question'
  | 'connect source'
  | 'defer with trigger'

export interface GapChoice {
  elementId: string
  decision: GapDecision
}

/**
 * One derived element of the step 7 review. A `backed` element names the
 * profiled object it came from in `evidence`; a `gap` explains what is missing
 * and needs a decision.
 */
export interface CoverageElement {
  elementId: string
  name: string
  kind: 'entity' | 'relationship'
  status: 'backed' | 'gap'
  confidence: number
  evidence: string | null
  reason: string | null
}

export interface CoveragePayload {
  title: string
  entityCount: number
  relationshipCount: number
  heroQuestionCount: number
  gapCount: number
  objectCount: number
  elements: CoverageElement[]
}

export interface HeroQuestion {
  text: string
  priority: "high" | "normal"
  source: "ai" | "user"
}

export interface GraphUseCase {
  useCaseId: string
  name: string
  status: 'draft' | 'committed'
  domainId: string | null
  businessNeed: string
  personas: Persona[]
  kpis: Kpi[]
  sources: SourcePick[]
  heroQuestions: HeroQuestion[]
  citations: Citations
  answerFormats: AnswerFormat[]
  gapDecisions: GapChoice[]
  step: number
  stepTotal: number
  updatedAt: string | null
}

/* ---------------- Graph Studio ---------------- */

/** What a review row may be answered with. A causal claim has its own set. */
export type ReviewChoice =
  | 'approve'
  | 'correct'
  | 'reject'
  | 'approve-causal'
  | 'downgrade-correlational'

export interface ReviewDecision {
  choice: ReviewChoice
  justification: string | null
  decidedAt: string
}

/**
 * One row of a graph's review queue. `floor` is why a human must see it at all
 * — a schema change, a causal claim, a new entity type.
 */
export interface ReviewItem {
  itemId: string
  kind: 'relationship' | 'entity'
  title: string
  detail: string
  confidence: number
  floor: string | null
  /** 'standard' or 'causal' — which three buttons the row offers. */
  actionSet: string
  /** True when the row cannot be resolved without a recorded reason. */
  justification: boolean
  decision: ReviewDecision | null
}

/** A built graph, as the studio's list shows it. */
export interface StudioGraph {
  useCaseId: string
  name: string
  domainId: string | null
  businessNeed: string
  /** The *working draft* — what Publish would make live. */
  version: string
  /** What was last made live, or null. Never the same as `version`. */
  liveVersion: string | null
  state: 'draft' | 'published'
  /** Rows still needing a human, plus the pivot if it is open. */
  queueCount: number
  mustReviewOutstanding: number
  mustReviewCount: number
  publishedCount: number
  builtAt: string | null
}

export interface StudioGraphsPayload {
  graphs: StudioGraph[]
  count: number
  /** Use cases still in the wizard — not listed, nothing to review yet. */
  draftCount: number
}

/* ---------------- Ask ---------------- */

/**
 * A graph Ask can query — one that is live.
 *
 * `version` is the *published* one, the only version that serves. A built graph
 * nobody published is not here at all; Ask has nothing to run against.
 */
export interface AskGraph {
  useCaseId: string
  name: string
  domainId: string | null
  version: string
  publishedAt: string | null
  publishedBy: string | null
  /** What step 6 promised, so the answer never decides it at runtime. */
  citations: 'required' | 'optional'
  /** Standing limits — step 7's gap decisions, read back. */
  caveats: string[]
  /** The hero questions this graph was built for; the chips under the box. */
  suggestedQuestions: string[]
  entityCount: number
  relationshipCount: number
}

export interface AskGraphsPayload {
  graphs: AskGraph[]
  count: number
  /** Built but never published — the fix is Publish, not New Graph. */
  builtCount: number
  draftCount: number
}

/** One line of the supervisor's working, shown so an answer can be audited. */
export interface AskStep {
  step: string
  detail: string
}

export interface AskCitation {
  label: string
  detail: string
  confidence: number
}

export interface AskAnswer {
  question: string
  useCaseId: string
  graphName: string
  version: string
  /** False is a real outcome: the graph abstained, and `reason` says why. */
  answered: boolean
  reason: string
  answer: string | null
  /** Null whenever it abstained — there is no number to report. */
  confidence: number | null
  entities: string[]
  path: string[]
  hops: number
  reasoning: AskStep[]
  citations: AskCitation[]
  caveats: string[]
  askedAt: string
}

export interface PivotOption {
  optionId: string
  label: string
  consequence: string
}

export interface StudioPivot {
  pivotId: string
  alternativeId: string
  title: string
  detail: string
  options: PivotOption[]
  open: boolean
  chosen: string | null
}

/** Sign-off, recorded beside a live version — never folded into it. */
export interface VersionApproval {
  approvedBy: string
  approvedAt: string
  note: string | null
}

export interface PublishedVersion {
  version: number
  publishedAt: string
  publishedBy: string
  note: string
  /** Null while a version is published but nobody has signed it off. */
  approval: VersionApproval | null
  /** Exactly one row is serving. Not necessarily the newest — see rollback. */
  isLive: boolean
}

/* ---------------- Canvas ---------------- */

/** Which legend colour a node takes. */
export type CanvasGroup = 'assets' | 'work' | 'contracts'

export interface CanvasNode {
  nodeId: string
  label: string
  sublabel: string
  group: CanvasGroup
  confidence: number
  /** True while the review item behind it is undecided. */
  proposed: boolean
  origin: 'derived' | 'studio-authored'
  rejected: boolean
  needsReview: boolean
  reviewItemId: string | null
  onAnswerPath: boolean
  x: number
  y: number
}

export interface CanvasEdge {
  from: string
  to: string
  label: string
  proposed: boolean
  reviewItemId: string | null
  onAnswerPath: boolean
}

export interface CanvasFacets {
  all: number
  lowConfidence: number
  needsReview: number
  studioAuthored: number
}

export interface CanvasPayload {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  nodeCount: number
  edgeCount: number
  facets: CanvasFacets
}

/** What the draft graph could — or could not — answer. */
export interface QueryAnswer {
  question: string
  answerable: boolean
  reason: string
  matched: string[]
  path: string[]
  pathLabels: string[]
  edgesUsed: { from: string; to: string; label: string }[]
  hops: number
  /** An answer leaning on an undecided edge is answerable *and* provisional. */
  caveats: string[]
  canvas: CanvasPayload
}

export interface GraphStudioPayload extends StudioGraph {
  graphName: string
  status: string
  decisionMemory: string
  mustReview: ReviewItem[]
  /** Named a sample because it is one — these buckets are spot-checked. */
  confirmedSample: ReviewItem[]
  confirmedCount: number
  autoApprovedSample: ReviewItem[]
  autoApprovedCount: number
  pivot: StudioPivot
  pivotCount: number
  batchResolved: number
  batchTotal: number
  publish: { blocked: boolean; reasons: string[]; explanation: string }
  versions: PublishedVersion[]
}

export interface QualityCheck {
  checkId: string
  label: string
  passed: boolean
  detail: string
}

export interface QualityReport {
  checks: QualityCheck[]
  passed: number
  failed: number
  ranAt: string
}

/** One profiled object a graph could draw from — a table, or a document. */
export interface GraphSourceObject {
  objectId: string
  parentId: string
  label: string
  units: number
  /** "columns" or "entities". */
  unitLabel: string
}

export interface GraphSource {
  sourceId: string
  sourceName: string
  connector: string
  kind: string
  status: string
  typeLabel: string
  account: string
  /** "Datasets" or "Folders". */
  scopeLabel: string
  scope: string[]
  objects: GraphSourceObject[]
  objectCount: number
  /** "tables" or "documents". */
  unitLabel: string
}

export interface GraphSourcesPayload {
  sources: GraphSource[]
  sourceCount: number
  /** Connected *and* carrying something profiled — connected alone can't feed a graph. */
  profiledSourceCount: number
}

/**
 * A step 4 pick. `mode: 'all'` keeps meaning "everything profiled here", so a
 * table profiled later is included without reopening the wizard.
 */
export interface SourcePick {
  sourceId: string
  mode: 'all' | 'subset'
  objects: string[]
}

export interface Suggestion {
  id: string
  name: string
  /** A persona's focus, a KPI's definition — what the row shows beneath it. */
  detail: string
  /** Why it was drafted — shown so a suggestion is never unexplained. */
  why: string
}

/** What a model call cost and what it was doing — shown while it runs. */
export interface LlmRun {
  stages: string[]
  costUsd: number
  costCapUsd: number
}

export interface Suggestions {
  suggestions: Suggestion[]
  count: number
  derivedFrom: string
  run: LlmRun
}

/**
 * The derivation between step 6 and step 7. Async on purpose: it returns an id
 * immediately and the answer arrives by polling, so leaving the page does not
 * lose the run.
 */
export interface DerivationRun {
  derivationId: string
  status: 'running' | 'complete'
  stageIndex: number
  stageTotal: number
  stageLabel: string
  progress: number
  /** Entity names revealed so far — what the user watches stream in. */
  revealed: string[]
  entityTotal: number
  costUsd: number
  costCapUsd: number
  coverage: CoveragePayload | null
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

/* ---------------- Identity ---------------- */

const AUTH_ROLE = shape({ role_id: str, label: str, access_note: str })

const AUTH_ROLES_PAYLOAD = shape({
  roles: arrayOf(AUTH_ROLE),
  count: num,
})

const SESSION_IDENTITY_PAYLOAD = shape({
  email: str,
  role_id: str,
  role_label: str,
  access_note: str,
  initials: str,
  signed_in_at: str,
})

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

const DRAFTED_ITEM = shape({
  name: str,
  description: str,
  source: oneOf(['ai', 'user']),
})

const GRAPH_SOURCES_PAYLOAD = shape({
  source_count: num,
  profiled_source_count: num,
  sources: arrayOf(
    shape({
      source_id: str,
      source_name: str,
      connector: str,
      kind: str,
      status: str,
      type_label: str,
      account: str,
      scope_label: str,
      scope: arrayOf(str),
      object_count: num,
      unit_label: str,
      objects: arrayOf(
        shape({
          object_id: str,
          parent_id: str,
          label: str,
          units: num,
          unit_label: str,
        }),
      ),
    }),
  ),
})

const HERO_QUESTION = shape({
  text: str,
  priority: oneOf(["high", "normal"]),
  source: oneOf(["ai", "user"]),
})

const ANSWER_FORMAT = shape({ format_id: str, name: str, format: str })

const GAP_CHOICE = shape({
  element_id: str,
  decision: oneOf([
    'accept permanent',
    'drop question',
    'connect source',
    'defer with trigger',
  ]),
})

const COVERAGE_PAYLOAD = shape({
  title: str,
  entity_count: num,
  relationship_count: num,
  hero_question_count: num,
  gap_count: num,
  object_count: num,
  elements: arrayOf(
    shape({
      element_id: str,
      name: str,
      kind: oneOf(['entity', 'relationship']),
      status: oneOf(['backed', 'gap']),
      confidence: num,
      evidence: nullable(str),
      reason: nullable(str),
    }),
  ),
})

const SOURCE_PICK = shape({
  source_id: str,
  mode: oneOf(['all', 'subset']),
  objects: arrayOf(str),
})

const USE_CASE = shape({
  use_case_id: str,
  name: str,
  status: oneOf(['draft', 'committed']),
  domain_id: nullable(str),
  business_need: str,
  personas: arrayOf(DRAFTED_ITEM),
  kpis: arrayOf(DRAFTED_ITEM),
  sources: arrayOf(SOURCE_PICK),
  hero_questions: arrayOf(HERO_QUESTION),
  citations: oneOf(['required', 'optional']),
  answer_formats: arrayOf(ANSWER_FORMAT),
  gap_decisions: arrayOf(GAP_CHOICE),
  step: num,
  step_total: num,
  updated_at: nullable(str),
})

const LLM_RUN = shape({
  stages: arrayOf(str),
  cost_usd: num,
  cost_cap_usd: num,
})

const SUGGESTIONS_PAYLOAD = shape({
  count: num,
  derived_from: str,
  run: LLM_RUN,
  suggestions: arrayOf(shape({ id: str, name: str, detail: str, why: str })),
})

const DERIVATION_PAYLOAD = shape({
  derivation_id: str,
  status: oneOf(['running', 'complete']),
  stage_index: num,
  stage_total: num,
  stage_label: str,
  progress: num,
  revealed: arrayOf(str),
  entity_total: num,
  cost_usd: num,
  cost_cap_usd: num,
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

/** The drives a session can read — the twin of OAUTH_PROJECTS_PAYLOAD. */
const OAUTH_DRIVES_PAYLOAD = shape({
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
  drive_count: num,
})

const DRIVE_FOLDERS_PAYLOAD = shape({
  drive_id: str,
  folders: arrayOf(
    shape({ folder_id: str, name: str, path: str, document_count: num }),
  ),
})

const OAUTH_CALLBACK_PAYLOAD = shape({
  account: shape({ email: str, name: str }),
  session: str,
  provider: oneOf(['bigquery', 'drive']),
})

const OAUTH_PROJECTS_PAYLOAD = shape({
  projects: arrayOf(
    shape({
      project_id: str,
      display_name: str,
      location: str,
      dataset_count: num,
      credential_handle: nullable(str),
    }),
  ),
  project_count: num,
})

/* ---------------- Graph Studio ---------------- */

const STUDIO_GRAPH = shape({
  use_case_id: str,
  name: str,
  domain_id: nullable(str),
  business_need: str,
  version: str,
  state: oneOf(['draft', 'published']),
  live_version: nullable(str),
  queue_count: num,
  must_review_outstanding: num,
  must_review_count: num,
  published_count: num,
  built_at: nullable(str),
})

const STUDIO_GRAPHS_PAYLOAD = shape({
  graphs: arrayOf(STUDIO_GRAPH),
  count: num,
  draft_count: num,
})

const REVIEW_ITEM = shape({
  item_id: str,
  kind: oneOf(['relationship', 'entity']),
  title: str,
  detail: str,
  confidence: num,
  floor: nullable(str),
  action_set: str,
  justification: bool,
  decision: nullable(
    shape({ choice: str, justification: nullable(str), decided_at: str }),
  ),
})

const GRAPH_STUDIO_PAYLOAD = shape({
  use_case_id: str,
  name: str,
  domain_id: nullable(str),
  business_need: str,
  version: str,
  state: oneOf(['draft', 'published']),
  live_version: nullable(str),
  queue_count: num,
  must_review_outstanding: num,
  must_review_count: num,
  published_count: num,
  built_at: nullable(str),
  graph_name: str,
  status: str,
  decision_memory: str,
  must_review: arrayOf(REVIEW_ITEM),
  confirmed_sample: arrayOf(REVIEW_ITEM),
  confirmed_count: num,
  auto_approved_sample: arrayOf(REVIEW_ITEM),
  auto_approved_count: num,
  pivot: shape({
    pivot_id: str,
    alternative_id: str,
    title: str,
    detail: str,
    options: arrayOf(shape({ option_id: str, label: str, consequence: str })),
    open: bool,
    chosen: nullable(str),
  }),
  pivot_count: num,
  batch_resolved: num,
  batch_total: num,
  publish: shape({ blocked: bool, reasons: arrayOf(str), explanation: str }),
  versions: arrayOf(
    shape({
      version: num,
      published_at: str,
      published_by: str,
      note: str,
      approval: nullable(
        shape({ approved_by: str, approved_at: str, note: nullable(str) }),
      ),
      is_live: bool,
    }),
  ),
})

const CANVAS_NODE = shape({
  node_id: str,
  label: str,
  sublabel: str,
  group: oneOf(['assets', 'work', 'contracts']),
  confidence: num,
  proposed: bool,
  origin: oneOf(['derived', 'studio-authored']),
  rejected: bool,
  needs_review: bool,
  review_item_id: nullable(str),
  on_answer_path: bool,
  x: num,
  y: num,
})

const CANVAS_EDGE = shape({
  from: str,
  to: str,
  label: str,
  proposed: bool,
  review_item_id: nullable(str),
  on_answer_path: bool,
})

const CANVAS_PAYLOAD = shape({
  nodes: arrayOf(CANVAS_NODE),
  edges: arrayOf(CANVAS_EDGE),
  node_count: num,
  edge_count: num,
  facets: shape({
    all: num,
    low_confidence: num,
    needs_review: num,
    studio_authored: num,
  }),
})

const QUERY_PAYLOAD = shape({
  question: str,
  answerable: bool,
  reason: str,
  matched: arrayOf(str),
  path: arrayOf(str),
  edges_used: arrayOf(shape({ from: str, to: str, label: str })),
  hops: num,
  caveats: arrayOf(str),
  canvas: CANVAS_PAYLOAD,
})

const QUALITY_REPORT_PAYLOAD = shape({
  checks: arrayOf(shape({ check_id: str, label: str, passed: bool, detail: str })),
  passed: num,
  failed: num,
  ran_at: str,
})

/* ---------------- Ask ---------------- */

const ASK_GRAPH = shape({
  use_case_id: str,
  name: str,
  domain_id: nullable(str),
  version: str,
  published_at: nullable(str),
  published_by: nullable(str),
  citations: oneOf(['required', 'optional']),
  caveats: arrayOf(str),
  suggested_questions: arrayOf(str),
  entity_count: num,
  relationship_count: num,
})

const ASK_GRAPHS_PAYLOAD = shape({
  graphs: arrayOf(ASK_GRAPH),
  count: num,
  built_count: num,
  draft_count: num,
})

/*
 * `answer` and `confidence` are nullable because an abstention has neither, and
 * that is a correct outcome rather than a missing field. `reason` is not
 * nullable: an answer that cannot say why it is an answer is not one.
 */
const ASK_ANSWER_PAYLOAD = shape({
  question: str,
  use_case_id: str,
  graph_name: str,
  version: str,
  answered: bool,
  reason: str,
  answer: nullable(str),
  confidence: nullable(num),
  entities: arrayOf(str),
  path: arrayOf(str),
  hops: num,
  reasoning: arrayOf(shape({ step: str, detail: str })),
  citations: arrayOf(shape({ label: str, detail: str, confidence: num })),
  caveats: arrayOf(str),
  asked_at: str,
})

/* ---------------- Writes answer with a shape too ---------------- */

/*
 * A POST/PUT/PATCH response is as reachable as a GET's — `/db` can be edited
 * live, and a stale server answers writes with the old shape as readily as
 * reads. These were the endpoints whose results were rendered or stored without
 * a boundary check; a missing field surfaced as `undefined` in a table instead
 * of a message naming the field.
 */
const OAUTH_START_PAYLOAD = shape({
  state: str,
  provider: oneOf(['bigquery', 'drive']),
  auth_url: str,
  scopes: arrayOf(str),
})

const REGISTERED_SOURCE_PAYLOAD = shape({
  source_id: str,
  source_name: str,
  connector: str,
  project_id: str,
  credential_handle: str,
  datasets: arrayOf(str),
  status: str,
  registered_at: str,
  newly_connected: bool,
})

const REGISTERED_DRIVE_PAYLOAD = shape({
  source_id: str,
  source_name: str,
  connector: str,
  drive_id: str,
  display_name: str,
  folders: arrayOf(str),
  status: str,
  registered_at: str,
  newly_connected: bool,
  folder_count: num,
  document_count: num,
})

const PROJECT_DATASETS_PAYLOAD = shape({
  project_id: str,
  datasets: arrayOf(shape({ dataset_id: str })),
})

const JOB_STARTED_PAYLOAD = shape({ job: JOB })

const DELETED_PAYLOAD = shape({ deleted: str })

const DOCUMENT_SUMMARY_PAYLOAD = shape({ key: str, summary: nullable(str) })

const COLUMN_DESCRIPTION_PAYLOAD = shape({ key: str, description: nullable(str) })

const DB_SECTION = shape({ key: str, kind: str, count: num, required: bool })

const DB_PAYLOAD = shape({
  path: str,
  bytes: num,
  required: arrayOf(str),
  db: shape({}),
  sections: arrayOf(DB_SECTION),
})

/* A save answers with the section list the editor re-renders from. */
const DB_SAVED_PAYLOAD = shape({ saved: bool, sections: arrayOf(DB_SECTION) })

const DB_SECTION_SAVED_PAYLOAD = shape({
  saved: bool,
  section: str,
  sections: arrayOf(DB_SECTION),
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

// No backticks: this is shown in a toast, where they render as characters.
const UNREACHABLE =
  'Cannot reach the mock server. Start it with npm run mock (port 4000), then try again.'

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

/* ---------------- Identity ---------------- */

export async function listAuthRoles(): Promise<AuthRolesPayload> {
  const raw = validate<{
    roles: { role_id: string; label: string; access_note: string }[]
    count: number
  }>('The role list', await request<unknown>('/auth/roles'), AUTH_ROLES_PAYLOAD)

  return {
    roles: raw.roles.map((r) => ({
      roleId: r.role_id,
      label: r.label,
      accessNote: r.access_note,
    })),
    count: raw.count,
  }
}

export async function login(input: {
  email: string
  password: string
  roleId: string
}): Promise<SessionIdentity> {
  const raw = validate<{
    email: string
    role_id: string
    role_label: string
    access_note: string
    initials: string
    signed_in_at: string
  }>(
    'The signed-in session',
    await request<unknown>('/auth/login', {
      method: 'POST',
      body: { email: input.email, password: input.password, role_id: input.roleId },
    }),
    SESSION_IDENTITY_PAYLOAD,
  )

  return {
    email: raw.email,
    roleId: raw.role_id,
    roleLabel: raw.role_label,
    accessNote: raw.access_note,
    initials: raw.initials,
    signedInAt: raw.signed_in_at,
  }
}

/** The scope depends on the connector, so the provider goes out with the start. */
export async function oauthStart(
  provider: OAuthProvider = 'bigquery',
): Promise<OAuthStart> {
  return validate<OAuthStart>(
    'The Google sign-in',
    await request<unknown>(`/sources/oauth/start?provider=${provider}`),
    OAUTH_START_PAYLOAD,
  )
}

export async function oauthCallback(state: string): Promise<OAuthCallback> {
  const raw = await request<unknown>(
    `/sources/oauth/callback?state=${encodeURIComponent(state)}&provider=bigquery`,
  )
  return validate<OAuthCallback>('The Google sign-in result', raw, OAUTH_CALLBACK_PAYLOAD)
}

export async function driveOauthCallback(state: string): Promise<DriveOAuthCallback> {
  const raw = await request<unknown>(
    `/sources/oauth/callback?state=${encodeURIComponent(state)}&provider=drive`,
  )
  return validate<DriveOAuthCallback>(
    'The Google Drive sign-in result',
    raw,
    OAUTH_CALLBACK_PAYLOAD,
  )
}

/** Spends the session on what the account can see. Twin: `listOauthDrives`. */
export async function listOauthProjects(session: string): Promise<GcpProject[]> {
  const raw = await request<unknown>(
    `/sources/oauth/projects?session=${encodeURIComponent(session)}`,
  )
  return validate<{ projects: GcpProject[] }>(
    'The projects this account can read',
    raw,
    OAUTH_PROJECTS_PAYLOAD,
  ).projects
}

/** Twin of `listOauthProjects`. */
export async function listOauthDrives(session: string): Promise<DriveInfo[]> {
  const raw = await request<unknown>(
    `/sources/oauth/drives?session=${encodeURIComponent(session)}`,
  )
  return validate<{ drives: DriveInfo[] }>(
    'The drives this account can read',
    raw,
    OAUTH_DRIVES_PAYLOAD,
  ).drives
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

export async function registerSource(input: {
  projectId: string
  credentialHandle: string
  datasets: string[]
  sourceName: string
}): Promise<RegisteredSource> {
  return validate<RegisteredSource>(
    'The registered source',
    await request<unknown>('/sources', {
      method: 'POST',
      body: {
        project_id: input.projectId,
        credential_handle: input.credentialHandle,
        datasets: input.datasets,
        source_name: input.sourceName,
      },
    }),
    REGISTERED_SOURCE_PAYLOAD,
  )
}

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

export async function registerDriveSource(input: {
  driveId: string
  credentialHandle: string
  folders: string[]
  sourceName: string
}): Promise<RegisteredDriveSource> {
  return validate<RegisteredDriveSource>(
    'The registered Drive source',
    await request<unknown>('/sources/drive', {
      method: 'POST',
      body: {
        drive_id: input.driveId,
        credential_handle: input.credentialHandle,
        folders: input.folders,
        source_name: input.sourceName,
      },
    }),
    REGISTERED_DRIVE_PAYLOAD,
  )
}

export async function registerGenericSource(input: {
  connector: string
  sourceName: string
  typeLabel: string
  credentialRef?: string
}): Promise<RegisteredSource> {
  return validate<RegisteredSource>(
    'The registered source',
    await request<unknown>('/sources/generic', {
      method: 'POST',
      body: {
        connector: input.connector,
        source_name: input.sourceName,
        type_label: input.typeLabel,
        credential_ref: input.credentialRef ?? null,
      },
    }),
    REGISTERED_SOURCE_PAYLOAD,
  )
}

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

/** All three answer with the changed row, so all three check its shape. */
export async function disconnectSource(sourceId: string): Promise<RawSourceRow> {
  return validate<RawSourceRow>(
    'The disconnected source',
    await request<unknown>(`/sources/${encodeURIComponent(sourceId)}/disconnect`, {
      method: 'POST',
    }),
    SOURCE_ROW,
  )
}

export async function deleteSource(sourceId: string): Promise<{ deleted: string }> {
  return validate<{ deleted: string }>(
    'The deleted source',
    await request<unknown>(`/sources/${encodeURIComponent(sourceId)}`, {
      method: 'DELETE',
    }),
    DELETED_PAYLOAD,
  )
}

export async function updateSourceDatasets(
  sourceId: string,
  datasets: string[],
): Promise<RawSourceRow> {
  return validate<RawSourceRow>(
    'The updated allowlist',
    await request<unknown>(`/sources/${encodeURIComponent(sourceId)}/datasets`, {
      method: 'PUT',
      body: { datasets },
    }),
    SOURCE_ROW,
  )
}

export async function updateSourceFolders(
  sourceId: string,
  folders: string[],
): Promise<RawSourceRow> {
  return validate<RawSourceRow>(
    'The updated folder allowlist',
    await request<unknown>(`/sources/${encodeURIComponent(sourceId)}/folders`, {
      method: 'PUT',
      body: { folders },
    }),
    SOURCE_ROW,
  )
}

export async function listProjectDatasets(
  projectId: string,
): Promise<{ project_id: string; datasets: { dataset_id: string }[] }> {
  return validate<{ project_id: string; datasets: { dataset_id: string }[] }>(
    'The dataset list',
    await request<unknown>(`/projects/${encodeURIComponent(projectId)}/datasets`),
    PROJECT_DATASETS_PAYLOAD,
  )
}

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

/*
 * A queued job goes straight into the jobs board and is then polled, so a
 * malformed one would render as a row of `undefined` that never resolves.
 */
export async function profileTables(
  sourceId: string,
  objects: { dataset_id: string; table_id: string }[],
  force: boolean,
): Promise<{ job: ProfilingJob }> {
  return validate<{ job: ProfilingJob }>(
    'The queued profiling job',
    await request<unknown>(`/sources/${encodeURIComponent(sourceId)}/profile`, {
      method: 'POST',
      body: { objects, force },
    }),
    JOB_STARTED_PAYLOAD,
  )
}

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

/** Drive's twin of `profileTables`, checked against the same job shape. */
export async function profileDocuments(
  sourceId: string,
  objects: { folder_id: string; document_id: string }[],
  force: boolean,
): Promise<{ job: ProfilingJob }> {
  return validate<{ job: ProfilingJob }>(
    'The queued profiling job',
    await request<unknown>(
      `/sources/${encodeURIComponent(sourceId)}/profile-documents`,
      { method: 'POST', body: { objects, force } },
    ),
    JOB_STARTED_PAYLOAD,
  )
}

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

export async function setDocumentSummary(
  sourceId: string,
  input: { folder_id: string; document_id: string; summary: string },
): Promise<{ key: string; summary: string | null }> {
  return validate<{ key: string; summary: string | null }>(
    'The saved summary',
    await request<unknown>(`/sources/${encodeURIComponent(sourceId)}/documents`, {
      method: 'PATCH',
      body: input,
    }),
    DOCUMENT_SUMMARY_PAYLOAD,
  )
}

export async function getProfiledColumns(
  sourceId: string,
): Promise<ProfiledColumnsPayload> {
  const raw = await request<unknown>(
    `/sources/${encodeURIComponent(sourceId)}/columns`,
  )
  return validate<ProfiledColumnsPayload>("The column dictionary", raw, COLUMNS_PAYLOAD)
}

export async function setColumnDescription(
  sourceId: string,
  input: {
    dataset_id: string
    table_id: string
    column_id: string
    description: string
  },
): Promise<{ key: string; description: string | null }> {
  return validate<{ key: string; description: string | null }>(
    'The saved description',
    await request<unknown>(`/sources/${encodeURIComponent(sourceId)}/columns`, {
      method: 'PATCH',
      body: input,
    }),
    COLUMN_DESCRIPTION_PAYLOAD,
  )
}

export async function cancelProfilingJob(jobId: string): Promise<ProfilingJob> {
  return validate<ProfilingJob>(
    'The cancelled job',
    await request<unknown>(`/profiling-jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    }),
    JOB,
  )
}

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
  personas: Persona[]
  kpis: Kpi[]
  sources: { source_id: string; mode: 'all' | 'subset'; objects: string[] }[]
  hero_questions: HeroQuestion[]
  citations: Citations
  answer_formats: { format_id: string; name: string; format: string }[]
  gap_decisions: { element_id: string; decision: GapDecision }[]
  step: number
  step_total: number
  updated_at: string | null
}

/** The fields steps 2–7 added. A server older than them answers with none. */
const USE_CASE_STEP_FIELDS = [
  'personas',
  'kpis',
  'sources',
  'hero_questions',
  'citations',
  'answer_formats',
  'gap_decisions',
] as const

/*
 * A use case carrying none of the step 2–7 fields is not a malformed payload —
 * it is a mock server that started before those fields existed and is still
 * answering with the old shape. Seven "should be an array, got undefined" lines
 * describe the symptom and send you reading the schema; this names the cause and
 * the one-line fix. The check has to live here because a stale server cannot
 * warn about itself.
 */
function assertCurrentUseCaseShape(raw: unknown) {
  if (raw === null || typeof raw !== 'object') return
  const u = raw as Record<string, unknown>
  // Only judge something that really is a use case, and only when *every* newer
  // field is absent — one missing field is a genuine bug worth the field names.
  if (typeof u.use_case_id !== 'string') return
  if (!USE_CASE_STEP_FIELDS.every((field) => u[field] === undefined)) return

  throw new Error(
    'The mock server is running an older version of this app, so a saved use ' +
      'case came back without its personas, KPIs, sources, questions or answer ' +
      'settings. Restart it with npm run mock and try again — nothing you ' +
      'entered has been lost.',
  )
}

const toUseCase = (u: RawUseCase): GraphUseCase => ({
  useCaseId: u.use_case_id,
  name: u.name,
  status: u.status,
  domainId: u.domain_id,
  businessNeed: u.business_need,
  personas: u.personas,
  kpis: u.kpis,
  sources: u.sources.map((s) => ({
    sourceId: s.source_id,
    mode: s.mode,
    objects: s.objects,
  })),
  heroQuestions: u.hero_questions,
  citations: u.citations,
  answerFormats: u.answer_formats.map((f) => ({
    formatId: f.format_id,
    name: f.name,
    format: f.format,
  })),
  gapDecisions: u.gap_decisions.map((d) => ({
    elementId: d.element_id,
    decision: d.decision,
  })),
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
  const payload = await request<unknown>('/graph-use-cases')
  // Before the field-by-field check, so a stale server is named as such.
  const first = (payload as { use_cases?: unknown[] } | null)?.use_cases?.[0]
  assertCurrentUseCaseShape(first)

  const raw = validate<{
    use_cases: RawUseCase[]
    count: number
    draft_count: number
    committed_count: number
    steps: string[]
  }>('The saved use cases', payload, USE_CASES_PAYLOAD)

  return {
    useCases: raw.use_cases.map(toUseCase),
    count: raw.count,
    draftCount: raw.draft_count,
    committedCount: raw.committed_count,
    steps: raw.steps,
  }
}

/** Steps 2 and 3 answer the same shape, so one fetcher serves both. */
async function fetchSuggestions(
  path: string,
  what: string,
  input: { domainId: string | null; businessNeed: string },
): Promise<Suggestions> {
  const raw = validate<{
    suggestions: Suggestion[]
    count: number
    derived_from: string
    run: { stages: string[]; cost_usd: number; cost_cap_usd: number }
  }>(
    what,
    await request<unknown>(path, {
      method: 'POST',
      body: { domain_id: input.domainId, business_need: input.businessNeed },
    }),
    SUGGESTIONS_PAYLOAD,
  )

  return {
    suggestions: raw.suggestions,
    count: raw.count,
    derivedFrom: raw.derived_from,
    run: {
      stages: raw.run.stages,
      costUsd: raw.run.cost_usd,
      costCapUsd: raw.run.cost_cap_usd,
    },
  }
}

export const suggestPersonas = (input: {
  domainId: string | null
  businessNeed: string
}) =>
  fetchSuggestions('/graph-personas/suggest', 'The persona suggestions', input)

export async function listGraphSources(): Promise<GraphSourcesPayload> {
  const raw = validate<{
    sources: {
      source_id: string
      source_name: string
      connector: string
      kind: string
      status: string
      type_label: string
      account: string
      scope_label: string
      scope: string[]
      object_count: number
      unit_label: string
      objects: {
        object_id: string
        parent_id: string
        label: string
        units: number
        unit_label: string
      }[]
    }[]
    source_count: number
    profiled_source_count: number
  }>(
    'The available sources',
    await request<unknown>('/graph-sources'),
    GRAPH_SOURCES_PAYLOAD,
  )

  return {
    sources: raw.sources.map((s) => ({
      sourceId: s.source_id,
      sourceName: s.source_name,
      connector: s.connector,
      kind: s.kind,
      status: s.status,
      typeLabel: s.type_label,
      account: s.account,
      scopeLabel: s.scope_label,
      scope: s.scope,
      objectCount: s.object_count,
      unitLabel: s.unit_label,
      objects: s.objects.map((o) => ({
        objectId: o.object_id,
        parentId: o.parent_id,
        label: o.label,
        units: o.units,
        unitLabel: o.unit_label,
      })),
    })),
    sourceCount: raw.source_count,
    profiledSourceCount: raw.profiled_source_count,
  }
}

export const suggestKpis = (input: {
  domainId: string | null
  businessNeed: string
}) => fetchSuggestions('/graph-kpis/suggest', 'The KPI suggestions', input)

interface RawCoverage {
  title: string
  entity_count: number
  relationship_count: number
  hero_question_count: number
  gap_count: number
  object_count: number
  elements: {
    element_id: string
    name: string
    kind: 'entity' | 'relationship'
    status: 'backed' | 'gap'
    confidence: number
    evidence: string | null
    reason: string | null
  }[]
}

/** Shared by the direct review and the answer a derivation run finishes with. */
const toCoverage = (raw: RawCoverage): CoveragePayload => ({
  title: raw.title,
  entityCount: raw.entity_count,
  relationshipCount: raw.relationship_count,
  heroQuestionCount: raw.hero_question_count,
  gapCount: raw.gap_count,
  objectCount: raw.object_count,
  elements: raw.elements.map((e) => ({
    elementId: e.element_id,
    name: e.name,
    kind: e.kind,
    status: e.status,
    confidence: e.confidence,
    evidence: e.evidence,
    reason: e.reason,
  })),
})

export async function reviewCoverage(input: {
  name: string
  sources: SourcePick[]
  heroQuestions: HeroQuestion[]
}): Promise<CoveragePayload> {
  return toCoverage(
    validate<RawCoverage>(
      'The coverage review',
      await request<unknown>('/graph-coverage', {
        method: 'POST',
        body: {
          name: input.name,
          sources: input.sources.map((s) => ({
            source_id: s.sourceId,
            mode: s.mode,
            objects: s.objects,
          })),
          hero_questions: input.heroQuestions,
        },
      }),
      COVERAGE_PAYLOAD,
    ),
  )
}

interface RawDerivation {
  derivation_id: string
  status: 'running' | 'complete'
  stage_index: number
  stage_total: number
  stage_label: string
  progress: number
  revealed: string[]
  entity_total: number
  cost_usd: number
  cost_cap_usd: number
  coverage: unknown
}

const toDerivation = (raw: RawDerivation): DerivationRun => ({
  derivationId: raw.derivation_id,
  status: raw.status,
  stageIndex: raw.stage_index,
  stageTotal: raw.stage_total,
  stageLabel: raw.stage_label,
  progress: raw.progress,
  revealed: raw.revealed,
  entityTotal: raw.entity_total,
  costUsd: raw.cost_usd,
  costCapUsd: raw.cost_cap_usd,
  // Only a finished run carries an answer, and it is validated as one.
  coverage: raw.coverage
    ? toCoverage(
        validate<RawCoverage>('The derived coverage', raw.coverage, COVERAGE_PAYLOAD),
      )
    : null,
})

export async function startDerivation(input: {
  name: string
  sources: SourcePick[]
  heroQuestions: HeroQuestion[]
}): Promise<DerivationRun> {
  const raw = validate<RawDerivation>(
    'The derivation run',
    await request<unknown>('/graph-derivations', {
      method: 'POST',
      body: {
        name: input.name,
        sources: input.sources.map((s) => ({
          source_id: s.sourceId,
          mode: s.mode,
          objects: s.objects,
        })),
        hero_questions: input.heroQuestions,
      },
    }),
    DERIVATION_PAYLOAD,
  )
  return toDerivation(raw)
}

export async function getDerivation(derivationId: string): Promise<DerivationRun> {
  const raw = validate<RawDerivation>(
    'The derivation run',
    await request<unknown>(`/graph-derivations/${encodeURIComponent(derivationId)}`),
    DERIVATION_PAYLOAD,
  )
  return toDerivation(raw)
}

export const suggestAnswerFormats = (input: {
  domainId: string | null
  businessNeed: string
}) =>
  fetchSuggestions(
    '/graph-answer-formats/suggest',
    'The answer formats',
    input,
  )

export const suggestQuestions = (input: {
  domainId: string | null
  businessNeed: string
}) =>
  fetchSuggestions(
    '/graph-questions/suggest',
    'The hero question suggestions',
    input,
  )

/** No `useCaseId` creates a draft; passing one updates it in place. */
export async function saveUseCase(input: {
  useCaseId?: string | null
  name: string
  domainId: string | null
  businessNeed: string
  personas: Persona[]
  kpis: Kpi[]
  sources: SourcePick[]
  heroQuestions: HeroQuestion[]
  citations: Citations
  answerFormats: AnswerFormat[]
  gapDecisions: GapChoice[]
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
      personas: input.personas,
      kpis: input.kpis,
      sources: input.sources.map((s) => ({
        source_id: s.sourceId,
        mode: s.mode,
        objects: s.objects,
      })),
      hero_questions: input.heroQuestions,
      citations: input.citations,
      answer_formats: input.answerFormats.map((f) => ({
        format_id: f.formatId,
        name: f.name,
        format: f.format,
      })),
      gap_decisions: input.gapDecisions.map((d) => ({
        element_id: d.elementId,
        decision: d.decision,
      })),
      step: input.step,
      status: input.status,
    },
  })
  assertCurrentUseCaseShape((payload as { use_case?: unknown } | null)?.use_case)
  return toUseCase(
    validate<{ use_case: RawUseCase }>(
      'The saved use case',
      payload,
      shape({ use_case: USE_CASE }),
    ).use_case,
  )
}

/* ---------------- Graph Studio ---------------- */

interface RawStudioGraph {
  use_case_id: string
  name: string
  domain_id: string | null
  business_need: string
  version: string
  live_version: string | null
  state: 'draft' | 'published'
  queue_count: number
  must_review_outstanding: number
  must_review_count: number
  published_count: number
  built_at: string | null
}

interface RawReviewItem {
  item_id: string
  kind: 'relationship' | 'entity'
  title: string
  detail: string
  confidence: number
  floor: string | null
  action_set: string
  justification: boolean
  decision: { choice: string; justification: string | null; decided_at: string } | null
}

interface RawStudio extends RawStudioGraph {
  graph_name: string
  status: string
  decision_memory: string
  must_review: RawReviewItem[]
  confirmed_sample: RawReviewItem[]
  confirmed_count: number
  auto_approved_sample: RawReviewItem[]
  auto_approved_count: number
  pivot: {
    pivot_id: string
    alternative_id: string
    title: string
    detail: string
    options: { option_id: string; label: string; consequence: string }[]
    open: boolean
    chosen: string | null
  }
  pivot_count: number
  batch_resolved: number
  batch_total: number
  publish: { blocked: boolean; reasons: string[]; explanation: string }
  versions: {
    version: number
    published_at: string
    published_by: string
    note: string
    approval: { approved_by: string; approved_at: string; note: string | null } | null
    is_live: boolean
  }[]
}

const toStudioGraph = (g: RawStudioGraph): StudioGraph => ({
  useCaseId: g.use_case_id,
  name: g.name,
  domainId: g.domain_id,
  businessNeed: g.business_need,
  version: g.version,
  liveVersion: g.live_version,
  state: g.state,
  queueCount: g.queue_count,
  mustReviewOutstanding: g.must_review_outstanding,
  mustReviewCount: g.must_review_count,
  publishedCount: g.published_count,
  builtAt: g.built_at,
})

const toReviewItem = (i: RawReviewItem): ReviewItem => ({
  itemId: i.item_id,
  kind: i.kind,
  title: i.title,
  detail: i.detail,
  confidence: i.confidence,
  floor: i.floor,
  actionSet: i.action_set,
  justification: i.justification,
  decision: i.decision
    ? {
        choice: i.decision.choice as ReviewChoice,
        justification: i.decision.justification,
        decidedAt: i.decision.decided_at,
      }
    : null,
})

const toStudio = (raw: RawStudio): GraphStudioPayload => ({
  ...toStudioGraph(raw),
  graphName: raw.graph_name,
  status: raw.status,
  decisionMemory: raw.decision_memory,
  mustReview: raw.must_review.map(toReviewItem),
  confirmedSample: raw.confirmed_sample.map(toReviewItem),
  confirmedCount: raw.confirmed_count,
  autoApprovedSample: raw.auto_approved_sample.map(toReviewItem),
  autoApprovedCount: raw.auto_approved_count,
  pivot: {
    pivotId: raw.pivot.pivot_id,
    alternativeId: raw.pivot.alternative_id,
    title: raw.pivot.title,
    detail: raw.pivot.detail,
    options: raw.pivot.options.map((o) => ({
      optionId: o.option_id,
      label: o.label,
      consequence: o.consequence,
    })),
    open: raw.pivot.open,
    chosen: raw.pivot.chosen,
  },
  pivotCount: raw.pivot_count,
  batchResolved: raw.batch_resolved,
  batchTotal: raw.batch_total,
  publish: raw.publish,
  versions: raw.versions.map((v) => ({
    version: v.version,
    publishedAt: v.published_at,
    publishedBy: v.published_by,
    note: v.note,
    approval: v.approval
      ? {
          approvedBy: v.approval.approved_by,
          approvedAt: v.approval.approved_at,
          note: v.approval.note,
        }
      : null,
    isLive: v.is_live,
  })),
})

interface RawCanvasNode {
  node_id: string
  label: string
  sublabel: string
  group: CanvasGroup
  confidence: number
  proposed: boolean
  origin: 'derived' | 'studio-authored'
  rejected: boolean
  needs_review: boolean
  review_item_id: string | null
  on_answer_path: boolean
  x: number
  y: number
}

interface RawCanvas {
  nodes: RawCanvasNode[]
  edges: {
    from: string
    to: string
    label: string
    proposed: boolean
    review_item_id: string | null
    on_answer_path: boolean
  }[]
  node_count: number
  edge_count: number
  facets: {
    all: number
    low_confidence: number
    needs_review: number
    studio_authored: number
  }
}

const toCanvas = (raw: RawCanvas): CanvasPayload => ({
  nodes: raw.nodes.map((n) => ({
    nodeId: n.node_id,
    label: n.label,
    sublabel: n.sublabel,
    group: n.group,
    confidence: n.confidence,
    proposed: n.proposed,
    origin: n.origin,
    rejected: n.rejected,
    needsReview: n.needs_review,
    reviewItemId: n.review_item_id,
    onAnswerPath: n.on_answer_path,
    x: n.x,
    y: n.y,
  })),
  edges: raw.edges.map((e) => ({
    from: e.from,
    to: e.to,
    label: e.label,
    proposed: e.proposed,
    reviewItemId: e.review_item_id,
    onAnswerPath: e.on_answer_path,
  })),
  nodeCount: raw.node_count,
  edgeCount: raw.edge_count,
  facets: {
    all: raw.facets.all,
    lowConfidence: raw.facets.low_confidence,
    needsReview: raw.facets.needs_review,
    studioAuthored: raw.facets.studio_authored,
  },
})

/** The studio's front door: only graphs that have actually been built. */
export async function listStudioGraphs(): Promise<StudioGraphsPayload> {
  const raw = validate<{
    graphs: RawStudioGraph[]
    count: number
    draft_count: number
  }>('The built graphs', await request<unknown>('/graph-studio'), STUDIO_GRAPHS_PAYLOAD)

  return {
    graphs: raw.graphs.map(toStudioGraph),
    count: raw.count,
    draftCount: raw.draft_count,
  }
}

const studioPath = (useCaseId: string) =>
  `/graph-studio/${encodeURIComponent(useCaseId)}`

export async function getGraphStudio(useCaseId: string): Promise<GraphStudioPayload> {
  return toStudio(
    validate<RawStudio>(
      'The review queue',
      await request<unknown>(studioPath(useCaseId)),
      GRAPH_STUDIO_PAYLOAD,
    ),
  )
}

/** Every action answers with the whole studio, so the page never guesses. */
const withStudio = (what: string, payload: unknown) =>
  toStudio(
    validate<{ studio: RawStudio }>(
      what,
      payload,
      shape({ studio: GRAPH_STUDIO_PAYLOAD }),
    ).studio,
  )

export async function decideReviewItem(input: {
  useCaseId: string
  itemId: string
  choice: ReviewChoice
  justification?: string
}): Promise<GraphStudioPayload> {
  return withStudio(
    'The recorded decision',
    await request<unknown>(`${studioPath(input.useCaseId)}/decisions`, {
      method: 'POST',
      body: {
        item_id: input.itemId,
        choice: input.choice,
        justification: input.justification,
      },
    }),
  )
}

export async function resolvePivot(
  useCaseId: string,
  optionId: string,
): Promise<GraphStudioPayload> {
  return withStudio(
    'The pivot decision',
    await request<unknown>(`${studioPath(useCaseId)}/pivot`, {
      method: 'POST',
      body: { option_id: optionId },
    }),
  )
}

export async function publishGraph(useCaseId: string): Promise<GraphStudioPayload> {
  return withStudio(
    'The published graph',
    await request<unknown>(`${studioPath(useCaseId)}/publish`, { method: 'POST' }),
  )
}

export async function getStudioCanvas(useCaseId: string): Promise<CanvasPayload> {
  return toCanvas(
    validate<RawCanvas>(
      'The canvas',
      await request<unknown>(`${studioPath(useCaseId)}/canvas`),
      CANVAS_PAYLOAD,
    ),
  )
}

/** Asks the *draft* graph, and comes back with the path it used. */
export async function askStudio(
  useCaseId: string,
  question: string,
): Promise<QueryAnswer> {
  const raw = validate<{
    question: string
    answerable: boolean
    reason: string
    matched: string[]
    path: string[]
    edges_used: { from: string; to: string; label: string }[]
    hops: number
    caveats: string[]
    canvas: RawCanvas
  }>(
    'The answer',
    await request<unknown>(`${studioPath(useCaseId)}/query`, {
      method: 'POST',
      body: { question },
    }),
    QUERY_PAYLOAD,
  )

  const canvas = toCanvas(raw.canvas)
  const label = (id: string) =>
    canvas.nodes.find((n) => n.nodeId === id)?.label ?? id

  return {
    question: raw.question,
    answerable: raw.answerable,
    reason: raw.reason,
    matched: raw.matched,
    path: raw.path,
    // Resolved here rather than trusted from the server: the labels the answer
    // shows must be the ones the canvas draws.
    pathLabels: raw.path.map(label),
    edgesUsed: raw.edges_used,
    hops: raw.hops,
    caveats: raw.caveats,
    canvas,
  }
}

export async function approveVersion(
  useCaseId: string,
  version: number,
  note?: string,
): Promise<GraphStudioPayload> {
  return withStudio(
    'The approved version',
    await request<unknown>(`${studioPath(useCaseId)}/versions/${version}/approve`, {
      method: 'POST',
      body: { note },
    }),
  )
}

/**
 * Point the graph at a published version — including an older one, which is
 * what a rollback is. Approval is the server's gate, not this call's.
 */
export async function activateVersion(
  useCaseId: string,
  version: number,
): Promise<GraphStudioPayload> {
  return withStudio(
    'The activated version',
    await request<unknown>(`${studioPath(useCaseId)}/versions/${version}/activate`, {
      method: 'POST',
    }),
  )
}

export async function runQualityCheck(useCaseId: string): Promise<QualityReport> {
  const raw = validate<{
    checks: { check_id: string; label: string; passed: boolean; detail: string }[]
    passed: number
    failed: number
    ran_at: string
  }>(
    'The quality report',
    await request<unknown>(`${studioPath(useCaseId)}/quality-check`, {
      method: 'POST',
    }),
    QUALITY_REPORT_PAYLOAD,
  )
  return {
    checks: raw.checks.map((c) => ({
      checkId: c.check_id,
      label: c.label,
      passed: c.passed,
      detail: c.detail,
    })),
    passed: raw.passed,
    failed: raw.failed,
    ranAt: raw.ran_at,
  }
}

export async function deleteUseCase(useCaseId: string): Promise<{ deleted: string }> {
  return validate<{ deleted: string }>(
    'The deleted use case',
    await request<unknown>(`/graph-use-cases/${encodeURIComponent(useCaseId)}`, {
      method: 'DELETE',
    }),
    DELETED_PAYLOAD,
  )
}

export async function getDb(): Promise<DbPayload> {
  const raw = await request<unknown>('/db')
  return validate<DbPayload>("The db.json document", raw, DB_PAYLOAD)
}

export async function putDb(
  db: unknown,
): Promise<{ saved: boolean; sections: DbSection[] }> {
  return validate<{ saved: boolean; sections: DbSection[] }>(
    'The saved db.json',
    await request<unknown>('/db', { method: 'PUT', body: { db } }),
    DB_SAVED_PAYLOAD,
  )
}

export async function putDbSection(
  section: string,
  value: unknown,
): Promise<{ saved: boolean; section: string; sections: DbSection[] }> {
  return validate<{ saved: boolean; section: string; sections: DbSection[] }>(
    'The saved section',
    await request<unknown>(`/db/${encodeURIComponent(section)}`, {
      method: 'PUT',
      body: { value },
    }),
    DB_SECTION_SAVED_PAYLOAD,
  )
}

/* ---------------- Ask ---------------- */

interface RawAskGraph {
  use_case_id: string
  name: string
  domain_id: string | null
  version: string
  published_at: string | null
  published_by: string | null
  citations: 'required' | 'optional'
  caveats: string[]
  suggested_questions: string[]
  entity_count: number
  relationship_count: number
}

const toAskGraph = (raw: RawAskGraph): AskGraph => ({
  useCaseId: raw.use_case_id,
  name: raw.name,
  domainId: raw.domain_id,
  version: raw.version,
  publishedAt: raw.published_at,
  publishedBy: raw.published_by,
  citations: raw.citations,
  caveats: raw.caveats,
  suggestedQuestions: raw.suggested_questions,
  entityCount: raw.entity_count,
  relationshipCount: raw.relationship_count,
})

/** The graphs that are live. An empty list is the page's whole story. */
export async function listAskGraphs(): Promise<AskGraphsPayload> {
  const raw = validate<{
    graphs: RawAskGraph[]
    count: number
    built_count: number
    draft_count: number
  }>('The live graphs', await request<unknown>('/ask'), ASK_GRAPHS_PAYLOAD)

  return {
    graphs: raw.graphs.map(toAskGraph),
    count: raw.count,
    builtCount: raw.built_count,
    draftCount: raw.draft_count,
  }
}

export async function askQuestion(
  useCaseId: string,
  question: string,
): Promise<AskAnswer> {
  const raw = validate<{
    question: string
    use_case_id: string
    graph_name: string
    version: string
    answered: boolean
    reason: string
    answer: string | null
    confidence: number | null
    entities: string[]
    path: string[]
    hops: number
    reasoning: AskStep[]
    citations: AskCitation[]
    caveats: string[]
    asked_at: string
  }>(
    'The answer',
    await request<unknown>('/ask', {
      method: 'POST',
      body: { use_case_id: useCaseId, question },
    }),
    ASK_ANSWER_PAYLOAD,
  )

  return {
    question: raw.question,
    useCaseId: raw.use_case_id,
    graphName: raw.graph_name,
    version: raw.version,
    answered: raw.answered,
    reason: raw.reason,
    answer: raw.answer,
    confidence: raw.confidence,
    entities: raw.entities,
    path: raw.path,
    hops: raw.hops,
    reasoning: raw.reasoning,
    citations: raw.citations,
    caveats: raw.caveats,
    askedAt: raw.asked_at,
  }
}

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
