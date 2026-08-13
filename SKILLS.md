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

**Each card carries its vendor mark**, from `ConnectorIcon` — inline SVG, so
nothing is fetched. A vision connector keeps its mark, desaturated: removing it
would leave holes in the grid that read as still loading, and leaving it at full
colour would make an unavailable card the brightest thing on the row.

**Every connector key needs a mark of its own, and `check-docs` enforces it.**
`ConnectorIcon` used to fall back to `BigQueryIcon`, so the five connectors
without one were each drawn *as BigQuery* — harmless while nothing rendered them,
a card claiming to be a product it is not the moment step 1 showed icons. The
fallback is now a neutral cylinder labelled with the key it did not recognise.

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
  → GET /sources/oauth/projects?session=…  the projects, each with a handle
    GET /sources/oauth/drives?session=…    the drives, each with a handle
```

**There is no popup.** One button runs all three calls, with
`GoogleConsentPanel` inline beneath it — a row per call. A Google-styled
click-through window (account chooser → Allow) was built and removed; do not
re-add one without being asked.

**The panel lists the scopes `/sources/oauth/start` returned**, not a per-provider
constant. Drive asks for **two** (`drive.metadata.readonly` *and* `drive.readonly`
— the second is what lets profiling read a document's text), and the first version
of this footer named one. `CONSENT_GRANT_COPY` in `data/consentStages.ts` supplies
wording keyed by scope URL; an unmapped scope renders as its bare id rather than
vanishing, and `check-docs` fails if the server can issue a scope with no copy.
`CONSENT_SCOPES` is only the fallback for stage 0, when the call that reports them
has not returned yet — before that, listing two would be a guess.

**The source name is required, and at least `SOURCE_NAME_MIN` (6) characters.**
One rule, in two halves that `check-docs` keeps equal: `sourceNameProblem` in
`data/sourceName.ts` refuses before the round trip, and its twin in `server.mjs`
refuses the write on all three register endpoints. **No id fallback** —
`source_name || project.display_name || project_id` used to make the field
optional in practice, and produced rows named `vrio-contextweave-demo`, which
reads as a name and is not one. The error appears once the field has been touched,
not on arrival; `Next` refuses at step 2 with the length in the message. The five
stubbed connectors get the same floor from the same constant, via `minLength` on
their `sourceName` field.

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

**Symptom to recognise:** the sidebar footer says the email you logged in with and
the wizard says `nishant.srivastav@vriodigital.com` (the `db.google_account`
seed). Those two disagree only if the alert is reading the payload — check
`connectedAs`, not the server.

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
a request behind it. It renders inline under the button while `busy === 'login'`,
starting at stage 0 — the `/oauth/start` call already in flight.

The button reads "Signing in…" and is disabled meanwhile; the success alert then
reports the count read (`1 project(s)`, `1 drive(s)` for the seeded demo) — the
count comes from the response, never a written figure.

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

### The source list

Left column, one card per connected source. **The `source_id` leads and the name
the user gave rides beside it as a neutral tag** (`cat-source-name`) — the id is
what every action acts on, but `bigquery:vrio-contextweave-demo` is not what
anyone is scanning for. Same pairing in the detail header. Now that a name is
required and at least six characters (Flow 1, step 2), that tag always says
something; before, it would often have echoed the project id.

Neutral tints, not `STATUS`: a name is not a state. The id ellipsises before the
name does, because its project part is repeated on the meta line under it.

### Browse

`GET /sources/:id/browse` returns only **allowlisted** datasets with their
tables. Rendered as a checkable antd `Tree`; parent/child propagation is antd's,
and leaf keys encode `dataset::table` so a checked key converts back to an object
(`leafKey` / `parseLeaf`).

**A leaf names the object twice, and both are needed.** The id is what the run
posts back, so it leads; under it sit the view's `label` and its `grain` — a Gold
view called `e_manifest` is unusable until the tree says it is
`e-Manifest (shipments)`, one row per shipment. Both come from `db.json` and are
carried straight through `browsableObjects`, so `validateDb` refuses a document
whose tables have lost either.

`GET /sources/:id/browse-documents` is the Drive twin: allowlisted folders with
their documents, same tree, leaf keys encode `folder::document`. Its second line
is `doc_type_label · linked_entity` — what the file *is*
(`Consent Decree (modification)`) and which graph entity it maps to
(`J.R. Simplot Company Don Plant`), from the extraction map. `linked_entity` is
never synthesised: it is the join to the structured side, and a hash must not
invent it.

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

Facet chips (All / Needs review / PII / IDs / Measures / Dates / Location / Flags)
filter client-side; the counts come from the server's `facets`. **They are the
classes this data actually has** — the profile uses eight (`identifier date
dimension entity address geo flag measure`) and none is `text`, so a Text chip
would have read 0 for all 206 columns. `Location` folds `address` and `geo`
together, 69 of the 206; `check-docs` asserts the server's arithmetic and the
panel's filter fold them the same way, because a chip that counts 69 and lists 41
is worse than either number alone. Below them, datasets →
collapsible table cards → the column table: `COLUMN · TYPE · DESCRIPTION ·
CLASS · PII · NULL% · DISTINCT`. Each card head repeats the view's `label` and
`grain` beside the id, because a column list means nothing until the row it
describes is named.

**For `epa_hazwaste`, the columns are real.** `column_profiles` in `db.json` holds
all **206** — ingested from ` _demo_data_package_2026-08-10/02_profiling/`
`Metadata_Profiling.xlsx`, one sheet per view — with the profiler's own
`label`, `type`, `description`, semantic `class`, `derivation`, `confidence`,
`pii`, `null_pct` and `distinct`. `tableDictionary()` serves that verbatim for any
`dataset.table` it has an entry for, and `check-docs` asserts the count matches
what the catalogue claims for each view, so the two cannot drift.

To re-ingest after the workbook changes, re-run the ingestion (a scratch script;
the reader is ~100 lines of zip + XML rather than a dependency). Rounding
`null_pct` on the way in is deliberate: the workbook carries
`88.09999999999999`, which is float noise, not a statistic.

**`needs review` means low confidence, not a missing description.** Every real
column arrives described, so "has one" would pin the facet at 0 forever. It is set
when the profiler was below the High band (**0.85**, `HIGH_CONFIDENCE`) and no
curator has confirmed it — 81 of the 206 on arrival. A curator note settles it and
decrements the facet, exactly as before.

**Column metadata is synthesised for anything else, and you need to know how.**
`synthesiseColumns()` is the fallback for a table `column_profiles` does not
cover: `db.json` stores a column *count*, and the columns come from a slice of
`column_vocabulary` chosen by hashing the table name, with every statistic derived
from a hash of table+column. That means:

- It is **deterministic** — repeat requests agree, so nothing shifts under the UI.
- Identifier columns get `distinct == row count`; other classes get plausible
  cardinalities by class.
- Names render uppercased-with-spaces in the UI (`manifest_tracking_number` →
  `MANIFEST TRACKING NUMBER`); storage stays snake_case.
- **A `_2` is only ever a second copy.** The slice starts at a hashed offset, so
  the vocabulary's lap boundary falls mid-list; suffixing by lap made a 50-column
  view show `manifest_tracking_number_2` with no `_1` anywhere. The suffix now
  counts uses *within that table*, so a table no wider than the vocabulary has
  none at all, and `e_manifest_all` (92 columns over 50 entries) has exactly 42.

Editing a description (`PATCH /sources/:id/columns`) stores a note against
`dataset.table.column` on the source and flips `description_status` to
`described`, which decrements the **Needs review** facet.

To give another table real columns, add a `column_profiles` entry keyed
`<dataset>.<table>`; `tableDictionary` already prefers it. Do not extend
`column_vocabulary` to imitate a table the profiler has already described.

### The document dictionary — the same idea, one level up

**Files:** `ProfiledDocumentsPanel.tsx` → `useDocumentsStore` →
`GET /sources/:id/documents` → `documentDictionary()` in `server.mjs`

Facet chips (All / Needs review / PII / Consent decrees / Complaints /
Settlements / CAFOs), then folders → collapsible document cards → the entity
table: `ENTITY · TYPE · CLASS · PII · OCCURRENCES · COVERAGE`. Each card head
carries the file's `doc_type_label` and `linked_entity` beside its name, in
neutral tints — what a document is and who it is about are categories, not state.

**The four type facets are the corpus's own kinds, not a fixed taxonomy.** They
match `doc_type`, the slug, and the map lives in one place per side
(`FACET_FOR_TYPE` in `server.mjs`, `TYPE_FOR_FACET` in the panel) —
`check-docs` asserts the two agree. A consent-decree *modification* files under
Consent decrees because that is what it is; only `doc_type_label` says it is a
modification. Reseed `drives` with different kinds and both maps move together.

**Each card carries the document's *resolution into the graph*, and it is real.**
`document_extractions` in `db.json` — ingested from
`08_unstructured/Entity_Extraction_Map.xlsx` — records, per file, the entity the
extractor pulled out, the facility node it resolved to (`FAC:LAD727050419`), that
node's state, and **how many inbound manifests it already carries**. That last
number is the payoff: it is what makes a consent decree connect to the manifest
stream, so it is read, never derived. Two documents about one facility resolve to
the *same* node — Chemours cd + cp → `FAC:NCD844706749`, Stericycle complaint +
settlement → `FAC:ILR000067890` — which is the entity resolution working, not a
duplicate.

A document with no entry renders **"No graph entity resolved from this document
yet."** rather than an empty strip, and `check-docs` fails if a seeded document
has no extraction, so that sentence means "nothing matched" and never "the
ingestion skipped a row".

Two deliberate differences from the column dictionary — do not "fix" them:

- **The facets count documents, not entities.** A file is the unit a curator
  reviews, so `all` is the profiled-document count and `pii` counts documents
  holding at least one PII entity.
- **The editable note is the document's `summary`, not a per-entity
  description.** `PATCH /sources/:id/documents` stores it against
  `folder.document` and flips `summary_status` to `described`, which decrements
  **Needs review**. Extracted entities are read-only: they are machine output,
  not curation.

**The entity *list* is still synthesised, and the two halves stay apart.** The map
describes one entity per file, not the dozens a 96-page decree holds, so the table
comes from `document_vocabulary` — sliced by hashing the document id, statistics
derived from a hash of document+entity, so repeat requests agree. `occurrences` is
1–2 for an identifier and recurs for prose classes; `coverage_pct` is occurrences
over the document's chunk count (`pages × 2.5`). The resolved entity is reported
in its own row rather than dropped into that list, because a fact that was read and
a fact that was hashed must not sit in the same column looking alike —
`check-docs`-adjacent coverage asserts no `FAC:` id appears among the entities.

---

## Flow 5 — Editing the data (`/db`)

**Files:** `DbEditorPage.tsx` → `dbStore.ts` → `GET|PUT /db`, `PUT /db/:section`

Reachable by URL only — routed, but commented out of `NAV_ITEMS`.

Pick a top-level key (or `whole file`), edit JSON, Save. Three layers of
protection, in order:

1. **Client parse** — `parseDraft` keeps Save disabled until the text is valid
   JSON, so nothing invalid is ever sent.
2. **Server shape check** — `validateDb` verifies all 25 required keys and
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

- **Suggested questions** — each card carries the question, then **what it is
  for**, then **why it was drafted**, then `AI-DRAFTED`, a **High** checkbox,
  `+ Add` and ✕. The two middle lines are the same pair `DraftedStep` gives a
  persona (`detail` then `why`) and they are not interchangeable: the first is the
  reason the brief gave for asking ("the core liability question — connects
  inbound manifests to generator compliance records"), the second is why this
  suggester surfaced it ("named in the … use case", "matches your brief on
  transporter, loads"). This step used to render **neither**, so a drafted
  question was the one suggestion in the wizard that arrived unexplained.
  A question with no stated rationale simply has no `detail` line.
  High is decided *as you accept it*, not afterwards, so the checkbox sits on the
  suggestion too. It arrives **already ticked** when the drafted question carries
  its own `priority` — a use case that already said a question is High should not
  make you say it again — and ticking or unticking still wins over that default.
  **The current use case states no priorities**, so nothing arrives ticked; that
  is the brief being silent, not a bug to fix by inventing them.
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
        → POST /graph-use-cases              commits the brief (pin_inputs)
        → POST /graph-studio/:id/builds       202 + a queued run
        → /graph-studio/:useCaseId            lands on Build, watching that run
/graph-studio                                every graph you have built
        → click one → Build · Review queue (6) · Canvas · Query & sanity-check
                      · Quality report · Versions
```

