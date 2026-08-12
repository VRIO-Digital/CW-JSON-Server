# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev         # Vite dev server (proxies /api → localhost:4000)
npm run mock        # the JSON API on :4000 — the app has NO data without this
npm run build       # tsc -b && vite build
npm run lint        # oxlint
npm run audit       # audit gate (fails on any advisory, minus the allowlist)
npm run check-docs  # asserts this file's factual claims against the code
npm run ingest:graph # re-seeds graph_studio from 05_knowledge_graph/ (writes db.json)
npm run ingest:whatif # re-seeds whatif from "09_What if lens/" (writes db.json)
npm run ingest:reports # re-seeds reports from 07_reports/ (writes db.json)
npm run preflight   # lint + build + audit + check-docs — run before calling work done
```

**Two processes are required.** `npm run dev` alone renders empty pages: there is no
static fallback data anywhere in `src/`. Run `npm run mock` in a second terminal.
On a different port, `npm run mock -- 4001` also needs the proxy target —
`MOCK_ORIGIN=http://localhost:4001 npm run dev`, no file edit.

### Where the API lives, per environment

One variable decides it, `VITE_API_BASE`, and it is set in the `.env` files
rather than in code — `check-docs` fails on a hardcoded origin in `client.ts`.

| | `VITE_API_BASE` | How the call gets there |
|---|---|---|
| `npm run dev` (`.env.development`) | `/api` | the Vite proxy strips `/api` → `MOCK_ORIGIN`, default `localhost:4000` |
| `npm run build` (`.env.production`) | `http://18.205.228.143:4000` | called directly, cross-origin |
| behind nginx (`deploy/`) | `/api` | `proxy_pass` strips it → `MOCK_ORIGIN` |

**Local is the default at every layer**, so a fresh clone needs no environment
set up. Unset `VITE_API_BASE` falls back to `/api`, which is why the deployed
origin lives in `.env.production` only and why deleting that file breaks the
production build without breaking development.

Two things the direct cross-origin call depends on, both already true: the mock
server sends `access-control-allow-origin: *` on every response including the
`OPTIONS` preflight, and the deployed server answers on **4000, not 80**. It is
also plain HTTP — an `https://` page cannot call it at all, so serving the SPA
over TLS means putting a proxy in front and setting `VITE_API_BASE=/api`.

`VITE_*` variables are inlined into the bundle at build time. Changing one is a
rebuild, not a restart, and none of them can ever hold a secret.

`docker compose up --build` runs both in containers instead — nginx serves the
built SPA on `:8080` and takes over the two jobs the dev server did for free,
proxying `/api` (prefix stripped, exactly as `vite.config.ts` rewrites it) and
serving `index.html` for client routes. See `deploy/README.md`.

There is no test runner. Verification is done by building an SSR bundle of a
throwaway script and running it under node:

```bash
npx vite build --ssr smoke.tsx --outDir dist-ssr --logLevel warn && node dist-ssr/smoke.js
```

This is how components get asserted on without a DOM. Stub `globalThis.fetch` to
test `src/api/client.ts` against fabricated payloads. antd `Modal`/`Drawer` render
through a portal that `renderToString` will not traverse — extract the body into
its own component if it needs asserting (that is why `ConnectSourceWizard` is
separate from `ConnectSourceModal`). Delete the scratch files afterwards.

**Three things `renderToString` will not show you, and all three fail quietly.**
A zustand-driven component renders the store's **initial** state — zustand v5
passes `getInitialState` as the server snapshot — so loading the store first is
not enough; shim `React.useSyncExternalStore` in the scratch file (see
`docs/REGRESSIONS.md`). Anything expanded by a `useEffect` (the dictionary's
column and entity tables) is absent, so assert those against the payload. And
antd's virtualised `Tree` may render no leaves without layout. Each of these
turns an "absent" assertion into a pass over nothing: **whenever you assert that
text is missing, assert in the same run that the render had its data.**

## Architecture

A single-tenant data-governance console. Six feature pages plus a dev-only
`db.json` editor, all reading from a zero-dependency mock API.

```
mock-server/db.json ──► mock-server/server.mjs ──► /api proxy ──► src/api/client.ts
                                                                       │ validate
                                                                       ▼
                                                                  src/store/*
                                                                       │
                                                                       ▼
                                                              src/pages, src/components
```

**Data flows one way and every layer has one job.** `db.json` is the only source
of data; `server.mjs` shapes it and holds mutable run state; `client.ts` fetches
and validates; the stores hold state and own all error handling; components read
the stores and render. Never call `client.ts` straight from a component unless it
is a one-shot read with a local `try/catch` (see `EditDatasetsModal` and
`EditFoldersModal`).

### The mock server (`mock-server/`)

Zero dependencies on purpose — the audit gate makes every added package
expensive, and a mock backend is not worth widening the dependency surface.

**What it is seeded with is one source per connector, and no more.**
`projects` holds a single BigQuery project — `vrio-contextweave-demo`, display
name *EPA Hazwaste*, one dataset `epa_hazwaste` (US) carrying the five Gold
business views the demo document specifies (`e_manifest` 50 · `e_manifest_all`
92 · `RCRA_compliance` 30 · `RCRA_Compliance_Summary` 9 ·
`FRS_Facility_profile` 25 = **206 columns**). `drives` holds a single shared
drive, *Compliance Docs*, one folder `08_unstructured`, seven EPA
enforcement PDFs. `google_account` is `nishant.srivastav@vriodigital.com` —
the fallback the consent callback names when a caller sends no `as=`.

**The `epa_hazwaste` columns are real, and `column_profiles` holds them.** All
**206**, ingested from the demo package's `02_profiling/Metadata_Profiling.xlsx`
(one sheet per view) and keyed `<dataset>.<table>`: label, type, description,
semantic class, derivation, confidence, PII, null % and distinct count.
`tableDictionary` serves that verbatim and only falls back to `synthesiseColumns`
for a table with no entry — the fallback is a fallback, and `check-docs` asserts
both that the branch exists and that every view's profiled count equals the count
the catalogue advertises. The workbook is the source of truth; re-ingest rather
than hand-editing 206 entries. Its `null_pct` values carry float noise
(`88.09999999999999`), rounded on the way in so the UI never prints an artefact of
binary floating point as a statistic.

**The documents' *resolutions* are real too, in `document_extractions`.** Keyed by
`document_id`, ingested from `08_unstructured/Entity_Extraction_Map.xlsx`: the
extracted entity, the graph facility node it resolved to, its state, and the count
of inbound manifests that node already carries. `documentDictionary` reports it as
the document's `resolution` (null when nothing matched) and **does not fold it into
the synthesised entity list** — a read fact and a hashed one must not sit in one
column looking alike. Two documents about one facility share a node; that is
entity resolution, not duplication. The entity *list* stays synthesised because the
map describes one entity per file, not the dozens a 96-page decree holds.

**A view states its `label` and its `grain`; a document states its
`doc_type_label` and its `linked_entity`.** These are not decoration: `e_manifest`
is unreadable without "one hazardous-waste shipment (manifest)", and
`linked_entity` is the join from a consent decree to the company on the
structured side, so it is read from `db.json` and never synthesised. `validateDb`
checks all four *inside* the nested arrays, and `check-docs` checks them before
boot.

`db.json` is read once at startup into a `db` object that every route closes
over. Two kinds of state live here:

- **From `db.json`** — projects/datasets/tables, drives/folders/documents,
  credentials (`credentials` for BigQuery, `drive_credentials` for Drive), the
  audit / traces / evals payloads, change signals, `column_profiles`,
  `document_extractions`, `column_vocabulary`, `document_vocabulary`.
- **In memory, lost on restart** — `registered` (sources added through the wizard,
  including their profiled tables/documents, column notes and document
  summaries) and `profilingJobs`.

Consequences worth knowing before debugging:

- **Editing `server.mjs` requires a restart**, and that clears every registered
  source. A server started before a shape change keeps answering with the old
  fields — `listSources` has a targeted check for exactly this that tells you to
  restart, because the symptom is otherwise blank ids and `Invalid Date`.
- **`validateDb` runs at startup too, and the server refuses to boot when it
  fails** — naming the missing keys and the restore command. A document a stale
  process wrote back can be missing keys no route touched, and without this the
  first symptom is `undefined is not a function` deep inside a route.
- `PUT /db` writes via temp-file + rename, then mutates the in-memory `db` in
  place. That in-place mutation is what makes an edit take effect without a
  restart; reassigning `db` would break every route's closure.
- `validateDb` in `server.mjs` guards the required top-level keys, so the `/db`
  editor cannot save a document that would crash the app. There are 25 required
  keys, and the newer ones are as required as the originals: removing `drives`
  breaks the connect wizard, and removing `graph_domains` breaks step 1 of New
  Graph — not just a catalogue page. `column_profiles` and
  `document_extractions` are required for a subtler reason: losing either does not
  throw. The first silently swaps the profiler's 206 real columns for synthesised
  ones; the second turns every document's "resolved to `FAC:…`, 28 linked
  manifests" into "nothing resolved yet". Both read as an answer.
  `graph_studio.sanity_checks` is nested rather than top-level but is required for
  exactly the same reason: without it the Query tab falls through to the live walk,
  which abstains on a question the recorded set answers in full — and an abstention
  reads as "the draft cannot answer this", which is the finding that tab exists to
  report.
- **`validateDb` also checks *across* keys, not only within one.**
  `graph_use_case_templates` holds nothing but ids into `graph_personas`,
  `graph_kpis` and `graph_hero_questions`, and an id that does not resolve
  would not throw — it would drop out of the bundle, and the step would draft
  five personas where the use case names six. A short list reads as an answer,
  so the server refuses to boot and names the id. `check-docs` asserts the same
  thing, so it fails the build before it can fail a boot.
  Two more of these guard the studio: a canvas edge whose endpoint is not a node, and
  a **sanity check that walks a node or edge the canvas does not have**. Both fail the
  same silent way — the check still reports "graph can answer this" while the canvas
  highlights one hop fewer than the answer claims.
- **`commitDb` validates before it writes, not only in the `/db` editor.** Every
  writer hands it the whole document, so a server that started before a key was
  added to `db.json` would write its stale copy back and silently drop that key.
  It now refuses and says to restart. This is the stale-server pitfall with
  teeth: it has already eaten a key once.
- **`graph_use_cases` is the one collection the UI writes back to disk.**
  Registered sources live in memory and die with the process; a saved use case
  goes through `commitDb`, so a draft survives a restart. That asymmetry is
  deliberate — a half-finished graph brief is the user's work, a mock
  registration is not.

### Connection gating

Nothing exists until a source is connected. `/audit`, `/traces`, `/evals` and
`/change-signals` return **empty collections plus `connected_sources: 0`** when
no source is connected, and each page renders `NoSourceConnected` instead of its
cards. A *disconnected* source counts as not connected, but stays listed on
Sources so it can still be deleted.

Profiled counts are deliberately 0 on registration: registration is instant,
counts only land once the profiler has run. Do not "fix" this by populating them
from `db.json`.

**A source must be named, and the name must be at least `SOURCE_NAME_MIN` (6)
characters.** All three register endpoints (`/sources`, `/sources/drive`,
`/sources/generic`) run the same `sourceNameProblem` and refuse with a sentence
naming the length; `src/data/sourceName.ts` is the client half, and `check-docs`
fails if the two numbers drift or an endpoint stops checking. **There is no id
fallback** — `source_name || project.display_name || project_id` made the field
optional in practice and produced rows named `vrio-contextweave-demo`, which reads
as a name and is not one. Do not reintroduce one to "be lenient": the label is
what the Sources table, the Catalogue tab and every job row key off, and nothing
downstream can make `db` readable.

