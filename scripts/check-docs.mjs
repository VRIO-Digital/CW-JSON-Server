#!/usr/bin/env node
/**
 * Doc-drift gate.
 *
 * CLAUDE.md and SKILLS.md state facts about the code — how many connectors
 * exist, what the pipeline stages are called, which db.json keys are required.
 * Those go stale silently as features land, and a confidently wrong doc is worse
 * than no doc, because the next session trusts it.
 *
 * This asserts the claims against the source. When it fails, the code and the
 * docs disagree: fix whichever is wrong. Do not delete the assertion to pass.
 *
 *   node scripts/check-docs.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const problems = []
const checked = []

const ok = (label, detail) => checked.push(`${label} — ${detail}`)
const bad = (label, detail) => problems.push(`${label}: ${detail}`)

/** Asserts a condition, recording either way. */
function expect(label, condition, detail) {
  if (condition) ok(label, detail)
  else bad(label, detail)
}

/* ---------------- the documents must exist ---------------- */

for (const file of ['CLAUDE.md', 'SKILLS.md', 'docs/REGRESSIONS.md']) {
  if (!existsSync(join(root, file))) {
    bad(file, 'is missing — the work loop depends on it')
  }
}
if (problems.length > 0) {
  console.error('check-docs: FAILED\n')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

const claude = read('CLAUDE.md')
const skills = read('SKILLS.md')
const server = read('mock-server/server.mjs')
const connectors = read('src/data/connectors.ts')
const indexCss = read('src/index.css')
const theme = read('src/theme.ts')
const nav = read('src/nav.ts')
const jobsTab = read('src/components/ProfilingJobsTab.tsx')
const client = read('src/api/client.ts')
const wizard = read('src/components/ConnectSourceWizard.tsx')

/* ---------------- connectors ---------------- */

/*
 * Asserted by name rather than by a count in prose: a count can be written as a
 * word, and a stale hardcoded fallback would make the check pass forever. Adding
 * a connector fails this until SKILLS.md mentions it, which is the point.
 */
// `\r?\n` on both sides: git checks these files out with CRLF on Windows, and a
// split that assumed LF found zero connectors and reported "0 of 0 available"
// — a stale-doc failure that was really a stale regex.
const connectorBlocks = connectors.split(/\r?\n {2}\{\r?\n/).slice(1)
const connectorList = connectorBlocks
  .map((block) => ({
    name: (block.match(/name: '([^']+)'/) ?? [])[1],
    available: /available: true/.test(block),
    hasReason: /reason:/.test(block),
  }))
  .filter((c) => c.name)

/**
 * Prose says "BigQuery", not "Google BigQuery" — so match the distinctive part
 * of the name, not the whole vendor string. Still fails for a connector nobody
 * mentioned, which is what this is for.
 */
const distinctive = (name) =>
  name.replace(/^Google /, '').replace(/ bucket$/, '').trim()

for (const c of connectorList) {
  const token = distinctive(c.name)
  expect(
    `connector "${c.name}" documented`,
    skills.includes(c.name) ||
      claude.includes(c.name) ||
      skills.includes(token) ||
      claude.includes(token),
    `${c.available ? 'available' : 'vision'} — "${token}" must appear in SKILLS.md flow 1`,
  )
  if (!c.available) {
    expect(
      `connector "${c.name}" explains itself`,
      c.hasReason,
      'an unavailable connector needs a `reason`, or the card does nothing when clicked',
    )
  }
}

expect(
  'at least one connector is usable',
  connectorList.some((c) => c.available),
  `${connectorList.filter((c) => c.available).length} of ${connectorList.length} available`,
)

/*
 * Every connector needs its own mark.
 *
 * `ConnectorIcon` used to fall back to `BigQueryIcon`, so the five connectors
 * without one were each drawn as BigQuery — a card claiming to be a product it is
 * not, and invisible while nothing rendered those five. The fallback is neutral
 * now, but a missing mark would still be a grey cylinder where a logo belongs, so
 * adding a connector fails this until it has one.
 */
const iconSource = read('src/components/ConnectorIcon.tsx')
/* Found in two steps, not one pattern: the declaration's type annotation is
   `Record<string, (props: { size?: number }) => JSX.Element>`, which carries both
   an `=` and a `{`, so `[^=]*= \{` stopped inside it and reported zero marks —
   the same false-empty a bare `\n` split once caused for connectors. */
const marksStart = iconSource.indexOf('const MARKS')
const marksBody =
  marksStart < 0
    ? ''
    : iconSource.slice(iconSource.indexOf('= {', marksStart) + 3).split('\n}')[0]
const markedKeys = [...marksBody.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
const connectorKeys = [...connectors.matchAll(/^ {4}key: '(\w+)',/gm)].map((m) => m[1])
expect(
  'every connector key has a mark',
  connectorKeys.length > 0 &&
    connectorKeys.every((k) => markedKeys.includes(k)),
  `keys ${connectorKeys.join(',')} · marks ${markedKeys.join(',')}`,
)
expect(
  'an unknown connector falls back to the neutral mark, not a vendor one',
  /GenericSourceIcon size=\{size\} label=\{connector\}/.test(iconSource) &&
    !/return <BigQueryIcon size=\{size\} \/>\s*\n\}/.test(iconSource),
  'a wrong vendor logo is a claim, not a default',
)

/* ---------------- profiling pipeline ---------------- */

const pipelineBlock = server.match(/const PIPELINE = \[([\s\S]*?)\]/)
const stages = pipelineBlock
  ? [...pipelineBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : []

expect('pipeline stage count', stages.length === 5, `${stages.length} stages in server.mjs`)

for (const stage of stages) {
  expect(
    `stage "${stage}" documented`,
    skills.includes(stage) || claude.includes(stage),
    'must appear in SKILLS.md flow 3',
  )
}

expect(
  'pipeline stage total in docs',
  skills.includes(`${stages.length} stages`) || skills.includes(`5/5`),
  `SKILLS.md should reflect ${stages.length}`,
)

/* ---------------- db.json required keys ---------------- */

const shapeBlock = server.match(/const DB_SHAPE = \{([\s\S]*?)\n\}/)
const requiredKeys = shapeBlock
  ? [...shapeBlock[1].matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])
  : []

expect('db required-key count', requiredKeys.length > 0, `${requiredKeys.length} keys guarded`)

/*
 * Every document that states the number must state the right one.
 *
 * This used to be one `||` across both files, so a true claim in CLAUDE.md
 * covered for a stale "19 required keys" in SKILLS.md — the check passed while a
 * doc was wrong, which is the exact failure it exists to catch. Now each file is
 * asserted where it makes the claim, and a file that does not make it is not
 * required to.
 */
for (const [file, text] of [
  ['CLAUDE.md', claude],
  ['SKILLS.md', skills],
]) {
  const stated = [...text.matchAll(/(\d+) required keys?/g)].map((m) => Number(m[1]))
  if (stated.length === 0) continue
  expect(
    `${file} states the right required-key count`,
    stated.every((n) => n === requiredKeys.length),
    `code guards ${requiredKeys.length}, ${file} says ${stated.join(', ')}`,
  )
}
expect(
  'the required-key count is documented somewhere',
  /\d+ required keys?/.test(claude) || /\d+ required keys?/.test(skills),
  `code guards ${requiredKeys.length}: ${requiredKeys.join(', ')}`,
)

const db = JSON.parse(read('mock-server/db.json'))
const dbKeys = Object.keys(db)
for (const key of requiredKeys) {
  expect(`db.json has "${key}"`, dbKeys.includes(key), 'DB_SHAPE requires it')
}

/* ---------------- a required name is a shown name ---------------- */

/*
 * The rule below makes a source name mandatory. That is only worth anything if
 * the name is then visible where a source is identified — the Catalogue card and
 * its detail header, which otherwise show `bigquery:<project>` and nothing a user
 * chose. Matched on the field being read, not on a class name, so a restyle does
 * not fail this and a deletion does.
 */
const cataloguePage = read('src/pages/CataloguePage.tsx')
expect(
  'the Catalogue names each source, not just its id',
  (cataloguePage.match(/\{s\.sourceName\}|\{selected\.sourceName\}/g) ?? []).length >= 2,
  'the card and the detail header both render sourceName',
)

/* ---------------- the source-name rule is one rule ---------------- */

/*
 * The floor is written twice — once in `server.mjs`, which refuses the write, and
 * once in `src/data/sourceName.ts`, which refuses before the round trip. Drift
 * between them is invisible in the worst direction: a client that allows 4 turns
 * a typed name into a 400 the user cannot act on, and a client stricter than the
 * server just blocks work for no stated reason.
 */
const serverMin = Number(server.match(/const SOURCE_NAME_MIN = (\d+)/)?.[1] ?? NaN)
const sourceNameData = read('src/data/sourceName.ts')
const clientMin = Number(sourceNameData.match(/SOURCE_NAME_MIN = (\d+)/)?.[1] ?? NaN)
expect(
  'the source-name floor agrees on both sides',
  Number.isFinite(serverMin) && serverMin === clientMin,
  `server ${serverMin} · client ${clientMin}`,
)

/*
 * And it must actually be enforced where a source gets registered. All three
 * endpoints, because the stubbed connectors land in the same Sources table — and
 * no id fallback, which is what made the field optional in practice even while
 * the form asked for it.
 */
for (const route of ['/sources', '/sources/drive', '/sources/generic']) {
  const block = (server.split(`p === '${route}'`)[1] ?? '').slice(0, 2600)
  expect(
    `POST ${route} refuses a bad source_name`,
    /sourceNameProblem\(source_name\)/.test(block),
    'every register endpoint runs the shared validator',
  )
}
expect(
  'no register endpoint falls back to an id for the name',
  !/source_name \|\| (project|drive)\./.test(server) &&
    !/sourceName: sourceName \|\|/.test(wizard),
  'a row named after its project id reads as a name and is not one',
)

/* ---------------- the consent screen lists every scope ---------------- */

/*
 * The sign-in dialog renders the scopes `/sources/oauth/start` returned, and
 * looks their wording up by URL. An unmapped scope still renders — as its bare
 * URL, which is honest but unexplained — so the failure is silent by design.
 * This catches it: every scope the server can issue must have copy.
 *
 * Drive is why this exists. It asks for two scopes, and the first version of the
 * dialog described one.
 */
const serverScopes = [
  ...new Set(
    [...server.matchAll(/'(https:\/\/www\.googleapis\.com\/auth\/[\w.]+)'/g)].map(
      (m) => m[1],
    ),
  ),
]
const consentData = read('src/data/consentStages.ts')
expect(
  'the server issues scopes the dialog can describe',
  serverScopes.length > 0,
  `${serverScopes.length} scope(s) found in server.mjs`,
)
for (const scope of serverScopes) {
  expect(
    `scope ${scope.replace('https://www.googleapis.com/auth/', '')} has consent copy`,
    consentData.includes(`'${scope}'`),
    'add it to CONSENT_GRANT_COPY or the consent screen shows a bare URL',
  )
}

/*
 * And the panel must list what the response reported, not a per-provider
 * constant. `CONSENT_SCOPES` stays as the fallback for the moment before that
 * first call returns; what must not come back is a footer that renders only it.
 */
expect(
  'the consent panel lists the reported scopes',
  /scopes\?: string\[\]/.test(read('src/components/GoogleConsentPanel.tsx')) &&
    /scopes=\{oauthScopes\}/.test(wizard),
  'the wizard holds start.scopes and the panel renders them',
)

/* ---------------- the real column profile is the one served ---------------- */

/*
 * `column_profiles` holds the 206 columns ingested from
 * `02_profiling/Metadata_Profiling.xlsx`. Losing the branch that reads it does
 * not throw — `tableDictionary` falls back to synthesis, and the catalogue serves
 * invented columns that look exactly as plausible. So both halves are asserted:
 * the data is there, and the code prefers it.
 */
expect(
  'tableDictionary prefers the real profile',
  /db\.column_profiles\?\.\[`\$\{datasetId\}\.\$\{tableId\}`\]/.test(server) &&
    /function synthesiseColumns/.test(server),
  'real columns first, synthesis only as the fallback',
)

const profiles = db.column_profiles ?? {}
const profileKeys = Object.keys(profiles)
expect(
  'column_profiles covers every view of every dataset in db.json',
  db.projects.every((p) =>
    p.datasets.every((d) =>
      d.tables.every((t) => profileKeys.includes(`${d.dataset_id}.${t.table_id}`)),
    ),
  ),
  `profiled: ${profileKeys.join(', ')}`,
)

for (const project of db.projects ?? []) {
  for (const dataset of project.datasets ?? []) {
    for (const table of dataset.tables ?? []) {
      const columns = profiles[`${dataset.dataset_id}.${table.table_id}`] ?? []
      expect(
        `${table.table_id} profiles exactly the ${table.columns} columns it claims`,
        columns.length === table.columns,
        `catalogue says ${table.columns}, column_profiles has ${columns.length}`,
      )
      expect(
        `${table.table_id} column ids are unique`,
        new Set(columns.map((c) => c.column_id)).size === columns.length,
        'a duplicate id would collide in the dictionary and in column_notes',
      )
    }
  }
}

/*
 * Class facets fold classes together (`location` is `address` + `geo`), so the
 * server's arithmetic and the panel's filter have to agree on which classes go in
 * which chip — otherwise a chip counts 69 and lists 41.
 */
const columnsPanel = read('src/components/ProfiledColumnsPanel.tsx')
const profiledClasses = [
  ...new Set(Object.values(profiles).flatMap((cs) => cs.map((c) => c.class))),
].sort()
expect(
  'every class in the data is in the client union',
  profiledClasses.every((c) => new RegExp(`\\| '${c}'|'${c}',`).test(client)),
  `classes in use: ${profiledClasses.join(', ')}`,
)
const facetBlockCols = server.match(/const facets = \{([\s\S]*?)\n {6}\}/)
const serverColumnFacets = facetBlockCols
  ? [...facetBlockCols[1].matchAll(/^\s*(\w+): 0,/gm)].map((m) => m[1])
  : []
const panelFacetKeys = [
  ...(columnsPanel.match(/const FACETS[\s\S]*?\n\]/)?.[0] ?? '').matchAll(
    /key: '(\w+)'/g,
  ),
].map((m) => m[1])
expect(
  'the column facets match end to end',
  serverColumnFacets.length > 0 &&
    JSON.stringify([...serverColumnFacets].sort()) ===
      JSON.stringify([...panelFacetKeys].sort()),
  `server ${serverColumnFacets.join(',')} · panel ${panelFacetKeys.join(',')}`,
)
expect(
  'every profiled class lands in a facet or is deliberately unfaceted',
  /address' \|\| c\.class === 'geo'/.test(server) && /'flag'/.test(server),
  'address+geo fold into location, flag into flags',
)

/* ---------------- the canvas ---------------- */

/*
 * The canvas draws the demo package's knowledge graph, and the package is the source
 * of truth. Every claim here compares db.json against
 * 05_knowledge_graph/knowledge_graph.json, so a hand-edit to either side shows up as
 * a disagreement rather than as a picture that quietly no longer matches the data.
 */
const kgPath = ' _demo_data_package_2026-08-10/05_knowledge_graph/knowledge_graph.json'
const kg = existsSync(kgPath) ? JSON.parse(read(kgPath)) : null
const canvas = db.graph_studio.canvas

expect(
  'the canvas holds every relationship the knowledge graph states',
  kg === null || canvas.edges.length === kg.edges.length,
  kg === null
    ? 'the package is not in this checkout — nothing to compare against'
    : `${canvas.edges.length} edges vs ${kg.edges.length} in the package`,
)
expect(
  'and every node it lists, plus the four endpoints its roster omits',
  kg === null || canvas.nodes.length === kg.nodes.length + 4,
  kg === null ? 'package absent' : `${canvas.nodes.length} vs ${kg.nodes.length} + 4`,
)
/*
 * The failure this replaces: 20 edges pointed at ids the roster did not contain, so
 * they were skipped while drawing and 17 facilities appeared to have no enforcement
 * at all. Silence is the wrong answer for a missing relationship, so it fails at boot.
 */
const canvasNodeIds = new Set(canvas.nodes.map((n) => n.node_id))
expect(
  'no canvas edge points at a node that is not there',
  canvas.edges.every((e) => canvasNodeIds.has(e.from) && canvasNodeIds.has(e.to)),
  'an unresolved endpoint is drawn as nothing at all',
)
expect(
  'and the server refuses a document with one, rather than drawing nothing',
  /graph_studio\.canvas has an edge whose \$\{side\} is/.test(server),
  'validateDb checks the endpoints across keys',
)
expect(
  'every node carries its type, its provenance and its own size',
  canvas.nodes.every(
    (n) => n.type && n.source && typeof n.degree === 'number' && typeof n.r === 'number',
  ),
  'source is the catalogue object; r is the degree, not a styling choice',
)
expect(
  'the structured nodes name the profiled tables the catalogue lists',
  ['FRS_Facility_profile', 'e_manifest', 'e_manifest_all', 'RCRA_compliance'].every((t) =>
    canvas.nodes.some((n) => n.source.includes(t)),
  ),
  [...new Set(canvas.nodes.map((n) => n.source))].length + ' distinct sources',
)
expect(
  'and the document nodes name the Drive folder and the file',
  canvas.nodes
    .filter((n) => n.group === 'document')
    .every((n) => /^Compliance Docs · 08_unstructured\/.+\.pdf$/.test(n.source)),
  'a node whose provenance is not on it is a claim taken on trust',
)
/*
 * Rendered text has no doubled or edge spaces.
 *
 * A repo-wide find/replace of "VLS" ran over the demo package as well as the app and
 * left labels reading "  Texas Molecular" — a gap where the word had been. Nothing
 * errors, and a label drawn inside a circle shows every space it has. Node *ids* are
 * exempt: they are opaque keys carrying the same damage on both ends of an edge, so
 * cleaning them would unmatch the edges.
 */
const renderedText = canvas.nodes.flatMap((n) => [n.label, n.sublabel, n.source])
expect(
  'no canvas label, sublabel or source has a doubled or edge space',
  renderedText.every((t) => t === t.trim() && !/ {2}/.test(t)),
  renderedText.filter((t) => t !== t.trim() || / {2}/.test(t)).slice(0, 3).join(' | ') ||
    `${renderedText.length} strings clean`,
)

/*
 * Colour is the origin class, and the four hues are validated pairwise. The ink on
 * each fill is *measured*, not chosen: white clears 4.5:1 on the blue and the
 * magenta but reaches only 2.8:1 on the green, so those take dark ink. A label
 * nobody can read is not a label, so the contrast is recomputed here.
 */
const legend = read('src/data/canvasLegend.ts')
const legendGroups = [
  ...legend.matchAll(/\{ key: '(\w+)', label: '[^']*', color: '(#[0-9a-f]{6})', ink: '(#[0-9a-f]{6})' \}/g),
].map((m) => ({ key: m[1], color: m[2], ink: m[3] }))
const relLum = (hex) => {
  const chan = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2]
}
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
expect(
  'the canvas has four origin classes, and the server agrees',
  legendGroups.length === 4 &&
    /const CANVAS_GROUPS = \['row', 'dimension', 'document', 'alias'\]/.test(server) &&
    legendGroups.every((g) => ['row', 'dimension', 'document', 'alias'].includes(g.key)),
  legendGroups.map((g) => g.key).join(', ') || 'parsed none — check the literal shape',
)
for (const g of legendGroups) {
  expect(
    `the label on the ${g.key} hue is readable (${g.ink} on ${g.color})`,
    contrast(g.color, g.ink) >= 4.5,
    `${contrast(g.color, g.ink).toFixed(2)}:1`,
  )
}
expect(
  'every origin class is used, so no legend row is a dead colour',
  legendGroups.every((g) => canvas.nodes.some((n) => n.group === g.key)),
  legendGroups
    .map((g) => `${g.key} ${canvas.nodes.filter((n) => n.group === g.key).length}`)
    .join(' · '),
)
/*
 * A proposed element exists because a review row is open — that is what makes the
 * canvas and the queue one truth rather than two pictures. An id on an element with
 * no row behind it would draw a dashed node nobody can ever settle.
 */
const reviewIds = new Set(db.graph_studio.review_items.map((i) => i.item_id))
expect(
  'every review_item_id on the canvas has a row in the queue',
  [...canvas.nodes, ...canvas.edges]
    .filter((x) => x.review_item_id)
    .every((x) => reviewIds.has(x.review_item_id)),
  `${[...canvas.nodes, ...canvas.edges].filter((x) => x.review_item_id).length} provisional elements`,
)
expect(
  'the queue is about this graph — its pools are the graph’s own types',
  kg === null ||
    kg.node_types.every((t) => db.graph_studio.generated.subjects.includes(t.type)),
  'synthesised rows must not name entities the canvas has never heard of',
)
expect(
  'and the pivot is the package’s own resolution question',
  /Texas Molecular LP/.test(db.graph_studio.pivot.title) &&
    db.graph_studio.pivot.options.length === 2,
  db.graph_studio.pivot.title,
)
/*
 * The query matcher. Both of its guards were paid for: a *kind* word ("facility",
 * "waste") once matched instances and answered about a pair nobody asked for, and a
 * uniqueness rule once refused to match "chemours" because the facility and its
 * consent decree share the name — the bridge the graph exists for.
 */
expect(
  'the query matcher stops type words and common words, not rare ones',
  /const kindWords = new Set\(\)/.test(server) &&
    /!kindWords\.has\(w\) && seenIn\.get\(w\) <= rareMax/.test(server),
  'rarity, plus the ontology’s own vocabulary as a stoplist',
)
expect(
  'the canvas has an ingest to re-run, and the docs name it',
  existsSync(join(root, 'scripts/ingest-knowledge-graph.mjs')) &&
    /"ingest:graph": "node scripts\/ingest-knowledge-graph\.mjs"/.test(read('package.json')) &&
    claude.includes('npm run ingest:graph'),
  'hand-editing 93 laid-out nodes is not a maintenance path',
)
expect(
  'the canvas sizes and positions come from the server, not the component',
  /r: n\.r,/.test(server) &&
    /viewBox=\{`0 0 \$\{box\.w\} \$\{box\.h\}`\}/.test(read('src/components/GraphCanvas.tsx')),
  'a hardcoded viewBox is a second opinion about the layout',
)

/* ---------------- the build pipeline ---------------- */

/*
 * `BUILD_STAGES` is what the Build tab renders verbatim and what SKILLS.md lists.
 * A stage added to the server without being documented shows up on screen as an
 * unexplained row — and printing the platform's own names is the whole reason they
 * can be looked up.
 */
const buildStagesBlock = server.match(/const BUILD_STAGES = \[([\s\S]*?)\r?\n\]/)
const buildStageEntries = buildStagesBlock
  ? [...buildStagesBlock[1].matchAll(/\{ key: '(\w+)', steps: \[([^\]]*)\] \}/g)].map((m) => ({
      key: m[1],
      steps: [...m[2].matchAll(/'(\w+)'/g)].map((s) => s[1]),
    }))
  : []
const buildStages = buildStageEntries.map((s) => s.key)
expect(
  'the build pipeline has stages',
  buildStages.length > 0,
  `${buildStages.length}: ${buildStages.join(' → ')}`,
)
for (const stage of buildStages) {
  expect(
    `build stage \`${stage}\` documented`,
    skills.includes(stage),
    'name it in SKILLS.md flow 8',
  )
}
/*
 * Every stage owns inner work, and no substep name is reused.
 *
 * A stage with no substeps renders as a row claiming work nobody can see — the
 * thing the substeps were added to fix. A duplicated name is worse than cosmetic:
 * the substep rows are keyed by it, so two rows in one stage would collide in
 * React and one of them would silently stop updating.
 */
const buildSteps = buildStageEntries.flatMap((s) => s.steps)
expect(
  'every build stage names its own substeps',
  buildStageEntries.length > 0 && buildStageEntries.every((s) => s.steps.length > 0),
  `${buildSteps.length} substeps across ${buildStageEntries.length} stages`,
)
expect(
  'no two build substeps share a name',
  new Set(buildSteps).size === buildSteps.length,
  'the rows are keyed by it',
)
expect(
  'the substeps are what advances, driven by one cursor',
  /const BUILD_STEPS = BUILD_STAGES\.flatMap/.test(server) &&
    /run\.cursor \+= 1/.test(server) &&
    !/run\.stage_index \+= 1[\s\S]{0,200}BUILD_STAGES\.length/.test(server),
  'a stage index kept alongside a step index is two counters that can disagree',
)
/*
 * The pace is documented, and the page derives from it rather than restating it.
 *
 * A build now takes minutes, not seconds, so the duration on screen is load-bearing:
 * a five-minute spinner with no estimate reads as wedged. That figure has to come
 * from the server's own number — the earlier band check asserted a total instead,
 * and a deliberate change to the pace would have failed it as if it were a bug.
 */
const buildStepMs = Number(
  ((server.match(/const BUILD_STEP_MS = ([\d_]+)/) ?? [])[1] ?? '0').replace(/_/g, ''),
)
const buildRunSecs = (buildStepMs * buildSteps.length) / 1000
/* "2m 35s" — the same shape `dur()` prints, so the docs quote the page. */
const buildRunLabel =
  buildRunSecs < 60
    ? `${buildRunSecs}s`
    : `${Math.floor(buildRunSecs / 60)}m${buildRunSecs % 60 ? ` ${buildRunSecs % 60}s` : ''}`
/* `\b` on the pace, because plain `includes('5s')` is satisfied by the "35s" in the
   total beside it — a claim that passes for the wrong reason is not a claim. */
const pacePattern = new RegExp(`\\b${buildStepMs / 1000}s\\b`)
expect(
  'the substep pace and the run length are documented as the server has them',
  buildStepMs > 0 &&
    [claude, skills].every((doc) => pacePattern.test(doc) && doc.includes(buildRunLabel)),
  `BUILD_STEP_MS ${buildStepMs} · ${buildSteps.length} substeps ≈ ${buildRunLabel}`,
)
/* Comments stripped first: the `dur()` doc comment shows "5m 10s" as an example of
   its own output, and a claim that read that as a hardcoded pace would cry wolf —
   which is how a real red claim gets ignored. */
const buildTabCode = read('src/components/BuildTab.tsx')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*/g, '')
expect(
  'and the page reports the pace rather than hardcoding it',
  /step_ms: BUILD_STEP_MS/.test(server) &&
    /step_ms: num/.test(client) &&
    /shown\.stepTotal \* shown\.stepMs/.test(buildTabCode) &&
    !/\d+\s?s\b/.test(buildTabCode),
  'a duration on screen is derived from what the server sent',
)
expect(
  'and the panel renders the substeps under their stage',
  /className="bt-steps"/.test(read('src/components/BuildTab.tsx')) &&
    /stage\.steps\.map/.test(read('src/components/BuildTab.tsx')),
  'BuildTab nests them rather than flattening the pipeline',
)
expect(
  'a build is a run the page polls, not an instant commit',
  /match: \(p\) => \/\^\\\/graph-studio\\\/\[\^\/\]\+\\\/builds\$\/\.test\(p\)/.test(server) &&
    /send\(res, 202, buildView\(startBuildFor/.test(server),
  '202 + a queued run, like a profiling job',
)
expect(
  'the build lives in the studio, where rebuilding does',
  /BuildTab/.test(read('src/pages/GraphStudioPage.tsx')) &&
    /useGraphBuildStore/.test(read('src/store/graphStudioStore.ts')),
  'the tab and its store are the studio’s',
)
expect(
  'and the wizard starts it at the click rather than committing and leaving',
  /startBuild\(result\.useCase\.useCaseId\)/.test(read('src/pages/NewGraphPage.tsx')) &&
    /state: \{ tab: 'build' \}/.test(read('src/pages/NewGraphPage.tsx')),
  'Save & build starts the run, then hands over to the Build tab',
)
/*
 * A version *is* a build: every finished run records one, and building must never
 * publish. `studioLive` is the publish pointer, so a build touching it would mean
 * a rebuild silently went live.
 */
const startBuildBody = (server.match(/function startBuildFor[\s\S]*?\n\}/) ?? [''])[0]
const runBuildBody = (server.match(/function runGraphBuild[\s\S]*?\n\}/) ?? [''])[0]
/*
 * The build payload's field names, server against client schema.
 *
 * TypeScript cannot see across this boundary: `RawGraphBuild` is a *claim* about
 * what the server sends, so renaming a field in `buildView` compiles cleanly and
 * fails at runtime instead — `draft_version should be a string, got undefined`,
 * which reads like a stale server and is not one. This compares the two lists.
 */
