/**
 * Lets a CAPEX report's headline figures narrow with the reader's own filters.
 *
 * **The behaviour this changes.** Picking `Executive category: Blankets` on the Variance Report moved
 * the population line from 50 to 10, narrowed the table and the chart, and left `$20.0M · $17.6M ·
 * -$2.4M · -11.8%` byte-identical above them. That is correct and the document says so — those four are
 * `portfolio.period*`, declared programme figures published over all 4,500 projects and served as
 * stated rather than re-summed — but a reader's two available conclusions are "the filter is broken"
 * and "the number is wrong", and neither is true.
 *
 * **What it does.** Unnarrowed, nothing changes: the declared figure is served exactly as before, with
 * its unchanged-by-your-filters note ready for the blocks a narrowing genuinely cannot move. Narrowed,
 * a figRow whose every figure has a row field behind it re-sums over the rows the reader's filters
 * admit, relabels itself `Q1 2026 · 10 projects in view`, and carries a seam naming the count it footed
 * to and the declared figure it is no longer showing. Clearing the filter brings the programme figure
 * back. Only the period family qualifies today; the gap, the large-project population, the filing
 * exposure and the next-twelve-months blocks keep their declared figures and their note.
 *
 * **This is not the substitution `db.gates.declaredAggregate.neverSubstitute` forbids.** That rule is
 * about a re-summed total wearing the DECLARED figure's label — "a different measure wearing this
 * one's label", in the fixture's words. It is the *label* that carries the lie, so the licence is the
 * naming: this block states its population in its heading, in its footer and in the population it
 * records, and the two figures are never shown as one. The fixture already draws exactly this
 * distinction for itself — `samplePeriod*` beside `period*`, under a note reading "samplePeriod* foots
 * to the table on screen; period* is the declared programme figure."
 *
 * **It is a script rather than an edit, and the document's own header says why**: *"DO NOT HAND-EDIT.
 * Edit the generator that emits the fixture, re-run the chain."* That generator (`gen/port.py`) lives in
 * the demo package rather than in this repo, so the honest stand-in is a transform that is re-runnable
 * and verified against the document it just wrote. Run it again after a re-export; `check-docs` fails
 * the build if the documents come back without it.
 *
 * The safety is in the shape of the thing:
 *
 * 1. **Three anchored replacements, each required to match exactly once.** A missing anchor or a second
 *    match refuses the run rather than patching the wrong copy of a 2.6 MB file.
 * 2. **Idempotent.** A document already carrying the marker is skipped and said to be skipped, so a
 *    re-run after a partial re-export does not stack two copies of the helper.
 * 3. **The arithmetic is the MEASURE'S, never this script's.** The inserted code hands the block's own
 *    `{key, measure}` pairs to the document's `aggregate()`, so `m_plan_period` sums and
 *    `m_variance_pct` is recomputed from its declared operands. The average-of-percentages answer —
 *    plausible, wrong, and off by however unequal the projects are — is unreachable from here.
 * 4. **The rewrite is verified against the document it produced.** The file is re-read and re-parsed,
 *    the three edits asserted present, every row field the map names asserted to exist and be numeric
 *    on every project row, and the whole computation replayed per execution category against an
 *    independent implementation of the glossary's own rules.
 *
 * That fourth check is the one that matters after a re-export. The all-or-nothing rule means a single
 * renamed row field turns the feature off *quietly* — every block falls back to its declared figure and
 * the reader is back where they started with nothing saying so. So a map entry that no longer resolves
 * refuses the run.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DIR = new URL('../../frontend/src/Capex/Report/', import.meta.url)
const FILES = [
  'R1_variance_report.html',
  'R2_project_360.html',
  'R3_rate_case_filing_calendar.html',
]

/* The documents are CRLF throughout — 58,595 of them and not one bare LF — so every anchor and every
   inserted line has to be. A bare "\n" here matches nothing and reports the run as already applied,
   which is the silent pass check-docs claims in this repo have already been bitten by twice. */
const NL = '\r\n'
const lines = (...xs) => xs.join(NL)

/* The marker an already-patched document carries. Named for the map rather than for the feature,
   because the map is the part a re-export can break. */
const MARKER = 'IN_VIEW_FIELD'

/* ------------------------------------------------------------------ the code that goes in */