### Two connectors, one shape

BigQuery (structured) and Google Drive (unstructured) are both real, and Drive
is deliberately a mirror rather than a parallel universe:
project→dataset→table becomes drive→folder→document, `datasets` becomes
`folders`, `profiled_tables`/`profiled_columns` become
`profiled_documents`/`profiled_entities`, and every endpoint has a twin
(`/sources/drive/preview`, `/sources/drive`, `/browse-documents`,
`/profile-documents`, `/documents`, `/folders`). A source's `kind`
(`bigquery` | `gdrive`) picks the path.

**Each endpoint refuses the other connector's source with a 400 that names its
twin.** Answering a Drive source's `/browse` with an empty dataset list would
read as "nothing to profile" and send you debugging the allowlist instead of the
call. When adding an endpoint for one connector, add that guard to both.

Three things the mirror deliberately does *not* make identical:

- **Consent is scoped to the connector.**
  `/sources/oauth/start?provider=bigquery|drive` issues a state remembered *with*
  its provider, and the callback rejects a state replayed against the other one.
  Drive asks for **two** scopes (`drive.metadata.readonly` to list files,
  `drive.readonly` so profiling can read one), BigQuery for one
  (`bigquery.readonly`) — and the consent screen renders the list the endpoint
  returned rather than a copy held in the client, so it cannot describe fewer
  permissions than are being asked for.
  The callback returns the account and a **session**; the account it names is
  **whoever is signed in**, passed as `as=<email>` because the identity is
  client-held and the server has nothing to look it up from (`db.google_account`
  is the fallback for a caller that names nobody, and a malformed `as` is a 400
  rather than a quiet fall back to that seed). What that account can see
  is a second call (`/sources/oauth/projects` / `/sources/oauth/drives` — twins,
  each refusing the other's session). All three are **paced**
  (`CONSENT_START_MS`, `CONSENT_MS`, `DISCOVERY_MS` ≈ 3.1s) — signing in is not
  instant or silent, for the same reason a model call is not. Errors are never
  paced. **A stage advances when its request returns, not on a timer** — so add a
  stage only when there is a call behind it.
  **There is no sign-in popup.** One button runs all three calls with
  `GoogleConsentPanel` inline beneath it, a row per call, listing the scopes the
  response reported. A Google-styled click-through window was built and removed on
  request — do not re-add one unasked.
- **The document dictionary reviews files, not fields.** Its facets count
  *documents* (`pii` means "holds at least one PII entity"), and the editable note
  is the document's `summary` via `PATCH /sources/:id/documents` — extracted
  entities are machine output and read-only. `documentDictionary()` synthesises
  them from `document_vocabulary` exactly as `synthesiseColumns()` does from
  `column_vocabulary`: sliced by hashing the document id, statistics from a hash
  of document+entity, so repeat requests agree. Both suffix a repeated name
  (`_2`) only when *that* table or document has already used it, never on the
  vocabulary's second lap — the slice starts at a hashed offset, so lap-based
  suffixing printed a `_2` whose `_1` appeared nowhere.
  **Its four type facets are the corpus's kinds, not a taxonomy.** Consent
  decrees / Complaints / Settlements / CAFOs, matched on `doc_type`; a
  consent-decree *modification* files under `consent_decree` and says so only in
  `doc_type_label`. The map exists twice — `FACET_FOR_TYPE` server-side,
  `TYPE_FOR_FACET` in `ProfiledDocumentsPanel` — and `check-docs` asserts the two
  agree and that every seeded `doc_type` has a bucket, because a facet stuck at 0
  reads as "none in this corpus" rather than as a broken map.
- **Only the two real connectors get a wizard branch.** `isBigQuery` / `isDrive`
  (together `isGoogle`) run consent → preview → finish and keep the dialog open on
  Finish. The five stubbed connectors still fall through to the generic field loop
  and `POST /sources/generic`, which registers a bare row and closes.

### The profiling pipeline

`POST /sources/:id/profile` and `POST /sources/:id/profile-documents` return
**202 with a `queued` job** and drive it through `PIPELINE` or `DOC_PIPELINE`
(5 stages each — kept equal so a job row reads the same either way) on timers,
committing objects as they go. This is why `ProfilingJobsTab` polls (3s, only
while `active_count > 0`) and why starting a run switches the Catalogue to the
jobs tab — a queued job is otherwise invisible. Already-profiled objects are
skipped; an all-skipped job completes instantly rather than faking a run.
`force` is still a server parameter, but the only UI that sets it is the
**Force** button on a row in Profiling jobs — the browse panels never force.

A forced commit **updates the existing record in place** instead of pushing a
second one, so `profiled_tables` cannot double while `profiled_at` still moves.

A job's work list is `objects` (`{parent_id, object_id, label, units, state}`)
with `kind` and `unit` on the job, never `tables` — one board carries both
connectors' runs, and a re-run posts back to the endpoint its `kind` names.

### The New Graph wizard (`/new-graph`)

Seven steps — Domain, Personas, KPIs, Sources, Hero questions, Answer
requirements, Entities & relationships — over `NewGraphPage.tsx` → `graphStore`
→ `/graph-domains`, `/graph-personas/suggest`, `/graph-kpis/suggest`,
`/graph-sources`, `/graph-questions/suggest`, `/graph-answer-formats/suggest`, `/graph-coverage` and `/graph-use-cases`.
**All seven steps are built.**

**Steps unlock in order, and one function decides it.** `stepIssue(step, draft)`
in `src/data/wizardSteps.ts` is the only definition of "this step is complete" —
`Next`, the stepper's lock and step 7's build button all read it, so they cannot
disagree. A step past `maxStep` renders locked but stays clickable, and says what
is missing. Back is always free; jumping forward re-checks the steps in between,
because an answer can be deleted after it was given. Add a new step's rule there,
not in the page. Server-side only step 1's domain is enforced (`step > 1` or a
commit without one → 400) — a later step's rule would stop **Save draft** from
keeping partial work.

**A model call is never silent or instant.** The derivation between steps 6 and 7
is a real async run (`POST /graph-derivations` → 202, poll by id) that reveals its
entity names and its cost as it goes, and every `Suggest … (LLM)` response is held
for `SUGGEST_MS` so the drafting state can be seen. Both are paced for the same
reason `PIPELINE` is: an operation that returns instantly and shows nothing
teaches that it is free, and this one is not. Never show a cost figure the server
did not report.

**Step 7 derives only from what is profiled.** `graphCoverage` walks the source
picks back to real profiled objects, so an entity names the table it came from
(`manifest_header (1,240,500 rows)`) and a relationship is claimed only where two
objects share an identifier column in the dictionary. A hero question no profiled
column covers becomes a **gap**, and **the build stays blocked until every gap has
a decision** — that gate is the point of the step, so do not let "Save & build"
proceed past an undecided one.

**Step 6 declares, it does not decide.** Citations and answer formats are chosen
by the use case so the engine never picks a render format at runtime — the note
on the page says so, and `answer_formats` is stored self-describing
(`{ format_id, name, format }`) so editing the pool cannot rewrite what a saved
brief promised. Its formats load on arrival rather than behind a Suggest button,
because the step picks *between* them rather than accumulating them.

**Step 5 is not one of them.** A hero question is a sentence plus a High flag,
not a name plus a description, so `HeroQuestionsStep` is its own component —
forcing it into `DraftedStep` would have meant a second text field nobody wants
and a priority concept the other steps do not have. It still shares the
suggester: `suggestFrom` reads `text` where the other pools carry `name`.

A pool question may carry its own `priority`, and where it does the suggestion
arrives with **High already ticked** — a use case that stated the priority
should not make the user re-derive it. It pre-fills rather than decides:
`highMarks[s.id] ?? s.priority === 'high'` lets an explicit tick or untick win,
because accepting a question is still the user's act. `priority` is the only
optional field on a `Suggestion`, so its schema is
`nullable(oneOf(['high','normal']))` — personas, KPIs and formats never send it.

**Steps 2 and 3 are one component, not two.** Personas and KPIs are the same
interaction — let the AI draft a list, add what fits, type your own, see which is
which — so `DraftedStep` renders both and they differ only in copy. Server-side,
`suggestFrom` serves both pools and `normalizeDrafted` stores both lists; the
payload shape is `{ id, name, detail, why }` either way. A later step wanting the
same pattern should reuse it rather than add a third copy.

Two rules the copy on the page promises, and the code has to keep:

- **The step labels live in `server.mjs` (`WIZARD_STEPS`) and reach the page in
  the `/graph-use-cases` payload.** The stepper renders that list and the server
  validates `step` against the same one, so a step cannot exist in the UI that the
  API would reject.
- **Domains are ranked by what the connected data supports, not alphabetically.**
  `fit` is seeded per domain in `db.json` but downgraded at request time: a domain
  cannot claim it is "already profiled" while the tenant has profiled nothing, so
  with no sources connected the ranking legitimately differs from a screenshot
  taken with data. `strong` → `partial` → `none`, then the seeded `rank`.

- **A suggestion always says why it was suggested.** There is no model behind
  "Suggest personas (LLM)": `suggestedPersonas()` ranks the `graph_personas` pool
  by keywords found in the business need, then domain fit, then a hash of the
  brief — so the same brief always drafts the same four, and each carries a `why`
  the UI prints. A suggestion nobody can explain is worse than no suggestion.

