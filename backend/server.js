#!/usr/bin/env node
/**
 * Dummy JSON API for the Connect-a-source flow.
 *
 * Zero dependencies on purpose: the project's audit gate fails on any advisory,
 * and a mock backend is not worth widening the dependency surface for.
 *
 *   node backend/server.js [port]     # defaults to 4000
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
 *   POST   /auth/login                     { email, password } — role comes from db.settings
 *   GET    /settings                       users + personas + each one's navigation access
 *   PATCH  /settings/personas/:roleId/nav  { nav: { key: bool } }
 *   POST   /settings/personas/:roleId/reset
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
 *   POST   /sources/:id/reconnect          re-issues the handle; keeps everything profiled
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
 *   POST   /graph-coverage                 step 6 review { name, sources, hero_questions }
 *   POST   /graph-derivations              step 5 -> 6 run; 202 + poll
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
 *   GET    /ask                            the graphs that are live, so askable
 *   POST   /ask                            { use_case_id, question, citations, formats }
 *   GET    /graph-use-cases                saved drafts + committed use cases
 *   POST   /graph-use-cases                upsert a draft { use_case_id?, name, ... }
 *   DELETE /graph-use-cases/:useCaseId
 *   GET    /audit                          { stats, events, policies }
 *   GET    /traces                         { stats, items, waterfall }
 *   GET    /evals                          { stats, runs, checks }
 */
import { createServer } from 'node:http'
import { docRef, presignGet, readDoc, storeKind, writeDoc } from './store.js'
import {
  activeDataset,
  BOTH,
  containerProxy,
  DATASET_HEADER,
  DATASETS,
  documentProxy,
  mergeDocs,
  PRIMARY,
  SELECTORS,
  selectorFrom,
  unplannedKeys,
  withDataset,
} from './datasets.js'
import { exportKey, FORMATS } from './reportExport.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/*
 * `backend/.env.local` holds the AWS credentials the S3 store signs with. It is loaded here
 * rather than required in the shell so that `npm run mock` needs no setup — and it is a *file*
 * rather than three constants in `store.js` because `.gitignore` covers `*.local`: a bucket name
 * is an address and can be committed, an access key is scraped off GitHub by bots within minutes.
 *
 * Absent is fine and silent. A machine running `S3_BUCKET=off` has nothing to sign, and the store
 * says exactly what is missing if it turns out something did need signing.
 */
try {
  process.loadEnvFile(join(here, '.env.local'))
} catch {
  /* no .env.local — the environment is expected to carry whatever is needed. */
}

/**
 * Read one of the two JSON databases, and **fail with something a person can act on**.
 *
 * `JSON.parse` on a broken file says `Expected double-quoted property name in JSON at position
 * 2464`, and nothing else — not the file, not the line, not the fix. That is the failure this
 * whole repo guards against everywhere *after* boot: `validateDb` refuses a bad document naming
 * the missing key and the command that restores it, but it never runs, because the parse dies
 * first.
 *
 * **The common cause is a merge conflict, and it is checked for by name.** `db.json` is a
 * generated file that is also committed, so a `git pull` or `git stash pop` on a box where it has
 * been re-seeded leaves conflict markers in it — and a crash-looping server then reports a byte
 * offset while the actual problem is `<<<<<<< Updated upstream` sitting in the middle of the file.
 * Naming the marker and its line turns a puzzle into a one-line fix.
 */
/**
 * Each document's version as this process last saw it - an S3 ETag, or `null` for a file.
 * `writeJsonAtomic` sends it back as `If-Match`, which is what turns a second writer into a
 * refused write instead of a silently lost update.
 */
const docEtags = new Map()

async function readJsonDb(ref, label, restore) {
  let text
  try {
    /* Awaited, not synchronous: an object is a network read and there is no sync form of one.
       The guarantee that mattered is kept by where this is awaited rather than by how it reads -
       boot awaits both documents before `listen`, so nothing is served before its data is in. */
    const doc = await readDoc(ref)
    text = doc.text
    docEtags.set(ref, doc.etag)
  } catch (error) {
    console.error(`\nmock-server: refusing to start — cannot read ${label}.`)
    console.error(`  · ${error.message}`)
    /* The remedy depends on where the document was being read from: re-seeding a local file fixes
       nothing when the server is reading a bucket, and sending somebody to `git checkout` over a
       credentials error is a wrong instruction rather than merely an unhelpful one. */
    console.error(
      storeKind(ref) === 's3'
        ? `\n  This server reads S3 (${ref}). Check AWS_REGION and the instance role, then:\n` +
            `      npm run db:push   (uploads the local ${label})\n`
        : `\n  Restore it:\n      ${restore}\n`,
    )
    process.exit(1)
  }

  /* Checked before parsing, because a conflicted file is not "bad JSON" — it is two good files
     stacked, and saying so is the difference between a fix and a hunt. */
  const lines = text.split(/\r?\n/)
  const marker = lines.findIndex((l) => /^(<<<<<<<|=======|>>>>>>>)/.test(l))
  if (marker !== -1) {
    console.error(`\nmock-server: refusing to start — ${label} still has merge conflict markers.`)
    console.error(`  · line ${marker + 1}: ${lines[marker].slice(0, 60)}`)
    console.error(
      '\n  This file is generated *and* committed, so a pull or a stash pop over a re-seeded\n' +
        '  copy conflicts every time. Take one side and rebuild it rather than hand-merging:\n' +
        `      git checkout --theirs ${label}   (or --ours)\n` +
        `      ${restore}\n`,
    )
    process.exit(1)
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    /* Turn the byte offset into a line and column — the only two numbers an editor can use. */
    const at = Number(/position (\d+)/.exec(error.message)?.[1] ?? -1)
    const upto = at >= 0 ? text.slice(0, at).split(/\r?\n/) : null
    console.error(`\nmock-server: refusing to start — ${label} is not valid JSON.`)
    console.error(
      upto
        ? `  · line ${upto.length}, column ${upto[upto.length - 1].length + 1}: ${error.message}`
        : `  · ${error.message}`,
    )
    console.error(`\n  Restore it:\n      ${restore}\n`)
    process.exit(1)
  }
}

/**
 * One `db.json` per dataset, and it is the only document there is.
 *
 * The documents live under a prefix per dataset (`s3://contextweave.com/EPA/db.json`), so the refs
 * are built per dataset rather than once.
 *
 * **There used to be three documents; the other two are keys now.** `settings.json` and
 * `reports_prototype.json` were separate files on the reasoning that two stores with one job each
 * cannot damage one another — a settings write could not touch a report, and an ingest rebuilding
 * `db.reports` could not drop a permission. They were folded into `db.json` as `settings` and
 * `reports_prototype` on request, so that guarantee is now carried differently: both are keys in
 * `DB_SHAPE`, so `commitDb` validates them **before every write** rather than only the writer that
 * owns them, and `validateDb` refuses a document missing either. That is a stronger check than the
 * old one applied at a narrower moment, and it has to stay — `ingest-reports.js` rebuilding
 * `db.reports` wholesale is precisely how `governance` was nearly deleted once, and there are two
 * more subtrees in that file's blast radius now.
 *
 * Both are still the **tenant's** rather than a dataset's, which is why `MERGE_PLAN` marks them
 * `primary` and why no secondary dataset carries a copy: two datasets do not mean eight users.
 */
const DB_PATHS = Object.fromEntries(
  DATASETS.map((name) => [name, docRef('db.json', join(here, 'db.json'), name)]),
)
const DB_PATH = DB_PATHS[PRIMARY]

/*
 * ---------------- every dataset at once, then nothing until they are all in ----------------
 *
 * **Fetched together because they are independent, and awaited together because the server must not
 * listen without all of them.** Read one after the other this cost a full round trip each before the
 * port was open — which on a link to a bucket a continent away is most of a five-second boot, and
 * every request in that window is a connection refused rather than a slow page. No document is
 * needed to locate another, so none of them ever had a reason to wait.
 *
 * `Promise.all` keeps the guarantee exactly as it was: this is still one `await` above
 * `server.listen`, and nothing is served before every document is parsed. What changed is only that
 * the waits overlap. On the local-file store it makes no measurable difference and costs nothing.
 *
 * **This used to read three documents and now reads one per dataset**, because `settings` and
 * `reports_prototype` are keys inside `db.json` rather than files beside it. The parallelism is kept
 * rather than unwound: it is what a second dataset needs, and it is the same shape either way.
 *
 * A failure in any still exits inside `readJsonDb`, before the others can resolve — a refusal naming
 * the document that failed, which is what it was before.
 */
const loadedDocs = await Promise.all(
  DATASETS.map((name) =>
    readJsonDb(
      DB_PATHS[name],
      `${name}/db.json`,
      name === PRIMARY
        ? 'git checkout HEAD -- backend/db.json && npm run seed:governance'
        : `npm run seed:dataset -- ${name} && npm run db:push -- ${name}`,
    ),
  ),
)

/**
 * Every dataset's document, by name — the real objects, which `commitDb` swaps in place.
 *
 * Reads still go through `db` below. This map is what that resolves *into*, and the only thing that
 * knows there is more than one document.
 */
const docs = Object.fromEntries(DATASETS.map((name, i) => [name, loadedDocs[i]]))

/**
 * `both`, computed once and rebuilt when a document changes.
 *
 * Merging 476 KB of documents on every request would be paid by every page; a version counter is
 * enough because the only thing that changes a document in this process is `commitDb`, which bumps
 * it. Held as `null` rather than eagerly built so a server nobody asks `both` of never pays for it.
 */
let mergedDoc = null
const invalidateMerged = () => {
  mergedDoc = null
}
function currentDoc() {
  const selected = activeDataset()
  if (selected !== BOTH) return docs[selected]
  if (!mergedDoc) mergedDoc = mergeDocs(DATASETS.map((name) => docs[name]))
  return mergedDoc
}

/**
 * The document this request selected.
 *
 * Every one of the ~280 `db.<key>` reads below is unchanged and means what it always meant — see
 * the note at the top of `datasets.js` for why this is a Proxy rather than a parameter threaded
 * through every helper.
 */
const db = documentProxy(currentDoc)

/* ---------------- the live state, which is per dataset too ---------------- */

/**
 * Everything this process holds that never reaches disk, one set per dataset.
 *
 * **Keyed by dataset because none of it is keyed by dataset.** A registration is keyed by source
 * id, a decision by `useCaseId:itemId`, a publication by `useCaseId:sha256` — so a single shared
 * `Map` would show an EPA registration while CAPEX was selected, and settling a CAPEX review row
 * would answer an EPA one. Neither throws; both answer, which is the failure mode this repo
 * refuses everywhere else.
 *
 * `map` and `array` are the two container kinds, named rather than inferred so a new entry has to
 * say which it is instead of being guessed from an initialiser that is no longer here.
 */
const LIVE_SHAPE = {
  registered: 'map',
  profilingJobs: 'array',
  graphBuildsByUseCase: 'map',
  derivations: 'map',
  studioVersions: 'map',
  studioBuildCount: 'map',
  studioDecisions: 'map',
  studioPivotChoice: 'map',
  studioLive: 'map',
  studioPublishedBy: 'map',
  whatifSaved: 'map',
  governanceLog: 'array',
}

const live = Object.fromEntries(
  DATASETS.map((name) => [
    name,
    Object.fromEntries(
      Object.entries(LIVE_SHAPE).map(([key, kind]) => [key, kind === 'map' ? new Map() : []]),
    ),
  ]),
)

/** The timestamp a merged list orders by, taken from the rows rather than assumed. */
const AT_KEYS = ['at', 'queued_at', 'created_at', 'started_at', 'published_at']

/* The methods that would change a container. Listed rather than detected, so a new one is a decision. */
const MAP_WRITERS = ['set', 'delete', 'clear']
const ARRAY_WRITERS = ['push', 'unshift', 'pop', 'shift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']

/**
 * A merged container that answers reads and refuses writes by name.
 *
 * The alternative was refusing every non-GET at the dispatcher, which also refused `/auth/login`,
 * `/ask` and every other POST that only reads — and made `both` a state a signed-out reader could not
 * leave. This refuses the act itself, so the verb no longer decides.
 */
function readOnly(value, name, writers) {
  return new Proxy(value, {
    get(target, key) {
      if (typeof key === 'string' && writers.includes(key)) {
        return () => {
          throw new Error(
            `cannot change ${name} while dataset=${BOTH} is selected — it merges every dataset for ` +
              `reading, so this would be written to a copy and lost. Select ${DATASETS.join(' or ')} first.`,
          )
        }
      }
      const held = target[key]
      return typeof held === 'function' ? held.bind(target) : held
    },
  })
}

/**
 * One dataset's live container, or a read-only merge of every dataset's under `both`.
 *
 * The merge is rebuilt per access rather than cached: these hold registrations, jobs and decisions
 * — tens of entries, copied by reference — and there is no version to invalidate on, because a
 * profiling timer mutates them between requests as well as during one. **Writing through the merged
 * view would land on a throwaway**, which is why the dispatcher refuses every non-GET while `both`
 * is selected rather than leaving a write to succeed and vanish.
 *
 * The two arrays are kept newest-first, so a merge interleaves them by their own timestamp instead
 * of concatenating one dataset's history after the other's.
 */
function liveContainer(name) {
  return containerProxy(() => {
    const selected = activeDataset()
    if (selected !== BOTH) return live[selected][name]

    /*
     * Under `both` the container is a snapshot built for reading, so a mutating call has nowhere to
     * land — it would succeed against a throwaway and be gone by the next request, which is the
     * silent-write failure this whole split exists to avoid. Refused by name instead, with the fix in
     * the sentence. `readOnly` wraps the merged value; the read methods are untouched.
     */
    const parts = DATASETS.map((d) => live[d][name])
    if (LIVE_SHAPE[name] === 'map') {
      /*
       * First writer wins, walking in `DATASETS` order — so the primary's entry wins a shared key
       * (matching `MERGE_PLAN`) *and* comes first in iteration order. Building it the other way
       * round gets the precedence right and lists the secondary's rows above the primary's, which
       * reads as a table sorted by nothing.
       */
      const merged = new Map()
      for (const part of parts) {
        for (const [key, value] of part) if (!merged.has(key)) merged.set(key, value)
      }
      return readOnly(merged, name, MAP_WRITERS)
    }
    const rows = parts.flat()
    const at = AT_KEYS.find((k) => rows.some((r) => r && k in r))
    const sorted = at
      ? [...rows].sort((a, b) => String(b?.[at] ?? '').localeCompare(String(a?.[at] ?? '')))
      : [...rows]
    return readOnly(sorted, name, ARRAY_WRITERS)
  }, LIVE_SHAPE[name])
}

/*
 * ---------------- the Settings store, which is a key rather than a file ----------------
 *
 * `db.settings` holds only what the Settings page administers: the users, and which navigation each
 * persona may see. It was `backend/settings.json` — a separate document with a separate validator,
 * on the reasoning that two stores with one job each cannot damage one another. Folded in on request,
 * so the separation is now by *key* rather than by file, and the guard moved with it: `settings` is in
 * `DB_SHAPE`, so `commitDb` validates it before **every** write rather than only this page's, and a
 * writer that rebuilds another subtree wholesale cannot land a document without it.
 *
 * That last part is the hazard the two files existed to prevent, and it is not hypothetical: the reports
 * ingest silently dropped `governance` for exactly that reason. `ingest-reports.js` still rebuilds
 * `db.reports` wholesale and now has two more subtrees to step around; what stops it is that
 * `commitDb` and `validateDb` both refuse a document with either key missing.
 *
 * **It names personas by `role_id` and never by label.** `db.auth_roles` is the pool — what report
 * audiences validate against, what the login echoes back — so there is one answer to "who exists" and
 * this key cannot drift from it. `validateSettings` refuses a role id `db.json` does not have.
 *
 * Read through `db`, so it is the selected dataset's — which is EPA's whichever dataset that is, since
 * `MERGE_PLAN` marks it `primary`: the users are the tenant's, not a dataset's.
 */
const settings = {
  get users() {
    return db.settings.users
  },
  get defaults() {
    return db.settings.defaults
  },
  get read_only() {
    return db.settings.read_only
  },
  get nav_permissions() {
    return db.settings.nav_permissions
  },
  /*
   * What each persona may do to a report in the Library, and the authored set Reset restores.
   *
   * **A getter per key, so a new key has to be declared here to be visible at all.** That is a real
   * trap and it caught this pair: the seed wrote both blocks, `validateSettings` accepted them and
   * `GET /settings` still served `reports: {}` for every persona, because a façade of named getters
   * does not forward what it was not told about. The symptom is a page whose switches are all off with
   * the file plainly holding `true` — which reads as a broken toggle rather than a missing accessor.
   */
  get report_permissions() {
    return db.settings.report_permissions
  },
  get report_defaults() {
    return db.settings.report_defaults
  },
}

/**
 * The prototype dataset, and what it has to be to be servable.
 *
 * **Shallow on purpose.** The page validates it deeply — `src/reports/data/validate.ts` walks every row
 * and was written when this was a bundled import — so the check here is the one the *server* is
 * responsible for: refuse to boot on a document the prototype could not render at all. Duplicating the
 * deep walk in a second language is how the two come to disagree about what a valid row is.
 *
 * Every collection is required **non-empty**, unlike a secondary dataset's rosters: this is one authored
 * sample dataset, and an empty `generators` is a document that lost its data rather than a state anybody
 * chose. `meta`, `assumptions` and `opts` are objects the panes read fields off directly.
 */
const PROTOTYPE_COLLECTIONS = [
  'fields',
  'generators',
  'facilities',
  'quarters',
  'traces',
  'starters',
  'presets',
  'slice_default',
  'audiences',
  'library',
]
const PROTOTYPE_OBJECTS = ['meta', 'assumptions', 'opts']

function validatePrototype(candidate) {
  const problems = []
  if (!isObject(candidate)) return ['db.reports_prototype must be a JSON object']
  for (const key of PROTOTYPE_OBJECTS) {
    if (!isObject(candidate[key])) problems.push(`"${key}" must be an object`)
  }
  for (const key of PROTOTYPE_COLLECTIONS) {
    const value = candidate[key]
    if (!Array.isArray(value)) problems.push(`"${key}" must be an array`)
    /*
     * **`library` is the one collection that may be empty, and the client's validator already said so.**
     *
     * Every other collection here is authored sample data: an empty `generators` is a document that lost
     * its rows rather than a state anybody chose. The shelf is different — it is the prototype's own demo
     * *fiction*, other people's saved reports, and `src/reports/data/validate.ts` permits it empty in as
     * many words ("a fresh workspace has published nothing"). Hosted it is always empty anyway, because a
     * governed Library is present and the prototype defers to it.
     *
     * Two validators disagreeing about one field is worth resolving rather than working around: a dataset
     * whose shelf rows referred to starters it no longer had could only satisfy both by inventing four
     * demo reports, which is fabricating data to pass a check.
     */
    else if (value.length === 0 && key !== 'library') {
      problems.push(`"${key}" is empty — the prototype would render nothing`)
    }
  }
  return problems
}

/* Read through `db` at call time, like `settings`. Nothing writes it — the prototype does not save
   back — so a writer would go through `commitDb` the way `commitSettings` now does. */
const prototypeData = () => db.reports_prototype

/**
 * The port, in the order a caller means it.
 *
 * `process.argv[2]` first, because that is somebody typing `npm run mock -- 4001` while looking at the
 * terminal — an explicit instruction beats an inherited environment.
 *
 * **`PORT` next, and that entry is what makes this deployable.** Elastic Beanstalk's Node platform sets
 * `PORT` (8080) and puts nginx in front proxying `:80` to it. A server that ignores `PORT` listens on
 * 4000, nginx finds nothing on 8080, and every health check fails — so the environment goes red while the
 * application is perfectly healthy, which is the least diagnosable kind of deployment failure. The same
 * convention covers Heroku, Fly, App Runner and Cloud Run.
 *
 * `MOCK_PORT` stays for the boxes that already set it.
 */
const PORT = Number(process.argv[2] ?? process.env.PORT ?? process.env.MOCK_PORT ?? 4000)

/** Registered sources, keyed by source_id. Resets on restart. */
const registered = liveContainer('registered')
/** Profiling runs, newest first. */
const profilingJobs = liveContainer('profilingJobs')
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

/*
 * How long step 3's two acts are held — `1. Run preview` and `2. Finish`, on both
 * connectors. Discovering a project's datasets and registering a source are the
 * two calls in this wizard that would really talk to Google, and both returned
 * before the button's spinner drew a frame: an act that finishes instantly and
 * shows nothing teaches that it is free. Same reasoning as CONSENT_MS and the
 * profiler's stage timers, and the same rule — **the button advances when its
 * request returns, not on a timer**, so the hold is here rather than in the
 * component, and every refusal above it answers immediately.
 */
const CONNECT_STEP_MS = 5000

/**
 * How short a source name may be.
 *
 * A name is **required** on every register endpoint, and the project or drive id
 * is no longer accepted as a silent fallback. It used to be: registering with the
 * field blank produced a row called `vrio-contextweave-demo`, which reads as a
 * name until two sources from one project need telling apart. The floor exists so
 * "a", "x" and "db" cannot pass either — the Sources table and the Catalog both
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
    'access-control-allow-headers': `content-type,${DATASET_HEADER}`,
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
    'access-control-allow-headers': `content-type,${DATASET_HEADER}`,
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
  auth_roles: (v, empty) =>
    Array.isArray(v) &&
    (empty || v.length > 0) &&
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
  projects: (v, empty) =>
    Array.isArray(v) &&
    (empty || v.length > 0) &&
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
  drives: (v, empty) =>
    Array.isArray(v) &&
    (empty || v.length > 0) &&
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
  column_vocabulary: (v, empty) =>
    Array.isArray(v) &&
    (empty || v.length > 0) &&
    v.every((c) => isObject(c) && c.name && c.type && c.class),
  document_vocabulary: (v, empty) =>
    Array.isArray(v) &&
    (empty || v.length > 0) &&
    v.every((c) => isObject(c) && c.name && c.type && c.class),
  /*
   * The real profiled columns, `dataset.table` → columns[]. Required, and checked
   * inside: `tableDictionary` falls back to synthesis when a table has no entry,
   * so losing this key would not throw — the Catalog would quietly serve 206
   * invented columns in place of the profiler's, which is the worst kind of
   * wrong. A malformed entry is refused for the same reason.
   */
  column_profiles: (v, empty) =>
    isObject(v) &&
    (empty || Object.keys(v).length > 0) &&
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
  document_extractions: (v, empty) =>
    isObject(v) &&
    (empty || Object.keys(v).length > 0) &&
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
  ask_answers: (v, empty) =>
    Array.isArray(v) &&
    (empty || v.length > 0) &&
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
  graph_domains: (v, empty) =>
    Array.isArray(v) &&
    (empty || v.length > 0) &&
    v.every((d) => isObject(d) && d.domain_id && d.name),
  graph_personas: (v, empty) =>
    Array.isArray(v) &&
    (empty || v.length > 0) &&
    v.every((p) => isObject(p) && p.persona_id && p.name),
  graph_kpis: (v, empty) =>
    Array.isArray(v) && (empty || v.length > 0) && v.every((k) => isObject(k) && k.kpi_id && k.name),
  graph_hero_questions: (v, empty) =>
    Array.isArray(v) &&
    (empty || v.length > 0) &&
    v.every((q) => isObject(q) && q.question_id && q.text),
  graph_answer_formats: (v, empty) =>
    Array.isArray(v) &&
    (empty || v.length > 0) &&
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
  /*
   * The What-if lens. Every nested key is checked for the reason `column_profiles` is:
   * losing one does not throw. Without `generators` the pools are empty and the page
   * reads "no generator qualifies"; without `watched_measures` a scenario column has
   * nothing to recompute and reads as "no inherited risk"; without `headroom` the
   * inverse question prints an em dash, which reads as "no limit". All three are
   * answers, and all three would be wrong.
   */
  whatif: (v, empty) =>
    isObject(v) &&
    isObject(v.facility) &&
    Array.isArray(v.generators) &&
    (empty || v.generators.length > 0) &&
    Array.isArray(v.watched_measures) &&
    (empty || v.watched_measures.length > 0) &&
    Array.isArray(v.candidate_pools) &&
    Array.isArray(v.resolvable) &&
    isObject(v.formats) &&
    isObject(v.headroom),
  /*
   * The reports section, nested-checked for the reason `whatif` is: losing one key
   * does not throw, it answers. Without `data` every report renders its authored
   * tiles above an empty table — "nothing to report" rather than "a roster went
   * missing". Without `fields` every column header prints its raw key (`last_enf`).
   * Without `tiles` or `footer` a report loses the two things that make it citable:
   * its headline figures and the table it was read from.
   */
  reports: (v, empty) =>
    isObject(v) &&
    isObject(v.meta) &&
    Array.isArray(v.fields) &&
    (empty || v.fields.length > 0) &&
    isObject(v.assumptions) &&
    /* The wizard's three pickers, the facets it slices by, the summary a generated
       report computes, and the saved library. Losing `opts` leaves step 2 with a
       sentence nobody can change; losing `summary_catalog` leaves a generated report
       with no tiles, which reads as "nothing to summarise". */
    isObject(v.opts) &&
    Array.isArray(v.slice_default) &&
    Array.isArray(v.summary_catalog) &&
    (empty || v.summary_catalog.length > 0) &&
    Array.isArray(v.summary_default) &&
    Array.isArray(v.saved) &&
    isObject(v.data) &&
    Object.values(v.data).every((rows) => Array.isArray(rows) && (empty || rows.length > 0)) &&
    /*
     * The governance block. Nested rather than top-level, and required for the reason
     * `graph_studio.sanity_checks` is: losing it does not throw, it answers. The Library would
     * render with no lifecycle chips, the Operations tab with no gates, and an ungoverned report
     * section reads as a report section with nothing to govern.
     */
    isObject(v.governance) &&
    Array.isArray(v.governance.statuses) &&
    v.governance.statuses.length > 0 &&
    /* A state needs all three: the chip reads the label and tints itself from the tone, so a
       state missing either renders as a chip with no name or no state colour. */
    v.governance.statuses.every((s) => isObject(s) && s.key && s.label && s.tone) &&
    Array.isArray(v.governance.reports) &&
    /* Governed rows are a dataset's own definitions, so a dataset with no reports has none — the
       state pool, the data scopes and the publishing copy above are the tenant's and stay required. */
    (empty || v.governance.reports.length > 0) &&
    v.governance.reports.every(
      (g) =>
        isObject(g) &&
        g.report_id &&
        g.status &&
        /*
         * **Across keys**, and for the reason the graph's edge endpoints are checked: a status the
         * state pool does not declare does not throw. It has no label, so the card prints the raw
         * key; and it matches no chip, so the row is reachable only under "All current" while
         * every other chip under-counts by one. A short count reads as an answer.
         */
        v.governance.statuses.some((s) => s.key === g.status) &&
        g.version &&
        g.author &&
        g.category &&
        /*
         * An array, and **not** a non-empty one. Share can set a definition private, which is
         * `audience: []` and a decision a reader made — so the server has to boot with it. The
         * seed still refuses an empty audience, because there it is a typo and nothing on that
         * side can tell the two apart.
         */
        Array.isArray(g.audience),
    ) &&
    Array.isArray(v.governance.data_scope) &&
    v.governance.data_scope.length > 0 &&
    isObject(v.governance.gate_notes) &&
    /*
     * The publish dialog's copy. Required for the reason the rest of `governance` is: losing it
     * does not throw, it answers — the dialog renders with no lead, no reader note and a freshness
     * select with nothing in it, which reads as a publish flow that asks for nothing. And a preset
     * with no sentence prints a blank line under a control that plainly did something.
     */
    isObject(v.governance.publishing) &&
    isObject(v.governance.publishing.readers) &&
    /* Required in these words wherever a client-held audience is recorded. */
    String(v.governance.publishing.readers.caveat ?? '').includes('not access control') &&
    isObject(v.governance.publishing.freshness) &&
    Array.isArray(v.governance.publishing.freshness.presets) &&
    v.governance.publishing.freshness.presets.length > 0 &&
    v.governance.publishing.freshness.presets.every((p) => isObject(p) && p.id && p.label && p.sentence) &&
    /* A default naming no preset opens the select on nothing. */
    v.governance.publishing.freshness.presets.some(
      (p) => p.id === v.governance.publishing.freshness.default,
    ) &&
    /*
     * The Audit & Governance page's copy. Required for the same reason, and one field of it is
     * load-bearing rather than decorative: `not_enforced` is the sentence that stops the page
     * implying a filter runs. A page that lets somebody author a restriction and says nothing
     * about enforcement is the one claim this whole section exists to avoid, so the phrase is
     * checked rather than merely the key.
     */
    isObject(v.governance.audit) &&
    isObject(v.governance.audit.copy) &&
    /recorded, not enforced/.test(String(v.governance.audit.copy.not_enforced ?? '')) &&
    Array.isArray(v.governance.audit.copy.gates) &&
    v.governance.audit.copy.gates.length > 0 &&
    Array.isArray(v.governance.audit.categories) &&
    v.governance.audit.categories.some((c) => c.key === 'all') &&
    /*
     * `access_requests` was required here, holding readers' asks for a report they were not entitled
     * to. It went with the pending-approval state: nothing writes one and nothing renders one, and a
     * required key for a feature that does not exist fails a boot for no reason a user could act on.
     * An older `db.json` may still carry it; an extra key is not a problem, and re-seeding drops it.
     */
    Array.isArray(v.reports) &&
    (empty || v.reports.length > 0) &&
    v.reports.every(
      (r) =>
        isObject(r) &&
        r.report_id &&
        r.heading &&
        r.spine &&
        Array.isArray(r.blocks) &&
        r.blocks.length > 0 &&
        Array.isArray(r.tiles) &&
        r.tiles.length > 0 &&
        Array.isArray(r.footer) &&
        r.footer.length > 0,
    ),

  /*
   * ---------------- the two keys that used to be documents ----------------
   *
   * `settings` and `reports_prototype` were `backend/settings.json` and
   * `backend/reports_prototype.json`, each with its own validator run once at boot. Folding them
   * in moved the check here, which is *stronger* rather than merely different: every writer hands
   * `commitDb` the whole document, so a writer that rebuilds one subtree and forgets to carry these
   * forward is now a refused write naming the key, rather than a file that silently lost the tenant's
   * users. `ingest-reports.js` rebuilding `db.reports` wholesale is how `governance` was nearly
   * dropped once, and this is the same hazard with two more subtrees in range.
   *
   * Both delegate to the validators that already existed, rather than restating their rules — the
   * settings one checks *across* `db.auth_roles`, which a shape function here could not do.
   *
   * **Neither is relaxed by `empty`.** A secondary dataset may legitimately have no projects and no
   * profiles, but it has the same tenant behind it: an empty user list is a document that lost its
   * data in any dataset, and `MERGE_PLAN` marks both `primary` precisely because they are not a
   * dataset's to vary.
   */
  /*
   * **Validated against the document's *own* `auth_roles`, not the ambient dataset's.**
   *
   * `validateSettings` checks that every user names a real persona, and it read `db.auth_roles` to do
   * it. At boot there is no request in flight, so `activeDataset()` is the primary — which meant CAPEX's
   * settings were checked against **EPA's** roles. That was invisible while CAPEX was empty and carried
   * the primary's block verbatim; the moment it arrived as its own tenant, with its own personas, the
   * boot refused a document that is internally consistent and named the wrong reason.
   *
   * So the whole candidate is threaded through and the roles come from it. A document has to be valid
   * on its own terms — that is what "one document per dataset" means.
   */
  settings: (v, _empty, doc) => validateSettings(v, doc).length === 0,
  reports_prototype: (v) => validatePrototype(v).length === 0,
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
  whatif:
    'object with facility{}, generators[], watched_measures[], candidate_pools[], formats{}, ' +
    'resolvable[], headroom{} — the What-if lens, from "npm run ingest:whatif"',
  reports:
    'object with meta{}, fields[], assumptions{}, opts{}, slice_default[], ' +
    'summary_catalog[], summary_default[], saved[], data{ generators[], facilities[], ' +
    'quarters[], traces[] }, reports[] of { report_id, heading, spine, blocks[], ' +
    'tiles[], footer[] } and ' +
    'governance{ statuses[] of { key, label, tone }, reports[] of ' +
    '{ report_id, status naming one of those states, version, author, category, audience[] }, ' +
    'data_scope[], gate_notes{}, publishing{ lead, name{}, readers{ caveat saying ' +
    '"not access control" }, freshness{ presets[] of { id, label, sentence }, default naming ' +
    'one }, foot, buttons{} } } ' +
    '— the report section, from "npm run ingest:reports" and ' +
    '"node scripts/seed-report-governance.js"',
  settings:
    'object with users[] of { email, name, role_id naming one of auth_roles }, ' +
    'nav_permissions{}, defaults{} carrying the same keys, and read_only{} — what the Settings ' +
    'page administers, from "npm run seed:settings"',
  reports_prototype:
    'object with meta{}, assumptions{}, opts{} and non-empty fields[], generators[], ' +
    'facilities[], quarters[], traces[], starters[], presets[], slice_default[], audiences[], ' +
    'library[] — the authoring prototype’s own sample data, from "npm run db:pull"',
}

