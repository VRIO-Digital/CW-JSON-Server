# React 18 + TypeScript + Vite

A React **18** application with TypeScript, built with Vite, and wired so that
adding a vulnerable dependency fails loudly instead of slipping in silently.

## Stack

| Piece      | Version  |
| ---------- | -------- |
| react      | 18.3.1   |
| react-dom  | 18.3.1   |
| typescript | 6.0.x    |
| vite       | 8.x      |
| oxlint     | 1.x      |

React is pinned to the 18 line (`^18.3.1`), so `npm update` will not pull in
React 19. `@types/react` and `@types/react-dom` are pinned to their matching
18.x lines — mixing React 18 with React 19 types is a common source of
confusing type errors, so keep those three in step if you ever bump versions.

## Scripts

```bash
npm run dev        # dev server with HMR
npm run build      # tsc -b && vite build
npm run preview    # serve the production build
npm run lint       # oxlint
npm run audit      # fail if ANY advisory is present
npm run audit:fix  # npm audit fix
npm run preflight  # lint + build + audit — run before pushing
```

## Vulnerability gate

`scripts/audit-gate.mjs` runs `npm audit --json`, and **exits non-zero if any
advisory at or above the threshold exists**. The threshold defaults to `low`,
which means anything at all fails.

It is wired to `postinstall`, so it runs automatically on every
`npm install` / `npm i <package>`:

```
$ npm i some-old-package

> postinstall
> node scripts/audit-gate.mjs low

audit-gate: FAILED — 1 vulnerability(ies) at or above "low".
  [critical] minimist 1.0.0 - 1.2.5
      Prototype Pollution in minimist
      https://github.com/advisories/GHSA-vh95-rmgr-6w4m
      fix: available via `npm audit fix`
```

### Why not just `npm audit --audit-level=low` in postinstall?

Because bare `npm audit` also exits 1 when it simply *cannot reach* the
registry — so every offline install and every CI runner without registry access
would fail for the wrong reason. The gate distinguishes the two: a registry
error prints a warning and exits 0, while a real advisory fails.

### Important caveat

`postinstall` runs **after** packages are written to `node_modules`. The gate is
a loud, build-breaking alarm — not a preventative block. When it fires, the bad
package is already on disk, so act on it:

```bash
npm run audit:fix          # try the automatic upgrade
npm uninstall <package>    # or back it out entirely
```

### When a fix is not published

If a transitive dependency is vulnerable and the direct dependency hasn't
released an update, pin the fixed version yourself with `overrides` in
`package.json`:

```json
{
  "overrides": {
    "vulnerable-transitive-dep": "^1.2.3"
  }
}
```

Then re-run `npm install` so the gate re-evaluates.

### Adjusting the threshold

```bash
node scripts/audit-gate.mjs moderate   # ignore low-severity advisories
AUDIT_LEVEL=high npm run audit         # or via env var
```

To change the default for installs, edit the `postinstall` script in
`package.json`. `.npmrc` sets `audit-level=low` so that a bare `npm audit`
matches the gate's strictness.

### Escape hatch

If you ever need to install without the gate running:

```bash
npm install --ignore-scripts
```

## Notes

- The scaffolded `src/App.tsx` is Vite's starter page — safe to delete. Its
  external links use `target="_blank"` without `rel="noreferrer"`; current
  browsers imply `noopener` there, but add `rel="noreferrer"` if you keep them.
- `npm audit` covers *known, published* advisories only. It is not a substitute
  for reviewing what a new dependency actually does before adding it.

## Expanding the Oxlint configuration

For a production application, enable type-aware lint rules by installing
`oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules).