- **A brief that *names* a known use case gets that use case's own list, not a
  ranking.** `graph_use_case_templates` holds the tenant's use cases as id
  bundles — one today, *Cradle-to-Grave Compliance & Liability Intelligence*,
  ingested from `03_use_case_wizard/Use_Case_Wizard.docx` along with the 4
  personas, 7 KPIs and 13 hero questions it names.
  `matchTemplate` claims one when the brief contains at least
  `TEMPLATE_MIN_PHRASES` (2) of its `match_phrases` — which are drawn from its
  own description, so pasting that description in hits all of them. A match
  returns the members **whole and in the template's own order**, past the 4/5
  keyword limit, because a template is a stated answer rather than a ranking and
  truncating it would drop members the use case explicitly claims. The `why`
  becomes "named in the … use case" and `derived_from` names it too, so the
  bundle is as explainable as the ranking it replaced.

  **A tie matches nothing.** Two templates scoring equally means the brief named
  neither, so it falls back to keyword ranking rather than picking one — which
  is why `check-docs` asserts every phrase is unique to its own template **and
  present verbatim in it**; two of the current template's phrases were
  paraphrases of its description on the first attempt, and the check caught both.
  Only personas, KPIs and hero questions are templated; step 6's answer formats
  have no `memberKey` and stay ranked, because a use case states what it must
  answer, never how to render it.

  **`detail` is what a suggestion is *for*; `why` is why it was drafted.** They
  are two fields because they answer two questions, and neither may stand in for
  the other — a hero question whose `why` was replaced by its purpose stopped
  saying it had been keyword-matched. A persona's `detail` is its `focus`, a
  KPI's is its `definition`, and a hero question's is the `rationale` the brief
  stated for asking it ("the core liability question — connects inbound manifests
  to generator compliance records"). That slot was empty before, which is why
  drafted questions arrived with a name and nothing else while personas beside
  them explained themselves.

  **No suggestion states a priority its brief never stated.** The current use
  case marks no question High, so none arrives ticked; the user decides in step 5.
  `priority` is still honoured where a pool entry carries one.
  An added persona is `{ name, description, source }` — `source` records whether
  the AI drafted it or a user typed it, which is what the **AI-DRAFTED** /
  **USER-DRAFTED** tag reads from. Both are provenance, so they use brand and
  neutral tints rather than a `STATUS` colour: neither is a state. `normalizePersonas` trims, de-duplicates and accepts the bare
  string an older draft holds, but a persona with no name is a 400, not a silent
  drop.

- **Step 4 lists profiled state, not registrations.** `/graph-sources` walks the
  connected sources' committed `profiled` / `profiled_docs` and reports each
  object in the connector's unit (`columns` / `entities`). A source with nothing
  profiled is returned with `object_count: 0` and refused if picked — listed but
  disabled, because "not profiled yet" and "not connected" are different problems
  and only the user can fix either. `mode: 'all'` is stored rather than expanded,
  so a table profiled later is included without editing the draft.
- **Step 4 is the one step that cannot be skipped empty.** Nothing connected
  shows `NoSourceConnected`; connected-but-unprofiled shows an error linking to
  the Data Catalogue; and `Next` refuses with the fix for whichever case applies,
  because every later step derives from this selection.

The user never types an entity name — that is the product premise, so do not add
an entity field to any step. Step 7 confirms what the AI derived. Personas are
lightweight tags that shape questions and tone; they are **not** access control,
and nothing in this flow should start treating them as permissions.

### Graph Studio (`/graph-studio`)

Where a *built* graph becomes a published one. **The studio lists graphs, it is
not one graph** — `/graph-studio` shows every use case that has been committed on
step 7, and `/graph-studio/:useCaseId` opens that one's review. New Graph's
"Save & build graph" navigates straight to the new graph's studio, because a
committed brief is not a finished graph: what the deriver was unsure about is
exactly what a human has to settle.

**A draft is not listed, and opening one is refused with a 400 that says how to
fix it** — "not built yet" is a different problem from "no such graph", and only
one of them is solved by finishing the wizard. The draft *count* is still shown,
because it answers "where is my graph?".

**Nothing on a card is a decorative number.** `graph_studio` in `db.json` holds the
queue, the pivot and each bucket's total, all ingested from the package's
`graph_studio.json` **trust lanes** — `autoApprove` 398, `confirmedFyi` 12,
`mustReview` 6, `pivot` 1, and those sum to its `elements_total`. The must-review
lane is **entirely authored**: `must_review_total` equals the number of ingested
rows, so nothing synthesised pads the lane a reviewer has to clear. The two
spot-check buckets below it *are* synthesised by `studioItems`, the way
`synthesiseColumns` synthesises columns — by a hash that includes the **use case id**,
so every built graph gets its own sample and repeats agree — and confidence is
generated inside each bucket's band because the cards promise `0.85–0.95` and
`≥0.95`. They come back as a named `*_sample`, never a list pretending to be all 398.

**The queue is five rows plus the pivot, and the split is deliberate.** The package
ships six must-review decisions; `rq1` is the identity merge — Texas Molecular LP ⇄
VLS Texas Molecular — which is the one decision that changes what every other row
*means*, because it decides whether pre-acquisition tonnage is this facility's
history. So it is ingested as the **pivot** and the queue holds the other five. Its
arithmetic still matches the package's `mustReviewTotal` of 6, and `check-docs`
asserts the merge appears in exactly one of the two places: listing it in both would
ask one question twice and let a reviewer answer it two ways.

**A row's buttons are its own — its labels, not just its family.** Each row states
three, in its own terms: "Keep distinct", "Declare basis = manifest", "Leave
orphaned". The *choice* behind each is still one of the fixed set (`approve` keeps the
element, `correct` marks it studio-authored, `reject` drops it) because what a
decision means to the canvas has to be identical on every row. The server validates
against **the row's own `actions`** and names them in the refusal, and the page reads
that same list, so it cannot offer a button the API would reject. `action_set` remains
the fallback family for a row that states none — which is where the causal pair
(`approve-causal` / `downgrade-correlational`) still lives. A `schema-changing` row
cannot be resolved without a justification, enforced server-side, not merely shown.

**A row's `graph_refs` are not what it makes provisional.** The refs are the nodes a
row is *about*; the provisional set is the elements whose existence it is still
deciding, mapped explicitly in the ingest. Marking refs would dash the receiving TSDF
as a 0.68-confidence proposal because a waste-code modelling question mentioned it.
Two rows deliberately mark nothing: rq5 *declines* a promotion, so there is no node to
dash, and rq6 is about three attachments that fell below the floor and were never
drawn — an absence has no circle.

**The pivot is a separate precondition from the queue.** Clearing every row still
leaves publish blocked while it is open, because settling it changes what the
decided rows mean. `publish.blocked` and its `reasons` are computed once on the
server; the button's `disabled`, its tooltip, the banner and the publish refusal
all read that one list. Publishing makes the draft's *own* version live
(`draft v15` → `Publish v15…`); it does not mint a new number.

Decisions and the pivot live in memory, keyed `useCaseId:itemId`, so two graphs
cannot answer each other's rows.

**Building lives here, not in the wizard, because a graph is built more than
once.** `POST /graph-studio/:id/builds` answers **202 with a queued run** — the
same contract as a profiling job — and the **Build** tab polls it. Eleven stages
(`BUILD_STAGES`, `pin_inputs` → `a05_graph_construction`) tick over, every run is
kept in that graph's history, and an earlier one stays loadable. Settling review
rows changes what a build produces, so **Rebuild** is the normal case, not an
escape hatch.

**Each stage names its own substeps, and the substeps are what advance.**
`BUILD_STEPS` is `BUILD_STAGES` flattened — 31 substeps at `BUILD_STEP_MS`, **5s**
each, so a whole build runs ≈**2m 35s** — and a run keeps **one cursor** into that
list. Every state on screen is derived from it: a substep is complete before the
cursor, running at it, pending after, and a stage is `running` exactly while the
cursor sits inside it. A stage index kept alongside a step index is two counters
that can disagree, and the symptom is a stage reading complete while one of its
substeps still spins. Adding a stage means adding its substeps too — a stage with
none is a row claiming work nobody can see, which is what this replaced, and
`check-docs` fails on it.

**A build takes minutes, so the panel says how many.** 5s a substep is slow on
purpose — slow enough to narrate a row while it runs — which makes an unexplained
spinner read as a wedged process. `buildView` reports `step_ms`, and the note and
the "…left" figure derive from it: change the pace on the server and the page
follows. Never restate the number in the component; `check-docs` fails on any
hardcoded duration there, and on this paragraph disagreeing with the constant.

New Graph's "Save & build graph" commits the brief, starts the build **at the
click**, then navigates to this tab — so the pipeline on screen is that button's
run, not something this page kicked off on arrival. Do not move the build back into
the wizard, and do not let the commit stand in for it: committing is instantaneous,
which is exactly why it is stage one (`pin_inputs`) rather than the whole thing.

**A build does not publish.** It reports the draft version it produced
(`draft_version`, the same number the Publish button would make live) and says to
publish it from Versions; the gate is unchanged and still refuses while the queue
or the pivot is open. `package_id` and `graph_version` are minted **per run**, so a
rebuild is visibly a different package — reporting one id for both would say a
rebuild changed nothing.

**The six tabs are one truth, not six pictures.**

- **Canvas** draws the ontology as hand-written inline SVG — no graph library,
  for the same reason the mock server has no dependencies. Positions come from
  the server so a reload draws the same picture; dragging is local, because
  rearranging is for reading. **An element is "proposed" exactly while its
  review item is undecided**, so approving a row in the queue un-dashes its node
  here, and *correcting* one marks it `studio-authored`. The filter chips carry
  counts, so an empty result reads as "none match" rather than a broken chip.

  **What it draws is the demo package's own knowledge graph** —
  `05_knowledge_graph/knowledge_graph.json`, **189 nodes and 241 edges**, ingested
  into `graph_studio.canvas` by `npm run ingest:graph`. That script is the layout: it
  runs a deterministic force pass plus a separation pass and writes `x`, `y` and `r`,
  so **re-run it rather than hand-editing 189 nodes** — the same rule as the column
  profiles. It reads `graph_studio.json` from the same folder too, and reseeds the
  review queue, the pivot, the sanity checks and the synthesis pools, because a queue
  naming entities the canvas has never heard of is two truths again.

  **The graph is an index, not a copy, and that is the model — not a detail.** The
  package is spec-faithful AGB Layer 1 with three element classes: 7 `concept` nodes
  (type-level, one per entity type however many rows), 179 `thin_instance` nodes
  (identity + provenance *only* — no attributes, no measures, no dates), and 3
  `measure_element` nodes. Every figure a sublabel or an edge tooltip shows comes
  from the package's `demo_display` block, which is its cache of what Layer 2 would
  federate at query time. Do not move a value onto a node to make rendering easier:
  the separation is the thing being demonstrated.

  **Column values are no longer nodes, and that is a decision the package records.**
  The previous graph promoted distinct column values — 13 `WasteCode`, 9
  `ViolationType`, 5 `EnforcementType` — and `not_nodes` now lists all three with
  `was_wrongly` beside them: a code carried on a row is an attribute of the shipment,
  not an entity with its own registry. The events those columns described are nodes
  instead (40 `Evaluation`, 38 `Violation`, 31 `Enforcement`). `check-docs` fails if
  a retired type reappears on the canvas, and rq5 in the queue is the standing offer
  to promote them anyway — declined by default.

  Three things on the drawing are data, not styling, and none may be chosen for
  looks:

  - **The fill is the node's origin class**, which is the graph's own account of how it
    was built: a source row becomes an entity or event, an uploaded document becomes
    a document node, a raw name resolves through an alias, and `schema` is the pair of
    classes that are not instances at all — the type-level concepts and the measure
    elements. Four classes, not nine ontology types, because a categorical palette
    stops being reliably distinguishable past four and *any* two nodes can end up
    adjacent here. The hues are validated pairwise, and each carries an `ink` measured
    against its fill: white clears 4.5:1 on the blue and the magenta, not on the
    green. `check-docs` recomputes every pair. **`dimension` was the fourth class and
    was retired with the column-value nodes** — a legend row with no members
    advertises a claim the graph denies, so the hue moved rather than staying empty.
  - **The ring is the node's ontology type.** A second encoding rather than nine
    fills, so the canvas answers "what kind of thing is this" as well as "where did it
    come from" without a palette nobody can read. **A ring exists only where a fill
    carries more than one type** — `row` holds five and `schema` holds two, so those
    seven are ringed; `document` and `alias` hold one type each, and their fill already
    names it. That constraint is what makes the palette possible: a ring only has to
    separate its *siblings on the same fill*, never all nine at once. Four rules, all
    recomputed by `check-docs` — 3:1 against the page, 3:1 *or* a 40° hue turn against
    the fill inside it, and a 40° turn or 2:1 against a sibling. The ring is **its own
    circle, not a stroke on the disc**: a stylesheet rule beats a presentation
    attribute, and the disc's stroke is where the states are drawn.
  - **Size is degree.** `r` comes from the server, scaled by the square root of the
    relationships a node carries, so the receiving TSDF is the biggest circle
    because 61 edges land on it — not because it is the subject.
  - **`source` is the catalogue object** the node was built from
    (`epa_hazwaste.FRS_Facility_profile`, `Compliance Docs ·
    08_unstructured/chemours-cd.pdf`), on the node's tooltip and in the inspector.
    A node whose provenance is not on it is a claim the reader has to take on trust.

  **The reader can move the view, and that is what reveals the labels.** Scroll zooms
  about the cursor, dragging the background pans, and **Reset view** appears only once
  either has moved. Both are hand-written — `getScreenCTM` does the client-pixel → view
  → graph conversion, so nothing has to reproduce the viewBox letterboxing — and both
  are local, like the node drag: the server's positions are still the picture. The
  wheel listener is registered with `{ passive: false }` **by hand**, because React
  registers `onWheel` as passive and a passive listener cannot `preventDefault`, so the
  page scrolls behind the zoom.

  **Labels appear when they can be read.** A node big enough carries its name inside,
  wrapped; the other 159 are labelled *beside* it — the label of a 23px node is four
  times its width, so stacking those underneath is what made them collide — and they
  arrive once the view can hold them: **zoomed past `LABEL_AT_ZOOM` (1.35×)**, narrowed
  by a filter to 28 nodes, or hovered. Edge labels follow the same rule. Every label is
  cased in the page colour with `paint-order: stroke`, or it is illegible exactly where
  the graph is densest. The threshold is stated once and the hint interpolates it;
  `check-docs` fails on a hardcoded copy.

  **Clicking a node dims everything outside its neighbourhood**, and a note says what
  is shown and how to undo it. At 189 nodes "which of these lines are mine" is not
  answerable by looking, so this is the interaction that makes the picture readable. It
  is the *neighbourhood* rather than the node, because a node with nothing around it
  explains nothing — and it is on click, not hover, because dimming that follows the
  pointer is a strobe.

  **The legend is both filters.** Two axes, fill and ring, each row carrying its count
  from the server's `facets`, so one control cannot disagree with itself about what a
  colour means and what it shows.

  **An edge whose endpoint is not a node is refused at boot.** An earlier package
  shipped 20 of them — three alias names and an unitemised enforcement type its
  roster omitted — and a skipped edge is silent: 17 facilities simply appeared to
  have no enforcement. `validateDb` checks the endpoints across keys. **This build
  resolves cleanly**, so the ingest no longer materialises anything and *throws* if it
  has to: `check-docs` asserts the canvas is exactly the roster, because a canvas
  bigger than the package means something is being invented again.
