# SKILLS.md

How ContextWeave actually works, end to end. `CLAUDE.md` covers structure and
conventions; this file covers **flow** — what happens when a user does something,
which files are involved, and where each step can fail.

Read this before changing a flow. Every section names the files it touches.

---

## The core premise

Nothing in this app is real until a data source is connected. That single rule
explains most of the design:

- No page has static fallback data. Empty API → empty page.
- `/audit`, `/traces`, `/evals`, `/change-signals` return empty collections and
  `connected_sources: 0` until a source is connected.
- Profiled counts stay 0 after registering, because registration and profiling
  are separate events.

If you find yourself adding sample data to make a page "look right", you are
fighting the premise.

---

## Signing in

**Files:** `LoginPage.tsx` → `authStore.ts` → `client.ts` → `server.mjs`
(`GET /auth/roles`, `POST /auth/login`) · route gate in `RequireAuth.tsx`

Every page below is gated behind this one. `routes.tsx` wraps the whole `/`
tree in a `RequireAuth` layout route; visiting any of them signed out redirects
to `/login` with the attempted location carried in `state.from`, and signing in
sends the user back there instead of always landing on Sources.

### The form

Email, password, role — a `Select` populated from `GET /auth/roles`, fetched
once on mount the same way `EditDatasetsModal` populates its dataset list (a
one-shot local read, not a store). All three are required; email is checked
against antd's `type: 'email'` rule, password needs 6+ characters, both re-
checked server-side because a client rule is not a boundary.

**This is a persona demo, not real authentication, and it says so on the
page.** `POST /auth/login` has no account store to check a password against —
it validates *shape*, not identity: a well-formed email, a plausible password
length, a role that exists in `auth_roles`. Any password succeeds for any
email, same as the BigQuery/Drive consent screens never check a real Google
account. Do not build anything that assumes this login verifies a person.

### The five roles

`platform_admin`, `domain_architect`, `data_analyst`,
`business_user_executive`, `business_user_project` — each a
`{ role_id, label, access_note }` row in `db.json`'s `auth_roles`, the same
pool pattern as `graph_domains`. The dropdown shows `label`. `access_note`
travels with the session but **nothing renders it** — the sidebar's "My data
access" card was removed. Adding a sixth role is a `db.json` edit.

### What lands in the sidebar

Success returns `{ email, role_id, role_label, access_note, initials,
signed_in_at }`, and `authStore` persists it to `localStorage` — a refresh
does not force a re-login, because unlike a registered source there is no
server-side session for a restart to lose. `initials` comes from the email
(`adaeze.okonjo@…` → `AO`): there is no name field on the form, so the sidebar
avatar is derived from what was actually collected rather than invented.

The footer renders three things and no more — the avatar, the email over the
role label, and **Sign out**.

**Where it fails:** an invalid email or a short password is a 400 naming which;
an unknown `role_id` is a 400 naming it; the mock server not running shows the
usual "start `npm run mock`" message. **Sign out** (bottom of the sidebar)
clears the identity and returns to `/login` — a pure client action, since there
is no server-side session to revoke.

---

## Flow 1 — Connecting a source (BigQuery or Google Drive)

**Files:** `ConnectSourceModal.tsx` → `ConnectSourceWizard.tsx` → `client.ts` →
`server.mjs` · connector list in `data/connectors.ts`

Three steps, driven by local state in the wizard (not a store — it is one
self-contained transaction).

**Two connectors are real, and they are the same flow in different units.**
BigQuery discovers *datasets of tables*; Drive discovers *folders of documents*.
Read the BigQuery column below and the Drive one mirrors it line for line.

| | BigQuery | Google Drive |
|---|---|---|
| consent | `GET /sources/oauth/start?provider=bigquery` | `…?provider=drive` |
| discovery | `POST /sources/preview` | `POST /sources/drive/preview` |
| register | `POST /sources` | `POST /sources/drive` |
| allowlist | datasets | folders |
| `source_id` | `bigquery:<project_id>` | `gdrive:<drive_id>` |
| `kind` | `bigquery` | `gdrive` |

### Step 1 · Connector

Seven connectors from `CONNECTORS`. Only `available: true` ones are selectable —
Google BigQuery and Google Drive. The other five (GCS bucket, Amazon S3 bucket,
PostgreSQL, Snowflake, MongoDB) render dimmed; clicking one shows *why* it is not
ready via its `reason` field rather than doing nothing. `Continue` is disabled
until an available connector is picked.

To make one usable: flip `available` and give it a real step-2 path. Its form
fields are already defined.

### Step 2 · Connection

BigQuery and Drive each get a bespoke branch (`isBigQuery` / `isDrive`, together
`isGoogle`); the five stubbed connectors fall back to the generic field loop over
`connector.fields`.

```
Login with Google
  → GET /sources/oauth/start?provider=…    issues a one-time state, scoped
  → GET /sources/oauth/callback?provider=…&as=<signed-in email>
                                           consumes it, returns the account
                                           + a session (no list)
  → GET /sources/oauth/projects?session=…  4 projects, each with a handle
    GET /sources/oauth/drives?session=…    3 drives, each with a handle
```

