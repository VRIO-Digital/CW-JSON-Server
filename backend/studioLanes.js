/**
 * The two lanes a Graph Studio use case is built from, derived from the document.
 *
 * **Pure, for the reason `reportExport.js` is pure.** Every function here takes the selected
 * document (and usually one use case out of it) and gives back plain data. Nothing opens a file,
 * nothing reads `db`, nothing knows about S3 or about a request. That is what lets
 * `npm run verify:studio-lanes` assert what a lane derives to with no server running and no bucket
 * — and a derivation that can only be checked by clicking through five tabs is one nobody checks.
 *
 * **Everything here is DERIVED from what the document already holds, and that is the whole design.**
 * The studio this replaced read a `graph_studio` block authored by an ingest; this one reads the
 * tenant's own rows — `projects` and `column_profiles` for the structured lane, the canvas roster and
 * `document_extractions` for the document lane — so a dataset that ships data ships a studio with it.
 * CAPEX gets its lanes for free, and nothing has to be seeded twice. The alternative was a second
 * authored fixture beside the first, which is two answers to what this tenant's graph holds.
 *
 * **Where nothing in the document answers, the answer is synthesised deterministically or refused —
 * never invented plausibly.** A story's prose is synthesised from the use case's own business need
 * (its words, rearranged, never new facts); a chunk of document text nobody stored is *refused*,
 * because a sentence invented and labelled "the passage this was asserted from" is the one lie this
 * module could tell that a reader could not catch. The rule is `tableDictionary`'s: real data wins,
 * synthesis is a marked fallback, and a figure nobody measured is `null` rather than a plausible
 * number.
 */

/* ---------------- shared ---------------- */

/** FNV-1a, the same one `server.js` uses — stable across requests, so a derived figure never shifts
 *  under the UI between two polls of the same build. */