- **Query & sanity-check** asks the *draft*, by one of two routes, and the answer
  always says which.

  **A recorded check wins, and names itself.** `graph_studio.sanity_checks` holds the
  five the package wrote (from `graph_studio.json`) — a hero question, a verdict, the
  context chips, the Cypher the engine would plan, its cost against the budget, and
  the sub-graph it walks. Served exactly the way `ask_answers` is: matched on the
  question at **the same `ASK_MATCH_MIN`**, so the studio cannot pass a question Ask
  then declines, with `recorded: true` and `check_id` on the payload so a written
  verdict is never read as something the walk derived. Anything unrecognised falls
  through to the walk, which abstains.

  **A recorded check is not exempt from the caveats.** They are computed from the
  edges it actually used, so sc1 — which rides the Chemours `DESCRIBED_BY` edge that
  rq2 has open — is answerable *and* flagged provisional. That is the whole point of
  keeping one canvas behind both surfaces.

  **A recorded traversal is a sub-graph, not a chain.** `path_labels` is empty on a
  recorded check and the hops are listed from `edges_used` instead: sc3 walks three
  generators and three enforcement actions that all meet at the receiving TSDF, and
  arrow-joining those seven ids would claim a route nobody walked.

  The walk itself is a real breadth-first search over the edges that exist, and its
  path is what lights up on the canvas — the answer carries the marked canvas back
  with it, so there is no second request and no second truth. A question naming one
  entity, or two that nothing connects, is **not answerable and says why**. Matching
  needs the whole label or a word that is **rare and not a type name**: a word naming
  more than 5% of the nodes ("texas") names none of them, and a word from the
  ontology's own vocabulary ("facility", "waste" — read off the node types and edge
  labels, not a hand-written list) cannot name an instance. **Nor can a concept
  node**, whose label *is* a bare type name — the whole-label shortcut has to clear
  the same stoplist, or "the Denka facility" resolves to `CONCEPT:Facility`. The rule
  used to be "unique to one node", which refused to match "chemours" the moment a
  facility and the consent decree about it shared a name — the bridge from
  unstructured to structured that this graph exists for.
- **Quality report** re-runs the same three preconditions the publish gate uses.
- **Versions** lists **every version, which is to say every build** — newest
  first, one row each, from `studioVersions`. A row carries what identifies it
  (`sha256`), what it is (`entities`, `relationships`, `graph_id`), where it came
  from (`from_job`), the config it is a version of (`config_version`), and whether
  the gate had passed when it finished.

**A version is content-addressed and immutable.** `sha256` is its identity: two
builds of one brief differ there and nowhere else, which is why several rows read
`v2`. **Publishing flips a pointer, it never rewrites a row** — `studioLive` holds
one content hash per graph, `published` on each row is computed from it, and
unpublishing clears it. The copy on every row says exactly this, so it has to stay
true: *immutable — content-addressed; publishing gates Ask access, it does not
mutate this graph.*

**Publish and unpublish, and nothing between them.** An earlier model separated
three acts (publish → approve → activate); that was collapsed on request. What was
lost is explicit: there is **no recorded human sign-off**, and a rollback is
publishing an older row rather than activating an approved one. What survives is
the part that protects correctness — the gate still refuses an unreviewed graph
whichever row is chosen, and Ask still refuses anything unpublished. **Publishing
an older row is the rollback**, and it works because any row may be published.

**The config version moves when the brief does.** `configVersion` is bumped by
committing a brief — not by a build and not by a publish — so every build of one
brief shares a label and they are told apart by content. A version counter that
moved on publish would relabel history.

**Publishing names a build, so it happens on that build's row.** There is no
header publish button: "Publish v2…" could not say which of six builds it meant.
The header shows the loaded job instead. Do not add a header publish button back.

### Ask (`/ask`)

Where a *published* graph gets used. **Ask queries the published version, and only
that one** — `GET /ask` lists the graphs `publishedVersion()` returns a row for, so
a draft is absent, a built-but-unpublished graph is absent, and **unpublishing
takes a graph out of Ask immediately**. It reports the content it answered from
(`graph_id`, `sha256`), because "which build answered this" is a question a reader
is entitled to ask. Both are still counted (`built_count`, `draft_count`), because
"finish the wizard" and "press Publish" are different fixes and the empty page
has to name the right one. `POST /ask` refuses an unpublished graph with the
sentence that says so.

The walk is the studio's (`studioQuery`), deliberately: the sanity check that
passed before publishing cannot then disagree with the answer after it. What
Ask adds is the part a reader can audit — the entities the question was
grounded in, the relationships that carried it, and a confidence that is the
**weakest node on the route**, not a flourish.

**An abstention is an answer.** When nothing matches, or two matched entities
have nothing between them, `answered` is false, `reason` says which, and
`answer`/`confidence` are `null` — no number is invented to fill the field, and
the page tags it `warn`, never `crit`. A query engine that always produces a
paragraph is a search box with better manners.

**Nothing on the page is written copy pretending to be data.** The version, who
published it and when come from the publish record; the standing caveats are
step 7's gap decisions read back through `GAP_CAVEAT`; the citation policy is
step 6's; and the suggestion chips are the use case's own hero questions — a
chip is a promise the brief already made.

**The answer is streamed, and the recorded one wins.** `ask_answers` holds the
tenant's 40 written answers (from `06_queries/query_set.json`) as ordered
**blocks** — text, metric, chart, table — with evidence and a stated confidence.
`matchAskAnswer` serves one for the same question, or one sharing ≥ `ASK_MATCH_MIN`
(0.6) of the asked words and beating the runner-up; a tie matches nothing, and
anything unrecognised falls through to the graph walk, which abstains. Every
recorded answer names **which** it was, so a written answer is never read as
something the walk derived.

`POST /ask` answers with `text/event-stream` — `stage`s, then `summary`, then one
`block` at a time, then `done` with the whole envelope. `askQuestionStreaming`
validates **every event** and `done` as one object; that object is what the store
keeps, so nothing on screen was assembled from unchecked fragments. Pacing is
per-piece (`ASK_STAGE_MS`, `ASK_BLOCK_MS`) rather than one hold, so a five-block
answer legitimately takes longer than a one-line abstention. Refusals stay plain
400s **before the stream opens**: an error must never arrive as an event inside a
200, and refusals are never paced.

**Charts are hand-drawn SVG, and the form comes from the data's job.** No chart
library, for the reason the canvas has none. A 2-slice donut renders as a meter, a
≤ 4-slice pie as a 100% stacked bar, a wider pie as bars — past ~7 classes the
answer is bars or a table, never more colours. One hue for magnitude; the four
categorical hues are validated and directly labelled. Every chart carries a
collapsed values table so nothing is colour-only, and status tints appear only on
a metric's `flag`, because a share is not a state. **Each chart caps `max-width` at
its own viewBox width** — an SVG scales its text with everything else, so without
the cap a wide column rendered 11px labels at 28px.

### The What-if lens (`/what-if`)

Where a load is judged **before** it is accepted. Ingested from
`09_What if lens/whatif_vls_data.json` by `npm run ingest:whatif` into `db.whatif` —
24 candidate generators with their federal records, 4 watchable measures, 4 candidate
pools, and every string the page prints.

**It is a read-only overlay and nothing on it writes to the graph.** The copy says so
three times, so the code has to keep it: `POST /whatif/scenario` computes and returns,
storing nothing, and the saved library holds **generator ids, never figures**. That is
the whole reason computing is a call rather than a calculation — a saved scenario
re-opened next week shows next week's record, and a store that cached the numbers would
be caching an answer that quietly went stale.

**Two tabs are two jobs.** *Authoring* sets the frame — which governed measures are
watched, which pool a scenario may draw from, how many columns to compare — over three
steps, each narrowing the next, so the rail is clickable backwards only. *Runtime* swaps
loads inside that frame; every figure recomputes on the server.

**The connection gate replaces the lens, header chrome included.** `GET /whatif` returns
its copy whether or not a source is connected, so the page's banner ("built on the real
demo graph — 36 inbound generators") and its provenance note used to print above
`NoSourceConnected` — a claim about data one line above the sentence saying there is
none. The whole lens lives in `WhatIfLens`, rendered only when `connected_sources > 0`,
so the gated branch has no source-derived copy to leak; only `PageHeader` is common to
both, as on every other gated page. `check-docs` asserts the split both ways.

**A measure must ground before it can be watched, and the graph decides.**
`POST /whatif/resolve` answers with one of three verdicts: `resolved` adds the measure
it grounded to, `grounds_not_inherited` explains that the measure is real but measures
the wrong thing (tonnage measures the Manifest, not inherited risk), and `refused` says
nothing in this graph resolves it. **The keyword list is deliberately absent from
`GET /whatif`** — a client holding it could answer for itself, which would make the
refusal theatre. `check-docs` asserts it never reaches the payload. Paced like the
suggesters, because a resolution that returns instantly reads as a lookup in a list the
client already had.

**Every figure names the federal source it came from**, and a measure reports three
different things: `inherited` (what the load brings), `baseline` (what the facility
already carries) and `value` (the sum, judged against the appetite line). A measure with
no baseline — a consent decree is not something a facility keeps a running count of —
reports `null` rather than `0`, because 0 would be a claim. A load that moves nothing
says so instead of printing "+0".

**The breach rule is real but currently unreachable, and that is the data's answer.**
`enf` breaches at the facility's 10-action appetite; the baseline is 0 and the largest
single load carries 4, so one load cannot cross it. Headroom is the measure that answers
"how close am I" — the package's own formula, computed per pool at ingest — and it says
5 more enforcement-carrying loads. Do not manufacture a breach to exercise the styling.

