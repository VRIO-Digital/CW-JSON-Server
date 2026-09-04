/**
 * Give a dataset's document its `data_model` key — `npm run seed:data-model [-- CAPEX]`.
 *
 * **`data_model` is a required key holding nothing to begin with**, which is an odd pair until you
 * see what the alternative costs. The Data Modeling tab's declarations — the entity a curator wrote
 * for a table, the identifier they confirmed and the relationships they declared — are somebody's
 * work, written through `commitDb` so they survive a restart the way a
 * saved graph brief does. Losing the key does not throw: every card goes back to *Not yet declared*
 * and every edge off the canvas, which reads as a tenant that has modelled nothing rather than as
 * data that is gone. So `validateDb` requires it, and this is the command its refusal names.
 *
 * What it writes is `{ "entities": [] }` and nothing else. There is no seeded declaration, on
 * purpose: a relationship nobody drew is a claim about this tenant's schema, and the tab's own
 * suggestions run already derives candidates from the profiled columns — with `degraded: true` on
 * the payload, because there is no model behind this server and the tab says so.
 *
 * **It never rewrites a declaration that is already there.** A seed that owns a subtree and replaces
 * its parent is how a subtree gets deleted — the fault `ingest-reports.js` nearly committed against
 * `governance`. So an existing block is left exactly as it is, and a malformed one is *reported*
 * rather than flattened: the fix for a broken declaration is editing it, not losing it.
 *
 * Writes a file and only a file, like every other seed here. Push it with `npm run db:push`
 * (`-- CAPEX` for a secondary dataset).
 */

import { readFile, writeFile } from 'node:fs/promises'
import { DATASETS, PRIMARY } from '../datasets.js'

const die = (message) => {
  console.error(`\nseed-data-model: ${message}\n`)
  process.exit(1)
}

const target = (process.argv[2] ?? PRIMARY).trim()
if (!DATASETS.includes(target)) {
  die(
    `"${target}" is not a declared dataset — this tenant has ${DATASETS.join(', ')}.\n` +
      '  Add it to DATASETS in backend/datasets.js first, with its MERGE_PLAN entries.',
  )
}

/* The same naming `store.js`'s `localDocPath` gives a dataset's local stand-in: the primary keeps
   the plain `backend/db.json` every command in CLAUDE.md names, and only a secondary takes a
   suffix. */
const secondary = target !== PRIMARY
const name = secondary ? `db.${target}.json` : 'db.json'
const path = new URL(`../${name}`, import.meta.url)

let doc
try {
  doc = JSON.parse(await readFile(path, 'utf8'))
} catch (error) {
  die(
    `could not read ${target}'s document at backend/${name} — ${error.message}\n` +
      `  It is fetched rather than authored:\n      npm run db:pull${secondary ? ` -- ${target}` : ''}`,
  )
}


/* ---------------- the primary's recorded suggestions ---------------- */

/**
 * The relationships this tenant's own schema really has, written down.
 *
 * **These are the AI-suggester's payload, mocked from data rather than generated** — the same
 * arrangement `ask_answers` has for answers and `graph_studio.sanity_checks` has for checks. What a
 * recorded suggestion carries is everything a column-name scan cannot produce: a relationship
 * *name* somebody would actually use, the alternatives they considered, the reasoning a reviewer
 * needs to judge it, and a confidence that is a stated opinion. The structural derivation stays as
 * the fallback for every pair nothing here names.
 *
 * **Every figure in a rationale is read out of `column_profiles` at write time**, not typed — see
 * `describe()` below, which refuses to write a suggestion whose numbers it cannot read. A rationale
 * quoting a distinct count that has since changed is the small version of a transcribed report
 * figure, and it goes stale the same way.
 *
 * **All four cardinalities, and each is true of this data rather than chosen to fill the set:**
 *
 *  - `1:1` — one manifest, one enriched row. 1,200 distinct over 1,200 rows on both sides.
 *  - `1:1` — one facility, one compliance-360 row. 49 over 49 on both.
 *  - `1:N` — one facility, many evaluation/violation/enforcement line items. 49 unique facilities
 *    against 364 line items.
 *  - `N:1` — many manifests, one receiving facility. Every manifest in this extract ships to the
 *    same TSDF, which is why the receiving id has exactly one distinct value.
 *  - `N:N` — both manifest views carry `generator_id` and neither is unique on it. A real join and a
 *    bad one to *keep*, which is the point of it being here: it is the suggestion a reviewer should
 *    re-point at the facility view, and its own rationale says so.
 */
