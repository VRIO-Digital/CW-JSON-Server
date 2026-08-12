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
  variant,
  // `Check` is already taken in this file by the eval-checks payload type, so the
  // validator's own is aliased rather than renaming a public type.
  type Check as FieldCheck,
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
  /** What the semantic layer calls this view, e.g. `e-Manifest (shipments)`. */
  label: string
  type: string
  /** What one row is. A Gold view is only readable if its grain is stated. */
  grain: string
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
  /** What the document calls itself — `Consent Decree (modification)`. */
  doc_type_label: string
  /** The graph entity the file is about, from the extraction map. */
  linked_entity: string
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

/*
 * The semantic classes the profiler assigns. Eight of these come from the real
 * `Metadata_Profiling` workbook; `text` is only produced by the synthesised
 * fallback, and is kept so that path still validates.
 */
export type ColumnClass =
  | 'identifier'
  | 'dimension'
  | 'entity'
  | 'measure'
  | 'date'
  | 'address'
  | 'geo'
  | 'flag'
  | 'text'

export interface ProfiledColumn {
  column_id: string
  /** The profiler's own name for it (`TOTAL QUANTITY ACUTE KG`). */
  label: string
  type: string
  class: ColumnClass
  /** LLM classification confidence, shown beside the class chip. */
  confidence: number
  /** How the classification was reached — `llm` for every profiled column today. */
  derivation: string
  pii: boolean
  null_pct: number
  distinct: number
  description: string | null
  /**
   * `needs review` means the profiler was below the High band (0.85) and no
   * curator has confirmed it — not that a description is missing. Every real
   * column has one.
   */
  description_status: 'needs review' | 'described'
}

