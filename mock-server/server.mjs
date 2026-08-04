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
 *   GET    /sources/oauth/start
 *   GET    /sources/oauth/callback?state=...
 *   POST   /sources/preview                { project_id, credential_handle }
 *   POST   /sources                        { project_id, credential_handle, datasets, source_name }
 *   GET    /sources                        registered rows only
 *   POST   /sources/:id/disconnect
 *   PUT    /sources/:id/datasets           { datasets }
 *   DELETE /sources/:sourceId
 *   GET    /sources/:id/browse             allowlisted datasets + their tables
 *   POST   /sources/:id/profile            { objects: [{dataset_id, table_id}], force }
 *   GET    /sources/:id/columns            profiled columns
 *   GET    /profiling-jobs
 *   GET    /change-signals
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
/** OAuth states issued by /sources/oauth/start, consumed by the callback. */
const oauthStates = new Set()

let counter = 0
const nextId = () => `${Date.now().toString(36)}${(counter++).toString(36)}`

const findProject = (id) => db.projects.find((p) => p.project_id === id)
const findCredentialByHandle = (handle) =>
  db.credentials.find((c) => c.credential_handle === handle)

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
 * `profiled_tables` / `profiled_columns` deliberately stay 0: registration is
 * instant, but counts only land once the Metadata Profiler has run. Nothing in
 * this mock runs it, so they remain 0 — which is the real behaviour.
 */