**The account it connects is the signed-in one.** `ConnectSourceWizard` reads
`useAuthStore(s => s.identity?.email)` and sends it as `as=`, because the identity
lives in the browser and the server has no session to look it up from. The success
alert then renders `connectedAs = signedInAs ?? account.email` — the store first,
the payload only as a fallback — so it reads `Connected as <the email you logged in
with>` even when the API answering is an older build (or the deployed box) that
still echoes `db.google_account`. The name the server derives comes from that email
(`displayNameFromEmail`), never invented. With no `as`, the server falls back to
`db.google_account` in `db.json` — which is what every user used to see. A
malformed `as` is a 400, not a silent fall back to the seed, and `check-docs`
asserts all four legs: the server reads `as`, the client sends it for both
connectors, the wizard sources it from the store, and both alerts render
`connectedAs`.

**Symptom to recognise:** the sidebar footer says `karthik@gmail.com` and the
wizard says `karthik.mahadeva@vriodigital.com`. Those two disagree only if the
alert is reading the payload — check `connectedAs`, not the server.

**Consent and discovery are two calls, not one.** The callback says *who* signed
in; what that account can *see* is spent from the `session` afterwards — what a
real handshake does (a code becomes a token, the token lists resources), and what
gives the wizard a third stage with a real request behind it. The session is
**not** single-use, unlike the state: it stands in for an access token, so a
retried discovery works instead of forcing the sign-in again.

`/oauth/projects` and `/oauth/drives` are twins, and **each refuses the other's
session by name** — answering a Drive session with an empty project list would
read as "this account has no projects".

**Signing in is never instant or silent.** All three calls are held server-side
(`CONSENT_START_MS` 900ms + `CONSENT_MS` 1400ms + `DISCOVERY_MS` 800ms ≈ a 3.1s
sign-in, tuned together to sit in the 2–4s band with no stage short enough to
flash past) for the same reason `SUGGEST_MS` holds a draft: a handshake that
finishes before the first frame paints looks like nothing happened, and it is the
one moment a user should see which scope is being granted. `GoogleConsentPanel`
shows a row per call, labels from `data/consentStages.ts`, and **a row advances
only when its request returns**, never on a timer of its own — so the panel
cannot claim progress the handshake has not made. Add a stage only when there is
a request behind it. The button reads "Signing in…" and is disabled meanwhile;
the success alert then reports the count read (`4 project(s)`, `3 drive(s)`).

**Only the success path is paced.** A replayed state, an unknown session and a
cross-provider session all answer in single-digit milliseconds — making an error
wait teaches nothing and reads as a hang.

The state is single-use — replaying it returns 400. It also **remembers which
provider it was issued for**: a BigQuery consent replayed against
`provider=drive` is a 400, not a silent cross-scope read. Selecting a project or
drive fills its credential handle and invalidates any previous preview.

There is **no raw-key path**. The "Advanced" collapse takes an id and a
credential handle only; credentials are held by reference, and the server has no
endpoint that accepts a key. Do not reintroduce one.

`Continue` requires both an id and a credential handle.

### Step 3 · Test & Finish

```
1. Run preview   POST /sources/preview        discovers datasets, registers nothing
                 POST /sources/drive/preview  discovers folders, registers nothing
2. Finish        POST /sources                registers for real
                 POST /sources/drive
```

Preview validates the handle against the project/drive (a handle for another one
gets 403) and returns the dataset or folder list, which becomes the allowlist
checkboxes — all checked, because the copy says "uncheck to exclude". Finish
rejects an empty or unknown list. The Drive preview also reports page counts and
the distinct MIME types per folder: documents are *counted*, never read, until
the profiler runs.

The dialog **stays open** after Finish so the confirmation stays readable; `Close`
dismisses it. `onRegistered` refreshes the Sources table without closing.

**Where it fails:** wrong project/handle or drive/handle pairing → 403. Empty
allowlist → 400. A consent replayed against the other provider → 400. Mock server
not running → the wizard shows the "start `npm run mock`" message.

---

## Flow 2 — What a registered source looks like

**Files:** `SourcesPage.tsx` → `sourcesStore.ts` → `GET /sources`

Columns: `source name` (with the `source_id` beneath it, because that is what the
actions act on) · `status` · `project / account` · `scope` · `connected` ·
`profiled` · Actions.

`scope` and `profiled` read in the unit of the connector: `3 dataset(s)` and
`4 table(s) · 112 col(s)` for BigQuery, `3 folder(s)` and
`10 doc(s) · 168 entities` for Drive.

The four cards read Registered sources / Profiled tables / Profiled columns /
Profiled documents. **The last three stay 0** until profiling runs — that is
correct, not a bug.

Three actions, all through the store:

| Action | Endpoint | Effect |
|---|---|---|
| Edit datasets *(BigQuery)* | `PUT /sources/:id/datasets` | narrows the allowlist; catalogue follows immediately |
| Edit folders *(Drive)* | `PUT /sources/:id/folders` | the same, in folders |
| Disconnect | `POST /sources/:id/disconnect` | revokes the credential, **keeps** the registration |
| Delete | `DELETE /sources/:id` | removes it and its catalogue rows |

One button, two modals: the row's `kind` picks `EditDatasetsModal` or
`EditFoldersModal`. Each allowlist endpoint refuses the other connector's source
with a message naming the right one rather than half-applying an edit.

Disconnect is not deletion. A disconnected source stays listed so it remains
deletable, but stops counting as connected — so the other four pages fall back to
their empty state. There is no Reconnect yet; delete and re-register.

---

## Flow 3 — Browse → profile → watch the pipeline

This is the most involved flow and the one most likely to be misunderstood.

**Files:** `CataloguePage.tsx` (`BrowsePanel`) → `catalogueStore.ts`
(`useBrowseStore`, `useJobsStore`) → `ProfilingJobsTab.tsx` → `server.mjs`
(`runJob`, `PIPELINE`)

