# REGRESSIONS.md

Every bug that cost real debugging time, and the guard that stops it recurring.

Read this before touching the mock server, antd props, spacing, or a store
selector. Append to it whenever you fix something — see
`.claude/skills/contextweave-flow/SKILL.md`, phase 4.

**Template**

```
## <short title>
**Symptom** — what was visibly wrong.
**Root cause** — why, one sentence.
**Fix** — what changed.
**Guard** — mechanical (build fails) > diagnostic (message names the fix) > documented.
```

Guards are ranked: prefer one that fails the build. A note in a doc is the
weakest form and only acceptable when the first two do not apply.

---

## Stale mock server serves the old row shape

**Symptom** — Sources table showed 9 rows with a blank `source_id`,
`Invalid Date`, and `undefined table(s) · undefined col(s)`. Looked like a
frontend bug; cost two rounds of confusion.

**Root cause** — the running server had loaded `db.json` and the row-shaping code
at startup, before both changed. It kept answering with the old fields
(`name`, `last_sync`) while the new UI asked for `source_id`, `connected_at`,
`profiled_tables`.

**Fix** — killed the stale process and restarted it.

**Guard** — *diagnostic*: `listSources` in `src/api/client.ts` checks for rows
without a string `source_id` and throws a message naming the fix ("Restart it:
stop `npm run mock` and start it again") **before** the schema runs, so the user
gets one actionable sentence instead of a wall of field mismatches.

**Rule** — editing `server.mjs` or `db.json`'s shape requires a restart, and a
restart clears every registered source. When output looks impossibly wrong,
check the server's age before your own code.

---

## Background server holds the port but stops answering

**Symptom** — `curl localhost:4000` timed out, yet a new `npm run mock` failed
with `EADDRINUSE`. Happened three times.

**Root cause** — a server started with `nohup … &` from a shell that then exited.
On Windows the child survives, keeps the listening socket, and accumulates
sockets in `CloseWait` while no longer serving.

**Fix** — `Get-NetTCPConnection -LocalPort 4000` to find the pid, `Stop-Process`,
restart under a supervisor that outlives the shell.

**Guard** — *diagnostic*: `server.mjs` has an `EADDRINUSE` handler that prints
how to check `/health`, how to find and kill the holder on Windows and macOS, and
how to run on another port — instead of an unhandled `error` event stack trace
that buries the cause. Also a `SIGINT` handler so Ctrl-C closes the listener
cleanly rather than orphaning it.

---

## PowerShell corrupted UTF-8 in a source file

**Symptom** — em dashes and `·` in `src/data/dummy.ts` turned into `â€"` and
`Â·`, plus a stray BOM.

**Root cause** — `Get-Content`/`Set-Content` round-trip in PS 5.1: the file was
read as ANSI (Windows-1252) because it had no BOM, then written back as UTF-8.

**Fix** — repaired the mojibake sequences and stripped the BOM with node reading
and writing explicit `'utf8'`, then scanned the whole tree to confirm nothing
else was affected.

**Guard** — *documented* (in `CLAUDE.md` gotchas): never round-trip a source file
through PowerShell text cmdlets. Use the Edit tool, or node with explicit
`'utf8'`. No mechanical guard exists because the corruption is only detectable
by scanning for known mojibake sequences after the fact.

---

## `erasableSyntaxOnly` rejects constructor parameter properties

**Symptom** — `error TS1294: This syntax is not allowed when
'erasableSyntaxOnly' is enabled` on `ApiError`.

**Root cause** — `constructor(message: string, readonly status: number)` is a
TypeScript-only construct; the tsconfig forbids syntax that cannot be erased.

**Fix** — declared `status: number` as a field and assigned it in the body.

**Guard** — *mechanical*: `tsc -b` in `npm run build` already fails on it. The
lesson is to build, not just lint — `oxlint` passes this happily.

---

## Unused import fails the build, not just lint

**Symptom** — build broke with `TS6133: 'Empty' is declared but its value is
never read` after a refactor removed its last use.

**Root cause** — `noUnusedLocals` and `noUnusedParameters` are on.

**Fix** — removed the dead imports.

**Guard** — *mechanical*: `npm run build` catches it. Never conclude a refactor
on `npm run lint` alone; lint reports these as warnings and exits 0.

---

## antd v6 prop renames

**Symptom** — deprecation diagnostics, then wrong rendering, on `Tag bordered`,
`Alert message`, `Drawer width`, `Modal destroyOnClose`.

**Root cause** — assumed antd v5's API. This project is on v6, which renamed
them: `bordered` → `variant`, `message` → `title`, `width` → `size` (Drawer),
`destroyOnClose` → `destroyOnHidden`.

**Fix** — read the installed `.d.ts` for each component and used the current
props.

**Guard** — *documented* (`CLAUDE.md` UI conventions) plus a habit: before using
an antd prop, `grep` the installed
`node_modules/antd/es/<component>/*.d.ts` for `deprecated`. Cheaper than a
render-and-look cycle.

---

## `?? []` in a selector defeats memoisation

**Symptom** — `oxlint` warned "React hook useMemo depends on `sources`, which
changes every render".

**Root cause** — `data?.sources ?? []` allocates a fresh array on every render,
so every downstream `useMemo` recomputed.

**Fix** — a module-level constant, exposed as `selectSources` in
`src/store/sourcesStore.ts`.

**Guard** — *mechanical*: `oxlint`'s `exhaustive-deps` catches it when the value
feeds a hook. **Rule** — selectors must return stable references; never inline a
fallback literal in one.

---

## Global find-replace renamed a prop it should not have

**Symptom** — `Cannot find name 'load'` in `ChangeSignalsTab`, which takes a
`reload` prop.

**Root cause** — a blanket `void reload()` → `void load()` replacement across a
file hit a prop of the same name in an unrelated component.

**Fix** — restored the prop call site.

**Guard** — *documented*: use the Edit tool with surrounding context for
identifier renames. A whole-file string replace has no scope awareness. When one
is unavoidable, build immediately and read every error rather than assuming it
was clean.

---

## antd Modal bodies cannot be asserted on

**Symptom** — an SSR smoke test of `ConnectSourceModal` returned a zero-length
string, so nothing could be verified.

**Root cause** — `Modal` and `Drawer` render through a React portal, and
`renderToString` does not traverse portals.

**Fix** — split the flow into `ConnectSourceWizard` (assertable) wrapped by
`ConnectSourceModal` (dialog chrome only).

**Guard** — *documented* (`CLAUDE.md` commands): keep dialog content in its own
component. Better structure anyway — the separation is why the wizard is
testable.

---

## Profiled counts contradicted their own semantics

**Symptom** — the Catalog showed real table and column counts for a freshly
registered source, while the UI copy said counts "stay 0 until the Metadata
Profiler has run".

**Root cause** — Catalog rows were populated from `db.json`'s table data at
registration time, which conflated registering with profiling.

**Fix** — connected rows report `profiled_tables`/`profiled_columns` (0 until a
job runs) and `quality: null`.

**Guard** — *documented* (`CLAUDE.md`): registration is instant, profiling is a
separate async event. Do not "fix" a zero by reading it out of `db.json`.

---

## Test assertion was wrong, not the code

**Symptom** — a suite reported `1 FAILURES` on `validateDb`, and separately
`20 FAILURES` on the sources API.

**Root cause** — both were the harness's fault. The first asserted 7 problems
where 8 was correct (7 missing keys **plus** one wrong shape). The second ran
against a stale server on port 4000.

**Fix** — corrected the assertion; re-ran the second suite on a spare port.

**Guard** — *documented*: when a suite fails, check the assertion and the
environment before changing the code. Report which it was — a fixed test that
was never broken hides a real defect.

---

## A stale server's old shape read as a schema bug

**Symptom** — saving in the New Graph wizard failed with `use_case.personas
should be an array, got undefined; use_case.kpis …; (+3 more)` — seven fields
undefined at once. The message points at the schema, so the hunt starts in
`client.ts` and `savedUseCase`, both of which were correct.

**Root cause** — the mock server process had been started before the commit that
added the step 2–7 fields, and `db.json` is read once at startup: the file on
disk was current, the process answering was not. `GET /graph-use-cases` returned
only the eight original keys.

**Fix** — restart `npm run mock`. No code was wrong.

**The worse half.** Every save also wrote that stale document back, so
`db.json` silently lost `graph_personas`, `graph_kpis`, `graph_hero_questions`
and `graph_answer_formats` — four keys no route the user touched had anything to
do with. `commitDb`'s `validateDb` is exactly the guard against this, and it
works going forward; it could not fire here because the running process predated
the keys and so did its copy of the required list. `npm run check-docs` caught
the loss, and the keys were restored from `git show HEAD:mock-server/db.json`.
**A stale server is a data-loss bug, not just a display bug** — kill it before
saving anything else.

Restarting onto the damaged file then failed a second way: the new process
booted fine and only broke inside a route (`Cannot read properties of undefined
(reading 'map')` from `/graph-personas/suggest`), because nothing validated the
document at startup.

**Second guard** — *mechanical* (`server.mjs`, before `server.listen`):
`validateDb(db)` runs at startup and the server **refuses to boot** on a
document the routes cannot serve, listing the missing keys and the restore
command. A write was already guarded; a boot was not.

**Guard** — *diagnostic* (`assertCurrentUseCaseShape` in `client.ts`): when a use
case carries **none** of the seven newer fields, the client throws
"…predates steps 2–7 … restart it: npm run mock" instead of listing the fields.
It fires on both `listUseCases` and `saveUseCase`. The check must live in the
client — a server running old code cannot warn that it is running old code. It
only triggers when *every* newer field is absent, so a genuine one-field bug
still gets the field name rather than being blamed on the server's age.

---

## A stale server dropped a *nested* key nobody was guarding

**Symptom** — the `graph_studio.canvas` seed vanished from `db.json` minutes
after it was written. `validateDb` passed, the server started fine, and only the
missing tab gave it away.

**Root cause** — the same stale-process write-back as before, one level deeper.
`commitDb` writes the whole in-memory document, and a process started before
`canvas` existed carries a `graph_studio` without it. `DB_SHAPE.graph_studio`
only checked `review_items`, `generated` and `pivot`, so the write validated and
the key was lost silently.

**Fix** — re-seeded from the edit, and killed the process before it could do it
again.

**Guard** — *mechanical* (`DB_SHAPE.graph_studio` in `server.mjs`): the check now
requires `canvas.nodes` and `canvas.edges` too, so that write is refused with a
message naming the key. **A top-level-only shape check cannot see nested loss** —
when a seeded section grows a sub-object the app depends on, add it to the shape
check at the same time, or the next stale server deletes it for free.

---

## "published v16" named a version nobody had seen

**Symptom** — the Graph Studio list showed `published v16` on a graph whose
publish had produced **v15**. The number on screen matched nothing in the
Versions table.

**Root cause** — one field doing two jobs. `version` was `15 + publishedCount`,
so it meant "the working draft", while `state` flipped to `published` after the
first publish. Rendered as one tag, `{state} {version}` read as a claim about
v16 — which is the *next* draft, not anything live.

**Fix** — the summary now returns `version` (the working draft) **and**
`last_published_version` (what is live, or null). The card and the header show
`draft v16` beside `live v15`.

**Guard** — *mechanical* (`client.ts` schema + a rendered assertion): the API
carries both fields, and the smoke test asserts the pair after a publish —
`version` is v16, `last_published_version` is v15, and the string
`published v16` never appears. **Rule** — a draft version and a live version are
two facts; one tag rendering both is how they get confused.

---

## Fourteen endpoints had no schema, all of them writes

**Symptom** — none yet, which is the point: `CLAUDE.md` promised "add a schema
whenever you add an endpoint", and an audit found fourteen exported fetchers
returning payloads straight to the UI with no boundary check —
`oauthStart`, both registrations, the generic one, `disconnectSource`,
`deleteSource`, both allowlist updates, `listProjectDatasets`, both `profile*`
calls, both `PATCH` note savers, `cancelProfilingJob`, `deleteUseCase` and both
`/db` writes.

**Root cause** — the rule was read as being about *reads*. Every one of the gaps
was a write, whose result is rendered or stored just the same: a registered
source goes into a table, a queued job goes onto the jobs board and is polled, a
saved section re-renders the editor.

**Fix** — schemas for all of them, reusing `SOURCE_ROW` and `JOB` where the shape
already existed.

**Guard** — *mechanical* (`scripts/check-docs.mjs`): an exported fetcher that
calls `request()` must also reach `validate()`, directly or via a helper that
does. Verified by stripping one fetcher's schema and watching `check-docs` name
it. **A doc line could not hold this** — it had already failed to, fourteen times.

**Also learned** — `nullable()` permits an absent key, not just `null`, so a
nullable field's schema checks its type rather than its presence. Where the key
must exist, do not make it nullable.

---

## check-docs reported "0 of 0 connectors available" on Windows

**Symptom** — `npm run preflight` failed on `at least one connector is usable:
0 of 0 available`, with `connectors.ts` untouched and both real connectors
plainly `available: true`. Every per-connector claim silently passed too, because
the loop it fed had nothing to iterate.

**Root cause** — `scripts/check-docs.mjs` split the file on `/\n {2}\{\n/`. Git
checks these files out with CRLF on Windows, so the text is `\r\n  {\r\n` and the
trailing `{\n` never matched. The parse returned zero connector blocks, and a
check with nothing to check reported the code as broken.

**Fix** — `/\r?\n {2}\{\r?\n/`. Twelve claims came back (38 → 50 verified).

**Guard** — *mechanical*: the fix is the guard, and the check now proves itself —
a zero-length parse can no longer masquerade as a passing sweep. **Rule for any
new assertion in `check-docs.mjs`: match `\r?\n`, never a bare `\n`.** A doc-gate
that fails for a reason unrelated to the docs trains everyone to ignore it, which
is worse than not having it.

---

## A deleted button left a prop that broke the build

**Symptom** — `npm run build` failed on two `TS6133` errors that had nothing to do
with the change in hand: `onStartNew` unused in `NewGraphPage.tsx`, `BuildOutlined`
unused in `nav.ts`. `npm run lint` reported both as *warnings*, so a lint-only
check looked clean.

**Root cause** — the "Start a use case" button was removed from the empty saved-use-cases
panel but its prop, its handler and the call site stayed; `BuildOutlined` was left
behind when two nav entries were commented out. `noUnusedLocals` is on, so both
are errors to `tsc` and warnings to oxlint.

**Fix** — restored the button the panel's own comment promises ("offer the one
thing that fills it"), and dropped the unused icon import, naming it in the
commented-out entries so it comes back with them.

**Guard** — *mechanical*, and it already existed: `tsc` fails on both. The lesson
is about which gate to trust — **oxlint warnings do not fail the build and `tsc`
does, so never conclude a refactor on `npm run lint` alone.** `npm run preflight`
runs both; that is the only signal that counts.

---

## A plain `.env` pointed `npm run dev` at the production box

**Symptom** — New Graph kept drafting the *old* personas, KPIs and hero questions
however many times Suggest was clicked. `curl localhost:4000` returned the new
ones correctly; the browser, on the same machine, did not. Two rounds were lost
to "the mock server must be stale" — it was current, and restarting it changed
nothing because it was never being called.

**Root cause** — `VITE_API_BASE=http://18.205.228.143:4000` lived in a plain
`.env`, and Vite loads `.env` in **every** mode. So `npm run dev` skipped its own
`/api` proxy and called the deployed EC2 box, which runs older code against an
older `db.json`. `.env.development` and `.env.production` — the two files
`CLAUDE.md` describes — had never existed.

**Fix** — split it: `.env.development` = `/api` (the proxy), `.env.production` =
the deployed origin, plain `.env` deleted. Mode files take precedence over
`.env`, so development now reaches the local mock server again.

**Guard** — *mechanical*. `check-docs` already asserted both mode files exist and
had been **failing on exactly that for the whole session**, dismissed as
"pre-existing and unrelated". So the guard is doubled with one that names this
failure directly: `no VITE_API_BASE in a plain .env`. The wider lesson is about
reading the gate rather than the code — **a red `check-docs` claim is a
description of a live fault, not background noise. Do not diagnose past a
failing assertion; the environment claims are the ones most likely to explain a
symptom that makes no sense.** A local API that answers correctly while the app
disagrees means the app is not talking to it: check `VITE_API_BASE` in the
Network tab's request URL before suspecting the server.

---

## The connect wizard told everyone they were somebody else

**Symptom** — every user who connected a BigQuery or Drive source saw
`Connected as karthik.mahadeva@vriodigital.com`, whoever they had signed in as.
Nothing errored; the wizard simply reported the wrong human at the one moment it
claims an account is being linked.

**Root cause** — `GET /sources/oauth/callback` answered every caller with
`db.google_account`, a seeded record in `db.json`. The console's identity is
client-held (`useAuthStore` → `localStorage`), so the server had no session to
read the real user from and nobody had ever passed it one.

**Fix** — the callback takes `as=<email>`; `ConnectSourceWizard` reads
`identity?.email` from the auth store and both `oauthCallback` and
`driveOauthCallback` send it through one `callbackPath()` helper. **The alert
renders `signedInAs ?? account.email`, store first** — the server-side half alone
was not enough: the seeded email came back the moment the page was pointed at an
API that had not been updated (see the plain-`.env` entry below — dev was calling
the deployed box, so a fixed local server changed nothing on screen). Who is
connecting is a client fact here: the login authenticates by shape and the consent
proves well-formedness, not identity, so the store is the authority and the `as=`
round-trip only keeps the API's answer honest for anyone reading it. The name that
comes back is derived from the email (`displayNameFromEmail`, the twin of
`emailInitials`) rather than invented. `db.google_account` stays the fallback for
a caller that names nobody — a curl, the route list — and a malformed `as` is
refused with a sentence instead of quietly falling back to the seed, because
connecting as the wrong person is the whole bug.

**Guard** — *mechanical*: four `check-docs` claims, one per leg of the path
(the server reads `as` and no longer sends `account: db.google_account` from that
route; the client sends `&as=${encodeURIComponent(signedInAs)}` via `callbackPath`
for both connectors; the wizard takes the email from `useAuthStore` and passes it
in both branches; both alerts render `connectedAs`, and neither renders
`account.email` directly). Any one of the four going missing restores the seeded
email in silence, which is why a doc line could not hold this.

**Also learned** — a server-side fix is not visible until the app is calling that
server. The first round of this landed correctly in `server.mjs` and the screen did
not change, because `.env` pointed `npm run dev` at the deployed box. **When a fix
provably works against `curl` and the UI still shows the old value, check
`VITE_API_BASE` before changing the fix.**

**Rule** — **client-held identity has to be *sent*.** A server route that reports
who did something cannot look the user up; if it names a person and was not told
who, it is naming a seed. `triggered_by` in the audit payload and
`approved_by` / `published_by` in Graph Studio still read `db.google_account` —
they are seeded provenance, not the signed-in user, and should not be read as it.

---

## A `_2` column whose `_1` appears nowhere

**Symptom** — the Gold view `e_manifest` (50 columns, over a 50-entry
`column_vocabulary`) rendered `manifest_tracking_number_2`,
`generator_epa_id_2`, `frs_registry_id_2` — while the unsuffixed names appeared
in no table at all. It reads as a dictionary that lost half its rows, or as a
duplicate-column bug in the profiler.

**Root cause** — `tableDictionary` (and `documentDictionary`) suffixed by *lap*:
`cycle = floor((offset + i) / vocab.length)`. The slice deliberately starts at a
hashed offset, so the lap boundary falls in the middle of the list; every entry
before the offset was reached on lap 1 and got `_2`, and lap 0 never covered it.

**Fix** — suffix on collision *within that table or document* instead of by lap:
count uses of each name and append `_${seen}` only from the second. Ids stay
unique and deterministic; a table no wider than the vocabulary now has no suffix
at all, and `e_manifest_all` (92 over 50) has exactly 42.

**Guard** — *documented*, and deliberately so: uniqueness is what the code must
guarantee and it still does either way, so nothing can fail a build over
cosmetics. The rule is in `SKILLS.md` § Flow 4 — **a `_2` is only ever a second
copy** — and the reason is in the comment above the counter.

---

## `renderToString` renders a zustand store's *initial* state

**Symptom** — an SSR smoke test loaded a store (`await
useDocumentsStore.getState().load(id)`, verified: 7 documents, no error), rendered
`ProfiledDocumentsPanel`, and got antd's "No data" empty state. Worse than a plain
failure: the negative assertion in the same test — "no old facet label survives" —
**passed**, because nothing at all had rendered.

**Root cause** — zustand v5's `useStore` passes `api.getInitialState` as
`useSyncExternalStore`'s third argument, the *server* snapshot. `renderToString`
uses that branch, so every zustand-driven component renders the state the store
was created with, no matter what has been loaded into it since.

**Fix** — in the scratch smoke only, make the server snapshot the live one before
rendering:
`React.useSyncExternalStore = (sub, get) => real(sub, get, get)`. zustand reads
the property off the `React` default export at call time, so assigning it works
inside a bundle.

**Guard** — *documented* (this entry and the note in `CLAUDE.md` § verification):
the shim belongs in throwaway test code, not in `src/`. The transferable rule is
the assertion habit — **when asserting that something is absent from rendered
HTML, assert in the same test that the data-bearing render happened at all.**
Two "passes" in this repo have now been passes over nothing (see also the
`\r?\n` split that swept an empty connector list).

**Also** — the effect-driven parts of a panel do not render under SSR either: the
column and entity tables expand from a `useEffect`, so their rows are absent.
Assert those against the payload, not the HTML.

---

## A consent screen that described fewer scopes than it requested

**Symptom** — the new Google sign-in window listed one permission for Drive
("See information about your Google Drive files") and the user pressed Allow on
it. `/sources/oauth/start?provider=drive` returns **two** scopes:
`drive.metadata.readonly` *and* `drive.readonly` — the second grants reading file
contents, which is what profiling needs. The screen collected agreement for less
than the handshake asked for. CLAUDE.md named one scope too, so the doc agreed
with the bug.

**Root cause** — the dialog kept its own per-provider list of grants. Any list
maintained beside the thing it describes drifts from it; this one was wrong the
day it was written.

**Fix** — the dialog renders `start.scopes`, the array the endpoint returned.
`CONSENT_GRANT_COPY` supplies wording keyed by scope URL and nothing else; a scope
with no entry renders as its bare URL, which is unexplained but not hidden.

**Guard** — *mechanical*: `check-docs` collects every
`https://www.googleapis.com/auth/…` string in `server.mjs` and fails if any lacks
copy. Adding a scope to the server without describing it fails the build; adding
one without listing it is now impossible, because the list is the response.

**Rule** — **a screen that collects consent must render what was requested, not
what it expects to be requested.** The same reasoning as "never show a cost figure
the server did not report", pointed the other way: never show a smaller promise
than the one being made.

---

## A doc-drift guard that broke on a renamed local

**Symptom** — `check-docs` failed with "the connect wizard takes that email from
the auth store: BigQuery and Drive both pass signedInAs to their callback" after
the sign-in became a click-through. Both connectors still passed `signedInAs`; the
fact was true and the check was red.

**Root cause** — the assertion matched `oauthCallback(start.state, signedInAs)`
literally. Splitting the handshake into open-then-allow moved the state into a
`oauthState` state variable, so the pattern missed. A second attempt matched
`\bo(?:authCallback|OauthCallback)` and still missed, because in
`driveOauthCallback` the capital O has no word boundary before it.

**Fix** — match the argument, not the local: `(?:drive)?[oO]authCallback\([\w.]+,
signedInAs\)`.

**Guard** — *documented*, plus the habit: **assert the fact, not the spelling.**
A claim keyed to a local variable name fails on a rename and teaches the next
session that the check cries wolf — which is how the `.env` claim came to be
ignored for a whole session. When adding a `check-docs` pattern, ask what would
have to become *false* for it to fail, and match that.

---

## An optional-in-practice source name

**Symptom** — the wizard's "Source name" field could be left blank and the source
registered anyway, as `vrio-contextweave-demo` (BigQuery) or `Compliance Docs`
(Drive). A one-character name passed too. The Sources table, the Catalog tab and
every profiling job row key off that string, so two sources from one project were
indistinguishable and nothing downstream could fix it.

**Root cause** — three fallbacks, each reasonable alone:
`source_name || project.display_name || project_id` on the server, `sourceName ||
projectId` in `finishBigQuery`, `values.sourceName || selected.name` in
`finishGeneric`. The generic connector's field was already `required: true`, so the
form *asked* — and the code answered for the user when they declined.

**Fix** — `SOURCE_NAME_MIN = 6` and a shared `sourceNameProblem` on both sides.
All three register endpoints refuse; every fallback removed, so a missing name is
now a 400 rather than an invented label. The wizard checks the same rule before the
round trip and shows the error only once the field has been touched.

**Guard** — *mechanical*: `check-docs` asserts the server's and the client's
minimum are the same number, that each of the three endpoints calls
`sourceNameProblem`, and that **no fallback pattern comes back** (`source_name ||
project.` / `sourceName: sourceName ||`). The last one is the important one: the
validator could stay in place while a fallback quietly reintroduced the bug.

**Rule** — **a fallback for a required field makes it optional.** If the form asks
for something, the code must not answer on the user's behalf; `||` on a
user-supplied value is where "required" goes to die.

---

## A doc-count guard that one true claim covered for

**Symptom** — `SKILLS.md` said `validateDb` verifies "all 19 required keys" while
`CLAUDE.md` said 20 and the code guarded 20. `check-docs` was green.

**Root cause** — the assertion was a single `||` across both files:
`skills.includes('20 required keys') || skills.includes('all eight required keys')
|| claude.includes('20 required')`. CLAUDE.md's correct claim satisfied it, so
SKILLS.md's stale one was never looked at. The check asked "does *someone* say the
right number", not "does everyone who says it say it right".

**Fix** — each file is asserted where it makes the claim: every `N required keys`
in either document must equal the guarded count, and a separate claim requires at
least one of them to state it. (The count is 21 now — `column_profiles`.)

**Guard** — *mechanical*, and the lesson is about the shape: **an `||` across
sources makes a guard as weak as its most-correct source.** Assert each source
that makes a claim, and keep the "someone must say it" requirement separate from
"whoever says it must be right".

---

## Reading xlsx: attribute order is not a contract

**Symptom** — a zero-dependency xlsx reader returned an empty workbook for
`Metadata_Profiling.xlsx`. No error: `Object.keys(wb).length === 0`, which read
as "the file has no sheets".

**Root cause** — the relationship parser matched
`<Relationship[^>]*Id="…"[^>]*Target="…"` — one regex spanning two attributes, in
that order. This workbook writes `Type`, then `Target`, then `Id`. XML makes no
ordering guarantee, so every sheet failed to resolve and the loop produced nothing.

**Fix** — read each attribute with its own pattern, and throw
`no sheets resolved` rather than returning `{}`.

**Guard** — *diagnostic* (the reader is a scratch tool, not shipped code): it now
fails loudly instead of returning an empty result. The transferable rule is the
same one the `check-docs` rename taught — **never match two independent things
with one ordered pattern**, whether that is XML attributes or a function call and
its argument. Also: **a parser that can return empty must say so**, because
"parsed fine, found nothing" is indistinguishable from "the input was empty".

---

## Five connectors drawn as BigQuery

**Symptom** — latent until step 1 of the wizard got icons: `ConnectorIcon` ended
`return <BigQueryIcon size={size} />`, so GCS, S3, PostgreSQL, Snowflake and
MongoDB would each have rendered the BigQuery mark. Not a missing icon — a card
wearing the wrong vendor's logo.

**Root cause** — a fallback chosen for convenience when only two connectors were
ever rendered. `ConnectorIcon` was called in two places, both of which only ever
saw `bigquery` or `gdrive`, so the wrong branch was unreachable and stayed wrong.

**Fix** — a `MARKS` map with all seven keys, and a `GenericSourceIcon` fallback:
a neutral grey cylinder whose `aria-label` names the key it did not recognise.

**Guard** — *mechanical*: `check-docs` reads the keys out of `CONNECTORS` and the
keys out of `MARKS` and fails if any key lacks a mark, plus a second claim that the
fallback is the neutral one rather than a vendor mark. Adding a connector now fails
the build until it has its own drawing.

**Rule** — **a default that misidentifies is not a default.** A fallback may be
plainer than the real thing (grey cylinder, bare scope URL, the email instead of a
name) but it must not assert something false. And a wrong branch that nothing
currently reaches is still wrong: it is waiting for the feature that reaches it.

---

## A guard's own regex, twice, on the same mistake

**Symptom** — the new "every connector key has a mark" claim failed with
`marks ` — an empty list — while all seven marks were present.

**Root cause** — `const MARKS[^=]*= \{` . The declaration's type annotation is
`Record<string, (props: { size?: number }) => JSX.Element>`, which contains both an
`=` (in `=>`) and a `{`, so `[^=]*` stopped inside the annotation and the body
never matched. This is the third time in this repo a doc-guard pattern has failed
on the *shape* of the code rather than its meaning — after `\n` vs `\r?\n` and
`oauthCallback(start.state, …)`.

**Fix** — locate `const MARKS`, then `= {` after it, then slice to `\n}`. Two
steps, no single pattern spanning independent things.

**Guard** — *documented*, plus the negative test habit: **every new `check-docs`
claim gets deliberately broken once before it is trusted.** All three of these
failures looked like a stale doc and were a stale regex; the empty-list output is
the tell — a guard reporting "0 of N" is describing itself, not the code.

---

## `why` overwritten by `detail`, and a step that showed neither

**Symptom** — after ingesting the use-case brief, every drafted hero question's
`why` read "The core liability question — connects inbound manifests to generator
compliance records." A keyword-ranked question no longer said it had been
keyword-matched, which is the one thing CLAUDE.md requires a suggestion to say:
*"A suggestion nobody can explain is worse than no suggestion."*

**Root cause** — the brief states a *why* per question, and the obvious slot
looked like `Suggestion.why`. It is not: `why` is why **this suggester** drafted
the row, `detail` is what the row **is**. Overwriting the first with the second
lost the provenance and left `detail` empty — the field a persona uses for `focus`
and a KPI for `definition`, and which hero questions had never filled.

Compounding it: `HeroQuestionsStep` rendered *neither* field. So the brief's
reason would not have appeared anywhere, and the missing `why` was invisible.

**Fix** — `detail: focus ?? definition ?? rationale ?? format`, `why` untouched,
and the step now renders both lines in the same two voices `DraftedStep` uses.

**Guard** — *diagnostic*, in the comment on `asSuggestion`: the two fields are
named for the questions they answer, and the comment says neither may stand in for
the other. A mechanical check would have to assert copy, which is the "assert the
fact, not the spelling" trap.

**Rule** — **before reusing a field, read what it is for.** An empty field is not
a free field: `detail` was empty for hero questions because nobody had given them
one, not because it was available. And when adding data to a payload, check the
component actually renders the field — this one shipped two fields into a step
that displayed neither.

---

## An SVG chart that scaled its own text to 28px

**Symptom** — the bar chart in an Ask answer rendered enormous: rows about 65px
tall, category labels and value labels at roughly 28px, one chart filling the
screen. Nothing was wrong with the drawing — every proportion was correct.

**Root cause** — `.ab-svg { width: 100%; height: auto }` over a `viewBox="0 0 560
…"`. An SVG with a viewBox scales its *entire coordinate system* to the rendered
box, so in a ~1400px answer column the whole drawing was multiplied by 2.5 —
including the 11px `font-size` on every label. The CSS was written as if the SVG
were an image that would be laid out at its natural size and only shrink.

**Fix** — each chart caps itself at its own viewBox width inline
(`style={{ maxWidth: width }}`), so it can shrink but never grow. Row height and
the label/value columns were tightened too (26 → 20px rows, 560 → 520 wide).
The HTML-drawn forms — the stacked bar and the meter — got the same ceiling in CSS.

**Guard** — *documented*, plus an assertion in the scratch smoke that reads the
`viewBox` width out of the rendered markup and requires `max-width` to equal it.
A `check-docs` claim would have to assert a CSS number against a TSX constant,
which is the "assert the fact, not the spelling" trap; the cap living inline
*beside* the constant is what actually keeps them equal.

**Rule** — **`width: 100%` on a viewBox SVG is a zoom control, not a layout
rule.** If the drawing carries text at a chosen px size, that size only means
anything at 1:1 — so cap the upscale. This is also why the cap belongs in the
component: the component knows its viewBox width, and a magic number in a
stylesheet drifts from it silently.

---

## `text-overflow: ellipsis` on a flex container does nothing

**Symptom** — Ask's suggestion chips showed the *middle* of a hero question with
no "…" at either end: "Park are under active RCRA enforcement, and how mu". The
stylesheet already said `text-overflow: ellipsis`.

**Root cause** — the rule was on the antd `Button`, and an antd v6 button is
`display: inline-flex`. `text-overflow` applies to a block container's own inline
content; on a flex container it has nothing to act on, because the label is a flex
*item*. The item kept its full width, the button's `overflow: hidden` cut it, and
because a flex item is centred in a box too small for it, it was cut at **both**
ends — which is why the chip read as a fragment rather than a truncation.

**Fix** — the ellipsis moved to the inner span antd wraps the label in, with
`min-width: 0` so a flex item may shrink below its content at all. The button keeps
`max-width` and `overflow: hidden`.

**Guard** — *documented*, plus a scratch assertion that renders a real
`<Button>` and requires the stylesheet's selector to match the markup antd
actually produced. That is the fragile part: the rule depends on antd wrapping the
label in a span, so the test asserts the wrapper exists rather than trusting it.

**Rule** — **check which box a text property is acting on.** `text-overflow`,
`white-space` and `line-clamp` need a block container with inline content; antd v6
makes buttons, and much else, flex. The tell for this failure is text clipped at
*both* ends: that is a centred flex item, not a truncation.

---

## "Save & build graph" that built instantly and left

**Symptom** — pressing step 7's build button committed the brief and navigated to
Graph Studio on the same tick. Nothing said a build had run, so the one moment a
user wants confirming that the work happened showed them nothing — and a graph
appeared to be built by pressing a button.

**Root cause** — committing *was* the build. `POST /graph-use-cases` with
`status: committed` is one synchronous write, and the handler followed it with
`navigate(...)`. Nothing in the product modelled a build as work.

**Fix** — `POST /graph-studio/:id/builds` → 202 with a queued run, polled by id:
the same contract as a profiling job and the step 6→7 derivation, reusing the
established pattern rather than inventing a third. Eleven named stages advance on
server timers and Graph Studio's new **Build** tab fills the list in. The wizard
starts the run at the click and then hands over.

**It belongs in the studio, not the wizard** — that was the second attempt. A graph
is built more than once: settling review rows changes what a build produces, so
rebuilding is the normal case and the runs need a home where they can accumulate.
The first version put the panel in step 7, where a rebuild had nowhere to live.

**Guard** — *mechanical*: `check-docs` requires every `BUILD_STAGES` entry to be
named in `SKILLS.md`, that the endpoint answers 202 with a queued run, that the tab
and store are the studio's, that the wizard starts the run and navigates to the
Build tab, and that `startBuildFor` never touches `studioPublished` — building must
not publish.

**Rule** — **work that takes time must look like it takes time, and a thing done
more than once needs a home that can hold more than one of it.** The corollary
matters as much: the commit *is* instant, which is why it is stage one
(`pin_inputs`) rather than something the panel pretends to spend time on.

---

## A server field renamed, the client schema left behind

**Symptom** — opening Graph Studio: *"The graph build could not be read — the data
did not look the way this app expects. Restarting the mock server (npm run mock)
usually fixes it. Details: draft_version should be a string, got undefined."* The
message points at a stale server, and the server was fine.

**Root cause** — `buildView` was changed to emit `config_version` when a version
became a build; `GRAPH_BUILD` in `client.ts` still required `draft_version`.
**TypeScript cannot see this.** `RawGraphBuild` is a *claim* about what the server
sends, not a check of it, so the rename compiled cleanly on both sides and failed
only at the runtime boundary.

The test hole is the more useful half: the client-side build test replayed
`payloads.json` **captured before the rename**. A fixture older than the code
proves the code agreed with the fixture, not with the server.

**Fix** — renamed the schema, the raw type, the mapper and `BuildTab`'s two usages.

**Guard** — *mechanical*: `check-docs` extracts the field names out of `buildView`
and out of `GRAPH_BUILD` and requires the two lists to match, naming both when they
diverge. Verified by renaming a server field and watching it fail.

**Rules** — two of them:

- **A field name is a contract across two languages, and the compiler only checks
  one side.** When renaming anything a payload carries, grep the snake_case name,
  not just the camelCase one.
- **Re-capture fixtures after changing the thing they came from.** A recorded
  payload is a snapshot of an agreement; replaying an old one tests the snapshot.
  The message this bug produced ("restarting the mock server usually fixes it") is
  also a reminder that a *diagnostic* aimed at the common cause will confidently
  misdirect when the cause is something else.

---

## Twenty relationships drawn as nothing at all

**Symptom** — none, which is the problem. The canvas drew the demo package's
knowledge graph and 17 facilities appeared to carry no enforcement, three alias
names were absent, and every count on screen agreed with every other count. No
error, no empty state, no warning.

**Root cause** — `knowledge_graph.json` has 92 edges and 89 nodes, and 20 of those
edges point at ids the node roster does not contain: `NAME:Texas Molecular`,
`NAME:Texas Molecular LP`, `NAME:VLS Texas Molecular LP` (declared only by
`RESOLVES_TO`'s `from`, "raw name / alias") and `ENF:(various)`, the placeholder
`RCRA_compliance` uses when it reports a count and a penalty without a type.
`GraphCanvas` skips an edge whose endpoint it cannot find — correctly, since it has
nowhere to draw it — so the graph silently lost 22% of its relationships.

The tempting fixes are both worse. Dropping the edges says those facilities have no
enforcement, which is the opposite of what the source says. Retargeting them at one
of the five real enforcement types invents a fact the source declined to state.

**Fix** — the ingest materialises the four endpoints as the things they are: three
`Alias` nodes carrying their resolution method and confidence from the Entity
Resolution sheet, and one `EnforcementType` labelled *"Enforcement (type not
itemised)"* with a review row attached, so the placeholder is visible as an open
question rather than passed off as a dimension value.

**Guard** — *mechanical*, two of them: `validateDb` walks `graph_studio.canvas.edges`
and refuses to boot — or to write — a document with an endpoint that is not a node,
naming the id and the side; and `check-docs` compares the canvas against the package
file, so the node and edge counts cannot drift from the source they were ingested
from. Both were broken on purpose to confirm they bite.

**Rule** — **a renderer that skips what it cannot draw needs a validator that
refuses what cannot be drawn.** "Skip the malformed one" is right in the component
and wrong as the whole answer: silence is the only failure mode nobody debugs,
because it looks like an answer.

---

## A label rule that hid the one question the graph exists for

**Symptom** — *"What does the chemours consent decree say about the facility we
accept waste from?"* — the payoff question the package's own overview names — came
back *"No entity in this graph is named in the question."* The facility, the consent
decree and the edge between them were all present.

**Root cause** — `studioQuery` matched a question word to a node only if that word
appeared in **exactly one** label. It was written for the old seed, where every
entity had a distinct name, and it is precisely wrong for entity resolution: the
Chemours facility, `chemours-cd.pdf` and `chemours-cp.pdf` share "chemours" *because
they are about the same company*. The rule threw out its own bridge.

Relaxing it to plain rarity then produced the opposite failure — the same question
answered over `Chemours → VLS → Sprint Waste Services`, because "waste" and
"facility" were rare enough to count. A confident answer about a pair nobody asked
about is worse than an abstention. A third pass matched *The* Chemours Company
Fayetteville Works on the word "the", which is rare across these labels.

**Fix** — three conditions instead of one: a word must be at least four characters,
must not belong to the ontology's own vocabulary (the stoplist is built from the
canvas's `type` values and edge labels, split on camelCase and underscores, so
`Facility` stops "facility" and `WasteCode` stops "waste" and "code"), and must name
no more than 5% of the nodes.