### The Build tab

**Files:** `GraphStudioPage.tsx` → `useGraphBuildStore` → `BuildTab.tsx` →
`POST|GET /graph-studio/:id/builds`, `GET …/builds/:buildId`

Eleven stages, in dependency order — `pin_inputs`, `a01_schema_parsing`,
`join_matrix`, `entity_nomination`, `a03_relationship_inference`,
`a02_document_entity_extraction`, `a02b_document_relationship_mining`,
`a03b_cross_pipeline_reconciliation`, `a04_entity_resolution`,
`a015_comprehension`, `a05_graph_construction`.

**Each stage names its own substeps, and they are what advances.** A stage carries
2–3 (`pin_inputs` → `resolve_use_case`, `seal_coverage_evidence`,
`pin_source_versions`) — 31 in total at `BUILD_STEP_MS` (**5s**) each, so a run
takes about **2m 35s**. That is slow on purpose: a substep is paced to be narrated
while it runs, not merely to prove the work was not free.

**Because it takes minutes, the panel states the pace and the time left.** Both come
from `step_ms` in the payload, never from a number typed into the component — a
multi-minute spinner with no estimate reads as a wedged process, and an estimate the
client invented would be wrong the moment the server's pace changed.

**One cursor drives both levels.** `BUILD_STEPS` is the pipeline flattened, and a
run keeps nothing but an index into it: a substep is complete before the cursor,
running at it, pending after, and a stage is `running` exactly while the cursor
sits inside it. A stage index kept alongside a step index is two counters that can
disagree, and the screen would show a stage complete while one of its substeps
still spun. The server drives the cursor and the page polls every 350ms; a row
turns green when the server says it did, never on a timer of its own.

