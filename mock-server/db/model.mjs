/*
 * ============================================================================
 *  The relational model — one definition, three consumers
 * ============================================================================
 *
 * `db.json` is a 450 KB document with 25 top-level keys, and until this file it was
 * *also* the runtime store: the server read it at boot, every route closed over the
 * parsed object, and every write stringified the whole thing back to disk. This file
 * is the shape that document takes in PostgreSQL — 60-odd tables with real foreign
 * keys, so a canvas edge cannot name a node that is not there and a report audience
 * cannot name a persona `auth_roles` has never heard of.
 *
 * **It is written once and read three ways**, which is the whole reason it is data
 * rather than three hand-kept files:
 *
 *   model.mjs ──► schema.mjs   → CREATE SCHEMA / CREATE TABLE / REFERENCES  (the DDL)
 *             ──► mapping.mjs  → toRows(document) / fromRows(rows)          (the mapper)
 *             ──► pg.mjs       → loadDb() / commitDb()                      (the store)
 *
 * A hand-written `schema.sql` beside a hand-written mapper is two answers to "what
 * columns does `datasets` have", and they drift the first time one is edited — the
 * same failure `CLAUDE.md` records for the document dictionary's facet map, which
 * existed twice and had to grow a `check-docs` claim to stay honest. Here there is
 * one answer and the DDL is generated from it.
 *
 * ---------------------------------------------------------------------------
 *  What is a table, and what is a blob
 * ---------------------------------------------------------------------------
 *
 * Two kinds of thing live in `db.json`, and only one of them is relational.
 *
 * **Entity data** — the 36-generator register, the 189 canvas nodes, the 206 column
 * profiles, the 40 written answers, the five report definitions. These are rows. They
 * get tables, typed columns and foreign keys, because they have identity and they
 * reference each other.
 *
 * **Authored copy** — `whatif.copy`, `whatif.runtime`, `reports.opts`,
 * `reports.governance.publishing`. These are the tenant's words and the shapes the
 * components read them in: a heading, a placeholder, a preset's sentence. They are
 * documents, not relations. Normalising them would mean an EAV table of
 * `(path, key, value)` that loses the shape entirely and buys nothing — no query ever
 * joins on a button label. They are stored whole in `doc_blobs(path, value jsonb)`,
 * one row per subtree, keyed by the JSON path it came from.
 *
 * The line is drawn on **whether anything references it**, not on how big it is. That
 * is the same line the app already draws: `graph_use_case_templates` holds nothing but
 * ids into three pools, so those become join tables with real FKs; `whatif.formats`
 * holds three format templates nobody joins to, so it is a blob.
 *
 * ---------------------------------------------------------------------------
 *  Two type rules that exist to make the round trip exact
 * ---------------------------------------------------------------------------
 *
 * **No `numeric`, and no `bigint`.** `pg` returns both as *strings*, because neither
 * fits a JS number safely in general — so a `confidence` of `0.9` would come back as
 * `'0.9'` and `fromRows` would rebuild a document that no longer deep-equals the one
 * that went in, with nothing throwing. Counts are `integer` and anything fractional is
 * `double precision`, which is bit-for-bit what a JSON number already is.
 *
 * **An optional key stays absent, it does not become `null`.** `tone` is missing from
 * some stat rows and `review_item_id` from most canvas nodes, and `{ tone: null }` is a
 * different document from `{}` — `validateDb` and the client schemas both read presence.
 * A column marked `optional` is omitted from the rebuilt object when it is NULL, rather
 * than set to null. That is why every optional key in `db.json` is marked here: a
 * missed one is a silent shape change.
 */

/** Shorthand column constructors — `t('label')`, `i('rows')`, `f('confidence')`, … */
const col = (type) => (name, opts = {}) => ({ name, type, ...opts })

export const t = col('text')
export const i = col('integer')
export const f = col('double precision')
export const b = col('boolean')
export const j = col('jsonb')
export const ta = col('text[]')

/** Mark a column optional: absent (not null) in the rebuilt document when NULL. */
export const opt = (c) => ({ ...c, optional: true })
/** Point a column at a different JSON key than its SQL name. */
export const as = (c, json) => ({ ...c, json })

/* ============================================================================
 *  Identity and access
 * ========================================================================== */

const googleAccount = {
  table: 'google_account',
  pk: ['id'],
  singletonCol: 'id',
  cols: [t('email'), t('name'), t('picture')],
}

const authRoles = {
  table: 'auth_roles',
  pk: ['role_id'],
  ordinal: true,
  cols: [t('role_id'), t('label'), t('access_note')],
}

/* ============================================================================
 *  BigQuery: project → dataset → table → column profile
 * ========================================================================== */

