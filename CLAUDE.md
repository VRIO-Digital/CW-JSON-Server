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

## Architecture

A single-tenant data-governance console. Five feature pages plus a dev-only
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

`db.json` is read once at startup into a `db` object that every route closes
over. Two kinds of state live here:

- **From `db.json`** — projects/datasets/tables, drives/folders/documents,
  credentials (`credentials` for BigQuery, `drive_credentials` for Drive), the
  audit / traces / evals payloads, change signals, `column_vocabulary`,
  `document_vocabulary`.
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
  editor cannot save a document that would crash the app. There are 20 required
  keys, and the newer ones are as required as the originals: removing `drives`
  breaks the connect wizard, and removing `graph_domains` breaks step 1 of New
  Graph — not just a catalogue page.
- **`validateDb` also checks *across* keys, not only within one.**
  `graph_use_case_templates` holds nothing but ids into `graph_personas`,
  `graph_kpis` and `graph_hero_questions`, and an id that does not resolve
  would not throw — it would drop out of the bundle, and the step would draft
  five personas where the use case names six. A short list reads as an answer,
  so the server refuses to boot and names the id. `check-docs` asserts the same
  thing, so it fails the build before it can fail a boot.
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
  Drive asks for `drive.metadata.readonly`, BigQuery for `bigquery.readonly`.
  The callback returns the account and a **session**; the account it names is
  **whoever is signed in**, passed as `as=<email>` because the identity is
  client-held and the server has nothing to look it up from (`db.google_account`
  is the fallback for a caller that names nobody, and a malformed `as` is a 400
  rather than a quiet fall back to that seed). What that account can see
  is a second call (`/sources/oauth/projects` / `/sources/oauth/drives` — twins,
  each refusing the other's session). All three are **paced**
  (`CONSENT_START_MS`, `CONSENT_MS`, `DISCOVERY_MS` ≈ 3.1s) and
  `GoogleConsentPanel` shows a stage per call, naming the scope — signing in is
  not instant or silent, for the same reason a model call is not. Errors are
  never paced. **A stage advances when its request returns, not on a timer** —
  so add a stage only when there is a call behind it.
- **The document dictionary reviews files, not fields.** Its facets count
  *documents* (`pii` means "holds at least one PII entity"), and the editable note
  is the document's `summary` via `PATCH /sources/:id/documents` — extracted
  entities are machine output and read-only. `documentDictionary()` synthesises
  them from `document_vocabulary` exactly as `tableDictionary()` does from
  `column_vocabulary`: sliced by hashing the document id, statistics from a hash
  of document+entity, so repeat requests agree.
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
  ranking.** `graph_use_case_templates` holds the three HWNET use cases as id
  bundles, and `matchTemplate` claims one when the brief contains at least
  `TEMPLATE_MIN_PHRASES` (2) of its `match_phrases` — which are drawn from its
  own description, so pasting that description in hits all of them. A match
  returns the members **whole and in the template's own order**, past the 4/5
  keyword limit, because a template is a stated answer rather than a ranking and
  truncating it would drop members the use case explicitly claims. The `why`
  becomes "named in the … use case" and `derived_from` names it too, so the
  bundle is as explainable as the ranking it replaced.

  **A tie matches nothing.** Two templates scoring equally means the brief named
  neither, so it falls back to keyword ranking rather than picking one — which
  is why `check-docs` asserts every phrase is unique to its own template. Only
  personas, KPIs and hero questions are templated; step 6's answer formats have
  no `memberKey` and stay ranked, because a use case states what it must answer,
  never how to render it.
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

**Nothing on a card is a decorative number.** `graph_studio` in `db.json` holds
the four evidence-rich rows, the pivot and each bucket's total; the rest are
synthesised by `studioItems` the way `tableDictionary` synthesises columns — by a
hash that includes the **use case id**, so every built graph gets its own queue
and repeats agree. The card shows the length of what was returned, and confidence
is generated inside each bucket's band because the cards promise `0.85–0.95` and
`≥0.95`. Buckets below the floor come back as a named `*_sample`, never a list
pretending to be all 466.

**A row's buttons are its own.** `action_set` picks them: a causal claim is
`approve-causal` or `downgrade-correlational`, never plain "approve". The server
refuses any other choice, so the page cannot offer one the API would reject. A
`schema-changing` row cannot be resolved without a justification — enforced
server-side, not merely shown.

**The pivot is a separate precondition from the queue.** Clearing every row still
leaves publish blocked while it is open, because settling it changes what the
decided rows mean. `publish.blocked` and its `reasons` are computed once on the
server; the button's `disabled`, its tooltip, the banner and the publish refusal
all read that one list. Publishing makes the draft's *own* version live
(`draft v15` → `Publish v15…`); it does not mint a new number.

Decisions and the pivot live in memory, keyed `useCaseId:itemId`, so two graphs
cannot answer each other's rows.

**The five tabs are one truth, not five pictures.**

- **Canvas** draws the ontology as hand-written inline SVG — no graph library,
  for the same reason the mock server has no dependencies. Positions come from
  the server so a reload draws the same picture; dragging is local, because
  rearranging is for reading. **An element is "proposed" exactly while its
  review item is undecided**, so approving a row in the queue un-dashes its node
  here, and *correcting* one marks it `studio-authored`. The filter chips carry
  counts, so an empty result reads as "none match" rather than a broken chip.
- **Query & sanity-check** asks the *draft*. The answer is a real walk over the
  edges that exist, and its path is what lights up on the canvas — the answer
  carries the marked canvas back with it, so there is no second request and no
  second truth. A question naming one entity, or two that nothing connects, is
  **not answerable and says why**; an answer resting on an undecided edge is
  answerable *and* flagged provisional. Matching needs the whole label or a word
  unique to one node, or "work order" would silently answer about Change Order.
- **Quality report** re-runs the same three preconditions the publish gate uses.
- **Versions** lists **only published versions**, and separates three acts that
  are easy to conflate: *publishing* puts a version on the shelf, *approving*
  records that a human read the report, and *activating* points the graph at it.
  Approval is the gate on the third — `POST …/versions/:v/activate` refuses an
  unapproved version, so a sign-off is never decorative. Approving twice is
  refused naming who did it; activating what is already live is refused too.

**Live is not "the newest".** Any approved version can be activated, which is
what a rollback is, so `liveVersion` is tracked explicitly and each row carries
`isLive` — exactly one does. Publishing sets it to what it just published;
nothing else moves it.

**The draft version and the live version are two facts, and only one is worth
showing.** `version` is the working draft — what Publish would make live — and
`liveVersion` is what is serving. Publishing v15 moves the draft to v16, so one
tag rendering both reads "published v16", a version nobody has seen. The pages
show **`live v15` only**; the draft number appears on the Publish button
(`Publish v16…`), which is the one place it means anything. Do not add a
`draft vN` tag back — an internal counter beside a real version reads as history
nobody asked for.

### Ask (`/ask`)

Where a *published* graph gets used. **Ask queries the live version, and only
the live version** — `GET /ask` lists the graphs `liveVersion()` returns
something for, so a draft is absent and a built-but-unpublished graph is
absent too. Both are still counted (`built_count`, `draft_count`), because
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
chip is a promise the brief already made. `ANSWER_MS` paces the answer for the
same reason `SUGGEST_MS` paces a suggestion. Refusals are never paced.

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
of that path. The audit trail's `triggered_by` and Graph Studio's
`approved_by` / `published_by` still read `db.google_account` and are **not**
wired to the session; wire them the same way or leave them, but do not read them
as the current user.

### State (`src/store/`)

zustand. Eight modules (plus `asyncState.ts`, the shared machinery): `authStore`
(who is signed in — the one module persisted to `localStorage`, everything else
is server-derived), `sourcesStore`, `catalogueStore` (browse / columns /
document browse / documents / jobs / signals), `graphStore` (domains / use
cases), `graphStudioStore` (the studio's list + one graph's review),
`askStore` (live graphs + the last answer), `telemetryStore` (audit / traces /
evals), `dbStore`.

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
`Space size`). Keep the two in step. No raw px in any `margin`/`padding`/`gap`.