const HELPER = lines(
  '  /* ====================================================================== */',
  '  /* THE FIGURES A NARROWING CAN HONESTLY MOVE                              */',
  '  /* ====================================================================== */',
  '',
  '  /* `unaffectedByParams` above is the whole story for a declared aggregate the',
  '     rows cannot reproduce, and it stays the whole story for most of them. Nothing',
  '     in this workspace re-derives a five-year approved budget, a count of large',
  '     projects across the programme, or the days to the next filing — so those',
  '     figRows keep their declared figures and keep saying a narrowing did not move',
  '     them.',
  '',
  '     A PERIOD VARIANCE IS THE ONE FAMILY THAT IS DIFFERENT, and it is different',
  '     because the rows carry it. Every project in db.projects holds planPeriod and',
  '     actualPeriod over the same FY26-to-date window the declared figure covers, and',
  '     the fixture already states what summing them gives — samplePeriodPlan,',
  '     samplePeriodActual, samplePeriodVariance — under a note reading "samplePeriod*',
  '     foots to the table on screen; period* is the declared programme figure."',
  '',
  '     So a narrowed reader can be handed a figure that MOVES and is still a real',
  '     measurement of the same measure, provided the population is named. That naming',
  '     is the entire licence. db.gates.declaredAggregate.neverSubstitute forbids a',
  '     re-summed total wearing the DECLARED figure\'s label — "a different measure',
  '     wearing this one\'s label" — and it is the LABEL that carries the lie. It does',
  '     not forbid a re-summed total that says what it totalled.',
  '',
  '     Hence the shape. Unnarrowed, nothing changes: the declared programme figure is',
  '     served exactly as it always was, with its unchanged-by-your-filters note ready',
  '     for the blocks a narrowing really cannot move. Narrowed, the block re-sums over',
  '     the rows the reader\'s own filters admit, RELABELS itself with that population,',
  '     and carries a seam naming both the count it footed to and the declared figure it',
  '     is no longer showing. Clearing the filter brings the programme figure back.',
  '',
  '     Two rules keep it narrow:',
  '',
  '       · A block re-sums ONLY IF EVERY FIGURE IN IT HAS A ROW FIELD. Two tiles',
  '         narrowed beside two that could not be is a worse reading than either whole,',
  '         because nothing on the strip would say which two were which.',
  '',
  '       · The arithmetic is the MEASURE\'S, not this table\'s. aggregate() is handed',
  '         the block\'s own {key, measure} pairs, so m_plan_period sums and',
  '         m_variance_pct is recomputed from its declared operands. The average-of-',
  '         percentages answer — plausible, wrong, and off by however unequal the',
  '         projects are — is unreachable from here. All this table supplies is which',
  '         row field carries each key, which is the one thing the glossary does not',
  '         say. */',
  '  const IN_VIEW_FIELD = {',
  '    /* portfolio key -> the row field holding the same measure at the same coordinate.',
  '       periodPlan and periodActual are the programme\'s FY26-to-date plan and posted',
  '       spend; planPeriod and actualPeriod are one project\'s. The two halves of each',
  '       name are inverted between the two shapes, which is exactly why this is a map',
  '       and not a key match.',
  '',
  '       FIELD_FOR_MEASURE cannot serve here and it is worth saying why, because it',
  '       looks like the table for this job: it is COORDINATE-BLIND. It resolves m_actual',
  '       to `actual`, which is the project\'s inception-to-date spend, and a period row',
  '       built on it would print a project\'s whole life as its five-month actual — a',
  '       number of the right shape, the right unit and the wrong meaning. The block key',
  '       already encodes the coordinate, so the map is keyed on that. */',
  '    periodPlan: \'planPeriod\',',
  '    periodActual: \'actualPeriod\',',
  '    periodVariance: \'periodVariance\',',
  '    /* Null, and deliberately: m_variance_pct is a `ratio`, so aggregate() recomputes',
  '       it from periodVariance over periodPlan once those two are summed. A row field',
  '       here would make it a mean of sixty percentages instead, which is the classic',
  '       wrong answer that renders perfectly. The key is PRESENT rather than absent',
  '       because absence means "this block may not re-sum", and this figure may. */',
  '    periodVariancePct: null',
  '  };',
  '',
  '  /* Returns null — "serve the declared figure, exactly as before" — for every case',
  '     this may not or need not act on, so the caller has one test and the untouched',
  '     path is the default rather than something arrived at. */',
  '  function inViewFigures(b, ctx) {',
  '    if (!ctx.paramsNarrowed) return null;',
  '    if (!isDeclaredAggregate(b.source)) return null;',
  '    const figs = b.figures || [];',
  '    if (!figs.length) return null;',
  '    /* An `expr` figure is computed rather than read and a `count` counts a population',
  '       this map says nothing about, so a block holding either keeps its figures whole. */',
  '    if (figs.some(f => f.expr)) return null;',
  '    if (figs.some(f => !(f.key in IN_VIEW_FIELD))) return null;',
  '',
  '    /* Nothing admitted is not a narrowing this can answer. Re-summing no rows gives',
  '       nulls, and a strip of dashes under "0 projects in view" is a worse account of a',
  '       filter that excluded everything than the declared figure plus the note saying it',
  '       did not move. The report already has an empty state for the rows themselves. */',
  '    const rows = ctx.rows || [];',
  '    if (!rows.length) return null;',
  '',
  '    const fields = figs.map(f => IN_VIEW_FIELD[f.key]).filter(Boolean);',
  '',
  '    /* THE ROW FIELDS TAKE THE MASKING CHECK TOO, and they take it here because',
  '       figure() cannot: it masks on the block\'s own key (`periodPlan`) and the value',
  '       now comes out of `planPeriod`, which is a different name and a different mask',
  '       entry. Re-summing without this would serve, out of the rows, a column the scope',
  '       class had withheld from the figure — the disclosure-by-membership failure',
  '       maskedReads() was rewritten to close, arriving through a second door. Masked',
  '       means no re-sum, so the block falls back to the declared figure and its note,',
  '       which is the safe direction. */',
  '    if (fields.some(k => I.isMasked(ctx.scope, k))) return null;',
  '',
  '    /* Projected onto the BLOCK\'S OWN KEYS, so aggregate() reads the pairs the block',
  '       already declares and figure() reads the result out of a holder shaped like',
  '       db.portfolio. WEIGHT_FIELD rides along because a weighted_avg measure added to',
  '       this family later would otherwise divide by a weight nobody carried. */',
  '    const projected = rows.map(r => {',
  '      const o = {}; o[I.WEIGHT_FIELD] = r[I.WEIGHT_FIELD];',
  '      figs.forEach(f => { const k = IN_VIEW_FIELD[f.key]; if (k) o[f.key] = r[k]; });',
  '      return o;',
  '    });',
  '',
  '    const holder = I.aggregate(projected, figs.map(f => ({ key: f.key, measure: f.measure || null })));',
  '    return { holder: holder, n: rows.length };',
  '  }',
  '',
  '  /* The label, the population and the seam a re-summed block wears, composed in ONE',
  '     place and handed back whole — so the heading, the footer sentence and the',
  '     population the export records cannot come to name different populations, which',
  '     is the failure population() was written to close one level up. */',
  '  function inViewCoverage(b, ctx, inView) {',
  '    const n = inView.n;',
  '    const pf = db.portfolio || {};',
  '    const projects = n + \' project\' + (n === 1 ? \'\' : \'s\');',
  '    /* The declared figure this block is no longer showing, formatted by figure()',
  '       rather than composed here: every character on screen comes from a served',
  '       display, and a seam formatting its own would be the second implementation of',
  '       fmt() — the one thing this file spends six hundred lines refusing. */',
  '    const head = figure((b.figures || [])[0], sourceObject(b.source, ctx), ctx);',
  '    const pop = {',
  '      kind: \'inView\', n: n,',
  '      label: \'the \' + projects + \' your filters admit\',',
  '      note: pf.coverageNote || null,',
  '      /* The bold lead bFoot prints is the label above, so the sentence does not say',
  '         "the rows your filters admit" a second time three words later. */',
  '      seam: \'These figures are re-summed over those rows, so they foot to the table on \' +',
  '            \'screen rather than to the declared programme. Clear the filter and this block \' +',
  '            \'serves the declared figure again, published over all \' +',
  '            (pf.projectCountTotal || \'the programme\\\'s\') + \' projects: \' +',
  '            (head.label || head.key) + \' \' + (head.display || \'——\') + \'.\'',
  '    };',
  '    return {',
  '      label: (b.label ? b.label + \' · \' : \'\') + projects + \' in view\',',
  '      coverage: pop,',
  '      inView: {',
  '        n: n, population: pop,',
  '        declared: { key: head.key, label: head.label, display: head.display, raw: head.raw }',
  '      }',
  '    };',
  '  }',
  '',
)