const buildViewBody = (server.match(/const buildView = \(run\) => \(\{[\s\S]*?\n\}\)/) ?? [''])[0]
const serverBuildFields = [...buildViewBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
const buildSchemaBody = (client.match(/const GRAPH_BUILD = shape\(\{[\s\S]*?\n\}\)/) ?? [''])[0]
const clientBuildFields = [...buildSchemaBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
expect(
  'the build payload and its schema name the same fields',
  serverBuildFields.length > 0 &&
    JSON.stringify([...serverBuildFields].sort()) ===
      JSON.stringify([...clientBuildFields].sort()),
  `server ${serverBuildFields.join(',')} · schema ${clientBuildFields.join(',')}`,
)

expect(
  'a finished build records a version',
  /recordVersion\(run,/.test(runBuildBody),
  'runGraphBuild records one on completion, not on start',
)
expect(
  'building never publishes',
  !/studioLive\.set/.test(startBuildBody) && !/studioLive\.set/.test(runBuildBody),
  'publishing stays behind its own gate',
)
expect(
  'publishing names a content hash, and unpublishing exists',
  /versions\\\/\[0-9a-f\]\+\\\/publish/.test(server) &&
    /versions\\\/\[0-9a-f\]\+\\\/unpublish/.test(server),
  'a version is identified by what it contains, not by a counter',
)
expect(
  'the version rows are never rewritten',
  !/studioVersions\.get\([^)]*\)\[[^\]]*\]\s*=/.test(server) &&
    /published: v\.sha256 === studioLive\.get\(id\)/.test(server),
  'publishing flips a pointer, it does not mutate a row',
)
expect(
  'Ask serves the published version and nothing else',
  /const published = publishedVersion\(useCase\.use_case_id\)/.test(server) &&
    /if \(!published\) return null/.test(server),
  'unpublishing takes the graph out of Ask',
)
/*
 * A finished build has to *appear* on Versions.
 *
 * The rows come from the studio payload, which is otherwise fetched once on
 * arrival — so without a refresh keyed to the completed run, the build a user just
 * watched finish is absent from the list until they reload. Nothing errors; the
 * list is simply one run behind, which is the kind of staleness nobody reports.
 */
expect(
  'a completed build refreshes the version list',
  /refreshedForBuild/.test(read('src/pages/GraphStudioPage.tsx')) &&
    /shownBuild\?\.status !== 'complete'/.test(read('src/pages/GraphStudioPage.tsx')),
  'the row appears without a reload, once per run',
)

/* The header must not carry a publish button: it could not say which build it
   meant, which is the whole reason publishing moved onto the rows. */
expect(
  'publishing happens on a version row, not in the header',
  /onPublish\(sha256: string\)/.test(read('src/pages/GraphStudioPage.tsx')) &&
    !/Publish \{data\.version\}/.test(read('src/pages/GraphStudioPage.tsx')),
  'the header shows the loaded job instead',
)

/* ---------------- Ask's recorded answers are renderable ---------------- */

/*
 * `ask_answers` is the tenant's 40 written answers. Every block kind in them needs
 * a branch in `AnswerBlocks` and a case in the client's `variant`, or a block
 * silently disappears mid-answer — the reader sees a shorter answer, not an error.
 */
const answers = db.ask_answers ?? []
const blockKinds = [...new Set(answers.flatMap((a) => a.blocks.map((b) => b.type)))].sort()
const answerBlocks = read('src/components/AnswerBlocks.tsx')
expect(
  'every recorded block kind has a renderer',
  blockKinds.length > 0 &&
    blockKinds.every((k) => new RegExp(`block\\.type === '${k}'`).test(answerBlocks)),
  `kinds in the data: ${blockKinds.join(', ')}`,
)
expect(
  'and a case in the block validator',
  blockKinds.every((k) => new RegExp(`^\\s*${k}: shape\\(`, 'm').test(client)),
  'ANSWER_BLOCK is a tagged union over exactly these',
)
const chartKinds = [
  ...new Set(
    answers.flatMap((a) => a.blocks.filter((b) => b.type === 'chart').map((b) => b.chart)),
  ),
].sort()
expect(
  'every chart kind is one the client accepts',
  chartKinds.every((k) => new RegExp(`'${k}'`).test(client)),
  `chart kinds: ${chartKinds.join(', ')}`,
)

/*
 * The confidence band and the score must agree. The query set states both, and a
 * "High" chip over a 0.62 would misreport the answer's own certainty.
 */
for (const a of answers) {
  const band = a.confidence >= 0.85 ? 'High' : a.confidence >= 0.6 ? 'Medium' : 'Low'
  expect(
    `${a.answer_id} states a band that matches its score`,
    a.confidence_level === band,
    `${a.confidence_level} for ${a.confidence}`,
  )
}

/* No two recorded answers may answer the same question, or the matcher's
   tie-breaker decides which one a user gets. */
const askQuestions = answers.map((a) => a.question.trim().toLowerCase())
expect(
  'no question is recorded twice',
  new Set(askQuestions).size === askQuestions.length,
  `${answers.length} answers`,
)

/* The stream is the contract: refusals before it opens, events after. */
expect(
  'the answer is streamed as events, not one blob',
  /sseOpen\(res\)/.test(server) &&
    /sseSend\(res, 'block'/.test(server) &&
    /sseSend\(res, 'done'/.test(server),
  'stage → summary → block… → done',
)
expect(
  'and the client validates each event',
  /ASK_STAGE_EVENT/.test(client) &&
    /ASK_BLOCK_EVENT/.test(client) &&
    /ASK_ANSWER_PAYLOAD\)/.test(client),
  'per-event schemas plus the whole envelope on done',
)

/* ---------------- every document resolves into the graph ---------------- */

/*
 * `document_extractions` is the join from an uploaded PDF to a facility node in
 * the graph, ingested from `08_unstructured/Entity_Extraction_Map.xlsx`. A
 * document missing an entry renders "no graph entity resolved" — correct for a
 * file nothing matched, and indistinguishable from an ingestion that quietly
 * skipped a row. So every seeded document must have one.
 */
const extractions = db.document_extractions ?? {}
for (const drive of db.drives ?? []) {
  for (const folder of drive.folders ?? []) {
    for (const doc of folder.documents ?? []) {
      const resolution = extractions[doc.document_id]
      expect(
        `document "${doc.document_id}" resolves to a graph node`,
        Boolean(resolution?.resolved_node),
        resolution ? `→ ${resolution.resolved_node}` : 'no entry in document_extractions',
      )
      /* The two must name the same entity: `linked_entity` is what the browse
         tree shows and the resolution is what the graph joins on, and the map
         refined two of these names — a stale one here would read as agreement
         while pointing at a different company. */
      expect(
        `"${doc.document_id}" names the same entity in both places`,
        !resolution || resolution.extracted_entity === doc.linked_entity,
        `tree "${doc.linked_entity}" vs resolution "${resolution?.extracted_entity}"`,
      )
    }
  }
}
expect(
  'no extraction points at a document that no longer exists',
  Object.keys(extractions).every((id) =>
    (db.drives ?? []).some((dr) =>
      (dr.folders ?? []).some((f) => (f.documents ?? []).some((d) => d.document_id === id)),
    ),
  ),
  `${Object.keys(extractions).length} extractions`,
)
expect(
  'the resolution is served, not synthesised',
  /resolution: db\.document_extractions\?\.\[doc\.document_id\] \?\? null/.test(server),
  'documentDictionary reads it from db.json',
)

/* ---------------- document type facets agree end to end ---------------- */

/*
 * The document dictionary's type chips exist in three places — the server's
 * bucket map, the panel's reverse map, and the client schema that validates the
 * counts. A slug present on one side only does not throw: the chip renders
 * `undefined` or the bucket silently never fills, and a facet reading 0 looks
 * like "no consent decrees in this corpus". So they are asserted against each
 * other, and against the `doc_type`s db.json actually holds.
 */
const facetBlock = server.match(/const FACET_FOR_TYPE = \{([\s\S]*?)\n {6}\}/)
const serverFacetPairs = facetBlock
  ? [...facetBlock[1].matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[1], m[2]])
  : []
const docsPanel = read('src/components/ProfiledDocumentsPanel.tsx')
const panelBlock = docsPanel.match(/const TYPE_FOR_FACET[^=]*= \{([\s\S]*?)\n\}/)
const panelPairs = panelBlock
  ? [...panelBlock[1].matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[2], m[1]])
  : []