**Every stage and every substep is listed from the first response**, `pending`
until it runs: a list that grew a row at a time would hide how much is left, which
is the only thing the panel is for. Substeps stay visible on a stage that has not
started for the same reason. The names are printed **verbatim** so a row on screen
is greppable in a log — do not prettify them.

**Why here and not in the wizard.** A graph is built more than once: settling review
rows changes what a build produces, so **Rebuild** is the normal case. Every run is
kept in that graph's history and an earlier one stays loadable from the picker.
The wizard's job ends at starting the first one.

**Building is not publishing.** The footer names the draft version the run produced
and says to publish it from Versions; the publish gate is untouched and still
refuses while the queue or the pivot is open. `package_id` and `graph_version` are
minted per run, so a rebuild is visibly a different package.

**Where it fails:** a draft → 400 from `findBuiltGraph` naming "finish it in New
Graph"; a build the server has forgotten → 404 saying builds live in memory and a
restart clears them. If the wizard's build fails to start, the brief is still
committed and the message says both.

Every tab is built. The header carries only what is live — each tab owns its own
actions, so the quality check runs from the Quality report tab where its result
lands, and publishing runs from a version's own row in Versions, where the version
being published is the one you are looking at.

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

**Every figure is the length of something returned.** `db.json` holds the queue, the
pivot and the totals, all ingested from the package's **trust lanes** (`autoApprove`
398 · `confirmedFyi` 12 · `mustReview` 6 · `pivot` 1, summing to its
`elements_total`). The must-review lane is entirely authored — `must_review_total`
equals the ingested row count, so nothing synthesised pads the lane a reviewer must
clear. The two spot-check buckets *are* synthesised by `studioItems` from a hash that
includes the use case id, so each built graph has its own sample and repeats agree,
and confidence is generated inside each bucket's band so a card cannot lie about its
own filter. Those return a named `*_sample`; 398 is a count, not a list.

**Five rows plus the pivot.** The package ships six must-review decisions and `rq1`
is the identity merge (Texas Molecular LP ⇄ VLS Texas Molecular), which is the one
that changes what every other row *means* — so it is ingested as the pivot and the
queue holds the other five. The arithmetic still matches the package's
`mustReviewTotal`, and `check-docs` asserts the merge is in exactly one of the two:
in both, a reviewer could answer one question two ways.

**A row's buttons are its own labels.** Each states three in its own terms — "Keep
distinct", "Declare basis = manifest", "Leave orphaned" — while the *choice* behind
each stays one of the fixed set, because what a decision means to the canvas has to be
identical on every row. The server validates against the row's own `actions` and names
them in the refusal (`"approve-causal" is not one of the choices rq4 offers — it
takes: approve, correct, reject`), and the page reads that same list, so it cannot
offer a button the API rejects. `action_set` is the fallback family for a row stating
none, and where the causal pair still lives: **Approve as causal / Downgrade to
correlational / Reject**, never a plain "Approve", because only one keeps the causal
edge. A `schema-changing` row cannot be resolved without a justification, refused
server-side.