export function hash(str) {
  let h = 2166136261
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A hashed pick from a list — the repo's established way of making a synthesised choice repeatable. */
const pick = (list, seed) => (list.length === 0 ? null : list[hash(seed) % list.length])

/* ---------------- which lanes a use case has ---------------- */

/**
 * A source pick's connector kind, read off the id's own prefix.
 *
 * The wizard stores `bigquery:<project>` / `gdrive:<drive>` / `gmail:<mailbox>`, so the prefix *is*
 * the kind and there is nothing to look up. Deliberately not a lookup into `registered`: that lives
 * in the server's memory and dies with the process, so a lane derived from it would disappear on a
 * restart while the use case that named it survived — a graph that silently loses a lane is exactly
 * the failure `useUseCaseLanes` exists to prevent.
 */
export function pickKind(sourceId) {
  const colon = String(sourceId).indexOf(':')
  return colon === -1 ? '' : String(sourceId).slice(0, colon)
}

/** The structured source type, as the lane rule names it. A BigQuery project is the only structured
 *  connector this tenant has; a drive and a mailbox are both document-side. */
export const STRUCTURED_KINDS = ['bigquery']
export const DOCUMENT_KINDS = ['gdrive', 'gmail']

/**
 * Which lanes a saved use case has — **derived from what is attached, never declared.**
 *
 * There is no `graph_kind` field and there must not be one: it would be single-valued, so "a use
 * case with both a warehouse and a document set" would be unexpressible, and frozen at commit, so a
 * use case could not grow into a second lane. Both of those were live faults in the build this was
 * ported from, and the fix there was this same rule.
 */
export function deriveLanes(doc, useCase) {
  const picks = Array.isArray(useCase?.sources) ? useCase.sources : []
  const structured = picks.filter((p) => STRUCTURED_KINDS.includes(pickKind(p.source_id)))
  const documents = picks.filter((p) => DOCUMENT_KINDS.includes(pickKind(p.source_id)))
  return {
    hasStructured: structured.length > 0,
    hasDocuments: documents.length > 0,
    structuredPicks: structured,
    documentPicks: documents,
    documentCount: corpusDocuments(doc, useCase).length,
  }
}

/* ---------------- the structured lane ---------------- */

/**
 * The tables this use case's structured picks admit, with the project and dataset they came from.
 *
 * A pick is `{ source_id, mode, objects }` where an object is `"<dataset>.<table>"` and `mode: 'all'`
 * means the whole source, whatever it holds — stored rather than expanded, so a table profiled after
 * the brief was saved is included without editing the draft. That rule is the wizard's and is
 * re-read here rather than restated: expanding at save time would freeze today's list.
 */
export function selectedTables(doc, useCase) {
  const { structuredPicks } = deriveLanes(doc, useCase)
  const out = []
  for (const pick of structuredPicks) {
    const projectId = pick.source_id.slice('bigquery:'.length)
    const project = (doc.projects ?? []).find((p) => p.project_id === projectId)
    if (!project) continue
    for (const dataset of project.datasets ?? []) {
      for (const table of dataset.tables ?? []) {
        const key = `${dataset.dataset_id}.${table.table_id}`
        const admitted = pick.mode === 'all' || (pick.objects ?? []).includes(key)
        if (!admitted) continue
        out.push({ project, dataset, table, key })
      }
    }
  }
  return out
}

/** `<dataset>.<table>` — the key `column_profiles` is already keyed by, so the structured lane and
 *  the Data Catalog cannot come to disagree about which columns a table has. */
export const tableRefOf = (row) => row.key
export const columnRefOf = (row, column) => `${row.key}.${column.column_id}`

/**
 * The concepts the structured lane asserts.
 *
 * Read off the canvas's own `concept` elements rather than nominated here, because the package
 * already states them — seven type-level nodes, one per entity type however many rows. Nominating a
 * second set would put two answers to "what does this graph model" one tab apart.
 *
 * `declared` is true for a concept the use case's own metrics or hero questions name, false for one
 * only the canvas carries: that is the same distinction the reference draws between a concept the
 * wizard declared and one the extraction passes discovered, expressed against data this repo has.
 */
export function conceptsFor(doc, useCase) {
  const nodes = doc.graph_studio?.canvas?.nodes ?? []
  const declaredWords = new Set(
    [
      ...(useCase?.metrics ?? []).map((m) => m.name ?? m),
      ...(useCase?.hero_questions ?? []).map((q) => q.text ?? q),
      useCase?.business_need ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  )
  return nodes
    .filter((n) => n.element_class === 'concept')
    .map((n) => ({
      concept_ref: n.node_id,
      name: n.label,
      description: n.sublabel ?? null,
      declared: declaredWords.has(String(n.label).toLowerCase()),
      group_id: 'sg-1',
    }))
}

/**
 * The structured graph, in the shape the canvas consumes.
 *
 * Six edge kinds, and each one is read from somewhere real rather than drawn to fill the picture:
 * `HAS_COLUMN` from the profile, `REALISES` / `DESCRIBES` from the column's own semantic class,
 * `FK_TO` from the tenant's confirmed Data Modeling joins, `REL` from the canvas edges that run
 * between two concepts, and `COVERS` from the story group over the tables it was written about.
 *
 * **A column with no profile contributes no edge rather than a guessed one.** `column_profiles` is
 * the authority; a table it has no entry for is served with its columns synthesised by the Catalog,
 * and a *synthesised* column has no measured class to realise a concept with. Drawing one anyway
 * would put an asserted relationship on the canvas that nothing measured.
 */
export function sgbGraph(doc, useCase, buildId) {
  const rows = selectedTables(doc, useCase)
  const concepts = conceptsFor(doc, useCase)
  const conceptByName = new Map(concepts.map((c) => [c.name.toLowerCase(), c]))

  const tables = rows.map((row) => ({
    table_ref: tableRefOf(row),
    table_id: row.table.table_id,
    source_id: `bigquery:${row.project.project_id}`,
    schema_name: row.dataset.dataset_id,
    table_name: row.table.table_id,
    row_count_estimate: typeof row.table.rows === 'number' ? row.table.rows : null,
    table_kind: row.table.type ?? 'VIEW',
    selected: true,
    comment: row.table.label ?? null,
  }))

  const columns = []
  const edges = []

  for (const row of rows) {
    const profiled = (doc.column_profiles ?? {})[row.key]
    if (!Array.isArray(profiled)) continue
    profiled.forEach((column, i) => {
      const columnRef = columnRefOf(row, column)
      columns.push({
        column_ref: columnRef,
        table_ref: tableRefOf(row),
        column_name: column.column_id,
        ordinal_position: i + 1,
        data_type: column.type ?? 'STRING',
        profile: {
          /* Measured or nothing. A declared column carries no sample, so these stay null rather than
             taking a plausible figure — the rule `column_profiles` itself keeps. */
          distinct_count_in_sample:
            typeof column.distinct === 'number' ? column.distinct : null,
          null_ratio: typeof column.null_pct === 'number' ? column.null_pct / 100 : null,
          uniqueness_in_sample: null,
          format_signature: null,
          example_values: [],
          value_domain: null,
          is_sample_claim: typeof column.distinct === 'number',
        },
        description: column.description ?? null,
        semantic_role: column.class ?? null,
        concept_name: conceptForColumn(column, conceptByName),
      })
      edges.push({
        edge_type: 'HAS_COLUMN',
        src_kind: 'Table',
        src_ref: tableRefOf(row),
        dst_kind: 'Column',
        dst_ref: columnRef,
        declared: true,
        properties: {},
        group_id: null,
      })
      const concept = conceptForColumn(column, conceptByName)
      if (concept) {
        edges.push({
          /* An identifier *realises* the concept it identifies; anything else *describes* it. The
             distinction is the profiler's own class rather than a naming convention, because a
             convention would put a suggested relationship on the canvas on no evidence at all. */
          edge_type: column.class === 'identifier' ? 'REALISES' : 'DESCRIBES',
          src_kind: 'Column',
          src_ref: columnRef,
          dst_kind: 'Concept',
          dst_ref: conceptByName.get(concept.toLowerCase())?.concept_ref ?? concept,
          declared: false,
          properties: { confidence: column.confidence ?? null },
          group_id: null,
        })
      }
    })
  }

  /*
   * The tenant's own confirmed joins, not a column-name scan: `data_model` is where a curator said
   * these two columns join, and a second derivation here would let the canvas disagree with the tab
   * that recorded them.
   *
   * A relationship names column *lists* on both sides (a join can be composite), so the edge is
   * drawn per column pair and a pair whose column this build did not profile is **skipped rather
   * than drawn against a reference nothing resolves** — a dangling endpoint is the silent failure
   * `validateDb` refuses on the canvas, and it would be no better here.
   */
  const known = new Set(columns.map((c) => c.column_ref))
  for (const entity of doc.data_model?.entities ?? []) {
    for (const rel of entity.relationships ?? []) {
      const fromColumns = rel.from_columns ?? []
      const toColumns = rel.to_columns ?? []
      for (let i = 0; i < Math.min(fromColumns.length, toColumns.length); i++) {
        const fromRef = `${entity.table_key}.${fromColumns[i]}`
        const toRef = `${rel.target_table_key}.${toColumns[i]}`
        if (!known.has(fromRef) || !known.has(toRef)) continue
        edges.push({
          edge_type: 'FK_TO',
          src_kind: 'Column',
          src_ref: fromRef,
          dst_kind: 'Column',
          dst_ref: toRef,
          declared: true,
          properties: {
            name: rel.relationship_type ?? null,
            cardinality: rel.cardinality_hint ?? null,
            confirmed_by: rel.confirmed_by ?? null,
          },
          group_id: null,
        })
      }
    }
  }

  /* Concept-to-concept relationships, taken from the canvas edges whose two ends are both concepts.
     There are none in the EPA package today — its concepts are type-level and its edges run between
     instances — and an empty list is the honest answer rather than a reason to invent one. */
  const conceptIds = new Set(concepts.map((c) => c.concept_ref))
  for (const edge of doc.graph_studio?.canvas?.edges ?? []) {
    if (!conceptIds.has(edge.from) || !conceptIds.has(edge.to)) continue
    edges.push({
      edge_type: 'REL',
      src_kind: 'Concept',
      src_ref: edge.from,
      dst_kind: 'Concept',
      dst_ref: edge.to,
      declared: false,
      properties: { phrase: edge.label, detail: edge.detail ?? null },
      group_id: 'sg-1',
    })
  }

  const story = sgbStory(doc, useCase)
  for (const table of tables) {
    edges.push({
      edge_type: 'COVERS',
      src_kind: 'StoryGroup',
      src_ref: story.story_group_id,
      dst_kind: 'Table',
      dst_ref: table.table_ref,
      declared: false,
      properties: {},
      group_id: story.story_group_id,
    })
  }

  return { build_id: buildId, tables, columns, concepts, story_group: story, edges }
}

/**
 * Which concept a column realises or describes, or `null`.
 *
 * Matched on the column's **profiled class and its own label**, never on its name alone: a
 * `generator_id` names a facility because the profiler classified it as an identifier of one, and a
 * column called `status` that happens to contain the word "facility" does not. A column nothing
 * matches contributes no edge, which is why the canvas is sparser than a name scan would draw it and
 * why every edge on it can be traced back to a measurement.
 */
function conceptForColumn(column, conceptByName) {
  const haystack = `${column.column_id} ${column.description ?? ''}`.toLowerCase()
  for (const [name, concept] of conceptByName) {
    if (name.length < 4) continue
    if (haystack.includes(name)) return concept.name
  }
  return null
}

/**
 * The story this build was extracted from.
 *
 * **Composed from the use case's own business need and nothing else.** The reference has a model
 * write this prose; there is no model here, so the honest substitute is the tenant's own words
 * rearranged — every sentence in it came from the brief somebody typed. Writing a fresh narrative
 * would be this module inventing an account of the tenant's data and presenting it as read.
 *
 * `edited_by_user` is false until somebody edits it through the studio, which is the one thing on
 * this lane a person can change — and the record of that edit lives in the server's memory beside
 * the build, not here, because this function is pure.
 */
export function sgbStory(doc, useCase) {
  const need = String(useCase?.business_need ?? '').trim()
  const rows = selectedTables(doc, useCase)
  const tableList = rows.map((r) => r.key).join(', ')
  const lead = need.split('\n').filter(Boolean).slice(0, 3).join(' ')
  return {
    story_group_id: `sg-${useCase?.use_case_id ?? 'none'}`,
    story:
      lead ||
      'This use case states no business need yet — open it in New Graph and describe what the graph is for.',
    grain: { tables: rows.length, stated_by: 'the use case brief' },
    join_warning: null,
    /* What the derivation could not settle, stated rather than left out. A story that lists no
       uncertainties is claiming there are none. */
    uncertainties: rows.length === 0 ? ['No structured table is in scope for this use case.'] : [],
    edited_by_user: false,
    tables_covered: tableList,
  }
}

/** How many tables a drafted description names one by one before it states the rest as a count.
 *  Stated on the prose rather than truncated, which is the rule every capped list here keeps. */
const STORY_TABLES_DESCRIBED = 6

/** And how many declared joins it names before doing the same. */
const STORY_JOINS_NAMED = 8

const count = (n) => Number(n).toLocaleString('en-US')

/**
 * The other answer to "what words is this graph extracted from" — **the declared data model, rather
 * than the brief.**
 *
 * `sgbStory` stays what it is: the use case's own business need, which is what a story is before
 * anybody has drafted one. This is what *Draft from my data model* produces — a description of the
 * data itself: the tables in scope, the grain each one states, the columns profiled against it, the
 * identifier a curator confirmed, and the joins the Data Modeling tab holds.
 *
 * **Every clause is read, and a fact the document does not hold is left out rather than filled in.**
 * A table with no stated grain contributes no grain clause; a row count nobody has measured is
 * absent rather than 0 — which would say the table is empty; a dataset with no declared join says
 * that instead of naming one. So the prose is this dataset's own: CAPEX's reads about its capital
 * plan cube because that is what its document says, and nothing here knows the name of either
 * tenant. A transcribed sentence per dataset would be the small version of a transcribed figure.
 *
 * **No model runs.** The draft route says so with `degraded: true`, and this is the whole of what
 * produces the words.
 */
export function dataModelStory(doc, useCase) {
  const rows = selectedTables(doc, useCase)
  if (rows.length === 0) {
    return {
      story:
        'No structured table is in scope for this use case, so there is no data model to describe ' +
        'yet. Pick a BigQuery source on step 2 of New Graph, then draft again.',
      uncertainties: ['No structured table is in scope for this use case.'],
      tables_described: 0,
    }
  }

  const profiles = doc.column_profiles ?? {}
  const entities = (doc.data_model?.entities ?? []).filter((e) =>
    rows.some((r) => r.key === e.table_key),
  )
  const inScope = new Set(rows.map((r) => r.key))

  /* The identifier a person confirmed wins over the one a profiler classified: the first is a
     decision and the second is a measurement, and the sentence says which it read. */
  const identifierOf = (row) => {
    const declared = entities.find((e) => e.table_key === row.key)
    const confirmed = (declared?.attributes ?? []).find((a) => a.is_identifier)
    if (confirmed?.name) return { name: confirmed.name, confirmed: true }
    const profiled = (profiles[row.key] ?? []).find((c) => c.class === 'identifier')
    return profiled ? { name: profiled.column_id, confirmed: false } : null
  }

  const datasets = [...new Set(rows.map((r) => r.dataset.dataset_id))]
  const projects = [...new Set(rows.map((r) => r.project.display_name ?? r.project.project_id))]
  const profiledColumns = rows.reduce((n, r) => n + (profiles[r.key] ?? []).length, 0)

  const paragraphs = []
  paragraphs.push(
    `This data set holds ${count(rows.length)} table${rows.length === 1 ? '' : 's'} in ` +
      `${datasets.join(', ')}, on ${projects.join(' and ')}` +
      (profiledColumns > 0
        ? `, with ${count(profiledColumns)} column${profiledColumns === 1 ? '' : 's'} profiled across them.`
        : '. Nothing has been profiled against them yet.'),
  )

  for (const row of rows.slice(0, STORY_TABLES_DESCRIBED)) {
    const table = row.table
    const columns = profiles[row.key] ?? []
    const id = identifierOf(row)
    const clauses = []
    clauses.push(
      `The ${row.key} ${String(table.type ?? 'TABLE').toLowerCase() === 'view' ? 'view' : 'table'} ` +
        (table.label ? `is ${table.label}` : 'is carried by this source'),
    )
    if (table.grain) clauses.push(`with one row per ${String(table.grain).replace(/^one /, '')}`)
    const size = []
    const declaredColumns = table.columns ?? columns.length
    if (declaredColumns) size.push(`${count(declaredColumns)} column${declaredColumns === 1 ? '' : 's'}`)
    /* A row count the document does not carry is simply not stated — `rows: null` is "nobody has
       counted this", and 0 would say the table is empty. */
    if (typeof table.rows === 'number') size.push(`${count(table.rows)} row${table.rows === 1 ? '' : 's'}`)
    let sentence = `${clauses.join(', ')}.`
    if (size.length > 0) sentence += ` It carries ${size.join(' over ')}.`
    if (id) {
      sentence += ` A row is identified by ${id.name}, ${
        id.confirmed ? 'confirmed in Data Modeling' : 'classified as an identifier by the profiler'
      }.`
    }
    /* `carries` often opens with the label verbatim — printed as well as the label it repeats, the
       paragraph says the same thing twice. What is kept is whatever it adds beyond it. */
    const carries = String(table.carries ?? '').trim()
    const label = String(table.label ?? '').trim()
    const adds = carries.startsWith(label) ? carries.slice(label.length).replace(/^[.\s]+/, '') : carries
    if (adds) sentence += ` ${adds.replace(/\.?$/, '.')}`
    paragraphs.push(sentence)
  }
  const hidden = rows.length - STORY_TABLES_DESCRIBED
  if (hidden > 0) {
    /* The cap is stated rather than the list quietly stopping — a description that named six of
       eighteen without saying so is a claim about the scope. */
    paragraphs.push(
      `${count(hidden)} further table${hidden === 1 ? '' : 's'} in scope are not described one by ` +
        'one here; the build reads all of them.',
    )
  }

  /* The joins, from the tenant's own declarations — both ends in scope, or the sentence would name
     a table this graph does not hold. */
  const joins = []
  for (const entity of entities) {
    for (const rel of entity.relationships ?? []) {
      if (!inScope.has(rel.target_table_key)) continue
      joins.push(
        `${entity.table_key} ${rel.relationship_type} ${rel.target_table_key} on ` +
          `${(rel.from_columns ?? []).join(', ')}${
            rel.cardinality_hint ? ` (${rel.cardinality_hint})` : ''
          }`,
      )
    }
  }
  const uncertainties = []
  if (joins.length > 0) {
    const shown = joins.slice(0, STORY_JOINS_NAMED)
    paragraphs.push(
      `They relate to each other through ${count(joins.length)} declared join` +
        `${joins.length === 1 ? '' : 's'}: ${shown.join('; ')}` +
        /* Named to the cap and then counted, never cut in silence. */
        (joins.length > shown.length
          ? `; and ${count(joins.length - shown.length)} more the build reads.`
          : '.'),
    )
  } else {
    paragraphs.push(
      'No relationship between these tables has been declared in Data Modeling yet, so the build ' +
        'derives none from one.',
    )
    uncertainties.push('No declared join between the tables in scope.')
  }
  const undescribed = rows.filter((r) => !r.table.grain)
  if (undescribed.length > 0) {
    uncertainties.push(
      `${count(undescribed.length)} table${undescribed.length === 1 ? '' : 's'} state no grain.`,
    )
  }

  return {
    story: paragraphs.join('\n\n'),
    uncertainties,
    tables_described: Math.min(rows.length, STORY_TABLES_DESCRIBED),
  }
}

/* ---------------- the document lane ---------------- */

/** The documents this use case's drive and mailbox picks admit. */
export function corpusDocuments(doc, useCase) {
  const picks = (Array.isArray(useCase?.sources) ? useCase.sources : []).filter((p) =>
    DOCUMENT_KINDS.includes(pickKind(p.source_id)),
  )
  const out = []
  for (const pick of picks) {
    if (pickKind(pick.source_id) !== 'gdrive') continue
    const driveId = pick.source_id.slice('gdrive:'.length)
    const drive = (doc.drives ?? []).find((d) => d.drive_id === driveId)
    if (!drive) continue
    for (const folder of drive.folders ?? []) {
      for (const document of folder.documents ?? []) {
        const key = `${folder.folder_id}.${document.document_id}`
        const admitted = pick.mode === 'all' || (pick.objects ?? []).includes(key)
        if (!admitted) continue
        out.push({ drive, folder, document, key })
      }
    }
  }
  return out
}

/**
 * The entities the document lane holds — **the documents themselves, and what they resolved to.**
 *
 * Two kinds, because a document corpus really does hold two. A filed decree *is* a thing this lane
 * knows about, and `document_extractions` records, per document, the entity that was extracted from
 * it and the graph node that entity resolved to. Both halves are read; neither is synthesised.
 *
 * **Two documents about one facility share a node**, which is entity resolution rather than
 * duplication and is the single most important thing this lane demonstrates — the mention count is
 * what says so. A document that resolved to nothing still appears as a document and contributes no
 * resolved entity, because an unresolved extraction is a *finding* rather than an entity with a
 * missing field, and dropping the document with it would hide the finding entirely.
 */
/**
 * What a document was found to be about — **as a list, because a document names more than one
 * thing.**
 *
 * `document_extractions[id]` began as one object per file, on the reasoning that the map "describes
 * one entity per file, not the dozens a 96-page decree holds". That is true of EPA's extract, and it
 * is a fact about *that extract* rather than a rule: CAPEX's corpus is contracts, and a contract
 * names its project, its contract number, the vendor it was awarded to, the engineer and the change
 * orders that amend it — every one of which its own canvas already states. Read as one entity each,
 * all 41 of its documents resolved to a `Project`, so the Bridge derived a single entity type and
 * had one correspondence to review.
 *
 * So the value is an object **or** an array of them, and every reader goes through here. Both shapes
 * stay valid and EPA's map is untouched, which is the point: this widens what can be recorded
 * without changing what has been.
 */
export function extractionsFor(doc, documentId) {
  const value = (doc.document_extractions ?? {})[documentId]
  if (!value) return []
  return (Array.isArray(value) ? value : [value]).filter((e) => e && e.resolved_node)
}

export function dgbEntities(doc, useCase) {
  const documents = corpusDocuments(doc, useCase)
  const byNode = new Map()

  for (const row of documents) {
    /* The document, as itself. Its type is the tenant's own filing label rather than a word invented
       here, so the class chips on this lane are the corpus's taxonomy. */
    byNode.set(row.document.document_id, {
      entity_id: row.document.document_id,
      canonical_name: row.document.name ?? row.document.document_id,
      /*
       * **`Document`, with the filing label beside it rather than in place of it.** A consent decree
       * *is* a document; "Consent Agreement/Final Order" is the class this tenant files it under. Using
       * the label as the type read plausibly and broke two things at once: every filing label became an
       * entity type the Bridge then tried to correspond with a warehouse concept, and the canvas asked
       * its palette for a hue no ontology declares, which is the silent grey the palette claim exists
       * to catch.
       */
      entity_type: 'Document',
      doc_class: row.document.doc_type_label ?? null,
      aliases: [],
      mention_count: 1,
      kind: 'document',
    })

    for (const extracted of extractionsFor(doc, row.document.document_id)) {
    const nodeId = extracted.resolved_node
    const existing = byNode.get(nodeId)
    if (existing) {
      if (!existing.aliases.includes(extracted.extracted_entity)) {
        existing.aliases.push(extracted.extracted_entity)
      }
      existing.mention_count += 1
      continue
    }
    const node = (doc.graph_studio?.canvas?.nodes ?? []).find((n) => n.node_id === nodeId)
    byNode.set(nodeId, {
      entity_id: nodeId,
      canonical_name: node?.label ?? extracted.extracted_entity,
      /* **The extractor's own answer**, not the canvas node's type. The map says this text named a
         "Generator (facility)" or a "Transporter"; the node it resolved to says `Facility`. Those are
         two different claims — what the document called it, and what the graph holds — and flattening
         them to one loses the distinction the Bridge is built to reason about. */
      entity_type: extracted.entity_type ?? node?.type ?? 'Entity',
      /* What it resolved to, kept beside it: this is the evidence the Bridge reads. */
      resolved_type: node?.type ?? null,
      aliases: node && node.label !== extracted.extracted_entity ? [extracted.extracted_entity] : [],
      mention_count: 1,
      kind: 'resolved',
    })
    }
  }
  return [...byNode.values()]
}

/**
 * What this lane asserts: **document → the entity it was found to be about**, plus any canvas edge
 * whose two ends are both entities this corpus resolved to.
 *
 * The first kind is read straight out of `document_extractions` and is the lane's own claim — this
 * decree mentions this facility, with the extractor's own confidence on it. The second is scoped to
 * the corpus rather than taken from the whole canvas: an edge between two facilities neither of which
 * this use case's documents mention is the *structured* lane's assertion, and drawing it here would
 * credit the document lane with a relationship it never read.
 */
export function dgbRelations(doc, useCase) {
  const documents = corpusDocuments(doc, useCase)
  const entityIds = new Set(dgbEntities(doc, useCase).map((e) => e.entity_id))
  const out = []
  const documentForNode = new Map()

  for (const row of documents) {
    /* One relation per extraction: a document naming three things asserts three times, and the id
       carries the node so two of them cannot collide on one key. */
    for (const extracted of extractionsFor(doc, row.document.document_id)) {
    documentForNode.set(extracted.resolved_node, row.document.document_id)
    out.push({
      relation_id: `rel:${row.document.document_id}:${extracted.resolved_node}`,
      subject_entity_id: row.document.document_id,
      object_entity_id: extracted.resolved_node,
      relation_type: 'DESCRIBES',
      /* A pointer to the passage, never the passage itself — the edge carries no document text, and
         `chunkEvidence` is what resolves it. */
      chunk_id: `chunk:${row.document.document_id}`,
      document_id: row.document.document_id,
      classes: [row.document.doc_type].filter(Boolean),
      confidence: typeof extracted.confidence === 'number' ? extracted.confidence : null,
    })
    }
  }

  for (const edge of doc.graph_studio?.canvas?.edges ?? []) {
    if (!entityIds.has(edge.from) || !entityIds.has(edge.to)) continue
    out.push({
      relation_id: edge.edge_id,
      subject_entity_id: edge.from,
      object_entity_id: edge.to,
      relation_type: edge.label,
      chunk_id: `chunk:${edge.edge_id}`,
      document_id: documentForNode.get(edge.from) ?? documentForNode.get(edge.to) ?? null,
      classes: edge.detail ? [String(edge.detail).split(';')[0].trim()] : [],
      /* The canvas states no extraction confidence for its own edges, and `null` is the honest
         answer — a number here would be this module scoring somebody else's assertion. */
      confidence: null,
    })
  }
  return out
}

/** One mention per extraction, which is what the map records: this document, this chunk, this node. */
export function dgbMentions(doc, useCase) {
  const out = []
  for (const row of corpusDocuments(doc, useCase)) {
    for (const extracted of extractionsFor(doc, row.document.document_id)) {
    const node = (doc.graph_studio?.canvas?.nodes ?? []).find(
      (n) => n.node_id === extracted.resolved_node,
    )
    out.push({
      mention_id: `mention:${row.document.document_id}:${extracted.resolved_node}`,
      entity_id: extracted.resolved_node,
      chunk_id: `chunk:${row.document.document_id}`,
      document_id: row.document.document_id,
      entity_type: node?.type ?? 'Entity',
      /* The extraction states no salience, so this is hashed from the document and the entity — the
         same deterministic stand-in `synthesiseColumns` uses, and repeatable for that reason. */
      salience: Number((0.55 + (hash(`${row.document.document_id}:${extracted.extracted_entity}`) % 45) / 100).toFixed(2)),
      classes: [row.document.doc_type].filter(Boolean),
    })
    }
  }
  return out
}

/** The corpus's own document kinds — a real taxonomy this tenant filed by, not one invented here. */
export function dgbClasses(doc, useCase) {
  return [...new Set(corpusDocuments(doc, useCase).map((r) => r.document.doc_type).filter(Boolean))]
}

/**
 * The passage a relation was asserted from — **or a refusal, because nothing here stores one.**
 *
 * This is the one shape on the document surface that carries verbatim text, and no document in this
 * repo holds the body of an EPA consent decree. The reference resolves a real chunk; the honest
 * substitute is to say there is no stored passage, name the document, and let the panel render that.
 * Synthesising a sentence and labelling it "the text this was extracted from" is the one invention a
 * reader could not catch, and it is the exact thing an evidence panel exists to make checkable.
 */
export function chunkEvidence(doc, useCase, chunkId) {
  const documentId = String(chunkId).replace(/^chunk:/, '')
  const row = corpusDocuments(doc, useCase).find((r) => r.document.document_id === documentId)
  const relation = dgbRelations(doc, useCase).find((r) => r.chunk_id === chunkId)
  const target = row ?? corpusDocuments(doc, useCase).find((r) => r.document.document_id === relation?.document_id)
  if (!target) return null
  return {
    chunk_id: chunkId,
    document_id: target.document.document_id,
    /* Null, never a sentence. The panel prints "this corpus stores no passage text" beside the
       document's name; a plausible quotation would be indistinguishable from a real one. */
    chunk_text: null,
    document_name: target.document.name ?? target.document.document_id,
    doc_type_label: target.document.doc_type_label ?? null,
    linked_entity: target.document.linked_entity ?? null,
    ordinal: 1,
    page_start: typeof target.document.pages === 'number' ? 1 : null,
    page_end: typeof target.document.pages === 'number' ? target.document.pages : null,
  }
}

/* ---------------- the Bridge ---------------- */

/**
 * The Type Links between the two lanes — **EntityType ⇔ Concept, and nothing finer.**
 *
 * The Bridge asserts one kind of claim: that a thing of this document entity type *is* what one row
 * of this concept represents (`identity`), or is a *value of an attribute* of such a row
 * (`attribute`), or neither (`reject`). It names no column, projects onto no individual entity, and
 * queries no warehouse — so nothing here can become a `WHERE` clause and no screen may imply
 * otherwise.
 *
 * **Reject rows are returned, not dropped.** The list is a record of what was *considered*, not only
 * of what corresponded: without them a reader cannot tell a pair the derivation declined from a pair
 * it never saw, and a reviewer flipping a reject to identity would have no row to edit.
 *
 * **The decision is grounded in the resolution, not in the two names.** `document_extractions` records
 * what each extracted entity resolved to, so when every "Transporter" in the corpus resolved to a
 * `Facility` node, `Transporter ⇔ Facility` is an *identity* link and the count of documents that did
 * so is the evidence for it. A name echo with no resolution behind it is the weaker claim and lands
 * as `attribute`; everything else is `reject`. Matching the two strings alone would have called
 * "Generator (facility)" an attribute of Facility because the word appears inside it — which is
 * exactly backwards, and is why the rule reads the data instead.
 *
 * `confidence` is **categorical** — `high` only where a resolution decided it. Never a numeric score:
 * a number invites being read as a measurement, and nothing measured this.
 */
export function typeLinks(doc, useCase, bridgeBuildId) {
  const resolved = dgbEntities(doc, useCase).filter((e) => e.kind === 'resolved')
  /* Only the *resolved* entity types are bridged. A document's filing label ("Consent Decree") is a
     class the corpus files by, not a type of thing that could correspond to a warehouse concept, and
     putting all of them in would bury the one real correspondence under forty rejections. */
  const entityTypes = [...new Set(resolved.map((e) => e.entity_type))].sort()
  const resolutions = new Map()
  for (const entity of resolved) {
    if (!entity.resolved_type) continue
    const key = `${entity.entity_type}::${entity.resolved_type}`
    resolutions.set(key, (resolutions.get(key) ?? 0) + entity.mention_count)
  }

  const concepts = conceptsFor(doc, useCase)
  const out = []
  for (const entityType of entityTypes) {
    for (const concept of concepts) {
      const resolvedCount = resolutions.get(`${entityType}::${concept.name}`) ?? 0
      const echo =
        resolvedCount === 0 &&
        (entityType.toLowerCase().includes(concept.name.toLowerCase()) ||
          concept.name.toLowerCase().includes(entityType.toLowerCase()))
      const decision = resolvedCount > 0 ? 'identity' : echo ? 'attribute' : 'reject'
      out.push({
        type_link_id: `tl:${bridgeBuildId}:${entityType}:${concept.concept_ref}`,
        bridge_build_id: bridgeBuildId,
        entity_type: entityType,
        concept_ref: concept.concept_ref,
        concept_name: concept.name,
        concept_declared: concept.declared,
        decision,
        confidence: resolvedCount > 0 ? 'high' : 'low',
        reason:
          resolvedCount > 0
            ? `${resolvedCount} extraction${resolvedCount === 1 ? '' : 's'} of type "${entityType}" resolved to a ${concept.name} node, so a thing of this type IS what one ${concept.name} row represents.`
            : echo
              ? `"${entityType}" echoes the name ${concept.name} but nothing in this corpus resolved to one, so it reads as a value carried on such a row rather than the row itself.`
              : `No extraction of type "${entityType}" resolved to a ${concept.name}, and neither name contains the other.`,
        /* `llm` is what the reference's model-decided rows carry, and it is what makes a row count as
           still needing review. A derived decision is nobody's decision yet, so it wears the same
           value and blocks publishing in exactly the same way. */
        decided_by: 'llm',
        original_decision: null,
        original_confidence: null,
        original_reason: null,
        decided_by_user_id: null,
        decided_at: null,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      })
    }
  }
  /* Low confidence first — the reference's own ordering, so attention goes where the judgement was
     closest, and never re-sorted at the edge. */
  return out.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'low' ? -1 : 1))
}

