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
 *   GET    /auth/roles                     the personas the login dropdown offers
 *   POST   /auth/login                     { email, password, role_id }
 *   GET    /projects
 *   GET    /projects/:projectId/datasets
 *   GET    /drives
 *   GET    /drives/:driveId/folders
 *   GET    /sources/oauth/start?provider=bigquery|drive
 *   GET    /sources/oauth/callback?state=...&provider=bigquery|drive&as=email
 *   GET    /sources/oauth/projects?session=...  projects the account can read
 *   GET    /sources/oauth/drives?session=...    drives the account can read
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
 *   POST   /graph-personas/suggest         step 2 draft { domain_id, business_need }
 *   POST   /graph-kpis/suggest             step 3 draft { domain_id, business_need }
 *   GET    /graph-sources                  step 4: connected sources + profiled objects
 *   POST   /graph-questions/suggest         step 5 draft { domain_id, business_need }
 *   POST   /graph-answer-formats/suggest    step 6 formats { domain_id, business_need }
 *   POST   /graph-coverage                 step 7 review { name, sources, hero_questions }
 *   POST   /graph-derivations              step 6 -> 7 run; 202 + poll
 *   GET    /graph-derivations/:derivationId
 *   GET    /graph-studio                   the graphs that have been built
 *   GET    /graph-studio/:useCaseId        that graph's queue, pivot, gate
 *   POST   /graph-studio/:id/builds        build (or rebuild); 202 + poll
 *   GET    /graph-studio/:id/builds        this graph's build history
 *   GET    /graph-studio/:id/builds/:buildId
 *   POST   /graph-studio/:id/decisions     { item_id, choice, justification? }
 *   POST   /graph-studio/:id/pivot         { option_id }
 *   GET    /graph-studio/:id/canvas        the ontology as nodes + edges
 *   POST   /graph-studio/:id/query         { question } asked of the draft
 *   POST   /graph-studio/:id/versions/:sha/publish    gate Ask access to one build
 *   POST   /graph-studio/:id/versions/:sha/unpublish  take it out of Ask
 *   POST   /graph-studio/:id/quality-check checks the publish preconditions
 *   GET    /ask                            the graphs that are live, so askable
 *   POST   /ask                            { use_case_id, question } asked of the live one
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

/*
 * How long the two consent calls are held. There is no Google here, so both are
 * ready instantly — but the wizard shows a stage per call, and a handshake that
 * finishes before the first frame paints looks like nothing happened. Same
 * reasoning as SUGGEST_MS and the profiler's stage timers.
 *
 * The two together are the whole sign-in, and it is deliberately in the 2–4s
 * band: long enough that each stage is read rather than glimpsed, short enough
 * that nobody wonders whether it has hung. Change them as a pair — it is the
 * total that is tuned, not either number on its own.
 */
const CONSENT_START_MS = 900
const CONSENT_MS = 1400
const DISCOVERY_MS = 800

/**
 * How short a source name may be.
 *
 * A name is **required** on every register endpoint, and the project or drive id
 * is no longer accepted as a silent fallback. It used to be: registering with the
 * field blank produced a row called `vrio-contextweave-demo`, which reads as a
 * name until two sources from one project need telling apart. The floor exists so
 * "a", "x" and "db" cannot pass either — the Sources table and the Catalogue both
 * key off this string, and neither can be made readable later.
 *
 * `check-docs` asserts the client's copy of this number matches.
 */
const SOURCE_NAME_MIN = 6

/**
 * The one validator all three register endpoints use, so BigQuery, Drive and the
 * stubbed connectors cannot disagree about what a name is. Returns the sentence
 * to send, or null when the name is fine — the message is shown verbatim, so it
 * says what to do rather than which predicate failed.
 */
function sourceNameProblem(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name === '') {
    return 'source_name is required — give this source a name of at least ' +
      `${SOURCE_NAME_MIN} characters, so it can be told apart in the Sources table.`
  }
  if (name.length < SOURCE_NAME_MIN) {
    return `"${name}" is too short — a source name needs at least ${SOURCE_NAME_MIN} characters.`
  }
  return null
}

/*
 * Sessions issued by the callback, consumed by the discovery endpoints —
 * session → the provider it was granted for. Unlike a state this is *not*
 * single-use: it stands in for an access token, and a token survives being read
 * twice, so a retried discovery works instead of forcing the sign-in again.
 */
const oauthSessions = new Map()

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

/*
 * Server-sent events, for the one response that arrives in pieces.
 *
 * An answer is streamed because it is *composed* — the summary lands, then each
 * block as it is produced. Everything else in this server answers in one shot and
 * should stay that way: streaming a list would be theatre.
 *
 * No dependency: SSE is `event:` and `data:` lines separated by a blank line, and
 * `res.write` is all it takes.
 */
const sseOpen = (res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Proxies buffer event streams by default, which turns a stream back into
    // one late blob. nginx honours this; the Vite dev proxy passes it through.
    'x-accel-buffering': 'no',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  })
}

const sseSend = (res, event, data) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

/** Sleeps between emissions, so a composed answer reads as composed. */
const pause = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.()
  })

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
  auth_roles: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((r) => isObject(r) && r.role_id && r.label),
  credentials: (v) =>
    Array.isArray(v) &&
    v.every((c) => isObject(c) && c.project_id && c.credential_handle),
  /*
   * The nested objects are checked, not only the collection. A table's `label`
   * and `grain` and a document's `doc_type_label` and `linked_entity` are read
   * straight through to the browse tree and the dictionary, so dropping one
   * renders a blank cell rather than raising anything — the same silent-drop
   * failure `graph_studio.canvas` is checked for.
   */
  projects: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (p) =>
        isObject(p) &&
        p.project_id &&
        Array.isArray(p.datasets) &&
        p.datasets.every(
          (d) =>
            isObject(d) &&
            d.dataset_id &&
            Array.isArray(d.tables) &&
            d.tables.every((t) => isObject(t) && t.table_id && t.label && t.grain),
        ),
    ),
  drive_credentials: (v) =>
    Array.isArray(v) &&
    v.every((c) => isObject(c) && c.drive_id && c.credential_handle),
  drives: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (d) =>
        isObject(d) &&
        d.drive_id &&
        Array.isArray(d.folders) &&
        d.folders.every(
          (f) =>
            isObject(f) &&
            f.folder_id &&
            Array.isArray(f.documents) &&
            f.documents.every(
              (doc) =>
                isObject(doc) &&
                doc.document_id &&
                doc.doc_type &&
                doc.doc_type_label &&
                doc.linked_entity,
            ),
        ),
    ),
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
  /*
   * The real profiled columns, `dataset.table` → columns[]. Required, and checked
   * inside: `tableDictionary` falls back to synthesis when a table has no entry,
   * so losing this key would not throw — the catalogue would quietly serve 206
   * invented columns in place of the profiler's, which is the worst kind of
   * wrong. A malformed entry is refused for the same reason.
   */
  column_profiles: (v) =>
    isObject(v) &&
    Object.keys(v).length > 0 &&
    Object.values(v).every(
      (columns) =>
        Array.isArray(columns) &&
        columns.length > 0 &&
        columns.every(
          (c) =>
            isObject(c) &&
            typeof c.column_id === 'string' &&
            typeof c.class === 'string' &&
            typeof c.description === 'string' &&
            typeof c.confidence === 'number',
        ),
    ),
  /*
   * document_id → its resolution into the graph. Required for the same reason
   * `column_profiles` is: dropping it does not throw, it turns every document's
   * "resolved to FAC:…, 28 linked manifests" into a shrug, and a graph payoff
   * that silently disappears is worse than one that errors.
   */
  document_extractions: (v) =>
    isObject(v) &&
    Object.keys(v).length > 0 &&
    Object.values(v).every(
      (e) =>
        isObject(e) &&
        typeof e.extracted_entity === 'string' &&
        typeof e.resolved_node === 'string' &&
        typeof e.linked_manifests === 'number' &&
        typeof e.confidence === 'number',
    ),
  /*
   * The tenant's written answers. Required for the reason `column_profiles` is:
   * losing it does not throw — `matchAskAnswer` finds nothing and every question
   * falls through to the graph walk, so Ask quietly stops answering anything it
   * has a real answer for and abstains instead. An empty list is a working app
   * that has lost its content.
   */
  ask_answers: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (a) =>
        isObject(a) &&
        typeof a.answer_id === 'string' &&
        typeof a.question === 'string' &&
        typeof a.summary === 'string' &&
        Array.isArray(a.blocks) &&
        a.blocks.every((b) => isObject(b) && typeof b.type === 'string') &&
        typeof a.confidence === 'number',
    ),
  graph_domains: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((d) => isObject(d) && d.domain_id && d.name),
  graph_personas: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((p) => isObject(p) && p.persona_id && p.name),
  graph_kpis: (v) =>
    Array.isArray(v) && v.length > 0 && v.every((k) => isObject(k) && k.kpi_id && k.name),
  graph_hero_questions: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((q) => isObject(q) && q.question_id && q.text),
  graph_answer_formats: (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((f) => isObject(f) && f.format_id && f.name),
  /*
   * A stated answer for a brief the tenant already knows, as opposed to the
   * pools above, which are ranked against a brief nobody has seen before. The
   * member lists are *ids into those pools*, never copies: a persona edited in
   * `graph_personas` must not leave a template quietly describing the old one.
   */
  graph_use_case_templates: (v) =>
    Array.isArray(v) &&
    v.every(
      (t) =>
        isObject(t) &&
        t.template_id &&
        t.name &&
        Array.isArray(t.match_phrases) &&
        Array.isArray(t.personas) &&
        Array.isArray(t.kpis) &&
        Array.isArray(t.hero_questions),
    ),
  graph_use_cases: (v) =>
    Array.isArray(v) && v.every((u) => isObject(u) && u.use_case_id && u.name),
  /*
   * The nested keys are checked too, not just the top level. A server running
   * since before `canvas` existed would otherwise write its stale copy back and
   * drop it silently — a top-level-only check cannot see that, and it has
   * already happened once.
   */
  graph_studio: (v) =>
    isObject(v) &&
    Array.isArray(v.review_items) &&
    isObject(v.generated) &&
    isObject(v.pivot) &&
    isObject(v.canvas) &&
    Array.isArray(v.canvas.nodes) &&
    Array.isArray(v.canvas.edges) &&
    /*
     * `sanity_checks` is required for the reason `column_profiles` is: losing it
     * does not throw. The Query tab falls through to the live walk, which abstains
     * on a question the recorded set answers in full — and an abstention reads as
     * "the draft cannot answer this", which is exactly the finding the tab exists
     * to report. A missing key would look like a failed sanity check.
     */
    Array.isArray(v.sanity_checks),
}

const DB_HINTS = {
  google_account: 'object with at least an "email" string',
  auth_roles: 'non-empty array of { role_id, label }',
  credentials: 'array of { project_id, credential_handle }',
  projects:
    'non-empty array of { project_id, datasets: [{ dataset_id, tables: [{ table_id, label, grain }] }] }',
  drive_credentials: 'array of { drive_id, credential_handle }',
  drives:
    'non-empty array of { drive_id, folders: [{ folder_id, documents: [{ document_id, doc_type, doc_type_label, linked_entity }] }] }',
  audit: 'object with stats[], events[], policies[]',
  traces: 'object with stats[], items[]',
  evals: 'object with stats[], runs[], checks[]',
  change_signals: 'array',
  column_vocabulary: 'non-empty array of { name, type, class }',
  document_vocabulary: 'non-empty array of { name, type, class }',
  column_profiles:
    'object keyed "<dataset>.<table>", each a non-empty array of ' +
    '{ column_id, label, type, class, description, derivation, confidence, pii, null_pct, distinct }',
  ask_answers:
    'non-empty array of { answer_id, question, summary, blocks[], evidence[], confidence } — ' +
    'the recorded answers Ask serves',
  document_extractions:
    'object keyed by document_id, each ' +
    '{ extraction_id, extracted_entity, entity_type, resolved_node, resolved_facility, state, linked_manifests, confidence }',
  graph_domains: 'non-empty array of { domain_id, name }',
  graph_personas: 'non-empty array of { persona_id, name }',
  graph_kpis: 'non-empty array of { kpi_id, name }',
  graph_hero_questions: 'non-empty array of { question_id, text }',
  graph_answer_formats: 'non-empty array of { format_id, name }',
  graph_use_case_templates:
    'array of { template_id, name, match_phrases[], personas[], kpis[], hero_questions[] } — ' +
    'the three member lists hold ids from graph_personas / graph_kpis / graph_hero_questions',
  graph_use_cases: 'array of { use_case_id, name }',
  graph_studio:
    'object with review_items[], generated{}, pivot{}, canvas{ nodes[], edges[] }, ' +
    'sanity_checks[] — the recorded Query & sanity-check set, each { check_id, question, path[], edges_used[] }',
}