**A row's `graph_refs` are not what it makes provisional.** Refs are what the row is
*about*; the provisional set is what its decision still governs, mapped explicitly in
the ingest. rq5 and rq6 deliberately mark nothing — rq5 declines a promotion so there
is no node to dash, and rq6 concerns three attachments below the floor that were never
drawn.

Every action answers with the whole studio, so the cards, the gate and the row
move together and no second fetch can leave them disagreeing.

### The publish gate

**The pivot is a separate precondition from the queue.** Resolving all five rows
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
*and radii* are seeded in `db.json` so a reload draws the same picture; dragging
moves a node in local state only, because rearranging is a reading aid, not an edit.
The viewBox is measured from the nodes rather than fixed in the component — a
hardcoded box is a second opinion about the layout, and the drag maths reads from it.

**It draws the demo package's knowledge graph**, ingested from
`05_knowledge_graph/knowledge_graph.json`: **189 nodes, 241 edges**, one hub (VLS
Texas Molecular, 61 relationships), 49 facilities, 40 evaluations, 38 violations, 31
enforcements, 11 sampled manifests, 7 enforcement documents, 7 concepts, 3 measure
elements and 3 aliases.

**The graph is an index, not a copy.** Spec-faithful AGB Layer 1, three element
classes: `concept` (type-level, one node however many rows), `thin_instance`
(identity + provenance *only* — no attributes, no measures, no dates) and
`measure_element`. Every figure on a sublabel or an edge tooltip comes from the
package's `demo_display` block, its cache of what Layer 2 would federate at query
time. Do not move a value onto a node to make rendering easier: the separation is what
is being demonstrated, and the inspector's **Element** row is where it is stated.

**Column values are not nodes, by decision.** The earlier graph promoted 13
`WasteCode`, 9 `ViolationType` and 5 `EnforcementType`; the package's `not_nodes`
lists all three with `was_wrongly` beside them — a code on a row is an attribute of
the shipment. The events those columns described are nodes instead. `check-docs`
fails if a retired type reappears, and rq5 in the queue is the standing offer to
promote them anyway, declined by default.

**Three things on the drawing are data.**

| | means | why not decoration |
|---|---|---|
| fill | the node's **origin class** — row · schema (concept/measure) · document · alias | the graph's own account of how it was built, and the answer to "which source is this?" |
| ring | the node's **ontology type**, where a fill carries more than one | the answer to "what kind of thing is this", without nine competing fills |
| size (`r`) | the node's **degree**, by square root | the hub is biggest because 61 edges land on it, not because it is the subject |
| `source` | the **catalogue object** it came from | `epa_hazwaste.FRS_Facility_profile`, `Compliance Docs · 08_unstructured/chemours-cd.pdf` |

**Four fills, not nine.** A categorical palette stops being reliably distinguishable
past four, and on a canvas any two nodes can end up adjacent. Each hue ships an `ink`
measured against it — white clears 4.5:1 on the blue and the magenta, not on the green
— and `check-docs` recomputes every pair. The blue is one step darker than it first was
for exactly that reason. **`dimension` was the fourth class and retired with the
column-value nodes**: a legend row with no members advertises a claim the graph denies,
so the hue moved to `schema` rather than sitting empty.

**The ring carries the type, and only where it has to.** `row` holds five types and
`schema` two, so those seven are ringed; `document` and `alias` hold one type each and
their fill already names it. That is what makes the palette possible — a ring separates
its *siblings on the same fill*, never all nine at once — and the four rules
(`check-docs` recomputes each) are 3:1 against the page, 3:1 **or** a 40° hue turn
against the fill inside it, and a 40° turn or 2:1 against a sibling. A first attempt
reused the demo viewer's own light hues and failed twelve ways: a light ring holds
against neither a mid-tone fill nor a white page. The ring is **its own circle**, not a
stroke on `.gc-disc` — a stylesheet rule beats a presentation attribute, and the disc's
stroke is where the states are drawn.

**Zoom, pan, and neighbourhood focus.** Scroll zooms about the cursor, dragging the
background pans, **Reset view** appears once either has moved, and clicking a node dims
everything outside its neighbourhood with a note saying so. All hand-written — no graph
library, for the reason the mock server has no dependencies — and all local, so the
server's positions remain the picture. Two things bite here: React registers `onWheel`
as **passive**, so the wheel listener is attached by hand with `{ passive: false }` or
the page scrolls behind the zoom; and the client-pixel → graph conversion goes through
`getScreenCTM`, which already knows the viewBox and its letterboxing, rather than
reproducing that maths and drifting when the panel resizes.

**Full view** opens the same graph in a **new tab** at
`/graph-studio/:useCaseId/canvas`, using the whole window — the studio tab keeps its
place, its queue and whatever the reader had zoomed to. It is the same `GraphCanvas` and
the same `NodeInspector` on the same payload; only the frame differs, because a full
view that drew its own graph would be a second truth about it. Three things about the
route:

- It is declared **before** the `App` tree. `graph-studio/:useCaseId` matches the
  parent segment, so declared after it the studio page would render at the full view's
  URL — a wrong page with no error anywhere.
- It sits **outside** `App`, the only page besides `/login` that does, and for the
  opposite reason: `/login` has nothing to navigate to yet and this has nothing to
  spare. Still inside `RequireAuth`.
- It is **URL-only**, like `/audit`, `/trace`, `/validation` and `/db` — reached by the
  button, never advertised in the sidebar.

The button is `fullViewHref` on `GraphCanvas`, and the full view **does not pass it**:
a link to the page you are already on is a dead control, and the absence is what makes
it impossible rather than merely unlikely.

