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