expect(
  'document type facets are mapped',
  serverFacetPairs.length > 0 && panelPairs.length === serverFacetPairs.length,
  `${serverFacetPairs.length} server buckets, ${panelPairs.length} panel facets`,
)
expect(
  'server and panel agree on every doc_type facet',
  JSON.stringify([...serverFacetPairs].sort()) === JSON.stringify([...panelPairs].sort()),
  `server ${JSON.stringify(serverFacetPairs)} vs panel ${JSON.stringify(panelPairs)}`,
)

const seededDocTypes = [
  ...new Set(
    (db.drives ?? []).flatMap((d) =>
      (d.folders ?? []).flatMap((f) => (f.documents ?? []).map((doc) => doc.doc_type)),
    ),
  ),
]
const bucketedTypes = serverFacetPairs.map(([type]) => type)
expect(
  'every seeded doc_type has a facet',
  seededDocTypes.every((t) => bucketedTypes.includes(t)),
  `seeded: ${seededDocTypes.join(', ')} · bucketed: ${bucketedTypes.join(', ')}`,
)
expect(
  'the facet labels are documented',
  serverFacetPairs.every(([, bucket]) => client.includes(`${bucket}: num`)),
  'each bucket is validated in the DOCUMENTS_PAYLOAD schema',
)