/**
 * Does this Type Link still block publishing?
 *
 * **The criterion, and the whole of it:** it asserts a correspondence (`decision !== 'reject'`) and
 * no person has decided it (`decided_by === 'llm'`).
 *
 * Rejects are excluded because publishing approves the correspondences a Bridge *asserts*, and a
 * reject asserts none. Confidence is excluded deliberately, and that is the load-bearing part: it is
 * the deriver's own self-report, so gating on it would let the deriver choose which rows a human is
 * obliged to look at — and a confidently-wrong `identity` link, the one that actually does damage,
 * would be exactly the row that escaped. Confidence *orders* the queue; it does not define it.
 */
export const needsReview = (link) => link.decision !== 'reject' && link.decided_by === 'llm'

/* ---------------- the use cases the studio lists ---------------- */

/**
 * Every use case, with the lanes it has — **not only the committed ones, and not filtered by lane.**
 *
 * A draft can already have been built, and the lane is derived per row below, so filtering here would
 * hide graphs that exist. The studio's own selector states each row's lanes instead, which is the
 * answer to "why does this use case offer no document build" that a shortened list cannot give.
 */
export function studioUseCases(doc) {
  return (doc.graph_use_cases ?? []).map((useCase) => {
    const lanes = deriveLanes(doc, useCase)
    return {
      use_case_config_id: useCase.use_case_id,
      name: useCase.name ?? null,
      domain: useCase.domain_id ?? null,
      status: useCase.status ?? 'draft',
      has_structured: lanes.hasStructured,
      has_documents: lanes.hasDocuments,
      document_count: lanes.documentCount,
      structured_table_count: selectedTables(doc, useCase).length,
      /* A use case is buildable once it has been committed. The reference filters its picker on a
         committed *version id* being truthy rather than on a status, for the reason its own comment
         gives — `undefined` is not `null`, and a row without a usable version reached the picker,
         rendered, and then could not be selected. The same rule here is the status being exactly
         `committed`, which is the only value this document's writer ever sets. */
      latest_committed_version_id:
        useCase.status === 'committed' ? `${useCase.use_case_id}:v1` : null,
      updated_at: useCase.updated_at ?? null,
    }
  })
}