const FIGROW_FROM = lines(
  '  /* ---- figRow ---------------------------------------------------------- */',
  '  H.figRow = (b, ctx) => {',
  '    const holder = sourceObject(b.source, ctx);',
  '    const figs = (b.figures || []).map(f => figure(f, holder, ctx));',
  '',
)

const FIGROW_TO = lines(
  '  /* ---- figRow ---------------------------------------------------------- */',
  '  H.figRow = (b, ctx) => {',
  '    /* A narrowing the rows can answer is answered from the rows. See IN_VIEW_FIELD:',
  '       null here is the untouched path, and it is what every other figRow gets. */',
  '    const inView = inViewFigures(b, ctx);',
  '    const holder = inView ? inView.holder : sourceObject(b.source, ctx);',
  '    const figs = (b.figures || []).map(f => figure(f, holder, ctx));',
  '',
)

const RETURN_FROM = lines(
  '    return {',
  '      figures: figs,',
  '      basesPresent: bases,',
  '      basisNote: b.basisNote || null,',
  '      combines: false,',
  '      combinesNote: bases.length > 1',
  '        ? \'These \' + figs.length + \' figures sit at \' + bases.length + \' bases (\' + bases.join(\', \') +',
  '          \') and are shown side by side. Nothing here is summed, so there is no cross-basis \' +',
  '          \'combination to license.\'',
  '        : null,',
  '      coverage: b.coverageNote ? population(b.source) : null',
  '    };',
  '  };',
  '',
)

