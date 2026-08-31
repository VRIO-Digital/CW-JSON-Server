/*
 * Client for the JSON server in backend/. Vite proxies /api/* to it with
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
 * Every request then goes under `/backend`, the prefix the server serves its endpoints at, appended
 * here rather than written into each of the ~200 paths below or into each .env file.
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

import { currentDataset, resetDatasetIfRefused } from './dataset'

/**
 * The prefix the server serves every endpoint under — `backend/server.js`'s own `API_PREFIX`, which it
 * strips once in its dispatcher.
 *
 * It is a **path**, not an origin, which is why it is written here rather than in a `.env` file: where
 * the API lives differs per environment and belongs in `VITE_API_BASE`; *what the API calls its own
 * endpoints* is the same in every environment and is the server's fact, not the deployment's. Folding
 * it into `BASE` is what keeps the ~200 paths below spelled the way the server declares them.
 *
 * The two literals are a contract the compiler cannot see, exactly as `x-dataset` is, so `check-docs`
 * asserts this string and the server's are the same one.
 */
const API_PREFIX = '/backend'

// The trailing slash is stripped because every path below starts with one, and
// `${BASE}${path}` would otherwise ask for //sources.
const BASE =
  (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '') + API_PREFIX

/* ---------------- Datasets ---------------- */

/** One tenant dataset, with what it actually holds. */
export type DatasetRow = {
  dataset: string
  label: string
  primary: boolean
  ref: string
  store: string
  projects: number
  drives: number
  reports: number
  graphs: number
  populated: boolean
}

export type DatasetsPayload = {
  datasets: DatasetRow[]
  both: { dataset: string; label: string; readOnly: boolean }
  selected: string
}

/**
 * Which datasets this tenant has, and which one this call was answered from.
 *
 * `selected` is the server's reading of the header the request carried, so it is what proves the
 * selection arrived — a selector showing CAPEX while every payload came from EPA is the failure
 * this endpoint makes visible.
 */
export async function listDatasets(): Promise<DatasetsPayload> {
  const raw = validate<{
    datasets: DatasetRow[]
    both: { dataset: string; label: string; read_only: boolean }
    selected: string
  }>('The dataset list', await request<unknown>('/datasets'), DATASETS_PAYLOAD)

  return {
    datasets: raw.datasets,
    both: { dataset: raw.both.dataset, label: raw.both.label, readOnly: raw.both.read_only },
    selected: raw.selected,
  }
}

/* ---------------- The report prototype's dataset ---------------- */

/**
 * The Authoring tab's sample data, from `s3://contextweave.com/EPA/reports_prototype.json`.
 *
 * It used to be `import dataset from './data/dataset.json'` — compiled into the bundle, so editing a
 * figure meant a rebuild and a redeploy, and it was the one thing on screen the bucket could not change.
 *
 * Typed as `unknown` on purpose: the prototype declares these shapes itself (`Dataset` in
 * `src/reports/data.ts`) and validates them on receipt, the same way it declares the `Governance` payload
 * rather than importing this file's types. Absent its host it is exactly the standalone prototype it was.
 */
export async function getReportsPrototypeDataset(): Promise<{
  ref: string
  store: string
  dataset: unknown
}> {
  return validate<{ ref: string; store: string; dataset: unknown }>(
    "The report prototype's dataset",
    await request<unknown>('/reports/prototype'),
    PROTOTYPE_PAYLOAD,
  )
}

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
  /**
   * The user's own name, from the settings store.
   *
   * The login used to have none to report — it collected an address and a role and nothing else, which
   * is why the avatar is initials rather than a name. Now the address resolves to a user, so this is
   * read rather than invented.
   */
  name: string
  /** **Looked up, not claimed.** The settings store says which persona this address is. */
  roleId: string
  roleLabel: string
  accessNote: string
  /** Derived from the email, which is still what the avatar draws. */
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
/**
 * The connectors that run a Google consent, declared **once** so the type and the runtime check cannot
 * disagree.
 *
 * They did. The union was widened for Gmail and the two `oneOf(['bigquery', 'drive'])` schemas below
 * were not, so the server answered `provider: "gmail"`, the validator refused it, and the wizard showed
 * *"The Google sign-in could not be read — … provider should be one of bigquery | drive"* — a message
 * that blames a stale mock server, over a server that was right. A union is a compile-time claim and a
 * schema is a runtime one; only the second is checked against the payload, and only the first was
 * updated.
 */
export const OAUTH_PROVIDERS = ['bigquery', 'drive', 'gmail'] as const
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]

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

/**
 * The mailbox a Gmail consent reaches, and the handle minted for it.
 *
 * One per consent rather than a list the tenant configured: a mailbox is whoever just signed in, so
 * unlike a drive there is no row in the document to point at.
 */
export interface MailboxInfo {
  mailbox: string
  /** What the tenant calls it — "EHS compliance inbox". */
  display_name: string
  description: string
  credential_handle: string
  label_count: number
}

/** What the Gmail preview discovers — labels only, and it registers nothing. */
export interface GmailPreview {
  mailbox: string
  display_name: string
  description: string
  /** Gmail's own system labels first, then this mailbox's own filing. */
  labels: string[]
  label_count: number
}

/** A registered Gmail source. No profiled counts: this connector carries no catalogue. */
export interface RegisteredGmailSource {
  source_id: string
  source_name: string
  connector: string
  mailbox: string
  credential_handle: string
  labels: string[]
  /** The optional Gmail search, exactly as typed, or null. */
  query: string | null
  attachments: boolean
  status: string
  registered_at: string
  newly_connected: boolean
}