const datasetTables = {
  table: 'dataset_tables',
  pk: ['dataset_id', 'table_id'],
  parent: ['dataset_id'],
  ordinal: true,
  fk: [{ cols: ['dataset_id'], table: 'datasets', refs: ['dataset_id'] }],
  cols: [
    t('table_id'),
    t('label'),
    t('type'),
    t('grain'),
    i('rows'),
    i('columns'),
    f('size_gb'),
    b('partitioned'),
  ],
}

const datasets = {
  table: 'datasets',
  pk: ['dataset_id'],
  parent: ['project_id'],
  ordinal: true,
  fk: [{ cols: ['project_id'], table: 'projects', refs: ['project_id'] }],
  cols: [t('dataset_id'), t('location'), t('description'), t('semantic_layer')],
  children: [{ json: 'tables', spec: datasetTables }],
}

const projects = {
  table: 'projects',
  pk: ['project_id'],
  ordinal: true,
  cols: [t('project_id'), t('display_name'), t('location')],
  children: [{ json: 'datasets', spec: datasets }],
}

const credentials = {
  table: 'credentials',
  pk: ['project_id'],
  ordinal: true,
  fk: [{ cols: ['project_id'], table: 'projects', refs: ['project_id'] }],
  cols: [t('project_id'), t('credential_handle')],
}

/*
 * The 206 real columns, keyed `<dataset>.<table>` in the document.
 *
 * The key is kept verbatim in `profile_key` *and* split into the two ids it is made
 * of, so the foreign key can be real: a profile for a table the catalogue does not
 * list is exactly the drift `check-docs` counts today (every view's profiled count
 * must equal the count the catalogue advertises), and a constraint says it once.
 * Rebuilding uses `profile_key`, never the split, so the key cannot be re-derived
 * wrongly on the way out.
 */
const columnProfiles = {
  table: 'column_profiles',
  pk: ['profile_key', 'column_id'],
  keyCol: 'profile_key',
  keyCols: [t('dataset_id'), t('table_id')],
  splitKey: (key) => {
    const at = key.indexOf('.')
    return { dataset_id: key.slice(0, at), table_id: key.slice(at + 1) }
  },
  ordinal: true,
  fk: [{ cols: ['dataset_id', 'table_id'], table: 'dataset_tables', refs: ['dataset_id', 'table_id'] }],
  cols: [
    t('column_id'),
    t('label'),
    t('type'),
    t('class'),
    t('description'),
    t('derivation'),
    f('confidence'),
    b('pii'),
    f('null_pct'),
    as(i('distinct_count'), 'distinct'),
  ],
}

/* ============================================================================
 *  Drive: drive → folder → document → extraction
 * ========================================================================== */

const documents = {
  table: 'documents',
  pk: ['document_id'],
  parent: ['folder_id'],
  ordinal: true,
  fk: [{ cols: ['folder_id'], table: 'folders', refs: ['folder_id'] }],
  cols: [
    t('document_id'),
    t('name'),
    t('mime_type'),
    t('doc_type'),
    t('doc_type_label'),
    t('linked_entity'),
    i('pages'),
    f('size_mb'),
    i('entities'),
    t('modified'),
  ],
}

const folders = {
  table: 'folders',
  pk: ['folder_id'],
  parent: ['drive_id'],
  ordinal: true,
  fk: [{ cols: ['drive_id'], table: 'drives', refs: ['drive_id'] }],
  cols: [t('folder_id'), t('name'), t('path'), t('description')],
  children: [{ json: 'documents', spec: documents }],
}

const drives = {
  table: 'drives',
  pk: ['drive_id'],
  ordinal: true,
  cols: [t('drive_id'), t('display_name'), t('kind'), t('owner')],
  children: [{ json: 'folders', spec: folders }],
}

const driveCredentials = {
  table: 'drive_credentials',
  pk: ['drive_id'],
  ordinal: true,
  fk: [{ cols: ['drive_id'], table: 'drives', refs: ['drive_id'] }],
  cols: [t('drive_id'), t('credential_handle')],
}

/*
 * A document's *resolution* — read from the extraction map, not hashed. Keyed by
 * document id, which is a document, so the key is the foreign key: an extraction for
 * a file the corpus does not hold would report "resolved to FAC:…" about nothing.
 */
const documentExtractions = {
  table: 'document_extractions',
  pk: ['document_id'],
  keyCol: 'document_id',
  ordinal: true,
  fk: [{ cols: ['document_id'], table: 'documents', refs: ['document_id'] }],
  cols: [
    t('extraction_id'),
    t('extracted_entity'),
    t('entity_type'),
    t('resolved_node'),
    t('resolved_facility'),
    t('state'),
    i('linked_manifests'),
    f('confidence'),
  ],
}

/* ============================================================================
 *  Vocabularies and change signals
 * ========================================================================== */

const vocabularyCols = [t('name'), t('type'), t('class'), f('confidence'), opt(b('pii'))]

const columnVocabulary = {
  table: 'column_vocabulary',
  pk: ['ordinal'],
  ordinal: true,
  cols: vocabularyCols,
}

