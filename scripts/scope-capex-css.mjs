/**
 * Scope the CAPEX report layer's stylesheet — `node scripts/scope-capex-css.mjs`.
 *
 * **Why a script and not a hand edit.** `src/report/src/styles/prototype.css` is 2,322 lines and 1,440
 * rules of vendored design code, and it owns its page: `*{box-sizing:border-box; margin:0; padding:0}`
 * plus bare `body`, `a` and `h1,h2,h3`. Dropped into this app unscoped it resets every antd component
 * and restyles headings on pages nobody touched — the exact regression
 * `src/reports/reports-prototype.css` had to be scoped to stop, and it fails silently.
 *
 * So the scoping is generated, re-runnable, and **checked**: the transform must change selectors and
 * nothing else, which the integrity pass at the bottom asserts by comparing every rule *body* before and
 * after. That check has already earned its place twice — once when a `  N  ` placeholder collided with
 * plain numbers in declarations and spliced a comment's prose into the middle of a rule, and once when a
 * comment sitting between `}` and the next selector was folded into the selector, scoping nothing.
 *
 * **Comments are handled inline rather than lifted out.** A `{` inside prose would desynchronise the
 * depth counter, so the scanner tracks a comment flag and passes those characters through untouched —
 * no placeholder, so nothing can collide with one.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'src/report/src/styles/prototype.css')
const OUT = join(root, 'src/capex-report/capex-report.css')
const SCOPE = '.cw-capex-report'

const raw = readFileSync(SRC, 'utf8')

/** One selector, scoped. The page-level rules fold onto the wrapper rather than being prefixed. */
const scopeSelector = (part) => {
  const sel = part.trim()
  if (!sel) return part
  /* Everything inside the scope, and the scope itself — that is what `*` meant when it owned a page. */
  if (sel === '*') return `${SCOPE}, ${SCOPE} *`
  /* The wrapper *is* the page ground here. */
  if (sel === 'body' || sel === 'html' || sel === ':root') return SCOPE
  /* Already scoped: the transform is idempotent, so a re-run is safe. */
  if (sel.startsWith(SCOPE)) return sel
  /* `body.dark` / `:root[data-theme]` become the wrapper carrying that qualifier. */
  if (/^(body|html|:root)([.:[])/.test(sel)) return SCOPE + sel.replace(/^(body|html|:root)/, '')
  /*
   * **A bare attribute selector qualified the page, so it qualifies the wrapper — not a descendant.**
   *
   * The sheet declares its palette as `:root, [data-theme="dark"]{…}` and `[data-theme="light"]{…}`,
   * meaning "the page is in this theme": on `<html>`, which is where the standalone app set the
   * attribute. Prefixed as a descendant (`.cw-capex-report [data-theme="light"]`) the light block can
   * only match an element *inside* the report that carries the attribute — nothing does — so the report
   * rendered dark inside a light app however the wrapper was marked. Attached to the wrapper
   * (`.cw-capex-report[data-theme="light"]`) it means what it meant.
   *
   * Only a *leading* attribute selector: `[hidden] .foo` is a real descendant rule and is prefixed
   * normally.
   */
  if (/^\[[^\]]+\]$/.test(sel)) return SCOPE + sel
  return `${SCOPE} ${sel}`
}

/**
 * A prelude, scoped — with any leading comments and whitespace left exactly where they were.
 *
 * A note between `}` and the next selector is part of the prelude as far as the scanner is concerned.
 * Folding it into the selector produced `.cw-capex-report <the whole comment> .srcTag.BQ`, which scoped
 * nothing and read as a comment moved into a rule.
 */
const scopePrelude = (prelude) => {
  const lead = prelude.match(/^(?:\s|\/\*[\s\S]*?\*\/)*/)[0]
  const selectors = prelude.slice(lead.length)
  if (!selectors.trim()) return prelude
  return lead + selectors.split(',').map(scopeSelector).join(', ')
}

let out = ''
let buf = ''
let depth = 0
/* What each open brace was: a rule, a nested at-rule, a keyframes block, or something else. */
const stack = []

for (let i = 0; i < raw.length; i++) {
  /* A comment passes through verbatim and cannot move the depth. */
  if (raw[i] === '/' && raw[i + 1] === '*') {
    const end = raw.indexOf('*/', i + 2)
    const stop = end < 0 ? raw.length : end + 2
    buf += raw.slice(i, stop)
    i = stop - 1
    continue
  }

  const ch = raw[i]

  if (ch === '{') {
    const prelude = buf
    buf = ''
    const head = prelude.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    const inKeyframes = stack.includes('keyframes')
    /* Inside `@media` a rule sits at depth 1; elsewhere a rule sits at depth 0. */
    const selectorDepth = stack[stack.length - 1] === 'nested' ? 1 : 0

    if (head.startsWith('@')) {
      stack.push(
        /^@(-\w+-)?keyframes\b/.test(head)
          ? 'keyframes'
          : /^@(media|supports|layer|container)\b/.test(head)
            ? 'nested'
            : 'other',
      )
      out += prelude + '{'
    } else if (!inKeyframes && depth === selectorDepth) {
      stack.push('rule')
      out += scopePrelude(prelude) + '{'
    } else {
      /* A keyframe step, or a prelude nested deeper than a selector can be. */
      stack.push('rule')
      out += prelude + '{'
    }
    depth++
    continue
  }

  if (ch === '}') {
    out += buf + '}'
    buf = ''
    depth = Math.max(0, depth - 1)
    stack.pop()
    continue
  }

  buf += ch
}
out += buf