**Layout uses antd's 24-column `Row`/`Col`**, not CSS grid.

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

**The sidebar currently advertises more than exists.** `NAV_ITEMS` has 13
entries; `routes.tsx` serves eight of them (`/sources`, `/new-graph`,
`/graph-studio`, `/ask`, `/catalogue`, `/audit`, `/trace`, `/validation`) plus
`/db` by URL, all gated behind `RequireAuth`, plus `/login` ungated. Graph Studio
is two routes — `/graph-studio` lists the built graphs and
`/graph-studio/:useCaseId` opens one. The other five — Knowledge Graphs,
Reports, Graph Builds, What-if Lenses, Feedback & Learning — are roadmap
placeholders with no route, so clicking one falls through `path: '*'` to
`NotFoundPage`. That is a deliberate shell, not a broken link: when one gets a
page, add it to `routes.tsx` and nothing else changes.

## The audit gate

`scripts/audit-gate.mjs` fails on **any** advisory at or above `low`
(`.npmrc` sets `audit-level=low` to match). It runs on `postinstall`, so it fires
on every `npm i`. A registry failure warns and exits 0 rather than breaking
offline installs.

It carries a per-advisory `ALLOWLIST`, deliberately not a raised threshold:
waiving one known-inapplicable finding must not admit the next unrelated one at
the same severity. One entry today — `GHSA-qwww-vcr4-c8h2` on `react-router`,
an RSC-mode CSRF bypass unreachable in a client-only SPA with element routes and
no loaders/actions/SSR. **No advisory-free `react-router` release exists**; every
version ≤ 7.17.0 carries a larger set. Remove the entry when upstream patches —
the gate nags when an entry stops matching.

Adding a dependency here is a real decision. Check `npm audit` before and after,
and prefer writing ~100 lines to pulling in a package.

## Working in this repo

`.claude/skills/contextweave-flow/SKILL.md` defines the loop: orient (read the
relevant `SKILLS.md` flow and `docs/REGRESSIONS.md`) → build → verify → **record**.
The record phase is not optional — it is why the same bug does not land twice.

- **`SKILLS.md`** — the seven end-to-end flows, their files, and their failure modes.
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
