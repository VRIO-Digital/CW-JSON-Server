# The ContextWeave API — FastAPI over PostgreSQL

A port of `mock-server/server.mjs` (9,473 lines of zero-dependency Node) to
FastAPI, with the data in Postgres instead of two JSON files. Same 86 routes,
same payload shapes, same pacing. The React frontend is unchanged and calls it at
the same origin.

```bash
pip install -r backend/requirements.txt
npm run api          # uvicorn on :4000
npm run dev          # the SPA, in a second terminal
```

`npm run api:smoke` walks the whole product end to end (131 assertions) against a
throwaway SQLite file, so it runs with no Postgres server at all.

## The connection

Five values at the top of [`app/database.py`](app/database.py) and **nowhere
else** — no `.env`, no config module, nothing to keep in step:

```python
PG_HOST = "localhost"
PG_PORT = 5432
PG_DATABASE = "postgres"
PG_USER = "postgres"
PG_PASSWORD = "postgres"
```

The server checks the connection *before* it touches the schema, and a failure
names the DSN, the driver's own sentence, and the three things it is usually —
because SQLAlchemy's own error is a 30-frame traceback with the useful line
buried in it.

## Tables are created automatically

`Base.metadata.create_all` runs on every boot; it is a no-op once they exist.
There are 15, all prefixed `cw_`, and they fall into two groups.

**The tenant's data** — bootstrapped once from `mock-server/db.json` and
`mock-server/settings.json`, after which Postgres is the only source of truth and
the files are never read again. `python -m backend.reseed` is the deliberate way
back.

| table | holds |
|---|---|
| `cw_documents` | one row per top-level key. `kind='array'` means its rows are next door |
| `cw_collection_rows` | one row per member of a list-shaped key, in authored order |
| `cw_settings` | the users, each persona's navigation access, and the defaults Reset restores |

Every key lives in exactly one of the first two, never both: two homes for one
collection is how they come to disagree. An object-shaped key (`graph_studio`,
`reports`, `whatif`) is a single JSONB document; a list (`projects`,
`ask_answers`, `graph_use_cases`) is exploded into rows, so it is queryable
rather than buried in one blob.

**Run state** — this is the one real behaviour change. In Node it lived in
`Map`s and died with the process; a restart cleared every registered source,
profiling job, review decision, build and publication, and the code said so in a
dozen error messages. It persists now:

`cw_sources` · `cw_profiling_jobs` · `cw_oauth_states` · `cw_oauth_sessions` ·
`cw_graph_derivations` · `cw_studio_decisions` · `cw_studio_pivots` ·
`cw_studio_builds` · `cw_studio_publications` · `cw_whatif_scenarios` ·
`cw_governance_events` · `cw_governance_scopes`

A database that forgets what it was told is not a database. The consequence worth
knowing: the gates (Ask, Reports, the What-if lens, Audit) no longer close on a
restart, because publication survives one.

## What was ported exactly, and how that was checked

Three things the UI's figures depend on had to come out bit-identical, so none of
them was taken on trust:

- **The hash.** Columns, entities, confidences, sample sets and content hashes
  are all derived from an FNV-1a hash of an id. `js_hash` reproduces
  JavaScript's `Math.imul` 32-bit wrap exactly — including that `hash('')` is
  2166136261, because JS leaves the seed uncoerced. Checked against Node on 687
  real identifiers from `db.json`: **0 mismatches**.
- **The two dictionaries.** `table_dictionary` and `document_dictionary` were
  compared to the Node originals over all 8 profiled tables (the 206 real
  `epa_hazwaste` columns included) and all 17 documents: **byte-identical**.
- **The validator.** `validate_db` accepts the real document and refuses each of
  seven deliberate breaks — a dropped `column_profiles`, a canvas edge with no
  node, a folder naming a parent from another drive, a measure reading a field no
  generator carries, a template naming a KPI that does not exist, a dropped
  "not access control" caveat, and a Settings lock that Reset would strand.

## The frontend contract