function validateDb(candidate) {
  const problems = []
  if (!isObject(candidate)) return ['the document must be a JSON object']

  /*
   * **An empty collection is a real state in a secondary dataset, and a lost one in the primary.**
   *
   * Fourteen keys are required non-empty, and every one of those rules is right for EPA: a document
   * that came back with no projects, no profiles or no report definitions has lost data no route
   * touched, which is exactly the stale-server fault `commitDb` refuses. But CAPEX is *deliberately*
   * empty until it is populated, and the alternative to allowing that is worse in both directions —
   * seed it with EPA's rows and CAPEX shows EPA's figures under CAPEX's name, or leave it invalid
   * and the server will not boot at all.
   *
   * So emptiness is permitted for a dataset that is not the primary, and **nothing else is**: a row
   * that *is* present is checked exactly as strictly, so a malformed CAPEX project is still a
   * refusal. The keys holding the section's own vocabulary — the field dictionary, the wizard pools,
   * the What-if copy, the governance states — are seeded from the primary rather than emptied,
   * because a page with no copy does not read as an empty dataset, it reads as a broken one.
   */
  const empty = activeDataset() !== PRIMARY

  for (const [key, check] of Object.entries(DB_SHAPE)) {
    if (!(key in candidate)) problems.push(`"${key}" is missing — ${DB_HINTS[key]}`)
    else if (!check(candidate[key], empty, candidate))
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

  /*
   * A drive is a tree, stored flat: a folder points at its parent, and the connect wizard draws
   * the nesting from those pointers. A `parent_id` naming no folder of the same drive fails the
   * same silent way a dangling canvas edge does — the child is not refused, it is drawn at the
   * root, so a subfolder of "Active matters" appears to be a top-level folder of its own and the
   * allowlist looks like it covers more of the drive than it does. A cycle is worse: the tree
   * walk never reaches the root and the folder simply is not drawn at all.
   */
  if (problems.length === 0) {
    for (const drive of candidate.drives) {
      const own = new Map(drive.folders.map((f) => [f.folder_id, f]))
      for (const folder of drive.folders) {
        const parentId = folder.parent_id ?? null
        if (parentId !== null && !own.has(parentId)) {
          problems.push(
            `drive "${drive.drive_id}" folder "${folder.folder_id}" names parent ` +
              `"${parentId}", which is not a folder of that drive — it would be drawn at the ` +
              'root instead, which reads as a folder nobody nested',
          )
          continue
        }
        const seen = new Set([folder.folder_id])
        let cursor = parentId
        while (cursor !== null && cursor !== undefined) {
          if (seen.has(cursor)) {
            problems.push(
              `drive "${drive.drive_id}" folder "${folder.folder_id}" is its own ancestor — ` +
                'a cycle in parent_id leaves the folder off the tree entirely',
            )
            break
          }
          seen.add(cursor)
          cursor = own.get(cursor)?.parent_id ?? null
        }
      }
    }
  }

  /*
   * The What-if lens is a web of references into its own generator roster, and `/db`
   * lets a user edit it live. Every one of these reads as an answer when it breaks: a
   * measure on a field nobody carries shows 0 inherited risk, a pool on a missing field
   * offers nobody, and a resolvable naming no measure reports "Resolved — added" and
   * adds nothing. `npm run ingest:whatif` checks the same things against the package;
   * this checks the document actually being served.
   */
  if (problems.length === 0) {
    const w = candidate.whatif
    /*
     * **The field checks need a row to read the fields off, and a seeded dataset has none.**
     *
     * "No generator carries this field" is a real fault when there are generators and a vacuous one
     * when there are not — with an empty roster *every* field is missing, so running these would
     * report one problem per watched measure and none of them would be actionable. The checks that do
     * not depend on a row (formats, headroom, resolvable) still run, because those are references
     * inside the block and are as wrong on an empty dataset as on a full one.
     */
    const roster = Array.isArray(w.generators) ? w.generators : []
    const genFields = roster.length > 0 ? new Set(Object.keys(roster[0])) : null
    const measureKeys = new Set(w.watched_measures.map((m) => m.key))
    for (const m of w.watched_measures) {
      if (genFields && !genFields.has(m.field)) {
        problems.push(
          `whatif.watched_measures "${m.key}" reads generator field "${m.field}", which no ` +
            'generator carries — it would show as no inherited risk rather than as an error',
        )
      }
      if (!(m.format in w.formats)) {
        problems.push(
          `whatif.watched_measures "${m.key}" wants format "${m.format}", which whatif.formats ` +
            'does not define — its figure would print raw',
        )
      }
    }
    for (const p of w.candidate_pools) {
      if (p.filter && genFields && !genFields.has(p.filter.field)) {
        problems.push(
          `whatif.candidate_pools "${p.key}" filters on "${p.filter.field}", which no generator ` +
            'carries — the pool would offer nobody, which reads as "none qualify"',
        )
      }
      if (!(p.key in w.headroom)) {
        problems.push(
          `whatif.headroom has no entry for pool "${p.key}" — the inverse question would print ` +
            'an em dash, which reads as "no limit". Re-run "npm run ingest:whatif"',
        )
      }
    }
    for (const r of w.resolvable) {
      if (r.resolves_to !== null && !measureKeys.has(r.resolves_to)) {
        problems.push(
          `whatif.resolvable "${r.keywords?.[0]}" resolves to "${r.resolves_to}", which is not a ` +
            'watched measure — authoring would report success and add nothing',
        )
      }
    }
    /*
     * The publish dialog, which fails the same silent way. A preset with no sentence
     * prints a blank recurrence line under a control that plainly did something; a
     * default naming no preset opens the dialog on nothing; and a `no_day_error` the
     * route quotes but the document lacks refuses a publish with an empty sentence.
     */
    const pub = w.publishing
    if (!pub || !Array.isArray(pub.freshness?.presets) || pub.freshness.presets.length === 0) {
      problems.push(
        'whatif.publishing declares no freshness presets — the publish dialog would offer an ' +
          'empty schedule control. Re-run "npm run ingest:whatif"',
      )
    } else {
      for (const p of pub.freshness.presets) {
        if (!p.sentence) {
          problems.push(
            `whatif.publishing freshness preset "${p.id}" states no sentence — picking it would ` +
              'print a blank recurrence line, which reads as "no schedule"',
          )
        }
      }
      if (!pub.freshness.presets.some((p) => p.id === pub.freshness.default?.preset)) {
        problems.push(
          `whatif.publishing freshness default names preset "${pub.freshness.default?.preset}", ` +
            'which is not offered — the dialog would open on nothing',
        )
      }
      if (!pub.readers?.empty_error || !pub.freshness.no_day_error) {
        problems.push(
          'whatif.publishing is missing a refusal sentence (readers.empty_error / ' +
            'freshness.no_day_error) — the publish route sends those verbatim, so a refusal ' +
            'would arrive blank',
        )
      }
    }
  }

  /*
   * A report is references all the way down — a spine into `data`, a chart measure and
   * table columns into `fields`, a scope into the filters this server implements — and
   * every broken one renders rather than throwing. A missing spine gives tiles above an
   * empty table; a column naming a field the rows do not carry gives a header with
   * blank cells under it; a scope this server does not know would throw *inside* the
   * route, which arrives as a 400 on a report that plainly exists. All three read as
   * statements about the data. `npm run ingest:reports` checks the same references
   * against the package; this checks the document being served.
   */
  if (problems.length === 0) {
    const rep = candidate.reports
    const fieldKeys = new Set(rep.fields.map((f) => f.key))
    for (const r of rep.reports) {
      const rows = rep.data[r.spine]
      if (!Array.isArray(rows)) {
        problems.push(
          `reports "${r.report_id}" reads spine "${r.spine}", which reports.data does not have — ` +
            'its report would render its tiles above an empty table',
        )
        continue
      }
      /*
       * **A column reference can only be checked against a row that exists.**
       *
       * The same shape as the What-if roster check above: with an empty spine every column is
       * "missing", so these would report one problem per block and none of them actionable — and a
       * dataset being populated in stages legitimately has a definition before its rows, or rows
       * before the definition. The spine's *existence* and its label column are still checked, since
       * neither needs a row; `null` here means "no row to check against", not "no keys".
       */
      const rowKeys = rows.length > 0 ? new Set(Object.keys(rows[0])) : null
      if (!(r.scope in REPORT_SCOPES)) {
        problems.push(
          `reports "${r.report_id}" is scoped "${r.scope}", which this server has no filter for — ` +
            `known scopes: ${Object.keys(REPORT_SCOPES).join(', ')}`,
        )
      }
      if (!REPORT_LABEL_KEY[r.spine]) {
        problems.push(
          `reports.data."${r.spine}" has no label column declared in REPORT_LABEL_KEY, so every ` +
            'chart bar and table row on that spine would be unnamed',
        )
      } else if (rowKeys && !rowKeys.has(REPORT_LABEL_KEY[r.spine])) {
        problems.push(
          `reports.data."${r.spine}" rows do not carry "${REPORT_LABEL_KEY[r.spine]}", the column ` +
            'their labels come from',
        )
      }
      for (const block of r.blocks) {
        if (block.type === 'chart' && rowKeys && !rowKeys.has(block.measure)) {
          problems.push(
            `reports "${r.report_id}" charts "${block.measure}", which its ${r.spine} rows do not ` +
              'carry — every bar would be zero, which reads as no exposure',
          )
        }
        if (block.type === 'quarterly' && rowKeys && !rowKeys.has(block.metric)) {
          problems.push(
            `reports "${r.report_id}" trends "${block.metric}", which its ${r.spine} rows do not carry`,
          )
        }
        for (const col of block.type === 'table' ? block.cols : []) {
          if (!fieldKeys.has(col) || (rowKeys && !rowKeys.has(col))) {
            problems.push(
              `reports "${r.report_id}" tabulates "${col}", which ${
                fieldKeys.has(col) ? `its ${r.spine} rows do not carry` : 'reports.fields does not describe'
              } — the column would render with blank cells`,
            )
          }
        }
      }
      /*
       * A summary key with no tile behind it drops out of a generated report's strip,
       * leaving three tiles where the written report states four — a short summary reads
       * as an answer, the same failure a use-case template's missing persona id has.
       */
      for (const key of r.summary_keys ?? []) {
        if (!rep.summary_catalog.some((t) => t.key === key)) {
          problems.push(
            `reports "${r.report_id}" summarises "${key}", which reports.summary_catalog ` +
              'does not define — a re-asked report would show one tile fewer than the written one',
          )
        }
      }
    }
    /*
     * A saved question is re-asked, so its frame has to still resolve. One naming a
     * report or a scope that no longer exists would come back as a library row that
     * opens onto nothing.
     */
    for (const s of rep.saved ?? []) {
      if (!rep.reports.some((r) => r.report_id === s.report_id)) {
        problems.push(
          `reports.saved "${s.name ?? s.saved_id}" is saved against report "${s.report_id}", ` +
            'which no longer exists — it would open onto nothing',
        )
      }
      if (!(s.scope in REPORT_SCOPES)) {
        problems.push(
          `reports.saved "${s.name ?? s.saved_id}" is scoped "${s.scope}", which this server ` +
            'has no filter for',
        )
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
 * Write one file atomically, off the event loop, **one write at a time per path**.
 *
 * `db.json` is 450 KB, and `writeFileSync` stringified and wrote all of it on every commit while
 * every other request waited. Asynchronous writing gives that time back — but it also removes the
 * thing the synchronous version got for free: with `await` in the middle, two commits can be in
 * flight at once, and they share a temp path. The second would write `db.json.tmp` while the first
 * was still renaming it, and the file that landed would be neither document. So the writes are
 * chained per path: the queue is what makes "atomic" still true once the write can yield.
 *
 * The chain never rejects — a failed write settles it and is re-thrown to *that* caller only, so
 * one bad write cannot wedge every later one behind a rejected promise.
 */
const writeChains = new Map()
function writeJsonAtomic(ref, text) {
  const previous = writeChains.get(ref) ?? Promise.resolve()
  const next = previous.then(async () => {
    /* The version this process last saw, sent back as `If-Match`. On a file it is `null` and
       `writeDoc` does temp-then-rename as before; on S3 a second writer makes this a refused
       write rather than a lost update. The new version is kept for the write after this one. */
    const etag = await writeDoc(ref, text, docEtags.get(ref))
    docEtags.set(ref, etag)
  })
  writeChains.set(
    ref,
    next.catch(() => {}),
  )
  return next
}

/**
 * Writes via a temp file + rename so a failed write cannot leave a truncated
 * db.json, then hot-swaps the in-memory document in place — every route closes
 * over `db`, so mutating it is what makes the edit take effect without a
 * restart.
 *
 * **Async, and the order of the two steps is the load-bearing part.** Validation and the in-memory
 * swap both happen *synchronously*, before the first `await`; only the file write yields. That is
 * what keeps a second handler from reading a stale document: every call site builds its `next` from
 * `db` and calls straight into here, so by the time anything else can run, `db` already holds the
 * new state. Swapping after the write instead would open a window where two overlapping edits each
 * read the pre-edit document and the second silently dropped the first.
 *
 * The cost of swapping first is that a failed write would leave memory ahead of the file, so the
 * previous document is kept and restored if the write rejects — the caller gets the error *and* the
 * two agree again, which is what the synchronous version guaranteed by never getting that far.
 */
async function commitDb(next) {
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

  /*
   * The dataset this request selected — resolved here rather than taken as an argument, so none of
   * the callers had to learn about datasets. `both` never reaches this: the dispatcher refuses every
   * non-GET while it is selected, because a merged document has no single file to write back to and
   * splitting one into two writes would have to invent which dataset each row came from.
   */
  const selected = activeDataset()
  if (selected === BOTH) {
    throw new Error(
      `cannot write while dataset=${BOTH} is selected — it is a merged reading view with no single ` +
        `document behind it. Select one of ${DATASETS.join(' or ')} and write that.`,
    )
  }
  const target = docs[selected]

  /* Kept so the swap can be undone if the write fails — see the note above. */
  const previous = { ...target }
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, next)
  /* The merged view is built from these documents, so it is stale the moment one changes. */
  invalidateMerged()

  try {
    await writeJsonAtomic(DB_PATHS[selected], text)
  } catch (error) {
    for (const key of Object.keys(target)) delete target[key]
    Object.assign(target, previous)
    invalidateMerged()
    throw new Error(
      `could not write ${selected}/db.json — ${error.message}. Nothing was changed; the in-memory ` +
        'document has been put back the way it was.',
    )
  }
}

/* ---------------- the settings store: its shape, and its writer ---------------- */

/**
 * What `db.settings` has to be to be servable.
 *
 * Every rule here is one whose breach **answers rather than throws**: a persona with no permission set
 * shows a sidebar it should not, a user naming a role `db.auth_roles` lacks signs in as nobody, and a
 * key locked *off* is a permission that can never be granted. None of those raise anything.
 *
 * Checked **across files** where it has to be — the personas are `db.auth_roles`, not a list here.
 */
function validateSettings(candidate, doc = null) {
  const problems = []
  if (!isObject(candidate)) return ['db.settings must be a JSON object']

  /*
   * The personas this settings block is allowed to name — the *document's* own where one was handed in,
   * and the selected dataset's otherwise (which is what every request-time caller wants). See the note
   * on `DB_SHAPE.settings`: reading the ambient `db` at boot checked one dataset's users against
   * another's roles.
   */
  const roleIds = (isObject(doc) && Array.isArray(doc.auth_roles) ? doc.auth_roles : db.auth_roles).map(
    (r) => r.role_id,
  )
  const { users, defaults, read_only: readOnly, nav_permissions: perms } = candidate

  if (!Array.isArray(users) || users.length === 0) {
    problems.push('"users" must be a non-empty array — the login resolves a role from it')
  } else {
    for (const u of users) {
      if (!isObject(u) || !u.email || !u.name || !u.role_id) {
        problems.push('every user needs { id, name, email, role_id }')
        continue
      }
      if (!roleIds.includes(u.role_id)) {
        problems.push(
          `user "${u.email}" is role "${u.role_id}", which db.auth_roles does not have ` +
            `(${roleIds.join(', ')})`,
        )
      }
    }
    const seen = users.map((u) => String(u.email).toLowerCase())
    if (new Set(seen).size !== seen.length) {
      problems.push('two users share an email — the login resolves a role by address')
    }
  }

  const reportPerms = candidate.report_permissions
  const reportDefaults = candidate.report_defaults

  for (const [label, block] of [
    ['defaults', defaults],
    ['nav_permissions', perms],
    /*
     * The report blocks are checked by the same loop rather than a second copy of it: both are
     * "an object keyed by role_id whose entries hold booleans", and writing that twice is how the
     * two come to disagree about whether an unknown persona is an error.
     */
    ['report_defaults', reportDefaults],
    ['report_permissions', reportPerms],
  ]) {
    if (!isObject(block)) {
      problems.push(`"${label}" must be an object keyed by role_id`)
      continue
    }
    for (const roleId of roleIds) {
      if (!isObject(block[roleId])) {
        problems.push(`"${label}" has no entry for persona "${roleId}"`)
      }
    }
    for (const [roleId, entry] of Object.entries(block)) {
      if (!roleIds.includes(roleId)) problems.push(`"${label}" names persona "${roleId}", which is not one`)
      if (!isObject(entry)) continue
      for (const [key, value] of Object.entries(entry)) {
        if (typeof value !== 'boolean') {
          problems.push(`"${label}.${roleId}.${key}" must be true or false`)
        }
      }
    }
  }

  /*
   * **`defaults` and `nav_permissions` must cover the same keys, per persona.**
   *
   * Reset copies a persona's defaults over its live set, so a key missing from `defaults` is a
   * permission that silently becomes "not configured" — visible — the first time anybody resets. And a
   * key missing from the live set falls back to the default anyway, so the two disagreeing is always a
   * drifted file rather than an intention. Neither throws; both change what a sidebar shows.
   */
  if (isObject(defaults) && isObject(perms)) {
    /* The same `roleIds` as above, so the parity check cannot be run against a different pool from
       the one the entries were validated against. */
    for (const roleId of roleIds) {
      const a = Object.keys(defaults[roleId] ?? {}).sort()
      const b = Object.keys(perms[roleId] ?? {}).sort()
      const missing = a.filter((k) => !b.includes(k))
      const extra = b.filter((k) => !a.includes(k))
      if (missing.length > 0 || extra.length > 0) {
        problems.push(
          `"${roleId}" has different navigation keys in defaults and nav_permissions` +
            (missing.length > 0 ? ` (missing: ${missing.join(', ')})` : '') +
            (extra.length > 0 ? ` (unknown: ${extra.join(', ')})` : ''),
        )
      }
    }
  }

  /*
   * **The report blocks carry exactly `REPORT_ACTIONS`, and both of them do.**
   *
   * Two failures this catches, neither of which throws. A key that is not one of the three is a
   * permission no button reads — stored forever, and it reads as configured. And a *missing* one
   * resolves through `reportPermissionsFor` to the authored default, so `defaults` losing `delete`
   * silently hands every persona whatever the live set happens to say and Reset stops restoring it —
   * the same hazard as the navigation parity check above, which a break test found there first.
   *
   * Checked per persona rather than on the block, because that is the granularity the page writes at.
   */
  for (const [label, block] of [
    ['report_defaults', reportDefaults],
    ['report_permissions', reportPerms],
  ]) {
    if (!isObject(block)) continue
    for (const roleId of roleIds) {
      const entry = block[roleId]
      if (!isObject(entry)) continue
      const keys = Object.keys(entry).sort()
      const missing = REPORT_ACTIONS.filter((a) => !keys.includes(a))
      const unknown = keys.filter((k) => !REPORT_ACTIONS.includes(k))
      if (missing.length > 0 || unknown.length > 0) {
        problems.push(
          `"${label}.${roleId}" must carry exactly ${REPORT_ACTIONS.join(', ')}` +
            (missing.length > 0 ? ` (missing: ${missing.join(', ')})` : '') +
            (unknown.length > 0 ? ` (unknown: ${unknown.join(', ')})` : ''),
        )
      }
    }
  }

  if (!isObject(readOnly)) {
    problems.push('"read_only" must be an object keyed by role_id')
  } else {
    for (const [roleId, keys] of Object.entries(readOnly)) {
      if (!roleIds.includes(roleId)) problems.push(`"read_only" names persona "${roleId}", which is not one`)
      if (!Array.isArray(keys)) {
        problems.push(`"read_only.${roleId}" must be an array of navigation keys`)
        continue
      }
      for (const key of keys) {
        /*
         * Locked *off* is the silent one: a row nobody can ever switch on, and no error anywhere.
         *
         * Checked against the **defaults as well as the live set**, because Reset copies the defaults
         * over the live set — a lock that is on now and off by default becomes unreachable the first
         * time anybody resets that persona, which is the same fault arriving later.
         */
        if (perms?.[roleId]?.[key] !== true) {
          problems.push(
            `"${roleId}" locks "${key}" but it is not on — a locked-off item can never be granted`,
          )
        }
        if (defaults?.[roleId]?.[key] !== true) {
          problems.push(
            `"${roleId}" locks "${key}" but its default is off — Reset would make it unreachable`,
          )
        }
      }
    }
  }

  /* Somebody has to be able to open the page that grants everything else. */
  if (isObject(perms) && !Object.values(perms).some((p) => isObject(p) && p.settings === true)) {
    problems.push('no persona has "settings" — nobody could open the page that grants it')
  }

  return problems
}

/**
 * Writes the settings store — which is now a write of `db.json` with one key replaced.
 *
 * **It is still its own function, and that is deliberate.** The refusal a Settings page needs names
 * `npm run seed:settings` and describes a permission, not a report; `commitDb`'s names the document
 * and tells you to restart. Validating here first is what keeps that message, and it costs nothing
 * because `commitDb` validates the whole document again anyway — this is simply the one caller that
 * can say which of the twenty-seven keys it was trying to change.
 *
 * The ordering guarantees are `commitDb`'s now rather than restated here: the in-memory swap happens
 * before the first `await`, writes are chained per path, and a failed write puts memory back. That is
 * exactly the set this function used to implement by hand, and having one implementation of it is a
 * good half of what the merge bought.
 */
async function commitSettings(next) {
  const problems = validateSettings(next)
  if (problems.length > 0) {
    throw new Error(
      `refusing to write the settings — ${problems.join('; ')}. Re-author them with ` +
        '"npm run seed:settings" if they have drifted.',
    )
  }
  await commitDb({ ...db, settings: next })
}

/** One persona's live access, falling back to its authored defaults. */
const navPermissionsFor = (roleId) => ({
  ...(settings.defaults[roleId] ?? {}),
  ...(settings.nav_permissions[roleId] ?? {}),
})

/**
 * What a persona may do to a report in the Library: open it, edit its definition, delete its
 * governance row.
 *
 * **Declared once, here, because three layers count them.** `validateSettings` refuses a key that is
 * not one of these, the PATCH route refuses the same, and the seed authors exactly these — a fourth
 * action added to a component would be a permission nobody can store, and a key stored that no button
 * reads is a decision with no effect. Same rule as `NAV_KEYS` against `nav.ts`.
 *
 * **These are the row's own three acts, and Share is deliberately not among them.** Sharing edits the
 * *audience* — who is told a report exists — which Audit & Governance owns and which is a different
 * question from what this persona may do. Adding it here would give one record two homes.
 */
const REPORT_ACTIONS = ['open', 'edit', 'delete']

/**
 * One persona's live report access, falling back to its authored defaults — the twin of
 * `navPermissionsFor`, and the same fallback for the same reason: an absent key means "not
 * configured", which resolves to the authored default rather than to a denial. A missing key that
 * read as `false` would turn a drifted file into a persona locked out of every report, which reads as
 * a broken page rather than as a setting.
 */
const reportPermissionsFor = (roleId) => ({
  ...(settings.report_defaults?.[roleId] ?? {}),
  ...(settings.report_permissions?.[roleId] ?? {}),
})

/** Whether a persona's toggle for one navigation key is fixed. */
const navReadOnly = (roleId, key) => (settings.read_only[roleId] ?? []).includes(key)

/**
 * The Settings payload: the users, the personas, and each one's access.
 *
 * Personas are resolved from `db.auth_roles` on the way out, so a label is never stored here and a
 * renamed role reaches every surface at once. `read_only` rides along per persona rather than being a
 * rule the client re-derives — the server enforces it, so the client should be *told* it.
 */
const settingsView = () => ({
  users: settings.users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role_id: u.role_id,
    role_label: db.auth_roles.find((r) => r.role_id === u.role_id)?.label ?? u.role_id,
  })),
  personas: db.auth_roles.map((role) => ({
    role_id: role.role_id,
    label: role.label,
    access_note: role.access_note ?? '',
    nav: navPermissionsFor(role.role_id),
    read_only: settings.read_only[role.role_id] ?? [],
    /* So the page can offer Reset without keeping its own copy of what "default" means. */
    defaults: settings.defaults[role.role_id] ?? {},
    /*
     * What this persona may do to a report, and what it would reset to. Served beside `nav` rather
     * than on a payload of its own: they are two answers to "what may this persona reach", the page
     * configures them one persona at a time, and a second endpoint would mean two fetches that can
     * disagree about which personas exist.
     */
    reports: reportPermissionsFor(role.role_id),
    report_defaults: settings.report_defaults?.[role.role_id] ?? {},
  })),
  /*
   * The actions, served rather than written into the panel — the rule the consent screen's scopes
   * follow. A column the component invented could offer a permission `PATCH` refuses, and a column it
   * omitted would hide one the server stores and the card reads.
   */
  report_actions: REPORT_ACTIONS,
})

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
/*
 * Six steps.
 *
 * **'Answer requirements' was the seventh and is gone from the brief.** Citations and
 * the render format are chosen where an answer is actually asked for — a tab on Ask —
 * rather than declared once by the use case, so nothing in this list stores them any
 * more. A brief that had reached the old step 6 or 7 opens on 'Entities &
 * relationships': `savedUseCase` clamps the stored number to this list's length, which
 * is the only remap that cannot point at a step that no longer exists.
 */
const WIZARD_STEPS = [
  'Domain',
  'Personas',
  'KPIs',
  'Sources',
  'Hero questions',
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
 * detail step 6 needs: the table it came from, its size, and its columns.
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
      /*
       * **Two different obligations on one field, and they need separating.**
       *
       * `rowCount` is what the catalogue knows: a number, or `null` for a table it listed but never
       * profiled. CAPEX's own provenance insists on that distinction — *"rows is null for the 60 tables
       * the package catalogued but did not profile — that is the honest value, not zero"* — and 62 of its
       * 64 tables are in that state.
       *
       * `rows` below is a **synthesis input**: `tableDictionary` scales its distinct counts and null
       * percentages by it, so it has to be a number and 0 is a serviceable floor for a table nobody has
       * measured. That is arithmetic nobody reads.
       *
       * `size` is a **figure a reader sees**, so it may not borrow that 0. `${0} rows` states that the
       * table is empty when the truth is that nobody has counted it — the same mistake the What-if lens
       * avoids by reporting `null` rather than `0` for a facility with no baseline.
       *
       * The wording matches `frontend/src/data/rowCount.ts`. It is stated twice on purpose: the two
       * packages deploy separately and must not import each other, so a shared constant would couple
       * them. If one changes, change the other.
       */
      const rowCount = meta?.rows ?? null
      const rows = rowCount ?? 0
      out.push({
        objectId,
        sourceName: source.source_name,
        label: p.table_id,
        size: rowCount === null ? 'row count not profiled' : `${rowCount.toLocaleString('en-US')} rows`,
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
 * Step 6's coverage review.
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
 * The derivation run between step 5 and step 6.
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
  'Checking coverage against the Catalog',
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
 * 3s per substep — 31 of them, so a whole build is ≈1m 33s.
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
const BUILD_STEP_MS = 3_000

/**
 * Every build ever run, newest first, keyed by use case. In memory like every
 * other run here, so a restart clears the history and the 404 says so.
 */
const graphBuildsByUseCase = liveContainer('graphBuildsByUseCase')

/** Runs in flight, keyed by id. In memory, like every other run in this mock. */
const derivations = liveContainer('derivations')

const DERIVATION_STAGE_MS = 1300
const COST_CAP_USD = 1

/** What a "Suggest … (LLM)" button shows while it waits. */
const DRAFT_STAGES = ['Reading your brief', 'Drafting candidates', 'Ranking against your data']

// Long enough for the drafting state to be seen, short enough not to annoy.
const SUGGEST_MS = 1100

/*
 * How long an export's presigned link opens the file for.
 *
 * **The link is the permission**, so its lifetime is the whole of the access decision: anyone
 * holding it can read that object until it expires, and nothing can revoke it early. An hour is
 * long enough to send a report to somebody and have them open it, and short enough that a URL
 * pasted into a ticket or a chat log stops working long before the ticket is closed.
 *
 * Reported to the caller as `expires_in` rather than left implicit — a link that has quietly
 * stopped working reads as a broken report rather than as an expired share.
 */
const REPORT_EXPORT_LINK_MS = 60 * 60 * 1000

/*
 * What every step of the What-if flow is held for.
 *
 * Longer than `SUGGEST_MS` on purpose: a step here is not a list being ranked, it is
 * a candidate load being admitted into the graph hypothetically and traversed to the
 * generator's federal record — evaluations, violations, enforcement, any decree — and
 * an operation that returns in 2ms teaches that the traversal is free. It is not.
 *
 * The hold is on the endpoint, never in the page, wherever a request exists: a step
 * advances when its call returns. Refusals are never paced — a four-second 404 on a
 * generator the pool excludes reads as a hang.
 */
const WHATIF_STEP_MS = 4000

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
const studioVersions = liveContainer('studioVersions')

/**
 * **A version per build: v1, v2, v3.** The number is the count of builds this graph has
 * started, so every run — first build or tenth rebuild — gets its own label.
 *
 * This replaced a *config* version that moved when the brief was committed and stayed put
 * across rebuilds, so several rows legitimately read `v2` and were told apart by content
 * hash alone. Content addressing is still the identity (`sha256`, unchanged); what changed is
 * that the label now names the build rather than the brief, which is what a reader means by
 * "version" on a list of builds.
 *
 * **It is still assigned once, at the start of a run, and never recomputed.** That is the
 * property the old scheme was protecting: a counter that moved on publish would relabel
 * history, so a published `v2` must stay `v2` however many builds follow it. Assigning at
 * `startBuildFor` and reading the stored value everywhere keeps that true.
 */
const studioBuildCount = liveContainer('studioBuildCount')

/** The next label for this graph, and the count that produced it. Called once per run. */
function nextBuildVersion(useCaseId) {
  const next = (studioBuildCount.get(useCaseId) ?? 0) + 1
  studioBuildCount.set(useCaseId, next)
  return `v${next}`
}

/**
 * The newest label this graph has reached — what the studio header and the wizard's card
 * show as its draft version. `v1` before anything has been built, because that is the
 * version the first build will produce, not a claim that one exists.
 */
const configVersion = (useCaseId) => `v${studioBuildCount.get(useCaseId) || 1}`

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
    /*
     * This build's version — v1, v2, v3 — taken once, here, and carried on the run. Every
     * surface reads it from the run or from the version row the run produced, so a published
     * label can never be recomputed into a different number by a later rebuild.
     */
    config_version: nextBuildVersion(id),
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
 * This is the Data Catalog's profiled state, not the registration — a source
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
const studioDecisions = liveContainer('studioDecisions')
const studioPivotChoice = liveContainer('studioPivotChoice')
/*
 * Which version is published, keyed by use case — the **content hash** of one
 * build, not a number. One pointer: publishing sets it, unpublishing clears it, and
 * publishing a different row moves it. The version rows themselves are never
 * touched, which is what makes them immutable.
 */
const studioLive = liveContainer('studioLive')

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

/*
 * Who published what, keyed `useCaseId:sha256`.
 *
 * **The server has to be told.** The identity is client-held — there is no session here to
 * look a user up from — so the publish route takes `as=<email>` exactly as the consent
 * callback does, and this is where it is kept. Before this, every "published by" line in
 * the app read `db.google_account`, the seeded account, and a reader had no way to know it
 * was not the person who pressed the button.
 *
 * In memory, like publication itself: a restart forgets both together, which is the only
 * consistent thing it could do.
 */
const studioPublishedBy = liveContainer('studioPublishedBy')

/**
 * The account to name as publisher: whoever published it, or the seeded account when
 * nobody was recorded — a version published before this existed, or by a caller that sent
 * no identity. The fallback is the tenant's own account rather than a blank, because
 * "published by nobody" is not true of a live version.
 */
const publishedByFor = (useCaseId) => {
  const sha = studioLive.get(useCaseId)
  return (sha && studioPublishedBy.get(`${useCaseId}:${sha}`)) || db.google_account.email
}

/**
 * The label of what is serving, for the pages that print it. Null before anything
 * is published — no version number is invented to fill the tag.
 */
function liveVersion(useCaseId) {
  return publishedVersion(useCaseId)?.config_version ?? null
}

/** A graph is in the studio once it has been built — committed on the last step. */
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
     * The newest version label this graph has reached. **A build takes the next number**
     * (v1, v2, v3), so this moves when a build starts — not when the brief is committed and
     * not when something is published. Before the first build it reads `v1`, which is what
     * that build will produce rather than a claim that a version exists.
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
         `source` is the Catalog object itself, so a node on the canvas can be
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
/*
 * **A paragraph every 5 seconds.** Slower than it was (380ms) and slow on purpose: an answer
 * that lands in one blink reads as a lookup, and this one is meant to read as composed — a
 * reader watches a paragraph arrive, takes it in, and the next follows. The cost is that a
 * five-block answer takes ~25s, which is why the page draws a shimmer for each paragraph
 * still to come rather than leaving an unexplained gap.
 *
 * Change this number and the page follows: nothing client-side restates it, and the count of
 * shimmers comes from `block_count` below rather than from a guess about the pace.
 */
const ASK_BLOCK_MS = 5_000

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
 * Not invented here: these are the coverage step's gap decisions read back, matched to the
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
    /* Whoever published it, which the publish route was told. */
    published_by: publishedByFor(useCase.use_case_id),
    graph_id: published.graph_id,
    sha256: published.sha256,
    /* No `citations` here any more. The brief used to declare it on step 6 and every
       answer inherited it; it is now asked for per question on Ask's own tab, so it
       rides on the *answer* rather than on the graph. A graph-level copy would be a
       second answer to "what did this reader require". */
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

/*
 * Answer requirements — what a reader wants an answer to carry, chosen per question
 * on Ask's own tab.
 *
 * **This used to be step 6 of the wizard**, where the use case declared it once for
 * every answer it would ever give. It moved because the reader asking is the one who
 * knows what they need this answer to be, and because a declaration nothing checks is
 * worth less than a request something reports on.
 *
 * The pool is the server's: the formats are `db.graph_answer_formats`, and the two
 * citation options are authored here rather than in the component, for the reason the
 * consent screen renders the scopes the endpoint returned — a client holding its own
 * list can offer a value the API refuses.
 */
const CITATION_OPTIONS = [
  { value: 'required', label: 'Required — every claim cites its source' },
  { value: 'optional', label: 'Optional' },
]
const DEFAULT_CITATIONS = 'required'

/**
 * The formats a reader may ask for, self-describing on the way out so the page never
 * has to look a name up by id.
 */
const askAnswerFormats = () =>
  (db.graph_answer_formats ?? []).map((f) => ({
    format_id: f.format_id,
    name: f.name,
    format: String(f.format ?? ''),
  }))

/**
 * What the reader asked for, as the payload will state it — or a 400.
 *
 * Returned rather than thrown so the route can refuse before the stream opens: an
 * error must never arrive as an event inside a 200.
 */
function askRequested(body) {
  const citations = body.citations ?? DEFAULT_CITATIONS
  if (!CITATION_OPTIONS.some((o) => o.value === citations)) {
    return { error: `citations must be one of: ${CITATION_OPTIONS.map((o) => o.value).join(', ')}` }
  }
  const asked = body.formats === undefined ? [] : body.formats
  if (!Array.isArray(asked)) {
    return { error: 'formats must be an array of format_id' }
  }
  const pool = askAnswerFormats()
  const unknown = asked.filter((id) => !pool.some((f) => f.format_id === id))
  if (unknown.length > 0) {
    return {
      error: `unknown answer format(s): ${unknown.join(', ')} — this graph offers ${pool
        .map((f) => f.format_id)
        .join(', ')}`,
    }
  }
  return { citations, formats: pool.filter((f) => asked.includes(f.format_id)) }
}

/**
 * Whether the answer met what was asked of it — **computed, never asserted**.
 *
 * Citations are the half that really applies: required plus an answer carrying none is
 * a fact this can check, and it says so rather than passing the answer off as
 * compliant. The render format is **stated, not applied** — a recorded answer holds
 * the blocks the tenant wrote, and claiming they were rendered to order would be a
 * claim the screen underneath disproves. Same two-gate honesty as a report's audience
 * versus its data scope.
 */
function askRequirements(requested, citations, answered) {
  const cited = citations.length
  const satisfied = requested.citations !== 'required' || cited > 0

  const citationNote =
    requested.citations === 'required'
      ? cited > 0
        ? `Citations required — ${cited} attached, one per claim this answer rests on.`
        : answered
          ? 'Citations required, and this answer carries none: nothing on the route names a source.'
          : 'Citations required, but nothing was answered, so there is nothing to cite.'
      : `Citations optional — ${cited} attached.`

  const formatNote =
    requested.formats.length > 0
      ? ` Requested render: ${requested.formats
          .map((f) => f.name)
          .join(', ')} — stated, not applied: an answer renders as the blocks it holds.`
      : ''

  return {
    citations: requested.citations,
    formats: requested.formats,
    satisfied,
    note: `${citationNote}${formatNote}`,
  }
}

function askAnswer(useCase, question, requested = { citations: DEFAULT_CITATIONS, formats: [] }) {
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
        requirements: askRequirements(requested, citations, false),
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
      requirements: askRequirements(requested, citations, true),
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
      requirements: askRequirements(requested, [], false),
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
          /* The reader's own requirement for *this* question, not a promise the brief
             made about every answer: step 6 no longer exists and the use case declares
             nothing here. */
          `${citations.length} citation(s); citations are ${requested.citations} for this question.`,
      },
    ],
    citations,
    requirements: askRequirements(requested, citations, true),
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
  gap_decisions: normalizeGapDecisions(u.gap_decisions),
  /*
   * Clamped, because the step list got shorter. A brief saved on the old 'Answer
   * requirements' (6) or 'Entities & relationships' (7) opens on the new last step —
   * every answer it holds is still there, and the alternative is a stepper pointing at
   * a step that does not exist. `citations` and `answer_formats` may still sit on an
   * older record in db.json; they are simply not read, and the next save drops them.
   */
  step: Math.min(Math.max(Number(u.step ?? 1), 1), WIZARD_STEPS.length),
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


/* ---------------- The What-if lens ----------------
 *
 * A read-only overlay on the graph: it admits a candidate load *hypothetically* and
 * reports what that load would make the facility inherit. Nothing here writes to the
 * graph, and the saved library holds generator ids rather than figures — which is what
 * lets a saved scenario stay true as the graph changes.
 */

/**
 * The saved library, in memory. Lost on restart, like a registered source.
 *
 * **An entry is a whole scenario, not a column.** It carries the frame — the measures
 * being watched and the pool a case may draw from — plus its cases, and a case is
 * `{ name, generator_id }`: the admitted load and nothing else. That is the publishable
 * object, and the reason it is: a figure without its frame (what was watched, which
 * pool it was drawn from) is a number without a question, so a case cannot be shared on
 * its own. No entry ever holds a computed measure; `POST /whatif/scenario` derives those
 * on every read, which is what keeps a scenario true as the graph changes.
 */
const whatifSaved = liveContainer('whatifSaved')
let whatifSavedSeq = 1

/**
 * Who a scenario can be published to: the tenant's own users, with their persona.
 *
 * Served rather than written into the dialog, for the reason the report Share picker
 * reads `GET /auth/roles` and the consent screen renders the scopes the endpoint
 * returned — a directory held by the client is a second answer to "who exists", and it
 * can offer a reader this endpoint then refuses. `access_note` rides along because the
 * dialog *states* what a reader's persona may see; it does not filter anything, and the
 * copy beside it says so.
 */
const whatifReaders = () =>
  settings.users.map((u) => {
    const role = db.auth_roles.find((r) => r.role_id === u.role_id)
    return {
      email: u.email,
      name: u.name,
      role_id: u.role_id,
      role_label: role?.label ?? u.role_id,
      access_note: role?.access_note ?? '',
    }
  })

const WHATIF_OPS = {
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>=': (a, b) => a >= b,
}

/** The generators a pool admits. A pool with no filter is every generator. */
const whatifPool = (poolKey) => {
  const pool = db.whatif.candidate_pools.find((p) => p.key === poolKey)
  if (!pool || pool.filter === null) return db.whatif.generators
  const op = WHATIF_OPS[pool.filter.op]
  return db.whatif.generators.filter((g) => op(g[pool.filter.field], pool.filter.value))
}

/**
 * A figure, printed the way the package says to print it.
 *
 * The formats are data (`{v}`, `${v/1000}k`, `{v?yes:no}`) because the prototype's
 * formatting closures were re-expressed declaratively — so this reads the template
 * rather than carrying a second opinion about how a penalty is written. An unknown
 * format prints the raw value rather than throwing: `validateDb` already refuses a
 * measure naming one that does not exist, so reaching here means the document changed
 * under a running process, and a raw number is more use than a crash.
 */
function whatifFormat(value, format) {
  if (format === 'currency_k') return `$${Math.round(Number(value) / 1000)}k`
  if (format === 'boolean_yesno') return value ? 'yes' : 'no'
  return String(value)
}

/** The frame every scenario is judged inside. */
const whatifFrame = () => ({
  facility: db.whatif.facility,
  generators: db.whatif.generators,
  transporters: db.whatif.transporters,
  watched_measures: db.whatif.watched_measures,
  /* Each pool carries its own count, so an empty pool reads as "nobody qualifies"
     rather than as a dropdown that failed to populate. */
  candidate_pools: db.whatif.candidate_pools.map((p) => ({
    ...p,
    count: whatifPool(p.key).length,
  })),
  formats: db.whatif.formats,
  /* One row per pool, computed at ingest and keyed by the pool it belongs to — an
     array rather than a map so a missing pool is a short list rather than an undefined
     lookup. `room: null` where nothing in the pool carries enforcement: there is no
     break point to state, and dividing by zero would print "unlimited headroom", the
     opposite of what an empty carrying set means. */
  headroom: db.whatif.candidate_pools.map((p) => ({
    pool: p.key,
    ...db.whatif.headroom[p.key],
  })),
  copy: db.whatif.copy,
  state_defaults: db.whatif.state_defaults,
  authoring: db.whatif.authoring,
  runtime: db.whatif.runtime,
  graph_reference: db.whatif.graph_reference,
  publishing: db.whatif.publishing,
  /* The two pools the publish dialog picks from, both the app's own. Readers are the
     tenant's users; the graphs are the ones actually published — the lens already only
     opens when one is, so this list is never empty on this branch. */
  readers: whatifReaders(),
  graphs: reportGraphs(),
})

/**
 * What admitting one load would inherit.
 *
 * Every measure reports three things and they are different questions: `inherited` is
 * what this load brings, `baseline` is what the facility already carries, and `value`
 * is the sum — the figure that gets judged against the appetite line. A measure with
 * no baseline (a consent decree is not something a facility has a running count of)
 * reports the load's own value and says its baseline is null rather than printing 0,
 * because 0 would be a claim.
 */
function whatifScenario(generator, watchKeys) {
  const { facility } = db.whatif
  const measures = db.whatif.watched_measures
    .filter((m) => watchKeys.includes(m.key))
    .map((m) => {
      const inherited = generator[m.field]
      const baseline = m.baseline_field === null ? null : facility.baseline[m.baseline_field]
      /* Summed only where a baseline exists. A boolean measure has nothing to add to. */
      const value = baseline === null ? inherited : baseline + inherited
      const appetite =
        m.appetite_field === null ? null : facility.appetite[m.appetite_field]
      const breached =
        m.breach === null
          ? false
          : WHATIF_OPS[m.breach.op](value, facility.appetite[m.breach.against.slice('appetite.'.length)])
      return {
        key: m.key,
        label: m.label,
        source: m.source,
        grounds: m.grounds,
        unit: m.unit,
        value,
        value_text: whatifFormat(value, m.format),
        inherited,
        inherited_text: whatifFormat(inherited, m.format),
        baseline,
        baseline_text: baseline === null ? null : whatifFormat(baseline, m.format),
        appetite,
        breached,
        /* Whether this load moved the figure at all. A load that changes nothing is a
           real answer and reads better than a "▲ +0". */
        moved: m.format === 'boolean_yesno' ? Boolean(inherited) : Number(inherited) > 0,
      }
    })

  /*
   * The source lines, filled from the package's templates. Every figure on the card
   * cites the federal source it came from — "no value is invented" is the promise, and
   * a citation the reader cannot see is not one.
   */
  const filled = db.whatif.runtime.sources.map((s) => {
    const line = s.line
      .replaceAll('{transporter}', generator.transporter)
      .replaceAll('{manifests}', String(generator.manifests))
      .replaceAll('{tons}', String(Math.round(generator.tons)))
      .replaceAll('{id}', generator.id)
      .replaceAll('{evaluations}', String(generator.evaluations))
      .replaceAll('{violations}', String(generator.violations))
      .replaceAll('{enforcement}', String(generator.enforcement))
      .replaceAll('{last_enforcement}', generator.last_enforcement)
      .replaceAll('{name}', generator.name)
    /* ECHO's template carries both readings separated by "|" — the enforcement line and
       the no-enforcement line — because whether a generator has public enforcement is
       exactly what that source answers. */
    const [withEnf, withoutEnf] = line.split('  |  ')
    return {
      key: s.key,
      label: s.label,
      line:
        s.key === 'ECHO'
          ? generator.enforcement > 0
            ? withEnf
            : (withoutEnf ?? withEnf)
          : line,
      // The document source only applies where a decree was actually extracted.
      applies: s.key === 'DOC' ? Boolean(generator.consent_decree) : true,
    }
  })

  const flagged =
    generator.violations > 0 || generator.enforcement > 0 || Boolean(generator.consent_decree)

  return {
    generator,
    measures,
    sources: filled.filter((s) => s.applies),
    /* Nothing connects to this load, said plainly. The alternative — an empty trace
       panel — reads as "not checked" rather than "checked, and clean". */
    flagged,
    clean_note: flagged ? null : db.whatif.runtime.scenario_card.clean_note,
    /* What the scenario cannot see. Stated rather than hidden, so a reader does not
       take these figures for the whole picture. */
    residual_note: db.whatif.runtime.scenario_card.residual_note,
    /* The subgraph this load traverses — drawn on the card. Built from what the
       generator actually carries, so a clean load draws no enforcement node. */
    subgraph: whatifSubgraph(generator),
  }
}

/**
 * The sub-graph one admitted load traverses, as something drawable.
 *
 * **Its shape is the package's, not this file's.** `graph_reference.scenario_subgraph`
 * states the traversal in prose — "Evaluations —EVALUATION_OF→ Generator, Violations
 * —FOUND_IN→ Evaluations, Enforcement —ENFORCEMENT_AGAINST→ Generator (if any)" — and
 * `graph_reference.relationships` is the list of edge names the graph has. Every edge below
 * takes its label from that list rather than from a string typed here, so a diagram cannot
 * name a relationship the graph does not have; `check-docs` asserts the subset.
 *
 * The node's **count** is separate from its label so the drawing can put the figure inside
 * the circle and the type beside it. It used to be baked into one string ("14 evaluations"),
 * which a chain could print and a diagram could not.
 *
 * Built from what the generator actually carries: a clean load draws no enforcement node,
 * and one under no decree draws no document. An absence has no circle — the same rule the
 * studio canvas follows for a relationship nobody proposed.
 */
function whatifSubgraph(generator) {
  const rel = (name) =>
    db.whatif.graph_reference.relationships.includes(name) ? name : null
  const hasEnforcement = generator.enforcement > 0
  const hasViolations = generator.violations > 0

  return {
    nodes: [
      {
        key: 'evaluation',
        label: 'Evaluations',
        count: generator.evaluations,
        risk: null,
      },
      ...(hasViolations
        ? [{ key: 'violation', label: 'Violations', count: generator.violations, risk: null }]
        : []),
      ...(hasEnforcement
        ? [
            {
              key: 'enforcement',
              label: 'Enforcement',
              count: generator.enforcement,
              risk: null,
            },
          ]
        : []),
      ...(generator.consent_decree
        ? [{ key: 'document', label: 'Consent decree', count: null, risk: null }]
        : []),
      { key: 'generator', label: generator.name, count: null, risk: generator.risk },
      { key: 'facility', label: db.whatif.facility.name, count: null, risk: null },
    ],
    edges: [
      ...(hasViolations ? [{ from: 'violation', to: 'evaluation', label: rel('FOUND_IN') }] : []),
      { from: 'evaluation', to: 'generator', label: rel('EVALUATION_OF') },
      ...(hasEnforcement
        ? [{ from: 'enforcement', to: 'generator', label: rel('ENFORCEMENT_AGAINST') }]
        : []),
      ...(generator.consent_decree
        ? [{ from: 'document', to: 'generator', label: rel('DESCRIBED_BY') }]
        : []),
      { from: 'generator', to: 'facility', label: rel('SHIPS_TO') },
    ].filter((e) => e.label !== null),
    relationships: db.whatif.graph_reference.relationships,
  }
}

/* ---------------- Reports ----------------
 *
 * Five written reports over four rosters, from "npm run ingest:reports".
 *
 * **A report is a question asked of the data, not a stored table** — its own lead note
 * says so — so nothing here is a saved result. `db.reports` holds the rosters, the
 * report's authored copy (heading, subtitle, tiles, footer, all extracted from the
 * package's rendered HTML) and the *definition* of each block; every figure a block
 * shows is computed on this side of the wire, on every request. A page that summed a
 * column itself would be a second source for the number, which is the rule the What-if
 * headroom already follows.
 *
 * A report's scope is part of its question. Four of the five ask about every inbound
 * generator; the consent-decree report asks about the four under a decree, and its
 * scope is applied here rather than baked into a copy of the roster — so the report and
 * the register it draws from cannot drift.
 */
const REPORT_SCOPES = {
  all: (rows) => rows,
  cd: (rows) => rows.filter((r) => r.cd === true),
  enf: (rows) => rows.filter((r) => r.enf > 0),
  oos: (rows) => rows.filter((r) => r.state !== 'TX'),
  /*
   * CAPEX's own scope id, and it really does mean every row: its three report definitions are written
   * against the whole 60-project register, and the *masking* its personas differ by is a data-scope
   * matter rather than a row filter. Named here rather than rewritten to `all` in the document, because
   * the document is generated (`_meta` says so) and a value edited on this side would be overwritten by
   * its next rebuild — so the server learns the name instead.
   *
   * A scope this map does not know **stops the boot** rather than silently selecting nothing, which is
   * how CAPEX's arrival was caught: a report whose scope quietly returned no rows would have rendered
   * as an empty register, which reads as a dataset with no projects.
   */
  sc_author_all: (rows) => rows,
}

/**
 * Which column names a row on each spine — a bar with no label is not a bar.
 *
 * Every dataset's spines live in this one map. CAPEX's spine is `projects` and its label column is `n`,
 * which is the project name; the abbreviation is the generated document's, not a choice made here.
 */
const REPORT_LABEL_KEY = {
  generators: 'generator',
  facilities: 'facility',
  quarters: 'quarter',
  traces: 'mtn',
  projects: 'n',
}

/*
 * Headers for the three rosters the package's field dictionary does not describe.
 *
 * `reports.fields` describes the *generator* register — that is what the authoring tool
 * filters and tabulates — so a facility's `last_eval` or a trace's `mtn` has no label
 * in the data. These are headers for those columns and nothing more: no figure, no
 * claim, and `check-docs` fails if a column reaches a table with neither a field label
 * nor an entry here, because the alternative is a header reading `gen_state`.
 */
const REPORT_LABELS = {
  facility: 'Facility',
  role: 'Role',
  last_eval: 'Last evaluation',
  quarter: 'Quarter',
  rej: 'Rejected loads',
  res: 'Residue manifests',
  mtn: 'Manifest tracking number',
  gen_state: 'Generator state',
  shipped: 'Shipped',
  received: 'Received',
  days: 'Days in possession',
  transporters: 'Custody chain',
  residue: 'Residue',
  rejected: 'Rejected',
  status: 'Status',
}

/*
 * A report is asked of the **published** graph, so the section is gated on one existing
 * — the same precondition as Ask, and for the same reason: a figure attributed to a
 * graph nobody has published is a figure from nowhere. `publishedVersion` lives in
 * memory, so a restart takes the section back to its gate until something is published
 * again; that is already true of Ask and is not worth a second mechanism.
 */
const publishedGraphs = () =>
  builtGraphs()
    .map((useCase) => ({ useCase, published: publishedVersion(useCase.use_case_id) }))
    .filter((row) => row.published !== null)
    /* Newest build first, by the same field Ask sorts its list on (`created_at`, the
       build that produced the version). Publishing flips a pointer and mints no date. */
    .sort((a, b) => Date.parse(b.published.created_at ?? 0) - Date.parse(a.published.created_at ?? 0))

/**
 * Every published graph a report can be asked of, newest build first.
 *
 * Plural, because the reader chooses: the authoring wizard opens on this list, and a
 * question is asked *of* one of them. `published_by` is the same field Ask reports and
 * has the same caveat — it is the seeded account, not the signed-in user, because
 * publishing is not told who did it.
 */
const reportGraphs = () =>
  publishedGraphs().map(({ useCase, published }) => ({
    use_case_id: useCase.use_case_id,
    name: useCase.name,
    domain_id: useCase.domain_id ?? null,
    version: published.config_version,
    sha256: published.sha256,
    /* The build that produced the live content. Publishing does not mint a date of its
       own, so none is invented here. */
    built_at: published.created_at ?? null,
    published_by: publishedByFor(useCase.use_case_id),
    entity_count: published.entities ?? null,
    relationship_count: published.relationships ?? null,
  }))

/** The default: the most recently published graph. Null before anything is published. */
const reportGraph = () => reportGraphs()[0] ?? null

/**
 * The graph a saved report names, whether or not it is still published.
 *
 * A saved report holds a `use_case_id`, and publication lives in memory — so a row saved
 * before a restart names a graph that is no longer live. That is reported rather than
 * hidden: the figures still compute (they come from the rosters), but the report says the
 * content it was asked of is not published now, which is a different claim from being
 * unable to answer.
 */
const reportGraphFor = (useCaseId) => {
  if (!useCaseId) return null
  const live = reportGraphs().find((g) => g.use_case_id === useCaseId)
  if (live) return { ...live, live: true }
  const useCase = db.graph_use_cases.find((u) => u.use_case_id === useCaseId)
  if (!useCase) return null
  return {
    use_case_id: useCase.use_case_id,
    name: useCase.name,
    domain_id: useCase.domain_id ?? null,
    /* A brief carries no version of its own — versions belong to builds — so a graph nobody
       published reports null rather than a number that names nothing. */
    version: null,
    sha256: null,
    built_at: null,
    published_by: null,
    entity_count: null,
    relationship_count: null,
    live: false,
  }
}

/** The counts the two empty states need: "publish one" and "finish one" differ. */
const reportGraphCounts = () => ({
  published_count: publishedGraphs().length,
  built_count: builtGraphs().length,
  draft_count: db.graph_use_cases.length - builtGraphs().length,
})

const reportField = (key) => db.reports.fields.find((f) => f.key === key)
const reportLabel = (key) => reportField(key)?.label ?? REPORT_LABELS[key] ?? key
/** `kind` decides alignment, so it is read from the dictionary before the value. */
const reportKind = (key, rows) =>
  reportField(key)?.kind ?? (typeof rows[0]?.[key] === 'number' ? 'num' : 'cat')
const reportColumns = (keys, rows) =>
  keys.map((key) => ({ key, label: reportLabel(key), kind: reportKind(key, rows) }))

/**
 * The rows a report is about: its spine, narrowed by its own scope.
 *
 * A frame built by the authoring wizard passes its own already-filtered `rows`, so every
 * block, chart and count below derives from one row list rather than each recomputing a
 * filter and risking a different answer to "how many are in view".
 */
const reportRows = (report) =>
  report.rows ?? REPORT_SCOPES[report.scope](db.reports.data[report.spine])

/**
 * A part-to-whole share over the register, as a ring.
 *
 * The consent-decree report's second chart: what proportion of *all* inbound tonnage comes
 * from generators carrying an open violation. Computed over the whole register rather than the
 * report's own scope, because that is the claim — the tile beside it reads 79.3% **of total
 * inbound**, and a share of four generators' tonnage would be a different number wearing the
 * same label.
 *
 * Two slices, each directly labelled, so the ring's colours name a category the legend
 * repeats. Only built where the split is real: with nothing on one side there is no share to
 * draw, and a full ring is not a comparison.
 */
function reportShareChart(field, title, note) {
  const rows = registerRows()
  const carrying = rows.filter((r) => Number(r.viols) > 0)
  const clean = rows.filter((r) => Number(r.viols) === 0)
  const sum = (set) => set.reduce((t, r) => t + Number(r[field] ?? 0), 0)
  if (carrying.length === 0 || clean.length === 0) return null
  return {
    type: 'chart',
    chart: 'donut',
    title,
    width: 420,
    x_label: 'Compliance status',
    y_label: reportLabel(field),
    series: null,
    data: [
      { label: 'From open-violation generators', value: sum(carrying), tone: null, values: null },
      { label: 'From clean-record generators', value: sum(clean), tone: null, values: null },
    ],
    note,
  }
}

/**
 * Two measures over the same rows, as one grouped chart.
 *
 * The package's scorecard draws evaluations and violations **side by side per facility**, and
 * that pairing *is* the comparison — two separate charts make it two findings a reader has to
 * hold in their head at once. Two hues here encode two *series* rather than two values of one
 * measure, and the legend names both, which is the case a categorical palette exists for.
 *
 * **Roster order, not ranked.** A scorecard's subject leads and its comparators follow;
 * sorting by size would bury the facility the report is about wherever its number happens to
 * fall.
 */
function reportGroupedChart(report, keys, title) {
  const rows = reportRows(report)
  const labelKey = REPORT_LABEL_KEY[report.spine]
  return {
    type: 'chart',
    chart: 'grouped',
    title,
    width: 900,
    x_label: reportLabel(labelKey),
    y_label: null,
    series: keys.map((key) => ({ key, label: reportLabel(key) })),
    data: rows.map((r) => ({
      label: String(r[labelKey]),
      /* One value per series, keyed by its measure, so a point cannot lose which is which.
         `value` stays as the first series so anything reading a flat chart still reads one. */
      values: Object.fromEntries(keys.map((key) => [key, Number(r[key] ?? 0)])),
      value: Number(r[keys[0]] ?? 0),
      tone: null,
    })),
    note: null,
  }
}

/**
 * One chart, in the shape the page's chart component already takes.
 *
 * Rows carrying nothing are dropped rather than drawn as zero-length bars, and the
 * count that was dropped is reported in the note: 22 of the 36 generators have never
 * been penalised, and 22 empty bars would say the chart is broken rather than that the
 * register is mostly clean. **No cap, and no silent one** — a report that showed a top
 * ten would have to say so, so it shows all of them.
 */
function reportChart(report, measure, title, form = 'bar') {
  const rows = reportRows(report)
  const labelKey = REPORT_LABEL_KEY[report.spine]
  const carrying = rows.filter((r) => Number(r[measure]) > 0)
  const ordered =
    form === 'line'
      ? /* A trend keeps the roster's order: quarters are already chronological, and
           sorting them by size would make a line meaningless. */
        rows
      : [...carrying].sort((a, b) => Number(b[measure]) - Number(a[measure]))
  const dropped = form === 'line' ? 0 : rows.length - carrying.length

  return {
    type: 'chart',
    chart: form,
    title,
    x_label: reportLabel(labelKey),
    y_label: reportLabel(measure),
    data: ordered.map((r) => ({
      label: String(r[labelKey]),
      value: Number(r[measure]),
      /*
       * The row's risk tier, where the roster carries one. The package's register colours its
       * bars by tier and says so in the caption; a tier is a *state*, so it is the one thing
       * that may vary a magnitude chart's hue — length still encodes the value, and the table
       * beside it repeats the tier as a tag with an icon and a word.
       */
      tone: r.risk === 'high' ? 'crit' : r.risk === 'med' ? 'warn' : r.risk === 'low' ? 'good' : null,
    })),
    /* Wider than an answer's chart: a report card is the page's full width, and a 520-unit
       drawing centred in it left half the card empty. The viewBox grows rather than the cap
       being lifted, so the text stays the size it was drawn at. */
    width: 900,
    note:
      dropped > 0
        ? /* Named by the spine, not by the tenant's own "inbound generators" — that
             phrase is true of the register and false of the facility scorecard, and
             "4 of 5 inbound generators" would be a wrong sentence about facilities. */
          `${ordered.length} of ${rows.length} ` +
          `${report.spine === 'generators' ? db.reports.meta.entity_plural : report.spine} carry ` +
          `${reportLabel(measure).toLowerCase()} on record; the other ${dropped} are at zero.`
        : null,
  }
}

/** A block's definition plus everything it displays, computed now. */
function reportBlock(report, block) {
  const rows = reportRows(report)

  if (block.type === 'chart') {
    /*
     * `chartType` in the package is `bar` or `column`. A long axis of generator names is
     * unreadable vertically, so a wide register is drawn as horizontal bars whatever it asks
     * for — but a **narrowed** one is short enough for columns, which is how the package draws
     * its four decree-bound generators, and the block's own preference decides it there.
     */
    const rows = reportRows(report)
    /*
     * **Few rows are columns; a long register is bars.** The authoring block states a
     * preference (`chartType`), and the package's own rendered reports do not always follow
     * it — Report 5 asks for `bar` and draws four vertical columns. The readable form is the
     * one that decides, which is the rule the chart component states for itself: a name elides
     * to fit under four columns and thirty-six of them is what horizontal bars are for.
     */
    const form = rows.length <= 6 ? 'column' : 'bar'
    const main = reportChart(report, block.measure, block.title, form)
    /*
     * The share beside it, where the report is about a subset: "how much of the whole is
     * this?" is the question a scoped report raises and cannot answer from its own rows. Only
     * on the generator register, which is the roster the split is defined over.
     */
    const share =
      report.scope !== 'all' && report.spine === 'generators'
        ? reportShareChart(
            block.measure,
            `Inbound ${reportLabel(block.measure).toLowerCase()} by generator compliance status`,
            'Share of the whole register, not of this report’s rows — the question a scoped report raises.',
          )
        : null
    return share ? { ...main, companion: share } : main
  }

  if (block.type === 'table') {
    const sortKey = block.cols.includes(report.measure) ? report.measure : null
    const ordered = sortKey
      ? [...rows].sort((a, b) => Number(b[sortKey]) - Number(a[sortKey]))
      : rows
    return {
      type: 'table',
      title: block.title,
      columns: reportColumns(block.cols, rows),
      rows: ordered,
      /* What the order means. A ranked table whose ranking is unstated invites the
         reader to assume the roster's order is significant. */
      sorted_by: sortKey ? reportLabel(sortKey) : null,
    }
  }

  if (block.type === 'facilities') {
    /*
     * The scorecard. The package drew evaluations and violations as one grouped bar
     * chart; here they are two single-series charts, because one hue per magnitude is
     * the rule the chart component keeps and a grouped form would be a second encoding
     * it does not have. The comparison survives — same rows, same order.
     */
    const keys = Object.keys(rows[0])
    return {
      type: 'facilities',
      title: block.title,
      columns: reportColumns(keys, rows),
      rows,
      /* The facility the report is *about*, so its row can be marked. Computed at
         ingest from the roster's roles and checked to be exactly one. */
      subject: report.subject ?? null,
      /* One grouped chart where both measures are present — the pairing is the point — and a
         single-series chart where only one is. */
      charts: (() => {
        const pair = ['evals', 'viols'].filter((key) => keys.includes(key))
        if (pair.length > 1) {
          const title = `${pair.map((key) => reportLabel(key)).join(' & ')} by facility`
          return [reportGroupedChart(report, pair, title)]
        }
        return pair.map((key) => reportChart(report, key, `${reportLabel(key)} by facility`))
      })(),
    }
  }

  if (block.type === 'quarterly') {
    return {
      type: 'quarterly',
      title: block.title,
      columns: reportColumns(Object.keys(rows[0]), rows),
      rows,
      /*
       * Two charts, as the package's quarterly report draws them: the metric the block names,
       * as a trend, and the manifest count beside it. `column` rather than `bar` because a
       * quarter label is short and a trend reads left to right — the component picks the form
       * from the data's job, and this is the job.
       */
      charts: [
        reportChart(report, block.metric, `${reportLabel(block.metric)} by quarter`, 'line'),
        ...(block.metric !== 'manifests' && 'manifests' in (rows[0] ?? {})
          ? [reportChart(report, 'manifests', `${reportLabel('manifests')} by quarter`, 'column')]
          : []),
      ],
    }
  }

  /* Traces. Rendered as custody chains rather than a grid, because the chain is the
     finding: a manifest's transporters are ordered, and an order is not a cell. */
  return {
    type: 'traces',
    title: block.title,
    columns: reportColumns(Object.keys(rows[0]), rows),
    rows,
  }
}

/* ---------------- authoring: a report asked under other assumptions ----------------
 *
 * The five written reports are read under the assumptions they were written for. Asking
 * one under a *different* scope or filter produces a different report, and the authored
 * tiles no longer describe it — "With enforcement history 15 of 36" is a statement about
 * the whole register. So a generated report computes its summary from
 * `summary_catalog`, whose aggregations are declared as data at ingest precisely so this
 * side implements them once.
 */
const REPORT_AGGS = {
  rows: (rows) => rows.length,
  sum: (rows, field) => rows.reduce((t, r) => t + Number(r[field] ?? 0), 0),
  count_positive: (rows, field) => rows.filter((r) => Number(r[field]) > 0).length,
  count_true: (rows, field) => rows.filter((r) => r[field] === true).length,
  count_high: (rows, field) => rows.filter((r) => r[field] === 'high').length,
  count_out_of_state: (rows, field) => rows.filter((r) => r[field] !== 'TX').length,
}

/** The prototype's own formats: money rounded to the dollar, tonnage with a unit. */
const REPORT_FORMATS = {
  int: (v) => Math.round(v).toLocaleString('en-US'),
  money: (v) => `$${Math.round(v).toLocaleString('en-US')}`,
  tons: (v) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })} t`,
}

/** The summary a generated report states, computed over the rows actually in view. */
function reportSummary(keys, rows) {
  return keys
    .map((key) => db.reports.summary_catalog.find((t) => t.key === key))
    .filter(Boolean)
    .map((tile) => ({
      label: tile.label,
      value: REPORT_FORMATS[tile.format](REPORT_AGGS[tile.agg](rows, tile.field)),
      /* Computed over the frame, and it says so — these must never be mistaken for the
         package's authored figures, which describe the written report. */
      unit: 'computed for this frame',
      tone: tile.tone,
    }))
}

/**
 * The frame a question was asked under: a report, a scope, a ranking, a horizon, and
 * any facet filters.
 *
 * **The horizon is declared, not applied.** Nothing in these rosters is sliced by it —
 * the register is cumulative and the quarterly roster is the whole window the package
 * ships — so applying one would invent a filter, and stating one silently would claim a
 * filter that did not run. It is carried into the sentence and reported as a caveat.
 */
const REPORT_HORIZON_CAVEAT =
  'The time window is part of the question as stated, not a filter that ran: these ' +
  'rosters are cumulative — the register carries a generator’s whole federal history and ' +
  'the quarterly roster is the full 2023–2026 window. Every figure below is over all of it.'

/** A frame off the wire, with every field a string and the filter list an array. */
const reportFrameFrom = (body) => ({
  report_id: String(body.report_id ?? ''),
  use_case_id: body.use_case_id ? String(body.use_case_id) : null,
  scope: String(body.scope ?? ''),
  measure: String(body.measure ?? ''),
  horizon: String(body.horizon ?? ''),
  filters: Array.isArray(body.filters) ? body.filters : [],
})

const reportFrameProblem = (frame) => {
  const report = db.reports.reports.find((r) => r.report_id === frame.report_id)
  if (!report) {
    return `no report "${frame.report_id}" — this section has ${db.reports.reports
      .map((r) => r.report_id)
      .join(', ')}`
  }
  /*
   * A question is asked *of a published graph*, so the frame names one and it has to be
   * live. Refused rather than defaulted: silently answering against a different graph than
   * the one chosen would attribute the figures to content nobody picked.
   */
  if (frame.use_case_id) {
    const live = reportGraphs().some((g) => g.use_case_id === frame.use_case_id)
    if (!live) {
      const published = reportGraphs()
      return published.length === 0
        ? `no graph is published — publish one in Graph Studio, then ask it`
        : `"${frame.use_case_id}" is not a published graph — published: ${published
            .map((g) => g.use_case_id)
            .join(', ')}`
    }
  }
  for (const [slot, value] of Object.entries({
    scope: frame.scope,
    measure: frame.measure,
    horizon: frame.horizon,
  })) {
    if (!db.reports.opts[slot].options.some((o) => o.value === value)) {
      return `"${value}" is not one of the ${slot} options — pick one of ${db.reports.opts[
        slot
      ].options
        .map((o) => o.value)
        .join(', ')}`
    }
  }
  /*
   * A filter has to be one of the facets *this report's spine* offers. Checking only the
   * generator dictionary refused a facility's role and a quarter's year — facets the report
   * itself renders as chips — so this asks the same function the chips came from.
   */
  const facets = reportFacetsFor(report.spine)
  for (const filter of frame.filters ?? []) {
    const facet = facets.find((f) => f.key === filter.key)
    if (!facet) {
      return `"${filter.key}" cannot be filtered on for ${report.spine} — this report slices by ${
        facets.map((f) => f.key).join(', ') || 'nothing'
      }`
    }
    if (!facet.values.some((v) => v.value === String(filter.value))) {
      return `"${filter.value}" is not a ${filter.key} in this report — it has ${facet.values
        .map((v) => v.value)
        .join(', ')}`
    }
  }
  return null
}

/** A facet value as it reads on a chip: `cd` is a flag, `risk` a tier. */
const reportFacetLabel = (key, value) =>
  key === 'cd' ? (value === 'true' ? 'Yes' : 'No') : String(value)

/**
 * The rows a frame selects: its scope, then its facet filters.
 *
 * **Values on one facet are OR-ed; different facets are AND-ed.** Two `risk` filters mean "high or
 * medium", not "high and medium" — which is nothing, and is what a plain reduce over the list produced.
 * A chip bar that lets a reader pick High *and* Medium is the whole point of a multi-select facet, and it
 * was unexpressible until this grouped by key: `risk=high, risk=med, cd=true` reads as
 * "(high or medium) and under a decree", which is the only reading a reader could mean.
 *
 * One filter per key behaves exactly as it did, so a saved frame and an export are unaffected.
 */
function reportFrameRows(report, frame) {
  const scoped = REPORT_SCOPES[frame.scope](db.reports.data[report.spine])

  /* Grouped rather than reduced one filter at a time — see the note above. */
  const byKey = new Map()
  for (const filter of frame.filters ?? []) {
    const key = String(filter.key)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(String(filter.value))
  }

  let rows = scoped
  for (const [key, values] of byKey) {
    /* `flag` is one control over three columns, so it filters by test rather than by
       equality — the only facet whose value is not a column of its own. */
    if (key === 'flag') {
      const tests = values.map((v) => REPORT_FLAG_TESTS[v]).filter(Boolean)
      if (tests.length > 0) rows = rows.filter((r) => tests.some((test) => test(r)))
      continue
    }
    rows = rows.filter((r) => values.includes(String(r[key])))
  }
  return rows
}

/**
 * A report built from a frame.
 *
 * Two outcomes, and the payload says which. When the frame matches what the report was
 * written for, this *is* the written report — the authored tiles and all, because
 * nothing about the question changed. Otherwise it is **generated**: the summary is
 * recomputed over the rows in view and labelled as such, so the tenant's authored
 * figures are never shown against a frame they do not describe.
 *
 * The horizon is not part of that decision, because it filters nothing (see the caveat).
 */
/*
 * The report as this frame asks for it.
 *
 * One object, and everything downstream reads its figures and its labels off it —
 * `reportView`, `reportBlock` and the reading sentence all take it — so a built report
 * cannot disagree with itself about what was asked.
 */
function reportFrameAsked(report, frame) {
  const label = (slot, value) =>
    db.reports.opts[slot].options.find((o) => o.value === value)?.label ?? null
  return {
    ...report,
    scope: frame.scope,
    measure: frame.measure,
    scope_label: label('scope', frame.scope) ?? report.scope_label,
    measure_label: label('measure', frame.measure) ?? report.measure_label,
    horizon_label: label('horizon', frame.horizon),
    /* The graph this frame was asked of, which is the reader's pick rather than whatever
       happens to be newest. */
    graph: reportGraphFor(frame.use_case_id) ?? reportGraph(),
    rows: reportFrameRows(report, frame),
  }
}

/** The sentence to check in step 2, and the chips that change it. Nothing is built. */
const reportBuildReading = (report, frame) => {
  const reading = reportReading(reportFrameAsked(report, frame))
  return { reading: reading.text, assumptions: reading.assumptions }
}

function reportBuild(report, frame) {
  const written =
    frame.scope === report.scope &&
    frame.measure === report.measure &&
    (frame.filters ?? []).length === 0
  const asked = { ...reportFrameAsked(report, frame), applied_filters: frame.filters ?? [] }

  return {
    ...reportView(asked),
    variant: written ? 'written' : 'generated',
    /* Filters narrow the rows a *generated* report shows; a written one has none by
       definition, which is what `written` above checks. */
    filters: (frame.filters ?? []).map((f) => ({
      key: f.key,
      label: reportLabel(f.key),
      value: String(f.value),
      value_label: reportFacetLabel(f.key, f.value),
    })),
    tiles: written
      ? report.tiles
      : reportSummary(
          report.summary_keys.length > 0 ? report.summary_keys : db.reports.summary_default,
          asked.rows,
        ),
    /*
     * A generated report has no authored tiles to show, and on a spine the summary
     * Catalog does not describe (facilities, quarters, traces) it has no summary at
     * all — said plainly rather than left as an empty strip.
     */
    summary_note:
      written || report.spine === 'generators'
        ? null
        : `This summary is only defined for the ${db.reports.meta.entity_plural} register, so a re-asked ${report.spine} report states none.`,
    caveats: [
      REPORT_HORIZON_CAVEAT,
      /* A saved report whose graph is no longer published still computes — the figures
         come from the rosters — but it must not claim to have been asked of live content.
         Publication is in memory, so this is the state after every restart. */
      ...(asked.graph && asked.graph.live === false
        ? [
            `This was saved against ${asked.graph.name}, which is not published right now. ` +
              'The figures are current — they come from the connected rosters — but nothing ' +
              'live answered it. Publish that graph again in Graph Studio to restore the link.',
          ]
        : []),
    ],
  }
}

/**
 * Which report a typed question is asking for.
 *
 * Matched the way `matchAskAnswer` matches a recorded answer, at the same threshold and
 * with the same tie rule, so the two surfaces cannot disagree about whether a sentence
 * names something. **A miss is reported, not hidden**: the prototype routed every
 * unrecognised question to the generator register silently, which is a guess presented
 * as an understanding. Here the register is still the fallback — it is the only frame a
 * question about the inbound network can start from — but the read-back says the question
 * was not recognised, and the whole point of the Confirm step is that the reader fixes it
 * before anything is built.
 */
function reportMatch(question) {
  const asked = askTokens(question)
  const fallback = db.reports.reports[0]
  if (asked.length === 0) {
    return { report: fallback, matched: false, why: 'No words to match — start from a standard report or say more.' }
  }

  const normalise = (s) => askTokens(s).join(' ')
  const exact = db.reports.reports.find((r) => normalise(r.question) === asked.join(' '))
  if (exact) return { report: exact, matched: true, why: `This is ${exact.report_tag}’s own question.` }

  const scored = db.reports.reports
    .map((r) => {
      const own = new Set(askTokens(r.question))
      const shared = asked.filter((w) => own.has(w))
      return { report: r, score: shared.length / asked.length, shared }
    })
    .sort((x, y) => y.score - x.score)

  const [best, runnerUp] = scored
  if (best.score < ASK_MATCH_MIN || (runnerUp && runnerUp.score === best.score)) {
    return {
      report: fallback,
      matched: false,
      why:
        `That does not match one of the ${db.reports.reports.length} standard reports closely enough to be sure, ` +
        `so it is being read as ${fallback.report_tag} — the ${db.reports.meta.entity_plural} register. ` +
        'Change any underlined part below, or start from a standard report.',
    }
  }
  return {
    report: best.report,
    matched: true,
    why: `Read as ${best.report.report_tag} — it matches on ${best.shared.slice(0, 4).join(', ')}.`,
  }
}

/** The facets a generator report can be sliced by, with the values actually present. */
/*
 * What a report can be sliced by, per spine.
 *
 * **The generator register's facets are declared** — `slice_default` names them and
 * `fields.filterable` allows them. The other three rosters declare none, so theirs are
 * derived from the column that distinguishes their rows: a facility's role, a quarter's
 * year, a trace's flags. Every value carries the count of rows behind it, so an empty facet
 * reads as "none of these" rather than as a chip that failed to fill — and a facet with only
 * one value is dropped, because a filter that cannot change the answer is furniture.
 *
 * A chip re-asks the report with that filter rather than hiding rows locally: every figure
 * above the table is the server's, and a chart that kept the whole roster while the table
 * showed a slice would be two answers on one screen.
 */
const FACET_LABELS = { role: 'Role', year: 'Year', flag: 'Show' }

const reportFacetsFor = (spine) => {
  const rows = db.reports.data[spine] ?? []
  const facet = (key, label, values) => ({ key, label, values: values.filter((v) => v.count > 0) })
  const distinct = (pick) => [...new Set(rows.map(pick).map(String))].sort()

  if (spine === 'generators') {
    return db.reports.slice_default
      .map((key) => reportField(key))
      .filter((field) => field && field.filterable)
      .map((field) =>
        facet(
          field.key,
          field.label,
          distinct((g) => g[field.key]).map((value) => ({
            value,
            label: reportFacetLabel(field.key, value),
            count: rows.filter((g) => String(g[field.key]) === value).length,
          })),
        ),
      )
      .filter((f) => f.values.length > 1)
  }

  if (spine === 'facilities') {
    return [
      facet(
        'role',
        FACET_LABELS.role,
        distinct((f) => f.role).map((value) => ({
          value,
          label: value,
          count: rows.filter((f) => f.role === value).length,
        })),
      ),
    ].filter((f) => f.values.length > 1)
  }

  if (spine === 'quarters') {
    return [
      facet(
        'year',
        FACET_LABELS.year,
        distinct((q) => q.quarter.slice(0, 4)).map((value) => ({
          value,
          label: value,
          count: rows.filter((q) => q.quarter.startsWith(value)).length,
        })),
      ),
    ].filter((f) => f.values.length > 1)
  }

  if (spine === 'traces') {
    /* A trace's flags are three different columns, so this is one control over the three the
       package's own filter bar offers: rejected, residue, out-of-state. */
    const flags = [
      { value: 'rejected', label: 'Rejected', test: (t) => t.rejected === 'Y' },
      { value: 'residue', label: 'Residue', test: (t) => t.residue === 'Y' },
      { value: 'out_of_state', label: 'Out-of-state', test: (t) => t.gen_state !== 'TX' },
    ]
    return [
      facet(
        'flag',
        FACET_LABELS.flag,
        flags.map((f) => ({ value: f.value, label: f.label, count: rows.filter(f.test).length })),
      ),
    ].filter((f) => f.values.length > 0)
  }

  return []
}

/** The wizard's own facet set: the register's, because that is the spine it narrows. */
const reportFacets = () => reportFacetsFor('generators')

/** The flag filters, as row tests — the one facet whose value is not a column. */
const REPORT_FLAG_TESTS = {
  rejected: (t) => t.rejected === 'Y',
  residue: (t) => t.residue === 'Y',
  out_of_state: (t) => t.gen_state !== 'TX',
}

/** The reading sentence, with each slot filled by the assumption behind it. */
function reportReading(report) {
  const used = report.reading.slots.map((slot) => ({
    slot,
    label:
      slot === 'scope'
        ? report.scope_label
        : slot === 'measure'
          ? report.measure_label
          : /* A frame carries its own horizon; a written report is read under the
               file's default. Either way the sentence and the chips agree. */
            (report.horizon_label ?? db.reports.assumptions[slot].label),
  }))
  const text = used.reduce(
    (sentence, { slot, label }) => sentence.replaceAll(`{${slot}}`, label),
    report.reading.template,
  )
  return { text, assumptions: used }
}

/** Every role, or the ones a saved row names — resolved to `{ role_id, label }`. */
const reportViewerRoles = (saved) => {
  const all = db.auth_roles.map((r) => ({ role_id: r.role_id, label: r.label }))
  const ids = saved.viewer_roles
  if (!Array.isArray(ids) || ids.length === 0) return all
  return all.filter((r) => ids.includes(r.role_id))
}

/**
 * The roles a save may name, checked against the role pool.
 *
 * An empty list is refused rather than stored: it would hide the report from everyone,
 * including whoever set it, and "saved but invisible" is the same as deleted with extra steps.
 * An unknown id is refused naming the pool, because a role nobody can hold would silently
 * narrow the list to nothing.
 */
const reportViewerRolesProblem = (ids) => {
  if (ids === null || ids === undefined) return null
  if (!Array.isArray(ids) || ids.length === 0) {
    return `name at least one role — a report no role can view is a report you have deleted. Roles: ${db.auth_roles
      .map((r) => r.role_id)
      .join(', ')}`
  }
  const unknown = ids.filter((id) => !db.auth_roles.some((r) => r.role_id === id))
  if (unknown.length > 0) {
    return `no such role: ${unknown.join(', ')} — this tenant has ${db.auth_roles
      .map((r) => r.role_id)
      .join(', ')}`
  }
  return null
}

/** A saved question, with the labels its frame reads by now. */
const reportSavedView = (saved) => {
  const report = db.reports.reports.find((r) => r.report_id === saved.report_id)
  const label = (slot, value) =>
    db.reports.opts[slot].options.find((o) => o.value === value)?.label ?? value
  return {
    ...saved,
    report_tag: report?.report_tag ?? saved.report_id,
    heading: report?.heading ?? saved.report_id,
    /*
     * The graph it was asked of, and whether that content is still published. Publication
     * lives in memory, so a row saved before a restart names a graph that is no longer
     * live — reported rather than hidden, because "asked of a graph nobody has published
     * now" is a caveat on the figures, not a failure to produce them.
     */
    graph: reportGraphFor(saved.use_case_id),
    /* Who saved it: the browser's own signed-in identity, sent with the save. Unlike the
       graph's `published_by` — which is the seeded account, because publishing is never
       told who did it — this one really is the person who acted. */
    saved_by: saved.saved_by ?? null,
    /*
     * Which roles this report is meant for, resolved to their labels.
     *
     * **A demo control, and the copy says so.** The login authenticates by shape and the role
     * is client-held, so this cannot be access control — it narrows what the section *shows* a
     * reader with that role, which is what a demo of governed reporting needs, and the panel
     * that sets it states plainly that the API will still serve the report to anyone who asks.
     * Defaults to every role: a report nobody can see is a report that vanished.
     */
    viewer_roles: reportViewerRoles(saved),
    /*
     * Resolved on the way out, never stored. A saved question holds its frame and no
     * figures — re-open it next week and it is re-asked, which is the same rule the
     * What-if library follows for exactly the same reason.
     */
    scope_label: label('scope', saved.scope),
    measure_label: label('measure', saved.measure),
    horizon_label: label('horizon', saved.horizon),
    filters: (saved.filters ?? []).map((f) => ({
      key: f.key,
      label: reportLabel(f.key),
      value: String(f.value),
      value_label: reportFacetLabel(f.key, f.value),
    })),
  }
}

/** The section: what has been written, and what this dataset cannot answer. */
/*
 * The section's payload.
 *
 * **The persona is not in it.** `db.reports.meta` names the tenant persona these reports
 * were written for, and the section printed it as a strip above the grid until that was
 * removed — so it is not served here. It is still read server-side, where it is load-bearing:
 * `entity_plural` labels a computed summary tile and names the rows a chart dropped, and
 * `source_trace` is on every report. A payload field nothing renders is the kind of thing
 * that gets rendered later by accident.
 */
/*
 * The section, as a given role would see it.
 *
 * `asRole` is the browser's own signed-in role, sent on the request the way `as=` sends the
 * address. It narrows the saved list to the reports meant for that role — the demo of governed
 * reporting — and it is **not** a permission: the role is client-held, so anything asking the
 * API directly still gets every row. The panel that sets an audience says exactly that.
 */
/*
 * ---------------- the section's governance view ----------------
 *
 * The three tabs the report section renders — Library, Author, Operations & audience — are one
 * payload, computed here.
 *
 * **What is read and what is computed.** `db.reports.governance` holds the governance decisions
 * (a report's lifecycle state, its definition version, its author, its category, the as-of date
 * of the data it reads, its refresh schedule, its approval, and the personas its audience names)
 * because nothing in the package implies them. Everything else on those tabs is derived on every
 * request: the chip counts, the floor line, whether a report is parameterized, every entitlement
 * cell, the publish checks and the audit rows. A figure a component could compute is a second
 * source for it, and a governance grid is exactly where two sources become two answers.
 */
/*
 * A lifecycle state's label and its tone both come from `governance.statuses`, which is the one
 * place they are written. A second map here is how a state ends up tinted `warn` on a card and
 * `neutral` on the chip that counts it — two answers to what the state *is*, which is the whole
 * failure this section is built to avoid. `validateDb` refuses a report whose status is not in
 * that list, so the fallbacks below cannot be reached by seeded data.
 */
const reportState = (key) => db.reports.governance.statuses.find((s) => s.key === key) ?? null

const reportStatusLabel = (key) => reportState(key)?.label ?? key

const reportStatusTone = (key) => reportState(key)?.tone ?? 'neutral'

/*
 * One cell of gate 1.
 *
 * A cell answers "may this persona see that this report EXISTS", which is why a pending report
 * reads *entitled once published* rather than plain "entitled": the audience is decided, the
 * visibility is not. Both facts in one string, because a reviewer reading the grid is deciding
 * whether the audience is right, not whether the report is finished.
 */
const reportEntitlementCell = (governanceRow, roleId) => {
  if (!governanceRow.audience.includes(roleId)) {
    return { state: 'not_entitled', label: 'not entitled', tone: 'crit' }
  }
  if (governanceRow.status === 'published') {
    return { state: 'entitled_published', label: 'entitled - published', tone: 'good' }
  }
  if (governanceRow.status === 'pending_approval') {
    return {
      state: 'entitled_pending',
      label: 'entitled once published - awaiting approval',
      tone: 'warn',
    }
  }
  /*
   * Blocked needs its own cell, or it falls to the archived one below and reads "entitled -
   * archived, opens by link only" — which says the audience can open it. They cannot: it was never
   * published. The audience is decided and the report is going nowhere until the block clears.
   */
  if (governanceRow.status === 'blocked') {
    return {
      state: 'entitled_blocked',
      label: 'entitled once published - blocked, nothing to open',
      tone: 'crit',
    }
  }
  return {
    state: 'entitled_archived',
    label: 'entitled - archived, opens by link only',
    tone: 'neutral',
  }
}

/**
 * **The register this dataset governs, described by the dataset rather than assumed.**
 *
 * Five places read `db.reports.data.generators` directly, which is EPA's spine — and CAPEX has no such
 * roster, so every one of them threw `Cannot read properties of undefined (reading 'length')` and
 * `GET /governance` was a flat 400 for that dataset. A page that 400s reads as a broken server rather
 * than as a dataset the page has nothing to say about, which is the failure this repo refuses
 * everywhere else.
 *
 * **CAPEX already answers the question**: its document ships `reports.register` — the roster's key, its
 * identity column and its own field dictionary — which is exactly what these sites need and is why it
 * is read here rather than a second table being written. EPA ships none, so the defaults *are* EPA's
 * spine and its behaviour is unchanged to the byte.
 *
 * Under `both` the merged `register` is `primary`, so this resolves to the defaults — correct, because
 * every single-valued key under `both` comes from EPA, and the governed roster is one of them.
 */
const reportRegister = () => ({
  roster: db.reports.register?.roster ?? 'generators',
  identity: db.reports.register?.identity ?? 'generator',
  fields: db.reports.register?.fields ?? db.reports.fields,
})

/**
 * The register's rows, or an empty list.
 *
 * Empty rather than `undefined`: a dataset whose register this document does not carry has nothing to
 * govern, which every caller here already renders as "no rows" — where `undefined` is a crash. The
 * distinction matters because `?? 0`-style defaults are how "nobody has counted" becomes "zero", and an
 * empty roster genuinely is the answer for a dataset with no register.
 */
const registerRows = () => db.reports.data[reportRegister().roster] ?? []

/**
 * The floor under a report: the roster it reads and how much of it there is.
 *
 * Derived from the report's own spine rather than authored, so a report cannot claim a floor it
 * does not stand on. `row_count` is what its scope selects, `spine_total` the whole roster —
 * "4 of 36" is the difference between a scoped report and a register.
 */
const reportFloorLine = (report) => {
  const rows = reportRows(report).length
  const total = db.reports.data[report.spine].length
  const roster = REPORT_SCOPES[report.spine]?.label ?? report.spine
  return rows === total
    ? `floor set by the ${roster} of ${total} rows`
    : `floor set by ${rows} of ${total} rows in the ${roster}`
}

/*
 * The role the browser reports, ignored when it names nothing this tenant has.
 *
 * Read the same way on the section's GET and on all three writes, so a write cannot answer with a
 * view computed for a different reader than the one that asked. An unknown role falls back to "no
 * role", which sees every row — the safe direction for a control whose own copy calls it a demo.
 */
const reportRoleFrom = (query) => {
  const asRole = query.get('as_role')
  return asRole && db.auth_roles.some((r) => r.role_id === asRole) ? asRole : null
}

/** A report definition, as the Library card and the Operations tables read it. */
const reportGovernanceRow = (governanceRow) => {
  const report = db.reports.reports.find((r) => r.report_id === governanceRow.report_id)
  return {
    report_id: governanceRow.report_id,
    kind: 'written',
    report_tag: report.report_tag,
    title: report.heading,
    /* The question in the report's own words, and the paragraph the tenant wrote under it. Both
       are the report's own copy — the card quotes, it does not paraphrase. */
    question: report.question,
    lead: report.note ?? report.subtitle ?? '',
    status: governanceRow.status,
    status_label: reportStatusLabel(governanceRow.status),
    tone: reportStatusTone(governanceRow.status),
    version: governanceRow.version,
    author: governanceRow.author,
    category: governanceRow.category,
    as_of: governanceRow.as_of,
    schedule: governanceRow.schedule,
    approval: governanceRow.approval,
    note: governanceRow.note,
    floor: reportFloorLine(report),
    /* Derived: a report is parameterized exactly when its spine offers facets to slice by. */
    parameterized: reportFacetsFor(report.spine).length > 0,
    row_count: reportRows(report).length,
    spine_total: db.reports.data[report.spine].length,
    /* Private is an empty audience and says so as a fact, so the card need not infer it from a
       zero — "shared with nobody" and "we could not resolve anybody" are different things. */
    private: governanceRow.audience.length === 0,
    /* How many role ids the audience *names*, beside how many of them resolved. Equal is the
       invariant; unequal means a persona was renamed or removed under a live audience. */
    audience_named: governanceRow.audience.length,
    entitled_roles: governanceRow.audience
      .map((role_id) => {
        const role = db.auth_roles.find((r) => r.role_id === role_id)
        return role ? { role_id, label: role.label } : null
      })
      .filter(Boolean),
  }
}

/**
 * A composed report, in the same shape as a written one.
 *
 * The Library is one grid, so a saved row has to answer the same questions a written report
 * does — and every answer here is a fact the row already carries: who saved it stands in for the
 * author, its graph's version for the definition version, its audience for the entitlement. What
 * it cannot claim is an approval, and it says so with a null rather than a label.
 */
const reportSavedGovernanceRow = (saved) => {
  const view = reportSavedView(saved)
  const report = db.reports.reports.find((r) => r.report_id === saved.report_id)
  return {
    report_id: saved.saved_id,
    kind: 'saved',
    saved_id: saved.saved_id,
    report_tag: view.report_tag,
    title: saved.name,
    question: saved.question ?? report?.question ?? '',
    lead: report?.note ?? '',
    status: 'published',
    status_label: reportStatusLabel('published'),
    tone: 'good',
    version: view.graph?.version ?? null,
    author: view.saved_by,
    category: 'Composed',
    as_of: saved.saved_at ? String(saved.saved_at).slice(0, 10) : null,
    schedule: 'On demand',
    approval: null,
    note:
      view.graph && !view.graph.live
        ? 'Asked of a graph nobody has published now, so it re-asks against the current rosters and says so in its caveats.'
        : null,
    floor: report ? reportFloorLine(report) : null,
    parameterized: report ? reportFacetsFor(report.spine).length > 0 : false,
    row_count: report ? reportRows(report).length : 0,
    spine_total: report ? db.reports.data[report.spine].length : 0,
    private: view.viewer_roles.length === 0,
    /* A saved row's audience is already resolved on the way out of `reportSavedView`, so what it
       names and what resolved are the same list by construction. */
    audience_named: view.viewer_roles.length,
    entitled_roles: view.viewer_roles,
  }
}

/**
 * The whole governance view, as one persona sees it.
 *
 * `asRole` hides nothing here — the grid's point is that a reader can see how many definitions
 * exist that they are *not* entitled to, which is a governance fact rather than a leak. What it
 * does is report that number, so "6 entitled, 1 not listed" is computed rather than written.
 */
const reportGovernanceView = (asRole) => {
  /*
   * Nothing on a row depends on who is asking any more. A per-row `access` block did — whether the
   * calling role could open the report, and what it had requested — and it went with the
   * pending-approval state. `asRole` still resolves the viewer's own scope and still counts the
   * definitions it is *not* named on, which is a governance fact rather than a gate.
   */
  const written = db.reports.governance.reports.map(reportGovernanceRow)
  const saved = (db.reports.saved ?? []).map(reportSavedGovernanceRow)
  const rows = [...written, ...saved]

  const count = (key) =>
    key === 'current'
      ? rows.filter((r) => r.status !== 'archived').length
      : rows.filter((r) => r.status === key).length

  const entitledTo = (row) => !asRole || row.entitled_roles.some((r) => r.role_id === asRole)
  /* Resolved the same way gate 2's rows are, so one scope row cannot be labelled in one place
     and unlabelled in another. */
  const scopeRaw = db.reports.governance.data_scope.find((s) => s.role_id === asRole) ?? null
  const scopeRow = scopeRaw
    ? {
        ...scopeRaw,
        label: db.auth_roles.find((r) => r.role_id === scopeRaw.role_id)?.label ?? scopeRaw.role_id,
      }
    : null

  /*
   * **The definitions this tenant has that are not governed**, and how to get them back.
   *
   * A report lives in two places: `db.reports.reports` is the definition, ingested from the package,
   * and `db.reports.governance.reports` is the decision to govern it. Delete drops the second, and
   * the row then leaves the Library with nothing anywhere saying why — the list is simply shorter.
   * That reads as data loss, and it has sent two rounds of "Report N is missing" at a section whose
   * own file still holds it.
   *
   * So the gap is reported rather than left to be counted. It is computed, not stored, and it names
   * the command that fixes it — which is also the answer when the cause is a **stale process**: a
   * server that deleted a row before `db.json` was re-seeded keeps serving four from memory, and its
   * own payload now says which one it is short.
   */
  const ungoverned = db.reports.reports
    .filter((r) => !db.reports.governance.reports.some((g) => g.report_id === r.report_id))
    .map((r) => ({ report_id: r.report_id, report_tag: r.report_tag, title: r.heading }))

  return {
    reports: rows,
    ungoverned,
    /* Named here rather than assembled in the page, so one string says it everywhere. */
    restore: 'npm run seed:governance',
    /* The publish dialog's copy, authored by `npm run seed:governance`. */
    publishing: db.reports.governance.publishing,
    /*
     * **Who the publish dialog can pick.** The tenant's own users from `db.settings`, each
     * carrying the persona they sign in as and that persona's *declared* data scope — the same
     * `data_scope` row gate 2 renders, resolved here so one scope row cannot read one way in the
     * Operations grid and another beside somebody's name.
     *
     * A person is picked and their **role** is what gets stored: a report audience is
     * `viewer_roles`, and translating a person into an address would be a second audience model
     * beside the one the entitlement matrix and `?as_role=` already read.
     *
     * `scope` is stated, never applied. No roster in this section is filtered per persona, so a
     * count like "sees 32 of 36" would claim a filter that never ran — the note beside the list
     * says the preview is the rules' result, and the rules are the ones already on the reader.
     */
    people: settings.users.map((u) => {
      const role = db.auth_roles.find((r) => r.role_id === u.role_id)
      const scope = db.reports.governance.data_scope.find((s) => s.role_id === u.role_id)
      return {
        email: u.email,
        name: u.name,
        role_id: u.role_id,
        role_label: role?.label ?? u.role_id,
        scope: scope?.scope ?? null,
        masked: scope?.masked ?? null,
      }
    }),
    /* `current` leads and is not a stored state: published + pending is what a reader means. */
    statuses: [
      { key: 'current', label: 'All current', tone: 'neutral', count: count('current') },
      ...db.reports.governance.statuses.map((s) => ({ ...s, count: count(s.key) })),
    ],
    categories: [...new Set(rows.map((r) => r.category))].sort(),
    /*
     * The banner. Both halves are computed: how many definitions this persona is named on, and
     * how many exist that it is not — the second is what makes the first mean something.
     */
    viewer: {
      role_id: asRole,
      label: asRole ? db.auth_roles.find((r) => r.role_id === asRole)?.label ?? asRole : null,
      entitled_count: rows.filter(entitledTo).length,
      not_entitled_count: rows.filter((r) => !entitledTo(r)).length,
      scope: scopeRow,
    },
    /* The Author tab: a permission, and who holds it. */
    author: {
      may_author: scopeRow ? scopeRow.may_author === true : true,
      note: db.reports.governance.gate_notes.author,
      authors: db.reports.governance.data_scope
        .filter((s) => s.may_author)
        .map((s) => db.auth_roles.find((r) => r.role_id === s.role_id)?.label ?? s.role_id),
    },
    gates: {
      note: db.reports.governance.gate_notes.both,
      entitlement: {
        note: db.reports.governance.gate_notes.entitlement,
        /* The grid's columns are report definitions, named — a header has to say which report a
           cell is about, or the grid is a wall of tinted words. */
        columns: rows.map((r) => ({
          report_id: r.report_id,
          title: r.title,
          report_tag: r.report_tag,
          status: r.status,
        })),
        roles: db.auth_roles.map((role) => ({
          role_id: role.role_id,
          label: role.label,
          cells: [
            ...db.reports.governance.reports.map((g) => ({
              report_id: g.report_id,
              ...reportEntitlementCell(g, role.role_id),
            })),
            ...(db.reports.saved ?? []).map((s) => ({
              report_id: s.saved_id,
              ...reportEntitlementCell(
                { audience: reportViewerRoles(s).map((r) => r.role_id), status: 'published' },
                role.role_id,
              ),
            })),
          ],
        })),
      },
      data_scope: {
        note: db.reports.governance.gate_notes.data_scope,
        rows: db.reports.governance.data_scope.map((s) => ({
          ...s,
          label: db.auth_roles.find((r) => r.role_id === s.role_id)?.label ?? s.role_id,
        })),
      },
    },
    /* Refresh & schedule: what runs when, and what it stands on. */
    schedule: rows.map((r) => ({
      report_id: r.report_id,
      title: r.title,
      schedule: r.schedule,
      as_of: r.as_of,
      floor: r.floor,
      parameterized: r.parameterized,
      status_label: r.status_label,
      tone: r.tone,
    })),
    /*
     * Report audit: acts this app can actually account for — who wrote a definition and at which
     * version, who approved it, who saved a composed row and when, and whether the content it was
     * asked of is still published. No invented event log: an audit trail with fabricated rows is
     * worse than a short one.
     */
    audit: [
      ...written.map((r) => ({
        report_id: r.report_id,
        title: r.title,
        act: `defined ${r.version}`,
        actor: r.author,
        at: r.as_of,
        detail: r.approval
          ? `${r.status_label.toLowerCase()} · ${r.approval}`
          : `${r.status_label.toLowerCase()} · no approval recorded`,
        tone: r.tone,
      })),
      ...(db.reports.saved ?? []).map((s) => {
        const view = reportSavedView(s)
        return {
          report_id: s.saved_id,
          title: s.name,
          act: 'saved a composed report',
          actor: view.saved_by ?? 'unknown',
          at: s.saved_at ? String(s.saved_at).slice(0, 10) : null,
          detail: view.graph
            ? `asked of ${view.graph.name} ${view.graph.version ?? ''}`.trim() +
              (view.graph.live ? '' : ' - not published now')
            : 'no graph recorded',
          tone: view.graph?.live ? 'good' : 'warn',
        }
      }),
    ],
    /*
     * Publish checks: the preconditions, recomputed. Each is a real test against real state, so a
     * tick here is a fact rather than a decoration — and the one that fails after every restart
     * (publication lives in memory) is the one the reader most needs named.
     */
    publish_checks: rows.map((r) => ({
      report_id: r.report_id,
      title: r.title,
      checks: [
        {
          /*
           * **What this tests is that every persona the audience names still exists**, not that it
           * names one. Private is a decision Share can make, so "nobody" passes and says so; what
           * fails is an audience naming a persona that has been renamed or removed under it, which
           * silently narrows who can see the report and looks like nothing at all.
           */
          key: 'audience',
          label: 'Every persona the audience names still exists',
          pass: r.audience_named === r.entitled_roles.length,
          detail: r.private
            ? 'private - shared with nobody, which is a decision rather than a gap'
            : r.audience_named === r.entitled_roles.length
              ? `${r.entitled_roles.length} of ${db.auth_roles.length} personas`
              : `names ${r.audience_named}, ${r.entitled_roles.length} resolve - ` +
                'a persona was renamed or removed under this audience',
        },
        {
          key: 'floor',
          label: 'Spine roster resolves to rows',
          pass: r.row_count > 0,
          detail: r.floor ?? 'no roster',
        },
        {
          key: 'approval',
          label: 'Approval recorded',
          pass: r.approval !== null,
          detail: r.approval ?? 'none - a definition may not be published unapproved',
        },
        {
          key: 'graph',
          label: 'A published graph to ask it of',
          pass: publishedGraphs().length > 0,
          detail:
            publishedGraphs().length > 0
              ? `${publishedGraphs().length} published`
              : 'nothing published - publication lives in memory, so a restart closes this',
        },
      ],
    })),
  }
}

/* ---------------- Audit & Governance ----------------
 *
 * One page for **who sees what**, and what this server has recorded about it. Two gates and a
 * trail, and the page names all three:
 *
 *  - **Who can open it** — set by the author when they publish, and managed here per artifact.
 *    A report's audience is `viewer_roles`; a published what-if scenario's is a list of reader
 *    addresses. Those are two different pools and this page does not merge them: it resolves both
 *    to *people* for display, and writes back to whichever the artifact actually stores.
 *  - **What they see inside** — an access rule per persona: a restriction basis (a field the
 *    register declares filterable) plus the values that persona may see, resolved against the real
 *    36-generator roster.
 *  - **Every change is recorded** — in memory, like publication itself.
 *
 * **The rule is recorded, not enforced, and the page says so in those words.** No roster in this
 * app is filtered per persona: a report renders the same rows for everybody. Resolving the rule
 * against the roster is arithmetic on data this server holds — honest — but claiming a reader
 * *saw* that subset would be claiming a filter that never ran. That is the distinction gate 2 has
 * always been documented under, made editable here rather than made real.
 */

/** What this server has seen. In memory, like publication — a restart forgets both together. */
const governanceLog = liveContainer('governanceLog')
let governanceLogSeq = 1
const logGovernance = (category, actor, text, detail) => {
  governanceLog.unshift({
    event_id: `gl-${governanceLogSeq++}`,
    at: new Date().toISOString(),
    category,
    actor: actor ?? db.google_account.email,
    text,
    detail,
  })
}

/**
 * The fields a restriction may run on.
 *
 * **Derived, never a written list.** The register's own field dictionary decides: the spine's
 * identity column, plus every field it declares `filterable`. That is the same set the report
 * section's facets come from, so a basis offered here cannot be one no report could slice by —
 * and a field the dictionary stops declaring disappears from both at once. `enf` is deliberately
 * absent for exactly that reason: the dictionary does not declare it filterable.
 */
const governanceBases = () => {
  const rows = registerRows()
  const { identity, fields } = reportRegister()
  const keys = [
    identity,
    ...fields.filter((f) => f.filterable).map((f) => f.key),
  ].filter((k, i, all) => all.indexOf(k) === i && k in (rows[0] ?? {}))

  return keys.map((key) => {
    /* The **register's** dictionary, not the section's: it is the list `keys` came from, so every
       basis is guaranteed a label. Read off `db.reports.fields` instead, a register whose columns that
       dictionary does not describe falls through to the raw key — a chip reading `gen_state`, which is
       the same failure REPORT_LABELS exists to prevent one layer up. */
    const field = fields.find((f) => f.key === key)
    /* The values are the roster's own distinct values, each carrying how many rows it admits —
       so an empty basis reads as "nothing qualifies" rather than as a control that failed. */
    const seen = new Map()
    for (const row of rows) {
      const raw = row[key]
      const value = typeof raw === 'boolean' ? String(raw) : String(raw ?? '')
      seen.set(value, (seen.get(value) ?? 0) + 1)
    }
    return {
      basis: key,
      label: field?.label ?? REPORT_LABELS[key] ?? key,
      identity: key === identity,
      values: [...seen.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([value, count]) => ({
          value,
          /* A boolean field prints as a sentence, not as "true": a chip reading `true` is a
             value nobody outside this file can act on. */
          label:
            typeof rows.find((r) => String(r[key]) === value)?.[key] === 'boolean'
              ? value === 'true'
                ? `${field?.label ?? key}`
                : `No ${(field?.label ?? key).toLowerCase()}`
              : value,
          count,
        })),
    }
  })
}

/** The rows one rule admits, against today's roster. */
const governanceRows = (rule) => {
  if (!rule || !rule.basis || !Array.isArray(rule.values) || rule.values.length === 0) return []
  return registerRows().filter((row) =>
    rule.values.some((v) => String(row[rule.basis] ?? '') === String(v)),
  )
}

/**
 * What a persona's rule resolves to today.
 *
 * Four outcomes and they are different facts: `full` sees the roster, `mask` sees it as totals
 * only, `part` sees what the rule admits, and `none` sees nothing — which is what an unset rule
 * means, and it is stated rather than defaulted to "everything".
 */
const governanceResolution = (scope) => {
  const total = registerRows().length
  const basis = scope.rule ? governanceBases().find((b) => b.basis === scope.rule.basis) : null
  if (scope.full && scope.mask) {
    return { kind: 'mask', count: total, total, summary: 'Totals only — row figures masked', sample: [] }
  }
  if (scope.full) {
    return { kind: 'full', count: total, total, summary: `All ${total} generators`, sample: [] }
  }
  if (!scope.rule || !basis) {
    /* "No rule yet", not "opens empty": nothing here is enforced, so describing what a reader
       would see would be a claim about a filter that does not run. */
    return { kind: 'none', count: 0, total, summary: 'No rule authored yet', sample: [] }
  }
  const rows = governanceRows(scope.rule)
  if (rows.length === 0) {
    return {
      kind: 'none',
      count: 0,
      total,
      summary: `${basis.label}: no value picked yet`,
      sample: [],
    }
  }
  const labelFor = (v) => basis.values.find((x) => x.value === String(v))?.label ?? String(v)
  return {
    kind: 'part',
    count: rows.length,
    total,
    summary: `${basis.label}: ${scope.rule.values.map(labelFor).join(', ')}`,
    /* Named, because "32 of 36" is not checkable and a list of names is. */
    sample: rows.map((r) => String(r[reportRegister().identity])),
  }
}

/** Every person this tenant has, with the rule their persona carries. */
const governancePeople = () =>
  settings.users.map((u) => {
    const role = db.auth_roles.find((r) => r.role_id === u.role_id)
    const scope = db.reports.governance.data_scope.find((s) => s.role_id === u.role_id) ?? {}
    return {
      email: u.email,
      name: u.name,
      role_id: u.role_id,
      role_label: role?.label ?? u.role_id,
      /* The tenant's authored description of this persona's scope, beside the rule that is
         actually editable — two different things, so both are named. */
      declared: scope.scope ?? null,
      masked_columns: scope.masked ?? null,
      full: scope.full === true,
      mask: scope.mask === true,
      rule: scope.rule ?? null,
      resolution: governanceResolution(scope),
    }
  })

/** A person by address, or null. The directory is Settings' — nothing here invents one. */
const governancePerson = (email) =>
  governancePeople().find((p) => p.email.toLowerCase() === String(email ?? '').toLowerCase()) ?? null

/**
 * The published artifacts this page governs.
 *
 * Two kinds with two audience models, resolved to people either way. A **report** stores role
 * ids, so its readers are the people holding those roles; a **what-if scenario** stores addresses,
 * so its readers are those people directly. Each row says which actions it can carry out, because
 * they differ: a scenario can be unpublished (that route exists), a report cannot — the section
 * has no such act, and its equivalent is an audience of nobody.
 */
const governanceArtifacts = () => {
  const reports = db.reports.governance.reports.map((row) => {
    const definition = db.reports.reports.find((r) => r.report_id === row.report_id)
    const audience = Array.isArray(row.audience) ? row.audience : []
    return {
      artifact_id: row.report_id,
      kind: 'report',
      kind_label: 'Report',
      name: definition?.heading ?? row.report_id,
      published_by: row.author ?? null,
      live: row.status === 'published',
      status_label: reportState(row.status)?.label ?? row.status,
      freshness: row.schedule ?? null,
      cases: null,
      /* Every person whose persona the audience names. Two people on one persona both appear —
         which is the honest reading of a role-based audience, not a bug. */
      readers: governancePeople()
        .filter((p) => audience.includes(p.role_id))
        .map((p) => p.email),
      audience_note:
        'Stored as personas, so adding somebody names their persona — anyone else holding it is ' +
        'named too.',
      can_unpublish: false,
    }
  })

  const scenarios = [...whatifSaved.values()]
    .filter((s) => s.published !== null)
    .map((s) => ({
      artifact_id: s.saved_id,
      kind: 'whatif',
      kind_label: 'What-if scenario',
      name: s.name,
      published_by: s.published.published_by,
      live: true,
      status_label: 'Published',
      freshness:
        db.whatif.publishing.freshness.presets.find((p) => p.id === s.published.freshness.preset)
          ?.label ?? null,
      cases: s.cases.map((c) => c.name),
      readers: s.published.readers,
      audience_note: 'Stored as addresses — a scenario names people, not personas.',
      can_unpublish: true,
    }))

  return [...reports, ...scenarios]
}

const governanceArtifact = (id) => governanceArtifacts().find((a) => a.artifact_id === id) ?? null

/**
 * Add a person to an artifact's audience, in whatever that artifact stores.
 *
 * A **report** keeps persona ids, so naming a person names their persona — and the row says so,
 * because anyone else holding it is named too. A **scenario** keeps addresses, so it keeps theirs.
 * Translating one model into the other is what this deliberately does not do.
 */
const governanceAddReader = async (artifact, person) => {
  if (artifact.kind === 'report') {
    const row = db.reports.governance.reports.find((r) => r.report_id === artifact.artifact_id)
    if (row.audience.includes(person.role_id)) return
    await commitDb({
      ...db,
      reports: {
        ...db.reports,
        governance: {
          ...db.reports.governance,
          reports: db.reports.governance.reports.map((r) =>
            r.report_id === artifact.artifact_id
              ? { ...r, audience: [...r.audience, person.role_id] }
              : r,
          ),
        },
      },
    })
    return
  }
  const entry = whatifSaved.get(artifact.artifact_id)
  whatifSaved.set(artifact.artifact_id, {
    ...entry,
    published: { ...entry.published, readers: [...entry.published.readers, person.email] },
  })
}

/** Remove one, or say why it cannot be done. Returns a sentence on refusal, null on success. */
const governanceRemoveReader = async (artifact, email) => {
  const person = governancePerson(email)
  if (artifact.kind === 'report') {
    await commitDb({
      ...db,
      reports: {
        ...db.reports,
        governance: {
          ...db.reports.governance,
          reports: db.reports.governance.reports.map((r) =>
            r.report_id === artifact.artifact_id
              ? { ...r, audience: r.audience.filter((rid) => rid !== person?.role_id) }
              : r,
          ),
        },
      },
    })
    return null
  }
  const entry = whatifSaved.get(artifact.artifact_id)
  const readers = entry.published.readers.filter((e) => e !== email)
  /* A published scenario with no readers is published to nobody, which the publish route already
     refuses. Unpublish is the act that means that, and the refusal names it. */
  if (readers.length === 0) {
    return (
      `${person?.name ?? email} is the only reader of “${artifact.name}”. A published scenario ` +
      'names at least one — unpublish it instead, which withdraws it and keeps the author’s draft.'
    )
  }
  whatifSaved.set(artifact.artifact_id, {
    ...entry,
    published: { ...entry.published, readers },
  })
  return null
}

/** The page's whole payload. */
const governanceView = () => ({
  connected_sources: connectedSources().length,
  ...reportGraphCounts(),
  roster_total: registerRows().length,
  bases: governanceBases(),
  people: governancePeople(),
  artifacts: governanceArtifacts(),
  log: governanceLog,
  log_categories: db.reports.governance.audit.categories,
  copy: db.reports.governance.audit.copy,
})

const reportsList = (asRole) => ({
  /* The three tabs' own payload — see reportGovernanceView above. */
  governance: reportGovernanceView(asRole),
  /*
   * The published graphs a report can be asked of — plural, because the wizard opens on
   * this list and the reader picks. `graph` stays as the default (the newest) so a report
   * opened straight off the section still names what answered it.
   */
  graphs: reportGraphs(),
  graph: reportGraph(),
  saved: (db.reports.saved ?? [])
    .map(reportSavedView)
    .filter((row) => !asRole || row.viewer_roles.some((r) => r.role_id === asRole)),
  authoring: {
    opts: db.reports.opts,
    facets: reportFacets(),
    defaults: Object.fromEntries(
      Object.entries(db.reports.assumptions).map(([slot, chosen]) => [slot, chosen.value]),
    ),
  },
  reports: db.reports.reports.map((r) => ({
    report_id: r.report_id,
    report_tag: r.report_tag,
    heading: r.heading,
    subtitle: r.subtitle,
    question: r.question,
    spine: r.spine,
    /* Both counts, because "5 traces" and "36 generators" are the difference between a
       sample and a register, and a card that showed neither would look identical. */
    row_count: reportRows(r).length,
    spine_total: db.reports.data[r.spine].length,
    block_kinds: r.blocks.map((b) => b.type),
    tiles: r.tiles,
  })),
})

/** One report, with every figure computed against the roster it names. */
const reportView = (report) => {
  const reading = reportReading(report)
  return {
    report_id: report.report_id,
    report_tag: report.report_tag,
    heading: report.heading,
    subtitle: report.subtitle,
    badge: report.badge,
    note: report.note,
    title: report.title,
    question: report.question,
    spine: report.spine,
    row_count: reportRows(report).length,
    spine_total: db.reports.data[report.spine].length,
    reading: reading.text,
    assumptions: reading.assumptions,
    /*
     * The frame in **values**, beside the labels the page prints.
     *
     * `assumptions` is for reading; this is for asking again. A chip on the report has to
     * rebuild it under the same scope, measure and horizon plus one filter, and reconstructing
     * those from their labels would be guessing at what it had already been told.
     */
    frame: {
      report_id: report.report_id,
      use_case_id: report.graph?.use_case_id ?? reportGraph()?.use_case_id ?? null,
      scope: report.scope,
      measure: report.measure,
      horizon: report.horizon_label
        ? (db.reports.opts.horizon.options.find((o) => o.label === report.horizon_label)?.value ??
          db.reports.assumptions.horizon.value)
        : db.reports.assumptions.horizon.value,
      filters: (report.applied_filters ?? []).map((f) => ({ key: f.key, value: String(f.value) })),
    },
    /* What this report can be sliced by — the chip bar the package's own reports carry. A
       chip re-asks the report, so the figures never describe a different set than the rows. */
    facets: reportFacetsFor(report.spine),
    tiles: report.tiles,
    footer: report.footer,
    blocks: report.blocks.map((block) => reportBlock(report, block)),
    /* Where the figures come from, in the tenant's words. */
    source_trace: db.reports.meta.source_trace,
    /*
     * And which published graph answered it — the claim Ask makes about its own answers,
     * made here for the same reason. A frame carries its own pick; a written report read
     * straight off the section defaults to the newest published one.
     */
    graph: report.graph ?? reportGraph(),
  }
}

const routes = [
  /* ---------------- which datasets exist ---------------- */

  /**
   * The dataset pool, so the selector renders what the server has rather than a list written into
   * the component.
   *
   * The same rule the consent screen follows with its scopes and the Share picker with its roles: a
   * client-held list can offer a value the API refuses, and here that would mean a selector showing
   * CAPEX on a deployment that has no CAPEX prefix. Each entry says where it reads from and whether
   * it holds anything, because "empty" and "not configured" are different answers — and `both` is
   * reported as a reading view so the UI does not have to know that writes are refused under it.
   */
  /*
   * ---------------- liveness, for whatever is in front of this process ----------------
   *
   * **A load balancer needs one route that answers, and `/` is not it.** The dispatcher answers an
   * unknown path with a 404 that says the server may be stale — useful to a developer, and read by
   * Elastic Beanstalk's default health check as a failing application. The environment then goes red
   * while every real endpoint is healthy, which is the least diagnosable deployment failure there is.
   *
   * **It reports readiness rather than a bare `ok`, and the distinction is real.** Every dataset's
   * document is read and validated *above* `server.listen`, so a process that is listening has already
   * parsed and accepted all of them — which is exactly what a checker wants to know. Naming the datasets
   * and the store makes the reply a diagnosis rather than a heartbeat: "listening, but reading the wrong
   * store" is a state a heartbeat cannot express and this one can.
   *
   * Deliberately outside the dataset scope in spirit: it names them all rather than the selected one, so
   * a health check needs no header and cannot fail on a wrong `x-dataset`.
   */
  {
    method: 'GET',
    match: (p) => p === '/health',
    handle: (_req, res) =>
      send(res, 200, {
        ok: true,
        /* Listening at all means every document below was parsed and validated. */
        datasets: DATASETS,
        store: storeKind(DB_PATH),
        port: PORT,
        uptime_s: Math.round(process.uptime()),
      }),
  },

  {
    method: 'GET',
    match: (p) => p === '/datasets',
    handle: (_req, res) =>
      send(res, 200, {
        datasets: DATASETS.map((name) => ({
          dataset: name,
          label: name,
          primary: name === PRIMARY,
          ref: DB_PATHS[name],
          store: storeKind(DB_PATHS[name]),
          /* What this dataset actually holds, so an empty one reads as empty rather than broken. */
          projects: (docs[name].projects ?? []).length,
          drives: (docs[name].drives ?? []).length,
          reports: (docs[name].reports?.reports ?? []).length,
          graphs: (docs[name].graph_use_cases ?? []).length,
          populated: (docs[name].projects ?? []).length > 0,
        })),
        both: { dataset: BOTH, label: 'Both', read_only: true },
        selected: activeDataset(),
      }),
  },

  /* ---------------- db.json editor ---------------- */

  {
    method: 'GET',
    match: (p) => p === '/db',
    handle: (_req, res) =>
      send(res, 200, {
        /* The selected dataset's own document and its own ref — under `both`, the primary's ref
           names where a write would land, and a write under `both` is refused before it gets here. */
        path: DB_PATHS[activeDataset()] ?? DB_PATH,
        dataset: activeDataset(),
        store: storeKind(DB_PATHS[activeDataset()] ?? DB_PATH),
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
      await commitDb(next)
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
      await commitDb(next)
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
      const { email, password } = await readJson(req)

      if (!email || !EMAIL_RE.test(String(email))) {
        return send(res, 400, { error: 'Enter a valid email address.' })
      }
      if (!password || String(password).length < 6) {
        return send(res, 400, { error: 'Password must be at least 6 characters.' })
      }

      /*
       * **The role is the user's, not the form's.** The login used to ask for one, which meant the same
       * address could sign in as any persona — so the picker was the whole of "who are you". Settings now
       * holds a user list, and that is where the role comes from: one address, one persona, administered
       * in one place.
       *
       * Matched case-insensitively, because an email address is not case-sensitive to the person typing
       * it and "Ellis.Hargrove@…" being nobody would be a puzzle rather than a rule.
       */
      const address = String(email).trim()
      const user = settings.users.find(
        (u) => String(u.email).toLowerCase() === address.toLowerCase(),
      )
      if (!user) {
        return send(res, 400, {
          error:
            `No user is set up for ${address}. This prototype signs in the people Settings knows: ` +
            `${settings.users.map((u) => u.email).join(', ')}.`,
        })
      }
      /* Refused rather than defaulted: a persona this tenant does not have is a broken settings file,
         and signing somebody in as nobody is worse than telling them so. */
      const role = db.auth_roles.find((r) => r.role_id === user.role_id)
      if (!role) {
        return send(res, 400, {
          error:
            `${address} is set up as "${user.role_id}", which is not one of this tenant's personas. ` +
            'Re-author the settings store with "npm run seed:settings".',
        })
      }

      /*
       * **Still not authentication.** There is no credential store: the password is length-checked and
       * nothing more, exactly as before. What changed is that the *persona* is now looked up rather than
       * claimed. Nothing built on this should read it as a verified identity.
       */
      send(res, 200, {
        email: user.email,
        name: user.name,
        role_id: role.role_id,
        role_label: role.label,
        access_note: role.access_note ?? '',
        initials: emailInitials(user.email),
        signed_in_at: new Date().toISOString(),
      })
    },
  },

  /*
   * ---------------- Settings: the users, and what each persona may see ----------------
   *
   * Served from `db.settings`, which was a **separate document** until it was folded in — see the note
   * where it is bound. Both writes commit through `commitDb`, so a permission survives a restart;
   * unlike a registered source, a decision about who sees what is somebody's work.
   *
   * **Neither route is access control.** They record and report a navigation preference; the persona
   * arrives from a browser whose login authenticates by shape. Every surface here says so in words.
   */
  {
    method: 'GET',
    match: (p) => p === '/settings',
    handle: (_req, res) => send(res, 200, settingsView()),
  },

  /*
   * One persona's navigation access. Whole set per write rather than one key at a time, so the payload
   * says what the answer is instead of what changed — and the reply is the whole view, so the page
   * renders a validated payload rather than patching its own copy.
   */
  {
    method: 'PATCH',
    match: (p) => /^\/settings\/personas\/[^/]+\/nav$/.test(p),
    handle: async (req, res, { pathname }) => {
      const roleId = decodeURIComponent(
        pathname.slice('/settings/personas/'.length, -'/nav'.length),
      )
      const role = db.auth_roles.find((r) => r.role_id === roleId)
      if (!role) {
        return send(res, 404, {
          error:
            `no persona "${roleId}" — this tenant has ` +
            db.auth_roles.map((r) => r.role_id).join(', '),
        })
      }

      const body = await readJson(req)
      if (!isObject(body.nav)) {
        return send(res, 400, {
          error: 'send nav as an object of { navigationKey: true | false }',
        })
      }

      const current = navPermissionsFor(roleId)
      const known = Object.keys(current)
      const next = { ...current }
      for (const [key, value] of Object.entries(body.nav)) {
        /* A key the sidebar does not have would be a permission nobody can exercise, stored forever. */
        if (!known.includes(key)) {
          return send(res, 400, {
            error: `no navigation item "${key}" — this app has ${known.join(', ')}`,
          })
        }
        if (typeof value !== 'boolean') {
          return send(res, 400, { error: `"${key}" must be true or false` })
        }
        /*
         * **The lock is enforced here, not only by a disabled switch.** A disabled control is a courtesy
         * to whoever is looking at it; this is the rule. Refused rather than ignored, because silently
         * keeping a value the caller asked to change is how a UI comes to disagree with the server.
         */
        if (navReadOnly(roleId, key) && value !== current[key]) {
          return send(res, 400, {
            error:
              `"${key}" is fixed for ${role.label} and cannot be changed. It is the page that ` +
              'grants every other permission, so the persona that administers it keeps it.',
          })
        }
        next[key] = value
      }

      await commitSettings({
        ...settings,
        nav_permissions: { ...settings.nav_permissions, [roleId]: next },
      })
      send(res, 200, settingsView())
    },
  },

  /*
   * One persona's report access — which of the Library row's three acts it is offered.
   *
   * **The twin of the nav route, and deliberately built as one.** Whole set per write so the payload
   * says what the answer *is*; the reply is the whole view so the page renders something validated
   * rather than patching its own copy; an unknown persona is a 404 naming the ones that exist and an
   * unknown action a 400 naming the three. Adding an endpoint for one of these pairs means adding the
   * same guard to the other.
   *
   * **And it is not access control, which is why there is no lock here.** The navigation route fixes
   * `settings` for Platform Admin because turning it off would strand the persona that grants every
   * other permission — there is no way back. Nothing here can strand anybody: a persona that loses
   * `edit` still reaches this page and can hand it back, and the API still serves every report to a
   * caller that names no role. So the rule stays "record the decision, hide the control, say plainly
   * that hiding is not authorising" rather than a fixed key nobody could explain.
   */
  {
    method: 'PATCH',
    match: (p) => /^\/settings\/personas\/[^/]+\/reports$/.test(p),
    handle: async (req, res, { pathname }) => {
      const roleId = decodeURIComponent(
        pathname.slice('/settings/personas/'.length, -'/reports'.length),
      )
      const role = db.auth_roles.find((r) => r.role_id === roleId)
      if (!role) {
        return send(res, 404, {
          error:
            `no persona "${roleId}" — this tenant has ` +
            db.auth_roles.map((r) => r.role_id).join(', '),
        })
      }

      const body = await readJson(req)
      if (!isObject(body.reports)) {
        return send(res, 400, {
          error: `send reports as an object of { ${REPORT_ACTIONS.join(' | ')}: true | false }`,
        })
      }

      const next = { ...reportPermissionsFor(roleId) }
      for (const [key, value] of Object.entries(body.reports)) {
        /* An action no row has is a permission nobody can exercise — refused rather than stored, the
           same reasoning as an unknown navigation key. */
        if (!REPORT_ACTIONS.includes(key)) {
          return send(res, 400, {
            error: `no report action "${key}" — a row has ${REPORT_ACTIONS.join(', ')}`,
          })
        }
        if (typeof value !== 'boolean') {
          return send(res, 400, { error: `"${key}" must be true or false` })
        }
        next[key] = value
      }

      await commitSettings({
        ...settings,
        report_permissions: { ...settings.report_permissions, [roleId]: next },
      })
      send(res, 200, settingsView())
    },
  },

  /* Back to the authored defaults for one persona — which live in the same file, so this copies rather
     than reconstructs. Both blocks at once: the button says "Reset to defaults" for the persona, and
     restoring its navigation while leaving its report access edited would answer half of that. */
  {
    method: 'POST',
    match: (p) => /^\/settings\/personas\/[^/]+\/reset$/.test(p),
    handle: async (_req, res, { pathname }) => {
      const roleId = decodeURIComponent(
        pathname.slice('/settings/personas/'.length, -'/reset'.length),
      )
      if (!db.auth_roles.some((r) => r.role_id === roleId)) {
        return send(res, 404, {
          error:
            `no persona "${roleId}" — this tenant has ` +
            db.auth_roles.map((r) => r.role_id).join(', '),
        })
      }
      await commitSettings({
        ...settings,
        nav_permissions: {
          ...settings.nav_permissions,
          [roleId]: { ...(settings.defaults[roleId] ?? {}) },
        },
        report_permissions: {
          ...settings.report_permissions,
          [roleId]: { ...(settings.report_defaults?.[roleId] ?? {}) },
        },
      })
      send(res, 200, settingsView())
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
          // A folder's parent, so a caller can draw the drive as the tree it is
          // rather than as a flat list of paths. `null` at the root.
          parent_id: f.parent_id ?? null,
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

      const payload = {
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
      }
      setTimeout(() => send(res, 200, payload), CONNECT_STEP_MS).unref?.()
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

      const payload = {
        drive_id,
        display_name: drive.display_name,
        kind: drive.kind,
        folder_count: drive.folders.length,
        document_count: drive.folders.reduce((s, f) => s + f.documents.length, 0),
        folders: drive.folders.map((f) => ({
          folder_id: f.folder_id,
          /*
           * A drive is a tree, and the allowlist is picked from it. The folders stay one flat
           * list — every walk over them, here and in `validateDb`, is unchanged — and the
           * parent pointer is what lets the wizard draw the nesting. `null` is a root, and the
           * key is present on every folder including the package's own, so "no parent" is never
           * confused with "seeded before nesting existed".
           */
          parent_id: f.parent_id ?? null,
          name: f.name,
          path: f.path,
          description: f.description,
          document_count: f.documents.length,
          // What the document profiler would have to read, not just count.
          page_count: f.documents.reduce((s, d) => s + d.pages, 0),
          file_types: [...new Set(f.documents.map((d) => d.mime_type))],
        })),
        registered: false,
      }
      setTimeout(() => send(res, 200, payload), CONNECT_STEP_MS).unref?.()
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

      setTimeout(
        () =>
          send(res, alreadyRegistered ? 200 : 201, {
            ...record,
            drive: drive_id,
            display_name: drive.display_name,
            folder_count: folders.length,
            document_count: documentCount,
          }),
        CONNECT_STEP_MS,
      ).unref?.()
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

      setTimeout(
        () =>
          send(res, alreadyRegistered ? 200 : 201, {
            ...record,
            project: project_id,
            dataset_count: datasets.length,
            table_count: tableCount,
          }),
        CONNECT_STEP_MS,
      ).unref?.()
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
        /* A synthesis input, not a displayed figure — see the note at the other call site. `null` means
           the table was catalogued and never profiled, and 0 is a floor for the hashing rather than a
           claim about the table; nothing here renders it. */
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
    /*
     * `/graph-answer-formats/suggest` was the fourth of these and is gone with step 6.
     * A render format is no longer something a brief drafts and stores: the reader
     * picks one per question on Ask, from the whole pool, which `GET /ask` serves. A
     * suggester over three formats was ranking a list short enough to read in full.
     */
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
            // A hero question is the graph's contract, so more of them are useful.
            pool === 'graph_hero_questions' ? 5 : 4,
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

  // Step 5 → 6. Starts the derivation and returns immediately; the answer
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
   * Step 6. Derived from the draft rather than from a saved row, so the review
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

  // Step 4. What the Data Catalog has actually profiled, per connected source.
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
    handle: (_req, res, { pathname, query }) => {
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

      /*
       * Who is publishing. Sent as `as=<email>` because the identity is client-held and
       * this server has nothing to look it up from — the rule the consent callback set. A
       * malformed one is refused rather than recorded: every "published by" line in the app
       * reads this, and a name nobody can be is worse than the seeded fallback.
       */
      const as = query.get('as')
      if (as !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(as)) {
        return send(res, 400, {
          error: `"${as}" is not an email — send the signed-in address as ?as=, or nothing`,
        })
      }

      studioLive.set(id, sha)
      /*
       * Written on every publish, never merged into what was there. This records *this*
       * publish act, so a publish that names nobody has to fall back to the tenant account
       * rather than inherit the last publisher's name — which is what it did until a smoke
       * run unpublished and republished anonymously and the page still credited the
       * previous person.
       */
      if (as) studioPublishedBy.set(`${id}:${sha}`, as)
      else studioPublishedBy.delete(`${id}:${sha}`)
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
        /*
         * The Answer requirements tab's pool. It was step 6 of the wizard, where the
         * brief declared it once; a reader now asks per question, so the options are
         * served here — the same rule the consent screen follows, because a client
         * holding its own list can offer a value `POST /ask` refuses.
         */
        answer_requirements: {
          citations_options: CITATION_OPTIONS,
          default_citations: DEFAULT_CITATIONS,
          formats: askAnswerFormats(),
          note: 'Citations really apply — an answer that carries none says so. A render format is stated, not applied: an answer renders as the blocks it holds.',
        },
      })
    },
  },

  // Ask the live graph. Every refusal names the fix, and none of them is paced.
  {
    method: 'POST',
    match: (p) => p === '/ask',
    handle: async (req, res) => {
      const body = await readJson(req)
      const { use_case_id, question } = body
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
      /* What the reader required of this answer, validated here — before the stream
         opens, like every other refusal on this route. */
      const requested = askRequested(body)
      if (requested.error) return send(res, 400, { error: requested.error })

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
      const answer = askAnswer(found.useCase, String(question).trim(), requested)

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
        /*
         * How many blocks are still to come.
         *
         * The page draws one shimmer per paragraph it is waiting for, and that has to be a
         * *fact* rather than an animation: a placeholder for a piece nobody promised is the
         * same lie as a stage that ticks without a request. The count is known here — the
         * answer is composed before the stream opens — so it is stated here.
         */
        block_count: (answer.blocks ?? []).length,
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
        gap_decisions,
        step,
        status,
      } = body
      /* `citations` and `answer_formats` are deliberately not read. They were step 6's,
         and that step is gone — the choice is made per question on Ask now. An older
         client still sending them is ignored rather than refused: the fields are not
         wrong, they simply belong to another surface. */

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
              error: `${pick.source_id} has nothing profiled yet — profile it in the Data Catalog first`,
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
        gap_decisions: decisions ?? existing?.gap_decisions ?? [],
        step: stepNumber,
        updated_at: new Date().toISOString(),
      }

      await commitDb({
        ...db,
        graph_use_cases: existing
          ? db.graph_use_cases.map((u) =>
              u.use_case_id === record.use_case_id ? record : u,
            )
          : [record, ...db.graph_use_cases],
      })

      /*
       * Committing a brief no longer moves a version label — **a build does**, and the count
       * lives in `studioBuildCount`. This is where the old config version was bumped, and it
       * is deliberately empty now rather than bumping both: two counters over one label is how
       * a published v2 comes to be called v3 by something that never rebuilt it.
       */

      send(res, existing ? 200 : 201, { saved: true, use_case: savedUseCase(record) })
    },
  },

  {
    method: 'DELETE',
    match: (p) => /^\/graph-use-cases\/.+$/.test(p),
    handle: async (_req, res, { pathname }) => {
      const id = decodeURIComponent(pathname.slice('/graph-use-cases/'.length))
      if (!db.graph_use_cases.some((u) => u.use_case_id === id)) {
        return send(res, 404, { error: `no use case ${id}` })
      }
      await commitDb({
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

  /*
   * The other half of Disconnect, and the reason the dialog can promise it is reversible.
   *
   * Disconnect revokes the credential and keeps everything else — the allowlist, and every
   * object the profiler has committed. This re-issues a handle from the credential store, the
   * same place registering gets one, and flips the status back. **It does not re-register**:
   * `POST /sources` builds a fresh record, so re-running the wizard on the same project drops
   * the profiled objects that are still sitting here. The two are different acts and only one
   * of them is an undo.
   *
   * A source that is already connected is refused rather than quietly re-issued: "reconnected"
   * would be reported for a row that was never disconnected.
   */
  {
    method: 'POST',
    match: (p) => /^\/sources\/.+\/reconnect$/.test(p),
    handle: (_req, res, { pathname }) => {
      const sourceId = decodeURIComponent(
        pathname.slice('/sources/'.length, -'/reconnect'.length),
      )
      const source = registered.get(sourceId)
      if (!source) return send(res, 404, { error: `no registered source ${sourceId}` })
      if (source.status !== 'disconnected') {
        return send(res, 400, {
          error: `${sourceId} is already ${source.status} — there is nothing to reconnect`,
        })
      }

      if (source.kind === 'bigquery') {
        const cred = db.credentials.find((c) => c.project_id === source.project_id)
        if (!cred) {
          return send(res, 400, {
            error:
              `no credential is on file for ${source.project_id} — connect it again from ` +
              'Connect source, which will re-run the Google consent',
          })
        }
        source.credential_handle = cred.credential_handle
      } else if (source.kind === 'gdrive') {
        const cred = db.drive_credentials.find((c) => c.drive_id === source.drive_id)
        if (!cred) {
          return send(res, 400, {
            error:
              `no credential is on file for ${source.drive_id} — connect it again from ` +
              'Connect source, which will re-run the Google consent',
          })
        }
        source.credential_handle = cred.credential_handle
      }
      /* A generic source's credential was a reference the user pasted, and disconnecting
         cleared it. Nothing here can re-issue one, and inventing a handle would be worse than
         the null: the row is a stub either way, and nothing reads it. */

      source.status = source.kind === 'generic' ? 'syncing' : 'connected'
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
      /*
       * A disconnected source has no credential, so widening what it may profile promises
       * access it cannot make. The Sources table disables the button too — but a disabled
       * control is a courtesy to whoever is looking at it, and any other path into this route
       * would otherwise store an allowlist nothing could act on. Same reasoning as the fixed
       * Settings permission, which is also enforced here rather than only in the switch.
       */
      if (source.status === 'disconnected') {
        return send(res, 400, {
          error: `${sourceId} is disconnected — reconnect it before changing its allowlist`,
        })
      }

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
      /* The twin of the check on /datasets, and added to both at once: a guard on one connector
         only is how the two paths come to disagree about what a disconnected source may do. */
      if (source.status === 'disconnected') {
        return send(res, 400, {
          error: `${sourceId} is disconnected — reconnect it before changing its allowlist`,
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

  /* ---------------- The What-if lens ---------------- */

  /*
   * The frame: the facility, the measures that can be watched, the pools a scenario
   * can draw from, and the copy the page prints.
   *
   * **`resolvable` is deliberately not in this payload.** It is the list of phrasings
   * the graph can ground, and the whole premise of the authoring step is that the
   * *graph* decides what grounds — "what doesn't ground is refused, not invented". A
   * client holding the keyword list could answer that itself, which would make the
   * refusal a piece of theatre. It stays server-side and `POST /whatif/resolve` is the
   * only way to ask.
   */
  {
    method: 'GET',
    match: (p) => p === '/whatif',
    handle: (_req, res) => {
      const connected = connectedSources().length
      const counts = reportGraphCounts()
      /*
       * One gate, the same one the report section has: publication. The copy calls this a
       * read-only overlay **on the knowledge graph**, so without a published graph there
       * is nothing to overlay and figures shown anyway would be attributed to content
       * nobody has published. A connected source is not a second precondition — the two
       * pages share one rule, which is why they share one empty state.
       */
      if (counts.published_count === 0) {
        return send(res, 200, {
          connected_sources: connected,
          ...counts,
          facility: null,
          generators: [],
          watched_measures: [],
          candidate_pools: [],
          formats: {},
          headroom: [],
          saved: [],
          /* Both pools empty on this branch, and honestly so: there is no published
             graph to bind to, so there is nothing to publish and nobody to publish it
             to. The keys are still sent because the client validates their shape. */
          readers: [],
          graphs: [],
          copy: db.whatif.copy,
          state_defaults: db.whatif.state_defaults,
          authoring: db.whatif.authoring,
          runtime: db.whatif.runtime,
          publishing: db.whatif.publishing,
          graph_reference: db.whatif.graph_reference,
        })
      }
      send(res, 200, {
        connected_sources: connected,
        ...counts,
        ...whatifFrame(),
        saved: [...whatifSaved.values()],
      })
    },
  },

  /*
   * Resolving a typed measure against the graph.
   *
   * Three verdicts and they are the point: `resolved` adds the measure it grounded to,
   * `grounds_not_inherited` explains that the measure is real but measures the wrong
   * thing (tonnage measures the Manifest, not inherited risk), and `refused` says
   * nothing in this graph resolves it. Paced like the suggesters, because a resolution
   * that returns instantly reads as a lookup in a list the client already had — which
   * is exactly what this is not.
   */
  {
    method: 'POST',
    match: (p) => p === '/whatif/resolve',
    handle: async (req, res) => {
      const { text } = await readJson(req)
      const asked = String(text ?? '').trim()
      if (!asked) return send(res, 400, { error: 'type a measure to resolve against the graph' })

      const hit = db.whatif.resolvable.find((r) =>
        r.keywords.some((k) => asked.toLowerCase().includes(k)),
      )
      const copy = db.whatif.resolve_copy
      const fill = (s) =>
        String(s ?? '')
          .replaceAll('{q}', asked)
          .replaceAll(
            '{label}',
            db.whatif.watched_measures.find((m) => m.key === hit?.resolves_to)?.label ?? '',
          )

      const answer = !hit
        ? {
            verdict: 'refused',
            measure_key: null,
            tone: copy.refused.tone,
            title: fill(copy.refused.title),
            body: fill(copy.refused.body),
          }
        : hit.verdict === 'grounds_not_inherited'
          ? {
              verdict: 'grounds_not_inherited',
              measure_key: null,
              tone: copy.grounds_not_inherited.tone,
              title: fill(copy.grounds_not_inherited.title),
              body: `${hit.note}.`,
            }
          : {
              verdict: 'resolved',
              measure_key: hit.resolves_to,
              tone: copy.resolved.tone,
              title: fill(copy.resolved.title),
              body: `${hit.note}.`,
            }

      setTimeout(() => send(res, 200, { text: asked, ...answer }), WHATIF_STEP_MS).unref?.()
    },
  },

  /*
   * One scenario column: what admitting this load would inherit.
   *
   * Computed on the server, every time, because a figure the page arrived at itself is
   * a figure with two sources. Nothing is stored — a scenario is a read-only overlay
   * and this route writes nothing, which is what lets the copy promise it never writes
   * back. Not paced: this is a traversal, not a model call, and the copy says every
   * figure recomputes *live* when a load is swapped.
   */
  {
    method: 'POST',
    match: (p) => p === '/whatif/scenario',
    handle: async (req, res) => {
      const { generator_id, watch } = await readJson(req)
      const generator = db.whatif.generators.find((g) => g.id === generator_id)
      if (!generator) {
        return send(res, 404, {
          error: `no generator ${generator_id} in this pool — the Runtime only offers loads the frame allows`,
        })
      }
      const keys = Array.isArray(watch) ? watch : []
      const unknown = keys.filter((k) => !db.whatif.watched_measures.some((m) => m.key === k))
      if (unknown.length > 0) {
        return send(res, 400, {
          error: `not a watched measure: ${unknown.join(', ')} — author it in step 1 first`,
        })
      }
      /* The traversal itself. Every column's figures come from here, so this is the
         call the reader is waiting on when a load is swapped. */
      setTimeout(() => send(res, 200, whatifScenario(generator, keys)), WHATIF_STEP_MS).unref?.()
    },
  },

  /*
   * The saved library. **It stores the admitted load and never the numbers**, so a
   * saved scenario stays live as the graph changes — re-opening it recomputes. That is
   * the whole reason `POST /whatif/scenario` exists separately: the library holds a
   * generator id, and the figures are derived every time they are shown.
   *
   * In memory, like registered sources: a scenario library is a working session, not
   * something a mock writes back over its seed.
   */
  {
    method: 'POST',
    match: (p) => p === '/whatif/saved',
    handle: async (req, res) => {
      const { saved_id, name, watch, pool, cases } = await readJson(req)

      /* The frame first, because a case is only meaningful inside one. A pool the
         package does not ship would silently admit every generator. */
      const poolKey = String(pool ?? '')
      if (!db.whatif.candidate_pools.some((p) => p.key === poolKey)) {
        return send(res, 400, {
          error: `no candidate pool "${poolKey}" — pick one of: ${db.whatif.candidate_pools
            .map((p) => p.key)
            .join(', ')}`,
        })
      }
      const watchKeys = Array.isArray(watch) ? watch.map(String) : []
      const unknown = watchKeys.filter((k) => !db.whatif.watched_measures.some((m) => m.key === k))
      if (unknown.length > 0) {
        return send(res, 400, {
          error: `not a watched measure: ${unknown.join(', ')} — author it in step 1 first`,
        })
      }
      /* A scenario judged against nothing is not a scenario, which is the same refusal
         step 1 makes before it will continue. */
      if (watchKeys.length === 0) {
        return send(res, 400, {
          error: 'a scenario watches at least one measure — pick one in step 1 before saving',
        })
      }

      const rows = Array.isArray(cases) ? cases : []
      if (rows.length === 0) {
        return send(res, 400, { error: 'a scenario holds at least one case — open a column in Runtime first' })
      }
      const admitted = whatifPool(poolKey)
      const nextCases = []
      for (const row of rows) {
        const generator = db.whatif.generators.find((g) => g.id === row?.generator_id)
        if (!generator) return send(res, 404, { error: `no generator ${row?.generator_id}` })
        /* A case whose load the frame excludes would reopen showing a load its own
           dropdown does not offer — the frame is what the pool step exists to set. */
        if (!admitted.some((g) => g.id === generator.id)) {
          return send(res, 400, {
            error: `${generator.name} is not in the "${poolKey}" pool — a case may only admit a load the frame allows`,
          })
        }
        /* The package's own default, so an unnamed case is still identifiable rather
           than listed as an empty row. */
        const fallback = db.whatif.runtime.saved_library.default_name_template.replace(
          '{first_two_words_of_generator}',
          generator.name.split(/\s+/).slice(0, 2).join(' '),
        )
        nextCases.push({ name: String(row?.name ?? '').trim() || fallback, generator_id: generator.id })
      }

      // An update keeps the id, so the runtime stays linked to its library entry.
      const id = saved_id && whatifSaved.has(saved_id) ? saved_id : `sv-${whatifSavedSeq++}`
      const previous = whatifSaved.get(id) ?? null
      const label =
        String(name ?? '').trim() ||
        previous?.name ||
        `What-if — ${(db.whatif.candidate_pools.find((p) => p.key === poolKey)?.label ?? poolKey).toLowerCase()}`

      const at = new Date().toISOString()

      whatifSaved.set(id, {
        saved_id: id,
        name: label,
        watch: watchKeys,
        pool: poolKey,
        cases: nextCases,
        /*
         * When it was **created**, carried through every re-save.
         *
         * This is a different fact from `published.published_at`, and both are on the
         * row for that reason: a scenario can sit in the library for a week before
         * anybody publishes it, so a card showing one date would be dating the other
         * act. Neither is a figure — they are the record of two decisions.
         */
        created_at: previous?.created_at ?? at,
        updated_at: at,
        /*
         * Re-saving keeps the publication, because editing a published scenario is
         * still that publication — but its readers are reading a frame that just
         * changed under them, so the entry says when it was last written and the row
         * reports it. Nothing here is a figure.
         */
        published: previous?.published ?? null,
      })
      setTimeout(
        () => send(res, 200, { saved: [...whatifSaved.values()], saved_id: id }),
        WHATIF_STEP_MS,
      ).unref?.()
    },
  },

  {
    method: 'DELETE',
    match: (p) => /^\/whatif\/saved\/[^/]+$/.test(p),
    handle: (_req, res, { pathname }) => {
      const id = decodeURIComponent(pathname.slice('/whatif/saved/'.length))
      if (!whatifSaved.has(id)) return send(res, 404, { error: `no saved scenario ${id}` })
      whatifSaved.delete(id)
      /* Deleting from the library leaves any open column in place, just unlinked — the
         page turns it back into an unsaved draft rather than closing it out from under
         the reader. */
      send(res, 200, { saved: [...whatifSaved.values()], deleted: id })
    },
  },

  /*
   * Publishing a scenario, and unpublishing it.
   *
   * **The whole scenario travels, or nothing does** — which is why this route hangs off
   * a library entry rather than off a column. Publishing records three decisions and
   * verifies each against a pool the server owns:
   *
   *  - **readers**, checked against `db.settings`'s users. An address outside the
   *    directory is refused naming who is in it, exactly as the login refuses an
   *    unknown address: inventing a reader is inventing a user.
   *  - **the graph it is bound to**, checked against what is *currently* published.
   *    A scenario bound to a draft would promise figures traversed from content nobody
   *    published, and defaulting to the newest would attribute them to a graph the
   *    author never picked.
   *  - **freshness**, checked against the presets `db.whatif.publishing` declares.
   *
   * **It is not access control**, and the dialog says so in those words: the directory
   * is served, but the role is client-held and this API serves every scenario to a
   * caller that names nobody. What publishing records is who is *told*.
   *
   * `published_by` is taken from `?as=<email>` for the reason every "who did this" field
   * here is: the identity is client-held and the server has nothing to look it up from.
   * It is written on every publish rather than only when absent — a record keyed by a
   * thing but holding a fact about an *act* goes stale the moment the act repeats, which
   * is how `studioPublishedBy` kept crediting the previous publisher.
   *
   * In memory, like the library it lives in and like graph publication itself: a restart
   * closes every gate on this page, and it must not leave a scenario claiming readers.
   */
  {
    method: 'POST',
    match: (p) => /^\/whatif\/saved\/[^/]+\/publish$/.test(p),
    handle: async (req, res, { pathname, query }) => {
      const id = decodeURIComponent(pathname.slice('/whatif/saved/'.length, -'/publish'.length))
      const entry = whatifSaved.get(id)
      if (!entry) return send(res, 404, { error: `no saved scenario ${id}` })

      const as = query.get('as')
      if (as !== null && !EMAIL_RE.test(as)) {
        return send(res, 400, {
          error: `"${as}" is not an email — send the signed-in address as ?as=, or nothing`,
        })
      }

      const { readers, graph_use_case_id, freshness } = await readJson(req)

      const directory = whatifReaders()
      const picked = Array.isArray(readers) ? [...new Set(readers.map((r) => String(r).trim()))] : []
      if (picked.length === 0) {
        return send(res, 400, { error: db.whatif.publishing.readers.empty_error })
      }
      const strangers = picked.filter((e) => !directory.some((d) => d.email === e))
      if (strangers.length > 0) {
        return send(res, 400, {
          error:
            `${strangers.join(', ')} is not in the directory — Settings knows ` +
            `${directory.map((d) => d.email).join(', ')}`,
        })
      }

      /* Order is the directory's, so the row reads the same however they were ticked. */
      const inDirectoryOrder = directory.filter((d) => picked.includes(d.email)).map((d) => d.email)

      const live = reportGraphs()
      const graph = live.find((g) => g.use_case_id === graph_use_case_id)
      if (!graph) {
        return send(res, 400, {
          error:
            live.length === 0
              ? db.whatif.publishing.graph.empty
              : `no published graph "${graph_use_case_id}" — published now: ${live
                  .map((g) => `${g.name} (${g.use_case_id})`)
                  .join(', ')}`,
        })
      }

      const presets = db.whatif.publishing.freshness.presets
      const fresh = freshness ?? {}
      const preset = presets.find((p) => p.id === fresh.preset)
      if (!preset) {
        return send(res, 400, {
          error: `no freshness preset "${fresh.preset}" — pick one of: ${presets.map((p) => p.id).join(', ')}`,
        })
      }
      const unit = String(fresh.unit ?? db.whatif.publishing.freshness.default.unit)
      if (!db.whatif.publishing.freshness.units.includes(unit)) {
        return send(res, 400, {
          error: `no freshness unit "${unit}" — pick one of: ${db.whatif.publishing.freshness.units.join(', ')}`,
        })
      }
      const days = Array.isArray(fresh.days) ? fresh.days.map(String) : []
      const strangeDays = days.filter((d) => !db.whatif.publishing.freshness.days.includes(d))
      if (strangeDays.length > 0) {
        return send(res, 400, { error: `not a day of the week: ${strangeDays.join(', ')}` })
      }
      /* A weekly recurrence with no day never runs. Refused rather than accepted and
         quietly never fired, which would read on the row as a live schedule. */
      if (preset.id === 'custom' && unit === 'week' && days.length === 0) {
        return send(res, 400, { error: db.whatif.publishing.freshness.no_day_error })
      }
      const every = Number(fresh.every)
      const time = String(fresh.time ?? db.whatif.publishing.freshness.default.time)
      if (!db.whatif.publishing.freshness.times.includes(time)) {
        return send(res, 400, {
          error: `no freshness time "${time}" — pick one of: ${db.whatif.publishing.freshness.times.join(', ')}`,
        })
      }

      whatifSaved.set(id, {
        ...entry,
        published: {
          readers: inDirectoryOrder,
          graph_use_case_id: graph.use_case_id,
          graph_name: graph.name,
          /* The content that answers it, not just the brief — the same pair Ask and a
             report footer report, so "which build did a reader see" is answerable. */
          graph_version: graph.version,
          graph_sha256: graph.sha256,
          freshness: {
            preset: preset.id,
            every: Number.isFinite(every) && every >= 1 ? Math.min(Math.round(every), 52) : 1,
            unit,
            days,
            time,
          },
          /* `.email`, not the account object — it is the tenant's own seeded account and
             holds a name and a picture beside the address. The fallback is that account
             rather than a blank, because "published by nobody" is not true of something
             a reader can open, and it is written on *every* publish rather than only
             when absent: an anonymous re-publish must stop crediting whoever went last. */
          published_by: as ?? db.google_account.email,
          published_at: new Date().toISOString(),
        },
      })
      send(res, 200, { saved: [...whatifSaved.values()], saved_id: id })
    },
  },

  {
    method: 'DELETE',
    match: (p) => /^\/whatif\/saved\/[^/]+\/publish$/.test(p),
    handle: (_req, res, { pathname }) => {
      const id = decodeURIComponent(pathname.slice('/whatif/saved/'.length, -'/publish'.length))
      const entry = whatifSaved.get(id)
      if (!entry) return send(res, 404, { error: `no saved scenario ${id}` })
      /* Unpublishing keeps the scenario — it stops being readable, it does not stop
         existing, and the copy on the dialog promises exactly that. */
      whatifSaved.set(id, { ...entry, published: null })
      send(res, 200, { saved: [...whatifSaved.values()], saved_id: id })
    },
  },

  /* ---------------- Audit & Governance ---------------- */

  /* The whole page: the two gates, the artifacts they apply to, and the trail. */
  {
    method: 'GET',
    match: (p) => p === '/governance',
    handle: (_req, res) => send(res, 200, governanceView()),
  },

  /*
   * The access rule a persona carries.
   *
   * Written against `db.reports.governance.data_scope`, which is where gate 2 already lives — so
   * this edits the tenant's existing scope row rather than opening a second answer to "what may
   * this persona see". It **commits**, like a report audience and unlike a registered source: a
   * decision about who sees what is somebody's work and must survive a restart.
   *
   * A rule is **recorded, not enforced** — the page says so and so does the reply. Nothing in this
   * app filters a roster per persona, so what this changes is what the resolution *would* admit.
   */
  {
    method: 'PATCH',
    match: (p) => /^\/governance\/scope\/[^/]+$/.test(p),
    handle: async (req, res, { pathname, query }) => {
      const roleId = decodeURIComponent(pathname.slice('/governance/scope/'.length))
      const scope = db.reports.governance.data_scope.find((s) => s.role_id === roleId)
      if (!scope) {
        return send(res, 404, {
          error:
            `no persona "${roleId}" — this tenant governs ` +
            db.reports.governance.data_scope.map((s) => s.role_id).join(', '),
        })
      }

      const as = query.get('as')
      if (as !== null && !EMAIL_RE.test(as)) {
        return send(res, 400, {
          error: `"${as}" is not an email — send the signed-in address as ?as=, or nothing`,
        })
      }

      const body = await readJson(req)
      const next = { ...scope }

      if ('full' in body) next.full = body.full === true
      if ('mask' in body) next.mask = body.mask === true

      if ('rule' in body) {
        if (body.rule === null) {
          next.rule = null
        } else {
          const bases = governanceBases()
          const basis = bases.find((b) => b.basis === body.rule?.basis)
          if (!basis) {
            return send(res, 400, {
              error:
                `no restriction basis "${body.rule?.basis}" — the register offers ` +
                `${bases.map((b) => b.basis).join(', ')}. Only fields the dictionary declares ` +
                'filterable, plus the spine\'s identity column, can restrict anything',
            })
          }
          const values = Array.isArray(body.rule.values) ? [...new Set(body.rule.values.map(String))] : []
          const strangers = values.filter((v) => !basis.values.some((x) => x.value === v))
          if (strangers.length > 0) {
            return send(res, 400, {
              error:
                `${basis.label} has no value ${strangers.join(', ')} in this register — the values ` +
                'come from the roster itself, so one that is not on it would admit nothing',
            })
          }
          next.rule = { basis: basis.basis, values }
          /* A rule and "sees everything" are contradictory claims; picking one clears the other
             rather than leaving a rule that nothing reads. */
          next.full = false
        }
      }
      /* Masking with no scope would mask nothing — the mask is *how* a scope is shown, not a
         scope of its own, so it implies the full roster when there is nothing else. */
      if (next.mask && !next.full && !(next.rule && next.rule.values.length > 0)) next.full = true

      await commitDb({
        ...db,
        reports: {
          ...db.reports,
          governance: {
            ...db.reports.governance,
            data_scope: db.reports.governance.data_scope.map((s) =>
              s.role_id === roleId ? next : s,
            ),
          },
        },
      })

      const resolved = governanceResolution(next)
      logGovernance(
        'rule',
        as,
        `changed the access rule for ${db.auth_roles.find((r) => r.role_id === roleId)?.label ?? roleId}`,
        `${resolved.summary} — resolves to ${resolved.count} of ${resolved.total} generators today. ` +
          'Recorded, not enforced: no roster here is filtered per persona.',
      )
      send(res, 200, governanceView())
    },
  },

  /*
   * A reader on a published artifact.
   *
   * **The server owns the mapping**, because the two kinds store different things: a report's
   * audience is persona ids and a scenario's is addresses. A page that knew which was which would
   * be a second answer to "what is an audience made of", so it names a person and this route
   * writes to whichever pool the artifact actually keeps.
   */
  {
    method: 'POST',
    match: (p) => /^\/governance\/artifacts\/[^/]+\/readers$/.test(p),
    handle: async (req, res, { pathname, query }) => {
      const id = decodeURIComponent(
        pathname.slice('/governance/artifacts/'.length, -'/readers'.length),
      )
      const artifact = governanceArtifact(id)
      if (!artifact) return send(res, 404, { error: `no published artifact "${id}"` })

      const as = query.get('as')
      if (as !== null && !EMAIL_RE.test(as)) {
        return send(res, 400, { error: `"${as}" is not an email — send the signed-in address as ?as=, or nothing` })
      }

      const { email } = await readJson(req)
      const person = governancePerson(email)
      if (!person) {
        return send(res, 400, {
          error:
            `${email} is not in the directory — Settings knows ` +
            governancePeople().map((p) => p.email).join(', '),
        })
      }
      if (artifact.readers.includes(person.email)) {
        return send(res, 400, { error: `${person.name} can already open “${artifact.name}”.` })
      }

      await governanceAddReader(artifact, person)
      logGovernance('reader', as, `gave ${person.name} access to “${artifact.name}”`, artifact.audience_note)
      send(res, 200, governanceView())
    },
  },

  {
    method: 'DELETE',
    match: (p) => /^\/governance\/artifacts\/[^/]+\/readers\/[^/]+$/.test(p),
    handle: async (_req, res, { pathname, query }) => {
      const rest = pathname.slice('/governance/artifacts/'.length)
      const id = decodeURIComponent(rest.slice(0, rest.indexOf('/readers/')))
      const email = decodeURIComponent(rest.slice(rest.indexOf('/readers/') + '/readers/'.length))
      const artifact = governanceArtifact(id)
      if (!artifact) return send(res, 404, { error: `no published artifact "${id}"` })
      if (!artifact.readers.includes(email)) {
        return send(res, 404, { error: `${email} is not a reader of “${artifact.name}”` })
      }
      const as = query.get('as')
      if (as !== null && !EMAIL_RE.test(as)) {
        return send(res, 400, { error: `"${as}" is not an email — send the signed-in address as ?as=, or nothing` })
      }
      const person = governancePerson(email)

      const problem = await governanceRemoveReader(artifact, email)
      if (problem) return send(res, 400, { error: problem })

      logGovernance(
        'reader',
        as,
        `removed ${person?.name ?? email} from “${artifact.name}”`,
        'The link stops working for them on the next read.',
      )
      send(res, 200, governanceView())
    },
  },

  /*
   * Unpublish — **offered only where it can be carried out**. A scenario's publication is a record
   * this server keeps, so it can be withdrawn; a report definition has no such act, and its
   * equivalent is an audience of nobody. The refusal says which, rather than a button that 404s.
   */
  {
    method: 'POST',
    match: (p) => /^\/governance\/artifacts\/[^/]+\/unpublish$/.test(p),
    handle: (_req, res, { pathname, query }) => {
      const id = decodeURIComponent(
        pathname.slice('/governance/artifacts/'.length, -'/unpublish'.length),
      )
      const artifact = governanceArtifact(id)
      if (!artifact) return send(res, 404, { error: `no published artifact "${id}"` })
      if (!artifact.can_unpublish) {
        return send(res, 400, {
          error:
            `“${artifact.name}” is a report definition — this section has no unpublish. Remove ` +
            'every reader instead, which makes it private and is a decision the row records.',
        })
      }
      const as = query.get('as')
      if (as !== null && !EMAIL_RE.test(as)) {
        return send(res, 400, { error: `"${as}" is not an email — send the signed-in address as ?as=, or nothing` })
      }
      const entry = whatifSaved.get(id)
      whatifSaved.set(id, { ...entry, published: null })
      logGovernance(
        'publish',
        as,
        `unpublished “${artifact.name}”`,
        'It stays in the author’s library — unpublishing withdraws the readers, not the scenario.',
      )
      send(res, 200, governanceView())
    },
  },

  /* ---------------- Reports ---------------- */

  /*
   * The section: the five written reports, and the fields this dataset cannot answer.
   *
   * **One gate, and it is publication.** A report is asked of the *published* graph, so
   * nothing is reported until a version is live — and that is the *only* precondition:
   * connecting a source is not one, because publishing a graph is already downstream of
   * having something to build it from. `connected_sources` still rides along for the
   * pages that report it, but it gates nothing here. `built_count` and `draft_count` are
   * beside `published_count` because "finish the wizard" and "press Publish" are
   * different fixes and the empty page has to name the right one.
   *
   * The gate serves no copy. A card headed "Inbound Generator Risk Register · 36
   * generators" above "No graph has been published" is a claim about data nothing has
   * answered for, which is the mistake the What-if page had to be corrected for.
   */
  {
    method: 'GET',
    match: (p) => p === '/reports',
    handle: (_req, res, { query }) => {
      const connected = connectedSources().length
      const counts = reportGraphCounts()

      /*
       * **The rendered documents ride on both branches, because the publish gate is not about them.**
       *
       * That gate exists because an EPA report *is* a question asked of the published graph — serving
       * one with nothing published would be answering from content nobody released. A CAPEX report is a
       * finished document: nothing was asked of a graph to produce it, so withholding it until a graph is
       * published would be enforcing a precondition it does not have, and the section would read as
       * empty for a dataset that ships three reports.
       *
       * They are named `documents` rather than folded into `reports` for the same reason: a computed
       * report and a rendered one are different things, and a reader has to be able to tell which they
       * are looking at.
       */
      const documents = db.reports.documents ?? []
      const authoringDocument = db.reports.authoring_document ?? null

      if (counts.published_count === 0) {
        return send(res, 200, {
          connected_sources: connected,
          ...counts,
          graph: null,
          graphs: [],
          reports: [],
          saved: [],
          authoring: null,
          /*
           * **The governance view rides along for a dataset that ships documents, and only for one.**
           *
           * It is `null` while the gate is closed because there is normally nothing to govern until a
           * graph is published — a governance block full of empty lists reads as "nothing governed".
           * A dataset whose reports are *documents* has a library either way, so withholding it would
           * leave the Library with no chips and no rows for reports that plainly exist.
           *
           * `reportGovernanceView` reads `db.reports.governance` and nothing about a published graph,
           * so this is a wider *audience* for an already-computed view rather than a looser gate. EPA
           * still gets `null` here, which is what keeps its documented behaviour unchanged.
           */
          governance: documents.length > 0 ? reportGovernanceView(reportRoleFrom(query)) : null,
          documents,
          authoring_document: authoringDocument,
        })
      }
      /* The role the browser reports, read by `reportRoleFrom` — the same reader for this GET and
         for all three governance writes, so a write cannot answer with a view computed for
         somebody else. */
      send(res, 200, {
        connected_sources: connected,
        ...counts,
        ...reportsList(reportRoleFrom(query)),
        documents,
        authoring_document: authoringDocument,
      })
    },
  },

  /*
   * ---------------- the three acts a reader performs on a governed definition ----------------
   *
   * Share, Delete and Request access. All three **commit**, because all three are somebody's
   * decision rather than a derived figure: a restart clears a registered source and a publication,
   * and it must not clear who a report was shared with or who is waiting to be let in.
   *
   * Each answers with the governance view rather than a bare `{ ok: true }`, so the page renders a
   * validated payload instead of patching its own copy of the state it just changed — the same rule
   * every studio decision follows.
   *
   * **None of them is access control**, and the routes cannot pretend otherwise: the role arrives
   * from the browser, which the login authenticates by shape. They record and report decisions. Any
   * UI built on them has to say so in those words.
   */

  /*
   * /* Share — who may see that this report exists. `[]` is private, and is a decision. */
  {
    method: 'PATCH',
    match: (p) => /^\/reports\/governance\/[^/]+\/audience$/.test(p),
    handle: async (req, res, { pathname, query }) => {
      const id = decodeURIComponent(
        pathname.slice('/reports/governance/'.length, -'/audience'.length),
      )
      const row = db.reports.governance.reports.find((r) => r.report_id === id)
      if (!row) {
        return send(res, 404, {
          error:
            `no governed report "${id}" — this tenant governs ` +
            `${db.reports.governance.reports.map((r) => r.report_id).join(', ')}`,
        })
      }

      const body = await readJson(req)
      if (!Array.isArray(body.audience)) {
        return send(res, 400, {
          error:
            'send audience as an array of role ids — an empty array makes the report private, ' +
            `which is a decision. Roles: ${db.auth_roles.map((r) => r.role_id).join(', ')}`,
        })
      }
      const ids = [...new Set(body.audience.map(String))]
      const unknown = ids.filter((rid) => !db.auth_roles.some((r) => r.role_id === rid))
      if (unknown.length > 0) {
        return send(res, 400, {
          error:
            `no such role: ${unknown.join(', ')} — this tenant has ` +
            db.auth_roles.map((r) => r.role_id).join(', '),
        })
      }

      await commitDb({
        ...db,
        reports: {
          ...db.reports,
          governance: {
            ...db.reports.governance,
            reports: db.reports.governance.reports.map((r) =>
              r.report_id === id ? { ...r, audience: ids } : r,
            ),
          },
        },
      })
      send(res, 200, { governance: reportGovernanceView(reportRoleFrom(query)) })
    },
  },

  /*
   * Delete — drops the **governance row**, which is what makes a report a governed definition.
   *
   * The definition itself is the package's and stays in `db.reports.reports`, so this is
   * recoverable: `node scripts/seed-report-governance.js` re-authors every row. The refusal below
   * and the message on success both say so, because "deleted" that cannot be undone and "deleted"
   * that a seed restores are different promises to make to somebody clicking Delete.
   */
  {
    method: 'DELETE',
    match: (p) => /^\/reports\/governance\/[^/]+$/.test(p),
    handle: async (_req, res, { pathname, query }) => {
      const id = decodeURIComponent(pathname.slice('/reports/governance/'.length))
      const row = db.reports.governance.reports.find((r) => r.report_id === id)
      if (!row) {
        return send(res, 404, {
          error:
            `no governed report "${id}" — this tenant governs ` +
            `${db.reports.governance.reports.map((r) => r.report_id).join(', ')}`,
        })
      }
      if (db.reports.governance.reports.length === 1) {
        return send(res, 400, {
          error:
            'this is the last governed definition — removing it would leave the section with ' +
            'nothing to govern, which reads as a broken page rather than an empty one. Re-seed ' +
            'with "node scripts/seed-report-governance.js" if that is really what you want.',
        })
      }

      await commitDb({
        ...db,
        reports: {
          ...db.reports,
          governance: {
            ...db.reports.governance,
            reports: db.reports.governance.reports.filter((r) => r.report_id !== id),
          },
        },
      })
      send(res, 200, {
        removed: id,
        restore: 'node scripts/seed-report-governance.js',
        governance: reportGovernanceView(reportRoleFrom(query)),
      })
    },
  },

  /*
   * ---------------- the report prototype's own dataset ----------------
   *
   * The Authoring tab's sample data, served rather than bundled. It used to be
   * `src/reports/data/dataset.json` compiled into the JS, which made it the one thing on screen that
   * editing the bucket could not change — a figure needed a rebuild and a redeploy.
   *
   * **Declared before `/reports/:id`, and that ordering is load-bearing.** That route matches
   * `/^\/reports\/[^/]+$/`, so `prototype` would arrive as a report id and come back as
   * `no report "prototype"` — a 404 naming five ids, none of them the thing being asked for. Same hazard
   * as `graph-studio/:useCaseId` matching the canvas route's parent segment.
   *
   * Ungated: it is the prototype's own sample data and says so on the page, so it does not wait on a
   * published graph the way a computed report does.
   */
  {
    method: 'GET',
    match: (p) => p === '/reports/prototype',
    handle: (_req, res) =>
      send(res, 200, {
        ref: DB_PATH,
        store: storeKind(DB_PATH),
        dataset: prototypeData(),
      }),
  },

  /*
   * One report, computed. Every figure on it is derived here from the roster its spine
   * names, so the page renders numbers rather than arriving at them.
   *
   * An unknown id is a 404 naming the ids that exist — the section is five fixed
   * reports, so a miss is a typo or a stale link rather than something to be lenient
   * about. Refused with the same sentence whichever gate is closed: "no such report",
   * "nothing connected" and "nothing published" are three different problems.
   */
  {
    method: 'GET',
    match: (p) => /^\/reports\/[^/]+$/.test(p),
    handle: (_req, res, { pathname }) => {
      const id = decodeURIComponent(pathname.slice('/reports/'.length))
      const report = db.reports.reports.find((r) => r.report_id === id)
      if (!report) {
        return send(res, 404, {
          error:
            `no report "${id}" — this section has ` +
            `${db.reports.reports.map((r) => r.report_id).join(', ')}`,
        })
      }
      const connected = connectedSources().length
      const counts = reportGraphCounts()
      if (counts.published_count === 0) {
        return send(res, 200, { connected_sources: connected, ...counts, report: null })
      }
      send(res, 200, { connected_sources: connected, ...counts, report: reportView(report) })
    },
  },

  /*
   * Reading a typed question back, before anything runs against the data.
   *
   * The page promises exactly this — "I'll read it back in one plain sentence first —
   * nothing runs against your compliance data until you're happy with it" — so this
   * endpoint returns a *sentence and a frame*, never a report. It is **paced** like the
   * suggesters, because reading a question is the one act here that reads as a model
   * call, and one that returned instantly would teach that it is free.
   *
   * A question that matches nothing is still read back, against the register, and the
   * payload says it was not recognised. Refusing outright would leave the reader with a
   * blank step; guessing silently would put words in their mouth.
   */
  {
    method: 'POST',
    match: (p) => p === '/reports/read',
    handle: async (req, res) => {
      const { question, report_id, use_case_id } = await readJson(req)
      const asked = String(question ?? '').trim()
      /* The graph is chosen before the question, so it is validated before the question
         is read: a sentence read back against a graph nobody published is theatre. */
      if (use_case_id && !reportGraphs().some((g) => g.use_case_id === use_case_id)) {
        return send(res, 400, {
          error: reportFrameProblem({ report_id: db.reports.reports[0].report_id, use_case_id, scope: db.reports.reports[0].scope, measure: db.reports.reports[0].measure, horizon: db.reports.assumptions.horizon.value }),
        })
      }
      /* Picking a standard report is not a question to interpret, so it is not paced and
         not matched — the chip *is* the answer. */
      const picked = report_id
        ? db.reports.reports.find((r) => r.report_id === report_id)
        : null
      if (report_id && !picked) {
        return send(res, 404, {
          error: `no report "${report_id}" — this section has ${db.reports.reports
            .map((r) => r.report_id)
            .join(', ')}`,
        })
      }
      if (!picked && !asked) {
        return send(res, 400, {
          error: 'type what you need, or start from one of the standard reports',
        })
      }

      const match = picked
        ? { report: picked, matched: true, why: `Starting from ${picked.report_tag}.` }
        : reportMatch(asked)
      const frame = {
        report_id: match.report.report_id,
        /* Carried through every step: the graph the question is asked of is part of the
           frame, not a detail of the request that read it back. */
        use_case_id: use_case_id ?? reportGraph()?.use_case_id ?? null,
        scope: match.report.scope,
        measure: match.report.measure,
        horizon: db.reports.assumptions.horizon.value,
        filters: [],
      }
      const payload = {
        question: picked ? picked.question : asked,
        matched: match.matched,
        why: match.why,
        report_tag: match.report.report_tag,
        heading: match.report.heading,
        spine: match.report.spine,
        graph: reportGraphFor(frame.use_case_id),
        frame,
        /* The sentence to check, and the pickers that change it. */
        ...reportBuildReading(match.report, frame),
        caveats: [REPORT_HORIZON_CAVEAT],
      }
      if (picked) return send(res, 200, payload)
      setTimeout(() => send(res, 200, payload), SUGGEST_MS).unref?.()
    },
  },

  /*
   * Building the report the confirmed frame describes.
   *
   * Not paced: this is a read over the rosters, the same as a What-if scenario, and the
   * copy promises the figures recompute rather than that a model runs. Every one of them
   * is computed here — and the payload says whether what came back is the written report
   * or a **generated** one, because a generated report must never show the tenant's
   * authored tiles against a frame they do not describe.
   */
  {
    method: 'POST',
    match: (p) => p === '/reports/build',
    handle: async (req, res) => {
      const frame = reportFrameFrom(await readJson(req))
      const problem = reportFrameProblem(frame)
      if (problem) return send(res, 400, { error: problem })

      const report = db.reports.reports.find((r) => r.report_id === frame.report_id)
      send(res, 200, { report: reportBuild(report, frame) })
    },
  },

  /*
   * ---------------- exporting a built report to a file ----------------
   *
   * **This is the one place a figure is written down, and it is a snapshot, not a cache.**
   * Everything else here re-asks: `db.reports` stores no result, and `GET /reports/saved/:id`
   * rebuilds from the frame so a stale figure can never be served as a current one. An export is
   * the opposite act on purpose — somebody needs to send this report to a person who does not have
   * the app — so the file carries the moment it was generated, the frame it was generated under and
   * the published graph that answered it. A number detached from those three is a number with no
   * question attached.
   *
   * Nothing reads an export back. It is written to S3 and never fetched by this server, which is
   * what keeps the rule intact: the export is evidence of what a report said, and the report is
   * still computed fresh every time it is opened.
   *
   * The reply carries a **presigned URL** because a private bucket makes an object unreachable to
   * exactly the person the export is for. That link is the permission — anyone holding it can read
   * the object until it expires — so it is a share, not an entitlement, which is the same
   * distinction this section draws everywhere else. `expires_in` is reported rather than implied:
   * a link that has quietly stopped working reads as a broken report.
   */
  {
    method: 'POST',
    match: (p) => p === '/reports/export',
    handle: async (req, res) => {
      const body = await readJson(req)
      const format = String(body.format ?? 'html').toLowerCase()
      if (!Object.hasOwn(FORMATS, format)) {
        return send(res, 400, {
          error: `"${format}" is not a format this exports — one of: ${Object.keys(FORMATS).join(', ')}. ` +
            'For PDF, open the HTML export and print to PDF: it carries a print stylesheet.',
        })
      }

      const frame = reportFrameFrom(body)
      const problem = reportFrameProblem(frame)
      if (problem) return send(res, 400, { error: problem })

      /* Who generated it, told rather than guessed — the rule the consent callback established and
         `saved_by` follows. Unlike `saved_by` this one is optional: a file with no name on it is
         still a true record of what the report said, whereas an unattributed *save* is a claim
         about authorship. A malformed one is still refused rather than quietly dropped. */
      const by = body.as ? String(body.as).trim() : null
      if (by && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(by)) {
        return send(res, 400, { error: `"${by}" is not an email — send the signed-in address as "as", or nothing` })
      }

      if (storeKind(DB_PATH) !== 's3') {
        return send(res, 400, {
          error:
            'exports are written to S3 and this server is reading local files (S3_BUCKET=off). ' +
            'Unset S3_BUCKET to export.',
        })
      }

      const report = db.reports.reports.find((r) => r.report_id === frame.report_id)
      const built = reportBuild(report, frame)

      const generatedAt = new Date().toISOString()
      const spec = FORMATS[format]
      const text = spec.render(built, { generatedAt, generatedBy: by })

      /* Beside the two documents, under the same prefix — one bucket location for this tenant,
         so an export is found by the person who knows where db.json is. */
      const ref = docRef(exportKey(built, spec.ext, generatedAt), null)
      try {
        /* No `If-Match`: an export key carries its own timestamp, so it names a new object every
           time and there is no previous version for a second writer to lose. */
        await writeDoc(ref, text, null, spec.contentType)
      } catch (error) {
        return send(res, 502, { error: `could not write the export — ${error.message}` })
      }

      const expiresIn = REPORT_EXPORT_LINK_MS / 1000
      send(res, 200, {
        export: {
          ref,
          format,
          bytes: Buffer.byteLength(text, 'utf8'),
          generated_at: generatedAt,
          generated_by: by,
          report_id: built.report_id,
          heading: built.heading,
          variant: built.variant,
          url: await presignGet(ref, expiresIn),
          expires_in: expiresIn,
        },
      })
    },
  },

  /*
   * The saved library.
   *
   * **A saved report is a question, not a result** — the frame and nothing else, so
   * re-opening one next week re-asks it against whatever the rosters then hold. It is
   * written through `commitDb`, which means it survives a restart: a question someone
   * composed is their work, the same asymmetry that lets a graph brief persist while a
   * registered source does not.
   */
  {
    method: 'POST',
    match: (p) => p === '/reports/saved',
    handle: async (req, res) => {
      const body = await readJson(req)
      const frame = reportFrameFrom(body)
      const problem = reportFrameProblem(frame)
      if (problem) return send(res, 400, { error: problem })
      const name = String(body.name ?? '').trim()
      if (!name) {
        return send(res, 400, { error: 'name this report so the library is readable' })
      }
      /*
       * Who saved it. The identity is client-held, so this route has to be *told* —
       * the same reason the consent callback takes `as=`. A malformed one is refused
       * rather than quietly recorded, because a name nobody can be is worse than none.
       */
      const viewerRoles = Array.isArray(body.viewer_roles) ? body.viewer_roles.map(String) : null
      const rolesProblem = reportViewerRolesProblem(viewerRoles)
      if (rolesProblem) return send(res, 400, { error: rolesProblem })
      const savedBy = body.saved_by ? String(body.saved_by).trim() : null
      if (savedBy !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(savedBy)) {
        return send(res, 400, { error: `"${savedBy}" is not an email — send the signed-in address as saved_by, or nothing` })
      }

      const saved = [...(db.reports.saved ?? [])]
      const existing = body.saved_id ? saved.findIndex((s) => s.saved_id === body.saved_id) : -1
      const row = {
        saved_id: existing >= 0 ? body.saved_id : `rp-${saved.length + 1}-${hash(name) % 9999}`,
        name,
        question: String(body.question ?? '').trim() || null,
        ...frame,
        saved_by: savedBy ?? saved[existing]?.saved_by ?? null,
        /* Kept as ids, resolved to labels on the way out — a stored label would go stale the
           moment a role is renamed in db.json. */
        viewer_roles: viewerRoles ?? saved[existing]?.viewer_roles ?? db.auth_roles.map((r) => r.role_id),
        saved_at: new Date().toISOString(),
      }
      if (existing >= 0) saved[existing] = row
      else saved.push(row)

      await commitDb({ ...db, reports: { ...db.reports, saved } })
      send(res, 200, { saved: (db.reports.saved ?? []).map(reportSavedView) })
    },
  },

  /*
   * Opening a saved report.
   *
   * **It is re-asked, not recalled.** The row holds a frame, so this rebuilds it against
   * the rosters as they are now — which is the whole reason a saved report stores no
   * figures. The row comes back beside the report so the page can say who saved it, when,
   * and which graph it was asked of.
   *
   * Two path segments, so the single-segment `GET /reports/:reportId` cannot match it —
   * but `GET /reports/saved` with no id does fall through to that route, which answers
   * `no report "saved"` and names the five that exist. That is the right refusal.
   */
  {
    method: 'GET',
    match: (p) => /^\/reports\/saved\/[^/]+$/.test(p),
    handle: (_req, res, { pathname }) => {
      const id = decodeURIComponent(pathname.slice('/reports/saved/'.length))
      const saved = (db.reports.saved ?? []).find((s) => s.saved_id === id)
      if (!saved) {
        return send(res, 404, {
          error:
            `no saved report ${id} — the library has ` +
            `${(db.reports.saved ?? []).length} report(s)`,
        })
      }
      const connected = connectedSources().length
      const counts = reportGraphCounts()
      if (counts.published_count === 0) {
        return send(res, 200, { connected_sources: connected, ...counts, report: null, saved: null })
      }
      const report = db.reports.reports.find((r) => r.report_id === saved.report_id)
      send(res, 200, {
        connected_sources: connected,
        ...counts,
        saved: reportSavedView(saved),
        report: reportBuild(report, {
          report_id: saved.report_id,
          use_case_id: saved.use_case_id ?? null,
          scope: saved.scope,
          measure: saved.measure,
          horizon: saved.horizon,
          filters: saved.filters ?? [],
        }),
      })
    },
  },

  /*
   * Who a saved report is for.
   *
   * Its own endpoint rather than a field on the save, because setting it is not re-saving the
   * report: the frame, the name and the question are untouched, and asking the caller to
   * re-post all three to change an audience invites one of them to arrive stale.
   *
   * **This is a demo control and the panel says so.** The role is client-held and the login
   * authenticates by shape, so it narrows what the section *shows* rather than what the API
   * will serve — which is the honest version of governed reporting in a mock.
   */
  {
    method: 'POST',
    match: (p) => /^\/reports\/saved\/[^/]+\/roles$/.test(p),
    handle: async (req, res, { pathname }) => {
      const id = decodeURIComponent(
        pathname.slice('/reports/saved/'.length, -'/roles'.length),
      )
      const saved = db.reports.saved ?? []
      const row = saved.find((s) => s.saved_id === id)
      if (!row) return send(res, 404, { error: `no saved report ${id}` })

      const { viewer_roles } = await readJson(req)
      const ids = Array.isArray(viewer_roles) ? viewer_roles.map(String) : null
      const problem = reportViewerRolesProblem(ids)
      if (problem) return send(res, 400, { error: problem })

      await commitDb({
        ...db,
        reports: {
          ...db.reports,
          saved: saved.map((s) => (s.saved_id === id ? { ...s, viewer_roles: ids } : s)),
        },
      })
      send(res, 200, { saved: (db.reports.saved ?? []).map(reportSavedView) })
    },
  },

  {
    method: 'DELETE',
    match: (p) => /^\/reports\/saved\/[^/]+$/.test(p),
    handle: async (_req, res, { pathname }) => {
      const id = decodeURIComponent(pathname.slice('/reports/saved/'.length))
      const saved = db.reports.saved ?? []
      if (!saved.some((s) => s.saved_id === id)) {
        return send(res, 404, { error: `no saved report ${id}` })
      }
      await commitDb({
        ...db,
        reports: { ...db.reports, saved: saved.filter((s) => s.saved_id !== id) },
      })
      send(res, 200, { saved: (db.reports.saved ?? []).map(reportSavedView), deleted: id })
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

  /*
   * ---------------- which dataset this request reads ----------------
   *
   * The one place a request begins, so the one place the selection is entered. Everything below
   * `route.handle` — every helper, every timer started inside it — reads `db` and the live
   * containers through this scope, which is why none of them had to take a dataset argument.
   *
   * An unknown value is a refusal naming the ones that exist rather than a quiet fall back to EPA:
   * a typo in `?dataset=` would otherwise serve EPA's figures under CAPEX's name, which is the
   * exact confusion the split exists to prevent.
   */
  const dataset = selectorFrom(url.searchParams, req.headers)
  if (!dataset) {
    const asked = url.searchParams.get('dataset') ?? req.headers['x-dataset']
    return send(res, 400, {
      error: `"${asked}" is not a dataset — this tenant has ${SELECTORS.join(', ')}.`,
    })
  }

  /*
   * `both` refuses **writes**, and the refusal lives at the two places that write rather than here.
   *
   * This was a check on the method, and that was wrong in a way only the flow shows: **most of the
   * reads in this API are POSTs.** `/auth/login` is a lookup, `/ask` is a query, `/whatif/scenario`
   * computes and stores nothing, `/reports/build` re-asks a question, `/graph-coverage` walks the
   * profiled objects — a blanket method check refused all of them, and the one that mattered was
   * login: switching to `both` signs the reader out, and they could then never sign back in.
   *
   * So `commitDb` refuses a document write and the live containers refuse a mutation, each naming the
   * fix. A pure read is answered whatever its verb, and nothing that would land on a throwaway can
   * get through.
   */

  try {
    await withDataset(dataset, () => route.handle(req, res, { pathname, query: url.searchParams }))
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
/*
 * Every dataset, not just the primary. A document that cannot be served is the same fault whichever
 * prefix it came from, and finding out when somebody switches to CAPEX puts the failure a long way
 * from its cause — the page would simply be the one that broke.
 */
for (const name of DATASETS) {
  const problems = withDataset(name, () => validateDb(docs[name]))
  if (problems.length > 0) {
    console.error(`\nmock-server: refusing to start — ${name}/db.json cannot be served.`)
    for (const problem of problems) console.error(`  · ${problem}`)
    console.error(
      name === PRIMARY
        ? '\n  Restore the file, then start again:' +
            '\n      npm run db:pull\n'
        : `\n  Re-seed that dataset, then start again:` +
            `\n      npm run seed:dataset -- ${name} && npm run db:push -- ${name}\n`,
    )
    process.exit(1)
  }
}

/*
 * And every key must have a merge rule, or `dataset=both` answers with a guess.
 *
 * A key `MERGE_PLAN` says nothing about is dropped from the merged document — so `both` would serve
 * a document missing a required key, which `validateDb` would never see because it validates the
 * two real documents and not the view built from them. The symptom is a page that works under EPA
 * and is empty under `both`, which reads as "CAPEX has no data". Checked here because this is where
 * both facts are in hand at once.
 */
for (const name of DATASETS) {
  const unplanned = unplannedKeys(docs[name])
  if (unplanned.length > 0) {
    console.error(
      `\nmock-server: refusing to start — ${name}/db.json has ${unplanned.length} key(s) that ` +
        `dataset=${BOTH} would silently drop.`,
    )
    for (const key of unplanned) console.error(`  · ${key}`)
    console.error(
      '\n  Add each one to MERGE_PLAN in backend/datasets.js, saying whether it is the' +
        "\n  primary's alone or a collection the datasets union.\n",
    )
    process.exit(1)
  }
}

/*
 * The same treatment for the two keys that used to be documents of their own.
 *
 * **`validateDb` has already refused a document missing either**, since both are `DB_SHAPE` keys now.
 * These stay for the message rather than the check: `validateDb` reports `"settings" is the wrong
 * shape` and tells you to restart, and the fix for a drifted permission set is a different command
 * from the fix for a stale process. A boot refusal naming the wrong command is one nobody can act on.
 *
 * Neither failure throws on its own, which is why they are refusals at all. A missing permission set
 * would show every sidebar item to a persona that should see three; a missing user would refuse an
 * address that is supposed to work; an unrenderable prototype arrives as an empty Authoring tab. All
 * three read as answers.
 */
const prototypeProblems = validatePrototype(prototypeData())
if (prototypeProblems.length > 0) {
  console.error('\nmock-server: refusing to start — db.reports_prototype cannot be served.')
  for (const problem of prototypeProblems) console.error(`  · ${problem}`)
  console.error('\n  Fetch the document again, then start again:\n      npm run db:pull\n')
  process.exit(1)
}

const settingsProblems = validateSettings(db.settings)
if (settingsProblems.length > 0) {
  console.error('\nmock-server: refusing to start — db.settings cannot be served.')
  for (const problem of settingsProblems) console.error(`  · ${problem}`)
  console.error('\n  Re-author them, then start again:\n      npm run seed:settings\n')
  process.exit(1)
}

server.listen(PORT, () => {
  console.log(`mock API listening on http://localhost:${PORT}`)
  /*
   * **Which store, said out loud on every start.** The default is the local file, and the committed
   * copy is a real document — so a box that meant to read the bucket and did not set `S3_BUCKET`
   * gets plausible, possibly stale figures rather than an error. This line is what makes that
   * visible, so it names the ref and, on the file store, how to ask for the bucket instead.
   */
  console.log(
    `  reading ${storeKind(DB_PATH)} ${DB_PATH}` +
      (storeKind(DB_PATH) === 's3'
        ? ` (writes are conditional on ETag)`
        : ` — set S3_BUCKET to read the bucket instead`),
  )
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