# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Two packages, one repo

**`backend/` and `frontend/` are separate npm packages, and each deploys on its own.** That is the
whole reason for the split: the backend is a zero-dependency Node process and must be shippable
without pulling React, antd and d3 with it.

```
backend/     package.json (0 runtime deps) · server.js · store.js · datasets.js
             reportExport.js · db.json · db.CAPEX.json · .env.local (ignored)
             scripts/ (the seeds, the ingests, s3-sync, the two verifiers)
             ecosystem.config.js
frontend/    package.json (react, antd, d3, zustand, router, icons + dev deps)
             src/ · public/ · index.html · vite.config.ts · tsconfig*.json
             .env · .npmrc · .oxlintrc.json · node_modules/
             scripts/audit-gate.mjs — the deps it audits are this package's
root/        package.json — orchestration only, installs nothing
             check-docs.mjs — the one gate that belongs to neither package
             CLAUDE.md · SKILLS.md · docs/
```

**There are no npm workspaces, deliberately.** Workspaces hoist one lockfile and one `node_modules`
to the root, which is the opposite of two independently deployable packages. The cost is stated
rather than hidden: the root cannot `npm i` for both — **install in each package** — and every root
script delegates with `--prefix` rather than running a tool the root does not have.

**Every command still works from the root**, so nothing below changed its name; `npm run dev` is
`npm --prefix frontend run dev`, `npm run mock` is `npm --prefix backend run mock`, and the seeds and
ingests delegate to the backend. Run them inside a package too if you prefer — both are complete.

**Only `check-docs.mjs` is at the root, flat beside the shell scripts, and that is not a leftover.** It reads 198 paths under `frontend/`,
34 under `backend/` and the root documents it validates — so it cannot live inside either package
without making that package undeployable on its own. It reads ~320 paths in total: the whole gate is
keyed to file locations, so the split re-pointed every one, verified by the failing-claim set being
**identical before and after**.

**The audit gate lives in `frontend/`, because the dependencies do.** `backend/` has none by design, so
there is nothing there to audit. Moving it also removed the last cross-package reach: `frontend`'s
`postinstall` used to call `../scripts/audit-gate.mjs`, which meant the frontend could not `npm ci`
without a file outside itself.

**And it finds its own package rather than being told which one.** `npm audit` reports on its working
directory, so a wrong directory is a *silent* pass: no lockfile, "registry unreachable", exit 0, green
while auditing an empty tree. That happened twice while the directory was a parameter — once run from
the root, once from reading the wrong `argv` slot, whose symptom was identical to the bug it was fixing.
It derives the package root from `import.meta.url` now, so every call site gets the same answer and there
is nothing to pass wrongly.

**The one place the split is crossed is `npm run ingest:capex`.** It is a backend script — it writes
`backend/db.CAPEX.json` — and it reads the CAPEX report documents out of `frontend/src/Capex/Report/`,
because those are frontend assets that Vite bundles. A dev-time seed reaching across is the honest
arrangement; the alternative is a second copy of three 2.5 MB documents.

## Deploying

**Backend on Elastic Beanstalk, frontend on S3 + CloudFront** — the full runbook is
`docs/DEPLOY-EB.md`. Four things in the code exist for it, and each one closes a failure that is
invisible rather than loud:

- **The server reads `PORT`.** EB sets it to 8080 and proxies `:80` to it with nginx; a server that
  listens on 4000 instead makes every health check fail while the application is perfectly healthy. An
  explicit `npm run mock -- 4001` still wins over it, because a typed argument beats an inherited
  environment.
- **`GET /backend/health` exists.** EB's default check hits `/`, which the dispatcher 404s with a "this server
  may be stale" message — a load balancer reads that as a failed application. It reports the datasets and
  **which store it actually read**, so `"file"` after a deploy tells you `S3_BUCKET` never reached the
  process and the box is serving a copy frozen at bundle time.
- **The environment must be single-instance**, which is the same correctness requirement
  `ecosystem.config.js` records for PM2: the write chain is per process and the live state never reaches
  storage, so a second instance means silently lost writes and a publish that takes effect half the time.
  `eb create --single` is what enforces it — a single-instance environment *is* one instance, which is why
  AWS gives it an Elastic IP rather than a load balancer. **`.ebextensions` deliberately does not pin the
  Auto Scaling group**: `aws:autoscaling:asg` and `aws:elasticbeanstalk:environment:process:default` are
  load-balancer namespaces, and on a single-instance environment EB rejects them and fails the deploy with
  *"Your source bundle has issues"* — an error that names the zip and sends you nowhere near the setting.
  If the environment is ever recreated as load-balanced, the pin has to come back.
- **`.ebignore` restates the credential rules.** The moment that file exists the EB CLI stops reading
  `.gitignore` — so without its first two lines, `backend/.env.local` would be ignored by git and
  *shipped to AWS inside the bundle*. `backend/scripts/` is excluded too: the seeds and ingests read a
  demo package that is not on the instance.
- **And the S3 configuration is hardcoded in a file git never sees.**
  `backend/.ebextensions/02-credentials.config` sets `S3_BUCKET=contextweave.com`, `S3_PREFIX=EPA`,
  `AWS_REGION=us-east-1` and the access key and secret as environment properties, so a deploy needs no
  `eb setenv` — which is what `01-app.config` used to prescribe, and why it deliberately set nothing
  about S3 itself. **Gitignored and shipped are independent here**, which is the whole mechanism:
  `.ebignore` replaces `.gitignore` for bundling and says nothing about `.ebextensions`, so the file
  travels in the zip while an `AKIA…` key never reaches GitHub. Both halves are asserted, because both
  fail quietly — dropping the ignore rule publishes the key, and naming the file in `.ebignore` strips it
  from the bundle and leaves the box booting on the documents frozen in at deploy time, every figure on
  screen plausible and months stale. `GET /health`’s `store` is how you tell (`"s3"` or `"file"`).
  Locally none of it applies: `S3_BUCKET` is unset, so the server reads `backend/db.json` and
  `backend/db.CAPEX.json` — one file per dataset, named by `localDocPath`.

**The mixed-content trap is worth knowing before the first demo.** EB hands you `http://` and CloudFront
serves `https://`, and an https page cannot call an http API — the browser blocks it with no server-side
symptom at all. Routing `/api/*` through CloudFront to the EB origin is the tidy fix: one origin, no
CORS, and `VITE_API_BASE=/api`.

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
npm run seed:governance # re-authors db.reports.governance — the fix when a definition is missing
npm run seed:settings   # re-authors db.settings — users and persona navigation
npm run seed:dataset -- CAPEX # writes an empty-but-servable db.json for a secondary dataset
npm run seed:workspaces # adds the extra GCP projects and Drives (with nested folders) to db.json
npm run seed:capex-drive # authors CAPEX's My Drive from its own shipped documents (writes db.CAPEX.json)
npm run seed:prototype-model # authors the primary's report-authoring row model (writes db.json)
npm run db:push     # upload the three documents to S3 (-- db|settings|prototype, -- CAPEX per dataset)
npm run db:pull     # the other direction — overwrite the local copies from the bucket
npm run verify:sigv4 # checks the S3 signing against AWS's published vector; no network needed
npm run verify:export # checks the report HTML/CSV renderers; pure, so no bucket needed
npm run preflight   # lint + build + audit + verify:sigv4 + verify:export + check-docs — run before calling work done
```

**Two processes are required.** `npm run dev` alone renders empty pages: there is no
static fallback data anywhere in `src/`. Run `npm run mock` in a second terminal.
On a different port, `npm run mock -- 4001` also needs the proxy target —
`MOCK_ORIGIN=http://localhost:4001 npm run dev`, no file edit.

### Where the API lives, per environment

One variable decides it, `VITE_API_BASE`, and it is set in the `.env` files
rather than in code — `check-docs` fails on a hardcoded origin in `client.ts`.

**And every endpoint sits under `/backend`** — `http://localhost:4000/backend/reports`, never
`…:4000/reports`. That is the *API's own* address space rather than a deployment's, which is why it is
**not** in `VITE_API_BASE`: where the server lives differs per environment, what it calls its endpoints
does not. So it is written twice and only twice — `API_PREFIX` in `backend/server.js`, `API_PREFIX` in
`frontend/src/api/client.ts` — and `check-docs` asserts the two literals are the same string, exactly as
it does for `x-dataset`. The client appends it to `BASE`; the server **strips it once in the
dispatcher**, so the ~200 `match` predicates, every path in `server.js`'s header and every claim about a
route are still spelled `/reports`. The prefix survives the Vite proxy untouched: the browser asks for
`/api/backend/reports`, the proxy strips `/api`, and the server receives `/backend/reports`.

**An un-prefixed request is refused, and the refusal names the address that would have worked.** Serving
both is what would make this migration invisible: a bundle calling the old address would keep working
until the compatibility path was removed, which is the same objection that keeps one dataset selector
from quietly falling back to the primary. It also means the API answers nothing at the root — so the EB
health check is `/backend/health`, set in `.ebextensions/01-app.config`, and a checker left on `/health`
gets a 404 a load balancer reads as a dead application.

| | `VITE_API_BASE` | How the call gets there |
|---|---|---|
| `npm run dev` (`frontend/.env.development`) | `/api` | the Vite proxy strips `/api` → `MOCK_ORIGIN`, default `localhost:4000`; the call is `/api/backend/…` |
| `npm run build` (`frontend/.env.production`) | `http://18.205.228.143:4000` | called directly, cross-origin |
| behind nginx (`deploy/`) | `/api` | `proxy_pass` strips it → `MOCK_ORIGIN` |

**Local is the default at every layer**, so a fresh clone needs no environment
set up. Unset `VITE_API_BASE` falls back to `/api`, which is why the deployed
origin lives in `frontend/.env.production` only and why deleting that file breaks the
production build without breaking development.

Two things the direct cross-origin call depends on, both already true: the mock
server sends `access-control-allow-origin: *` on every response including the
`OPTIONS` preflight, and the deployed server answers on **4000, not 80**. It also
**allows every custom request header the client sends** — `x-dataset` names the dataset, and only
four request headers are CORS-safelisted, so any other one makes the request *preflighted* and the
browser blocks it unless the `OPTIONS` reply lists it. Adding a header in `client.ts` without adding
it to `access-control-allow-headers` breaks **every** call in the browser with `Failed to fetch`,
while `curl` keeps answering 200 because it does not enforce CORS. `DATASET_HEADER` in
`datasets.js` is the one declaration, both reply paths interpolate it, and `check-docs` asserts the
client's literal and the server's allow-list are the same string. It is
also plain HTTP — an `https://` page cannot call it at all, so serving the SPA
over TLS means putting a proxy in front and setting `VITE_API_BASE=/api`.

`VITE_*` variables are inlined into the bundle at build time. Changing one is a
rebuild, not a restart, and none of them can ever hold a secret.