const documentVocabulary = {
  table: 'document_vocabulary',
  pk: ['ordinal'],
  ordinal: true,
  cols: vocabularyCols,
}

const changeSignals = {
  table: 'change_signals',
  pk: ['signal_id'],
  ordinal: true,
  cols: [
    t('signal_id'),
    t('kind'),
    t('severity'),
    t('dataset'),
    as(t('table_name'), 'table'),
    t('detail'),
    t('action'),
    t('detected'),
  ],
}

/* ============================================================================
 *  The graph pools
 *
 *  `domains` and `keywords` are `text[]` rather than child tables: they are opaque
 *  tag lists that nothing joins to, and an array column round-trips their order for
 *  free. `graph_use_case_templates`' members are the opposite — they are ids into
 *  three pools, which is precisely the cross-key check `validateDb` performs today,
 *  so they get join tables and the constraint does the checking.
 * ========================================================================== */

const graphDomains = {
  table: 'graph_domains',
  pk: ['domain_id'],
  ordinal: true,
  cols: [
    t('domain_id'),
    t('name'),
    ta('expected_sources'),
    t('fit'),
    t('note'),
    t('unmet_note'),
    i('rank'),
  ],
}

const graphPersonas = {
  table: 'graph_personas',
  pk: ['persona_id'],
  ordinal: true,
  cols: [t('persona_id'), t('name'), ta('domains'), ta('keywords'), t('focus'), opt(ta('top_questions'))],
}

const graphKpis = {
  table: 'graph_kpis',
  pk: ['kpi_id'],
  ordinal: true,
  cols: [t('kpi_id'), t('name'), ta('domains'), ta('keywords'), t('definition')],
}

/*
 * `priority` is the one optional field on a pool question — a use case that stated a
 * priority should not make the user re-derive it. No question in the current package
 * carries one, so the column is nullable *and* optional: an absent priority must stay
 * absent, or every drafted question would arrive claiming `priority: null`.
 */
const graphHeroQuestions = {
  table: 'graph_hero_questions',
  pk: ['question_id'],
  ordinal: true,
  cols: [
    t('question_id'),
    as(t('question_text'), 'text'),
    ta('domains'),
    ta('keywords'),
    opt(t('priority')),
    opt(t('rationale')),
  ],
}

const graphAnswerFormats = {
  table: 'graph_answer_formats',
  pk: ['format_id'],
  ordinal: true,
  cols: [t('format_id'), t('name'), t('format'), ta('domains'), ta('keywords')],
}

const templateMember = (table, memberCol, refTable, refCol) => ({
  table,
  pk: ['template_id', 'ordinal'],
  parent: ['template_id'],
  ordinal: true,
  scalar: memberCol,
  fk: [
    { cols: ['template_id'], table: 'graph_use_case_templates', refs: ['template_id'] },
    { cols: [memberCol], table: refTable, refs: [refCol] },
  ],
  cols: [t(memberCol)],
})

const graphUseCaseTemplates = {
  table: 'graph_use_case_templates',
  pk: ['template_id'],
  ordinal: true,
  cols: [t('template_id'), t('use_case_id'), t('name'), t('description'), ta('match_phrases')],
  children: [
    {
      json: 'personas',
      spec: templateMember('template_personas', 'persona_id', 'graph_personas', 'persona_id'),
    },
    { json: 'kpis', spec: templateMember('template_kpis', 'kpi_id', 'graph_kpis', 'kpi_id') },
    {
      json: 'hero_questions',
      spec: templateMember(
        'template_hero_questions',
        'question_id',
        'graph_hero_questions',
        'question_id',
      ),
    },
  ],
}

/* ============================================================================
 *  Use cases — the one collection the UI writes back
 * ========================================================================== */

const draftedMember = (table) => ({
  table,
  pk: ['use_case_id', 'ordinal'],
  parent: ['use_case_id'],
  ordinal: true,
  fk: [{ cols: ['use_case_id'], table: 'graph_use_cases', refs: ['use_case_id'] }],
  cols: [t('name'), t('description'), t('source')],
})

