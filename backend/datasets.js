/**
 * Which tenant dataset a request is reading — EPA, CAPEX, or both at once.
 *
 * `store.js` owns how bytes get in and out of one document; `server.js` owns what a document
 * *means*. This file owns only **which** document a request is talking about, so neither of those
 * had to learn about a second dataset.
 *
 * **One process holds every dataset, and a request picks one.** The prefix used to be read once at
 * boot (`docRef` reads `S3_PREFIX` at module load), so a second dataset meant a second server and
 * "both" was not expressible at all. Every dataset is loaded at boot instead and the selection
 * arrives per request — `?dataset=` or the `x-dataset` header — which is what makes switching
 * instant and `both` something that can be computed rather than stitched together in the browser.
 *
 * **The 282 `db.<key>` reads in `server.js` were left alone.** Threading a request through
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
 * **There are two, and every one of them is read at boot.** A name here with no document behind it
 * stops the boot, which is why adding a dataset is this array *and then* `npm run seed:dataset --
 * <NAME>`, in that order — the seed refuses a name this array does not declare.
 *
 * `both` therefore merges two real documents, which is what the merge plan below was written for and
 * was under-exercised while there was one.
 */
export const DATASETS = ['EPA', 'CAPEX']
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
  /*
   * **The document's own account of itself, where its generator wrote one.** CAPEX's document carries
   * `_meta` (the package that built it, the tenant, the as-of date, and its own "never hand-edit this,
   * change the generator" note) and `_provenance` (per key, which artifact the values were read out of).
   * EPA's document carries neither.
   *
   * `primary` rather than a union or a merge, and the consequence is deliberate: under `both` these come
   * from EPA, which has none, so the merged view carries no provenance at all. That is the honest answer
   * — a merged document is not any one package's output, so claiming one package's provenance for it
   * would be the most misleading thing this key could do.
   *
   * They are here because a top-level key with no rule **stops the boot**, which is the guard working:
   * dropping a document's provenance silently is exactly the kind of loss that reads as an answer.
   */
  _meta: 'primary',
  _provenance: 'primary',

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
          /* EPA's four rosters. */
          generators: { union: 'generator' },
          facilities: { union: 'facility' },
          quarters: { union: 'quarter' },
          traces: { union: 'manifest' },
          /*
           * **CAPEX's six, and their absence was a live 400 rather than a missing row.**
           *
           * `reports.reports` unions, so CAPEX's report definitions reach the merged document — and they
           * declare `spine: "projects"`. With no rule here that roster dropped out, so
           * `reportFloorLine` read `db.reports.data.projects.length` on `undefined` and **every**
           * `/reports` call under `both` answered *"Cannot read properties of undefined (reading
           * 'length')"*. Which is this plan's own documented hazard, one level below where the boot guard
           * was looking: `unplannedKeys` checked the top level only and never descended into a `deep`
           * plan. It descends now, so a seventh roster stops the boot instead of emptying a page.
           *
           * The three keyed on an id union on it. The last three are lists of **strings** — business unit,
           * region and category names — so there is no field to dedup by and `{ union: null }` is the
           * honest rule. `primary` would have been wrong for all six in the way that is hardest to see:
           * EPA carries none of them, so it resolves to `undefined` and reproduces the crash it was
           * supposed to prevent. A rule naming the primary is only safe where the primary has the key.
           */
          projects: { union: 'n' },
          contracts: { union: 'id' },
          changeOrders: { union: 'id' },
          business_units: { union: null },
          regions: { union: null },
          categories: { union: null },
        },
      },
      reports: { union: 'report_id' },
      saved: { union: 'saved_id' },
      /*
       * CAPEX-only descriptions of its own rosters — the register's roster/identity/fields, and the
       * authoring fixture the generator wrote. `primary` rather than a union: they describe **one**
       * package's data, so merging two would produce a field dictionary belonging to neither. EPA has
       * neither, so `both` carries none — the same deliberate answer `authoring_document` gives, and
       * safe here for the reason it is safe there: nothing reads them, so resolving to `undefined`
       * costs a description rather than a page.
       */
      register: 'primary',
      authoring_fixture: 'primary',
      /*
       * The **rendered** reports a dataset ships as documents rather than as questions.
       *
       * EPA has none: its five reports are computed per request from the rosters above, which is what
       * makes a figure there current rather than stored. CAPEX ships three finished HTML documents and
       * no roster to compute from, so they are listed as documents and their figures stay inside them.
       * A union, because two datasets genuinely bring their own — the same reasoning as `projects`.
       */
      documents: { union: 'document_id' },
      /*
       * The authoring exploration, one per dataset, so `primary` — EPA has none, which is why `both`
       * shows no authoring document rather than CAPEX's. A merged view claiming CAPEX's exploration
       * belonged to the tenant's primary dataset would be attributing a design study to the wrong one.
       */
      authoring_document: 'primary',
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

