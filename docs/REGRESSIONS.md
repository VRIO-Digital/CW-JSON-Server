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
