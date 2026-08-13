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

**Symptom** — the catalogue showed real table and column counts for a freshly
registered source, while the UI copy said counts "stay 0 until the Metadata
Profiler has run".

**Root cause** — catalogue rows were populated from `db.json`'s table data at
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
(Drive). A one-character name passed too. The Sources table, the Catalogue tab and
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
