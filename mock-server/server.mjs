#!/usr/bin/env node
/**
 * Dummy JSON API for the Connect-a-source flow.
 *
 * Zero dependencies on purpose: the project's audit gate fails on any advisory,
 * and a mock backend is not worth widening the dependency surface for.
 *
 *   node mock-server/server.mjs [port]     # defaults to 4000
 *
 * This is the ONLY data source for the UI — there is no static fallback in the
 * app, so every page is empty until this server is running.
 *
 * Sources registered through the wizard live in memory and reset when the
 * process restarts. Everything else is read from db.json at startup.
 *
 * Routes (Vite proxies /api/* here with the /api prefix stripped):
 *   GET    /db                             the document + a section summary
 *   PUT    /db                             replace it all   { db }  or the object itself
 *   PUT    /db/:section                    replace one key  { value }
 *   GET    /health
 *   GET    /projects
 *   GET    /projects/:projectId/datasets
 *   GET    /drives
 *   GET    /drives/:driveId/folders
 *   GET    /sources/oauth/start?provider=bigquery|drive
 *   GET    /sources/oauth/callback?state=...&provider=bigquery|drive
 *   POST   /sources/preview                { project_id, credential_handle }
 *   POST   /sources                        { project_id, credential_handle, datasets, source_name }
 *   POST   /sources/drive/preview          { drive_id, credential_handle }
 *   POST   /sources/drive                  { drive_id, credential_handle, folders, source_name }
 *   GET    /sources                        registered rows only
 *   POST   /sources/:id/disconnect
 *   PUT    /sources/:id/datasets           { datasets }
 *   PUT    /sources/:id/folders            { folders }
 *   DELETE /sources/:sourceId
 *   GET    /sources/:id/browse             allowlisted datasets + their tables
 *   GET    /sources/:id/browse-documents   allowlisted folders + their documents
 *   POST   /sources/:id/profile            { objects: [{dataset_id, table_id}], force }
 *   POST   /sources/:id/profile-documents  { objects: [{folder_id, document_id}], force }
 *   GET    /sources/:id/columns            profiled columns
 *   GET    /sources/:id/documents          profiled documents + extracted entities
 *   GET    /profiling-jobs
 *   GET    /change-signals
 *   GET    /graph-domains                  step 1 options, ranked by real fit
 *   GET    /graph-use-cases                saved drafts + committed use cases
 *   POST   /graph-use-cases                upsert a draft { use_case_id?, name, ... }
 *   DELETE /graph-use-cases/:useCaseId
 *   GET    /audit                          { stats, events, policies }
 *   GET    /traces                         { stats, items, waterfall }
 *   GET    /evals                          { stats, runs, checks }
 */
import { createServer } from 'node:http'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(here, 'db.json')
const db = JSON.parse(readFileSync(DB_PATH, 'utf8'))

const PORT = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 4000)

/** Registered sources, keyed by source_id. Resets on restart. */
const registered = new Map()
/** Profiling runs, newest first. */
const profilingJobs = []
/**
 * OAuth states issued by /sources/oauth/start, consumed by the callback —
 * state → the provider it was issued for. A real consent screen ties the state
 * to the granted scope, so a BigQuery state cannot be replayed against Drive.
 */
const oauthStates = new Map()

let counter = 0
const nextId = () => `${Date.now().toString(36)}${(counter++).toString(36)}`

const findProject = (id) => db.projects.find((p) => p.project_id === id)
const findCredentialByHandle = (handle) =>
  db.credentials.find((c) => c.credential_handle === handle)

const findDrive = (id) => db.drives.find((d) => d.drive_id === id)
const findDriveCredentialByHandle = (handle) =>
  db.drive_credentials.find((c) => c.credential_handle === handle)
const findFolder = (drive, folderId) =>
  (drive?.folders ?? []).find((f) => f.folder_id === folderId)
const findDocument = (drive, folderId, documentId) =>
  (findFolder(drive, folderId)?.documents ?? []).find(
    (d) => d.document_id === documentId,
  )

const send = (res, status, payload) => {
  const body = JSON.stringify(payload, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'cache-control': 'no-store',
  })
  res.end(body)
}

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1e6) reject(new Error('payload too large'))
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })

/**
 * A registered source, shaped for the Sources table.
 *
 * Every profiled_* counter deliberately starts at 0: registration is instant,
 * but counts only land once the Metadata Profiler has run over the selected
 * tables (BigQuery) or documents (Drive).
 *
 * `scope` reads in the unit of the connector — datasets for BigQuery, folders
 * for Drive — because that is what the allowlist actually narrows.
 */
function sourceRow(source) {
  const isDrive = source.kind === 'gdrive'
  return {
    source_id: source.source_id,
    source_name: source.source_name,
    connector: source.connector,
    status: source.status,
    project_account: source.project_id ?? source.drive_id ?? source.account ?? '—',
    scope: isDrive
      ? `${(source.folders ?? []).length} folder(s)`
      : source.kind === 'bigquery'
        ? `${source.datasets.length} dataset(s)`
        : '—',
    connected_at: source.registered_at,
    profiled_tables: source.profiled_tables ?? 0,
    profiled_columns: source.profiled_columns ?? 0,
    profiled_documents: isDrive ? (source.profiled_documents ?? 0) : null,
    profiled_entities: isDrive ? (source.profiled_entities ?? 0) : null,
    datasets: source.datasets ?? [],
    folders: source.folders ?? [],
    kind: source.kind,
  }
}

/** Sources that are registered AND still connected. */
const connectedSources = () =>
  [...registered.values()].filter((s) => s.status === 'connected')

/* ---------------- db.json editing ---------------- */

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The shape the rest of this server reads. Editing db.json through the UI must
 * not be able to remove a key the app then crashes on, so a candidate document
 * is checked before anything touches disk.
 */
const DB_SHAPE = {
  google_account: (v) => isObject(v) && typeof v.email === 'string',
  credentials: (v) =>
    Array.isArray(v) &&
    v.every((c) => isObject(c) && c.project_id && c.credential_handle),
  projects: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((p) => isObject(p) && p.project_id && Array.isArray(p.datasets)),
  drive_credentials: (v) =>
    Array.isArray(v) &&
    v.every((c) => isObject(c) && c.drive_id && c.credential_handle),
  drives: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((d) => isObject(d) && d.drive_id && Array.isArray(d.folders)),
  audit: (v) =>
    isObject(v) &&
    Array.isArray(v.stats) &&
    Array.isArray(v.events) &&
    Array.isArray(v.policies),
  traces: (v) => isObject(v) && Array.isArray(v.stats) && Array.isArray(v.items),
  evals: (v) =>
    isObject(v) &&
    Array.isArray(v.stats) &&
    Array.isArray(v.runs) &&
    Array.isArray(v.checks),
  change_signals: (v) => Array.isArray(v),
  column_vocabulary: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((c) => isObject(c) && c.name && c.type && c.class),
  document_vocabulary: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((c) => isObject(c) && c.name && c.type && c.class),
  graph_domains: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((d) => isObject(d) && d.domain_id && d.name),
  graph_use_cases: (v) =>
    Array.isArray(v) && v.every((u) => isObject(u) && u.use_case_id && u.name),
}