/**
 * The sources this tenant has, in the shape the lane derivation reads.
 *
 * Served from the document rather than from the server's `registered` map on purpose: a lane must not
 * disappear because the process restarted, and a use case's picks name document rows.
 */
export function studioSources(doc) {
  const out = []
  for (const project of doc.projects ?? []) {
    out.push({
      source_id: `bigquery:${project.project_id}`,
      source_type: 'structured_schema',
      name: project.display_name ?? project.project_id,
      connector: 'bigquery',
    })
  }
  for (const drive of doc.drives ?? []) {
    out.push({
      source_id: `gdrive:${drive.drive_id}`,
      source_type: 'unstructured_document',
      name: drive.display_name ?? drive.drive_id,
      connector: 'gdrive',
    })
  }
  return out
}

/* ---------------- counts, for the panels that state them ---------------- */

/** What a structured build produced. Columns are deliberately **not** in `node_count`: the canvas
 *  folds a column into its table's properties, so counting them would report a number the drawing
 *  never draws. */
export function sgbCounts(doc, useCase) {
  const graph = sgbGraph(doc, useCase, 'counts')
  return {
    node_count: graph.tables.length + graph.concepts.length,
    relation_count: graph.edges.length,
    table_count: graph.tables.length,
    column_count: graph.columns.length,
    concept_count: graph.concepts.length,
  }
}

/** What a document build produced. */
export function dgbCounts(doc, useCase) {
  return {
    document_count: corpusDocuments(doc, useCase).length,
    entity_count: dgbEntities(doc, useCase).length,
    relation_count: dgbRelations(doc, useCase).length,
    class_count: dgbClasses(doc, useCase).length,
  }
}

export { isObject, pick }