**Drive files:** `CataloguePage.tsx` (`DocumentBrowsePanel`) →
`useDocumentBrowseStore` → the same `ProfilingJobsTab`.

### Browse

`GET /sources/:id/browse` returns only **allowlisted** datasets with their
tables. Rendered as a checkable antd `Tree`; parent/child propagation is antd's,
and leaf keys encode `dataset::table` so a checked key converts back to an object
(`leafKey` / `parseLeaf`).

`GET /sources/:id/browse-documents` is the Drive twin: allowlisted folders with
their documents, same tree, leaf keys encode `folder::document`.

Ask the wrong one and you get a **400 naming the right endpoint**, not an empty
tree — an empty tree reads as "nothing to profile" and sends you debugging the
allowlist. Same for `columns` vs `documents`, and `profile` vs
`profile-documents`.

### Start Profiling

```
POST /sources/:id/profile             →  202 Accepted, job status "queued"
POST /sources/:id/profile-documents   →  202 Accepted, job status "queued"
```

**It does not do the work.** The response is a queued job. The server then walks
it through five stages on timers — which five depends on the connector, because
extracting text from a PDF is not sampling a column:

```
queued                          queued
  → 1/5 Schema fetch              → 1/5 Text extraction
  → 2/5 Statistics sampling       → 2/5 Chunking
  → 3/5 Class inference           → 3/5 Entity extraction
  → 4/5 PII detection             → 4/5 Document PII detection
  → 5/5 Candidate keys            → 5/5 Topic classification
complete                        complete
```

Both are **five stages on purpose**, so a job row reads the same either way.

Objects are committed to the source as stages pass, so `profiled_tables` /
`profiled_columns` — or `profiled_documents` / `profiled_entities` — climb
*during* the run rather than jumping at the end.

A job's work list is `objects`, never `tables`: `{parent_id, object_id, label,
units, state}`, plus `unit: 'table' | 'document'` and `kind` on the job. One
board shows runs from both connectors, and `unit` is what it prints. A re-run
sends the objects back to the endpoint the job's `kind` came from.

Two behaviours that look like bugs but are not:

- An already-profiled table or document is **skipped**. The browse panels never
  force — their footer is `Select all · Select none · Start Profiling`.
  Re-profiling is done per-run from the **Force** button on a row in Profiling
  jobs, which re-queues that job's object set with `force: true`.
- A forced commit updates the object's record **in place** — `profiled_tables`
  and `profiled_columns` do not double on a re-run, but `profiled_at` moves.
- If everything selected is already profiled, the job completes instantly with
  `nothing to profile` instead of faking a 12-second run.

### Watching it

Starting a run **switches to the Profiling jobs tab** — from the Catalogue tab a
queued job is invisible, which was the whole point of making it async.

`ProfilingJobsTab` polls every 3s **only while `active_count > 0`**; the poll that
sees zero stops the loop, so there is no traffic at rest. Active rows are
expanded by default, tracked as *opt-outs* so a job appearing mid-poll shows its
progress without a click. The bar is blue while running, green on complete, amber
on cancelled. `Cancel` → `POST /profiling-jobs/:id/cancel`; cancelling twice
returns 409.

Re-profile / Force on a finished row re-queue the same table set — `Force` sends
`force: true`; the plain one does not, so it skips whatever is already profiled.

---

## Flow 4 — The column dictionary

**Files:** `ProfiledColumnsPanel.tsx` → `useColumnsStore` →
`GET /sources/:id/columns` → `tableDictionary()` in `server.mjs`

Facet chips (All / Needs review / PII / IDs / Measures / Dates / Text) filter
client-side; the counts come from the server's `facets`. Below them, datasets →
collapsible table cards → the column table: `COLUMN · TYPE · DESCRIPTION ·
CLASS · PII · NULL% · DISTINCT`.

**Column metadata is synthesised, and you need to know how.** `db.json` stores a
column *count* per table, not 58 hand-written schemas. `tableDictionary()` picks a
slice of `column_vocabulary` by hashing the table name, and derives every
statistic from a hash of table+column. That means:

- It is **deterministic** — repeat requests agree, so nothing shifts under the UI.
- Identifier columns get `distinct == row count`; other classes get plausible
  cardinalities by class.
- Names render uppercased-with-spaces in the UI (`foreign_generator_province` →
  `FOREIGN GENERATOR PROVINCE`); storage stays snake_case.

Editing a description (`PATCH /sources/:id/columns`) stores a note against
`dataset.table.column` on the source and flips `description_status` to
`described`, which decrements the **Needs review** facet.

To use real column names for a table, put them in `db.json` and give
`tableDictionary` a branch that prefers them.

### The document dictionary — the same idea, one level up

**Files:** `ProfiledDocumentsPanel.tsx` → `useDocumentsStore` →
`GET /sources/:id/documents` → `documentDictionary()` in `server.mjs`

Facet chips (All / Needs review / PII / Manifests / Contracts / Reports / Notes),
then folders → collapsible document cards → the entity table: `ENTITY · TYPE ·
CLASS · PII · OCCURRENCES · COVERAGE`.

Two deliberate differences from the column dictionary — do not "fix" them:

- **The facets count documents, not entities.** A file is the unit a curator
  reviews, so `all` is the profiled-document count and `pii` counts documents
  holding at least one PII entity.
- **The editable note is the document's `summary`, not a per-entity
  description.** `PATCH /sources/:id/documents` stores it against
  `folder.document` and flips `summary_status` to `described`, which decrements
  **Needs review**. Extracted entities are read-only: they are machine output,
  not curation.

Entities are synthesised from `document_vocabulary` exactly as columns are from
`column_vocabulary` — sliced by hashing the document id, statistics derived from
a hash of document+entity, so repeat requests agree. `occurrences` is 1–2 for an
identifier and recurs for prose classes; `coverage_pct` is occurrences over the
document's chunk count (`pages × 2.5`).

---

## Flow 5 — Editing the data (`/db`)

**Files:** `DbEditorPage.tsx` → `dbStore.ts` → `GET|PUT /db`, `PUT /db/:section`

Reachable by URL only — routed, but commented out of `NAV_ITEMS`.

Pick a top-level key (or `whole file`), edit JSON, Save. Three layers of
protection, in order:

1. **Client parse** — `parseDraft` keeps Save disabled until the text is valid
   JSON, so nothing invalid is ever sent.
2. **Server shape check** — `validateDb` verifies all 19 required keys and
   their basic structure. A document that would crash the app is rejected with a
   message per problem.
3. **Atomic write** — temp file + rename, so a failed write cannot truncate
   `db.json`.

Then the in-memory `db` is mutated **in place**, which is what makes the edit live
without a restart.

Two limits: registered sources are not stored in `db.json` (memory only, lost on
restart), and referential integrity is not enforced — deleting a project that a
registered source points at leaves that source with no datasets.

---

## Flow 6 — How a request becomes state

The path every read takes, and what each layer contributes:

```
component
  └─ useXStore((s) => s.field)          selects narrowly; stable refs from selectors
       └─ store.load()                   try/catch lives here; sets { data | error }
            └─ client.fn()               fetch + snake→camel mapping
                 └─ validate(schema)     rejects at the boundary, names the path
                      └─ /api proxy      Vite strips /api
                           └─ server.mjs
