/**
 * Which tenant dataset a request is reading — EPA, CAPEX, or both at once.
 *
 * `store.mjs` owns how bytes get in and out of one document; `server.mjs` owns what a document
 * *means*. This file owns only **which** document a request is talking about, so neither of those
 * had to learn about a second dataset.
 *
 * **One process holds every dataset, and a request picks one.** The prefix used to be read once at
 * boot (`docRef` reads `S3_PREFIX` at module load), so a second dataset meant a second server and
 * "both" was not expressible at all. Every dataset is loaded at boot instead and the selection
 * arrives per request — `?dataset=` or the `x-dataset` header — which is what makes switching
 * instant and `both` something that can be computed rather than stitched together in the browser.
 *
 * **The 282 `db.<key>` reads in `server.mjs` were left alone.** Threading a request through
 * `reportView`, `studioItems`, `whatifView` and every other helper would have touched most of the
 * file to say one thing; `db` is a Proxy over "the document this request selected" instead, so the
 * reads mean what they always meant. The selection travels in an `AsyncLocalStorage` scope entered
 * by the dispatcher, which is the one place a request begins.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * The datasets, in order, and EPA is first because that ordering is load-bearing: it is the
 * primary, so it is what `both` resolves a single-valued key to and what a caller naming no
 * dataset gets.
 *
 * **There is one today, and the machinery is still here on purpose.** `CAPEX` was seeded and then
 * removed on request; what went with it is the *document*, not the ability to hold a second one.
 * Every dataset in this list is read at boot and a request picks one, so a name here with no
 * document behind it stops the boot — which is why removing the file means removing the name, and
 * why adding a dataset back is this array plus `npm run seed:dataset -- <NAME>`.
 *
 * `both` therefore currently merges one document with nothing, which is EPA. It is left reachable
 * rather than special-cased away: the merge is a pure function over this list, and a second
 * dataset restores its meaning without any of it having to be written again.
 */
export const DATASETS = ['EPA']
export const PRIMARY = 'EPA'
export const BOTH = 'both'

/**
 * The header a request names its dataset in.
 *
 * **A constant because it is also a CORS decision.** Any header that is not one of the four
 * CORS-safelisted ones makes a cross-origin request *preflighted*, and the browser then blocks it
 * unless the `OPTIONS` reply lists the header in `access-control-allow-headers`. The deployed app
 * calls the mock server directly on another origin, so adding this header without adding it there
 * broke **every** request in the browser with `TypeError: Failed to fetch` — while `curl`, which does
 * not enforce CORS, kept answering 200. Declared here so `send`, `sseOpen` and `selectorFrom` all
 * read one string.
 */
export const DATASET_HEADER = 'x-dataset'

/** Every value the `dataset` selector accepts, which is what a refusal names. */
export const SELECTORS = [...DATASETS, BOTH]

/* ---------------- how two documents combine ---------------- */

/**
 * What `both` does with each top-level key, stated per key rather than inferred from its type.
 *
 * **Inferring would be wrong in both directions.** `auth_roles` and `column_vocabulary` are both
 * arrays and neither should be unioned — the first is the identity pool (two datasets do not mean
 * eight roles) and the second is a synthesis vocabulary rather than tenant data. `audit`, `traces`
 * and `evals` are objects holding arrays *and* the totals computed over them, so unioning the
 * arrays would leave `policy_total` describing one dataset while `policies` held two.
 *
 * - `primary` — EPA's value, whole. The decision on record: single-valued keys come from EPA.
 * - `{ union: 'field' }` — concatenate, dropping a later row whose `field` a kept row already has.
 *   An identity collision across datasets is the one thing a union can silently get wrong.
 * - `{ union: null }` — concatenate with no dedup, for a list with no id.
 * - `{ deep: { ... } }` — recurse one level with a plan of its own.
 * - `keyed` — an object used as a map (`column_profiles`, `document_extractions`): merge the key
 *   sets, primary winning a shared key.
 *
 * **A key with no entry here is a refusal, not a guess.** A new top-level key would otherwise
 * default to something, and the wrong default is invisible: EPA's value silently standing for both
 * datasets reads exactly like a correct answer. Same rule as the document dictionary's `doc_type`
 * facet map.
 */
