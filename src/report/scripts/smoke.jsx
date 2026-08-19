/* ==========================================================================
   RENDER SMOKE TEST

   Every block renderer, on every real payload, for all three reports — plus the
   library, all seven lineage sections, both modals and the graph at each of its
   three annotation layers and three tiers.

   This exists because of a failure the prototype's own comments describe twice: a
   handler and a renderer agreeing on a block type and disagreeing on its shape,
   with nothing looking at what came out. `bVendors` read `b.allowed` and
   `b.values`, which the api had stopped serving, so a whole block of the project
   report rendered as a masking notice for a masking that was not happening — and
   it rendered, so nothing failed. A build that compiles proves nothing about that.

   Run: node --experimental-strip-types is not needed; this goes through esbuild
   via `npm run smoke`.
   ========================================================================== */
import React from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { Route, Routes } from 'react-router-dom'

import { ReportStateProvider, ReportStateContext, ViewProvider } from '../src/state/ReportState.jsx'
import LibraryPage from '../src/pages/LibraryPage.jsx'
import ReportPage from '../src/pages/ReportPage.jsx'
import Block from '../src/components/blocks/index.jsx'
import LineageDrawer from '../src/components/report/LineageDrawer.jsx'
import SpecModal from '../src/components/report/SpecModal.jsx'
import ExportModal from '../src/components/report/ExportModal.jsx'
import { reports, resolvedById } from '../src/lib/db.js'

/* Rows inside a panel the reader opens. Genuinely not on the page until they open
   it, which is the design rather than a gap. */
const COLLAPSED = {
  expansions: 1, orders: 1, loose: 1, items: 1, history: 1, drilldown: 1,
}

/* ── SERVED, AND DELIBERATELY NOT DRAWN ────────────────────────────────────────
   Three figures the resolver formats and the prototype's renderers never print.
   They are listed WITH THEIR REASON rather than quietly excluded, because the
   difference between "we chose not to draw this" and "we lost it" is the entire
   value of the check above, and an unnamed exclusion is indistinguishable from a
   bug that has been normalised.

   Anything not on this list that goes missing fails. The list is short on purpose:
   if it grows, the check is turning into a rubber stamp. */
const NOT_DRAWN = {
  /* `chain.steps` is the delta between each pair of adjacent stages. The chain is a
     sequence, not a bridge — its own payload says "each stage is a different measure
     at a different coordinate, and nothing here adds across stages", and one of the
     four steps crosses from commitment to record basis carrying a note that it is
     not a licensed cross-basis quantity. Printing the deltas between the bars would
     invite exactly the subtraction the coordinate rules refuse without a declared
     licence. A waterfall block is what you reach for when the deltas ARE the point,
     and this is not one. */
  steps: 1,
  /* `lineItems.groups[].outsidePackages` — the project budget less what was let
     under contract. The group's `outsideNote` states both ends of the subtraction
     and what the difference consists of ("design allowance, owner-furnished
     equipment, internal labour and unreleased contingency … a definition, not a
     reconciliation break") without printing the figure itself. */
  outsidePackages: 1,
}

let failures = 0
let checks = 0

function check(name, fn) {
  checks++
  try {
    const html = fn()
    if (!html || html.length < 20) throw new Error('rendered ' + (html || '').length + ' chars')
    return html
  } catch (e) {
    failures++
    console.error('FAIL  ' + name + '\n      ' + (e && e.message))
    return ''
  }
}

const at = (path, node) => renderToString(
  <StaticRouter location={path}><ReportStateProvider>{node}</ReportStateProvider></StaticRouter>
)

/* A page that reads route params has to be rendered THROUGH A MATCHED ROUTE.
   Rendering it bare under a StaticRouter gives it an empty params object, so
   ReportPage takes its not-found branch and every content assertion below fails
   for a reason that has nothing to do with the component. */
const atRoute = (path, pattern, node) => renderToString(
  <StaticRouter location={path}>
    <ReportStateProvider>
      <Routes><Route path={pattern} element={node} /></Routes>
    </ReportStateProvider>
  </StaticRouter>
)