/*
 * Both fields are read straight through to the browse tree and the dictionary,
 * so a document or view missing one renders a blank rather than raising. The
 * server refuses such a document at boot; this refuses it before boot.
 */
for (const drive of db.drives ?? []) {
  for (const folder of drive.folders ?? []) {
    for (const doc of folder.documents ?? []) {
      expect(
        `document "${doc.document_id}" names its type and entity`,
        Boolean(doc.doc_type_label && doc.linked_entity),
        `doc_type_label=${doc.doc_type_label} linked_entity=${doc.linked_entity}`,
      )
    }
  }
}
for (const project of db.projects ?? []) {
  for (const dataset of project.datasets ?? []) {
    for (const table of dataset.tables ?? []) {
      expect(
        `view "${table.table_id}" states its label and grain`,
        Boolean(table.label && table.grain),
        `label=${table.label} grain=${table.grain}`,
      )
    }
  }
}

/* ---------------- use-case templates resolve ---------------- */

/*
 * A template is nothing but ids into three other pools, so a typo does not
 * throw — the member drops out and the step drafts five personas where the use
 * case names six. A short list reads as an answer, which is why this is checked
 * here as well as in `validateDb`: the server catches it at boot, and this
 * catches it before the server is ever started.
 */
for (const [memberKey, poolKey, idKey] of [
  ['personas', 'graph_personas', 'persona_id'],
  ['kpis', 'graph_kpis', 'kpi_id'],
  ['hero_questions', 'graph_hero_questions', 'question_id'],
]) {
  for (const template of db.graph_use_case_templates ?? []) {
    const missing = template[memberKey].filter(
      (id) => !db[poolKey].some((entry) => entry[idKey] === id),
    )
    expect(
      `template "${template.template_id}" ${memberKey} all resolve`,
      missing.length === 0,
      `not in ${poolKey}: ${missing.join(', ')}`,
    )
  }
}