export const MERGE_PLAN = {
  /* Identity and the account — one tenant, one set of people, whichever dataset is in view. */
  google_account: 'primary',
  auth_roles: 'primary',

  /* Sources: a dataset genuinely brings its own projects and drives. */
  credentials: { union: 'project_id' },
  projects: { union: 'project_id' },
  drive_credentials: { union: 'drive_id' },
  drives: { union: 'drive_id' },

  /* Canned telemetry payloads carrying their own precomputed totals — see the note above. */
  audit: 'primary',
  traces: 'primary',
  evals: 'primary',

  change_signals: { union: 'signal_id' },

  /* Vocabularies the synthesisers slice; not tenant data, and a union would only widen a hash. */
  column_vocabulary: 'primary',
  document_vocabulary: 'primary',

  /* The wizard's pools, and the graphs built from them. */
  graph_domains: { union: 'domain_id' },
  graph_use_cases: { union: 'use_case_id' },
  graph_personas: { union: 'persona_id' },
  graph_kpis: { union: 'kpi_id' },
  graph_hero_questions: { union: 'question_id' },
  graph_answer_formats: { union: 'format_id' },
  graph_use_case_templates: { union: 'template_id' },

  /*
   * The studio's graph. The canvas unions because two datasets are two sets of elements and
   * `validateDb` still holds — each document's edges resolve inside its own node roster, so the
   * union's do too. `generated` is one build's own counts and cannot be added up honestly.
   */
  graph_studio: {
    deep: {
      review_items: { union: 'item_id' },
      sanity_checks: { union: 'check_id' },
      canvas: { deep: { nodes: { union: 'id' }, edges: { union: null } } },
      pivot: 'primary',
      generated: 'primary',
    },
  },

  /* Profiles and extractions are maps keyed by `dataset.table` and by document id. */
  column_profiles: 'keyed',
  document_extractions: 'keyed',

  ask_answers: { union: 'answer_id' },

  /* One facility, one appetite line, one set of candidate loads — a merged frame is not a frame. */
  whatif: 'primary',

  /*
   * The two documents that used to be files of their own, and both are the **tenant's** rather than
   * a dataset's — which is exactly why they are `primary` here and were never copied per prefix.
   *
   * `settings` holds the users and each persona's navigation: two datasets do not mean eight users,
   * for the same reason `auth_roles` and `google_account` are `primary`. `reports_prototype` is the
   * authoring prototype's own sample data, not a dataset's rosters — those are `reports.data` above
   * — and a copy per dataset would have meant inventing sample figures nobody wrote.
   */
  settings: 'primary',
  reports_prototype: 'primary',

  /*
   * Reports: the definitions and the rosters they are asked over are per dataset; the field
   * dictionary, the assumptions and the summary Catalog are the section's own vocabulary.
   */
  reports: {
    deep: {
      meta: 'primary',
      fields: 'primary',
      assumptions: 'primary',
      opts: 'primary',
      slice_default: 'primary',
      summary_catalog: 'primary',
      summary_default: 'primary',
      data: {
        deep: {
          generators: { union: 'generator' },
          facilities: { union: 'facility' },
          quarters: { union: 'quarter' },
          traces: { union: 'manifest' },
        },
      },
      reports: { union: 'report_id' },
      saved: { union: 'saved_id' },
      governance: {
        deep: {
          statuses: 'primary',
          reports: { union: 'report_id' },
          data_scope: 'primary',
          gate_notes: 'primary',
          publishing: 'primary',
          /*
           * The Audit & Governance page's copy and its category chips — *not* an audit trail, which
           * is what the name suggests and what this was first written as. A union would have left it
           * `[]` in a seeded dataset, and the boot guard's answer was "reports is the wrong shape"
           * with 40 lines of hint: the sentence that stops the page implying a filter runs lives in
           * here (`copy.not_enforced`), so an emptied version is a page authoring restrictions with
           * nothing said about enforcement.
           */
          audit: 'primary',
        },
      },
    },
  },
}

/** A key in a document that `MERGE_PLAN` says nothing about — the boot guard reports these. */
export function unplannedKeys(doc, plan = MERGE_PLAN) {
  return Object.keys(doc ?? {}).filter((k) => !(k in plan))
}

function unionRows(primary, secondary, field) {
  const rows = Array.isArray(primary) ? [...primary] : []
  if (!Array.isArray(secondary)) return rows
  if (!field) return [...rows, ...secondary]
  const seen = new Set(rows.map((r) => r?.[field]))
  for (const row of secondary) {
    if (row && seen.has(row[field])) continue
    if (row) seen.add(row[field])
    rows.push(row)
  }
  return rows
}