const DB_HINTS = {
  google_account: 'object with at least an "email" string',
  credentials: 'array of { project_id, credential_handle }',
  projects: 'non-empty array of { project_id, datasets: [] }',
  drive_credentials: 'array of { drive_id, credential_handle }',
  drives: 'non-empty array of { drive_id, folders: [] }',
  audit: 'object with stats[], events[], policies[]',
  traces: 'object with stats[], items[]',
  evals: 'object with stats[], runs[], checks[]',
  change_signals: 'array',
  column_vocabulary: 'non-empty array of { name, type, class }',
  document_vocabulary: 'non-empty array of { name, type, class }',
  graph_domains: 'non-empty array of { domain_id, name }',
  graph_use_cases: 'array of { use_case_id, name }',
}

function validateDb(candidate) {
  const problems = []
  if (!isObject(candidate)) return ['the document must be a JSON object']
  for (const [key, check] of Object.entries(DB_SHAPE)) {
    if (!(key in candidate)) problems.push(`"${key}" is missing — ${DB_HINTS[key]}`)
    else if (!check(candidate[key]))
      problems.push(`"${key}" is the wrong shape — expected ${DB_HINTS[key]}`)
  }
  return problems
}

/** Describes each top-level key for the editor's section list. */
const dbSections = () =>
  Object.entries(db).map(([key, value]) => ({
    key,
    kind: Array.isArray(value) ? 'array' : isObject(value) ? 'object' : typeof value,
    count: Array.isArray(value)
      ? value.length
      : isObject(value)
        ? Object.keys(value).length
        : 1,
    required: key in DB_SHAPE,
  }))

/**
 * Writes via a temp file + rename so a failed write cannot leave a truncated
 * db.json, then hot-swaps the in-memory document in place — every route closes
 * over `db`, so mutating it is what makes the edit take effect without a
 * restart.
 */