```

Failure modes and what the user sees:

| Failure | Message |
|---|---|
| Server not running | *Cannot reach the JSON server. Start it with `npm run mock`* |
| HTTP error | the server's own `error` text, verbatim |
| Malformed payload | *… came back in an unexpected shape: `sources[0].profiled_tables` should be a number, got string* |
| Stale server (old row shape) | *… running an older version of this API … Restart it* |
| Anything else | the error's own message — never swallowed |

`ApiErrorAlert` renders the load-failure case as the whole page, because with no
fallback data there is nothing else to show.

Actions differ from loads: they return `Result`, and the component decides
between `message.success` and `message.error`. No component contains a
`try/catch`.

---

## Flow 7 — New Graph: describing a use case

**Files:** `NewGraphPage.tsx` → `graphStore.ts` → `GET /graph-domains`,
`GET|POST /graph-use-cases`, `DELETE /graph-use-cases/:id`

Seven steps, and the premise is inverted from every other flow: **the user
describes a business need and the AI derives the graph.** Nobody types an entity
name — do not add a field that asks for one.

```
1 Domain → 2 Personas → 3 KPIs → 4 Sources → 5 Hero questions
        → 6 Answer requirements → 7 Entities & relationships
```

Labels come from `WIZARD_STEPS` in `server.mjs` via the `/graph-use-cases`
payload, so the stepper and the server's `step` validation are the same list.
**All seven steps are built.**

### Step gating

**A step unlocks only once the one before it is complete.** `stepIssue(step,
draft)` in `src/data/wizardSteps.ts` is the single definition of "complete" —
`Next`, the stepper's lock and step 7's build button all read it, so none of them
can disagree about whether a step is done. It returns the message shown to the
user, so each rule names the fix rather than the rule:

| Step | Complete when |
|---|---|
| 1 Domain | named *and* a domain picked |
| 2 Personas | at least one persona |
| 3 KPIs | at least one KPI |
| 4 Sources | the four checks below |
| 5 Hero questions | at least one question |
| 6 Answer requirements | at least one question type selected |
| 7 Entities & relationships | every gap decided — the build gate |

`maxStep` on the page is how far the draft has been taken, restored from the
saved `step` when a use case is opened. A step past it renders `is-locked` with a
lock in place of its number, and **stays clickable on purpose** — the click
answers with what is missing, where a disabled button would just read as broken.

Going **back is always free** and keeps the answers, so a cleared step can be
reopened and edited. Going forward re-checks every step in between
(`firstIncompleteStep`), because an answer can be deleted after it was given —
emptying step 3 relocks step 5. Jumping does not save; `Next` is the save point.

Server-side, only step 1's rule is enforced (`step > 1` or `status:
'committed'` without a domain → 400, checked on the merged value so an upsert
carrying the domain on the existing record still passes). The later steps stay
client-side deliberately: **Save draft** must be able to persist partial work
from any step, and a server rule would refuse it.

### Saved use cases

The card above the stepper lists every saved use case, newest first: name, a
`draft` / `committed · ready to build` status tag, its domain chip, and when it
was updated. `Open` loads it back into the form *at the step it was left on*;
committed rows read `Open → build`. Delete asks first, and deleting the row that
is currently open resets the form rather than leaving it editing a ghost.

Unlike a registered source, a use case is written to `db.json` through
`commitDb`, so drafts survive a restart.

### Step 1 · Domain

Use case name (what the drafts list shows) · business domain · the free-text
business need.

The three domain cards are **ranked by what the connected data can actually
support**. `GET /graph-domains` downgrades a seeded `strong` fit to `partial` or
`none` when nothing is profiled, because "already profiled for this domain" must
not be claimed over zero profiled objects — so with no source connected the order
and the notes legitimately differ from a screenshot taken with data. Connect and
profile a source and the backed domain climbs to the top.

`Next` refuses an unnamed use case or an unpicked domain, then **saves before
advancing**, so a reload never loses the last answer. The domain is also
enforced server-side, because every later step derives from it. Step 7's primary
action commits — status `committed`, which is what makes a row read "ready to
build".

### Steps 2 and 3 · Personas, then KPIs

**Both steps are the same component** (`DraftedStep`) over the same server
machinery — they differ only in copy and which pool they draw from:

| | Step 2 | Step 3 |
|---|---|---|
| suggester | `POST /graph-personas/suggest` | `POST /graph-kpis/suggest` |
| pool | `graph_personas` (`focus`) | `graph_kpis` (`definition`) |
| list label | Who will ask questions of this graph? | KPIs these answers report against |
| saved as | `personas` | `kpis` |

Both answer `{ suggestions: [{ id, name, detail, why }], count, derived_from }`,
and both lists are stored as `{ name, description, source }`. Adding a step 4–7
list of the same kind means reusing `DraftedStep` and `suggestFrom`, not writing
a third variant.

`Suggest personas (LLM)` → `POST /graph-personas/suggest { domain_id,
business_need }` → up to four drafts from the `graph_personas` pool. Each row
carries an **AI-DRAFTED** tag, its `why`, a **+ Add** button and an ✕ to wave it
away (local only — a suggestion was never saved).

**+ Add** moves it into *Who will ask questions of this graph?*, keeping the
focus line as its description and `source: 'ai'`.

Below the suggestions, **Add persona** — the same primary button as the
suggester, because typing your own is not a lesser path — opens a two-field form
(**name**, **description**) with `✓ Add` disabled until the name is filled, and ✕
to cancel. It sits *above* the list it adds to.

*Who will ask questions of this graph?* renders in the same tabular form as the
suggestions: name over description, then the provenance tag — **AI-DRAFTED**
(brand tint) or **USER-DRAFTED** (neutral) — and ✕ to remove. Provenance stays
visible after adding; without it a drafted persona and a typed one are
indistinguishable the moment they land in the list.

A persona is `{ name, description, source }`. The server trims, de-duplicates by
name (case-insensitive), caps at 12, and **rejects a persona with no name** rather
than dropping it silently. A bare string is still accepted and normalised, because
that is what earlier drafts hold — an old draft opens instead of rendering
`undefined` in the chip.

Three things to keep true:

- **Suggestions are not the draft.** They live in `usePersonaSuggestStore` and
  are never saved until adopted, and opening another use case clears them —
  suggestions belong to the brief that produced them.
- **Every suggestion explains itself.** The ranking is keywords found in the
  business need, then domain fit, then a hash of the brief; the `why` states
  which it was ("matches your brief on cost, spend, escalation" vs "typical for
  this domain"), and it is deterministic for the same brief.
- **A brief that names a known use case is answered from it, not ranked.** If
  the business need contains two or more of a `graph_use_case_templates` entry's
  `match_phrases` — pasting that use case's description hits all of them — the
  step drafts exactly that use case's personas, KPIs and hero questions, whole
  and in its own order, past the four-suggestion limit. The `why` reads "named
  in the … use case" and `derived_from` names it. Two templates tying matches
  neither, and the keyword ranking answers instead.
- **Personas are tags, not permissions.** The panel says so, and the server never
  validates a persona against the suggestion pool — the user may add their own.

With no brief the suggester falls back to domain only and says so
(`derived_from`). Omitting `personas` from a save leaves them untouched; sending
`[]` clears them.

### Step 4 · Sources

**Files:** `SourcesStep.tsx` → `useGraphSourcesStore` → `GET /graph-sources`

This is the one step whose answers are not free text: it lists **what the Data
Catalogue has actually profiled**, per connected source, in that connector's unit
— `epa_dataset2.manifest_header · 42 columns` for BigQuery, `Audit reports /
FY25 audit.pdf · 26 entities` for Drive.

Select a source, then keep `All profiled tables (N)` or `Choose tables…` and pick
from the box. A pick is `{ source_id, mode, objects }`; **`mode: 'all'` keeps
meaning "everything profiled here"**, so a table profiled after the draft was
saved is included without reopening the wizard, while `subset` pins an explicit
list.

**Two dead ends, two different exits.** Telling someone to connect a source when
they already have three is useless advice, so the step distinguishes them:

| State | What step 4 shows |
|---|---|
| nothing connected | `NoSourceConnected` — "Connect a source" → `/sources` |
| connected, nothing profiled | an **error** alert — "No profiled data yet — you cannot select a source", with "Open the Data Catalogue to profile a source" → `/catalogue`, above the cards, each tagged `nothing profiled` and disabled |
| something profiled | the selection UI; the alert disappears |

**`Next` refuses to leave step 4 empty** (its rule lives with every other step's,
in `wizardSteps.ts`), and names the fix for each case: no
sources connected → go to Sources; connected but unprofiled → go to the Data
Catalogue; profiled but nothing selected → select a source; a `subset` with no
objects → pick one or switch back to all. Every later step derives from this
selection, so advancing empty would build a graph over no data.

Three refusals, all server-side too, because these answers must still be true at
build time:

- picking a source that is connected but has **nothing profiled** → 400 pointing
  at the Data Catalogue. It is still *listed*, tagged `nothing profiled` and
  disabled — "not profiled yet" is a different problem from "not connected", and
  hiding it would make the two indistinguishable.
- a `subset` selecting nothing → 400 (*"an empty selection can't derive"*)
- an object that is not profiled on that source, or a source that is not
  connected → 400 naming it

Disconnecting a source removes it from what this step offers, so a stale pick
cannot survive quietly.

### Step 5 · Hero questions

**Files:** `HeroQuestionsStep.tsx` → `useQuestionSuggestStore` →
`POST /graph-questions/suggest`

The questions the graph exists to answer — and the **High** ones are its
*contract*: what it must be able to answer to count as built.

Not a `DraftedStep`, deliberately. A hero question is one long sentence rather
than a name plus a description, so it gets a card with the controls beneath it,
and its second field is a **High** checkbox rather than more text. Five are
drafted rather than four, because a contract wants a little more to choose from.

- **Suggested questions** — each card carries `AI-DRAFTED`, a **High** checkbox,
  `+ Add` and ✕. High is decided *as you accept it*, not afterwards, so the
  checkbox sits on the suggestion too. It arrives **already ticked** when the
  drafted question carries its own `priority` — a use case that already said
  a question is High should not make you say it again — and ticking or unticking
  still wins over that default.
- **Your questions** — one row each: a `HIGH` badge on the left when marked,
  the text, then `AI-DRAFTED`/`USER`, a still-editable **High** checkbox, and ✕.
  Nobody gets a contract right first time, so priority stays changeable.
- **+ Add question** opens a High checkbox, a pill input and `✓ Add` (disabled
  until there is text) with a round ✕ to cancel.

Stored as `hero_questions: [{ text, priority, source }]`. `priority` is
two-valued on purpose — a third tier would invite ranking instead of choosing.
The server de-duplicates by text (case-insensitively), caps at 20, accepts a bare
string from an older draft, and **rejects a question with no text**.

### Step 6 · Answer requirements

**Files:** `AnswerRequirementsStep.tsx` → `useAnswerFormatStore` →
`POST /graph-answer-formats/suggest`

Two declarations, and the step exists so they are *declarations*:

- **Citations** — a pair of pills, `Required — every claim cites its source` or
  `Optional`. Required is the default: a graph that cannot show its source is not
  auditable, so opting out is the deliberate act.
- **Answer format by question type** — checkbox cards, each a question type over
  its render recipe (`Cost drivers` / *narrative + drivers table + trend*). The
  three shown are drafted from the domain and the brief by the same
  `suggestFrom` ranking, limited to three because this step picks between
  formats rather than accumulating them.

The note under the cards is the point of the whole step: *the use case declares
how answers render; the engine never chooses the format at runtime.*

Unlike steps 2, 3 and 5 there is no Suggest button — the formats **load on
arrival**, since a choice you cannot see is not a choice.

Saved as `citations` plus `answer_formats: [{ format_id, name, format }]`, stored
**self-describing on purpose**: editing the pool in `db.json` later must not
silently change what an already-saved brief promised. A bad `citations` value, a
format with no `format_id` or `name`, or a non-array is a 400.

The primary action here reads **Generate use-case brief →**, not Next: this is
the last step the user answers, and step 7 is what the AI derives from it.

### Between 6 and 7 · the derivation run

**Files:** `LlmRun.tsx` → `useDerivationStore` → `POST /graph-derivations`,
`GET /graph-derivations/:id`

`Generate use-case brief` hands the answers to a derivation and advances
immediately. Step 7 then shows the run rather than a blank wait:

```
                        ◜  spinner
        Deriving the entities you need…
  Capital Project, Authorization, Purchase Order, Cost Line…
  ███████████░░░░░░░░░░░░░░░░░░░░░░░░░
  async — safe to leave; you’ll be notified · run cost so far $0.34 of $1.00 cap