**Guard** — *mechanical*: `check-docs` asserts the stoplist and the rarity test are
both in the matcher, so a revert to bare uniqueness fails the build. Behaviour was
confirmed against a live server across seven questions — the bridge answers, a
type-word question and a common-word question both abstain, and two real nodes with
nothing between them still say exactly that.

**Rule** — **a matcher's threshold is a claim about the data, so re-derive it when
the data changes.** Uniqueness was a reasonable rule for eight invented entities and
a wrong one for a graph whose whole purpose is that two records name the same thing.

---

## Eight canvas claims passed while comparing against nothing

**Symptom** — `check-docs` reported the canvas agreed with the demo package on every
count. It had not compared them at all: each claim's detail line read *"the package is
not in this checkout — nothing to compare against"*, and nobody read the details of a
passing claim.

**Root cause** — the repo-wide removal of the word "VLS" ran over `check-docs.mjs` as
well as the app, turning `vls_demo_data_package_…` into ` _demo_data_package_…` — a
leading space and a missing directory name. `kg` was guarded with
`existsSync(kgPath) ? … : null` and every claim was written `kg === null || <real
test>`, so a path that could never resolve made all eight vacuously true.

**Fix** — corrected the path, asserted that it *exists* as its own claim, asserted the
ingest script reads the same two paths, and dropped the `kg === null ||` escape from
every claim below so they can only pass by actually agreeing.

**Guard** — *mechanical*: the path's existence is now claim #1 of the block, so the
whole block cannot silently skip. Breaking the path fails the build instead of
turning eight claims green.

**Rule** — **a guard whose good answer is its own inability to run is describing
itself.** This is the fourth `check-docs` claim in this repo to fail open (after `\n`
vs `\r?\n`, a renamed local, and a `=>` in a type annotation), and each one reported
an empty or absent list. When a claim can be satisfied by *finding nothing*, assert
that it found something first.

---

## The graph rebuild left a legend colour with no members

**Symptom** — after ingesting the rebuilt `knowledge_graph.json`, the canvas legend
still offered **column value → dimension** as one of its four origin classes. Nothing
errored; the chip simply counted 0 forever.

**Root cause** — the package was rebuilt as spec-faithful AGB Layer 1, and its
`not_nodes` block records that the three column-value node types (`WasteCode` 13,
`ViolationType` 9, `EnforcementType` 5) were **deliberately** retired: a code carried
on a row is an attribute of the shipment, not an entity with its own registry. The
`dimension` hue encoded a build rule the graph no longer follows.

**Fix** — the class became `schema` (type-level → concept / measure), covering the 7
concept and 3 measure-element nodes that the rebuild *added* and that no hue described.
Four hues either way, palette unchanged, so the pairwise contrast work still stands.

**Guard** — *mechanical*: `check-docs` asserts every legend hue has members on the
canvas (it always did), plus two new claims — that the retired types are absent from
the canvas, and that `dimension` is gone from the legend, `CANVAS_GROUPS` and the
`CanvasGroup` union. The second is **scoped to the canvas vocabulary**: a first
attempt searched the whole of `client.ts` for the token and failed on the profiler's
eight column classes, which include an unrelated `dimension`.

**Rule** — **a facet stuck at 0 reads as "none in this corpus", not as a broken map**
— and a legend row is worse than a facet, because it also advertises a claim the data
denies. When ingested data changes shape, re-derive the categories rather than
re-pointing them.

---

## A concept node was matched as an instance

**Symptom** — "tell me about the Denka facility please" came back *"Facility and Denka
Performance Elastomer LLC are both in the graph, but nothing connects them yet."* The
facility and its own CAFO document are one hop apart.

**Root cause** — the rebuild added 7 type-level `Concept` nodes labelled exactly
"Facility", "Manifest", "Document". The matcher's stoplist already refused the *word*
"facility", but the whole-label shortcut (`asked.includes(n.label.toLowerCase())`) ran
before the stoplist and matched the node whose entire label is that word. Two paths
into the matcher, one rule between them.

**Fix** — concepts are excluded from instance matching (`element_class !== 'concept'`,
because a concept *is* the type), and the whole-label shortcut now clears the stoplist
too.

**Guard** — *mechanical*: `check-docs` asserts both halves are in the matcher, and the
smoke run asserts a question containing "facility" matches only real entities while
still answering over the facility→document hop — the failure mode is not "abstains",
it is "answers about the wrong pair", so both directions are checked.

**Rule** — **a stoplist on words does not cover a node whose whole label is one of
them.** When new data changes what labels look like, re-check every path into the
matcher, not the one the rule was written for.

---

## The demo package contradicted itself about a retired edge type

**Symptom** — nothing visible. The ingested sanity check sc3 told the reader
"Generator facilities carry HAS_ENFORCEMENT edges" and planned
`MATCH (f:Facility)-[:HAS_ENFORCEMENT]->(:EnforcementType)`, against a graph that has
neither.

**Root cause** — `graph_studio.json`'s prose was written against the previous build.
Its own `traversal` block correctly walks `ENFORCEMENT_AGAINST` to an `Enforcement`
event, and only the traversal resolves against the roster — so the package disagreed
with itself and just one reading was possible.

**Fix** — the ingest rewrites those three strings (`PROSE_FIXES`) with the correction
stated in a comment, since a re-ingest must not quietly restore them.

**Guard** — *mechanical*: `check-docs` asserts no verdict, chip or plan names a
retired type, and that every relationship a plan matches on (`[:X]`) is one the graph
has. The claim took two attempts: refusing the names outright failed on the check that
says *"no WasteCode node"* — which is the correct thing to say — and an earlier pass
keyed to "any SCREAMING_SNAKE word" failed on `EPA_ID` and an `LDR_SET` inside a
Cypher comment. It now fires only on a retired type asserted as one the graph **has**,
verified in both directions against sc3's pre-fix and post-fix prose.

**Rule** — **when ingested data contradicts itself, resolve toward the half that
resolves against the roster, and guard the correction** — the source file is not going
to change under you, but the next re-ingest will.

---

## The type ring: three failures before the palette held

**Symptom** — nothing shipped broken; the validator caught all three before they did.
Worth recording because each is a general trap.

**Root cause and fix, in order:**

1. **Light rings on a light ground.** The first palette reused the demo viewer's own
   hues (`#c9a3f5`, `#fb923c`, `#f43f5e`…). Those are designed for a `#0d1117` ground.
   On a white page inside a mid-tone fill they failed twelve ways at once: a ring has
   **two** neighbours — the fill inside and the page outside — and a light hue holds
   against neither. Fixed by going dark.
2. **A ring the same hue as the fill it sits on.** Facility's slate-blue `#3d4a63` sat
   6° from the `#2570cd` row fill, which reads as no ring at all; Document's dark brown
   and Alias's dark plum had the same problem against their own fills. Facility became
   a true neutral (`#3f3f46`, so the hue test treats it as separated from everything),
   and Document and Alias **lost their rings entirely** — each is the only type on its
   fill, so the fill already names it and a ring would encode the same fact twice.
3. **A ring drawn as a stroke on the disc did not appear.** `.gc-disc` sets `stroke` in
   the stylesheet, and **a CSS rule beats an SVG presentation attribute**, so
   `stroke={ring}` was silently overridden. It would also have fought the disc's state
   strokes (proposed / selected / answer path). The ring became its own `<circle>`.

**Guard** — *mechanical*: `check-docs` recomputes all four palette rules per ring (3:1
vs the page; 3:1 **or** a 40° hue turn vs its fill; 40° or 2:1 vs a sibling; and a ring
exists exactly where a fill carries more than one type), asserts each ringed type is
really drawn on the fill it declares, and asserts the ring is its own circle rather than
a stroke on the disc.

**Rule** — **the rule for a fill is not the rule for a ring.** A fill has one
neighbour and a ring has two, so a palette that passed as fills can fail as rings — and
the hue-turn alternative to the luminance test is what keeps any variety possible, since
a ring dark enough to clear 3:1 against a mid-blue fill would have to be near-black, and
nine near-blacks discriminate nothing.

---

## Zoom scrolled the page behind itself

**Symptom** — the first zoom gesture on the canvas scrolled the studio page as well as
zooming the graph.

**Root cause** — the handler was the JSX `onWheel` prop. React attaches wheel listeners
at the root as **passive**, and a passive listener's `preventDefault()` is a no-op that
only warns in some browsers.

**Fix** — the listener is registered by hand in an effect with `{ passive: false }`,
plus `touch-action: none` on the SVG so the browser is told up front.

**Guard** — *mechanical*: `check-docs` asserts the `{ passive: false }` registration is
present, so a revert to the JSX prop fails the build.

**Rule** — **a framework's event prop is not always a plain listener.** When a handler
must `preventDefault`, check how the framework registered it.