`docker compose up --build` runs both in containers instead — nginx serves the
built SPA on `:8080` and takes over the two jobs the dev server did for free,
proxying `/api` (prefix stripped, exactly as `frontend/vite.config.ts` rewrites it) and
serving `frontend/index.html` for client routes. See `deploy/README.md`.

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
backend/db.json ──► backend/server.js ──► /api proxy ──► frontend/src/api/client.ts
                                                                       │ validate
                                                                       ▼
                                                                  frontend/src/store/*
                                                                       │
                                                                       ▼
                                                              frontend/src/pages, frontend/src/components
```

**Data flows one way and every layer has one job.** `db.json` is the only source
of data; `server.js` shapes it and holds mutable run state; `client.ts` fetches
and validates; the stores hold state and own all error handling; components read
the stores and render. Never call `client.ts` straight from a component unless it
is a one-shot read with a local `try/catch` (see `EditDatasetsModal` and
`EditFoldersModal`).

### The mock server (`backend/`)

Zero dependencies on purpose — the audit gate makes every added package
expensive, and a mock backend is not worth widening the dependency surface.

**The demo package seeds one source per connector; `npm run seed:workspaces` adds
the rest.** The package's own are `vrio-contextweave-demo` — display name *EPA
Hazwaste*, one dataset `epa_hazwaste` (US) carrying the five Gold business views the
demo document specifies (`e_manifest` 50 · `e_manifest_all` 92 · `RCRA_compliance`
30 · `RCRA_Compliance_Summary` 9 · `FRS_Facility_profile` 25 = **206 columns**) —
and the shared drive *Compliance Docs*, whose `08_unstructured` folder holds the
seven EPA enforcement PDFs. **Neither is ever rewritten**; the seed only adds
beside them, so a re-ingest of the package still wins.

**It adds them because a picker needs something to pick between.** `projects` holds
**3** (the demo one, *VLS Transport Ops*, *Compliance Sandbox* — one Select option is
indistinguishable from a Select that failed to load its others), and `drives` holds
**3**: the package's shared drive, a second shared drive *VLS Legal*, and a *My
Drive*. Both kinds exist deliberately — the wizard picks between My Drive and the
shared drives, and a control with nothing on one side reads as broken rather than as
an account with no shared drives.

**And that is a rule about every dataset, which CAPEX broke by shipping one drive.** Its package has
the shared *Capital Delivery Docs* and nothing else, so its wizard offered *My Drive (0)* beside
*Shared drive (1)* — the control with nothing on one side, in the one document the claim above did
not read. `npm run seed:capex-drive` authors it: three folders, one of them nested, holding **working
copies of documents that dataset already ships** — the first contract in each project folder, keeping
its entity, project code, contract number and page count, and resolving through `document_extractions`
to the very node its original resolves to. **Nothing about the drive is invented**, because a personal
drive holding five contractors nobody has heard of would put five entities into the Data Catalog that
the canvas has never seen. It is a script rather than an edit for the reason every CAPEX change is:
the document's `_meta` forbids hand-editing, and a transcribed page count is a figure that goes stale
at the next rebuild. `check-docs` asserts both halves per dataset — both kinds of drive exist, and
every document in the seeded one resolves to a node its own canvas has.

**A drive nests, and the nesting is a `parent_id` on a flat list.** Folders stay one
array per drive, so every existing walk over `drive.folders` is unchanged; a root
carries `parent_id: null`, and the key is on every folder including the package's own
so "no parent" is never confused with "seeded before nesting existed". `validateDb`
refuses a parent that is not a folder of the same drive, and refuses a cycle: neither
throws — the first draws the child at the root, which reads as an allowlist covering
more of the drive than it does, and the second leaves it off the tree entirely.

Everything the seed adds is checked before it is written: a project's Catalog column
count is *derived* from its profile rather than typed twice, every `class` must be one
the client's union already declares, every `doc_type` must have a facet bucket, and
every document it adds resolves into the graph through `document_extractions` — to the
same facilities the package's own documents resolve to, so nothing invents a node the
canvas has never heard of.

`google_account` is `nishant.srivastav@vriodigital.com` — the fallback the consent
callback names when a caller sends no `as=`.

**The `epa_hazwaste` columns are real, and `column_profiles` holds them.** All
**206**, ingested from the demo package's `02_profiling/Metadata_Profiling.xlsx`
(one sheet per view) and keyed `<dataset>.<table>`: label, type, description,
semantic class, derivation, confidence, PII, null % and distinct count.
`tableDictionary` serves that verbatim and only falls back to `synthesiseColumns`
for a table with no entry — the fallback is a fallback, and `check-docs` asserts
both that the branch exists and that every view's profiled count equals the count
the Catalog advertises. The workbook is the source of truth; re-ingest rather
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

### Where the data lives

**The document lives in S3, and the local copy is gone.** `backend/store.js` is the whole
storage layer: a document is named by a **ref**, and the ref says where it is — an absolute path is
a file, `s3://bucket/key` is an object.

| | ref | how the bytes move |
|---|---|---|
| default, and the deployed box | `s3://contextweave.com/EPA/db.json` | signed `GetObject` / `PutObject` |
| `S3_BUCKET=off` | `backend/db.json` | `readFile`, and temp-file + rename on write |

**There is one document per dataset, and there used to be three in total.** `settings.json` held the
users and each persona's navigation; `reports_prototype.json` held the report prototype's own sample
data (itself once `src/reports/data/dataset.json`, compiled into the JS bundle, which made it the one
thing on screen the bucket could not change). **Both were folded into `db.json` on request**, as the
top-level keys `settings` and `reports_prototype`. `npm run db:pull` fetches the one document; the
boot read is still a `Promise.all` above `server.listen`, now one entry per dataset.

**The separation those two files bought was real, and it moved rather than went away.** Two stores
with one job each meant a settings write could not touch a report, and an ingest rebuilding
`db.reports` could not drop a permission — which is not hypothetical, since `ingest-reports.js`
nearly deleted `governance` that exact way. The guarantee is now carried by `DB_SHAPE`: `settings`
and `reports_prototype` are **required keys**, so `validateDb` refuses a document missing either and
`commitDb` validates them before **every** write rather than only the writer that owns them. That is
a stronger check applied at a wider moment — it catches a writer that rebuilds *some other* subtree
and forgets to carry these forward, which is the case two separate files never covered. The two
narrower validators (`validateSettings`, `validatePrototype`) are what `DB_SHAPE` delegates to, so
none of their rules were restated, and each keeps its own boot refusal because the fix for a drifted
permission set is a different command from the fix for a stale roster.

Both are still **tenant-level rather than a dataset's**, and that is now expressed as a merge rule:
`MERGE_PLAN` marks both `primary`, so a secondary dataset's document carries the primary's answer to
"who exists" rather than a second one. `npm run seed:settings` therefore reads the whole document and
replaces one key — a script that owns a subtree and rewrites its parent is how a subtree gets deleted.

### Two datasets — EPA and CAPEX

**A dataset is a prefix, and there are two.** `EPA/` is the primary and holds everything described
below; `CAPEX/` is the second and holds the capital-programme reports. Every dataset in `DATASETS` is
read at boot, so a name with no document behind it stops the boot — which is why adding one is that
array plus `npm run seed:dataset -- <NAME>`, in that order, and why the seed refuses a name the array
does not declare.

**EPA was called EPA.** The rename was the selector only: `DATASETS`, `PRIMARY`, `DEFAULT_PREFIX`,
`DEFAULT_DATASET`, the URL letter and every claim and sentence about *which dataset a request is
reading*. The **data kept its own names** — the BigQuery project is still display-name *EPA Hazwaste*
with its `epa_hazwaste` views, and the seven EPA enforcement PDFs are still that — because those are
what the tenant's data is called rather than what the dataset is. `check-docs` and CLAUDE.md therefore
still say `EPA` in exactly two places, both of them about the data.

**The bucket prefix moved with the name.** `s3://contextweave.com/EPA/db.json` is where the primary's
document lives now, so a checkout reading the bucket needs the object moved before `npm run db:pull`
resolves; a checkout reading local files — the default — is unaffected. And a browser that had `EPA`
persisted recovers by itself: the server refuses it, and `resetDatasetIfRefused()` discards the value
and retries on the primary, which is the exact failure that fix was written for.

`backend/datasets.js` owns which one a request is reading — `store.js` still owns only how
bytes move, and `server.js` still owns only what a document means.

| selector | what it reads | writes |
|---|---|---|
| `EPA` (default) | `s3://contextweave.com/EPA/db.json` | yes |
| `CAPEX` | `s3://contextweave.com/CAPEX/db.json` | yes |
| `both` | every dataset merged, per `MERGE_PLAN` | **refused** |

**`both` now merges two real documents**, which is what the machinery was built for and was
under-exercised while there was one. Every key needs a `MERGE_PLAN` rule or the boot stops, and the
two the CAPEX reports added are stated there: `reports.documents` unions on `document_id` because two
datasets genuinely bring their own, and `reports.authoring_document` is `primary` — EPA has none, so
`both` shows no authoring document rather than attributing CAPEX's exploration to the primary.

**CAPEX is its own tenant, and its document is generated.** It arrived as `Northline Water Group` with
five users at its own domain and four personas of its own (`business_user_exec`, `analyst`, `architect`,
`admin`) — so selecting CAPEX changes who can sign in, which is coherent because switching dataset already
signs you out. Its `_meta` says *"never hand-edit this file — change the generator and rebuild"*, which is
why the three things it needed were added on **this** side: `_meta` and `_provenance` got `MERGE_PLAN`
rules (both `primary`, so a merged view claims no single package's provenance), and its report scope
(`sc_author_all`) and spine label (`projects` → `n`) were added to `REPORT_SCOPES` and `REPORT_LABEL_KEY`.

**Which exposed a real bug: a document must be validated against its own keys.** `validateSettings` read
`db.auth_roles`, and at boot there is no request in flight, so `activeDataset()` is the primary — CAPEX's
users were checked against EPA's personas and the boot refused a document that was internally consistent.
`DB_SHAPE`'s checks now receive the whole candidate. **Every cross-key check inside `validateDb` must read
`candidate`, never `db`**, because it runs once per document.

**And `npm run seed:settings -- CAPEX` fills what a generated document could not know.**
`report_defaults` / `report_permissions` were added to `validateSettings` after CAPEX's document was
built, so for a **secondary** dataset the seed writes only the missing blocks and leaves the users,
navigation and locked row alone — re-authoring those from the primary's constants would replace one
tenant's directory with another's. The values are *derived* from that document's own
`governance.data_scope.may_author`, mapped person → persona through its own user list, so CAPEX's
`analyst` and `architect` author while its `admin` ("No access yet") only reads. A persona whose people
disagree is refused rather than silently reduced to one answer.

**CAPEX's rows are the package's, not the primary's.** `npm run seed:dataset -- CAPEX` writes the
primary's *structure* with the primary's *rows* removed, so it is servable without showing EPA's
figures under CAPEX's name; `npm run ingest:capex` then adds the three rendered reports. Everything
else about CAPEX — sources, the graph, What-if — is legitimately empty, which is why `validateDb`
permits an empty collection in a secondary dataset and nowhere else.

**Every dataset is loaded at boot and a request picks one**, by `?dataset=` or the `x-dataset`
header, defaulting to the primary. The prefix used to be read from the environment once at module
load, which made a dataset a property of the *process*: a second one meant a second server, and
`both` was not expressible at all. The selection now travels in an `AsyncLocalStorage` scope entered
by the dispatcher — the one place a request begins — and `db` is a **Proxy** over "the document this
request selected". That is why the ~280 `db.<key>` reads in `server.js` are untouched and still mean
what they always meant; threading a request through `reportView`, `studioItems` and `whatifView`
would have edited most of the file to say one thing.

**An unrecognised selector is a 400 naming the ones that exist**, never a quiet fall back to EPA —
serving one dataset's figures under another's name is the single failure this split exists to
prevent. Case is not significant.

**`both` is a reading view, and it refuses writes at the write rather than by the verb.** A merged
document has no file behind it and a merged live container is a snapshot, so a write would either land
on a throwaway or have to invent which dataset the row belonged to. Two places refuse, each naming the
fix: `commitDb` for the document, and every live container for a mutation (`readOnly` wraps the merged
value and throws on `set`/`push`/…).

**It began as "refuse every non-GET" in the dispatcher, and that was wrong, because most reads in this
API are POSTs.** `/auth/login` is a lookup, `/ask` is a query, `/whatif/scenario` computes and stores
nothing, `/reports/build` re-asks a question, `/graph-coverage` walks the profiled objects — a method
check refused all of them. The one that mattered was login: switching to `both` signs the reader out,
so a refused login made `both` a state they could never leave. Do not reintroduce a verb check;
`check-docs` asserts its absence. The Dataset panel states the restriction where the switch is, so it
does not arrive as a toast from a page the reader did not know was scoped.

**`MERGE_PLAN` states per key what `both` does, and a key it says nothing about stops the boot.**
Inferring from the value's type would be wrong in both directions: `auth_roles` and
`column_vocabulary` are both arrays and neither unions (one is the identity pool, the other a
synthesis vocabulary), while `audit`, `traces` and `evals` are objects holding arrays *and* the
totals computed over them. The decision on record is **EPA wins every single-valued key** — identity,
the account, the What-if frame, the section vocabularies — and only genuine collections union
(projects, drives, graphs, report definitions, canvas nodes and edges, recorded answers). A key with
no rule would drop out of the merged document, which `validateDb` never sees because it validates the
two real documents rather than the view built from them; the symptom is a page that works under EPA
and is empty under `both`, read as "CAPEX has no data".

**The in-memory state is per dataset, because none of it is keyed by dataset.** A registration is
keyed by source id, a studio decision by `useCaseId:itemId`, a publication by `useCaseId:sha256` — so
one shared `Map` would show an EPA registration while CAPEX was selected. All twelve containers are
declared once in `LIVE_SHAPE` and resolved through `liveContainer`, so the call sites are unchanged.

**The settings have no dataset, and that is a `MERGE_PLAN` rule now rather than a missing file.**
`db.settings` holds the users and each persona's navigation, which is the tenant's rather than a
dataset's, so `MERGE_PLAN` marks it — and `reports_prototype` beside it — `primary`: a secondary
dataset's document carries the primary's answer to "who exists" rather than a second one. While they
were files of their own the same fact was expressed by refusing to push them under a secondary
prefix; that refusal is gone with the documents it was about.

**A secondary dataset is seeded, not left empty, and `npm run seed:dataset -- CAPEX` writes it.**
"Empty" is not a document: `validateDb` requires 27 keys and checks inside most of them, and the two
obvious ways out are both wrong — seeding CAPEX with EPA's rows shows EPA's figures under CAPEX's
name, and leaving it invalid stops the server booting. The seed writes the third thing, the primary's
*structure* with the primary's *rows* removed, and it decides which is which by reading `MERGE_PLAN`
rather than a second list of its own. It writes a file only, like every other seed here, so the flow
is: seed, check the diff, `npm run db:push -- CAPEX`.

**So `validateDb` permits an empty collection in a secondary dataset, and nowhere else.** Fourteen
keys are required non-empty and every one of those rules is right for EPA — a document that came back
with no projects or no profiles has lost data no route touched. A dataset that is deliberately empty
is a different fact, so `empty` is true only when the selected dataset is not the primary. Nothing
else is relaxed: a row that *is* present is checked exactly as strictly, so a malformed CAPEX project
is still a refusal.

**On the client, the selection is sent from one place and the pool is served from another.** The
value lives in `src/api/dataset.ts` beside the fetcher that sends it — not in a store, because
`request()` must read it at module scope for the very first call, before anything has hydrated — and
it is persisted to `localStorage` under its own key, which `logout()` does not touch. `GET /datasets`
supplies the options, never a list written into `DatasetPanel`, and each row states what it holds so
an unpopulated dataset reads as empty rather than as a page that failed. That "no data yet" is on the
**row** as well as in the select, because a select renders its options through a portal: in the
dropdown alone it was visible only after opening the control, leaving a reader to infer an empty
dataset from a line of zeros.

**A persisted selection can outlive the dataset it names, so a refused one is discarded and the call
is remade.** This is not hypothetical and it bricked the app once: `CAPEX` was removed from
`DATASETS` while browsers still had it selected, and since the value survives a reload and a
sign-out, every request carried `x-dataset: CAPEX` and the server refused every one. Both sides
correct — the refusal is exactly what a wrong dataset should get — and nothing in between cleared
the value, so every page failed identically and the only cure was editing `localStorage` by hand.
`resetDatasetIfRefused()` in `dataset.ts` forgets it, and `request()` calls that **only** on a 400
naming `is not a dataset`, retrying once.

**It recovers from the server's answer rather than pre-empting it, and that is the whole
distinction.** Validating the stored value against a list held in the client is the obvious fix and
the wrong one, for the reason the consent screen's client-side scope list was wrong: a pool in the
browser can refuse a dataset the server has, and it would go stale the same way one release later.
Nothing here decides whether `CAPEX` is a dataset — the server decides, refuses, and the client
discards the value *because* it was refused. The retry is gated on the reset reporting it had
something to clear, so a genuine 400 throws on the second pass instead of looping.

**Every persisted reference needs an answer to "what if the thing is gone".** The identity in
`localStorage` carries `roleId`, which is a `db.auth_roles` id, and removing a role would strand a
signed-in browser the same way.

**Changing the dataset is administered in Settings, confirmed in words, and ends the session.** It is
not a view toggle, and the three parts are one act:

- **Settings → Dataset**, not the sidebar. A control that signs you out does not belong beside the
  page links, one mis-click away; Settings is where the things that reconfigure the console already
  are. The panel also lists what each dataset holds, which is the answer to both "did my switch work"
  and "why is CAPEX empty".
- **A confirmation naming both datasets**, from `src/data/datasetSwitch.ts` — copy rather than markup
  for the reason `sourceActions` is (a `Modal` portals out of `renderToString`), and interpolated from
  the two names so the CAPEX dialog can never ask about EPA. It states the sign-out, because that is
  the one consequence a reader cannot undo by switching back. The select's `onChange` only opens the
  dialog; nothing changes until OK.
- **Then sign out and reload**, in that order after persisting: `setCurrentDataset` → `logout()` →
  `window.location.assign('/login')`. Persisting first is what makes the choice survive the reload;
  doing it after would race the navigation, and losing it would bring the app back on the dataset the
  reader had just left with a sign-out to show for it.

**The reload is the mechanism, and it replaced an `epoch` counter used as the `<Outlet>` key.** That
key remounted the *components* and left the module-level zustand stores holding the previous
dataset's rows — stores are singletons, so unmounting the page tree does not clear them. A guarantee
in appearance only. A full document reload constructs every module again, so nothing can carry a row
across, and signing out is honest besides: the persona was resolved against the tenant directory, and
every registered source, profiling job, studio decision and publication in the mock server's memory
belongs to the dataset it was made under.

**The dataset's letter is the first segment of every in-app URL** — `/E/sources`, `/C/reports`,
`/B/ask` — so the address says which dataset the page is showing. `datasetSegment` takes the first
letter and capitalises it; `appPath` puts it on the front of every `navigate`, `Link` and `href` that
points inside the app, so it cannot be present on most routes and missing on one. `NAV_ITEMS` keeps
its canonical paths (`/sources`) and the sidebar prefixes them at render, because a prefix baked into
the nav table would be a second place the dataset lives and stale the moment it changed. `/login` and
`/login/data` stay unprefixed: they are the addresses that exist without a dataset.

**The selection is the authority and the URL is its rendering — which is backwards for a URL, and
deliberate.** `DatasetPathGate` sits at `/:ds` and *corrects* a segment that is wrong or missing
rather than adopting it: `/C/sources` under EPA becomes `/E/sources`, and an old unprefixed
`/sources` becomes `/E/sources` too. Adopting it would make the URL a second way to change dataset —
one that skips the confirmation and the sign-out, and that would leave the letter disagreeing with the
`x-dataset` header every request carries. A single-character first segment is the dataset segment and
anything longer is route, which is what tells those two repairs apart; search and hash ride along,
since they belong to the page rather than the prefix.

**One letter is unambiguous only while the initials differ.** `EPA`, `CAPEX` and `both` give `E`, `C`
and `B`; a third dataset starting with one of those would share an address and the URL would name
neither, so `check-docs` asserts the letters are distinct rather than leaving it to be discovered.

**The correction is a pure function (`datasetPathFix`), and the gate only renders it.** `<Navigate>`
navigates in a `useLayoutEffect`, which `renderToString` never runs — a test that mounted the route
table and read the router's location reported *every* redirect as broken, `RequireAuth`'s included.
The decidable part lives where it can be asserted, for the same reason a `Modal`'s copy lives in
`src/data/`.

**And the login says which dataset it will sign into.** A switch drops the reader there, so an
unlabelled form followed by a different console reads as the app having lost the switch. It is read
from the client-held selection rather than the server, because that is what the next request will
carry.

**The address is committed; the credentials are not, and that split is the rule.** `DEFAULT_BUCKET`,
`DEFAULT_PREFIX` and `DEFAULT_REGION` are hardcoded in `store.js` because a bucket name and a key
prefix are *addresses* — they appear in every log line and in `GET /db`'s reply, so committing them
costs nothing and saves setting up an environment. The access key and secret are in
**`backend/.env.local`**, which `.gitignore` covers via `*.local` and `process.loadEnvFile`
reads at boot. `check-docs` asserts both halves: the addresses are present, and no tracked file
matches `AKIA[0-9A-Z]{16}` or a 40-character secret. A key in a tracked file is scraped off GitHub
by bots within minutes of a push, and that is not a hypothetical.

**A bucket name containing a dot must be addressed path-style.** `contextweave.com` does, and the
virtual-hosted form puts it in the hostname — `contextweave.com.s3.us-east-1.amazonaws.com` —
against a certificate for `*.s3.us-east-1.amazonaws.com`, whose wildcard matches exactly one label.
TLS fails before a request is sent, with *"Hostname/IP does not match certificate's altnames"*,
which names neither S3 nor this repo. `addressing()` puts a dotted bucket in the path instead, and
the canonical request carries it there too — sign a different resource than you request and the
answer is 403.

**A session token belongs to temporary credentials only.** `AKIA…` is a long-term IAM key and must
be sent *without* one; `ASIA…` is from STS and is meaningless without it. Reading
`AWS_SESSION_TOKEN` unconditionally pairs a long-term key with whatever token is in the environment
— which is how this first ran, and S3 answered `400 InvalidToken`, which reads as "the credentials
are bad" and sends you to rotate a key that was fine.

**The three JSON documents are committed as well as stored in the bucket — a decision, taken on
2026-08-19.** They were gitignored, on the reasoning that a committed copy beside a served one is two
answers to what the figures are. They travel in git now because the repo is how they reach a box with no
bucket credentials. **The bucket is still what the server reads**: nothing fetches the committed copy, so
the hazard is not a wrong figure but a stale one — and `db.json` being generated *and* committed is
precisely the shape that has already crash-looped a deployed box on `<<<<<<< Updated upstream` sitting
inside the JSON. `readJsonDb` checks for conflict markers before parsing for that reason; after a pull that
touches them, `npm run db:pull` is what makes the checkout agree with the bucket again.

**The credential files are a different matter and are not a preference.** `backend/.env.local` and its
`.backup` copy stay ignored, all three rules are asserted by `check-docs` — see below — and they have now
been committed twice, both times stopped by GitHub push protection rather than by us. A key in a tracked
file is scraped off GitHub within minutes of a push.

**`npm run db:pull` before `preflight` on a fresh checkout.** `check-docs` reads both documents for
~40 claims and now **refuses to run** without them, naming the command — it does not fall back to an
empty object, because roughly forty claims walk `db.projects` and `db.graph_studio.canvas` and the
first `.every()` would crash mid-file, printing no summary. A checker that cannot reach what it
checks says so rather than answering. Both files are gitignored, so pulling them cannot commit
tenant data by accident.

**S3 is signed here rather than with the AWS SDK.** `@aws-sdk/client-s3` is ~40 transitive
packages through a gate that fails on any advisory at `low`, for two HTTP calls; Node 22 has
`fetch` and `node:crypto`, so `sigv4()` is ~40 lines instead. It is **pure and exported** for one
reason: a signature is arithmetic, a wrong one returns `403 SignatureDoesNotMatch`, and a 403 reads
as a bucket-policy problem — you would go and edit the policy, which is not where the fault is. So
`npm run verify:sigv4` replays **AWS's own published test vector** and runs in `preflight`, with no
network and no bucket.

**Both documents are fetched at once, and boot is still dominated by one of them.** They are read
through a single `Promise.all`, so the two waits overlap and the smaller one costs nothing — but
`db.json` is 492 KB and takes **~2.9s** to pull from `us-east-1` on a link from India, against
~1.0s of Node start-up. So a cold boot is ~4s and the fetch is
most of it. **Parallelising helped by about the smaller fetch and no more**; if boot time matters,
the fix is a bucket in a closer region (`ap-south-1` measured ~157ms per round trip against
~957ms for `us-east-1`), not anything in this code.

**And a settings toggle is one round trip, so it inherits that number directly.** `PATCH
/settings/personas/:roleId/nav` writes `db.json` and the store waits for the server to
confirm before it moves the switch, which is deliberate — an earlier bug had a toggle report
failure for a write that had saved. On a cross-continent bucket that is ~300ms–1.2s of the switch
appearing to do nothing. Region is the fix here too; an optimistic toggle would only hide it.

**The boot read is awaited, and that is the same guarantee it always had.** It used to be
`readFileSync`, and the rule was written down as "the boot read stays synchronous" — but the
guarantee was never the synchrony, it was the *ordering*: nothing may be served before both
documents are in. An object has no synchronous read, so the spelling changed and the guarantee did
not. Top-level `await` in an ES module makes source order execution order, both reads sit above
`server.listen`, and `check-docs` asserts the ordering rather than the call.

**A file write is temp-then-rename; an S3 write is not, and does not need to be.** The rename
exists because a crashed `writeFile` truncates; `PutObject` is atomic per object. What S3 adds is
the check a file could never have — **`If-Match` on the ETag this process last read**, so a second
writer becomes a refused write naming the staleness rather than a silently lost update. The write
chain stays either way: it is what preserves ordering, and that reasoning is independent of storage.

**The mock server runs as one instance, and that is a correctness requirement.** PM2 ran three in
cluster mode, which was wrong twice over — every writer hands `commitDb` the *whole* document and
the write chain is per-process, so two workers meant the last one silently won; and the live state
that never reaches disk (`registered`, `studioLive`, `profilingJobs`, `whatifSaved`,
`oauthSessions`) was three independent copies behind a round-robin, so publishing a graph took
effect for about one request in three. Raising `instances` again means moving all of that state out
of the process first. `ecosystem.config.js` records this beside the number, and `check-docs`
asserts both the number and the note.

**The seeds and ingests write files, and only files.** That is correct — they read a demo package
off disk and must run without credentials — so the flow when the server reads S3 is: re-seed
locally, check the diff, `npm run db:push`. A push validates the required top-level keys first,
reading them from `DB_SHAPE` in `server.js` rather than listing them again, because otherwise the
boot failure lands on the deployed box instead of in your terminal. `npm run db:pull` is the other
direction.

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

- **Editing `server.js` requires a restart**, and that clears every registered
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
- **The writes are async; the boot read is not.** `db.json` is 450 KB, and
  `writeFileSync` stringified and wrote all of it on every commit while every other
  request waited — so `commitDb` and `commitSettings` are `async` and go through
  `writeJsonAtomic`. Three things hold that together, and all three are asserted:
  the writes are **chained per path** (two commits share a temp path, and without the
  chain the file that lands is neither document — the serialization the synchronous
  version got for free); the **in-memory swap happens before the first `await`**, so a
  second handler cannot read the pre-edit document and silently drop the first edit;
  and a failed write **puts memory back**, so the file and the process cannot diverge.
  Every call site awaits, or a rejected write becomes an unhandled rejection behind a
  200. The boot read stays synchronous on purpose: nothing may be served before
  `db.json` is loaded.
- `validateDb` in `server.js` guards the required top-level keys, so the `/db`
  editor cannot save a document that would crash the app. There are 27 required
  keys, and the newer ones are as required as the originals: removing `drives`
  breaks the connect wizard, and removing `graph_domains` breaks step 1 of New
  Graph — not just a Catalog page. `column_profiles` and
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
Sources so it can still be reconnected or deleted.

**`/change-signals` has no surface.** The Data Catalog's third tab was removed on
request, so the endpoint, its `db.json` payload, `listChangeSignals` and
`useSignalsStore` are all still there with nothing reading them — the same waiting-for
-a-caller state the `/reports*` endpoints are in. Re-adding the tab is a `Tabs` entry
plus the four selectors; do not delete the layers below it to "finish" the removal,
and do not name Change signals in copy that lists the app's pages.

**Disconnect and Delete ask one question and say nothing else.** *"Are you sure you want
to disconnect / delete this source?"* is the `Popconfirm`'s **title**, and there is no
`description` on either. `SourceImpactNotice` — which stated the consequences — was
deleted on request, along with its stylesheet, its `othersConnected` prop and the helper
in `SourcesPage` that computed it. `src/data/sourceActions.ts` holds the sentence.

**What that costs is recorded rather than glossed, because the acts did not change.**
Nothing on screen now says that Disconnect is reversible and Delete is not, or that
deleting the last connected source closes the Data Catalog, Profiling jobs, Traces and
Validation. All of it is still true: `POST /sources/:id/reconnect` re-issues the handle
**in place** so every profiled object survives (which is why a disconnected row offers
**Reconnect**), `POST /sources` is *not* that act and starts from nothing profiled, and
`registered.delete` takes the profiled tables, columns, documents and every note typed
against them. The app is simply quieter about consequences it still has. Full entry in
`docs/REGRESSIONS.md`; **do not restore any of it without being asked** — it was removed
twice over, deliberately.

**Two rules survive, and one `check-docs` claim covers both across every layer.** The
sentence is **interpolated from the act**, so "delete" can never appear over a
disconnect; and it is written **once**, so the two dialogs cannot come to word the same
pair of acts differently. The claim also asserts neither Popconfirm has grown a
`description` back and that the deleted files are off disk — a partial revival is the
shape that fails silently, so the guard is one cross-layer claim rather than one per
file.

**Copy, not a component.** A `Popconfirm` portals out of `renderToString`, so a sentence
written inline in the page cannot be asserted on; held in `src/data/` it can be called
directly by a test, like `profilingOutcome` and `connectSteps`. That was also the
original reason the notice was its own component.

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
what the Sources table, the Catalog tab and every job row key off, and nothing
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

Four things the mirror deliberately does *not* make identical:

- **A drive is a tree; a project is two flat lists.** Datasets do not contain
  datasets, so BigQuery's allowlist stays a checkbox group — folders do, so Drive's
  is `FolderTreePicker`, built from `parent_id`. **Checking a folder checks the
  folders inside it**, because that is what a reader means by picking a folder, and
  the value stays a plain list of folder ids for the register call. A folder holding
  folders states two counts (`3 here · 41 with subfolders`): one number would be
  wrong either way, and a container reading "0 documents" beside two full subfolders
  is exactly the mistake the flat list made. The drive is also picked in two moves —
  **My Drive or Shared drives** first, then the drive — because a personal drive and
  an organisation's are different things to connect, and a kind the account has none
  of is offered with the count that says so rather than hidden.

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
  **The consent happens in a sign-in window** (`GoogleSignInWindow`), asked for and
  re-added on request after an earlier one was removed: a Google-styled click-through
  with an account step and a consent step. **The window opens on the first call's
  response, not on the click** — it renders the scopes `/sources/oauth/start`
  reported, so a window that opened first could only open blank or guess, and Drive
  asks for two. **Allow is what spends the consent**: the callback and the discovery
  call run from that button, `GoogleConsentPanel` shows its row per call inside the
  window, and Cancel grants nothing and connects nobody. The account it offers is the
  browser's own and it says so — an account chooser listing invented people would be
  a claim about who has signed in to Google — and the window states in its own footer
  that it proves a request is well-formed rather than that a real Google account is
  behind it. It keeps no scope list of its own; `CONSENT_GRANT_COPY` supplies wording
  only, and `check-docs` fails if one comes back.
- **Step 3's two acts are paced too, at `CONNECT_STEP_MS` (5s).** `1. Run preview` and
  `2. Finish` are the calls that would really reach Google, and both answered before
  their spinner drew a frame. The hold is on the four endpoints — `/sources/preview`,
  `/sources/drive/preview`, `/sources`, `/sources/drive` — never in the wizard, so the
  rule the consent stages keep is unbroken: **a button advances when its request
  returns, not on a timer the client holds**. Only the success reply waits; the
  refusals above it are immediate, because a five-second 403 on a mistyped handle
  reads as a hang. `check-docs` asserts both halves per endpoint and that none of the
  four handlers grows a timer.
  **And each act is named while it runs, in its own small modal.** `ConnectRunPanel` is a
  spinner and one line — *Discovering the datasets in project vrio-contextweave-demo* under
  Run preview, *Registering project … with the datasets you checked.* under Finish — two
  dialogs, because one panel listing both rows said "registering the source" while nothing
  was being registered. The message is `src/data/connectSteps.ts`'s, per act and in the
  connector's own unit, and neither act's words carry the other's verb. **Its `{subject}` is
  the id the request is made with** — the project, or the drive on Drive — interpolated the
  way `runtime.headroom.sentence` interpolates `{room}`, so a five-second wait says which
  project it is reading. No subject-less variant: step 2 will not advance without an id.
  Both open on
  `busy` rather than on state of their own, over the two Google branches only, since the
  generic one has no paced call behind a dialog.
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
while `active_count > 0`) and why starting a run switches the Catalog to the
jobs tab — a queued job is otherwise invisible. **And why queueing one re-reads
the board**: that poll stops at `active_count: 0`, so a second run started with
the tab already open is invisible to it. `handleQueued` loads the jobs list along
with the sources; without it the re-profile confirm queued a run that
really ran while the board sat on the completed job, which reads as a button that
did nothing. A poll that stops is not a subscription. Already-profiled objects are
skipped; an all-skipped job completes instantly rather than faking a run.
**`force` is never the first click, and both places that set it are a second act.**
Profiling jobs keeps its per-row **Force**, for a run that has already finished. The
browse panels start unforced always — but when *everything* picked was already
profiled, the run does nothing, and that outcome is where re-profiling is offered:
`profilingOutcome` (shared by both panels, so they differ only by the noun) turns it
into a confirm that **names the objects** and says what profiling them again would do,
with `force: true` behind its OK. The message it replaced — "Nothing to profile — 2
table(s) already profiled. Use Force on the run in Profiling jobs to redo them." —
never said *which* two, and sent the reader to another tab to act on the job that had
just done nothing. A count with no names leaves you to work out whether the object you
cared about ran; the naming is capped at `NAMES_SHOWN` and **the cap is stated**, never
a silent truncation. `check-docs` asserts the button does not force and that the
confirm's `onOk` is the only path that does.

A forced commit **updates the existing record in place** instead of pushing a
second one, so `profiled_tables` cannot double while `profiled_at` still moves.

A job's work list is `objects` (`{parent_id, object_id, label, units, state}`)
with `kind` and `unit` on the job, never `tables` — one board carries both
connectors' runs, and a re-run posts back to the endpoint its `kind` names.

### The New Graph wizard (`/new-graph`)

Six steps — Domain, Personas, KPIs, Sources, Hero questions, Entities &
relationships — over `NewGraphPage.tsx` → `graphStore`
→ `/graph-domains`, `/graph-personas/suggest`, `/graph-kpis/suggest`,
`/graph-sources`, `/graph-questions/suggest`, `/graph-coverage` and `/graph-use-cases`.
**All six steps are built.**

**'Answer requirements' was step 6 and is gone.** The citation policy and the render
format were declared once per brief, for every answer the graph would ever give; they
are asked for **per question** now, on Ask's own tab — see Ask below. Nothing on a brief
stores them, `/graph-answer-formats/suggest` is gone with the step, and `LAST_STEP` in
the page is the one place the count lives (`stepTotal` still reads the server's
`WIZARD_STEPS`). A brief saved on the old step 6 or 7 opens on the new last step:
`savedUseCase` clamps the number, because a stepper pointing at a step the API would
reject is worse than a brief that opens one screen further back. `check-docs` asserts the
absence on **every layer at once** — the server, the store, the page, the rules and the
deleted component — because half a removal is the shape that fails silently.

**Steps unlock in order, and one function decides it.** `stepIssue(step, draft)`
in `src/data/wizardSteps.ts` is the only definition of "this step is complete" —
`Next`, the stepper's lock and the last step's build button all read it, so they cannot
disagree. A step past `maxStep` renders locked but stays clickable, and says what
is missing. Back is always free; jumping forward re-checks the steps in between,
because an answer can be deleted after it was given. Add a new step's rule there,
not in the page. Server-side only step 1's domain is enforced (`step > 1` or a
commit without one → 400) — a later step's rule would stop **Save draft** from
keeping partial work.

**A model call is never silent or instant.** The derivation between steps 5 and 6
is a real async run (`POST /graph-derivations` → 202, poll by id) that reveals its
entity names and its cost as it goes, and every `Suggest … (LLM)` response is held
for `SUGGEST_MS` so the drafting state can be seen. Both are paced for the same
reason `PIPELINE` is: an operation that returns instantly and shows nothing
teaches that it is free, and this one is not. Never show a cost figure the server
did not report.

**Step 6 derives only from what is profiled.** `graphCoverage` walks the source
picks back to real profiled objects, so an entity names the table it came from
(`manifest_header (1,240,500 rows)`) and a relationship is claimed only where two
objects share an identifier column in the dictionary. A hero question no profiled
column covers becomes a **gap**, and **the build stays blocked until every gap has
a decision** — that gate is the point of the step, so do not let "Save & build"
proceed past an undecided one.

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

- **The step labels live in `server.js` (`WIZARD_STEPS`) and reach the page in
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
  Only personas, KPIs and hero questions are templated — which is now all three
  suggesters. The answer formats had no `memberKey` and stayed ranked, because a use
  case states what it must answer and never how to render it; that suggester is gone
  with step 6, and the whole pool is offered on Ask instead.

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
  the Data Catalog; and `Next` refuses with the fix for whichever case applies,
  because every later step derives from this selection.

The user never types an entity name — that is the product premise, so do not add
an entity field to any step. Step 7 confirms what the AI derived. Personas are
lightweight tags that shape questions and tone; they are **not** access control,
and nothing in this flow should start treating them as permissions.

### Graph Studio (`/graph-studio`)

Where a *built* graph becomes a published one. **The studio lists graphs, it is
not one graph** — `/graph-studio` shows every use case that has been committed on
the last step, and `/graph-studio/:useCaseId` opens that one's review. New Graph's
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

**And build first: the other four tabs are locked until a run completes — and locked again
while one is in flight.** Review queue,
Canvas, Query & sanity-check and Versions all read *a build's output*, so
they are `disabled` while `builds` holds no `complete` run — the review queue most of all,
because its rows are the package's and it looks populated whether or not anything has been
built. **A rebuild locks them the same way**, because what they would show while it runs is
the *previous* build's output with nothing saying so: a canvas and a version list the run is
in the act of superseding, which reads as this run's result arriving early, and settling a
queue row against a superseded canvas is a decision made on stale evidence. So the flag is
`outputReadable` — `builtOnce && !buildRunning` — and it drives all four, so they cannot
disagree. Two things this
needs and has: a locked tab **cannot stay the active one** — the studio's default arrival
tab is the queue, and a disabled *and* selected tab renders a pane with no way out — and
the lock **says why**, above the tabs, only while it holds, in different words while a run
is in flight ("start one" is the wrong instruction for somebody already watching one, and it
is the only sentence a rebuild can carry).
This does not reverse the paragraph above: rebuilding after settling rows is still the
normal case; its output simply cannot be read until it lands.

**Each stage names its own substeps, and the substeps are what advance.**
`BUILD_STEPS` is `BUILD_STAGES` flattened — 31 substeps at `BUILD_STEP_MS`, **3s**
each, so a whole build runs ≈**1m 33s** — and a run keeps **one cursor** into that
list. Every state on screen is derived from it: a substep is complete before the
cursor, running at it, pending after, and a stage is `running` exactly while the
cursor sits inside it. A stage index kept alongside a step index is two counters
that can disagree, and the symptom is a stage reading complete while one of its
substeps still spins. Adding a stage means adding its substeps too — a stage with
none is a row claiming work nobody can see, which is what this replaced, and
`check-docs` fails on it.

**A build takes minutes, so the panel says how many.** 3s a substep is slow on
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

**There was a sixth tab — Quality report — and it is gone.** It ran
`POST /graph-studio/:id/quality-check`, which recomputed the same three preconditions
`publish.blocked` already reports: a second surface for one gate, and the only one a
reader could mistake for a separate verdict. Removed on request across every layer at
once — the endpoint and its `QUALITY_CHECK_MS` pacing, `runQualityCheck` with the
`QualityReport`/`QualityCheck` types and their schema in `client.ts`, the store's
`report` / `checking` / `check`, the tab and its `.gs-check*` and `.gs-quality-head`
styles. **The gate itself is untouched**: `publish.blocked`, its `reasons`, the banner
above the review queue and the refusal on publish are still those three checks, still
computed once on the server. `check-docs` asserts the absence on every layer at once,
because half a removal is the shape that fails silently.

**The five tabs are one truth, not five pictures.**

- **Canvas** is the **vendored graph viewer** (`src/graph-viewer`), a d3-force drawing with
  its own sidebar, legend, search and inspector. **It replaced a hand-written inline SVG**
  that drew the ingest's precomputed positions: 189 nodes in a fixed arrangement read as a
  hairball, and no palette work fixes a layout nobody can pull apart. The viewer was
  **vendored rather than reimplemented**, the same way `src/reports/` was — what runs here is
  its own hook, its own lib and its own stylesheet.

  **There is one copy, and it is this one.** The standalone app it was vendored from lived at
  `vendor/graph-viewer-source/` and was deleted on 2026-08-18: nothing imported it, so it was
  a second copy of the viewer that could only ever drift from the one being rendered. Its demo
  dataset went with it — so `src/graph-viewer/data` being absent is now a deletion rather than
  a relocation, which is the same guarantee by a shorter route. Git history holds the original
  if the folder's own behaviour is ever in question; change `src/graph-viewer` for anything the
  app should do.

  **d3 is a real dependency, and a deliberate exception.** "Prefer writing ~100 lines to
  pulling in a package" still holds everywhere else — the answer charts and the What-if
  drawings are still hand-written SVG — but a force simulation with drag, zoom and a settling
  layout is not 100 lines, and the folder that already had one was the thing being asked for.
  `npm audit` was 0 advisories before and after; the gate runs on every install.

  **One canvas component, two frames.** The studio tab and `…/canvas` (the **Full view ↗**
  button, which lives on the tab because a vendored viewer knows nothing about this app's
  routes) render the same component on the same payload. A full view with its own drawing
  would be a second truth. The viewer brings its own inspector, so the studio's
  `NodeInspector` column went with the old canvas rather than sitting beside a panel saying
  the same things.

  **Four changes were made to the folder on the way in, and no others.** It takes its graph
  as a prop instead of importing the demo dataset that shipped with it; its root carries
  `cw-graph`, the class its stylesheet is now scoped under (its selectors are as generic as
  `.link`, `.tab` and `.dot`, and it carries a whole palette on that class — unscoped it repaints
  the app);
  `useForceGraph` gained a `highlight` prop, because the Query tab promises an answer's
  evidence lights up here and that mechanism already existed for the clicked neighbourhood;
  and **it fills a container instead of a document**.

  That last one is a bug this already had. The root was the document's own flex root at
  `100vw`, so it declared no width; dropped into the full view's flex row it sized to
  *content* — the drawing collapsed to min-content beside a 360px sidebar and two thirds of
  the page stayed blank white. The width is stated both ways now (`width: 100%` for the
  studio tab's block container, `flex: 1 1 auto` + `min-width: 0` for the flex one), pressure
  comes out of the drawing rather than the panel, and the **simulation measures its box**
  rather than reading `clientWidth` once: an unlaid-out panel measures 0, which piles every
  node into the corner, and a `ResizeObserver` re-centres instead of keeping a centre for a
  width the panel no longer has. `check-docs` asserts all four halves.

  **`fromCanvas` renames; it does not invent.** The two shapes were already close, which is
  why vendoring was possible: `element_class` is exactly the viewer's three classes (only
  `measure_element` → `measure`), our ontology `type` is the key its palette is written
  against, `source` is the `provenance` its inspector prints, and the studio's review state
  becomes its L2 note — *only where there is something to say*, because an absence has no
  note. `r` is deliberately **not** passed: the viewer sizes a node by class and degree, and
  two radius rules disagree silently. `check-docs` asserts every type the canvas draws has a
  hue and that each hue clears 3:1 on the viewer's own ground — **read off `--bg`, never written
  down twice**, which is what let the ground be turned over without the hues quietly going with it.

  **Two fields on a canvas node are each dataset's own, and declaring them narrowly refused a whole
  canvas.** `group` is the package's account of how an element was built — EPA states four origin
  classes (`row`/`schema`/`document`/`alias`), CAPEX names its node types — and `source` is the
  Catalog object behind the node, which CAPEX does not state for 11 of its 442. Declared
  `oneOf([…four…])` and `str`, they refused **every** CAPEX node with *"group should be one of row |
  schema | document | alias"*, under the message that tells you to restart the mock server. `group` is
  a plain string now — nothing decides an appearance from it, since the viewer colours by ontology
  `type` — and `source` is nullable, with the inspector drawing no provenance line rather than the
  word "null". The third instance of the `rows: num` pitfall, and `check-docs` now checks both
  documents against the schema rather than trusting the declaration.

  **And the palette is per-ontology, so it carries both.** The nine hues above are EPA's; CAPEX draws
  **18** types of which three overlap, so fifteen fell through to the grey default and its legend was
  fifteen identical rows — the "honest but silent" failure the palette claim exists to catch, reached
  for the dataset the claim did not read. Fifteen hues were generated (each type's rank stepped by the
  golden angle, then its lightness walked down until it clears 3.2:1 on white) and **written into
  `TYPE_COLORS` as literals**, so a designer can move one; a per-name hash was tried first and put two
  types 0.2° apart. `check-docs` measures the union of both canvases' types and asserts no two types on
  *one* canvas share a hue. What that cannot fix is stated in the file: eighteen categories do not
  separate reliably by hue at a 4.5px disc, so the legend's counts and its filter rows are how a reader
  isolates a type.

  **The ground is white, and it was not when the folder arrived.** The viewer was vendored dark, so
  the Canvas tab read as a hole cut in a studio whose every other surface is white; turning it over
  was the whole palette rather than one token, because a palette is a set of relationships. The nine
  node hues went from GitHub's dark set — **1.95:1 to 3.36:1 on a white page**, which is a legend
  nobody can read — to their ~5:1 shades, all nine in *one* luminance band so they are told apart by
  hue rather than by lightness. Two consequences worth stating: Enforcement is orange rather than a
  second red, because `#f85149` and `#ff7b72` were separated by being light and lighter and neither
  can stay light here; and the halo cut around every disc and label is the *ground's* colour, so it
  inverted with it. `docs/REGRESSIONS.md` holds the rest — the earlier failure was reusing one
  ground's hues on the other, in the opposite direction, and the guard that catches both is the same
  one.

  **The ingest's positions still do work.** `x`/`y` are handed to d3 as each node's starting
  position, so a run settles from the arrangement `npm run ingest:graph` wrote rather than
  from a random scatter — which is why the picture is recognisably the same graph each time,
  and why re-running the ingest is still how the layout changes.

  **What the retirement cost, stated plainly**: the origin-class fill and the ontology ring
  (the viewer colours by type instead — nine hues, which the four-hue origin-class fill could not
  carry), labels gated on `LABEL_AT_ZOOM`, the hand-written `getScreenCTM`
  pan/zoom with its non-passive wheel listener, and `src/data/canvasLegend.ts`. `group` is
  still on the payload and still checked at boot — it is the graph's own account of how an
  element was built — but the drawing no longer encodes it.

  **An element is "proposed" exactly while its review item is undecided**, so settling a row
  in the queue changes what this shows — it reaches the viewer as the node's L2 note rather
  than as a dash, which is the one thing a reviewer must not miss.

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

  **`source` is the Catalog object** the node was built from
  (`epa_hazwaste.FRS_Facility_profile`, `Compliance Docs ·
  08_unstructured/chemours-cd.pdf`), and it reaches the viewer's inspector as
  `provenance`. A node whose provenance is not on it is a claim the reader has to take on
  trust.

  **Clicking a node dims everything outside its neighbourhood** — the viewer's own
  interaction, and the reason the hairball became readable. At 189 nodes "which of these
  lines are mine" is not answerable by looking. Its search box narrows by label, and its
  legend rows filter by type, each carrying its count.

  **An edge whose endpoint is not a node is refused at boot.** An earlier package
  shipped 20 of them — three alias names and an unitemised enforcement type its
  roster omitted — and a skipped edge is silent: 17 facilities simply appeared to
  have no enforcement. `validateDb` checks the endpoints across keys, and the viewer's own
  `normalizeGraph` drops such an edge quietly — which is exactly why the boot check has to
  be the one that catches it. **This build resolves cleanly**, so the ingest no longer
  materialises anything and *throws* if it has to: `check-docs` asserts the canvas is
  exactly the roster, because a canvas bigger than the package means something is being
  invented again.
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
- **Versions** lists **every version, which is to say every build** — newest
  first, one row each, from `studioVersions`. A row carries what identifies it
  (`sha256`), what it is (`entities`, `relationships`, `graph_id`), where it came
  from (`from_job`), the config it is a version of (`config_version`), and whether
  the gate had passed when it finished.

**A version is content-addressed and immutable.** `sha256` is its identity: two
builds of one brief differ there and nowhere else. **Each build also takes its own
number — v1, v2, v3** — so the list reads as a list of builds; the number is a name,
the hash is the identity. **Publishing flips a pointer, it never rewrites a row** — `studioLive` holds
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

**A version per build, assigned once, never recomputed.** `studioBuildCount` gives each
run the next number when it *starts* — v1, v2, v3 — and every surface reads that stored
value, so a published `v2` stays `v2` however many builds follow it. That immutability is
the whole point and it is what the previous scheme was protecting by a different route:
`configVersion` used to be bumped by *committing a brief*, so every rebuild of one brief
shared a label and several rows legitimately read `v2`, told apart by hash alone. Reported
from use as the wrong reading of a list of builds, so the label now names the build.
Committing a brief moves nothing, and neither does publishing — **two counters over one
label is how a published v2 comes to be called v3 by something that never rebuilt it.**
A brief that has never been built reports `v1`, which is what its first build will
produce rather than a claim that a version exists.

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

**Ask is a conversation, with New chat and a chat history beside it.** A question becomes a
**turn** (the question plus the answer it got) appended to the active chat; the last answer is
the last turn, read through `selectActiveChat`, and there is no second copy of it in the store
— two homes for one answer is how the thread and the history come to disagree. A chat is
created **by asking**, so "New chat" only clears the active id and the list never fills with
empty threads. Switching graphs starts a new thread: an answer belongs to the version that
produced it.

**The history panel is called History, and it starts shut.** A permanent 260px column costs
the thread a quarter of its width on every screen to show a list a reader consults
occasionally, so the panel collapses to a single toggle — which carries the **count**, because a
shut control with no number says nothing about what is behind it. Collapsed means *absent*, not
hidden: the component returns early, so the rows are not in the markup at all. Expanding reveals
New chat and the threads; starting a thread or opening one shuts it again, because both acts end
in reading and reading wants the width.

**The history is `sessionStorage`, keyed by the signed-in address, and the panel says so.**
Session rather than local because a chat is a working session — the same reasoning that keeps
registered sources and review decisions in the mock server's memory — and keyed by email
because the identity is client-held and two people share a browser. A signed-out caller reads
and writes nothing: "signed out" is not a user. `CHATS_KEPT` (20) is the cap, stated on the
rail along with the fact that closing the tab ends it and **nothing is stored on the server** —
a rail that looked like an archive would promise one that does not exist.

**And it is validated on the way in.** `sessionStorage` is hand-editable, exactly like the
`/db` editor, and a restored chat is rendered by the same components that render a validated
answer — so `loadChats` checks each entry and *drops* what fails rather than throwing: one bad
chat costs that chat, and a turn with no answer (a tab closed mid-stream) is dropped rather
than restored as a spinner nobody can end.

**The agent's own messages are the server's stages.** While a question is in flight the turn
renders the streamed `stage` lines, then the summary, then each block, paced between the pieces
(`ASK_STAGE_MS` 420ms, `ASK_BLOCK_MS` **5s**) — so a five-block answer legitimately takes ~25s
and a one-line abstention does not. The page holds no timer: a stage appears because a stage
happened, the same distinction `GoogleConsentPanel` draws.

**A paragraph every 5s, with a shimmer for the ones still out.** Five seconds is long enough
that an empty gap reads as a page that stopped, so every paragraph still to come is drawn as a
placeholder — and the *count* is the summary event's `block_count`, not a guess. The server
knows it because the answer is composed before the stream opens; a client-side guess would put a
shimmer under an answer that had finished, which is the same lie as a stage that ticks without a
request. Three ragged lines rather than one bar (a paragraph is ragged; a rectangle reads as an
image loading), `aria-hidden` because the page already says "Composing the rest of the answer…"
in words, and the pan yields to `prefers-reduced-motion` — it is decoration over a stated fact.

**The Answer requirements tab is currently switched off.** Its tab item and the five hooks that
feed it are commented out together in `AskPage.tsx` — together, because `noUnusedLocals` fails
the build over a binding nothing reads, and because a commented tab beside a live panel import
is a component nothing renders. Nothing behind it was removed: `AnswerRequirementsPanel`, the
served pool on `GET /ask`, `POST /ask`'s `citations` and `formats`, and the per-answer
`requirements` verdict are all still there and still asserted. While it is off every question is
asked with the **served default** (`required`), and turning it back on is uncommenting the two
blocks. `check-docs` reads it through `codeOnly`, so the claim cannot pass over the comment.

**Two tabs: Ask, and Answer requirements.** The second is where step 6 of the wizard
went. A reader picks what an answer has to carry — citations `required`/`optional`, and
which render formats they want — and the choice **travels with the question**
(`POST /ask` takes `citations` and `formats`), because the reader asking is the one who
knows what this answer has to be. The pool is served on `GET /ask`, never written into
the component, for the reason the consent screen renders the scopes the endpoint
returned: a client-held list can offer a value the API refuses, and an unknown
`format_id` is a plain 400 naming the pool, before the stream opens. `selectCitations` is
the single definition of the effective value — the reader's pick, or the served default —
so the control cannot show one thing while the request carries another.

**And the answer reports on it, computed rather than asserted.** `requirements` rides on
every envelope with a `satisfied` flag and a sentence. **Citations really apply**: asking
for them and getting an answer that cites nothing is a fact, `satisfied` is false and the
page tags it. **A format is stated, not applied** — a recorded answer holds the blocks
the tenant wrote, so claiming it was rendered to order is a claim the screen underneath
disproves. Same two-gate honesty as a report's audience versus its data scope; do not
collapse them into "the answer met your requirements".

**Nothing else on the page is written copy pretending to be data.** The version, who
published it and when come from the publish record; the standing caveats are
the coverage step's gap decisions read back through `GAP_CAVEAT`; and the suggestion
chips are the use case's own hero questions — a
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

**A dataset's lens is either computed or shipped, and CAPEX ships one.** Everything below describes EPA:
a candidate load is admitted hypothetically and every figure is traversed to that generator's federal
record, per request. CAPEX has no pool of candidates to admit — its own document says so, which is why
its `generators` and `candidate_pools` are legitimately empty — and its model is a cost decomposition
moved by sliders instead. So it ships a finished page, `frontend/src/Capex/what-if-lens/`, and the
What-if page frames it in an `iframe` exactly as the Library frames a CAPEX report. Rendering the
traversal lens over that data would draw an empty frame above a pool reading "nobody qualifies", which
is an answer and the wrong one; transcribing the page's figures into components is the other way to get
it wrong, and it looks right on screen.

**The pointer is `whatif.document` and every field of it is read out of the file.** `npm run
ingest:capex` writes it — the same script that ingests the reports, because both write
`db.CAPEX.json` and two writers of one document is how a subtree gets dropped. The `<title>` stamp
carries the name, the stage and the version (*What-if — Veolia CapEx (draft v2)*), the `<h1>` and
standfirst carry what the page says it is for, and the tab buttons carry its own two tabs; the script
**refuses to write** rather than storing a row the page could not label. `stage` is deliberately *not*
checked against `governance.statuses` — those are the lifecycle states of a governed Library row, and
the lens is not one.

**Behind the publish gate, so it is served on the open branch only.** A computed lens overlays the
published graph, so with nothing published its figures would be attributed to content nobody released; a
rendered one asked nothing of a graph, which is why it rode both branches at first. **Reversed on
request**, together with the report documents — the graph is released first and the surfaces that read
the tenant's data open after it. So `GET /whatif` sends `document: null` while the gate is closed, the
page tests `publishedCount` **before** `frame.document`, and `check-docs` compares the two indices in
that order. A restart closes it again, because publication is in memory.

**One viewer, two callers.** `DocumentViewer` frames a Library report and this lens both: the single
copy of the file resolved at build time, the real boundary around it and the missing-file diagnosis are
wanted identically by each, and a second viewer would be a second place for the `.apiFab` rule to hold.
`reportDocuments.ts` grows a **second glob** rather than a widened one — `Report/` holds reports and
`what-if-lens/` holds a lens, and the folder is what says which kind a file is — feeding the one lookup,
so the duplicate-basename throw still covers both.

**The lens is rendered `seamless`, which means it is the page rather than a file on display.** Asked
for directly, and it is four things: no bar — so no **Back** to somewhere it never came from, no
**Export PDF**, and no label restating a title the document prints itself — no border or radius on the
frame, and the document's own `body` background painted **white** by a rule injected into the frame.
Together they are the difference between a page of this app and an embedded HTML file. **What it costs
is the print button**, and that is stated rather than glossed: nothing else offers to print a framed
lens, and the browser's own Print gives the app around it, because `DocumentViewer.css` deliberately
narrows nothing for print. A report keeps all of it — bar, Back and export.

**Five rules are injected, never edited in**, exactly as the mock-API pill's is: the document's
`_meta` says *"never hand-edit this file — change the generator and rebuild"*, so an edit would be lost
at the next export and silently return. They are `SEAMLESS_CSS`, applied only to a seamless frame:

- **the page ground**, overriding `body` rather than the document's `--bg0` token, because a token name
  is one file's private vocabulary while `background` on `body` is the fact;
- **the publish dialog's scrim**, which washed the whole lens with `rgba(20,25,35,.44)` — so opening
  *Publish this scenario* greyed everything behind it. Flat `#fff` now. A translucent white was tried
  first and reported as grey again, correctly: at 82% the sliders and figures behind it read through,
  and a page seen through a haze is not a white page. The card keeps its own border and
  `0 14px 40px` shadow, which is what separates it from the ground — the scrim never did that;
- **and a lock on the page behind that dialog** (`body:has(.shOv.on)`), because `.shOv` is
  `position: fixed` with its own `overflow: auto`, so a tall dialog scrolled itself *while the document
  behind still scrolled too* — the second scrollbar back again the moment Publish opened. `:has()` is
  what lets a rule say that from outside; where it is unsupported the rule is inert and the old
  behaviour returns, which is a visible fallback rather than a broken page;
- **the receipt's link out of the app** (`.shGov`, and the `<br>` after it, or the removed line keeps
  its blank). *Scenario published* ends in an orange *Open Audit & Governance →* pointing at
  `../10_access_publishing/governance_audit_capex.html` — a sibling of the document in the package it
  was exported from, and a path this bundle does not carry, so inside the frame it is the most emphatic
  control on the dialog and it can only 404. The fact it stated is still there in words one line above
  it (*"per-reader scope is managed in Audit & Governance"*), which is why hiding the link loses a
  broken route rather than the sentence;
- **and a document's own top bar** (`body > .top`). The Audit & Governance screen draws one — the
  wordmark, a breadcrumb and an avatar naming *Dana Whitfield, Domain Architect* — which inside this
  app is a second wordmark under the first and a second identity beside the sidebar's, naming somebody
  the reader is not. The same decision as dropping the report prototype's `main.tsx` and `Sidebar`. The
  rule is inert for a document that draws no bar, which the What-if lens does not.

**Every declaration carries `!important`, and that is load-bearing.** These documents have *two*
stylesheets — one in `<head>` and a second **inside `<body>`**, which is where `.shOv` and `.shGov` are
declared — so a sheet appended to `<head>` is *earlier* in document order than the rules it means to
beat, and at equal specificity the later one wins. The failure is half-silent and reads as a selector
typo: hiding the receipt's link took its trailing `<br>` (which nothing else styles) and left the link
itself, and the white scrim was inert from the day it was written while the ground beside it worked —
because `body` is declared in the *head* sheet and `.shOv` is not. Appending the injection to the end of
`<body>` would fix it by luck of ordering and break at the next export that moves a block; weight states
the intent instead.

These name the documents' own class names, which is a real coupling and the same one `.apiFab` already
is. It is the price of not editing a generated file, and it fails visibly rather than silently — a
renamed class leaves the rule inert and the grey comes back.

**And the frame keeps a fixed height, which looks like an oversight and is not.** Sizing the iframe to
its content would put the document in the app's own scroll and remove the last cue that a frame is
there — but this lens places its publish overlay (`inset: 0`) and its toast with `position: fixed`,
which resolves against the **iframe's** viewport. Make that viewport as tall as the document and a
reader scrolled past the top clicks Publish and sees nothing happen, the dialog having opened a thousand
pixels above them. `check-docs` pins the height for that reason: "make it seamless" is exactly the
request that would remove it next.

**But the height is measured rather than guessed, because a guessed one gave two scrollbars.** `82vh`
plus the page header plus the shell's padding is taller than the viewport, so the *app* scrolled as well
as the document — two bars at the same edge, and dragging the outer one moved the frame instead of the
report. The frame is fitted to exactly what is left of the viewport, so the app has nothing to scroll
and the document's own bar is the only one. Three things make that fit right, and each was a bug in the
first attempt: it is measured from the frame's **document-relative** top (`rect.top + scrollY`, or a
resize arriving mid-scroll fits it too tall and the outer bar returns), it **subtracts the space below**
the frame rather than naming the shell's padding — which would tie this component to the app frame it
happens to sit in — and it runs **before paint**, aliased to `useEffect` where there is no layout so a
`renderToString` test does not warn on every render. The stylesheet's `82vh` stays as the no-layout
fallback, which is what an SSR render and the first paint get.

**The fixture behind the page was already in `db.CAPEX.json` and is untouched.** `whatif.slices`,
`levers`, `locked_slices` and `program` are a verbatim extract of that file's own `SLICES`/`PROGRAM`
— all five slice traces match character for character — so the ingest re-derives none of it. The one
thing it does correct is `copy.tabs`, which was extracted from an earlier three-tab build (Author ·
Run & compare · Library) and now reads the page's own two. That list is what the *React* lens renders,
so for a framed dataset nothing prints it — which is exactly how it stayed stale.

Everything from here down is the computed lens. Ingested from
`09_What if lens/whatif_vls_data.json` by `npm run ingest:whatif` into `db.whatif` —
24 candidate generators with their federal records, 4 watchable measures, 4 candidate
pools, and every string the page prints.

**It is a read-only overlay and nothing on it writes to the graph.** The copy says so
three times, so the code has to keep it: `POST /whatif/scenario` computes and returns,
storing nothing, and the saved library holds **generator ids, never figures**. That is
the whole reason computing is a call rather than a calculation — a saved scenario
re-opened next week shows next week's record, and a store that cached the numbers would
be caching an answer that quietly went stale.

**A scenario is the frame plus its cases, and that is the publishable object.** The
library used to hold one *column* each — a loose load with no question attached — and v2
of the package's prototype (`what if lenses/`) makes the whole thing the unit: an entry
carries the watched measures, the pool, and a case per admitted load. A case cannot be
saved, shared or published on its own, because a figure without its frame (what was
watched, which pool it was drawn from) is a number without a question. So Save and
Publish live once on the **scenario bar**, never on a column, and `POST /whatif/saved`
refuses a case whose load the frame excludes, a scenario watching nothing, and a pool the
package does not ship.

**Publishing a scenario records three decisions and verifies each against a pool the
server owns.** `POST|DELETE /whatif/saved/:id/publish`:

- **Readers** are the tenant's users from `db.settings`, served on the frame as
  `readers` with their persona and its `access_note`. An address outside the directory is
  refused **naming who is in it**, the same refusal the login makes for an unknown
  address — inventing a reader is inventing a user. A directory written into the dialog
  would be a second answer to "who exists", the mistake the consent screen made with its
  scope list.
- **The graph** is one of the graphs *currently published* (`reportGraphs()`, the list the
  report section reads). A scenario bound to a draft would promise figures traversed from
  content nobody published; defaulting to the newest would attribute them to a graph the
  author never picked. The publication stores the version **and** the content hash.
- **Freshness** is one of the presets `db.whatif.publishing` declares, each carrying its
  own `sentence`. `custom` interpolates `{n}`/`{when}`/`{time}` in the component the way
  `runtime.headroom.sentence` interpolates `{room}` — the words stay the tenant's. A
  weekly custom schedule with no day is refused rather than accepted and never fired.

`published_by` comes from `?as=<email>` — client-held, so the route has to be told — and
is written on **every** publish rather than only when absent, or an anonymous re-publish
keeps crediting whoever went last. A malformed `as` is a 400. The fallback is
`db.google_account.email` (**`.email`** — the seeded account is an object).

**Sharing is not access control, and the dialog says so in those words.** The directory
is real, but the role is client-held and the API serves every scenario to a caller that
names nobody; what publishing records is who is *told*. Reader-level scope is likewise
**declared, not applied** — each reader's persona note is printed beside them and no
roster here is filtered per persona, so a filtered count would claim a filter that never
ran. Same two-gate rule the report section states.

**A publish that succeeds shows a receipt, and a receipt states rather than counts.**
`PublishedConfirm` opens on the publication the write just stored and reads it back — the
cases by name, the readers by name, the graph it is bound to with the build date the live
list carries, and the freshness preset's own label and sentence. No figure appears on it,
because a publication holds each case's admitted load and no numbers; the rule is the
Published tab's, applied at the moment the decision is made. Its words are the tenant's
(`publishing.done`, authored by the ingest and required by `validateDb`) with `{name}`,
`{n}` and `{when}` interpolated where they are printed, so a label or a count typed into
the component would be a second answer to something the record already states. **It opens
on a first publish only** — its title is *Scenario published*, so showing it after
*Update publication* would announce an act that had already happened, and `first` is read
*before* the write because afterwards the entry carries a publication either way. The
address on it is **`published.link`, composed by the server** from `WHATIF_LINK_BASE` and
the scenario's slug, for the reason `DEFAULT_BUCKET` is committed in `store.js`: an
address costs nothing to commit, and composing it in the dialog too would make a copied
link and a stored link two answers to where a reader should go. The panel is exported
apart from its `Modal`, and the one act it offers beyond *Done* is *Start a new scenario*,
which returns to Authoring — where a scenario starts, because the frame is picked before
anything is admitted. Scope is named, not applied: the last row points at Audit &
Governance rather than implying this dialog filters anything.

**The publishing copy is authored by the ingest, not shipped by the package.**
`whatif_vls_data.json` predates v2 and carries no publishing block, and
`npm run ingest:whatif` rebuilds `db.whatif` wholesale — so a block seeded from a
separate script would be deleted on the next re-ingest, which is how `ingest-reports.js`
nearly dropped every report audience. It is authored inside the ingest instead, checked
there and again by `validateDb`. The subtitle is overridden there for the same reason:
the package's ends "save the ones worth keeping", which described a library that no
longer exists.

Publication lives in memory beside the library and beside graph publication itself, so a
restart forgets all three together — the only consistent thing it could do.

**Three tabs are three jobs.** *Authoring* sets the frame — which governed measures are
watched, which pool a scenario may draw from, how many columns to compare — over three
steps, each narrowing the next, so the rail is clickable backwards only. *Runtime* swaps
loads inside that frame; every figure recomputes on the server. *Published scenarios* is
a **reading** surface: what has been told to somebody, to whom, which build they see, and
when it was created as against when it was told.

**The third tab is read-only, which is why it is not part of Runtime.** Every control in
Runtime swaps a load and recomputes a figure; nothing on Published changes a scenario. Its
one act — *Manage publishing…* — hands over to the publish dialog, which lives **above the
tabs** so Runtime's bar and a published card reach the same one. A dialog per tab would be
two places to change one publication, which is how they come to disagree about what it says.

**The tab list is the tenant's, served on `copy.tabs`.** The package ships two, because
when it was written a publication had no surface of its own — so the third is appended in
`npm run ingest:whatif` the way `V2_SUBTITLE` overrides the package's subtitle, and for the
same reason: a re-ingest of the untouched JSON must still produce the tab list the page
renders. A tab hardcoded in the component would be a second answer to "what tabs exist".

**One record, one surface — the library says nothing about a publication.** A published
row in *Saved scenario library* carried a `Published · N readers` tag, a `Bound to … ·
published by …` line and a **Manage publishing…** button, all of which the Published tab
now states in full. Two surfaces reporting one record is how they come to disagree, so the
library kept only its own job: listing what is saved so it can be re-opened. A row's
publish button is therefore offered **only while publishing is still the act to be done** —
a published row has none.

Nothing was lost in the move, and that had to be arranged rather than assumed: the details
view gained **Open in Runtime**, because the library row is no longer where a published
scenario is re-opened. The runtime *bar* still states the open scenario's own publication —
that is the scenario you are looking at, not a list of them, and it is the one place the two
readings do not collide.

**A card states, and never counts.** A publication stores the frame and each case's
admitted load, never the numbers, so a card that showed a tonnage would be showing
something the publication does not hold. It names its readers rather than counting them —
capped, and the cap says so — and carries **two dates**, because `created_at` and
`published_at` date two different acts: a scenario can sit in the library for a week before
anybody publishes it. Both are on the saved row; neither is a figure.

**The tab exists whether or not anything is in it, so its empty state names the act that
fills it** — publish one from Runtime. That is different from the *grid*, which is absent
entirely when nothing is published: an empty heading over a sentence reads as a section
that failed to load.

**The connection gate replaces the lens, header chrome included.** `GET /whatif` returns
its copy whether or not a source is connected, so the page's banner ("built on the real
demo graph — 36 inbound generators") and its provenance note used to print above
`NoSourceConnected` — a claim about data one line above the sentence saying there is
none. The whole lens lives in `WhatIfLens`, rendered only when `connected_sources > 0`,
so the gated branch has no source-derived copy to leak; only `PageHeader` is common to
both, as on every other gated page. `check-docs` asserts the split both ways.

**Every step of the lens is paced, at `WHATIF_STEP_MS` (4s).** Longer than `SUGGEST_MS`
on purpose: a step here is not a list being ranked, it is a candidate load admitted into
the graph hypothetically and traversed to the generator's federal record, and an operation
that returns in 2ms teaches that the traversal is free. It covers *Resolve against graph*,
*Save frame & run*, *Save / Update saved scenario* and **every load swap in Runtime** —
each of those has a request, so each is held **on the endpoint**, and the rule the rest of
the app keeps is unbroken: a step advances when its call returns, not on a timer the client
holds. **Refusals stay immediate** — a four-second 404 on a generator the pool excludes
reads as a hang.

A column mid-traversal says so in place rather than blanking: `computing` is per column, so
*Save frame & run* switches to Runtime at once and each case reports its own wait, the way
the profiling board does.

**Two steps of Authoring are the one client-side exception, and `STEP_HOLD_MS` names it.**
Steps 1→2 and 2→3 make no request at all — picking measures and narrowing a pool are
decisions recorded in the store — so there is nothing whose return could advance them, and
the alternative to a hold is a step that completes before the reader has seen it start.
Same reasoning as the report prototype's two client-side steps, and the same hazard: the
timer is cleared on unmount, so leaving Authoring mid-step cannot fire the advance into a
component that is gone. **Back is never held** — a reader going back is correcting
something, and holding that reads as the page fighting them. The two numbers are one pace
for one flow; if either changes the other should.

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
would report "Resolved — added" and add nothing. All three read as answers. Its
`publishing` block is checked the same way and for the same reason: a preset with no
sentence prints a blank recurrence line under a control that plainly did something, a
default naming no preset opens the dialog on nothing, and a missing refusal sentence
arrives as an empty 400 — the route sends those verbatim.
`npm run ingest:whatif` checks the same references against the package and refuses to
write.

### Reports (`/reports`)

**The section is the demo package's authoring prototype, vendored whole.** `src/reports/` is a
port of `vls_demo_data_package_2026-08-10/repor code` — its own types, panes, block renderers,
dataset and stylesheet, using React and nothing else. It is not built from this app's
components, and that is the point: it was imported rather than reimplemented.

Four things were changed to make it a page instead of an app, and nothing else:

- **Its `main.tsx` and its `Sidebar` were dropped.** This app draws the sidebar, the wordmark and
  the signed-in persona; the prototype's named a *different* persona, so keeping it would have
  put two identities and two nav rails on one screen.
- **Its `ToastProvider` and `MenuProvider` wrap the page, not the app.** They are the
  prototype's own toast host and popover host, mounted at its root. At the app's root they would
  sit above every other page.
- **Its stylesheet was scoped** to `.cw-reports`, with its `:root` tokens moved onto that class.
  **This is load-bearing, not tidiness**: the original sets `*{margin:0;padding:0}`, `body`,
  `button`, `h1,h2,h3`, `table`, `th` and `td` as bare selectors, so unscoped it resets every
  antd component's margins and restyles every table on Sources, Ask, Catalog, Graph Studio and
  What-if — silently, on pages nobody touched. `check-docs` asserts every selector stays scoped,
  that the tokens stay off `:root`, and that the page mounts it in a matching wrapper.

- **Its two authoring steps are paced.** `READ_MS` (2s) holds "Read my question", and "Build the
  report" is paced per step (below), because both were instant — and an operation that returns
  instantly and shows nothing teaches that it is free, which is why the profiler, the suggesters and
  the graph build are all paced. **Client-side, uniquely**: these steps run against the
  prototype’s own dataset, so there is no request whose return could advance them. Everywhere a request
  does exist the rule is unchanged — a stage advances when its call returns, never on a timer. The
  empty-question refusal is *not* paced, and one runner clears its timer on unmount so leaving mid-step
  cannot fire into a dead component.

- **And the build says what it is doing, a step at a time.** It was one 3s hold behind a button
  that could only say "Building your report…"; it is now a dialog (`BuildRunDialog`) listing the
  five things composing a report actually does — pinning the graph, selecting the rows, ranking by
  the measure, composing the blocks, laying out the draft — at `BUILD_STAGE_MS` (**5s**) each, so
  a run takes the **list's length times that**, ≈**25s**, and no duration is written down anywhere.
  Adding a step makes the run longer, which is the point; `check-docs` reads the constant and fails
  both on a duration typed into the component and on this paragraph quoting a different number —
  the same rule the graph build's panel follows with `step_ms`. A step is paced to be *read*: each
  states the value it used, and a row that passes faster than its own sentence is a spinner with
  extra frames.

  **Each step states the value this run used** — the graph's own label, `31 of 36 inbound
  generators, narrowed by 2 filters`, the measure the read-back named, the blocks about to be
  instantiated — because a step describing building in general is a spinner with more words.
  `buildStages()` is a **pure function in `src/reports/lib/`** for the reason `connectSteps.ts`
  is copy rather than markup: the dialog renders only while a build is in flight, so an assertion
  made through the page would render it shut and pass over nothing. **A spine `selectRows` never
  selects does not get a count** — facilities, quarters and traces state the scope line instead,
  exactly as `ConfirmPane` does, because "36 of 36 inbound generators" would name a selection that
  never ran against them. Every row is listed from the first frame, `pending` until it runs; the
  running one carries the spinner and the finished ones a tick, so state is never colour alone.
  There is no Cancel: nothing is in flight to cancel, and closing it would leave the run to finish
  behind it.

**It is one of two stylesheets exempt from the `--sp-*` spacing rule**, and both are
vendored. 173 spacing declarations on a 2px rhythm here, and the graph viewer's own in
`src/graph-viewer/styles.css` — neither expressible on a 4px scale without redrawing
somebody else's design, both carried over unchanged. The exemption is a **named two-entry
list**, and `check-docs` asserts it holds nothing but those two vendored paths: nothing
authored in this repo joins it, and "vendored" cannot come to mean "inconvenient to
convert".

**A published report opens out of the Library, and the Library is the only list.** The Library already
lists every governed definition with an **Open report** button; that button hands the report id to the
host and the rendered report replaces the prototype until Back. This was briefly a switch at the top of
the page between a card grid of the five and the prototype — two lists of the same definitions, which is
two answers to "what reports exist", so the grid was deleted rather than kept beside it.

**`Open report` and `Edit report` therefore stop being the same act**, which is what their labels always
claimed: Open reads the published report — the tenant's figures, in the format its audience sees — and
Edit loads the authoring definition behind the row. The prototype learns this through one optional
callback (`onOpenPublished`, the fourth in the same shape as `actions`); absent it, the folder standing
alone behaves exactly as it did.

**Which means a report with no governance row cannot be opened.** The Library lists governed rows, so a
definition missing one is absent from the only list — `governance.ungoverned` names it above the grid with
the `npm run seed:governance` command that restores it, and that notice is now load-bearing rather than
informational.

**The reports themselves are the tenant's five, rendered.** The demo package's `07_reports/Report_N_*.html` are the
tenant's *rendered* reports; their layout is now React — crumb, heading and badge, the lead note, four
summary tiles, the facet bar, a card per block, then the footnotes — in `src/components/report/`
(`PublishedReport`, `ReportBlocks`, and the primitives in `ui.tsx`) over `reportsStore`. **Their figures
did not come across.** Every number is `reportView`'s, computed per request from `db.reports` in
`s3://contextweave.com/EPA/db.json`; pasting a rendered figure into a component is the one change that
would break the section's premise while looking right on screen, so `check-docs` asserts no component
here does arithmetic.

**The chrome is a second port's, and only the chrome.** `src/ddd` held a standalone Vite app — the same
five reports as five React components, each with its rosters compiled in as TypeScript constants, plus
seven UI primitives and a stylesheet. The *design* was adopted: `ReportShell`, `KpiRow`, `Card`,
`DataTable` and the marks (`Tag`, `FlagPill`, `DocRef`, `Chain`) are in `ui.tsx`, and its sheet is
`report.css`, scoped under `.cw-report`. The *data* was not, and neither was the shape: **one component
still renders all five**, because the reports differ in their blocks and the blocks are in the payload —
a component per report could only differ by hardcoding what its report happens to contain, which is a
stored result wearing a live report's chrome. The standalone copy was deleted rather than kept beside
this one; two ports of one report are two answers to what it looks like. Three of its parts stayed
behind, each because it would have made a claim: its `ReportChart` wrapped Chart.js, its `FilterBar` held
the chip selection in `useState` and filtered rows in the browser, and its sheet imported Google Fonts
over the network. `check-docs` asserts all of that on one cross-layer claim, because half a port is the
shape that fails silently.

**A cell's mark comes from its column, never from the shape of its value.** A compliance tier is a `Tag`,
a consent decree is the purple marker, an enforcement document is a `DocRef`, a `Y` on a trace is a
`FlagPill` and a list is a `Chain`. Keyed on the column, the register's `risk` renders as a tier on every
report that carries it; keyed on the value, any three-letter string would become one. **The document
column is the newest of these** — `db.reports.fields` carries `document`, the four decree-bound
generators carry their filename and the other 32 carry `null`, because an absence is not a filename.

Three things the HTML did that deliberately did not come across:

- **Chart.js from a CDN.** Charts are `AnswerChart` — the server emits a report's chart in the answer
  shape so one component draws both, which is why an answer and a report cannot come to disagree about
  what a bar means. Transcribing a `<script src="cdn…">` would widen the dependency surface by
  accident, through a gate that fails on any advisory at `low`.
- **Its table-only filtering.** The chips *do* filter — clicking one re-asks the report through
  `POST /reports/build` — but on the server, so the table, the chart **and** the four tiles recompute
  together. The prototype hid `<tr>`s and left its chart and its KPIs describing the unfiltered set, which
  is two readings of one screen. A re-asked report comes back `variant: 'generated'` with its tiles
  recomputed over the rows in view, and says so; clear the facets and the authored figures return as
  `written`.
- **Its `*{margin:0;padding:0}` reset and its own palette.** `report.css` scopes every rule under
  `.cw-report` and puts its layout spacing on the `--sp-*` scale — an unscoped reset is exactly what the
  vendored prototype's sheet had to be scoped under `.cw-reports` to contain, and the raw px it arrived
  with was converted rather than added to the spacing exemption: that list is for vendored code, holds
  two entries, and "vendored" must not come to mean "inconvenient to convert".

**Values on one facet are OR-ed; different facets are AND-ed.** `risk=high, risk=med` reads as "high or
medium", and adding `cd=true` narrows that — which is the only reading a reader could mean from a
multi-select chip bar. `reportFrameRows` groups the frame's filters by key to get it; a plain reduce over
the list ANDed everything, so picking High *and* Medium selected nothing and multi-select was
unexpressible. One filter per key behaves exactly as it did, so a saved frame and an export are unaffected.

**Each facet is a multi-select dropdown, not a row of chips.** The values come from the roster, so how
many there are is the data's business rather than the layout's: four states fit on one line and twenty do
not, and a control that wraps onto three lines is the layout deciding how much data is reasonable. An
empty selection **is** that facet's "All", which is also what clearing it means — so there is no separate
All control to keep in step with the selection.

**An option states the count it would leave**, from the facet the server serves, and the count is part of
the option's label rather than a rendered node so the selected tag carries it too. `maxTagCount` is a
number rather than `responsive`: that mode measures the control, so before layout it collapses every tag
into "+N …" — which is what the first paint shows and what a render test sees.

**Alignment is declared, not sniffed.** A report column states its `kind`, so a penalty column is
right-aligned because the field dictionary says it is numeric — never because every cell in this slice
happened to parse as a number, which is how one report right-aligns a column another leaves ragged.
Both the header and the cell read that one flag.

**A custody chain renders in order.** A trace's transporters are a list, joined with arrows: "an order
laid into a cell reads as a set", and a comma is exactly that mistake.

**The store keeps the requested id beside the report.** Opening one report and then another before the
first returns would otherwise leave the slower reply on screen under the newer heading — one report's
tiles below another's title, which reads as data rather than as a race.

**And it is still one route.** `/reports` is one address; the section that had a page per report was
removed when the prototype was vendored in, and re-adding five URLs would undo that as a side effect.
Which report is open is `openId` in the store.

**The authoring prototype is otherwise unchanged and still there.** It owns its three tabs and draws its
own bundled sample data everywhere except that one button, and only one of the two is mounted at a time —
it installs a toast host and a popover host that portal to `document.body`, and two of each would leave a
menu opening against the wrong one, which is how Delete came to look like a dead button once already.

**The gate is the only thing on the page that is real.** The section opens once a graph is
published — the same precondition Ask and the What-if lens have, stated by the same
`NoPublishedGraph` component — and `GET /reports` is called for `published_count`,
`built_count` and `draft_count` alone.

**Everything the prototype shows is its own demo dataset** — now `db.reports_prototype`, inside
`s3://contextweave.com/EPA/db.json`, served by `GET /reports/prototype` and hydrated into
`src/reports/data.ts` before the prototype renders. Edit the figures in the bucket; no rebuild. It was
a document of its own (`reports_prototype.json`) until that was folded in; what the move had to
preserve is exactly this sentence — it is *served*, so the bucket still decides what the Authoring tab
shows, which is the whole reason it stopped being a bundled import.

**That route is declared before `/reports/:id`, and the order is load-bearing.** That matcher is
`/^\/reports\/[^/]+$/`, so declared second the request would come back as `no report "prototype"` — a 404
naming five report ids, none of them the thing asked for. Same hazard as `graph-studio/:useCaseId` and the
canvas route.

**The module's exports are `let`, and that is what makes one fetch reach every consumer.** ES module
bindings are live, so `hydrate` assigns and the twelve importers see the new values without any of them
changing. It holds only because **no consumer reads them at module scope** — every one is inside a
component or a function, which was checked before the change. The empty defaults are not a fallback:
nothing renders against them, they exist so a stray render during the fetch cannot throw on
`undefined.map`. `isHydrated` is how the page knows, and the page tells three states apart — unreachable,
malformed (naming the file), or arrived — because an empty Authoring tab reads as a section that failed
to load. `validateDataset` still walks the payload and now guards a network read rather than a typo.
Nothing on it reads `db.json` or calls `/reports*`, and nothing published in it leaves the
browser. The prototype says so itself. Wiring it to the API is a later job, and the API is
waiting for it: eight `/reports*` endpoints, `db.reports` still required, both ingest scripts,
and `client.ts`'s typed report layer — which currently has one caller reading one field.

#### The API the prototype does not use yet

#### A report is a question re-asked, not a stored table

`db.reports` stores **no result**. It holds four rosters (36 inbound generators, 5 comparator
facilities, 14 quarters, 5 manifest traces), a field dictionary, the assumptions a report is
read under, and each report's *definition*. Every figure — each chart's series, each table's
order, every count on a card — is computed in `reportView` per request. Arithmetic on a measure
in a component would be a second source for it.

**The ingest reads two files per report, because they answer two questions.**
`report_authoring_data.json` is the data and the five report definitions (`starters` — a
question, a spine, and its blocks). Each `Report_N_*.html` is the *rendered* report, and its
heading, subtitle, badge, lead note, four summary tiles and footer are copy the tenant wrote
which the JSON does not carry. They are joined on the starter's own `report_tag`
("Report 2" → `Report_2_*.html`), never by position.

**The authored tiles are checked against the roster, and a mismatch refuses the write.** A tile
transcribed from a rendered page is exactly the figure that goes quietly stale, so
`npm run ingest:reports` recomputes 17 of them — 36 generators, 15 with enforcement history,
1,200 manifests, 27,311 tons, 4 under a decree, $540k combined penalty — and fails naming both
numbers when one disagrees. `check-docs` re-checks the same identities against `db.json`.

**A report's scope is part of its question.** Four ask about every inbound generator; the
consent-decree report asks about the four under a decree, and its scope is applied in
`reportView` rather than baked into a copy of the roster. The ingest refuses unless a scoped
report selects exactly what its own tiles count, so `4 of 36` cannot drift into `36 of 36`
while the tiles still say four.

#### Five block kinds, and the payload states what each draws

`chart`, `table`, `facilities` (the scorecard, its subject row marked), `quarterly` (a trend
plus its detail) and `traces` (custody chains — a manifest's transporters are *ordered*, and an
order laid into a cell reads as a set). A `kpis` block is dropped at ingest: the tiles it names
are already the report's own, with a label, a unit and a tone a key list cannot express.
`validateDb` refuses a block whose measure or column its spine does not carry — a blank column
reads as "no data" rather than as a broken reference.

Charts are emitted in **`AnswerChart`'s payload shape**, so one component can draw an answer and
a report and there is no second set of rules about what a bar means. Two consequences the server
already applies: the package's `bar`/`column` distinction collapses by row count — six rows or
fewer are drawn as columns, a long register as horizontal bars, whatever the block asks for —
and its one grouped chart becomes a `grouped` form with a legend, because one hue per magnitude
is the rule. Rows carrying nothing are dropped rather than drawn as zero-length bars, and the
note says how many: 22 of the 36 generators have never been penalised, and **no cap is silent**.
A **scoped** chart on the register also carries a `companion` — the split of the whole register
by compliance status, whose 79.3% is the figure the tile beside it states, drawn as a ring.

Column headers for the three rosters the field dictionary does not describe live in
`REPORT_LABELS` in `server.js`. They are headers and nothing else, and `check-docs` fails if a
column reaches a table with neither a field label nor an entry there, because the alternative is
a header reading `gen_state`.

**What the dataset cannot answer is in the payload.** Waste code, transporter and daily volume
are `avail: false` in the field dictionary, each with the package's reason — "where is the
waste-code breakdown" is a question a UI should answer rather than answer by omission.

#### The frame is the question, in values

`{ report_id, use_case_id, scope, measure, horizon, filters }`. `POST /reports/build` computes a
report from one; `reportView` returns the frame back **in values** beside the assumption labels,
so a chip can re-ask the report with the same scope, measure and window plus one filter rather
than recovering a scope from its printed label.

- **A report is asked of a published graph.** `use_case_id` is part of the frame and a frame
  naming one that is not live is **refused, naming the ones that are** — defaulting to whatever
  is newest would attribute the figures to content nobody picked. `graphs` on the payload lists
  every published graph with its version, hash, size and publisher.
- **`variant` is the honesty of the flow.** `written` when the frame is the one the report was
  written for, so the authored tiles still describe it; `generated` otherwise — and a generated
  report's tiles are recomputed from `summary_catalog` over the rows in view and carry "computed
  for this frame". The tenant's authored figures are never returned against a frame they do not
  describe. On a spine the Catalog does not cover (facilities, quarters, traces) a generated
  report states no summary and says why.
- **Facets are per spine**, and the frame validator asks the same `reportFacetsFor` the facets
  came from, so a filter a UI could offer cannot be one the API refuses. The register's are
  declared (`slice_default` + `fields.filterable`); the other three are derived from the column
  that distinguishes their rows — a facility's `role`, a quarter's `year`, a trace's `flag`
  (three columns, one control).
- **The horizon is declared, not applied.** Nothing in these rosters is sliced by time — the
  register carries a generator's whole federal history and the quarterly roster is the full
  window — so applying one would invent a filter and stating one silently would claim a filter
  that never ran. It is stated on the read-back and again in the built report's caveats. Scope,
  measure and facet filters all really apply.
- **`POST /reports/read` returns a sentence and a frame, never figures**, and is **paced**
  (`SUGGEST_MS`) because reading a question back is the one act here that reads as a model call.
  Picking a standard report by id is neither matched nor paced. Matching reuses `askTokens` and
  `ASK_MATCH_MIN` with the same tie rule as `matchAskAnswer`, so two surfaces cannot disagree
  about whether a sentence names something; a miss is read as the register and **says it was not
  recognised** rather than presenting a guess as an understanding.
- **`POST /reports/build` is not paced**: it is a read over the rosters, like a What-if scenario.
- **`summary_catalog` is ten tiles expressed as data** — a label, a tone, the field it reads and
  how it aggregates — because a closure cannot be served. `server.js` implements the six
  aggregations and three formats it names, and the ingest refuses one it does not.

#### Exporting a report — the one place a figure is written down

`POST /reports/export` builds a report and writes it to S3 as a **file somebody can be sent**:
`html` or `csv`, under `s3://contextweave.com/EPA/exports/<report_id>-<timestamp>.<ext>`. The
renderers are `backend/reportExport.js`.

**It is a snapshot, and never a cache — the distinction is the whole design.** Everything else in
this section re-asks: `db.reports` stores no result, and `GET /reports/saved/:id` rebuilds from the
frame so a stale figure cannot be served as a current one. An export is the opposite act on
purpose, because somebody needs to send this report to a person who does not have the app. What
keeps the rule intact is that **nothing reads an export back** — no route fetches `exports/`, and
`check-docs` asserts the absence. The moment a read path points there, the section has a cache with
none of a cache's honesty about staleness.

So the file carries what makes a written figure checkable: **when it was generated, the frame it
was generated under, the row count in view, and the published graph that answered it**. A number
detached from those is a number with no question attached.

**The reply carries a presigned URL, and the link is the permission.** A private bucket makes an
export unreachable to exactly the person it is for. Anyone holding the link can read that object
until it expires, and nothing can revoke it early — so it is a *share*, not an entitlement, which is
the distinction this section draws everywhere else. `REPORT_EXPORT_LINK_MS` (1 hour) is reported
back as `expires_in` rather than implied: a link that has quietly stopped working reads as a broken
report.

**No PDF, and that is a dependency decision rather than an omission.** Server-side PDF means a
headless browser — ~40 transitive packages and a Chromium download — through a gate that fails on
any advisory at `low`. The HTML carries a print stylesheet instead, with `page-break-inside: avoid`
on every block, so *Print → Save as PDF* produces the same document. If a real PDF pipeline is
wanted it should be argued on its own terms, the way d3 was.

**And an opened report has an `Export PDF` button, which is that decision made usable.** It sits on
`PublishedReportPane`'s bar beside *Back to Library* and calls `window.print()` — the browser is the
renderer, and `check-docs` asserts no headless-browser package has arrived by the back door. Offered
only once the report is on screen: printing mid-fetch hands the reader a page of chrome with a spinner
where the figures go. The hint lives in `src/data/reportExport.ts` because a `Tooltip` portals out of
`renderToString`, so inline it could not be asserted on — the same reason `sourceActions.ts` exists.

**What prints is the report, and the mechanism is `visibility` rather than `display`.**
`PublishedReportPane.css` hides `body *` and reveals `.prp, .prp *`, then lifts the subtree to the page
origin. Hiding the app's chrome *by name* would need a list of every wrapper — the sidebar, the header,
the tab bar, and whatever is added next — which is wrong the first time one appears, silently, on a page
nobody re-printed. Hiding everything and revealing one subtree needs no list, and it only works because
a hidden element still takes its space: `display: none` on a body child would take the report down with
it. The report's own paper rules are in `report.css`, still every-selector-scoped under `.cw-report`,
because a bare `.card` or `table` rule inside a print block would restyle every antd table in the app
the moment anybody printed any page.

**This is the client-side twin of `POST /reports/export`, not a replacement for it.** That endpoint
still renders HTML and CSV, still writes to the bucket, and still has no caller — and it **requires
S3**, so on a server reading local files (`S3_BUCKET=off`) it answers a 400 saying so. Printing works in
both configurations, which is why the PDF path is the one that got a button first.

Three rules the renderers keep, each guarding a failure that is silent:

- **Every tabular block is emitted, not just the first.** A report holds several; exporting one
  would be a silent truncation of the rest.
- **CSV is RFC 4180 quoted.** A comma inside a facility name splits the row and shifts every later
  column by one, and nothing errors.
- **The HTML is self-contained and escaped.** It is opened from a private bucket by a remote
  browser, so an external asset simply fails; and an unescaped `<` ends the document early, taking
  the rest of the report with it.

`npm run verify:export` checks all of this offline — the renderers are **pure**, which is what makes
them assertable without a bucket, a network or a published graph. It reads the block kinds out of
`reportBlock` in `server.js` rather than listing them, so a kind added there and not handled in the
exporter fails the build instead of exporting as nothing.

**Nothing calls it yet.** Like the other `/reports*` endpoints, this one is waiting for a caller —
the vendored prototype does not talk to the API. Wiring a button means editing vendored code, which
is a separate decision.

#### A dataset can ship rendered reports instead of computing them

**CAPEX's reports are documents; EPA's are questions.** Everything above describes EPA: `db.reports`
stores no result and every figure is computed in `reportView` per request, because a report there *is* a
question re-asked of a published graph. CAPEX ships three finished HTML documents — `src/Capex/Report/`,
2.5 MB each, standalone pages with their own `<head>`, theme and inline scripts — and no roster to
compute from. So they are served as documents and every figure stays inside the file. Transcribing one
into a component is the single change that would look right on screen and break this section's premise.

**`npm run ingest:capex` reads the metadata out of the documents.** Each file embeds the prototype's own
report registry, so the title in the Library is the title the report gives itself — *Variance Report*
v13, *Project 360* v15, *Rate-Case Filing Calendar* v7 — along with the subtitle, category, author and
refresh sentence. Nothing is typed into this repo, and `check-docs` asserts no ingested title appears as
a literal in the component: a transcribed title is the small version of a transcribed figure, and it goes
stale the first time a document is re-exported. The ingest **refuses to write** on a missing field or an
unknown state rather than producing a row the Library renders as `undefined`.

**The three files are 99.9% one document.** They differ only in a trailing script setting `REPORT_ID`
(`rep_q_variance`, `rep_proj_360`, `rep_pis_calendar`), which is what the ingest reads to tell them apart
and what it looks the registry entry up by. That is also why all three are carried rather than one
parameterised copy: the id is baked into the file, and rewriting somebody's 2.5 MB export to inject a
different one is a fragile dependency on its internals.

**The publish gate applies to them, and it did not always.** The documents rode on both branches at
first, on the reasoning that a gate about *questions* should not apply to a finished artefact: a CAPEX
report asked nothing of a graph, so withholding it enforced a precondition it did not have and left the
section empty for a dataset that ships three reports. **Reversed on request** — *"report and whatif lens
should be activated after publishing the graph studio for the capex data"* — because that argument
produced a **section** where what was wanted is a **sequence**: the graph is released first, and the
surfaces that read the tenant's data open after it.

So the shape is the one this file had before documents existed. Nothing published means empty
collections and `published_count: 0`, with `built_count` and `draft_count` beside it because "publish
the build you have" and "finish a draft" are different fixes; the documents ride the **open branch
only**, and `ReportsPage` tests one number (`publishedCount === 0`). The governance view went back with
them: it was served while the gate was closed *because* the documents were, so that exception had no
remaining purpose. One gate, one branch, one number — for a dataset whose reports are computed and one
whose reports are documents alike.

**A gate has to be satisfiable, so CAPEX ships the brief that names its own graph.** It shipped 442
canvas nodes, 908 edges, seven must-review rows, a pivot and five sanity checks — and an empty
`graph_use_cases`, so Graph Studio listed nothing, no build could start and no version could exist:
the two sections could *never* open, which reads as a broken page rather than as a precondition.
`npm run ingest:capex` writes one **committed** brief, `uc_capital_programs`, and every field of it is
derived from the dataset's own use-case template — the id, the name, the description as the business
need, and the 7 personas, 23 KPIs and 13 hero questions it names by id, each recorded `source: 'ai'`
because that is the provenance the wizard's suggesters record when they draft from a template. **Its
domain is derived too**, from the domains its own members name (`capital-projects`), because a domain
picked in the script would be a claim the package never made. It names **no source**: a registration
lives in the server's memory, so any id written here would dangle until somebody connects it. And the
seed is an **upsert** — a saved brief survives a restart precisely because it is the user's work, so
replacing the collection would delete every draft in it.

**What remains manual, and it is the product's own flow.** Building, reviewing and publishing all live
in memory, so after each restart: open the graph in Studio, **Build** (31 substeps ≈ 1m 33s), settle the
seven review rows and the pivot, then publish the version — and both sections open. Doing exactly that
is what found the crash recorded in `docs/REGRESSIONS.md` under a null canvas confidence.

**They are framed, not inlined.** `DocumentViewer` puts each in an `iframe`. Injecting the body would
drop the `<head>` the report *is* and put its selectors in the app's tree — the problem that forced
`.cw-reports` on the vendored prototype's sheet, with live script on top. The frame is a real boundary,
and what it costs is stated rather than glossed: **the app cannot see inside**, so a button *within* a
document reaches nothing here, and the document fetches its own webfonts from the network. Printing is
delegated to the frame (`contentWindow.print()`), so a document prints as its own page.

**And a framed document is held until it has opened its report.** Each file is the whole prototype app
with one report on top, and the parts that make it *a report* are the **last** lines of a 2.6 MB file: the
style that hides the app's own sidebar and topbar, then the script that signs in and calls `repOpen`. A
browser paints as it parses, so that shell — and the Knowledge-graphs screen the document opens on — is on
screen for as long as the rest of the file takes to arrive. Reported from use: **Open report** showed
somebody else's app for a beat first, which reads as the wrong report having opened. It cannot be fixed in
the document, whose `_meta` forbids hand-edits, so `DocumentViewer` hides the frame and says which document
is opening and why the frame is empty. **Hidden with `visibility`, never `display: none`** — a frame that is
not in the document is not loading, so there would be nothing to wait for and nothing for the seamless fit
to measure.

**The reveal is observed, not timed**, which is the rule the rest of the app keeps: `go('reports')` puts
`on` on the document's own `#v-reports`, so that class *is* the report having been opened. A document with
no such shell — the What-if lens is one page, not an app — is ready once it has loaded, and a frame this app
cannot read is ready at once, because a frame it cannot read is one it cannot wait on. `REVEAL_CAP_MS` (15s)
is the other half: a re-export that renamed that view would otherwise hold a spinner over a report sitting
there fully drawn, so the failure is a **slow open and never an empty frame**. `check-docs` asserts both
halves — the watcher reads that id, and the document really carries it and really starts on another view.

**A frame's own `about:blank` is a *complete* document, and that is the trap this hold fell into first.** A
frame carries that placeholder from the moment it is mounted until the first byte lands, and it reports
`readyState: 'complete'` — so the "no shell, so ready when loaded" fallback fired on the first tick and
revealed the frame just in time for the real document to paint its shell into it. **It showed on the first
open only**, because a second one is served from cache and the real document is already parsing before the
first tick: a cache is not a hold, and "works the second time" is the signature of this class of bug.
Arrival is therefore checked (`inner.URL !== 'about:blank'`) and the fallback is gated on it — and the cap
is counted **from arrival**, so a slow download cannot spend an allowance that exists to cover a renamed
view. A document that never arrives keeps the wait, which is the true thing to say about it.

**There is one copy of each file, and it stays in `src/Capex/Report/`.** `src/data/reportDocuments.ts`
resolves a filename to a URL through `import.meta.glob('../*/Report/*.html', { query: '?url' })`. Copying
them into `public/` is the obvious alternative and was rejected for one reason: a second copy of a 2.5 MB
re-exported document is a whole report that can go stale silently. The glob is written per dataset folder
rather than naming CAPEX, so a second dataset shipping documents is a folder drop plus an ingest run. A
filename the bundle does not carry resolves to `null` and the viewer **says which files are here** — a
guessed path would load the SPA's own `frontend/index.html` and render the app inside the report frame.

**There is one Library UI, and CAPEX uses it.** A CAPEX-only grid of document cards existed briefly and
was removed: two grids of the same definitions is two answers to "what reports exist", which this section
refuses everywhere else. So CAPEX renders the **vendored prototype** exactly as EPA does — the lifecycle
chip bar, the cards, the four acts, the *Author a report* wizard — over CAPEX's own governance rows, which
its document ships complete with title, question, state, version, author, category and schedule.

**Which needed the governance view served while the publish gate is closed.** It is `null` there
normally, because nothing is governed until a graph is published; a dataset whose reports are documents
has a library either way, so `GET /reports` includes it when `documents` is non-empty and only then. That
is a wider audience for an already-computed view rather than a looser gate — EPA still gets `null`.

**Open opens whichever kind of report the row is.** The prototype hands over an id; the host matches it
against `documents` first and falls through to the computed report. Both collections carry `report_id`, so
the match is exact rather than a guess on the title.

**Edit loads the report into the authoring wizard, editable, with a Save — the same act it is for EPA.**
That needs an authoring **starter** behind the row, which `npm run ingest:capex` now writes: one per
report, keyed to its slug so `starterForTag` resolves, carrying **the dataset's own title and question**
read from its report definitions. Two weaker answers were tried first and both were reported: withholding
the button, and framing the static authoring page — a page with no editing and no Save is not Edit.

**What a starter cannot borrow is the block vocabulary of the renderer that produced the HTML.** CAPEX's
report definitions are written for that renderer — `spine: "projects"`, `figRow` blocks, its own scope
and measure ids — and the authoring prototype has a different set of blocks. So a starter carries the
dataset's own title and question with the blocks this prototype draws, and **the figures inside the
editor are the authoring fixture's**, exactly as they are when EPA's reports are edited: the Authoring
tab has always drawn its own sample data and says so. Nothing about a *published* CAPEX report changes —
Open still frames the real rendered document, and its figures stay inside it.

**And the editor draws that dataset's own rows, which it did not at first.** The starters took the
prototype's block vocabulary because the engine was written against EPA's roster — `selectRows` returned
`Generator[]`, `scopeSet` switched over three EPA scope ids, `fmt` knew that `penalty` is money, and
seven closures were the summary tiles. So a CAPEX author composing a report was offered *all inbound
generators*, *penalty exposure*, and filters for State / Compliance risk / Consent decree, over 36 rows
that were EPA's. The note here used to say re-basing would be "a rewrite of the vendored engine's core
rather than data added to it, and should be argued on its own terms" — **the argument is that the
dataset already ships the fixture**, and what was left was one bounded generalisation.

**`reports_prototype.row_model` is that generalisation.** Every literal above is now a declaration per
dataset: which column names a row, which carries its state and how each value tones, what each scope
option admits, which columns may be ranked, which tiles exist and what they aggregate, how each column
prints. `src/reports/` reads that and nothing else — `check-docs` asserts the EPA column names are gone
from `select.ts`, `format.ts`, `blocks.ts`, `TableBlock` and `ChartBlock`, **through `codeOnly`**,
because each of those files' comments quotes the code it replaced.

**Each failure it prevents is silent, which is why the model is required rather than defaulted.** A
column another dataset does not carry renders as a blank cell; a scope with no rule fell through to
`default:` and quietly covered every row; a tile over a missing column reads `0`; a chart ranking by an
absent column sorts every row to zero. Four answers, none of them an error. So a missing rule now selects
*nothing*, both validators refuse a document without a model, and each one is checked against the rows it
claims to describe.

**CAPEX's fixture is the package's own, and its `_note` says what it is for**: *"the seven-project
fixture the screen previews against … deliberately NOT the CAPEX portfolio: an author composing a report
should see a preview small enough to check by eye."* `npm run ingest:capex` builds the whole prototype
block from it — the seven projects with their authorized, committed and projected figures, the dataset's
own field dictionary, its three assumption slots, its filter columns, and its personas as the audience
pool. The four **derived** columns (variance in dollars and per cent, per cent of envelope spent, and the
status banding) are *computed from the fixture's own `derivationRules`* and checked against the `derived`
block it ships; a disagreement refuses the write, and `check-docs` re-checks the written document. Reading
`derived` directly would have been transcription, and it is the same rule that recomputes 17 report tiles.

**A measure option's value is the column it ranks by**, which is how EPA's have always worked (`value:
'penalty'`, label "penalty exposure"). CAPEX's are written as baselines — envelope, working forecast, MTP
— so the ingest matches each to the column that answers it and **drops the ones it cannot**, stating
which: the fixture carries authorized, committed and projected, so *against the authorized envelope* is
computable and the other two are not. Offering a control that silently changes nothing is the fault this
repo refuses everywhere; inventing the columns would be worse.

**Three block kinds, because this fixture is projects and nothing else.** `facilities`, `quarters` and
`traces` are EPA's rosters, so CAPEX's are empty — and empty is permitted **exactly when `row_model.
blocks` does not list the block that draws them**, in both validators. A roster left empty behind a block
a starter can still add is a panel that renders nothing.

Nothing about a *published* CAPEX report changes: Open still frames the real rendered document, and the
figures inside it stay inside it.

**`npm run seed:prototype-model` authors the primary's model**, transcribed from the code it replaced
rather than chosen, so EPA's behaviour is exactly what it was. It refuses to write a model naming a
column its fixture does not carry — which is the blank table the model exists to prevent, one layer down.

**Two things had to move with the starters, both found by a validator rather than guessed.** The
dataset arrived carrying the primary's five starters *and* four demo shelf rows built on them, so
swapping the starters left those rows naming ids that no longer existed — which the prototype's **own**
validator refuses at hydration, so the section would not render at all. The shelf is emptied instead: it
is the prototype's own fiction, and hosted it starts empty anyway because a governed Library is present.
That in turn needed the server's `validatePrototype` to stop requiring `library` non-empty — the client's
validator already permitted it empty in as many words, and **two validators disagreeing about one field
is worth resolving rather than working around**, since the only way to satisfy both was to invent four
demo reports.

**A CAPEX row offers all four acts, and getting there took two corrections.** `GovernedCard` offered Open
and Edit only where an authoring *starter* backed the row — right while every report was one of the
prototype's own definitions, and wrong for a rendered document, which has none. `hostOpenable` is the host
saying "I can render this id", and it enables **both**, because the host is what knows which surfaces it
has; `App.openGoverned` hands such a row straight back rather than trying to load a starter that does not
exist. **Edit then opens the dataset's authoring document** — a rendered report is a finished artefact, so
"edit" cannot mean changing it in place, and what it can honestly mean is the dataset's own account of how
a report is composed. Withholding the button instead was tried first and reported as a bug: a Library with
two of its four acts missing reads as a broken card rather than as a permission.

**The other correction was the permissions themselves.** CAPEX's report access was *derived* from its
document's `may_author`, which looked principled and was wrong: that document marks its Platform Admin
"No access yet", so the persona that administers the section arrived unable to edit or delete a report —
Delete simply absent from every card. `may_author` is about **data scope**, and these three are about which
*controls* a row offers; using one to decide the other conflated two gates this app is careful to keep
apart. Every CAPEX persona now starts with all three, and narrowing is a decision made on
**Settings → Report View**, which is what that tab is for.

**Share and Delete are the governance routes, unchanged.** They act on the governance row, which is the
single audience record for a report. A pair of document-specific routes was built and then removed for
exactly that reason: two audience fields for one report is two homes for one record.

**Three things are hidden by the frame rather than by editing the documents**, and they are `FRAMED_CSS`
in `DocumentViewer` — injected on load into *every* frame, seamless or not, because the documents' `_meta`
says *"never hand-edit this file — change the generator and rebuild"*: an edit would be lost at the next
export and silently return, while a rule applied by the frame holds for whatever version is dropped in and
keeps the file byte-identical to what the generator produced. It is a style only — nothing is removed from
the DOM and no script is touched.

- **The mock-API pill** (`.apiFab`), a floating badge toggling a log of the document's own mock calls: a
  prototype affordance, noise inside an app with its own API.
- **The embedded *Ask about this report* surface** (`.repBlock:has(.embedAsk)`), a question box bound to
  the document's own mock data inside an app whose Ask page queries the published graph. Two ask boxes on
  one screen are two answers to where a question goes, and only one of them reaches this tenant's data —
  the same decision as dropping the report prototype's sidebar and persona when it was vendored. The whole
  block goes rather than its input: `.repBlock` is the block frame and carries the *"Ask about this
  report"* heading, so hiding the body alone would leave a titled empty panel. `:has()` is what reaches
  from the body up to the frame; where it is unsupported the rule is inert and the surface returns, which
  is a visible fallback rather than a broken page.
- **The document's own *View* chip group** (`.filtBar .fgroup.vt`) — and this one is a **defect in the
  export rather than a control anybody chose**. The fixture serves `viewTypes` as plain strings
  (`["Category", "Region", …]`) while the document's own `repFilterBar` reads `t.label`, `t.id` and
  `t.enabled` off each entry, so every chip renders unlabelled and, `enabled` being undefined, locked:
  four blank pills that can be neither read nor clicked. The real fix is a generator that serves objects;
  hiding them is the honest half of that. The parameter chips beside them — Region, Executive category,
  Period, Lifecycle phase — are untouched and still work.

`check-docs` asserts each rule **and that the documents carry the class it names**, because a selector
naming a class no document has is inert, and inert looks exactly like the thing having been removed. It
also pins the `viewTypes` mismatch itself, so when a re-export starts serving objects both halves fail
together and the rule that hides them can go.

**Report View permissions apply exactly as they do to a governed row**, through the same
`reportActionsFor`, with a withheld act being an absent handler rather than a disabled button. **Share is
not gated**, because it edits the *audience* — which Settings deliberately excludes from the three acts,
since that record belongs to Audit & Governance.

#### Publication is the only gate

A report is asked of the published graph, so that is the whole precondition — nothing published
means empty collections and `published_count: 0`, with `built_count` and `draft_count` beside it
because "publish the build you have" and "finish a draft" are different fixes. **A connected
source is deliberately not a second gate**: publishing is already downstream of having something
to build from. `connected_sources` still rides on every payload and gates nothing. The What-if
lens shares the one rule. Publication lives in memory, so a restart closes the gate again.

Every report names the published content that answered it (`graph`: name, version, `sha256`) in
its footer, and `publishedByFor` supplies who published it.

#### A saved report is a question, not a result

`POST /reports/saved` stores the frame and the question through `commitDb`, so it survives a
restart — the same asymmetry that keeps a graph brief and drops a registered source — and stores
**no figures**, so `GET /reports/saved/:id` re-asks it. A row whose graph is no longer published
still answers and says so in a caveat rather than claiming live content; with publication in
memory that is the state after every restart.

**Who saved it is told, never guessed.** `saved_by` is the browser's own signed-in address,
validated as an email and refused otherwise, because the identity is client-held and the server
has nothing to look it up from — the rule the consent callback established. Saving without a
name is a 400: naming is the one thing the app must not decide.

**`viewer_roles`** names which of the login's roles a saved report is meant for, stored as role
ids so a renamed role leaves no stale label. It defaults to every role, an empty audience is
refused, and an unknown id is refused naming the pool. `GET /reports?as_role=…` then serves a
caller only the rows their role is named on. **It is not access control**: the role is
client-held and the login authenticates by shape, so it narrows what a reader is shown while the
API still serves every row to a caller that asks without a role. Any UI built on this must say
so in those words.

#### Governance is authored; everything about it is computed

`db.reports.governance` — seeded by `node backend/scripts/seed-report-governance.js` — holds only the
decisions: state (`published` · `pending_approval` · `blocked` · `archived`), version, author,
category, as-of, schedule, approval, and which personas each definition's audience names. Every
number and every cell is computed in `reportGovernanceView` per request: the chip counts, the floor
line, `parameterized` (a spine with facets), the entitlement matrix, the audit rows and the publish
checks. A count taken from its own filtered array would be a second answer to "how many are
published".

**All five definitions are seeded `published`, so three chips legitimately sit at 0.** The pool
declares four states and the data currently uses one; a lifecycle chip at 0 means "nothing is
blocked", which is news rather than a broken map. Changing a `status` in the seed is the one-line
way to populate the others.

**`db.reports.access_requests` is gone**, with the pending-approval state it served. It was a required
nested key; nothing writes one and nothing reads one now, and a required key for a feature that does
not exist fails a boot for no reason a user could act on. An older `db.json` may still carry it — an
extra key is harmless, and `npm run seed:governance` drops it.

**A state is declared once, in `governance.statuses`, and everything reads it from there** — its
key, the label a chip and a card print, and the `tone` both tint themselves with. `server.js` used
to keep a second tone map beside it, which is how a state ends up `warn` on a card and `neutral` on
the chip counting it; `reportStatusTone` reads the pool instead and `check-docs` fails if a second
copy comes back. `blocked` is not `pending_approval` with worse manners — pending waits on a
person, blocked names a precondition that fails, so it carries `crit`, the row says which publish
check it fails, and both states are *current*: only `archived` is not.

**A state also needs its own entitlement cell.** The chain in `reportEntitlementCell` ends at
archived, so a state added without a branch falls into "entitled - archived, opens by link only" —
which tells an audience it can open something that was never published. `check-docs` asserts every
declared state but `archived` has a branch naming it.

`governance` is **required**, and nested for the reason `graph_studio.sanity_checks` is: losing
it does not throw, it just renders as a section with nothing to govern. `validateDb` refuses it
at boot; the seed refuses to write a row naming a report or a persona that does not exist. It also
checks **across** the block: a `status` the state pool does not declare has no label, so the card
prints the raw key, and it matches no chip, so the row is reachable only under "All current" while
every other chip under-counts by one. Neither throws.

#### The Library is one list, and the chips count it

`GET /reports` carries the whole governance view and `client.ts` types all of it, but only two
things reach the screen: the publish gate, and the Library's chip bar — `All current` plus every
declared state, each with the count the server computed. `ReportsPage` passes
`governance` into the vendored prototype, `App` holds which state is selected, and `LibraryPane`
renders the bar and the governed definitions in it. The prototype **declares the payload's shape
itself** (`Governance`, `GovernedRow`, `GovernanceState` in `src/reports/App.tsx`) rather than
importing `client.ts`'s types, the same as `GraphOption`: absent the props it is exactly the
standalone prototype it was, chip bar and all.

**One grid, both kinds of card.** The governed definitions and the reports saved in this session were
two grids under two headings; they are one list now, and what separates them is on each card
(`GovernedCard` / `SessionCard`, extracted so both stay assertable) rather than in a heading above a
group of them. A reader looking for a report should not have to know which collection it landed in.

**That merge is what moved the chip counts off the server.** It cannot count rows nobody has told it
about, so a served count beside a list holding session reports would be counting something else. The
*pool* is still the server's — keys, labels, tones, order — and the count comes from the same
`inState` the grid filters with, declared once, so a chip cannot say five while the grid shows six.
The server still computes its own counts for the Operations tab, over its own rows.

**A session report is not folded into the tenant's Published chip.** It has been submitted to nobody,
so it answers to a `SESSION` chip — *Saved here*, present only when something is in it — while its own
Draft/Published pill still says what it is locally. Counting it as Published would be the one claim
this section exists to avoid.

**A published report's name is how its audience refers to it, so two cannot share one.** `nameProblem`
is the single rule, checked across the whole list (both halves — they sit in one grid), and used by
both writers: the publish dialog checks as you type, and Save draft checks before it writes. Only
*published* names are reserved (two drafts may collide; publishing is where it is resolved), case and
surrounding space do not make a name different, and a report never collides with itself.

**The card states no approval.** `approval` is still on the payload and the Operations tab's audit rows
and publish checks still read it — what was removed is restating it in a list whose job is to say what
each report is and who can see it.

**The publish dialog asks three things, and none of them is an approval.** It used to ask for a name
and then say *"A Domain Architect approves before the audience sees it"* — a sentence the code stopped
keeping when publish → approve → activate collapsed to publish/unpublish. The report went live
immediately either way, so the dialog was promising a sign-off nothing performs. It now asks for:

- **a name**, kept because a published report's name is how its audience refers to it and `nameProblem`
  reserves it across the whole list;
- **who can open it** — picked as *people* from `governance.people` (the tenant's users from
  `db.settings`, served with their persona), and stored as **`viewer_roles`**, because that is the
  audience model the entitlement matrix and `?as_role=` already read. A directory written into the
  component would be a second answer to "who exists". There is no invite: the four personas are the
  pool, and offering to invite an address would promise a reader this app cannot create;
- **how fresh the figures stay**, from `governance.publishing.freshness.presets`, each carrying its own
  `sentence` so the line under the select is the tenant's words.

Beside each reader is that persona's **declared** data scope — the same `data_scope` row gate 2 renders
— and its masked columns. **Stated, never counted.** A figure like "sees 32 of 36 generators" would be
the dialog claiming a filter no roster here runs, which is the rule the Operations tab's own note
states. The gate-1 caveat is on the dialog in the required words: sharing narrows who is *told*, and
it is not access control.

`governance.publishing` is authored by `npm run seed:governance`, which **refuses to write** a preset
with no sentence, a default naming no preset, a lead that claims an approval step, or a caveat missing
"not access control". `validateDb` re-checks the same block, because losing it does not throw — the
dialog would render with no lead, no reader note and an empty freshness select, which reads as a
publish flow that asks for nothing.

**A chip at 0 is a state, not a broken map** — unlike the document dictionary's type facets, where
0 means the map is wrong. Nothing blocked is good news, so the chip dims and stays clickable and
the empty grid says so in words. New CSS for the section goes in `ReportsPage.css`, not the
vendored sheet, which carries a do-not-hand-edit rule — and so it is on the `--sp-*` scale like
everything else authored here.

#### Four actions on a row, and the two that reach the server

**Open report · Edit report · Share · Delete**, on every row, and each is offered only where it can be
carried out — a button that 404s is worse than one that is absent. Open and Edit need an authoring
starter behind the row; Share and Delete are the *governance row's* own, so a composed
(`kind: 'saved'`) row gets neither.

**There is no access gate on a row, and there was.** A per-row `access` block said whether the calling
role could open a report and what it had requested, and a reader outside the audience saw *Request
access* / *Access pending approval* **instead of** the four actions. It was removed on request, along
with `POST /reports/access-requests`, `db.reports.access_requests` and `requestReportAccess`. The
audience is still *stated* on the row ("Shared with: … / nobody — private") and nothing acts on it —
which is the honest position anyway, because the role is client-held and the API serves every row to a
caller that names none, so the gate was never access control.

`check-docs` asserts the absence **on every layer at once**, because the dangerous shape is a partial
revival: a card that gates on `access` while the payload no longer sends one renders a row with no
actions at all, which is the symptom that prompted the removal. Re-adding it deliberately means
deleting that claim in the same commit.

**Open and Edit work because a governed definition *is* one of the prototype's starters.** Both come
from `07_reports/report_authoring_data.json`, so `fromGoverned` matches a row to a starter on
`report_tag` — not on position, and not on the title, which differs between the tenant's heading and
the starter's. It returns `null` where nothing matches and the row then offers no Open.

- **`PATCH /reports/governance/:id/audience` is Share.** `[]` is **private**, and private is a
  decision: `validateDb` accepts an empty audience for exactly that reason, while the *seed* still
  refuses one because there it is a typo and nothing on that side tells the two apart.
- **`DELETE /reports/governance/:id` drops the governance row, not the definition.** The definition
  is the package's and stays in `db.reports.reports`, so a re-seed restores it — the reply carries the
  command and the confirmation says so, because "gone for good" and "a seed brings it back" are
  different promises to make to somebody clicking Delete. The last row cannot be deleted: a section
  with nothing to govern reads as broken rather than empty.

  **And the gap is stated, not left to be counted.** `governance.ungoverned` lists every definition
  with no governance row, and the Library names them above the list with the served `restore` command —
  because a list that is simply one card shorter reads as data loss. It also names the other cause a
  re-seed cannot fix: a server serving an older `db.json` from memory.
Both **commit**, because both are somebody's decision: a restart clears a registered source and a
publication, and it must not clear who a report was shared with. Each answers with the whole
governance view, and the page **re-reads the section** rather than adopting that reply — one path into
the state on screen instead of two.

**Sharing is not access control, and the picker says so on the page.** The role travels from the
browser and the login authenticates by shape, so what Share records is *stated* on the row and acted
on nowhere; the API still serves every row to a caller that names no role. That is the rule
`viewer_roles` established, applied to gate 1 — and CLAUDE.md's requirement that any UI built on it say
so in those words is met by `SharePicker`'s own caveat line. It is also why removing the access gate
lost nothing real: a gate on a client-held role was never enforcing anything.

**The Share picker renders the served role pool.** `GET /auth/roles` is the source, the same one the
login reads; a list of four roles written into the component would be a second answer to "who exists"
and could offer a role the API refuses — which is precisely what a client-side copy of the consent
scopes did. It is also **its own component**, because a panel behind a parent's `useState` cannot be
asserted on: `renderToString` renders the closed state and every check about its contents passes over
nothing.

**And it is a dialog at `App`'s root, beside `PublishDialog`, never a panel inside a card.** Inline it
grew its card by ~400px, which in an equal-height grid stretched every sibling in the row and left
four cards with a chasm between their text and their buttons. `LibraryPane` only *opens* it —
`check-docs` asserts the pane renders neither the picker nor any dialog chrome.

**Share is on the session cards too**, over the same dialog, writing `viewerRoles` on the local row.
Those roles stay in the browser — the prototype does not post its saved reports — so the dialog and
the row both say so, and `viewerRoles` is absent rather than `[]` until Share is used: never-shared
and deliberately-private are different facts, and only the second is a decision. It is a **separate
field from the prototype's own `audience`** (Operations / Compliance), because those are two pools and
translating one into the other would invent a mapping.

**Hosted, the session list starts empty.** The prototype's four seeded library rows are its own fiction
— other people's reports with bylines nobody here has — and in one list with the tenant's real
definitions they read as four more reports that do not exist. Standing alone the prototype keeps them,
because there is no real list for them to stand beside; that branch is also the only one that still
renders the old empty-state panel.

**Delete promises only what it does.** It drops the governance row, so the confirmation says the
definition leaves the list and that `npm run seed:governance` brings it back — never "gone for good".
That script is also the fix when a definition goes missing: it re-authors all five, and it settles a
pending access request whose audience it just widened, the same way `PATCH …/audience` does.

**`may_author`** comes from the persona's data-scope row: a persona that cannot see the
underlying figures cannot define what a report asserts about them, and the refusal names who
can. **The two gates are never merged** — gate 1 is audience entitlement (who may see that a
report exists), gate 2 is data scope (which rows a predicate admits and which columns are
masked) — and gate 2 is **declared, not applied**: no roster here is filtered per persona, so
applying a predicate would invent a filter and stating one silently would claim a filter that
never ran. One permission built from both is wrong in both directions.


### Audit & Governance (`/audit`)

One page for **who sees what**, over `AuditPage` → `governanceStore` → `GET /governance`,
`PATCH /governance/scope/:roleId`, `POST|DELETE /governance/artifacts/:id/readers`,
`POST /governance/artifacts/:id/unpublish`. Its copy is authored by `npm run seed:governance`.

**Two gates and a trail, and the page is honest about which of them is real.**

- **Who can open it** — the audience on each published artifact, managed here. **A report's
  audience is persona ids and a scenario's is addresses**, and the two are never merged: the page
  names a *person*, and the server writes to whichever pool that artifact actually keeps
  (`governanceAddReader`). Each row states which it is, so one is not read as the other.
- **What they see inside** — an access rule per persona: a restriction **basis** plus the values it
  admits, resolved against **that dataset's own register** — EPA's 36 inbound generators, CAPEX's 60
projects. `reportRegister()` reads the `reports.register` block a document ships (its roster, its
identity column, its own field dictionary) and defaults to EPA's spine, so EPA is unchanged; five
sites read `db.reports.data.generators` directly before that, which made `GET /governance` a flat 400
under CAPEX — a page that 400s reads as a broken server rather than as a dataset it has nothing to say
about. `check-docs` asserts no direct read comes back. **The basis list is derived, never
  written**: the register's identity column plus every field the dictionary declares `filterable`.
  `enf` is deliberately absent because the dictionary does not declare it — a basis nobody could
  slice a report by is not one.
- **The trail** — rule changes, readers added and removed, publications withdrawn, each with who
  did it from `?as=`. In memory, like publication.

**A rule is recorded, not enforced, and that sentence is served and printed where the rules are.**
No roster in this app is filtered per persona, so `resolution` states what a rule *would* admit —
never what a reader saw. It is computed once on the server and the page never recalculates it; it
names the rows as well as counting them, because "32 of 36" is not checkable and a list is.
`validateDb` checks for the phrase itself rather than the key, and the seed refuses a copy block
without it: a page that lets somebody author a restriction and stays quiet about enforcement is
implying one runs, which is the claim this whole section exists to avoid.

**Only two personas start with a rule.** The seed transcribes the two `data_scope` predicates that
are literally `TRUE` into `full`, and leaves the other two with none — `receiving_facility` is not
a column on this register and `FALSE — never a measure` is the absence of a rule. Inventing one to
fill those rows would put a restriction in the tenant's mouth. A persona with no rule says "No rule
authored yet" rather than "opens empty", which would itself be a claim about enforcement.

**Unpublish is offered only where the server has that act** — a scenario's publication is a record
this server keeps, a report definition's is not, and the refusal names the equivalent (an audience
of nobody). The last reader of a published scenario cannot be removed either: a published scenario
names at least one, so the refusal points at unpublish instead.

**A dataset can ship this screen too, and CAPEX does.** Everything above describes the computed page:
EPA resolves every rule against its own 36-generator register per request and states, in the tenant's
words, that a rule is recorded and not enforced. CAPEX ships `frontend/src/Capex/audit-governance/` —
the finished screen, with its two gates, its five-person directory, its three published reports and one
published scenario, its audit trail, and every count resolved against its own 60-project roster **by the
page itself**. `GET /governance` carries the pointer as `document`, `AuditPage` frames it with
`DocumentViewer seamless`, and the computed page is what a dataset without one still gets. Transcribing
the page's roster into `db.reports.governance` is the one change that would look right on screen and put
a second answer to *who sees what* in the document.

**Two files, because they answer two questions** — the same arrangement a report's `.html` and
`report_authoring_data.json` have. `governance_audit_capex.html` is the screen; `governance_audit_data.json`
is the extract the package's own `extract_governance.js` took *from that page*, carrying the roster, the
directory, the published artifacts, the audit log, the cost caps and the sealed traces in machine-readable
form. **Neither is transcribed into `db.CAPEX.json`.** `npm run ingest:capex` reads the document for what
the app has to be able to say about it — its `<title>`, its `<h1>`, its standfirst, its own three tabs —
and reads the extract for provenance (which package, which screen, when it was generated) and for the one
number the pointer carries, the roster the page resolves against.

**And the extract is what the page is *checked against*, which is the reason it is worth having.** The two
were exported from one build, so a disagreement means one half is stale — and a stale governance screen is
invisible, because it looks complete on its own. The ingest **refuses to write** when the page's own `PROJ`
roster and the extract's `roster.count` differ, when the two name different directories, when the extract
governs a report this dataset does not ship (matched against `db.reports.documents`, which is what the
Library lists), when it governs a person `db.settings` has never heard of, or when it came out of a
different package. The people are checked **by address as well as by name**, which they were not at
first — see below.

**The tenant's people are at one domain, and it is the console's.** The package writes its five people at
`@northlinewater.com`; `db.settings` carries the same five, same local parts, at `@vriodigital.com` — the
addresses Settings lists and the only ones anybody can sign in as. So the governance screen named five
readers, and the reports five authors, that no session here could ever be. **The five were rewritten to
the console's domain on request**, everywhere they appear: 16 mentions in the governance page, 16 in its
extract, 5 in each of the three reports and 9 in the What-if lens, all five local parts unchanged.

**Only those five moved, and the boundary is the point.** A blanket domain swap was the first attempt and
it was wrong: each report carries **five more** people — its authors and approvers, `marc.beaulieu`,
`tolu.adeyemi`, `karen.stroud`, `hector.villalobos`, `ilaria.castellan` — who are figures *inside the
report data* rather than people this console knows, and moving them onto the real company's domain reads
as five colleagues who cannot sign in. That is the mirror image of the fault being fixed, and it is what
the second rule below exists to catch. They stay on the package's own domain, as do the reports' project
contacts (`i.ostrowski@northlinewater.example` and ~20 more, 47 mentions per report) at the reserved TLD
that cannot resolve, and the share links (`contextweave.northlinewater.com/r/variance-report`), which are
the *tenant's* web address rather than a mailbox — the What-if receipt prints the same host, so moving
them would make two framed screens disagree about where a published artifact lives.

**Which is what let the ingest's check be tightened.** It compared names alone, and its comment said why:
with the domains differing, refusing over one was refusing a correct pair for something the script could
not resolve. With the mismatch gone the workaround has nothing left to work around, so it matches on the
**address** and reports a same-address-different-name as its own problem. That is also what stops this
coming back — these are package exports, so the next one carries the package's domain again, and by name
it would have passed while the screen listed five addresses nobody here can sign in as.

**`check-docs` asserts it one layer wider, as two rules over every document.** Wider because the ingest
reads *one* of these files: it checks the governance extract, while the screen itself, the three reports
and the lens carry the same addresses and are never parsed for them. Two rules because the substitution
that satisfies one breaks the other — **(1)** a person in the directory appears at the directory's address
and never at a second domain, and **(2)** an address at the directory's domain is one of the directory's,
so nobody is invented into it. Rule 1 catches a re-export reverting the domain; rule 2 caught the blanket
swap above. Both are break-tested.

**Behind the publish gate, on the open branch only** — `governanceDocument()` returns `null` while
`published_count` is 0, so the gated branch is the shared `NoPublishedGraph` for a shipped screen and a
computed one alike. This page governs *published* artifacts, so framing it with nothing published would
describe reports and scenarios nobody released; it is the same correction the What-if lens took. The page
tests the gate **before** `view.document`, and `check-docs` compares the two indices in that order.

**`MERGE_PLAN` marks it `primary`**, like `authoring_document`: one screen per dataset, and a merged view
has no single one. EPA has none, so `both` frames nothing and falls back to the computed page — unioning
would lay CAPEX's screen, whose every count is resolved against its 60 projects, over a view that also
holds EPA's 36 generators. A new nested key with no rule stops the boot, which is exactly how this one was
caught.

### Settings (`/settings`)

Four tabs — **Add User**, **Dataset**, **Persona Configuration** and **Report View** — over `SettingsPage`
→ `settingsStore` → `GET /settings`, served from **`db.settings`** — a key of `db.json`, not a file of its
own.

**The Dataset tab is the one that is not about `db.settings`.** It administers which dataset 
the whole console reads — see *Two datasets* above — and it is here because confirming it signs the 
reader out, which is a reconfiguration rather than navigation. Nothing on it is written to 
`db.settings`: the selection is client-held, and the pool comes from `GET /datasets`.

**It has its own small database, separate from `db.json`.** That file is the tenant's data — sources,
profiles, the graph, the reports; this one holds only what this page administers: the users, each
persona's navigation access, and the authored defaults those reset to. Two files, two validators, one job
each, so a settings write cannot touch a report and an ingest that rebuilds `db.reports` cannot drop a
permission. The second hazard is not hypothetical — the reports ingest silently dropped `governance` for
exactly that reason. `npm run seed:settings` re-authors it, and the server refuses to boot on a bad one
naming that command.

**It persists.** A permission survives a restart, unlike a registered source: a decision about who sees
what is somebody's work. `commitSettings` writes temp-file-then-rename and validates first, like
`commitDb`; the in-memory copy is reassigned rather than mutated in place, which is safe because nothing
captures the object — every route reads `settings.x` at call time.

**It names personas by `role_id` and never by label.** `db.auth_roles` is still the pool — what report
audiences validate against, what the login echoes back — and the server resolves labels on the way out,
so a rename reaches every surface at once. `validateSettings` checks *across* the two files and refuses a
role id `db.json` does not have.

**`defaults` and `nav_permissions` must carry the same keys.** Reset copies the defaults over the live
set, so a key missing from `defaults` is a permission that silently becomes "not configured" — visible —
the first time anybody resets. Both blocks are checked, and so is the lock below: a locked row that is on
now but off by default becomes unreachable at the next Reset. A break test found that gap.

**The configurable items are the sidebar's own.** The seed cannot import a `.tsx` module, so its
`NAV_KEYS` is written once and `check-docs` compares it to `nav.ts` — a key it has that the sidebar does
not is a permission nobody can exercise; one the sidebar has that it lacks is an item no persona can hide.

**One place decides visibility: `visibleNavItems`.** The sidebar filters through it and nothing else
does — a component that also filtered would be a second answer to "can this persona see Reports". A
toggle moves the sidebar on the next render, with no reload. `App`'s mobile header deliberately reads the
*unfiltered* list: it names the page you are on, and a hidden page is still reachable.

**The persona the sidebar shows is the one selected here.** It starts as whoever signed in
(`syncActivePersona` adopts a role only when none is active, so previewing another persona is not undone
by the next render) and sign-out clears it. Before the fetch returns, or with no persona active, every
item shows — a sidebar that started empty and filled in would read as a broken app, and an absent key
means "not configured", never "denied".

**Settings belongs to Platform Admin.** It is the page that administers every other persona, so it is on
and **fixed** there and off-but-configurable everywhere else — which is how it gets granted. The lock is
enforced by the **server**, in `PATCH /settings/personas/:roleId/nav`, not merely by a disabled switch: a
disabled control is a courtesy to whoever is looking at it, and any other path into the store could
otherwise strand the one persona that can grant everything. A change to a fixed key is refused with a
sentence rather than ignored, because silently keeping a value the caller asked to change is how a UI
comes to disagree with the server.

**Hiding is not authorising**, and the tab says so in those words. `/settings` is routed
unconditionally, so a persona whose sidebar no longer lists it can still reach the page — which is what
stops a reader turning Settings off for a configurable persona and losing the way back. The page warns
when that state is reached and names the URL. Do not build anything on these permissions that assumes
they gate access; they are the same client-held preference `viewer_roles` is.

**The Report View tab records what a persona may *do* to a report, and the split from Persona
Configuration is the point.** That tab answers "which pages does this persona see"; this one answers
"what may it do once it is on one of them" — the three acts a Library row offers, `open` · `edit` ·
`delete`. One table mixing nine navigation items with three report acts would be two questions in one
list. `report_permissions` and `report_defaults` sit beside `nav_permissions` and `defaults` in
`db.settings`, `PATCH /settings/personas/:roleId/reports` is the twin of the `nav` route, and Reset
restores **both** blocks — the button says "Reset to defaults" for the persona, and restoring its
navigation while leaving its report access edited would answer half of that.

**The actions are declared once, in `REPORT_ACTIONS`, and three layers are checked against it.** The
PATCH route validates against it, `validateSettings` refuses a stored block that does not carry exactly
those keys, and the seed writes its own copy because a script cannot import the server — so `check-docs`
compares the two, exactly as it compares `NAV_KEYS` to `nav.ts`. Each drift fails in a different silent
direction: a fourth action in a component is a permission the API refuses, a missing one stops the boot,
and a key the server holds that the panel never renders is a decision with no way to see it. The panel
renders the **served** list for the same reason the consent screen renders the scopes the endpoint
returned. **Share is deliberately not one of them** — that edits the *audience*, which Audit &
Governance owns, and putting it here would give one record two homes.

**It gates by withholding a handler, never by a permission field on the card.** `GovernedCard` already
shows a button only where there is a handler to run, so a withheld act is simply no callback passed —
`actions && may('edit')` in `src/reports/App.tsx`. That is not a style preference: a card that tested a
permission field of its own is the exact shape of the access gate this section removed, where a payload
that stopped carrying the field rendered a row with **no actions at all**. `reportActionsFor` in
`settingsStore` is the one place the rule lives, the twin of `visibleNavItems`, and **absent means
allowed** — before the fetch returns, or with no persona active, every act is offered, because a Library
whose buttons appeared a moment after its cards would read as a broken page. Session reports are not
gated: those are the reader's own drafts, held in this browser and submitted to nobody.

**And there is no lock here, unlike Navigation access.** Settings is fixed on Platform Admin because a
persona able to hide its own way back in would be stranded with no route to recovery. Nothing on this
tab can strand anybody — a persona that loses `edit` still reaches this page and can hand it back, and
the API still serves every report to a caller that names no role. A fixed row nobody could explain is
worse than none. **Which is also why the tab states, in those words, that it controls what is offered
and not what is permitted**: it switches off a *Delete* button, the most authoritative-looking control
in the section, so staying quiet would imply an enforcement that does not exist.

### Identity (`/login`)

Gates the whole app, so it is the one flow that sits outside `RequireAuth`
rather than behind it — see Routing below for how the route table wraps that.

**This is a persona demo, and there is now a small user directory behind it.**
`POST /auth/login` takes **`{ email, password }`** and nothing else. There is
still no credential store, so the password is length-checked and no more — but
the *persona* is looked up rather than claimed: the address has to be one of the
users in `db.settings`, and the role on that row is the one you sign in as. An
unknown address is refused, naming the people Settings knows.

**The role picker is gone, and that is the point.** The form used to ask which
persona you were, so one address could sign in as any of them — the dropdown was
the whole of "who are you". `LoginPage` no longer reads `GET /auth/roles` at all,
and the empty-Select-with-no-reason failure mode went with it. It still verifies
nothing, exactly as the BigQuery/Drive consent screens prove a request is
well-formed rather than that a real Google account sits behind it; the page says
so. Do not build a feature on this login that assumes it authenticates.

**The four roles still come from `db.json`, not a hardcoded union**, the same
pattern as `graph_domains`/`graph_personas`: `GET /auth/roles` serves
`{ role_id, label, access_note }`, `db.settings` names those `role_id`s and
never a label, and `POST /auth/login` echoes the resolved `label` back in the
session so the sidebar never has to re-fetch the pool to render it. Adding a
fifth role is an `auth_roles` edit plus a `settings` one — the seed refuses a
user whose role the pool does not have.

**The session now carries the user's `name`**, which the login previously had no
way to know. The avatar is still initials from the email, because that is what it
has always drawn.

`access_note` describes what a role may see. It is carried through the API and the
session, and the Persona Configuration tab now prints it beside the persona being
configured — the first surface to render it. The sidebar's "My data access" card is
still gone; do not re-add one on the assumption that a signed-in user has been told
what their role can reach.

**The identity is client-held, not server state.** `useAuthStore` persists
`{ email, name, roleId, roleLabel, accessNote, initials, signedInAt }` to
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

### Components (`src/components/`)

**Grouped by feature, one folder per area, and nothing sits flat at the top.** The folder held 47
components in a single flat list, which is readable at a dozen and is a scroll at forty-seven: the
name was the only thing saying which page a component belonged to, so `SourcesStep` (the New Graph
wizard's step 4) sorted next to `Sidebar` and nothing grouped the four What-if drawings that only
ever render together. Eleven folders now, and a component's path states its area:

| folder | what is in it |
|---|---|
| `common/` | reached for from outside by three files or more — `PageHeader`, `ApiErrorAlert`, `StatusTag`, `StatCards`, `EmptyState`, `NoSourceConnected`, `NoPublishedGraph`, `ConnectorIcon` |
| `shell/` | the app frame and the routing guards — `Sidebar`, `RequireAuth`, `DatasetPathGate`, `DatasetRedirect` |
| `sources/` | the connect wizard, its consent windows and `StageList` |
| `catalog/` | the four profiling and dictionary panels |
| `graph/` | the New Graph wizard's steps, plus `LlmRun` |
| `studio/` | Graph Studio's tabs — `BuildTab`, `VersionsTab`, `ReviewQueueItem` |
| `ask/` | the answer view, its blocks and `AnswerChart` |
| `whatif/` | the lens's columns, drawings and publish dialog |
| `governance/` | Audit & Governance's card and rule editor |
| `settings/` | the three Settings tabs |
| `report/` | the rendered-report chrome — **already a folder, and untouched by the grouping** |

**A cross-group import is expected, not a smell.** `report/ReportBlocks` imports
`../ask/AnswerChart` on purpose — one component draws an answer's chart and a report's, which is why
the two cannot come to disagree about what a bar means. The grouping is about where a file *lives*,
and it does not claim the groups are independent.

**`common/` is earned by use, not by looking generic.** Membership is "three or more files import it
from outside its own folder", and both halves of that were learned by writing the check rather than
assumed:

- **Pages are the wrong denominator.** Only `CatalogPage` imports `ConnectorIcon` *directly*, so
  counted by pages it looked like Catalog's private mark — but the New Graph wizard's step 4 and the
  connect wizard import it too, from two other groups. Filed under `catalog/` on that reading it
  became a component two other areas reach across for, which is the arrangement `common/` exists to
  avoid. A sibling importer counts.
- **A total is the wrong number.** `LlmRun` has three importers and all three are `graph/` — two
  wizard steps and the wizard's page. Three uses inside one area is what a feature folder is *for*,
  so it stays in `graph/` despite the neutral name. `StageList` went the other way for the same
  reason: one importer, `sources/GoogleConsentPanel`, so it lives beside it.

`EmptyState` is in `common/` on the other half of the rule — three importers, one of them a page
outside `common/` — and it is the primitive `NoSourceConnected` and `NoPublishedGraph` wrap. `shell/`
is exempt: no page imports `Sidebar` or the routing guards, because `App` and the route table do, and
they are the app frame rather than something a page reuses. A component promoted to `common/` on a
hunch is a component whose folder no longer says anything.

**The two vendored folders are not part of this and must not be folded in.** `src/reports/` and
`src/graph-viewer/` were imported whole, each with its own components, lib and scoped stylesheet, and
`check-docs` asserts their paths and their CSS scoping — see the Reports and Canvas sections. Merging
either into this tree would break those claims and lose the one thing vendoring bought: a folder that
can be diffed against where it came from.

**An absence claim about a component searches the tree, never one path.** `absentUnderComponents` in
`check-docs.mjs` is why: the five deleted components it guards (`SourceImpactNotice`, `NodeInspector`,
`GraphCanvas`, `DatasetPicker`, `AnswerRequirementsStep`) were each checked against one flat path,
which was exact while the folder was flat and fails open now — a revival landing in its feature folder
would satisfy a check pointed at the old location. `check-docs` also asserts the top level holds no
`.tsx` at all, so the folder cannot drift back to flat one convenient file at a time.

### State (`src/store/`)

zustand. Thirteen modules (plus `asyncState.ts`, the shared machinery): `authStore`
(who is signed in — the one module persisted to `localStorage`, everything else
is server-derived), `sourcesStore`, `catalogStore` (browse / columns /
document browse / documents / jobs — plus `signals`, which nothing reads since
the Change signals tab was removed), `graphStore` (domains / use
cases), `graphStudioStore` (the studio's list + one graph's review),
`askStore` (live graphs + the last answer), `whatifStore` (the What-if frame plus
one column per admitted load — the *load*, never the figures), `reportsStore` (the
section list, plus one report keyed by the id in the URL — it keeps that id beside the
report so a slow fetch cannot leave one report's tiles under another's heading),
`telemetryStore` (audit / traces / evals), `settingsStore` (which persona the sidebar is showing and
what each may see — from db.settings — its own small store over one key of db.json), `dbStore`.

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
`ProfiledColumnsPanel.css` / `CatalogPage.css` classes rather than growing a
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

**One precondition, one screen.** Four pages need a published graph — Ask, Reports, the
What-if lens and Audit & Governance — and every one renders **`NoPublishedGraph`**, whose
single action is **Open Graph Studio**, because that is where the publish button is. Only
the `detail` sentence and an optional `footnote` are per-page; the title, the action and
the numbered path are not, or the same gate comes to be called two things. Ask kept a
private copy of it for a long while — "No graph is live yet" against "No graph has been
published", its own steps, its own button — which reads as two different problems and
sends a reader looking for a second fix. `check-docs` asserts all four use the component
*and* that none of them hand-rolls an `EmptyState` on that branch. **The action forks on
the counts**, and must: `builtCount > 0` means publish what you have (Graph Studio),
nothing built means build one first (New Graph), and offering one for both sends half the
readers to the wrong screen.

**Brand text on the brand tint needs `BRAND_INK`, not `BRAND`.** `BRAND` on `BRAND_SOFT` is
2.91:1 — under AA — so a *selected* item styled that way is the hardest thing on the control to read.
`BRAND_INK` is the same hue at 5.96:1, and `check-docs` recomputes both. `BRAND` stays correct for fills,
borders and marks, where 3:1 is the bar. Selection also carries **weight**, because colour alone is what
this repo refuses everywhere else. The sidebar’s own selected rule in `Sidebar.css` still uses the raw
brand on a 12% wash (2.65:1) and predates this; it is bolded, and worth fixing when that file is next
touched.

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

**Every in-app route lives under the dataset's letter** — `/:ds` is a layout route holding
`DatasetPathGate`, and the pages are relative to it, so `/sources` is really `/E/sources`. See *Two
datasets* above for why the letter is derived from the selection rather than read from the URL. The
paths named throughout this file are the canonical ones without the segment, which is also how
`NAV_ITEMS` states them.

**`/login` sits outside `RequireAuth`, and everything else sits inside it.**
The route table wraps the whole `/` tree — `App` and every page under it — in a
`RequireAuth` layout route; an unauthenticated visit to any of them redirects to
`/login` with the attempted location in `state.from`, and `LoginPage` reads that
back to return the user to where they were headed rather than always landing on
Sources. `/login` has no `NAV_ITEMS` entry — there is nothing to navigate to
before signing in, and once signed in there is no reason to navigate back.

**Every sidebar entry now has a page.** `NAV_ITEMS` has **9** live entries and `routes.tsx`
has a page for **9** of them (`/new-graph`, `/ask`, `/reports`, `/sources`, `/catalog`,
`/graph-studio`, `/what-if`, `/audit`, `/settings`). **Knowledge Graphs was the tenth and is
gone** — a roadmap placeholder with no route, so clicking it fell through `path: '*'` to
`NotFoundPage`; it was removed on request. Removing it was four coordinated edits, which is
what any nav entry costs: the `NAV_ITEMS` entry, its `NavKey` and its icon import in `nav.ts`,
its key in the seed's `NAV_KEYS`, and a re-seed of `db.settings` so no persona carries a
permission for an item that does not exist. A future placeholder is the same four in reverse
plus the one line in `routes.tsx` when it gets a page — `/what-if`, `/reports` and `/audit`
were all placeholders until theirs landed.

**The nine sit in three groups, and a group is a heading rather than a permission.** `NAV_GROUPS`
in `nav.ts` declares them in order — **Explore** (Reports, Ask, What-if Lenses), **Build &
Configure** (New Graph, Sources, Data Catalog, Graph Studio), **Trust & Operations** (Audit &
Governance, Settings) — and every item names one. `SidebarMenu` builds the headings from the list
`visibleNavItems` returned and drops a group with nothing under it, because `EXPLORE` above empty
space reads as a section that failed to load rather than as one the persona may not open. The
grouping costs a fifth coordinated edit on top of the four above: `NAV_ITEMS` is in group order, and
`check-docs` compares that order to the seed's `NAV_KEYS` literally, so a reordering here is a
reordering there plus `npm run seed:settings`.

**And the sidebar is filtered.** `visibleNavItems` in `settingsStore` decides which of those nine
entries a persona sees — see Settings below. `App`'s mobile header deliberately looks up the
*unfiltered* list, because it names the page you are on and a hidden page is still reachable by URL.

**`/reports` is one route, not four.** The React section that had a page per report was
removed; what is there now is the demo package's authoring prototype, vendored into
`src/reports/`, which owns its own three-tab navigation and its own library. So a report is not
a URL here.

The traffic also runs the other way. **Three routes are reachable by URL only**, having
been commented out of `NAV_ITEMS` rather than deleted: `/trace`,
`/validation` and `/db`. `/audit` was the fourth until Audit & Governance got a page. Two more are URL-only by design and were never in the list. **`/login/data`** frames
the settings/users/connectors description from `public/` — a document, so it sits outside `App` *and*
outside `RequireAuth`, because behind the gate a typed URL would bounce to the login and never show it.
Nothing on it is tenant data. `check-docs` asserts the file it names is really in `public/`, since a rename
would leave the path answering with a blank frame and no error. The others are
`/graph-studio/:useCaseId/canvas`, the full-window canvas, which the **Full view**
button on the Canvas tab opens in a new tab, and **`/doctor`** — see below.

**`/doctor` is the frontend's `GET /health`, and it sits outside the gate for the same kind of
reason that route exists at all.** Four different faults produce one blank console — the API is
unreachable, the bundle is calling a different API, the `x-dataset` header is not arriving, or the
tenant simply has not published a graph — and nothing on screen tells them apart. So one page
reports, in rows, each with the fix for the state it found: which API this bundle calls and in which
mode, whether it answers (port, uptime, the datasets validated at boot), **which store answered**,
the dataset this browser sends *against* the one the server says it answered from, whether that
selection is one the server still has, who the browser is signed in as and whether that persona still
exists, and the two preconditions — connected sources and published graphs, with `built`/`draft`
beside the latter because "publish what you have" and "build one" are different fixes.

- **Outside `RequireAuth`, and outside `/:ds`.** An unreachable API breaks the sign-in *first*, so a
  page behind the sign-in cannot report it; and `DatasetPathGate` would rewrite the address of a page
  whose job includes explaining that redirect. It is URL-only, with no `NAV_ITEMS` entry, by the rule
  `/db` follows. It reads only endpoints this API already serves without a session, and changes
  nothing.
- **The verdicts are a pure function** — `diagnose` in `src/data/doctor.ts` — for the reason
  `datasetPathFix` is: a rule inside a component cannot be asserted without rendering the component's
  own state. The page renders what it returns and decides nothing; `check-docs` fails on a tone
  literal in the component.
- **Every row states what it read**, and the *Copy report* button renders the same checks as text, so
  a pasted report cannot say something the screen does not. A check whose call failed says so in
  place: the four calls are `Promise.allSettled`, never `all`, because the dataset check is exactly
  what a reader needs while `/reports` is refusing.
- **The base is `apiBase()` from `client.ts`**, never `import.meta.env` read a second time — the one
  question this page exists to answer must have one answer. Local files behind a *relative* base is
  normal and says so; local files behind an absolute origin is a deployed box serving the documents
  frozen into its bundle, which is `warn` and names `S3_BUCKET`.
- **And `GET /health` has exactly one matcher again.** There were two — this one and a legacy
  `{ ok, projects, registered_sources }` further down that `routes.find` could never reach. A dead
  duplicate is worse than none: an edit to the wrong copy changes nothing, silently.

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

`frontend/scripts/audit-gate.mjs` fails on **any** advisory at or above `low`
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

**`d3` is the one deliberate exception, and it names its own reason.** The graph
viewer vendored into `src/graph-viewer` is a d3-force drawing, and a settling force
layout with drag and zoom is not 100 lines — the alternative was a hand-written
simulation that would not match the folder it came from. Audit was 0 advisories before
and after. Everything else that draws here is still hand-written SVG: the answer charts,
the What-if frame and traversal, and the span-waterfall bar. A second charting or graph
package needs the same argument made again from scratch.

## Working in this repo

`.claude/skills/contextweave-flow/SKILL.md` defines the loop: orient (read the
relevant `SKILLS.md` flow and `docs/REGRESSIONS.md`) → build → verify → **record**.
The record phase is not optional — it is why the same bug does not land twice.

- **`SKILLS.md`** — the thirteen end-to-end flows, their files, and their failure modes.
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
  origin belongs in `frontend/.env.development` (`/api`) and `frontend/.env.production` only — in a
  plain `.env` it applies to *every* mode and silently points `npm run dev` at
  the deployed box, where local `db.json` edits and `server.js` changes have no
  effect and nothing errors. `check-docs` now fails on it. Symptom to recognise:
  `curl localhost:4000` is right and the browser is wrong.
- **A failing `check-docs` claim is a live fault, not background noise.** The
  `.env` bug above sat in a red claim for a whole session while it was dismissed
  as unrelated. Read the red claims before diagnosing anything else.
- **A stale mock server answers with the old shape.** Editing `server.js` or a
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
- **A declared field type is a claim about every dataset, not the one in front of you.** `rows: num` in
  the browse schema was true by accident: EPA has 8 tables and profiles all 8. CAPEX ships 64 of which 62
  carry `rows: null` — *"the honest value, not zero"*, in its own provenance — and every browse of a CAPEX
  source was refused with `rows should be a number, got null`, under a message blaming a stale server. When
  widening such a field, check every consumer for `?? 0`: the compiler is satisfied by a default that
  lies, and "0 rows" says a table is empty when nobody has counted it.
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
- **Scoping a stylesheet breaks everything that portals out of the scope.** The report
  prototype's sheet had to be scoped under `.cw-reports` — its bare `*`, `body` and `table` rules
  would restyle the whole app — and its `MenuProvider` portals to `document.body`, outside that
  wrapper. Every menu lost its `position`, `z-index` and background and rendered below the page,
  so **Delete looked like a dead button** while actually opening an invisible confirmation. The
  portal now carries the class *boxlessly* (`display: contents`): `.cw-reports` also holds a
  full-height opaque background, and any box would become the containing block for a menu
  positioned against the document. Audit every `document.body` mount — portal, tooltip, modal,
  toast — whenever you scope a sheet.
- **A claim appended to the end of `check-docs` never runs.** The reporting block at the bottom
  ends in `process.exit`, so a claim added after it is dead — `check-docs` still passes and every
  break test reports `MISSED`. The tell is the **claim total not moving**. Add claims in the
  section they belong to, and confirm the count went up.
- **"The write failed" and "I did not hear whether it succeeded" are different facts.** A settings toggle
  reported "cannot reach the mock server" for a PATCH the server had already committed, because the store
  only updated on success — so the page showed the old value and the toast blamed the write. A failed write
  now re-reads before reporting. A network error means the outcome is unknown; ask the server.
- **A fallback is state, and needs the same checks as the state it replaces.** `db.settings` holds
  live permissions and the `defaults` Reset copies over them; both the validator and its claim checked
  only the live set, so a broken default became a broken sidebar at the next Reset with nothing throwing.
  Presets, defaults, seeds and reset payloads are all delayed ways of setting the real thing.
- **A list that is merely shorter is not a message.** Deleting a report's governance row removed it from
  the Library with nothing saying why, and "only 4 reports showing" was reported twice against a
  `db.json` that held all five. The section now serves `governance.ungoverned` and the page states it
  with the restore command. If a UI can remove a row, it has to be able to say the row is gone.
- **When the file and the screen disagree, suspect the process before the data.** A mock server running
  since before two turns of changes had deleted a row from its own memory; re-seeding fixed the file and
  not the process, and `PUT /db` was *refused* because that old process still validated a key the file no
  longer has. An old server's own refusal messages date it. `PUT /db` reloads in place and keeps
  in-memory publication; a restart clears it and closes every gate.
- **When a feature is removed, guard its absence at every layer it touched.** The report access gate
  spanned the server, a route, a required `db.json` key, a client schema and fetcher, two handlers, a
  card and a stylesheet. Half of it is worse than all of it: a card gating on `access` while the payload
  no longer sends one renders a row with no actions — the original symptom. One cross-layer claim, not
  one per file.
- **A file can have mixed line endings after scripted edits**, so a break test that searches for `\n`
  in a CRLF region silently fails to mutate and reports the claim as unbreakable. Check the mutation
  landed before rewriting a working guard.
- **Strip comments before asserting that code does not say something — assume it, do not discover it.**
  This has now cost five claims across three sessions: the comment explaining why a file does *not* do
  something names the thing it does not do. `!/Approval/` matched the note about removing the approval
  line; `!/access_requests/` matched the note about dropping the key; `!/visibleNavItems/` matched
  `App.tsx`'s note about deliberately not calling it. Use `codeOnly()` for every absence claim, and key
  on the narrowest token that carries the fact. Two `check-docs` claims failed
  against correct code because they were whole-file searches for a word the file mentions *in the
  comment explaining its removal* — "no approval line", "not \"gone for good\"". A third was too broad:
  `!/Approval/` also matched "Access pending approval", a different feature. Use `codeOnly()` and key on
  the narrowest token that carries the fact (`r.approval`, not `approval`).
- **When a list changes what it contains, re-derive every number about it.** The Library's chips printed
  the server's counts, which was one source while the list held only server rows; merging the session
  reports in would have shown "Published 5" over six cards. "The server computes it" is a single source
  only while the server can see everything being counted.
- **`x = { … }` on a shared key deletes everything not listed.** `ingest-reports.js` rebuilds
  `db.reports` wholesale and carried `saved` forward by hand; `governance` was added later by another
  script and was not carried, so a re-ingest would have deleted every audience and data-scope row.
  When a script owns a subtree, derive the carry-forward list from `validateDb` rather than
  remembering it — and refuse to write rather than produce a document that cannot boot.
- **When a field becomes writable, re-read every rule that assumed it was authored.** Allowing a
  private (empty) report audience broke two rules written when only the seed set it: `validateDb`
  would have refused the commit, and a publish check would have reported a deliberately private
  report as failing. The seed and the API legitimately want *different* invariants on that field;
  naming which and why is the fix, not collapsing them.
- **An `else` that returns a specific answer is not a fallback.** `reportEntitlementCell` tested
  published, then pending, then *returned the archived cell* — so a `blocked` definition told its
  audience it could open a report nobody published. Its tone came from a literal map in
  `server.js` while the chip counting the same state read `governance.statuses`, so one state read
  `neutral` on the card and `crit` on the chip. When a pool in `db.json` gains a member, grep every
  `=== 'member'` chain and every literal map keyed by the same vocabulary; the compiler sees
  neither, and both fail by answering.
- **A negative assertion on a page with two grids is ambiguous.** The Library holds the governed
  definitions and the session shelf, so `!html.includes('rcard')` failed against correct code —
  the shelf's cards are meant to be there. Slice the render to the section you mean. And
  `renderToString` splits `text {expr} text` into separate nodes, so make interpolated copy one
  expression rather than loosening the assertion around it.
- **A vacuous assertion is worse than no assertion.** Two written this session passed
  over nothing — one `|| true`, one `!x || x` — and both were reporting success. If an
  assertion cannot fail, it is a comment.
- **The equal-height card trick breaks a card that expands**, and it has now bitten twice.
  `height: 100%` plus a flex body plus `margin-top: auto` on the foot is right for a grid of fixed
  cards and wrong for one with a panel inside it: the saved-report card grew a tall empty head and
  spilled its meta rows out of its own frame the first time the audience panel opened, and the
  report Share panel later stretched its whole grid row, leaving four sibling cards with a chasm
  between their text and their buttons. **Anything that expands belongs outside the grid** — a
  dialog at the page root is the default, not the fallback.
- **A flex row shrinks its items before it wraps.** Four action buttons in a 275px card column had
  nowhere to go, so every label broke mid-phrase ("Open" over "report") instead of moving to a
  second line — and a `.spacer` with `flex: 1` reserved the width that would have let them fit. Set
  `flex-wrap: wrap` and `white-space: nowrap` together, or the layout degrades by mangling text.
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
- **A seeded singleton is a record, not a value.** `db.google_account` is
  `{ email, name, picture }`, and a new publish route fell back to the object instead of
  `.email` — a 200 the client refused with `published_by should be a string, got object`,
  which reads as a stale server and was a three-second-old one. Grep the key's other
  callers before falling back to it; the unwrapping convention lives in them and nowhere
  the compiler can see. And read the *value* before blaming the process.
- **When a synchronous operation becomes asynchronous, write down what it was getting
  for free.** Making the `db.json` writes async cost three guarantees at once:
  serialization (two commits share a temp path), read-modify-write atomicity (a handler
  reading the pre-edit document drops the previous edit), and crash consistency (a write
  that throws never reached the swap). Each had to be put back by hand — a queue, an
  ordering decision, a rollback. Async I/O is rarely just "add `await`".
- **`db.json` is generated *and* committed, so a pull over a re-seeded copy conflicts.**
  A deployed box crash-looped on `Expected double-quoted property name in JSON at
  position 2464` while the real problem was `<<<<<<< Updated upstream` at line 113.
  Both databases now load through `readJsonDb`, which checks for conflict markers
  *before* parsing and names the file, the line and the rebuild command —
  `validateDb`'s careful refusal is useless here because `JSON.parse` runs first.
  **A diagnostic that runs after the parse never runs on the worst input.**
- **A partial fallback moves a crash rather than removing it.** `check-docs` guards a
  missing demo package with empty objects so its claims fail loudly instead of vacuously
  — but the fallback omitted `counts`, so the run still died three claims later and
  printed no summary. Enumerate a fallback's keys from the code that dereferences them.
- **A shared empty state needs a claim listing the pages that must use it.** Ask kept a
  private copy of the publish gate, so one precondition had two screens with two sets of
  words — invisible, because each page looked right alone. Assert both halves: every gated
  page renders the shared component, and none of them hand-rolls an `EmptyState` for the
  same branch.
- **`codeOnly` is for every whole-file `check-docs` claim, not only the negative ones.** A
  *presence* claim searching for `copy.notEnforced` passed after the render stopped using
  it, because the component's own comment names the field — the same self-documenting-file
  trap already recorded five times for absence claims. Key on the narrowest rendered form
  (`description={view.copy.notEnforced}`), never the bare identifier.
- **Pair every absence claim with a presence claim over the same region.** `codeOnly`'s
  JSX-comment rule was `\{\s*\/\*`, so `interface Props {` followed by a doc comment
  matched and the non-greedy tail deleted **139 lines** of the component before any claim
  read it. Absence claims all passed — a file with its middle removed satisfies every
  one of them — and it surfaced only because four *positive* claims were written against
  the same region. "X is absent" and "Y is still here" are cheap together and worthless
  apart. Same reasoning as proving a `renderToString` had its data.
- **A helper shared by `check-docs` claims belongs above every claim.** The file is one
  long script, so definition order is execution order: `codeOnly` was declared 600 lines
  below four new claims that used it, and a `const` in the temporal dead zone would have
  killed the run before its summary — which is the "claim total stops moving" failure,
  where every break test reports MISSED and correct guards look broken.
- **A custom request header is a CORS decision, and `curl` cannot see it.** Only four request
  headers are safelisted; any other makes a cross-origin request preflighted, and the browser blocks
  it unless the `OPTIONS` reply names it in `access-control-allow-headers`. Adding `x-dataset` to
  `request()` broke every call in the browser (`TypeError: Failed to fetch`) while every server-side
  test still passed 200 — and it bites hardest where the app calls the server on another origin,
  which is both the deployed setup and any dev setup whose `VITE_API_BASE` is an origin rather than
  `/api`. Two reply paths need it: `send` and `sseOpen`.
- **antd v6 renamed props** — read the installed `.d.ts`; do not assume v5.
- **Selectors must return stable references.** `data?.x ?? []` allocates every
  render and defeats downstream memos; use a module-level constant.
- **Do not whole-file find-replace identifiers** — it has no scope awareness and
  has already renamed an unrelated prop. Use Edit with surrounding context.
- **When a test fails, suspect the assertion and the environment first.** Two
  "failures" in this repo were a miscounted expectation and a stale server.
- React is pinned to the 18 line on purpose; keep `@types/react` in step.