export interface PreviewFolder {
  folder_id: string
  /**
   * The folder this one sits inside, or `null` at the root of the drive.
   *
   * A drive is a tree and the allowlist is picked from it, but the folders stay one flat list —
   * every walk over them is unchanged, and the wizard builds the tree from these pointers.
   */
  parent_id: string | null
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

/**
 * What a *generic* registration answers with — a different shape from BigQuery's, and it always was.
 *
 * It has no \`project_id\`: a mailbox connects as an OAuth client, not into a GCP project. Validating it
 * against \`RegisteredSource\` demanded one anyway, so the server registered the source and the client
 * then threw \`project_id should be a string, got undefined\` — a failure toast over a source that had
 * been created. Never seen, because every connector on this path was \`available: false\` until the email
 * one; the same locked door that hid the form-wiring defect.
 */
export interface RegisteredGenericSource {
  source_id: string
  source_name: string
  connector: string
  type_label: string
  /** A \`secret://\` pointer, or null where the connector asks for no credential. */
  credential_handle: string | null
  /** What it connected *as* — the email connector's client id. Null where a connector names nothing. */
  account: string | null
  datasets: string[]
  status: string
  registered_at: string
  newly_connected: boolean
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
  /**
   * Whether this source carries a catalogue at all.
   *
   * The server derives it from whether a profiler exists for the kind, so it is one answer rather than
   * a pair of connector names the Catalog also has to know. False for a mailbox: it is connected so a
   * report can be delivered from it, and there is nothing in it to sample.
   */
  profilable: boolean
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
  profilable: boolean
}

/* ---------------- Catalog: browse & profile ---------------- */

export interface BrowseTable {
  table_id: string
  /** What the semantic layer calls this view, e.g. `e-Manifest (shipments)`. */
  label: string
  type: string
  /** What one row is. A Gold view is only readable if its grain is stated. */
  grain: string
  columns: number
  /** `null` when the table is catalogued but has never been profiled — not zero, which would be a claim. */
  rows: number | null
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

/* ---------------- Catalog: browse & profile documents ---------------- */

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
 * The semantic class the profiler assigned, and it is **the dataset's vocabulary rather than a
 * closed set of ours**.
 *
 * This was a nine-member union, which was true of EPA and a claim about every dataset — the same
 * mistake as `rows: num` before CAPEX arrived with `rows: null`. CAPEX's generator emits sixteen
 * classes (`measure_record`, `period_accumulation`, `lifecycle_state` …), so the validator refused
 * the whole payload and **both dictionaries rendered nothing at all** behind "the data did not look
 * the way this app expects" — a page-level failure to protect a chip's wording.
 *
 * Widening is safe because nothing keys behaviour off the value any more. The tag is neutral by
 * construction (only `is-identifier` and `is-measure` carry a rule; anything else takes the base
 * style, which is what the class-chips-stay-neutral convention wants anyway), and the facet a column
 * answers to now arrives **on the column** as `facet`, computed server-side from `CLASS_FACET`.
 *
 * What replaced the runtime guard is a build-time one, which is the stronger trade: `check-docs`
 * asserts every class in **every** dataset is either in a facet or listed as deliberately unfaceted,
 * so a seventeenth class fails `npm run preflight` instead of a page.
 */
export type ColumnClass = string

export interface ProfiledColumn {
  column_id: string
  /** The profiler's own name for it (`TOTAL QUANTITY ACUTE KG`). */
  label: string
  type: string
  class: ColumnClass
  /**
   * The class chip this column answers to, or `null` for a class with no chip.
   *
   * Server-side, from `CLASS_FACET`, because the panel used to hold its own copy of the fold and two
   * copies can disagree — a chip counting 69 and listing 41 reads as a broken filter.
   */
  facet: string | null
  /** LLM classification confidence, shown beside the class chip. */
  confidence: number
  /**
   * How the classification was reached, or `null` where the profiler did not record it.
   *
   * **Nullable because it is the dataset's to state.** EPA's workbook records `llm` for all 237
   * columns; CAPEX's generator records nothing for any of its 224, and a schema saying `str` refused
   * the payload and blanked the whole dictionary. Third field in this family after `rows` and
   * `class` — a declared type is a claim about every dataset, not the one it was written against.
   *
   * Rendered only when present. There is no default, deliberately: `llm` would attribute a method to
   * a classification nobody described, which is the same lie as printing confidence 0.00 for a node
   * that was never scored.
   */
  derivation: string | null
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
  /** `null` when nobody has counted — see the browse type above. */
  rows: number | null
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
}

/**
 * One document-kind chip: the `doc_type` slug it filters by, its label, and its count.
 *
 * **Served, because the kinds are the corpus's and not this app's.** These were four fixed keys on
 * `DocumentFacets` and a matching `TYPE_FOR_FACET` table in the panel — EPA's enforcement papers,
 * which left all four chips reading 0 against CAPEX's 36 scope documents and contracts. The `key` is
 * the slug the document carries, so the panel filters on it directly and there is no second map to
 * fall out of step.
 */
export interface DocumentTypeFacet {
  key: string
  label: string
  count: number
}

export interface ProfiledDocumentsPayload {
  source_id: string
  profiled_documents: number
  folder_count: number
  entity_count: number
  facets: DocumentFacets
  type_facets: DocumentTypeFacet[]
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
 * How answers of one question type render — one option a reader may ask for on Ask's
 * Answer requirements tab.
 *
 * **No longer part of a use-case brief.** It was step 6 of the wizard, stored
 * self-describing so a saved brief kept promising what it promised; the choice is made
 * per question now, so it is served with the graph list and never written to a draft.
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
  /* No graph-level `citations`: the reader chooses per question on the Answer
     requirements tab, so it rides on the answer instead. */
  /** Standing limits — the coverage step's gap decisions, read back. */
  caveats: string[]
  /** The hero questions this graph was built for; the chips under the box. */
  suggestedQuestions: string[]
  entityCount: number
  relationshipCount: number
}

/**
 * What a reader may require of an answer — the Answer requirements tab's pool.
 *
 * Served rather than written into the component, for the reason the consent screen
 * renders the scopes the endpoint returned: a client holding its own list can offer a
 * value `POST /ask` refuses.
 */
export interface AnswerRequirementOptions {
  citationsOptions: { value: Citations; label: string }[]
  defaultCitations: Citations
  formats: AnswerFormat[]
  /** Which half really applies, in the server's words. */
  note: string
}

export interface AskGraphsPayload {
  graphs: AskGraph[]
  count: number
  /** Built but never published — the fix is Publish, not New Graph. */
  builtCount: number
  draftCount: number
  answerRequirements: AnswerRequirementOptions
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
      /** `column` is vertical bars, for a short label over a left-to-right series. */
      chart: 'bar' | 'line' | 'column' | 'grouped' | 'pie' | 'donut'
      title: string
      x_label?: string | null
      y_label?: string | null
      note?: string | null
      /** A wider viewBox where the surface is wider — a report card, not an answer column. */
      width?: number | null
      /** Two measures over the same rows: a grouped chart names them, one hue each. */
      series?: { key: string; label: string }[] | null
      /** A point may carry a state: the register's bars are coloured by compliance risk. */
      data: {
        label: string
        value: number
        tone?: 'good' | 'warn' | 'crit' | null
        /** One value per series on a grouped chart, keyed by measure. */
        values?: Record<string, number> | null
      }[]
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

/**
 * What was required of this answer, and whether it was met — **computed by the server,
 * never asserted**. Citations really apply: required plus nothing cited is a fact, and
 * `satisfied` is false. A format is stated, not applied — a recorded answer holds the
 * blocks the tenant wrote, and claiming they were rendered to order would be a claim
 * the page underneath disproves.
 */
export interface AnswerRequirements {
  citations: Citations
  formats: AnswerFormat[]
  satisfied: boolean
  note: string
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
  /** What the reader asked this answer to carry, and whether it did. */
  requirements: AnswerRequirements
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
  /**
   * This version's label — v1, v2, v3, one per build.
   *
   * Named `configVersion` for the payload field it maps, which is older than the change: it
   * used to name the *brief's* config and was shared by every build of it. A build takes the
   * next number now, assigned once when the run starts, so a published label is never
   * recomputed by a later rebuild.
   */
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
 * How a package accounts for the way an element was built — **its own vocabulary, not a fixed one.**
 *
 * EPA states four origin classes: a source row becomes an entity or event node, an uploaded document
 * becomes a document node, a raw name resolves through an alias, and `schema` is the pair of element
 * classes that are not instances. CAPEX states its node's *type* here instead. Both are the graph's
 * account of itself, and neither is wrong — so this is a string, and the union that used to be here
 * refused every one of CAPEX's 442 nodes with a message about a stale server.
 *
 * **Nothing reads it to decide an appearance.** It was the legend's fill until the viewer was vendored
 * in; that draws by ontology `type` now, which is why widening this costs nothing. `dimension` was a
 * fifth EPA value until the graph was rebuilt — column values are no longer promoted to nodes, a waste
 * code being an attribute of a shipment — and it is gone rather than empty, because a legend row for it
 * would advertise a claim the graph denies.
 */
export type CanvasGroup = string

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
  /**
   * The Catalog object it was built from, e.g. `epa_hazwaste.e_manifest`.
   *
   * `null` where the package states none — CAPEX states none for 11 of its 442 nodes. The inspector
   * prints provenance only when there is some, so an absence stays an absence rather than becoming the
   * string "null" under a heading that claims to say where a figure came from.
   */
  source: string | null
  /** Relationships carried. The node's radius is this, not a decorative size. */
  degree: number
  /** Radius in canvas units, from the server so a reload draws one picture. */
  r: number
  group: CanvasGroup
  /** Null where the package scored no node — CAPEX scores none of its 442. Never defaulted to 0. */
  confidence: number | null
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
  /** This run's own version — what Publish would make live. One per build. */
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

/**
 * The dataset pool, served rather than written here.
 *
 * The same rule the consent screen follows with its scopes and the Share picker with its roles: a
 * list held in the client can offer a value the API refuses, and here that would be a selector
 * showing CAPEX on a deployment with no CAPEX prefix. `populated` is the server's own answer to
 * "does this hold anything", so an empty dataset reads as empty rather than as a page that failed.
 */
const DATASET_ROW = shape({
  dataset: str,
  label: str,
  primary: bool,
  ref: str,
  store: str,
  projects: num,
  drives: num,
  reports: num,
  graphs: num,
  populated: bool,
})

/**
 * The report prototype's own dataset, served rather than bundled.
 *
 * **Shallow here, and deliberately.** The prototype already validates it deeply — `validateDataset` in
 * `src/reports/data/validate.ts` walks every row and every enum, and was written when this was a JSON
 * import — so this checks the envelope the boundary is responsible for and hands the rest over. Two deep
 * validators over one document is two answers to "what is a valid row".
 *
 * `arrayOf(unknownRow)` rather than a row schema for the same reason: the prototype owns those shapes.
 */
const PROTOTYPE_ROW = (value: unknown, path: string) =>
  value !== null && typeof value === 'object' ? [] : [`${path} should be an object`]

const PROTOTYPE_DATASET = shape({
  meta: shape({}),
  assumptions: shape({}),
  opts: shape({}),
  fields: arrayOf(PROTOTYPE_ROW),
  generators: arrayOf(PROTOTYPE_ROW),
  facilities: arrayOf(PROTOTYPE_ROW),
  quarters: arrayOf(PROTOTYPE_ROW),
  traces: arrayOf(PROTOTYPE_ROW),
  starters: arrayOf(PROTOTYPE_ROW),
  presets: arrayOf(PROTOTYPE_ROW),
  audiences: arrayOf(PROTOTYPE_ROW),
  library: arrayOf(PROTOTYPE_ROW),
  slice_default: arrayOf(str),
})

const PROTOTYPE_PAYLOAD = shape({
  ref: str,
  store: str,
  dataset: PROTOTYPE_DATASET,
})

const DATASETS_PAYLOAD = shape({
  datasets: arrayOf(DATASET_ROW),
  both: shape({ dataset: str, label: str, read_only: bool }),
  selected: str,
})

const AUTH_ROLES_PAYLOAD = shape({
  roles: arrayOf(AUTH_ROLE),
  count: num,
})

const SESSION_IDENTITY_PAYLOAD = shape({
  email: str,
  name: str,
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
  profilable: bool,
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
          /*
           * **Nullable, because a catalogued table need not have been profiled.** CAPEX's own provenance
           * says it: "rows is null for the 60 tables the package catalogued but did not profile — that is
           * the honest value, not zero." 62 of its 64 tables arrive that way, and declaring `num` here
           * made every browse of a CAPEX source fail validation with "rows should be a number, got null" —
           * a real payload refused by a schema written when one dataset had profiled everything.
           */
          rows: nullable(num),
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
          /* Nullable for the same reason as the browse payload above — see the note there. */
          rows: nullable(num),
          column_count: num,
          columns: arrayOf(
            shape({
              column_id: str,
              label: str,
              type: str,
              /* The dataset's vocabulary, not ours — see ColumnClass. */
              class: str,
              facet: nullable(str),
              confidence: num,
              /* Null wherever the profiler recorded no method — see the interface. */
              derivation: nullable(str),
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
  }),
  type_facets: arrayOf(shape({ key: str, label: str, count: num })),
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
              /* Same reasoning as a column's: CAPEX's documents carry `measure_commitment`,
                 `person` and `label`, and refusing them blanked the whole document dictionary. */
              class: str,
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
      /* `nullable`, because a root folder has no parent — and nullable accepts an absent key
         too, so a drive seeded before nesting still reads rather than failing the whole
         preview over a folder that simply is not nested. */
      parent_id: nullable(str),
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
const OAUTH_MAILBOXES_PAYLOAD = shape({
  mailboxes: arrayOf(
    shape({
      mailbox: str,
      display_name: str,
      description: str,
      credential_handle: str,
      label_count: num,
    }),
  ),
  mailbox_count: num,
})

const GMAIL_PREVIEW_PAYLOAD = shape({
  mailbox: str,
  display_name: str,
  description: str,
  labels: arrayOf(str),
  label_count: num,
})

const REGISTERED_GMAIL_PAYLOAD = shape({
  source_id: str,
  source_name: str,
  connector: str,
  mailbox: str,
  credential_handle: str,
  labels: arrayOf(str),
  query: nullable(str),
  attachments: bool,
  status: str,
  registered_at: str,
  newly_connected: bool,
})

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
    shape({
      folder_id: str,
      parent_id: nullable(str),
      name: str,
      path: str,
      document_count: num,
    }),
  ),
})

const OAUTH_CALLBACK_PAYLOAD = shape({
  account: shape({ email: str, name: str }),
  session: str,
  provider: oneOf([...OAUTH_PROVIDERS]),
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
  /*
   * **Nullable, because a package may not know where a node came from.** CAPEX states no source for 11
   * of its 442 nodes, and `str` refused the whole canvas over them. The viewer already prints
   * provenance only when there is some — an absence has no note — so null is the honest value and 0
   * consumers wanted a placeholder.
   */
  source: nullable(str),
  degree: num,
  r: num,
  /*
   * **A plain string, because `group` is each package's own vocabulary.** It was
   * `oneOf(['row', 'schema', 'document', 'alias'])`, which is EPA's account of how an element was
   * built — and CAPEX names its node types there instead (`Concept`, `Programme`, `Region`…), so
   * every one of its 442 nodes was refused with "group should be one of row | schema | document |
   * alias", under a message blaming a stale server. The union was true of one dataset by accident.
   *
   * Nothing is lost by widening it: the drawing stopped encoding `group` when the viewer was vendored
   * in — it colours by ontology `type` — so this is carried as the graph's own account of itself and
   * read by nobody who could be misled by an unfamiliar word. A union that is right for one dataset
   * and refuses another is not a validator, it is a bug with a good error message.
   */
  group: str,
  /*
   * **Nullable, because a package may score no node at all.** CAPEX scores none of its 442 — the
   * package states no per-node confidence — while EPA scores all 189, so `num` here was true of one
   * dataset by accident. It would have refused the other's entire canvas with "confidence should be a
   * number, got null", which reads as a stale server and is not one. The same shape as `rows` on a
   * browsed table, and the same rule: check every consumer for a `?? 0`, because a default that
   * lies satisfies the compiler and states a score nobody derived.
   */
  confidence: nullable(num),
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

/* ---------------- Ask ---------------- */

const ASK_GRAPH = shape({
  use_case_id: str,
  name: str,
  domain_id: nullable(str),
  version: str,
  published_at: nullable(str),
  published_by: nullable(str),
  caveats: arrayOf(str),
  suggested_questions: arrayOf(str),
  entity_count: num,
  relationship_count: num,
})

const ANSWER_REQUIREMENT_OPTIONS = shape({
  citations_options: arrayOf(
    shape({ value: oneOf(['required', 'optional']), label: str }),
  ),
  default_citations: oneOf(['required', 'optional']),
  formats: arrayOf(ANSWER_FORMAT),
  note: str,
})

const ASK_GRAPHS_PAYLOAD = shape({
  graphs: arrayOf(ASK_GRAPH),
  count: num,
  built_count: num,
  draft_count: num,
  answer_requirements: ANSWER_REQUIREMENT_OPTIONS,
})

const ANSWER_REQUIREMENTS = shape({
  citations: oneOf(['required', 'optional']),
  formats: arrayOf(ANSWER_FORMAT),
  satisfied: bool,
  note: str,
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
    chart: oneOf(['bar', 'line', 'column', 'grouped', 'pie', 'donut']),
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
  requirements: ANSWER_REQUIREMENTS,
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
  provider: oneOf([...OAUTH_PROVIDERS]),
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

/* A generic registration's own shape — see `RegisteredGenericSource` for why it cannot borrow the
   BigQuery one. `nullable` on both of the fields a connector may legitimately not have. */
const REGISTERED_GENERIC_PAYLOAD = shape({
  source_id: str,
  source_name: str,
  connector: str,
  type_label: str,
  credential_handle: nullable(str),
  account: nullable(str),
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

/*
 * No backticks: this is shown in a toast, where they render as characters.
 *
 * **It names the request it could not make.** "Cannot reach the mock server" on its own sent a real
 * report round in circles: the server *was* running and answering that very endpoint from a terminal, so
 * the message described a state that was not true and hid the two things that discriminate — which URL
 * was tried, and by which method. A GET that works while a PATCH fails is a different fault from a dead
 * server, and only the URL says which.
 */
const unreachable = (method: string, url: string) =>
  `Cannot reach the mock server — ${method} ${url} did not complete. ` +
  'Start it with npm run mock (port 4000), check that address is the one you expect, then try again.'

async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const method = init?.method ?? 'GET'
  const url = `${BASE}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method,
      /*
       * **Every request names the dataset it is asking about, and this is the only place that
       * happens.** The server defaults a caller that names none to its primary, so omitting the
       * header would silently serve EPA under whatever the selector was showing — the one
       * confusion the split exists to prevent. A header rather than a query parameter on each
       * path, because it applies to every endpoint and none of them should have to remember it.
       */
      headers: {
        'x-dataset': currentDataset(),
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    })
  } catch (cause) {
    /*
     * A browser `fetch` throws for a dead server, a blocked request and a failed CORS preflight alike,
     * and says which only in the console. Carrying the underlying message through is what tells those
     * apart from a toast — `TypeError: Failed to fetch` is the generic one, anything else is a clue.
     */
    const detail = cause instanceof Error && cause.message ? ` (${cause.message})` : ''
    throw new ApiError(unreachable(method, url) + detail, 0)
  }

  const payload = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `request failed (${res.status})`
    /*
     * **A refused dataset is retried once on the primary, and only that refusal is.**
     *
     * A selection persisted to `localStorage` outlives the dataset it names — `CAPEX` was removed
     * while browsers still had it selected — and the server then refuses *every* request with
     * `"CAPEX" is not a dataset`. Both sides behaving correctly and the app dead in the middle: with
     * nothing clearing the value, every page failed identically and the cure was editing
     * `localStorage` by hand.
     *
     * So the stale value is discarded and the call is remade on the primary, which succeeds. It is
     * deliberately narrow: keyed on the server's own refusal for this one cause, after the reset
     * reports it actually had something to clear, and it retries **once** — `resetDatasetIfRefused`
     * returns false the second time, so a genuine 400 cannot become a loop. Everything else, a 400
     * included, still throws untouched.
     *
     * Not pre-validated on the way out, because the pool is the server's: a list held in the client
     * could refuse a dataset the server has, which is the mistake the consent screen's client-side
     * scope list was.
     */
    if (res.status === 400 && /is not a dataset/.test(detail) && resetDatasetIfRefused()) {
      return request<T>(path, init)
    }
    throw new ApiError(detail, res.status)
  }
  return payload as T
}

/* ---------------- Endpoints ---------------- */

/* ---------------- Liveness ---------------- */

/**
 * Where this bundle calls the API, as it was built.
 *
 * **Read from here rather than from `import.meta.env` a second time.** `VITE_API_BASE` is inlined at
 * build time, so a page that read the variable itself would be a second answer to the same question —
 * and the one thing the diagnostics page exists to report is which API the app is *actually* talking
 * to. `BASE` is that answer, trailing slash already stripped.
 */
export const apiBase = (): string => BASE

/** What `GET /health` reports: that the documents parsed, and which store they were read from. */
export interface ServerHealth {
  ok: boolean
  /** Every dataset read at boot — a process that is listening has validated all of them. */
  datasets: string[]
  /** `s3` or `file`. After a deploy, `file` means `S3_BUCKET` never reached the process. */
  store: string
  port: number
  uptimeS: number
}

const SERVER_HEALTH = shape({
  ok: bool,
  datasets: arrayOf(str),
  store: str,
  port: num,
  uptime_s: num,
})

/**
 * The one endpoint that answers before any dataset is chosen.
 *
 * It names every dataset rather than the selected one, so it cannot fail on a wrong `x-dataset` — which
 * is exactly what makes it the first thing to ask when nothing else works.
 */
export async function getHealth(): Promise<ServerHealth> {
  const raw = validate<{
    ok: boolean
    datasets: string[]
    store: string
    port: number
    uptime_s: number
  }>('The server health', await request<unknown>('/health'), SERVER_HEALTH)

  return {
    ok: raw.ok,
    datasets: raw.datasets,
    store: raw.store,
    port: raw.port,
    uptimeS: raw.uptime_s,
  }
}

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
}): Promise<SessionIdentity> {
  const raw = validate<{
    email: string
    name: string
    role_id: string
    role_label: string
    access_note: string
    initials: string
    signed_in_at: string
  }>(
    'The signed-in session',
    await request<unknown>('/auth/login', {
      method: 'POST',
      /* No role. It is the *user's*, looked up in the settings store by address — the form used to ask,
         which meant one address could sign in as any persona. */
      body: { email: input.email, password: input.password },
    }),
    SESSION_IDENTITY_PAYLOAD,
  )

  return {
    email: raw.email,
    name: raw.name,
    roleId: raw.role_id,
    roleLabel: raw.role_label,
    accessNote: raw.access_note,
    initials: raw.initials,
    signedInAt: raw.signed_in_at,
  }
}

/*
 * ---------------- Settings: users, and each persona's navigation ----------------
 *
 * From `settings.json`, a **separate store** from `db.json` holding only what this section administers.
 * Both writes commit, so a permission survives a restart.
 *
 * **Neither is access control.** They record and report a navigation preference; the persona arrives
 * from a browser whose login authenticates by shape. Any UI on top has to say so in those words.
 */

export interface SettingsUser {
  id: number
  name: string
  email: string
  roleId: string
  /** Resolved from `db.auth_roles` on the way out, so no label is stored twice. */
  roleLabel: string
}

export interface SettingsPersona {
  roleId: string
  label: string
  accessNote: string
  /** Live access, per navigation key. */
  nav: Record<string, boolean>
  /** Keys whose toggle is fixed — served rather than re-derived, because the server enforces it. */
  readOnly: string[]
  /** What Reset returns to, so the page keeps no copy of what "default" means. */
  defaults: Record<string, boolean>
  /** What this persona may do to a report in the Library: open, edit, delete. */
  reports: Record<string, boolean>
  /** The authored report access Reset restores — the twin of `defaults`. */
  reportDefaults: Record<string, boolean>
}

export interface SettingsPayload {
  users: SettingsUser[]
  personas: SettingsPersona[]
  /**
   * The report actions a row offers, served rather than written into the panel.
   *
   * The rule the consent screen's scopes follow: a column the component invented could offer a
   * permission `PATCH` refuses, and one it omitted would hide a permission the server stores and the
   * card reads.
   */
  reportActions: string[]
}

/*
 * An object whose keys are unknown and whose values must all be booleans — which `shape` cannot
 * express, since it checks named fields. The keys are navigation items, so they are the app's to know
 * and not the validator's; what has to be true is that every value is a real boolean, because a
 * `"false"` string would read as *on* everywhere it is tested.
 *
 * A `Check` pushes onto `issues` and never throws, like every other checker here.
 */
const boolMap: FieldCheck = (v, path, issues) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    issues.push(`${path} should be an object of booleans`)
    return
  }
  for (const [key, value] of Object.entries(v)) {
    if (typeof value !== 'boolean') {
      issues.push(`${path}.${key} should be a boolean, got ${value === null ? 'null' : typeof value}`)
    }
  }
}

const SETTINGS_PAYLOAD = shape({
  users: arrayOf(
    shape({ id: num, name: str, email: str, role_id: str, role_label: str }),
  ),
  personas: arrayOf(
    shape({
      role_id: str,
      label: str,
      access_note: str,
      nav: boolMap,
      read_only: arrayOf(str),
      defaults: boolMap,
      reports: boolMap,
      report_defaults: boolMap,
    }),
  ),
  report_actions: arrayOf(str),
})

const toSettings = (raw: {
  users: { id: number; name: string; email: string; role_id: string; role_label: string }[]
  personas: {
    role_id: string
    label: string
    access_note: string
    nav: Record<string, boolean>
    read_only: string[]
    defaults: Record<string, boolean>
    reports: Record<string, boolean>
    report_defaults: Record<string, boolean>
  }[]
  report_actions: string[]
}): SettingsPayload => ({
  users: raw.users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roleId: u.role_id,
    roleLabel: u.role_label,
  })),
  personas: raw.personas.map((p) => ({
    roleId: p.role_id,
    label: p.label,
    accessNote: p.access_note,
    nav: p.nav,
    readOnly: p.read_only,
    defaults: p.defaults,
    reports: p.reports,
    reportDefaults: p.report_defaults,
  })),
  reportActions: raw.report_actions,
})

export async function getSettings(): Promise<SettingsPayload> {
  return toSettings(
    validate('The settings', await request<unknown>('/settings'), SETTINGS_PAYLOAD),
  )
}

/**
 * Saves one persona's navigation access.
 *
 * The whole set per write, so the payload says what the answer *is* rather than what changed — and the
 * reply is the whole view, so the caller renders a validated payload instead of patching its own copy.
 * A key the app does not have, a non-boolean, or a change to a fixed key are all refused by the server
 * with a sentence; none of them is silently dropped.
 */
export async function setPersonaNav(
  roleId: string,
  nav: Record<string, boolean>,
): Promise<SettingsPayload> {
  return toSettings(
    validate(
      'The persona’s navigation',
      await request<unknown>(`/settings/personas/${encodeURIComponent(roleId)}/nav`, {
        method: 'PATCH',
        body: { nav },
      }),
      SETTINGS_PAYLOAD,
    ),
  )
}

/**
 * Saves one persona's report access — which of a Library row's three acts it is offered.
 *
 * The twin of `setPersonaNav`, and the same contract for the same reasons: the whole set per write, the
 * whole view back, and an unknown action or a non-boolean refused by the server with a sentence rather
 * than dropped.
 *
 * **It is not access control, and any UI on top has to say so in those words.** The persona is
 * client-held, the login authenticates by shape, and the API still serves every report to a caller that
 * names no role — so what this changes is which controls a reader is offered, not what they may reach.
 */
export async function setPersonaReports(
  roleId: string,
  reports: Record<string, boolean>,
): Promise<SettingsPayload> {
  return toSettings(
    validate(
      'The persona’s report access',
      await request<unknown>(`/settings/personas/${encodeURIComponent(roleId)}/reports`, {
        method: 'PATCH',
        body: { reports },
      }),
      SETTINGS_PAYLOAD,
    ),
  )
}

/** Back to the persona's authored defaults — both blocks, which live in the same store. */
export async function resetPersonaNav(roleId: string): Promise<SettingsPayload> {
  return toSettings(
    validate(
      'The persona’s navigation',
      await request<unknown>(`/settings/personas/${encodeURIComponent(roleId)}/reset`, {
        method: 'POST',
      }),
      SETTINGS_PAYLOAD,
    ),
  )
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

export async function gmailOauthCallback(
  state: string,
  signedInAs?: string,
): Promise<OAuthCallback> {
  const raw = await request<unknown>(callbackPath(state, 'gmail', signedInAs))
  return validate<OAuthCallback>('The Gmail sign-in result', raw, OAUTH_CALLBACK_PAYLOAD)
}

/**
 * Twin of `listOauthDrives`. Takes the signed-in address for the reason the callback does: the
 * identity is client-held, so the server has nothing to look the mailbox up from.
 */
export async function listOauthMailboxes(
  session: string,
  signedInAs?: string,
): Promise<MailboxInfo[]> {
  const as = signedInAs ? `&as=${encodeURIComponent(signedInAs)}` : ''
  const raw = await request<unknown>(
    `/sources/oauth/mailboxes?session=${encodeURIComponent(session)}${as}`,
  )
  return validate<{ mailboxes: MailboxInfo[] }>(
    'The mailbox this account can read',
    raw,
    OAUTH_MAILBOXES_PAYLOAD,
  ).mailboxes
}

/** Discovery only — the labels this handle can see, registering nothing. */
export async function previewGmailSource(
  mailbox: string,
  credentialHandle: string,
): Promise<GmailPreview> {
  return validate<GmailPreview>(
    'The Gmail preview',
    await request<unknown>('/sources/gmail/preview', {
      method: 'POST',
      body: { mailbox, credential_handle: credentialHandle },
    }),
    GMAIL_PREVIEW_PAYLOAD,
  )
}

export async function registerGmailSource(input: {
  mailbox: string
  credentialHandle: string
  labels: string[]
  /** The optional Gmail search. Sent as typed — the server does not second-guess it. */
  query?: string
  attachments: boolean
  sourceName: string
}): Promise<RegisteredGmailSource> {
  return validate<RegisteredGmailSource>(
    'The registered Gmail source',
    await request<unknown>('/sources/gmail', {
      method: 'POST',
      body: {
        mailbox: input.mailbox,
        credential_handle: input.credentialHandle,
        labels: input.labels,
        query: input.query ?? null,
        attachments: input.attachments,
        source_name: input.sourceName,
      },
    }),
    REGISTERED_GMAIL_PAYLOAD,
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
  /**
   * What the source connected *as* — the email connector's OAuth client id.
   *
   * An identifier, never a secret: it is shown on the Sources row, which is the point. The secret half
   * of the pair travels as \`credentialRef\`, a pointer, because the wizard promises the raw one is
   * never persisted.
   */
  account?: string
}): Promise<RegisteredGenericSource> {
  return validate<RegisteredGenericSource>(
    'The registered source',
    await request<unknown>('/sources/generic', {
      method: 'POST',
      body: {
        connector: input.connector,
        source_name: input.sourceName,
        type_label: input.typeLabel,
        credential_ref: input.credentialRef ?? null,
        account: input.account ?? null,
      },
    }),
    REGISTERED_GENERIC_PAYLOAD,
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
      profilable: s.profilable,
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

/**
 * The undo for `disconnectSource`. Re-issues the credential handle and flips the status back,
 * keeping the allowlist and every profiled object — which is what makes Disconnect safe to
 * offer as reversible. Re-registering through the wizard is *not* this: it builds a fresh
 * record and the profiled objects go with the old one.
 */
export async function reconnectSource(sourceId: string): Promise<RawSourceRow> {
  return validate<RawSourceRow>(
    'The reconnected source',
    await request<unknown>(`/sources/${encodeURIComponent(sourceId)}/reconnect`, {
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
  folders: {
    folder_id: string
    parent_id: string | null
    name: string
    path: string
    document_count: number
  }[]
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
  gap_decisions: { element_id: string; decision: GapDecision }[]
  step: number
  step_total: number
  updated_at: string | null
}

/** The fields steps 2–6 added. A server older than them answers with none. */
const USE_CASE_STEP_FIELDS = [
  'personas',
  'kpis',
  'sources',
  'hero_questions',
  'gap_decisions',
] as const

/*
 * A use case carrying none of the step 2–6 fields is not a malformed payload —
 * it is a mock server that started before those fields existed and is still
 * answering with the old shape. Five "should be an array, got undefined" lines
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
      'case came back without its personas, KPIs, sources, questions or gap ' +
      'decisions. Restart it with npm run mock and try again — nothing you ' +
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
  source: string | null
  degree: number
  r: number
  group: string
  confidence: number | null
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
/**
 * Publish one version, and record who did it.
 *
 * `as` is the signed-in address. The server cannot look it up — the identity is
 * client-held — so every "published by" line in the app is only as true as this argument,
 * which is the same contract the consent callback has. Omitting it falls back to the
 * tenant's seeded account rather than to nobody.
 */
export async function publishVersion(
  useCaseId: string,
  sha256: string,
  as?: string | null,
): Promise<GraphStudioPayload> {
  const path = `${studioPath(useCaseId)}/versions/${sha256}/publish`
  return withStudio(
    'The published version',
    await request<unknown>(as ? `${path}?as=${encodeURIComponent(as)}` : path, {
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
  caveats: raw.caveats,
  suggestedQuestions: raw.suggested_questions,
  entityCount: raw.entity_count,
  relationshipCount: raw.relationship_count,
})

/** A served format, in the shape the page reads. */
const toAnswerFormat = (f: {
  format_id: string
  name: string
  format: string
}): AnswerFormat => ({ formatId: f.format_id, name: f.name, format: f.format })

/** The graphs that are live. An empty list is the page's whole story. */
export async function listAskGraphs(): Promise<AskGraphsPayload> {
  const raw = validate<{
    graphs: RawAskGraph[]
    count: number
    built_count: number
    draft_count: number
    answer_requirements: {
      citations_options: { value: Citations; label: string }[]
      default_citations: Citations
      formats: { format_id: string; name: string; format: string }[]
      note: string
    }
  }>('The live graphs', await request<unknown>('/ask'), ASK_GRAPHS_PAYLOAD)

  return {
    graphs: raw.graphs.map(toAskGraph),
    count: raw.count,
    builtCount: raw.built_count,
    draftCount: raw.draft_count,
    answerRequirements: {
      citationsOptions: raw.answer_requirements.citations_options,
      defaultCitations: raw.answer_requirements.default_citations,
      formats: raw.answer_requirements.formats.map(toAnswerFormat),
      note: raw.answer_requirements.note,
    },
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
  requirements: {
    citations: Citations
    formats: { format_id: string; name: string; format: string }[]
    satisfied: boolean
    note: string
  }
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
  requirements: {
    citations: raw.requirements.citations,
    formats: raw.requirements.formats.map(toAnswerFormat),
    satisfied: raw.requirements.satisfied,
    note: raw.requirements.note,
  },
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
      /** How many blocks are still to come — what the shimmers are counted from. */
      blockCount: number
    }
  | { kind: 'block'; index: number; block: AnswerBlock }
  | { kind: 'done'; answer: AskAnswer }

const ASK_STAGE_EVENT = shape({ step: str, detail: str })
const ASK_SUMMARY_EVENT = shape({
  answered: bool,
  summary: nullable(str),
  reason: str,
  answer: nullable(str),
  /* How many blocks follow. The page draws one shimmer per paragraph it is waiting for, so
     this is a promise the server keeps rather than a guess the client makes. */
  block_count: num,
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
  /* What the reader required of this answer. Sent with the question because it is a
     property of the asking, not of the graph — the brief no longer declares it. */
  requirements: { citations: Citations; formats: string[] },
  onEvent: (event: AskEvent) => void,
): Promise<AskAnswer> {
  const response = await fetch(`${BASE}/ask`, {
    method: 'POST',
    /* The stream carries the selection too — an answer belongs to the dataset it was asked of. */
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-dataset': currentDataset(),
    },
    body: JSON.stringify({
      use_case_id: useCaseId,
      question,
      citations: requirements.citations,
      formats: requirements.formats,
    }),
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
        block_count: number
      }>('The answer summary', data, ASK_SUMMARY_EVENT)
      onEvent({
        kind: 'summary',
        answered: e.answered,
        summary: e.summary,
        reason: e.reason,
        answer: e.answer,
        blockCount: e.block_count,
      })
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

/** One case inside a scenario: the admitted load, and what it is called. */
export interface WhatIfCase {
  name: string
  generatorId: string
}

/** Somebody a scenario can be published to. The tenant's own users, with their persona. */
export interface WhatIfReader {
  email: string
  name: string
  roleId: string
  roleLabel: string
  /** What that persona may see. Stated beside them — this lens applies no filter. */
  accessNote: string
}

/** A published graph a scenario can be bound to. */
export interface WhatIfGraphOption {
  useCaseId: string
  name: string
  version: string | null
  sha256: string | null
  /**
   * When the build behind the live content was made.
   *
   * Publishing mints no date of its own, so this is the build's — which is what the
   * confirmation's graph line dates. Null for a version built before the field existed,
   * and then the line says which graph without claiming a day.
   */
  builtAt: string | null
}

/** How often a reader's figures re-traverse. Declared, never a promise this mock keeps. */
export interface WhatIfFreshness {
  preset: string
  every: number
  unit: string
  days: string[]
  time: string
}

/** What a published scenario records: who is told, which content answers it, how often. */
export interface WhatIfPublication {
  readers: string[]
  graphUseCaseId: string
  graphName: string
  graphVersion: string | null
  graphSha256: string | null
  freshness: WhatIfFreshness
  publishedBy: string
  publishedAt: string
  /** Where the readers go. Composed by the server, never assembled in a component. */
  link: string
}

/**
 * A saved scenario: the frame, its cases, and its publication.
 *
 * **Stores the admitted load, never the figures.** That is what lets it stay true as the
 * graph changes — re-opening it recomputes every measure by traversal rather than
 * reading a number somebody cached last week.
 */
export interface WhatIfSaved {
  savedId: string
  name: string
  /** When it was created — never confused with when it was published. */
  createdAt: string
  /** When its frame or its cases were last written. */
  updatedAt: string
  /** The frame: which measures were watched and which pool the cases may draw from. */
  watch: string[]
  pool: string
  cases: WhatIfCase[]
  /** Null while it is a library entry nobody has published. */
  published: WhatIfPublication | null
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
  /** The figure inside the circle — null on a node that is not a count. */
  count: number | null
  /** Only the generator carries one; the tier is a state, so it is drawn as one. */
  risk: 'high' | 'med' | 'low' | null
}

/** One traversal step. `label` is a relationship the graph declares, never a phrase. */
export interface WhatIfSubgraphEdge {
  from: string
  to: string
  label: string
}

/** A node type in the legend: what it is called, and the colour the package gave it. */
export interface WhatIfNodeType {
  key: string
  label: string
  color: string
  /** On the generator only: the colour per risk tier. */
  riskColors?: Record<string, string>
}

/** How the pool frame is drawn — the package states the centre, the edge and the cap. */
export interface WhatIfGraphFrame {
  description: string
  centerNode: string
  edge: string
  maxDrawn: number
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
  subgraph: {
    nodes: WhatIfSubgraphNode[]
    edges: WhatIfSubgraphEdge[]
    relationships: string[]
  }
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

/**
 * The publish dialog's copy — all of it the tenant's, none of it written in a component.
 *
 * A freshness preset carries its own `sentence` because the recurrence line has to change
 * as the control does; `custom` interpolates `{n}`, `{when}` and `{time}`, the same
 * arrangement `runtime.headroom.sentence` uses for `{room}` and `{appetite}`.
 */
export interface WhatIfPublishing {
  publishTitle: string
  manageTitle: string
  call: string
  readers: {
    label: string
    placeholder: string
    emptyError: string
    caveat: string
    scopeNote: string
  }
  graph: { label: string; note: string; empty: string }
  freshness: {
    label: string
    presets: { id: string; label: string; sentence: string }[]
    days: string[]
    times: string[]
    units: string[]
    default: WhatIfFreshness
    noDayError: string
  }
  /**
   * The confirmation shown once a publish has succeeded.
   *
   * Every line of it restates something the publication *stored*, which is why the copy
   * is the tenant's and the values are the record's: `body` interpolates `{name}` and
   * `{n}`, `graphNote` interpolates `{when}`. It states and never counts a figure — a
   * publication holds each case's admitted load and no numbers at all.
   */
  done: {
    title: string
    body: string
    stored: string
    link: { label: string; copied: string }
    labels: { cases: string; readers: string; graph: string; numbers: string; access: string }
    graphNote: string
    accessNote: string
    auditLink: string
    buttons: { again: string; close: string }
  }
  buttons: {
    publish: string
    update: string
    unpublish: string
    manage: string
    open: string
  }
  unpublishedNote: string
}

/**
 * A rendered What-if lens: a finished page this dataset ships instead of a traversal to compute.
 *
 * Every field is read out of the document by `npm run ingest:capex` — its `<title>` carries the name, the
 * stage and the version, its `<h1>` and standfirst carry what it says it is for, and its tab buttons carry
 * its own two tabs. None of it is typed in this repo, for the reason a report's figures are not: a
 * transcription is right until the file is next exported, and then it is wrong and looks fine.
 */
export interface WhatIfDocument {
  documentId: string
  /** The file, relative to the dataset's lens folder. Resolved to a URL by the page, not here. */
  file: string
  title: string
  version: string
  /** The document's own word for how finished it is — "draft". Not a governance state. */
  stage: string
  heading: string
  subtitle: string
  tabs: { key: string; label: string }[]
}

export interface WhatIfFrame {
  connectedSources: number
  /** 0 while no graph is published — the lens overlays the published graph. */
  publishedCount: number
  builtCount: number
  draftCount: number
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
  /**
   * Who a scenario can be published to, and which content it can be bound to.
   *
   * Both are the app's own pools — `settings.json`'s users and the graphs that are
   * actually published — served rather than held here, because a client-side copy of
   * either is a second answer to "who exists" and can offer what the API refuses.
   */
  readers: WhatIfReader[]
  graphs: WhatIfGraphOption[]
  copy: WhatIfCopy
  /**
   * The rendered lens this dataset ships, or `null` where the lens is computed.
   *
   * Present for a dataset whose What-if is a document rather than a traversal, and served on **both**
   * branches of `GET /whatif` — the publish gate is about questions, and a finished page asked nothing
   * of a graph. The page frames it in place of the lens.
   */
  document: WhatIfDocument | null
  publishing: WhatIfPublishing
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
  graphReference: {
    nodeTypes: WhatIfNodeType[]
    relationships: string[]
    /** How the pool frame is drawn: what sits at the centre, the edge, and the cap. */
    frame: WhatIfGraphFrame
  }
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

const WHATIF_FRESHNESS = shape({
  preset: str,
  every: num,
  unit: str,
  days: arrayOf(str),
  time: str,
})

/*
 * A saved scenario. `cases` carries generator ids and names and *nothing else* — the
 * schema is where that contract is visible, because a server that started answering
 * with cached measures here would otherwise be indistinguishable from one that did not.
 */
const WHATIF_SAVED = shape({
  saved_id: str,
  name: str,
  /* When the scenario was created and when it was last written. Two facts, and
     neither is `published.published_at` — a library entry can wait a week for
     somebody to publish it, so a row showing one date would date the other act. */
  created_at: str,
  updated_at: str,
  watch: arrayOf(str),
  pool: str,
  cases: arrayOf(shape({ name: str, generator_id: str })),
  published: nullable(
    shape({
      readers: arrayOf(str),
      graph_use_case_id: str,
      graph_name: str,
      graph_version: nullable(str),
      graph_sha256: nullable(str),
      freshness: WHATIF_FRESHNESS,
      published_by: str,
      published_at: str,
      /* Not nullable: a publication a reader can be sent has an address, and a blank one
         would print an empty box beside a Copy link button that copies nothing. */
      link: str,
    }),
  ),
})

const WHATIF_READER = shape({
  email: str,
  name: str,
  role_id: str,
  role_label: str,
  access_note: str,
})

const WHATIF_GRAPH_OPTION = shape({
  use_case_id: str,
  name: str,
  version: nullable(str),
  sha256: nullable(str),
  built_at: nullable(str),
})

const WHATIF_PUBLISHING = shape({
  publish_title: str,
  manage_title: str,
  call: str,
  readers: shape({
    label: str,
    placeholder: str,
    empty_error: str,
    caveat: str,
    scope_note: str,
  }),
  graph: shape({ label: str, note: str, empty: str }),
  freshness: shape({
    label: str,
    presets: arrayOf(shape({ id: str, label: str, sentence: str })),
    days: arrayOf(str),
    times: arrayOf(str),
    units: arrayOf(str),
    default: WHATIF_FRESHNESS,
    no_day_error: str,
  }),
  done: shape({
    title: str,
    body: str,
    stored: str,
    link: shape({ label: str, copied: str }),
    labels: shape({ cases: str, readers: str, graph: str, numbers: str, access: str }),
    graph_note: str,
    access_note: str,
    audit_link: str,
    buttons: shape({ again: str, close: str }),
  }),
  buttons: shape({
    publish: str,
    update: str,
    unpublish: str,
    manage: str,
    open: str,
  }),
  unpublished_note: str,
})

const WHATIF_FRAME = shape({
  connected_sources: num,
  /* The publish gate, the same three counts the report section carries. */
  published_count: num,
  built_count: num,
  draft_count: num,
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
  /* Both empty before a graph is published, and the gate branch sends them so anyway —
     the shape is checked on every branch, not only the one with data. */
  readers: arrayOf(WHATIF_READER),
  graphs: arrayOf(WHATIF_GRAPH_OPTION),
  publishing: WHATIF_PUBLISHING,
  /* `nullable` accepts an absent key as well as null, which is what a dataset with a computed lens
     sends. A *present* one is checked in full — this object is what the page frames instead of the
     lens, so a missing `file` is a blank frame and a missing `title` is a bar labelled `undefined`. */
  document: nullable(
    shape({
      document_id: str,
      file: str,
      title: str,
      version: str,
      stage: str,
      heading: str,
      subtitle: str,
      tabs: arrayOf(shape({ key: str, label: str })),
    }),
  ),
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
    /* The palette is the package's own: a node type states its colour, and the generator
       states one per risk tier. A component picking hues here would be inventing a legend. */
    node_types: arrayOf(
      shape({ key: str, label: str, color: str, risk_colors: nullable(objectOnly) }),
    ),
    relationships: arrayOf(str),
    frame: shape({
      description: str,
      center_node: str,
      edge: str,
      max_drawn: num,
    }),
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
    nodes: arrayOf(
      shape({
        key: str,
        label: str,
        count: nullable(num),
        risk: nullable(oneOf(['high', 'med', 'low'])),
      }),
    ),
    edges: arrayOf(shape({ from: str, to: str, label: str })),
    relationships: arrayOf(str),
  }),
})

const WHATIF_SAVED_PAYLOAD = shape({ saved: arrayOf(WHATIF_SAVED) })
/* A write answers with the library *and* the id it touched, so the page can link the
   runtime to the entry without guessing which row is new. */
const WHATIF_SAVED_WRITE = shape({ saved: arrayOf(WHATIF_SAVED), saved_id: str })

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

interface RawWhatIfFreshness {
  preset: string
  every: number
  unit: string
  days: string[]
  time: string
}

interface RawWhatIfSaved {
  saved_id: string
  name: string
  created_at: string
  updated_at: string
  watch: string[]
  pool: string
  cases: { name: string; generator_id: string }[]
  published: {
    readers: string[]
    graph_use_case_id: string
    graph_name: string
    graph_version: string | null
    graph_sha256: string | null
    freshness: RawWhatIfFreshness
    published_by: string
    published_at: string
    link: string
  } | null
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
  createdAt: s.created_at,
  updatedAt: s.updated_at,
  watch: s.watch,
  pool: s.pool,
  cases: s.cases.map((c) => ({ name: c.name, generatorId: c.generator_id })),
  published: s.published
    ? {
        readers: s.published.readers,
        graphUseCaseId: s.published.graph_use_case_id,
        graphName: s.published.graph_name,
        graphVersion: s.published.graph_version,
        graphSha256: s.published.graph_sha256,
        freshness: s.published.freshness,
        publishedBy: s.published.published_by,
        publishedAt: s.published.published_at,
        link: s.published.link,
      }
    : null,
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
  published_count: number
  built_count: number
  draft_count: number
  facility: WhatIfFrame['facility']
  generators: RawWhatIfGenerator[]
  watched_measures: WhatIfMeasure[]
  candidate_pools: WhatIfPool[]
  headroom: WhatIfHeadroom[]
  saved: RawWhatIfSaved[]
  readers: {
    email: string
    name: string
    role_id: string
    role_label: string
    access_note: string
  }[]
  graphs: {
    use_case_id: string
    name: string
    version: string | null
    sha256: string | null
    built_at: string | null
  }[]
  document: {
    document_id: string
    file: string
    title: string
    version: string
    stage: string
    heading: string
    subtitle: string
    tabs: { key: string; label: string }[]
  } | null
  publishing: {
    publish_title: string
    manage_title: string
    call: string
    readers: {
      label: string
      placeholder: string
      empty_error: string
      caveat: string
      scope_note: string
    }
    graph: { label: string; note: string; empty: string }
    freshness: {
      label: string
      presets: { id: string; label: string; sentence: string }[]
      days: string[]
      times: string[]
      units: string[]
      default: RawWhatIfFreshness
      no_day_error: string
    }
    done: {
      title: string
      body: string
      stored: string
      link: { label: string; copied: string }
      labels: { cases: string; readers: string; graph: string; numbers: string; access: string }
      graph_note: string
      access_note: string
      audit_link: string
      buttons: { again: string; close: string }
    }
    buttons: {
      publish: string
      update: string
      unpublish: string
      manage: string
      open: string
    }
    unpublished_note: string
  }
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
  graph_reference: {
    node_types: {
      key: string
      label: string
      color: string
      risk_colors?: Record<string, string>
    }[]
    relationships: string[]
    frame: { description: string; center_node: string; edge: string; max_drawn: number }
  }
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
    publishedCount: raw.published_count,
    builtCount: raw.built_count,
    draftCount: raw.draft_count,
    facility: raw.facility,
    generators: raw.generators.map(toWhatIfGenerator),
    measures: raw.watched_measures,
    pools: raw.candidate_pools,
    headroom: raw.headroom,
    saved: raw.saved.map(toWhatIfSaved),
    readers: raw.readers.map((r) => ({
      email: r.email,
      name: r.name,
      roleId: r.role_id,
      roleLabel: r.role_label,
      accessNote: r.access_note,
    })),
    graphs: raw.graphs.map((g) => ({
      useCaseId: g.use_case_id,
      name: g.name,
      version: g.version,
      sha256: g.sha256,
      builtAt: g.built_at,
    })),
    publishing: {
      publishTitle: raw.publishing.publish_title,
      manageTitle: raw.publishing.manage_title,
      call: raw.publishing.call,
      readers: {
        label: raw.publishing.readers.label,
        placeholder: raw.publishing.readers.placeholder,
        emptyError: raw.publishing.readers.empty_error,
        caveat: raw.publishing.readers.caveat,
        scopeNote: raw.publishing.readers.scope_note,
      },
      graph: raw.publishing.graph,
      freshness: {
        label: raw.publishing.freshness.label,
        presets: raw.publishing.freshness.presets,
        days: raw.publishing.freshness.days,
        times: raw.publishing.freshness.times,
        units: raw.publishing.freshness.units,
        default: raw.publishing.freshness.default,
        noDayError: raw.publishing.freshness.no_day_error,
      },
      done: {
        title: raw.publishing.done.title,
        body: raw.publishing.done.body,
        stored: raw.publishing.done.stored,
        link: raw.publishing.done.link,
        labels: raw.publishing.done.labels,
        graphNote: raw.publishing.done.graph_note,
        accessNote: raw.publishing.done.access_note,
        auditLink: raw.publishing.done.audit_link,
        buttons: raw.publishing.done.buttons,
      },
      buttons: raw.publishing.buttons,
      unpublishedNote: raw.publishing.unpublished_note,
    },
    document:
      raw.document === null || raw.document === undefined
        ? null
        : {
            documentId: raw.document.document_id,
            file: raw.document.file,
            title: raw.document.title,
            version: raw.document.version,
            stage: raw.document.stage,
            heading: raw.document.heading,
            subtitle: raw.document.subtitle,
            tabs: raw.document.tabs,
          },
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
      nodeTypes: raw.graph_reference.node_types.map((t) => ({
        key: t.key,
        label: t.label,
        color: t.color,
        riskColors: t.risk_colors,
      })),
      relationships: raw.graph_reference.relationships,
      frame: {
        description: raw.graph_reference.frame.description,
        centerNode: raw.graph_reference.frame.center_node,
        edge: raw.graph_reference.frame.edge,
        maxDrawn: raw.graph_reference.frame.max_drawn,
      },
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
  subgraph: {
    nodes: WhatIfSubgraphNode[]
    edges: WhatIfSubgraphEdge[]
    relationships: string[]
  }
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

/**
 * Save or update a library entry — the **whole scenario**, frame included.
 *
 * The frame travels with the cases because it is what makes them mean anything: a case
 * re-opened without the measures it was judged against and the pool it was drawn from is
 * a load with no question attached. Stores the admitted loads, never the figures.
 */
export async function saveWhatIfScenario(input: {
  savedId?: string | null
  name: string
  watch: string[]
  pool: string
  cases: WhatIfCase[]
}): Promise<{ saved: WhatIfSaved[]; savedId: string }> {
  const raw = validate<{ saved: RawWhatIfSaved[]; saved_id: string }>(
    'The saved scenario',
    await request<unknown>('/whatif/saved', {
      method: 'POST',
      body: {
        saved_id: input.savedId ?? null,
        name: input.name,
        watch: input.watch,
        pool: input.pool,
        cases: input.cases.map((c) => ({ name: c.name, generator_id: c.generatorId })),
      },
    }),
    WHATIF_SAVED_WRITE,
  )
  return { saved: raw.saved.map(toWhatIfSaved), savedId: raw.saved_id }
}

/**
 * Publish a saved scenario: who is told, which published graph answers it, how often.
 *
 * `as` is the signed-in address, sent for the reason every "who did this" field in this
 * app is sent — the identity is client-held and the server has nothing to look it up
 * from. The server refuses a reader outside the directory and a graph that is not
 * currently published, so neither can be invented here.
 */
export async function publishWhatIfScenario(input: {
  savedId: string
  readers: string[]
  graphUseCaseId: string
  freshness: WhatIfFreshness
  as?: string | null
}): Promise<WhatIfSaved[]> {
  const query = input.as ? `?as=${encodeURIComponent(input.as)}` : ''
  const raw = validate<{ saved: RawWhatIfSaved[]; saved_id: string }>(
    'The published scenario',
    await request<unknown>(`/whatif/saved/${encodeURIComponent(input.savedId)}/publish${query}`, {
      method: 'POST',
      body: {
        readers: input.readers,
        graph_use_case_id: input.graphUseCaseId,
        freshness: input.freshness,
      },
    }),
    WHATIF_SAVED_WRITE,
  )
  return raw.saved.map(toWhatIfSaved)
}

/** Stop a scenario being readable. It stays in the library — that is the promise made. */
export async function unpublishWhatIfScenario(savedId: string): Promise<WhatIfSaved[]> {
  const raw = validate<{ saved: RawWhatIfSaved[]; saved_id: string }>(
    'The unpublished scenario',
    await request<unknown>(`/whatif/saved/${encodeURIComponent(savedId)}/publish`, {
      method: 'DELETE',
    }),
    WHATIF_SAVED_WRITE,
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

/* ---------------- Reports ---------------- */

/*
 * The report section: five written reports over four rosters.
 *
 * **Every figure here was computed by the server**, including each chart's series and
 * each table's order — a report is a question re-asked of the roster, not a stored
 * result, so nothing on this side sums a column. The one thing the client decides is
 * the chart *form*, and `AnswerChart` already owns that decision.
 *
 * A row is deliberately **not** camelCased. Its keys are the field keys the report's own
 * columns name (`last_enf`, `gen_state`), and a table looks a cell up by that key —
 * renaming them here would leave every column reading its header from the data and its
 * value from nowhere.
 */

/**
 * A summary tile, as the package's report rendered it.
 *
 * `tone` excludes `info` because these are the four tones a `Stat` accepts and a tile
 * *is* a `Stat` — the report's own reading of its figure, carried through unchanged.
 */
export interface ReportTile {
  label: string
  /** Formatted by the report: "$1.80M", "26 / 46", "Class I". */
  value: string
  unit: string
  tone: Exclude<Tone, 'info'> | null
}

/** One labelled segment of a report's footer — "Source.", "Confidence.", "Bridge.". */
export interface ReportFootnote {
  label: string
  text: string
}

export interface ReportColumn {
  key: string
  label: string
  /** `num` is right-aligned and tabular; `cat` reads as text. */
  kind: 'num' | 'cat'
}

/** A cell is whatever the roster carries — a trace's custody chain is a list. */
export type ReportCell = string | number | boolean | string[]
export type ReportRow = Record<string, ReportCell>

/**
 * Charts are the answer-chart shape exactly, so one component draws both.
 *
 * A report's chart may carry a **companion** — the share beside the ranking, as the package's
 * decree report draws them side by side. It is a chart in its own right, computed on the
 * server; the block does not become a container of two, because the second answers a question
 * the first raises rather than standing alone.
 */
export type ReportChart = Extract<AnswerBlock, { type: 'chart' }> & {
  companion?: Extract<AnswerBlock, { type: 'chart' }> | null
}

export type ReportBlock =
  | ReportChart
  | {
      type: 'table'
      title: string
      columns: ReportColumn[]
      rows: ReportRow[]
      /** What the ranking is, stated: an unexplained order reads as significant. */
      sortedBy: string | null
    }
  | {
      type: 'facilities'
      title: string
      columns: ReportColumn[]
      rows: ReportRow[]
      /** The facility the scorecard is about, so its row can be marked. */
      subject: string | null
      charts: ReportChart[]
    }
  | {
      type: 'quarterly'
      title: string
      columns: ReportColumn[]
      rows: ReportRow[]
      charts: ReportChart[]
    }
  | { type: 'traces'; title: string; columns: ReportColumn[]; rows: ReportRow[] }

/** One card in the section list. */
export interface ReportSummary {
  reportId: string
  reportTag: string
  heading: string
  subtitle: string
  question: string
  spine: string
  /** Rows this report is about, and rows on its spine — 4 of 36 is the report. */
  rowCount: number
  spineTotal: number
  blockKinds: string[]
  tiles: ReportTile[]
}

/**
 * A **rendered** report a dataset ships as a finished document rather than as a question.
 *
 * EPA has none: its five reports are computed per request from the rosters, which is what makes a
 * figure there current rather than stored. CAPEX ships three standalone HTML documents and no roster to
 * compute from, so they are listed as documents and every figure stays inside the file — transcribing
 * one into a component is the change that would look right on screen and break the section's premise.
 *
 * Every field here is read out of the document itself by `npm run ingest:capex`, including the title, so
 * the Library prints the name the report gives itself.
 */
export interface ReportDocument {
  documentId: string
  /** The id baked into the document, which is what selects the report inside it. */
  reportId: string
  /** The file, relative to the dataset's report folder. Resolved to a URL by the page, not here. */
  file: string
  /**
   * The specification document that says how this report is built, or null where the dataset ships none.
   *
   * Framed while the report is being built, in place of the narrated build steps — the dataset's own
   * account of what the agent resolved and which measures it bound, rather than a summary of composing a
   * report in general. Resolved to a URL by the page like `file`, and nullable because a document
   * predating the specs is a document with none rather than a malformed one.
   */
  specFile: string | null
  title: string
  subtitle: string
  category: string
  /** One of the governance state pool's keys, so a card and a chip cannot disagree about it. */
  status: string
  version: string
  slug: string
  author: string
  /** The document's own refresh sentence — "Daily 07:00 UTC" — rather than its cron. */
  refresh: string
  updatedAt: string
}

export interface ReportsIndex {
  connectedSources: number
  /**
   * The publish gate. `publishedCount` is the precondition; `builtCount` and `draftCount`
   * are what the empty state needs to name the right fix — "finish the wizard" and
   * "press Publish" are different problems.
   */
  publishedCount: number
  builtCount: number
  draftCount: number
  /**
   * The rendered documents this dataset ships, and its authoring exploration.
   *
   * Both ride on the payload whether or not a graph is published, because the publish gate is about
   * questions asked of a graph and a rendered document asked nothing of one.
   */
  documents: ReportDocument[]
  authoringDocument: string | null
  /** Every published graph a question may be asked of, newest build first. */
  graphs: ReportGraph[]
  /** The default — the newest published — for a report opened straight off the section. */
  graph: ReportGraph | null
  reports: ReportSummary[]
  saved: SavedReport[]
  /** Null while either gate is closed — the wizard has nothing to ask against. */
  authoring: ReportAuthoring | null
  /** The three tabs' payload. Null while the publish gate is closed, like `authoring`. */
  governance: ReportGovernance | null
}

export interface Report {
  reportId: string
  reportTag: string
  heading: string
  subtitle: string
  badge: string
  /** Only two of the five carry a lead note. */
  note: string | null
  title: string
  question: string
  spine: string
  rowCount: number
  spineTotal: number
  /** The question as a sentence, with its assumptions filled in. */
  reading: string
  assumptions: { slot: string; label: string }[]
  /** What this report can be sliced by — rendered as its chip bar. */
  facets: ReportFacet[]
  /** The frame it was built under, in values: what a chip re-asks it with. */
  frame: ReportFrame
  tiles: ReportTile[]
  footer: ReportFootnote[]
  blocks: ReportBlock[]
  sourceTrace: string
  /** The published graph this was answered against — null only before one exists. */
  graph: ReportGraph | null
}

/**
 * The published graph the section is asked of.
 *
 * A report is available once a graph has been published, so the content that answered it
 * is reportable — the same claim Ask makes about its own answers, for the same reason.
 */
export interface ReportGraph {
  useCaseId: string
  name: string
  domainId: string | null
  version: string | null
  /** Null on a graph that is no longer published — there is no live content to name. */
  sha256: string | null
  builtAt: string | null
  /**
   * Who published it: the account that pressed Publish, which the publish route is told as
   * `?as=`. Null only where nothing is published; the tenant's own account stands in for a
   * version published before this was recorded.
   */
  publishedBy: string | null
  entityCount: number | null
  relationshipCount: number | null
  /** False on a saved report whose graph has since been unpublished. */
  live: boolean
}

const REPORT_TILE = shape({
  label: str,
  value: str,
  unit: str,
  tone: nullable(oneOf(['good', 'warn', 'crit', 'neutral'])),
})

const REPORT_COLUMNS = arrayOf(shape({ key: str, label: str, kind: oneOf(['num', 'cat']) }))
/* A row's own keys are the report's field keys, so only its object-ness is checked here.
   The columns are what a table renders, and every one of those is checked above. */
const REPORT_ROWS = arrayOf(shape({}))

/* One field list, two shapes: a chart, and a chart that may carry a companion. */
const REPORT_CHART_FIELDS = {
  type: oneOf(['chart']),
  chart: oneOf(['bar', 'line', 'column', 'grouped', 'pie', 'donut']),
  title: str,
  x_label: nullable(str),
  y_label: nullable(str),
  note: nullable(str),
  width: nullable(num),
  series: nullable(arrayOf(shape({ key: str, label: str }))),
  data: arrayOf(
    shape({
      label: str,
      value: num,
      tone: nullable(oneOf(['good', 'warn', 'crit'])),
      values: nullable(objectOnly),
    }),
  ),
}

const REPORT_CHART = shape(REPORT_CHART_FIELDS)

const REPORT_CHART_WITH_COMPANION = shape({
  ...REPORT_CHART_FIELDS,
  companion: nullable(shape(REPORT_CHART_FIELDS)),
})

const REPORT_BLOCK = variant('type', {
  chart: REPORT_CHART_WITH_COMPANION,
  table: shape({
    title: str,
    columns: REPORT_COLUMNS,
    rows: REPORT_ROWS,
    sorted_by: nullable(str),
  }),
  facilities: shape({
    title: str,
    columns: REPORT_COLUMNS,
    rows: REPORT_ROWS,
    subject: nullable(str),
    charts: arrayOf(REPORT_CHART),
  }),
  quarterly: shape({
    title: str,
    columns: REPORT_COLUMNS,
    rows: REPORT_ROWS,
    charts: arrayOf(REPORT_CHART),
  }),
  traces: shape({ title: str, columns: REPORT_COLUMNS, rows: REPORT_ROWS }),
})

/* Nullable because it is null until a graph is published, which is the gate itself. */
const REPORT_GRAPH_FIELDS = {
  use_case_id: str,
  name: str,
  domain_id: nullable(str),
  version: nullable(str),
  sha256: nullable(str),
  built_at: nullable(str),
  published_by: nullable(str),
  entity_count: nullable(num),
  relationship_count: nullable(num),
  live: nullable(bool),
}
const REPORT_GRAPH = nullable(shape(REPORT_GRAPH_FIELDS))
const REPORT_GRAPHS = arrayOf(shape(REPORT_GRAPH_FIELDS))

/* ---------------- Reports: authoring ---------------- */

/*
 * Authoring a report is three steps and two calls, and the split is the promise the page
 * makes: **"nothing runs against your compliance data until you're happy with it"**.
 *
 *   POST /reports/read   → a sentence and a frame. No figures. Paced, because reading a
 *                          question back is the one act here that reads as a model call.
 *   POST /reports/build  → the report. Every figure computed server-side, and the payload
 *                          says whether it is the *written* report or a **generated** one.
 *
 * A saved report holds its frame and never its figures, so re-opening one re-asks it —
 * the same rule the What-if library follows.
 */

/** One option on a picker, with the tenant's own gloss. */
export interface ReportOption {
  value: string
  label: string
  detail: string
}

/** The three questions a frame answers, and what each may be set to. */
export interface ReportOpts {
  scope: { question: string; options: ReportOption[] }
  measure: { question: string; options: ReportOption[] }
  horizon: { question: string; options: ReportOption[] }
}

/** A facet a generator report can be sliced by, with the values present in the roster. */
export interface ReportFacet {
  key: string
  label: string
  values: { value: string; label: string; count: number }[]
}

export interface ReportAuthoring {
  opts: ReportOpts
  facets: ReportFacet[]
  defaults: { scope: string; measure: string; horizon: string }
}

/** What a report is asked under. Sent to /reports/build and stored in the library. */
export interface ReportFrame {
  reportId: string
  /** The published graph this is asked of — part of the frame, not of the request. */
  useCaseId: string | null
  scope: string
  measure: string
  horizon: string
  filters: { key: string; value: string }[]
}

/** A filter as the built report reports it back, with both labels resolved. */
export interface ReportFilter {
  key: string
  label: string
  value: string
  valueLabel: string
}

/** The read-back: what the question was understood as, before anything runs. */
export interface ReportReadBack {
  question: string
  /** The graph the question is being asked of, echoed back. */
  graph: ReportGraph | null
  /** False is a real outcome: it was read as the register and says so. */
  matched: boolean
  why: string
  reportTag: string
  heading: string
  spine: string
  frame: ReportFrame
  reading: string
  assumptions: { slot: string; label: string }[]
  caveats: string[]
}

/** A built report: a `Report`, plus what makes it this frame's rather than the written one. */
export interface BuiltReport extends Report {
  /** `written` = the frame the report was written for; `generated` = re-asked. */
  variant: 'written' | 'generated'
  filters: ReportFilter[]
  /** Null unless the spine has no summary to compute — said rather than left blank. */
  summaryNote: string | null
  caveats: string[]
}

export interface SavedReport {
  savedId: string
  name: string
  question: string | null
  reportId: string
  /** The graph it was asked of — `live: false` if that graph is no longer published. */
  graph: ReportGraph | null
  /** The signed-in address the browser sent when it was saved. */
  savedBy: string | null
  /**
   * The roles this report is meant for.
   *
   * A demo control, not a permission: the role is client-held, so it narrows what the section
   * shows a reader rather than what the API will serve. Defaults to every role.
   */
  viewerRoles: { roleId: string; label: string }[]
  reportTag: string
  heading: string
  scope: string
  measure: string
  horizon: string
  scopeLabel: string
  measureLabel: string
  horizonLabel: string
  filters: ReportFilter[]
  savedAt: string
}

const REPORT_OPTS = shape({
  scope: shape({ q: str, options: arrayOf(shape({ value: str, label: str, d: str })) }),
  measure: shape({ q: str, options: arrayOf(shape({ value: str, label: str, d: str })) }),
  horizon: shape({ q: str, options: arrayOf(shape({ value: str, label: str, d: str })) }),
})

const REPORT_AUTHORING = nullable(
  shape({
    opts: REPORT_OPTS,
    facets: arrayOf(
      shape({
        key: str,
        label: str,
        values: arrayOf(shape({ value: str, label: str, count: num })),
      }),
    ),
    defaults: shape({ scope: str, measure: str, horizon: str }),
  }),
)

const REPORT_FILTERS = arrayOf(shape({ key: str, label: str, value: str, value_label: str }))

const REPORT_FRAME = shape({
  report_id: str,
  use_case_id: nullable(str),
  scope: str,
  measure: str,
  horizon: str,
  filters: arrayOf(shape({ key: str, value: str })),
})

const REPORT_READBACK = shape({
  question: str,
  graph: REPORT_GRAPH,
  matched: bool,
  why: str,
  report_tag: str,
  heading: str,
  spine: str,
  frame: REPORT_FRAME,
  reading: str,
  assumptions: arrayOf(shape({ slot: str, label: str })),
  caveats: arrayOf(str),
})

const REPORT_SAVED_ROW = shape({
  saved_id: str,
  name: str,
  question: nullable(str),
  report_id: str,
  use_case_id: nullable(str),
  graph: REPORT_GRAPH,
  saved_by: nullable(str),
  viewer_roles: arrayOf(shape({ role_id: str, label: str })),
    report_tag: str,
    heading: str,
    scope: str,
    measure: str,
    horizon: str,
    scope_label: str,
    measure_label: str,
    horizon_label: str,
  filters: REPORT_FILTERS,
  saved_at: str,
})

const REPORT_SAVED = arrayOf(REPORT_SAVED_ROW)
const REPORT_SAVED_PAYLOAD = shape({ saved: REPORT_SAVED })



/*
 * ---------------- the section's governance view ----------------
 *
 * The three tabs — Library, Author, Operations & audience — are one payload, computed by the
 * server on every request. Nothing here is figures a component could recompute: the chip counts,
 * the floor line, each entitlement cell and every check arrive decided, because a governance grid
 * is exactly where a second source becomes a second answer.
 */

/** One card in the Library, written or composed. */
export interface GovernedReport {
  reportId: string
  /** `written` is one of the tenant's five definitions; `saved` is one someone composed. */
  kind: 'written' | 'saved'
  savedId: string | null
  reportTag: string
  title: string
  /** The report's own question, quoted on the card rather than paraphrased. */
  question: string
  lead: string
  status: string
  statusLabel: string
  tone: Tone
  version: string | null
  author: string | null
  category: string
  asOf: string | null
  schedule: string
  /** null when nothing was recorded — never the word "none" pretending to be an approval. */
  approval: string | null
  note: string | null
  floor: string | null
  parameterized: boolean
  rowCount: number
  spineTotal: number
  /** Shared with nobody — a decision Share made, not an audience that failed to resolve. */
  private: boolean
  /** How many role ids the audience *names*, beside how many resolved in `entitledRoles`. */
  audienceNamed: number
  /**
   * The roles the audience names, resolved.
   *
   * **Stated, not enforced.** A per-row `access` block once said whether the calling role could open
   * a report and what it had requested; it and its endpoint were removed. Nothing replaced them,
   * which is the honest position: the role is client-held and the login authenticates by shape, so
   * the API serves every row to a caller that names none and a gate built on this was never access
   * control. `as_role` still narrows the *saved* rows and still reports `viewer.notEntitledCount`.
   */
  entitledRoles: { roleId: string; label: string }[]
}

export interface GovernanceStatus {
  key: string
  label: string
  tone: Tone
  count: number
}

/** The data scope a persona carries — declared, and the page says it is not applied. */
export interface DataScopeRow {
  roleId: string
  label: string
  scope: string
  predicate: string
  grain: string
  masked: string
  mayAuthor: boolean
}

export interface EntitlementCell {
  reportId: string
  state: string
  label: string
  tone: Tone
}

/**
 * The publish dialog's copy.
 *
 * Authored in the governance seed rather than shipped by the package, because the prototype's own
 * dialog states that "a Domain Architect approves before the audience sees it" — a claim that
 * stopped being true when publish → approve → activate collapsed to publish/unpublish. A freshness
 * preset carries its own `sentence` so the line under the select is the tenant's words.
 */
export interface ReportPublishing {
  title: string
  republishTitle: string
  lead: string
  name: { label: string; help: string; placeholder: string }
  readers: {
    label: string
    placeholder: string
    empty: string
    note: string
    caveat: string
    localCaveat: string
  }
  freshness: {
    label: string
    presets: { id: string; label: string; sentence: string }[]
    default: string
  }
  foot: string
  buttons: { publish: string; republish: string; cancel: string }
}

export interface ReportGovernance {
  reports: GovernedReport[]
  /**
   * Definitions the tenant has that nothing governs — normally empty.
   *
   * A report is a definition (`db.reports.reports`, ingested) plus the decision to govern it
   * (`governance.reports`, seeded). Delete drops the second, and the row then leaves the Library with
   * nothing saying why: the list is just shorter, which reads as data loss. This is that gap, named,
   * so the page can state it instead of leaving somebody to count cards. It is also what a **stale
   * process** looks like — one that deleted a row before `db.json` was re-seeded keeps serving the
   * short list from memory, and this says which one it is short.
   */
  ungoverned: { reportId: string; reportTag: string; title: string }[]
  /** The command that re-authors them. Served, so one string says it everywhere. */
  restore: string
  /**
   * Who the publish dialog can pick, and what each of them may see.
   *
   * The tenant's own users with the persona they sign in as. A person is picked and their **role**
   * is what a report's audience stores, because `viewer_roles` is the audience model the
   * entitlement matrix and `?as_role=` already read — an address here would be a second one.
   *
   * `scope` and `masked` are the persona's *declared* data scope, the same `data_scope` row gate 2
   * renders. Stated beside a name, never applied: no roster in this section is filtered per
   * persona, so a count would claim a filter that never ran.
   */
  people: {
    email: string
    name: string
    roleId: string
    roleLabel: string
    scope: string | null
    masked: string | null
  }[]
  /** The publish dialog's copy, authored by `npm run seed:governance`. */
  publishing: ReportPublishing
  statuses: GovernanceStatus[]
  categories: string[]
  viewer: {
    roleId: string | null
    label: string | null
    entitledCount: number
    notEntitledCount: number
    scope: DataScopeRow | null
  }
  author: { mayAuthor: boolean; note: string; authors: string[] }
  gates: {
    note: string
    entitlement: {
      note: string
      columns: { reportId: string; title: string; reportTag: string; status: string }[]
      roles: { roleId: string; label: string; cells: EntitlementCell[] }[]
    }
    dataScope: { note: string; rows: DataScopeRow[] }
  }
  schedule: {
    reportId: string
    title: string
    schedule: string
    asOf: string | null
    floor: string | null
    parameterized: boolean
    statusLabel: string
    tone: Tone
  }[]
  audit: {
    reportId: string
    title: string
    act: string
    actor: string
    at: string | null
    detail: string
    tone: Tone
  }[]
  publishChecks: {
    reportId: string
    title: string
    checks: { key: string; label: string; pass: boolean; detail: string }[]
  }[]
}

const TONE = oneOf(['good', 'warn', 'crit', 'info', 'neutral'])

const GOVERNED_REPORT = shape({
  report_id: str,
  kind: oneOf(['written', 'saved']),
  saved_id: nullable(str),
  report_tag: str,
  title: str,
  question: str,
  lead: str,
  status: str,
  status_label: str,
  tone: TONE,
  version: nullable(str),
  author: nullable(str),
  category: str,
  as_of: nullable(str),
  schedule: str,
  approval: nullable(str),
  note: nullable(str),
  floor: nullable(str),
  parameterized: bool,
  row_count: num,
  spine_total: num,
  private: bool,
  audience_named: num,
  entitled_roles: arrayOf(shape({ role_id: str, label: str })),
})

const DATA_SCOPE_ROW = shape({
  role_id: str,
  /*
   * Absent on the banner's own row.
   *
   * Gate 2's rows are resolved against `auth_roles` on the way out and carry a label; the
   * viewer's scope is the governance row itself, and the persona's name is already beside it as
   * `viewer.label`. So the label is optional here and falls back to the id rather than being
   * required of a payload that has no reason to repeat it.
   */
  label: nullable(str),
  scope: str,
  predicate: str,
  grain: str,
  masked: str,
  may_author: bool,
})

const REPORT_GOVERNANCE = shape({
  reports: arrayOf(GOVERNED_REPORT),
  ungoverned: arrayOf(shape({ report_id: str, report_tag: str, title: str })),
  restore: str,
  people: arrayOf(
    shape({
      email: str,
      name: str,
      role_id: str,
      role_label: str,
      /* Nullable: a persona with no `data_scope` row has no declared scope to state, and an
         invented one would be the dialog answering for gate 2. */
      scope: nullable(str),
      masked: nullable(str),
    }),
  ),
  publishing: shape({
    title: str,
    republish_title: str,
    lead: str,
    name: shape({ label: str, help: str, placeholder: str }),
    readers: shape({
      label: str,
      placeholder: str,
      empty: str,
      note: str,
      caveat: str,
      local_caveat: str,
    }),
    freshness: shape({
      label: str,
      presets: arrayOf(shape({ id: str, label: str, sentence: str })),
      default: str,
    }),
    foot: str,
    buttons: shape({ publish: str, republish: str, cancel: str }),
  }),
  statuses: arrayOf(shape({ key: str, label: str, tone: TONE, count: num })),
  categories: arrayOf(str),
  viewer: shape({
    role_id: nullable(str),
    label: nullable(str),
    entitled_count: num,
    not_entitled_count: num,
    scope: nullable(DATA_SCOPE_ROW),
  }),
  author: shape({ may_author: bool, note: str, authors: arrayOf(str) }),
  gates: shape({
    note: str,
    entitlement: shape({
      note: str,
      columns: arrayOf(shape({ report_id: str, title: str, report_tag: str, status: str })),
      roles: arrayOf(
        shape({
          role_id: str,
          label: str,
          cells: arrayOf(shape({ report_id: str, state: str, label: str, tone: TONE })),
        }),
      ),
    }),
    data_scope: shape({ note: str, rows: arrayOf(DATA_SCOPE_ROW) }),
  }),
  schedule: arrayOf(
    shape({
      report_id: str,
      title: str,
      schedule: str,
      as_of: nullable(str),
      floor: nullable(str),
      parameterized: bool,
      status_label: str,
      tone: TONE,
    }),
  ),
  audit: arrayOf(
    shape({
      report_id: str,
      title: str,
      act: str,
      actor: str,
      at: nullable(str),
      detail: str,
      tone: TONE,
    }),
  ),
  publish_checks: arrayOf(
    shape({
      report_id: str,
      title: str,
      checks: arrayOf(shape({ key: str, label: str, pass: bool, detail: str })),
    }),
  ),
})

interface RawDataScope {
  role_id: string
  label?: string | null
  scope: string
  predicate: string
  grain: string
  masked: string
  may_author: boolean
}

const toScope = (s: RawDataScope): DataScopeRow => ({
  roleId: s.role_id,
  label: s.label ?? s.role_id,
  scope: s.scope,
  predicate: s.predicate,
  grain: s.grain,
  masked: s.masked,
  mayAuthor: s.may_author,
})

/* eslint-disable @typescript-eslint/no-explicit-any */
const toGovernance = (g: any): ReportGovernance => ({
  reports: g.reports.map((r: any) => ({
    reportId: r.report_id,
    kind: r.kind,
    savedId: r.saved_id ?? null,
    reportTag: r.report_tag,
    title: r.title,
    question: r.question,
    lead: r.lead,
    status: r.status,
    statusLabel: r.status_label,
    tone: r.tone,
    version: r.version,
    author: r.author,
    category: r.category,
    asOf: r.as_of,
    schedule: r.schedule,
    approval: r.approval,
    note: r.note,
    floor: r.floor,
    parameterized: r.parameterized,
    rowCount: r.row_count,
    spineTotal: r.spine_total,
    private: r.private,
    audienceNamed: r.audience_named,
    entitledRoles: r.entitled_roles.map((e: any) => ({ roleId: e.role_id, label: e.label })),
  })),
  ungoverned: (g.ungoverned ?? []).map((r: any) => ({
    reportId: r.report_id,
    reportTag: r.report_tag,
    title: r.title,
  })),
  restore: g.restore,
  people: (g.people ?? []).map((p: any) => ({
    email: p.email,
    name: p.name,
    roleId: p.role_id,
    roleLabel: p.role_label,
    scope: p.scope,
    masked: p.masked,
  })),
  publishing: {
    title: g.publishing.title,
    republishTitle: g.publishing.republish_title,
    lead: g.publishing.lead,
    name: g.publishing.name,
    readers: {
      label: g.publishing.readers.label,
      placeholder: g.publishing.readers.placeholder,
      empty: g.publishing.readers.empty,
      note: g.publishing.readers.note,
      caveat: g.publishing.readers.caveat,
      localCaveat: g.publishing.readers.local_caveat,
    },
    freshness: g.publishing.freshness,
    foot: g.publishing.foot,
    buttons: g.publishing.buttons,
  },
  statuses: g.statuses,
  categories: g.categories,
  viewer: {
    roleId: g.viewer.role_id,
    label: g.viewer.label,
    entitledCount: g.viewer.entitled_count,
    notEntitledCount: g.viewer.not_entitled_count,
    scope: g.viewer.scope ? toScope(g.viewer.scope) : null,
  },
  author: { mayAuthor: g.author.may_author, note: g.author.note, authors: g.author.authors },
  gates: {
    note: g.gates.note,
    entitlement: {
      note: g.gates.entitlement.note,
      columns: g.gates.entitlement.columns.map((c: any) => ({
        reportId: c.report_id,
        title: c.title,
        reportTag: c.report_tag,
        status: c.status,
      })),
      roles: g.gates.entitlement.roles.map((r: any) => ({
        roleId: r.role_id,
        label: r.label,
        cells: r.cells.map((c: any) => ({
          reportId: c.report_id,
          state: c.state,
          label: c.label,
          tone: c.tone,
        })),
      })),
    },
    dataScope: {
      note: g.gates.data_scope.note,
      rows: g.gates.data_scope.rows.map(toScope),
    },
  },
  schedule: g.schedule.map((s: any) => ({
    reportId: s.report_id,
    title: s.title,
    schedule: s.schedule,
    asOf: s.as_of,
    floor: s.floor,
    parameterized: s.parameterized,
    statusLabel: s.status_label,
    tone: s.tone,
  })),
  audit: g.audit.map((a: any) => ({
    reportId: a.report_id,
    title: a.title,
    act: a.act,
    actor: a.actor,
    at: a.at,
    detail: a.detail,
    tone: a.tone,
  })),
  publishChecks: g.publish_checks.map((p: any) => ({
    reportId: p.report_id,
    title: p.title,
    checks: p.checks,
  })),
})
/* eslint-enable @typescript-eslint/no-explicit-any */

const REPORTS_INDEX = shape({
  connected_sources: num,
  /* Null while the publish gate is closed: the section has no library to govern until a graph
     is published, and a governance block full of empty lists would read as "nothing governed". */
  governance: nullable(REPORT_GOVERNANCE),
  published_count: num,
  built_count: num,
  draft_count: num,
  graph: REPORT_GRAPH,
  graphs: REPORT_GRAPHS,
  saved: REPORT_SAVED,
  authoring: REPORT_AUTHORING,
  documents: arrayOf(
    shape({
      document_id: str,
      report_id: str,
      file: str,
      /* Nullable, and the ingest still refuses to write a document without one: an absent spec can
         only mean a document from before they existed, which is exactly what nullable is for.
         Declaring it `str` would refuse a whole payload over a field nothing on the page needs. */
      spec_file: nullable(str),
      title: str,
      subtitle: str,
      category: str,
      status: str,
      version: str,
      slug: str,
      author: str,
      refresh: str,
      updated_at: str,
    }),
  ),
  authoring_document: nullable(str),
  reports: arrayOf(
    shape({
      report_id: str,
      report_tag: str,
      heading: str,
      subtitle: str,
      question: str,
      spine: str,
      row_count: num,
      spine_total: num,
      block_kinds: arrayOf(str),
      tiles: arrayOf(REPORT_TILE),
    }),
  ),
})

/* One report's fields, shared by the written payload and the built one — a built report
   is the same report asked under a chosen frame, so its shape cannot drift from this. */
const REPORT_FIELDS = {
  report_id: str,
  report_tag: str,
  heading: str,
  subtitle: str,
  badge: str,
  note: nullable(str),
  title: str,
  question: str,
  spine: str,
  row_count: num,
  spine_total: num,
  reading: str,
  assumptions: arrayOf(shape({ slot: str, label: str })),
  facets: arrayOf(
    shape({
      key: str,
      label: str,
      values: arrayOf(shape({ value: str, label: str, count: num })),
    }),
  ),
  frame: REPORT_FRAME,
  tiles: arrayOf(REPORT_TILE),
  footer: arrayOf(shape({ label: str, text: str })),
  blocks: arrayOf(REPORT_BLOCK),
  source_trace: str,
  graph: REPORT_GRAPH,
}

const REPORT_PAYLOAD = shape({
  connected_sources: num,
  published_count: num,
  built_count: num,
  draft_count: num,
  report: nullable(shape(REPORT_FIELDS)),
})

interface RawReportSummary {
  report_id: string
  report_tag: string
  heading: string
  subtitle: string
  question: string
  spine: string
  row_count: number
  spine_total: number
  block_kinds: string[]
  tiles: ReportTile[]
}

interface RawReportBlock {
  type: ReportBlock['type']
  title: string
  columns?: ReportColumn[]
  rows?: ReportRow[]
  sorted_by?: string | null
  subject?: string | null
  charts?: ReportChart[]
  chart?: ReportChart['chart']
  data?: ReportChart['data']
  x_label?: string | null
  y_label?: string | null
  note?: string | null
}

interface RawReport {
  report_id: string
  report_tag: string
  heading: string
  subtitle: string
  badge: string
  note: string | null
  title: string
  question: string
  spine: string
  row_count: number
  spine_total: number
  reading: string
  assumptions: { slot: string; label: string }[]
  facets: ReportFacet[]
  frame: RawReportFrame
  tiles: ReportTile[]
  footer: ReportFootnote[]
  blocks: RawReportBlock[]
  source_trace: string
  graph: RawReportGraph | null
}

interface RawReportGraph {
  use_case_id: string
  name: string
  domain_id?: string | null
  version: string | null
  sha256: string | null
  built_at: string | null
  published_by?: string | null
  entity_count?: number | null
  relationship_count?: number | null
  live?: boolean
}

const toReportGraph = (g: RawReportGraph | null): ReportGraph | null =>
  g
    ? {
        useCaseId: g.use_case_id,
        name: g.name,
        domainId: g.domain_id ?? null,
        version: g.version,
        sha256: g.sha256,
        builtAt: g.built_at,
        publishedBy: g.published_by ?? null,
        entityCount: g.entity_count ?? null,
        relationshipCount: g.relationship_count ?? null,
        /* Absent means live: only a saved report's graph carries the flag, and only
           because it can name one that has since been unpublished. */
        live: g.live ?? true,
      }
    : null

/* `sorted_by` is the only snake_case field a block carries that the UI reads; every
   other block arrives in the shape its chart or table component already takes. */
const toReportBlock = (b: RawReportBlock): ReportBlock =>
  b.type === 'table'
    ? {
        type: 'table',
        title: b.title,
        columns: b.columns ?? [],
        rows: b.rows ?? [],
        sortedBy: b.sorted_by ?? null,
      }
    : (b as unknown as ReportBlock)

/** The section: what has been written, and what this dataset cannot answer. */
export async function getReports(asRole?: string | null): Promise<ReportsIndex> {
  const raw = validate<{
    connected_sources: number
    published_count: number
    built_count: number
    draft_count: number
    graph: RawReportGraph | null
    graphs: RawReportGraph[]
    saved: RawSavedReport[]
    authoring: RawReportAuthoring | null
    documents: {
      document_id: string
      report_id: string
      file: string
      /* Absent on a document from before the specs existed, which is why the mapping defaults it. */
      spec_file?: string | null
      title: string
      subtitle: string
      category: string
      status: string
      version: string
      slug: string
      author: string
      refresh: string
      updated_at: string
    }[]
    authoring_document: string | null
    reports: RawReportSummary[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    governance: any
  }>(
    'The report section',
    await request<unknown>(
      asRole ? `/reports?as_role=${encodeURIComponent(asRole)}` : '/reports',
    ),
    REPORTS_INDEX,
  )

  return {
    connectedSources: raw.connected_sources,
    publishedCount: raw.published_count,
    builtCount: raw.built_count,
    draftCount: raw.draft_count,
    graph: toReportGraph(raw.graph),
    graphs: raw.graphs.map((g) => toReportGraph(g)).filter((g): g is ReportGraph => g !== null),
    saved: raw.saved.map(toSaved),
    authoring: raw.authoring ? toAuthoring(raw.authoring) : null,
    documents: raw.documents.map((d) => ({
      documentId: d.document_id,
      reportId: d.report_id,
      file: d.file,
      specFile: d.spec_file ?? null,
      title: d.title,
      subtitle: d.subtitle,
      category: d.category,
      status: d.status,
      version: d.version,
      slug: d.slug,
      author: d.author,
      refresh: d.refresh,
      updatedAt: d.updated_at,
    })),
    authoringDocument: raw.authoring_document,
    governance: raw.governance ? toGovernance(raw.governance) : null,
    reports: raw.reports.map((r) => ({
      reportId: r.report_id,
      reportTag: r.report_tag,
      heading: r.heading,
      subtitle: r.subtitle,
      question: r.question,
      spine: r.spine,
      rowCount: r.row_count,
      spineTotal: r.spine_total,
      blockKinds: r.block_kinds,
      tiles: r.tiles,
    })),
  }
}

/* One mapper for a report however it arrived — read by id, or built from a frame. */
const toReport = (r: RawReport): Report => ({
  reportId: r.report_id,
  reportTag: r.report_tag,
  heading: r.heading,
  subtitle: r.subtitle,
  badge: r.badge,
  note: r.note,
  title: r.title,
  question: r.question,
  spine: r.spine,
  rowCount: r.row_count,
  spineTotal: r.spine_total,
  reading: r.reading,
  assumptions: r.assumptions,
  facets: r.facets,
  frame: toFrame(r.frame),
  tiles: r.tiles,
  footer: r.footer,
  blocks: r.blocks.map(toReportBlock),
  sourceTrace: r.source_trace,
  graph: toReportGraph(r.graph),
})

/** One report, with every figure already computed against its roster. */
export async function getReport(reportId: string): Promise<{
  connectedSources: number
  publishedCount: number
  builtCount: number
  draftCount: number
  report: Report | null
}> {
  const raw = validate<{
    connected_sources: number
    published_count: number
    built_count: number
    draft_count: number
    report: RawReport | null
  }>(
    'The report',
    await request<unknown>(`/reports/${encodeURIComponent(reportId)}`),
    REPORT_PAYLOAD,
  )

  return {
    connectedSources: raw.connected_sources,
    publishedCount: raw.published_count,
    builtCount: raw.built_count,
    draftCount: raw.draft_count,
    report: raw.report ? toReport(raw.report) : null,
  }
}

interface RawReportOptSlot {
  q: string
  options: { value: string; label: string; d: string }[]
}

interface RawReportAuthoring {
  opts: Record<'scope' | 'measure' | 'horizon', RawReportOptSlot>
  facets: ReportFacet[]
  defaults: { scope: string; measure: string; horizon: string }
}

interface RawReportFrame {
  report_id: string
  use_case_id: string | null
  scope: string
  measure: string
  horizon: string
  filters: { key: string; value: string }[]
}

interface RawReportFilter {
  key: string
  label: string
  value: string
  value_label: string
}

interface RawSavedReport {
  saved_id: string
  name: string
  question: string | null
  report_id: string
  use_case_id: string | null
  graph: RawReportGraph | null
  saved_by: string | null
  viewer_roles: { role_id: string; label: string }[]
  report_tag: string
  heading: string
  scope: string
  measure: string
  horizon: string
  scope_label: string
  measure_label: string
  horizon_label: string
  filters: RawReportFilter[]
  saved_at: string
}

/* `q`/`d` are the prototype's field names for the question and the gloss; spelled out
   here because a picker's help text is read by a user, not by the prototype. */
const toOptSlot = (slot: RawReportOptSlot) => ({
  question: slot.q,
  options: slot.options.map((o) => ({ value: o.value, label: o.label, detail: o.d })),
})

const toAuthoring = (raw: RawReportAuthoring): ReportAuthoring => ({
  opts: {
    scope: toOptSlot(raw.opts.scope),
    measure: toOptSlot(raw.opts.measure),
    horizon: toOptSlot(raw.opts.horizon),
  },
  facets: raw.facets,
  defaults: raw.defaults,
})

const toFrame = (raw: RawReportFrame): ReportFrame => ({
  reportId: raw.report_id,
  useCaseId: raw.use_case_id ?? null,
  scope: raw.scope,
  measure: raw.measure,
  horizon: raw.horizon,
  filters: raw.filters,
})

const fromFrame = (frame: ReportFrame) => ({
  report_id: frame.reportId,
  use_case_id: frame.useCaseId,
  scope: frame.scope,
  measure: frame.measure,
  horizon: frame.horizon,
  filters: frame.filters,
})

const toFilter = (f: RawReportFilter): ReportFilter => ({
  key: f.key,
  label: f.label,
  value: f.value,
  valueLabel: f.value_label,
})

const toSaved = (s: RawSavedReport): SavedReport => ({
  savedId: s.saved_id,
  name: s.name,
  question: s.question,
  reportId: s.report_id,
  graph: toReportGraph(s.graph),
  savedBy: s.saved_by,
  viewerRoles: s.viewer_roles.map((r) => ({ roleId: r.role_id, label: r.label })),
  reportTag: s.report_tag,
  heading: s.heading,
  scope: s.scope,
  measure: s.measure,
  horizon: s.horizon,
  scopeLabel: s.scope_label,
  measureLabel: s.measure_label,
  horizonLabel: s.horizon_label,
  filters: s.filters.map(toFilter),
  savedAt: s.saved_at,
})

/**
 * Read a typed question back as one sentence — or start from a standard report.
 *
 * Nothing is built here. Pass `reportId` to start from a chip, in which case there is no
 * question to interpret and the answer is immediate; a typed question is paced.
 */
export async function readReportQuestion(input: {
  question?: string
  reportId?: string
  /** The published graph the question is asked of. */
  useCaseId?: string | null
}): Promise<ReportReadBack> {
  const raw = validate<{
    question: string
    graph: RawReportGraph | null
    matched: boolean
    why: string
    report_tag: string
    heading: string
    spine: string
    frame: RawReportFrame
    reading: string
    assumptions: { slot: string; label: string }[]
    caveats: string[]
  }>(
    'The read-back',
    await request<unknown>('/reports/read', {
      method: 'POST',
      body: {
        question: input.question ?? null,
        report_id: input.reportId ?? null,
        use_case_id: input.useCaseId ?? null,
      },
    }),
    REPORT_READBACK,
  )

  return {
    question: raw.question,
    graph: toReportGraph(raw.graph),
    matched: raw.matched,
    why: raw.why,
    reportTag: raw.report_tag,
    heading: raw.heading,
    spine: raw.spine,
    frame: toFrame(raw.frame),
    reading: raw.reading,
    assumptions: raw.assumptions,
    caveats: raw.caveats,
  }
}

/* The built-report shape and its mapper, shared by `POST /reports/build` and
   `GET /reports/saved/:id` — the two ways one arrives. Two copies would drift. */
const BUILT_REPORT_FIELDS = {
  ...REPORT_FIELDS,
  variant: oneOf(['written', 'generated']),
  filters: REPORT_FILTERS,
  summary_note: nullable(str),
  caveats: arrayOf(str),
}

const toBuiltReport = (
  r: RawReport & {
    variant: 'written' | 'generated'
    filters: RawReportFilter[]
    summary_note: string | null
    caveats: string[]
  },
): BuiltReport => ({
  ...toReport(r),
  variant: r.variant,
  filters: r.filters.map(toFilter),
  summaryNote: r.summary_note,
  caveats: r.caveats,
})

/** Build the report this frame describes. Every figure comes back computed. */
export async function buildReport(frame: ReportFrame): Promise<BuiltReport> {
  const raw = validate<{
    report: RawReport & {
      variant: 'written' | 'generated'
      filters: RawReportFilter[]
      summary_note: string | null
      caveats: string[]
    }
  }>(
    'The built report',
    await request<unknown>('/reports/build', { method: 'POST', body: fromFrame(frame) }),
    shape({ report: shape(BUILT_REPORT_FIELDS) }),
  )

  return toBuiltReport(raw.report)
}


/** Save a question to the library — the frame, never the figures. */
export async function saveReport(input: {
  savedId?: string | null
  name: string
  question: string | null
  frame: ReportFrame
  /** The signed-in address. The server cannot look it up — the identity is client-held. */
  savedBy?: string | null
}): Promise<SavedReport[]> {
  const raw = validate<{ saved: RawSavedReport[] }>(
    'The saved report',
    await request<unknown>('/reports/saved', {
      method: 'POST',
      body: {
        saved_id: input.savedId ?? null,
        name: input.name,
        question: input.question,
        saved_by: input.savedBy ?? null,
        ...fromFrame(input.frame),
      },
    }),
    REPORT_SAVED_PAYLOAD,
  )
  return raw.saved.map(toSaved)
}

/**
 * Set which roles a saved report is meant for.
 *
 * Its own call rather than a re-save: the frame, the name and the question are untouched, and
 * re-posting all three to change an audience invites one of them to arrive stale.
 */
export async function setSavedReportRoles(
  savedId: string,
  roleIds: string[],
): Promise<SavedReport[]> {
  const raw = validate<{ saved: RawSavedReport[] }>(
    'The report audience',
    await request<unknown>(`/reports/saved/${encodeURIComponent(savedId)}/roles`, {
      method: 'POST',
      body: { viewer_roles: roleIds },
    }),
    REPORT_SAVED_PAYLOAD,
  )
  return raw.saved.map(toSaved)
}

/** Remove a saved question. */
/*
 * ---------------- the two acts on a governed definition ----------------
 *
 * Share and Delete. Each answers with the whole governance view rather than an acknowledgement, so
 * the caller renders a validated payload instead of patching its own copy of what it just changed —
 * and each is validated on the way in for the reason every read is: `/db` makes a malformed payload
 * reachable, and a write's answer is rendered exactly like a fetched one.
 *
 * A third act, `POST /reports/access-requests`, was removed with the pending-approval state.
 *
 * **Neither is access control.** They record and report decisions; the role travels from the browser,
 * which the login authenticates by shape.
 */
const GOVERNANCE_REPLY = shape({ governance: REPORT_GOVERNANCE })

/**
 * Who may see that a report exists. An **empty** list makes it private, which is a decision the
 * server records rather than a refusal — so this takes the roles and does not require one.
 */
export async function setReportAudience(
  reportId: string,
  audience: string[],
  asRole?: string | null,
): Promise<ReportGovernance> {
  const raw = validate<{ governance: any }>(
    'The report audience',
    await request<unknown>(
      `/reports/governance/${encodeURIComponent(reportId)}/audience${asRoleQuery(asRole)}`,
      { method: 'PATCH', body: { audience } },
    ),
    GOVERNANCE_REPLY,
  )
  return toGovernance(raw.governance)
}

/**
 * Removes a report's **governance row**, which is what makes it a governed definition.
 *
 * The definition itself is the package's and stays in `db.reports`, so this is recoverable by
 * re-seeding — `restore` carries the command, and a caller that promises "gone for good" would be
 * promising something the server did not do.
 */
export async function deleteGovernedReport(
  reportId: string,
  asRole?: string | null,
): Promise<{ removed: string; restore: string; governance: ReportGovernance }> {
  const raw = validate<{ removed: string; restore: string; governance: any }>(
    'The governed report',
    await request<unknown>(
      `/reports/governance/${encodeURIComponent(reportId)}${asRoleQuery(asRole)}`,
      { method: 'DELETE' },
    ),
    shape({ removed: str, restore: str, governance: REPORT_GOVERNANCE }),
  )
  return { removed: raw.removed, restore: raw.restore, governance: toGovernance(raw.governance) }
}

/* One place that spells the role parameter, so a write cannot ask for a different reader's view. */
const asRoleQuery = (asRole?: string | null) =>
  asRole ? `?as_role=${encodeURIComponent(asRole)}` : ''

export async function deleteSavedReport(savedId: string): Promise<SavedReport[]> {
  const raw = validate<{ saved: RawSavedReport[] }>(
    'The saved report',
    await request<unknown>(`/reports/saved/${encodeURIComponent(savedId)}`, { method: 'DELETE' }),
    REPORT_SAVED_PAYLOAD,
  )
  return raw.saved.map(toSaved)
}

/**
 * Open a saved report: its frame, re-asked now.
 *
 * The row comes back beside the report because the page states what the figures do not —
 * who saved it, when, and which graph it was asked of.
 */
export async function getSavedReport(savedId: string): Promise<{
  connectedSources: number
  publishedCount: number
  builtCount: number
  draftCount: number
  saved: SavedReport | null
  report: BuiltReport | null
}> {
  const raw = validate<{
    connected_sources: number
    published_count: number
    built_count: number
    draft_count: number
    saved: RawSavedReport | null
    report:
      | (RawReport & {
          variant: 'written' | 'generated'
          filters: RawReportFilter[]
          summary_note: string | null
          caveats: string[]
        })
      | null
  }>(
    'The saved report',
    await request<unknown>(`/reports/saved/${encodeURIComponent(savedId)}`),
    shape({
      connected_sources: num,
      published_count: num,
      built_count: num,
      draft_count: num,
      saved: nullable(REPORT_SAVED_ROW),
      report: nullable(shape(BUILT_REPORT_FIELDS)),
    }),
  )

  return {
    connectedSources: raw.connected_sources,
    publishedCount: raw.published_count,
    builtCount: raw.built_count,
    draftCount: raw.draft_count,
    saved: raw.saved ? toSaved(raw.saved) : null,
    report: raw.report ? toBuiltReport(raw.report) : null,
  }
}

/* ---------------- Audit & Governance ---------------- */

/*
 * Who sees what, and what this server has recorded about it.
 *
 * **A rule is recorded, not enforced**, and the payload says so rather than leaving it to the page:
 * no roster in this app is filtered per persona, so `resolution` states what a rule *would* admit
 * against today's register — never what a reader saw. That distinction is the whole reason the
 * field is called a resolution and carries its own sample.
 */

/** A field a restriction may run on: the register's identity column, plus its filterable fields. */
export interface GovernanceBasis {
  basis: string
  label: string
  /** True on the spine's own identity column — restricting by it names rows one at a time. */
  identity: boolean
  values: { value: string; label: string; count: number }[]
}

/** What a persona's rule admits against today's register. */
export interface GovernanceResolution {
  kind: 'full' | 'mask' | 'part' | 'none'
  count: number
  total: number
  summary: string
  /** The rows it names. A list is checkable in a way "32 of 36" is not. */
  sample: string[]
}

export interface GovernancePerson {
  email: string
  name: string
  roleId: string
  roleLabel: string
  /** The tenant's authored prose for this persona's scope — beside the rule, never instead of it. */
  declared: string | null
  maskedColumns: string | null
  full: boolean
  mask: boolean
  rule: { basis: string; values: string[] } | null
  resolution: GovernanceResolution
}

/** A published report or scenario, with its audience resolved to people. */
export interface GovernanceArtifact {
  artifactId: string
  kind: 'report' | 'whatif'
  kindLabel: string
  name: string
  publishedBy: string | null
  live: boolean
  statusLabel: string
  freshness: string | null
  cases: string[] | null
  readers: string[]
  /** What this artifact's audience is actually made of — the two kinds differ. */
  audienceNote: string
  /** False on a report: the section has no unpublish, and the row must not offer one. */
  canUnpublish: boolean
}

export interface GovernanceEvent {
  eventId: string
  at: string
  category: string
  actor: string
  text: string
  detail: string
}

/**
 * The rendered Audit & Governance screen a dataset ships, or `null` where the screen is computed.
 *
 * The same arrangement as `WhatIfDocument`: a dataset can ship a finished page instead of a set of
 * figures to resolve per request, and the page frames it rather than transcribing what it says.
 */
export interface GovernanceDocument {
  documentId: string
  /** The file, relative to the dataset's `audit-governance` folder. Resolved to a URL by the page. */
  file: string
  title: string
  heading: string
  subtitle: string
  tabs: { key: string; label: string }[]
  /** Where the screen came from — the package, which screen of it, and when it was generated. */
  package: string
  screen: string
  generated: string
  /** The roster every count on the page is resolved against, stated rather than recomputed here. */
  rosterTotal: number
}

export interface GovernanceView {
  connectedSources: number
  publishedCount: number
  builtCount: number
  draftCount: number
  /**
   * The rendered screen this dataset ships, or `null`.
   *
   * Served on the **open branch only**: this page governs published artifacts, so a framed screen with
   * nothing published would describe reports and scenarios nobody released. The gate is tested before
   * this field is read, exactly as the What-if page tests it before `frame.document`.
   */
  document: GovernanceDocument | null
  rosterTotal: number
  bases: GovernanceBasis[]
  people: GovernancePerson[]
  artifacts: GovernanceArtifact[]
  log: GovernanceEvent[]
  logCategories: { key: string; label: string }[]
  copy: {
    title: string
    lead: string
    gates: { key: string; title: string; detail: string }[]
    /** The sentence the page turns on: a rule is recorded, not enforced. */
    notEnforced: string
    emptyLog: string
    logNote: string
    basisNote: string
  }
}

const GOVERNANCE_VIEW = shape({
  connected_sources: num,
  published_count: num,
  built_count: num,
  draft_count: num,
  /* `nullable` accepts an absent key as well as null, which is what a dataset with a computed screen
     sends. A *present* one is checked in full — it is what the page frames instead of the rules, so a
     missing `file` is a blank frame and a missing `title` is a frame with no accessible name. */
  document: nullable(
    shape({
      document_id: str,
      file: str,
      title: str,
      heading: str,
      subtitle: str,
      tabs: arrayOf(shape({ key: str, label: str })),
      package: str,
      screen: str,
      generated: str,
      roster_total: num,
    }),
  ),
  roster_total: num,
  bases: arrayOf(
    shape({
      basis: str,
      label: str,
      identity: bool,
      values: arrayOf(shape({ value: str, label: str, count: num })),
    }),
  ),
  people: arrayOf(
    shape({
      email: str,
      name: str,
      role_id: str,
      role_label: str,
      declared: nullable(str),
      masked_columns: nullable(str),
      full: bool,
      mask: bool,
      rule: nullable(shape({ basis: str, values: arrayOf(str) })),
      resolution: shape({
        kind: oneOf(['full', 'mask', 'part', 'none']),
        count: num,
        total: num,
        summary: str,
        sample: arrayOf(str),
      }),
    }),
  ),
  artifacts: arrayOf(
    shape({
      artifact_id: str,
      kind: oneOf(['report', 'whatif']),
      kind_label: str,
      name: str,
      published_by: nullable(str),
      live: bool,
      status_label: str,
      freshness: nullable(str),
      cases: nullable(arrayOf(str)),
      readers: arrayOf(str),
      audience_note: str,
      can_unpublish: bool,
    }),
  ),
  log: arrayOf(
    shape({ event_id: str, at: str, category: str, actor: str, text: str, detail: str }),
  ),
  log_categories: arrayOf(shape({ key: str, label: str })),
  copy: shape({
    title: str,
    lead: str,
    gates: arrayOf(shape({ key: str, title: str, detail: str })),
    not_enforced: str,
    empty_log: str,
    log_note: str,
    basis_note: str,
  }),
})

interface RawGovernanceView {
  connected_sources: number
  published_count: number
  built_count: number
  draft_count: number
  document: {
    document_id: string
    file: string
    title: string
    heading: string
    subtitle: string
    tabs: { key: string; label: string }[]
    package: string
    screen: string
    generated: string
    roster_total: number
  } | null
  roster_total: number
  bases: GovernanceBasis[]
  people: {
    email: string
    name: string
    role_id: string
    role_label: string
    declared: string | null
    masked_columns: string | null
    full: boolean
    mask: boolean
    rule: { basis: string; values: string[] } | null
    resolution: GovernanceResolution
  }[]
  artifacts: {
    artifact_id: string
    kind: 'report' | 'whatif'
    kind_label: string
    name: string
    published_by: string | null
    live: boolean
    status_label: string
    freshness: string | null
    cases: string[] | null
    readers: string[]
    audience_note: string
    can_unpublish: boolean
  }[]
  log: {
    event_id: string
    at: string
    category: string
    actor: string
    text: string
    detail: string
  }[]
  log_categories: { key: string; label: string }[]
  copy: {
    title: string
    lead: string
    gates: { key: string; title: string; detail: string }[]
    not_enforced: string
    empty_log: string
    log_note: string
    basis_note: string
  }
}

const toGovernanceView = (raw: RawGovernanceView): GovernanceView => ({
  connectedSources: raw.connected_sources,
  publishedCount: raw.published_count,
  builtCount: raw.built_count,
  draftCount: raw.draft_count,
  document: raw.document
    ? {
        documentId: raw.document.document_id,
        file: raw.document.file,
        title: raw.document.title,
        heading: raw.document.heading,
        subtitle: raw.document.subtitle,
        tabs: raw.document.tabs,
        package: raw.document.package,
        screen: raw.document.screen,
        generated: raw.document.generated,
        rosterTotal: raw.document.roster_total,
      }
    : null,
  rosterTotal: raw.roster_total,
  bases: raw.bases,
  people: raw.people.map((p) => ({
    email: p.email,
    name: p.name,
    roleId: p.role_id,
    roleLabel: p.role_label,
    declared: p.declared,
    maskedColumns: p.masked_columns,
    full: p.full,
    mask: p.mask,
    rule: p.rule,
    resolution: p.resolution,
  })),
  artifacts: raw.artifacts.map((a) => ({
    artifactId: a.artifact_id,
    kind: a.kind,
    kindLabel: a.kind_label,
    name: a.name,
    publishedBy: a.published_by,
    live: a.live,
    statusLabel: a.status_label,
    freshness: a.freshness,
    cases: a.cases,
    readers: a.readers,
    audienceNote: a.audience_note,
    canUnpublish: a.can_unpublish,
  })),
  log: raw.log.map((e) => ({
    eventId: e.event_id,
    at: e.at,
    category: e.category,
    actor: e.actor,
    text: e.text,
    detail: e.detail,
  })),
  logCategories: raw.log_categories,
  copy: {
    title: raw.copy.title,
    lead: raw.copy.lead,
    gates: raw.copy.gates,
    notEnforced: raw.copy.not_enforced,
    emptyLog: raw.copy.empty_log,
    logNote: raw.copy.log_note,
    basisNote: raw.copy.basis_note,
  },
})

/** The whole page. */
export async function getGovernance(): Promise<GovernanceView> {
  return toGovernanceView(
    validate<RawGovernanceView>(
      'Audit & Governance',
      await request<unknown>('/governance'),
      GOVERNANCE_VIEW,
    ),
  )
}

/** `as` is the signed-in address — client-held, so every route that records who has to be told. */
const asQuery = (as?: string | null) => (as ? `?as=${encodeURIComponent(as)}` : '')

/** Set a persona's access rule. Every writer answers with the whole view, so there is one path in. */
export async function setGovernanceScope(input: {
  roleId: string
  rule?: { basis: string; values: string[] } | null
  full?: boolean
  mask?: boolean
  as?: string | null
}): Promise<GovernanceView> {
  const body: Record<string, unknown> = {}
  if (input.rule !== undefined) body.rule = input.rule
  if (input.full !== undefined) body.full = input.full
  if (input.mask !== undefined) body.mask = input.mask
  return toGovernanceView(
    validate<RawGovernanceView>(
      'The access rule',
      await request<unknown>(
        `/governance/scope/${encodeURIComponent(input.roleId)}${asQuery(input.as)}`,
        { method: 'PATCH', body },
      ),
      GOVERNANCE_VIEW,
    ),
  )
}

/** Give somebody access. The server writes to whichever pool the artifact keeps. */
export async function addGovernanceReader(input: {
  artifactId: string
  email: string
  as?: string | null
}): Promise<GovernanceView> {
  return toGovernanceView(
    validate<RawGovernanceView>(
      'The reader',
      await request<unknown>(
        `/governance/artifacts/${encodeURIComponent(input.artifactId)}/readers${asQuery(input.as)}`,
        { method: 'POST', body: { email: input.email } },
      ),
      GOVERNANCE_VIEW,
    ),
  )
}

export async function removeGovernanceReader(input: {
  artifactId: string
  email: string
  as?: string | null
}): Promise<GovernanceView> {
  const path =
    `/governance/artifacts/${encodeURIComponent(input.artifactId)}` +
    `/readers/${encodeURIComponent(input.email)}${asQuery(input.as)}`
  return toGovernanceView(
    validate<RawGovernanceView>(
      'The reader',
      await request<unknown>(path, { method: 'DELETE' }),
      GOVERNANCE_VIEW,
    ),
  )
}

/** Withdraw a published scenario. Refused on a report, which has no such act. */
export async function unpublishGovernanceArtifact(input: {
  artifactId: string
  as?: string | null
}): Promise<GovernanceView> {
  return toGovernanceView(
    validate<RawGovernanceView>(
      'The withdrawal',
      await request<unknown>(
        `/governance/artifacts/${encodeURIComponent(input.artifactId)}/unpublish${asQuery(input.as)}`,
        { method: 'POST' },
      ),
      GOVERNANCE_VIEW,
    ),
  )
}