export interface ProfiledTable {
  table_id: string
  label: string
  type: string
  grain: string
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
  /** `address` and `geo` together — both answer "where". */
  location: number
  flags: number
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

/**
 * Where a document's extracted entity landed in the graph.
 *
 * Read from the extraction map, never derived — this is the join between the
 * unstructured side and the manifest stream, so `linked_manifests` is a real
 * count from that workbook and not a plausible number.
 */
export interface DocumentResolution {
  extraction_id: string
  extracted_entity: string
  /** `Generator (facility)`, `Transporter`, … */
  entity_type: string
  /** The graph node id, e.g. `FAC:LAD727050419`. */
  resolved_node: string
  resolved_facility: string
  state: string
  linked_manifests: number
  confidence: number
}

export interface ProfiledDocument {
  document_id: string
  name: string
  mime_type: string
  doc_type: string
  doc_type_label: string
  linked_entity: string
  /** Null when nothing resolved — the panel says so rather than showing nothing. */
  resolution: DocumentResolution | null
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
  consent_decrees: number
  complaints: number
  settlements: number
  cafos: number
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
  /** `measure` is the third: a cross-basis measure is neither entity nor edge. */
  kind: 'relationship' | 'entity' | 'measure'
  title: string
  detail: string
  confidence: number
  /** The triage lane the row arrived in, which is the package's, not derived here. */
  band: 'High' | 'Medium' | 'Low' | null
  floor: string | null
  /** 'standard' or 'causal' — the fallback family when a row states no buttons. */
  actionSet: string
  /**
   * The row's own buttons. `label` is what it says in the row's terms ("Keep
   * distinct"); `choice` is what gets recorded, and stays one of the fixed set so a
   * decision means the same thing to the canvas on every row.
   */
  actions: { choice: ReviewChoice; label: string }[]
  /** What the deriver had to go on, as the package stated it. */
  evidence: string[]
  /** Canvas node ids the row is *about* — not necessarily what it makes proposed. */
  graphRefs: string[]
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
  /**
   * Null for a recorded answer's evidence rows. The query set states one
   * confidence for the whole answer, so a number per source view would be
   * invented — and the page shows the figure only where there is one.
   */
  confidence: number | null
}

/* ---------------- Ask: the blocks a recorded answer is made of ---------------- */

/**
 * One piece of an answer.
 *
 * A recorded answer is an ordered list of these, exactly as the tenant wrote it:
 * prose, a row of figures, a chart, a table. The discriminant is `type`, and an
 * unknown one is refused at the boundary rather than rendered as a blank — a
 * missing block in the middle of an answer reads as a gap in the reasoning.
 */
export type AnswerBlock =
  | { type: 'text'; markdown: string }
  | { type: 'metric'; items: AnswerMetric[] }
  | {
      type: 'chart'
      chart: 'bar' | 'line' | 'pie' | 'donut'
      title: string
      x_label?: string | null
      y_label?: string | null
      note?: string | null
      data: { label: string; value: number }[]
    }
  | { type: 'table'; title: string; columns: string[]; rows: AnswerCell[][] }

/** A table cell or a metric value: the tenant writes counts as numbers. */
export type AnswerCell = string | number

export interface AnswerMetric {
  label: string
  /** A figure or a short string — the tenant's own value, rendered as given. */
  value: number | string
  unit?: string | null
  /** `risk` and `good` are the only two, and they carry an icon, never colour alone. */
  flag?: 'good' | 'risk' | null
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
  /** The one-line headline of a recorded answer; null when the graph walk answered. */
  summary: string | null
  /** Empty when the walk answered — it produces prose, not blocks. */
  blocks: AnswerBlock[]
  /** Which recorded answer this was, or null. Provenance, not decoration. */
  answerId: string | null
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
  /** Why it is a pivot and not a queue row — the server's sentence, not the page's. */
  whyPivot: string
  confidence: number
  band: 'High' | 'Medium' | 'Low' | null
  floor: string
  evidence: string[]
  graphRefs: string[]
  options: PivotOption[]
  open: boolean
  chosen: string | null
}

/**
 * One version of a graph — that is, one build of it.
 *
 * Immutable and content-addressed: `sha256` is the identity, and two builds of one
 * config differ there and nowhere else. Publishing flips `published` on exactly one
 * row; it never rewrites a row.
 */
export interface GraphVersion {
  /** The content hash. The identity, and what publish/unpublish name. */
  sha256: string
  graphId: string
  /** The config this is a version of — shared by every build of one brief. */
  configVersion: string
  entities: number
  relationships: number
  /** The build that produced it, so a version can be traced to its run. */
  fromJob: string
  createdAt: string
  /**
   * Whether the publish gate was clear when this build finished. `unknown` is not
   * a failure — nobody had settled the queue and pivot yet, so nothing checked it.
   */
  gate: 'passed' | 'unknown'
  /** At most one row is true. Ask queries that one and no other. */
  published: boolean
}

/* ---------------- Canvas ---------------- */

/**
 * Which legend colour a node takes — its **origin class**, not its type.
 *
 * A source row becomes an entity or event node, an uploaded document becomes a
 * document node, a raw name resolves through an alias, and `schema` is the pair of
 * element classes that are not instances: the type-level concepts and the measure
 * elements. Four categories, because a categorical palette stops being reliably
 * distinguishable past four when any two marks can end up adjacent; the ontology
 * type rides on `type` and `elementClass` instead.
 *
 * `dimension` was here until the graph was rebuilt. Column values are no longer
 * promoted to nodes — a waste code is an attribute of a shipment — so the class has
 * no members by decision, and a legend row for it would advertise a claim the graph
 * denies.
 */
export type CanvasGroup = 'row' | 'schema' | 'document' | 'alias'

export interface CanvasNode {
  nodeId: string
  label: string
  sublabel: string
  /** The ontology's own type — Facility, Manifest, Evaluation, Enforcement, … */
  type: string
  /**
   * The build model's element class. A `thin_instance` carries identity and
   * provenance only — its values federate at query time and are not in the graph —
   * while a `concept` is type-level and a `measure_element` is a quantity promoted
   * so relationships can point at it.
   */
  elementClass: 'thin_instance' | 'concept' | 'measure_element'
  /** The catalogue object it was built from, e.g. `epa_hazwaste.e_manifest`. */
  source: string
  /** Relationships carried. The node's radius is this, not a decorative size. */
  degree: number
  /** Radius in canvas units, from the server so a reload draws one picture. */
  r: number
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
  /** The graph's own id, which is how a recorded sanity check names its hops. */
  edgeId: string
  from: string
  to: string
  label: string
  /** The relationship's evidence, verbatim: `manifests=46; total_tons=1061.8; …`. */
  detail: string
  proposed: boolean
  reviewItemId: string | null
  onAnswerPath: boolean
}

export interface CanvasFacets {
  all: number
  lowConfidence: number
  needsReview: number
  studioAuthored: number
  /** One per origin class, so the legend can carry counts and filter by them. */
  groups: { key: CanvasGroup; count: number }[]
  /** One per ontology type — what the ring encodes. Rendered in the legend's order. */
  types: { key: string; count: number }[]
}

export interface CanvasPayload {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  nodeCount: number
  edgeCount: number
  facets: CanvasFacets
}

/** One relationship an answer travelled, as a sentence's worth of parts. */
export interface QueryHop {
  edgeId: string
  from: string
  to: string
  label: string
  fromLabel: string
  toLabel: string
  /** True where the hop's review row is still open — the answer is provisional. */
  proposed: boolean
}

/** A chip of context a recorded check states alongside its verdict. */
export interface QueryContext {
  /** What kind of thing it is — `document`, `traversal`, `measure`, `pending`, … */
  chip: string
  label: string
  meta: string
  /** False where the chip is a caveat rather than a confirmation. */
  ok: boolean
}

/**
 * What the draft graph could — or could not — answer.
 *
 * `recorded` says which route answered. A recorded check is one of the demo
 * package's five, and it brings the verdict, the Cypher the engine would plan, and
 * its cost against the budget; a derived walk brings `pathLabels`, the chain its
 * breadth-first search actually followed. The recorded fields are `null` on a walk,
 * and `pathLabels` is empty on a recorded check — its traversal is a sub-graph, not
 * a chain, so its hops are in `edgesUsed` and joining them with arrows would claim
 * a route nobody walked.
 */
export interface QueryAnswer {
  question: string
  answerable: boolean
  reason: string
  matched: string[]
  path: string[]
  pathLabels: string[]
  edgesUsed: QueryHop[]
  hops: number
  /** An answer leaning on an undecided edge is answerable *and* provisional. */
  caveats: string[]
  recorded: boolean
  checkId: string | null
  /** The hero question this check is a check *on*. */
  heroQuestionId: string | null
  /** How it matched — "the same question", or the words it shared. */
  matchedHow: string | null
  verdict: string | null
  verdictBody: string | null
  context: QueryContext[]
  plan: string | null
  costUsd: number | null
  budgetUsd: number | null
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
  /** The recorded checks, as the Query tab's chips. A chip is a promise already made. */
  sanityChecks: { checkId: string; heroQuestionId: string; question: string }[]
  batchResolved: number
  batchTotal: number
  publish: { blocked: boolean; reasons: string[]; explanation: string }
  /** Every build that produced a version, newest first. */
  versions: GraphVersion[]
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
  /**
   * Hero questions only, and only where a use case stated one. It pre-ticks the
   * High box; the user still decides, because accepting is theirs.
   */
  priority?: 'high' | 'normal'
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

/** One substep inside a stage — the inner work, named the same way. */
export interface BuildStep {
  key: string
  state: 'pending' | 'running' | 'complete'
}

/** One stage of the build pipeline, and where it has got to. */
export interface BuildStage {
  /** The platform's own name, so a row matches a log line. */
  key: string
  state: 'pending' | 'running' | 'complete'
  /**
   * What the stage is actually doing. Never empty: a stage with no substeps would
   * be a row that claims work nobody can see, which is what this replaced.
   */
  steps: BuildStep[]
}

/**
 * One build of a graph. Every stage is present from the first response, so the
 * panel shows the whole pipeline and fills it in rather than growing a row.
 */
export interface GraphBuild {
  buildId: string
  useCaseId: string
  status: 'running' | 'complete'
  stageIndex: number
  stageTotal: number
  /** Progress in substeps — what actually advances, and what the header counts. */
  stepIndex: number
  stepTotal: number
  /** How long one substep takes, per the server. The page's ETA derives from it. */
  stepMs: number
  stages: BuildStage[]
  packageId: string
  graphVersion: string
  /** What Publish would make live — the studio's working draft number. */
  configVersion: string
  startedAt: string
  finishedAt: string | null
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
        shape({
          table_id: str,
          label: str,
          type: str,
          grain: str,
          columns: num,
          rows: num,
          profiled: bool,
        }),
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
          doc_type_label: str,
          linked_entity: str,
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
    location: num,
    flags: num,
  }),
  datasets: arrayOf(
    shape({
      dataset_id: str,
      table_count: num,
      column_count: num,
      tables: arrayOf(
        shape({
          table_id: str,
          label: str,
          type: str,
          grain: str,
          rows: num,
          column_count: num,
          columns: arrayOf(
            shape({
              column_id: str,
              label: str,
              type: str,
              class: oneOf([
                'identifier',
                'dimension',
                'entity',
                'measure',
                'date',
                'address',
                'geo',
                'flag',
                'text',
              ]),
              confidence: num,
              derivation: str,
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
    consent_decrees: num,
    complaints: num,
    settlements: num,
    cafos: num,
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
          doc_type_label: str,
          linked_entity: str,
          /* nullable() accepts an absent key as well as null, so this checks the
             shape when it is there and tolerates a document that resolved to
             nothing. */
          resolution: nullable(
            shape({
              extraction_id: str,
              extracted_entity: str,
              entity_type: str,
              resolved_node: str,
              resolved_facility: str,
              state: str,
              linked_manifests: num,
              confidence: num,
            }),
          ),
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
  suggestions: arrayOf(
    shape({
      id: str,
      name: str,
      detail: str,
      why: str,
      // Absent on personas, KPIs and formats, and on any question no use case
      // stated a priority for — nullable checks the type, not the presence.
      priority: nullable(oneOf(['high', 'normal'])),
    }),
  ),
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

const GRAPH_BUILD = shape({
  build_id: str,
  use_case_id: str,
  status: oneOf(['running', 'complete']),
  stage_index: num,
  stage_total: num,
  step_index: num,
  step_total: num,
  step_ms: num,
  stages: arrayOf(
    shape({
      key: str,
      state: oneOf(['pending', 'running', 'complete']),
      steps: arrayOf(shape({ key: str, state: oneOf(['pending', 'running', 'complete']) })),
    }),
  ),
  package_id: str,
  graph_version: str,
  config_version: str,
  started_at: str,
  finished_at: nullable(str),
})

const GRAPH_BUILDS_PAYLOAD = shape({
  use_case_id: str,
  builds: arrayOf(GRAPH_BUILD),
  count: num,
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
  /* `measure` joined the two on the rebuild: a cross-basis measure is a third kind
     of thing to review, neither an entity nor a relationship. */
  kind: oneOf(['relationship', 'entity', 'measure']),
  title: str,
  detail: str,
  confidence: num,
  /* The triage lane the row arrived in. Nullable rather than absent-tolerant would
     hide a server that stopped sending it, so it is checked as a value. */
  band: nullable(oneOf(['High', 'Medium', 'Low'])),
  floor: nullable(str),
  action_set: str,
  /* The row's own buttons. `choice` is what gets recorded and `label` is what the
     button says, so a row can offer "Keep distinct" without inventing a fifth
     recorded outcome. */
  actions: arrayOf(shape({ choice: str, label: str })),
  evidence: arrayOf(str),
  graph_refs: arrayOf(str),
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
    /* Why this is a pivot rather than a queue row — the sentence the page prints
       above the options, so it is the server's and not the component's. */
    why_pivot: str,
    confidence: num,
    band: nullable(oneOf(['High', 'Medium', 'Low'])),
    floor: str,
    evidence: arrayOf(str),
    graph_refs: arrayOf(str),
    options: arrayOf(shape({ option_id: str, label: str, consequence: str })),
    open: bool,
    chosen: nullable(str),
  }),
  pivot_count: num,
  /* The recorded sanity checks, as chips. Question and hero ref only — the verdict
     and the plan stay behind the query, so a chip cannot show an answer nobody
     asked for. */
  sanity_checks: arrayOf(
    shape({ check_id: str, hero_question_id: str, question: str }),
  ),
  batch_resolved: num,
  batch_total: num,
  publish: shape({ blocked: bool, reasons: arrayOf(str), explanation: str }),
  versions: arrayOf(
    shape({
      sha256: str,
      graph_id: str,
      config_version: str,
      entities: num,
      relationships: num,
      from_job: str,
      created_at: str,
      gate: oneOf(['passed', 'unknown']),
      published: bool,
    }),
  ),
})

const CANVAS_NODE = shape({
  node_id: str,
  label: str,
  sublabel: str,
  type: str,
  /* Which of the build model's three element classes the node is. The colour folds
     `concept` and `measure_element` into one hue, so this is where the distinction
     survives — and it is the distinction the graph rebuild was about. */
  element_class: oneOf(['thin_instance', 'concept', 'measure_element']),
  source: str,
  degree: num,
  r: num,
  group: oneOf(['row', 'schema', 'document', 'alias']),
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
  /* The graph's own edge id. A recorded sanity check names its hops by id, so the
     highlight is the exact relationships the answer used. */
  edge_id: str,
  from: str,
  to: str,
  label: str,
  detail: str,
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
    groups: arrayOf(
      shape({ key: oneOf(['row', 'schema', 'document', 'alias']), count: num }),
    ),
    /* Per ontology type — what the ring encodes. Not a `oneOf`: the type list is the
       graph's, and a new type must show up in the legend rather than fail here. */
    types: arrayOf(shape({ key: str, count: num })),
  }),
})

/*
 * A studio answer, from either route.
 *
 * The recorded fields are nullable because a derived walk has none of them — and
 * `recorded` is the boolean that says which route answered, so a written verdict is
 * never read as something the walk produced. Nullable rather than optional: a server
 * that stopped sending `recorded` would otherwise read as "derived" on every answer.
 */
const QUERY_PAYLOAD = shape({
  question: str,
  answerable: bool,
  reason: str,
  matched: arrayOf(str),
  path: arrayOf(str),
  path_labels: arrayOf(str),
  edges_used: arrayOf(
    shape({
      edge_id: str,
      from: str,
      to: str,
      label: str,
      from_label: str,
      to_label: str,
      proposed: bool,
    }),
  ),
  hops: num,
  caveats: arrayOf(str),
  recorded: bool,
  check_id: nullable(str),
  hero_question_id: nullable(str),
  matched_how: nullable(str),
  verdict: nullable(str),
  verdict_body: nullable(str),
  context: arrayOf(shape({ chip: str, label: str, meta: str, ok: bool })),
  plan: nullable(str),
  cost_usd: nullable(num),
  budget_usd: nullable(num),
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
/**
 * One block of a recorded answer, by its `type`.
 *
 * `value` on a metric is `number | string` because the tenant writes both ("15",
 * "TXD000719518"), and coercing either way would rewrite their figure.
 */
/** A figure the tenant wrote either way — a number, or text like an EPA id. */
const cell: FieldCheck = (v, path, issues) => {
  if (typeof v !== 'number' && typeof v !== 'string') {
    issues.push(`${path} should be a number or a string, got ${typeof v}`)
  }
}

const ANSWER_BLOCK = variant('type', {
  text: shape({ type: str, markdown: str }),
  metric: shape({
    type: str,
    items: arrayOf(
      shape({
        label: str,
        value: cell,
        unit: nullable(str),
        flag: nullable(oneOf(['good', 'risk'])),
      }),
    ),
  }),
  chart: shape({
    type: str,
    chart: oneOf(['bar', 'line', 'pie', 'donut']),
    title: str,
    x_label: nullable(str),
    y_label: nullable(str),
    note: nullable(str),
    data: arrayOf(shape({ label: str, value: num })),
  }),
  table: shape({
    type: str,
    title: str,
    columns: arrayOf(str),
    /*
     * A cell is a string OR a number — the corpus writes counts as numbers and
     * everything else as text. Declared as `str` first, which would have refused
     * every table in the set: the boundary check caught it before a browser did,
     * which is the whole point of having one.
     */
    rows: arrayOf(arrayOf(cell)),
  }),
})

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
  citations: arrayOf(shape({ label: str, detail: str, confidence: nullable(num) })),
  caveats: arrayOf(str),
  asked_at: str,
  summary: nullable(str),
  blocks: arrayOf(ANSWER_BLOCK),
  answer_id: nullable(str),
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

/**
 * Who is connecting has to be *sent*, because the server does not know it: the
 * console's identity is client-held (`useAuthStore`), so the consent callback
 * echoes back the email it is given as the connecting account. Omit it and the
 * server answers with the seeded `google_account` — which is how the wizard once
 * told every user they had connected as one person from `db.json`.
 */
function callbackPath(state: string, provider: OAuthProvider, signedInAs?: string) {
  const as = signedInAs ? `&as=${encodeURIComponent(signedInAs)}` : ''
  return `/sources/oauth/callback?state=${encodeURIComponent(state)}&provider=${provider}${as}`
}

export async function oauthCallback(
  state: string,
  signedInAs?: string,
): Promise<OAuthCallback> {
  const raw = await request<unknown>(callbackPath(state, 'bigquery', signedInAs))
  return validate<OAuthCallback>('The Google sign-in result', raw, OAUTH_CALLBACK_PAYLOAD)
}

export async function driveOauthCallback(
  state: string,
  signedInAs?: string,
): Promise<DriveOAuthCallback> {
  const raw = await request<unknown>(callbackPath(state, 'drive', signedInAs))
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
  kind: 'relationship' | 'entity' | 'measure'
  title: string
  detail: string
  confidence: number
  band: 'High' | 'Medium' | 'Low' | null
  floor: string | null
  action_set: string
  actions: { choice: string; label: string }[]
  evidence: string[]
  graph_refs: string[]
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
    why_pivot: string
    confidence: number
    band: 'High' | 'Medium' | 'Low' | null
    floor: string
    evidence: string[]
    graph_refs: string[]
    options: { option_id: string; label: string; consequence: string }[]
    open: boolean
    chosen: string | null
  }
  pivot_count: number
  sanity_checks: { check_id: string; hero_question_id: string; question: string }[]
  batch_resolved: number
  batch_total: number
  publish: { blocked: boolean; reasons: string[]; explanation: string }
  versions: {
    sha256: string
    graph_id: string
    config_version: string
    entities: number
    relationships: number
    from_job: string
    created_at: string
    gate: 'passed' | 'unknown'
    published: boolean
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
  band: i.band,
  floor: i.floor,
  actionSet: i.action_set,
  actions: i.actions.map((a) => ({ choice: a.choice as ReviewChoice, label: a.label })),
  evidence: i.evidence,
  graphRefs: i.graph_refs,
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
    whyPivot: raw.pivot.why_pivot,
    confidence: raw.pivot.confidence,
    band: raw.pivot.band,
    floor: raw.pivot.floor,
    evidence: raw.pivot.evidence,
    graphRefs: raw.pivot.graph_refs,
    options: raw.pivot.options.map((o) => ({
      optionId: o.option_id,
      label: o.label,
      consequence: o.consequence,
    })),
    open: raw.pivot.open,
    chosen: raw.pivot.chosen,
  },
  pivotCount: raw.pivot_count,
  sanityChecks: raw.sanity_checks.map((c) => ({
    checkId: c.check_id,
    heroQuestionId: c.hero_question_id,
    question: c.question,
  })),
  batchResolved: raw.batch_resolved,
  batchTotal: raw.batch_total,
  publish: raw.publish,
  versions: raw.versions.map((v) => ({
    sha256: v.sha256,
    graphId: v.graph_id,
    configVersion: v.config_version,
    entities: v.entities,
    relationships: v.relationships,
    fromJob: v.from_job,
    createdAt: v.created_at,
    gate: v.gate,
    published: v.published,
  })),
})

interface RawCanvasNode {
  node_id: string
  label: string
  sublabel: string
  type: string
  element_class: 'thin_instance' | 'concept' | 'measure_element'
  source: string
  degree: number
  r: number
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
    edge_id: string
    from: string
    to: string
    label: string
    detail: string
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
    groups: { key: CanvasGroup; count: number }[]
    types: { key: string; count: number }[]
  }
}

const toCanvas = (raw: RawCanvas): CanvasPayload => ({
  nodes: raw.nodes.map((n) => ({
    nodeId: n.node_id,
    label: n.label,
    sublabel: n.sublabel,
    type: n.type,
    elementClass: n.element_class,
    source: n.source,
    degree: n.degree,
    r: n.r,
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
    edgeId: e.edge_id,
    from: e.from,
    to: e.to,
    label: e.label,
    detail: e.detail,
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
    groups: raw.facets.groups,
    types: raw.facets.types,
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

type RawGraphBuild = {
  build_id: string
  use_case_id: string
  status: 'running' | 'complete'
  stage_index: number
  stage_total: number
  step_index: number
  step_total: number
  step_ms: number
  stages: BuildStage[]
  package_id: string
  graph_version: string
  config_version: string
  started_at: string
  finished_at: string | null
}

const toGraphBuild = (raw: RawGraphBuild): GraphBuild => ({
  buildId: raw.build_id,
  useCaseId: raw.use_case_id,
  status: raw.status,
  stageIndex: raw.stage_index,
  stageTotal: raw.stage_total,
  stepIndex: raw.step_index,
  stepTotal: raw.step_total,
  stepMs: raw.step_ms,
  stages: raw.stages,
  packageId: raw.package_id,
  graphVersion: raw.graph_version,
  configVersion: raw.config_version,
  startedAt: raw.started_at,
  finishedAt: raw.finished_at,
})

const studioBuildsPath = (useCaseId: string) =>
  `/graph-studio/${encodeURIComponent(useCaseId)}/builds`

/** Builds, or rebuilds. Answers 202 with a queued run, not a finished graph. */
export async function startGraphBuild(useCaseId: string): Promise<GraphBuild> {
  return toGraphBuild(
    validate<RawGraphBuild>(
      'The graph build',
      await request<unknown>(studioBuildsPath(useCaseId), { method: 'POST' }),
      GRAPH_BUILD,
    ),
  )
}

/** This graph's runs, newest first. */
export async function listGraphBuilds(useCaseId: string): Promise<GraphBuild[]> {
  const raw = validate<{ builds: RawGraphBuild[] }>(
    'The build history',
    await request<unknown>(studioBuildsPath(useCaseId)),
    GRAPH_BUILDS_PAYLOAD,
  )
  return raw.builds.map(toGraphBuild)
}

export async function getGraphBuild(
  useCaseId: string,
  buildId: string,
): Promise<GraphBuild> {
  return toGraphBuild(
    validate<RawGraphBuild>(
      'The graph build',
      await request<unknown>(
        `${studioBuildsPath(useCaseId)}/${encodeURIComponent(buildId)}`,
      ),
      GRAPH_BUILD,
    ),
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
    path_labels: string[]
    edges_used: {
      edge_id: string
      from: string
      to: string
      label: string
      from_label: string
      to_label: string
      proposed: boolean
    }[]
    hops: number
    caveats: string[]
    recorded: boolean
    check_id: string | null
    hero_question_id: string | null
    matched_how: string | null
    verdict: string | null
    verdict_body: string | null
    context: { chip: string; label: string; meta: string; ok: boolean }[]
    plan: string | null
    cost_usd: number | null
    budget_usd: number | null
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
    /*
     * A chain only where there is one. For a derived walk the labels are resolved
     * here rather than trusted, so what the answer shows is what the canvas draws;
     * for a recorded check the server sends none, because its traversal is a
     * sub-graph and arrow-joining its ids would claim a route nobody walked. The
     * hops are in `edgesUsed` either way.
     */
    pathLabels: raw.recorded ? raw.path_labels : raw.path.map(label),
    edgesUsed: raw.edges_used.map((e) => ({
      edgeId: e.edge_id,
      from: e.from,
      to: e.to,
      label: e.label,
      fromLabel: e.from_label,
      toLabel: e.to_label,
      proposed: e.proposed,
    })),
    hops: raw.hops,
    caveats: raw.caveats,
    recorded: raw.recorded,
    checkId: raw.check_id,
    heroQuestionId: raw.hero_question_id,
    matchedHow: raw.matched_how,
    verdict: raw.verdict,
    verdictBody: raw.verdict_body,
    context: raw.context,
    plan: raw.plan,
    costUsd: raw.cost_usd,
    budgetUsd: raw.budget_usd,
    canvas,
  }
}

/**
 * Publish one version — gate Ask's access to that exact content.
 *
 * Named by content hash, not by a number: what is published is a specific build.
 * Publishing an older row is what a rollback is, and the server's gate still
 * refuses an unreviewed graph whichever row is chosen.
 */
export async function publishVersion(
  useCaseId: string,
  sha256: string,
): Promise<GraphStudioPayload> {
  return withStudio(
    'The published version',
    await request<unknown>(`${studioPath(useCaseId)}/versions/${sha256}/publish`, {
      method: 'POST',
    }),
  )
}

/** Take the published version out of Ask. The version itself is untouched. */
export async function unpublishVersion(
  useCaseId: string,
  sha256: string,
): Promise<GraphStudioPayload> {
  return withStudio(
    'The unpublished version',
    await request<unknown>(`${studioPath(useCaseId)}/versions/${sha256}/unpublish`, {
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

type RawAskAnswer = {
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
  summary: string | null
  blocks: AnswerBlock[]
  answer_id: string | null
}

const toAskAnswer = (raw: RawAskAnswer): AskAnswer => ({
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
  summary: raw.summary,
  blocks: raw.blocks,
  answerId: raw.answer_id,
})

/** What arrives while an answer is being composed. */
export type AskEvent =
  | { kind: 'stage'; step: string; detail: string }
  | {
      kind: 'summary'
      answered: boolean
      summary: string | null
      reason: string
      answer: string | null
    }
  | { kind: 'block'; index: number; block: AnswerBlock }
  | { kind: 'done'; answer: AskAnswer }

const ASK_STAGE_EVENT = shape({ step: str, detail: str })
const ASK_SUMMARY_EVENT = shape({
  answered: bool,
  summary: nullable(str),
  reason: str,
  answer: nullable(str),
})
const ASK_BLOCK_EVENT = shape({ index: num, block: ANSWER_BLOCK })

/**
 * Asks, and reports the answer as it is composed.
 *
 * `/ask` answers with an event stream, so this cannot go through the shared
 * transport helper — that reads one JSON body. **Every event is still
 * validated**, by its own schema, and the final `done` carries the whole envelope
 * so the answer the store keeps has been checked as one object rather than
 * assembled from fragments the page happened to receive.
 *
 * (The words above avoid naming that helper with parentheses on purpose:
 * `check-docs` finds fetchers by scanning declaration bodies for it, and a
 * mention in a comment made the schema *above* this one look like an unvalidated
 * fetcher. The check is deliberately crude — it is cheaper to word around it than
 * to teach it to parse.)
 *
 * A refusal still arrives as a JSON 400 before the stream opens, so the existing
 * `ApiError` path is unchanged: only the success case streams.
 */
export async function askQuestionStreaming(
  useCaseId: string,
  question: string,
  onEvent: (event: AskEvent) => void,
): Promise<AskAnswer> {
  const response = await fetch(`${BASE}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ use_case_id: useCaseId, question }),
  })

  if (!response.ok) {
    // Same shape of failure as request(): the server's own sentence, verbatim.
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(
      body?.error ?? `The answer could not be read (HTTP ${response.status}).`,
      response.status,
    )
  }
  if (!response.body) {
    throw new ApiError('The answer stream was empty — restart the mock server.', 500)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final: AskAnswer | null = null

  const handle = (event: string, data: unknown) => {
    if (event === 'stage') {
      const e = validate<{ step: string; detail: string }>(
        'An answer step',
        data,
        ASK_STAGE_EVENT,
      )
      onEvent({ kind: 'stage', ...e })
    } else if (event === 'summary') {
      const e = validate<{
        answered: boolean
        summary: string | null
        reason: string
        answer: string | null
      }>('The answer summary', data, ASK_SUMMARY_EVENT)
      onEvent({ kind: 'summary', ...e })
    } else if (event === 'block') {
      const e = validate<{ index: number; block: AnswerBlock }>(
        'An answer block',
        data,
        ASK_BLOCK_EVENT,
      )
      onEvent({ kind: 'block', ...e })
    } else if (event === 'done') {
      final = toAskAnswer(validate<RawAskAnswer>('The answer', data, ASK_ANSWER_PAYLOAD))
      onEvent({ kind: 'done', answer: final })
    }
    // An unknown event name is ignored on purpose: a newer server adding one
    // must not break an older page, and nothing is rendered from it.
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    // SSE frames are separated by a blank line; a partial frame stays buffered.
    let cut = buffer.indexOf('\n\n')
    while (cut >= 0) {
      const frame = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const name = frame.match(/^event: (.+)$/m)?.[1]
      const payload = frame.match(/^data: ([\s\S]+)$/m)?.[1]
      if (name && payload) handle(name, JSON.parse(payload) as unknown)
      cut = buffer.indexOf('\n\n')
    }
    if (done) break
  }

  if (!final) {
    throw new ApiError(
      'The answer stream ended before the answer did — restart the mock server (npm run mock) and ask again.',
      500,
    )
  }
  return final
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

/* ---------------- The What-if lens ---------------- */

/**
 * A candidate generator — one possible load.
 *
 * Every figure here is a federal record the graph already holds, not a projection:
 * `evaluations` and `violations` come from RCRAInfo, `enforcement` and `penalty` from
 * ECHO, `manifests` and `tons` from e-Manifest, `consentDecree` from an extracted
 * document. Nothing on this page is predicted.
 */
export interface WhatIfGenerator {
  id: string
  name: string
  state: string
  risk: 'high' | 'med' | 'low'
  transporter: string
  evaluations: number
  violations: number
  enforcement: number
  penalty: number
  tons: number
  manifests: number
  consentDecree: boolean
  lastEnforcement: string
}

/** A measure that can be watched, because the graph already computes it. */
export interface WhatIfMeasure {
  key: string
  label: string
  unit: string
  /** Which federal source it comes from — ECHO, RCRA, DOC. */
  source: string
  /** The relationship or measure element it grounds to. */
  grounds: string
  /** True where the measure is inherited from the load rather than the facility's own. */
  inherited: boolean
}

/** A pool of candidate loads, carrying its own count. */
export interface WhatIfPool {
  key: string
  label: string
  count: number
}

/**
 * The inverse question, per pool: how many more enforcement-carrying loads fit.
 *
 * `room` is `null` where nothing in the pool carries enforcement — there is no break
 * point to state, and a `0` there would read as "no room left" when the truth is "no
 * load in this pool moves the figure".
 */
export interface WhatIfHeadroom {
  pool: string
  room: number | null
  avg: number | null
  carrying: number
  appetite: number
}

/** A saved scenario. Stores the admitted load, never the figures. */
export interface WhatIfSaved {
  savedId: string
  name: string
  generatorId: string
}

/** One watched measure, computed for one candidate load. */
export interface WhatIfScenarioMeasure {
  key: string
  label: string
  source: string
  grounds: string
  unit: string
  /** The figure judged against the appetite line: baseline plus what is inherited. */
  value: number | boolean
  valueText: string
  /** What this load brings. */
  inherited: number | boolean
  inheritedText: string
  /** What the facility already carries, or `null` where it keeps no running count. */
  baseline: number | boolean | null
  baselineText: string | null
  appetite: number | null
  /** True where `value` crosses the facility's stated appetite. */
  breached: boolean
  /** False where this load moves the figure not at all — a real answer. */
  moved: boolean
}

/** A node in the subgraph one admitted load traverses. */
export interface WhatIfSubgraphNode {
  key: string
  label: string
  risk?: 'high' | 'med' | 'low'
}

/** One scenario column: what admitting this load would inherit. */
export interface WhatIfScenario {
  generator: WhatIfGenerator
  measures: WhatIfScenarioMeasure[]
  /** The federal record behind each figure. "No value is invented" is the promise. */
  sources: { key: string; label: string; line: string }[]
  /** True where anything at all connects to this load. */
  flagged: boolean
  /** Said plainly when nothing does — an empty trace panel reads as "not checked". */
  cleanNote: string | null
  /** What the scenario cannot see, stated rather than hidden. */
  residualNote: string
  subgraph: { nodes: WhatIfSubgraphNode[]; relationships: string[] }
}

/**
 * What the graph said about a typed measure.
 *
 * Three verdicts, and the refusal is the important one: a measure that does not ground
 * to a relationship cannot be watched, and saying so is the difference between a
 * governed measure and a made-up one.
 */
export interface WhatIfResolution {
  text: string
  verdict: 'resolved' | 'grounds_not_inherited' | 'refused'
  /** The measure it added, or null for the two verdicts that add nothing. */
  measureKey: string | null
  tone: 'ok' | 'warn' | 'bad'
  title: string
  body: string
}

/** The copy the page prints. All of it server-side, none of it written in a component. */
export interface WhatIfCopy {
  pageTitle: string
  banner: string
  subtitle: string
  overlayPill: string
  dataNote: string
  tabs: { key: string; label: string }[]
}

export interface WhatIfAuthoringStep {
  n: number
  key: string
  title: string
  heading: string
  help: string
}

export interface WhatIfFrame {
  connectedSources: number
  facility: {
    id: string
    name: string
    role: string
    baseline: Record<string, number>
    appetite: Record<string, number>
  } | null
  generators: WhatIfGenerator[]
  measures: WhatIfMeasure[]
  pools: WhatIfPool[]
  headroom: WhatIfHeadroom[]
  saved: WhatIfSaved[]
  copy: WhatIfCopy
  defaults: { tab: string; step: number; count: number; watch: string[]; pool: string }
  authoring: {
    steps: WhatIfAuthoringStep[]
    addMeasure: { label: string; placeholder: string; button: string; help: string }
    previewRows: number
    reviewNote: string
    scenarioCount: { heading: string; help: string; options: number[]; default: number }
    cta: [string, string, string]
    graphLink: string
  }
  runtime: {
    compare: { min: number; max: number; default: number; help: string }
    card: {
      loadLabel: string
      namePlaceholder: string
      traceLink: string
      traceHeader: string
      graphLink: string
    }
    headroom: { label: string; sentence: string; help: string }
    library: {
      title: string
      empty: string
      fullHelp: string
      saveBtn: string
      updateBtn: string
      savedFlag: string
      addBtn: string
    }
    closingNote: string
  }
  graphReference: { nodeTypes: { key: string; label: string }[]; relationships: string[] }
}

/*
 * The schemas. Every field the page reads is checked at the boundary, because `/db`
 * lets a user edit this data live and a measure reading `undefined` renders as "no
 * inherited risk" — an answer, and the wrong one.
 */

/** A measure's value is a number or a boolean: a consent decree is yes/no, and
 *  coercing it to 0/1 would print "0" where the answer is "no". */
const numOrBool: FieldCheck = (v, path, issues) => {
  if (typeof v !== 'number' && typeof v !== 'boolean') {
    issues.push(`${path} should be a number or a boolean, got ${typeof v}`)
  }
}

/** An object whose keys are the tenant's, so the keys are not enumerable here — but
 *  it still has to *be* an object, which is what a bare `shape({})` asserts. */
const objectOnly = shape({})

const WHATIF_GENERATOR = shape({
  id: str,
  name: str,
  state: str,
  risk: oneOf(['high', 'med', 'low']),
  transporter: str,
  evaluations: num,
  violations: num,
  enforcement: num,
  penalty: num,
  tons: num,
  manifests: num,
  consent_decree: bool,
  last_enforcement: str,
})

const WHATIF_MEASURE = shape({
  key: str,
  label: str,
  unit: str,
  source: str,
  grounds: str,
  inherited: bool,
})

const WHATIF_SAVED = shape({ saved_id: str, name: str, generator_id: str })

const WHATIF_FRAME = shape({
  connected_sources: num,
  /* Null before a source is connected — the page shows NoSourceConnected, and a
     fabricated facility would be a claim about a tenant with no data. */
  facility: nullable(
    shape({ id: str, name: str, role: str, baseline: objectOnly, appetite: objectOnly }),
  ),
  generators: arrayOf(WHATIF_GENERATOR),
  watched_measures: arrayOf(WHATIF_MEASURE),
  candidate_pools: arrayOf(shape({ key: str, label: str, count: num })),
  headroom: arrayOf(
    shape({
      pool: str,
      room: nullable(num),
      avg: nullable(num),
      carrying: num,
      appetite: num,
    }),
  ),
  saved: arrayOf(WHATIF_SAVED),
  copy: shape({
    page_title: str,
    banner: str,
    subtitle: str,
    overlay_pill: str,
    data_note: str,
    tabs: arrayOf(shape({ key: str, label: str })),
  }),
  state_defaults: shape({
    tab: str,
    step: num,
    count: num,
    watch: objectOnly,
    pool: str,
  }),
  authoring: shape({
    /* `help` is nullable because step 3 carries a `note` instead — the review step has
       nothing to explain, it has a guarantee to state. Declaring it as a required
       string made the whole frame fail to read, which is the validator doing its job. */
    steps: arrayOf(shape({ n: num, key: str, title: str, heading: str, help: nullable(str) })),
    scenario_count: shape({
      heading: str,
      help: str,
      options: arrayOf(num),
      default: num,
    }),
    cta_step1: str,
    cta_step2: str,
    cta_step3: str,
  }),
  runtime: shape({
    compare: shape({ min: num, max: num, default: num, help: str }),
    scenario_card: shape({
      load_label: str,
      name_placeholder: str,
      trace_link: str,
      trace_header: str,
      residual_note: str,
      clean_note: str,
      graph_link: str,
    }),
    headroom: shape({ label: str, sentence: str, help: str }),
    saved_library: shape({
      title: str,
      empty: str,
      full_help: str,
      save_btn: str,
      update_btn: str,
      saved_flag: str,
      add_btn: str,
    }),
    closing_note: str,
  }),
  graph_reference: shape({
    node_types: arrayOf(shape({ key: str, label: str })),
    relationships: arrayOf(str),
  }),
})

const WHATIF_RESOLUTION = shape({
  text: str,
  verdict: oneOf(['resolved', 'grounds_not_inherited', 'refused']),
  measure_key: nullable(str),
  tone: oneOf(['ok', 'warn', 'bad']),
  title: str,
  body: str,
})

const WHATIF_SCENARIO = shape({
  generator: WHATIF_GENERATOR,
  measures: arrayOf(
    shape({
      key: str,
      label: str,
      source: str,
      grounds: str,
      unit: str,
      value: numOrBool,
      value_text: str,
      inherited: numOrBool,
      inherited_text: str,
      baseline: nullable(numOrBool),
      baseline_text: nullable(str),
      appetite: nullable(num),
      breached: bool,
      moved: bool,
    }),
  ),
  sources: arrayOf(shape({ key: str, label: str, line: str })),
  flagged: bool,
  clean_note: nullable(str),
  residual_note: str,
  subgraph: shape({
    nodes: arrayOf(shape({ key: str, label: str })),
    relationships: arrayOf(str),
  }),
})

const WHATIF_SAVED_PAYLOAD = shape({ saved: arrayOf(WHATIF_SAVED) })

interface RawWhatIfGenerator {
  id: string
  name: string
  state: string
  risk: 'high' | 'med' | 'low'
  transporter: string
  evaluations: number
  violations: number
  enforcement: number
  penalty: number
  tons: number
  manifests: number
  consent_decree: boolean
  last_enforcement: string
}

interface RawWhatIfSaved {
  saved_id: string
  name: string
  generator_id: string
}

const toWhatIfGenerator = (g: RawWhatIfGenerator): WhatIfGenerator => ({
  id: g.id,
  name: g.name,
  state: g.state,
  risk: g.risk,
  transporter: g.transporter,
  evaluations: g.evaluations,
  violations: g.violations,
  enforcement: g.enforcement,
  penalty: g.penalty,
  tons: g.tons,
  manifests: g.manifests,
  consentDecree: g.consent_decree,
  lastEnforcement: g.last_enforcement,
})

const toWhatIfSaved = (s: RawWhatIfSaved): WhatIfSaved => ({
  savedId: s.saved_id,
  name: s.name,
  generatorId: s.generator_id,
})

interface RawWhatIfStep {
  n: number
  key: string
  title: string
  heading: string
  help: string | null
  add_measure?: { label: string; placeholder: string; button: string; help: string }
  preview_rows?: number
  graph_link?: string
  note?: string
}

interface RawWhatIfFrame {
  connected_sources: number
  facility: WhatIfFrame['facility']
  generators: RawWhatIfGenerator[]
  watched_measures: WhatIfMeasure[]
  candidate_pools: WhatIfPool[]
  headroom: WhatIfHeadroom[]
  saved: RawWhatIfSaved[]
  copy: {
    page_title: string
    banner: string
    subtitle: string
    overlay_pill: string
    data_note: string
    tabs: { key: string; label: string }[]
  }
  state_defaults: {
    tab: string
    step: number
    count: number
    watch: Record<string, boolean>
    pool: string
  }
  authoring: {
    steps: RawWhatIfStep[]
    scenario_count: { heading: string; help: string; options: number[]; default: number }
    cta_step1: string
    cta_step2: string
    cta_step3: string
  }
  runtime: {
    compare: { min: number; max: number; default: number; help: string }
    scenario_card: {
      load_label: string
      name_placeholder: string
      trace_link: string
      trace_header: string
      residual_note: string
      clean_note: string
      graph_link: string
    }
    headroom: { label: string; sentence: string; help: string }
    saved_library: {
      title: string
      empty: string
      full_help: string
      save_btn: string
      update_btn: string
      saved_flag: string
      add_btn: string
    }
    closing_note: string
  }
  graph_reference: { node_types: { key: string; label: string }[]; relationships: string[] }
}

const EMPTY_ADD_MEASURE = { label: '', placeholder: '', button: '', help: '' }

/** The frame: the facility, what can be watched, and what a scenario can draw from. */
export async function getWhatIfFrame(): Promise<WhatIfFrame> {
  const raw = validate<RawWhatIfFrame>(
    'The What-if lens',
    await request<unknown>('/whatif'),
    WHATIF_FRAME,
  )

  const steps = raw.authoring.steps
  const step = (key: string) => steps.find((s) => s.key === key)

  return {
    connectedSources: raw.connected_sources,
    facility: raw.facility,
    generators: raw.generators.map(toWhatIfGenerator),
    measures: raw.watched_measures,
    pools: raw.candidate_pools,
    headroom: raw.headroom,
    saved: raw.saved.map(toWhatIfSaved),
    copy: {
      pageTitle: raw.copy.page_title,
      banner: raw.copy.banner,
      subtitle: raw.copy.subtitle,
      overlayPill: raw.copy.overlay_pill,
      dataNote: raw.copy.data_note,
      tabs: raw.copy.tabs,
    },
    /* The defaults arrive as an object of flags because that is how the prototype held
       them; the store wants the keys that are on, which is the same fact in the shape
       the UI uses. */
    defaults: {
      tab: raw.state_defaults.tab,
      step: raw.state_defaults.step,
      count: raw.state_defaults.count,
      watch: Object.entries(raw.state_defaults.watch)
        .filter(([, on]) => on)
        .map(([key]) => key),
      pool: raw.state_defaults.pool,
    },
    authoring: {
      steps: steps.map((s) => ({
        n: s.n,
        key: s.key,
        title: s.title,
        heading: s.heading,
        /* Defaulted here so every component reads a string. Step 3's guarantee lands in
           `reviewNote` instead, which is where its `note` goes. */
        help: s.help ?? '',
      })),
      /* Step 1's add-measure copy, step 2's preview size and step 3's note live on
         their own steps in the package; lifted here so each component reads one flat
         object rather than hunting the array for its own key. */
      addMeasure: step('watch')?.add_measure ?? EMPTY_ADD_MEASURE,
      previewRows: step('pool')?.preview_rows ?? 8,
      reviewNote: step('review')?.note ?? '',
      scenarioCount: raw.authoring.scenario_count,
      cta: [raw.authoring.cta_step1, raw.authoring.cta_step2, raw.authoring.cta_step3],
      graphLink: step('pool')?.graph_link ?? '',
    },
    runtime: {
      compare: raw.runtime.compare,
      card: {
        loadLabel: raw.runtime.scenario_card.load_label,
        namePlaceholder: raw.runtime.scenario_card.name_placeholder,
        traceLink: raw.runtime.scenario_card.trace_link,
        traceHeader: raw.runtime.scenario_card.trace_header,
        graphLink: raw.runtime.scenario_card.graph_link,
      },
      headroom: raw.runtime.headroom,
      library: {
        title: raw.runtime.saved_library.title,
        empty: raw.runtime.saved_library.empty,
        fullHelp: raw.runtime.saved_library.full_help,
        saveBtn: raw.runtime.saved_library.save_btn,
        updateBtn: raw.runtime.saved_library.update_btn,
        savedFlag: raw.runtime.saved_library.saved_flag,
        addBtn: raw.runtime.saved_library.add_btn,
      },
      closingNote: raw.runtime.closing_note,
    },
    graphReference: {
      nodeTypes: raw.graph_reference.node_types,
      relationships: raw.graph_reference.relationships,
    },
  }
}

/**
 * Ask the graph whether a typed measure grounds.
 *
 * The answer comes from the server because the *graph* decides what grounds — the
 * keyword list is deliberately absent from the frame payload, so this is the only way
 * to ask and a refusal cannot be faked client-side.
 */
export async function resolveWhatIfMeasure(text: string): Promise<WhatIfResolution> {
  const raw = validate<{
    text: string
    verdict: 'resolved' | 'grounds_not_inherited' | 'refused'
    measure_key: string | null
    tone: 'ok' | 'warn' | 'bad'
    title: string
    body: string
  }>(
    'The measure resolution',
    await request<unknown>('/whatif/resolve', { method: 'POST', body: { text } }),
    WHATIF_RESOLUTION,
  )
  return {
    text: raw.text,
    verdict: raw.verdict,
    measureKey: raw.measure_key,
    tone: raw.tone,
    title: raw.title,
    body: raw.body,
  }
}

interface RawWhatIfScenario {
  generator: RawWhatIfGenerator
  measures: {
    key: string
    label: string
    source: string
    grounds: string
    unit: string
    value: number | boolean
    value_text: string
    inherited: number | boolean
    inherited_text: string
    baseline: number | boolean | null
    baseline_text: string | null
    appetite: number | null
    breached: boolean
    moved: boolean
  }[]
  sources: { key: string; label: string; line: string }[]
  flagged: boolean
  clean_note: string | null
  residual_note: string
  subgraph: { nodes: WhatIfSubgraphNode[]; relationships: string[] }
}

/** What admitting one load would inherit. Recomputed every time; nothing is stored. */
export async function computeWhatIfScenario(input: {
  generatorId: string
  watch: string[]
}): Promise<WhatIfScenario> {
  const raw = validate<RawWhatIfScenario>(
    'The scenario',
    await request<unknown>('/whatif/scenario', {
      method: 'POST',
      body: { generator_id: input.generatorId, watch: input.watch },
    }),
    WHATIF_SCENARIO,
  )
  return {
    generator: toWhatIfGenerator(raw.generator),
    measures: raw.measures.map((m) => ({
      key: m.key,
      label: m.label,
      source: m.source,
      grounds: m.grounds,
      unit: m.unit,
      value: m.value,
      valueText: m.value_text,
      inherited: m.inherited,
      inheritedText: m.inherited_text,
      baseline: m.baseline,
      baselineText: m.baseline_text,
      appetite: m.appetite,
      breached: m.breached,
      moved: m.moved,
    })),
    sources: raw.sources,
    flagged: raw.flagged,
    cleanNote: raw.clean_note,
    residualNote: raw.residual_note,
    subgraph: raw.subgraph,
  }
}

/** Save or update a library entry. Stores the admitted load, never the figures. */
export async function saveWhatIfScenario(input: {
  savedId?: string | null
  name: string
  generatorId: string
}): Promise<WhatIfSaved[]> {
  const raw = validate<{ saved: RawWhatIfSaved[] }>(
    'The saved scenario',
    await request<unknown>('/whatif/saved', {
      method: 'POST',
      body: {
        saved_id: input.savedId ?? null,
        name: input.name,
        generator_id: input.generatorId,
      },
    }),
    WHATIF_SAVED_PAYLOAD,
  )
  return raw.saved.map(toWhatIfSaved)
}

/** Remove a library entry. Any open column stays put, just unlinked. */
export async function deleteWhatIfScenario(savedId: string): Promise<WhatIfSaved[]> {
  const raw = validate<{ saved: RawWhatIfSaved[] }>(
    'The saved scenario',
    await request<unknown>(`/whatif/saved/${encodeURIComponent(savedId)}`, {
      method: 'DELETE',
    }),
    WHATIF_SAVED_PAYLOAD,
  )
  return raw.saved.map(toWhatIfSaved)
}