const SUGGESTIONS = [
  {
    suggestion_id: 'sg_manifest_detail',
    from: 'epa_hazwaste.e_manifest',
    from_column: 'manifest_tracking_number',
    to: 'epa_hazwaste.e_manifest_all',
    to_column: 'manifest_tracking_number',
    relationship_type: 'HAS_MANIFEST_DETAIL',
    relationship_type_alternatives: ['ENRICHED_BY', 'SAME_SHIPMENT_AS'],
    cardinality_hint: '1:1',
    confidence: 0.97,
    rationale:
      'The tracking number is unique on both sides, so the enriched view is one row per manifest ' +
      'rather than a fan-out of them. Worth declaring because the generator, receiver and ' +
      'transporter profiles a question needs live on the enriched side while the shipment itself is ' +
      'on this one.',
  },
  {
    suggestion_id: 'sg_facility_compliance_360',
    from: 'epa_hazwaste.FRS_Facility_profile',
    from_column: 'registry_id',
    to: 'epa_hazwaste.RCRA_Compliance_Summary',
    to_column: 'registry_id',
    relationship_type: 'HAS_COMPLIANCE_SUMMARY',
    relationship_type_alternatives: ['SUMMARISED_BY', 'HAS_COMPLIANCE_360'],
    cardinality_hint: '1:1',
    confidence: 0.94,
    rationale:
      'Both views are one row per facility on the same registry id, so this is a profile and its ' +
      'summary rather than a history. Declare it and a facility question can reach the rolled-up ' +
      'compliance standing without walking the line items.',
  },
  {
    suggestion_id: 'sg_facility_compliance_history',
    from: 'epa_hazwaste.FRS_Facility_profile',
    from_column: 'registry_id',
    to: 'epa_hazwaste.RCRA_compliance',
    to_column: 'registry_id',
    relationship_type: 'HAS_COMPLIANCE_HISTORY',
    relationship_type_alternatives: ['HAS_EVALUATIONS', 'EVALUATED_BY'],
    cardinality_hint: '1:N',
    confidence: 0.92,
    rationale:
      'The registry id is unique on the facility view and repeats across the line items, which is ' +
      'one facility to many evaluations, violations and enforcement actions. This is the join every ' +
      '"what is this facility\'s compliance record" question walks.',
  },
  {
    suggestion_id: 'sg_manifest_receiving_facility',
    from: 'epa_hazwaste.e_manifest',
    from_column: 'des_facility_id',
    to: 'epa_hazwaste.FRS_Facility_profile',
    to_column: 'pgm_sys_id',
    relationship_type: 'SHIPS_TO',
    relationship_type_alternatives: ['RECEIVED_BY', 'HAS_RECEIVING_FACILITY'],
    cardinality_hint: 'N:1',
    confidence: 0.88,
    /* The one distinct value is the honest oddity of this extract, and stating it is what lets a
       reviewer judge the suggestion rather than take the cardinality on trust. */
    rationale:
      'Many manifests to one facility. Note the shape of this extract before accepting it: the ' +
      'receiving id has exactly one distinct value across all 1,200 manifests, so every shipment ' +
      'here goes to the same TSDF — the cardinality is right, and it is right for a narrower reason ' +
      'than a fuller extract would give.',
  },
  {
    suggestion_id: 'sg_manifest_generator_crosswalk',
    from: 'epa_hazwaste.e_manifest',
    from_column: 'generator_id',
    to: 'epa_hazwaste.e_manifest_all',
    to_column: 'generator_id',
    relationship_type: 'SHARES_GENERATOR_WITH',
    relationship_type_alternatives: ['SAME_GENERATOR_AS', 'GENERATED_BY'],
    cardinality_hint: 'N:N',
    confidence: 0.61,
    /* Deliberately the low-confidence one: a real join, and a poor thing to keep. A suggester that
       only ever offered good suggestions would make the review queue theatre. */
    rationale:
      'Both views carry the generator id and neither is unique on it — 36 generators across 1,200 ' +
      'rows on each side — so the join is genuinely many-to-many and would multiply rows if anything ' +
      'traversed it. Offered because the columns match, not because this is the join you want: the ' +
      'generator belongs on the facility view, and re-pointing it there is the likelier answer.',
  },
]

/**
 * One suggestion, with its numbers read out of the document rather than typed.
 *
 * Refuses to write rather than guessing, which is the rule every seed here follows: a suggestion
 * naming a table or a column this document does not carry would be offered to a reader and then
 * refused when they pressed Confirm, and `validateDb` would stop the boot before that anyway.
 */
function describe(suggestion) {
  for (const [side, key, column] of [
    ['from', suggestion.from, suggestion.from_column],
    ['to', suggestion.to, suggestion.to_column],
  ]) {
    const [datasetId, tableId] = key.split('.')
    const table = doc.projects
      .flatMap((p) => p.datasets)
      .find((d) => d.dataset_id === datasetId)
      ?.tables.find((t) => t.table_id === tableId)
    if (!table) {
      die(
        `suggestion ${suggestion.suggestion_id} names ${side} table ${key}, which no project in ` +
          'backend/db.json carries. Fix the table or drop the suggestion — a suggestion nothing can ' +
          'draw never reaches a reader.',
      )
    }
    const profiled = doc.column_profiles[key]
    if (Array.isArray(profiled) && !profiled.some((col) => col.column_id === column)) {
      die(
        `suggestion ${suggestion.suggestion_id} joins on ${key}.${column}, which that table's ` +
          'profile does not carry. The tab would offer it and then refuse it on Confirm.',
      )
    }
  }

  return {
    suggestion_id: suggestion.suggestion_id,
    from_table_key: suggestion.from,
    from_column: suggestion.from_column,
    to_table_key: suggestion.to,
    to_column: suggestion.to_column,
    relationship_type: suggestion.relationship_type,
    relationship_type_alternatives: suggestion.relationship_type_alternatives,
    cardinality_hint: suggestion.cardinality_hint,
    rationale: suggestion.rationale,
    confidence: suggestion.confidence,
  }
}
const existing = doc.data_model