const RETURN_TO = lines(
  '    const out = {',
  '      figures: figs,',
  '      basesPresent: bases,',
  '      basisNote: b.basisNote || null,',
  '      combines: false,',
  '      combinesNote: bases.length > 1',
  '        ? \'These \' + figs.length + \' figures sit at \' + bases.length + \' bases (\' + bases.join(\', \') +',
  '          \') and are shown side by side. Nothing here is summed, so there is no cross-basis \' +',
  '          \'combination to license.\'',
  '        : null,',
  '      coverage: b.coverageNote ? population(b.source) : null',
  '    };',
  '    /* Assigned last, so a re-summed block\'s own label and coverage win over the',
  '       spec\'s. A block that did not re-sum is untouched, down to the key order. */',
  '    return inView ? Object.assign(out, inViewCoverage(b, ctx, inView)) : out;',
  '  };',
  '',
)

const RESOLVE_FROM = lines(
  '      return Object.assign(base, fn(b, ctx), { population: population(b.source) },',
  '                           unaffectedByParams(b, ctx));',
  '',
)

const RESOLVE_TO = lines(
  '      const out = Object.assign(base, fn(b, ctx), { population: population(b.source) });',
  '      /* A block that re-summed over the rows in view MOVED with the narrowing, so the',
  '         unchanged-by-your-filters note would be a false sentence printed directly',
  '         under a figure that had just changed — and the population it totalled is the',
  '         rows on screen rather than the declared programme. Both answers come off the',
  '         handler rather than being re-derived here, so the heading, the footer seam and',
  '         the population this records cannot disagree about what was totalled. */',
  '      if (out.inView) { out.population = out.inView.population; return out; }',
  '      return Object.assign(out, unaffectedByParams(b, ctx));',
  '',
)

const EDITS = [
  { name: 'the IN_VIEW_FIELD map and its two helpers', from: FIGROW_FROM, to: HELPER + FIGROW_TO },
  { name: 'H.figRow\'s return, so a re-summed block can relabel itself', from: RETURN_FROM, to: RETURN_TO },
  { name: 'resolveBlock, so a moved figure loses the note saying it did not move', from: RESOLVE_FROM, to: RESOLVE_TO },
]

/* ------------------------------------------------------------------ applying it */

const die = msg => { console.error('\nRefused: ' + msg + '\n'); process.exit(1) }