---

## CLAUDE.md described a sidebar that had shrunk by five

**Symptom** — the routing note read *"`NAV_ITEMS` has 13 entries; `routes.tsx` serves
eight of them"*. It was 8 and 5. Found incidentally: a smoke assertion printed
`8 nav items` while the paragraph beside it said 13.

**Root cause** — six keys were commented out of `NAV_ITEMS` over time. No check read
either number, so the prose stayed put. `check-docs` had a claim about `/db`'s presence
in the sidebar but none about the counts, and prose about a count is the easiest kind of
doc to falsify and the hardest to notice.

**Fix** — rewrote the paragraph from the source: 8 live entries, 5 with a page, 3
roadmap placeholders that fall through to `NotFoundPage`, and — the half the old
paragraph never mentioned — **4 routes reachable by URL only** because they were
commented out of the nav rather than deleted.

**Guard** — *mechanical*: `check-docs` now reads both counts off `nav.ts` and
`routes.tsx` and requires CLAUDE.md to state them, so commenting a key in or out fails
the build.

**Rule** — **a number in prose needs a check or it will drift.** Every count in these
docs that matters is now read from the source; one that is only written down is a
comment about the past.

---

## A route whose pattern is another route's prefix

**Symptom** — caught by its own guard before it shipped, but the failure mode is
invisible: `/graph-studio/:id/canvas` declared *after* the `App` tree renders the
**studio page** instead of the full-window canvas. No error, no 404 — just the wrong
page at the right URL.

**Root cause** — `graph-studio/:useCaseId` matches the parent segment of
`graph-studio/x/canvas`, and react-router takes the first sufficient match in
declaration order.

**Fix** — the canvas route is declared before the `App` tree, with the reason in a
comment beside it.

**Guard** — *mechanical*: `check-docs` compares the two declaration indices and fails if
the canvas route moves after `element: <App />`. Verified by moving it and watching the
claim go red.

**Rule** — **when a new path extends an existing pattern, declaration order is
load-bearing.** The symptom is a wrong render rather than an error, so it needs a
positional check, not a smoke test that only asks whether the page loads.

---

## One absent string stopped the whole What-if frame from loading

**Symptom** — `The What-if lens could not be read … authoring.steps[2].help should be a
string, got undefined`. Nothing on the page rendered.

**Root cause** — the package's three authoring steps look alike but are not: steps 1 and
2 carry `help`, and step 3 carries `note` instead, because the review step has nothing to
explain and a guarantee to state. The schema declared `help: str` for all three from
reading the first two.

**Fix** — `help: nullable(str)`, defaulted to `''` in the mapper so every component still
reads a string, and step 3's `note` surfaces as `reviewNote` where the page actually
wants it.

**Guard** — *mechanical*: the schema itself, which is what caught it. This is the
validator working exactly as designed — the failure named the field and the index, and
it took one read of the package to see why.

**Rule** — **do not infer a required field from the first element of an array.** Near
identical objects diverge exactly where their purpose does, and a schema is a claim about
all of them.

---

## Two Alerts printed the tenant's sentence twice

**Symptom** — caught by a smoke assertion, not by eye: the What-if page's review Alert and
its closing Alert each had a hardcoded title that was already the first sentence of the
note passed as their description.

**Root cause** — the package writes those notes as one string that opens with the point
("This is a read-only overlay. Running a scenario…"). Wanting a bold lead, I retyped that
sentence as the Alert title instead of splitting it off the data. So the emphasis was
real but the sentence appeared twice, and the words were mine claiming to be theirs.

**Fix** — a `lead()` helper splits the first sentence off the served string; both Alerts
use it. Nothing on the page is now written in a component.

**Guard** — *mechanical*: the smoke greps `WhatIfPage.tsx` and `ScenarioColumn.tsx` for
the first 40 characters of every served copy string and fails if any appears. That check
is what found this.

**Rule** — **if the payload carries the sentence, the component must not.** When copy
needs emphasis the data does not encode, derive it from the data rather than retyping it.

---

## Two assertions in one session that could not fail

**Symptom** — a smoke run reported `ok` for "labels are cased against the page" and for
"no copy was hardcoded". Neither was checking anything: the first was
`html.includes(x) || true`, the second `!html.includes(x) || html.includes(x)`.

**Root cause** — both were written as placeholders while reaching for the real check
(one needed to read the stylesheet, the other the component source, and neither fact is
in the rendered HTML), then left as passing lines.

**Fix** — both now read the file they are actually claims about: `paint-order: stroke`
inside the specific CSS rule, and the served copy strings against the component sources.
The second immediately found a real bug.

**Guard** — *documented*, and honestly so: there is no mechanical way to detect a
tautology in an arbitrary boolean without a linter rule for it, and oxlint has none
enabled here. The note in CLAUDE.md's pitfall list is the guard, alongside the standing
rule that already exists for this class — **whenever you assert that something is
absent, assert in the same run that the check had its data.**

**Rule** — **an assertion that cannot fail is a comment.** This is the same family as the
`check-docs` claims that passed over an empty list; the difference is only that these
were in a throwaway rather than in the build.

---

## A page's banner described data it had just said was not connected

**Symptom** — with no source connected, `/what-if` rendered its header, the
`read-only overlay` pill and the banner *VLS Texas Molecular — Deer Park, TX · built on
the real demo graph (36 inbound generators, EPA RCRAInfo + e-Manifest + ECHO)* directly
above the empty state saying **No data source is connected**. Two answers on one screen,
and the confident-looking one was wrong.

**Root cause** — only the tabs were behind the gate. `GET /whatif` returns its copy
regardless of `connected_sources`, and the pill, the banner and the provenance note were
rendered above the branch rather than inside it — the same mistake as putting a
`StatCards` row above a gate, except copy reads as a claim rather than as zeros.

**Fix** — the whole lens (pill, banner, tabs, note) moved into `WhatIfLens`, rendered
only on the connected branch. `PageHeader` is all the two branches share, which is what
every other gated page already did.

**Guard** — *mechanical*: `check-docs` slices `WhatIfPage.tsx` at the first non-exported
function and asserts the gate half names `NoSourceConnected` and none of `copy.banner` /
`copy.overlayPill` / `copy.dataNote`, while the lens half names all three. Both
directions, so deleting the copy cannot satisfy it. Broken three ways before being
trusted — chrome back above the gate, a served string deleted, the gate removed — and an
SSR smoke asserted both renders, with the header's served subtitle proving the "absent"
run had its payload.

**Rule** — **a connection gate replaces the page, not just its cards.** Served copy about
absent data is still a claim about absent data. Put everything the gate excludes in one
component rather than gating each piece, so the next paragraph added to the page cannot
land on the wrong side.

---

## A break-test that broke nothing, and nearly cost a good claim

**Symptom** — the seven new `check-docs` claims for the report section were each broken
once to prove they could fail. Two came back **MISSED**. On the face of it that meant two
assertions that cannot fail — the worst kind — and the obvious next move was to rewrite
them.

**Root cause** — neither claim was weak; the *mutations* were. One searched for
`"  gen_state: 'Generator state',\n"` in a CRLF file and matched nothing, so the file was
never modified — the repo's own `\r?\n` pitfall, this time in the throwaway rather than in
the check. The other bumped a generator's penalty by 1,000 and no checked identity
depended on that generator, which was a real gap: the register's headline tile
(`Total penalty exposure $1.80M`) was not among the identities being recomputed.

**Fix** — the mutation now uses `/\r?\n/`, and the missing identity was added, so a
roster edit anywhere in the register moves a checked figure. Both claims fail when broken,
verified by breaking them again.

**Guard** — *mechanical*, and the point of the entry: the break-harness now **verifies the
mutation landed** (it compares file hashes before and after, and restores from a copy
rather than from git), so "the claim did not fire" can no longer be confused with "the
file did not change".

**Rule** — **when a break-test reports a claim as unbreakable, suspect the break first.**
A false MISSED argues for deleting a working guard, which is worse than a false pass — and
one of the two here was pointing at a genuine hole in the identity set, which is exactly
what a break-test is for.

**Later, the same harness earned its keep the other way.** The publish gate added to
Reports and the What-if lens was guarded by counting occurrences of
`connected === 0 || counts.published_count === 0` and requiring at least two. Weakening the
*lens's* gate left the two in the report routes behind, so the claim passed while the lens
had stopped checking publication — a page open on a precondition it no longer tested. The
break-test found it, and the claim now checks the `/whatif` route body specifically as well
as the count. **A claim that counts instances does not say which instance**; where the fact
is "each of these three does X", assert it of each.


---

## A re-publish credited the previous publisher

**Symptom** — publishing was wired to the signed-in user, so "published by ana.delgado@…"
appeared where the seeded account used to. Then a smoke run unpublished that version and
published it again **without** sending an identity, and every line still read
`ana.delgado@…` — crediting a person who had not performed that publish.

**Root cause** — the record is keyed `useCaseId:sha256`, and the handler only *set* it when
an identity arrived. A version's content hash does not change when it is republished, so the
old entry survived and the fallback never applied. The key describes a version; the fact it
holds describes an *act*.

**Fix** — the handler now writes on every publish: the address when it is told one, and a
`delete` when it is not, so the tenant-account fallback applies to a publish nobody claimed.

**Guard** — *mechanical*: `check-docs` asserts both the `set` and the `delete` are present,
and the smoke asserts all three states in order — told, untold, told again — because the bug
only appears on the second publish of one version.

**Rule** — **a record keyed by a thing, holding a fact about an act, has to be rewritten on
every act.** Setting-only is a merge, and a merge inherits whatever the last actor left
behind. The tell was that the fallback path could never be reached twice.


---

## Six claims that found a string somewhere other than where it mattered

**Symptom** — six times in one session, a `check-docs` claim passed while the fact it guarded
was broken. Each time the break-test caught it, and each time the claim was searching a whole
file for a string that appears more than once:

- `frame.graphReference.nodeTypes` — gutting the *fill* lookup passed on the legend's copy.
- `maxWidth: width` — removing the cap from one of three SVG forms passed on the other two.
- `onSlice` — a page that kept its handler and dropped the prop still mentioned it.
- `block.companion` — a block that stopped rendering it still mentioned it in a width expression.
- `if (connected === 0 || …)` — weakening the lens's gate left the report routes' copies behind.
- `It is not access control` — changing the *rendered* sentence left the file's own comment
  saying it.

**Root cause** — `read(file).includes(x)` answers "does this string appear", and the claim
needed "does this string appear *here*, and everywhere it has to". A file that legitimately
mentions a token twice — once in code, once in a comment or a second call site — makes the
loose form unfalsifiable.

**Fix** — each claim now slices the function it is about (`fillFor`, `Legend`, `reportsList`),
counts occurrences against a denominator that comes from the code (`maxWidth` per `<svg>`), or
keys on the longer phrase that only the rendered copy carries.

**Guard** — *documented*, and the break-harness is the mechanism: every new claim is broken at
least once before it is trusted, which is what surfaced all six. A claim that cannot be broken
is not yet a guard.

**Rule** — **assert the fact at its site, not the token in its file.** If the property is "each
of these N does X", check each, or count against N. If it is "the copy says X", key on a phrase
long enough that a comment cannot satisfy it.

## The equal-height card trick stretched a card that opens a panel

**Symptom** — the saved-report card rendered as a very tall, almost empty box with its title
floating in the middle of it, and the rows below the title (Saved by / Asked of / Visible to, the
action row, the audience panel) drew *outside* the card's frame, underneath the Published-graphs
panel beside it. Nothing errored.

**Root cause** — `.rp-saved` carried the treatment the written-report cards use to line a grid
up: `height: 100%`, `display: flex; flex-direction: column` on the body, and the foot pushed down
with `margin-top: auto`. That is correct for cards whose height is set from outside and whose
content never changes. This card *expands* — the **Who can view** panel opens inside it — so the
forced height and the auto-pushed foot were fighting the content: antd's head filled the height
nothing was actually setting, and everything after it overflowed a box that would not grow.

**Fix** — the card is laid out by its content: no `height`, no flex body, no `auto` margin, and
the spacing below each part stated explicitly. The written-report cards keep the trick, because
nothing inside them changes size.

**Guard** — *mechanical*. `check-docs` reads the `.rp-saved` and `.rp-saved-foot` rule bodies and
fails if any of the three reappears — the rule body, not the selector, because the earlier padding
claim had already been fooled once by an emptied block.

**Rule** — **equal-height cards and expanding cards are two different layouts.** Before copying a
card's CSS, ask whether anything inside the new one can change height.

## A panel behind a `useState` cannot be asserted on from its parent

**Symptom** — a 13-assertion smoke over `SavedReportCard` reported eight failures that all read
as missing markup: no "Who can view this report", no roles, no checkboxes. The component was
correct; `renderToString` had simply rendered the card with `audienceOpen` false.

**Root cause** — the documented rule for `Modal`/`Drawer` is about portals, but the underlying
problem is broader: **`renderToString` renders the initial state**, so anything behind a
`useState` toggle is absent from the string. Worse, the eight failures were the *lucky* case —
had the assertions been "is absent" checks, they would all have passed over an empty render, which
is the failure mode `CLAUDE.md` already warns about for `useEffect` and virtualised trees.

Patching the hook does not fix it either: a component that does `import { useState } from 'react'`
never reads `React.useState`, so shimming the namespace changed nothing.

**Fix** — extracted the panel to `AudiencePicker`, exactly as `ConnectSourceWizard` is separate
from `ConnectSourceModal`, and the smoke renders it directly with three audiences (some / all /
none). The card's own smoke now asserts the *closed* card does **not** draw the panel, which is
the fact that made the extraction necessary.

**Guard** — *mechanical*. The audience claim requires the card to compose `<AudiencePicker …>`, so
inlining the panel back into the card fails the build.

**Rule** — **if a smoke has to see it, it cannot live behind the parent's state.** Extract the
body; do not try to open it from the test.

## A break-test harness that could not fail

**Symptom** — seven mutations in a row reported `MISSED` against two new claims. Both claims were
correct, and a hand-run of `check-docs` on the same mutated file listed the failure.

**Root cause** — two bugs in the harness, one after the other. It first read `stdout`, and
`check-docs` writes its failure list to **stderr**. Fixed, it then decoded the subprocess through
the Windows console codepage, where the `✗` it was grepping for did not survive the round trip —
so it found zero failing lines in output that plainly had two.

**Fix** — decode with `encoding='utf-8'`, match on the claim's own text rather than the glyph, and
treat a run with no `claims are stale` summary as a **crash** rather than a pass, because a
mutation can make the checker throw before it reports.

**Guard** — *documented*, in `CLAUDE.md`'s pitfalls. There is nothing to mechanise: the harness is
scratch code by design.

**Rule** — **a break test is an assertion, so the vacuous-assertion rule covers it.** When a
mutation reports MISSED, suspect the harness before the claim: three of these have now been the
harness (a `\n` that never matched, a stream, an encoding) and none has been a false claim.

## A card body at 0 beside a head at antd's default

**Symptom** — in the report section, every card's content sat flush against its left edge while its
title sat 24px in. The first thing a reader noticed, on five card classes at once.

**Root cause** — the theme sets `Card.bodyPadding: 0` globally, so a card has to state its own
padding. The heads kept antd's default; the bodies had none.

**Fix** — both edges set from one token, for every card class in the section.

**Guard** — was *mechanical*, in `check-docs`: it read the rule's declaration rather than the list
of selectors, because the selectors share one block and emptying it once left all five in place
while every card went unpadded. **That guard is gone with the report UI.** The rule survives here
and in `CLAUDE.md`'s pitfalls, and applies to any new card in this app.

**Rule** — **`Card.bodyPadding: 0` is a live trap, not a preference.** A new card class states its
own body padding, from the same token as its head, or it looks broken on first sight.

## A select-all that could only ever select

**Symptom** — the saved-report audience control had an *Every role* button beside five role
checkboxes. It went dark the moment all five were ticked and said nothing about the state in
between, so a partial selection looked identical to none.

**Root cause** — two mistakes in one control. A button beside checkboxes reads as a different kind
of act, and a two-state control cannot describe three states: all, none, and some.

**Fix** — replaced with an **All roles checkbox** carrying `indeterminate` while only some are
ticked. `checked` would claim every role can view it and `unchecked` would claim none can; both
are wrong for a partial selection.

**Guard** — was *mechanical* in `check-docs` and went with the report UI. Recorded here because it
is a general control-design rule, not a report one.

**Rule** — **a select-all belongs to the same control family as what it selects, and it needs three
states.** If it cannot be `indeterminate`, it will misreport a partial selection.

## Scoping a stylesheet breaks everything that portals out of the scope

**Symptom** — after importing the report prototype, **Delete did nothing**. Nor did any other
menu: the assumption dropdowns on Confirm, the field picker, the add-block menu. No console
error, no failed request, no visible change on click.

**Root cause** — two correct decisions that combine into a silent break. The vendored stylesheet
had to be **scoped** under `.cw-reports`, because it sets `*{margin:0;padding:0}`, `body`,
`button`, `table`, `th` and `td` as bare selectors and would otherwise restyle every page in the
app. And `MenuProvider` **portals to `document.body`** — which is outside that wrapper. So the
popover matched none of its own rules: no `position: absolute`, no `z-index`, no background, no
padding. It rendered as unstyled text below the entire page.

The Delete button *was* firing. It opened a confirmation nobody could see, so the second click
that actually deletes was never available.

**Fix** — the portal carries the class with it: `createPortal(<div className="cw-reports
cw-portal">…</div>, document.body)`, with `.cw-reports.cw-portal { display: contents }`. Boxless
is the load-bearing half — `.cw-reports` also holds the prototype's `height: 100%` and opaque
background, which at body level would paint a sheet over the app, and any box would become the
containing block for a menu whose `left`/`top` are computed against the document.

**Guard** — *mechanical*. `check-docs` walks `src/reports/**` for `createPortal(`, requires each
call to open with the scoped wrapper, and requires the `display: contents` rule to exist. Three
break tests: wrapper removed, wrapper made a box, rule deleted.

**Rule** — **when you scope a stylesheet, audit every portal in the code it styles.** A portal is
a hole in the scope, and the failure is invisible: unstyled content off-screen reads as a dead
control, not as a CSS problem. The same applies to anything using `document.body` as a mount —
tooltips, modals, toasts, popovers.

## A claim appended to the end of check-docs never runs

**Symptom** — a new claim was added, `check-docs` passed, and all six break tests reported
`MISSED`. The claim looked correct and the mutations were landing.

**Root cause** — it was appended with `cat >>`, which put it **after** the reporting block at the
bottom of the file — and that block ends in `process.exit(0)` / `process.exit(1)`. The claim was
never evaluated at all. `check-docs` reported the same total as before, which is the tell: the
count did not move.

**Fix** — moved it above `/* ---------------- report ---------------- */`. The count went 333 →
334 and all six mutations were caught.

**Guard** — *diagnostic*, and it is the break test itself. A claim that cannot fail is the
vacuous assertion this repo already forbids; what is new is that appending to the file is a way
to create one **without writing a bad claim**. The break test is what found it, exactly as it
found the three token-vs-fact claims.

**Rule** — **add claims in the section they belong to, never at the end of the file**, and check
the claim total moved. Six `MISSED` in a row is never six unbreakable claims — the repo's own
note already says to suspect the break first; suspect the *placement* too.

## A state added to a pool falls through the if-chain into the wrong answer

**Symptom** — caught while adding `blocked` to the report lifecycle, before it shipped, but both
halves were live faults the moment the state existed and neither would have thrown.

`reportEntitlementCell` tests `published`, then `pending_approval`, then **returns the archived
cell**. A `blocked` definition therefore reported *"entitled - archived, opens by link only"* to
every persona in its audience — telling them they can open a report that was never published. And
`reportGovernanceRow` read its tone from `REPORT_STATUS_TONE`, a literal map in `server.mjs`, while
the chip that counts the same state read `tone` from `governance.statuses` in `db.json`. A state
missing from the map came back `neutral` on the card and `crit` on its chip: two answers to what
the state *is*, on one screen.

**Root cause** — one concept written twice, and an if-chain whose `else` is a specific answer
rather than a fallback. Both are the same shape of bug: adding a member to a pool silently gets a
wrong answer from code that was correct for the members that existed when it was written.

**Fix** — the tone is read from the pool (`reportState(key)?.tone`) and the second map is gone;
`blocked` has its own entitlement cell (*"entitled once published - blocked, nothing to open"*,
`crit`). `validateDb` refuses a governed report whose `status` is not one of the declared states,
and the seed refuses to write one — because that failure is silent too: an undeclared status has no
label, so the card prints the raw key, and it matches no chip, so the row is reachable only under
"All current" while every other chip under-counts by one.

**Guard** — *mechanical*, three claims. Every governed report sits in a declared state (asserted
against `db.json`, plus the boot check and the seed refusal). Every state declares `key`, `label`
and `tone`, the tone is read from the pool, and `REPORT_STATUS_TONE` must not come back. And every
declared state **but `archived`** has a branch naming it in `reportEntitlementCell` — keyed to the
end of the chain, which is where the fallthrough lands.

**Rule** — **an `else` that returns a specific answer is not a fallback**, and a pool's properties
belong to the pool. When a list in `db.json` gains a member, grep for every `=== 'member'` chain and
every literal map keyed by the same vocabulary: the compiler cannot see either, and both fail by
answering.

## An "absent" assertion scoped to the page passes over the wrong grid

**Symptom** — a smoke assertion that the Library's empty state *draws no card* failed against
correct code. `renderToString` had rendered exactly what it should.

**Root cause** — the Library now holds two grids: the governed definitions the chips filter, and
the session shelf below them. `!html.includes('rcard')` was asked of the whole page, and the shelf's
cards are supposed to be there. A second assertion nearly went the same way — `!html.includes(...)`
for a definition title, where the shelf's own seeded names come from the prototype's dataset and
could have collided with it.

**Fix** — the assertions slice the page between the two headings and ask only the governed section.

**Guard** — *documented*, and it is the repo's existing rule applied to a second surface: **assert a
fact at its site, not its token in the page.** The related trap — `renderToString` splitting
`text {expr} text` into separate nodes, so an `includes` of the whole sentence fails — was fixed by
making the copy one expression rather than by loosening the assertion.

**Rule** — before believing a red "is absent" assertion, ask **which** part of the render it read.
Two grids on one page make every unscoped negative assertion ambiguous, and the failure looks like
a code bug.

## An ingest that rebuilds a whole key deletes everything added to it since

**Symptom** — found by reading, not by breaking: `npm run ingest:reports` would have deleted
`db.reports.governance` — the lifecycle states, every audience, every data-scope row — and the server
would then have refused to boot naming `reports`.

**Root cause** — the script ends with `db.reports = { … }`, a whole-key replacement listing what the
package provides. `saved` was carried forward explicitly, with a comment saying exactly why. Then
`governance` was added by a *different* script months later, and nothing brought the two together:
the ingest had no reason to mention a key that did not exist when it was written, and the seed had no
way to know the ingest would flatten it.

**Fix** — `governance` and the new `access_requests` are carried forward beside `saved`, and the
script **refuses to write** when `governance` is absent rather than producing a db.json the server
cannot boot. `access_requests` matters more than it looks: losing `governance` is loud, but losing
requests is silent — every row reads "no request made" and whoever asked waits on nothing.

**Guard** — *mechanical*, two claims. Every key `validateDb` requires under `db.reports` that the
ingest does not author must appear in the ingest's object literal (read off the validator, so a key
added later is covered without touching the check). And the refusal message must exist.

**Rule** — **`x = { … }` on a shared key is a delete of everything not listed.** When a script owns a
whole subtree, the test is not "did I write what I meant" but "is every key anything else writes
still here" — and the list has to be derived from the validator rather than remembered.

## An if-chain's fallthrough and a widened invariant, from one feature

**Symptom** — two consequences of adding a *private* (empty) audience, both caught before shipping.
`validateDb` required `audience.length > 0`, so the first Share-to-nobody would have refused the
commit — a user action failing on a rule written before that action existed. And the publish check
read "Audience names at least one persona", so a deliberately private report would have shown a
failing precondition, which reads as broken rather than as private.

**Root cause** — an invariant that was right when the audience was only ever authored, carried into a
world where a reader can set it. The check tested the *shape* of a decision instead of its integrity.