/**
 * Every key in a document that `MERGE_PLAN` says nothing about, as a dotted path.
 *
 * **It descends, and it did not.** The rule this guard exists for is stated above — a key with no
 * entry is dropped from the merged document, `validateDb` never sees it because it validates the two
 * real documents rather than the view built from them, and the symptom is a page that works under the
 * primary and is broken under `both`. All of that is as true of a nested key as a top-level one, and the
 * check covered only the top level: CAPEX's six `reports.data` rosters had no rule, dropped silently,
 * and turned every `/reports` call under `both` into a 400 — while the boot reported nothing, because
 * `reports` itself was planned.
 *
 * Only a `deep` rule is descended into, which is exactly the set of rules that recurse in
 * `mergeValue`. `primary` takes the whole value, `keyed` merges key sets and a union works on rows —
 * none of them can drop a key the caller did not name, so none of them needs checking below itself.
 */
export function unplannedKeys(doc, plan = MERGE_PLAN, trail = "") {
  const unplanned = []
  for (const key of Object.keys(doc ?? {})) {
    const path = trail ? trail + "." + key : key
    if (!(key in plan)) {
      unplanned.push(path)
      continue
    }
    const rule = plan[key]
    const value = doc[key]
    const nested =
      rule && typeof rule === "object" && rule.deep && value && typeof value === "object" && !Array.isArray(value)
    if (nested) unplanned.push(...unplannedKeys(value, rule.deep, path))
  }
  return unplanned
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
      /* Configurable always — see `descriptorFor`. The document is an object rather than an array,
         so this trap has never had a `length` to trip over; it is the same invariant either way, and
         the two proxies must not answer it differently. */
      getOwnPropertyDescriptor: (_t, key) =>
        descriptorFor(resolve(), key) ?? {
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
export function containerProxy(resolve, kind = 'map') {
  /*
   * **The target's *kind* has to match what it stands for, and only arrays care.**
   *
   * `Array.isArray` and `JSON.stringify` both read the target, not the traps — so an array container
   * behind a `{}` target is not an array to either of them, and `GET /governance` serialised its log
   * as `{"0":...,"1":...}`. The client validator then refuses it (`log should be an array, got
   * object`), which reads as a stale mock server and is not one. A `[]` target costs nothing.
   */
  return new Proxy(
    kind === 'array' ? [] : {},
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
      getOwnPropertyDescriptor: (t, key) => descriptorFor(resolve(), key, t),
    },
  )
}

/**
 * One resolved property's descriptor, answering the proxy invariant in both directions.
 *
 * **A proxy may not report a property as non-configurable unless its own target really has it that
 * way.** Passing a resolved descriptor straight through is therefore a claim the engine checks and
 * rejects:
 *
 *     'getOwnPropertyDescriptor' on proxy: trap reported non-configurability for property 'length'
 *     which is either non-existent or configurable in the proxy target
 *
 * **An array is what makes this reachable.** `Array.prototype` gives every array a `length` that is
 * `configurable: false`, and two live containers are arrays (`profilingJobs`, `governanceLog`).
 *
 * The tell is *which* operations fail. `.length`, `.push` and `.filter` are fine — those are the
 * `get` trap. It is `JSON.stringify`, `Object.keys` and `{ ...spread }` that break, because only
 * those walk descriptors. So a container works perfectly until a route tries to **serialise** it,
 * and then that one endpoint 500s while every other use is healthy — which, on a page whose only
 * fetch that is, reads as the whole server being down.
 *
 * **And the invariant runs the other way too**, which is why this consults the proxy's own target
 * rather than forcing `configurable: true` everywhere: a property the target holds as
 * non-configurable — `length`, on the `[]` an array container now uses — may not be *reported* as
 * configurable either. Match the target where it has an opinion; claim configurable elsewhere.
 */
function descriptorFor(resolved, key, proxyTarget = {}) {
  const descriptor = Reflect.getOwnPropertyDescriptor(resolved, key)
  if (!descriptor) return undefined
  const own = Reflect.getOwnPropertyDescriptor(proxyTarget, key)
  if (own && !own.configurable) return descriptor
  return { ...descriptor, configurable: true }
}