**Labels appear when they can be read.** 30 nodes are big enough to hold their name
inside, wrapped to three lines; the other 159 are labelled *beside* them — a 23px
node's label is four times its width, and stacking those underneath is what made 222 of
them collide. They arrive once the view can hold them: zoomed past **1.35×**, or once a
filter or search cuts the view to 28 nodes, or on hover. Edge labels follow the same
rule. Every label is cased in the page colour with `paint-order: stroke`, or it is
unreadable exactly where the graph is densest. **The legend is both filters** — fill and
ring, each row carrying its server-side count — so one control cannot disagree with
itself about what a colour means and what it shows.

**The canvas and the review queue are the same truth.** A node or edge carrying a
`review_item_id` is *proposed* exactly while that row is undecided — approve rq2 and
the Chemours `DESCRIBED_BY` edge un-dashes, correct rq4 and the `quantity_tons`
measure element becomes `studio-authored` (which is what the fourth filter chip
counts). The inspector says so and links back to the queue.

The one state shown is "proposed", and it carries a dashed outline and the word as
well as a colour. Filter chips show counts, so an empty result reads as "none match"
and not as a broken chip.

**An edge whose endpoint is not a node fails the boot.** An earlier package shipped 20
such edges — three alias names and an unitemised enforcement type its node roster
omitted — and the symptom was silence: those relationships were skipped while drawing,
so 17 facilities looked like they had no enforcement. `validateDb` checks canvas
endpoints across keys. **This build resolves cleanly**, so the ingest materialises
nothing and throws if it would have to, and `check-docs` asserts the canvas is exactly
the roster — a canvas larger than the package means something is being invented.

### Query & sanity-check

**Files:** `GraphStudioPage.tsx` → `POST /graph-studio/:id/query`

A question asked of the **draft**, before anyone commits to it — by one of two
routes, and the payload always says which. The answer comes back as a canvas with the
walk marked, which is what the glow on the Canvas tab is; there is no second request
and no second truth.

**A recorded check wins, and names itself.** `graph_studio.sanity_checks` holds the
five the package wrote in `graph_studio.json`: a hero question (`hq4`, `hq2`, `hq1`,
`hq13`, `hq10`), a verdict, the context chips, the Cypher the engine would plan, its
cost against the budget, and the sub-graph it walks. They are offered as chips under
the box, because a chip is a promise the brief already made. Matched exactly as
`ask_answers` are and at **the same `ASK_MATCH_MIN`** — two thresholds over one
tenant's questions would let the studio pass what Ask declines — with `recorded: true`
and `check_id` on the payload, so a written verdict is never read as something the
walk derived. A recorded check names its hops by `edge_id`, so the highlight is exactly
the relationships it used.

**A recorded traversal is a sub-graph, not a chain.** `pathLabels` is empty on one and
the hops are listed from `edgesUsed` instead: sc3 walks three generators and three
enforcement actions that all meet at the receiving TSDF, and arrow-joining those seven
ids would claim a route nobody walked.

Anything unrecognised falls through to **the walk**. There is no engine: the entities
named are matched to nodes and the path between them is walked over the edges that
actually exist, so the path *is* the evidence.

Three honest failures, and they are the point:

- a question naming **no** entity in the graph → not answerable
- naming **one** → "a question needs two things to relate"
- naming two that **nothing connects** → says so rather than inventing a hop

An answer crossing an undecided edge is answerable **and provisional**, and says
which decision it is resting on — publishing would change it. **A recorded check is
not exempt**: its caveats come from the edges it actually used, so sc1, which rides
the Chemours `DESCRIBED_BY` edge that rq2 has open, is answerable and flagged.

Matching requires the whole label or a word that is **rare and not a type name**.
Three ways a bare shared word answers a question nobody asked:

- it is a *kind* — "which facility do we accept waste from" holds "facility" and
  "waste", which name the type `Facility` and an edge label, so no instance may claim
  them. The stoplist is read off the graph's own `type` and edge-label vocabulary, so
  a new node type stops its own word without anyone remembering to.
- it is common — "texas" is in five labels here, so it names none of them.
- **it is the whole label of a concept node.** The rebuild put 7 type-level nodes on
  the canvas labelled exactly "Facility", "Manifest", "Document" — and the whole-label
  shortcut bypassed the stoplist, so "tell me about the Denka facility" resolved to
  `CONCEPT:Facility` and reported the two had nothing between them. A concept *is* the
  type, so concepts are excluded from instance matching and the shortcut clears the
  stoplist too.

The rule was once "unique to one node", and it broke the moment a facility and the
consent decree about it shared a name: "what does the chemours consent decree say
about the facility we accept waste from" matched nothing, and that question is the
whole point of the graph. Rarity replaced uniqueness — a word naming at most 5% of
the nodes is taken as naming them deliberately — and the word floor is four
characters, because "the" is rare across these labels and matched *The* Chemours
Company Fayetteville Works on the article.

### Versions

**Files:** `GraphStudioPage.tsx` → `VersionsTab.tsx` →
`POST …/versions/:sha/publish`, `POST …/versions/:sha/unpublish`

**A version is a build.** Every run that finishes records one row, newest first:

```
facility manifest · v2   loaded  gate passed  published   11/08/2026, 14:57
8 entities · 4 relationships · graph 9ff33f44… · sha256 67da70212ac5… · from job d2aee040…
[ Load this version's job ]  [ Unpublish ]   immutable — content-addressed; …
```

**Content-addressed and immutable.** `sha256` is the identity — two builds of one
brief differ there and nowhere else, which is why several rows read `v2`.
Publishing flips a pointer (`studioLive`, one content hash per graph); it never
rewrites a row, and unpublishing clears the pointer. The sentence on every row says
so, so it must stay true.

**Two acts, not three:**

| Act | Endpoint | What it means |
|---|---|---|
| publish | `POST …/versions/:sha/publish` | Ask may query **this** build |
| unpublish | `POST …/versions/:sha/unpublish` | take it out of Ask; the row survives |