**Fix** — `validateDb` takes any array; the **seed** still refuses an empty audience, because there
it can only be a typo and nothing on that side distinguishes the two. The publish check now tests
that every persona the audience *names* still resolves — private passes and says so, and what fails
is an audience naming a persona that was renamed or removed under it, which is the real silent
narrowing and previously had no check at all.

**Guard** — *mechanical*. `check-docs` asserts the validator accepts an empty audience, that the seed
still refuses one, and that the publish check compares `audience_named` against what resolved rather
than against zero.

**Rule** — **when a field becomes writable, re-read every rule that assumed it was authored.** Two
different surfaces can want two different invariants on one field, and that is not an inconsistency
to resolve — the seed and the API here genuinely need different rules, and saying which and why is
the fix.

## The equal-height card trick breaks a card that expands — a second time

**Symptom** — reported from a screenshot. The Share panel opened inside its card and the whole grid
row grew to ~600px: the four cards beside it kept their text at the top and had their action rows
pinned at the very bottom, a chasm of empty card between. Separately, in a 275px column every button
label broke mid-phrase — "Open" over "report", "✎ Edit" over "report".

**Root cause** — two independent faults that read as one bad layout.

The panel: `.rcard` is `height: 100%` in a `grid` with `.racts2 { margin-top: auto }`. That is the
right recipe for a grid of fixed cards and wrong for one that expands — a taller card sets the row
height for its siblings, and `margin-top: auto` then pushes their buttons all the way down. **This
repo already had this entry**, for the saved-report card's audience panel; the note said "wrong for
one with a panel inside it" and a panel went inside one anyway.

The labels: `.racts2` is `display: flex` with no `flex-wrap`, so four buttons in a narrow column had
nowhere to go and the flex items shrank, breaking each label internally instead of moving to a second
line. A `.spacer` (`flex: 1`) before Delete made it worse by reserving the width that would have let
them fit.

**Fix** — the picker is a `ShareDialog` rendered at `App`'s root beside `PublishDialog`, in the
prototype's own `.modalBack` / `.modal` chrome, so nothing in a card expands at all. The action row
gets `flex-wrap: wrap` with `white-space: nowrap` on the buttons — a label may wrap the row, never
itself — the `.spacer` is gone, and the governed grid takes its own `minmax(400px, 1fr)` because four
actions do not fit in 330px.

**Guard** — *mechanical*. `check-docs` asserts `LibraryPane` renders neither `<SharePicker>`,
`<ShareDialog>` nor `modalBack`; that `App` holds the `sharing` state and renders the dialog; and that
the nowrap rule and the wider column both exist. Keyed on the JSX rather than the module name, because
the pane legitimately still imports `ShareRole` as a type. Four break tests, all caught.

**Rule** — **anything that expands belongs outside an equal-height grid.** A dialog at the page root
is the default, not the fallback: it cannot be stretched by the grid and cannot stretch it. And when a
flex row runs out of room it shrinks its items before it wraps — say `flex-wrap: wrap` and
`white-space: nowrap` together, or the layout degrades by mangling text rather than by reflowing.

## An "is absent" claim defeated by the comment explaining the absence

**Symptom** — two `check-docs` claims failed against correct code: "the report card states no approval"
and "Delete promises only what it does" (which forbids "gone for good"). Both were true of the card.

**Root cause** — the claims were whole-file `includes` for a word the file mentions **in the comment
that explains why it was removed**: *"and **no approval line**. `approval` is still on the payload…"*
and *"What actually happens, not \"gone for good\"…"*. The prose documenting the decision is the exact
text the guard forbids.

A third variant of the same claim was too broad rather than comment-defeated: `!/Approval/` also matched
**"Access pending approval"**, which is a different feature entirely and one the section is required to
show.

**Fix** — a `codeOnly()` helper strips JSX comment blocks, block comments and line comments before any
absence is asserted, and the approval claim keys on the *field* and the *label* (`r.approval`,
`Approval:`) rather than on the word.

**Guard** — *mechanical*, and it is the break test: seven mutations against these claims, all caught,
including one that puts the approval line back and one that restores the "gone for good" promise.

**Rule** — **strip comments before asserting that code does not say something**, and prefer the
narrowest token that carries the fact. A codebase that explains its decisions in prose will always
mention what it removed; a guard that reads the prose is guarding the wrong file.

## The chip that counted the server's rows, over a list that was not the server's

**Symptom** — no failure yet; caught while merging the Library's two grids into one. The chips printed
`governance.statuses[].count`, computed server-side. Merging the session reports into the same list
would have left "Published 5" above six published cards.

**Root cause** — the counts were served precisely so there would be one answer to "how many are
published", which was right while the list held only the server's rows. The merge changed what the list
*is*, and a served count then answers a question nobody asked.

**Fix** — the pool stays the server's (keys, labels, tones, order) and the count comes from the same
`inState` the grid filters with, declared once. A session report answers to its own `SESSION` chip
rather than the tenant's Published, so nothing ungoverned is counted as governed.

**Guard** — *mechanical*. `check-docs` asserts both call sites derive from `inState(cards, …)`, that
`SESSION` exists and is what a session row carries, and that neither old heading is back. Break tests:
restore a heading, and drop the count re-derivation.

**Rule** — **when a list changes what it contains, re-derive every number about it.** "The server
computes it" is only a single source while the server can see everything being counted.

## The access gate that replaced a row's actions, and what it left behind

**Not a bug — a removal, recorded because the shape is worth remembering.** A per-row `access` block
reported whether the signed-in role could open a report and what it had requested, and a reader whose
role the audience did not name saw *Not shared with your role* / *Access pending approval* **instead of**
Open · Edit · Share · Delete. The first thing a reader noticed was a card with no actions at all.

**What it consisted of**, so a revival is a decision rather than an archaeology exercise:
`reportAccessFor` and `reportAuthorRoleLabels` in `server.mjs`; a `POST /reports/access-requests` route;
`db.reports.access_requests` as a required nested key, carried by the ingest and the seed; `access` on
`GovernedReport` with its schema and mapper; `requestReportAccess` in `client.ts`; a `requestAccess`
callback on the page and a `requestGovernedAccess` handler in `App`; the `rp-access` block in
`GovernedCard`; and its styles.

**Why removing it lost nothing real** — the role is client-held and the login authenticates by shape,
so the API served every row to a caller that named none. A gate on that was never access control, which
is why the audience is still *stated* on the row and now acted on nowhere.

**Guard** — *mechanical*, and deliberately **cross-layer**: one claim asserts the absence in the server,
the client, the card and the stylesheet together. The dangerous shape is not the feature, it is half of
it: a card that gates on `access` while the payload no longer sends one renders a row with no actions,
which is the original symptom. Six break tests, all caught — including one that re-adds the pill to the
card and one that leaves the dead CSS behind.

**Rule** — **when a feature is removed, guard its absence at every layer it touched, not just the one
you deleted last.** And a removal claim must strip comments before searching: the note explaining the
removal names everything removed, so an un-stripped guard reads its own explanation and fails.

**Aside, and the third time this has cost a break test:** the mutation "delete the `restore:` line"
reported MISSED because it searched for `\n` in a CRLF region of `server.mjs` — the file has *mixed*
endings after scripted edits. Verify the mutation landed before believing a claim is unbreakable; the
repo's note says suspect the break first, and mixed endings are why.

## A list that is merely shorter, and a stale process serving it

**Symptom** — reported twice, a turn apart: "Report 1 is missing, only 4 reports showing". Both times
the report actually absent was **Report 3** (`trace`), and both times `db.json` on disk held all five.
Nothing on the page or in the payload said a row was missing; the list was simply one card shorter, and
the only way to notice which was to count cards against a file the reader cannot see.

**Root cause** — two faults compounding.

*The silent one:* a report is a **definition** (`db.reports.reports`, ingested from the package) plus a
**decision to govern it** (`db.reports.governance.reports`, seeded). Delete drops the second. Nothing
threw, nothing was logged, and no payload field described the gap — so a withdrawn decision was
indistinguishable from data loss.

*The stale one:* the mock server had been running since before two turns of server changes. It deleted
`trace` from its own in-memory `db`; a later `npm run seed:governance` fixed the **file** and not the
**process**, so it kept serving four. `PUT /db` — normally the way to reload in place without losing
in-memory publication — was **refused**, because that old process still validated against a key the
current `db.json` no longer has (`access_requests`). The tell was the refusal naming a key nobody had
mentioned for two turns.

**Fix** — the section computes `governance.ungoverned` (definition id, tag and title) and serves
`restore: 'npm run seed:governance'`; the Library states both above the list, in `warn`, and adds the
sentence a re-seed cannot fix: *if it reappears in the file but not here, the server is serving an older
copy from memory — restart it.* The user's session was recovered without a restart by `PUT`ing a payload
with `access_requests: []` re-added to satisfy the old validator, then re-seeding to drop it again — the
published graph survived, which a restart would have cleared.

**Guard** — *mechanical*, cross-layer: `check-docs` asserts the gap is computed from the two
collections and not stored, that `restore` is served, that `client.ts` validates `ungoverned`
non-nullably (an empty list is the normal answer), that the page renders the names and the served
command, that the component keeps **no copy** of that command, and that the stale-process sentence
survives. Six break tests, all caught.

**Rule** — **when a UI can remove a row, it has to be able to say the row is gone.** "Shorter" is not a
message. And when the file and the screen disagree, suspect the process before the data: an old server's
own refusal messages date it, because they validate against a schema that has moved on.

## Defaults checked less carefully than the live set they overwrite

**Symptom** — two of ten break-test mutations against the new Settings claims reported MISSED, and this
time the breaks were right and the guards were wrong.

**Root cause** — `settings.json` holds two permission blocks per persona: `nav_permissions` (live) and
`defaults` (what Reset copies over it). Both the validator and the `check-docs` claim scrutinised the live
set — every navigation key present, a locked key on — and said nothing about `defaults`. So a key missing
from `defaults`, or a locked row that was on now and off by default, passed every check and became a
broken live state the first time anybody pressed **Reset to defaults**. Nothing threw at any point; the
sidebar simply showed an item it should not.

The mutations found it by accident: `String.replace` with a plain string replaces the *first* occurrence,
and in that file `defaults` comes before `nav_permissions` — so both mutations landed on the block nobody
was checking. Two "unbreakable claims" that were really two blind spots.

**Fix** — `validateSettings` now requires the two blocks to carry identical key sets per persona, and a
read-only key to be `true` in **both**. The claim checks both blocks too. All ten mutations are caught.

**Guard** — *mechanical*, at the boot validator and in `check-docs`, plus the seed's own refusal.

**Rule** — **a fallback is state, and needs the same checks as the state it replaces.** Anything that can
be copied over the live values later — defaults, presets, a reset payload, a seed — is a delayed way of
setting them, so every invariant that protects the live set has to protect it too. And when a break test
reports MISSED, check *where* the mutation landed before concluding the claim is unbreakable: with a
plain-string replace, that is wherever the text first appears.

## A write whose response is lost, reported as a write that did not happen

**Symptom** — reported from a screenshot: toggling a persona's navigation access showed *"Cannot reach the
mock server. Start it with npm run mock (port 4000), then try again."* The page had loaded fine and was
showing all four personas and nine permission rows.

**Root cause** — two things, and only the second is a defect.

*The trigger* was transient. The mock server was restarted between the page load and the click — the
verification work in that session was rewriting `server.mjs`, and the process was restarted to pick the
changes up. A `fetch` that cannot connect throws, and `toMessage`'s network branch produces exactly that
sentence. The server, the route and the payload were all fine minutes later, from `curl` and through the
real client.

*The defect* was what happened next: **the write had been applied.** The server received the PATCH,
committed it, and the response was lost. `setPermission` only updated its copy on success, so the page
went on showing the old value while `settings.json` held the new one — and the toast said the change had
failed. It was found by accident: a check written to assert "Settings is off for Domain Architect, as the
screenshot shows" failed, because by then it was on.

**Fix** — a failed write now re-reads from the server before returning its `Result`. For a *refusal* the
re-read changes nothing (the server never applied it); for a *lost response* it replaces a hopeful guess
with what is actually stored. One GET, and the page stops being able to lie about it.

**Guard** — *mechanical*, and it needed a fetch stub that fails in the right way: a plain rejection tests
nothing, because the request never reaches the server. The test lets the write through, *then* throws, so
the server has applied it and the client has not heard — and asserts the store ends up agreeing with the
server. A refusal is asserted in the same run to keep the re-read from hiding one.

**Rule** — **"the write failed" and "I did not hear whether the write succeeded" are different facts, and
a network error is the second one.** Anything that reports an outcome after a lost response is guessing;
ask the server instead. And when a break test or a verification run rewrites source that a running process
loaded, expect a restart in the middle of somebody's click — the confusing error is the process, not the
code.

## A seeded account is an object, and a new route read it as a string

**Symptom** — publishing a What-if scenario without an `as=` address returned a 200 that the client then
refused: *"The published scenario could not be read — the data did not look the way this app expects…
`saved[0].published.published_by should be a string, got object`."* The message names a stale mock server,
and the server was three seconds old.

**Root cause** — `db.google_account` is `{ email, name, picture }`, not an address. The new publish route
was written from the *rule* — "fall back to the tenant's own account, because published by nobody is not
true of something a reader can open" — and reached for the account rather than its `email`. Every other
path that names a publisher (`publishedByFor`, the report footer, Ask) reads `.email`; this one was the
first new reader of that key in a while, and the compiler sees nothing: `server.mjs` is JavaScript, and
the field is only ever stringified at the edge.

The failure mode worth noting is the *message*. A shape error on a field the client has never seen before
reads as a stale process, because that is overwhelmingly what it usually is — and the instinct is to
restart rather than to look at the value.

**Fix** — `published_by: as ?? db.google_account.email`.

**Guard** — *mechanical*, two of them, and the first one already worked: the `client.ts` schema is what
caught this at all, on the first request, naming the field and the type. `check-docs` now asserts the
route reads `db.google_account.email` specifically rather than `db.google_account`, so the narrower
mistake cannot come back silently — a claim keyed on the bare key would have passed against the bug.

**Rule** — **a seeded singleton is a record, not a value.** Before falling back to one, read what it
actually holds; `grep` the key's other callers, because the convention for unwrapping it lives in them and
nowhere the compiler can see it. And when a validator reports a shape error, check the *value* before
blaming the process — the stale-server hint is a good guess, not a diagnosis.

## A `check-docs` helper used above its own definition

**Symptom** — none yet, and that is why it is here. Nine new claims were added to the What-if section of
`check-docs.mjs`, four of them using `codeOnly()` to strip comments before asserting an absence. That
helper was declared with `const` **600 lines below**, in the report section where it was first needed.

**Root cause** — a `const` in the temporal dead zone. The claims happened to be added *above* it, so the
first one to run would have thrown `ReferenceError: Cannot access 'codeOnly' before initialization` — and
`check-docs` would have died before printing a summary. The section that ends in `process.exit` never runs
in that case, which produces exactly the failure this file already records once: **the claim total stops
moving**, every break test reports MISSED, and the obvious next move is to rewrite guards that were fine.

It was caught only because the break-test harness treats "no summary line" as a crash rather than a pass —
a rule added the last time this bit.

**Fix** — `codeOnly` moved up beside `read`, with a note saying why it lives there.

**Guard** — *documented*, and deliberately so: the mechanical guard already exists and is the harness's
`if (!/claims/.test(out))` crash branch, which catches this for any future claim. What is added here is
the reason a shared helper in this file belongs at the top — a claim cannot choose to run after it.

**Rule** — **a helper shared by claims belongs above every claim, not beside its first user.** `check-docs`
is one long script with no functions, so definition order *is* execution order; anything a claim reaches
for has to be declared before the first claim that might.

## `codeOnly` deleted 139 lines of the file it was meant to clean

**Symptom** — four freshly written `check-docs` claims about the report publish dialog failed against
code that plainly satisfied them. `onConfirm(trimmed, initialAudience, roles, fresh)` was on line 150 of
the component; the claim searching for it said no.

**Root cause** — `codeOnly()` strips comments before an absence is asserted, and its first rule was
`\{\s*\/\*[\s\S]*?\*\/\s*\}` for JSX comment blocks. The `\s*` between the brace and the star is the
bug: **any** `{` followed by whitespace and a block comment matched — and `interface Props {` followed by
a `/** Prefilled name … */` doc comment is exactly that. The non-greedy tail then ran to the first `*/}`
anywhere below, which was 139 lines further down. Everything between was deleted before a single claim
looked at it.

Three things made it invisible for two sessions. It only fires on a file whose *first* `{`-then-comment
happens to be a block opener rather than a JSX comment, so most files were untouched. The strip is
silent — no error, just a shorter string. And the helper's whole purpose is **absence** claims, which
pass when the text is missing: a file with its middle removed satisfies every one of them. It surfaced
only because four *positive* claims were written against the same region and went red.

So the failure mode is the one this file already records twice under a different name: a guard that
cannot fail. Any `!/…/.test(codeOnly(src))` claim written since this helper landed was, on an affected
file, asserting over a hole.

**Fix** — require the brace and the star to be adjacent: `\{\/\*`. A JSX comment is written `{/* … */}`
with nothing between them, so no real one is lost, and the generic block-comment rule that follows
empties the comment anyway — leaving a bare `{}` that no claim searches for.

**Guard** — *mechanical*, and it is the four positive claims themselves. An absence claim cannot detect
this (that is the whole problem), so each new area guarded with `codeOnly` now carries at least one
claim asserting the code **is** there, beside the ones asserting something is not. A break test that
only ever mutates *in* a forbidden token proves nothing about whether the searched region still exists.

**Rule** — **pair every absence claim with a presence claim over the same region.** "X is not in this
file" and "this file still contains Y" are cheap together and worthless apart: the first passes over an
empty string, and only the second notices that the string got empty. The same reasoning is already why
`renderToString` assertions must prove the render had its data.

## A presence claim satisfied by the comment explaining it

**Symptom** — a break test reported one of eight new claims as unbreakable. The mutation replaced the
Audit & Governance page's `description={view.copy.notEnforced}` — the served "a rule is recorded, not
enforced" sentence — with a hardcoded line saying the opposite, and `check-docs` stayed green.

**Root cause** — the claim searched the raw file for `copy.notEnforced`, and the component's own doc
comment says *"That sentence is served (`copy.notEnforced`) and printed where the rules are"*. The
token was still in the file after the render had stopped using it.

This file already records that trap five times — but always for **absence** claims, under the rule
"strip comments before asserting that code does not say something". This is the same failure on a
**presence** claim, which nothing had warned about: a token in prose proves the *word* is in the file
and nothing at all about what renders. The absence and presence cases are the same bug, because both
are whole-file string searches over a file that talks about itself.

The claim it defeated is the load-bearing one on that page. The page lets somebody author a data-access
rule that nothing enforces, and that sentence is the only thing standing between it and implying a
filter runs — so an unbreakable guard on it was worse than none.

**Fix** — `codeOnly()` on the page, and key on the rendered expression (`description={view.copy.notEnforced}`)
rather than the field name.

**Guard** — *mechanical*, and it is the break test itself, which is why the gap surfaced at all. What is
added is the note in `check-docs` beside that claim naming this specific failure, so the next presence
claim over a self-documenting file starts from `codeOnly`.

**Rule** — **`codeOnly` is for every whole-file claim, not only the negative ones.** A file that explains
its own design mentions the identifiers it uses; searching the raw text tells you the author wrote the
word, not that the code still runs it. Key on the narrowest rendered form — the JSX attribute, the call,
the assignment — never the bare identifier.

## Two screens for one precondition

**Symptom** — reported as a question about the gated pages: when nothing is published, do they say
where to go? Three of the four did, in one set of words; the fourth did, in another.

**Root cause** — Ask shipped its own `EmptyState` for the publish gate before `NoPublishedGraph`
existed, and was never moved onto it. So the same precondition had two screens: **"No graph is live
yet"** on Ask and **"No graph has been published"** on Reports, the What-if lens and Audit &
Governance, with different numbered steps and two separate copies of the *Open Graph Studio* button.

Nothing was broken, which is why it survived — both screens sent the reader to the right place. The
cost is that one gate reads as two problems: somebody who hits it on Ask and again on Reports has no
way to know they are the same wall, and looks for a second fix. `NoPublishedGraph`'s own doc comment
had recorded the split as a known fact rather than treating it as a defect.

**Fix** — Ask renders `NoPublishedGraph`. Its two genuinely Ask-specific sentences survive as props:
`detail` (what appears here once a graph is live) and a new optional `footnote`. The title, the
action and the steps are deliberately *not* overridable — those are the parts that have to be
identical for four pages to describe one gate.

**Guard** — *mechanical*, and asserted both ways: every page in `PUBLISH_GATED_PAGES` renders
`<NoPublishedGraph`, and none of them contains an `<EmptyState` for that branch. The second half is
what stops the next page quietly growing a private copy — the first half alone passes on a page that
renders both.

**Rule** — **a shared empty state needs a claim listing the pages that must use it.** A component
existing is not the same as everybody using it, and the drift is invisible: each page looks right on
its own, and only somebody who hits the same wall twice notices. When a precondition has one fix,
give it one screen and enumerate the pages that show it.

## A crash-looping server reporting a byte offset, and a guard that only moved its crash

**Symptom** — two faults, found together from a deployed box's log:

    SyntaxError: Expected double-quoted property name in JSON at position 2464 (line 113 column 1)
        at JSON.parse (<anonymous>)
        at file:///home/ubuntu/CW-JSON-Server/mock-server/server.mjs:104:21

repeating forever under the process manager. And locally, `npm run check-docs` died with
`TypeError: Cannot read properties of undefined (reading 'by_element_class')`, taking all 386 claims
down with it.

**Root cause** — two, and they share a shape: **a guard that runs too late, and a guard that only
covers half of what it guards.**

*The box.* `mock-server/db.json` is a **generated file that is also committed**, so a pull or a
stash pop over a re-seeded copy conflicts every time — and the file had `<<<<<<< Updated upstream`
sitting at line 113. `validateDb` exists precisely to refuse a bad document while naming the key and
the command that restores it, but it never ran: `JSON.parse` is the first thing to touch the file,
and it reports a byte offset and nothing else. No file name, no line, no fix, and a restart loop
reprinting it.

*The check.* The demo package directory is untracked, and had been removed from the working tree.
`check-docs` already had a fallback for exactly that — with a comment explaining that a crash hides
every other claim — but the fallback object omitted `counts`, which the third claim walks into. A
partial guard does not remove the crash, it **moves** it: the run still died, one claim later, and
the summary line still never printed. Filling `counts` moved it to `counts.by_type` one claim after
that. The keys a fallback needs are the ones the claims *dereference*, which are not the ones the
real file leads with.

**Fix** — a `readJsonDb(path, label, restore)` that both databases go through. It checks for conflict
markers **before parsing** and names the marker, its line and the fix; turns a parse failure's byte
offset into a line and column; and names the file and its rebuild command in every case. And the
`check-docs` fallbacks now list every key the claims read, enumerated from the source rather than
discovered one crash at a time.

**Guard** — *mechanical*. `check-docs` asserts both databases are read through the loader and that
the raw `JSON.parse(readFileSync(...))` does not come back, that the conflict-marker case is checked
by name, and that each file names its own rebuild command. All three refusal paths — conflict,
malformed, missing — were exercised against a copy of the box's actual failure and reproduce its
line 113.

**Rule** — **a diagnostic that runs after the parse is a diagnostic that never runs on the worst
input.** Anything read at boot needs its failure named *at the read*, not by the validator behind it.
And when a fallback exists so a run can continue without an optional input, enumerate its keys from
the code that reads them: a fallback missing one key does not degrade, it crashes somewhere less
obvious, and a check-docs that cannot print its summary is the "claim total stops moving" failure
this file already records twice.

## Making the writes async removes a guarantee the sync version gave for free

**Symptom** — none yet; this is the hazard introduced by a change, recorded before it bites.

`db.json` is 450 KB. `commitDb` stringified and wrote all of it with `writeFileSync` on every
commit — a report audience change, a governance rule, a saved graph brief — and every other request
waited behind it. Moving to `fs/promises` gives that time back.

**What it takes away.** Three things were true only because the write could not yield:

1. **One writer at a time.** Both writers use the same temp path (`db.json.tmp`). With an `await` in
   the middle, two commits overlap: the second writes the temp file while the first is renaming it,
   and what lands is neither document. Synchronous code could not produce that.