/* ── the library ─────────────────────────────────────────────────────────── */
const lib = check('library page', () => at('/', <LibraryPage />))
reports.forEach(r => {
  if (lib.indexOf(r.name) < 0) { failures++; console.error('FAIL  library omits ' + r.name) }
})

/* ── each report page, whole ─────────────────────────────────────────────── */
reports.forEach(r => {
  const html = check('report page · ' + r.slug, () =>
    atRoute('/reports/' + r.slug, '/reports/:slug', <ReportPage />))
  const v = resolvedById(r.id)

  /* EVERY BLOCK LABEL MUST BE ON THE PAGE. A block that renders as an empty div
     passes a "did it throw" test and fails the only test that matters. */
  v.blocks.forEach(b => {
    const label = b.label || b.title || ''
    if (label && html.indexOf(escapeHtml(label)) < 0) {
      failures++
      console.error('FAIL  ' + r.slug + ' · block "' + label + '" (' + b.type + ') not on the page')
    }
  })

  /* No renderer may fall through to the unsupported-type band. */
  if (html.indexOf('Unsupported block type') > -1) {
    failures++
    console.error('FAIL  ' + r.slug + ' · a block fell through to bUnknown')
  }

  /* The trust bar's as-of and the row counts are the page's own claims about
     itself; a page missing them is a page missing its frame. */
  if (html.indexOf(escapeHtml(v.asOf.display)) < 0) {
    failures++
    console.error('FAIL  ' + r.slug + ' · trust bar as-of missing')
  }

  /* ── AND EVERY SERVED FIGURE MUST BE ON THE PAGE ──────────────────────────
     The point of the port is that the numbers are the resolver's. So the check is
     not "did a renderer produce output" but "did the string the resolver formatted
     reach the screen". Every `display` on every figure, cell, stage, tile and
     total in the payload is collected and looked for.

     This is the assertion that catches a renderer reading a field the resolver
     renamed: the block still draws its frame, its title and its footnotes, and the
     figures quietly go missing. Which is exactly how a whole block of the project
     report once shipped as a masking notice for a masking that was not happening.

     Collapsed rows are excluded because they are genuinely not on the page until
     the reader opens them — that is the design, not a gap.

     A FIGURE COUNTS AS PRESENT IF EITHER ITS `display` OR ITS `exact` IS THERE.
     Not a loophole: a chart segment's figure is carried in the segment's tooltip,
     and the renderer puts the FULLER string there — `$4,996,377,632` rather than
     `$5.00B` — because a tooltip is where a reader goes for the precise number.
     Both strings are the resolver's, so either one satisfies the rule this check
     exists to enforce. */
  const want = collectFigures(v.blocks)
  const missing = want.filter(f =>
    html.indexOf(escapeHtml(f.display)) < 0
    && !(f.exact && html.indexOf(escapeHtml(f.exact)) > -1))
  checks++
  /* The count is printed on success too. A figure check that silently collected
     nothing would pass, and "0 of 0 figures verified" is the shape of that
     failure — so the number is on screen where a reader can see it is not zero. */
  if (!missing.length) {
    console.log('ok    ' + r.slug + ' · ' + v.blocks.length + ' blocks · '
      + want.length + ' served figures on the page')
  }
  if (missing.length) {
    failures++
    console.error('FAIL  ' + r.slug + ' · ' + missing.length + ' of ' + want.length
      + ' served figures not on the page: ' + missing.slice(0, 8).map(f => f.display).join(' | ')
      + (missing.length > 8 ? ' …' : ''))
  }
})

/* Walks a block payload for every formatted figure the resolver produced.
   `display` and `exact` are the contract — they are what the api emits for a
   figure, a cell, a stage, a month tile or a total, and they are the only strings a
   renderer is allowed to print. */