```

The answer is computed up front — `graphCoverage` is deterministic — but revealed
over five stages on timers, exactly as the Metadata Profiler is, and for the same
reason: **the run is genuinely async** (it has an id, and polling resumes it), and
a wizard that jumps straight to a finished answer teaches that deriving a graph is
instant and free. Entity names stream in proportionally to the bar; cost accrues
per stage and stops at the cap.

The page polls every 700ms **only while the run is in flight**. Arriving at step 7
without a run — by clicking the stepper — reviews directly through
`/graph-coverage` instead, so the step is never blank just because the run started
elsewhere. Starting a new derivation clears any gap decisions: they were answers
about a previous derivation.

### The LLM drafting state

Every `Suggest … (LLM)` button shows an inline strip while it waits — what it is
doing (`Reading your brief · Drafting candidates · Ranking against your data`) and
what the last call cost. The suggest endpoints are **held for `SUGGEST_MS`
deliberately**: there is no model here, so they would otherwise return in about
2ms, leaving the UI nowhere to show that something was asked of an LLM and
teaching that the call is free. Cost is deterministic per brief, and the strip
shows no figure at all until a run has reported one.

### Step 7 · Entities & relationships (coverage review)

**Files:** `CoverageStep.tsx` → `useCoverageStore` → `POST /graph-coverage` ·
build gate in `data/coverage.ts`

The only step the user does not fill in — it reports what the AI derived from
everything above, **checked against the catalogue**.

**Every backed element names the profiled object it came from.** An entity *is* a
profiled table or document, so its evidence line reads
`context-weave-dev · manifest_header (1,240,500 rows) · match 0.89`. Nothing here
is invented: the entity name is the table name in title case, the row count comes
from `db.json`, and a **relationship is only claimed where two profiled objects
share an identifier column** in the column dictionary — that shared key is the
evidence (`shared key batch_id · match 0.94`). Anything looser would be a guess
dressed as a derivation.

A hero question whose vocabulary appears in no profiled column becomes a **gap**:
*"No candidates in any connected source — nothing profiled covers purchase,
orders, lived."* Each gap offers four decisions — `accept permanent`,
`drop question`, `connect source`, `defer with trigger` — stored as
`gap_decisions: [{ element_id, decision }]`.

**Save & build graph is disabled until every gap has a decision**
(`coverageIsDecided`); `Save Only` always works. An undecided gap is a question
the graph cannot answer, and shipping it silently is the failure this step exists
to prevent.

The review is **re-derived on every arrival**, never cached — narrowing a source
pick on step 4 immediately narrows what step 7 reports.

**Where it fails:** an unnamed draft → 400 (`name is required`), an unknown
domain or an out-of-range step → 400, opening a use case the server no longer has
→ 404. All surface through the store's `Result`, so the page shows a message and
keeps its state.

---

## Flow 8 — Graph Studio: a built graph becomes a published one

**Files:** `GraphStudioListPage.tsx` · `GraphStudioPage.tsx` →
`ReviewQueueItem.tsx` → `graphStudioStore.ts` → `GET /graph-studio`,
`GET|POST /graph-studio/:useCaseId…`

```
New Graph step 7 · Save & build graph
        → /graph-studio/:useCaseId          the new graph's review, opened