2. **No stale read.** `commitDb(next)` swapped memory immediately after writing, and nothing could
   run in between. Asynchronously, if the swap waits for the write, a second handler builds *its*
   `next` from the pre-edit `db` and the first edit disappears — a lost update with no error.
3. **The file and the process agree.** A synchronous write that threw never reached the swap.

**Fix** — all three are kept explicitly rather than assumed. `writeJsonAtomic` chains writes per
path, so "atomic" survives the yield; the chain's stored link swallows rejections so one bad write
cannot wedge every later one behind it. `commitDb` and `commitSettings` validate and swap
**synchronously**, before the first `await`, so the new state is visible to the next handler the
moment the call is made — every call site builds `next` and calls straight in, so there is no window.
And the previous document is kept and restored if the write rejects, which is the only way to keep
(3) once the swap comes first.

**Guard** — *mechanical*, four claims: the writes are async and chained, the swap precedes the await
(compared by source position) and rolls back, every call site awaits, and the boot read stays
synchronous. Plus a live test firing eight overlapping writes at one route and asserting `db.json`
still parses, disk and memory agree, and no temp file is left behind.

**Rule** — **when a synchronous operation becomes asynchronous, write down what it was getting for
free.** Serialization, read-modify-write atomicity and crash consistency are all free while nothing
can yield, and all three are silently lost the moment something can. Async I/O is rarely just "add
`await`"; it is that plus a queue, plus an ordering decision, plus a rollback.

## A break test whose mutation the guard still matched

**Cost** — a claim that reported `MISSED` and looked like it needed rewriting, when it was one
character short of correct.

**What happened.** The new claim that Drive's allowlist is a tree tested
`/<FolderTreePicker/.test(wizard)`. The break test renamed the component to
`<FolderTreePickerX` — and `<FolderTreePickerX` *contains* `<FolderTreePicker`, so the regex still
matched and the guard reported the fact as still true. Three sibling claims broke correctly in the
same run, which made this one look like the outlier that needed loosening rather than tightening.

**Fix** — key on something the rename cannot leave behind: `<FolderTreePicker\s+folders=\{…\}`,
the rendered call with its prop.

**Guard** — the break test itself, re-run until it reports `CAUGHT`.

**Rule** — **a substring match cannot detect a suffix.** An identifier claim needs a boundary — the
next token, a `\b`, or the prop that follows — or renaming the thing leaves the guard green. Same
family as the whole-file `includes` that matches the comment explaining the removal: the question is
always "what is the narrowest text that carries the fact", and a bare identifier is rarely it.

## "1 drive" from a server that had been running since before the drives existed

**Cost** — one debugging cycle spent reading a preview response for a drive the server insisted did
not exist, `Cannot read properties of undefined (reading 'map')` on `folders`.

**What happened.** `npm run seed:workspaces` wrote three drives into `db.json`, and
`/sources/oauth/drives` answered with one. The file was right; the process was two hours old and had
read `db.json` at boot. This is the documented stale-server pitfall, and it still cost time because
the symptom pointed at the seed — the endpoint answered `200` with a well-formed, complete-looking
payload, and a *shorter list* is the one stale-server symptom that does not look like a stale server.
`Get-NetTCPConnection -LocalPort 4000` named the pid; killing it and restarting fixed it instantly.

**Guard** — none mechanical: the seed prints what it wrote, and the server prints its projects and
drives at boot, so the two can be compared in one glance.

**Rule** — **a stale server that has lost fields announces itself; one that has lost rows does not.**
`undefined` in three places at once reads as a stale process. A collection with fewer members reads
as data that was never written. When a list is short and the file says otherwise, check the process
age before re-running the seed.

## A destructive action that described the row instead of the app

**Cost** — none yet; caught while adding the warnings. Recorded because the shape recurs.

**What happened.** Disconnect and Delete each confirmed with one line about the *record* — "the
credential is revoked but the registration is kept", "registration and its Catalog entries are
removed". Deleting the last connected source closes five pages (Data Catalog, Profiling jobs,
Change signals, Traces, Validation) and empties New Graph's Sources step, and nothing said so; a
reader who found out afterwards had no way to tell whether they had broken something.

The tempting fix is worse than the problem: a warning that says "Ask, Reports and Graph Studio will
stop working" is **false** — those gate on a published graph, not on a connected source, and keep
answering from published content. An overstated warning is disproved by the next click, and a
reader who catches one stops believing the others.

**Fix** — `SourceImpactNotice`, one component for both acts, naming the pages that close *and* the
pages that do not, branching on a count of the other connected rows rather than asserting "the
last one". Disconnect's "this can be undone" is carried out by `POST /sources/:id/reconnect`, which
mutates the record in place so every profiled object survives — and the copy distinguishes that
from re-registering, which builds a fresh record and drops the profile.

**Guard** — *mechanical*, cross-layer: each page named as "keeps answering" must render
`NoPublishedGraph` and must **not** render `NoSourceConnected`, and each page named as "closes"
must render `NoSourceConnected`; plus the four legs of the undo (route, fetcher, store action,
button) and that the route does not `registered.set`. Plus an SSR smoke test over both acts and
both branches.

**Rule** — **a warning is a claim about the app, so it is checkable — check it.** Name the surfaces
rather than saying "some features stop working", and assert each name against the gate that page
really renders. And **never promise an undo that nothing performs**: the publish dialog once
promised a sign-off that had been deleted, and a "you can reconnect afterwards" with no reconnect is
the same sentence.

## A break test that mutated the comment instead of the code

**Cost** — two correct guards reported `MISSED`, and the obvious next move was to loosen them.

**What happened.** Break tests for the new warning copy used `String.replace` on a phrase that
appears twice in the file: once in the doc comment explaining the rule, once in the rendered string.
`replace` takes the first, so the mutation landed in the comment, the copy was untouched, and the
claim correctly reported the fact as still true.

**Fix** — `replaceAll`, and both claims then reported `CAUGHT`.

**Rule** — the "strip comments before asserting" rule has a mirror image on the *mutation* side: a
well-documented file names the fact twice, so a break test's `replace` is as likely to hit the prose
as the code. Mutate with `replaceAll`, or key the mutation on something only the code carries — and
when a guard reports MISSED, diff the file before rewriting the guard.

## Two controls for one piece of state, and only one of them showed it

**Cost** — none directly; the Catalog's panels simply had a ✕ nobody needed and a pair of buttons
that misdescribed the two actions.

**What happened.** The Data Catalog's detail column opened four panels, each drawing its own
`✕ close` above its content, while the buttons that opened them showed nothing at all. So the panel
state had two controls, and the one a reader looks at first — the button they just pressed — was the
one that did not reflect it. The pair was also a primary and a secondary, which reads as a ranking:
on a source with nothing profiled the browse panel is the only way forward, and on a profiled one
the dictionary is the whole point.

**Fix** — the ✕ is gone from all four; both buttons are toggles whose fill is the state — open is
antd `primary` (brand orange), closed is `default` (white) — plus `aria-pressed` and a line under
the row saying the same button closes the panel while one is open. `browseOpen` / `dictionaryOpen`
are derived from `panel` rather than tracked beside it.

**Guard** — *mechanical*: no `CloseOutlined` and no `onClose` in any of the four files (one claim
each, so a partial revival fails), both buttons typed from their open flag, both `aria-pressed`,
the flags derived, the hint present and gated, and no button fill declared in the action row's own
CSS — open reads the brand from `theme.ts`, so there is no second copy to drift. Plus an SSR smoke
test that each panel renders and draws no close control — the positive half paired with the
absence, as always.

**Rule** — **one piece of state, one control, and that control shows the state.** A toggle that
does not look pressed needs a second way out, and the second way out is what makes the first one
look broken. And when a control is removed, remove its prop in the same commit: a handler nobody
passes is a button that does nothing.

**Second rule, on the guard side** — a `const` added to `check-docs` can collide with one declared
600 lines above it, and the whole run dies with `SyntaxError` before printing a summary. That is the
"claim total stops moving" failure again; grep for the binding before adding it.

**Postscript, on the claim written for it** — the first version asserted the stylesheet held no
6-digit hex at all inside `.cat-actions*`. The hint line under the buttons legitimately sets
`color: #97a1b2`, so the claim failed against correct code on the very next run. Narrowed to
`background` or the brand hexes specifically. A guard that fires on something true is the same
liability as one that never fires: both teach the next reader to skim past red.

## A message that counted what it would not name, and pointed somewhere else to act

**Cost** — reported from use: *"Nothing to profile — 2 table(s) already profiled. Use Force on the
run in Profiling jobs to redo them."*

**What happened.** Two failures in one sentence, both about what the reader does next. It counted
the skipped objects without naming them, so on a source with five views you could not tell whether
the one you cared about was among the two — the panel had just been used to pick them, and the
answer was a tab away. And the only way forward it offered was the **Force** button on a *different
tab*, against the job row that had been created for the run that had just done nothing.

The rule it was obeying was real: "the browse panels never force", so an accidental re-profile
cannot happen on a first click. But that rule was being paid for by the reader every time the
common case came up.

**Fix** — `src/data/profilingOutcome.ts`, shared by both browse panels (they differ only by the
noun). An all-skipped run is now a confirm that names the objects, says what re-profiling does, and
carries `force: true` on its OK. A *partial* run names its skipped objects in the same words. Names
are capped at `NAMES_SHOWN` with the remainder counted, never silently truncated.

**Guard** — *mechanical*: the skipped list is interpolated in both branches, the cap is stated, the
module mentions neither "Profiling jobs" nor "Force", each panel's Start Profiling button calls
`startProfiling()` unforced while the confirm's `onOk` is the **only** `startProfiling(true)`, and
neither panel words the outcome itself. Plus a unit-style smoke test over all four branches
(all-skipped, singular, capped, partial, clean) and a live check that `force: true` really
re-queues a skipped table.

**Rule** — **a message that reports a count should name what it counted**, when the names are what
the reader would act on and the list is short enough to say. And **offer the next act where the
question is asked**: pointing at a control on another screen is a fine thing to *document* and a
poor thing to *require*. Relaxing a "never do X here" rule is allowed when the rule was protecting
against an accidental click — put the act behind a confirm rather than behind a different tab.

## A five-second call behind a button spinner, and a break test that a unit word satisfied

**Cost** — asked for from use: a 5s hold on step 3's two acts, then "show a small modal where step 1
is loading".

**What happened.** `1. Run preview` and `2. Finish` are the only calls in the connect wizard that
would really reach Google, and both answered before their spinner drew a frame — an act that returns
instantly teaches that it is free. Pacing them made the opposite problem: five seconds of a button
spinner that says only "something is happening" reads as a wedged dialog.

**Fix** — `CONNECT_STEP_MS` (5s) holds the *success* reply of `/sources/preview`,
`/sources/drive/preview`, `/sources` and `/sources/drive`. On the server, so the rule the consent
stages keep is unbroken: a row advances when its request returns, never on a client timer. Refusals
answer immediately — a five-second 403 on a mistyped handle is a hang. `ConnectRunPanel` then names
the act in flight, opening on `busy` (the flag the buttons' spinners already read, so the dialog
cannot outlive its call), for the Google branches only, with rows from `src/data/connectSteps.ts`.
The rows themselves moved into **`StageList`**, shared with the sign-in window.

The panel's first shape was one dialog listing **both** acts, the running one spinning and the
other waiting. Reported from use immediately: under Run preview it had "2. Finish — registering
the source and its dataset allowlist" on screen, which is work that was not running. It is two
dialogs now, one per act, each a spinner and a single line saying only what its own call is doing:
*Discovering the datasets in project vrio-contextweave-demo*, then *Registering project … with the
datasets you checked.* The explanatory second sentences each had were cut for the same reason the
disconnect notice has a word budget — a paragraph under a spinner is read once and then never
again — and what earned its place instead was the **subject**: an id interpolated from the request,
because a line that could describe any project the account can read is barely a message.

**Guard** — *mechanical*, per endpoint: held on `CONNECT_STEP_MS`, and its refusals not; none of the
four client handlers holds a timer; the panel is a component rather than a body inside the `Modal`
(antd portals out of `renderToString`); the message comes from the data module per act; and each
act's message carries its own unit and **not the other act's verb** — no "registering" in the
preview line, no "discovering" in the finish one; every one of the four templates carries the
`{subject}` slot, and the wizard fills both dialogs from the id the request is made with.

**Rule** — **a progress dialog may only describe the call that is running.** A row for the act that
has not started is a stage that ticks without a request, one step earlier: it puts words on screen
for work nobody is doing. If two acts need narrating, that is two dialogs.

Two more, about the guards rather than the feature. **Slice a handler at the next
handler, not at a character count**: a 4000-char window over the BigQuery preview route reached into
the Drive one, so deleting its own hold still found the neighbour's and the claim could not fail.
And **a claim that a list is in the right unit has to check every row of it**: `rows.includes(unit)`
passed a mutation that renamed the second Drive row to "dataset allowlist", because the first row
still said "folders". Assert the wrong unit is *absent* as well.

## A forced re-profile that ran, on a board that had stopped looking

**Cost** — reported from use: *"when user click again profile table job should run again, it not
running."* The run was queued and completed on the server the whole time.

**What happened.** `ProfilingJobsTab` loads on mount and then polls **only while
`active_count > 0`** — the poll that sees 0 stops the loop, which is right for a board nobody is
adding to. `handleQueued` refreshed the sources and the change signals and switched to the jobs tab,
but never the jobs list itself; on the first click that worked by accident, because the tab mounted
fresh and its mount effect loaded.

The re-profile confirm walks straight into the gap. The first click queues an all-skipped job that
completes instantly, so the board arrives idle and the loop stops. Pressing **Profile 5 table(s)
again** then posts `force: true`, the server queues a real run — verified: objects `pending`,
`active_count` 1, and it completes with them `profiled` — and nothing on the page ever asks. The
list keeps showing the completed job, the tab label keeps saying "Profiling jobs", and no error is
raised anywhere. It reads as a button that did nothing.

**Fix** — `handleQueued` calls the jobs store's `load()` too. One read puts `active_count` at 1,
which restarts the poll the board already had.

**Guard** — *mechanical*, two halves: `handleQueued` calls `loadJobs()` (and takes it from
`useJobsStore`), and the polling effect still returns early at `activeCount === 0` — the claim about
the first only matters while the second is true, so it says so and fails if the poll ever changes.
Plus a live store-level test through `useBrowseStore`/`useJobsStore` against a real server: first run
profiles, second skips everything, the board is idle, the forced run queues, **an untold board still
reads idle**, one `load()` shows it, and it finishes with the table `profiled`.

**Rule** — **a poll that stops is not a subscription.** Anything that queues work has to tell the
view that renders it; "it polls" is only true while something is already in flight, and the
first thing a reader does after a run that did nothing is start one that does. The tell is a feature
that works the first time and not the second.

## Answer requirements moved out of the brief and onto the question

**Cost** — asked for from use: *"remove answer requirement and add ask tab"*, clarified as
dropping `answer_formats` entirely and putting the choice under Ask.

**What happened.** Step 6 of the New Graph wizard asked for two things — a citation policy and
a set of render formats — and stored them on the brief, self-describing, so editing the pool
could not rewrite what a saved brief promised. The premise was *"the use case declares how
answers render; the engine never chooses at runtime"*. Nothing ever read the declaration back:
the citation policy printed on Ask as a sentence, and no answer's blocks were ever chosen from
`answer_formats`. It was a promise with no keeper.

**Fix** — the wizard is six steps, and the choice is asked for per question on Ask's own
**Answer requirements** tab. `POST /ask` takes `citations` and `formats`, validates both
against the server's own pool (unknown format → 400 naming it, before the stream opens), and
every answer carries `requirements: { citations, formats, satisfied, note }`. **`satisfied` is
computed**: required citations plus an answer that cites nothing is false, and the page tags it
`warn`. A format stays **stated, not applied**, in those words, because a recorded answer holds
the blocks the tenant wrote.

A brief saved on the old step 6 or 7 opens on the new last step — `savedUseCase` clamps the
stored number rather than leaving a stepper pointing at a step the API would reject.

**Guard** — *mechanical*, and deliberately **one cross-layer block rather than one claim per
file**: the step list is six and ends on the coverage review; no brief-shaped region of the
server, the page, the rules or the store mentions `answer_formats` or `citations`;
`normalizeFormats` and `/graph-answer-formats/suggest` are gone from server, client and store;
`AnswerRequirementsStep.tsx` is off disk; the page derives every step number from `LAST_STEP`;
and on the replacement side the tab exists, the panel is its own component, its options come
from the payload, `satisfied` is the computed expression, and the "stated, not applied" phrase
reaches the screen. Five of them break-tested. Plus a live end-to-end run (25 assertions: the
six steps, a refused step 7, the 404'd suggester, the served pool, three answers under
different requirements, and both refusals) and a render test of the panel (12).

**Rule** — **a declaration nothing reads back is worth less than a request something reports
on.** When a stored setting has no consumer, the honest move is to ask for it where the work
happens and report whether it was met — not to keep storing it because the copy sounds
principled. And two guard lessons, both already recorded and both hit again here: an absence
claim needs `codeOnly()`, because the comment explaining why a field is *no longer read* names
it (sixth time); and a whole-file search for `answer_formats` matches `graph_answer_formats`,
the pool that is *supposed* to still be there — scope the region, or the claim is about the
wrong thing.

## The studio's output tabs were readable before anything had been built

**Cost** — asked for from use: *"until build completed should not show the others, disable that,
build first"*, plus a faster pace.

**What happened.** `/graph-studio/:id` opened on the **Review queue** by default, and every tab
was live from the first render. All five besides Build describe a build's *output* — the rows a
run produced, the canvas it drew, the versions it minted — so before any run had completed they
offered a reading of nothing. The review queue is the worst of them and the reason this is not
cosmetic: its rows are the demo package's, not the run's, so it looks fully populated whether or
not a build has ever happened. A reviewer could settle six decisions against a graph that did
not exist yet.

**Fix** — one flag, `builtOnce` (`builds.some(b => b.status === 'complete')`), disables the other
five tabs, and an Alert above them names the act that lifts the lock — different words while a
run is in flight, because "start one" is wrong for somebody already watching one. The pace also
dropped from 5s a substep to **3s**, so a whole run is 1m 33s instead of 2m 35s; the number lives
once in `BUILD_STEP_MS` and reaches the page through `step_ms`.

**Guard** — *mechanical*: all five tabs carry `disabled: !builtOnce` (counted, not spot-checked),
Build itself never does, the active-tab guard exists, and the sentence branches on
`buildRunning`. Two break-tested. The existing pace claim did its job unprompted — changing the
constant failed `check-docs` on both docs until they were updated, which is exactly what it is
for. Plus a live run through `useGraphBuildStore`: no completed run before, none while queued,
one after, and the run really took ~93s.

**Rule** — **a tab that reads another tab's output is a precondition, not a peer.** Ordering
tabs left-to-right implies a sequence without enforcing one, and the tab that looks most
convincing when empty is the one that does damage — a queue whose rows come from a package
renders identically before and after the run that is supposed to produce them. When locking one,
push it off `activeKey` too: disabled *and* selected is a pane with no way out, and the default
arrival tab is exactly the one that gets locked.

## The canvas was a hairball, and no palette work was going to fix it

**Cost** — reported from use with a screenshot: 189 nodes in a fixed arrangement, most of them
identical blue discs, edges crossing everything. The pointer was at `src/grap` — a standalone
d3-force viewer already in the tree — and the ask was "it should look like this, based on their
real components".

**What happened.** The old canvas was hand-written inline SVG drawing the ingest's precomputed
positions, and a great deal of care had gone into it: a four-hue origin-class fill with measured
ink, an ontology ring inside it validated four ways, labels gated on zoom, a `getScreenCTM`
pan/zoom with a hand-attached non-passive wheel listener. Every one of those decisions was
correct *and none of them addressed the actual problem*, which is that a static force layout of
189 nodes cannot be pulled apart by looking at it. The reader needed to grab a node and drag the
graph open; no amount of encoding substitutes for that.

**Fix** — the viewer was **vendored** into `src/graph-viewer` (its hook, lib, types and
stylesheet), the way `src/reports/` was, and it replaced the canvas in *both* places that drew
one: the studio tab and the full-window route. `d3` became a declared dependency — the
deliberate exception to "prefer ~100 lines to a package", because a settling simulation with
drag and zoom is not 100 lines. Audit was 0 advisories before and after.

Three changes were made to the folder and no others: it takes its graph as a prop (its demo
dataset stayed behind), its root carries `cw-graph` so its stylesheet could be scoped, and
`useForceGraph` gained a `highlight` prop so the Query tab's promise — the answer's evidence
lights up on the canvas — still holds. `fromCanvas` renames and nothing more; the ingest's
`x`/`y` are handed over as the simulation's *starting* positions, so the seeded layout still
does work and the picture stays recognisable.

**Guard** — the claims that described the retired drawing were deleted, not weakened, and
replaced with ones that have a subject: one component rendered by both surfaces, the old files
gone from disk, d3 declared, every ontology type has a hue, each hue clears 3:1 on the viewer's
own **dark** ground, the adapter passes no second radius, the answer path is still wired, and
the stylesheet is scoped with no document-level rule left. Three break-tested. Plus 20 live
assertions through the real payload (every node and edge survives, all three element classes
arrive spelled the viewer's way, nothing falls through to grey, the legend counts each node
once, provenance is present, a proposed node says so and a settled one carries no note).

**Rule** — **when a picture is unreadable, the fix is usually interaction, not encoding.** A
palette answers "what is this one"; only a movable layout answers "how is this connected". Two
smaller ones fell out of it. **Vendored source belongs outside `src/`**: the viewer's own folder
sat at `src/grap`, where it was a second importable copy of the canvas, type-checked by `tsc`
and swept by `check-docs` — its raw-px stylesheet was already failing the `--sp-*` rule for a
component nobody rendered. It moved to `vendor/graph-viewer-source/`. **That half was reversed on
2026-08-18** — see the entry below. And **a claim that says
"the app has no graph library" is the wrong shape**: the What-if lens's guard asserted
`!package.json.includes('d3')`, so adding d3 for the studio failed a claim about a component
that had not changed. Scope a "draws its own SVG" claim to the file that draws.

## A vendored root that filled a document, dropped into a container

**Cost** — reported from use with a screenshot, one turn after the viewer landed: the full view
rendered the drawing squeezed into a ~300px column beside its 360px sidebar, the graph itself
cut off to the left, and two thirds of the page blank white.

**What happened.** Two faults, and the second hides behind the first.

`.cw-graph` — the vendored viewer's root — was the *document's* flex root in the app it came
from, at `height: 100vh` and no width, because a document root needs none. Dropped into
`.gcf-body`'s flex row it became a flex *item* with `flex-basis: auto` and no width, so it
sized to **content**: min-content for the drawing plus 360px for the panel, and the rest of the
page stayed empty. Nothing errored; the viewer worked perfectly inside the box it had asked for.

Then the simulation. `forceCenter` was built once from `svgEl.clientWidth`, which in the folder
it came from was always the window. Here it was that narrow column — so the layout centred on a
width the graph does not have and sat off-screen. The same line has a worse failure mode: a
panel that has not been laid out yet measures **0**, and `forceCenter(0, 0)` piles all 189 nodes
into the top-left corner.

**Fix** — the width is stated both ways (`width: 100%` for a block container, `flex: 1 1 auto`
plus `min-width: 0` for a flex one) so the same component fills the studio tab and the full-view
page; `flex-shrink: 0` on the panel and `min-width: 0` on the drawing so width pressure comes
out of the right one. The centre is measured through a helper that falls back to
`getBoundingClientRect`, and a `ResizeObserver` re-centres with a gentle `alpha` nudge rather
than re-settling from scratch.

**Guard** — four claims, all break-tested: the root declares width *and* flex *and* min-width,
the panel cannot shrink while the drawing can, the centre goes through the measured box, and the
observer exists and is disconnected.

**Rule** — **a component that was a document root does not become a child for free.** `100vh`,
no width, `#root`, `html, body` — each is an assumption about owning the page, and the one that
bites is the *missing* declaration rather than the present ones, because a sized-to-content flex
item looks like a small component rather than a broken one. When vendoring a root, state the
width, state the height at the container, and check anything that **measured** the old box.

And the guard lesson, for the eighth recorded time: **strip comments before an absence or
presence claim on a file's own text.** The rule I added carries a comment explaining *why* it
declares `width: 100%` — so the claim passed against a file with the declaration deleted. The
tell was the break test reporting MISSED on a mutation I had watched land.