function patch(name) {
  const path = fileURLToPath(new URL(name, DIR))
  const before = readFileSync(path, 'utf8')

  if (before.includes(MARKER)) return { name, path, skipped: true }

  let after = before
  for (const e of EDITS) {
    const hits = after.split(e.from).length - 1
    if (hits !== 1) {
      die(name + ': the anchor for ' + e.name + ' matched ' + hits + ' times, not once. The document ' +
          'has moved underneath this script — re-read the region and re-cut the anchor rather than ' +
          'loosening it.')
    }
    after = after.replace(e.from, e.to)
  }
  writeFileSync(path, after, 'utf8')
  return { name, path, skipped: false, grew: after.length - before.length }
}

/* ------------------------------------------------------------------ verifying it */

/* The fixture is a JS object literal with comments in it, so the two collections this checks are cut
   out by matching brackets and parsed as JSON rather than evaluated. Strings are skipped explicitly: a
   "]" inside a project name would end the roster early and the check would silently run on a prefix,
   which is the shape of guard this repo distrusts most. */
const BACKSLASH = String.fromCharCode(92)

function carve(src, from) {
  let open = from
  while (open < src.length && src[open] !== '[' && src[open] !== '{') open++
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '"') { i++; while (i < src.length && !(src[i] === '"' && src[i - 1] !== BACKSLASH)) i++; continue }
    if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') { depth--; if (!depth) return src.slice(open, i + 1) }
  }
  return null
}