function validateDb(candidate) {
  const problems = []
  if (!isObject(candidate)) return ['the document must be a JSON object']
  for (const [key, check] of Object.entries(DB_SHAPE)) {
    if (!(key in candidate)) problems.push(`"${key}" is missing — ${DB_HINTS[key]}`)
    else if (!check(candidate[key]))
      problems.push(`"${key}" is the wrong shape — expected ${DB_HINTS[key]}`)
  }

  /*
   * The per-key checks above cannot see across keys, and a use-case template is
   * nothing but references into three other keys. An id that does not resolve
   * would not throw — it would drop out of the bundle, and the step would draft
   * four personas where the use case names five. A short list looks like an
   * answer, so this has to fail at boot rather than at request time.
   */
  /*
   * A canvas edge whose endpoint is not a node does not throw — it is skipped while
   * drawing, so the relationship simply is not there. The knowledge graph shipped
   * with 20 such edges (three alias names and an unitemised enforcement type that
   * the node roster omitted), and the symptom was a facility drawn with no
   * enforcement at all. Silence is the wrong answer for a missing relationship.
   */
  if (problems.length === 0) {
    const nodeIds = new Set(candidate.graph_studio.canvas.nodes.map((n) => n.node_id))
    for (const e of candidate.graph_studio.canvas.edges) {
      for (const [end, side] of [
        [e.from, 'from'],
        [e.to, 'to'],
      ]) {
        if (!nodeIds.has(end)) {
          problems.push(
            `graph_studio.canvas has an edge whose ${side} is "${end}", which is not ` +
              'a node — add the node or remove the edge, or it will be drawn as nothing',
          )
        }
      }
    }

    /*
     * A recorded sanity check walks a sub-graph by id, and the answer lights that
     * walk up on the canvas. An id that resolves to nothing fails the same silent
     * way a dangling edge does: the check still reports "graph can answer this" and
     * the canvas highlights one hop less than the answer claims. Same class of bug,
     * same refusal.
     */
    const edgeIds = new Set(candidate.graph_studio.canvas.edges.map((e) => e.edge_id))
    for (const check of candidate.graph_studio.sanity_checks) {
      for (const id of check.path ?? []) {
        if (!nodeIds.has(id)) {
          problems.push(
            `graph_studio.sanity_checks "${check.check_id}" walks node "${id}", which is ` +
              'not on the canvas — re-run "npm run ingest:graph" rather than editing either by hand',
          )
        }
      }
      for (const id of check.edges_used ?? []) {
        if (!edgeIds.has(id)) {
          problems.push(
            `graph_studio.sanity_checks "${check.check_id}" walks edge "${id}", which is ` +
              'not on the canvas — re-run "npm run ingest:graph" rather than editing either by hand',
          )
        }
      }
    }
  }

  if (problems.length === 0) {
    for (const template of candidate.graph_use_case_templates) {
      for (const [memberKey, poolKey, idKey] of [
        ['personas', 'graph_personas', 'persona_id'],
        ['kpis', 'graph_kpis', 'kpi_id'],
        ['hero_questions', 'graph_hero_questions', 'question_id'],
      ]) {
        for (const id of template[memberKey]) {
          if (!candidate[poolKey].some((entry) => entry[idKey] === id)) {
            problems.push(
              `graph_use_case_templates "${template.template_id}" names ${memberKey.slice(0, -1)} ` +
                `"${id}", which is not in ${poolKey} — add it there or remove it from the template`,
            )
          }
        }
      }
    }
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
  /*
   * Every writer passes the whole document, so a server that started before a
   * key was added to db.json would write its stale copy back and silently drop
   * that key — the file would lose data no route ever touched. Validating here
   * rather than only in the /db editor turns that into a refused write with a
   * message naming the missing key.
   */
  const problems = validateDb(next)
  if (problems.length > 0) {
    throw new Error(
      `refusing to write db.json — ${problems.join('; ')}. If this server has ` +
        'been running since before that key existed, restart it.',
    )
  }

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
 * Above this, the profiler's own description is taken as good; below it, the
 * column is flagged for review. The band is the product's (High ≥ 0.85), so the
 * chip a user sees and the facet that counts it cannot disagree.
 */
const HIGH_CONFIDENCE = 0.85

/**
 * The column dictionary the profiler produces for one table.
 *
 * **Two sources, and real data wins.** `column_profiles` in db.json holds the
 * actual profiled columns for the five `epa_hazwaste` views — 206 of them,
 * ingested from `02_profiling/Metadata_Profiling.xlsx`, with the profiler's own
 * description, semantic class, confidence, PII flag, null % and distinct count.
 * Any table with an entry there is served from it verbatim.
 *
 * Anything else falls back to synthesis from `column_vocabulary` (see
 * `synthesiseColumns`), because a table nobody has profiled for real still has to
 * render. The fallback is a fallback: do not "simplify" by removing the real
 * branch, and do not extend the vocabulary to cover a view the workbook already
 * describes.
 *
 * A curator's note (`column_notes`) overrides the description on either path —
 * that is the one field a human owns.
 */
function tableDictionary(source, datasetId, tableId, columnCount, tableRows) {
  const profiled = db.column_profiles?.[`${datasetId}.${tableId}`]
  if (Array.isArray(profiled) && profiled.length > 0) {
    const notes = source.column_notes ?? {}
    return profiled.map((c) => {
      const note = notes[`${datasetId}.${tableId}.${c.column_id}`] ?? null
      return {
        column_id: c.column_id,
        label: c.label,
        type: c.type,
        class: c.class,
        confidence: c.confidence,
        derivation: c.derivation,
        pii: Boolean(c.pii),
        null_pct: c.null_pct,
        distinct: c.distinct,
        description: note ?? c.description,
        /*
         * Every real column arrives with a description, so "has one" would make
         * the Needs-review facet read 0 forever. What it means here is what a
         * reviewer would actually want: the profiler was less than confident and
         * no human has confirmed it. A curator note settles it either way.
         */
        description_status:
          note || c.confidence >= HIGH_CONFIDENCE ? 'described' : 'needs review',
      }
    })
  }
  return synthesiseColumns(source, datasetId, tableId, columnCount, tableRows)
}

/**
 * The hash-derived dictionary, for tables `column_profiles` does not cover.
 *
 * db.json stores a column *count* per table rather than a hand-written schema, so
 * the columns are synthesised from `column_vocabulary`: the slice is chosen by
 * hashing the table name, and every statistic derives from a hash of
 * table+column. Deterministic, so repeat requests agree.
 */
function synthesiseColumns(source, datasetId, tableId, columnCount, tableRows) {
  const vocab = db.column_vocabulary
  const offset = hash(tableId) % vocab.length
  const notes = source.column_notes ?? {}

  /*
   * A name is suffixed only when this table has already used it — not on the
   * vocabulary's second lap. The offset means the lap boundary falls mid-list,
   * so a table with no more columns than the vocabulary has entries used to
   * show `manifest_tracking_number_2` while the unsuffixed name appeared
   * nowhere. Suffixing on collision keeps ids unique without inventing a
   * "_2" that has no "_1".
   */
  const used = new Map()

  return Array.from({ length: columnCount }, (_, i) => {
    const v = vocab[(offset + i) % vocab.length]
    const seen = (used.get(v.name) ?? 0) + 1
    used.set(v.name, seen)
    const columnId = seen > 1 ? `${v.name}_${seen}` : v.name
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
      // Derived, not stored: a synthesised column has no name of its own beyond
      // its id, and the panel renders whichever it is given.
      label: columnId.replace(/_/g, ' ').toUpperCase(),
      type: v.type,
      class: v.class,
      confidence: v.confidence,
      derivation: 'llm',
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
 * **Two halves, and only one of them is synthesised.**
 *
 * The *resolution* is real: `document_extractions` in db.json, ingested from
 * `08_unstructured/Entity_Extraction_Map.xlsx`, records the entity the extractor
 * pulled out of each file, the graph facility node it resolved to, and how many
 * inbound manifests that node already carries. That is the join between the
 * unstructured side and the structured one — the whole point of profiling a
 * consent decree — so it is read, never derived. A document with no entry gets
 * `resolution: null`, which the panel says out loud rather than leaving blank.
 *
 * The *entity list* is synthesised, as the column dictionary's fallback is:
 * db.json stores an entity **count** per document, the slice comes from
 * `document_vocabulary` by hashing the document id, and occurrences/coverage come
 * from a hash of document+entity. Deterministic, so repeat requests agree. The
 * workbook describes one entity per file, not the dozens a 96-page decree holds,
 * so the list cannot be read from it — and the resolved one is reported
 * separately rather than being dropped into the list as though a hash had found it.
 *
 * Note what is NOT synthesised either: the summary. A description belongs to the
 * whole document here rather than to each entity, because that is the unit a
 * curator actually reviews for an unstructured file.
 */
function documentDictionary(source, folderId, doc) {
  const vocab = db.document_vocabulary
  const offset = hash(doc.document_id) % vocab.length
  const notes = source.document_notes ?? {}
  const chunks = Math.max(1, Math.round(doc.pages * 2.5))

  // Suffixed on collision within this document, for the reason tableDictionary
  // explains: a "_2" whose "_1" is nowhere reads as missing data.
  const used = new Map()

  const entities = Array.from({ length: doc.entities }, (_, i) => {
    const v = vocab[(offset + i) % vocab.length]
    const seen = (used.get(v.name) ?? 0) + 1
    used.set(v.name, seen)
    const entityId = seen > 1 ? `${v.name}_${seen}` : v.name
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
    doc_type_label: doc.doc_type_label,
    /*
     * The graph entity this file is about, from `Entity_Extraction_Map`. It is
     * read from db.json rather than synthesised: which company a consent decree
     * names is the one fact about these documents that a hash must never
     * invent, because it is what joins them to the structured side.
     */
    linked_entity: doc.linked_entity,
    /** Where that entity landed in the graph. Null when nothing resolved. */
    resolution: db.document_extractions?.[doc.document_id] ?? null,
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

  /*
   * A forced re-run reaches an object that is already committed. It must not
   * push a second record — that would double `profiled_tables` — but it must
   * leave a mark, or a re-profile is indistinguishable from never having run.
   * So: update in place, insert otherwise.
   */
  const at = new Date().toISOString()

  if (job.kind === 'gdrive') {
    source.profiled_docs = source.profiled_docs ?? []
    const existing = source.profiled_docs.find(
      (p) => p.folder_id === next.parent_id && p.document_id === next.object_id,
    )
    if (existing) {
      existing.entities = next.units
      existing.profiled_at = at
    } else {
      source.profiled_docs.push({
        folder_id: next.parent_id,
        document_id: next.object_id,
        entities: next.units,
        profiled_at: at,
      })
    }
  } else {
    source.profiled = source.profiled ?? []
    const existing = source.profiled.find(
      (p) => p.dataset_id === next.parent_id && p.table_id === next.object_id,
    )
    if (existing) {
      existing.columns = next.units
      existing.profiled_at = at
    } else {
      source.profiled.push({
        dataset_id: next.parent_id,
        table_id: next.object_id,
        columns: next.units,
        profiled_at: at,
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * `adaeze.okonjo@x.com` → `AO`; `ab@x.com` → `AB`.
 *
 * There is no name field to draw an avatar from — only the email the login form
 * collects — so the initials are derived from it: split the local part on
 * `.`/`_`/`-` (the separators a real "first.last" address uses) and take the
 * first letter of the first and last segment, falling back to the first two
 * letters of the whole local part when there is only one segment.
 */
function emailInitials(email) {
  const local = String(email).split('@')[0] ?? ''
  const segments = local.split(/[._-]+/).filter(Boolean)
  const initials =
    segments.length >= 2
      ? segments[0][0] + segments[segments.length - 1][0]
      : local.slice(0, 2)
  return initials.toUpperCase() || '?'
}

/**
 * `adaeze.okonjo@x.com` → `Adaeze Okonjo`; `ops@x.com` → `Ops`.
 *
 * Same reasoning as `emailInitials`: the login form collects an email and
 * nothing else, so a display name is *derived* from what was collected rather
 * than invented. Used by the consent callback, which has to answer with a name
 * and must not answer with somebody else's.
 */
function displayNameFromEmail(email) {
  const local = String(email).split('@')[0] ?? ''
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(' ')
  return name || String(email)
}

/**
 * A drafted item as stored: a name, a description, and where it came from.
 * Personas (step 2) and KPIs (step 3) are the same shape.
 *
 * Accepts a bare string too, because that is what earlier drafts (and a
 * hand-edited db.json) hold — normalising on read means an old draft opens
 * rather than rendering `undefined` in the row.
 */
function normalizeDrafted(list) {
  const seen = new Set()
  const out = []

  for (const entry of Array.isArray(list) ? list : []) {
    const raw = typeof entry === 'string' ? { name: entry } : (entry ?? {})
    const name = String(raw.name ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      name,
      description: String(raw.description ?? '').trim(),
      // Provenance is kept so the UI can say which ones the AI drafted.
      source: raw.source === 'ai' ? 'ai' : 'user',
    })
    if (out.length >= 12) break
  }
  return out
}

/**
 * Answer formats as stored, self-describing on purpose: the use case declares
 * how its answers render, so editing the pool in db.json later must not silently
 * change what an already-saved brief promised.
 */
function normalizeFormats(list) {
  const seen = new Set()
  const out = []

  for (const entry of Array.isArray(list) ? list : []) {
    const raw = entry ?? {}
    const formatId = String(raw.format_id ?? '').trim()
    const name = String(raw.name ?? '').trim()
    if (!formatId || !name || seen.has(formatId)) continue
    seen.add(formatId)
    out.push({ format_id: formatId, name, format: String(raw.format ?? '').trim() })
  }
  return out
}

/**
 * Hero questions as stored: the question, whether it is High, and who wrote it.
 *
 * `priority` is deliberately two-valued. High means "this is the graph's
 * contract" — a third tier would invite ranking instead of choosing.
 */
function normalizeQuestions(list) {
  const seen = new Set()
  const out = []

  for (const entry of Array.isArray(list) ? list : []) {
    const raw = typeof entry === 'string' ? { text: entry } : (entry ?? {})
    const text = String(raw.text ?? raw.name ?? '').trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      text,
      priority: raw.priority === 'high' ? 'high' : 'normal',
      source: raw.source === 'ai' ? 'ai' : 'user',
    })
    if (out.length >= 20) break
  }
  return out
}

/**
 * What the user decided about a gap. A gap without a decision blocks the build,
 * so these are stored beside the answers rather than derived.
 */
const GAP_DECISIONS = ['accept permanent', 'drop question', 'connect source', 'defer with trigger']

function normalizeGapDecisions(list) {
  const seen = new Set()
  const out = []
  for (const entry of Array.isArray(list) ? list : []) {
    const elementId = String(entry?.element_id ?? '').trim()
    const decision = String(entry?.decision ?? '').trim()
    if (!elementId || seen.has(elementId) || !GAP_DECISIONS.includes(decision)) continue
    seen.add(elementId)
    out.push({ element_id: elementId, decision })
  }
  return out
}

/** `manifest_header` → `Manifest Header`; a file name loses its extension. */
const entityName = (raw) =>
  String(raw)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())

/** Deterministic 0.86–0.99, so a match score never shifts under the UI. */
const matchScore = (seed) => Number((0.86 + (hash(seed) % 14) / 100).toFixed(2))

/**
 * The profiled objects a use case's source picks actually resolve to, with the
 * detail step 7 needs: the table it came from, its size, and its columns.
 *
 * Walks `registered` rather than `graphSources()` because coverage needs row
 * counts and the column dictionary, which the step 4 payload deliberately does
 * not carry.
 */
function selectedProfiledObjects(picks) {
  const out = []

  for (const pick of normalizeSourcePicks(picks)) {
    const source = registered.get(pick.source_id)
    if (!source || source.status !== 'connected') continue
    const wanted = new Set(pick.objects)
    const takeAll = pick.mode !== 'subset'

    if (source.kind === 'gdrive') {
      const drive = findDrive(source.drive_id)
      for (const p of source.profiled_docs ?? []) {
        const objectId = `${p.folder_id}.${p.document_id}`
        if (!takeAll && !wanted.has(objectId)) continue
        const meta = findDocument(drive, p.folder_id, p.document_id)
        if (!meta) continue
        out.push({
          objectId,
          sourceName: source.source_name,
          label: meta.name,
          // "2,841 documents" in the reference reads as the corpus behind an
          // extracted entity, so a document reports its pages the same way.
          size: `${meta.pages} pages`,
          evidenceKind: 'extraction match',
          columns: documentDictionary(source, p.folder_id, meta).entities.map((e) => ({
            id: e.entity_id,
            class: e.class,
          })),
        })
      }
      continue
    }

    const project = findProject(source.project_id)
    for (const p of source.profiled ?? []) {
      const objectId = `${p.dataset_id}.${p.table_id}`
      if (!takeAll && !wanted.has(objectId)) continue
      const meta = project?.datasets
        .find((d) => d.dataset_id === p.dataset_id)
        ?.tables.find((t) => t.table_id === p.table_id)
      const rows = meta?.rows ?? 0
      out.push({
        objectId,
        sourceName: source.source_name,
        label: p.table_id,
        size: `${rows.toLocaleString('en-US')} rows`,
        evidenceKind: 'match',
        columns: tableDictionary(source, p.dataset_id, p.table_id, p.columns, rows).map(
          (c) => ({ id: c.column_id, class: c.class }),
        ),
      })
    }
  }
  return out
}

const STOPWORDS = new Set([
  'which', 'what', 'where', 'when', 'whose', 'there', 'their', 'these', 'those',
  'about', 'across', 'based', 'before', 'being', 'between', 'could', 'every',
  'from', 'have', 'highest', 'lowest', 'most', 'other', 'should', 'still',
  'that', 'the', 'them', 'they', 'this', 'total', 'with', 'within', 'would',
  'can', 'complete', 'specific', 'different', 'historical', 'receive', 'exhibit',
  'nearing', 'through', 'quarter', 'trace',
])

/**
 * Step 7's coverage review.
 *
 * Every element is derived from something that has actually been profiled: an
 * entity is a profiled table or document, and its evidence names that object.
 * A hero question whose vocabulary appears nowhere in the profiled columns
 * becomes a **gap** — which is the honest answer, and the one that needs a
 * decision before anything is built.
 */
function graphCoverage({ name, picks, heroQuestions }) {
  const objects = selectedProfiledObjects(picks)
  const questions = normalizeQuestions(heroQuestions)
  const elements = []

  for (const o of objects) {
    const match = matchScore(`${o.sourceName}:${o.objectId}`)
    elements.push({
      element_id: `entity:${o.objectId}`,
      name: entityName(o.label),
      kind: 'entity',
      status: 'backed',
      confidence: match,
      // The line the reference shows under the name: where it came from.
      evidence: `${o.sourceName} · ${o.label} (${o.size}) · ${o.evidenceKind} ${match.toFixed(2)}`,
      reason: null,
    })
  }

  /*
   * Relationships are only claimed where two profiled objects share an
   * identifier column — that shared key *is* the evidence. Anything looser
   * would be a guess dressed as a derivation.
   */
  const keysFor = (o) =>
    new Set(o.columns.filter((c) => c.class === 'identifier').map((c) => c.id))

  for (let i = 0; i < objects.length && elements.length < 40; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const shared = [...keysFor(objects[i])].filter((k) => keysFor(objects[j]).has(k))
      if (shared.length === 0) continue
      const key = shared[0]
      const match = matchScore(`${objects[i].objectId}~${objects[j].objectId}`)
      elements.push({
        element_id: `rel:${objects[i].objectId}~${objects[j].objectId}`,
        name: `${entityName(objects[i].label)} → links-to → ${entityName(objects[j].label)}`,
        kind: 'relationship',
        status: 'backed',
        confidence: match,
        evidence: `shared key ${key} · ${objects[i].sourceName} · match ${match.toFixed(2)}`,
        reason: null,
      })
      break
    }
  }

  // What the profiled data can actually speak about.
  const vocabulary = new Set()
  for (const o of objects) {
    for (const word of entityName(o.label).toLowerCase().split(' ')) vocabulary.add(word)
    for (const c of o.columns) {
      for (const word of c.id.toLowerCase().split('_')) vocabulary.add(word)
    }
  }

  for (const q of questions) {
    const salient = [
      ...new Set(
        q.text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 5 && !STOPWORDS.has(w)),
      ),
    ]
    if (salient.length === 0) continue
    const matched = salient.filter((w) =>
      [...vocabulary].some((v) => v.startsWith(w.slice(0, 5))),
    )
    if (matched.length > 0) continue

    const missing = salient.slice(0, 3).join(', ')
    elements.push({
      element_id: `gap:${slugify(q.text).slice(0, 48)}`,
      name: q.text,
      kind: q.priority === 'high' ? 'entity' : 'relationship',
      status: 'gap',
      confidence: Number((0.2 + (hash(q.text) % 30) / 100).toFixed(2)),
      evidence: null,
      reason: `No candidates in any connected source — nothing profiled covers ${missing}.`,
    })
  }

  const entities = elements.filter((e) => e.kind === 'entity' && e.status === 'backed')
  const relationships = elements.filter(
    (e) => e.kind === 'relationship' && e.status === 'backed',
  )
  const gaps = elements.filter((e) => e.status === 'gap')

  return {
    title: `${name || 'Untitled use case'} — coverage review`,
    entity_count: entities.length,
    relationship_count: relationships.length,
    hero_question_count: questions.length,
    gap_count: gaps.length,
    object_count: objects.length,
    elements,
  }
}

/*
 * The derivation run between step 6 and step 7.
 *
 * The answer is computed up front — `graphCoverage` is deterministic — but it is
 * revealed over five stages on timers, the same way the Metadata Profiler is.
 * That is not decoration: the run is genuinely async (you can leave the page and
 * come back to it by id), and a wizard that jumps straight to a finished answer
 * teaches the user that deriving a graph is free and instant, which it is not.
 */
const DERIVATION_STAGES = [
  'Reading the business need',
  'Matching hero questions to profiled columns',
  'Deriving the entities you need',
  'Proposing relationships',
  'Checking coverage against the catalogue',
]

/**
 * The graph build pipeline — what turns a committed brief into a graph.
 *
 * Named as the platform names them, so a row on screen matches a row in a log,
 * and ordered by what depends on what: inputs are pinned first, the structured
 * side is parsed and joined before entities can be nominated, the document side is
 * mined separately, the two are reconciled, then resolved, comprehended, and
 * finally constructed.
 *
 * This lives in Graph Studio rather than in the wizard because a graph is built
 * more than once. Rebuilding after settling review rows is the normal case, so the
 * runs are kept per graph and the last one stays readable.
 */
const BUILD_STAGES = [
  { key: 'pin_inputs', steps: ['resolve_use_case', 'seal_coverage_evidence', 'pin_source_versions'] },
  { key: 'a01_schema_parsing', steps: ['read_column_profiles', 'infer_column_semantics', 'validate_grain'] },
  { key: 'join_matrix', steps: ['enumerate_shared_keys', 'score_join_candidates', 'prune_weak_joins'] },
  { key: 'entity_nomination', steps: ['nominate_from_tables', 'dedupe_nominations', 'bind_to_hero_questions'] },
  { key: 'a03_relationship_inference', steps: ['pair_entities', 'test_shared_identifiers', 'rank_by_evidence'] },
  { key: 'a02_document_entity_extraction', steps: ['chunk_documents', 'extract_entities', 'score_extraction_confidence'] },
  { key: 'a02b_document_relationship_mining', steps: ['mine_cooccurrence', 'link_document_entities'] },
  { key: 'a03b_cross_pipeline_reconciliation', steps: ['align_structured_and_document', 'resolve_conflicts', 'merge_evidence'] },
  { key: 'a04_entity_resolution', steps: ['blocking_pass', 'pairwise_match', 'assign_canonical_ids'] },
  { key: 'a015_comprehension', steps: ['summarise_entities', 'draft_relationship_labels'] },
  { key: 'a05_graph_construction', steps: ['materialise_nodes', 'materialise_edges', 'seal_package'] },
]

/**
 * The pipeline flattened to its substeps, which is what actually advances.
 *
 * **One cursor, not two.** A stage index and a step index kept in step by hand is
 * two counters that can disagree; a single cursor over this list makes every state
 * on screen derivable — a substep is complete before the cursor, running at it,
 * pending after, and a stage is whatever its substeps say it is.
 */
const BUILD_STEPS = BUILD_STAGES.flatMap((stage, stageIndex) =>
  stage.steps.map((step) => ({ stage: stage.key, step, stageIndex })),
)

/*
 * 5s per substep — 31 of them, so a whole build is ≈2m 35s.
 *
 * Deliberately far slower than PIPELINE or DERIVATION_STAGE_MS. Those pace an
 * operation so it cannot read as free; this one is paced so each substep can be
 * *narrated* — a build is watched over someone's shoulder, and a row that finishes
 * in a quarter of a second is gone before it can be pointed at. The cost is that a
 * run outlives a demo segment, which is why the Build tab states the expected
 * duration: without it, minutes of spinner read as wedged. Change this number and
 * the sentence on the page follows from it rather than repeating it — `step_ms` is
 * in the payload for exactly that reason.
 */
const BUILD_STEP_MS = 5_000

/**
 * Every build ever run, newest first, keyed by use case. In memory like every
 * other run here, so a restart clears the history and the 404 says so.
 */
const graphBuildsByUseCase = new Map()

/** Runs in flight, keyed by id. In memory, like every other run in this mock. */
const derivations = new Map()

const DERIVATION_STAGE_MS = 1300
const COST_CAP_USD = 1

/** What a "Suggest … (LLM)" button shows while it waits. */
const DRAFT_STAGES = ['Reading your brief', 'Drafting candidates', 'Ranking against your data']

// Long enough for the drafting state to be seen, short enough not to annoy.
const SUGGEST_MS = 1100

/** A quality check reads as work only if it takes long enough to be work. */
const QUALITY_CHECK_MS = 1200

/** Public shape of a derivation; the coverage only lands when it completes. */
const derivationView = (run) => ({
  derivation_id: run.derivation_id,
  status: run.status,
  stage_index: run.stage_index,
  stage_total: DERIVATION_STAGES.length,
  stage_label: run.stage_label,
  progress: run.progress,
  // The names stream in as they are derived — what the user watches.
  revealed: run.revealed,
  entity_total: run.entityTotal,
  cost_usd: Number(run.cost.toFixed(2)),
  cost_cap_usd: COST_CAP_USD,
  started_at: run.started_at,
  finished_at: run.finished_at,
  coverage: run.status === 'complete' ? run.coverage : null,
})

/**
 * A version is a build.
 *
 * Every completed build records one immutable, content-addressed row: the graph it
 * produced, its sha256, what it contains, the config version it was built from, and
 * the job it came from. Rebuilding the same config produces *another* version of
 * that config — which is why several rows share `v2` and differ by content hash.
 *
 * Nothing here is ever mutated. Publishing flips a pointer to one of these rows; it
 * does not rewrite the row, and unpublishing puts the pointer back. That is what
 * "immutable — content-addressed; publishing gates Ask access, it does not mutate
 * this graph" means on screen, and it has to stay true.
 */
const studioVersions = new Map()

/**
 * The config version a build is built from — `v1` plus the number of times the
 * brief has been committed. It moves when the *brief* changes, not when a build or
 * a publish happens, so every rebuild of one brief carries one version label.
 */
const studioConfigVersion = new Map()

const configVersion = (useCaseId) => `v${studioConfigVersion.get(useCaseId) ?? 1}`

/** Called when a brief is committed: a new config is a new version to build. */
function bumpConfigVersion(useCaseId) {
  studioConfigVersion.set(useCaseId, (studioConfigVersion.get(useCaseId) ?? 1) + 1)
}

/** Records the version a finished build produced. */
function recordVersion(run, gatePassed) {
  const rows = studioVersions.get(run.use_case_id) ?? []
  const gen = db.graph_studio.generated
  rows.unshift({
    /* The content hash *is* the identity — two builds of one config differ here
       and nowhere else, which is the point of content addressing. */
    sha256: `${(hash(`sha:${run.build_id}`) % 0xfffffffffff).toString(16)}${(hash(`sha2:${run.build_id}`) % 0xfffffff).toString(16)}`,
    graph_id: run.graph_version,
    config_version: run.config_version,
    entities: gen.entity_total ?? studioCanvas(run.use_case_id).node_count,
    relationships: studioCanvas(run.use_case_id).edge_count,
    from_job: run.build_id,
    created_at: run.finished_at,
    /*
     * Whether the publish gate was clear when this build finished. `unknown` is
     * not a failure — it means nobody had settled the queue and the pivot yet, so
     * nothing has checked this content. Publishing re-checks; this only reports
     * what was true at build time.
     */
    gate: gatePassed ? 'passed' : 'unknown',
  })
  studioVersions.set(run.use_case_id, rows)
}

/**
 * Public shape of a build.
 *
 * Every stage is listed from the first response with its own state, so the panel
 * shows the whole pipeline and fills it in — a list that grew a row at a time would
 * hide how much is left, which is the only thing the panel is for.
 *
 * `package_id` and `graph_version` are the run's own, minted when it starts: a
 * rebuild produces a new graph version, which is the point of rebuilding. They are
 * *reported*, never derived on the client.
 */
/**
 * Which stage the cursor is in. `BUILD_STAGES.length` once the run is past the
 * end — a finished run must not point at a real stage, or its last row would read
 * as still running.
 */
const stageIndexAt = (cursor) =>
  BUILD_STEPS[cursor]?.stageIndex ?? BUILD_STAGES.length

const buildView = (run) => ({
  build_id: run.build_id,
  use_case_id: run.use_case_id,
  status: run.status,
  /*
   * Every state below is derived from `run.cursor`, the one number the run keeps.
   * A stage is `running` while the cursor sits inside it — not merely because some
   * of its substeps are done — so the header and the rows cannot disagree.
   */
  stage_index: stageIndexAt(run.cursor),
  stage_total: BUILD_STAGES.length,
  step_index: run.cursor,
  step_total: BUILD_STEPS.length,
  /* The pace, reported rather than assumed: the page states how long a build takes
     and how much is left, and neither figure may be a number the client invented. */
  step_ms: BUILD_STEP_MS,
  stages: BUILD_STAGES.map((stage, i) => {
    const flat = BUILD_STEPS.map((s, index) => ({ ...s, index })).filter(
      (s) => s.stageIndex === i,
    )
    const done = flat.every((s) => s.index < run.cursor)
    const started = flat.some((s) => s.index < run.cursor)
    return {
      key: stage.key,
      state: done ? 'complete' : started || i === stageIndexAt(run.cursor) ? 'running' : 'pending',
      steps: flat.map((s) => ({
        key: s.step,
        state:
          s.index < run.cursor ? 'complete' : s.index === run.cursor ? 'running' : 'pending',
      })),
    }
  }),
  package_id: run.package_id,
  graph_version: run.graph_version,
  /* The config version this build is of — the label its version row carries. */
  config_version: run.config_version,
  started_at: run.started_at,
  finished_at: run.finished_at,
})

function runGraphBuild(run, useCase) {
  const step = () => {
    if (run.status !== 'running') return
    run.cursor += 1
    if (run.cursor >= BUILD_STEPS.length) {
      /* One past the last substep leaves every row `complete`: the running row is
         the cursor, so a finished run must not point at a real substep. */
      run.status = 'complete'
      run.finished_at = new Date().toISOString()
      // The version exists because the build finished — not because it started.
      recordVersion(run, studioSummary(useCase).queue_count === 0)
      return
    }
    setTimeout(step, BUILD_STEP_MS).unref?.()
  }
  setTimeout(step, BUILD_STEP_MS).unref?.()
}

/** Starts a build for a graph and records it in that graph's history. */
function startBuildFor(useCase) {
  const id = useCase.use_case_id
  const buildId = crypto.randomUUID()
  const run = {
    build_id: buildId,
    use_case_id: id,
    status: 'running',
    /* The only progress the run keeps: an index into BUILD_STEPS. Every stage and
       substep state on screen is derived from it, so they cannot disagree. */
    cursor: 0,
    /* Per run, not per graph: two builds of the same brief are two packages, and
       reporting one id for both would say a rebuild changed nothing. */
    package_id: `a${(hash(`package:${buildId}`) % 0xfffffff).toString(16).padStart(7, '0')}`,
    graph_version: `${(hash(`version:${buildId}`) % 0xfffffff).toString(16).padStart(7, '0')}f`,
    /* The config this build is of. Stable across rebuilds and across publishing —
       what moves it is a change to the brief. */
    config_version: configVersion(id),
    started_at: new Date().toISOString(),
    finished_at: null,
  }
  const history = graphBuildsByUseCase.get(id) ?? []
  history.unshift(run)
  graphBuildsByUseCase.set(id, history)
  runGraphBuild(run, useCase)
  return run
}

function runDerivation(run) {
  const names = run.coverage.elements
    .filter((e) => e.status === 'backed')
    .map((e) => e.name)

  const step = () => {
    if (run.status !== 'running') return
    run.stage_index += 1
    run.stage_label = DERIVATION_STAGES[run.stage_index - 1]
    run.progress = Math.round((run.stage_index / DERIVATION_STAGES.length) * 100)

    // Reveal proportionally, so the list fills as the bar does.
    const target = Math.ceil((names.length * run.stage_index) / DERIVATION_STAGES.length)
    run.revealed = names.slice(0, target)

    // Cost accrues per stage and is capped — a run that would exceed the cap
    // stops charging rather than quietly running past it.
    run.cost = Math.min(
      COST_CAP_USD,
      run.cost + 0.06 + (hash(`${run.derivation_id}:${run.stage_index}`) % 8) / 100,
    )

    if (run.stage_index >= DERIVATION_STAGES.length) {
      run.status = 'complete'
      run.progress = 100
      run.revealed = names
      run.finished_at = new Date().toISOString()
      return
    }
    setTimeout(step, DERIVATION_STAGE_MS).unref?.()
  }

  setTimeout(step, DERIVATION_STAGE_MS).unref?.()
}

/**
 * A step 4 pick: which source, and how much of it.
 *
 * `mode: 'all'` keeps meaning "everything profiled here", so a table profiled
 * after the draft was saved is included without the user reopening the wizard.
 * `mode: 'subset'` pins an explicit list.
 */
function normalizeSourcePicks(list) {
  const seen = new Set()
  const out = []

  for (const entry of Array.isArray(list) ? list : []) {
    const sourceId = String(entry?.source_id ?? '').trim()
    if (!sourceId || seen.has(sourceId)) continue
    seen.add(sourceId)
    const mode = entry?.mode === 'subset' ? 'subset' : 'all'
    out.push({
      source_id: sourceId,
      mode,
      objects:
        mode === 'subset'
          ? [
              ...new Set(
                (Array.isArray(entry.objects) ? entry.objects : [])
                  .map((o) => String(o).trim())
                  .filter(Boolean),
              ),
            ]
          : [],
    })
  }
  return out
}

/**
 * What step 4 offers: every connected source with the objects the profiler has
 * actually landed, in the unit the connector holds.
 *
 * This is the Data Catalogue's profiled state, not the registration — a source
 * can be connected with nothing profiled, and it is listed with `profiled: 0` so
 * the reason it cannot feed a graph is visible rather than inferred from an
 * absence.
 */
function graphSources() {
  const sources = connectedSources().map((source) => {
    const isDrive = source.kind === 'gdrive'
    const drive = isDrive ? findDrive(source.drive_id) : null

    const objects = isDrive
      ? (source.profiled_docs ?? []).map((p) => {
          const meta = findDocument(drive, p.folder_id, p.document_id)
          const folder = findFolder(drive, p.folder_id)
          return {
            object_id: `${p.folder_id}.${p.document_id}`,
            parent_id: p.folder_id,
            label: `${folder?.name ?? p.folder_id} / ${meta?.name ?? p.document_id}`,
            units: p.entities,
            unit_label: 'entities',
          }
        })
      : (source.profiled ?? []).map((p) => ({
          object_id: `${p.dataset_id}.${p.table_id}`,
          parent_id: p.dataset_id,
          label: `${p.dataset_id}.${p.table_id}`,
          units: p.columns,
          unit_label: 'columns',
        }))

    return {
      source_id: source.source_id,
      source_name: source.source_name,
      connector: source.connector,
      kind: source.kind,
      status: source.status,
      type_label: isDrive ? 'Google Drive' : 'BigQuery',
      account: source.project_id ?? source.drive_id ?? '—',
      // "Datasets: a, b" for BigQuery; "Folders: …" for Drive.
      scope_label: isDrive ? 'Folders' : 'Datasets',
      scope: isDrive
        ? (source.folders ?? []).map(
            (id) => findFolder(drive, id)?.name ?? id,
          )
        : (source.datasets ?? []),
      objects,
      object_count: objects.length,
      unit_label: isDrive ? 'documents' : 'tables',
    }
  })

  return {
    sources,
    source_count: sources.length,
    // Sources that could actually contribute — connected is not enough.
    profiled_source_count: sources.filter((s) => s.object_count > 0).length,
  }
}

/* ---------------- Graph Studio ---------------- */

/*
 * A review pass, per built graph.
 *
 * Keyed by use case id, and in memory like a registered source: reviewing is a
 * working session, not something a mock writes back over its seed. `decisions`
 * is keyed `useCaseId:itemId` so two graphs cannot answer each other's rows.
 */
const studioDecisions = new Map()
const studioPivotChoice = new Map()
/*
 * Which version is published, keyed by use case — the **content hash** of one
 * build, not a number. One pointer: publishing sets it, unpublishing clears it, and
 * publishing a different row moves it. The version rows themselves are never
 * touched, which is what makes them immutable.
 */
const studioLive = new Map()

const FLOORS = ['schema-changing', 'causal', 'new entity type']

/**
 * The published version — the one Ask may query, or null.
 *
 * **One pointer, not a chain.** Publishing points here and unpublishing clears it;
 * there is no separate approve or activate step. That is a deliberate narrowing of
 * an earlier three-act model (publish → approve → activate), and the cost is
 * explicit: there is no recorded human sign-off and no rollback to an older
 * version other than publishing it again. What survives is the part that matters
 * for correctness — a gate that refuses to publish unreviewed content, and Ask
 * refusing anything unpublished.
 */
function publishedVersion(useCaseId) {
  const sha = studioLive.get(useCaseId)
  if (!sha) return null
  return (studioVersions.get(useCaseId) ?? []).find((v) => v.sha256 === sha) ?? null
}

/**
 * The label of what is serving, for the pages that print it. Null before anything
 * is published — no version number is invented to fill the tag.
 */
function liveVersion(useCaseId) {
  return publishedVersion(useCaseId)?.config_version ?? null
}

/** A graph is in the studio once it has been built — committed on step 7. */
const builtGraphs = () =>
  db.graph_use_cases.filter((u) => u.status === 'committed')

/*
 * The queue for one graph.
 *
 * db.json carries the four evidence-rich rows and each bucket's total; the rest
 * are synthesised here the way `tableDictionary` synthesises columns — sliced by
 * a hash that includes the **use case id**, so every built graph gets its own
 * queue and repeat requests agree. Confidence is generated inside each bucket's
 * band, because the cards promise "0.85–0.95" and "≥0.95" and a card must not
 * lie about its own filter.
 */
function studioItems(useCaseId, bucket, total, authored = []) {
  const { subjects, predicates } = db.graph_studio.generated
  const items = [...authored]

  for (let i = authored.length; i < total; i += 1) {
    const seed = hash(`${useCaseId}:${bucket}:${i}`)
    const subjectIndex = seed % subjects.length
    // A relationship to itself reads as a bug in the deriver, so the object is
    // nudged along rather than skipped — skipping would return fewer rows than
    // the count on the card promises.
    let objectIndex = (seed >> 7) % subjects.length
    if (objectIndex === subjectIndex) objectIndex = (objectIndex + 1) % subjects.length

    const spread = (seed >> 11) % 100
    const confidence =
      bucket === 'auto_approved'
        ? 0.95 + spread / 2000
        : bucket === 'confirmed'
          ? 0.85 + spread / 1000
          : 0.7 + spread / 700

    const floor = bucket === 'must_review' ? FLOORS[seed % FLOORS.length] : null
    const score = Number(confidence.toFixed(2))
    items.push({
      item_id: `rv-${bucket}-${i}`,
      kind: 'relationship',
      title: `${subjects[subjectIndex]} → ${predicates[(seed >> 3) % predicates.length]} → ${subjects[objectIndex]}`,
      detail:
        `L/S/T match — lexical ${(0.7 + ((seed >> 2) % 30) / 100).toFixed(2)} · ` +
        `structural ${(0.6 + ((seed >> 5) % 35) / 100).toFixed(2)} · ` +
        `evidence: the join holds on ${(80 + ((seed >> 9) % 20)).toFixed(1)}% of sampled rows.`,
      confidence: score,
      /* The triage lane, from the bucket's own confidence band rather than a fourth
         number — a sampled row is in the band its bucket promised. */
      band: score >= 0.95 ? 'High' : score >= 0.85 ? 'Medium' : 'Low',
      floor,
      action_set: 'standard',
      /* Same three choices as an ingested standard row. A sampled row has no
         hand-written labels, so it carries the plain ones. */
      actions: [
        { choice: 'approve', label: 'Approve' },
        { choice: 'correct', label: 'Correct…' },
        { choice: 'reject', label: 'Reject' },
      ],
      /* A sampled row's evidence is its own match scores, already in `detail`.
         Repeating them as bullets would look like a second source. */
      evidence: [],
      graph_refs: [],
      justification: floor === 'schema-changing',
    })
  }
  return items
}

/*
 * Every row leaves here with the same keys, whether it was ingested or synthesised.
 * A row that simply omitted `evidence` would fail the client's schema at the
 * boundary with `evidence should be an array, got undefined`, which reads as a
 * stale server and is not one.
 */
const withDecision = (useCaseId) => (item) => ({
  ...item,
  floor: item.floor ?? null,
  band: item.band ?? null,
  evidence: item.evidence ?? [],
  graph_refs: item.graph_refs ?? [],
  actions: item.actions ?? [
    { choice: 'approve', label: 'Approve' },
    { choice: 'correct', label: 'Correct…' },
    { choice: 'reject', label: 'Reject' },
  ],
  decision: studioDecisions.get(`${useCaseId}:${item.item_id}`) ?? null,
})

/** How far along one graph's review is — the row in the studio's list. */
function studioSummary(useCase) {
  const gen = db.graph_studio.generated
  const outstanding = studioItems(
    useCase.use_case_id,
    'must_review',
    gen.must_review_total,
    db.graph_studio.review_items,
  ).filter((i) => !studioDecisions.get(`${useCase.use_case_id}:${i.item_id}`)).length
  const pivotOpen = !studioPivotChoice.has(useCase.use_case_id)
  const versions = studioVersions.get(useCase.use_case_id) ?? []

  return {
    use_case_id: useCase.use_case_id,
    name: useCase.name,
    domain_id: useCase.domain_id ?? null,
    business_need: useCase.business_need ?? '',
    /*
     * `version` is the **config** version — what a build of this brief would be a
     * version *of*. It moves when the brief is committed again, not when a build
     * runs and not when something is published, which is why several builds share
     * one label and differ by content hash.
     */
    version: configVersion(useCase.use_case_id),
    // What is serving, or null. Never a number invented to fill the tag.
    live_version: liveVersion(useCase.use_case_id),
    // "draft" until one of this graph's versions is published.
    state: publishedVersion(useCase.use_case_id) ? 'published' : 'draft',
    queue_count: outstanding + (pivotOpen ? 1 : 0),
    must_review_outstanding: outstanding,
    must_review_count: gen.must_review_total,
    /* Builds that produced a version — the length of the Versions list, not a
       count of publishes. A graph has many versions and at most one published. */
    version_count: versions.length,
    published_count: publishedVersion(useCase.use_case_id) ? 1 : 0,
    built_at: useCase.updated_at ?? null,
  }
}

/** Everything one graph's studio page reads. */
function graphStudio(useCase) {
  const studio = db.graph_studio
  const gen = studio.generated
  const id = useCase.use_case_id
  const decorate = withDecision(id)

  const mustReview = studioItems(
    id,
    'must_review',
    gen.must_review_total,
    studio.review_items,
  ).map(decorate)
  const confirmed = studioItems(id, 'confirmed', gen.sample_size).map(decorate)
  const autoApproved = studioItems(id, 'auto_approved', gen.sample_size).map(decorate)

  const outstanding = mustReview.filter((i) => !i.decision).length
  const pivotOpen = !studioPivotChoice.has(id)

  /*
   * The pivot is a *separate* precondition from the queue. Clearing every row
   * still leaves publish blocked while it is open, because settling it changes
   * what the rows already decided mean.
   */
  const reasons = []
  if (outstanding > 0) {
    reasons.push(`${outstanding} must-review relationship(s) unresolved`)
  }
  if (pivotOpen) {
    reasons.push(
      `1 pivot decision open (${studio.pivot.pivot_id} / ${studio.pivot.alternative_id})`,
    )
  }

  const decided = mustReview.length - outstanding

  return {
    ...studioSummary(useCase),
    graph_name: useCase.name,
    status: 'draft',
    decision_memory: 'synced',

    must_review: mustReview,
    must_review_count: mustReview.length,
    must_review_outstanding: outstanding,

    // A sample, and named one: these buckets are spot-checked, not listed.
    confirmed_sample: confirmed,
    confirmed_count: gen.confirmed_total,
    auto_approved_sample: autoApproved,
    auto_approved_count: gen.auto_approved_total,

    pivot: { ...studio.pivot, open: pivotOpen, chosen: studioPivotChoice.get(id) ?? null },
    pivot_count: pivotOpen ? 1 : 0,

    /*
     * The questions the Query tab offers as chips — the recorded sanity checks, each
     * naming the hero question it is a check on. A chip is a promise the brief
     * already made, so they are read from the set rather than written on the page;
     * the answers themselves stay behind the request.
     */
    sanity_checks: studio.sanity_checks.map((c) => ({
      check_id: c.check_id,
      hero_question_id: c.hero_question_id,
      question: c.question,
    })),

    batch_resolved: decided + (pivotOpen ? 0 : 1),
    batch_total: gen.must_review_total + 1 + gen.spot_check_quota,

    publish: {
      blocked: reasons.length > 0,
      reasons,
      explanation:
        'The pivot is a separate precondition from the queue — resolving every row still leaves publish blocked while an entity-resolution pivot is open, because a pivot changes what the other decisions mean.',
    },

    /*
     * One row per build that finished — every version this graph has ever had,
     * newest first. The rows are immutable: `published` is a pointer, so
     * publishing a different one flips exactly one boolean here and rewrites
     * nothing.
     */
    versions: (studioVersions.get(id) ?? []).map((v) => ({
      ...v,
      published: v.sha256 === studioLive.get(id),
    })),
  }
}

/**
 * Resolves the `:useCaseId` in a studio path.
 *
 * A draft is refused rather than 404'd: "not built yet" is a different problem
 * from "no such graph", and only one of them is fixed by finishing the wizard.
 */
function findBuiltGraph(useCaseId) {
  const useCase = db.graph_use_cases.find((u) => u.use_case_id === useCaseId)
  if (!useCase) return { error: `no graph ${useCaseId}`, status: 404 }
  if (useCase.status !== 'committed') {
    return {
      error: `${useCase.name} has not been built yet — finish it in New Graph and use "Save & build graph"`,
      status: 400,
    }
  }
  return { useCase }
}

/* ---------------- The canvas ---------------- */

/**
 * The origin classes, in legend order.
 *
 * A node's colour says **where it came from**, not what type it is: a source row
 * becomes an entity or event node, an uploaded document becomes a document node, a
 * raw name resolves through an alias node, and the elements that are not instances
 * at all — the type-level concepts and the measure elements — are the fourth class.
 * That is the knowledge graph's own build model, and it is four categories rather
 * than the nine the type list would need: a categorical palette cannot keep every
 * pair distinguishable past four, and any two nodes can end up adjacent here. The
 * type and the element class are carried in the sublabel and the inspector instead.
 *
 * **`dimension` used to be one of these and is deliberately gone.** The previous
 * graph promoted distinct column values to nodes — 13 waste codes, 9 violation
 * types, 5 enforcement types. The package now records all three under `not_nodes`:
 * a code carried on a row is an attribute of the shipment, not an entity with its
 * own registry. A legend row for it would be a colour with no members and a claim
 * the graph denies.
 */
const CANVAS_GROUPS = ['row', 'schema', 'document', 'alias']

/**
 * The ontology as the canvas draws it.
 *
 * A node or edge carrying a `review_item_id` is **proposed until that item is
 * decided** — which is what makes the canvas and the review queue the same
 * truth rather than two pictures. Approving the Contractor row turns its node
 * from proposed to confirmed; correcting it marks the node studio-authored,
 * because a corrected element is no longer purely what the deriver produced.
 */
function studioCanvas(useCaseId, answerPath = [], answerEdges = null) {
  const decisionFor = (id) =>
    id ? (studioDecisions.get(`${useCaseId}:${id}`) ?? null) : null

  const state = (reviewItemId) => {
    if (!reviewItemId) return { proposed: false, origin: 'derived' }
    const decision = decisionFor(reviewItemId)
    if (!decision) return { proposed: true, origin: 'derived' }
    return {
      proposed: false,
      // A corrected element is the studio's, not the deriver's.
      origin: decision.choice === 'correct' ? 'studio-authored' : 'derived',
      rejected: decision.choice === 'reject',
    }
  }

  const nodes = db.graph_studio.canvas.nodes.map((n) => {
    const s = state(n.review_item_id)
    return {
      node_id: n.node_id,
      label: n.label,
      // A proposed node says so, and says how sure the deriver was.
      sublabel: s.proposed ? `proposed · ${n.confidence.toFixed(2)}` : n.sublabel,
      /* What the node *is*, and where it came from. `group` is the origin class the
         colour encodes — a row, a column value, a document, a resolved alias — and
         `source` is the catalogue object itself, so a node on the canvas can be
         traced back to the table or file it was built from without a second lookup.
         `type` is the ontology's own type, carried separately because "which source"
         and "which kind of thing" are different questions. */
      type: n.type,
      /* Which of the build model's three element classes this is — `thin_instance`,
         `concept` or `measure_element`. The colour folds the last two together, so
         the inspector is where the distinction survives, and it is the distinction
         the whole graph rebuild was about: an instance carries identity only. */
      element_class: n.element_class,
      source: n.source,
      /* Size is data: the number of relationships the node carries. A radius chosen
         for looks would claim an importance the graph does not have. */
      degree: n.degree,
      r: n.r,
      group: n.group,
      confidence: n.confidence,
      proposed: s.proposed,
      origin: s.origin,
      rejected: Boolean(s.rejected),
      needs_review: s.proposed,
      review_item_id: n.review_item_id ?? null,
      on_answer_path: answerPath.includes(n.node_id),
      x: n.x,
      y: n.y,
    }
  })

  const edges = db.graph_studio.canvas.edges.map((e) => {
    const s = state(e.review_item_id)
    return {
      /* The package's own edge id. It is what a recorded sanity check names, so the
         highlight can be the exact hops the answer used rather than every edge that
         happens to run between two nodes on the path. */
      edge_id: e.edge_id,
      from: e.from,
      to: e.to,
      label: s.proposed ? `${e.label} · proposed` : e.label,
      /* The edge's own properties, verbatim from the graph spec — "manifests=46;
         total_tons=1061.8; waste_codes_seen=F005, D035". A relationship with no
         evidence on it is an assertion, and this is the evidence. Layer 1 holds no
         values, so these come from the package's federation cache; the three edge
         kinds it has no values for carry their structural fact instead. */
      detail: e.detail ?? '',
      proposed: s.proposed,
      review_item_id: e.review_item_id ?? null,
      /* An explicit hop list wins where one was given; otherwise both endpoints on
         the path is the best a derived walk can say. */
      on_answer_path: answerEdges
        ? answerEdges.includes(e.edge_id)
        : answerPath.includes(e.from) && answerPath.includes(e.to),
    }
  })

  return {
    nodes,
    edges,
    node_count: nodes.length,
    edge_count: edges.length,
    // The filter chips are counts, so an empty filter is an empty *result*,
    // not a broken chip.
    facets: {
      all: nodes.length,
      low_confidence: nodes.filter((n) => n.confidence < 0.85).length,
      needs_review: nodes.filter((n) => n.needs_review).length,
      studio_authored: nodes.filter((n) => n.origin === 'studio-authored').length,
      /* Per origin class, so the legend can double as the filter: one control for
         "what does this colour mean" and "show me only those" cannot disagree with
         itself the way a legend beside a separate filter list can. */
      groups: CANVAS_GROUPS.map((key) => ({
        key,
        count: nodes.filter((n) => n.group === key).length,
      })),
      /* And per ontology type, which the ring encodes. Counted here for the same
         reason the groups are: the legend's number and the drawing's contents have to
         come from one place. The *order* is the legend's own, so this is a lookup. */
      types: [...new Set(nodes.map((n) => n.type))].map((key) => ({
        key,
        count: nodes.filter((n) => n.type === key).length,
      })),
    },
  }
}

/**
 * The recorded sanity check for a question, or null.
 *
 * `graph_studio.sanity_checks` holds the five the demo package wrote against this
 * dataset — each one a hero question, a verdict, the Cypher the engine would plan,
 * its cost against the budget, and the sub-graph it walks. Matched exactly the way
 * `matchAskAnswer` matches a recorded answer, and for the same reason: a near-miss
 * served as an answer to something else is worse than the walk's honest abstention.
 *
 * The threshold is shared with Ask deliberately. Two matchers over the same
 * tenant's questions that disagreed about what counts as the same question would
 * make the studio's sanity check pass on a question Ask then declines.
 */
function matchSanityCheck(question) {
  const checks = db.graph_studio.sanity_checks ?? []
  const asked = askTokens(question)
  if (checks.length === 0 || asked.length === 0) return null

  const normalise = (s) => askTokens(s).join(' ')
  const exact = checks.find((c) => normalise(c.question) === asked.join(' '))
  if (exact) return { check: exact, how: 'the same question' }

  const scored = checks
    .map((c) => {
      const own = new Set(askTokens(c.question))
      const shared = asked.filter((w) => own.has(w))
      return { check: c, score: shared.length / asked.length, shared }
    })
    .sort((x, y) => y.score - x.score)

  const [best, runnerUp] = scored
  if (best.score < ASK_MATCH_MIN) return null
  // A tie means the question named neither — same reasoning as matchTemplate.
  if (runnerUp && runnerUp.score === best.score) return null
  return {
    check: best.check,
    how: `it matches a recorded check on ${best.shared.slice(0, 4).join(', ')}`,
  }
}

/** The fields only a recorded check has, absent on a derived walk. */
const NO_RECORDED_CHECK = {
  recorded: false,
  check_id: null,
  hero_question_id: null,
  matched_how: null,
  verdict: null,
  verdict_body: null,
  context: [],
  plan: null,
  cost_usd: null,
  budget_usd: null,
}

/**
 * Answering a question against the *draft* graph.
 *
 * Two ways an answer arrives, and the payload always says which:
 *
 *  - **A recorded check.** The package's five, with the verdict and the Cypher plan
 *    the engine would run. `recorded` is true and `check_id` names it, so a written
 *    verdict is never read as something the walk derived — the same rule Ask keeps
 *    for `ask_answers`.
 *  - **The walk.** No engine here, so the answer is derived the way a reader would
 *    expect: the entities named in the question are matched to nodes and the path
 *    between them is walked over the edges that actually exist. A question whose
 *    entities are not both in the graph is **not answerable**, and says which one is
 *    missing — that is the sanity check, and a mock that always answers is worth
 *    nothing.
 *
 * Both routes report `caveats` the same way, computed from the edges the answer
 * actually used. A recorded check is not exempt: sc1 rides the Chemours
 * `DESCRIBED_BY` edge, which rq2 has open, so it is answerable *and* provisional —
 * and it says so rather than reading as settled because somebody wrote it down.
 */
function studioQuery(useCaseId, question) {
  const canvas = studioCanvas(useCaseId)
  const asked = String(question).toLowerCase()

  const label = (id) => canvas.nodes.find((n) => n.node_id === id)?.label ?? id
  /* The canvas appends " · proposed" to a provisional edge's label for the drawing.
     A sentence about that edge wants the relationship's name, not the annotation it
     is already making. */
  const edgeType = (e) => e.label.replace(/ · proposed$/, '')
  /*
   * An answer that leans on an undecided edge is answerable *and* provisional.
   * Saying so is the point — publishing would change the answer.
   */
  const caveatsFor = (edges) =>
    edges
      .filter((e) => e.proposed)
      .map((e) => `${label(e.from)} → ${edgeType(e)} → ${label(e.to)} is still under review`)
  /* Each hop carries its endpoints' labels, because a hop is rendered as a sentence
     and the page should not have to re-join it against the node list to do that. */
  const asHop = (e) => ({
    edge_id: e.edge_id,
    from: e.from,
    to: e.to,
    label: edgeType(e),
    from_label: label(e.from),
    to_label: label(e.to),
    proposed: e.proposed,
  })

  const recorded = matchSanityCheck(question)
  if (recorded) {
    const { check, how } = recorded
    const hops = check.edges_used
      .map((id) => canvas.edges.find((e) => e.edge_id === id))
      .filter(Boolean)
    return {
      question,
      answerable: true,
      reason: `${check.verdict} Walked ${hops.length} relationship(s) that exist in the draft.`,
      matched: check.path.map(label),
      path: check.path,
      /*
       * Deliberately empty. `path_labels` is a *chain* — what the walk below returns
       * from a breadth-first search, where each node genuinely leads to the next. A
       * recorded traversal is a sub-graph: sc3 walks three generators and three
       * enforcement actions that all meet at the receiving TSDF, and printing those
       * seven ids joined by arrows would claim a route nobody walked. The hops are in
       * `edges_used`, each one a relationship that exists, and the page renders those.
       */
      path_labels: [],
      edges_used: hops.map(asHop),
      hops: hops.length,
      caveats: caveatsFor(hops),
      recorded: true,
      check_id: check.check_id,
      hero_question_id: check.hero_question_id,
      matched_how: how,
      verdict: check.verdict,
      verdict_body: check.verdict_body,
      context: check.context,
      plan: check.plan,
      cost_usd: check.cost_usd,
      budget_usd: check.budget_usd,
    }
  }

  /*
   * Matched on the whole label, or on a word distinctive enough to name a node.
   *
   * Two things a bare shared word does wrong, and both produce a confident answer to
   * a question nobody asked — worse here than no answer:
   *
   *  - It is a *kind*, not a name. "which facility do we accept waste from" holds
   *    "facility" and "waste", and those words name the types Facility and
   *    WasteCode, so no instance may claim them. The stoplist is read off the
   *    graph's own `type` and edge-label vocabulary rather than hand-written, so
   *    a new node type stops its own word without anyone remembering to.
   *  - It is common. "texas" is in five labels here, so it names none of them.
   *
   * What is left is rarity, not uniqueness: the old rule was "appears in exactly one
   * label", and it broke the moment a facility and the consent decree about it
   * shared a name — the bridge from unstructured to structured that this graph
   * exists for. A word naming at most 5% of the nodes is taken as naming them
   * deliberately, which is what lets "chemours" pull in the facility and both of its
   * documents.
   */
  /* Four characters and up. "the" is rare across these labels — it appears in one —
     so a three-letter cut let "which facility ships the most waste" match The
     Chemours Company Fayetteville Works on the article. The shortest thing anyone
     names here is a waste code (D001), which is four. */
  const wordsOf = (label) =>
    label.toLowerCase().split(/[^a-z0-9#]+/).filter((w) => w.length > 3)

  const kindWords = new Set()
  for (const text of [
    ...canvas.nodes.map((n) => n.type),
    ...canvas.edges.map((e) => e.label),
  ]) {
    // Facility · WasteCode · SHIPS_TO → facility, waste, code, ships
    for (const w of String(text).split(/(?=[A-Z])|[^A-Za-z0-9]+/)) {
      if (w.length > 2) kindWords.add(w.toLowerCase())
    }
  }

  const seenIn = new Map()
  for (const n of canvas.nodes) {
    for (const w of new Set(wordsOf(n.label))) {
      seenIn.set(w, (seenIn.get(w) ?? 0) + 1)
    }
  }
  const rareMax = Math.max(1, Math.round(canvas.nodes.length * 0.05))

  /*
   * A concept node can never name an instance, because a concept *is* the type.
   *
   * The rebuild put the seven type-level nodes on the canvas, labelled exactly
   * "Facility", "Manifest", "Document" — and the whole-label shortcut below happily
   * matched them, so "tell me about the Denka facility" resolved to CONCEPT:Facility
   * and reported that Facility and Denka have nothing between them. The stoplist
   * already refused the *word* "facility"; what it could not refuse was a node whose
   * whole label is that word. Same rule, one level up: a type cannot be an instance,
   * whether it is spelled as a word inside a name or is the entire name.
   */
  const instances = canvas.nodes.filter((n) => n.element_class !== 'concept')

  const matched = instances.filter((n) => {
    const own = n.label.toLowerCase()
    /* The whole-label match still has to clear the stoplist. It is the shortcut for a
       multi-word name like "The Chemours Company Fayetteville Works", not a way past
       the rule that a kind word names no instance. */
    if (asked.includes(own) && !kindWords.has(own)) return true
    return wordsOf(n.label).some(
      (w) => !kindWords.has(w) && seenIn.get(w) <= rareMax && asked.includes(w),
    )
  })

  if (matched.length < 2) {
    return {
      question,
      answerable: false,
      reason:
        matched.length === 0
          ? 'No entity in this graph is named in the question.'
          : `Only ${matched[0].label} is named — a question needs two things to relate.`,
      matched: matched.map((n) => n.label),
      path: [],
      path_labels: [],
      edges_used: [],
      hops: 0,
      caveats: [],
      ...NO_RECORDED_CHECK,
    }
  }

  // Breadth-first between the first two matches, over the edges that exist.
  const [start, goal] = matched
  const neighbours = new Map()
  for (const e of canvas.edges) {
    if (!neighbours.has(e.from)) neighbours.set(e.from, [])
    if (!neighbours.has(e.to)) neighbours.set(e.to, [])
    neighbours.get(e.from).push({ to: e.to, edge: e })
    neighbours.get(e.to).push({ to: e.from, edge: e })
  }

  const queue = [[start.node_id]]
  const seen = new Set([start.node_id])
  let path = null
  while (queue.length > 0 && !path) {
    const here = queue.shift()
    const last = here[here.length - 1]
    if (last === goal.node_id) {
      path = here
      break
    }
    for (const step of neighbours.get(last) ?? []) {
      if (seen.has(step.to)) continue
      seen.add(step.to)
      queue.push([...here, step.to])
    }
  }

  if (!path) {
    return {
      question,
      answerable: false,
      reason: `${start.label} and ${goal.label} are both in the graph, but nothing connects them yet.`,
      matched: matched.map((n) => n.label),
      path: [],
      path_labels: [],
      edges_used: [],
      hops: 0,
      caveats: [],
      ...NO_RECORDED_CHECK,
    }
  }

  const edgesUsed = []
  for (let i = 0; i < path.length - 1; i += 1) {
    const edge = canvas.edges.find(
      (e) =>
        (e.from === path[i] && e.to === path[i + 1]) ||
        (e.to === path[i] && e.from === path[i + 1]),
    )
    if (edge) edgesUsed.push(edge)
  }

  return {
    question,
    answerable: true,
    reason: `Answered over ${edgesUsed.length} relationship(s) that exist in the draft.`,
    matched: matched.map((n) => n.label),
    path,
    path_labels: path.map(label),
    edges_used: edgesUsed.map(asHop),
    hops: edgesUsed.length,
    caveats: caveatsFor(edgesUsed),
    ...NO_RECORDED_CHECK,
  }
}

/* ---------------- Ask ---------------- */

/*
 * Ask queries a graph that is **live**, and that is the whole difference between
 * this and the studio's sanity check. The studio asks the *draft* to find out
 * whether it is finished; Ask asks the published version because that is what
 * the business is running on. A graph nobody has published is therefore not
 * askable — and "no graph is live" is a different sentence from "no graph
 * exists", because only one of them is fixed by pressing Publish.
 *
 * One walk serves both (`studioQuery`), so a sanity check that passed before
 * publishing cannot disagree with the answer after it.
 */

/**
 * How long an answer is held.
 *
 * Longer than SUGGEST_MS on purpose: this is a supervisor agent grounding a
 * question, routing it and composing a reply, and a query engine that answers
 * before the button finishes its click teaches that asking is free. Errors are
 * never paced — a refusal is not work.
 */
/*
 * The answer's own pacing. `ANSWER_MS` is gone as a single hold: an answer that
 * arrives in pieces is spaced *between* the pieces instead, so a five-block answer
 * takes longer than a one-line abstention — which is the honest shape, and what
 * makes it read as composed rather than fetched.
 *
 * Tuned so a typical answer (2 stages, 4 blocks) lands in about 3 seconds: long
 * enough to watch, short enough that nobody wonders whether it hung.
 */
const ASK_STAGE_MS = 420
const ASK_BLOCK_MS = 380

/** What a decision on a gap means for anyone asking the graph afterwards. */
const GAP_CAVEAT = {
  'accept permanent': 'unavailable — no connected source covers it',
  'drop question': 'out of scope for this graph',
  'connect source': 'unavailable until the promised source is connected',
  'defer with trigger': 'deferred — unavailable until its trigger fires',
}

/**
 * What a live graph has already admitted it cannot answer.
 *
 * Not invented here: these are step 7's gap decisions read back, matched to the
 * hero question they were taken against. A gap accepted permanently is a
 * standing caveat for every question asked of this graph, so the page prints it
 * before the first question rather than letting it surface as an abstention
 * nobody expected.
 */
function askCaveats(useCase) {
  const questions = normalizeQuestions(useCase.hero_questions)

  return normalizeGapDecisions(useCase.gap_decisions)
    .filter((g) => g.element_id.startsWith('gap:') && GAP_CAVEAT[g.decision])
    .map((g) => {
      // The id graphCoverage minted, recomputed rather than stored twice.
      const slug = g.element_id.slice('gap:'.length)
      const q = questions.find((h) => slugify(h.text).slice(0, 48) === slug)
      return `${q ? q.text : slug} — ${GAP_CAVEAT[g.decision]}`
    })
}

/**
 * One row in Ask's graph picker, or null for a graph that is not live.
 *
 * Everything here is a fact the brief or the publish already recorded — the
 * version that serves, who put it there, what the use case promised about
 * citations, and the hero questions it was built to answer. The suggestion
 * chips are those questions: a chip is a promise the brief already made, not a
 * prompt someone thought sounded good.
 */
function askableGraph(useCase) {
  /* The published version *is* the precondition: Ask has nothing to query until a
     specific build has been published, and unpublishing takes it away again. */
  const published = publishedVersion(useCase.use_case_id)
  if (!published) return null

  const canvas = studioCanvas(useCase.use_case_id)

  return {
    use_case_id: useCase.use_case_id,
    name: useCase.name,
    domain_id: useCase.domain_id ?? null,
    // The published version, never a draft — Ask cannot query one.
    version: published.config_version,
    /* When that build finished, and the content it is. Ask prints both, because
       "which graph answered this" is a question a reader is entitled to ask. */
    published_at: published.created_at,
    published_by: db.google_account.email,
    graph_id: published.graph_id,
    sha256: published.sha256,
    // Step 6 decided this, so the engine never picks at runtime.
    citations: useCase.citations === 'optional' ? 'optional' : 'required',
    caveats: askCaveats(useCase),
    suggested_questions: normalizeQuestions(useCase.hero_questions).map((q) => q.text),
    entity_count: canvas.node_count,
    relationship_count: canvas.edge_count,
  }
}

/**
 * Answering one question against the live graph.
 *
 * There is no model here, so nothing is asserted that the graph does not carry:
 * the entities are the ones the question named, the route is walked over edges
 * that exist, and **confidence is the weakest node on that route** rather than a
 * flourish. When the walk fails, the answer is an abstention that says why —
 * which is the honest outcome, and the one the page promises.
 */
/** Words that carry no signal when matching one question against another. */
const ASK_STOPWORDS = new Set(
  ('a an and are as at by did do does for from has have how in into is it its me my of on or our ' +
    'show shows tell that the their them then there these this to us was we what when where which ' +
    'who why will with you your every each are'
  ).split(' '),
)

const askTokens = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ASK_STOPWORDS.has(w))

/**
 * The recorded answer for a question, or null.
 *
 * `ask_answers` holds 40 answers the tenant wrote — 13 tied to hero questions, 22
 * standard, 5 declines. A typed question is matched against them: the same
 * question wins outright, otherwise the one sharing the most of the asked words,
 * and **only if it shares enough of them and beats the runner-up**. A near-miss
 * must not be served as an answer to something else: the graph walk below abstains
 * honestly, and that is the better outcome than confidently answering a question
 * nobody asked.
 */
function matchAskAnswer(question) {
  const answers = db.ask_answers ?? []
  if (answers.length === 0) return null

  const asked = askTokens(question)
  if (asked.length === 0) return null

  const normalise = (s) => askTokens(s).join(' ')
  const exact = answers.find((a) => normalise(a.question) === asked.join(' '))
  if (exact) return { answer: exact, how: 'the same question' }

  const scored = answers
    .map((a) => {
      const own = new Set(askTokens(a.question))
      const shared = asked.filter((w) => own.has(w))
      // Over the asked words, not the recorded ones: a long recorded question
      // should not be penalised for saying more than was asked.
      return { answer: a, score: shared.length / asked.length, shared }
    })
    .sort((x, y) => y.score - x.score)

  const [best, runnerUp] = scored
  if (best.score < ASK_MATCH_MIN) return null
  // A tie means the question named neither — same reasoning as matchTemplate.
  if (runnerUp && runnerUp.score === best.score) return null
  return {
    answer: best.answer,
    how: `it matches a recorded question on ${best.shared.slice(0, 4).join(', ')}`,
  }
}

/** How much of the asked question a recorded one must cover to be served. */
const ASK_MATCH_MIN = 0.6

function askAnswer(useCase, question) {
  const id = useCase.use_case_id
  const graph = askableGraph(useCase)
  const walk = studioQuery(id, question)
  const canvas = studioCanvas(id)
  const picks = normalizeSourcePicks(useCase.sources)

  const routed = picks.length
    ? `${picks.length} source pick(s) behind this graph: ${picks.map((p) => p.source_id).join(', ')}.`
    : 'No source picks are recorded on this brief.'

  const grounding = {
    step: 'Grounded the question in the graph',
    detail:
      walk.matched.length > 0
        ? `Matched ${walk.matched.length} entity(ies) in ${useCase.name} ${graph.version}: ${walk.matched.join(', ')}.`
        : `Nothing in ${useCase.name} ${graph.version} is named in the question.`,
  }

  const base = {
    question,
    use_case_id: id,
    graph_name: useCase.name,
    version: graph.version,
    entities: walk.matched,
    hops: walk.hops,
    caveats: [...graph.caveats, ...walk.caveats],
    asked_at: new Date().toISOString(),
  }

  /*
   * A recorded answer wins, and says so.
   *
   * These are the tenant's own 40 answers, written against this dataset, with
   * blocks, evidence and a stated confidence. The graph walk cannot produce a
   * chart or a table, so where a question is recognised the recorded answer is
   * the better one — but the *provenance* is reported rather than blurred: a
   * reasoning step names the answer id and how it matched, so nobody reads a
   * written answer as something the walk derived.
   */
  const recorded = matchAskAnswer(question)
  if (recorded) {
    const { answer: a, how } = recorded
    const reasoning = [
      grounding,
      {
        step: 'Answered from the recorded query set',
        detail: `${a.answer_id} (${a.kind}${a.hero_ref ? `, ${a.hero_ref}` : ''}) — ${how}.`,
      },
    ]
    /* Evidence rows carry no per-row score: the query set states one confidence
       for the whole answer, and a number per row would be invented. */
    const citations = (a.evidence ?? [])
      .filter((e) => e.source && e.source !== '—')
      .map((e) => ({ label: e.source, detail: e.detail, confidence: null }))

    if (a.kind === 'decline') {
      /*
       * A decline is an abstention, so it obeys the same rule as the walk's:
       * `answered: false` and **no confidence**. The query set scores its own
       * declines 0.99 — that is certainty that it *cannot* answer, which is not
       * the confidence field, and reporting it there would read as a 0.99 answer.
       */
      return {
        ...base,
        answered: false,
        reason: a.summary,
        answer: null,
        confidence: null,
        path: [],
        reasoning: [...reasoning, { step: 'Declined', detail: a.summary }],
        citations,
        summary: a.summary,
        blocks: a.blocks,
        answer_id: a.answer_id,
      }
    }

    return {
      ...base,
      answered: true,
      reason: `Answered from ${a.answer_id} — ${a.persona}'s question, recorded against ${graph.version}.`,
      answer: a.summary,
      confidence: a.confidence,
      path: walk.answerable ? walk.path_labels : [],
      reasoning,
      citations,
      summary: a.summary,
      blocks: a.blocks,
      answer_id: a.answer_id,
    }
  }

  if (!walk.answerable) {
    /*
     * Abstaining *is* the answer. A query engine that always produces a
     * paragraph is a search box with better manners, so the reason ships in the
     * same field an answer would have used and confidence stays null — there is
     * no number to report, and inventing one is the failure this guards.
     */
    return {
      ...base,
      answered: false,
      reason: walk.reason,
      answer: null,
      confidence: null,
      path: [],
      reasoning: [grounding, { step: 'Abstained', detail: walk.reason }],
      citations: [],
      // One shape either way: a walk produces prose, not blocks, and the client
      // renders whichever it is given rather than branching on presence.
      summary: null,
      blocks: [],
      answer_id: null,
    }
  }

  const labels = walk.path_labels
  const nodeOf = (nodeId) => canvas.nodes.find((n) => n.node_id === nodeId)
  const confidenceOf = (nodeId) => nodeOf(nodeId)?.confidence ?? 1
  // The weakest link, because a chain is no surer than that.
  const confidence = Number(Math.min(...walk.path.map(confidenceOf)).toFixed(2))

  const labelFor = (nodeId) => nodeOf(nodeId)?.label ?? nodeId
  const citations = walk.edges_used.map((e) => ({
    label: `${labelFor(e.from)} → ${e.label} → ${labelFor(e.to)}`,
    detail: `relationship in ${graph.version}, settled in review before publish`,
    confidence: Number(Math.min(confidenceOf(e.from), confidenceOf(e.to)).toFixed(2)),
  }))

  /*
   * A profiled object is cited only where it actually backs an entity on the
   * route. Most sessions have nothing registered, and a citation naming a table
   * this answer never touched is worse than a shorter list.
   */
  for (const o of selectedProfiledObjects(useCase.sources)) {
    if (!labels.includes(entityName(o.label))) continue
    citations.push({
      label: `${o.label} (${o.size})`,
      detail: `${o.sourceName} · ${o.evidenceKind}`,
      confidence: matchScore(`${o.sourceName}:${o.objectId}`),
    })
  }

  return {
    ...base,
    answered: true,
    // Not the walk's own wording: it says "in the draft", and Ask never asks a
    // draft. Same walk, different thing being asked.
    reason: `Answered over ${walk.hops} relationship(s) that exist in ${graph.version}.`,
    answer:
      `${labels[0]} connects to ${labels[labels.length - 1]} over ${walk.hops} ` +
      `relationship(s) in ${useCase.name} ${graph.version}: ${labels.join(' → ')}.`,
    confidence,
    path: labels,
    reasoning: [
      grounding,
      {
        step: 'Planned the route',
        detail: `Walked ${walk.hops} relationship(s) that exist in ${graph.version}: ${labels.join(' → ')}.`,
      },
      { step: 'Routed to source systems', detail: routed },
      {
        step: 'Composed the answer',
        detail:
          `Confidence ${confidence.toFixed(2)} — the weakest entity on the route. ` +
          `${citations.length} citation(s); citations are ${graph.citations} for this use case.`,
      },
    ],
    citations,
    summary: null,
    blocks: [],
    answer_id: null,
  }
}

/** A saved use case, with the defaults a hand-edited db.json might omit. */
const savedUseCase = (u) => ({
  use_case_id: u.use_case_id,
  name: u.name,
  status: u.status === 'committed' ? 'committed' : 'draft',
  domain_id: u.domain_id ?? null,
  business_need: u.business_need ?? '',
  personas: normalizeDrafted(u.personas),
  kpis: normalizeDrafted(u.kpis),
  sources: normalizeSourcePicks(u.sources),
  hero_questions: normalizeQuestions(u.hero_questions),
  citations: u.citations === 'optional' ? 'optional' : 'required',
  answer_formats: normalizeFormats(u.answer_formats),
  gap_decisions: normalizeGapDecisions(u.gap_decisions),
  step: u.step ?? 1,
  step_total: WIZARD_STEPS.length,
  updated_at: u.updated_at ?? null,
})

/**
 * The suggester behind "Suggest personas (LLM)" and "Suggest KPIs (LLM)".
 *
 * There is no model here, so the draft is derived the way a reader would expect
 * one to be: entries whose keywords appear in the business need rank first, then
 * those that belong to the chosen domain, then a stable hash so the same brief
 * always produces the same list. A suggestion nobody can explain is worse than
 * no suggestion.
 *
 * One implementation for both pools — they differ only in which field carries
 * the description (`focus` for a persona, `definition` for a KPI).
 */
function suggestFrom(pool, idKey, domainId, businessNeed, limit = 4) {
  const need = String(businessNeed ?? '').toLowerCase()

  const scored = pool.map((p) => {
    const hits = (p.keywords ?? []).filter((k) => need.includes(k)).length
    const domains = p.domains ?? []
    // An empty `domains` means the persona fits any domain.
    const domainFit = domains.length === 0 ? 1 : domains.includes(domainId) ? 2 : 0
    return {
      entry: p,
      hits,
      domainFit,
      // Tie-break that depends on the brief, so two use cases do not always get
      // the same four names in the same order.
      jitter: hash(`${need}:${p[idKey]}`) % 100,
    }
  })

  return scored
    // A persona from another domain with nothing in common is noise, not a draft.
    .filter((s) => s.domainFit > 0 || s.hits > 0)
    .sort(
      (a, b) =>
        b.hits - a.hits || b.domainFit - a.domainFit || b.jitter - a.jitter,
    )
    .slice(0, limit)
    .map((s) =>
      asSuggestion(s.entry, idKey, {
        // What the UI shows as the reason it was drafted.
        why:
          s.hits > 0
            ? `matches your brief on ${(s.entry.keywords ?? [])
                .filter((k) => need.includes(k))
                .slice(0, 3)
                .join(', ')}`
            : 'typical for this domain',
      }),
    )
}

/**
 * One pool entry as the row the wizard renders. Shared by the keyword ranking
 * and the template bundle so a drafted suggestion cannot read differently
 * depending on which path produced it.
 */
function asSuggestion(entry, idKey, { why }) {
  return {
    id: entry[idKey],
    // A hero question *is* its text, so that stands in for the name.
    name: entry.name ?? entry.text ?? '',
    /*
     * A persona carries `focus`, a KPI carries `definition`, and a hero question
     * carries the `rationale` the brief gave for asking it — the slot was empty
     * for questions before, which is why they arrived with a name and nothing
     * else. `detail` is what the thing is *for*; `why` below stays what it has
     * always been, the reason this suggester drafted it. They answer different
     * questions and neither may stand in for the other.
     */
    detail: entry.focus ?? entry.definition ?? entry.rationale ?? entry.format ?? '',
    /*
     * Only hero questions carry one, and it pre-ticks the High box rather than
     * deciding it: the question's own priority is what the use case stated, and
     * the user is still the one who accepts it.
     */
    ...(entry.priority ? { priority: entry.priority } : {}),
    why,
  }
}

/*
 * A brief can *name* a use case rather than describe a new one — pasting in a
 * template's description is the ordinary way this happens. Where it does, the
 * honest draft is that use case's own list, whole and in its own order, because
 * a template is a stated answer rather than a ranking: truncating it to the
 * keyword limit would drop members the use case explicitly claims.
 *
 * `match_phrases` are drawn from each template's description, so that paste
 * hits all of them. A tie is deliberately *not* a match — two templates scoring
 * equally means the brief named neither, and keyword ranking is the better
 * answer than a coin flip.
 */
const TEMPLATE_MIN_PHRASES = 2

function matchTemplate(businessNeed) {
  const need = String(businessNeed ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
  if (!need) return null

  const scored = db.graph_use_case_templates
    .map((template) => ({
      template,
      hits: template.match_phrases.filter((phrase) => need.includes(phrase)).length,
    }))
    .sort((a, b) => b.hits - a.hits)

  const [best, runnerUp] = scored
  if (!best || best.hits < TEMPLATE_MIN_PHRASES) return null
  if (runnerUp && runnerUp.hits === best.hits) return null
  return best.template
}

/** A template's own member list, resolved against the pool it holds ids for. */
function bundleFrom(template, pool, idKey, memberKey) {
  return template[memberKey]
    .map((id) => pool.find((entry) => entry[idKey] === id))
    // validateDb refuses to boot on an unresolvable id, so this cannot drop a
    // member silently — it is here so a hand-edited /db save degrades rather
    // than throwing mid-request.
    .filter(Boolean)
    .map((entry) =>
      asSuggestion(entry, idKey, { why: `named in the ${template.name} use case` }),
    )
}

/** Datasets a source may profile, with the tables inside each. */
function browsableObjects(source) {
  const project = findProject(source.project_id)
  const datasets = (source.datasets ?? []).map((datasetId) => {
    const dataset = project?.datasets.find((d) => d.dataset_id === datasetId)
    const tables = (dataset?.tables ?? []).map((t) => ({
      table_id: t.table_id,
      label: t.label,
      type: t.type,
      grain: t.grain,
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
      doc_type_label: d.doc_type_label,
      linked_entity: d.linked_entity,
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

  /*
   * Identity. This is a persona demo, not a user directory: there is no account
   * store to check a password against, so login authenticates by *shape* —
   * a well-formed email, a password of a plausible length, a role that exists —
   * exactly as the BigQuery/Drive consent screens prove a request is well-formed
   * rather than that a real Google account sits behind it. Nothing here should
   * be mistaken for real authentication.
   */
  {
    method: 'GET',
    match: (p) => p === '/auth/roles',
    handle: (_req, res) =>
      send(res, 200, {
        roles: db.auth_roles.map((r) => ({
          role_id: r.role_id,
          label: r.label,
          access_note: r.access_note ?? '',
        })),
        count: db.auth_roles.length,
      }),
  },

  {
    method: 'POST',
    match: (p) => p === '/auth/login',
    handle: async (req, res) => {
      const { email, password, role_id } = await readJson(req)

      if (!email || !EMAIL_RE.test(String(email))) {
        return send(res, 400, { error: 'Enter a valid email address.' })
      }
      if (!password || String(password).length < 6) {
        return send(res, 400, { error: 'Password must be at least 6 characters.' })
      }
      if (!role_id) {
        return send(res, 400, { error: 'Pick a role before signing in.' })
      }
      const role = db.auth_roles.find((r) => r.role_id === role_id)
      if (!role) {
        return send(res, 400, { error: `unknown role ${role_id}` })
      }

      send(res, 200, {
        email,
        role_id: role.role_id,
        role_label: role.label,
        access_note: role.access_note ?? '',
        initials: emailInitials(email),
        signed_in_at: new Date().toISOString(),
      })
    },
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
      // Paced like the suggesters: a consent handshake that completes in 2ms
      // gives the wizard nowhere to show that anything was asked of Google, and
      // teaches that signing in is instant. See CONSENT_MS.
      setTimeout(() => {
        send(res, 200, {
          state,
          provider,
          auth_url: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&scope=${scopes.join(' ')}`,
          scopes,
        })
      }, CONSENT_START_MS).unref?.()
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

      /*
       * Who signed in comes from the caller, because that is the only place it
       * exists. The console's identity is client-held (`useAuthStore`, see
       * CLAUDE.md § Identity) — there is no server-side session to look it up
       * from — so the wizard sends the signed-in email as `as` and this echoes
       * it back as the connecting account. Without it the consent answered with
       * `db.google_account` for everyone, so the wizard told every user they had
       * connected as one seeded person.
       *
       * `db.google_account` stays the fallback for a caller that names nobody
       * (a curl, the API docs), and a malformed `as` is refused rather than
       * quietly falling back to that seed — silently connecting as someone else
       * is the bug this parameter exists to fix.
       */
      const as = query.get('as')
      if (as !== null && !EMAIL_RE.test(as)) {
        return send(res, 400, {
          error: `"${as}" is not a valid email address — sign in again and retry the connection.`,
        })
      }
      const account = as
        ? { email: as, name: displayNameFromEmail(as), picture: null }
        : db.google_account

      /*
       * The consent ends here, and *only* the consent: it returns who signed in
       * plus a session, and what that account can see is a separate call. Two
       * reasons. It is what a real handshake does — a code is exchanged for a
       * token, then the token is spent listing resources — and it gives the
       * wizard a third stage backed by a real request, instead of a row that
       * ticks the instant the one before it does.
       */
      const session = `session-${nextId()}`
      oauthSessions.set(session, provider)

      /*
       * Held for the same reason the suggesters are: this stands in for a real
       * consent screen, and the wizard shows a stage per call. Only the success
       * path is paced — a rejected or replayed state answers immediately,
       * because making an error wait teaches nothing and reads as a hang.
       */
      setTimeout(
        () => send(res, 200, { account, session, provider }),
        CONSENT_MS,
      ).unref?.()
    },
  },

  /*
   * What the consenting account can see. One endpoint per connector rather than
   * a branch, so each can refuse the other's session by name — answering a Drive
   * session with an empty project list would read as "this account has no
   * projects" and send you debugging the credentials instead of the call.
   */
  {
    method: 'GET',
    match: (p) => p === '/sources/oauth/projects',
    handle: (_req, res, { query }) => {
      const session = query.get('session')
      if (!session || !oauthSessions.has(session)) {
        return send(res, 400, {
          error: 'invalid or expired session — start the Google sign-in again',
        })
      }
      if (oauthSessions.get(session) !== 'bigquery') {
        return send(res, 400, {
          error:
            'this session was granted for Drive — read its drives with /sources/oauth/drives',
        })
      }

      // One handle per project the consenting account can read.
      const projects = db.projects.map((p) => {
        const cred = db.credentials.find((c) => c.project_id === p.project_id)
        return {
          project_id: p.project_id,
          display_name: p.display_name,
          location: p.location,
          dataset_count: p.datasets.length,
          credential_handle: cred?.credential_handle ?? null,
        }
      })

      setTimeout(
        () => send(res, 200, { projects, project_count: projects.length }),
        DISCOVERY_MS,
      ).unref?.()
    },
  },

  {
    method: 'GET',
    match: (p) => p === '/sources/oauth/drives',
    handle: (_req, res, { query }) => {
      const session = query.get('session')
      if (!session || !oauthSessions.has(session)) {
        return send(res, 400, {
          error: 'invalid or expired session — start the Google sign-in again',
        })
      }
      if (oauthSessions.get(session) !== 'drive') {
        return send(res, 400, {
          error:
            'this session was granted for BigQuery — read its projects with /sources/oauth/projects',
        })
      }

      // One handle per drive the consenting account can read.
      const drives = db.drives.map((d) => {
        const cred = db.drive_credentials.find((c) => c.drive_id === d.drive_id)
        return {
          drive_id: d.drive_id,
          display_name: d.display_name,
          kind: d.kind,
          folder_count: d.folders.length,
          document_count: d.folders.reduce((s, f) => s + f.documents.length, 0),
          credential_handle: cred?.credential_handle ?? null,
        }
      })

      setTimeout(
        () => send(res, 200, { drives, drive_count: drives.length }),
        DISCOVERY_MS,
      ).unref?.()
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
      const nameProblem = sourceNameProblem(source_name)
      if (nameProblem) return send(res, 400, { error: nameProblem })
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
        // Required and validated above; the drive's own display name is no
        // longer a silent fallback, for the reason SOURCE_NAME_MIN gives.
        source_name: String(source_name).trim(),
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
      const nameProblem = sourceNameProblem(source_name)
      if (nameProblem) return send(res, 400, { error: nameProblem })
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
        // Required and validated above — no id fallback, because a row named
        // after its project id reads as a name and is not one.
        source_name: String(source_name).trim(),
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
      /*
       * The class facets are the classes this data actually has. The real
       * profile uses eight (`identifier date dimension entity address geo flag
       * measure`) and none of them is `text`, so a Text chip would have sat at 0
       * for all 206 columns — which reads as "no text columns here" rather than
       * as a chip nothing can fill. `location` folds `address` and `geo`
       * together: both answer "where", and 69 of the 206 are one or the other.
       */
      const facets = {
        all: 0,
        needs_review: 0,
        pii: 0,
        ids: 0,
        measures: 0,
        dates: 0,
        location: 0,
        flags: 0,
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
          if (c.class === 'address' || c.class === 'geo') facets.location += 1
          if (c.class === 'flag') facets.flags += 1
        }

        if (!byDataset.has(entry.dataset_id)) {
          byDataset.set(entry.dataset_id, { dataset_id: entry.dataset_id, tables: [] })
        }
        byDataset.get(entry.dataset_id).tables.push({
          table_id: entry.table_id,
          label: meta?.label ?? entry.table_id,
          type: meta?.type ?? 'TABLE',
          grain: meta?.grain ?? '',
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
      /*
       * The type facets are the document kinds this corpus actually holds —
       * federal RCRA enforcement papers. A consent-decree *modification* files
       * under `consent_decree` because that is what it is; what makes it a
       * modification is `doc_type_label`, which is what the reader sees.
       */
      const facets = {
        all: 0,
        needs_review: 0,
        pii: 0,
        consent_decrees: 0,
        complaints: 0,
        settlements: 0,
        cafos: 0,
      }
      const FACET_FOR_TYPE = {
        consent_decree: 'consent_decrees',
        complaint: 'complaints',
        settlement: 'settlements',
        cafo: 'cafos',
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

  // Steps 2 and 3. POSTs because the draft depends on the brief, not just the
  // domain. Same payload shape either way, so the UI reads one contract.
  ...[
    {
      path: '/graph-personas/suggest',
      pool: 'graph_personas',
      idKey: 'persona_id',
      memberKey: 'personas',
    },
    { path: '/graph-kpis/suggest', pool: 'graph_kpis', idKey: 'kpi_id', memberKey: 'kpis' },
    {
      path: '/graph-questions/suggest',
      pool: 'graph_hero_questions',
      idKey: 'question_id',
      memberKey: 'hero_questions',
    },
    // No `memberKey`: a use case states its personas, KPIs and questions, but
    // never its render formats — step 6 picks those, so they stay ranked.
    {
      path: '/graph-answer-formats/suggest',
      pool: 'graph_answer_formats',
      idKey: 'format_id',
    },
  ].map(({ path, pool, idKey, memberKey }) => ({
    method: 'POST',
    match: (p) => p === path,
    handle: async (req, res) => {
      const { domain_id, business_need } = await readJson(req)
      if (domain_id && !db.graph_domains.some((d) => d.domain_id === domain_id)) {
        return send(res, 400, { error: `unknown domain ${domain_id}` })
      }
      // A brief that names a known use case gets that use case's own list; a
      // brief describing something new gets the keyword ranking.
      const template = memberKey ? matchTemplate(business_need) : null
      const suggestions = template
        ? bundleFrom(template, db[pool], idKey, memberKey)
        : suggestFrom(
            db[pool],
            idKey,
            domain_id ?? null,
            business_need ?? '',
            // A hero question is the graph's contract, so more of them are useful;
            // answer formats are picked from, not accumulated, so fewer is clearer.
            pool === 'graph_hero_questions' ? 5 : pool === 'graph_answer_formats' ? 3 : 4,
          )
      /*
       * Held briefly on purpose. There is no model here, so the answer is ready
       * instantly — but a drafting step that returns in 2ms gives the UI nowhere
       * to show that something was asked of an LLM, and teaches that the call is
       * free. Paced like the profiler, for the same reason.
       */
      setTimeout(() => {
        send(res, 200, {
          suggestions,
          count: suggestions.length,
          // Says plainly where these came from — there is no model behind them.
          derived_from: template
            ? `the ${template.name} use case`
            : business_need
              ? 'business need + domain'
              : 'domain only',
          run: {
            stages: DRAFT_STAGES,
            // Deterministic, so the same brief always reports the same cost.
            cost_usd: Number(
              (0.01 + (hash(`${path}:${business_need ?? ''}`) % 6) / 100).toFixed(2),
            ),
            cost_cap_usd: COST_CAP_USD,
          },
        })
      }, SUGGEST_MS).unref?.()
    },
  })),

  // Step 6 → 7. Starts the derivation and returns immediately; the answer
  // arrives by polling, so leaving the page does not lose the run.
  {
    method: 'POST',
    match: (p) => p === '/graph-derivations',
    handle: async (req, res) => {
      const { name, sources, hero_questions } = await readJson(req)
      if (sources !== undefined && !Array.isArray(sources)) {
        return send(res, 400, { error: 'sources must be an array' })
      }
      if (hero_questions !== undefined && !Array.isArray(hero_questions)) {
        return send(res, 400, { error: 'hero_questions must be an array' })
      }

      const coverage = graphCoverage({
        name: name ?? '',
        picks: sources ?? [],
        heroQuestions: hero_questions ?? [],
      })

      const id = crypto.randomUUID()
      const run = {
        derivation_id: id,
        status: 'running',
        stage_index: 0,
        stage_label: 'queued',
        progress: 0,
        revealed: [],
        entityTotal: coverage.entity_count + coverage.relationship_count,
        cost: 0,
        started_at: new Date().toISOString(),
        finished_at: null,
        coverage,
      }
      derivations.set(id, run)
      runDerivation(run)

      send(res, 202, derivationView(run))
    },
  },

  {
    method: 'GET',
    match: (p) => /^\/graph-derivations\/.+$/.test(p),
    handle: (_req, res, { pathname }) => {
      const id = decodeURIComponent(pathname.slice('/graph-derivations/'.length))
      const run = derivations.get(id)
      if (!run) return send(res, 404, { error: `no derivation ${id}` })
      send(res, 200, derivationView(run))
    },
  },

  /*
   * Step 7. Derived from the draft rather than from a saved row, so the review
   * reflects what is on screen — including edits not yet saved.
   */
  {
    method: 'POST',
    match: (p) => p === '/graph-coverage',
    handle: async (req, res) => {
      const { name, sources, hero_questions } = await readJson(req)
      if (sources !== undefined && !Array.isArray(sources)) {
        return send(res, 400, { error: 'sources must be an array' })
      }
      if (hero_questions !== undefined && !Array.isArray(hero_questions)) {
        return send(res, 400, { error: 'hero_questions must be an array' })
      }
      send(
        res,
        200,
        graphCoverage({
          name: name ?? '',
          picks: sources ?? [],
          heroQuestions: hero_questions ?? [],
        }),
      )
    },
  },

  // Step 4. What the Data Catalogue has actually profiled, per connected source.
  {
    method: 'GET',
    match: (p) => p === '/graph-sources',
    handle: (_req, res) => send(res, 200, graphSources()),
  },

  /* ---------------- Graph Studio ---------------- */

  /*
   * The studio's front door: the graphs that have actually been built. A draft
   * is not listed — there is nothing to review until the wizard commits one.
   */
  {
    method: 'GET',
    match: (p) => p === '/graph-studio',
    handle: (_req, res) => {
      const graphs = builtGraphs()
        .map(studioSummary)
        .sort((a, b) => Date.parse(b.built_at ?? 0) - Date.parse(a.built_at ?? 0))
      send(res, 200, {
        graphs,
        count: graphs.length,
        draft_count: db.graph_use_cases.length - graphs.length,
      })
    },
  },

  // One built graph's review queue, pivot and publish gate.
  {
    method: 'GET',
    match: (p) => /^\/graph-studio\/[^/]+$/.test(p),
    handle: (_req, res, { pathname }) => {
      const id = decodeURIComponent(pathname.slice('/graph-studio/'.length))
      const found = findBuiltGraph(id)
      if (found.error) return send(res, found.status, { error: found.error })
      send(res, 200, graphStudio(found.useCase))
    },
  },

  // One decision on one row of one graph.
  {
    method: 'POST',
    match: (p) => /^\/graph-studio\/[^/]+\/decisions$/.test(p),
    handle: async (req, res, { pathname }) => {
      const id = decodeURIComponent(
        pathname.slice('/graph-studio/'.length, -'/decisions'.length),
      )
      const found = findBuiltGraph(id)
      if (found.error) return send(res, found.status, { error: found.error })

      const { item_id, choice, justification } = await readJson(req)
      const gen = db.graph_studio.generated
      const all = [
        ...studioItems(id, 'must_review', gen.must_review_total, db.graph_studio.review_items),
        ...studioItems(id, 'confirmed', gen.sample_size),
        ...studioItems(id, 'auto_approved', gen.sample_size),
      ]
      const item = all.find((i) => i.item_id === item_id)
      if (!item) return send(res, 404, { error: `no review item ${item_id}` })

      /*
       * The choices are the item's own, and the row is the authority on them.
       *
       * A row states its buttons in its own terms — "Keep distinct", "Declare basis
       * = manifest", "Leave orphaned" — but each one still resolves to one of the
       * recorded choices, because what a decision *means* to the canvas has to be
       * the same on every row: `approve` keeps the element, `correct` marks it
       * studio-authored, `reject` drops it. So the labels vary and the choices do
       * not, and this refuses anything the row does not offer. The page cannot
       * present a button the API would reject, because both read this one list.
       */
      const allowed = item.actions
        ? item.actions.map((a) => a.choice)
        : item.action_set === 'causal'
          ? ['approve-causal', 'downgrade-correlational', 'reject']
          : ['approve', 'correct', 'reject']
      if (!allowed.includes(choice)) {
        return send(res, 400, {
          error:
            `"${choice}" is not one of the choices ${item_id} offers — ` +
            `it takes: ${allowed.join(', ')}`,
        })
      }

      // A schema-changing floor is exactly where the reason has to outlive the
      // click, so the row cannot be cleared without one.
      if (item.justification && !String(justification ?? '').trim()) {
        return send(res, 400, {
          error:
            'this decision changes the schema — record a justification before resolving it',
        })
      }

      studioDecisions.set(`${id}:${item_id}`, {
        choice,
        justification: String(justification ?? '').trim() || null,
        decided_at: new Date().toISOString(),
      })
      send(res, 200, { item_id, studio: graphStudio(found.useCase) })
    },
  },

  // The ontology as a graph. Proposed elements are whatever the queue has not
  // decided yet, so this and the review queue can never tell different stories.
  {
    method: 'GET',
    match: (p) => /^\/graph-studio\/[^/]+\/canvas$/.test(p),
    handle: (_req, res, { pathname }) => {
      const id = decodeURIComponent(
        pathname.slice('/graph-studio/'.length, -'/canvas'.length),
      )
      const found = findBuiltGraph(id)
      if (found.error) return send(res, found.status, { error: found.error })
      send(res, 200, studioCanvas(id))
    },
  },

  // Ask the draft graph a question before anyone commits to it.
  {
    method: 'POST',
    match: (p) => /^\/graph-studio\/[^/]+\/query$/.test(p),
    handle: async (req, res, { pathname }) => {
      const id = decodeURIComponent(
        pathname.slice('/graph-studio/'.length, -'/query'.length),
      )
      const found = findBuiltGraph(id)
      if (found.error) return send(res, found.status, { error: found.error })

      const { question } = await readJson(req)
      if (!question || !String(question).trim()) {
        return send(res, 400, { error: 'ask a question first' })
      }
      const answer = studioQuery(id, String(question).trim())
      // Paced like the suggesters: an answer that returns instantly reads as a
      // lookup, and this is meant to read as the graph being asked.
      /* The marked canvas travels back with the answer, so there is no second
         request and no second truth. A recorded check names its hops, so the
         highlight is exactly those; a derived walk can only say which nodes it
         crossed. */
      setTimeout(
        () =>
          send(res, 200, {
            ...answer,
            canvas: studioCanvas(
              id,
              answer.path,
              answer.recorded ? answer.edges_used.map((e) => e.edge_id) : null,
            ),
          }),
        SUGGEST_MS,
      ).unref?.()
    },
  },

  /*
   * Publishing a version, and unpublishing it.
   *
   * **One pointer, and it names a content hash.** Publishing does not mutate the
   * version it points at — the rows are content-addressed and immutable — it
   * decides which one Ask may query. Unpublishing clears the pointer, which takes
   * the graph out of Ask without deleting anything.
   *
   * The gate is unchanged: an unreviewed graph cannot be published, whichever
   * version is chosen. A row may still *offer* Publish while its `gate` reads
   * `unknown` — the refusal explains what is outstanding, which is more use than a
   * disabled button with no reason.
   */
  {
    method: 'POST',
    match: (p) => /^\/graph-studio\/[^/]+\/versions\/[0-9a-f]+\/publish$/.test(p),
    handle: (_req, res, { pathname }) => {
      const [, , rawId, , sha] = pathname.split('/')
      const id = decodeURIComponent(rawId)
      const found = findBuiltGraph(id)
      if (found.error) return send(res, found.status, { error: found.error })

      const row = (studioVersions.get(id) ?? []).find((v) => v.sha256 === sha)
      if (!row) {
        return send(res, 404, {
          error:
            `no version ${sha} for ${id} — versions live in memory, so restarting ` +
            'the mock server clears them. Build the graph again.',
        })
      }

      const gate = graphStudio(found.useCase).publish
      if (gate.blocked) {
        return send(res, 400, {
          error: `publish is blocked — ${gate.reasons.join(' · ')}`,
          reasons: gate.reasons,
        })
      }

      studioLive.set(id, sha)
      send(res, 200, { published: sha, studio: graphStudio(found.useCase) })
    },
  },

  {
    method: 'POST',
    match: (p) => /^\/graph-studio\/[^/]+\/versions\/[0-9a-f]+\/unpublish$/.test(p),
    handle: (_req, res, { pathname }) => {
      const [, , rawId, , sha] = pathname.split('/')
      const id = decodeURIComponent(rawId)
      const found = findBuiltGraph(id)
      if (found.error) return send(res, found.status, { error: found.error })

      if (studioLive.get(id) !== sha) {
        return send(res, 400, {
          error: `version ${sha} is not the published one — nothing to unpublish`,
        })
      }
      /* Ask loses this graph the moment the pointer clears, which is the point:
         unpublishing is how a graph is taken out of service. */
      studioLive.delete(id)
      send(res, 200, { published: null, studio: graphStudio(found.useCase) })
    },
  },

  /*
   * Building the graph, and rebuilding it.
   *
   * 202 with a queued run — the same contract as a profiling job, deliberately,
   * rather than a third pattern for "a run the page watches". A build is repeatable
   * on purpose: settling review rows changes what a build produces, so the normal
   * case is running it again, and every run is kept so the last one stays readable.
   *
   * A draft is refused by `findBuiltGraph`, which is exactly the precondition —
   * the first stage is `pin_inputs`, and there is nothing to pin until the brief
   * is committed. Its message already says how to fix it.
   */
  {
    method: 'POST',
    match: (p) => /^\/graph-studio\/[^/]+\/builds$/.test(p),
    handle: (_req, res, { pathname }) => {
      const id = decodeURIComponent(
        pathname.slice('/graph-studio/'.length, -'/builds'.length),
      )
      const found = findBuiltGraph(id)
      if (found.error) return send(res, found.status, { error: found.error })
      send(res, 202, buildView(startBuildFor(found.useCase)))
    },
  },

  // This graph's build history, newest first — what the run picker lists.
  {
    method: 'GET',
    match: (p) => /^\/graph-studio\/[^/]+\/builds$/.test(p),
    handle: (_req, res, { pathname }) => {
      const id = decodeURIComponent(
        pathname.slice('/graph-studio/'.length, -'/builds'.length),
      )
      const found = findBuiltGraph(id)
      if (found.error) return send(res, found.status, { error: found.error })
      const history = graphBuildsByUseCase.get(id) ?? []
      send(res, 200, {
        use_case_id: id,
        builds: history.map(buildView),
        count: history.length,
      })
    },
  },

  // One run, polled while it is in flight.
  {
    method: 'GET',
    match: (p) => /^\/graph-studio\/[^/]+\/builds\/[^/]+$/.test(p),
    handle: (_req, res, { pathname }) => {
      const rest = pathname.slice('/graph-studio/'.length)
      const cut = rest.indexOf('/builds/')
      const id = decodeURIComponent(rest.slice(0, cut))
      const buildId = decodeURIComponent(rest.slice(cut + '/builds/'.length))
      const run = (graphBuildsByUseCase.get(id) ?? []).find(
        (b) => b.build_id === buildId,
      )
      if (!run) {
        return send(res, 404, {
          error: `no build ${buildId} for ${id} — builds live in memory, so restarting the mock server clears them. Trigger a build again.`,
        })
      }
      send(res, 200, buildView(run))
    },
  },

  // Settling the pivot. Its own endpoint because it is its own precondition.
  {
    method: 'POST',
    match: (p) => /^\/graph-studio\/[^/]+\/pivot$/.test(p),
    handle: async (req, res, { pathname }) => {
      const id = decodeURIComponent(
        pathname.slice('/graph-studio/'.length, -'/pivot'.length),
      )
      const found = findBuiltGraph(id)
      if (found.error) return send(res, found.status, { error: found.error })

      const { option_id } = await readJson(req)
      const options = db.graph_studio.pivot.options.map((o) => o.option_id)
      if (!options.includes(option_id)) {
        return send(res, 400, { error: `option_id must be one of: ${options.join(', ')}` })
      }
      studioPivotChoice.set(id, option_id)
      send(res, 200, { chosen: option_id, studio: graphStudio(found.useCase) })
    },
  },

  {
    method: 'POST',
    match: (p) => /^\/graph-studio\/[^/]+\/quality-check$/.test(p),
    handle: (_req, res, { pathname }) => {
      const id = decodeURIComponent(
        pathname.slice('/graph-studio/'.length, -'/quality-check'.length),
      )
      const found = findBuiltGraph(id)
      if (found.error) return send(res, found.status, { error: found.error })

      const studio = graphStudio(found.useCase)
      // Real checks over real state — a report that always passes is decoration.
      const checks = [
        {
          check_id: 'floor-decisions',
          label: 'Every floor item has a decision',
          passed: studio.must_review_outstanding === 0,
          detail: `${studio.must_review_outstanding} of ${studio.must_review_count} still open`,
        },
        {
          check_id: 'pivot-settled',
          label: 'No entity-resolution pivot is open',
          passed: !studio.pivot.open,
          detail: studio.pivot.open
            ? `${studio.pivot.pivot_id} is unresolved`
            : `settled as ${studio.pivot.chosen}`,
        },
        {
          check_id: 'schema-justified',
          label: 'Schema-changing approvals carry a justification',
          passed: studio.must_review
            .filter((i) => i.justification && i.decision)
            .every((i) => Boolean(i.decision.justification)),
          detail: 'recorded with the decision, not after it',
        },
      ]
      const failed = checks.filter((c) => !c.passed).length
      setTimeout(
        () =>
          send(res, 200, {
            checks,
            passed: checks.length - failed,
            failed,
            ran_at: new Date().toISOString(),
          }),
        QUALITY_CHECK_MS,
      ).unref?.()
    },
  },


  /*
   * The graphs Ask can query: the ones that are live.
   *
   * Built-but-unpublished and still-in-the-wizard are counted separately
   * because they are different problems with different fixes, and the empty
   * page has to name the right one.
   */
  {
    method: 'GET',
    match: (p) => p === '/ask',
    handle: (_req, res) => {
      const built = builtGraphs()
      const graphs = built
        .map(askableGraph)
        .filter(Boolean)
        .sort((a, b) => Date.parse(b.published_at ?? 0) - Date.parse(a.published_at ?? 0))

      send(res, 200, {
        graphs,
        count: graphs.length,
        built_count: built.length,
        draft_count: db.graph_use_cases.length - built.length,
      })
    },
  },

  // Ask the live graph. Every refusal names the fix, and none of them is paced.
  {
    method: 'POST',
    match: (p) => p === '/ask',
    handle: async (req, res) => {
      const { use_case_id, question } = await readJson(req)
      const id = String(use_case_id ?? '').trim()
      if (!id) return send(res, 400, { error: 'choose a graph to ask first' })

      const found = findBuiltGraph(id)
      if (found.error) return send(res, found.status, { error: found.error })
      if (liveVersion(id) === null) {
        return send(res, 400, {
          error: `${found.useCase.name} has never been published — publish it in Graph Studio, then ask it`,
        })
      }
      if (!String(question ?? '').trim()) {
        return send(res, 400, { error: 'ask a question first' })
      }

      /*
       * The answer is streamed, because it is composed rather than fetched.
       *
       * Everything above this line is validated first and refused with a plain
       * 400 — an error must not arrive as an event inside a 200, and refusals are
       * never paced. Only once the answer is known to exist does the stream open.
       *
       * The order is the order it becomes true: the grounding step, then the
       * summary, then each block as it is produced, then the whole envelope in
       * `done` so the client has one object to validate. Nothing is emitted that
       * the server has not already computed — the pacing spaces out real output
       * rather than animating over a finished blob, which is the same distinction
       * `GoogleConsentPanel` draws between a stage and a timer.
       */
      const answer = askAnswer(found.useCase, String(question).trim())

      sseOpen(res)
      // A client that goes away mid-answer stops the loop rather than writing to
      // a dead socket for the rest of the blocks.
      let open = true
      res.on('close', () => {
        open = false
      })

      for (const step of answer.reasoning) {
        if (!open) return
        sseSend(res, 'stage', { step: step.step, detail: step.detail })
        await pause(ASK_STAGE_MS)
      }

      if (!open) return
      sseSend(res, 'summary', {
        answered: answer.answered,
        summary: answer.summary,
        reason: answer.reason,
        answer: answer.answer,
      })

      for (const [index, block] of (answer.blocks ?? []).entries()) {
        await pause(ASK_BLOCK_MS)
        if (!open) return
        sseSend(res, 'block', { index, block })
      }

      await pause(ASK_BLOCK_MS)
      if (!open) return
      sseSend(res, 'done', answer)
      res.end()
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
      const {
        use_case_id,
        name,
        domain_id,
        business_need,
        personas,
        kpis,
        sources,
        hero_questions,
        citations,
        answer_formats,
        gap_decisions,
        step,
        status,
      } = body

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
      // Personas and KPIs are free text (the user can add their own), so they
      // are only trimmed and de-duplicated — never matched against the pool.
      for (const [label, list] of [
        ['personas', personas],
        ['kpis', kpis],
      ]) {
        if (list === undefined) continue
        if (!Array.isArray(list)) {
          return send(res, 400, {
            error: `${label} must be an array of { name, description }`,
          })
        }
        if (
          list.some(
            (p) => !String(typeof p === 'string' ? p : (p?.name ?? '')).trim(),
          )
        ) {
          return send(res, 400, {
            error: `every ${label === 'kpis' ? 'KPI' : 'persona'} needs a name`,
          })
        }
      }
      const personaTags =
        personas === undefined ? null : normalizeDrafted(personas)
      const kpiTags = kpis === undefined ? null : normalizeDrafted(kpis)

      if (hero_questions !== undefined) {
        if (!Array.isArray(hero_questions)) {
          return send(res, 400, {
            error: 'hero_questions must be an array of { text, priority }',
          })
        }
        if (
          hero_questions.some(
            (q) =>
              !String(typeof q === 'string' ? q : (q?.text ?? q?.name ?? '')).trim(),
          )
        ) {
          return send(res, 400, { error: 'every hero question needs text' })
        }
      }
      const questions =
        hero_questions === undefined ? null : normalizeQuestions(hero_questions)

      if (citations !== undefined && citations !== 'required' && citations !== 'optional') {
        return send(res, 400, { error: 'citations must be "required" or "optional"' })
      }
      if (answer_formats !== undefined && !Array.isArray(answer_formats)) {
        return send(res, 400, {
          error: 'answer_formats must be an array of { format_id, name, format }',
        })
      }
      if (
        answer_formats !== undefined &&
        answer_formats.some((f) => !String(f?.format_id ?? '').trim() || !String(f?.name ?? '').trim())
      ) {
        return send(res, 400, { error: 'every answer format needs a format_id and a name' })
      }
      const formats =
        answer_formats === undefined ? null : normalizeFormats(answer_formats)

      if (gap_decisions !== undefined) {
        if (!Array.isArray(gap_decisions)) {
          return send(res, 400, {
            error: 'gap_decisions must be an array of { element_id, decision }',
          })
        }
        const bad = gap_decisions.find(
          (d) => !GAP_DECISIONS.includes(String(d?.decision ?? '').trim()),
        )
        if (bad) {
          return send(res, 400, {
            error: `decision must be one of: ${GAP_DECISIONS.join(', ')}`,
          })
        }
      }
      const decisions =
        gap_decisions === undefined ? null : normalizeGapDecisions(gap_decisions)

      /*
       * Source picks are checked against what is actually profiled, because this
       * is the one step whose answers must still be true at build time: a
       * dataset the user no longer has, or a subset that selects nothing, would
       * derive an empty graph.
       */
      let sourcePicks = null
      if (sources !== undefined) {
        if (!Array.isArray(sources)) {
          return send(res, 400, {
            error: 'sources must be an array of { source_id, mode, objects }',
          })
        }
        sourcePicks = normalizeSourcePicks(sources)
        const available = graphSources().sources
        for (const pick of sourcePicks) {
          const source = available.find((s) => s.source_id === pick.source_id)
          if (!source) {
            return send(res, 400, {
              error: `${pick.source_id} is not a connected source`,
            })
          }
          if (source.object_count === 0) {
            return send(res, 400, {
              error: `${pick.source_id} has nothing profiled yet — profile it in the Data Catalogue first`,
            })
          }
          if (pick.mode === 'subset') {
            if (pick.objects.length === 0) {
              return send(res, 400, {
                error: `pick at least one ${source.unit_label.replace(/s$/, '')} for ${pick.source_id} — an empty selection can't derive`,
              })
            }
            const known = new Set(source.objects.map((o) => o.object_id))
            const unknown = pick.objects.filter((o) => !known.has(o))
            if (unknown.length > 0) {
              return send(res, 400, {
                error: `not profiled on ${pick.source_id}: ${unknown.join(', ')}`,
              })
            }
          }
        }
      }

      const existing = use_case_id
        ? db.graph_use_cases.find((u) => u.use_case_id === use_case_id)
        : null
      if (use_case_id && !existing) {
        return send(res, 404, { error: `no use case ${use_case_id}` })
      }

      /*
       * Steps unlock in order, and step 1's domain is what every later step
       * derives from — the suggesters all take it — so a draft cannot sit past
       * step 1, or commit, without one. The page gates this too; the rule is
       * here as well so it survives a direct call. Checked on the merged value,
       * because an upsert may be carrying the domain on the existing record
       * rather than in the body. Only step 1's answers are enforced here: a
       * later step's rule would make "Save draft" unable to keep partial work.
       */
      const resolvedDomain = domain_id ?? existing?.domain_id ?? null
      if (!resolvedDomain && (stepNumber > 1 || status === 'committed')) {
        return send(res, 400, {
          error:
            'pick a business domain on step 1 — a use case cannot advance past it or commit without one',
        })
      }

      const record = {
        use_case_id: existing?.use_case_id ?? `uc-${slugify(name)}-${nextId()}`,
        name: String(name).trim(),
        status: status ?? existing?.status ?? 'draft',
        domain_id: resolvedDomain,
        business_need: business_need ?? existing?.business_need ?? '',
        personas: personaTags ?? existing?.personas ?? [],
        kpis: kpiTags ?? existing?.kpis ?? [],
        sources: sourcePicks ?? existing?.sources ?? [],
        hero_questions: questions ?? existing?.hero_questions ?? [],
        citations: citations ?? existing?.citations ?? 'required',
        answer_formats: formats ?? existing?.answer_formats ?? [],
        gap_decisions: decisions ?? existing?.gap_decisions ?? [],
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

      /*
       * A newly committed brief is a new config, so the version label moves. It is
       * bumped here and nowhere else — not on a build and not on a publish — which
       * is why every build of one brief carries one label and they differ only by
       * content hash. Saving a *draft* changes nothing: a draft cannot be built.
       */
      if (status === 'committed' && existing?.status !== 'committed') {
        bumpConfigVersion(record.use_case_id)
      }

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
      if (!connector) {
        return send(res, 400, { error: 'connector is required' })
      }
      /* Same floor as the two real connectors: the stubbed ones land in the same
         Sources table, so a one-character name is no more readable here. */
      const nameProblem = sourceNameProblem(source_name)
      if (nameProblem) return send(res, 400, { error: nameProblem })
      const slug = String(source_name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      const sourceId = `${connector}:${slug}`
      const alreadyRegistered = registered.has(sourceId)

      const record = {
        kind: 'generic',
        source_id: sourceId,
        source_name: String(source_name).trim(),
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
    /*
     * A 404 on an endpoint the code plainly implements is the stale-server
     * signature: this process loaded its routes at startup, before the endpoint
     * existed. Saying so here covers every future endpoint at once, rather than
     * each one growing its own check after someone loses an hour to it.
     */
    return send(res, 404, {
      error:
        `no route for ${req.method} ${pathname} — if this endpoint is new, ` +
        'this server started before it existed. Restart it: stop `npm run mock` and start it again.',
    })
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

/*
 * Refuse to start on a document the routes cannot serve. `commitDb` already
 * rejects a *write* that would drop a required key, but a server booted from an
 * already-broken file passes that check and then fails deep inside a route
 * (`Cannot read properties of undefined (reading 'map')`) with nothing naming
 * the cause. That is reachable: a process running since before a key existed
 * wrote its stale copy back and dropped four of them. Failing here names the
 * missing keys at the one moment the fix is obvious.
 */
const startupProblems = validateDb(db)
if (startupProblems.length > 0) {
  console.error('\nmock-server: refusing to start — mock-server/db.json cannot be served.')
  for (const problem of startupProblems) console.error(`  · ${problem}`)
  console.error(
    '\n  Restore the file, then start again:' +
      '\n      git show HEAD:mock-server/db.json > mock-server/db.json\n',
  )
  process.exit(1)
}

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