## Ask kept one answer, so there was nothing for a history to be a history of

**Cost** — asked for from use: New chat, chat history, stored in session storage per user, and
visible agent messages while an answer is generated.

**What happened.** `askStore` held a single `answer` and `ask()` replaced it. Every question
erased the one before it — so the page could not show a conversation, let alone keep one, and
the streamed stages that *were* already there had nowhere to live but on top of the answer they
preceded.

**Fix** — a question becomes a **turn** (question + the answer it got) appended to the active
chat; `AskAnswerView` was extracted so one turn's markup is rendered per turn rather than
copied; `AskChatRail` offers New chat and this session's threads. History is `sessionStorage`
keyed by the signed-in address, capped at `CHATS_KEPT`, **validated on read**, and the rail
states in words that it lives in the tab and that nothing is stored on the server.

Four decisions worth keeping, all asserted: a chat is created *by asking* (so "New chat" only
clears the active id and the list never fills with empty threads); the thread is the **only**
home for an answer; switching graphs starts a new thread, because an answer belongs to the
version that produced it; and a signed-out caller reads and writes nothing.

**Guard** — ten claims, four break-tested. Plus 29 assertions on the storage module and the
rail (per-user isolation, round trip, the cap, unreadable JSON, a chat missing fields, a turn
with no answer, one bad entry costing only itself) and 26 live ones through the store against a
published graph: two questions build one thread in order, it survives a re-read, New chat keeps
the old one, another user sees none of it, delete and clear touch one user, and an abstention is
recorded as a turn rather than dropped.

**Rule** — **client storage is a boundary, so it gets a validator like any other.** `/db` made
that argument for responses; `sessionStorage` is the same shape of risk with a shorter fuse — it
is hand-editable and it feeds the components that render validated payloads. Drop what fails
rather than throwing: the reader loses only what closing the tab would have taken.

And a measuring lesson, third time in this log for the same shape: **measure the gap in rendered
markup, do not estimate it.** An "is this row marked" assertion used a 400-character window,
then 1,200; antd's message icon renders **1,244** characters of SVG path between the attribute
and the label. Both failed against correct code. A one-line probe printing the two indices
settled it in seconds.

## A shimmer has to stand for a paragraph somebody promised

**Cost** — asked for from use: each paragraph delayed 5 seconds, with a shimmer while it comes.

**What happened.** Blocks were paced at `ASK_BLOCK_MS` 380ms, which is fast enough that the gap
between paragraphs is invisible. At 5s it is very visible — and an empty 5-second gap reads as a
page that stopped, not as an answer being composed. So the delay needs a placeholder, and a
placeholder immediately raises the question this repo keeps asking: *is it standing for
something real?* A shimmer drawn "while streaming" would sit under the last paragraph of a
finished answer, promising a paragraph that was never coming — the same lie as a stage that ticks
without a request, one component down.

**Fix** — the summary event now carries **`block_count`**. The answer is composed before the
stream opens, so the server knows exactly how many blocks follow; the page draws
`block_count − landed` placeholders and the count reaches zero as the last one lands. Three
ragged lines rather than one bar (a paragraph is ragged; a rectangle reads as an image loading),
`aria-hidden` because the working line already says "Composing the rest of the answer…", and the
pan drops under `prefers-reduced-motion` — it is decoration over a stated fact.

**Guard** — four claims, all break-tested: `ASK_BLOCK_MS` is 5000 and the route awaits it, the
summary states `block_count` and the client validates it, the page subtracts landed from promised
(a literal `pending={1}` fails), and reduced motion is honoured. Plus 13 live assertions: the
placeholder count, the negative-count guard, shimmers before the first block, an empty answer
rendering nothing, and the measured gaps between blocks (~5s each, every promised block arriving).

**Rule** — **a placeholder is a claim about the future, so something has to have promised it.**
"Draw a skeleton while loading" is the version of this that lies at the end of every stream; the
fix is to make the producer state the count, which it can, because it already knows.

### And a note on the disabled Answer requirements tab

Found while fixing the above: the tab item had been commented out in `AskPage.tsx`, which left
five hooks and an import unused — `noUnusedLocals` failed `tsc -b`, so the build was broken. The
five hooks and the import are now commented **with** it, because half a switch is the shape that
breaks: a commented tab beside live hooks fails the build, and a commented tab beside a live panel
import is a component nothing renders. `check-docs` reads the absence through `codeOnly` — the
first version of that claim matched the commented-out tab and cheerfully reported a feature that
was not on screen, which is the ninth time that trap has been paid for here.

## Every build read v1, because the number named the brief

**Cost** — reported from use with a screenshot of the Versions tab: four builds, every row
labelled `Waste Management · v1`.

**What happened.** The label was a *config* version: `studioConfigVersion`, bumped when a brief
was **committed** and deliberately not by a build or a publish. That was a defensible model —
a build is a build *of a configuration*, and the reasoning written down at the time was sound:
"a version counter that moved on publish would relabel history". But it made the Versions tab,
which is a list of builds, show one number for all of them and expect the reader to tell them
apart by content hash. On a demo where the brief is committed once, every row read `v1`.

**Fix** — `studioBuildCount` gives each run the next number when it **starts**: v1, v2, v3. The
content hash is still the identity; the number is now the build's name for itself. Committing a
brief moves nothing, and neither does publishing.

**What survived from the old model, because it was the real constraint:** the label is assigned
once and *stored on the run*, and every surface reads the stored value. A counter read at render
time would relabel a published `v2` the moment a fourth build finished — which is exactly the
failure the previous scheme was avoiding, arrived at from the other direction.

**Guard** — three claims, all break-tested: the number comes from `nextBuildVersion` at
`startBuildFor`, every surface reads `run.config_version` rather than recomputing (restoring
`configVersion(id)` at the call site fails two claims at once), and `bumpConfigVersion` is gone
so there is only one counter. Plus 19 live assertions across four builds: v1/v2/v3 in order,
four labels with no repeats, publishing the **older** v2 leaves its label alone, Ask answers
from v2 by its own number, and a fourth build takes v4 without touching the published row.

**Rule** — **a label on a list has to name the thing the list contains.** The old number was
correct about a real entity (the configuration) and wrong about the list it appeared in, which
is the kind of error that survives review because every individual sentence about it is true.
When changing what a number counts, keep the property that made the old one safe — here,
assign-once-and-store — rather than only the behaviour that was asked for.

---

## The destructive-action warning was removed on request, and the acts were not

**Cost** — none yet; recorded because the *next* person to read `SourcesPage` will find two
dialogs that look harmless guarding two acts that are not. Asked for across two turns:
*"in the disconnect this source and delete the source just add the description r u sure you
want to disconnect and r u sure you want to delete"*, then *"remove all the description from
the disconnect and delete button just there should r you sure you want to delete and r u sure
you want to disconnect"*.

**What happened.** This file already carries the entry that *created*
`SourceImpactNotice` — "A destructive action that described the row instead of the app" —
because a one-line description said what happened to the row and nothing about what happened
to the app. That notice is now deleted. Both `Popconfirm`s are a title and nothing else.

**What was removed, and what each line was for:**

- *"Reconnect on this row undoes it — nothing profiled is lost."* / *"This cannot be undone —
  connecting it again starts from nothing profiled."* The only statement anywhere that the two
  acts differ in reversibility. `POST /sources/:id/reconnect` still restores the handle **in
  place** and `registered.delete` still takes every profiled table, column, document and note.
- *"It is the only connected source: Data Catalog, Profiling jobs, Traces and Validation
  close. Ask, Reports, Graph Studio, the What-if lens and Audit & Governance keep working."*
  Deleting the last connected source still closes those four surfaces. Nothing says so now.
- The `othersConnected` count, which existed so that line appeared **only** when it applied.

**Fix** — not a fix; a requested removal, carried out completely rather than half-way.
`SourceImpactNotice.tsx` and `.css` are off disk, `othersConnected` is gone from
`SourcesPage`, and the sentence lives in `src/data/sourceActions.ts` — copy rather than a
component, because a `Popconfirm` portals out of `renderToString` and a function can be
called by a test directly. The question is the **title**: as a description it sat under
"Delete this source?", which is the same question twice.

**Guard** — *mechanical*, and deliberately **one cross-layer claim**: the sentence is
interpolated from `action` (two hardcoded strings render fine and let the delete dialog ask
about disconnecting), both titles read it, neither Popconfirm carries a `description`, and
both deleted files are absent from disk. Three claims that guarded the removed copy were
**deleted rather than loosened** — the notice's page lists and its `othersConnected` count —
because a claim kept alive against a feature that is gone is the vacuous assertion this file
exists to prevent. The two per-page gate loops were *kept* with the notice half stripped:
they guard something independent and still live, namely that `NoSourceConnected` and
`NoPublishedGraph` are two different preconditions.

**Rule** — **when a warning is removed, the danger it warned about does not go with it.**
Write down what the screen no longer says, next to the code that still does it; the removal
is cheap to repeat and the knowledge is not. And the older rule, applied for the fourth
time: guard an absence **at every layer at once**. A `description` restored on one dialog and
not the other is two dialogs telling a reader different amounts about the same pair of acts,
and nothing errors.

## The Quality report tab was a second surface for one gate, and it is gone

**What happened.** Graph Studio had six tabs, and the sixth ran
`POST /graph-studio/:id/quality-check` — three checks over real state: every floor item
decided, no pivot open, every schema-changing approval justified. Those are the *same three
preconditions* `publish.blocked` computes and reports, which the banner over the review queue
already states and which the publish route already refuses on. Two surfaces for one gate: a
reader could run the check, see three ticks, and read that as a verdict separate from the one
Versions enforces. Removed on request.

**What was removed, per layer** — the endpoint and its `QUALITY_CHECK_MS` pacing in
`server.mjs` (with its line in the endpoint map at the top of the file); `runQualityCheck`,
`QualityReport`, `QualityCheck` and `QUALITY_REPORT_PAYLOAD` in `client.ts`; `report`,
`checking` and `check` in `graphStudioStore` (including the `report: null` in `open`'s
switching reset); the `quality` tab, `qualityTab`, `onCheck` and the two icon imports in
`GraphStudioPage.tsx`; and `.gs-check*` / `.gs-quality-head` in `GraphStudioPage.css`.
`.gs-todo` stayed — the Query tab and the canvas both use it.

**What did not change.** The gate. `publish.blocked`, its `reasons` and its `explanation` are
still computed once on the server from those three checks, the review queue still carries the
"Publish is blocked." / "Ready to publish." banner, and `VersionsTab` still reads the same
list for its disabled button, its tooltip and the refusal. Nothing that enforced anything was
in the tab; the tab only re-reported it.

**Guard** — *mechanical*, and **one cross-layer claim** rather than one per file, for the
reason this file has now recorded five times: half a removal is what fails silently — a store
still holding `report` behind a page that cannot show it, or a `POST …/quality-check` no
caller reaches. It runs through `codeOnly()` on the server, the client and the store, because
CLAUDE.md and the two code comments explaining the removal all name the thing removed. It is
**paired with a presence claim** over the same region (the gate's `gate.blocked` /
`gate.reasons` on the page, `publish: { blocked` in the client, `must_review_outstanding` on
the server), because an absence claim alone passes just as well over a file that has been
gutted. The tab-lock claim's `lockedTabs` went from five to four, so `disabled: !builtOnce`
is counted against the right denominator. Break-tested: putting `report: null` back in the
store took the run from 13 stale claims to 14.

**Rule** — **when two surfaces report one gate, deleting the reporting one costs nothing and
deleting the enforcing one costs everything.** Say in the removal note which was which, next
to the code that still enforces it.

## Reference-only source outside `src/` is still a second copy — `vendor/` deleted

*2026-08-18*

**Symptom** — reported from use as a maintenance problem, not a bug: two folders held the graph
viewer, `vendor/graph-viewer-source/` and `src/graph-viewer/`, and it was not obvious which one
a change belonged in.

**Cause** — the entry above moved the standalone viewer *out* of `src/` to stop it being a
second importable copy, which was right about the hazard it named (`tsc` type-checked it,
`check-docs` swept its raw-px stylesheet) and wrong about the remedy. Moving it out of `src/`
stopped the tooling seeing it; it did not stop it being a second copy. Nothing imported it,
nothing checked it against the live one, and no build would have failed if the two diverged —
so its only remaining job was to be read, which git history already does.

**Fix** — deleted the folder outright. Four doc references were the whole cost: CLAUDE.md and
SKILLS.md each named it as the viewer's source of record, SKILLS.md claimed the demo dataset
"stayed in `vendor/`" (it is now simply deleted), and the entry above is cross-referenced to
this one. No import, no `check-docs` claim and no build step referenced the path — verified by
grep across `*.ts`, `*.tsx`, `*.mjs`, `*.json` and `*.md` before deleting.

**Guard** — the existing claim that `src/graph-viewer/data` does not exist still holds, and now
holds for a simpler reason: the demo dataset is gone rather than relocated. Nothing new was
needed, because the deleted folder had nothing asserting anything about it — which is the
finding.

**Rule** — **"kept for reference" is a maintenance claim, and unmaintained is what it means.**
A copy nothing imports, nothing tests and nothing diffs against the live one is not
documentation; it is a second answer with no mechanism keeping it honest. Version control is
the reference copy. Before keeping source outside the build for reference, ask what would fail
if it drifted — if the answer is nothing, delete it. The genuine hazard the earlier entry found
(vendored code inside `src/` gets type-checked and swept by repo-wide rules) is real and is
handled where it should be: `src/graph-viewer/` and `src/reports/` are the two named entries on
the `--sp-*` exemption list, and that list is asserted to hold nothing else.

## A confirm footer that cannot fit its buttons wraps, and reads as misalignment

*2026-08-18*

**Symptom** — reported from use: the re-profile confirm looked like a pair of misaligned
buttons. "Leave them as they are" sat on one line and "Profile 11 document(s) again" on the
next, the narrower one above the wider, both hard against the right edge.

**Cause** — not alignment at all: the footer was out of room. A `Modal.confirm` defaults to
416px, and its `.ant-modal-confirm-btns` is `text-align: end` over inline-block buttons — so it
does not shrink them to fit, it **wraps** them as inline content, and because each line is
end-aligned separately the result is two right-aligned lines rather than one shrunken row. The
two labels are ~400px together against ~334px of usable width once the modal padding (48px) and
the confirm icon indent (~34px) come out. Both labels are deliberate sentences — the module
names the act rather than saying OK/Cancel — so they were always going to be wide.

**Fix** — `CONFIRM_WIDTH` (520) in `src/data/profilingOutcome.ts`, applied at both call sites.
The width lives beside the labels that force it, because shortening `confirmText` or
`cancelText` is the alternative fix and both are in that file. `cancelText` moved onto the
`ProfilingOutcome` type in the same change: it had been a literal written twice in two pages
while the module's stated job — and an existing claim — was that this wording is written once.

**Guard** — the existing "words the outcome from the shared module" claim gained a pair:
each panel must read `outcome.cancelText`, must not carry the literal, and must pass
`width: CONFIRM_WIDTH`. Break-tested by restoring the literal in `CatalogPage.tsx`, which
fails the claim by name.

**Rule** — **a flex row shrinks before it wraps; an inline-block row wraps before it shrinks.**
The entry above about four action buttons mangling their text mid-phrase is the *same* problem
in the other layout mode, and the tells are opposite: text broken inside a label means a flex
row starved its items, and buttons on separate right-aligned lines means an inline row ran out
of width. Neither is an alignment bug, and neither is fixed by an alignment property — read
which mode the container is in before reaching for one. antd's confirm footer is the inline
kind, so a dialog whose buttons are sentences needs a stated width.

## Three PM2 workers over a whole-document writer and in-memory state

*2026-08-18*

**Symptom** — found while planning the move of db.json to S3, not from a bug report, which is the
worrying part: nothing on screen says which worker answered.

**Cause** — `ecosystem.config.js` had `instances: 3, exec_mode: "cluster"`, and the server is
built on two assumptions that a second process breaks silently.

Every writer hands `commitDb` the **whole** document. The per-path write chain is what makes the
async write atomic, and it is a `Map` in one process — it knows nothing about the other two. Two
workers writing 492 KB each meant the last one won and discarded the other edit, with a 200 on
both. There are 14 commit call sites.

And roughly a dozen module-level `Map`s hold state that never reaches disk: `registered`,
`profilingJobs`, `studioLive`, `studioDecisions`, `studioVersions`, `whatifSaved`,
`oauthSessions`. Three copies behind a round-robin, so a source registered on one worker was
absent from the other two, and publishing a graph — the gate on Ask, Reports, What-if and Audit —
took effect for about one request in three.

**Fix** — `instances: 1`, `exec_mode: "fork"`. Not a workaround: a whole-document writer and
per-process state cannot be replicated by running more copies of it. Raising it again means
moving that state out of the process first.

**Guard** — a claim asserting the number, the absence of cluster mode, **and that the reason is
written beside it**. A bare `instances: 1` with no note is a number somebody raises next time
the box looks busy.

**Rule** — **horizontal scaling is a claim about a process being stateless, and nobody checked.**
The tell is not in the logs, because both failures are silent by construction: a lost update is a
successful write, and split-brain state is a feature that works a third of the time. Before
raising an instance count, grep for module-level mutable state and for any writer that persists a
whole document rather than a delta. Both were visible in this repo from the first line of
CLAUDE.md, which says in as many words that registered sources live in memory and die with the
process.

## Moving the JSON databases to S3: three traps, none of which names S3

*2026-08-18*

**Symptom** — each of these was a failure whose message pointed somewhere other than the fault.

**1. A dotted bucket name fails TLS, not auth.** The bucket is `contextweave.com`. Virtual-hosted
addressing puts it in the hostname, `contextweave.com.s3.us-east-1.amazonaws.com`, and AWS’s
certificate is `*.s3.us-east-1.amazonaws.com` — a wildcard matches exactly **one** label, and a
dotted name is two. The request never leaves the machine: *"Hostname/IP does not match
certificate’s altnames"*, which mentions neither S3 nor the bucket. Path-style addressing puts the
bucket in the path against the plain regional host, and **the canonical request has to carry it
there too** — signing a different resource than you request is a 403 on top of the fix.

**2. A stray session token invalidates a good key.** `AWS_SESSION_TOKEN` was set in the ambient
environment (912 characters, no matching key) while the access key came from `.env.local`. Reading
the token unconditionally paired a long-term `AKIA…` key with an unrelated STS token, and S3
answered `400 InvalidToken` — which reads as "your credentials are bad" and sends you to rotate a
key that was fine. A token belongs to `ASIA…` credentials and to nothing else.

**3. An identical write does not move the ETag.** The first test of the `If-Match` guard wrote the
*same bytes* back as a simulated second writer, then expected the server to be refused. It was not,
and for a moment that read as the guard being ignored by S3. S3 derives a non-multipart ETag from
the content, so an identical write leaves it unchanged and `If-Match` correctly still matches. The
guard was fine; the test was vacuous. Re-run with genuinely different bytes it refused correctly.

**Fix** — `addressing()` for the first, an `ASIA` check for the second, and a corrected test for
the third. All three are commented at their site with the message they produce, because the
message is the part that misleads.

**Guard** — `npm run verify:sigv4` replays AWS’s published vector offline, so a signing fault is
told apart from a permissions fault before either is debugged. Claims assert the committed bucket
and prefix, and that no tracked file matches `AKIA[0-9A-Z]{16}` or a 40-character secret.

**Rule** — **when integrating a service, the first bug is usually in the address, not the auth,
and the error text will say auth.** TLS failures, malformed tokens and signature mismatches all
surface as 400/403, which is the same shape as "you lack permission" — so the instinct is to go
and widen an IAM policy, which fixes nothing and weakens the thing you were not wrong about.
Verify the signature offline against a published vector, and read the *first* failure literally:
a certificate error is a certificate error.

**And a fourth, about the checker.** `check-docs` reads `db.json` for ~40 claims, so deleting the
local copy crashed it at line 239 — no summary, every claim reporting nothing. An empty-object
fallback only moved the crash to the first `db.projects.every()`, which is the partial-fallback
trap already recorded here. It now **refuses to run** and names `npm run db:pull`. A checker that
cannot reach what it checks must refuse, not answer — the same rule the mock server follows when a
document will not load.

## Writing a report to a file, without turning the section into a cache

*2026-08-18*

**Context** — reports had to be exportable to S3 so they could be sent to somebody outside the app.

**The hazard** — this section is built on "a saved report is a question, not a result": `db.reports`
stores no figures and `GET /reports/saved/:id` rebuilds from the frame, so a stale figure can never
be served as a current one. A file *is* a stored result, so an export is the one act that breaks
that rule, and the obvious next step - reading the file back on the next open - would turn the whole
section into a cache with none of a cache’s honesty about staleness.

**What keeps it honest** — nothing reads an export back. The export is written, linked and
forgotten; the report is still computed fresh every time it is opened. `check-docs` asserts the
*absence* of a read path into `exports/`, because that is the edit somebody would make for good
reasons on a slow day. And the file carries the moment, the frame, the row count and the graph
hash, so a figure that has been written down can still be checked against the question it answered.

**Three silent failure modes in the renderers**, each guarded: a comma inside a facility name splits
a CSV row and shifts every later column by one; an unescaped `<` ends the HTML document and takes
the rest of the report with it; and a block kind nobody handled renders as nothing at all. None of
the three throws, and all three produce a file that opens. The kinds are read out of `reportBlock`
rather than listed in the verifier, so a new one fails the build instead of exporting as blank.

**A mistake made and caught here**: the verifier sliced `reportBlock` "up to the next function
declaration", which broke because `reportChart` is declared *above* it - the slice ended early and
the check passed over three of the four kinds while reporting OK. It now slices to the closing brace
in column 0. Same family as the claims that reported "0 of 0".

**Rule** — **when a system’s correctness rests on never storing a result, the feature that stores
one needs a guard on the read path, not the write path.** Writing the file is the requested feature
and is harmless; reading it back is the thing that silently reverses the invariant, and it is the
change that will look like an optimisation to whoever makes it. Assert the absence of the reader.

## Turning the graph viewer's ground over is the whole palette, not one token — 2026-08-19

