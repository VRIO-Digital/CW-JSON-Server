---
name: contextweave-flow
description: Use for ANY work in this ContextWeave repo — adding or changing a page, endpoint, store, connector, or profiling behaviour; fixing a bug; refactoring; or answering "how does X work". Reads CLAUDE.md and SKILLS.md first so the change matches the existing structure and layer order, then keeps both files current, and turns every bug fixed into a guard that stops it recurring. Triggers on feature requests, on any "X is broken / not working / looks wrong" report, and on questions about a flow.
---

# ContextWeave work loop

Four phases, in order: **orient → build → verify → record**. Do not skip record;
it is what stops the same mistake twice.

## 1. Orient (before writing any code)

1. `CLAUDE.md` is already in context — it holds structure, conventions, and the
   pitfall list. Trust it over your own assumptions about this repo.
2. Read the relevant flow in **`SKILLS.md`** (eleven flows: connect a source ·
   registered source · browse→profile→pipeline · column dictionary · `/db`
   editor · request→state · New Graph · Graph Studio · Ask · What-if · Reports).
   Read the section, not the whole file.
3. Read **`docs/REGRESSIONS.md`** if the request is a bug report, or if you are
   about to touch the mock server, antd props, spacing, or a store selector.
   Check whether this exact failure already happened.
4. State the flow before coding — which layers change, in order:

   ```
   server.mjs → client.ts schema → client.ts fetcher → store action → component
   ```

   Name the layers you will touch. If a layer is skipped, say why. **The schema
   is never optional** — an endpoint without one turns a bad payload into
   `Cannot read properties of undefined` inside a render.

If the request is only a question, answer from `SKILLS.md` and stop.

## 2. Build

Follow the conventions in `CLAUDE.md` rather than rediscovering them. The ones
most often got wrong:

- Store actions return `Result` (`{ ok: true } | { ok: false, error }`) and never
  throw. All `try/catch` lives in the store; components branch on `result.ok`.
- `load()` sets `error` in state; a failed reload keeps the previous data.
- antd v6 — check the installed `.d.ts` before using a prop. Do not assume v5.
- Spacing from `--sp-*` / `SP` only. Layout via antd `Row`/`Col`.
- Status colours are reserved for state, and always ship an icon plus a label.
- No new dependency without checking `npm audit` before and after. Prefer
  writing ~100 lines over adding a package.

## 3. Verify

```bash
npm run preflight      # lint + build + audit + doc check
```

Then prove the behaviour. There is no test runner — build a throwaway SSR script
and run it:

```bash
npx vite build --ssr smoke.tsx --outDir dist-ssr --logLevel warn && node dist-ssr/smoke.js
```

**Exercise the failure paths, not just the happy one.** Nearly every real bug in
this repo was a wrong shape or a stale process, and both only appear when you
check what happens when things go wrong. For API work, stub `globalThis.fetch`
and assert the rejection message names the field.

Delete the scratch files when done. Report what passed and what you did not
check — never imply coverage you did not run.

If the mock server misbehaves before you suspect your code: confirm which
process owns port 4000 and whether it predates your edits. A server started
before a shape change keeps answering with the old fields.

## 4. Record

This is the phase that compounds. Do it in the same turn as the change.

### Any feature or behaviour change

Update the docs so the next session inherits the truth:

| Changed | Update |
|---|---|
| New endpoint, store, or convention | `CLAUDE.md` — architecture / conventions |
| New or altered user-facing flow | `SKILLS.md` — the affected flow, with its failure modes |
| New page or route | both — `CLAUDE.md` routing note, `SKILLS.md` flow |
| Counts, names, tokens (connectors, stages, keys) | `scripts/check-docs.mjs` if the assertion needs to move |

Keep both files factual and terse. Do not append a changelog — edit the section
that is now wrong. If a doc line is no longer true, that is a bug in the doc.

### Any bug fixed

Add an entry to **`docs/REGRESSIONS.md`** using its template: symptom, root
cause, fix, **guard**. Then add the one-line pointer to the "Known pitfalls"
list in `CLAUDE.md` so it is in context automatically next session.

Rank the guard — prefer the strongest one available:

1. **Mechanical** — a check in `scripts/check-docs.mjs`, a schema in `client.ts`,
   a validator in `server.mjs`, a type that makes the mistake unrepresentable.
   A guard that fails the build cannot be forgotten.
2. **Diagnostic** — an error message that names the cause and the fix, like the
   stale-server hint in `listSources` or the `EADDRINUSE` handler.
3. **Documented** — a line in `CLAUDE.md`. Weakest; use only when the first two
   genuinely do not apply.

A fix with no guard is not finished. If you cannot mechanise it, say so and
explain why the documented note is the best available.

## Doc drift

`npm run check-docs` verifies the factual claims in `CLAUDE.md` and `SKILLS.md`
against the code — connector counts, pipeline stages, required `db.json` keys,
spacing tokens, poll interval, route/doc-comment parity. It runs inside
`preflight`. When it fails, the code and the docs disagree: fix whichever is
wrong, and do not silence the check to make it pass.