**Both graph references are drawn, and the drawing is the payload's.** The pool step opens
a **frame** — every candidate in the pool, fanned into the facility they ship to — and a
runtime column opens the **traversal** one admitted load makes: its evaluations, violations,
enforcement and any consent decree, into the generator, into the TSDF. Hand-written inline
SVG in `WhatIfGraph.tsx`, no library, for the reason the studio canvas has none.

What each drawing asserts comes from the data: the node types, their labels and their
**colours** are `graph_reference.node_types` (the package's palette, so a component is not
inventing a legend); the frame's centre, edge name and 7-node cap are
`graph_reference.frame`, and the cap is stated on the drawing because a fan of seven standing
for twenty-four is otherwise a silent sample; and a scenario's nodes and **edges** are
computed server-side from what the generator carries, every edge label taken from the graph's
own relationship list — `check-docs` asserts the subset. A clean load draws no enforcement
node and one under no decree draws no document: **an absence has no circle**, the same rule
the studio canvas follows. The component decides only *where* a circle goes, because these
are two fixed schematics rather than a layout over an unknown graph.

**Nothing is predicted.** Every figure is a record the graph already holds. `residual`
is stated on every scenario — risk from records not yet connected to a generator — so a
reader does not take the figures for the whole picture, and a clean load says "nothing
connects" rather than showing an empty trace panel.

`whatif` is the 24th required `db.json` key, and `validateDb` checks *across* it: a
measure reading a field no generator carries would render as no inherited risk, a pool
filtering on a missing field would offer nobody, and a `resolvable` naming no measure
would report "Resolved — added" and add nothing. All three read as answers.
`npm run ingest:whatif` checks the same references against the package and refuses to
write.

### Reports (`/reports`)

The five reports written for this tenant, plus the ones a user composes, in **three tabs** —
**Library**, **Author**, **Operations & audience**. Library is one grid of every governed
definition, written and composed alike, told apart by `kind` rather than by which array it
arrived in; each still opens at its own URL. Two grids was the earlier model, and it listed a
composed report twice as soon as the second grid was added. `/reports/new` authors one, `/reports/saved/:savedId` opens a composed one, and
`/reports/:reportId` still renders a written one — reached from the wizard or by URL rather
than from a grid. `reports` is the **25th** required `db.json` key, seeded by
`npm run ingest:reports` from `07_reports/`, and its nav entry was a roadmap placeholder
until this page landed.

**One template renders all three** — written, built in the wizard, opened from the library.
`ReportView` is that template, and `check-docs` fails if a surface re-implements it: the
package ships five reports with a fixed anatomy (heading, the facility it is about, a lead
note, the question, four tiles, the blocks, a footer stating source and confidence), and a
composed report is that same anatomy asked under a different frame. The wizard's own copy of
the layout had already drifted — no badge, its own tag row, a different footer — which is
two answers to "what does a report look like".