**Context** — the vendored viewer arrived dark (`--bg: #0d1117`, GitHub's dark hues) and the Canvas
tab read as a hole cut in a studio whose every other surface is white. The ask was "make the canvas
background white".

**What one token would have produced** — a white page with the nine dark-mode node hues still on it,
measuring **1.95:1 to 3.36:1**: a legend nobody can read, and the small instance discs dissolving
into the paper. Nothing throws, and the drawing still looks like a drawing, which is why this is the
shape that ships.

**Four things inverted that are not obviously colours at all**, each found by asking what a value was
*for* rather than what it was:

- **The halo is the ground.** `.node circle`'s stroke and the `paint-order: stroke` behind every
  label were `#0d1117` — not a dark accent but a cut-out of the page, which is what keeps two
  overlapping nodes readable as two. Left alone they become dark rings on white: the exact opposite
  of their job.
- **`--panel2` had to become *lighter* than `--panel`.** On a dark ground a raised surface gains
  light; on a light one it gains white. Keeping the old relationship put the active tab visually
  behind the rail it sits on.
- **The badge's ink flips with the hue under it.** `InspectPanel` sets the pill's background to the
  node's type hue inline; the hues went from light to ~5:1 dark, so `color: #0d1117` on it became
  dark on dark — the same unreadable mark, one level in.
- **The dim floors move.** `opacity: .12` sinks a mark towards black from a hue that was already
  light; from a dark hue towards white it leaves a legible grey smudge, and clicking a node stops
  meaning "everything else recedes".

**The palette rule that came out of it** — the nine hues now sit in **one luminance band** (4.83:1 to
6.04:1 on white), separated by hue rather than lightness, minimum ΔE76 of 21. That is why Enforcement
is orange and no longer a second red: on the dark ground `#f85149` and `#ff7b72` were told apart by
being *light and lighter*, and on white neither can stay light, so the distinction had to move into
hue or be lost.

**What made this safe to do at all** — `check-docs` already read the ground off `--bg` in the
stylesheet rather than having it written down a second time, and re-measured every hue against
whatever it found. So the guard followed the change instead of having to be rewritten with it, and a
break test (`Manifest: "#ffe066"`) reports the failure by name and ratio: *the Manifest hue reads on
the viewer's ground (#ffe066 on #ffffff): 1.30:1*.

**A break test that misses is not always a broken harness.** Setting `--bg` back to `#0d1117` did
*not* fail the hue claims — because mid-tone hues chosen for white still clear 3:1 on near-black
(3.13–3.84). That is the claim being right about what it guards: it asserts the marks are *readable*
on the declared ground, not that the ground is any particular colour. Two different facts; only one
of them was ever asserted.

**Rule** — **a colour token is a relationship, not a value.** Before inverting a ground, list every
declaration that exists to *match* it (halos, paint-order strokes, cut-outs), every pair whose
ordering encodes depth, every ink sitting on a colour that is itself changing, and every opacity that
assumed which direction "fainter" runs. `docs`-side, the earlier failure here was the same mistake in
the opposite direction — reusing one ground's hues on the other — and the guard that catches both is
the one that reads the ground from the source instead of restating it.

---

## A prefix read once at module load makes a dataset a property of the process

**2026-08-19.** Adding a second tenant dataset (`CAPEX/` beside `EPA/`) looked like passing a
different `S3_PREFIX`. It was not, and the reason is where the prefix was read: `docRef` read
`process.env.S3_PREFIX` itself, and `server.mjs` called it once at module load. So the dataset was a
property of the **process** — a second dataset meant a second server, and `dataset=both` could not be
expressed at all, because no single process held two documents to merge.

The prefix is an *argument* now and every dataset is loaded at boot. Four things this cost, each of
which had to be found rather than predicted:

**282 `db.<key>` reads, and threading a request through all of them would have edited most of the
file to say one thing.** `reportView`, `studioItems`, `whatifView` and dozens of helpers read `db`
without any notion of a request. `db` is a `Proxy` over "the document this request selected" instead,
resolved through an `AsyncLocalStorage` scope the dispatcher enters. Every read is unchanged. The
proof it is transparent: six endpoints' payloads are **byte-identical** to the pre-change process for
EPA, and `GET /db` returns the same 189-node canvas and 40 recorded answers.

**Twelve in-memory containers, none of them keyed by dataset.** `registered` is keyed by source id,
`studioDecisions` by `useCaseId:itemId`, `studioPublishedBy` by `useCaseId:sha256`. Every one would
have shown an EPA registration under CAPEX — and *answered* rather than thrown. They resolve per
dataset now, declared once in `LIVE_SHAPE`.

**"Empty" is not a document.** `validateDb` requires 25 keys and checks inside most of them, so a
genuinely empty `CAPEX/db.json` refuses to boot — and both obvious ways out are worse. Seeding it with
the primary's rows shows EPA's figures under CAPEX's name, which is the one confusion the split
exists to prevent; leaving it invalid stops the server. `npm run seed:dataset` writes the third thing,
the primary's structure with the primary's rows removed, and emptiness is permitted in `validateDb`
**only for a non-primary dataset** — nothing else is relaxed.

**Two `validateDb` cross-key checks read `rows[0]` and threw on an empty roster.** `whatif`'s field
check and `reports`' column check both derive the available fields from the first row, so a seeded
dataset crashed the boot with `Cannot convert undefined or null to object` — inside the validator
whose whole job is to refuse a document with a sentence. Both are skipped when there is no row to read
against, because "no generator carries this field" is a real fault with generators and a vacuous one
without them: it would have reported one unactionable problem per watched measure.

**Rule** — **when a value is read from the environment inside the layer that uses it, it is a
property of the process, and anything wanting two of them needs a second process.** Before adding a
"second X", find where X is *bound*, not where it is *used*: a boot-time binding turns a per-request
concept into a deployment concept, and the tell is that the obvious feature ("show both") is not
merely unimplemented but inexpressible.

### And two guards that caught their own mistakes

The boot guard `MERGE_PLAN` needed — refuse a key the plan says nothing about — earned its place
immediately: `reports.governance.audit` was written as a union because the name says audit *trail*,
and it is the Audit page's **copy**, including the sentence that stops the page implying a filter
runs. Emptied, it failed the boot with "reports is the wrong shape" and forty lines of hint. A merged
document is not what `validateDb` validates, so without this the same mistake would have surfaced as
a page that works under EPA and is blank under `both`.

A break test also reported one new claim unbreakable when it was merely weak: the seed claim matched
`for (const [key, rule] of Object.entries(MERGE_PLAN))`, which appears **twice** in that file, so
emptying the loop that builds the document still matched the one that checks it. Keyed on
`seeded[key] = seedValue(rule, source[key])` now — the line that carries the fact. Same
self-documenting-file trap already recorded several times over, in a new shape: not a comment naming
the thing, but a *second call site* of it.


---

## A remount key clears components, not module-level stores

**2026-08-19.** The dataset switch first used an `epoch` counter as the `<Outlet>` key: increment it,
the page tree unmounts and remounts, every `useEffect` reloads. It reads like a guarantee and is not
one — **zustand stores are module-level singletons**, so unmounting every component leaves each
store's `data` exactly where it was. The pages would have remounted and rendered the previous
dataset's rows until each fetch returned.

The switch signs the reader out and reloads the document now, which is the only mechanism here that
cannot half-work: every module is constructed again, so nothing can carry a row across. That is also
the honest act rather than a workaround — the persona was resolved against the tenant directory, and
every registered source, profiling job, studio decision and publication in the mock server's memory
belongs to the dataset it was made under.

**Rule** — **"remount" is about components; ask separately what holds the data.** Before reaching for
a key to force a refresh, name where the stale value actually lives. If it is in a module singleton, a
context, a closure or `localStorage`, unmounting its readers changes nothing.

### Three smaller things the same change turned up

**A `Select`'s options portal, so a fact stated only in the dropdown is not on the page.** Each
dataset row carried "no data yet" in its option label — invisible until the control was opened, which
left a reader inferring an empty dataset from a line of zeros. The same reason `Modal` and `Popconfirm`
copy has to live in `src/data/`: what portals cannot be asserted on, and here it could not be *seen*
either. It is on the table row now, and the smoke test caught it because the assertion was written
against the rendered markup rather than against the options array.

**Ordering claims must read `codeOnly`, not the file.** A new claim asserted
`setCurrentDataset` appears before `logout()` before the reload — and failed against correct code,
because the comment explaining *why* the selection is persisted first says "which `logout()` does not
touch", 300 characters ahead of the call. Sixth time this file has been caught by a comment naming the
thing it explains; the rule is already written down, and a claim reasoning about *position* needs it
just as much as one asserting absence.

**Persist before you navigate away.** The switch writes the selection, drops the identity, then
reloads. Doing the write last would race the navigation, and the failure is quiet in the worst way:
the app comes back up on the dataset the reader had just left, having signed them out to get there.


---

## A custom request header blocked every call in the browser, and curl said 200

**2026-08-19.** Adding `x-dataset` to `request()` broke the app completely: the login reported
*"Cannot reach the mock server — POST http://localhost:4000/auth/login did not complete … (Failed to
fetch)"*, which reads as a server that is down. The server was up and answering. `curl` got a 200 from
`/health` and a 200 from `/auth/login` with the same body it always returned.

**Only four request headers are CORS-safelisted.** Any other one makes a cross-origin request
*preflighted*, and the browser refuses to send the real request unless the `OPTIONS` reply lists that
header in `access-control-allow-headers`. This server replied `content-type` and nothing else, so
every request carrying `x-dataset` was blocked before it left the browser. Nothing on the server side
could see it — a blocked request never arrives.

Two things made it total rather than partial. `request()` sends the header on **every** endpoint, so
the failure was not one page but all of them. And the app calls the server **cross-origin**: `.env`
sets `VITE_API_BASE=http://localhost:4000`, so a different port means a different origin and CORS
applies in development exactly as it does on the deployed box. Through the `/api` proxy the request is
same-origin and no preflight happens at all, which is why this class of bug is invisible in the setup
CLAUDE.md documents as the default.

The header name is declared once now (`DATASET_HEADER`), both reply paths interpolate it — `send` and
`sseOpen`, because the Ask stream is cross-origin too — and `check-docs` asserts the client's literal
and the server's allow-list are the same string.

**Rule** — **adding a request header is a server change.** Before adding one to a fetch, add it to
the preflight, and verify in a browser rather than with `curl`: `curl` does not enforce CORS, so it
cannot reproduce the failure and cannot confirm the fix. The tell that you are looking at CORS and not
at a dead server is the pair *"Failed to fetch" in the browser, 200 from the command line*.

### And the diagnosis that nearly went wrong

The reported symptom named port 4000 and said "start it with npm run mock", and something *was*
listening on 4000 — so the obvious reading was the documented Windows pitfall, a background server
holding the port while wedged. It was not: `curl` proved the process was healthy in the same second.
**When a client says "cannot reach" and the server answers a direct request, the fault is between
them** — the origin, the proxy, or the preflight — not in either one.


### The same change hid a second dead end: refusing writes by verb refuses the login

Found one line later, in the browser-shaped replay that verified the CORS fix — `POST /auth/login`
came back `400 POST is not available while dataset=both is selected`.

`both` is a reading view, so the first implementation refused every non-GET at the dispatcher. But
**most reads in this API are POSTs**: login is a lookup, `/ask` is a query, `/whatif/scenario` computes
and stores nothing, `/reports/build` re-asks a question. The method check refused all of them — and
because switching to `both` signs the reader out, the refused login made `both` a state a signed-out
reader could never leave. The switch worked, the sign-out worked, and the app was then unreachable.

The refusal is at the two things that actually write now: `commitDb` for the document, and a `readOnly`
wrapper on each merged live container that throws on `set`/`delete`/`push`/… A pure read is answered
whatever its verb.

**Rule** — **"read-only mode" is a property of the writes, not of the HTTP method.** In an API where
POST is used for queries, a verb check is a guess about intent, and its false positives are invisible
until someone walks the flow. Guard the mutation; let the verb mean nothing. And **walk the flow you
just changed** — this was not reachable by any single-request test, only by switching, being signed
out, and trying to sign back in.


---

## A `<Navigate>` redirect cannot be observed through `renderToString`

**2026-08-19.** Putting the dataset's letter on the front of every URL (`/E/sources`) needed a gate
that corrects a wrong or missing segment. The obvious test was the one this repo is set up for —
`routes.tsx` is deliberately separate from `main.tsx` so the table can be mounted on a memory router —
so: mount at `/sources`, render, read `router.state.location.pathname`, expect `/E/sources`.

**Fourteen of those assertions failed, and the code was right.** `<Navigate>` performs its navigation
in a `useLayoutEffect`, and `renderToString` never runs effects — it warns about exactly this and then
renders nothing useful. The router never moved. The tell was in the failures themselves: *"signed out,
a prefixed URL goes to the login"* also failed, and that path is `RequireAuth`, untouched and
known-good for months. A harness that reports a working mechanism as broken is describing itself.

The decidable part is now a pure function, `datasetPathFix(pathname, search, hash, expected)`, and the
gate is three lines that render its answer. 36 assertions, no router, no DOM. Same move as putting a
`Modal`'s copy in `src/data/`: what cannot be observed where it happens gets moved somewhere it can be.

**Rule** — **before testing a redirect, ask what performs it.** An element-based redirect
(`<Navigate>`, or anything in `useEffect`/`useLayoutEffect`) is invisible to `renderToString`; only a
loader-based one shows up in the router's state. And when a new test fails on unchanged code alongside
the new code, suspect the harness first — the existing behaviour is the control.

### And a decision worth keeping: the URL is derived, not authoritative

The tempting design is the usual one — read the letter from the URL and select that dataset, so the
address is shareable. It is wrong here, and the reason is a requirement one layer up: **changing dataset
signs the reader out**, behind a confirmation. A URL-authoritative letter would be a second way to
change dataset that skips both, and until something resynced them the letter would disagree with the
`x-dataset` header every request carries. So the selection stays the authority and a wrong letter is
corrected rather than obeyed.

That also settles what an old bookmark does: `/sources` has no segment, so the whole path is treated as
route and it is corrected to `/E/sources` rather than 404-ing on a dataset called "sources". A
single-character first segment is the dataset; anything longer is not.


---

## Porting a rendered report means taking its layout and refusing its figures

**2026-08-19.** The demo package's `07_reports/Report_N_*.html` are five *rendered* reports — heading, badge, four
summary tiles, cards of charts and tables, footnotes — and every figure in them is literal text. The
obvious conversion is to transcribe them into JSX, which would have produced five components that look
exactly right and are stored results: precisely what `db.reports` exists not to be, since it stores no
result and `reportView` computes every series and every row order per request.

What came across was the layout. What did not:

- **The figures.** Each report renders `getReport(id)`'s payload, and `check-docs` asserts no component
  in `src/components/report/` does arithmetic — a `.reduce` over a column would be a second answer to a
  number the report already states.
- **Chart.js from a CDN.** Charts are `AnswerChart`; the server already emits a report's chart in the
  answer shape so one component draws both. A transcribed `<script src>` is a dependency decision made
  by accident, through a gate that fails on any advisory at `low`.
- **The filter chips as controls.** They are rendered and they state the frame the report was built
  under. `POST /reports/build` still has no caller, so a clickable chip would promise a slice nothing
  applies.
- **`*{margin:0;padding:0}` and its own `:root` palette.** The vendored prototype's sheet had to be
  scoped under `.cw-reports` for exactly this reason; authored CSS repeating it would restyle every
  antd table in the app.

**Rule** — **when porting a rendered artefact, list what it hardcodes before writing a line.** A
rendered file's figures, its CDN scripts and its global CSS are all things that "work" on arrival and
are wrong to keep. The tell for the figures is that nothing breaks: the page looks right and the
section's premise is gone.

### Two failures the smoke test found, one real and one its own

Rendering all five against the live API produced 84 assertions and four failures.

**Two were real, and both were the interpolation split**, already recorded once for a different
component: `renderToString` puts a comment node between an interpolation and its neighbouring text, so
`{a} of {b} {c}` renders as `4<!-- --> of <!-- -->36` and *every* assertion about that sentence passes
over nothing. Both the scope line and the row count are single template expressions now. This has cost
a claim twice; the rule is to write interpolated copy as one expression, not to loosen the assertion.

**Two were the harness.** `renderToString` escapes `&` to `&amp;` and `'` to `&#x27;`, so a heading
reading *Consent-Decree & Out-of-State Exposure* and a sentence reading *Deer Park's* were both in the
markup and neither was findable. Every needle is escaped the same way now. Worth separating from the
real two: three of the four failures pointed at the assertion, one pointed at the component, and telling
them apart is the difference between fixing the code and loosening the test.

### And a break test that missed for the third time in one session

`c.kind === 'num'` appears **twice** in the table renderer — the header cell and the body cell — so a
whole-file `includes` survived a mutation that removed one of them, which is a right-aligned header over
a ragged column. Asserting the count (`=== 2`) catches it. That is the second-call-site variant of the
self-documenting-file trap, now recorded three times: a comment naming the thing, a second loop over the
same data, and a second call site of the same expression.


### And then: two lists of one set of definitions

**Reported from use, one turn later.** The published reports first landed as a card grid of their own,
behind a switch at the top of the page, beside the prototype's Library. The Library lists the same five
definitions — with an **Open report** button already on every row. So the section had two lists of one set
of reports, and the answer to "where is Report 2" depended on which you were looking at.

The grid is deleted. `Open report` hands the id to the host and the rendered report replaces the
prototype until Back, which also made the row's two buttons mean what they say: Open reads the published
report, Edit loads the authoring definition. The prototype learns this through one optional callback, so
the vendored folder standing alone is unchanged.

**The consequence had to be dealt with rather than discovered:** the Library lists *governed* rows, and
two of the five had no governance row — so with the grid gone they were unreachable. `governance.ungoverned`
was already saying so above the list, with the command that fixes it; that notice went from informational
to load-bearing the moment the Library became the only way in. Re-seeded, and loaded with `PUT /db` rather
than a restart, which keeps the in-memory publication and therefore the report gate open.

**Rule** — **when a new surface duplicates an existing list, delete one before shipping both.** And when
a list becomes the *only* way to reach something, re-read what that list filters: the Library was always
allowed to be shorter than the definition set, and that was harmless only while another route existed.


---

## The last bundled dataset, and what a `const` export costs

**2026-08-19.** An audit of "what is displayed and where does it come from" turned up exactly one file the
app read at runtime that was not in the bucket: `src/reports/data/dataset.json`, 21,922 bytes imported
into the JS. Everything else on screen already came from `EPA/db.json` or `EPA/settings.json`. So it was
the one thing a reader could not change by editing the bucket — a figure on the Authoring tab needed a
rebuild and a redeploy — and it was invisible as a problem precisely because it worked.

It is `EPA/reports_prototype.json` now, read at boot with the other two and served by
`GET /reports/prototype`. Four things that mattered:

**A `const` export cannot be hydrated.** The module published `export const GENERATORS = DATA.generators`,
and twelve files import those names. ES module bindings are *live*, so `export let` plus one `hydrate()`
reaches every importer without any of them changing — but only if **no consumer reads the binding at
module scope**, since that captures the value once. That was checked across all twelve before the change
rather than discovered after: every read is inside a component or a function.

**The empty defaults are not a fallback.** `export let GENERATORS: Generator[] = []` exists so that a
render arriving during the fetch cannot throw on `undefined.map` — a blank section with a stack trace
instead of a spinner. Nothing renders against them; `isHydrated` gates the prototype.

**A served document has more ways to be wrong than a bundled one**, so the page tells three states apart:
unreachable, malformed (naming the file), and arrived. The prototype's own `validateDataset` was written
to catch a typo in a JSON file and now guards a network payload, which is a promotion rather than a
duplicate — the server's check stays shallow on purpose, because two deep validators in two languages is
two answers to what a valid row is.

**Its route had to be declared before `/reports/:id`.** That matcher is `/^\/reports\/[^/]+$/`, so
`prototype` would have arrived as a report id and come back `no report "prototype"` — a 404 listing five
ids, none of them what was asked for. Third instance of the same hazard in this repo, after
`graph-studio/:useCaseId` and the dataset segment.

**Rule** — **"where does this byte come from" is a question to ask of every surface, not the ones that look
suspicious.** The bundled dataset survived several passes over this section because a bundled import is
indistinguishable from a fetched one on screen. `grep -rn "from '.*\.json'" src` is the whole audit, and it
takes a second.

### And the self-documenting-file trap, a fourth time

The claim asserting the import is gone searched the whole file for `from './data/dataset.json'` — and the
comment explaining *what the move replaced* quotes exactly that string. It failed against correct code.
`codeOnly` on every whole-file claim, positive or negative: this file has now been caught by a comment
naming the thing it explains four times in one session.


### And the filter chips had to actually filter

**Reported from use.** The register's chips were rendered as labels, on the reasoning that
`POST /reports/build` had no caller and a clickable chip would promise a slice nothing ran. That was the
right call for a chip that could not work and the wrong shape to ship: the reference prototype's chips
filter, and a reader looking at a chip bar expects it to do something.

They re-ask the report now, and **on the server**, which is strictly better than the prototype: the
prototype's `applyFilters` sets `tr.style.display='none'` and leaves its chart and its four KPIs
describing all 36 generators, so with High selected the screen says "7 rows" in the table and "36 distinct
generators" in a tile. Re-asking recomputes the table, the chart and the tiles from one frame, and
`variant: 'generated'` makes the report say the figures are for the slice.

**One server change made multi-select expressible.** `reportFrameRows` reduced over the filter list with
`.filter` per entry, so two `risk` filters ANDed — "high and medium" is nothing. Grouping by key first
gives OR within a facet and AND across, which is the only reading a reader could mean. One filter per key
behaves identically, so saved frames and exports were unaffected.