function sourceRow(source) {
  const isDrive = source.connector === 'gdrive'
  return {
    source_id: source.source_id,
    source_name: source.source_name,
    connector: source.connector,
    status: source.status,
    project_account: source.project_id ?? source.account ?? '—',
    scope:
      source.kind === 'bigquery'
        ? `${source.datasets.length} dataset(s)`
        : `${source.folder_count ?? 0} folder(s)`,
    connected_at: source.registered_at,
    profiled_tables: source.profiled_tables ?? 0,
    profiled_columns: source.profiled_columns ?? 0,
    profiled_documents: isDrive ? (source.profiled_documents ?? 0) : null,
    datasets: source.datasets ?? [],
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
}

const DB_HINTS = {
  google_account: 'object with at least an "email" string',
  credentials: 'array of { project_id, credential_handle }',
  projects: 'non-empty array of { project_id, datasets: [] }',
  audit: 'object with stats[], events[], policies[]',
  traces: 'object with stats[], items[]',
  evals: 'object with stats[], runs[], checks[]',
  change_signals: 'array',
  column_vocabulary: 'non-empty array of { name, type, class }',
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

/*
 * The Metadata Profiler pipeline. A job is queued, then walks these stages one
 * at a time, committing profiled tables as it goes — so the UI can show a run
 * in flight rather than a result appearing from nowhere.
 */
const PIPELINE = [
  'Schema fetch',
  'Statistics sampling',
  'Class inference',
  'PII detection',
  'Candidate keys',
]

// Paced so a run is comfortably observable at the UI's 3s poll interval.
const QUEUE_MS = 1200
const STAGE_MS = 2200

const elapsedSeconds = (job) => {
  if (!job.started_at) return 0
  const end = job.finished_at ? Date.parse(job.finished_at) : Date.now()
  return Math.max(0, Math.round((end - Date.parse(job.started_at)) / 1000))
}

/** Public shape of a job — elapsed is computed live for running jobs. */
const jobView = (job) => ({
  job_id: job.job_id,
  short_id: job.short_id,
  source_id: job.source_id,
  status: job.status,
  stage_index: job.stage_index,
  stage_total: PIPELINE.length,
  stage_label: job.stage_label,
  pipeline: `${job.stage_index}/${PIPELINE.length}: ${job.stage_label}`,
  progress: job.progress,
  tables: job.tables,
  table_count: job.tables.length,
  tables_done: job.tables.filter((t) => t.state !== 'pending').length,
  force: job.force,
  triggered_at: job.triggered_at,
  started_at: job.started_at,
  finished_at: job.finished_at,
  elapsed_seconds: elapsedSeconds(job),
  triggered_by: job.triggered_by,
  error: job.error,
})

/** Recompute a source's profiled counters from its committed table list. */
function recount(source) {
  source.profiled_tables = source.profiled.length
  source.profiled_columns = source.profiled.reduce((s, p) => s + p.columns, 0)
}

/** Commit one pending table of this job as profiled on its source. */
function commitNextTable(job) {
  const source = registered.get(job.source_id)
  if (!source) return
  const next = job.tables.find((t) => t.state === 'pending')
  if (!next) return

  const already = source.profiled.some(
    (p) => p.dataset_id === next.dataset_id && p.table_id === next.table_id,
  )
  if (!already) {
    source.profiled.push({
      dataset_id: next.dataset_id,
      table_id: next.table_id,
      columns: next.columns,
      profiled_at: new Date().toISOString(),
    })
  }
  next.state = 'profiled'
  recount(source)
}

/** Drive a queued job through the pipeline on timers. */
function runJob(job) {
  job.status = 'running'
  job.started_at = new Date().toISOString()

  const step = () => {
    if (job.status === 'cancelled') return
    job.stage_index += 1
    job.stage_label = PIPELINE[job.stage_index - 1]
    job.progress = Math.round((job.stage_index / PIPELINE.length) * 100)

    // Spread table commits across the run so counters climb as it progresses.
    const target = Math.floor(
      (job.tables.length * job.stage_index) / PIPELINE.length,
    )
    while (job.tables.filter((t) => t.state === 'profiled').length < target) {
      commitNextTable(job)
    }

    if (job.stage_index >= PIPELINE.length) {
      while (job.tables.some((t) => t.state === 'pending')) commitNextTable(job)
      job.status = 'complete'
      job.progress = 100
      job.finished_at = new Date().toISOString()
      return
    }
    setTimeout(step, STAGE_MS).unref?.()
  }

  setTimeout(step, STAGE_MS).unref?.()
}

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

  // Step 2: kick off the Google consent flow. A real deployment would return
  // Google's authorize URL; here the callback is immediately resolvable.
  {
    method: 'GET',
    match: (p) => p === '/sources/oauth/start',
    handle: (_req, res) => {
      const state = `state-${nextId()}`
      oauthStates.add(state)
      send(res, 200, {
        state,
        auth_url: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&scope=https://www.googleapis.com/auth/bigquery.readonly`,
        scopes: ['https://www.googleapis.com/auth/bigquery.readonly'],
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
      oauthStates.delete(state)
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

      const { objects, force } = await readJson(req)
      if (!Array.isArray(objects) || objects.length === 0) {
        return send(res, 400, { error: 'objects must be a non-empty array' })
      }

      const project = findProject(source.project_id)
      const allowed = new Set(source.datasets ?? [])
      source.profiled = source.profiled ?? []

      const tables = []
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
        tables.push({
          dataset_id,
          table_id,
          columns: table.columns,
          // Already-profiled tables are skipped unless the caller forces a redo.
          state: already && !force ? 'skipped' : 'pending',
        })
      }

      const jobId = crypto.randomUUID()
      const job = {
        job_id: jobId,
        short_id: jobId.slice(0, 8),
        source_id: sourceId,
        status: 'queued',
        stage_index: 0,
        stage_label: 'queued',
        progress: 0,
        tables,
        force: Boolean(force),
        triggered_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
        triggered_by: `${db.google_account.email} (Tenant Admin)`,
        error: null,
      }
      profilingJobs.unshift(job)

      if (tables.every((t) => t.state === 'skipped')) {
        // Nothing to do — finish immediately rather than faking a pipeline run.
        job.status = 'complete'
        job.stage_index = PIPELINE.length
        job.stage_label = 'nothing to profile'
        job.progress = 100
        job.started_at = job.triggered_at
        job.finished_at = job.triggered_at
      } else {
        setTimeout(() => runJob(job), QUEUE_MS).unref?.()
      }

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
        pipeline: PIPELINE,
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
  console.log('  credential handles (issued by the Google consent flow):')
  for (const c of db.credentials) {
    console.log(`    ${c.project_id.padEnd(24)} ${c.credential_handle}`)
  }
})