const graphUseCases = {
  table: 'graph_use_cases',
  pk: ['use_case_id'],
  ordinal: true,
  fk: [{ cols: ['domain_id'], table: 'graph_domains', refs: ['domain_id'] }],
  cols: [
    t('use_case_id'),
    t('name'),
    t('status'),
    t('domain_id'),
    t('business_need'),
    t('citations'),
    i('step'),
    t('updated_at'),
  ],
  children: [
    { json: 'personas', spec: draftedMember('use_case_personas') },
    { json: 'kpis', spec: draftedMember('use_case_kpis') },
    {
      json: 'sources',
      spec: {
        table: 'use_case_sources',
        pk: ['use_case_id', 'ordinal'],
        parent: ['use_case_id'],
        ordinal: true,
        fk: [{ cols: ['use_case_id'], table: 'graph_use_cases', refs: ['use_case_id'] }],
        cols: [t('source_id'), t('mode'), ta('objects')],
      },
    },
    {
      json: 'hero_questions',
      spec: {
        table: 'use_case_hero_questions',
        pk: ['use_case_id', 'ordinal'],
        parent: ['use_case_id'],
        ordinal: true,
        fk: [{ cols: ['use_case_id'], table: 'graph_use_cases', refs: ['use_case_id'] }],
        cols: [as(t('question_text'), 'text'), t('priority'), t('source')],
      },
    },
    {
      json: 'answer_formats',
      spec: {
        table: 'use_case_answer_formats',
        pk: ['use_case_id', 'ordinal'],
        parent: ['use_case_id'],
        ordinal: true,
        fk: [{ cols: ['use_case_id'], table: 'graph_use_cases', refs: ['use_case_id'] }],
        cols: [t('format_id'), t('name'), t('format')],
      },
    },
    /*
     * Gap decisions are empty in every shipped brief and the wizard writes whatever
     * step 7 produced. A column per field would be a guess at a shape nothing here
     * states; the decision is stored whole and the step keeps owning it.
     */
    {
      json: 'gap_decisions',
      spec: {
        table: 'use_case_gap_decisions',
        pk: ['use_case_id', 'ordinal'],
        parent: ['use_case_id'],
        ordinal: true,
        whole: true,
        fk: [{ cols: ['use_case_id'], table: 'graph_use_cases', refs: ['use_case_id'] }],
        cols: [j('decision')],
      },
    },
  ],
}

/* ============================================================================
 *  Graph Studio
 * ========================================================================== */

const canvasNodes = {
  table: 'canvas_nodes',
  pk: ['node_id'],
  ordinal: true,
  cols: [
    t('node_id'),
    t('label'),
    t('sublabel'),
    t('type'),
    t('element_class'),
    as(t('node_group'), 'group'),
    t('source'),
    f('confidence'),
    i('degree'),
    f('r'),
    f('x'),
    f('y'),
    opt(t('review_item_id')),
  ],
}

/*
 * The edge endpoints are foreign keys, and that is the point of this table.
 *
 * An earlier package shipped 20 edges whose endpoints the node roster omitted. A
 * renderer skips what it cannot draw, so nothing threw — 17 facilities simply appeared
 * to have no enforcement. `validateDb` grew a check for it; here the database refuses
 * the row.
 */
const canvasEdges = {
  table: 'canvas_edges',
  pk: ['edge_id'],
  ordinal: true,
  fk: [
    { cols: ['from_node'], table: 'canvas_nodes', refs: ['node_id'] },
    { cols: ['to_node'], table: 'canvas_nodes', refs: ['node_id'] },
  ],
  cols: [
    t('edge_id'),
    as(t('from_node'), 'from'),
    as(t('to_node'), 'to'),
    t('label'),
    t('detail'),
    opt(t('review_item_id')),
  ],
}

const reviewItems = {
  table: 'review_items',
  pk: ['item_id'],
  ordinal: true,
  cols: [
    t('item_id'),
    t('kind'),
    t('title'),
    t('detail'),
    f('confidence'),
    t('band'),
    t('floor'),
    t('action_set'),
    ta('evidence'),
    ta('graph_refs'),
    t('justification'),
  ],
  children: [
    {
      json: 'actions',
      spec: {
        table: 'review_item_actions',
        pk: ['item_id', 'ordinal'],
        parent: ['item_id'],
        ordinal: true,
        fk: [{ cols: ['item_id'], table: 'review_items', refs: ['item_id'] }],
        cols: [t('choice'), t('label')],
      },
    },
  ],
}

const studioPivot = {
  table: 'studio_pivot',
  pk: ['pivot_id'],
  cols: [
    t('pivot_id'),
    t('alternative_id'),
    t('title'),
    t('detail'),
    t('why_pivot'),
    f('confidence'),
    t('band'),
    t('floor'),
    ta('evidence'),
    ta('graph_refs'),
  ],
  children: [
    {
      json: 'options',
      spec: {
        table: 'studio_pivot_options',
        pk: ['pivot_id', 'ordinal'],
        parent: ['pivot_id'],
        ordinal: true,
        fk: [{ cols: ['pivot_id'], table: 'studio_pivot', refs: ['pivot_id'] }],
        cols: [t('option_id'), t('label'), t('consequence')],
      },
    },
  ],
}

const sanityChecks = {
  table: 'sanity_checks',
  pk: ['check_id'],
  ordinal: true,
  cols: [
    t('check_id'),
    t('hero_question_id'),
    t('question'),
    t('verdict'),
    t('verdict_body'),
    t('plan'),
    f('cost_usd'),
    f('budget_usd'),
    ta('path'),
    ta('edges_used'),
  ],
  children: [
    {
      json: 'context',
      spec: {
        table: 'sanity_check_context',
        pk: ['check_id', 'ordinal'],
        parent: ['check_id'],
        ordinal: true,
        fk: [{ cols: ['check_id'], table: 'sanity_checks', refs: ['check_id'] }],
        cols: [t('chip'), t('label'), t('meta'), b('ok')],
      },
    },
  ],
}