**Publishing an older row is the rollback**, and it works because any row may be
published. This replaced an earlier publish → approve → activate chain, and the
cost is stated plainly: there is **no recorded human sign-off** any more, and no
separate activate step. The gate is unchanged — an unreviewed graph is refused
whichever row is chosen.

**Publish is offered even when the gate is blocked**, because the refusal names
what is outstanding; that is more use than a disabled button with no reason. The
tooltip says it before the click.

The badges are facts about a row, so only two are `STATUS` coloured: `gate passed`
and `published`. `gate unknown` is neutral — it means nobody had reviewed the graph
when that build finished, which is not a failure. `loaded` marks the row the Build
tab is showing and takes a brand tint, because being loaded is navigational.

**Where it fails:** publishing while the gate is blocked → 400 naming every reason;
publishing or unpublishing an unknown hash → 404 saying versions live in memory;
unpublishing a row that is not the published one → 400.

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

**Two sources of answer, and the recorded one wins.**

`ask_answers` in `db.json` holds the tenant's **40 written answers** — ingested
from `06_queries/query_set.json`, 13 tied to hero questions, 22 standard, 5
declines — each an ordered list of **blocks** (`text` | `metric` | `chart` |
`table`) with its evidence and a stated confidence. `matchAskAnswer` serves one
when the typed question is the same question, or shares **at least
`ASK_MATCH_MIN` (0.6)** of its words *and* beats the runner-up. A tie matches
nothing, exactly as `matchTemplate` treats one: a near-miss served confidently is
worse than an abstention. Every recorded answer reports **which** it was —
`Answered from the recorded query set · Q01 (hero, hq1)` — so nobody reads a
written answer as something the walk derived.

Anything unrecognised falls through to `studioQuery` — **the same walk the
studio's sanity check uses**, so a check that passed before publishing cannot
disagree with the answer after it. That path carries four steps of working
(grounded → planned the route → routed to source systems → composed), one
citation per relationship walked, and a confidence that is the **weakest node on
the route**.

**The answer is streamed, because it is composed.** `POST /ask` answers with
`text/event-stream`: a `stage` per step of working, then `summary`, then one
`block` at a time, then `done` carrying the whole envelope. `askQuestionStreaming`
in `client.ts` reads it and **validates every event by its own schema** — `done`
is validated as a whole object, which is the one the store keeps, so the answer on
screen has never been assembled from unchecked fragments. A five-block answer
takes longer than a one-line abstention (`ASK_STAGE_MS` 420 + `ASK_BLOCK_MS` 380
per piece), which is the honest shape.

Refusals are still plain JSON 400s **before the stream opens** — an error must
never arrive as an event inside a 200, and errors are never paced.

**A recorded answer's evidence carries no per-row confidence.** The query set
states one score for the whole answer, so `citations[].confidence` is `null` on
that path and the page prints the figure only where there is one. Inventing a
number per source view is the failure this avoids.

**An abstention is a real answer.** No entity named, only one named, or two with
nothing between them → `answered: false`, `reason` says which, and `answer` and
`confidence` are `null`. The page tags it `warn`, not `crit`: declining to guess
is the behaviour, not a fault. **A recorded decline obeys the same rule**: the
query set scores its own declines `0.99`, which is certainty that it *cannot*
answer — reporting that in `confidence` would read as a 0.99 answer, so it stays
`null` and only the decline's text is shown.

**The blocks are rendered from scratch.** `AnswerBlocks.tsx` handles prose,
figures and tables; `AnswerChart.tsx` draws the charts as inline SVG — no chart
library, for the reason the ontology canvas has none. **The chart form is chosen
by the data's job, not by the `chart` field** (the package's own note says the
rendering team picks): `bar` → horizontal bars, `line` → a line with its peak
marked, a **2-slice `donut` → a meter** (a ratio is not a two-slice donut), a
`pie` of ≤ 4 → a 100% stacked bar, and a `pie` of more → bars, because past ~7
classes the answer is a table or bars and never more colours. One hue for
magnitude; the four categorical hues are a validated set and every segment is
directly labelled, since their contrast against the surface is below 3:1. Every
chart ships a collapsed **Values** table, so nothing is colour-only. Status tints
appear on a metric's `flag` and nowhere else — a share is not a state.

**Where it fails:** no `use_case_id` → 400 "choose a graph"; unknown id → 404;
a draft → 400 from `findBuiltGraph`; built but never published → 400 naming
Graph Studio; an empty question → 400. Every one of them is shown verbatim, so
each is written as a sentence to a user.

---

## Flow 10 — What-if: judging a load before accepting it

**Files:** `WhatIfPage.tsx` + `ScenarioColumn.tsx` -> `whatifStore` ->
`GET /whatif`, `POST /whatif/resolve`, `POST /whatif/scenario`,
`POST|DELETE /whatif/saved`. Data from `09_What if lens/whatif_vls_data.json` via
`npm run ingest:whatif`.

The question is "what would this load cost us", asked **before** the load is accepted.
A scenario admits a candidate generator hypothetically and the watched measures
recompute by traversal to its federal record: RCRAInfo evaluations and violations,
ECHO enforcement and penalties, an extracted consent decree. Nothing is predicted, and
nothing is written.

### It never writes back

The copy promises this three times, so the code keeps it: `POST /whatif/scenario`
computes and returns, storing nothing, and the saved library holds **generator ids,
never figures**. That is why computing is a call and not a calculation — re-open a
saved scenario next week and it shows next week's record. A store that cached the
numbers would cache an answer that quietly went stale, and `check-docs` asserts both
halves.

### Nothing connected shows the gate and nothing else