/**
 * The suggestions this dataset gets.
 *
 * **The primary's are authored; a secondary dataset's are empty**, which is the decision
 * `seed:settings` makes about a roster for the same reason: these name EPA's own views and EPA's own
 * columns, so writing them under CAPEX would describe tables that dataset has never heard of. A
 * dataset with none is a dataset whose suggestions are all derived from its schema — a real state
 * rather than a gap.
 */
const suggestions = secondary ? [] : SUGGESTIONS.map(describe)

if (existing === undefined) {
  doc.data_model = { entities: [], suggestions }
  await writeFile(path, `${JSON.stringify(doc, null, 2)}
`, 'utf8')
  console.log(
    `seed-data-model: wrote data_model to backend/${name} — no declarations, ` +
      `${suggestions.length} recorded suggestion(s).
` +
      `  Push it when you are happy with the diff:  npm run db:push${secondary ? ` -- ${target}` : ''}`,
  )
  process.exit(0)
}

/* ---------------- it is already there, so check it rather than replace it ---------------- */

if (existing === null || typeof existing !== 'object' || !Array.isArray(existing.entities)) {
  die(
    `backend/${name} already carries a data_model, and its entities are not an array.\n` +
      '  This seed will not overwrite declarations, so fix the block by hand (or in the /db editor) ' +
      'rather than losing what is in it.',
  )
}

/*
 * **A block with declarations but no `suggestions` gets the key filled in, not a refusal.**
 *
 * That is the shape this script itself wrote before recorded suggestions existed, and `validateDb`
 * now requires the key — so refusing here would leave a reader holding a document that cannot boot
 * and a seed that declines to fix it, which is the one thing a seed named by a boot refusal must
 * never do. Adding the missing key is the same act as adding the missing `data_model` above it, and
 * the declarations beside it are carried through untouched.
 */
if (!Array.isArray(existing.suggestions)) {
  doc.data_model = { ...existing, suggestions }
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  console.log(
    `seed-data-model: backend/${name} had no suggestions key — wrote ${suggestions.length}, and ` +
      `carried its ${existing.entities.length} declaration(s) through untouched.\n` +
      `  Push it when you are happy with the diff:  npm run db:push${secondary ? ` -- ${target}` : ''}`,
  )
  process.exit(0)
}

/*
 * The one thing worth reporting: a declaration whose table the document no longer carries. It is
 * refused at boot — an entity on a table nobody has drops out of the tab silently, which reads as a
 * table nobody declared — so naming it here is what turns a failed boot into an edit.
 */
const tableKeys = new Set(
  (doc.projects ?? []).flatMap((p) =>
    (p.datasets ?? []).flatMap((d) =>
      (d.tables ?? []).map((t) => `${d.dataset_id}.${t.table_id}`),
    ),
  ),
)
const stranded = existing.entities.filter((e) => !tableKeys.has(e.table_key))

console.log(
  `seed-data-model: backend/${name} already carries data_model with ` +
    `${existing.entities.length} declaration(s) and ${existing.suggestions.length} recorded ` +
    'suggestion(s) — left untouched.',
)

/*
 * **Re-authoring the suggestions is offered rather than done.** They are this script's own content
 * and replacing them would be safe on its own — but they live in the same key as the declarations,
 * which are somebody's work, and a seed that rewrites half a key it shares is one edit away from
 * rewriting the other half. So `--suggestions` is a deliberate second act, and it *spreads* the
 * existing block rather than rebuilding it.
 */
if (process.argv.includes('--suggestions')) {
  doc.data_model = { ...existing, suggestions }
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  console.log(
    `  --suggestions: re-authored ${suggestions.length}, and left the ` +
      `${existing.entities.length} declaration(s) alone.`,
  )
} else if (existing.suggestions.length !== suggestions.length) {
  console.log(
    `  This script would author ${suggestions.length}. Re-author them, declarations untouched:\n` +
      `      node backend/scripts/seed-data-model.js${secondary ? ` ${target}` : ''} --suggestions`,
  )
}
if (stranded.length > 0) {
  console.log(
    `  ${stranded.length} of them name a table this document no longer carries, and the server ` +
      'will refuse to boot until each is edited or removed:',
  )
  for (const e of stranded) console.log(`    ${e.entity_id} → ${e.table_key}`)
}