const studioGenerated = {
  table: 'studio_generated',
  pk: ['id'],
  singletonCol: 'id',
  cols: [
    i('must_review_total'),
    i('confirmed_total'),
    i('auto_approved_total'),
    i('spot_check_quota'),
    i('sample_size'),
    ta('subjects'),
    ta('predicates'),
  ],
}

/* ============================================================================
 *  Ask — the tenant's 40 written answers
 *
 *  A block's scalars are columns; its collections are jsonb. Four block kinds share
 *  one array in the document (text · metric · chart · table) and nine of their keys
 *  are optional, so a column per key would be nine mostly-NULL columns and a table per
 *  kind would need four inserts to preserve one ordering. The ordering is the thing
 *  that matters — an answer is read top to bottom — so one ordered table it is.
 * ========================================================================== */

const askAnswers = {
  table: 'ask_answers',
  pk: ['answer_id'],
  ordinal: true,
  cols: [
    t('answer_id'),
    t('persona'),
    t('kind'),
    t('question'),
    t('hero_ref'),
    t('summary'),
    t('confidence_level'),
    f('confidence'),
  ],
  children: [
    {
      json: 'blocks',
      spec: {
        table: 'ask_answer_blocks',
        pk: ['answer_id', 'ordinal'],
        parent: ['answer_id'],
        ordinal: true,
        fk: [{ cols: ['answer_id'], table: 'ask_answers', refs: ['answer_id'] }],
        cols: [
          t('type'),
          opt(t('markdown')),
          opt(t('title')),
          opt(t('chart')),
          opt(t('x_label')),
          opt(t('y_label')),
          opt(j('items')),
          opt(j('data')),
          opt(ta('columns')),
          opt(j('rows')),
          opt(t('note')),
        ],
      },
    },
    {
      json: 'evidence',
      spec: {
        table: 'ask_answer_evidence',
        pk: ['answer_id', 'ordinal'],
        parent: ['answer_id'],
        ordinal: true,
        fk: [{ cols: ['answer_id'], table: 'ask_answers', refs: ['answer_id'] }],
        cols: [t('source'), t('detail')],
      },
    },
  ],
}

/* ============================================================================
 *  Telemetry — audit, traces, evals
 * ========================================================================== */

const statCols = [t('label'), t('value'), t('note'), opt(t('tone'))]

const auditStats = { table: 'audit_stats', pk: ['ordinal'], ordinal: true, cols: statCols }
const auditEvents = {
  table: 'audit_events',
  pk: ['ordinal'],
  ordinal: true,
  cols: [t('actor'), t('action'), t('resource'), t('severity'), t('tone'), t('at')],
}
const auditPolicies = {
  table: 'audit_policies',
  pk: ['ordinal'],
  ordinal: true,
  cols: [t('name'), as(t('description'), 'desc'), t('status'), t('tone')],
}

const traceStats = { table: 'trace_stats', pk: ['ordinal'], ordinal: true, cols: statCols }
const traceItems = {
  table: 'trace_items',
  pk: ['id'],
  ordinal: true,
  cols: [
    t('id'),
    t('operation'),
    t('service'),
    i('duration'),
    i('spans'),
    t('status'),
    t('tone'),
    t('at'),
  ],
}
const traceWaterfall = {
  table: 'trace_waterfall',
  pk: ['trace_id'],
  cols: [t('trace_id'), t('operation'), i('total_ms')],
  children: [
    {
      json: 'spans',
      spec: {
        table: 'trace_waterfall_spans',
        pk: ['trace_id', 'ordinal'],
        parent: ['trace_id'],
        ordinal: true,
        fk: [{ cols: ['trace_id'], table: 'trace_waterfall', refs: ['trace_id'] }],
        cols: [t('name'), as(i('start_ms'), 'start'), as(i('duration_ms'), 'duration')],
      },
    },
  ],
}

const evalStats = { table: 'eval_stats', pk: ['ordinal'], ordinal: true, cols: statCols }
const evalRuns = {
  table: 'eval_runs',
  pk: ['ordinal'],
  ordinal: true,
  cols: [
    t('suite'),
    t('target'),
    i('checks'),
    f('pass_rate'),
    t('status'),
    t('tone'),
    t('ran_at'),
  ],
}
const evalChecks = {
  table: 'eval_checks',
  pk: ['ordinal'],
  ordinal: true,
  cols: [t('name'), t('dataset'), t('result'), t('tone'), t('detail')],
}