function collectFigures(node, out, depth) {
  const SKIP = Object.assign({}, COLLAPSED, NOT_DRAWN)
  out = out || []
  depth = depth || 0
  if (!node || typeof node !== 'object' || depth > 8) return out
  if (Array.isArray(node)) {
    node.forEach(x => collectFigures(x, out, depth + 1))
    return out
  }
  /* A masked figure prints the word "masked", not its value — so its display, if
     the payload even carries one, is deliberately not on the page. */
  if (node.masked) return out
  if (typeof node.display === 'string' && node.display.trim()) {
    out.push({ display: node.display, exact: typeof node.exact === 'string' ? node.exact : null })
  }
  Object.keys(node).forEach(k => {
    if (SKIP[k]) return
    /* THE BASELINE'S PER-POINT VALUES ARE GEOMETRY, NOT TEXT. It is drawn as a
       line rather than a series precisely because it sits on a different
       coordinate from the stack, and its container is aria-hidden: the reader is
       meant to see the shape and read the amount off the legend, which carries
       `baseline.total.display` and IS checked. So the line's own points are
       descended past — a tooltip on each of twelve monthly points would be
       inviting the eye to difference a commitment-basis figure against a
       record-basis bar, which is the operation the coordinate rules refuse
       without a declared licence. */
    if (k === 'baseline' && node[k] && typeof node[k] === 'object') {
      const { values, ...rest } = node[k]
      collectFigures(rest, out, depth + 1)
      return
    }
    collectFigures(node[k], out, depth + 1)
  })
  return out
}

/* ── each block renderer on its own, so a failure names the block ────────── */
reports.forEach(r => {
  const v = resolvedById(r.id)
  v.blocks.forEach(b => {
    check('block · ' + r.slug + ' · ' + b.type + ' · ' + (b.label || b.id), () =>
      renderToString(
        <StaticRouter location={'/reports/' + r.slug}>
          <ReportStateProvider>
            <ViewProvider view={v}><Block block={b} /></ViewProvider>
          </ReportStateProvider>
        </StaticRouter>
      ))
  })
})

/* ── the lineage drawer, every section, every graph tier and layer ───────── */
const SECTIONS = ['population', 'graph', 'sources', 'measures', 'transforms', 'limits', 'audit']
const LAYERS = ['biz', 'data', 'trust']

reports.forEach(r => {
  const v = resolvedById(r.id)
  const measures = ((v.lineage || {}).graph || {}).measures || []

  SECTIONS.forEach(section => {
    check('drawer · ' + r.slug + ' · ' + section, () => renderToString(
      <StaticRouter location={'/reports/' + r.slug}>
        <MockState lin={{ open: true, section, hit: null, hitLabel: null, node: null, layer: 'biz', full: false, max: false }}>
          <LineageDrawer view={v} onShowSpec={() => {}} />
        </MockState>
      </StaticRouter>
    ))
  })

  /* The graph is the piece with real branching: focused / report-walk / whole
     model, times three annotation layers, times a selected node. */
  LAYERS.forEach(layer => {
    [false, true].forEach(full => {
      const hit = measures.length ? [measures[0].key] : null
      const node = ((v.lineage || {}).graph || {}).nodes?.filter(n => n.walked)[0]
      check('graph · ' + r.slug + ' · ' + layer + (full ? ' · whole model' : ' · walk')
        + (hit ? ' · focused' : ''), () => renderToString(
        <StaticRouter location={'/reports/' + r.slug}>
          <MockState lin={{
            open: true, section: 'graph', hit, hitLabel: 'figure',
            node: node ? node.id : null, layer, full, max: false,
          }}>
            <LineageDrawer view={v} onShowSpec={() => {}} />
          </MockState>
        </StaticRouter>
      ))
    })
  })
})

/* ── the two overlays ────────────────────────────────────────────────────── */
reports.forEach(r => {
  const v = resolvedById(r.id)
  check('spec modal · ' + r.slug, () => at('/reports/' + r.slug,
    <SpecModal view={v} onClose={() => {}} />))
  check('export modal · ' + r.slug, () => at('/reports/' + r.slug,
    <ExportModal view={v} onClose={() => {}} />))
})

console.log('\n' + checks + ' checks, ' + failures + ' failed')
process.exit(failures ? 1 : 0)

/* A provider whose lineage state is FIXED, so a branch that only exists when the
   drawer is open on a particular section — or the graph is widened, or a node is
   selected — is actually reached rather than merely compiled. */
function MockState({ lin, children }) {
  const value = {
    lin,
    linDispatch: () => {},
    toasts: [], toast: () => {},
    modal: null, setModal: () => {},
    pop: null, setPop: () => {},
  }
  return <ReportStateContext.Provider value={value}>{children}</ReportStateContext.Provider>
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