/*
 * A phrase that appears in two templates' descriptions makes both score it, and
 * a tie deliberately matches neither — so a well-meaning edit here silently
 * turns a template off rather than breaking anything visible.
 */
const normalise = (s) => s.toLowerCase().replace(/\s+/g, ' ')
for (const template of db.graph_use_case_templates ?? []) {
  const own = normalise(template.description)
  const strays = template.match_phrases.filter(
    (phrase) =>
      !own.includes(phrase) ||
      (db.graph_use_case_templates ?? []).some(
        (other) =>
          other.template_id !== template.template_id &&
          normalise(other.description).includes(phrase),
      ),
  )
  expect(
    `template "${template.template_id}" phrases are its own and unique`,
    strays.length === 0,
    `absent from its description or shared with another template: ${strays.join(', ')}`,
  )
}

/* ---------------- every response is validated ---------------- */

/*
 * CLAUDE.md promises a schema for every endpoint, and the promise was quietly
 * broken for fourteen fetchers — mostly writes, whose results are rendered just
 * like a read's. A doc line cannot enforce this, so the shape of the code does:
 * an exported fetcher that calls `request<...>` must also call `validate(`.
 *
 * Deliberately crude — it reads each exported function/const body up to the next
 * export. A false positive means writing the schema, which is the point.
 */