/graph-studio                                every graph you have built
        → click one → Review queue (23) · Canvas · Query & sanity-check
                      · Quality report · Versions
```

Every tab is built. The header carries only what is live and **Publish vN…** —
each tab owns its own actions, so the quality check runs from the Quality report
tab where its result lands, not from a header that would then show nothing.

### The list

Only graphs that have been **built** — a use case committed on step 7. Each row
carries its name, domain, `draft v15` / `published`, when it was built, and the
one number that decides whether it can ship: how many items still need a human.

A use case still in the wizard is not listed, and opening its id is **refused
with a 400 naming the fix** rather than a 404 — "not built yet" is a different
problem from "no such graph". The draft count is still shown, because that is
the answer to "where did my graph go?".

### One graph's review

Four buckets, split by confidence and by whether a *floor* was hit:

| Card | Meaning |
|---|---|
| **Must review** | below 0.85 and on a floor — these block publish |
| **Pivot** | an entity-resolution question that blocks the build outright |
| **Confirmed FYI** | 0.85–0.95, spot-checked |
| **Auto-approved** | ≥0.95, listed for the record |

**Every figure is the length of something returned.** `db.json` holds the four
authored rows, the pivot and the totals; `studioItems` synthesises the rest from
a hash that includes the use case id — so each built graph has its own queue, and
repeats agree. Confidence is generated inside each bucket's band, so a card
cannot lie about its own filter. Confirmed and auto-approved return a named
`*_sample`; 466 is a count, not a list.

`action_set` decides a row's buttons. A causal claim gets **Approve as causal /
Downgrade to correlational / Reject** — never a plain "Approve", because only one
of those keeps the causal edge. The server's `allowed` list refuses anything
else, so add a set in both places or not at all. A `schema-changing` row cannot
be resolved without a justification, refused server-side.

Every action answers with the whole studio, so the cards, the gate and the row
move together and no second fetch can leave them disagreeing.

### The publish gate

**The pivot is a separate precondition from the queue.** Resolving all 22 rows
still leaves publish blocked while it is open, because settling it changes what
the already-decided rows mean — which is why the pivot sits *above* the rows
rather than in them.

`publish.blocked` and its `reasons` are computed once, on the server. The
button's `disabled`, its tooltip, the banner and the `POST …/publish` refusal all
read that one list, so a UI that forgot to disable still cannot publish.
Publishing makes the **draft's own** version live — `draft v15` publishes as
`v15`, and the next draft becomes v16.

**Where it fails:** a plain approve on a causal row → 400 naming the three legal
choices; a schema-changing row with no justification → 400; an unknown item →
404; an unknown pivot option → 400 naming the two; publish while blocked → 400
listing the same reasons the banner shows; opening an unbuilt draft → 400 telling
you to finish the wizard.

Decisions and the pivot live **in memory**, keyed `useCaseId:itemId` so two
graphs cannot answer each other's rows — a review pass is a working session, not
something a mock writes back over its seed.

### Canvas

**Files:** `GraphCanvas.tsx` + `data/canvasLegend.ts` → `GET /graph-studio/:id/canvas`

The ontology as nodes and edges, drawn in **hand-written inline SVG** — no graph
library, for the same reason the mock server has no dependencies. Node positions
are seeded in `db.json` so a reload draws the same picture; dragging moves a node
in local state only, because rearranging is a reading aid, not an edit.

**The canvas and the review queue are the same truth.** A node or edge carrying a
`review_item_id` is *proposed* exactly while that row is undecided — approve the
Contractor row and its node un-dashes here, correct it and the node becomes
`studio-authored` (which is what the fourth filter chip counts). The inspector
says so and links back to the queue.

Colour is the legend group — a *category*. The one state shown is "proposed",
and it carries a dashed outline and the word as well as a colour. Filter chips
show counts, so an empty result reads as "none match" and not as a broken chip.

### Query & sanity-check

**Files:** `GraphStudioPage.tsx` → `POST /graph-studio/:id/query`

A question asked of the **draft**, before anyone commits to it. There is no
engine: the entities named are matched to nodes and the path between them is
walked over the edges that actually exist, so the path *is* the evidence — and it
comes back as a canvas with those nodes marked, which is what the glow on the
Canvas tab is.

Three honest failures, and they are the point:

- a question naming **no** entity in the graph → not answerable
- naming **one** → "a question needs two things to relate"
- naming two that **nothing connects** → says so rather than inventing a hop

An answer crossing an undecided edge is answerable **and provisional**, and says
which decision it is resting on — publishing would change it.

Matching requires the whole label or a word unique to one node. A bare shared
word is not enough: "work order" would otherwise also match Change Order on
"order" and confidently answer about a pair nobody asked for.

### Versions

The table lists **only published versions** — the draft is not one of them.

**Three acts, deliberately separate:**

| Act | Endpoint | What it means |
|---|---|---|
| publish | `POST …/publish` | put this draft on the shelf; it also starts serving |
| approve | `POST …/versions/:v/approve` | a human read the report and signed it off |
| activate | `POST …/versions/:v/activate` | point the graph at it — this is rollback |

**Approval gates activation.** An unapproved version cannot be made live, so the
sign-off is never decorative; the row shows "approve first" rather than a
disabled button with no reason. Any *approved* version can be activated,
including an older one — which is why **live is not "the newest"**. It is
tracked explicitly, each row carries `is_live`, and exactly one does.

Publishing sets serving to what it just published; nothing else moves it, so a
rollback survives until someone changes it again. A rollback does **not** touch
the draft version — v18 stays the draft while v15 serves.

**Where it fails:** activating or approving an unpublished version → 404;
activating an unapproved one → 400 naming the fix; activating the live one → 400;
approving twice → 400 naming who already did it.

---

## Flow 9 — Ask: querying a published graph

`AskPage.tsx` → `askStore` → `GET /ask` · `POST /ask`

Where the graph gets used. Everything before this flow produces a graph; this is
the flow that spends it.

### What can be asked

Only a graph that is **live** — published, and the version currently serving.
`GET /ask` walks the built graphs, keeps the ones `liveVersion()` answers for,
and returns each with the facts the page prints:

| Field | Where it comes from |
|---|---|
| `version` | the live published version, never the draft counter |
| `published_at` / `published_by` | the publish record in Graph Studio |
| `caveats` | step 7's gap decisions, read back through `GAP_CAVEAT` |
| `citations` | step 6's promise — `required` or `optional` |
| `suggested_questions` | the use case's hero questions, verbatim |
| `entity_count` / `relationship_count` | the canvas |

Nothing here is page copy dressed as data. A suggestion chip is a hero question
the brief already committed to; a chip for something the graph was never built
for would be a trap.

### The empty page

Three different sentences, because they have three different fixes:

- **built but unpublished** (`built_count > 0`) → "publish it in Graph Studio",
  and the button goes there.
- **only drafts** (`draft_count > 0`) → finish the wizard first.
- **nothing at all** → describe a business need.

Getting this wrong sends someone to New Graph to fix a graph that only needed
publishing, which is why the two counts ship separately rather than as one
"nothing to ask".

### Asking

`POST /ask { use_case_id, question }` runs `studioQuery` — **the same walk the
studio's sanity check uses**, so a check that passed before publishing cannot
disagree with the answer after it. The reply carries four steps of working
(grounded → planned the route → routed to source systems → composed), one
citation per relationship walked, and a confidence that is the **weakest node on
the route**. Held for `ANSWER_MS`; errors are never paced.

**An abstention is a real answer.** No entity named, only one named, or two with
nothing between them → `answered: false`, `reason` says which, and `answer` and
`confidence` are `null`. The page tags it `warn`, not `crit`: declining to guess
is the behaviour, not a fault.

**Where it fails:** no `use_case_id` → 400 "choose a graph"; unknown id → 404;
a draft → 400 from `findBuiltGraph`; built but never published → 400 naming
Graph Studio; an empty question → 400. Every one of them is shown verbatim, so
each is written as a sentence to a user.

---

## Adding things

**A new endpoint**

1. Route in `server.mjs` (and its line in the header comment).
2. Response schema in `client.ts` — not optional; the boundary check is what
   turns a malformed payload into a readable message.
3. Fetcher in `client.ts`, mapping snake_case for any field the UI touches.
4. Store action returning `Result`, with the `try/catch`.
5. Component reads the store.

**A new page**

`src/pages/X.tsx` → route in `routes.tsx` → entry in `nav.ts` (`NavKey` *and*
`NAV_ITEMS`) → gate it on `connected_sources` with `NoSourceConnected` if its data
derives from a source.

**A new connector**

Entry in `data/connectors.ts` with its `fields`. `available: false` needs a
`reason`. Making it real means a step-2 branch in the wizard and server support;
`ConnectorIcon` needs a mark, or it falls back to BigQuery's.

Google Drive is the worked example of making one real — copy its shape rather
than inventing a third: `kind` on the record, its own preview/register/browse/
profile/dictionary endpoints, its own `PIPELINE`-length stage list, and a 400
from every endpoint of the *other* connector naming the right one. Reuse the job
machinery (`queueJob`, `runJob`, `objects`) instead of adding a second board.

**Verifying any of it**

`npm run preflight`, then an SSR smoke script for the behaviour — exercise the
failure paths, not just the happy one. Most of the real bugs found in this
codebase were wrong shapes and stale processes, and both show up only when you
check what happens when things go wrong.
