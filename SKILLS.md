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

## Flow 1 — Connecting a BigQuery source

**Files:** `ConnectSourceModal.tsx` → `ConnectSourceWizard.tsx` → `client.ts` →
`server.mjs` · connector list in `data/connectors.ts`

Three steps, driven by local state in the wizard (not a store — it is one
self-contained transaction).

### Step 1 · Connector

Seven connectors from `CONNECTORS`. Only `available: true` ones are selectable —
Google BigQuery and Google Drive. The other five (GCS bucket, Amazon S3 bucket,
PostgreSQL, Snowflake, MongoDB) render dimmed; clicking one shows *why* it is not
ready via its `reason` field rather than doing nothing. `Continue` is disabled
until an available connector is picked.

To make one usable: flip `available` and give it a real step-2 path. Its form
fields are already defined.

### Step 2 · Connection

BigQuery gets a bespoke branch (`isBigQuery`); every other connector falls back
to the generic field loop over `connector.fields`.

```
Login with Google
  → GET /sources/oauth/start        issues a one-time state
  → GET /sources/oauth/callback     consumes it, returns account + 4 projects
                                    each with a credential_handle
```

The state is single-use — replaying it returns 400. Selecting a project fills its
credential handle and invalidates any previous preview.

There is **no raw-key path**. The "Advanced" collapse takes a project id and a
credential handle only; credentials are held by reference, and the server has no
endpoint that accepts a key. Do not reintroduce one.

`Continue` requires both a project id and a credential handle.

### Step 3 · Test & Finish

```
1. Run preview   POST /sources/preview   discovers datasets, registers nothing
2. Finish        POST /sources           registers for real
```

Preview validates the handle against the project (a handle for another project
gets 403) and returns the dataset list, which becomes the allowlist checkboxes —
all checked, because the copy says "uncheck to exclude". Finish rejects an empty
or unknown dataset list.

The dialog **stays open** after Finish so the confirmation stays readable; `Close`
dismisses it. `onRegistered` refreshes the Sources table without closing.

**Where it fails:** wrong project/handle pairing → 403. Empty allowlist → 400.
Mock server not running → the wizard shows the "start `npm run mock`" message.

---

## Flow 2 — What a registered source looks like

**Files:** `SourcesPage.tsx` → `sourcesStore.ts` → `GET /sources`

Columns: `source name` (with the `source_id` beneath it, because that is what the
actions act on) · `status` · `project / account` · `scope` · `connected` ·
`profiled` · Actions.

The four cards read Registered sources / Profiled tables / Profiled columns /
Profiled documents. **The last three stay 0** until profiling runs — that is
correct, not a bug.

Three actions, all through the store:

| Action | Endpoint | Effect |
|---|---|---|
| Edit datasets | `PUT /sources/:id/datasets` | narrows the allowlist; catalogue follows immediately |
| Disconnect | `POST /sources/:id/disconnect` | revokes the credential, **keeps** the registration |
| Delete | `DELETE /sources/:id` | removes it and its catalogue rows |

Disconnect is not deletion. A disconnected source stays listed so it remains
deletable, but stops counting as connected — so the other four pages fall back to
their empty state. There is no Reconnect yet; delete and re-register.

---

## Flow 3 — Browse → profile → watch the pipeline

This is the most involved flow and the one most likely to be misunderstood.

**Files:** `CataloguePage.tsx` (`BrowsePanel`) → `catalogueStore.ts`
(`useBrowseStore`, `useJobsStore`) → `ProfilingJobsTab.tsx` → `server.mjs`
(`runJob`, `PIPELINE`)

### Browse

`GET /sources/:id/browse` returns only **allowlisted** datasets with their
tables. Rendered as a checkable antd `Tree`; parent/child propagation is antd's,
and leaf keys encode `dataset::table` so a checked key converts back to an object
(`leafKey` / `parseLeaf`).

### Start Profiling

```
POST /sources/:id/profile   →  202 Accepted, job status "queued"
```

**It does not do the work.** The response is a queued job. The server then walks
it through five stages on timers:

```
queued
  → 1/5 Schema fetch
  → 2/5 Statistics sampling
  → 3/5 Class inference
  → 4/5 PII detection
  → 5/5 Candidate keys
complete
```

Tables are committed to the source as stages pass, so `profiled_tables` and
`profiled_columns` climb *during* the run rather than jumping at the end.

Two behaviours that look like bugs but are not:

- An already-profiled table is **skipped**. The browse panel never forces — its
  footer is `Select all · Select none · Start Profiling`. Re-profiling is done
  per-run from the **Force** button on a row in Profiling jobs, which re-queues
  that job's table set with `force: true`.
- If every selected table is already profiled, the job completes instantly with
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

---

## Flow 5 — Editing the data (`/db`)

**Files:** `DbEditorPage.tsx` → `dbStore.ts` → `GET|PUT /db`, `PUT /db/:section`

Reachable by URL only — routed, but commented out of `NAV_ITEMS`.

Pick a top-level key (or `whole file`), edit JSON, Save. Three layers of
protection, in order:

1. **Client parse** — `parseDraft` keeps Save disabled until the text is valid
   JSON, so nothing invalid is ever sent.
2. **Server shape check** — `validateDb` verifies all eight required keys and
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

**Verifying any of it**

`npm run preflight`, then an SSR smoke script for the behaviour — exercise the
failure paths, not just the happy one. Most of the real bugs found in this
codebase were wrong shapes and stale processes, and both show up only when you
check what happens when things go wrong.