/* ============================================================================
 *  The What-if lens
 *
 *  The rosters and the measures are rows; the copy, the step definitions and the
 *  graph reference are the tenant's words and stay whole.
 * ========================================================================== */

const whatifFacility = {
  table: 'whatif_facility',
  pk: ['id'],
  cols: [t('id'), t('name'), t('role'), j('baseline'), j('appetite')],
}

const whatifTransporters = {
  table: 'whatif_transporters',
  pk: ['ordinal'],
  ordinal: true,
  scalar: 'name',
  cols: [t('name')],
}

const whatifGenerators = {
  table: 'whatif_generators',
  pk: ['id'],
  ordinal: true,
  cols: [
    t('id'),
    t('name'),
    t('state'),
    t('risk'),
    t('transporter'),
    i('evaluations'),
    i('violations'),
    i('enforcement'),
    i('penalty'),
    f('tons'),
    i('manifests'),
    b('consent_decree'),
    t('last_enforcement'),
  ],
}

const whatifWatchedMeasures = {
  table: 'whatif_watched_measures',
  pk: ['key'],
  ordinal: true,
  cols: [
    t('key'),
    t('label'),
    t('unit'),
    t('source'),
    t('grounds'),
    t('field'),
    t('format'),
    b('inherited'),
    t('baseline_field'),
    t('appetite_field'),
    j('breach'),
  ],
}

const whatifCandidatePools = {
  table: 'whatif_candidate_pools',
  pk: ['key'],
  ordinal: true,
  cols: [t('key'), t('label'), j('filter')],
}

const whatifResolvable = {
  table: 'whatif_resolvable',
  pk: ['ordinal'],
  ordinal: true,
  cols: [ta('keywords'), t('resolves_to'), t('verdict'), t('note')],
}

const whatifHeadroom = {
  table: 'whatif_headroom',
  pk: ['key'],
  keyCol: 'key',
  ordinal: true,
  cols: [f('room'), f('avg'), f('carrying'), f('appetite')],
}

/* ============================================================================
 *  Reports
 * ========================================================================== */

const reportFields = {
  table: 'report_fields',
  pk: ['key'],
  ordinal: true,
  cols: [t('key'), t('label'), t('kind'), b('filterable'), opt(b('avail')), opt(t('note'))],
}

const reportSummaryCatalog = {
  table: 'report_summary_catalog',
  pk: ['key'],
  ordinal: true,
  cols: [t('key'), t('label'), t('tone'), t('agg'), t('field'), t('format')],
}

const reportGenerators = {
  table: 'report_generators',
  pk: ['generator'],
  ordinal: true,
  cols: [
    t('generator'),
    t('state'),
    t('risk'),
    i('evals'),
    i('viols'),
    i('enf'),
    i('penalty'),
    f('tons'),
    i('manifests'),
    b('cd'),
    t('last_enf'),
  ],
}

const reportFacilities = {
  table: 'report_facilities',
  pk: ['facility'],
  ordinal: true,
  cols: [
    t('facility'),
    t('role'),
    t('state'),
    i('evals'),
    i('viols'),
    i('enf'),
    i('penalty'),
    t('last_eval'),
  ],
}

const reportQuarters = {
  table: 'report_quarters',
  pk: ['quarter'],
  ordinal: true,
  cols: [t('quarter'), i('manifests'), f('tons'), i('rej'), i('res')],
}

const reportTraces = {
  table: 'report_traces',
  pk: ['mtn'],
  ordinal: true,
  cols: [
    t('mtn'),
    t('generator'),
    t('gen_state'),
    t('shipped'),
    t('received'),
    i('days'),
    ta('transporters'),
    f('tons'),
    b('residue'),
    b('rejected'),
    t('status'),
  ],
}

const reportDefinitions = {
  table: 'report_definitions',
  pk: ['report_id'],
  ordinal: true,
  cols: [
    t('report_id'),
    t('report_tag'),
    t('subject'),
    t('title'),
    t('question'),
    t('spine'),
    t('scope'),
    t('scope_label'),
    t('measure'),
    t('measure_label'),
    j('reading'),
    t('heading'),
    t('subtitle'),
    t('badge'),
    t('note'),
    t('source_file'),
    ta('summary_keys'),
  ],
  children: [
    {
      json: 'blocks',
      spec: {
        table: 'report_definition_blocks',
        pk: ['report_id', 'ordinal'],
        parent: ['report_id'],
        ordinal: true,
        fk: [{ cols: ['report_id'], table: 'report_definitions', refs: ['report_id'] }],
        cols: [t('type'), opt(as(t('chart_type'), 'chartType')), opt(t('measure')), opt(t('metric')), t('title'), opt(ta('cols'))],
      },
    },
    {
      json: 'tiles',
      spec: {
        table: 'report_definition_tiles',
        pk: ['report_id', 'ordinal'],
        parent: ['report_id'],
        ordinal: true,
        fk: [{ cols: ['report_id'], table: 'report_definitions', refs: ['report_id'] }],
        cols: [t('label'), t('value'), t('unit'), t('tone')],
      },
    },
    {
      json: 'footer',
      spec: {
        table: 'report_definition_footer',
        pk: ['report_id', 'ordinal'],
        parent: ['report_id'],
        ordinal: true,
        fk: [{ cols: ['report_id'], table: 'report_definitions', refs: ['report_id'] }],
        cols: [t('label'), as(t('body'), 'text')],
      },
    },
  ],
}