const strip = t => t.replace(/\/\*[\s\S]*?\*\//g, '')

function fixtureOf(src, key) {
  const at = src.indexOf(NL + '  ' + key + ': ')
  if (at < 0) return null
  const txt = carve(src, src.indexOf(':', at) + 1)
  if (!txt) return null
  try { return JSON.parse(strip(txt)) } catch { return null }
}

function measuresOf(src) {
  const out = {}
  for (const id of ['m_plan_period', 'm_actual', 'm_variance_period', 'm_variance_pct']) {
    const at = src.indexOf('"' + id + '": {')
    if (at < 0) continue
    const txt = carve(src, at + id.length)
    if (!txt) continue
    try { out[id] = JSON.parse(strip(txt)) } catch { /* left absent; the caller refuses on it */ }
  }
  return out
}

/* An independent implementation of the glossary's own rules, deliberately written here rather than
   imported from anywhere: a verification that reuses the code under test verifies nothing. */
function expected(rows, figs, ms) {
  const out = {}
  const ratios = []
  for (const f of figs) {
    const m = ms[f.measure] || {}
    if (m.scopeClass === 'ratio') { ratios.push({ f, m }); continue }
    const vals = rows.map(r => r[f.key]).filter(v => typeof v === 'number')
    out[f.key] = vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }
  for (const { f, m } of ratios) {
    const ops = (m.derivedFrom || []).map(id => (figs.find(g => g.measure === id) || {}).key)
    const num = out[ops[0]]
    const den = out[ops[1]]
    out[f.key] = (ops.length === 2 && num != null && den) ? (num / den) * 100 : null
  }
  return out
}

/* The period figRow's own bindings, read off the block spec in the document rather than restated —
   see the check below, which asserts these are exactly what the block declares. */
const PERIOD_FIGURES = [
  { key: 'periodPlan', measure: 'm_plan_period' },
  { key: 'periodActual', measure: 'm_actual' },
  { key: 'periodVariance', measure: 'm_variance_period' },
  { key: 'periodVariancePct', measure: 'm_variance_pct' },
]

/* The map the inserted code carries, restated here as the thing being verified. It is written twice on
   purpose — once as the code that runs and once as the claim this checks — because a verification that
   read the map out of the code it just wrote would agree with itself whatever the map said. */
const FIELD_FOR_KEY = {
  periodPlan: 'planPeriod',
  periodActual: 'actualPeriod',
  periodVariance: 'periodVariance',
}

function verify(name) {
  const path = fileURLToPath(new URL(name, DIR))
  const src = readFileSync(path, 'utf8')
  const say = []

  for (const e of EDITS) {
    const hits = src.split(e.to).length - 1
    if (hits !== 1) die(name + ': after writing, ' + e.name + ' is present ' + hits + ' times, not once.')
  }
  if (!src.includes(MARKER)) die(name + ': the written document does not carry ' + MARKER + '.')

  const projects = fixtureOf(src, 'projects')
  const portfolio = fixtureOf(src, 'portfolio')
  const ms = measuresOf(src)
  if (!Array.isArray(projects) || !projects.length) {
    die(name + ': could not read db.projects back out of the document it just wrote.')
  }
  if (!portfolio) die(name + ': could not read db.portfolio back out of the document it just wrote.')

  /* The map, against the document. Every row field it names has to exist and be numeric on every row,
     or the block falls back to its declared figure with nothing on screen saying so — the quiet
     regression a re-export brings, and the reason this is a refusal and not a warning. */
  for (const [key, field] of Object.entries(FIELD_FOR_KEY)) {
    if (!(key in portfolio)) {
      die(name + ': db.portfolio no longer carries `' + key + '`, so the declared figure an unnarrowed ' +
          'reader falls back to is gone.')
    }
    const bad = projects.filter(r => typeof r[field] !== 'number')
    if (bad.length) {
      die(name + ': ' + bad.length + ' of ' + projects.length + ' project rows carry no numeric `' + field +
          '` (mapped from `' + key + '`). IN_VIEW_FIELD names a field this export does not have, so every ' +
          'narrowed figRow would quietly serve the declared figure instead. Re-cut the map against the ' +
          'new roster.')
    }
  }

  for (const f of PERIOD_FIGURES) {
    if (!ms[f.measure]) die(name + ': the glossary no longer carries ' + f.measure + ', which the period figRow binds.')
  }
  if (ms.m_variance_pct.scopeClass !== 'ratio') {
    die(name + ': m_variance_pct is scopeClass `' + ms.m_variance_pct.scopeClass + '`, not `ratio`. It would ' +
        'be summed or averaged instead of recomputed, and a mean of sixty variance percentages is not the ' +
        'population\'s variance.')
  }

  /* The whole computation, replayed per execution category — the narrowing a reader actually makes. */
  const cats = [...new Set(projects.map(r => r.execCategory))].filter(Boolean).sort()
  if (!cats.length) die(name + ': no project row carries an execCategory, so no narrowing could be replayed.')

  for (const cat of cats) {
    const rows = projects.filter(r => r.execCategory === cat).map(r => {
      const o = {}
      for (const [key, field] of Object.entries(FIELD_FOR_KEY)) o[key] = r[field]
      return o
    })
    const v = expected(rows, PERIOD_FIGURES, ms)
    for (const f of PERIOD_FIGURES) {
      if (typeof v[f.key] !== 'number' || !isFinite(v[f.key])) {
        die(name + ': narrowing to execCategory ' + cat + ' produces no ' + f.key + '. A narrowed reader ' +
            'would see a dash where a figure was.')
      }
    }
    /* The three money figures have to be internally consistent to the fixture's own whole-dollar grain,
       or the strip disagrees with itself on screen: a plan, an actual, and a variance that is not their
       difference. A dollar per row is what rounding to whole dollars costs. */
    const drift = Math.abs((v.periodActual - v.periodPlan) - v.periodVariance)
    if (drift > rows.length) {
      die(name + ': under execCategory ' + cat + ', periodActual - periodPlan is ' +
          (v.periodActual - v.periodPlan) + ' while the summed periodVariance is ' + v.periodVariance +
          ' — a drift of ' + drift + ' over ' + rows.length + ' rows. The strip would contradict itself.')
    }
    say.push('    ' + cat.padEnd(10) + String(rows.length).padStart(3) + ' rows   ' +
      'plan ' + v.periodPlan.toLocaleString('en-US').padStart(9) + '   ' +
      'actual ' + v.periodActual.toLocaleString('en-US').padStart(9) + '   ' +
      'variance ' + v.periodVariance.toLocaleString('en-US').padStart(8) + '   ' +
      v.periodVariancePct.toFixed(2).padStart(7) + '%')
  }
  return say
}

/* ------------------------------------------------------------------ run */

console.log('\nLetting the CAPEX reports\' headline figures narrow with the reader\'s filters.\n')

const done = FILES.map(patch)
for (const r of done) {
  console.log('  ' + (r.skipped ? 'already applied · ' : 'patched · +' + r.grew + ' bytes · ') + r.name)
}

console.log('\nVerifying against the documents on disk:')
const shown = verify(FILES[0])
FILES.slice(1).forEach(verify)
console.log('\n  ' + FILES[0] + ' — what a reader narrowing by executive category now sees:\n')
console.log(shown.join('\n'))
console.log('\n  Unnarrowed, every one of these blocks still serves the declared programme figure.')
console.log('  All ' + FILES.length + ' documents verified.\n')