/* Drop the source's own header comment; this file gets one of its own that says what it is. */
const body = out.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '')

const header = `/*
 * The CAPEX report layer's stylesheet, **scoped** — generated by \`scripts/scope-capex-css.mjs\`.
 *
 * Vendored from \`src/report/src/styles/prototype.css\` with its figures and spacing intact: every
 * selector prefixed with \`${SCOPE}\`, and the sheet's page-level rules (\`*\`, \`body\`, \`a\`,
 * \`h1,h2,h3\`) folded onto that wrapper.
 *
 * **The scoping is not tidiness.** The original owns its page — \`*{box-sizing:border-box; margin:0;
 * padding:0}\` and bare \`body\`, \`a\`, \`h1,h2,h3\`. Unscoped it resets every antd component in the app
 * and restyles headings on pages nobody touched, silently, which is exactly the regression
 * \`src/reports/reports-prototype.css\` had to be scoped to stop. \`check-docs\` asserts it stays scoped.
 *
 * **Audit anything that portals out of the scope.** The EPA prototype's menu host portals to
 * \`document.body\`, outside its wrapper, and lost its \`position\`, \`z-index\` and background when its
 * sheet was scoped — Delete looked like a dead button while actually opening an invisible dialog. The
 * renderers vendored beside this file mount no portal, which is why nothing needed the
 * \`display: contents\` treatment; re-check that if a modal or a toast is added here.
 *
 * **Exempt from the \`--sp-*\` spacing rule, as vendored design code**, on the same terms as the other
 * two: its rhythm is its own, and a 4px scale cannot express it without redrawing somebody else's
 * design. The exemption list is named and finite; nothing authored in this repo joins it.
 *
 * DO NOT HAND-EDIT. Change \`src/report/\` and re-run the transform.
 */

`

writeFileSync(OUT, header + body)

/* ---------------- integrity: selectors changed, nothing else did ---------------- */

/**
 * Every rule body, in order, with whitespace normalised.
 *
 * Comparing bodies rather than declaration counts is the check that actually holds: it catches a
 * comment relocated into a rule, a declaration dropped, and a brace desynchronised — all three of which
 * this transform has done at some point while reporting success.
 */
const bodies = (text) => {
  const found = []
  const stack = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = (end < 0 ? text.length : end + 2) - 1
      continue
    }
    if (text[i] === '{') {
      stack.push({ start: i + 1, nested: false })
      if (stack.length > 1) stack[stack.length - 2].nested = true
    } else if (text[i] === '}') {
      const open = stack.pop()
      /* Leaf blocks only. A rule inside `@media` has its selector at depth 1, so comparing
         depth-1 blocks compared selectors as though they were bodies — which is the whole thing
         this transform is allowed to change, and it reported corruption on every media query. */
      if (open && !open.nested) {
        found.push(text.slice(open.start, i).replace(/\s+/g, ' ').trim())
      }
    }
  }
  return found
}

const before = bodies(raw)
const after = bodies(header + body)
const mismatch = before.findIndex((b, i) => b !== after[i])

/* Comments stripped before the scan: one of them contains `class="srcTag ${`, and a brace inside
   prose truncated the prelude match so a correctly scoped selector was reported as unscoped. The
   scanner above already handles comments; this check has to as well. */
const scanned = (header + body).replace(/\/\*[\s\S]*?\*\//g, '')
const preludes = scanned.match(/(?:^|\})[^{}@]*\{/g) ?? []
const unscoped = preludes.filter(
  (p) => !p.includes(SCOPE) && !/(?:^|\})\s*(?:from|to|\d+(?:\.\d+)?%)\s*\{/.test(p),
)

console.log(`scope-capex-css: wrote src/capex-report/capex-report.css`)
console.log(`  ${before.length} rule bodies before, ${after.length} after`)
console.log(`  bodies identical: ${before.length === after.length && mismatch < 0}`)
console.log(`  ${preludes.length} top-level preludes, ${unscoped.length} unscoped`)

if (before.length !== after.length || mismatch >= 0) {
  console.error(`\n  refusing: rule bodies changed at index ${mismatch}`)
  console.error(`    before: ${String(before[mismatch]).slice(0, 160)}`)
  console.error(`    after:  ${String(after[mismatch]).slice(0, 160)}`)
  process.exit(1)
}
if (unscoped.length > 0) {
  console.error(`\n  refusing: ${unscoped.length} selector(s) left unscoped`)
  for (const p of unscoped.slice(0, 5)) console.error(`    ${p.replace(/\s+/g, ' ').trim().slice(0, 140)}`)
  process.exit(1)
}