`GET /whatif` answers with empty collections, `facility: null` and `connected_sources: 0`
— but it still returns the copy, so the page has strings it must not print yet. Only
`PageHeader` is shared between the two branches; the pill, the "What this lens is built
on" banner, the tabs and the provenance note are all inside `WhatIfLens`, which renders
only when a source is connected. Otherwise the banner's "36 inbound generators" appears
one line above `NoSourceConnected`. `check-docs` asserts the gate names none of that copy
and the lens names all of it.

### Authoring sets the frame, in three steps

1. **Watched measures** — chips for the four governed measures, each showing the
   relationship it grounds to. Plus a text box: type a measure and the *graph* answers.
2. **Candidate pool** — which generators a scenario may draw from, each pool carrying
   its count, with a preview of the first 8. The Runtime dropdowns offer this pool and
   nothing else, which is what makes the step more than decoration.
3. **Review** — the frame in one sentence, and the read-only guarantee.

The rail is clickable **backwards only**: a later step's question depends on this one's
answer, so jumping ahead would ask it against nothing. Step 1 refuses to continue with
no measure watched, and step 2 with an empty pool — both with the reason, not a silently
disabled button.

### A measure must ground before it can be watched

`POST /whatif/resolve` gives one of three verdicts:

| verdict | what happens | example |
|---|---|---|
| `resolved` | the measure it grounded to is added | "inherited penalty dollars" -> MEAS:penalty_amount |
| `grounds_not_inherited` | nothing is added, and it says why | "tonnage" grounds, but measures the Manifest, not inherited risk |
| `refused` | nothing in this graph resolves it | "days of sunshine" |

**The keyword list is deliberately absent from `GET /whatif`.** A client holding it
could answer for itself, and the refusal would be theatre — so the graph is asked, and
`check-docs` asserts the list never reaches the payload. Paced like the suggesters: a
resolution that returns instantly reads as a lookup in a list the client already had.

### Runtime swaps loads inside that frame

Up to 3 columns, each `{ generatorId, name, savedId }`. Swap the dropdown and that
column recomputes. Each measure reports three different things — `inherited` (what the
load brings), `baseline` (what the facility already carries) and `value` (the sum, judged
against the appetite line) — and a measure with **no** baseline reports `null` rather
than `0`, because a consent decree is not something a facility keeps a running count of
and 0 would be a claim. A load that moves nothing says so instead of printing "+0".

Every figure cites its federal source, and the trace panel repeats them against the
specific records. A **clean** load says "nothing connects" rather than showing an empty
trace, which would read as "not checked". The **residual** — risk from records not yet
connected to a generator — is stated on every scenario.

**Headroom** is the inverse question: how many more enforcement-carrying loads fit
before the appetite line. The package states the formula, the ingest computes it per
pool, and the page prints it — arithmetic on a measure in a component would be a second
source for a number.

**The breach rule is real but currently unreachable**, and that is the data's answer:
the appetite is 10 actions, the baseline is 0, and the largest single load carries 4.
Headroom says 5 more loads. Do not manufacture a breach to exercise the red styling;
`check-docs` asserts CLAUDE.md and the roster agree about whether one load can cross it.

### Two graph references, both drawn

The pool step opens the **frame** (every candidate fanned into the facility, capped at the
package's 7 and saying so) and a runtime column opens the **traversal** (evaluations →
violations → enforcement → the generator → the TSDF, with any consent decree). Inline SVG in
`WhatIfGraph.tsx`, no library. The node types, their labels and their colours are
`graph_reference.node_types`; the frame's centre, edge and cap are `graph_reference.frame`;
and the scenario's nodes and edges come from the server with every edge label drawn from the
graph's declared relationships. **An absence has no circle** — a clean load draws no
enforcement node.

**Where it fails:** an empty typed measure -> 400 before the pace; a load outside the
pool -> 404 naming the frame; an unwatched measure key -> 400 naming the step that adds
it; a saved id that does not exist -> 404. Adding a column past `compare.max` is refused
with a sentence rather than a disabled button that does nothing, and the last column
cannot be removed — an empty compare strip has no control that would bring one back.

Deleting a library entry **unlinks** any open column rather than closing it: the reader
was looking at that load.

---

## Flow 11 — Reports: the vendored authoring prototype

