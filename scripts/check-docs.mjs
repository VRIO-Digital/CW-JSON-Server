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
import { readFileSync, readdirSync, existsSync } from 'node:fs'
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
/*
 * The path is asserted, not merely tried.
 *
 * It read ` _demo_data_package_…` for a whole session — the repo-wide removal of
 * "VLS" ate the directory name here too — so `kg` was null and all eight claims
 * below passed while comparing against nothing, each one reporting "the package is
 * not in this checkout". A guard whose good answer is its own inability to run is
 * describing itself. The package is in the repo, so its absence is now a failure
 * rather than a skip, and the claims below can drop their null branches.
 */
const pkgDir = 'vls_demo_data_package_2026-08-10/05_knowledge_graph'
const kgPath = `${pkgDir}/knowledge_graph.json`
const studioPkgPath = `${pkgDir}/graph_studio.json`
expect(
  'the knowledge-graph package is where the ingest reads it from',
  existsSync(join(root, kgPath)) && existsSync(join(root, studioPkgPath)),
  `${kgPath} + graph_studio.json — the canvas, the queue and the checks all come from here`,
)
expect(
  'and the ingest reads exactly those two paths',
  [kgPath, studioPkgPath].every((p) => read('scripts/ingest-knowledge-graph.mjs').includes(p)),
  'a path this check does not share is a path this check cannot verify',
)
const kg = JSON.parse(read(kgPath))
const studioPkg = JSON.parse(read(studioPkgPath))
const canvas = db.graph_studio.canvas

expect(
  'the canvas holds every relationship the knowledge graph states',
  canvas.edges.length === kg.edges.length,
  `${canvas.edges.length} edges vs ${kg.edges.length} in the package`,
)
/*
 * Exactly the roster, with nothing materialised. The previous package shipped 20
 * edges pointing at ids its node list omitted, and the ingest had to invent four
 * nodes to keep them drawable; this build resolves cleanly, so a canvas larger than
 * the roster means something is being invented again.
 */
expect(
  'and every node it lists, with nothing invented to keep an edge drawable',
  canvas.nodes.length === kg.nodes.length,
  `${canvas.nodes.length} vs ${kg.nodes.length} in the package`,
)
expect(
  'every element class the package ships reaches the canvas',
  Object.entries(kg.counts.by_element_class).every(
    ([cls, n]) => canvas.nodes.filter((x) => x.element_class === cls).length === n,
  ),
  Object.entries(kg.counts.by_element_class)
    .map(([c, n]) => `${c} ${n}`)
    .join(' · '),
)
/*
 * The column-value node types are gone by decision, not by omission — `not_nodes`
 * records all three with `was_wrongly` beside them. A canvas that still drew them
 * would be drawing the modelling mistake the rebuild exists to correct, and the
 * `dimension` legend hue would come back with it.
 */
expect(
  'the column-value node types the package retired are absent from the canvas',
  ['WasteCode', 'ViolationType', 'EnforcementType'].every(
    (t) => !canvas.nodes.some((n) => n.type === t),
  ),
  `not_nodes lists ${kg.not_nodes.length} routed columns; a code on a row is an attribute`,
)
expect(
  'and no node carries a value Layer 1 does not hold',
  kg.nodes.every((n) => !('properties' in n)) &&
    /demo_display/.test(read('scripts/ingest-knowledge-graph.mjs')),
  'a thin instance is identity + provenance; the figures come from demo_display',
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
    /const CANVAS_GROUPS = \['row', 'schema', 'document', 'alias'\]/.test(server) &&
    legendGroups.every((g) => ['row', 'schema', 'document', 'alias'].includes(g.key)),
  legendGroups.map((g) => g.key).join(', ') || 'parsed none — check the literal shape',
)
/*
 * `dimension` was retired with the column-value nodes, and the retirement has to
 * reach every layer that named it: a legend row with no members advertises a claim
 * the graph denies, and a schema still accepting the key would let a stale server
 * send it without complaint.
 */
/*
 * Scoped to the canvas-group vocabulary, not to the spelling of the word.
 * `dimension` is also one of the profiler's eight column classes, which has nothing
 * to do with an origin colour — a file-wide search for the token failed on those and
 * would have gone on failing whatever was done to the canvas, and a check that cries
 * wolf is how a real red claim gets ignored.
 */