/** Every top-level declaration, exported or not, with its body. */
const declarations = client
  .split(/\n(?:export )?(?:async function|function|const) /)
  .slice(1)
  .map((chunk) => ({
    name: chunk.match(/^(\w+)/)?.[1] ?? '(anonymous)',
    exported: false,
    body: chunk,
  }))

// Helpers that validate on a fetcher's behalf — `withStudio` is one. A fetcher
// delegating to one of these is checked, just not in its own body.
const validators = new Set(
  declarations.filter((d) => /\bvalidate[<(]/.test(d.body)).map((d) => d.name),
)

// `request` is the transport itself — it has no shape of its own to check.
const fetchers = declarations.filter(
  (d) => d.name !== 'request' && /\brequest[<(]/.test(d.body),
)

expect(
  'client fetchers are found',
  fetchers.length > 20,
  `${fetchers.length} fetchers call request()`,
)

const unvalidated = fetchers.filter((f) => {
  if (/\bvalidate[<(]/.test(f.body)) return false
  // Delegating to a helper that validates counts, as long as it is not itself.
  return ![...validators].some(
    (helper) => helper !== f.name && new RegExp(`\\b${helper}\\s*\\(`).test(f.body),
  )
})
expect(
  'every fetcher validates its response',
  unvalidated.length === 0,
  unvalidated.length === 0
    ? `${fetchers.length} fetchers, all checked at the boundary`
    : `no schema in: ${unvalidated.map((f) => f.name).join(', ')} — ` +
      'add one in client.ts; a write answers with a shape too',
)

/* ---------------- where the API lives ---------------- */

/*
 * The API origin is per-environment, so it lives in .env.development /
 * .env.production and nowhere else. Two ways that quietly stops being true, and
 * both are cheap to catch:
 *
 *   · someone hardcodes the deployed host in client.ts to unblock themselves,
 *     and every developer's `npm run dev` starts writing to the shared box;
 *   · the .env files are deleted or renamed, and `VITE_API_BASE` silently
 *     resolves to undefined — which falls back to /api, so development still
 *     works and only the production build is broken, in a browser, later;
 *   · the two are collapsed into one plain `.env`, which Vite loads in *every*
 *     mode. That is the worst of the three, because it fails in the opposite
 *     direction: `npm run dev` starts calling the deployed box, the local mock
 *     server is bypassed, and every db.json edit and server.mjs change appears
 *     to do nothing. Nothing errors — the page just serves production's answers.
 *     This one has actually happened; see docs/REGRESSIONS.md.
 */
/*
 * A remote origin has to be available to the production build — from
 * `.env.production`, or from a plain `.env` if the two have been consolidated.
 * Without one, `VITE_API_BASE` is undefined, falls back to `/api`, and the
 * deployed SPA has no API: broken in a browser, later, silently.
 */
const prodEnv = existsSync(join(root, '.env.production'))
  ? read('.env.production')
  : ''
const plainEnvRaw = existsSync(join(root, '.env')) ? read('.env') : ''
const remoteRe = /^\s*VITE_API_BASE\s*=\s*https?:\/\/(?!localhost|127\.0\.0\.1|\[::1\])/m
expect(
  'a remote origin is available to the production build',
  remoteRe.test(prodEnv) || remoteRe.test(plainEnvRaw),
  '.env.production, or a plain .env carrying it',
)

/*
 * Development's origin may live in `.env.development` or in a plain `.env` —
 * what must never happen is a plain `.env` naming a *remote* origin, because
 * Vite loads it in every mode and `npm run dev` silently starts answering from
 * the deployed box. That is the failure that actually happened, and it is the
 * value, not the filename, that causes it: a plain `.env` pointing at localhost
 * cannot bypass the local mock server.
 *
 * Asserted this way rather than by banning the key outright so the check tracks
 * the hazard instead of a convention — a red claim nobody can act on gets
 * dismissed, and this one already sat red for a whole session.
 */
const plainEnv = plainEnvRaw
/*
 * The **last** assignment, because that is the one dotenv keeps — and a file with
 * two of them is worse than either, since the effective value is invisible.
 * An earlier version of this check read the *first* match and passed a `.env`
 * whose second line pointed at the deployed box: the guard agreed with the wrong
 * half of the file.
 */
const plainBases = [...plainEnv.matchAll(/^\s*VITE_API_BASE\s*=\s*(.+)$/gm)].map((m) =>
  m[1].trim(),
)
expect(
  '.env assigns VITE_API_BASE at most once',
  plainBases.length <= 1,
  plainBases.length > 1
    ? `${plainBases.length} assignments (${plainBases.join(' then ')}) — the last one wins, so the first is a decoy`
    : 'one or none',
)
const plainBase = plainBases.at(-1) ?? ''
const isLocal = (value) =>
  value === '' ||
  value.startsWith('/') ||
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(value)
expect(
  'a plain .env names no remote origin',
  isLocal(plainBase),
  plainBase
    ? `.env sets VITE_API_BASE=${plainBase} for every mode, development included`
    : 'no VITE_API_BASE in .env',
)
expect(
  'development has an API base',
  existsSync(join(root, '.env.development')) || plainBase !== '',
  'either .env.development or a local origin in .env — otherwise it falls back to /api',
)

expect(
  'client.ts reads the API base from the environment',
  /import\.meta\.env\.VITE_API_BASE/.test(client),
  'BASE must come from VITE_API_BASE, defaulting to /api',
)

const hardcodedOrigins = [...client.matchAll(/'https?:\/\/[^']+'/g)].map((m) => m[0])
expect(
  'no hardcoded API origin in client.ts',
  hardcodedOrigins.length === 0,
  hardcodedOrigins.length === 0
    ? 'the origin is environment-owned'
    : `${hardcodedOrigins.join(', ')} — move it to .env.production`,
)

/* ---------------- the consent connects the signed-in user ---------------- */

/*
 * `/sources/oauth/callback` used to answer every caller with `db.google_account`,
 * so the wizard's "Connected as …" named one seeded person no matter who was
 * signed in. The identity is client-held, so the fix has four legs and all four
 * have to hold: the server must read `as`, the client must send it, the wizard
 * must take it from the auth store, and the alert must *render* the signed-in
 * email rather than whatever the payload echoed — that last one is what makes the
 * page right against an older or deployed server too. Asserted here rather than
 * noted, because any one going missing restores the seeded email silently — nothing
 * errors, it just shows the wrong human.
 */
const callbackRoute = (server.split("p === '/sources/oauth/callback'")[1] ?? '').slice(
  0,
  3000,
)
expect(
  'consent callback reads the connecting account from the request',
  /query\.get\('as'\)/.test(callbackRoute) &&
    !/account: db\.google_account/.test(callbackRoute),
  '`as` names who signed in; db.google_account is the no-caller fallback only',
)
expect(
  'client.ts sends the signed-in email with the consent callback',
  /&as=\$\{encodeURIComponent\(signedInAs\)\}/.test(client) &&
    (client.match(/callbackPath\(state, '(bigquery|drive)', signedInAs\)/g) ?? [])
      .length === 2,
  'both oauthCallback and driveOauthCallback go through callbackPath',
)
expect(
  'the connect wizard takes that email from the auth store',
  /useAuthStore\(\(s\) => s\.identity\?\.email\)/.test(wizard) &&
    /* Matched on the argument, not on the local holding the state: the wizard
       renamed `start.state` to `oauthState` when the consent became a
       click-through, and this failed for a variable name while the fact it
       guards — both connectors send the signed-in email — was still true. */
    (wizard.match(/(?:drive)?[oO]authCallback\([\w.]+, signedInAs\)/g) ?? []).length === 2,
  'BigQuery and Drive both pass signedInAs to their callback',
)
expect(
  'the "Connected as" alert renders the signed-in email',
  /signedInAs \?\? account\.email/.test(wizard) &&
    (wizard.match(/Connected as <strong>\{connectedAs\}<\/strong>/g) ?? []).length === 2 &&
    !/Connected as <strong>\{account\.email\}/.test(wizard),
  'connectedAs prefers the auth store, so a stale server cannot name a stranger',
)

/* ---------------- spacing scale ---------------- */

const tokens = [...indexCss.matchAll(/--sp-(\d):/g)].map((m) => Number(m[1]))
expect('spacing scale present', tokens.length >= 9, `--sp-1..--sp-${Math.max(...tokens, 0)}`)
expect('SP mirror in theme.ts', /export const SP = \{/.test(theme), 'JSX side of the scale')

const cssFiles = [
  'src/index.css',
  'src/App.css',
  'src/pages/CataloguePage.css',
  'src/pages/DbEditorPage.css',
  'src/components/Sidebar.css',
  'src/components/NoSourceConnected.css',
  'src/components/ProfiledColumnsPanel.css',
  'src/components/ProfilingJobsTab.css',
  'src/components/ConnectSourceModal.css',
]
const rawPx = []
for (const file of cssFiles) {
  if (!existsSync(join(root, file))) continue
  const hits =
    read(file).match(
      /^\s*(margin|padding|gap|row-gap|column-gap)[^:]*:\s*[^;]*\b\d+px/gm,
    ) ?? []
  for (const hit of hits) rawPx.push(`${file}: ${hit.trim()}`)
}
expect(
  'no raw px spacing',
  rawPx.length === 0,
  rawPx.length === 0 ? 'all spacing uses --sp-*' : rawPx.join(' | '),
)

/* ---------------- poll interval ---------------- */

const pollMs = Number((jobsTab.match(/POLL_MS = (\d+)/) ?? [])[1])
expect(
  'poll interval matches the UI copy',
  jobsTab.includes('refreshing every ${POLL_MS / 1000}s'),
  `POLL_MS=${pollMs} is interpolated into the status line, so they cannot drift`,
)

/* ---------------- routes vs the server's own route list ---------------- */

const declared = new Set(
  [...server.matchAll(/^ \* {3}(GET|POST|PUT|PATCH|DELETE) +(\S+)/gm)].map(
    (m) => `${m[1]} ${m[2]}`,
  ),
)
const routeCount = (server.match(/^ {4}method: '/gm) ?? []).length
expect(
  'server documents its routes',
  declared.size > 0 && routeCount >= declared.size,
  `${routeCount} routes implemented, ${declared.size} listed in the header comment`,
)

/* ---------------- nav / route parity ---------------- */

const navKeys = [...nav.matchAll(/^ *\{ key: '(\w+)'|^ *key: '(\w+)',/gm)]
  .map((m) => m[1] ?? m[2])
  .filter(Boolean)
const dbInNav = /^\s*\{ key: 'db'/m.test(nav)
expect(
  'CLAUDE.md matches whether /db is in the sidebar',
  dbInNav
    ? !claude.includes('commented out of')
    : claude.includes('commented out of'),
  dbInNav ? '/db is in NAV_ITEMS' : '/db is routed but not in NAV_ITEMS',
)
expect('nav items parse', navKeys.length >= 5, `${navKeys.length} nav keys`)

/* ---------------- audit allowlist ---------------- */

const gate = read('scripts/audit-gate.mjs')
const waivers = [...gate.matchAll(/id: '(GHSA-[\w-]+)'/g)].map((m) => m[1])
for (const id of waivers) {
  expect(
    `waiver ${id} documented`,
    claude.includes(id),
    'CLAUDE.md must explain why it is waived',
  )
}

/*
 * And the inverse, which the loop above cannot see: an emptied ALLOWLIST makes
 * every claim above vanish rather than fail, so CLAUDE.md kept describing a
 * waiver that no longer existed and the count silently dropped by one. A GHSA id
 * named in CLAUDE.md must either still be waived or be described as removed.
 */
for (const match of [...claude.matchAll(/GHSA-[\w-]+/gi)]) {
  const id = match[0]
  const stillWaived = waivers.some((w) => w.toLowerCase() === id.toLowerCase())
  /* Sentence-scoped matching breaks on the dots in a version number, so this
     reads a window around the mention instead. */
  const around = claude.slice(
    Math.max(0, (match.index ?? 0) - 300),
    (match.index ?? 0) + id.length + 300,
  )
  const describedAsGone = /\b(removed|no longer|pinned|overrides)\b/i.test(around)
  expect(
    `${id} in CLAUDE.md matches the gate`,
    stillWaived || describedAsGone,
    stillWaived
      ? 'still in ALLOWLIST'
      : 'not in ALLOWLIST — say it was removed or pinned, or restore the entry',
  )
}

/* ---------------- report ---------------- */

if (problems.length === 0) {
  console.log(`check-docs: OK — ${checked.length} claims verified.`)
  process.exit(0)
}

console.error(`\ncheck-docs: FAILED — ${problems.length} of ${checked.length + problems.length} claims are stale.\n`)
for (const p of problems) console.error(`  ✗ ${p}`)
console.error(
  '\nThe code and the docs disagree. Fix whichever is wrong — do not remove the\n' +
    'assertion to make this pass. See .claude/skills/contextweave-flow/SKILL.md.\n',
)
process.exit(1)