/*
 * A saved report is a question, not a result — it stores the frame and re-asks it. So
 * the frame's four values are columns (they are what a chip re-asks with) and only
 * `filters` is jsonb, because a facet map is per spine and has no fixed keys.
 */
const reportSaved = {
  table: 'report_saved',
  pk: ['saved_id'],
  ordinal: true,
  fk: [{ cols: ['report_id'], table: 'report_definitions', refs: ['report_id'] }],
  cols: [
    t('saved_id'),
    t('name'),
    t('question'),
    t('report_id'),
    t('use_case_id'),
    t('scope'),
    t('measure'),
    t('horizon'),
    j('filters'),
    t('saved_by'),
    ta('viewer_roles'),
    t('saved_at'),
  ],
}

const governanceStatuses = {
  table: 'governance_statuses',
  pk: ['key'],
  ordinal: true,
  cols: [t('key'), t('label'), t('tone')],
}

/*
 * A governance row's `status` and its audience are both foreign keys, and both guard a
 * failure that answers rather than throws: a status the pool does not declare prints
 * its raw key on the card and matches no chip, and an audience naming a persona
 * `auth_roles` lacks tells a reader that somebody who does not exist can open it.
 */
const governanceReports = {
  table: 'governance_reports',
  pk: ['report_id'],
  ordinal: true,
  fk: [
    { cols: ['report_id'], table: 'report_definitions', refs: ['report_id'] },
    { cols: ['status'], table: 'governance_statuses', refs: ['key'] },
  ],
  cols: [
    t('report_id'),
    t('status'),
    t('version'),
    t('author'),
    t('category'),
    t('as_of'),
    t('schedule'),
    t('approval'),
    t('note'),
  ],
  children: [
    {
      json: 'audience',
      spec: {
        table: 'governance_audience',
        pk: ['report_id', 'ordinal'],
        parent: ['report_id'],
        ordinal: true,
        scalar: 'role_id',
        fk: [
          { cols: ['report_id'], table: 'governance_reports', refs: ['report_id'] },
          { cols: ['role_id'], table: 'auth_roles', refs: ['role_id'] },
        ],
        cols: [t('role_id')],
      },
    },
  ],
}

const governanceDataScope = {
  table: 'governance_data_scope',
  pk: ['role_id'],
  ordinal: true,
  fk: [{ cols: ['role_id'], table: 'auth_roles', refs: ['role_id'] }],
  cols: [
    t('role_id'),
    t('scope'),
    t('predicate'),
    t('grain'),
    t('masked'),
    b('may_author'),
    b('full'),
    b('mask'),
    j('rule'),
  ],
}

/* ============================================================================
 *  The roots — every top-level key of db.json, and where it goes
 *
 *  `kind` says how the JSON is shaped, not what the table looks like:
 *    array     — a list of objects at `path`
 *    singleton — one object at `path`
 *    map       — an object whose every value is an array of objects
 *    mapObject — an object whose every value is one object
 *    blob      — authored copy, stored whole in doc_blobs
 * ========================================================================== */