`npm run api:contract` is the check that the Python server and the TypeScript
client still agree. It records every payload the API answers with
(`backend/capture.py`, driving the smoke walk), then runs **the app's real
fetchers** against them — their real schemas, their real snake_case-to-camelCase
mapping, their real refusal handling. 43 fetchers, reads and writes both, plus the
streamed answer parsed into its `stage` / `summary` / `block` / `done` events.

This is not decoration. `client.ts` validates every response at its boundary, so
a field renamed or a type drifted surfaces as a toast in the UI and nowhere else —
which is precisely the failure a rewrite invites. It found four real breaks that
the API's own smoke test could not see, because the API was answering
consistently; it just wasn't answering what the app reads:

| break | symptom in the UI |
|---|---|
| refusals arrived as `{detail: {error}}` | every carefully worded 400 read as "request failed (400)" |
| `pivot.chosen` was the decision record, not the option id | "the review queue could not be read" |
| `/traces` gated branch sent `waterfall: []` | "the trace data could not be read" |
| `/audit` and `/evals` gated branches omitted their scalars | same, on two more pages |

**`{ "error": "…" }` at the top level is therefore a contract, not a
preference.** `client.ts` reads `payload.error` and shows it verbatim — that is
the whole reason the server's 400s are written as sentences to a person. FastAPI's
default envelope hides them, so `main.py` unwraps every `HTTPException` and turns
its own 422 into the same shape.

The gated branches are the other lesson: **the empty shape is not "the lists,
emptied"**. Every scalar has to be present at its own empty value — `''` for a
sentence, `0` for a total, `null` for the waterfall — because an absent key fails
the client's schema exactly as a wrong type does.

## Pacing is still server-side

`CONSENT_START_MS`, `CONSENT_MS`, `DISCOVERY_MS`, `CONNECT_STEP_MS` (5s),
`SUGGEST_MS`, `ASK_STAGE_MS`, `ASK_BLOCK_MS` (5s) — all in
[`app/deps.py`](app/deps.py) and the services, never in the client. A stage
advances when its request returns, not on a timer the page holds. Refusals are
never paced: a five-second 403 on a mistyped handle reads as a hang.

The three pipelines that used to run on `setTimeout` — profiling jobs, graph
builds, derivations — now **derive** their stage from elapsed wall-clock time on
each read. Same 2.2s stages and 3s build substeps, but a restart no longer
strands a run half-finished and two workers cannot advance one twice. Polling is
what moves them, so there is no worker to fall behind.

## Layout

```
app/
  database.py   the connection, the schema, the one-time bootstrap
  models.py     15 tables
  store.py      assembling the document from Postgres and writing it back
  validate.py   what the database has to hold for the API to serve it
  core.py       the JS-compatible hash, text helpers, the draft normalisers
  runtime.py    Ctx — one request's view of the world
  deps.py       session per request, refusals, pacing
  services/     the ported logic: catalogue, graph, studio, ask, whatif,
                reports, governance, admin
  routers/      the 86 endpoints
  main.py       CORS, lifespan, the stale-server 404
```

## One trap worth reading before you edit a service

A JSONB column is a plain `dict` once loaded, so **mutating it in place and
assigning it back is a no-op** — old and new compare equal, no `UPDATE` is
emitted, and the write is silently lost. It cost a build its content hash
exactly once: the row read `complete` (a `String` column, which did change)
while the hash inside its JSON stayed `null`, so the version list came back
empty with nothing erroring anywhere.

`Ctx.sources()`, `Ctx.source()`, `Ctx.jobs()`, `Ctx.job()` and `builds_for()`
therefore hand back `deepcopy`s. Copy on read, assign on write.

## Not carried over

- `PUT /db` writes to Postgres rather than a file, so the temp-file-plus-rename
  dance, the per-path write chain and the in-place `db` mutation are all gone —
  the database provides what they were protecting.
- The `npm run ingest:*` and `seed:*` scripts still write `mock-server/db.json`.
  They are unchanged, and the way to apply one is to re-run it and then
  `python -m backend.reseed`.
- `mock-server/server.mjs` is left in place and still runs (`npm run mock`).
  Nothing in this folder reads it.