const canvasGroupUnion = /export type CanvasGroup =([^\n]*)/.exec(read('src/api/client.ts'))?.[1]
expect(
  'the retired dimension class is gone from the legend, the server and the group union',
  !legend.includes("key: 'dimension'") &&
    !/CANVAS_GROUPS = \[[^\]]*dimension/.test(server) &&
    canvasGroupUnion !== undefined &&
    !canvasGroupUnion.includes('dimension'),
  `CanvasGroup =${canvasGroupUnion ?? ' (parsed none — check the type’s shape)'}`,
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
 * The type ring — the second encoding, added so the canvas can say what a node *is*
 * as well as where it came from without a nine-hue fill palette nobody can read.
 *
 * Four rules, all recomputed. They were not free: a first pass reused the demo
 * viewer's own light hues and failed twelve ways, because a light ring holds against
 * neither a mid-tone fill nor a white page.
 */
const ringHues = [
  ...legend.matchAll(/\{ type: '(\w+)', group: '(\w+)', color: '(#[0-9a-f]{6})' \}/g),
].map((m) => ({ type: m[1], group: m[2], color: m[3] }))
const unringed = [...legend.matchAll(/\{ type: '(\w+)', group: '(\w+)' \}(?!,\s*color)/g)]
  .map((m) => ({ type: m[1], group: m[2] }))
  .filter((u) => !ringHues.some((r) => r.type === u.type))
const fillFor = (group) => legendGroups.find((g) => g.key === group)?.color
const hueOf = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const mx = Math.max(r, g, b)
  const d = mx - Math.min(r, g, b)
  if (d / mx < 0.12) return null
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
const hueGap = (a, b) => {
  const [x, y] = [hueOf(a), hueOf(b)]
  if (x === null || y === null) return 180
  const d = Math.abs(x - y)
  return Math.min(d, 360 - d)
}

expect(
  'the type ring is declared for every type, ringed or deliberately not',
  ringHues.length + unringed.length === new Set(canvas.nodes.map((n) => n.type)).size,
  `${ringHues.length} ringed + ${unringed.length} unringed vs ` +
    `${new Set(canvas.nodes.map((n) => n.type)).size} types on the canvas`,
)
/*
 * The rule that makes the palette possible: a ring only ever separates its *siblings
 * on the same fill*, so a fill carrying one type needs none — and could not have one,
 * because the only hues near those fills are the fills themselves.
 */
const typesOnFill = new Map()
for (const n of canvas.nodes) {
  if (!typesOnFill.has(n.group)) typesOnFill.set(n.group, new Set())
  typesOnFill.get(n.group).add(n.type)
}
expect(
  'a ring exists exactly where a fill carries more than one type',
  ringHues.every((r) => typesOnFill.get(r.group)?.size > 1) &&
    unringed.every((u) => typesOnFill.get(u.group)?.size === 1),
  [...typesOnFill].map(([g, s]) => `${g} ${s.size}`).join(' · '),
)
expect(
  'and every ringed type is really drawn on the fill it declares',
  ringHues.every((r) =>
    canvas.nodes.filter((n) => n.type === r.type).every((n) => n.group === r.group),
  ),
  'a ring validated against the wrong fill is validated against nothing',
)
for (const r of ringHues) {
  const fill = fillFor(r.group)
  expect(
    `the ${r.type} ring reads against the page and its fill (${r.color} on ${fill})`,
    contrast(r.color, '#ffffff') >= 3 &&
      (contrast(r.color, fill) >= 3 || hueGap(r.color, fill) >= 40),
    `page ${contrast(r.color, '#ffffff').toFixed(2)}:1 · fill ${contrast(r.color, fill).toFixed(2)}:1 / ` +
      `${hueGap(r.color, fill).toFixed(0)}°`,
  )
}
expect(
  'and no two rings on one fill are confusable',
  ringHues.every((a) =>
    ringHues
      .filter((b) => b.group === a.group && b.type !== a.type)
      .every((b) => hueGap(a.color, b.color) >= 40 || contrast(a.color, b.color) >= 2),
  ),
  'siblings need a 40° hue turn or 2:1 — this is the only comparison that matters',
)
/*
 * The ring is its own circle. A stroke on `.gc-disc` would be overridden by the
 * stylesheet — a CSS rule beats a presentation attribute — and the disc's stroke is
 * where the *states* are drawn, so a ring there would also fight "proposed",
 * "selected" and the answer path.
 */
expect(
  'the ring is drawn as its own circle, not a stroke on the disc',
  /className="gc-ring"/.test(read('src/components/GraphCanvas.tsx')) &&
    !/gc-disc"[^>]*stroke=\{/.test(read('src/components/GraphCanvas.tsx')),
  'a stylesheet rule beats a presentation attribute',
)
/*
 * Zoom is what makes the small labels legible, so the component must not restate the
 * threshold in prose that can drift from the constant it describes — the same rule the
 * build panel's pace already follows.
 */
const gcSource = read('src/components/GraphCanvas.tsx')
expect(
  'zoom and pan are hand-written, with no graph library behind them',
  /getScreenCTM/.test(gcSource) &&
    !/from 'd3/.test(gcSource) &&
    !/"d3/.test(read('package.json')),
  'the audit gate makes every dependency expensive, and this is circles and lines',
)
expect(
  'the wheel listener is registered non-passively, or the page scrolls behind the zoom',
  /addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(gcSource),
  'React registers onWheel as passive, and a passive listener cannot preventDefault',
)
expect(
  'the label-at-zoom threshold is stated once and the hint reads it',
  /const LABEL_AT_ZOOM = [\d.]+/.test(gcSource) &&
    /\{LABEL_AT_ZOOM\}×/.test(gcSource),
  'a hardcoded number in the copy is a second opinion about when labels appear',
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
  Object.keys(kg.counts.by_type).every((t) =>
    db.graph_studio.generated.subjects.includes(t),
  ),
  'synthesised rows must not name entities the canvas has never heard of',
)
/*
 * The queue is the package's, and the pivot is one of its rows promoted.
 *
 * rq1 is the identity merge, which is the one decision that changes what every other
 * row *means* — so it is the pivot, and the queue holds the other five. Listing it in
 * both places would ask one question twice and let a reviewer answer it two ways, so
 * this asserts the split rather than the count alone: 5 + 1 is the package's own
 * `mustReviewTotal`.
 */
const pivot = db.graph_studio.pivot
const queueIds = db.graph_studio.review_items.map((i) => i.item_id)
expect(
  'the queue is the package’s rows, less the one promoted to the pivot',
  db.graph_studio.review_items.length + 1 === studioPkg.lanes.mustReviewTotal &&
    queueIds.length === studioPkg.review_queue.length - 1,
  `${queueIds.join(', ')} + 1 pivot = ${studioPkg.lanes.mustReviewTotal} must-review decisions`,
)
expect(
  'and the identity merge is in exactly one of the two, never both',
  /Texas Molecular/.test(pivot.title) &&
    pivot.options.length === 2 &&
    !db.graph_studio.review_items.some((i) => /merge to one facility/.test(i.title)),
  pivot.title,
)
expect(
  'the lane totals are the package’s trust lanes, not numbers chosen here',
  db.graph_studio.generated.confirmed_total === studioPkg.lanes.trust.confirmedFyi &&
    db.graph_studio.generated.auto_approved_total === studioPkg.lanes.trust.autoApprove &&
    db.graph_studio.generated.must_review_total === db.graph_studio.review_items.length,
  `auto-approve ${studioPkg.lanes.trust.autoApprove} · confirmed ${studioPkg.lanes.trust.confirmedFyi} · ` +
    `must-review ${db.graph_studio.generated.must_review_total} (all authored, none padded)`,
)
/*
 * A row states its buttons in its own terms, and every label still resolves to one
 * of the recorded choices. A row offering a fourth outcome would be a button the
 * server refuses, which is the failure `action_set` was introduced to stop.
 */
const CHOICES = ['approve', 'correct', 'reject', 'approve-causal', 'downgrade-correlational']
expect(
  'every row offers its own labels, and every label maps to a recorded choice',
  db.graph_studio.review_items.every(
    (i) => i.actions.length > 0 && i.actions.every((a) => CHOICES.includes(a.choice)),
  ) && /item\.actions\s*\n?\s*\? item\.actions\.map\(\(a\) => a\.choice\)/.test(server),
  db.graph_studio.review_items
    .map((i) => `${i.item_id}: ${i.actions.map((a) => a.label).join(' / ')}`)
    .join(' · '),
)
expect(
  'and the page reads the row’s actions rather than a list of its own',
  /item\.actions\.length > 0 \? item\.actions/.test(read('src/components/ReviewQueueItem.tsx')),
  'a page that kept its own list could offer a button the API refuses',
)

/*
 * The recorded sanity checks. These are the second surface the package ships, and
 * they are served the way `ask_answers` is — matched, named as recorded, falling
 * through to the walk. Three things have to hold, and each one failed silently
 * before it was checked: every walked id has to exist, no verdict may name an edge
 * type the graph does not have, and the threshold has to be Ask's.
 */
const checks = db.graph_studio.sanity_checks
const canvasEdgeIds = new Set(canvas.edges.map((e) => e.edge_id))
expect(
  'every recorded sanity check the package ships is ingested',
  checks.length === studioPkg.sanity_checks.length,
  `${checks.length} checks · ${checks.map((c) => c.hero_question_id).join(', ')}`,
)
expect(
  'each one walks nodes and edges that are on the canvas',
  checks.every(
    (c) =>
      c.path.every((id) => canvasNodeIds.has(id)) &&
      c.edges_used.every((id) => canvasEdgeIds.has(id)),
  ),
  `${checks.reduce((n, c) => n + c.edges_used.length, 0)} hops, all resolvable`,
)
expect(
  'and the server refuses a check that walks something absent',
  /sanity_checks "\$\{check\.check_id\}" walks node/.test(server),
  'a highlight one hop short of the answer it claims is silent otherwise',
)
/*
 * The package's sc3 states `HAS_ENFORCEMENT` and an `EnforcementType` node in its
 * prose while its own traversal walks `ENFORCEMENT_AGAINST` to an `Enforcement`
 * event. Only the traversal resolves, so the ingest corrects the prose — and this is
 * what stops the correction being dropped on the next re-ingest.
 */
/*
 * Keyed to the retired names, not to "any SCREAMING_SNAKE word" — the first attempt
 * was the latter and failed on `EPA_ID` and a `LDR_SET` inside a Cypher comment,
 * neither of which is a claim about the ontology. What must never survive is a
 * *retired* type: those are the ones that read as a relationship the graph has.
 */
const RETIRED_TYPES = ['HAS_ENFORCEMENT', 'WasteCode', 'ViolationType', 'EnforcementType']
const checkProse = checks
  .flatMap((c) => [c.verdict, c.verdict_body, c.plan, ...c.context.flatMap((x) => [x.label, x.meta])])
  .join(' ')
/*
 * Only ever in a negation. Refusing the names outright was the second attempt and it
 * failed on sc5, which says "no WasteCode node" and "not WasteCode nodes" — telling
 * the reader the promotion was declined is the whole point of that check, and it is
 * the opposite of the mistake being guarded against. What must not survive is a
 * retired type named as something the graph *has*, which is what sc3's prose did.
 */
const assertedRetired = RETIRED_TYPES.filter((t) =>
  [...checkProse.matchAll(new RegExp(`(\\S+\\s+)?${t}`, 'g'))].some(
    (m) => !/\b(no|not|never|without)\s+$/i.test(m[1] ?? ''),
  ),
)
expect(
  'a retired type is named only to say it is absent, never as one the graph has',
  assertedRetired.length === 0,
  assertedRetired.join(', ') ||
    `${RETIRED_TYPES.length} retired names, each negated wherever it appears`,
)
expect(
  'and every relationship a plan matches on is one the graph has',
  [...checkProse.matchAll(/\[\w*:([A-Z_]+)\]/g)].every((m) =>
    new Set(kg.edges.map((e) => e.type)).has(m[1]),
  ),
  [...new Set([...checkProse.matchAll(/\[\w*:([A-Z_]+)\]/g)].map((m) => m[1]))].join(', '),
)
expect(
  'a recorded check is matched at Ask’s threshold, not one of its own',
  /const checks = db\.graph_studio\.sanity_checks/.test(server) &&
    /best\.score < ASK_MATCH_MIN/.test(
      server.slice(server.indexOf('function matchSanityCheck')),
    ),
  'two thresholds over one tenant’s questions would let the studio pass what Ask declines',
)
expect(
  'and the answer says which route produced it',
  /recorded: true/.test(server) && /const NO_RECORDED_CHECK = \{/.test(server),
  'a written verdict read as a derived one is the one thing this tab must not do',
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
/*
 * And a concept node cannot be an instance. The rebuild put the seven type-level
 * nodes on the canvas labelled exactly "Facility", "Manifest", "Document" — and the
 * whole-label shortcut matched them, so "the Denka facility" resolved to
 * CONCEPT:Facility and reported the two had nothing between them. The word was
 * already stopped; the node whose entire label *is* that word was not.
 */
expect(
  'a concept node is never matched as an instance, whole label or not',
  /n\.element_class !== 'concept'/.test(server) &&
    /asked\.includes\(own\) && !kindWords\.has\(own\)/.test(server),
  `${canvas.nodes.filter((n) => n.element_class === 'concept').length} concept nodes are ` +
    'labelled with bare type names, which is why the shortcut needed the stoplist too',
)
expect(
  'the canvas has an ingest to re-run, and the docs name it',
  existsSync(join(root, 'scripts/ingest-knowledge-graph.mjs')) &&
    /"ingest:graph": "node scripts\/ingest-knowledge-graph\.mjs"/.test(read('package.json')) &&
    claude.includes('npm run ingest:graph'),
  `hand-editing ${canvas.nodes.length} laid-out nodes is not a maintenance path`,
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

/*
 * Every stylesheet, found on disk rather than listed here.
 *
 * The list this replaced named nine files and had stopped covering six — including three
 * added in the last month — so the rule it enforced was quietly true of two thirds of the
 * app. A guard whose scope is maintained by hand beside the thing it describes drifts from
 * it, which is the same failure as a client-side copy of a server's scope list.
 *
 * **Sub-scale insets are exempt.** The scale starts at `--sp-1: 4px`, so a 1px or 2px pill
 * inset cannot be expressed with it and is a border-ish detail rather than layout spacing.
 * Anything 4px or over must come from the scale.
 */
const cssFiles = (function walkCss(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walkCss(`${dir}/${entry.name}`)
      : entry.name.endsWith('.css')
        ? [`${dir}/${entry.name}`]
        : [],
  )
})('src')
/*
 * **One exemption, and it is vendored code.**
 *
 * `src/reports/reports-prototype.css` is the report prototype's own stylesheet, carried over
 * from the demo package with its figures and its 2px rhythm intact — 173 spacing declarations
 * a 4px scale cannot express without redrawing the design. It is design source material, not
 * something authored here, and the rule this check enforces is about what the team writes.
 *
 * The exemption is **narrowed by two other claims** rather than taken on trust: the file must
 * stay scoped under `.cw-reports` (below), and this list must stay one entry long — so nothing
 * authored in this repo can quietly join it, and the vendored sheet cannot quietly go global.
 */
const SPACING_EXEMPT = ['src/reports/reports-prototype.css']
expect(
  'the spacing rule has exactly one exemption, and it is the vendored stylesheet',
  SPACING_EXEMPT.length === 1 && cssFiles.includes(SPACING_EXEMPT[0]),
  'anything authored here comes from --sp-*; this one is carried over unchanged',
)
const rawPx = []
for (const file of cssFiles.filter((f) => !SPACING_EXEMPT.includes(f))) {
  const hits =
    read(file).match(
      /^\s*(margin|padding|gap|row-gap|column-gap)[^:]*:\s*[^;]*\b\d+px/gm,
    ) ?? []
  for (const hit of hits) {
    const overScale = [...hit.matchAll(/(\d+(?:\.\d+)?)px/g)].some((m) => Number(m[1]) >= 4)
    if (overScale) rawPx.push(`${file}: ${hit.trim()}`)
  }
}
expect(
  'no raw px spacing, in any stylesheet',
  cssFiles.length > 10 && rawPx.length === 0,
  rawPx.length === 0
    ? `${cssFiles.length} stylesheets, all layout spacing from --sp-*`
    : rawPx.join(' | '),
)

/*
 * **The vendored stylesheet is scoped, and that is not tidiness.**
 *
 * It was written for a page it owned outright: `*{margin:0;padding:0}`, `body`, `button`,
 * `h1,h2,h3`, `table`, `th`, `td` and `:root` were all bare. Unscoped, it resets every antd
 * component's margins and restyles every table on Sources, Ask, Catalogue, Graph Studio and
 * What-if — and it would do it silently, on pages nobody was editing.
 *
 * So: every selector in the file starts with the scope, its tokens sit on that class rather
 * than `:root`, and the page mounts it inside a matching wrapper. A `@`-rule or a keyframe stop
 * is not a selector and is skipped — which is how the first version of the transform failed,
 * latching on a single-line `@keyframes` and leaving two thirds of the file global.
 */
const protoCss = read(SPACING_EXEMPT[0])
/* Comments stripped first: the file's own header quotes `*{margin:0;padding:0}` while
   explaining why that rule had to be scoped, and scanning the raw text reported the
   explanation as an unscoped selector. */
const unscoped = protoCss
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((line) => /\{/.test(line))
  .map((line) => line.slice(0, line.indexOf('{')).trim())
  .filter((sel) => sel && !sel.startsWith('@') && !/^(from|to|\d+%)$/.test(sel))
  .filter((sel) => !sel.split(',').every((one) => one.trim().startsWith('.cw-reports')))
expect(
  'the vendored report stylesheet is scoped, so it cannot restyle the rest of the app',
  protoCss.length > 0 &&
    unscoped.length === 0 &&
    /* Its tokens moved off `:root` — left there they would win over the host's on every page. */
    !/^:root\s*\{/m.test(protoCss) &&
    /* And the page really wraps it in that class. */
    /className="cw-reports"/.test(read('src/pages/ReportsPage.tsx')),
  unscoped.length > 0
    ? `unscoped selectors: ${unscoped.slice(0, 3).join(' | ')}`
    : 'every selector under .cw-reports, tokens on the wrapper, page wraps in it',
)

/*
 * **A portal leaves the scope, so the scope has to travel with it.**
 *
 * Scoping the stylesheet broke every menu in the prototype and nothing said so. `MenuProvider`
 * portals to `document.body`, outside the page's `.cw-reports` wrapper, so none of the scoped
 * rules matched: no `position: absolute`, no `z-index`, no background. The popover rendered as
 * unstyled text below the whole page — and a Delete button whose confirmation is invisible looks
 * precisely like a button that does nothing.
 *
 * So: every portal out of the vendored tree carries the class, and it carries it boxlessly —
 * `.cw-reports` holds the prototype's `height: 100%` and opaque background, which at body level
 * would cover the app, and any box would change the containing block the menu positions against.
 */
const portalFiles = (function walkTsx(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walkTsx(`${dir}/${entry.name}`)
      : entry.name.endsWith('.tsx')
        ? [`${dir}/${entry.name}`]
        : [],
  )
})('src/reports').filter((f) => read(f).includes('createPortal('))
const unscopedPortals = portalFiles.filter(
  (f) => !/createPortal\(\s*(?:\/\*[\s\S]*?\*\/\s*)?<div className="cw-reports cw-portal">/.test(read(f)),
)
expect(
  'every portal out of the vendored tree carries the scope class, boxlessly',
  portalFiles.length > 0 &&
    unscopedPortals.length === 0 &&
    /\.cw-reports\.cw-portal\s*\{\s*display:\s*contents;?\s*\}/.test(read('src/pages/ReportsPage.css')),
  portalFiles.length === 0
    ? 'no portal was found in src/reports — this check cannot run'
    : unscopedPortals.length > 0
      ? `portals outside the scope: ${unscopedPortals.join(', ')}`
      : `${portalFiles.length} portal file(s), each scoped`,
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

/* ---------------- the What-if lens ---------------- */

/*
 * The package is the source of truth, the same rule the canvas follows. Every claim
 * here compares `db.whatif` against
 * "09 What if lens"/whatif_vls_data.json, so a hand-edit to either shows up as a
 * disagreement rather than as a page that quietly no longer matches its data.
 */
const whatifPkgPath = 'vls_demo_data_package_2026-08-10/09_What if lens/whatif_vls_data.json'
const whatifPkgHere = existsSync(join(root, whatifPkgPath))
expect(
  'the What-if package is where its ingest reads it from',
  whatifPkgHere && read('scripts/ingest-whatif.mjs').includes(whatifPkgPath),
  whatifPkgHere ? whatifPkgPath : `${whatifPkgPath} is not in this checkout`,
)
/* Read only once its presence is a claim of its own, so a wrong path is a red claim
   naming the file rather than a stack trace nobody reads as a doc failure. */
const whatifPkg = whatifPkgHere ? JSON.parse(read(whatifPkgPath)) : null
const whatif = db.whatif

expect(
  'every generator the package ships reaches db.whatif',
  whatifPkg !== null && whatif.generators.length === whatifPkg.generators.length,
  `${whatif.generators.length} generators`,
)
/*
 * The four reference classes the ingest checks, re-checked against the *document being
 * served*. Each fails silently: a measure on a missing field renders as no inherited
 * risk, a pool on a missing field offers nobody, a resolvable naming no measure reports
 * success and adds nothing.
 */
const genFields = new Set(Object.keys(whatif.generators[0]))
const measureKeys = new Set(whatif.watched_measures.map((m) => m.key))
expect(
  'every watched measure reads a field a generator actually carries',
  whatif.watched_measures.every((m) => genFields.has(m.field)),
  whatif.watched_measures.map((m) => `${m.key}→${m.field}`).join(' · '),
)
expect(
  'and names a format the package defines',
  whatif.watched_measures.every((m) => m.format in whatif.formats),
  Object.keys(whatif.formats).join(', '),
)
expect(
  'every pool filters on a real field and has a headroom row',
  whatif.candidate_pools.every(
    (p) => (p.filter === null || genFields.has(p.filter.field)) && p.key in whatif.headroom,
  ),
  whatif.candidate_pools.map((p) => p.key).join(', '),
)
expect(
  'every resolvable phrasing resolves to a measure or to nothing on purpose',
  whatif.resolvable.every((r) => r.resolves_to === null || measureKeys.has(r.resolves_to)),
  `${whatif.resolvable.length} phrasings`,
)
/* A keyword on two entries makes the verdict depend on list order — the same "a tie
   matches nothing" problem `matchTemplate` has. */
const whatifKeywords = whatif.resolvable.flatMap((r) => r.keywords)
expect(
  'and no keyword appears on two of them, so no verdict is order-dependent',
  new Set(whatifKeywords).size === whatifKeywords.length,
  `${whatifKeywords.length} keywords, ${new Set(whatifKeywords).size} distinct`,
)
expect(
  'the server refuses a document that breaks any of those',
  /whatif\.watched_measures "\$\{m\.key\}" reads generator field/.test(server) &&
    /whatif\.candidate_pools "\$\{p\.key\}" filters on/.test(server) &&
    /whatif\.resolvable ".*" resolves to/.test(server),
  'validateDb checks whatif across keys, like the studio canvas',
)

/*
 * The premise of the authoring step: the *graph* decides what grounds. A client holding
 * the keyword list could answer for itself, and the refusal would be theatre.
 */
expect(
  'the resolvable keyword list never reaches the client',
  /\*\*`resolvable` is deliberately not in this payload\.\*\*/.test(server) &&
    !/resolvable: db\.whatif\.resolvable/.test(server) &&
    !read('src/api/client.ts').includes('resolvable:'),
  'POST /whatif/resolve is the only way to ask',
)
/*
 * The library's contract, and the reason a scenario is computed rather than stored: it
 * keeps the admitted load so every figure recomputes against today's graph.
 */
expect(
  'the saved library stores the admitted load and never the figures',
  /whatifSaved\.set\(id, \{ saved_id: id, name: label, generator_id \}\)/.test(server) &&
    !/whatifSaved\.set\([^)]*measures/.test(server),
  'a saved scenario stays live as the graph changes',
)
expect(
  'and the store keeps a column as its load, not its numbers',
  /export interface ScenarioColumn \{/.test(read('src/store/whatifStore.ts')) &&
    /generatorId: string/.test(read('src/store/whatifStore.ts')),
  'figures live in `computed`, derived on every swap',
)
/*
 * The pool filters exist twice — as data on the server, and as a switch in the store so
 * the dropdown can list membership rather than only count it. The two must agree, or a
 * pool offers loads the frame excluded.
 */
const storeSrc = read('src/store/whatifStore.ts')
expect(
  'the client has a membership rule for every pool the package ships',
  whatif.candidate_pools
    .filter((p) => p.filter !== null)
    .every((p) => new RegExp(`case '${p.key}':`).test(storeSrc)),
  whatif.candidate_pools.map((p) => p.key).join(', '),
)
/* The breach rule is real but unreachable against this roster — the appetite is 10 and
   the largest single load carries 4. Asserted so nobody "fixes" the styling by inventing
   a breach, and so a data change that *does* make it reachable is noticed. */
const enfMeasure = whatif.watched_measures.find((m) => m.key === 'enf')
/* Read off the measure rather than hardcoded here, so this stays a claim about the
   breach rule the data declares and not about the word "enf". */
const maxLoad = Math.max(...whatif.generators.map((g) => g[enfMeasure.field]))
const enfBaseline = whatif.facility.baseline[enfMeasure.baseline_field]
const enfAppetite = whatif.facility.appetite[enfMeasure.appetite_field]
expect(
  'CLAUDE.md states whether one load can breach the appetite line',
  maxLoad + enfBaseline < enfAppetite ===
    claude.includes('The breach rule is real but currently unreachable'),
  `max load ${maxLoad} + baseline ${enfBaseline} vs appetite ${enfAppetite}`,
)
expect(
  'and headroom is the package formula, computed once on the server',
  whatifPkg !== null &&
    whatifPkg.runtime.headroom.formula.includes('floor((appetite.enf - baseline.enf)') &&
    /Math\.floor\(\(appetite - pkg\.facility\.baseline/.test(read('scripts/ingest-whatif.mjs')) &&
    !/Math\.floor/.test(read('src/pages/WhatIfPage.tsx')),
  'a break point computed in the page would be arithmetic on a measure',
)
/*
 * The connection gate replaces the lens rather than sitting under it.
 *
 * The page printed its header chrome above `NoSourceConnected`: the banner naming 36
 * inbound generators and the provenance note naming the package the figures came from,
 * both above the sentence "No data source is connected". Nothing errored — a claim about
 * data that is not there reads as data.
 *
 * Guarded structurally: the whole lens lives in one component rendered only on the
 * connected branch, so the gate has no source-derived copy to leak. Asserted both ways —
 * absent from the gate, present in the lens — because deleting the strings would
 * otherwise satisfy half of it.
 */
const whatIfSrc = read('src/pages/WhatIfPage.tsx')
const gateAt = whatIfSrc.indexOf('export default function WhatIfPage(')
const lensAt = whatIfSrc.indexOf('\nfunction ', gateAt)
const gatedCopy = ['copy.banner', 'copy.overlayPill', 'copy.dataNote']
expect(
  'the What-if gate replaces the lens rather than rendering beside it',
  gateAt !== -1 &&
    lensAt > gateAt &&
    /* Whichever empty state the gate renders — it was the source one, it is now the
       publish one — the fact guarded here is that the gate *replaces* the lens. */
    /No(Source Connected|PublishedGraph|SourceConnected)/.test(whatIfSrc.slice(gateAt, lensAt)) &&
    gatedCopy.every(
      (k) => !whatIfSrc.slice(gateAt, lensAt).includes(k) && whatIfSrc.slice(lensAt).includes(k),
    ),
  `${gatedCopy.join(', ')} render only inside the lens`,
)

/* ---------------- the report section ---------------- */

/*
 * The reports are the one section whose *copy* is extracted from the package's rendered
 * HTML, so the claims here fall into two families: the extraction resolved (a report has
 * its heading, tiles and footer), and the authored figures still match the roster they
 * were transcribed from.
 *
 * The path is asserted to exist first. A claim keyed to a package path that is not in the
 * checkout answers "not here" and passes — that has already swallowed eight canvas claims
 * for a session.
 */
const reportsDir = 'vls_demo_data_package_2026-08-10/07_reports'
const reportsPkgPath = `${reportsDir}/report_authoring_data.json`
const reportsPkgHere = existsSync(join(root, reportsPkgPath))
const reportsIngest = read('scripts/ingest-reports.mjs')
expect(
  'the reports package is where its ingest reads it from',
  reportsPkgHere && reportsIngest.includes(reportsDir),
  reportsPkgHere ? reportsPkgPath : `${reportsPkgPath} is not in this checkout`,
)

const reports = db.reports
const reportsPkg = reportsPkgHere ? JSON.parse(read(reportsPkgPath)) : null

expect(
  'every report the package defines reached db.reports',
  reportsPkg !== null && reports.reports.length === reportsPkg.starters.length,
  `${reports.reports.length} reports · ${reports.reports.map((r) => r.report_id).join(', ')}`,
)

/* The extraction resolved. A report with no tiles or no footer would render as a heading
   over a table, losing both the figures it is quoted for and the source it is cited by. */
expect(
  'every report carries the copy its page prints',
  reports.reports.every(
    (r) => r.heading && r.subtitle && r.badge && r.tiles.length > 0 && r.footer.length > 0,
  ),
  reports.reports.map((r) => `${r.report_tag} ${r.tiles.length} tiles`).join(' · '),
)

/*
 * A `kpis` block must not reach db.reports: its four keys and the report's four authored
 * tiles are the same summary, and rendering both would print it twice — two truths about
 * one figure, which is the failure this repo keeps guarding.
 */
expect(
  'no report renders its summary twice',
  reports.reports.every((r) => r.blocks.every((b) => b.type !== 'kpis')),
  'the tiles are report-level; the kpis block is dropped at ingest',
)

/*
 * The authored tiles against the roster, recomputed here from `db.reports.data` — the
 * same identities the ingest checks against the package, so a hand-edit to db.json is
 * caught as well as a package change. A tile is the most quotable figure on a report and
 * the least likely to be re-derived by hand.
 */
const repGen = reports.data.generators
const repQ = reports.data.quarters
const repSum = (rows, key) => rows.reduce((t, r) => t + r[key], 0)
const repInt = (v) => Math.round(v).toLocaleString('en-US')
const repCd = repGen.filter((g) => g.cd === true)
const tileOf = (reportId, label) =>
  reports.reports
    .find((r) => r.report_id === reportId)
    ?.tiles.find((t) => t.label.toLowerCase().includes(label.toLowerCase()))?.value ?? null

const TILE_IDENTITIES = [
  ['risk', 'Distinct generators', repInt(repGen.length)],
  /* The register's headline figure, and the one a roster edit moves first: the other
     counts survive a changed penalty, so without this the whole set passed over a
     generator whose exposure had been edited. */
  ['risk', 'Total penalty exposure', `$${(repSum(repGen, 'penalty') / 1e6).toFixed(2)}M`],
  ['risk', 'With enforcement history', repInt(repGen.filter((g) => g.enf > 0).length)],
  ['risk', 'Consent-decree generators', repInt(repCd.length)],
  ['cd', 'Tonnage exposure', repInt(repSum(repCd, 'tons'))],
  ['cd', 'Their combined penalty', `$${Math.round(repSum(repCd, 'penalty') / 1000)}k`],
  ['quarterly', 'Total inbound manifests', repInt(repSum(repQ, 'manifests'))],
  ['quarterly', 'Total tonnage', repInt(repSum(repQ, 'tons'))],
  ['quarterly', 'Rejections / residue', `${repInt(repSum(repQ, 'rej'))} / ${repInt(repSum(repQ, 'res'))}`],
]
const staleTiles = TILE_IDENTITIES.filter(([id, label, want]) => tileOf(id, label) !== want)
expect(
  'every checked tile still agrees with the roster it was transcribed from',
  staleTiles.length === 0,
  staleTiles.length === 0
    ? `${TILE_IDENTITIES.length} identities: ${TILE_IDENTITIES.map(([, l, v]) => `${l} ${v}`).join(' · ')}`
    : staleTiles
        .map(([id, label, want]) => `${id}/${label} reads ${tileOf(id, label)}, roster computes ${want}`)
        .join('; '),
)

/*
 * A scoped report has to select what its own tiles count. Without this the
 * consent-decree report could widen to all 36 generators while its tiles still said 4 —
 * and a wider report reads as a bigger exposure.
 */
const SCOPE_FILTERS = {
  all: (rows) => rows,
  cd: (rows) => rows.filter((r) => r.cd === true),
  enf: (rows) => rows.filter((r) => r.enf > 0),
  oos: (rows) => rows.filter((r) => r.state !== 'TX'),
}
const scoped = reports.reports.filter((r) => r.scope !== 'all')
expect(
  'a scoped report selects exactly what its tiles claim',
  scoped.length > 0 &&
    scoped.every((r) => {
      const rows = SCOPE_FILTERS[r.scope]?.(reports.data[r.spine]) ?? []
      return r.tiles.some((t) => t.value === repInt(rows.length))
    }),
  scoped.map((r) => `${r.report_id} scope=${r.scope}`).join(' · ') || 'no scoped report to check',
)

/*
 * Every column a table can render has a header. `reports.fields` describes the generator
 * register only, so the other three rosters' columns are labelled by `REPORT_LABELS` in
 * server.mjs — and a column in neither prints its raw key as a header (`gen_state`).
 */
const labelMapBody = /const REPORT_LABELS = \{([\s\S]*?)\n\}/.exec(server)?.[1] ?? ''
const labelledKeys = new Set([
  ...reports.fields.map((f) => f.key),
  ...[...labelMapBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]),
])
const unlabelled = [
  ...new Set(Object.values(reports.data).flatMap((rows) => Object.keys(rows[0]))),
].filter((key) => !labelledKeys.has(key))
expect(
  'every roster column has a header, from the field dictionary or REPORT_LABELS',
  labelMapBody.length > 0 && unlabelled.length === 0,
  labelMapBody.length === 0
    ? 'REPORT_LABELS was not found in server.mjs — this check cannot run'
    : unlabelled.length > 0
      ? `no header for: ${unlabelled.join(', ')} — they would print as raw keys`
      : `${labelledKeys.size} labelled keys, none missing`,
)

/* Every block reference resolves against the spine it reads. The server refuses these at
   boot; asserted here so it fails the build first. */
const badBlocks = []
for (const r of reports.reports) {
  const rows = reports.data[r.spine] ?? []
  const rowKeys = new Set(Object.keys(rows[0] ?? {}))
  if (rows.length === 0) badBlocks.push(`${r.report_id} reads spine "${r.spine}", which has no rows`)
  for (const b of r.blocks) {
    if (b.type === 'chart' && !rowKeys.has(b.measure)) badBlocks.push(`${r.report_id} charts ${b.measure}`)
    if (b.type === 'quarterly' && !rowKeys.has(b.metric)) badBlocks.push(`${r.report_id} trends ${b.metric}`)
    for (const c of b.type === 'table' ? b.cols : []) {
      if (!rowKeys.has(c)) badBlocks.push(`${r.report_id} tabulates ${c}`)
    }
  }
}
expect(
  'every block reads a column its spine carries',
  badBlocks.length === 0,
  badBlocks.length === 0
    ? `${reports.reports.reduce((t, r) => t + r.blocks.length, 0)} blocks over ${Object.keys(reports.data).length} rosters`
    : badBlocks.join('; '),
)
expect(
  'and validateDb refuses one that does not',
  /reports "\$\{r\.report_id\}" charts/.test(server) &&
    /reports "\$\{r\.report_id\}" tabulates/.test(server),
  'a blank column reads as "no data" rather than as a broken reference',
)

/*
 * One chart component for the whole app. A report's chart payload is an answer's chart
 * payload, so `ReportBlock` draws nothing itself — a second chart file would be a second
 * set of rules about what a bar means, and this repo has already had two truths about one
 * drawing.
 */


/*
 * **The report section is one route and a published-graph gate.**
 *
 * The prototype owns its own navigation — three tabs and its own library — so there is no
 * per-report URL the way the React section had. What this app contributes is the shell mount
 * and the precondition: available once a graph is published, the same rule Ask and the lens
 * follow, through the same component that states it.
 */
const reportRoutes = read('src/routes.tsx')
const reportsPage = read('src/pages/ReportsPage.tsx')
expect(
  'the report section is one route, gated on a published graph',
  /\{ path: 'reports', element: <ReportsPage \/> \}/.test(reportRoutes) &&
    /* One route, not the four the React section had. */
    !/path: 'reports\//.test(reportRoutes) &&
    /publishedCount === 0/.test(reportsPage) &&
    /<NoPublishedGraph/.test(reportsPage) &&
    /* The gate reads the API; it does not guess from something local. */
    /createReadStore\(getReports\)/.test(reportsPage),
  'one page, and it opens only once something is published',
)
expect(
  'and the endpoints behind it are still served',
  server.includes("match: (p) => p === '/reports'") &&
    /match: \(p\) => \/\^\\\/reports\\\/\[\^\/\]\+\$\/\.test\(p\)/.test(server),
  'the section reads published_count from it; the rest is waiting for a UI that asks',
)

/* ---------------- the report section: gates and authoring ---------------- */

/*
 * Both gates, and neither serves the reports' copy.
 *
 * A card headed "Inbound Generator Risk Register · 36 generators" above "No data source is
 * connected" is a claim about data that is not there — the mistake the What-if page had to
 * be corrected for — and the same is true above "No graph has been published". The server
 * is where it cannot come back: the gated branch nulls the persona, the picker set and the
 * graph, not only the figures.
 */
/*
 * Asserted field by field rather than as one sequence: the first version of this claim
 * matched the whole literal in order, so adding `graphs: []` to the gated payload broke it
 * while the fact it guards was still true. A claim keyed to the order of an object literal
 * is keyed to the spelling.
 */
/* Sliced from the section route by name. The first version of this slice matched on the
   condition alone and found the What-if branch, which has the same gate and none of these
   fields — a claim that reads the wrong function is not reading the code it names. */
const reportsIndexRoute =
  /match: \(p\) => p === '\/reports',[\s\S]*?\n  \},/.exec(server)?.[0] ?? ''
const gatedBranch =
  /if \(counts\.published_count === 0\) \{[\s\S]*?\}\)\r?\n\s*\}/.exec(reportsIndexRoute)?.[0] ?? ''
const withheld = ['graph: null', 'graphs: []', 'saved: []', 'authoring: null']
expect(
  'the report endpoints send no copy while nothing is published',
  gatedBranch.length > 0 &&
    withheld.every((field) => gatedBranch.includes(field)) &&
    /connected_sources: connected, \.\.\.counts, report: null/.test(server),
  gatedBranch.length === 0
    ? 'the gated branch was not found — this check cannot run'
    : 'the gate withholds the copy, the graphs and the pickers, not just the figures',
)
/*
 * **Publication is the only precondition**, on all four gated routes — the section, one
 * report, a saved report and the What-if frame. A connected source is deliberately *not*
 * one: publishing a graph is already downstream of having something to build it from, and
 * a second gate in front of it only tells the reader to fix something that is not stopping
 * them. Counting occurrences alone was too weak once — weakening the lens's gate left the
 * others behind and the claim passed — so the lens is checked by name as well.
 */
const whatifRoute = /match: \(p\) => p === '\/whatif',[\s\S]*?\n  \},/.exec(server)?.[0] ?? ''
expect(
  'all four gated routes check publication, and nothing else',
  (server.match(/if \(counts\.published_count === 0\)/g) ?? []).length >= 4 &&
    !/connected === 0 \|\| counts\.published_count/.test(server) &&
    whatifRoute.length > 0 &&
    whatifRoute.includes('counts.published_count === 0'),
  whatifRoute.length === 0
    ? 'the /whatif route was not found — this check cannot run'
    : 'reports, one report, a saved report and the lens share one rule',
)
/*
 * **The persona is not served to the section.** It was a strip above the grid; that was
 * removed, so the payload stopped carrying it. `db.reports.meta` is still read on this side —
 * `entity_plural` labels a computed tile and names the rows a chart dropped, `source_trace`
 * is on every report — which is exactly why the *unrendered* half must not be sent: a
 * payload field nothing prints is the one that gets printed later by accident.
 */
/* `reportsList` takes the reading role now, so the slice cannot assume an empty parameter
   list — a claim keyed to a signature breaks the moment the function grows an argument. */
const reportsListBody =
  /const reportsList = \([^)]*\) => \(\{[\s\S]*?\n\}\)/.exec(server)?.[0] ?? ''
expect(
  'the section payload carries no persona, and the server still uses one',
  reportsListBody.length > 0 &&
    !/^\s*meta:/m.test(reportsListBody) &&
    !client.includes('personaName') &&
    /db\.reports\.meta\.entity_plural/.test(server) &&
    /source_trace: db\.reports\.meta\.source_trace/.test(server),
  reportsListBody.length === 0
    ? 'reportsList was not found — this check cannot run'
    : 'nothing renders the persona, so nothing is sent it',
)

/*
 * **The Library is one grid of governed definitions.**
 *
 * Written and composed reports are the same kind of thing here — a question somebody is
 * accountable for — so they are listed together, from the server's governance list, and told
 * apart by `kind` rather than by which array they arrived in. Two grids was the earlier model and
 * it put the same composed report in both when the second one was added.
 *
 * Each still opens at its own URL: a written definition at `/reports/:reportId`, a composed one at
 * `/reports/saved/:savedId`.
 */

/*
 * **Three tabs, and the governance behind them is the server's arithmetic.**
 *
 * Library says what exists, Author says who may write one, Operations & audience says how both are
 * governed. Every count, cell and check on them is computed in `reportGovernanceView` on each
 * request — a chip that counted its own filtered array would be a second answer to "how many are
 * published", and a governance grid is the worst place to have two.
 */
const govBody = /const reportGovernanceView = \(asRole\) => \{[\s\S]*?\n\}/.exec(server)?.[0] ?? ''
expect(
  'the governance figures are computed per request, not stored',
  govBody.length > 0 &&
    /const count = \(key\) =>/.test(govBody) &&
    /entitled_count: rows\.filter\(entitledTo\)\.length/.test(govBody) &&
    /* And `db.reports.governance` holds decisions only — no count, no cell, no check. */
    !/count:\s*\d/.test(JSON.stringify(db.reports.governance)),
  govBody.length === 0
    ? 'reportGovernanceView was not found — this check cannot run'
    : 'a chip that counted its own filtered array would be a second answer',
)

/*
 * **The two gates are never collapsed into one, and gate 2 admits it is not applied.**
 *
 * Gate 1 is who may see that a report exists; gate 2 is which rows a predicate admits. The notes
 * that say so are served, so the components render them rather than holding a second copy — and
 * gate 2's says **declared, not applied**, because no roster in this prototype is filtered per
 * persona and a silent predicate would claim a filter that never ran.
 */

/*
 * `db.reports.governance` is required, and nested — the same reason
 * `graph_studio.sanity_checks` is. Losing it does not throw: the Library would render with no
 * lifecycle chips and the Operations tab with no gates, and an ungoverned report section reads as
 * a section with nothing to govern.
 */
expect(
  'the governance block is required at boot, and the seed refuses to write a broken one',
  /isObject\(v\.governance\) &&/.test(server) &&
    /Array\.isArray\(v\.governance\.data_scope\)/.test(server) &&
    /seed-report-governance: refusing to write/.test(read('scripts/seed-report-governance.mjs')) &&
    /has no data scope row/.test(read('scripts/seed-report-governance.mjs')),
  'refused at boot, and refused at the seam that writes it',
)

/*
 * **The Library's lifecycle chips: one pool, one count, and no state without a home.**
 *
 * The chip bar is `governance.statuses` — the states the tenant declares, plus a leading
 * `current` the server computes as everything not archived. Three ways this goes quietly wrong,
 * so three claims.
 */
const seed = read('scripts/seed-report-governance.mjs')
const stateKeys = db.reports.governance.statuses.map((s) => s.key)
expect(
  'every governed report sits in a declared lifecycle state',
  stateKeys.length > 0 &&
    db.reports.governance.reports.length > 0 &&
    db.reports.governance.reports.every((r) => stateKeys.includes(r.status)) &&
    /* Refused at boot and at the seam that writes it — a status with no state has no label, so
       the card prints the raw key, and it matches no chip, so every other chip under-counts. */
    /v\.governance\.statuses\.some\(\(s\) => s\.key === g\.status\)/.test(server) &&
    /which is not one of the lifecycle states/.test(seed),
  `${stateKeys.length} states, ${db.reports.governance.reports.length} definitions: ` +
    db.reports.governance.reports.map((r) => `${r.report_id}=${r.status}`).join(' '),
)
expect(
  'a state declares its own label and tone, and the server keeps no second copy',
  db.reports.governance.statuses.every((s) => s.key && s.label && s.tone) &&
    /* Read from the pool, not from a map beside it: a state tinted `warn` on a card and
       `neutral` on the chip counting it is two answers to what the state is. */
    /const reportStatusTone = \(key\) => reportState\(key\)\?\.tone/.test(server) &&
    !/REPORT_STATUS_TONE/.test(server) &&
    /* And each state the pool declares needs its own entitlement cell, or it falls through the
       chain into the archived one — which tells an audience it can open something unpublished. */
    stateKeys
      .filter((k) => k !== 'archived')
      .every((k) => new RegExp(`governanceRow\\.status === '${k}'`).test(server)),
  `tones from the pool: ${db.reports.governance.statuses.map((s) => `${s.key}/${s.tone}`).join(' ')}`,
)
/*
 * And the chips print the count they were served. A count computed beside the grid is the second
 * answer this whole section is built to avoid — `LibraryPane` reads `s.count` and filters rows by
 * the same rule the server counts them with (`current` is everything not archived).
 */
const libraryPane = read('src/reports/panes/LibraryPane.tsx')
const chipBar = /<div className="rp-chipRow"[\s\S]*?<\/div>/.exec(libraryPane)?.[0] ?? ''
expect(
  'the chip bar prints the served count and never one of its own',
  chipBar.length > 0 &&
    /\{s\.count\}/.test(chipBar) &&
    /\{s\.label\}/.test(chipBar) &&
    !/\.filter\(/.test(chipBar) &&
    !/\.length/.test(chipBar) &&
    /* The page hands the payload down; the prototype declares the shape rather than importing
       the client's, so it still stands alone with no host. */
    /governance=\{data\?\.governance\}/.test(read('src/pages/ReportsPage.tsx')) &&
    /key === 'current' \? rows\.filter\(\(r\) => r\.status !== 'archived'\)/.test(libraryPane),
  chipBar.length === 0
    ? 'the chip bar was not found — this check cannot run'
    : 'labels, tones and counts all arrive decided',
)

/*
 * **`db.reports` is rebuilt wholesale by the ingest, so everything else that writes into it has to
 * be carried forward there.**
 *
 * `db.reports = { … }` is a delete of every key not listed. `saved` was carried by hand; `governance`
 * was added later by a different script and was not, so a re-ingest would have dropped every
 * audience and data-scope row. The list is read off the validator rather than remembered, so a key
 * required later is covered without editing this claim.
 */
const ingestReports = read('scripts/ingest-reports.mjs')
const ingestLiteral = /db\.reports = \{[\s\S]*?\n\}/.exec(ingestReports)?.[0] ?? ''
/*
 * The keys `validateDb` demands under `reports` — read from that branch of `DB_SHAPE` and nowhere
 * else, so the list is the validator's rather than one kept here. It is the last entry in the
 * object, so the slice is anchored on the *next declaration* rather than on a brace: a brace at that
 * indent appears several times inside the branch itself.
 *
 * `\r?\n`, never a bare `\n` — these files check out with CRLF on Windows, and the first version of
 * this claim matched nothing and reported it as "0 of 0 keys, all carried" until the cannot-run
 * guard caught it.
 */
const reportsBranch =
  /\r?\n {2}reports: \(v\) =>[\s\S]*?\r?\n\}\r?\n\r?\nconst DB_HINTS/.exec(server)?.[0] ?? ''
const requiredUnderReports = [...reportsBranch.matchAll(/\bv\.([a-z_]+)\b/g)].map((m) => m[1])
expect(
  'every key the report section requires survives a re-ingest',
  ingestLiteral.length > 0 &&
    requiredUnderReports.length > 5 &&
    /* `key:` or the shorthand `key,` — the ingest writes `reports,` from a local of that name. */
    [...new Set(requiredUnderReports)].every((key) =>
      new RegExp(`\\b${key}\\s*[:,]`).test(ingestLiteral),
    ) &&
    /* And it refuses rather than writing a document the server cannot boot. */
    /refusing to write — db\.reports\.governance is missing/.test(ingestReports),
  ingestLiteral.length === 0 || requiredUnderReports.length <= 5
    ? 'the ingest literal or the validator branch was not found — this check cannot run'
    : 'dropped by the re-ingest: ' +
      ([...new Set(requiredUnderReports)]
        .filter((key) => !new RegExp(`\\b${key}\\s*[:,]`).test(ingestLiteral))
        .join(', ') ||
        'nothing, so it is the refusal message that is missing'),
)

/*
 * **A private audience is a decision, and the two surfaces that touch it want different rules.**
 *
 * Share can set `audience: []`, so the server has to boot with one — while the seed still refuses an
 * empty audience, because there it can only be a typo. And the publish check tests that every
 * persona the audience *names* resolves, so private passes and what fails is an audience naming a
 * persona that was removed under it.
 */
expect(
  'an empty audience boots, the seed still refuses one, and the publish check reads integrity',
  /* Not `length > 0` any more — a Share-to-nobody would have failed the commit. */
  !/governance\.reports\.every\([\s\S]*?g\.audience\.length > 0/.test(server) &&
    /Array\.isArray\(g\.audience\),/.test(server) &&
    /is entitled to nobody — seed an audience/.test(seed) &&
    /pass: r\.audience_named === r\.entitled_roles\.length/.test(server) &&
    /private - shared with nobody/.test(server),
  'the seed and the API want different invariants on one field, deliberately',
)

/*
 * **The three acts on a row, and the two claims they cannot be built without.**
 *
 * Each commits, because each is somebody's decision — and none of them is access control, which the
 * picker has to say on the page in those words.
 */
const sharePicker = read('src/reports/components/SharePicker.tsx')
const reportsApp = read('src/reports/App.tsx')
const reportsCss = read('src/pages/ReportsPage.css')
expect(
  'Share, Delete and Request access all commit, and each answers with the governance view',
  /match: \(p\) => \/\^\\\/reports\\\/governance\\\/\[\^\/\]\+\\\/audience\$\//.test(server) &&
    /match: \(p\) => p === '\/reports\/access-requests'/.test(server) &&
    /* Committed rather than in memory: a restart must not forget who a report was shared with. */
    (server.match(/access_requests: \[/g) ?? []).length > 0 &&
    (server.match(/governance: reportGovernanceView\(reportRoleFrom\(query\)\)/g) ?? []).length === 3 &&
    /* Delete drops the governance row and says how to get it back. */
    /restore: 'node scripts\/seed-report-governance\.mjs'/.test(server) &&
    /this is the last governed definition/.test(server),
  'three writes, one reader of the role, and a delete that admits it is reversible',
)
expect(
  'the picker renders the served role pool and says it is not access control',
  /* No copy of the four personas here — the pool arrives as a prop from `GET /auth/roles`. */
  !/business_user_executive|domain_architect|platform_admin/.test(sharePicker) &&
    /roles\.map\(\(role\) =>/.test(sharePicker) &&
    /not access control/.test(sharePicker) &&
    /createReadStore\(listAuthRoles\)/.test(read('src/pages/ReportsPage.tsx')) &&
    /* Its own component, or `renderToString` renders it closed and every assertion about it is
       vacuous — the `ConnectSourceWizard` rule. */
    /import \{ ShareDialog, type ShareRole \} from '\.\/components\/SharePicker'/.test(reportsApp),
  'the pool is served, the caveat is on the page, and the panel is assertable',
)

/*
 * **The Share picker is a dialog at the page's root, and nothing in a card may expand.**
 *
 * It began as a panel inline under the row it changed. The grid's cards are equal-height with their
 * action row pinned by `margin-top: auto`, so a card that grew by 400px stretched every sibling in
 * its row and left four cards with a chasm between their text and their buttons — the second time
 * this repo has met that trap. The guard is structural: the pane must hold neither the picker nor a
 * dialog, and `App` must render it beside `PublishDialog`.
 */
expect(
  'the share picker cannot stretch the grid it was opened from',
  /*
   * The pane opens it and never *renders* it — keyed on the JSX and on the dialog chrome, not on the
   * module name: the pane still imports `ShareRole` as a type to name the roles a row is shared with,
   * and forbidding that would be keying the claim to a spelling rather than to the fact.
   */
  !/<SharePicker|<ShareDialog|modalBack/.test(libraryPane) &&
    /onShareGoverned\?\(row: GovernedRow\): void/.test(libraryPane) &&
    /<ShareDialog/.test(reportsApp) &&
    /* Held at App level beside the other dialog, not inside the pane. */
    /const \[sharing, setSharing\] = useState/.test(reportsApp) &&
    /* And a label may wrap the row, never itself — four buttons in a 275px column broke every one. */
    /white-space: nowrap/.test(reportsCss) &&
    /minmax\(400px, 1fr\)/.test(reportsCss) &&
    /cards rp-govGrid/.test(libraryPane),
  'a dialog at the root, a wider column, and labels that do not break',
)

/*
 * Nothing in this app approves an access request, and the row has to name who could — "pending" with
 * no addressee is a dead end, and a button that granted it to whoever clicked would be a lie about
 * a login that authenticates by shape.
 */
expect(
  'a pending request names who could answer it, and nothing here grants it',
  /approvers: reportAuthorRoleLabels\(\)/.test(server) &&
    /may_author/.test(server) &&
    !/state: 'approved'/.test(server) &&
    /nothing in this demo grants it/.test(libraryPane),
  'recorded and reported; an audience is widened from Share instead',
)

/*
 * The four report surfaces that used to be checked here — the section, one report, a saved
 * report and the wizard — are gone with the UI. The rule they enforced (publication is the
 * only gate; a connected source is never a second one) now has one surface left, checked
 * below, plus the server-side claim above that all the gated routes test publication alone.
 */

/*
 * The What-if lens is gated on publication too, and shares the empty state. Two components
 * describing one precondition drift; one cannot.
 */
const noPublished = 'src/components/NoPublishedGraph.tsx'
expect(
  'the publish gate is one component, and the lens still uses it',
  existsSync(join(root, noPublished)) &&
    read('src/pages/WhatIfPage.tsx').includes('NoPublishedGraph'),
  'the report pages that shared it are gone; the wrapper and the lens remain',
)
expect(
  'and it names the fix that applies, which differs by what exists',
  read(noPublished).includes('builtCount') && read(noPublished).includes('draftCount'),
  '"publish the build you have" and "nothing is built yet" are different next actions',
)

/*
 * The summary catalogue is the prototype's ten tiles re-expressed as data, so the server
 * has to implement every aggregation and format it names. One it does not would render as
 * a blank tile beside three figures, which reads as a zero.
 */
const aggBody = /const REPORT_AGGS = \{([\s\S]*?)\n\}/.exec(server)?.[1] ?? ''
const fmtBody = /const REPORT_FORMATS = \{([\s\S]*?)\n\}/.exec(server)?.[1] ?? ''
const implemented = {
  aggs: new Set([...aggBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])),
  formats: new Set([...fmtBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])),
}
const genFieldsForTiles = new Set(Object.keys(reports.data.generators[0]))
const brokenTiles = reports.summary_catalog.filter(
  (t) =>
    !implemented.aggs.has(t.agg) ||
    !implemented.formats.has(t.format) ||
    (t.field !== null && !genFieldsForTiles.has(t.field)),
)
expect(
  'every summary tile aggregates and formats in a way the server implements',
  aggBody.length > 0 && fmtBody.length > 0 && brokenTiles.length === 0,
  aggBody.length === 0
    ? 'REPORT_AGGS was not found in server.mjs — this check cannot run'
    : brokenTiles.length > 0
      ? `broken: ${brokenTiles.map((t) => t.key).join(', ')}`
      : `${reports.summary_catalog.length} tiles · ${implemented.aggs.size} aggregations · ${implemented.formats.size} formats`,
)
expect(
  'and the default summary names tiles that exist',
  reports.summary_default.length > 0 &&
    reports.summary_default.every((k) => reports.summary_catalog.some((t) => t.key === k)),
  reports.summary_default.join(', '),
)

/*
 * A generated report's tiles are computed, and say so. The authored tiles describe the
 * written report over the whole register; showing them against a narrowed frame would
 * attribute the tenant's figures to a question they never answered.
 */
expect(
  'a computed tile is labelled as computed',
  /unit: 'computed for this frame'/.test(server),
  'the built payload labels every tile it recomputed for a frame',
)

/*
 * The horizon is the one assumption that filters nothing, and the app says so twice —
 * where it is chosen and in the built report's caveats. Claiming a time filter that never
 * ran would be the most quotable false statement on the page.
 */
const scopesBody = /const REPORT_SCOPES = \{([\s\S]*?)\n\}/.exec(server)?.[1] ?? ''
const frameRowsBody = /function reportFrameRows\([\s\S]*?\n\}/.exec(server)?.[0] ?? ''
expect(
  'the horizon is declared, not applied — and nothing filters by it',
  /const REPORT_HORIZON_CAVEAT =/.test(server) &&
    /* Twice: on the read-back and on the built report. The built one now leads a list —
       a saved report's graph can add a caveat of its own — so the count is of the
       constant's *use*, not of one exact line. */
    (server.match(/REPORT_HORIZON_CAVEAT,?\r?\n?\s*\]?/g) ?? []).length >= 3 &&
    scopesBody.length > 0 &&
    !scopesBody.includes('horizon') &&
    frameRowsBody.length > 0 &&
    !frameRowsBody.includes('horizon') &&
    claude.includes('The horizon is declared, not applied'),
  'stated on the read-back and on the built report; the row filters never read it',
)

/*
 * A saved report is a question. Storing a figure would cache an answer that goes stale
 * silently — the same rule the What-if library follows, and the reason both are stored as
 * ids rather than results.
 */
const savedRow = /const row = \{([\s\S]*?)\n      \}/.exec(server)?.[1] ?? ''
expect(
  'a saved report stores its frame and no figures',
  savedRow.length > 0 &&
    savedRow.includes('...frame') &&
    !/tiles|blocks|rows|value/.test(savedRow) &&
    /commitDb\(\{ \.\.\.db, reports: \{ \.\.\.db\.reports, saved \} \}\)/.test(server),
  savedRow.length === 0
    ? 'the saved row literal was not found — this check cannot run'
    : 'the frame and the question, through commitDb, so it survives a restart',
)
expect(
  'and a re-ingest carries the library forward',
  /saved: db\.reports\?\.saved \?\? \[\]/.test(reportsIngest),
  'overwriting it would delete saved questions on the next ingest',
)

/*
 * Reading a question back is paced; building is not. The first is the model-shaped act the
 * copy promises ("I'll read it back"); the second is a read over the rosters, like a
 * What-if scenario, and pacing it would teach that a traversal costs what a model does.
 */
const readRoute = /match: \(p\) => p === '\/reports\/read'[\s\S]*?\n  \},/.exec(server)?.[0] ?? ''
const buildRoute = /match: \(p\) => p === '\/reports\/build'[\s\S]*?\n  \},/.exec(server)?.[0] ?? ''
expect(
  'the read-back is paced and the build is not',
  readRoute.includes('SUGGEST_MS') && buildRoute.length > 0 && !/_MS/.test(buildRoute),
  'a picked standard report is not paced either — the chip is the answer',
)
expect(
  'and the read-back returns no figures',
  readRoute.length > 0 && !/tiles|blocks/.test(readRoute),
  'nothing runs against the data until the sentence is confirmed',
)

/* The wizard's route-order claim went with the wizard. The rule it followed — declare the
   specific path before the dynamic one, never rely on ranking — is still asserted by the
   full-window canvas claim further down, which is where this repo learned it. */

/* ---------------- reports: the graph, the template, and a saved report ---------------- */

/*
 * A report is asked *of a published graph*, so the graph is part of the frame and the
 * server refuses one that is not live. Defaulting silently to whatever is newest would
 * attribute the figures to content nobody picked — the same class of quiet substitution as
 * a matcher answering a question nobody asked.
 */
expect(
  'the frame names the graph a report is asked of, and an unpublished one is refused',
  /use_case_id: body\.use_case_id \? String\(body\.use_case_id\) : null/.test(server) &&
    /is not a published graph — published:/.test(server) &&
    client.includes('use_case_id: frame.useCaseId'),
  'chosen on step 1, carried through read → build → save',
)
expect(
  'and the API offers every published graph, not just the newest',
  /const reportGraphs = \(\) =>/.test(server) &&
    /graphs: reportGraphs\(\)/.test(server),
  'the payload lists them; a frame naming an unpublished one is refused',
)

/*
 * **One report template.** The package ships five rendered reports with a fixed anatomy,
 * and a report composed in the wizard is that same anatomy asked under a different frame.
 * When the layout lived in two files the wizard's copy had already drifted — no badge, its
 * own tag row, a different footer — which is two answers to "what does a report look like".
})

/*
 * Taking a standard report directly reads and builds it — and **stops there**, because the
 * one thing the app must not decide is what to call it. A row named by the app is one nobody
 * recognises a week later, and three of them read as duplicates rather than as three
 * questions. So `generate` does not save; the page asks for a name and the save is the
 * reader's act.
 */

/*
 * Who saved a report. The identity is client-held, so the route has to be *told* — the rule
 * the consent callback established, and the reason a malformed saved_by is a 400 rather
 * than a quietly recorded name.
 */
expect(
  'a saved report records who saved it, and is told rather than guessing',
  /is not an email — send the signed-in address as saved_by/.test(server) &&
    /saved_by: savedBy \?\? saved\[existing\]\?\.saved_by \?\? null/.test(server),
  'the identity is client-held, so the route has to be told',
)

/*
 * **And so does publishing.** Every "published by" line in the app — Ask, a report's footer,
 * the wizard's graph cards, the section's graph list — used to read `db.google_account`, the
 * seeded account, with no way for a reader to know it was not the person who pressed the
 * button. The publish route is now told `?as=`, keeps it per `useCaseId:sha`, and one helper
 * reports it: a second place deriving a publisher would be a second answer to "who".
 */
expect(
  'publishing records who did it, and every line reads that one record',
  /const studioPublishedBy = new Map\(\)/.test(server) &&
    /const publishedByFor = \(useCaseId\)/.test(server) &&
    /* Set *or cleared* on every publish: merging would credit the previous publisher for
       an anonymous re-publish, which a smoke run caught it doing. */
    /studioPublishedBy\.set\(`\$\{id\}:\$\{sha\}`, as\)/.test(server) &&
    /studioPublishedBy\.delete\(`\$\{id\}:\$\{sha\}`\)/.test(server) &&
    !/published_by: db\.google_account\.email/.test(server) &&
    (server.match(/published_by: publishedByFor\(/g) ?? []).length >= 2 &&
    client.includes('as ? `${path}?as=${encodeURIComponent(as)}`') &&
    read('src/store/graphStudioStore.ts').includes('useAuthStore.getState().identity?.email'),
  'told at publish time, with the tenant account as the fallback for an untold one',
)

/*
 * Opening a saved report re-asks it, and one whose graph has since been unpublished says so
 * instead of claiming live content answered it. Publication is in memory, so that is the
 * state after every restart.
 */
expect(
  'a saved report is re-asked, and an unpublished graph is reported not hidden',
  server.includes("match: (p) => /^\\/reports\\/saved\\/[^/]+$/.test(p)") &&
    /which is not published right now/.test(server),
  'the row holds a frame, so opening it and generating it are one act',
)
/* Its route-order claim went with the route — see the note where the report routes used to be
   asserted. The endpoint itself is still checked, above. */

/* ---------------- the What-if lens draws its graph references ---------------- */

/*
 * Two drawings — the pool's frame and one load's traversal — and **neither invents anything
 * it asserts**. The node types, their labels and their colours are the package's
 * (`graph_reference.node_types`); the frame's centre, its edge name and its cap are
 * `graph_reference.frame`; and a scenario's edges are built server-side with every label
 * taken from the graph's declared relationship list. A component picking a hue would be
 * inventing a legend, and an edge named in a component would claim a relationship the graph
 * may not have.
 */
const whatIfGraphSrc = read('src/components/WhatIfGraph.tsx')
const declaredRelationships = new Set(db.whatif.graph_reference.relationships)
const subgraphFn = /function whatifSubgraph\(generator\)[\s\S]*?\n\}/.exec(server)?.[0] ?? ''
const edgeLabels = [...subgraphFn.matchAll(/rel\('([A-Z_]+)'\)/g)].map((m) => m[1])
expect(
  'every edge the traversal draws is a relationship the graph declares',
  subgraphFn.length > 0 &&
    edgeLabels.length >= 4 &&
    edgeLabels.every((l) => declaredRelationships.has(l)),
  subgraphFn.length === 0
    ? 'whatifSubgraph was not found — this check cannot run'
    : `${edgeLabels.join(' · ')} — all in graph_reference.relationships`,
)
/*
 * Both readers of the palette, checked separately: the fill lookup and the legend. Asserting
 * the expression once passed while the *fill* had been swapped for a local palette and only
 * the legend still read the data — a claim that finds an expression somewhere does not say
 * where.
 */
const fillFn = /function fillFor\([\s\S]*?\n\}/.exec(whatIfGraphSrc)?.[0] ?? ''
const legendFn = /function Legend\([\s\S]*?\n\}/.exec(whatIfGraphSrc)?.[0] ?? ''
expect(
  'and the drawing takes its palette and its cap from the package',
  fillFn.includes('frame.graphReference.nodeTypes') &&
    fillFn.includes('riskColors') &&
    legendFn.includes('frame.graphReference.nodeTypes') &&
    whatIfGraphSrc.includes('rules.maxDrawn') &&
    whatIfGraphSrc.includes('rules.edge') &&
    /* The cap is stated on the drawing: seven standing for twenty-four is otherwise a
       silent sample, which is the rule the answer charts and the studio queue also keep. */
    whatIfGraphSrc.includes('first ${drawn.length} drawn'),
  'node types, their colours, the centre, the edge and the 7-node cap are all data',
)
expect(
  'the lens draws its own SVG rather than pulling a chart library',
  whatIfGraphSrc.includes('<svg') &&
    !/from '(?!\.|react)/.test(whatIfGraphSrc.replace(/from '\.\.\/api\/client'/g, '')) &&
    !read('package.json').includes('d3') &&
    !read('package.json').includes('chart.js'),
  'the same rule the studio canvas and the answer charts follow',
)
/* An absence has no circle: the nodes a scenario draws are conditional on what the
   generator carries, which is decided on the server and asserted here. */
expect(
  'a clean load draws no enforcement node and no document',
  /* Conditional on both sides: the node *and* its edge. Asserting only the node would pass
     over a diagram that drew an edge to something absent. */
  subgraphFn.includes('...(hasEnforcement') &&
    subgraphFn.includes('...(generator.consent_decree') &&
    (subgraphFn.match(/\.\.\.\(hasEnforcement/g) ?? []).length === 2 &&
    (subgraphFn.match(/\.\.\.\(generator\.consent_decree/g) ?? []).length === 2,
  'the same rule the studio canvas keeps for a relationship nobody proposed',
)

/* ---------------- a report's chip bar, and what a chip does ---------------- */

/*
 * **A chip re-asks the report; it never hides rows.**
 *
 * The tiles and the charts above a table are the server's figures. Filtering rows in the page
 * would leave them describing a set the table no longer shows — two answers on one screen,
 * which is the failure this whole section is built to avoid. So the chip hands the slice up,
 * the report is rebuilt under **the frame it states**, and every figure comes back computed
 * for that slice. `frame` exists on the payload in *values* for exactly this: reconstructing
 * a scope from its printed label would be guessing at what the report had already been told.
 */
expect(
  'a chip re-asks the report with its own frame, in values',
  /frame: \{[\s\S]*?report_id: report\.report_id/.test(server) &&
    /facets: reportFacetsFor\(report\.spine\)/.test(server),
  'recovering a scope from its printed label would be guessing at what it was told',
)
/* The claim that every report surface offered the chip bar went with those surfaces. What the
   server still owes a future UI is asserted above: the frame in values, and the facets. */

/*
 * Facets are per spine, and the frame validator asks the same function the chips came from.
 * Checking only the generator dictionary refused a facility's role and a quarter's year —
 * facets the report itself renders — so a chip would have offered a filter the API rejected.
 */
expect(
  'the facets the chips render are the facets a frame may filter by',
  /const reportFacetsFor = \(spine\) =>/.test(server) &&
    /const facets = reportFacetsFor\(report\.spine\)/.test(server) &&
    /facets: reportFacetsFor\(report\.spine\)/.test(server),
  'one function behind the chips and the refusal, so they cannot disagree',
)
/* The one facet whose value is not a column of its own still filters by the same rule. */
expect(
  'the trace flags filter by test, and the tests are the values the chips offer',
  /const REPORT_FLAG_TESTS = \{/.test(server) &&
    ['rejected', 'residue', 'out_of_state'].every((v) =>
      new RegExp(`${v}: \\(t\\) =>`).test(server),
    ),
  'rejected · residue · out-of-state — three columns, one control',
)

/*
 * The column form. Vertical bars exist for the one case horizontal loses — a short label over
 * a series that reads left to right — and the guard is that the *form* is still chosen by the
 * data: a long label falls back to bars however the payload asks.
 */
const answerChartSrc = read('src/components/AnswerChart.tsx')
expect(
  'a column chart falls back to bars when there are too many of them',
  /* The rule moved from label length to row count: a name is elided to fit under four
     columns, which is how the package draws its decree-bound generators, and thirty-six
     of them is what horizontal bars exist for. */
  answerChartSrc.includes("block.chart === 'column' && data.length <= 8") &&
    /function Columns\(/.test(answerChartSrc) &&
    /d\.label\.length > 16/.test(answerChartSrc) &&
    claude.includes('column'),
  'the form comes from the data’s job, not only from the field',
)

/* ---------------- a report renders like the rendered report ---------------- */

/*
 * Three ways the app's register drifted from the package's, all of them visible side by side:
 * the table showed the starter's six columns where the rendered report prints ten, every bar
 * was one hue where the package colours by risk tier, and the drawing sat at answer width in a
 * card twice as wide with its title printed above it a second time.
 */
const registerCols = db.reports.reports.find((r) => r.report_id === 'risk')?.blocks.find(
  (b) => b.type === 'table',
)?.cols ?? []
expect(
  'the register tabulates the columns its rendered report prints',
  registerCols.length === 10 &&
    ['evals', 'enf', 'tons', 'manifests'].every((k) => registerCols.includes(k)) &&
    reportsIngest.includes('const TABLE_COLS'),
  `${registerCols.join(', ')}`,
)
expect(
  'a bar may carry its row’s risk tier, and only a state may vary the hue',
  /tone: r\.risk === 'high' \? 'crit'/.test(server) &&
    /const TONE_HUE = \{/.test(answerChartSrc) &&
    /fill=\{d\.tone \? TONE_HUE\[d\.tone\] : DATA_HUE\}/.test(answerChartSrc),
  'length still encodes the value; the table beside it repeats the tier with an icon',
)
/*
 * The scorecard is **one grouped chart**, not one per measure.
 *
 * Evaluations beside violations per facility *is* the comparison the report makes; two separate
 * charts make it two findings a reader has to hold at once. Two hues here encode two series and
 * the legend names both — the second of the two things allowed to vary a magnitude chart's hue,
 * the other being a point's state. And it keeps **roster order**: sorting by size would bury
 * the facility the scorecard is about wherever its number falls.
 */
expect(
  'the facility scorecard draws one grouped chart in roster order',
  /function reportGroupedChart\(report, keys, title\)/.test(server) &&
    /chart: 'grouped'/.test(server) &&
    /series: keys\.map/.test(server) &&
    /* No sort in it: the rows are the roster's, unlike the ranked bars. */
    !/reportGroupedChart[\s\S]{0,600}\.sort\(/.test(server) &&
    /function Grouped\(\{ block \}/.test(answerChartSrc) &&
    answerChartSrc.includes("block.chart === 'grouped' && (block.series?.length ?? 0) > 1"),
  'two series, a legend, and the subject first',
)
expect(
  'and its values table carries every series',
  /block\.series && block\.series\.length > 1/.test(answerChartSrc) &&
    (answerChartSrc.match(/block\.series && block\.series\.length > 1/g) ?? []).length === 2,
  'the header row and the value cells both, or the table describes one measure of two',
)

expect(
  'a report’s chart is drawn at report width, and the cap follows it',
  /width: 900,/.test(server) &&
    answerChartSrc.includes('const width = block.width ?? 520') &&
    /* Every SVG form caps its own upscale — bars, columns and the line. Asserting the
       expression once passed while one of the three had had its cap removed. */
    /* Every drawing caps its own upscale. The ring caps at its own size rather than a
       `width` prop, so the count is of caps, not of the one spelling. */
    (answerChartSrc.match(/maxWidth: (width|size)/g) ?? []).length ===
      (answerChartSrc.match(/<svg/g) ?? []).length,
  'the viewBox grows rather than the cap being lifted, so the text stays its own size',
)

/*
 * The decree report draws a ranking **and the share it raises**.
 *
 * A scoped report says "four generators, 1,876 tons" and immediately provokes "out of what?" —
 * a question its own four rows cannot answer. So a scoped chart carries a companion computed
 * over the whole register, and its 79.3% is the same figure as the tile beside it. The ring
 * replaced a meter: a meter reads as progress toward something, and a share of inbound tonnage
 * is not progress.
 */
expect(
  'a scoped chart carries the share it raises, computed over the whole register',
  /function reportShareChart\(field, title, note\)/.test(server) &&
    /const rows = db\.reports\.data\.generators/.test(
      /function reportShareChart[\s\S]*?\n\}/.exec(server)?.[0] ?? '',
    ) &&
    /companion: share/.test(server),
  'the share is of the register, not of the report’s own rows',
)
expect(
  'and a two-to-four slice donut is drawn as a ring, not a meter',
  /function Ring\(\{ block \}/.test(answerChartSrc) &&
    !/function Meter\(/.test(answerChartSrc) &&
    !read('src/components/AnswerBlocks.css').includes('ab-meter') &&
    answerChartSrc.includes("block.chart === 'donut' && data.length >= 2 && data.length <= 4"),
  'every slice named in the legend, so the ring is never colour-alone',
)
/*
 * Colour: identity at four columns or fewer, state beyond. The package colours its four
 * decree-bound generators by which generator and its thirty-six-row register by risk tier, and
 * the readable form decides — the same rule that makes a long register horizontal bars whatever
 * its block asks for.
 */
expect(
  'a handful of columns are coloured by identity, a long register by state',
  /data\.length <= 4\r?\n\s*\? CATEGORICAL\[i % CATEGORICAL\.length\]\r?\n\s*: d\.tone/.test(
    answerChartSrc,
  ) && /const form = rows\.length <= 6 \? 'column' : 'bar'/.test(server),
  'the block states a preference; the readable form decides',
)

/*
 * **Who a saved report is for — and the honest name for it.**
 *
 * The roles are the tenant's own (`auth_roles`, the login's pool), stored as ids so a renamed
 * role does not leave a stale label behind, and resolved on the way out. An empty audience is
 * refused: it would hide the report from everyone including whoever set it, which is deletion
 * with extra steps.
 *
 * It is **not** access control, and the panel that sets it says so in those words. The role is
 * client-held and the login authenticates by shape, so this narrows what the section *shows* a
 * reader; anything asking the API without a role still gets every row. A control that implied a
 * permission this mock cannot keep would be the worst kind of claim in the app.
 */
expect(
  'a saved report names the roles it is for, from the tenant’s own pool',
  /const reportViewerRoles = \(saved\) =>/.test(server) &&
    /db\.auth_roles\.map\(\(r\) => \(\{ role_id: r\.role_id, label: r\.label \}\)\)/.test(server) &&
    /viewer_roles: reportViewerRoles\(saved\)/.test(server) &&
    /a report no role can view is a report you have deleted/.test(server) &&
    /no such role: \$\{unknown\.join\(', '\)\}/.test(server),
  'ids stored, labels resolved, and both refusals name the fix',
)

/*
 * **The theme sets `Card.bodyPadding: 0`**, so a card in this section has to state its own.
 *
 * It is not a style preference: a body at 0 beside a head at antd's default left every saved
 * report's content flush against the card's left edge while its title sat 24px in, which is the
 * misalignment a reader sees first. Both edges are set from one token, and every card class in
 * the section is listed — a new card that forgets is a new card that looks broken.
 */
/*
 * The card-padding, select-all and card-height claims that stood here read
 * `src/pages/ReportsPage.css` and the components it styled. All of them went with the report
 * UI. The lessons they encoded are not lost — they are entries in `docs/REGRESSIONS.md` and
 * lines in `CLAUDE.md`'s pitfalls, and they will apply again to whatever renders these
 * endpoints next: a card body at 0 beside a default head, a select-all that needs three
 * states, and the equal-height trick breaking a card that expands.
 */


/* ---------------- nav / route parity ---------------- */

/*
 * `[\w-]` and not `\w`: every hyphenated key — `new-graph`, `graph-studio`, `what-if` — was
 * invisible to this, so it parsed 4 of 8 and the `>= 5` below passed by a single entry. Taking
 * one entry out of the sidebar dropped it to 4 and failed the claim, which is the only reason
 * anyone looked. A parse that silently sees half the file is the "0 of N" failure again.
 */
const navKeys = [...nav.matchAll(/^ *\{ key: '([\w-]+)'|^ *key: '([\w-]+)',/gm)]
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
/* Against the paths, which parse independently — if the two disagree, one regex is wrong,
   which is exactly what was true here for however long. */
const navPathCount = [...nav.matchAll(/^ *path: '([^']+)',/gm)].length
expect(
  'nav items parse, and the keys and paths agree on how many there are',
  navKeys.length >= 5 && navKeys.length === navPathCount,
  `${navKeys.length} nav keys, ${navPathCount} nav paths`,
)

/*
 * The two counts in CLAUDE.md's routing paragraph, pinned.
 *
 * They had drifted: the paragraph said "13 entries, eight of them served" long after
 * six keys were commented out, leaving 8 live and 5 served. Prose about a count is the
 * easiest kind of doc to falsify and the hardest to notice, so both numbers are read
 * off the source here.
 */
const routesSrc = read('src/routes.tsx')
const navPaths = [...nav.matchAll(/^ *path: '([^']+)',/gm)].map((m) => m[1])
const routedPaths = [...routesSrc.matchAll(/path: '([^']+)'/g)].map((m) => m[1])
const navServed = navPaths.filter(
  (p) => routedPaths.includes(p) || routedPaths.includes(p.replace(/^\//, '')),
)
expect(
  'CLAUDE.md states how many sidebar entries exist',
  new RegExp(`\`NAV_ITEMS\` has \\*\\*${navPaths.length}\\*\\* live entries`).test(claude),
  `${navPaths.length} live nav entries`,
)
expect(
  'and how many of them have a page',
  new RegExp(`a page for \\*\\*${navServed.length}\\*\\* of them`).test(claude),
  `${navServed.length} served: ${navServed.join(', ')}`,
)

/*
 * The full-window canvas route. Its declaration order is load-bearing:
 * `graph-studio/:useCaseId` matches the parent segment of `graph-studio/x/canvas`, so
 * declared after the `App` tree the studio page would render at the full view's URL —
 * a wrong page with no error anywhere.
 */
const canvasRoute = "{ path: '/graph-studio/:useCaseId/canvas'"
expect(
  'the full-window canvas route exists and is declared before the App tree',
  routesSrc.includes(canvasRoute) &&
    routesSrc.indexOf(canvasRoute) < routesSrc.indexOf("element: <App />"),
  'a prefix pattern declared first would match it and win',
)
expect(
  'and it is URL-only, reached by the Full view button rather than the sidebar',
  !navPaths.some((p) => p.includes('/canvas')) &&
    /fullViewHref=\{`\/graph-studio\//.test(read('src/pages/GraphStudioPage.tsx')),
  'the same rule as /db: routed, not advertised',
)
/*
 * One canvas component, two frames. A full view that rendered its own drawing would be
 * a second truth about the same graph, which is the failure the whole studio is built
 * to avoid — and the button must not appear on the page it points at.
 */
expect(
  'the full view reuses the canvas and the inspector rather than copying them',
  ['GraphCanvas', 'NodeInspector'].every((c) =>
    read('src/pages/GraphCanvasFullPage.tsx').includes(`from '../components/${c}'`),
  ) && read('src/pages/GraphStudioPage.tsx').includes("from '../components/NodeInspector'"),
  'both views import one component each, so neither can drift',
)
/*
 * Keyed to the prop being *passed* (`fullViewHref=`), not to the word appearing. The
 * first version searched for the bare name and failed on the comment that explains why
 * the prop is absent — the same trap as the `dimension` claim and the retired-type
 * claim: assert the fact, never the spelling.
 */
expect(
  'and the full view offers no Full view button of its own',
  !/fullViewHref=/.test(read('src/pages/GraphCanvasFullPage.tsx')),
  'a link to the page you are on is a dead control',
)

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

/*
 * **The graph picker offers the graphs that are actually published.**
 *
 * The vendored dataset ships four graphs, every one described as "Published", and none of them
 * exists. Left as the picker's source it asserted four live graphs on a tenant that may have
 * none — and the seeded library rows said "Reads from the VLS Compliance graph" alongside. So
 * the host passes `publishedGraphs()` down and both pickers and the library seed take it.
 *
 * Asserted at three sites because the fallback is what makes it silent: with no list passed,
 * everything still renders, just naming graphs nobody published.
 */
const reportsHost = read('src/pages/ReportsPage.tsx')
const askPane = read('src/reports/panes/AskPane.tsx')
const confirmPane = read('src/reports/panes/ConfirmPane.tsx')
const graphMapper = /const graphOptions = useMemo\([\s\S]*?\n  \)/.exec(reportsHost)?.[0] ?? ''
expect(
  'the report graph picker lists only published graphs, from the server',
  graphMapper.length > 0 &&
    /data\?\.graphs \?\? \[\]/.test(graphMapper) &&
    /* No invented freshness: the payload reports size and publisher, not a refresh time. */
    !/refreshed/.test(graphMapper) &&
    /* Both pickers read the passed list rather than the dataset's. */
    /items=\{graphOptions\.map/.test(askPane) &&
    !/items=\{OPTS\.graph\.options/.test(askPane) &&
    /key === 'graph' \? graphOptions : OPTS\[key\]\.options/.test(confirmPane) &&
    /* And the seeded library rows read from it too, or every card names a fictional graph. */
    /seedLibrary\(first \?/.test(read('src/reports/App.tsx')) &&
    /export function seedLibrary\(graph\?: Assumption\)/.test(read('src/reports/lib/library.ts')),
  graphMapper.length === 0
    ? 'the graph mapper was not found — this check cannot run'
    : 'picker, confirm slot and library seed all take the published list',
)

/*
 * **Every chart form the toolbar offers actually draws.**
 *
 * `line` was on the package prototype's toolbar and existed nowhere here: `ChartType` was
 * `'bar' | 'column'`, `ChartBlock` had no branch for it, and the button was absent. A form a
 * reader can pick and cannot see is the "control with nothing behind it" rule, one layer down —
 * and it fails silently, because the block falls through to bars and looks like it ignored the
 * click.
 */
const chartBlockSrc = read('src/reports/components/blocks/ChartBlock.tsx')
const reportPaneSrc = read('src/reports/panes/ReportPane.tsx')
const chartForms = [
  ...(/\['bar', 'column', 'line'\] as const/.exec(reportPaneSrc) ? ['bar', 'column', 'line'] : []),
]
expect(
  'every chart form the toolbar offers has a renderer',
  chartForms.length === 3 &&
    /export type ChartType = 'bar' \| 'column' \| 'line'/.test(read('src/reports/types.ts')) &&
    /* A branch each: line by name, column by name, bars as the fallback. */
    /block\.chartType === 'line'/.test(chartBlockSrc) &&
    /block\.chartType === 'column'/.test(chartBlockSrc) &&
    /* And the line branch really draws — a polyline, not a placeholder. */
    /<polyline/.test(chartBlockSrc) &&
    /* Named for what it changes, not for the maths it used to imply. */
    reportPaneSrc.includes('⇄ Change data'),
  chartForms.length !== 3
    ? 'the toolbar form list was not found — this check cannot run'
    : 'bar, column and line each have a branch that draws',
)

/*
 * **The publish dialog no longer picks an audience, but a report still has one.**
 *
 * The `<select>` over the three audiences was removed on request. The value did not go with it:
 * a republished report keeps the audience it had, a new one takes the default, and the dialog
 * hands that back untouched. That forwarding is the part worth guarding — drop it and
 * `onConfirm` publishes with `undefined`, `audienceLabel` falls through to the raw key, and
 * every Library card reads "Audience:" followed by nothing while the audience tab miscounts.
 * Nothing throws.
 */
/* Comments stripped: the prop's own doc comment explains that a `<select>` *used to* be here,
   and searching the raw file matched that explanation. Fourth time in this file — if the string
   could legitimately appear in prose, strip the prose. */
const publishDialog = read('src/reports/components/PublishDialog.tsx')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
expect(
  'the publish dialog carries the audience it was given, and offers no picker',
  /onConfirm\(trimmed, initialAudience\)/.test(publishDialog) &&
    !/<select/.test(publishDialog) &&
    /* The pool is still read, by the label lookup the Library cards use. */
    /AUDIENCES\.find\(\(a\) => a\.key === key\)/.test(read('src/reports/lib/library.ts')),
  'removed as a control, kept as a value',
)

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