export const ROOTS = [
  { path: 'google_account', kind: 'singleton', spec: googleAccount },
  { path: 'auth_roles', kind: 'array', spec: authRoles },
  { path: 'projects', kind: 'array', spec: projects },
  { path: 'credentials', kind: 'array', spec: credentials },
  { path: 'column_profiles', kind: 'map', spec: columnProfiles },

  { path: 'drives', kind: 'array', spec: drives },
  { path: 'drive_credentials', kind: 'array', spec: driveCredentials },
  { path: 'document_extractions', kind: 'mapObject', spec: documentExtractions },

  { path: 'column_vocabulary', kind: 'array', spec: columnVocabulary },
  { path: 'document_vocabulary', kind: 'array', spec: documentVocabulary },
  { path: 'change_signals', kind: 'array', spec: changeSignals },

  { path: 'audit.stats', kind: 'array', spec: auditStats },
  { path: 'audit.events', kind: 'array', spec: auditEvents },
  { path: 'audit.policies', kind: 'array', spec: auditPolicies },
  { path: 'audit.event_window', kind: 'blob' },
  { path: 'audit.policy_total', kind: 'blob' },

  { path: 'traces.stats', kind: 'array', spec: traceStats },
  { path: 'traces.items', kind: 'array', spec: traceItems },
  { path: 'traces.waterfall', kind: 'singleton', spec: traceWaterfall },
  { path: 'traces.sampling', kind: 'blob' },

  { path: 'evals.stats', kind: 'array', spec: evalStats },
  { path: 'evals.runs', kind: 'array', spec: evalRuns },
  { path: 'evals.checks', kind: 'array', spec: evalChecks },
  { path: 'evals.run_trigger', kind: 'blob' },
  { path: 'evals.failure_summary', kind: 'blob' },

  { path: 'graph_domains', kind: 'array', spec: graphDomains },
  { path: 'graph_personas', kind: 'array', spec: graphPersonas },
  { path: 'graph_kpis', kind: 'array', spec: graphKpis },
  { path: 'graph_hero_questions', kind: 'array', spec: graphHeroQuestions },
  { path: 'graph_answer_formats', kind: 'array', spec: graphAnswerFormats },
  { path: 'graph_use_case_templates', kind: 'array', spec: graphUseCaseTemplates },
  { path: 'graph_use_cases', kind: 'array', spec: graphUseCases },

  { path: 'graph_studio.canvas.nodes', kind: 'array', spec: canvasNodes },
  { path: 'graph_studio.canvas.edges', kind: 'array', spec: canvasEdges },
  { path: 'graph_studio.review_items', kind: 'array', spec: reviewItems },
  { path: 'graph_studio.pivot', kind: 'singleton', spec: studioPivot },
  { path: 'graph_studio.sanity_checks', kind: 'array', spec: sanityChecks },
  { path: 'graph_studio.generated', kind: 'singleton', spec: studioGenerated },

  { path: 'ask_answers', kind: 'array', spec: askAnswers },

  { path: 'whatif.facility', kind: 'singleton', spec: whatifFacility },
  { path: 'whatif.transporters', kind: 'array', spec: whatifTransporters },
  { path: 'whatif.generators', kind: 'array', spec: whatifGenerators },
  { path: 'whatif.watched_measures', kind: 'array', spec: whatifWatchedMeasures },
  { path: 'whatif.candidate_pools', kind: 'array', spec: whatifCandidatePools },
  { path: 'whatif.resolvable', kind: 'array', spec: whatifResolvable },
  { path: 'whatif.headroom', kind: 'mapObject', spec: whatifHeadroom },
  { path: 'whatif.copy', kind: 'blob' },
  { path: 'whatif.state_defaults', kind: 'blob' },
  { path: 'whatif.formats', kind: 'blob' },
  { path: 'whatif.resolve_copy', kind: 'blob' },
  { path: 'whatif.authoring', kind: 'blob' },
  { path: 'whatif.runtime', kind: 'blob' },
  { path: 'whatif.graph_reference', kind: 'blob' },
  { path: 'whatif.publishing', kind: 'blob' },

  { path: 'reports.fields', kind: 'array', spec: reportFields },
  { path: 'reports.summary_catalog', kind: 'array', spec: reportSummaryCatalog },
  { path: 'reports.data.generators', kind: 'array', spec: reportGenerators },
  { path: 'reports.data.facilities', kind: 'array', spec: reportFacilities },
  { path: 'reports.data.quarters', kind: 'array', spec: reportQuarters },
  { path: 'reports.data.traces', kind: 'array', spec: reportTraces },
  { path: 'reports.reports', kind: 'array', spec: reportDefinitions },
  { path: 'reports.saved', kind: 'array', spec: reportSaved },
  { path: 'reports.governance.statuses', kind: 'array', spec: governanceStatuses },
  { path: 'reports.governance.reports', kind: 'array', spec: governanceReports },
  { path: 'reports.governance.data_scope', kind: 'array', spec: governanceDataScope },
  { path: 'reports.meta', kind: 'blob' },
  { path: 'reports.assumptions', kind: 'blob' },
  { path: 'reports.opts', kind: 'blob' },
  { path: 'reports.slice_default', kind: 'blob' },
  { path: 'reports.summary_default', kind: 'blob' },
  { path: 'reports.governance.gate_notes', kind: 'blob' },
  { path: 'reports.governance.publishing', kind: 'blob' },
  { path: 'reports.governance.audit', kind: 'blob' },
]

/** The blob table — every authored-copy subtree, one row per JSON path. */
export const DOC_BLOBS = {
  table: 'doc_blobs',
  pk: ['path'],
  cols: [t('path'), j('value')],
}

/** Every table in the model, parents before children, for CREATE and INSERT order. */
export function allSpecs() {
  const out = []
  const walk = (spec) => {
    out.push(spec)
    for (const child of spec.children ?? []) walk(child.spec)
  }
  for (const root of ROOTS) if (root.spec) walk(root.spec)
  out.push(DOC_BLOBS)
  return out
}

/** The schema every table is created in. One namespace, so a drop is one statement. */
export const SCHEMA = 'contextweave'