function commitDb(next) {
  const text = `${JSON.stringify(next, null, 2)}\n`
  const tmp = `${DB_PATH}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, DB_PATH)

  for (const key of Object.keys(db)) delete db[key]
  Object.assign(db, next)
}

/** FNV-1a — stable across requests so profiled stats never shift under the UI. */
function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/**
 * The column dictionary the profiler produces for one table.
 *
 * db.json stores a column *count* per table rather than 58 hand-written
 * schemas, so the dictionary is synthesised from `column_vocabulary`: the slice
 * is chosen by hashing the table name, and every statistic is derived from a
 * hash of table+column. Deterministic, so repeat requests agree.
 */
function tableDictionary(source, datasetId, tableId, columnCount, tableRows) {
  const vocab = db.column_vocabulary
  const offset = hash(tableId) % vocab.length
  const notes = source.column_notes ?? {}

  return Array.from({ length: columnCount }, (_, i) => {
    const v = vocab[(offset + i) % vocab.length]
    const cycle = Math.floor((offset + i) / vocab.length)
    const columnId = cycle > 0 ? `${v.name}_${cycle + 1}` : v.name
    const seed = hash(`${tableId}:${columnId}`)

    const nullPct =
      v.class === 'identifier' ? 0 : Number(((seed % 430) / 100).toFixed(1))

    let distinct
    if (v.class === 'identifier') distinct = tableRows
    else if (v.class === 'date') distinct = Math.max(1, Math.round(tableRows / 90))
    else if (v.class === 'measure') distinct = Math.max(1, Math.round(tableRows / 7))
    else if (v.class === 'text') distinct = Math.max(1, Math.round(tableRows * 0.86))
    else if (v.class === 'entity') distinct = Math.max(1, (seed % 2600) + 40)
    else distinct = Math.max(1, (seed % 1180) + 18)

    const key = `${datasetId}.${tableId}.${columnId}`
    const description = notes[key] ?? null

    return {
      column_id: columnId,
      type: v.type,
      class: v.class,
      confidence: v.confidence,
      pii: Boolean(v.pii),
      null_pct: nullPct,
      distinct: Math.min(distinct, Math.max(tableRows, 1)),
      description,
      description_status: description ? 'described' : 'needs review',
    }
  })
}

/**
 * What the document profiler extracts from one Drive file.
 *
 * The unstructured mirror of `tableDictionary`: db.json stores an entity
 * *count* per document rather than a hand-written extraction, so the entity
 * list is synthesised from `document_vocabulary` — the slice is chosen by
 * hashing the document id, and occurrences/coverage derive from a hash of
 * document+entity. Deterministic, so repeat requests agree.
 *
 * Note what is NOT synthesised: the summary. A description belongs to the
 * whole document here rather than to each entity, because that is the unit a
 * curator actually reviews for an unstructured file.
 */
function documentDictionary(source, folderId, doc) {
  const vocab = db.document_vocabulary
  const offset = hash(doc.document_id) % vocab.length
  const notes = source.document_notes ?? {}
  const chunks = Math.max(1, Math.round(doc.pages * 2.5))

  const entities = Array.from({ length: doc.entities }, (_, i) => {
    const v = vocab[(offset + i) % vocab.length]
    const cycle = Math.floor((offset + i) / vocab.length)
    const entityId = cycle > 0 ? `${v.name}_${cycle + 1}` : v.name
    const seed = hash(`${doc.document_id}:${entityId}`)

    // An identifier appears once per document; prose entities recur.
    const occurrences =
      v.class === 'identifier'
        ? 1 + (seed % 2)
        : v.class === 'text'
          ? Math.max(1, (seed % chunks) + 1)
          : Math.max(1, (seed % 9) + 1)

    return {
      entity_id: entityId,
      type: v.type,
      class: v.class,
      confidence: v.confidence,
      pii: Boolean(v.pii),
      occurrences,
      coverage_pct: Number(
        Math.min(100, ((occurrences / chunks) * 100)).toFixed(1),
      ),
    }
  })

  const key = `${folderId}.${doc.document_id}`
  const summary = notes[key] ?? null

  return {
    document_id: doc.document_id,
    name: doc.name,
    mime_type: doc.mime_type,
    doc_type: doc.doc_type,
    pages: doc.pages,
    size_mb: doc.size_mb,
    modified: doc.modified,
    chunks,
    entity_count: entities.length,
    pii_count: entities.filter((e) => e.pii).length,
    summary,
    summary_status: summary ? 'described' : 'needs review',
    entities,
  }
}

/*
 * The Metadata Profiler pipelines. A job is queued, then walks the stages of
 * its connector one at a time, committing profiled objects as it goes — so the
 * UI can show a run in flight rather than a result appearing from nowhere.
 *
 * Both are five stages, so a job row reads the same either way; the stage names
 * differ because extracting text from a PDF is not sampling a column.
 */
const PIPELINE = [
  'Schema fetch',
  'Statistics sampling',
  'Class inference',
  'PII detection',
  'Candidate keys',
]

const DOC_PIPELINE = [
  'Text extraction',
  'Chunking',
  'Entity extraction',
  'Document PII detection',
  'Topic classification',
]

const pipelineFor = (job) => (job.kind === 'gdrive' ? DOC_PIPELINE : PIPELINE)

// Paced so a run is comfortably observable at the UI's 3s poll interval.
const QUEUE_MS = 1200
const STAGE_MS = 2200

const elapsedSeconds = (job) => {
  if (!job.started_at) return 0
  const end = job.finished_at ? Date.parse(job.finished_at) : Date.now()
  return Math.max(0, Math.round((end - Date.parse(job.started_at)) / 1000))
}

/**
 * Public shape of a job — elapsed is computed live for running jobs.
 *
 * A job's work list is `objects`, not `tables`: a BigQuery job profiles tables
 * and a Drive job profiles documents, and one board shows both. `unit` is what
 * the UI labels a row with, so it never has to map a connector to a noun.
 */
const jobView = (job) => {
  const stages = pipelineFor(job)
  return {
    job_id: job.job_id,
    short_id: job.short_id,
    source_id: job.source_id,
    kind: job.kind,
    unit: job.unit,
    status: job.status,
    stage_index: job.stage_index,
    stage_total: stages.length,
    stage_label: job.stage_label,
    pipeline: `${job.stage_index}/${stages.length}: ${job.stage_label}`,
    progress: job.progress,
    objects: job.objects,
    object_count: job.objects.length,
    objects_done: job.objects.filter((o) => o.state !== 'pending').length,
    force: job.force,
    triggered_at: job.triggered_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    elapsed_seconds: elapsedSeconds(job),
    triggered_by: job.triggered_by,
    error: job.error,
  }
}

/** Recompute a source's profiled counters from what it has committed. */
function recount(source) {
  if (source.kind === 'gdrive') {
    const docs = source.profiled_docs ?? []
    source.profiled_documents = docs.length
    source.profiled_entities = docs.reduce((s, p) => s + p.entities, 0)
    return
  }
  source.profiled_tables = source.profiled.length
  source.profiled_columns = source.profiled.reduce((s, p) => s + p.columns, 0)
}

/** Commit one pending object of this job as profiled on its source. */
function commitNextObject(job) {
  const source = registered.get(job.source_id)
  if (!source) return
  const next = job.objects.find((o) => o.state === 'pending')
  if (!next) return

  if (job.kind === 'gdrive') {
    source.profiled_docs = source.profiled_docs ?? []
    const already = source.profiled_docs.some(
      (p) => p.folder_id === next.parent_id && p.document_id === next.object_id,
    )
    if (!already) {
      source.profiled_docs.push({
        folder_id: next.parent_id,
        document_id: next.object_id,
        entities: next.units,
        profiled_at: new Date().toISOString(),
      })
    }
  } else {
    source.profiled = source.profiled ?? []
    const already = source.profiled.some(
      (p) => p.dataset_id === next.parent_id && p.table_id === next.object_id,
    )
    if (!already) {
      source.profiled.push({
        dataset_id: next.parent_id,
        table_id: next.object_id,
        columns: next.units,
        profiled_at: new Date().toISOString(),
      })
    }
  }
  next.state = 'profiled'
  recount(source)
}

/** Drive a queued job through its connector's pipeline on timers. */
function runJob(job) {
  const stages = pipelineFor(job)
  job.status = 'running'
  job.started_at = new Date().toISOString()

  const step = () => {
    if (job.status === 'cancelled') return
    job.stage_index += 1
    job.stage_label = stages[job.stage_index - 1]
    job.progress = Math.round((job.stage_index / stages.length) * 100)

    // Spread commits across the run so counters climb as it progresses.
    const target = Math.floor((job.objects.length * job.stage_index) / stages.length)
    while (job.objects.filter((o) => o.state === 'profiled').length < target) {
      commitNextObject(job)
    }

    if (job.stage_index >= stages.length) {
      while (job.objects.some((o) => o.state === 'pending')) commitNextObject(job)
      job.status = 'complete'
      job.progress = 100
      job.finished_at = new Date().toISOString()
      return
    }
    setTimeout(step, STAGE_MS).unref?.()
  }

  setTimeout(step, STAGE_MS).unref?.()
}

/**
 * Queue a run and return its view. Shared by both connectors so a Drive job and
 * a BigQuery job cannot drift in status handling — only `objects` differ.
 */
function queueJob({ sourceId, kind, unit, objects, force }) {
  const jobId = crypto.randomUUID()
  const job = {
    job_id: jobId,
    short_id: jobId.slice(0, 8),
    source_id: sourceId,
    kind,
    unit,
    status: 'queued',
    stage_index: 0,
    stage_label: 'queued',
    progress: 0,
    objects,
    force: Boolean(force),
    triggered_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    triggered_by: `${db.google_account.email} (Tenant Admin)`,
    error: null,
  }
  profilingJobs.unshift(job)

  if (objects.every((o) => o.state === 'skipped')) {
    // Nothing to do — finish immediately rather than faking a pipeline run.
    job.status = 'complete'
    job.stage_index = pipelineFor(job).length
    job.stage_label = 'nothing to profile'
    job.progress = 100
    job.started_at = job.triggered_at
    job.finished_at = job.triggered_at
  } else {
    setTimeout(() => runJob(job), QUEUE_MS).unref?.()
  }

  return job
}

/*
 * The New Graph wizard. The labels live here rather than in the page so the
 * stepper the user clicks and the `step` this server accepts are the same list.
 */
const WIZARD_STEPS = [
  'Domain',
  'Personas',
  'KPIs',
  'Sources',
  'Hero questions',
  'Answer requirements',
  'Entities & relationships',
]

/** Strongest fit first — this is the ranking step 1 promises. */
const FIT_ORDER = { strong: 0, partial: 1, none: 2 }

const slugify = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** A saved use case, with the defaults a hand-edited db.json might omit. */
const savedUseCase = (u) => ({
  use_case_id: u.use_case_id,
  name: u.name,
  status: u.status === 'committed' ? 'committed' : 'draft',
  domain_id: u.domain_id ?? null,
  business_need: u.business_need ?? '',
  step: u.step ?? 1,
  step_total: WIZARD_STEPS.length,
  updated_at: u.updated_at ?? null,
})

/** Datasets a source may profile, with the tables inside each. */
function browsableObjects(source) {
  const project = findProject(source.project_id)
  const datasets = (source.datasets ?? []).map((datasetId) => {
    const dataset = project?.datasets.find((d) => d.dataset_id === datasetId)
    const tables = (dataset?.tables ?? []).map((t) => ({
      table_id: t.table_id,
      type: t.type,
      columns: t.columns,
      rows: t.rows,
      profiled: (source.profiled ?? []).some(
        (p) => p.dataset_id === datasetId && p.table_id === t.table_id,
      ),
    }))
    return { dataset_id: datasetId, table_count: tables.length, tables }
  })
  return {
    datasets,
    dataset_count: datasets.length,
    object_count: datasets.reduce((sum, d) => sum + d.table_count, 0),
  }
}

/** Folders a Drive source may profile, with the documents inside each. */
function browsableDocuments(source) {
  const drive = findDrive(source.drive_id)
  const profiled = source.profiled_docs ?? []
  const folders = (source.folders ?? []).map((folderId) => {
    const folder = findFolder(drive, folderId)
    const documents = (folder?.documents ?? []).map((d) => ({
      document_id: d.document_id,
      name: d.name,
      mime_type: d.mime_type,
      doc_type: d.doc_type,
      pages: d.pages,
      size_mb: d.size_mb,
      entities: d.entities,
      modified: d.modified,
      profiled: profiled.some(
        (p) => p.folder_id === folderId && p.document_id === d.document_id,
      ),
    }))
    return {
      folder_id: folderId,
      name: folder?.name ?? folderId,
      path: folder?.path ?? '',
      document_count: documents.length,
      documents,
    }
  })
  return {
    folders,
    folder_count: folders.length,
    object_count: folders.reduce((sum, f) => sum + f.document_count, 0),
  }
}


const routes = [
  /* ---------------- db.json editor ---------------- */

  {
    method: 'GET',
    match: (p) => p === '/db',
    handle: (_req, res) =>
      send(res, 200, {
        path: DB_PATH,
        bytes: Buffer.byteLength(JSON.stringify(db, null, 2), 'utf8'),
        sections: dbSections(),
        required: Object.keys(DB_SHAPE),
        db,
      }),
  },

  // Replaces the whole document.
  {
    method: 'PUT',
    match: (p) => p === '/db',
    handle: async (req, res) => {
      const body = await readJson(req)
      const next = isObject(body) && 'db' in body ? body.db : body
      const problems = validateDb(next)
      if (problems.length > 0) return send(res, 400, { error: problems.join('; '), problems })
      commitDb(next)
      send(res, 200, { saved: true, sections: dbSections() })
    },
  },

  // Replaces one top-level key, leaving the rest of the file untouched.
  {
    method: 'PUT',
    match: (p) => /^\/db\/[^/]+$/.test(p),
    handle: async (req, res, { pathname }) => {
      const section = decodeURIComponent(pathname.slice('/db/'.length))
      const body = await readJson(req)
      if (!isObject(body) || !('value' in body)) {
        return send(res, 400, { error: 'body must be { "value": ... }' })
      }
      const next = { ...db, [section]: body.value }
      const problems = validateDb(next)
      if (problems.length > 0) return send(res, 400, { error: problems.join('; '), problems })
      commitDb(next)
      send(res, 200, { saved: true, section, sections: dbSections() })
    },
  },

  {
    method: 'GET',
    match: (p) => p === '/health',
    handle: (_req, res) =>
      send(res, 200, {
        ok: true,
        projects: db.projects.length,
        registered_sources: registered.size,
      }),
  },

  {
    method: 'GET',
    match: (p) => p === '/projects',
    handle: (_req, res) =>
      send(res, 200, {
        projects: db.projects.map((p) => ({
          project_id: p.project_id,
          display_name: p.display_name,
          location: p.location,
          dataset_count: p.datasets.length,
        })),
      }),
  },

  {
    method: 'GET',
    match: (p) => /^\/projects\/[^/]+\/datasets$/.test(p),
    handle: (_req, res, { pathname }) => {
      const projectId = pathname.split('/')[2]
      const project = findProject(projectId)
      if (!project) return send(res, 404, { error: `unknown project ${projectId}` })
      send(res, 200, {
        project_id: project.project_id,
        datasets: project.datasets,
      })
    },
  },

  {
    method: 'GET',
    match: (p) => p === '/drives',
    handle: (_req, res) =>
      send(res, 200, {
        drives: db.drives.map((d) => ({
          drive_id: d.drive_id,
          display_name: d.display_name,
          kind: d.kind,
          folder_count: d.folders.length,
        })),
      }),
  },

  {
    method: 'GET',
    match: (p) => /^\/drives\/[^/]+\/folders$/.test(p),
    handle: (_req, res, { pathname }) => {
      const driveId = decodeURIComponent(pathname.split('/')[2])
      const drive = findDrive(driveId)
      if (!drive) return send(res, 404, { error: `unknown drive ${driveId}` })
      send(res, 200, {
        drive_id: drive.drive_id,
        folders: drive.folders.map((f) => ({
          folder_id: f.folder_id,
          name: f.name,
          path: f.path,
          document_count: f.documents.length,
        })),
      })
    },
  },

  // Step 2: kick off the Google consent flow. A real deployment would return
  // Google's authorize URL; here the callback is immediately resolvable.
  //
  // The scope depends on the connector, so the state is remembered with the
  // provider it was issued for — a BigQuery consent cannot be replayed to list
  // someone's Drive.
  {
    method: 'GET',
    match: (p) => p === '/sources/oauth/start',
    handle: (_req, res, { query }) => {
      const provider = query.get('provider') === 'drive' ? 'drive' : 'bigquery'
      const scopes =
        provider === 'drive'
          ? [
              'https://www.googleapis.com/auth/drive.metadata.readonly',
              'https://www.googleapis.com/auth/drive.readonly',
            ]
          : ['https://www.googleapis.com/auth/bigquery.readonly']

      const state = `state-${nextId()}`
      oauthStates.set(state, provider)
      send(res, 200, {
        state,
        provider,
        auth_url: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&scope=${scopes.join(' ')}`,
        scopes,
      })
    },
  },

  {
    method: 'GET',
    match: (p) => p === '/sources/oauth/callback',
    handle: (_req, res, { query }) => {
      const state = query.get('state')
      if (!state || !oauthStates.has(state)) {
        return send(res, 400, { error: 'invalid or expired state' })
      }
      const issuedFor = oauthStates.get(state)
      const provider = query.get('provider') === 'drive' ? 'drive' : 'bigquery'
      if (issuedFor !== provider) {
        return send(res, 400, {
          error: `this consent was granted for ${issuedFor}, not ${provider} — start the ${provider} sign-in again`,
        })
      }
      oauthStates.delete(state)

      if (provider === 'drive') {
        // One handle per drive the consenting account can read.
        return send(res, 200, {
          account: db.google_account,
          drives: db.drives.map((d) => {
            const cred = db.drive_credentials.find((c) => c.drive_id === d.drive_id)
            return {
              drive_id: d.drive_id,
              display_name: d.display_name,
              kind: d.kind,
              folder_count: d.folders.length,
              document_count: d.folders.reduce((s, f) => s + f.documents.length, 0),
              credential_handle: cred?.credential_handle ?? null,
            }
          }),
        })
      }

      send(res, 200, {
        account: db.google_account,
        // One handle per project the consenting account can read.
        projects: db.projects.map((p) => {
          const cred = db.credentials.find((c) => c.project_id === p.project_id)
          return {
            project_id: p.project_id,
            display_name: p.display_name,
            location: p.location,
            dataset_count: p.datasets.length,
            credential_handle: cred?.credential_handle ?? null,
          }
        }),
      })
    },
  },

  // Discovery only — registers nothing.
  {
    method: 'POST',
    match: (p) => p === '/sources/preview',
    handle: async (req, res) => {
      const { project_id, credential_handle } = await readJson(req)
      if (!project_id || !credential_handle) {
        return send(res, 400, {
          error: 'project_id and credential_handle are both required',
        })
      }
      const cred = findCredentialByHandle(credential_handle)
      if (!cred) return send(res, 401, { error: 'unknown credential_handle' })
      if (cred.project_id !== project_id) {
        return send(res, 403, {
          error: `credential_handle is not authorised for ${project_id}`,
        })
      }
      const project = findProject(project_id)
      if (!project) return send(res, 404, { error: `unknown project ${project_id}` })

      send(res, 200, {
        project_id,
        dataset_count: project.datasets.length,
        datasets: project.datasets.map((d) => ({
          dataset_id: d.dataset_id,
          location: d.location,
          description: d.description,
          table_count: d.tables.length,
          column_count: d.tables.reduce((s, t) => s + (t.columns ?? 0), 0),
        })),
        registered: false,
      })
    },
  },

  // Drive discovery — the same contract as /sources/preview, in folders.
  {
    method: 'POST',
    match: (p) => p === '/sources/drive/preview',
    handle: async (req, res) => {
      const { drive_id, credential_handle } = await readJson(req)
      if (!drive_id || !credential_handle) {
        return send(res, 400, {
          error: 'drive_id and credential_handle are both required',
        })
      }
      const cred = findDriveCredentialByHandle(credential_handle)
      if (!cred) return send(res, 401, { error: 'unknown credential_handle' })
      if (cred.drive_id !== drive_id) {
        return send(res, 403, {
          error: `credential_handle is not authorised for ${drive_id}`,
        })
      }
      const drive = findDrive(drive_id)
      if (!drive) return send(res, 404, { error: `unknown drive ${drive_id}` })

      send(res, 200, {
        drive_id,
        display_name: drive.display_name,
        kind: drive.kind,
        folder_count: drive.folders.length,
        document_count: drive.folders.reduce((s, f) => s + f.documents.length, 0),
        folders: drive.folders.map((f) => ({
          folder_id: f.folder_id,
          name: f.name,
          path: f.path,
          description: f.description,
          document_count: f.documents.length,
          // What the document profiler would have to read, not just count.
          page_count: f.documents.reduce((s, d) => s + d.pages, 0),
          file_types: [...new Set(f.documents.map((d) => d.mime_type))],
        })),
        registered: false,
      })
    },
  },

  {
    method: 'POST',
    match: (p) => p === '/sources/drive',
    handle: async (req, res) => {
      const { drive_id, credential_handle, folders, source_name } = await readJson(req)

      if (!drive_id || !credential_handle) {
        return send(res, 400, {
          error: 'drive_id and credential_handle are both required',
        })
      }
      if (!Array.isArray(folders) || folders.length === 0) {
        return send(res, 400, {
          error: 'folders must be a non-empty array for Finish',
        })
      }
      const cred = findDriveCredentialByHandle(credential_handle)
      if (!cred) return send(res, 401, { error: 'unknown credential_handle' })

      const drive = findDrive(drive_id)
      if (!drive) return send(res, 404, { error: `unknown drive ${drive_id}` })

      const known = new Set(drive.folders.map((f) => f.folder_id))
      const unknown = folders.filter((f) => !known.has(f))
      if (unknown.length > 0) {
        return send(res, 400, {
          error: `folder(s) not present in ${drive_id}: ${unknown.join(', ')}`,
        })
      }

      const sourceId = `gdrive:${drive_id}`
      const alreadyRegistered = registered.has(sourceId)

      const record = {
        kind: 'gdrive',
        source_id: sourceId,
        source_name: source_name || drive.display_name || drive_id,
        connector: 'gdrive',
        drive_id,
        credential_handle,
        folders,
        status: 'connected',
        registered_at: new Date().toISOString(),
        newly_connected: !alreadyRegistered,
      }
      registered.set(sourceId, record)

      const documentCount = folders.reduce((sum, id) => {
        const f = findFolder(drive, id)
        return sum + (f?.documents.length ?? 0)
      }, 0)

      send(res, alreadyRegistered ? 200 : 201, {
        ...record,
        drive: drive_id,
        display_name: drive.display_name,
        folder_count: folders.length,
        document_count: documentCount,
      })
    },
  },

  {
    method: 'POST',
    match: (p) => p === '/sources',
    handle: async (req, res) => {
      const body = await readJson(req)
      const { project_id, credential_handle, datasets, source_name } = body

      if (!project_id || !credential_handle) {
        return send(res, 400, {
          error: 'project_id and credential_handle are both required',
        })
      }
      if (!Array.isArray(datasets) || datasets.length === 0) {
        return send(res, 400, {
          error: 'datasets must be a non-empty array for Finish',
        })
      }
      const cred = findCredentialByHandle(credential_handle)
      if (!cred) return send(res, 401, { error: 'unknown credential_handle' })

      const project = findProject(project_id)
      if (!project) return send(res, 404, { error: `unknown project ${project_id}` })

      const known = new Set(project.datasets.map((d) => d.dataset_id))
      const unknown = datasets.filter((d) => !known.has(d))
      if (unknown.length > 0) {
        return send(res, 400, {
          error: `dataset(s) not present in ${project_id}: ${unknown.join(', ')}`,
        })
      }

      const sourceId = `bigquery:${project_id}`
      const alreadyRegistered = registered.has(sourceId)

      const record = {
        kind: 'bigquery',
        source_id: sourceId,
        source_name: source_name || project.display_name || project_id,
        connector: 'bigquery',
        project_id,
        credential_handle,
        datasets,
        status: 'connected',
        registered_at: new Date().toISOString(),
        newly_connected: !alreadyRegistered,
      }
      registered.set(sourceId, record)

      const tableCount = datasets.reduce((sum, id) => {
        const d = project.datasets.find((x) => x.dataset_id === id)
        return sum + (d?.tables.length ?? 0)
      }, 0)

      send(res, alreadyRegistered ? 200 : 201, {
        ...record,
        project: project_id,
        dataset_count: datasets.length,
        table_count: tableCount,
      })
    },
  },

  // Only genuinely registered sources — there is no sample data here.
  {
    method: 'GET',
    match: (p) => p === '/sources',
    handle: (_req, res) => {
      const rows = [...registered.values()].map(sourceRow)
      send(res, 200, {
        sources: rows,
        registered_count: rows.length,
        connected_sources: connectedSources().length,
        profiled_tables: rows.reduce((s, r) => s + r.profiled_tables, 0),
        profiled_columns: rows.reduce((s, r) => s + r.profiled_columns, 0),
        profiled_documents: rows.reduce((s, r) => s + (r.profiled_documents ?? 0), 0),
        profiled_entities: rows.reduce((s, r) => s + (r.profiled_entities ?? 0), 0),
      })
    },
  },

  // What "Browse table for profiling" lists: allowlisted datasets and tables.
  {
    method: 'GET',
    match: (p) => /^\/sources\/.+\/browse$/.test(p),
    handle: (_req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/browse'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })
      // A Drive source has no datasets, so this would answer with an empty tree
      // that reads as "nothing to profile" rather than "wrong endpoint".
      if (source.kind === 'gdrive') {
        return send(res, 400, {
          error: `${sourceId} holds documents, not tables — use GET /sources/${sourceId}/browse-documents`,
        })
      }
      send(res, 200, { source_id: sourceId, ...browsableObjects(source) })
    },
  },

  // Runs the Metadata Profiler over the chosen tables. This is what moves
  // "tables profiled" and "columns profiled" off 0.
  {
    method: 'POST',
    match: (p) => /^\/sources\/.+\/profile$/.test(p),
    handle: async (req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/profile'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })
      if (source.kind === 'gdrive') {
        return send(res, 400, {
          error: `${sourceId} holds documents, not tables — use POST /sources/${sourceId}/profile-documents`,
        })
      }

      const { objects, force } = await readJson(req)
      if (!Array.isArray(objects) || objects.length === 0) {
        return send(res, 400, { error: 'objects must be a non-empty array' })
      }

      const project = findProject(source.project_id)
      const allowed = new Set(source.datasets ?? [])
      source.profiled = source.profiled ?? []

      const work = []
      for (const { dataset_id, table_id } of objects) {
        if (!allowed.has(dataset_id)) {
          return send(res, 400, {
            error: `dataset ${dataset_id} is not in this source's allowlist`,
          })
        }
        const table = project?.datasets
          .find((d) => d.dataset_id === dataset_id)
          ?.tables.find((t) => t.table_id === table_id)
        if (!table) {
          return send(res, 400, {
            error: `table ${dataset_id}.${table_id} does not exist`,
          })
        }

        const already = source.profiled.some(
          (p) => p.dataset_id === dataset_id && p.table_id === table_id,
        )
        work.push({
          parent_id: dataset_id,
          object_id: table_id,
          label: table_id,
          units: table.columns,
          // Already-profiled tables are skipped unless the caller forces a redo.
          state: already && !force ? 'skipped' : 'pending',
        })
      }

      const job = queueJob({
        sourceId,
        kind: 'bigquery',
        unit: 'table',
        objects: work,
        force,
      })
      send(res, 202, { job: jobView(job) })
    },
  },

  // What "Browse documents for profiling" lists: allowlisted folders and files.
  {
    method: 'GET',
    match: (p) => /^\/sources\/.+\/browse-documents$/.test(p),
    handle: (_req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/browse-documents'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })
      if (source.kind !== 'gdrive') {
        return send(res, 400, {
          error: `${sourceId} is not a Drive source — use GET /sources/${sourceId}/browse`,
        })
      }
      send(res, 200, { source_id: sourceId, ...browsableDocuments(source) })
    },
  },

  // The document profiler. Same job board, same five-stage shape, different
  // work: extract text and entities from files rather than sample columns.
  {
    method: 'POST',
    match: (p) => /^\/sources\/.+\/profile-documents$/.test(p),
    handle: async (req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/profile-documents'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })
      if (source.kind !== 'gdrive') {
        return send(res, 400, {
          error: `${sourceId} is not a Drive source — use POST /sources/${sourceId}/profile`,
        })
      }

      const { objects, force } = await readJson(req)
      if (!Array.isArray(objects) || objects.length === 0) {
        return send(res, 400, { error: 'objects must be a non-empty array' })
      }

      const drive = findDrive(source.drive_id)
      const allowed = new Set(source.folders ?? [])
      source.profiled_docs = source.profiled_docs ?? []

      const work = []
      for (const { folder_id, document_id } of objects) {
        if (!allowed.has(folder_id)) {
          return send(res, 400, {
            error: `folder ${folder_id} is not in this source's allowlist`,
          })
        }
        const document = findDocument(drive, folder_id, document_id)
        if (!document) {
          return send(res, 400, {
            error: `document ${folder_id}/${document_id} does not exist`,
          })
        }

        const already = source.profiled_docs.some(
          (p) => p.folder_id === folder_id && p.document_id === document_id,
        )
        work.push({
          parent_id: folder_id,
          object_id: document_id,
          label: document.name,
          units: document.entities,
          state: already && !force ? 'skipped' : 'pending',
        })
      }

      const job = queueJob({
        sourceId,
        kind: 'gdrive',
        unit: 'document',
        objects: work,
        force,
      })
      send(res, 202, { job: jobView(job) })
    },
  },

  // Backs "View profiled columns" — grouped dataset → table → columns, with
  // the facet counts the filter chips display.
  {
    method: 'GET',
    match: (p) => /^\/sources\/.+\/columns$/.test(p),
    handle: (_req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/columns'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })
      if (source.kind === 'gdrive') {
        return send(res, 400, {
          error: `${sourceId} has documents, not columns — use GET /sources/${sourceId}/documents`,
        })
      }

      const project = findProject(source.project_id)
      const byDataset = new Map()
      const facets = {
        all: 0,
        needs_review: 0,
        pii: 0,
        ids: 0,
        measures: 0,
        dates: 0,
        text: 0,
      }

      for (const entry of source.profiled ?? []) {
        const meta = project?.datasets
          .find((d) => d.dataset_id === entry.dataset_id)
          ?.tables.find((t) => t.table_id === entry.table_id)
        const rows = meta?.rows ?? 0

        const columns = tableDictionary(
          source,
          entry.dataset_id,
          entry.table_id,
          entry.columns,
          rows,
        )

        for (const c of columns) {
          facets.all += 1
          if (c.description_status === 'needs review') facets.needs_review += 1
          if (c.pii) facets.pii += 1
          if (c.class === 'identifier') facets.ids += 1
          if (c.class === 'measure') facets.measures += 1
          if (c.class === 'date') facets.dates += 1
          if (c.class === 'text') facets.text += 1
        }

        if (!byDataset.has(entry.dataset_id)) {
          byDataset.set(entry.dataset_id, { dataset_id: entry.dataset_id, tables: [] })
        }
        byDataset.get(entry.dataset_id).tables.push({
          table_id: entry.table_id,
          type: meta?.type ?? 'TABLE',
          rows,
          column_count: columns.length,
          columns,
        })
      }

      const datasets = [...byDataset.values()].map((d) => ({
        ...d,
        table_count: d.tables.length,
        column_count: d.tables.reduce((s, t) => s + t.column_count, 0),
      }))

      send(res, 200, {
        source_id: sourceId,
        profiled_tables: (source.profiled ?? []).length,
        dataset_count: datasets.length,
        facets,
        datasets,
      })
    },
  },

  // The pencil beside a description writes here.
  {
    method: 'PATCH',
    match: (p) => /^\/sources\/.+\/columns$/.test(p),
    handle: async (req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/columns'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })

      const { dataset_id, table_id, column_id, description } = await readJson(req)
      if (!dataset_id || !table_id || !column_id) {
        return send(res, 400, {
          error: 'dataset_id, table_id and column_id are all required',
        })
      }
      source.column_notes = source.column_notes ?? {}
      const key = `${dataset_id}.${table_id}.${column_id}`
      if (description) source.column_notes[key] = description
      else delete source.column_notes[key]

      send(res, 200, { key, description: description ?? null })
    },
  },

  // Backs "View profiled documents" — grouped folder → document → entities,
  // with the facet counts the filter chips display. Unlike the column
  // dictionary the facets count *documents*: a file is the unit a curator
  // reviews, so "needs review" means a document with no summary.
  {
    method: 'GET',
    match: (p) => /^\/sources\/.+\/documents$/.test(p),
    handle: (_req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/documents'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })
      if (source.kind !== 'gdrive') {
        return send(res, 400, {
          error: `${sourceId} is not a Drive source — use GET /sources/${sourceId}/columns`,
        })
      }

      const drive = findDrive(source.drive_id)
      const byFolder = new Map()
      const facets = {
        all: 0,
        needs_review: 0,
        pii: 0,
        manifests: 0,
        contracts: 0,
        reports: 0,
        notes: 0,
      }
      const FACET_FOR_TYPE = {
        manifest: 'manifests',
        contract: 'contracts',
        report: 'reports',
        notes: 'notes',
      }

      for (const entry of source.profiled_docs ?? []) {
        const meta = findDocument(drive, entry.folder_id, entry.document_id)
        if (!meta) continue
        const document = documentDictionary(source, entry.folder_id, meta)

        facets.all += 1
        if (document.summary_status === 'needs review') facets.needs_review += 1
        if (document.pii_count > 0) facets.pii += 1
        const bucket = FACET_FOR_TYPE[document.doc_type]
        if (bucket) facets[bucket] += 1

        if (!byFolder.has(entry.folder_id)) {
          const folder = findFolder(drive, entry.folder_id)
          byFolder.set(entry.folder_id, {
            folder_id: entry.folder_id,
            name: folder?.name ?? entry.folder_id,
            path: folder?.path ?? '',
            documents: [],
          })
        }
        byFolder.get(entry.folder_id).documents.push(document)
      }

      const folders = [...byFolder.values()].map((f) => ({
        ...f,
        document_count: f.documents.length,
        entity_count: f.documents.reduce((s, d) => s + d.entity_count, 0),
      }))

      send(res, 200, {
        source_id: sourceId,
        profiled_documents: (source.profiled_docs ?? []).length,
        folder_count: folders.length,
        entity_count: folders.reduce((s, f) => s + f.entity_count, 0),
        facets,
        folders,
      })
    },
  },

  // The pencil beside a document summary writes here.
  {
    method: 'PATCH',
    match: (p) => /^\/sources\/.+\/documents$/.test(p),
    handle: async (req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/documents'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })

      const { folder_id, document_id, summary } = await readJson(req)
      if (!folder_id || !document_id) {
        return send(res, 400, {
          error: 'folder_id and document_id are both required',
        })
      }
      source.document_notes = source.document_notes ?? {}
      const key = `${folder_id}.${document_id}`
      if (summary) source.document_notes[key] = summary
      else delete source.document_notes[key]

      send(res, 200, { key, summary: summary ?? null })
    },
  },

  // Stops a queued or running job; it lands in Recent as "cancelled".
  {
    method: 'POST',
    match: (p) => /^\/profiling-jobs\/.+\/cancel$/.test(p),
    handle: (_req, res, { pathname }) => {
      const jobId = decodeURIComponent(
        pathname.slice('/profiling-jobs/'.length, -'/cancel'.length),
      )
      const job = profilingJobs.find((j) => j.job_id === jobId)
      if (!job) return send(res, 404, { error: `no job ${jobId}` })
      if (job.status === 'complete' || job.status === 'cancelled') {
        return send(res, 409, { error: `job is already ${job.status}` })
      }
      job.status = 'cancelled'
      job.finished_at = new Date().toISOString()
      job.started_at = job.started_at ?? job.triggered_at
      job.error = `cancelled at stage ${job.stage_index} of ${PIPELINE.length}`
      send(res, 200, jobView(job))
    },
  },

  {
    method: 'GET',
    match: (p) => p === '/profiling-jobs',
    handle: (_req, res) => {
      const views = profilingJobs.map(jobView)
      const active = views.filter(
        (j) => j.status === 'queued' || j.status === 'running',
      )
      const recent = views.filter(
        (j) => j.status !== 'queued' && j.status !== 'running',
      )

      const running = active.find((j) => j.status === 'running')
      const statusLine =
        active.length === 0
          ? 'idle — nothing running'
          : running
            ? `running — ${active.length} job(s) · stage ${running.stage_index} of ${running.stage_total}: ${running.stage_label}`
            : `queued — ${active.length} job(s) waiting to start`

      send(res, 200, {
        active,
        recent,
        active_count: active.length,
        recent_count: recent.length,
        status_line: statusLine,
        pipelines: { bigquery: PIPELINE, gdrive: DOC_PIPELINE },
      })
    },
  },

  {
    method: 'GET',
    match: (p) => p === '/change-signals',
    handle: (_req, res) => {
      const connected = connectedSources().length
      const signals = connected === 0 ? [] : db.change_signals
      send(res, 200, {
        signals,
        count: signals.length,
        connected_sources: connected,
      })
    },
  },

  /*
   * Step 1 of the New Graph wizard. Domains are returned ranked by what the
   * connected data can actually support, not alphabetically — a domain with no
   * backing data would produce a graph that answers nothing.
   *
   * `fit` is seeded in db.json but downgraded here: claiming a domain is
   * "already profiled" while the tenant has profiled nothing would be a lie of
   * exactly the kind the rest of this API refuses to tell.
   */
  {
    method: 'GET',
    match: (p) => p === '/graph-domains',
    handle: (_req, res) => {
      const connected = connectedSources()
      const profiled = connected.reduce(
        (sum, s) => sum + (s.profiled?.length ?? 0) + (s.profiled_docs?.length ?? 0),
        0,
      )

      const domains = db.graph_domains.map((d) => {
        let fit = d.fit ?? 'none'
        if (fit === 'strong' && profiled === 0) {
          fit = connected.length > 0 ? 'partial' : 'none'
        }
        const note =
          fit === (d.fit ?? 'none')
            ? d.note
            : fit === 'partial'
              ? 'Partial fit — a source is connected but nothing is profiled yet.'
              : (d.unmet_note ?? d.note)

        return {
          domain_id: d.domain_id,
          name: d.name,
          expected_sources: d.expected_sources ?? [],
          fit,
          note,
          rank: d.rank ?? 99,
        }
      })

      domains.sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit] || a.rank - b.rank)

      send(res, 200, {
        domains,
        domain_count: domains.length,
        connected_sources: connected.length,
        profiled_objects: profiled,
      })
    },
  },

  {
    method: 'GET',
    match: (p) => p === '/graph-use-cases',
    handle: (_req, res) => {
      const list = [...db.graph_use_cases].sort(
        (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
      )
      send(res, 200, {
        use_cases: list.map(savedUseCase),
        count: list.length,
        draft_count: list.filter((u) => u.status !== 'committed').length,
        committed_count: list.filter((u) => u.status === 'committed').length,
        // The wizard reads its step labels from here so the stepper and this
        // server's step validation cannot drift apart.
        steps: WIZARD_STEPS,
      })
    },
  },

  // Upsert: no id creates, an id updates. Unlike a registered source this is
  // written to db.json, so a draft survives a restart.
  {
    method: 'POST',
    match: (p) => p === '/graph-use-cases',
    handle: async (req, res) => {
      const body = await readJson(req)
      const { use_case_id, name, domain_id, business_need, step, status } = body

      if (!name || !String(name).trim()) {
        return send(res, 400, {
          error: 'name is required — it is what the saved use cases list shows',
        })
      }
      if (domain_id && !db.graph_domains.some((d) => d.domain_id === domain_id)) {
        return send(res, 400, { error: `unknown domain ${domain_id}` })
      }
      if (status && status !== 'draft' && status !== 'committed') {
        return send(res, 400, { error: 'status must be "draft" or "committed"' })
      }
      const stepNumber = Number(step ?? 1)
      if (
        !Number.isInteger(stepNumber) ||
        stepNumber < 1 ||
        stepNumber > WIZARD_STEPS.length
      ) {
        return send(res, 400, {
          error: `step must be an integer from 1 to ${WIZARD_STEPS.length}`,
        })
      }

      const existing = use_case_id
        ? db.graph_use_cases.find((u) => u.use_case_id === use_case_id)
        : null
      if (use_case_id && !existing) {
        return send(res, 404, { error: `no use case ${use_case_id}` })
      }

      const record = {
        use_case_id: existing?.use_case_id ?? `uc-${slugify(name)}-${nextId()}`,
        name: String(name).trim(),
        status: status ?? existing?.status ?? 'draft',
        domain_id: domain_id ?? existing?.domain_id ?? null,
        business_need: business_need ?? existing?.business_need ?? '',
        step: stepNumber,
        updated_at: new Date().toISOString(),
      }

      commitDb({
        ...db,
        graph_use_cases: existing
          ? db.graph_use_cases.map((u) =>
              u.use_case_id === record.use_case_id ? record : u,
            )
          : [record, ...db.graph_use_cases],
      })

      send(res, existing ? 200 : 201, { saved: true, use_case: savedUseCase(record) })
    },
  },

  {
    method: 'DELETE',
    match: (p) => /^\/graph-use-cases\/.+$/.test(p),
    handle: (_req, res, { pathname }) => {
      const id = decodeURIComponent(pathname.slice('/graph-use-cases/'.length))
      if (!db.graph_use_cases.some((u) => u.use_case_id === id)) {
        return send(res, 404, { error: `no use case ${id}` })
      }
      commitDb({
        ...db,
        graph_use_cases: db.graph_use_cases.filter((u) => u.use_case_id !== id),
      })
      send(res, 200, { deleted: id })
    },
  },

  // Revokes the credential but keeps the registration, so it can be re-linked.
  {
    method: 'POST',
    match: (p) => /^\/sources\/.+\/disconnect$/.test(p),
    handle: (_req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/disconnect'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })
      source.status = 'disconnected'
      source.credential_handle = null
      send(res, 200, sourceRow(source))
    },
  },

  // Narrows or widens which datasets the source may profile.
  {
    method: 'PUT',
    match: (p) => /^\/sources\/.+\/datasets$/.test(p),
    handle: async (req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/datasets'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })

      const { datasets } = await readJson(req)
      if (!Array.isArray(datasets) || datasets.length === 0) {
        return send(res, 400, { error: 'datasets must be a non-empty array' })
      }
      const project = findProject(source.project_id)
      const known = new Set((project?.datasets ?? []).map((d) => d.dataset_id))
      const unknown = datasets.filter((d) => !known.has(d))
      if (unknown.length > 0) {
        return send(res, 400, {
          error: `dataset(s) not present in ${source.project_id}: ${unknown.join(', ')}`,
        })
      }
      source.datasets = datasets
      send(res, 200, sourceRow(source))
    },
  },

  // The Drive equivalent: which folders this source may profile.
  {
    method: 'PUT',
    match: (p) => /^\/sources\/.+\/folders$/.test(p),
    handle: async (req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/folders'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })
      if (source.kind !== 'gdrive') {
        return send(res, 400, {
          error: `${sourceId} is not a Drive source — use PUT /sources/${sourceId}/datasets`,
        })
      }

      const { folders } = await readJson(req)
      if (!Array.isArray(folders) || folders.length === 0) {
        return send(res, 400, { error: 'folders must be a non-empty array' })
      }
      const drive = findDrive(source.drive_id)
      const known = new Set((drive?.folders ?? []).map((f) => f.folder_id))
      const unknown = folders.filter((f) => !known.has(f))
      if (unknown.length > 0) {
        return send(res, 400, {
          error: `folder(s) not present in ${source.drive_id}: ${unknown.join(', ')}`,
        })
      }
      source.folders = folders
      send(res, 200, sourceRow(source))
    },
  },

  // Non-BigQuery connectors have no metadata discovery yet, so they register
  // as a bare row without datasets.
  {
    method: 'POST',
    match: (p) => p === '/sources/generic',
    handle: async (req, res) => {
      const { connector, source_name, type_label, credential_ref } = await readJson(req)
      if (!connector || !source_name) {
        return send(res, 400, { error: 'connector and source_name are both required' })
      }
      const slug = String(source_name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      const sourceId = `${connector}:${slug}`
      const alreadyRegistered = registered.has(sourceId)

      const record = {
        kind: 'generic',
        source_id: sourceId,
        source_name,
        connector,
        type_label: type_label || connector,
        credential_handle: credential_ref ?? null,
        datasets: [],
        status: 'syncing',
        registered_at: new Date().toISOString(),
        newly_connected: !alreadyRegistered,
      }
      registered.set(sourceId, record)
      send(res, alreadyRegistered ? 200 : 201, record)
    },
  },

  /*
   * Audit / traces / evals are platform telemetry rather than per-source
   * listings, but none of it exists before a source is connected. Each payload
   * carries `connected_sources` so the page can show the not-connected state
   * instead of numbers that could not have been produced yet.
   */
  {
    method: 'GET',
    match: (p) => p === '/audit',
    handle: (_req, res) => {
      const connected = connectedSources().length
      send(res, 200, {
        ...(connected === 0 ? { stats: [], events: [], policies: [] } : db.audit),
        event_window: connected === 0 ? '' : db.audit.event_window,
        policy_total: connected === 0 ? 0 : db.audit.policy_total,
        connected_sources: connected,
      })
    },
  },

  {
    method: 'GET',
    match: (p) => p === '/traces',
    handle: (_req, res) => {
      const connected = connectedSources().length
      send(res, 200, {
        ...(connected === 0
          ? { stats: [], items: [], sampling: '', waterfall: null }
          : db.traces),
        connected_sources: connected,
      })
    },
  },

  {
    method: 'GET',
    match: (p) => p === '/evals',
    handle: (_req, res) => {
      const connected = connectedSources().length
      send(res, 200, {
        ...(connected === 0
          ? { stats: [], runs: [], checks: [], run_trigger: '', failure_summary: '' }
          : db.evals),
        connected_sources: connected,
      })
    },
  },

  {
    method: 'DELETE',
    match: (p) => /^\/sources\/.+$/.test(p),
    handle: (_req, res, { pathname }) => {
      const sourceId = decodeURIComponent(pathname.slice('/sources/'.length))
      if (!registered.has(sourceId)) {
        return send(res, 404, { error: `no registered source ${sourceId}` })
      }
      registered.delete(sourceId)
      send(res, 200, { deleted: sourceId })
    },
  },
]

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const pathname = url.pathname.replace(/\/+$/, '') || '/'

  const route = routes.find((r) => r.method === req.method && r.match(pathname))
  if (!route) {
    return send(res, 404, { error: `no route for ${req.method} ${pathname}` })
  }

  try {
    await route.handle(req, res, { pathname, query: url.searchParams })
  } catch (err) {
    send(res, 400, { error: err instanceof Error ? err.message : 'bad request' })
  }
})