function mergeValue(rule, primary, secondary) {
  if (rule === 'primary') return primary
  if (rule === 'keyed') return { ...(secondary ?? {}), ...(primary ?? {}) }
  if (rule && typeof rule === 'object' && 'union' in rule) {
    return unionRows(primary, secondary, rule.union)
  }
  if (rule && typeof rule === 'object' && rule.deep) {
    const out = { ...(primary ?? {}) }
    for (const [key, sub] of Object.entries(rule.deep)) {
      if (!(key in out) && !(key in (secondary ?? {}))) continue
      out[key] = mergeValue(sub, primary?.[key], secondary?.[key])
    }
    return out
  }
  /* Unreachable while `unplannedKeys` runs at boot; explicit so it cannot become a silent guess. */
  throw new Error('no merge rule for this value — MERGE_PLAN is incomplete')
}

/**
 * One document standing for every dataset, primary first.
 *
 * Reduced rather than special-cased for two, so a third dataset is a `DATASETS` entry and nothing
 * else. Folding left keeps "primary wins" meaning EPA rather than whichever was folded last.
 */
export function mergeDocs(docs) {
  const [first, ...rest] = docs
  if (rest.length === 0) return first
  return rest.reduce((acc, next) => {
    const out = {}
    for (const key of Object.keys(MERGE_PLAN)) {
      if (!(key in acc) && !(key in next)) continue
      out[key] = mergeValue(MERGE_PLAN[key], acc[key], next[key])
    }
    return out
  }, first)
}

/* ---------------- which dataset this request is reading ---------------- */

const scope = new AsyncLocalStorage()

/** The selector for the request in flight, or the primary outside one (boot, a seed, a test). */
export const activeDataset = () => scope.getStore()?.dataset ?? PRIMARY

/** Run `fn` with `dataset` selected. The dispatcher is the only caller. */
export const withDataset = (dataset, fn) => scope.run({ dataset }, fn)

/**
 * The selector a request asked for, or `null` if it named something that is not one.
 *
 * `?dataset=` first, then `x-dataset`, then the primary — the query parameter wins because it is
 * the one a person can type into a URL while looking at a page. Case is not significant (`epa` and
 * `EPA` are one dataset) but an unknown value is a refusal rather than a quiet fall back to EPA:
 * showing one dataset's figures under another's name is the failure this whole split exists to
 * prevent.
 */
export function selectorFrom(query, headers) {
  const raw = query?.get?.('dataset') ?? headers?.[DATASET_HEADER] ?? ''
  const asked = String(raw).trim()
  if (!asked) return PRIMARY
  const match = SELECTORS.find((s) => s.toLowerCase() === asked.toLowerCase())
  return match ?? null
}

/* ---------------- the proxies that let the existing code stay as it is ---------------- */

/**
 * An object that reads as whichever document the current request selected.
 *
 * `resolve()` returns the real document, so every trap forwards to a plain object and `db.projects`
 * costs one extra function call. The mutating traps exist because `commitDb` swaps the document in
 * place — `{...db}`, `delete db[k]`, `Object.assign(db, next)` — which is what makes a `/db` edit
 * take effect without a restart.
 */
export function documentProxy(resolve) {
  return new Proxy(
    {},
    {
      get: (_t, key) => resolve()[key],
      set: (_t, key, value) => {
        resolve()[key] = value
        return true
      },
      deleteProperty: (_t, key) => {
        delete resolve()[key]
        return true
      },
      has: (_t, key) => key in resolve(),
      ownKeys: () => Reflect.ownKeys(resolve()),
      getOwnPropertyDescriptor: (_t, key) =>
        Reflect.getOwnPropertyDescriptor(resolve(), key) ?? {
          value: resolve()[key],
          configurable: true,
          enumerable: true,
          writable: true,
        },
    },
  )
}

/**
 * A `Map` or an array that is really the current dataset's own.
 *
 * The in-memory state — registered sources, profiling jobs, studio decisions, publications — is
 * keyed by source id and use-case id, never by dataset, so one shared `Map` would show an EPA
 * registration under CAPEX. Rather than prefixing several hundred keys, each container resolves to
 * a per-dataset instance and the call sites are untouched. A method comes back bound to the
 * resolved target, so `registered.set(...)` and `profilingJobs.push(...)` land on the right one.
 */
export function containerProxy(resolve) {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        const target = resolve()
        const value = target[key]
        return typeof value === 'function' ? value.bind(target) : value
      },
      set: (_t, key, value) => {
        resolve()[key] = value
        return true
      },
      has: (_t, key) => key in resolve(),
      ownKeys: () => Reflect.ownKeys(resolve()),
      getOwnPropertyDescriptor: (_t, key) => Reflect.getOwnPropertyDescriptor(resolve(), key),
    },
  )
}