**A report is asked of the published graph, and that is the *only* gate** — the same
precondition as Ask. Nothing published → `NoPublishedGraph`, which names the fix that
applies from `built_count` / `draft_count` ("publish the build you have" and "finish a
draft" are different actions). **A connected source is deliberately not a second gate**:
publishing a graph is already downstream of having something to build it from, so a source
check in front of it only tells the reader to fix something that is not stopping them.
`connected_sources` still rides on every payload for the pages that report it, and gates
nothing. **The What-if lens shares the one rule** — it is a read-only overlay *on the
knowledge graph*, so there is nothing to overlay until one is published — and both pages
share `NoPublishedGraph`, the third `EmptyState` wrapper, so one precondition cannot be
described two ways. `check-docs` asserts that all four gated routes test publication alone
and that no report surface renders the source state. Publication lives in memory, so a
restart closes the gate again; that is already true of Ask and does not get a second
mechanism.

Every report names the published content that answered it (`graph`: name, version,
`sha256`) in its footer — the claim Ask already makes about its own answers.

**A report is a question re-asked, not a stored table** — the package's own lead note
says so, so `db.reports` stores no result. It holds four rosters (36 inbound generators,
5 comparator facilities, 14 quarters, 5 manifest traces), a field dictionary, the
assumptions a report is read under, and each report's *definition*. Every figure —
each chart's series, each table's order, every count on a card — is computed in
`reportView` on each request, so the page renders numbers rather than arriving at them.
The rule is the What-if headroom's: arithmetic on a measure in a component is a second
source for it.

**The ingest reads two files per report, because they answer two questions.**
`report_authoring_data.json` is the data and the five report definitions (`starters` —
a question, a spine, and its blocks). Each `Report_N_*.html` is the *rendered* report,
and its heading, subtitle, badge, lead note, four summary tiles and footer are copy the
tenant wrote about that one report and which the JSON does not carry. They are joined on
the starter's own `report_tag` ("Report 2" → `Report_2_*.html`), never by position.

**The authored tiles are checked against the roster, and a mismatch refuses the write.**
A tile transcribed from a rendered page is exactly the figure that goes quietly stale, so
`npm run ingest:reports` recomputes 17 of them — 36 generators, 15 with enforcement
history, 1,200 manifests, 27,311 tons, 4 under a decree, $540k combined penalty — and
fails naming both numbers when one disagrees. That is what keeps a tile authored rather
than invented. `check-docs` re-checks the same identities against `db.json`.

**A report's scope is part of its question.** Four ask about every inbound generator; the
consent-decree report asks about the four under a decree, and its scope is applied in
`reportView` rather than baked into a copy of the roster. The ingest refuses unless a
scoped report selects exactly what its own tiles count, so `4 of 36` cannot drift into
`36 of 36` while the tiles still say four.

**Five block kinds, and every one has a renderer**: `chart`, `table`, `facilities`
(the scorecard, its subject row marked), `quarterly` (a trend plus its detail) and
`traces` (custody chains — a manifest's transporters are *ordered*, and an order laid
into a cell reads as a set). A `kpis` block is dropped at ingest: the tiles it names are
already the report's own, with a label, a unit and a tone a key list cannot express, and
rendering both would print one summary twice. `validateDb` refuses a block whose measure
or column its spine does not carry — a blank column reads as "no data" rather than as a
broken reference.

**Charts are `AnswerChart`.** A report's chart payload *is* an answer's chart payload, so
the same hand-drawn SVG draws both and there is no second set of rules about what a bar
means. Two consequences: the package's `bar`/`column` distinction collapses to horizontal
bars (the labels are generator names), and its one grouped chart becomes two
single-series charts, because one hue per magnitude is the rule that component keeps.
Rows carrying nothing are dropped rather than drawn as zero-length bars, and the note
says how many — 22 of the 36 generators have never been penalised, and **no cap is
silent**.

**What the dataset cannot answer is on the page.** Waste code, transporter and daily
volume are `avail: false` in the field dictionary, each with the package's reason, and the
section lists all three: "where is the waste-code breakdown" is a question the page
should answer rather than answer by omission.

Column headers for the three rosters the field dictionary does not describe live in
`REPORT_LABELS` in `server.mjs`. They are headers and nothing else — no figure, no
claim — and `check-docs` fails if a column reaches a table with neither a field label nor
an entry there, because the alternative is a header reading `gen_state`.

**Every line on a Library card is a served fact.** A card carries the definition's title, its
lifecycle state (`published` · `pending_approval` · `archived`, as a `StatusTag` with an icon and
a word), the report's own question in quotes, the tenant's lead paragraph, the as-of date of the
data it reads, the **floor** it stands on, and a governance footer: version, author, personas
entitled, refresh schedule, whether it is parameterized, and how it was approved. A pending or
archived definition states why in the tenant's words.

**What is authored and what is computed is a hard line.** `db.reports.governance` — seeded by
`node scripts/seed-report-governance.mjs` — holds only the decisions: state, version, author,
category, as-of, schedule, approval, and which personas each definition's audience names. Every
number and every cell is computed in `reportGovernanceView` on each request: the chip counts, the
floor line, `parameterized` (a spine with facets), the entitlement matrix, the audit rows and the
publish checks. A chip that counted its own filtered array would be a second answer to "how many
are published", and a governance grid is the worst place in the app to hold two.

**`governance` is required, and nested for the reason `graph_studio.sanity_checks` is.** Losing it
does not throw — the Library would render with no lifecycle chips and Operations with no gates, and
an ungoverned report section reads as one with nothing to govern. `validateDb` refuses it at boot;
the seed refuses to write a row naming a report or a persona that does not exist.

**The section is read *as* the signed-in persona.** `load(roleId)` forwards to
`GET /reports?as_role=…`, so the banner's "N entitled · M not entitled" is true of the reader —
and `createReadStore` now forwards arguments rather than the report section growing a store of its
own. An unknown role is ignored server-side, the safe direction for a control the copy calls a demo.

**Author is a permission, not just a button.** `may_author` comes from the persona's data-scope row,
so a persona that cannot see the underlying figures cannot define what a report asserts about them —
and the refusal names who can. The wizard itself is unchanged; it is now reached from this tab.

**Operations & audience is four sub-tabs, and the first is the two gates.** Gate 1 is *audience
entitlement* — who may see that a report exists — as a role × definition matrix whose cells state
their verdict in words and tint to match. Gate 2 is *data scope* — which rows a predicate admits and
which columns are masked — and it is **declared, not applied**: no roster in this prototype is
filtered per persona, so applying a predicate would invent a filter and stating one silently would
claim a filter that never ran (the horizon's rule). The two are never merged, because one permission
built from both is wrong in both directions. **Refresh & schedule** lists what runs when and what it
stands on; **Report audit** lists only acts with a record behind them (who defined which version, how
it was approved, who saved a composed report, whether the content it was asked of is still published);
**Publish checks** recomputes four preconditions per definition, including the one that fails after
every restart, because publication lives in memory.

#### Authoring a report (`/reports/new`)

Four steps — **Graph → Ask → Confirm → Report** — and the split *is* the promise the page
makes: "nothing runs against your compliance data until you're happy with it".

**The graph is chosen first, and it is part of the frame.** `GET /reports` returns
`graphs` — every published graph, with its version, content hash, size and publisher — the
wizard opens on that list, and `use_case_id` travels through read → build → save. A frame
naming an unpublished graph is **refused, naming the ones that are**: defaulting to whatever
is newest would attribute the figures to content nobody picked. The default remains the
newest for a written report opened straight off the section, which is the only case where
nobody chose.

**Picking a standard report builds it, then asks what to call it.** A chip on step 2 runs
read → build against the chosen graph and lands on the report — readable immediately, and
**not yet kept**: the name prompt leads the page, pre-filled with the report's heading and
the graph version so there is something to accept, and saving is the reader's act. Naming is
the one thing the app must not decide; a row named by the app is one nobody recognises a
week later, and three of them read as duplicates rather than as three questions. The save
still posts a frame the server validated rather than one the page assembled.

**A saved report is opened, edited, and re-asked.** `GET /reports/saved/:id` rebuilds its
frame against the current rosters — the row holds no figures, so opening it and generating
it are the same act — and "Edit" reopens the wizard on that row, where saving **updates it**
instead of leaving two rows asking one question. A row whose graph has since been
unpublished still answers, and says so in a caveat rather than claiming live content: with
publication in memory, that is the state after every restart.

**Who did what is reported precisely, and both are told rather than guessed.** A saved
report names **who saved it** (`saved_by`); a graph names **who published it** (`?as=` on the
publish route, kept per version). Both are the browser's own signed-in address, validated as
an email and refused otherwise, because the identity is client-held and the server has
nothing to look it up from — the rule the consent callback established. Two different claims
about two different acts, and the copy does not blur them.

- **`POST /reports/read` returns a sentence and a frame, never figures**, and is **paced**
  (`SUGGEST_MS`) because reading a question back is the one act here that reads as a model
  call. Picking a standard report instead is neither matched nor paced — the chip *is* the
  answer.
- **An unrecognised question says so.** Matching reuses `askTokens` and `ASK_MATCH_MIN`
  with the same tie rule as `matchAskAnswer`, so the two surfaces cannot disagree about
  whether a sentence names something. A miss is still read as the generator register —
  it is the only frame the inbound network can start from — but the read-back reports
  that it was not recognised. The prototype routed every unrecognised question there
  silently, which is a guess presented as an understanding.
- **`POST /reports/build` computes the report.** Not paced: it is a read over the rosters,
  like a What-if scenario. It reports `variant`, and that field is the honesty of the whole
  flow: **`written`** when the frame is the one the report was written for (so the authored
  tiles still describe it), **`generated`** otherwise — and a generated report's tiles are
  recomputed from `summary_catalog` over the rows in view and carry "computed for this
  frame". The tenant's authored figures are never shown against a frame they do not
  describe. On a spine the catalogue does not cover (facilities, quarters, traces) a
  generated report states no summary and says why rather than showing an empty strip.
- **A report carries a chip bar, and a chip re-asks it.** Every spine offers facets — the
  register's are declared (`slice_default` + `fields.filterable`), and the other three are
  derived from the column that distinguishes their rows: a facility's `role`, a quarter's
  `year`, a trace's `flag` (three columns, one control). A chip does **not** hide rows: it
  rebuilds the report under the frame it states plus that filter, so the tiles and the charts
  follow the slice instead of describing a set the table no longer shows. That is why
  `frame` is on the payload in *values* beside the assumption labels — recovering a scope
  from its printed label would be guessing at what the report was already told. The frame
  validator asks the same `reportFacetsFor` the chips came from, so a chip cannot offer a
  filter the API refuses.
- **A report renders like the rendered report.** Three things had drifted from the package's
  own pages, all visible side by side: the table showed the *starter's* six columns where
  Report 2 prints ten (evaluations, tonnage and manifests too — transcribed per report in the
  ingest as `TABLE_COLS`, every key checked against the field dictionary); every bar was one
  hue where the package colours by **risk tier**, so a data point may now carry a `tone` and
  that is the one thing allowed to vary a magnitude chart's hue, because a tier is a *state*
  and the table beside it repeats it as a tag with an icon; and the drawing sat at answer
  width in a card twice as wide, with its title printed above it twice. A report's chart now
  asks for a **900-unit viewBox** — the box grows rather than the cap being lifted, so the text
  stays the size it was drawn at — and the card no longer repeats the caption the figure
  carries. Tile and table density are scoped to `.rp-tiles` / `.rp-table` rather than changed
  in `StatCards` or the theme, which the telemetry pages share.
- **Two charts sit side by side**, as the package's reports draw them, and `AnswerChart`
  gained two forms. A **`column`** form for the one case horizontal bars lose — a short label
  over a left-to-right series, which is what a quarter is; a long label still falls back to
  `bar` however the payload asks. And a **`grouped`** form: the facility scorecard draws
  evaluations *beside* violations per facility, because that pairing is the comparison the
  report makes, and two separate charts made it two findings a reader had to hold at once. It
  keeps **roster order** so the subject leads rather than being buried wherever its number
  falls, and its values table carries a column per series. Two hues there encode two
  *measures*, with a legend — that plus a point's `tone` are the only two things allowed to
  vary a magnitude chart's hue, and both are named on the drawing.
- **A scoped chart carries the share it raises.** "Four generators, 1,876 tons" provokes "out
  of what?", and the report's own four rows cannot answer it — so a scoped chart on the
  register comes with a **companion**: the split of the whole register by compliance status,
  whose 79.3% is the figure the tile beside it states. It is drawn as a **ring** with both
  sides in the legend. That replaced the meter: a meter reads as *progress toward* something
  and a share of inbound tonnage is not progress, so `donut` with two to four slices is now a
  ring and `Meter` is gone.
- **Colour on columns: identity at four or fewer, state beyond.** The package colours its four
  decree-bound generators by *which generator* and its thirty-six-row register by risk tier, so
  a handful of directly labelled columns take the categorical hues and a long one takes the
  tone. And **the readable form decides, not the block's preference**: a report block may ask
  for `bar`, but six rows or fewer are drawn as columns and a long register as horizontal bars —
  the package's own Report 5 asks for `bar` and draws four columns.
- **A chart and the rows behind it are two cards**, as the package lays them out, and a chart
  card carries no title of its own: the figure already has a caption. A report's lead note
  prints as the tenant's paragraph with no heading added above it.
- **`summary_catalog` is the prototype's ten tiles re-expressed as data** — a label, a
  tone, the field it reads and how it aggregates — because a closure cannot be served.
  `server.mjs` implements the six aggregations and three formats it names, and the ingest
  refuses one it does not.
- **The horizon is declared, not applied**, and the app says so where the horizon is
  chosen *and* in the built report's caveats. Nothing in these rosters is sliced by
  time — the register carries a generator's whole federal history and the quarterly roster
  is the full window — so applying one would invent a filter and stating one silently would
  claim a filter that never ran. Scope, measure and facet filters all really apply.
- **A saved report names who it is for, and the control says what it is.** Its card carries a
  **Who can view** panel — `AudiencePicker`, its own component for the same reason
  `ConnectSourceWizard` is separate from its modal: it renders behind the card's `useState`, so a
  `renderToString` of the card draws it closed and every assertion about its checkboxes would
  pass over nothing. Inside, a checkbox per `auth_role` — the login's own pool, with each role's
  `access_note` beside it, which until now was collected and rendered nowhere — stored as role
  *ids* so a renamed role leaves no stale label. **All roles is one of those checkboxes, with
  three states.** It is `indeterminate` while only some are ticked, because the other two would
  each misreport a partial selection, and it replaced an *Every role* button: a button beside
  checkboxes reads as a different kind of act, and that one could only ever select all, so it
  went dark the moment it had and said nothing about the state in between. A new report is visible to every role, an empty
  audience is refused (that is deletion with extra steps), and an unknown role id is refused
  naming the pool. `GET /reports?as_role=…` then shows a reader only the reports their role is
  named on. **It is not access control and the panel says so in those words**: the role is
  client-held and the login authenticates by shape, so this narrows what the section *shows*,
  while the API still serves every row to a caller that asks without a role. A control that
  implied a permission this mock cannot keep would be the worst claim in the app.
- **A card that can change height is laid out by its content.** `.rp-saved` had the
  equal-height treatment the written-report cards use — `height: 100%`, a flex-column body, the
  foot pushed down by `margin-top: auto` — and opening the audience panel inside it stretched the
  box: the head filled a height nothing was setting and the rows below left the card's frame. The
  written cards keep the trick because nothing inside them expands; this one may not have it, and
  `check-docs` asserts all three are absent from it.
- **A saved report is a question, not a result.** `POST /reports/saved` stores the frame
  and the question through `commitDb`, so it survives a restart — the same asymmetry that
  keeps a graph brief and drops a registered source — and stores **no figures**, so
  re-opening one re-asks it. `check-docs` asserts both halves.

Step 3's per-block editing from the prototype (add/remove/reorder blocks, retitle, switch
a chart's measure, pick columns) is **not built**, and `presets` is deliberately not in the
payload for that reason: a picker with nothing behind it is worse than an absent one.

### Identity (`/login`)

Gates the whole app, so it is the one flow that sits outside `RequireAuth`
rather than behind it — see Routing below for how the route table wraps that.

**This is a persona demo, not a user directory.** `POST /auth/login` has no
account store to check a password against, so it authenticates by *shape*: a
well-formed email, a password of a plausible length, a role that exists in
`auth_roles`. Any password signs in as the role picked — exactly as the
BigQuery/Drive consent screens prove a request is well-formed rather than that a
real Google account sits behind it. `LoginPage` says this on the page itself;
do not build a feature on top of this login that assumes it verifies anything.

**The five roles come from `db.json`, not a hardcoded union**, the same pattern
as `graph_domains`/`graph_personas`: `GET /auth/roles` serves `{ role_id, label,
access_note }` for the login dropdown, and `POST /auth/login` echoes the picked
role's `label` back in the session so the sidebar never has to re-fetch the pool
to render it. Adding a sixth role is a `db.json` edit, not a code change.

`access_note` describes what a role may see. It is carried through the API and
the session but **nothing renders it** — the sidebar's "My data access" card was
removed. Keep it or drop it deliberately; do not re-add a card on the assumption
that a signed-in user has been told what their role can reach.

**The identity is client-held, not server state.** `useAuthStore` persists
`{ email, roleId, roleLabel, accessNote, initials, signedInAt }` to
`localStorage` (key `contextweave.identity`) so a refresh does not force a
re-login — unlike a registered source, there is no server-side session for a
restart to lose. `initials` comes from the email (`adaeze.okonjo@…` → `AO`, via
`emailInitials()`): there is no name field to draw an avatar from, so the avatar
in the sidebar footer is derived from what was actually collected, not invented.
Sign-out is a pure client action (`logout()` + navigate to `/login`); there is no
server-side session to revoke.

**Client-held means it has to be sent — and it is the one fact the client keeps.**
Anything that reports *who* did something has to be told: the connect wizard
passes `identity.email` into `oauthCallback` / `driveOauthCallback` as `as=`, and
the consent echoes it back so the API agrees. But the **"Connected as …" alert
renders `signedInAs ?? account.email`**, preferring the store over the payload,
because this login authenticates by shape and the consent proves a request is
well-formed rather than that a real Google account is behind it — so who is
connecting is the browser's fact, not the server's. That is also why an older or
deployed mock server, still answering with `db.google_account`, cannot make the
page name a stranger. It is the one deliberate exception to "render what the
server reported", and it is deliberate because the server is echoing the client
here, not informing it. The
display name that comes back is derived from the email
(`displayNameFromEmail()`, the twin of `emailInitials()`) — the login form
collects no name, so one is never invented. `check-docs` asserts all three halves
of that path.

**Publishing is told who, the same way.** `POST …/versions/:sha/publish` takes `?as=<email>`
from the store, records it per `useCaseId:sha`, and every "published by" line — Ask, the
report footer, the wizard's graph cards, the section's graph list — reads that record
through `publishedByFor`. It falls back to `db.google_account` for a version published
before this existed or by a caller that sent nothing, because "published by nobody" is not
true of a live version. A malformed `as` is a 400, not a quiet fallback. The audit trail's
`triggered_by` and Graph Studio's `approved_by` are **still** `db.google_account` and are
not wired to the session; wire them the same way or leave them, but do not read them as the
current user.

### State (`src/store/`)

zustand. Ten modules (plus `asyncState.ts`, the shared machinery): `authStore`
(who is signed in — the one module persisted to `localStorage`, everything else
is server-derived), `sourcesStore`, `catalogueStore` (browse / columns /
document browse / documents / jobs / signals), `graphStore` (domains / use
cases), `graphStudioStore` (the studio's list + one graph's review),
`askStore` (live graphs + the last answer), `whatifStore` (the What-if frame plus
one column per admitted load — the *load*, never the figures), `reportsStore` (the
section list, plus one report keyed by the id in the URL — it keeps that id beside the
report so a slow fetch cannot leave one report's tiles under another's heading),
`telemetryStore` (audit / traces / evals), `dbStore`.

The Drive stores are separate from the BigQuery ones rather than one store
branching on connector: the payloads share no fields, so a union `data` would
have to be narrowed by every consumer.

Two conventions that the whole app depends on:

- **Actions never throw.** They return `Result` = `{ ok: true } | { ok: false, error }`.
  Callers branch on `result.ok` and show a message. All `try/catch` lives in the
  store, so components have none.
- **`load()` sets `error` in state** rather than throwing, and a failed reload
  leaves the previous data in place instead of blanking the screen.

`createReadStore(fetcher)` in `asyncState.ts` covers plain read-only endpoints —
prefer it over hand-rolling a fourth identical store. `toMessage()` normalises
anything thrown; it distinguishes `ApiError` (keeps the server's wording),
`ValidationError` (names the field), and a network failure (says
`npm run mock`), so do not collapse those into a generic string.

Select fields individually (`useSourcesStore(s => s.pending)`) so one field
changing does not re-render a whole page. Return stable references from
selectors — `selectSources` exists because `data?.sources ?? []` creates a new
array every render and defeats downstream memos.

### Validation (`src/api/validate.ts`)

A small combinator validator (`str`, `num`, `bool`, `nullable`, `arrayOf`,
`shape`, `oneOf`). Every response in `client.ts` is validated at the boundary.

This is not ceremony: `/db` lets a user edit the data live, so a malformed
payload is reachable. Without the check it surfaces as
`Cannot read properties of undefined (reading 'map')` deep inside a render;
with it, the message names the path (`sources[0].profiled_tables should be a
number, got string`). **Add a schema whenever you add an endpoint.**

**A write answers with a shape too.** The rule covers `POST`/`PUT`/`PATCH`/
`DELETE`, not just reads — a registration, a queued job or a saved section is
rendered exactly like a fetched list, and a stale server answers writes with the
old shape as readily as reads. `check-docs` enforces this mechanically: an
exported fetcher in `client.ts` that calls `request()` must also reach
`validate()`, directly or through a helper that does (`withStudio`). Adding an
endpoint without a schema now fails `npm run preflight`.

`nullable()` accepts an absent key as well as `null`, so a nullable field's
schema checks its *type*, not its presence. Use a non-nullable field when the key
must be there.

**Every message here is read by a user, not a maintainer.** A `ValidationError`
leads with what failed and what to do (restart the mock server), *then* the field
paths — a toast that opens with `use_case.personas should be an array` describes
a symptom nobody outside this repo can act on. Keep the paths: they are what
makes the cause findable. The same rule covers `toMessage`, which never returns
an empty string, and the server's own 400s, which are shown verbatim — so write
those as a sentence to a user too.

The client also maps the API's `snake_case` to `camelCase` for the fields the UI
touches (`last_sync` → `lastSync`, `pass_rate` → `passRate`, `ran_at` → `ranAt`).
The API stays snake_case; the mapping belongs in `client.ts`, not in components.

### UI conventions

**All components come from antd** (v6, not v5). Its API differs — check the
installed `.d.ts` before assuming: `Tag`/`Alert` use `variant`/`title` (not
`bordered`/`message`), `Drawer` uses `size` (not `width`), `destroyOnHidden`
replaces `destroyOnClose`. The only hand-written marks are `ConnectorIcon`
(vendor logos, inline SVG so nothing is fetched) and the span-waterfall bar,
which has no antd equivalent.

**`ConnectorIcon` has one mark per connector key, and an unknown key gets a
neutral cylinder — never another vendor's logo.** It fell back to `BigQueryIcon`,
which drew five of the seven connectors as BigQuery; `check-docs` now fails if a
key in `CONNECTORS` has no entry in `MARKS`. A wrong logo is a claim about what
something *is*, not a styling default — the same rule as a status colour on a
category chip, one level up.

**Drive file labels come from `fileKind()`** in `src/data/mimeTypes.ts`, shared by
the browse tree and the document dictionary so one MIME type cannot render as
`DOCUMENT` in one panel and `GDOC` in the other. The document panels reuse
`ProfiledColumnsPanel.css` / `CataloguePage.css` classes rather than growing a
second stylesheet for the same layout.

**Theme, not CSS.** Brand identity lives in `src/theme.ts` as a `ConfigProvider`
theme — `colorPrimary: #f4562b` plus Menu/Card/Table component tokens. Change the
brand there, not in stylesheets.

**Spacing comes from one scale.** `--sp-1`…`--sp-9` (4px steps) in `index.css`,
mirrored as `SP` in `theme.ts` for antd's numeric props (`gutter`, `gap`,
`Space size`). Keep the two in step. No raw px in any `margin`/`padding`/`gap` — the
check reads **every** stylesheet under `src/` (it used to read a hand-kept list of nine and
had stopped covering six), and exempts only sub-scale insets: 1–2px on a pill cannot be
expressed with a 4px scale, anything 4px or over must come from it.

**Layout uses antd's 24-column `Row`/`Col`**, not CSS grid — inside a card, grid is fine
where the content *is* a grid.

**The theme sets `Card.bodyPadding: 0`, so a card states its own.** That is a live trap, not a
preference: a body at 0 beside a head at antd's default leaves a card's content flush against its
left edge while the title sits 24px in, which is the first thing a reader notices. The report
section pads head and body from one token for every card class it has, and `check-docs` asserts
the rule *declares* the padding rather than merely listing the selectors — the two share one
block, so emptying it once left five cards unpadded with every selector still in place.

**A card grid aligns on its foot, not its top.** Cards in a row are the same height
already; what makes a grid look broken is a figure strip that floats after prose of
different lengths. Make the card body a flex column and give the strip `margin-top: auto`,
so the numbers line up across the row whatever the copy above them does — and where an odd
last card would sit beside a hole, span it (`xl={24}`), because a half-width card next to
empty space reads as one that failed to load. Both are in `ReportsPage`.

**Empty pages use `EmptyState`, never antd's `Empty`.** A grey box saying
"No data" states the problem and stops. Every empty page here is a page *before a
step has been taken*, so the shell carries a brand medallion, what will appear
once the step is taken, the one action that takes it, and the numbered path from
here to a filled screen. `NoSourceConnected` is the source-specific wrapper;
Graph Studio's is the second. Give a new one copy, not a new look.

**Status colours are reserved.** `STATUS.good` / `warn` / `crit` mean state only —
never decoration. Every status tag ships an icon *and* a text label
(`StatusTag`), so state is never colour-alone. Class/category chips stay neutral
so they cannot be mistaken for status.

### Routing

`src/routes.tsx` exports the route table; `src/main.tsx` binds it to browser
history. They are separate so tests can mount the table on a memory router.
`src/nav.ts` drives the sidebar — **`/db` is routed but commented out of
`NAV_ITEMS`**, so it is reachable by URL only. Adding a nav item means adding to
both `NavKey` and `NAV_ITEMS`.

**`/login` sits outside `RequireAuth`, and everything else sits inside it.**
The route table wraps the whole `/` tree — `App` and every page under it — in a
`RequireAuth` layout route; an unauthenticated visit to any of them redirects to
`/login` with the attempted location in `state.from`, and `LoginPage` reads that
back to return the user to where they were headed rather than always landing on
Sources. `/login` has no `NAV_ITEMS` entry — there is nothing to navigate to
before signing in, and once signed in there is no reason to navigate back.

**The sidebar advertises more than exists, and serves more than it advertises.**
`NAV_ITEMS` has **8** live entries and `routes.tsx` has a page for **7** of them
(`/new-graph`, `/ask`, `/reports`, `/sources`, `/catalogue`, `/graph-studio`,
`/what-if`). The last one — Knowledge Graphs — is a roadmap placeholder with no route, so
clicking it falls through `path: '*'` to `NotFoundPage`. That is a deliberate shell, not a
broken link: when it gets a page, add it to `routes.tsx` and nothing else changes —
`/what-if` and `/reports` were both placeholders until their pages landed, and each
needed exactly that one line.

The traffic also runs the other way. **Four routes are reachable by URL only**, having
been commented out of `NAV_ITEMS` rather than deleted: `/audit`, `/trace`,
`/validation` and `/db`. A fifth is URL-only by design and was never in the list —
`/graph-studio/:useCaseId/canvas`, the full-window canvas, which the **Full view**
button on the Canvas tab opens in a new tab.

Graph Studio is therefore three routes: `/graph-studio` lists the built graphs,
`/graph-studio/:useCaseId` opens one, and `…/canvas` draws that one's graph with the
whole window. **The canvas route is declared before the `App` tree, and that order
matters** — `graph-studio/:useCaseId` matches its parent segment and would win
otherwise, rendering the studio page at the full view's URL. It is also the only page
besides `/login` that sits *outside* `App`, for the opposite reason: `/login` has
nothing to navigate to yet, and the full view has nothing to spare. Both stay inside
`RequireAuth` except `/login` itself.

`check-docs` pins those counts, so a nav entry commented in or out shows up as a doc
failure rather than as a paragraph nobody re-read.

## The audit gate

`scripts/audit-gate.mjs` fails on **any** advisory at or above `low`
(`.npmrc` sets `audit-level=low` to match). It runs on `postinstall`, so it fires
on every `npm i`. A registry failure warns and exits 0 rather than breaking
offline installs.

It carries a per-advisory `ALLOWLIST`, deliberately not a raised threshold:
waiving one known-inapplicable finding must not admit the next unrelated one at
the same severity. **It is empty today.** The one entry it held —
`GHSA-qwww-vcr4-c8h2`, an RSC-mode CSRF bypass in `react-router` unreachable in a
client-only SPA — was removed on 2026-08-11 when the gate reported it matched no
advisory: upstream had patched, and a waiver that waives nothing is a standing
licence for the next finding on that package. The gate nags when an entry goes
stale, and `check-docs` fails if CLAUDE.md names a GHSA id the gate no longer
waives, so the two cannot drift apart in either direction.

**Prefer an `overrides` pin to a waiver when a patched release exists.**
`nanoid` is pinned that way (`^3.3.17`, for GHSA-2v37-7h3g-55p8) — it reaches us
only as vite → postcss → nanoid, and the advisory needs a custom generator called
with size 0, which postcss never does. A pin costs nothing and expires by itself;
a waiver sits in `audit-gate.mjs` admitting the next high finding on the same
package. The reason lives in the `//overrides` key beside it in `package.json`.

Adding a dependency here is a real decision. Check `npm audit` before and after,
and prefer writing ~100 lines to pulling in a package.

## Working in this repo

`.claude/skills/contextweave-flow/SKILL.md` defines the loop: orient (read the
relevant `SKILLS.md` flow and `docs/REGRESSIONS.md`) → build → verify → **record**.
The record phase is not optional — it is why the same bug does not land twice.

- **`SKILLS.md`** — the eleven end-to-end flows, their files, and their failure modes.
  Read the section before changing a flow; update it after.
- **`docs/REGRESSIONS.md`** — every bug that cost real time, with the guard that
  stops it recurring. Append on every fix. Prefer a guard that fails the build
  over one that fails at runtime, and either over a note.
- **`npm run check-docs`** — asserts this file's and `SKILLS.md`'s factual claims
  against the source, so a doc cannot quietly go stale as features land. It runs
  in `preflight`. When it fails, fix whichever side is wrong; never delete the
  assertion to go green.

## Known pitfalls

Each has a full entry in `docs/REGRESSIONS.md`.

- **`erasableSyntaxOnly` is on.** No constructor parameter properties, no enums.
  Declare class fields explicitly.
- **`noUnusedLocals` is on** — an unused import fails `npm run build`, not just
  lint, so never conclude a refactor on lint alone.
- **Never round-trip a source file through PowerShell `Get-Content`/`Set-Content`.**
  PS 5.1 reads UTF-8 as ANSI and corrupts em dashes and `·` into mojibake. Use the
  Edit tool, or node with explicit `'utf8'`.
- **Background-started servers on Windows outlive their shell and wedge** — the
  port stays bound while the process stops answering. Check
  `Get-NetTCPConnection -LocalPort 4000` and kill the pid before restarting.
- **Before blaming the mock server, check which API the app is calling.** The
  origin belongs in `.env.development` (`/api`) and `.env.production` only — in a
  plain `.env` it applies to *every* mode and silently points `npm run dev` at
  the deployed box, where local `db.json` edits and `server.mjs` changes have no
  effect and nothing errors. `check-docs` now fails on it. Symptom to recognise:
  `curl localhost:4000` is right and the browser is wrong.
- **A failing `check-docs` claim is a live fault, not background noise.** The
  `.env` bug above sat in a red claim for a whole session while it was dismissed
  as unrelated. Read the red claims before diagnosing anything else.
- **A stale mock server answers with the old shape.** Editing `server.mjs` or a
  payload shape needs a restart, which also clears every registered source. When
  output looks impossibly wrong, check the server's age before your own code —
  several fields `undefined` at once means the process, not the schema.
  `assertCurrentUseCaseShape` in `client.ts` says so for use cases; the same
  check is worth adding wherever a payload grows fields. A **404 on an endpoint
  that plainly exists** is the same fault, and the dispatcher's own 404 now says
  so — that one covers every endpoint added from here on.
- **A new `check-docs` assertion must match `\r?\n`, never a bare `\n`.** These
  files check out with CRLF on Windows; a split on `\n  {\n` found zero
  connectors and reported "0 of 0 available" — a green-looking sweep over an
  empty list.
- **An "is absent" assertion passes over an empty render.** `renderToString` gives
  a zustand component its *initial* state (zustand v5's `getInitialState` is the
  server snapshot), skips anything a `useEffect` expands, and may draw a
  virtualised `Tree` with no leaves. Assert in the same run that the render had
  its data.
- **A consent screen renders the scopes the server returned.** Drive asks for two;
  a client-side list described one. Never maintain a copy of what was requested
  beside the request.
- **A fallback for a required field makes it optional.** `source_name ||
  project_id` let a blank name register a source called `vrio-contextweave-demo`.
  If the form asks, the code must not answer for the user.
- **A payload field name is a contract the compiler cannot check.** A raw type is a
  *claim* about what the server sends, so renaming a server field compiles cleanly
  and fails at the validator — `draft_version should be a string, got undefined`,
  which reads as a stale server and is not one. Grep the snake_case name too, and
  **re-capture any test fixture that came from the thing you changed**: replaying an
  old payload tests the fixture, not the code.
- **A `check-docs` claim must assert the fact, not the spelling.** One keyed to a
  local variable name (`start.state`) failed on a rename while the fact it guarded
  was still true — and a check that cries wolf is how a real red claim gets
  ignored. **Break every new claim once** before trusting it: three of them have
  now failed on the shape of the code (`\n` vs `\r?\n`, a renamed local, a `=>`
  inside a type annotation), and each reported an empty list — a guard saying
  "0 of N" is describing itself.
- **A default that misidentifies is not a default.** `ConnectorIcon` fell back to
  BigQuery's logo, drawing five connectors as a product they are not. A fallback
  may be plainer than the real thing; it must not assert something false.
- **`width: 100%` on a viewBox SVG is a zoom control, not a layout rule.** It
  scales the drawing's text too — an answer chart rendered its 11px labels at 28px
  until each chart capped `max-width` at its own viewBox width. Cap the upscale in
  the component, where the number already lives. The canvas has the *inverse*: a
  1900-unit layout in an 800px panel renders 9.5px labels at ~4px, which is why the
  small labels are gated on zoom rather than drawn always.
- **React registers `onWheel` as passive, and a passive listener cannot
  `preventDefault`.** A zoom built on the JSX prop scrolls the page behind itself. Add
  the listener by hand with `{ passive: false }` in an effect.
- **A CSS rule beats an SVG presentation attribute.** `stroke={ring}` on an element
  whose class already sets `stroke` in the stylesheet does nothing. Give the new mark
  its own element rather than fighting specificity — and keep the disc's stroke for
  state, so a category cannot overwrite "proposed".
- **A ring, unlike a fill, has two neighbours.** It is adjacent to the fill inside and
  the page outside, so it needs checking against both. The demo viewer's light hues
  failed twelve ways when reused on a light ground: they hold against neither. Dark
  rings, and a hue-turn alternative to the luminance rule where luminance would force
  nine near-blacks.
- **A new path that extends an existing pattern must be declared first.**
  `graph-studio/:useCaseId` matches the parent segment of `graph-studio/x/canvas`, so
  the studio page renders at the full view's URL if the canvas route comes later — a
  wrong page with no error anywhere. `check-docs` compares the declaration indices.
- **A number in prose drifts unless something reads it.** The routing note claimed 13
  nav entries and 8 served long after it was 8 and 5, because no check looked at either.
  Both are now read off `nav.ts` and `routes.tsx`.
- **A field the whole array does not share is not a required field.** The What-if
  authoring steps carry `help` — except step 3, which carries `note` instead — and a
  schema declaring `help: str` made the entire frame fail to read over one absent
  string. Check the actual data before declaring a field on a list of near-identical
  objects.
- **Copy already in the payload must not be restated in a component.** Two Alerts on the
  What-if page hardcoded the first sentence of a tenant note that the payload already
  held, so each printed it twice — and put words in the tenant's mouth. Split the lead
  sentence off the data instead. A smoke assertion now greps the components for the
  served strings.
- **A connection gate has to replace the page's chrome as well as its cards.** The
  What-if banner and provenance note sat outside the gate, so "built on the real demo
  graph (36 inbound generators)" printed directly above "No data source is connected".
  Nothing errored — served copy about absent data reads as data. Put the whole lens in
  one component on the connected branch rather than gating each piece.
- **Assert a fact at its site, not its token in a file.** Six claims this session passed while
  what they guarded was broken, every one of them a whole-file `includes` for a string the file
  mentions twice — in a second call site, a width expression, or the file's own comment. Slice
  the function, count against a denominator the code provides, or key on a phrase only the
  rendered copy carries. Full list in `docs/REGRESSIONS.md`.
- **When a break-test reports a claim as unbreakable, suspect the break first.** Two of
  the report claims came back "MISSED" because the mutation never landed — one searched
  for a bare `\n` in a CRLF file — and the obvious next move would have been to rewrite
  two working guards. Verify the file actually changed. (One of the two *was* pointing at
  a real gap: the register's headline tile was not among the recomputed identities.)
- **A record keyed by a thing, holding a fact about an act, must be rewritten on every
  act.** `studioPublishedBy` is keyed by `useCaseId:sha256` and holds who published — and
  because a re-publish does not change the content hash, setting-only meant an anonymous
  re-publish kept crediting the previous publisher. Write *or clear* it every time; the tell
  is a fallback path that can never be reached twice.
- **A vacuous assertion is worse than no assertion.** Two written this session passed
  over nothing — one `|| true`, one `!x || x` — and both were reporting success. If an
  assertion cannot fail, it is a comment.
- **The equal-height card trick breaks a card that expands.** `height: 100%` plus a flex body
  plus `margin-top: auto` on the foot is right for a grid of fixed cards and wrong for one with a
  panel inside it: the saved-report card grew a tall empty head and spilled its meta rows out of
  its own frame the first time the audience panel opened.
- **A panel behind a `useState` cannot be asserted on from its parent.** `renderToString` renders
  the initial state, so a closed panel makes every check about its contents pass over nothing —
  the `Modal`/`Drawer` rule applies to plain conditional state too. Extract the panel
  (`AudiencePicker`, `ConnectSourceWizard`) rather than shimming the hook: a component that
  imports `useState` by name never reads `React.useState`, so patching the namespace does nothing.
- **A break-test harness has to read the stream and the encoding `check-docs` actually uses.**
  Seven mutations reported MISSED in one session against claims that were all correct: the first
  harness read `stdout` (the failures go to `stderr`), and the second decoded them through the
  console codepage, where the `✗` it was grepping for did not survive. A break test that cannot
  fail is exactly the vacuous assertion it exists to prevent — **match on the claim's own text**,
  and treat a run with no summary line as a crash rather than a pass.
- **`text-overflow: ellipsis` does nothing on a flex container**, and antd v6
  buttons are `inline-flex`. Put it on the inner label span with `min-width: 0`.
  Text clipped at *both* ends is the tell: that is a centred flex item, not a
  truncation.
- **A renderer that skips what it cannot draw needs a validator that refuses it.**
  20 canvas edges pointed at ids the node roster omitted, so they were skipped while
  drawing and 17 facilities appeared to have no enforcement — no error anywhere.
  `validateDb` now refuses a canvas edge with an unresolved endpoint.
- **A matcher's threshold is a claim about the data.** The query matched a word only
  if it named exactly one node, which is the wrong rule for a graph built on entity
  resolution: it refused "chemours" because the facility and its consent decree share
  the name. Relaxing it to plain rarity then answered about "waste" and "facility"
  instead — a type name can never name an instance.
- **A stoplist on words does not cover a node whose whole label is one of them.** The
  graph rebuild put 7 type-level `Concept` nodes on the canvas labelled exactly
  "Facility", "Manifest", "Document" — and the matcher's whole-label shortcut bypassed
  the stoplist, so "the Denka facility" resolved to `CONCEPT:Facility` and reported
  the two had nothing between them. A concept *is* the type; it can never be an
  instance. Both paths into a matcher need the same rule.
- **A `check-docs` claim keyed to a path can fail open.** `kgPath` read
  ` _demo_data_package_…` — the repo-wide "VLS" removal ate the directory name — so
  eight canvas claims passed for a session while comparing against `null`, each
  reporting "the package is not in this checkout". A guard whose good answer is its
  own inability to run is describing itself. The path is now asserted to exist, and
  asserted to be the one the ingest reads.
- **A retired type may only be named in a negation.** After the column-value nodes
  were dropped, one sanity check's prose still said "generator → HAS_ENFORCEMENT →
  EnforcementType" while its own traversal walked `ENFORCEMENT_AGAINST` — the package
  contradicting itself, and only the traversal resolved. But *refusing* the retired
  names outright then failed on the check that says "no WasteCode node", which is the
  correct thing to say. The guard checks for a retired type asserted as one the graph
  *has*.
- **A `_2` in the column or entity dictionary is only ever a second copy.**
  Suffixing by vocabulary lap printed a `_2` whose `_1` existed nowhere, because
  the slice starts at a hashed offset; it now counts uses within that table or
  document.
- **A route that names a person must be told who.** The identity is client-held,
  so a server route cannot look the signed-in user up: the consent callback
  reported `db.google_account` to everyone until the wizard started sending
  `as=<email>`. Anything new that records "who did this" has the same problem.
- **antd v6 renamed props** — read the installed `.d.ts`; do not assume v5.
- **Selectors must return stable references.** `data?.x ?? []` allocates every
  render and defeats downstream memos; use a module-level constant.
- **Do not whole-file find-replace identifiers** — it has no scope awareness and
  has already renamed an unrelated prop. Use Edit with surrounding context.
- **When a test fails, suspect the assertion and the environment first.** Two
  "failures" in this repo were a miscounted expectation and a stale server.
- React is pinned to the 18 line on purpose; keep `@types/react` in step.