// Without this, a busy port throws an unhandled 'error' event and dumps a
// stack trace that buries the one line that matters.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nmock-server: port ${PORT} is already in use.\n`)
    console.error('  A copy is probably already running. Check it:')
    console.error(`      curl http://localhost:${PORT}/health`)
    console.error('  If that answers, you do not need a second one — leave it be.\n')
    console.error('  Otherwise find and stop whatever holds the port:')
    console.error(`      Windows:  netstat -ano | findstr :${PORT}   then  taskkill /PID <pid> /F`)
    console.error(`      macOS:    lsof -ti :${PORT} | xargs kill\n`)
    console.error('  Or run on a different port (also update the proxy target in')
    console.error('  vite.config.ts, or the app will keep calling 4000):')
    console.error('      npm run mock -- 4001\n')
    process.exit(1)
  }
  throw err
})

process.on('SIGINT', () => {
  console.log('\nmock-server: shutting down')
  server.close(() => process.exit(0))
})

server.listen(PORT, () => {
  console.log(`mock API listening on http://localhost:${PORT}`)
  console.log(
    `  ${db.projects.length} GCP projects · ` +
      `${db.projects.reduce((s, p) => s + p.datasets.length, 0)} datasets · ` +
      `${db.projects.reduce((s, p) => s + p.datasets.reduce((t, d) => t + d.tables.length, 0), 0)} tables`,
  )
  console.log(
    `  ${db.drives.length} Drives · ` +
      `${db.drives.reduce((s, d) => s + d.folders.length, 0)} folders · ` +
      `${db.drives.reduce((s, d) => s + d.folders.reduce((t, f) => t + f.documents.length, 0), 0)} documents`,
  )
  console.log('  credential handles (issued by the Google consent flow):')
  for (const c of db.credentials) {
    console.log(`    ${c.project_id.padEnd(24)} ${c.credential_handle}`)
  }
  for (const c of db.drive_credentials) {
    console.log(`    ${c.drive_id.padEnd(24)} ${c.credential_handle}`)
  }
})