**Rule** — **before rendering a control as inert, check whether the API can already carry it.** The frame
was built for exactly this ("so a chip can re-ask the report with the same scope, measure and window plus
one filter" — CLAUDE.md, written before the chips existed), and the fetcher was typed and waiting. The
honest-but-inert version was two turns of work away from the honest-and-working one.


### Then the chips became dropdowns, because a chip row does not scale

**Reported from use, immediately after.** The chip bar worked, and with four states it looked fine. The
values are the roster's though — a register over twenty states would wrap the State facet onto three lines,
which is the control deciding how much data is reasonable. Each facet is an antd multi-select now, one per
row, and the OR-within/AND-across arithmetic is untouched: a multi-select reports its whole selection,
which is exactly what the frame carries.

Three things fell out of the change:

**"All" stopped being a control.** With chips it was a fourth chip that had to be kept in step with the
other three; an empty selection already means the same thing, so it is the placeholder and nothing more.

**One store action replaced three.** `toggleFilter`/`clearFacet` were chip-shaped — they inferred an
add/remove from a click. A dropdown reports its selection, so `setFacet(key, values)` takes it directly;
reconstructing "what changed" from it would be inventing an event the control never sent.

**`maxTagCount="responsive"` cannot be rendered without layout.** It measures the control, so under
`renderToString` every selected tag collapsed into `+ 1 …` and the assertion that the selection shows on
the control failed — correctly, since that is also what the first browser paint shows before measurement.
A fixed `maxTagCount={2}` is the same information deterministically.

**Rule** — **a control sized to today's data is a layout decision disguised as a design one.** Ask how many
values the facet *can* have, not how many it has; the answer comes from the roster, not the screenshot.

### And one assertion that would have passed over nothing

`filteredHtml.includes('ID')` — with `state=[ID,NC]` selected, the two matching rows put "ID" and "NC" in
the table, so the check passed whether or not the control showed anything. Sliced to the select's own
selection markup first, it failed, which is how the `responsive` problem above was found at all. A
substring assertion over a whole render is only as specific as the rarest string in it.


---

## A `.gitignore` rule is a guard, and commenting one out is disabling it

**2026-08-19, the second time in one day.** A push was blocked by GitHub push protection for
`mock-server/.env.local.backup` — the same AWS key id, secret and OpenAI key as the first block, in a new
commit. The cause was not a new mistake: every ignore rule protecting them had been **commented out**.

```
13: # *.local
40: # mock-server/.env.local
41: # mock-server/.env.local.backup
```

With those disabled, a `git add` swept both credential files in. The rules had been added a few hours
earlier *because of the first blocked push*, so the guard was removed and the failure it prevented happened
again immediately.

The reason they were commented out is legitimate and separate: the same commit also un-ignored `db.json`,
`db.CAPEX.json` and `reports_prototype.json`, which somebody wanted committed so they reach a box with no
bucket credentials. That is a real need and a reasonable decision — it just took the credential rules with
it, because they sat in the same file and one of them (`*.local`) is what covered both.

**What was done.** `git filter-branch --index-filter` stripped the two paths from the three unpushed
commits, preserving all three and every other file in them (45, 17 and 2 files). The credential rules were
restored and *only* those — the data-file rules were left as set, since committing the JSON is a decision,
not an accident. `.env.local` was then restored to disk from a backup branch, because rewriting the index
also removed it from the working tree and the server cannot sign an S3 request without it.

**Rule** — **when a guard and a preference share a file, separate them before editing.** The credential
rules and the data-file rules lived in one `.gitignore` under one comment block; turning off the second
turned off the first. Guards belong where turning them off is visibly a different act — which is why the
three lines are now asserted by `check-docs`, so commenting any of them out fails the build rather than
failing at a push six commits later.

### And a claim that passed over a commented-out rule

The guard asserting the prototype dataset was gitignored read
`/mock-server\/reports_prototype\.json/.test(read('.gitignore'))` — which matches
`# mock-server/reports_prototype.json` just as happily. So it passed while the rule was off. `codeOnly`
does not apply to a `.gitignore`, so the fix is anchoring: `/^mock-server\/\.env\.local$/m` matches a
live rule and not a commented one. The claim now guards the three credential rules that way, and the
prototype's own rule is gone from it deliberately, because that one is now a preference rather than a
guard.

## A port that brings its data brings a second source for every figure

**Symptom.** `src/ddd` was a standalone React port of the same five reports the Library
publishes — a good design, and five components each holding its own roster as compiled-in
TypeScript constants (36 generators, 5 facilities, 14 quarters, 5 traces). Dropping it in as
the published-report renderer would have looked right on screen and been correct on the day
it landed. Every figure would then have been a stored result: `db.reports` stores no result
precisely so that a report is a re-executable question, and `reportView` computes each series,
row order and count per request. A roster in a component is that premise inverted, and nothing
errors.

**Cause.** Two ports of one report is two answers to what it shows, and a diff confirmed they
already agreed to the row — which is exactly what makes the failure invisible: the copy is
right until the roster it was transcribed from changes.

**Fix.** Adopt the design, refuse the data. The primitives moved into
`src/components/report/ui.tsx` and the sheet into `report.css`; the components stayed one
renderer over the payload rather than five over five rosters, and the standalone folder was
deleted. Three of its parts stayed behind because each would have made a claim the app cannot
keep: `ReportChart` wrapped Chart.js (a dependency decision by transcription, through a gate
that fails at `low`), `FilterBar` filtered rows in the browser (leaving the chart and the KPIs
describing the unfiltered set — two readings of one screen), and the sheet imported Google
Fonts over the network.

**Guard.** One cross-layer `check-docs` claim, because half a port is what fails silently: the
second copy is absent, the primitives exist *and* are what `PublishedReport` renders through,
every selector in `report.css` is scoped under `.cw-report`, the font import is gone, and no
component under `src/components/report` declares a row literal. All four halves were
break-tested.

**Two smaller things it cost on the way.**

- `Ranked by {sortedBy}` rendered as `Ranked by<!-- --> tonnage`: `renderToString` puts a
  comment node between an interpolation and its neighbouring text, so the assertion passed over
  nothing. Same trap the scope line already carried a note about — made one expression.
- The claim asserting `report.css` is scoped read the file's own header comment as selectors,
  because those lines start with `*`. The self-documenting-file trap, in CSS this time: strip
  comments before asserting anything about a file's contents, positive or negative.

## Folding two documents into db.json moves a guard that was doing real work

**Symptom.** None yet — this is the entry written *before* the bug, because the change
removed the structural thing that was preventing it.

**What changed.** `mock-server/settings.json` and `mock-server/reports_prototype.json` were
folded into `db.json` as the keys `settings` and `reports_prototype`, on request.
`mock-server/db.CAPEX.json` was deleted at the same time and `DATASETS` dropped to `['EPA']`
— a name in that list with no document behind it stops the boot, so removing the file meant
removing the name.

**What the two files were for.** Two stores with one job each: a settings write could not
touch a report, and an ingest rebuilding `db.reports` could not drop a permission. The second
half is not hypothetical — `ingest-reports.mjs` rebuilds `db.reports` wholesale and nearly
deleted `governance` exactly that way, which is already an entry in this file. Merging puts
three more subtrees inside one script's blast radius.

**How the guarantee was kept.** Not by trusting the ingests. Both keys are in `DB_SHAPE`, so:

- `validateDb` refuses a document missing either, at boot and on every write;
- `commitDb` validates the **whole** document before every write, so a writer that rebuilt one
  subtree and forgot to carry another is a refused write naming the key rather than a file that
  silently lost the tenant's users;
- `npm run seed:settings` spreads the document (`{ ...db, settings }`) rather than rebuilding it.

That is a *wider* check than the old one — two files only protected against the writers that
knew about them — applied at every write instead of one. `commitSettings` survives anyway,
because the message is the point: the refusal a permission needs names `npm run seed:settings`,
and `commitDb`'s says "restart the server".

**The trap this leaves.** `db.json` now holds tenant configuration as well as tenant data, so
**any script that writes a subtree must spread the document, never rebuild it**. Three do:
`ingest-reports.mjs`, `ingest-whatif.mjs`, `ingest-knowledge-graph.mjs`. The rule already
existed for `governance`; the cost of breaking it is now the login as well.

**Guard.** Five `check-docs` claims re-keyed and break-tested: the settings store is a key with
its own validator, writer and spreading seed; `commitSettings` routes through `commitDb` and
keeps none of the ordering itself; the boot read is one `Promise.all` per dataset with both
former documents read off `db` at call time; the sync tool moves one document; and both keys
carry `primary` in `MERGE_PLAN`, which is what now makes them tenant-level rather than the
refusal that used to.

**One thing worth naming about the dataset removal.** The "every dataset has a distinct letter"
claim cannot fail with one dataset — which is precisely when a check stops being read and
precisely when the next dataset gets added. Its denominator is the declared list plus `both`, so
it re-acquires teeth automatically rather than needing to be remembered.



## A persisted view preference outlived the thing it named, and bricked every page

**Symptom.** Every page empty, with two messages that between them named neither cause: *"No
data — the JSON server is not responding"* and *`"CAPEX" is not a dataset — this tenant has EPA,
both.`* The server was running the whole time, answering `200` on `curl` and `200` in the browser
for anything that did not carry the header. The suggested fix on screen — `npm run mock`, in a
second terminal — was for a process already up, so following it changed nothing and confirmed the
wrong diagnosis.

**Cause.** `CAPEX` was seeded, then removed from `DATASETS` on request. The selection is
client-held and persisted to `localStorage` under `contextweave.dataset`, deliberately, so that a
refresh cannot silently move a reader from one dataset's figures to another's. A browser that had
selected `CAPEX` therefore kept sending `x-dataset: CAPEX` on **every** request, and the server
refused every one — correctly, since serving EPA's figures under CAPEX's name is the single
failure that split exists to prevent.

**So both halves were behaving as designed and the app was unusable between them.** Nothing
cleared the value: `read()` returned whatever was stored and no path reset it, so the failure was
total, identical on every page, and survived reload, sign-out and restart. The only cure was
editing `localStorage` by hand — which requires knowing the key, which requires reading the source.

**The near-miss.** The obvious fix is to validate the stored value against a list of datasets in
the client, and that is wrong for the reason the consent screen's client-side scope list was
wrong: a pool held in the browser can refuse something the server has, and it is a second answer
to "what datasets exist". It would also have gone stale in exactly the same way, one release later.

**Fix.** Recover from the server's answer instead of pre-empting it. `resetDatasetIfRefused()`
discards the persisted value and reports whether there was one; `request()` calls it only on a 400
whose body matches `is not a dataset`, and retries once. The pool stays entirely the server's —
nothing in the client decides whether `CAPEX` is a dataset, only what to do once told it is not.

**Why it cannot loop.** The retry is gated on the reset returning `true`, and the reset returns
`false` once the selection is already the primary. A genuine refusal therefore throws on the
second pass rather than recursing, and every other status — 400s included — is untouched.

**Guard.** A scratch SSR smoke test (the documented method: stub `fetch`, and stub `window`
*before* the dynamic import, because `dataset.ts` reads `localStorage` at module scope) asserted
all of it: two requests go out carrying `CAPEX` then `EPA`, the retry's payload is returned rather
than thrown, storage is cleared, and a second reset reports nothing to clear. Two of its nine
assertions failed on the first run against correct code — the stub's success payload did not
satisfy the real validator, which is the "suspect the assertion and the environment first" rule
paying out again.

**The lesson worth carrying.** A persisted preference is a reference to something that can be
deleted, so every one of them needs an answer to "what happens when the thing is gone". The
identity in `localStorage` has the same shape of risk: `roleId` is a `db.auth_roles` id, and
removing a role would strand a signed-in browser the same way. And when a stored value can wedge
every request, the error copy has to be able to say so — "the server is not responding" was read
as the truth for as long as it took to run `netstat`.

## A façade of named getters served an empty permission set for a file that plainly held one

**Symptom.** `db.settings` held `report_permissions` with four personas and twelve booleans, the seed
had written it, `validateSettings` accepted it and the server booted clean — and `GET /settings`
answered `reports: {}` for every persona. Every switch on the new tab would have rendered off with
the file on disk plainly saying `true`, which reads as a broken toggle rather than as a missing
accessor, and the first instinct is to go and debug the switch.

**Cause.** `settings` in `server.mjs` is not `db.settings`. It is a small object of **named getters** —
`get users()`, `get defaults()`, `get read_only()`, `get nav_permissions()` — each forwarding to
`db.settings`, so that the block is read through `db` and therefore belongs to the selected dataset.
A façade of named getters forwards exactly what it was told about and nothing else, so two new keys
were invisible to every reader of `settings.*` while being perfectly present one layer down.

**Why nothing caught it.** Each layer was individually right. The seed wrote the keys, so the *file*
was correct. `validateSettings` reads its `candidate` argument — the whole document's `settings` value,
not the façade — so it validated the real keys and passed. `reportPermissionsFor` used `?.` on both
blocks, which is correct defensive code for "not configured yet" and is precisely what turned a missing
accessor into a silent empty object rather than a crash. The optional chaining was load-bearing in one
direction and a muffler in the other.

**Fix.** Declare the two getters. The lesson is the general one: **when a namespace is a hand-written
façade rather than the object itself, adding a key to the underlying store is not enough** — grep for
how the namespace is constructed before assuming a new key is readable. `settings`, `db` (a Proxy) and
the twelve live containers (`liveContainer`) are all indirections over storage in this server, and only
the Proxy forwards unknown keys automatically.

**Guard.** The `check-docs` claim asserting the three-layer agreement of `REPORT_ACTIONS` checks that
every persona carries every action in **both** stored blocks, which fails if the seed stops writing
them — but it reads `db.json`, so it would not have caught this. What catches it is the smoke test
asserting `reportActionsFor` against a served payload, plus the fact that the panel renders the served
`report_actions`: an empty served block now shows up as a tab with no columns rather than as a tab with
columns all switched off.

**And a break test that cannot fail says nothing.** Three of the five new claims first reported MISSED,
and all three were breaking correctly — the harness grepped for the claim's label, and those labels
carry a curly apostrophe (`the report’s own print rules`), which a byte-wise `grep .` in this shell's
locale does not match. Comparing the *set* of failing claims before and after the mutation is the
reliable form; matching a guessed label is not. This is the third session in which a break harness,
rather than a guard, was the thing that was broken.

## A rebuild-the-subtree ingest silently un-shared a report

**Symptom.** Sharing a CAPEX report document with two personas worked, committed, and served correctly.
Running `npm run ingest:capex` afterwards — which is the documented way to restore a deleted row —
reverted it to never-shared, with nothing on screen or in the output to say so.

**Cause.** The ingest rebuilds `reports.documents` wholesale, which is correct for every field on the
row *except one*: each document's title, subtitle, category, version, author and refresh are read out of
the HTML, but `audience` is a decision made in the app through `PATCH /reports/documents/:id/audience`.
A rebuild is right for what the file authors and wrong for what it does not.

**This is the third time this exact shape has bitten.** `ingest-reports.mjs` nearly deleted every report
audience and data-scope row the same way, and the rule was already written down: *when a script owns a
subtree, derive the carry-forward list rather than remembering it*. It was still missed here, because the
new subtree looked entirely file-derived — the one non-derived field was added later, by a route, in a
different session's work.

**Fix.** Carry `audience` across, keyed by `document_id` rather than by position, so re-ordering the
folder cannot move one report's audience onto another. A row that never had one keeps no key at all,
because never-shared and deliberately-private are different facts and only the second is a decision.

**Guard.** A `check-docs` claim asserts the carry-forward exists, is keyed by id, and tests
`Array.isArray` — break-tested by removing it. The general rule to apply next time: **for every field on
a row a script rebuilds, ask which layer authors it.** If any field is written by a route rather than by
the source the script reads, that field needs carrying and the script should say so where it does it.

## Two vendored folders were missing from the worktree, and the first symptom was one import

**Symptom.** `[plugin:vite:import-analysis] Failed to resolve import "../reports/components/MenuProvider"
from "src/pages/ReportsPage.tsx"`. One import named, so the obvious reading is one missing file.

**Cause.** All of `src/reports/` (35 files) and `src/graph-viewer/` (12 files) were absent from the
working tree while present in git — `git status` showed 47 ` D` entries. The vite error names whichever
import it reached first, which makes a wholesale deletion look like a typo in one path.

**Fix.** `git checkout -- src/reports src/graph-viewer`. Worth knowing *before* reaching for it: the
index held the session's own uncommitted edit to `src/reports/App.tsx`, so the restore was lossless — but
that had to be **checked** rather than assumed, by diffing the index blob against a copy of the modified
file. A `git checkout` over a modified-but-uncommitted file is the one command in this repo that
destroys work silently, and earlier in the same session it had already wiped a print stylesheet block
that way.

**The lesson.** `git status --short` before diagnosing an import error. A resolution failure names one
path; the question to ask is how many files are missing, not what is wrong with that path. And a folder
of *assets* under `src/` is not app code: `src/EPA` and `src/Capex` are now in `tsconfig.app.json`'s
`exclude`, because `tsc -b` was failing on a reference copy nothing imports, and the stylesheet walker in
`check-docs` reads that same exclude list rather than keeping a second one that could disagree with it.

## A per-dataset document was validated against another dataset's personas

**Symptom.** CAPEX's real document arrived — its own tenant (Northline Water Group), five users at its
own domain, four personas of its own — and the server refused to boot: *`"settings" is the wrong shape
— expected users[] of { email, name, role_id naming one of auth_roles }`*. The document was internally
consistent: every user's `role_id` was one of **its own** `auth_roles`.

**Cause.** `validateSettings` read `db.auth_roles`, and `db` is a Proxy over "the document this request
selected". At boot there is no request in flight, so `activeDataset()` returns the primary — which meant
CAPEX's users were checked against **EPA's** personas. It never showed while CAPEX was empty and carried
the primary's block verbatim; the moment it became its own tenant, the check compared two unrelated
identity models and blamed the shape.

**Fix.** Thread the candidate document through `DB_SHAPE`'s checks (`check(value, empty, candidate)`) and
have `validateSettings` take it, so the roles come from the document being validated. A document has to
be valid on its own terms — that is what "one document per dataset" means.

**The general shape.** Any validator that reads the ambient `db` while checking a *candidate* is asking
one dataset about another. `validateDb` is called per document at boot, so **every cross-key check inside
it must read `candidate`, never `db`.** Worth grepping for: the parity check further down the same
function had the same bug and was fixed in the same pass.

**Two things the same import needed, both additive rather than destructive.** The document brought
`_meta` and `_provenance` — a top-level key with no `MERGE_PLAN` rule stops the boot, which is the guard
working, so both are declared `primary`. And its report definitions use a scope (`sc_author_all`) and a
spine (`projects`) this server did not know; both were added to the maps rather than edited in the
document, because `_meta` says the file is generated and a value changed on this side would be lost at
its next rebuild.

**And `npm run seed:settings` now takes a dataset.** The blocks CAPEX was missing —
`report_defaults` / `report_permissions`, added to `validateSettings` after its document was generated —
are authored by `npm run seed:settings -- CAPEX`, which for a secondary dataset writes **only the missing
blocks** and leaves the users, navigation and locked row alone. Their values are *derived* from the
document's own `governance.data_scope.may_author` rather than guessed, mapped person → persona through
its own user list, and a persona whose people disagree is refused rather than silently reduced.

## Splitting the repo into two packages: what would have failed silently

**The change.** `mock-server/` became `backend/` with its own zero-dependency `package.json`, the app
moved to `frontend/` with every runtime dependency, and the root kept only the docs, `check-docs` and
the audit gate. Two deployable packages, no npm workspaces.

**Four things broke in ways a build would not have told us about, and all four were caught by running
the gates rather than by reading the diff.**

**1. The audit gate would have passed by looking at nothing.** `npm audit` reports on the package in its
working directory. Run from a root that installs nothing, it finds no lockfile and `audit-gate` treats
that as "registry unreachable — skipping", exits 0, and the gate is green while auditing an empty tree.
A gate whose good answer is its own inability to see is exactly what that file exists to prevent, so the
directory is an argument now. The first attempt read it from `process.argv[4]` when the invocation puts
it at `argv[3]`, and the symptom was the same silent skip — which is worth noting: **the failure mode of
this bug looks identical to the bug it was fixing.**

**2. `check-docs` reads ~320 paths, and three of them were not string-rewritable.** A bulk rewrite of
quoted `'src/'` → `'frontend/src/'` handled most, but the directory *walks* used bare `'src'`, and
`importersOf` derived a repo-relative path with `f.slice(f.indexOf('/src/') + 1)` — which silently
returned `src/...` under the new layout and killed the run before any summary. That is the
"claim total stops moving" failure: the gate crashed, and a crashed gate reports nothing rather than
reporting a problem. It derives from `root` now instead of hunting for a path segment.

**3. The stylesheet walk compared paths from two different roots.** Its skip list is read out of
`frontend/tsconfig.app.json`, whose `exclude` is relative to that package (`src/ESS`), while every path
in `check-docs` is relative to the repo root. Unprefixed, the walker skipped nothing and the claim
asserted that `src/ESS` exists at the root, which it has not since the move.

**4. A user-facing sentence named a path that no longer existed.** `ApiErrorAlert` tells a reader
*"Every page reads from `mock-server/db.json` through that server"*, and `DbEditorPage`'s subtitle says
the same. Those are **copy**, not comments: they send somebody to a directory that is gone. Grepping for
the old name across `src/` — not just fixing imports — is what found them.

**What was deliberately not rewritten.** This file. A regression log records what happened *at the time*,
and the entries above this one describe a repo where the backend really was `mock-server/`; rewriting the
history to match the present would make every one of them a slightly false record.

**How the move was verified.** The set of failing `check-docs` claims was captured before the move and
compared by label after every stage. "Same 13 failures" is the only evidence that a 320-path rewrite
changed no meaning — a passing build proves the imports resolve and says nothing about the claims.

**The trap left behind.** `frontend/package-lock.json` still carries `"name": "context-weave-latest"`
from the pre-split manifest. npm rewrites it on the next install and nothing reads it meanwhile, but
`npm ci` against a renamed package is the kind of thing that fails once, in CI, with a confusing message.

## A schema written when one dataset had profiled everything refused the second dataset's real data

**Symptom.** Browsing a CAPEX source: *"The browsable objects could not be read — the data did not look
the way this app expects. Restarting the mock server (npm run mock) usually fixes it. Details:
datasets[0].tables[0].rows should be a number, got null (+8 more)"*.

**The message sends you the wrong way, and that is worth noting on its own.** "Restarting the mock server
usually fixes it" is the right first guess for a validation failure — a stale process answering with an
old shape is the common cause — and here it was not the cause at all. The server was current; the
*schema* was narrower than the data. A validator can only say "this is not what I expected"; which side
is wrong is a judgement it cannot make.

**Cause.** `rows: num` in `BROWSE_PAYLOAD`, and again in the profiled-tables payload. EPA has 8 tables and
all 8 are profiled, so `rows` was always a number and the declaration was true by accident. CAPEX ships a
64-table Table Catalog of which **62 have `rows: null`**, and its own provenance says why: *"rows is null
for the 60 tables the package catalogued but did not profile — that is the honest value, not zero."* A
catalogue lists what exists; profiling is what counts rows.

**Fix.** `nullable(num)` at both schema sites, `number | null` at both type sites, and — the part that
actually matters — **the renderers had to learn to say something other than a number**. `t.rows ?? 0`
would have made this compile and print **"0 rows"**, which is a *claim*: it says the table is empty when
the truth is nobody has looked. `rowCountLabel` / `profiledRowCountLabel` in `frontend/src/data/` print
"row count not profiled" instead, and `0` stays distinguishable because a profiled empty table really is
0 rows.

**Two server-side sites had the same `?? 0` and only one of them was a bug.** Both feed
`tableDictionary`, which scales synthesised statistics by the row count and genuinely needs a number — 0
is a serviceable floor for arithmetic nobody reads. One of them *also* built a displayed string,
`size: "0 rows"`, on the graph wizard's coverage evidence. Same expression, two obligations: the fix was
to separate `rowCount` (may be null, is shown) from `rows` (must be a number, is hashed).

**The general rule.** **A field's declared type is a claim about every dataset, not the one in front of
you.** `rows: num` was never verified — it was inferred from a dataset where the null case did not occur.
When a second tenant, dataset or customer arrives, the fields most likely to break are the ones that were
*optional in the domain and mandatory in the schema by coincidence*. And when widening one, check every
consumer for `?? 0`: the compiler is satisfied by a default that lies.

**Wording duplicated on purpose.** The phrase exists in `frontend/src/data/rowCount.ts` and in
`backend/server.mjs`. The two packages deploy independently and must not import each other, so a shared
constant would couple them; the comment at each site names the other.

## A Procfile comment failed an Elastic Beanstalk deploy after npm install had succeeded

**Symptom.** `eb-engine.log`: `An error occurred during application deployment: failed to generate rsyslog
file with error Procfile could not be parsed`. Everything before it succeeded — `.ebextensions` ran,
`npm install` completed, `npm rebuild` completed — and the error names **rsyslog**, which has nothing to do
with the cause.

**Cause.** The `Procfile` opened with a six-line `#` comment explaining why it existed. EB's parser treats
every non-empty line as `name: command` and **does not support comments**. This repo's house style is to
explain every file in a header comment; that habit is what broke the deploy.

**Fix.** The file is one line — `web: node server.js` — and the explanation moved into
`backend/scripts/bundle-eb.js` beside the entry that ships it.

**Guard.** `bundle-eb.js` now refuses to write a bundle whose Procfile has a comment or a line that is not
`name: command`, break-tested both ways. The point is *where* the check runs: EB validates the Procfile
**after** installing dependencies, so the feedback arrives a minute later attached to the wrong subsystem.
Checking it at bundle time turns a confusing remote failure into a local refusal that names the line.

**Four attempts, four different causes, and only the last one was legible.** In order: a zip whose root
was a folder (EB: "failed to generate a 'Procfile'... provide package.json, server.js or app.js");
load-balancer-only namespaces in `.ebextensions` on a single-instance environment (EB: "Your source bundle
has issues"); `S3_BUCKET` set with no credentials on the instance, so the boot read 403'd and the server
refused to start by design (EB: "Engine execution has encountered an error"); and this one. **Three of the
four EB messages named the wrong thing.** `eb-engine.log` named the right thing on the first read.

**The lesson about process, not code.** I inferred the first three causes from the event stream and was
right twice, wrong once — and "wrong once" cost a deploy cycle each time. The log was one command away
throughout:

    aws elasticbeanstalk request-environment-info  --environment-name <env> --info-type tail
    aws elasticbeanstalk retrieve-environment-info --environment-name <env> --info-type tail

When a platform reports a failure in its own vocabulary, get its log before theorising. The event stream
is a summary written for a dashboard; the log is the thing that knows.

**And a deploy that never changed.** Four of those attempts re-sent `app-260820_113110` — the console's
*Deploy* on an existing application version re-uploads that same bundle, so none of the first three fixes
was ever on the instance. A new bundle needs a new **version label**.

## A secondary dataset's document was uploaded under its local filename, and the 404's remedy pointed elsewhere

**Symptom.** A deployed box could not boot against the bucket: `no object at
s3://contextweave.com/CAPEX/db.json`. The object had in fact been uploaded, by hand, minutes earlier — a
listing of the bucket showed `CAPEX/db.CAPEX.json`, 2,043,666 bytes, ETag matching the local file's MD5
exactly. The bytes were right; only the name was wrong, and nothing on either side said so.

**Cause.** `localDocPath` suffixes a secondary dataset's *local* file — `backend/db.json` for EPA,
`backend/db.CAPEX.json` for CAPEX — because two documents share one directory and the plain name is what
every command and every seed already names. **In the bucket the prefix does that job**, so the key is
`CAPEX/db.json`. The suffix is an artefact of the filesystem, and carrying it into the key is the obvious
thing to do when uploading by hand, because the file in front of you is called `db.CAPEX.json`.

**What made it expensive** was the remedy the 404 printed: `upload one with: npm run db:push`. That command
takes the dataset as a **named argument** and defaults to the primary, so running it re-uploads EPA,
changes nothing about the missing object, and reports success. A reader following the message watches the
same 404 survive the fix it named — and spends the one guess they had.

**Fix.** `readDoc`'s 404 derives the dataset from the ref it was handed and names it:
`npm run db:push -- CAPEX`. The prefix is read off the key's first segment rather than imported from
`datasets.js`, because `store.js` owns only how bytes move and the ref already carries the answer.

**Guard.** None in `check-docs` — it cannot see a bucket, and a claim whose good answer is its own
inability to look is the fail-open shape this repo has already been bitten by. The remedy string is the
guard: it is now correct for every dataset by construction rather than for the primary by accident.

**The general shape, which has now cost time twice.** *A remedy that does not remedy the thing it was
printed for is worse than no remedy.* The same reasoning is why `validateDb` names the missing key and the
restore command, and why the boot banner prints the ref it actually read. An error message is a branch of
the program, and a branch that is right for the default case and quietly wrong for every other one is a
bug with better manners.
