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
  → GET /sources/oauth/callback?provider=… consumes it, returns account +
                                           4 projects / 3 drives, each with
                                           a credential_handle
```

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

Re-profile / Force on a finished row re-queue the same table set.

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
2. **Server shape check** — `validateDb` verifies all 17 required keys and
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
advancing**, so a reload never loses the last answer. Step 7's primary action
commits — status `committed`, which is what makes a row read "ready to build".

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

**`Next` refuses to leave step 4 empty**, and names the fix for each case: no
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
  checkbox sits on the suggestion too.
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