**Files:** `src/pages/ReportsPage.tsx` (the gate, the mount, and the governance it passes down) ->
`src/reports/**` (the prototype: `App.tsx` owns all state, `panes/` the three authoring steps plus
the library, `components/blocks/` the six block bodies, `data/dataset.json` the figures,
`reports-prototype.css` the styles) -> `src/pages/ReportsPage.css` (integration rules authored
here: the `.rp-host` margins, the portal scope class, and the Library's chip bar) ->
`GET /reports` for the publish counts, the published graphs, and `governance`.

**It is vendored, not written here.** `src/reports/` is a port of
`vls_demo_data_package_2026-08-10/repor code`, imported whole. Read its own README in the
package for how its state flows; the short version is that `App.tsx` owns the step, the prompt,
the four assumptions, the filters, the block list and edit mode, and the panes are
presentational.

### Three changes were made to it, and nothing else

Its `main.tsx` and `Sidebar` were dropped (this app has a sidebar, and the prototype's named a
different persona than the signed-in one); its `ToastProvider` and `MenuProvider` wrap the page
rather than the app; and its stylesheet was **scoped** to `.cw-reports`. That last one is not
optional — the original sets `*`, `body`, `button`, `h1,h2,h3`, `table`, `th` and `td` as bare
selectors and would restyle every other page silently. `check-docs` asserts it stays scoped and
that the page mounts it in a matching wrapper.

It is also the one stylesheet exempt from the `--sp-*` rule, as a named one-entry list that
`check-docs` holds at one entry — and it carries a **do-not-hand-edit** rule, so anything this repo
adds to the section is styled from `ReportsPage.css` instead, on the `--sp-*` scale, scoped under
`.cw-reports` so it inherits the prototype's own colour tokens. The Library's chip bar is the
current example.

### What is real and what is not

**Real:** the gate, and the whole Library — the five governed definitions, their lifecycle chips,
their four actions, who each is shared with, and whether the signed-in role may open it. The section
opens once a graph is published (the same precondition Ask and the What-if lens have, through the
same `NoPublishedGraph`) and the page reads `published_count` / `built_count` / `draft_count`.

**The report list is the tenant's five definitions, Reports 1–5, all seeded `published`** — the same
five the package's `07_reports` describes, which is also where the prototype's five authoring
starters come from. That shared origin is what makes **Open report** and **Edit report** work on a
row that arrived from the API: `fromGoverned` matches a row to its starter on `report_tag`.

**Four actions per row**, each offered only where it can be carried out:

| Action | Endpoint | Notes |
|---|---|---|
| Open report | — | loads the starter behind the row, read-only |
| Edit report | — | the same, in edit mode |
| Share | `PATCH /reports/governance/:id/audience` | `[]` is private, and private is a decision |
| Delete | `DELETE /reports/governance/:id` | drops the **governance row**; a re-seed restores it |

The same four are on the session cards, over the same dialog — but Share there writes `viewerRoles` on
the local row and nothing else: a session report has no governance row, so the dialog and the card both
say the choice stays in this browser.

**It is one list, not two groups.** Governed definitions and session reports share a grid, told apart by
the card (`GovernedCard` / `SessionCard`) rather than by a heading. A session report answers to its own
*Saved here* chip — never the tenant's Published — and the chip counts come from the same `inState` the
grid filters with, because the server cannot count rows it has not been told about.

**A published name is unique.** `nameProblem` is the one rule, applied across the whole list; the publish
dialog checks live and Save draft checks before writing. Drafts may share a name, case and space do not
make a name different, and a report never collides with itself.

**Delete drops the governance row, and `npm run seed:governance` restores it.** That is also the fix when
a definition has gone missing from the list — the confirmation says so rather than promising "gone for
good".

**A missing report says so.** `governance.ungoverned` names every definition with no governance row and
the Library states them above the list with the served restore command, because a list that is merely one
card shorter reads as data loss. It also names the cause a re-seed cannot fix: **a mock server serving an
older `db.json` from memory.** That is the likely answer whenever the file and the screen disagree — and
`PUT /db` reloads a running server in place, keeping the in-memory publication that a restart would clear.

**The picker is a dialog at `App`'s root, not a panel in the card.** Inline it stretched its whole grid
row and left the sibling cards with their buttons a screen below their text; `LibraryPane` only opens
it. The governed grid also takes a wider column (`minmax(400px, 1fr)`) with `white-space: nowrap` on
the buttons, because four actions in a 330px card broke every label mid-phrase.

**There is no access gate on a row, and there was one.** A per-row `access` block decided whether the
signed-in role could open a report; a reader outside the audience saw *Request access* / *Access pending
approval* **instead of** the four actions. Removed on request, along with `POST /reports/access-requests`,
`db.reports.access_requests` and `requestReportAccess`. The audience is still stated on the row and acted
on nowhere.

`check-docs` guards the absence on **every layer at once** — server, client, card and stylesheet —
because a partial revival is the dangerous shape: a card gating on `access` while the payload no longer
sends one renders a row with no actions at all, which is the symptom that prompted the removal. Re-adding
it deliberately means deleting that claim in the same commit. `docs/REGRESSIONS.md` records what it was.

**None of it is access control**, and `SharePicker` says so on the page: the role is the browser's,
and the API still serves every row to a caller that names none. That is also why the gate's removal lost
nothing real.

The chip bar is `governance.statuses` from `GET /reports`: **All current** plus every state the
tenant declares (`Published` · `Pending approval` · `Blocked` · `Archived`), each with the count
`reportGovernanceView` computed, filtering the definitions above the shelf. With all five published,
three of those chips sit at 0 — which for a lifecycle means nothing is blocked, not a broken chip.
`ReportsPage` passes `governance` in, `App` holds the selected state, `LibraryPane` draws both. Three
rules hold it together:

- **The count is printed, never computed.** `LibraryPane` renders `s.count` and its `current` filter
  is the server's own rule (everything not archived), so bar and grid cannot disagree.
- **The chips do not reach the shelf.** A report saved in this browser never left it — the prototype
  does not `POST /reports/saved` — so it sits under *Saved in this session* and is not counted as a
  governed definition. Hosted, that shelf **starts empty**: the prototype's four seeded rows are its
  own fiction and would read as four more reports that do not exist beside the real five.
- **The prototype declares the payload's shape itself** (`Governance` / `GovernedRow` /
  `GovernanceState` in `App.tsx`) rather than importing `client.ts`, exactly as it does for
  `GraphOption`. Drop the props and it is the standalone prototype again.

**Not real:** every figure. The prototype renders its own `dataset.json`; nothing reads
`db.json` for a measure, nothing calls `/reports*` for a chart, and publishing inside it does not
leave the browser. The rest of the `/reports*` API is still served and still typed in `client.ts` —
see the **Reports** section of `CLAUDE.md` for what it guarantees — and wiring the figures is a
separate job.

### Where it fails

Nothing published -> `NoPublishedGraph`, naming the fix from the two counts. `GET /reports`
failing -> `ApiErrorAlert` with a retry, because the gate is the one thing here that can fail.
The prototype's own failure modes are its: an unrecognised question is read as the generator
register, and the field picker lists what the graph cannot serve with the reason attached rather
than hiding it.

### If you wire it to the API

The dataset's vocabulary is the tenant's — the same starters, scopes, measures and horizons as
`db.reports` — so the frame it builds is one `POST /reports/build` would accept. Start there,
and keep the two definitions from drifting.

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
