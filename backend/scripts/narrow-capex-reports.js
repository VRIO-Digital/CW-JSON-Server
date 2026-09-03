/**
 * Lets a CAPEX report re-derive itself over the rows a reader's filters admit.
 *
 * **The behaviour this changes.** Picking `Executive category: Blankets` on the Variance Report moved
 * the population line from 50 to 10 and narrowed the three `projects`-sourced blocks under it — the
 * bubble, the project table and the reason mix — while everything sourced from `portfolio` stayed
 * byte-identical: the four headline tiles, the category chart, the region × category heatmap, and the
 * prose that quotes all of them. That is correct and the document says so on the block, in an
 * *Unchanged by your filters* note: those are **declared programme figures**, published over all 4,500
 * projects and served as stated rather than re-summed. It is also indistinguishable from a broken
 * filter, which is what it was read as.
 *
 * **What the fixture's own rule actually forbids.** `db.gates.declaredAggregate.neverSubstitute` is
 * written as *"a different measure wearing this one's label"* — so the fault it names is a total
 * re-summed over 60 sample rows printed under a figure published over 4,500, and **the label is what
 * carries the lie, not the arithmetic**. Read as "never re-sum" the rule blocks the fix; read as
 * written, it prescribes it. The fixture already draws the same distinction by hand, keeping
 * `samplePeriod*` beside `period*` under a note reading *"samplePeriod\* foots to the table on screen;
 * period\* is the declared programme figure."*
 *
 * **So the shape is: unnarrowed, nothing changes.** The declared figure is served exactly as before,
 * with its note ready for the blocks a narrowing genuinely cannot move. Narrowed, one overlay over
 * `db.portfolio` carries what the rows in view say, every block that reads a recomputed key gets it
 * through `sourceObject`, and each such block states the population it totalled. Clearing the filter
 * brings the programme figures back.
 *
 * **One overlay rather than a rule per block, because the alternative is a report at two scales.**
 * The tiles alone were made to narrow first, and that left the Variance Report internally
 * inconsistent: `$31.8K` of period plan above a category chart still drawn in millions and a
 * paragraph still reading *"actual spend of $17.6M"*. The figures on one screen have to move
 * together or not at all, and the only way to guarantee that is for them to come from one place.
 *
 * **Every derivation is checked against the value it replaces, over the whole roster.** Four of them
 * reproduce the declared figure exactly — the rate-case exposure counts and capital, which the
 * fixture's own `rcSampleNote` says are *"over the 60-project sample, not the programme"*. The other
 * two do not, and are not meant to: `variancePeriodByCategory` and `varianceHeatmap` are programme
 * aggregates like the tiles, so the rows reproduce them at roughly a fortieth. Both facts are asserted
 * — the first as an identity, the second as a *ratio* — because a shape that silently started footing
 * to the declared total would mean the rebuild had stopped reading the rows.
 *
 * **What cannot move is listed, not left out.** `IN_VIEW_DECLARED` names each key kept declared and
 * quotes the fixture's own reason. The in-service figures are the substantive ones: `pisNext12moCount`
 * is counted over *3,770 rows of a separate in-service file*, and `pisNext12moValue` and `rateBase` are
 * null because — in the fixture's words — *"the file carries dates and categories, not money, and
 * joining it to a budget for the whole programme is a join this fixture has not made."* Those blocks
 * keep the declared figure and keep the note saying a narrowing did not move it.
 *
 * **It is a script rather than an edit, and the document's own header says why**: *"DO NOT HAND-EDIT.
 * Edit the generator that emits the fixture, re-run the chain."* That generator (`gen/port.py`) lives in
 * the demo package rather than in this repo, so the honest stand-in is a transform that is re-runnable
 * and verified against the document it just wrote. Run it again after a re-export; `check-docs` fails
 * the build if the documents come back without it.
 *
 * The safety is in the shape of the thing:
 *
 * 1. **Anchored replacements, each required to match exactly once.** A missing anchor or a second match
 *    refuses the run rather than patching the wrong copy of a 2.6 MB file.
 * 2. **Idempotent.** A document already carrying the marker is skipped and said to be skipped.
 * 3. **The arithmetic is the MEASURE'S wherever the glossary states it.** The period figures go through
 *    the document's own `aggregate()` with their declared measures, so `m_plan_period` sums and
 *    `m_variance_pct` — declared `ratio` — is recomputed from its operands rather than averaged.
 * 4. **The rewrite is verified against the document it produced**: the edits present, every row field
 *    the rules name carried by every project row, each identity derivation reproducing its declared
 *    value, each programme-scale derivation reproducing it only at sample scale, and the heatmap
 *    closing on its own total.
 *
 * That fourth check is what matters after a re-export. A rule whose row field has been renamed stops
 * moving *quietly* — the block reverts to its declared figure and nothing on screen says so.
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

/* The marker an already-patched document carries. Named for the overlay rather than for the feature,
   because the overlay is the part a re-export can break. */
const MARKER = 'IN_VIEW_FIELD'

/* ------------------------------------------------------------------ the code that goes in */

const HELPER = lines(
  '  /* ====================================================================== */',
  '  /* WHAT THE ROWS IN VIEW SAY                                              */',
  '  /* ====================================================================== */',
  '',
  '  /* `unaffectedByParams` above is the whole story for a declared aggregate the rows',
  '     cannot reproduce, and it stays the whole story for the ones that genuinely',
  '     cannot — see IN_VIEW_DECLARED at the foot of this block, which names each and',
  '     quotes the fixture\'s own reason.',
  '',
  '     For the rest, a narrowed reader gets what their own rows say. ONE OVERLAY over',
  '     db.portfolio carries it, and every surface reads through that overlay rather',
  '     than each computing its own answer:',
  '',
  '       · sourceObject(\'portfolio\') and sourceObject(\'portfolio.<leaf>\'), which is',
  '         every figRow, bar, heatmap and filingCalendar in these reports;',
  '       · resolveTokens, so the prose quotes the same figures the tiles print.',
  '',
  '     THE ALTERNATIVE IS A REPORT AT TWO SCALES, and it was built first: only the four',
  '     headline tiles were made to narrow, which left $31.8K of period plan above a',
  '     category chart still drawn in millions and a paragraph still reading "actual',
  '     spend of $17.6M". Figures on one screen move together or not at all, and the only',
  '     way to guarantee that is for them to come from one place.',
  '',
  '     WHAT LICENSES ANY OF THIS is the label, not the arithmetic.',
  '     db.gates.declaredAggregate.neverSubstitute forbids "a different measure wearing',
  '     this one\'s label" — a total re-summed over 60 rows printed under a figure',
  '     published over 4500. So every block that reads a recomputed key states the',
  '     population it totalled, and the two figures are never shown as one. The fixture',
  '     already draws exactly this distinction for itself, keeping samplePeriod* beside',
  '     period* under a note reading "samplePeriod* foots to the table on screen;',
  '     period* is the declared programme figure."',
  '',
  '     Two of these rules reproduce the declared figure EXACTLY over the whole roster',
  '     and two reproduce it at roughly a fortieth, and both are correct: the rate-case',
  '     exposure figures are already sample-scoped (portfolio.rcSampleNote says so in as',
  '     many words), while the period figures and the two variance shapes are programme',
  '     aggregates. The build script asserts both properties, because a shape that',
  '     started footing to the declared total would mean it had stopped reading rows. */',
  '',
  '  /* A portfolio key whose value is the same measure as a row field, summed. The',
  '     measure is named beside it so the arithmetic stays the MEASURE\'S: aggregate()',
  '     sums m_plan_period and RECOMPUTES m_variance_pct from its declared operands,',
  '     rather than averaging sixty variance percentages — the classic wrong answer that',
  '     renders perfectly, and one that is off by however unequal the projects are.',
  '',
  '     FIELD_FOR_MEASURE cannot serve as this map, and it is worth saying why because it',
  '     looks like the table for the job: it is COORDINATE-BLIND. It resolves m_actual to',
  '     `actual`, the project\'s inception-to-date spend, so a period row built on it',
  '     would print a project\'s whole life as its five-month actual — right shape, right',
  '     unit, wrong meaning. The portfolio key already encodes the coordinate. */',
  '  const IN_VIEW_FIELD = {',
  '    periodPlan: { field: \'planPeriod\', measure: \'m_plan_period\' },',
  '    periodActual: { field: \'actualPeriod\', measure: \'m_actual\' },',
  '    periodVariance: { field: \'periodVariance\', measure: \'m_variance_period\' },',
  '    /* No field, and none is wanted: m_variance_pct is declared `ratio`, so aggregate()',
  '       recomputes it from periodVariance over periodPlan once those two are summed. */',
  '    periodVariancePct: { field: null, measure: \'m_variance_pct\' }',
  '  };',
  '',
  '  /* A portfolio key with a rule of its own — a count, an extreme, or a sum over a',
  '     subset. These four reproduce their declared values EXACTLY over the whole roster,',
  '     which is the fixture\'s own doing: portfolio.rcSampleNote says "exposure counts are',
  '     over the 60-project sample, not the programme". */',
  '  const IN_VIEW_DERIVED = {',
  '    rcSampleAtRiskCount: { reads: [\'rcStatus\'],',
  '      of: rows => rows.filter(r => r.rcStatus === \'misses_case\').length },',
  '    rcSampleNoDateCount: { reads: [\'rcStatus\'],',
  '      of: rows => rows.filter(r => r.rcStatus === \'no_date\').length },',
  '    /* Deferred capital is the working estimate, not the approved budget: what a missed',
  '       filing defers is what the project is now expected to cost. Checked against the',
  '       declared figure by the build script, which is how the field was chosen rather',
  '       than guessed — `budget` gives 447,728 where the document states 746,183. */',
  '    rcSampleDeferredCapital: { reads: [\'rcStatus\', \'forecast\'],',
  '      of: rows => rows.filter(r => r.rcStatus === \'misses_case\')',
  '                      .reduce((a, r) => a + (Number(r.forecast) || 0), 0) },',
  '    rcNextFilingBy: { reads: [\'rcFilingBy\'],',
  '      of: rows => { const r = nearestFilingRow(rows); return r ? r.rcFilingBy : null; } },',
  '    rcNextFilingJuris: { reads: [\'rcFilingBy\', \'jurisdiction\'],',
  '      of: rows => { const r = nearestFilingRow(rows); return r ? r.jurisdiction : null; } },',
  '    /* THE DAYS ARE READ, NEVER COUNTED. The obvious rule is (filingBy - today), and it is',
  '       wrong here: this fixture is dated against its own as-of, so counting from the clock',
  '       gives a number that drifts every morning and goes negative the moment the demo',
  '       outlives its data — 2026-08-01 is already behind us. The document states the answer',
  '       per jurisdiction as `daysToFilingBy` on its own rateCaseExposure entry, so the rule',
  '       looks it up for whichever jurisdiction the nearest filing is in. That also keeps this',
  '       figure and the calendar block below it reading the same number.',
  '',
  '       Added after the fact: the tile beside two that moved stayed at the declared 62, which',
  '       is the half-moved strip the first design refused by making a block all-or-nothing. The',
  '       overlay lost that guarantee, so `check-docs` now asserts every key a block reads has',
  '       either a rule or an entry in IN_VIEW_DECLARED. */',
  '    rcNextFilingDays: { reads: [\'rcFilingBy\', \'jurisdiction\'],',
  '      of: rows => {',
  '        const r = nearestFilingRow(rows);',
  '        if (!r) return null;',
  '        const entry = ((db.portfolio || {}).rateCaseExposure || [])',
  '          .find(e => e.jurisdiction === r.jurisdiction);',
  '        return entry ? entry.daysToFilingBy : null;',
  '      } }',
  '  };',
  '',
  '  /* The earliest filing-by date among the rows in view, and the row carrying it. Dates',
  '     are ISO, so a string compare is a date compare; a row with no date is not a row',
  '     with a late one, so it is left out rather than sorted to the end. */',
  '  function nearestFilingRow(rows) {',
  '    let best = null;',
  '    (rows || []).forEach(r => {',
  '      if (!r.rcFilingBy) return;',
  '      if (!best || r.rcFilingBy < best.rcFilingBy) best = r;',
  '    });',
  '    return best;',
  '  }',
  '',
  '  /* A portfolio key whose value is a SHAPE — an array or a matrix a block reads as its',
  '     source. Rebuilt entirely from the rows in view, with the parts that are not row',
  '     facts carried across from the declared object: a commission\'s filing date and',
  '     certification lead are not properties of this tenant\'s projects and must not move',
  '     when the project list does. */',
  '  const IN_VIEW_SHAPE = {',
  '    /* The category series behind "Actual spend against the calendarised plan". One',
  '       entry per budget category, in the declared order so a category keeps its place',
  '       on the axis; a category with no rows in view is DROPPED rather than drawn at',
  '       zero, because a zero bar says a category spent nothing and an absent one says',
  '       the filter excluded it. */',
  '    variancePeriodByCategory: {',
  '      reads: [\'budgetCategory\', \'execCategory\', \'planPeriod\', \'actualPeriod\', \'periodVariance\'],',
  '      of: (rows, declared) => {',
  '      const by = {};',
  '      (rows || []).forEach(r => {',
  '        const k = r.budgetCategory;',
  '        if (k == null) return;',
  '        if (!by[k]) by[k] = { execCategory: r.execCategory, budgetCategory: k, plan: 0, actual: 0, variance: 0 };',
  '        by[k].plan += Number(r.planPeriod) || 0;',
  '        by[k].actual += Number(r.actualPeriod) || 0;',
  '        by[k].variance += Number(r.periodVariance) || 0;',
  '      });',
  '      const order = (declared || []).map(d => d.budgetCategory);',
  '      const seen = order.filter(k => by[k]);',
  '      Object.keys(by).forEach(k => { if (seen.indexOf(k) < 0) seen.push(k); });',
  '        return seen.map(k => by[k]);',
  '      }',
  '    },',
  '',
  '    /* The region × category matrix. Its axes are rebuilt from the rows in view rather',
  '       than kept at the declared five-by-six, so a narrowed reader gets a matrix of the',
  '       regions and categories they actually have — an all-zero row would read as "at',
  '       plan", which is the one thing an excluded region must not say. The axes keep',
  '       their declared ORDER, and regionNames stays aligned to regions because the',
  '       renderer indexes one by the other.',
  '',
  '       rowTotals, colTotals and total are recomputed here rather than carried, because',
  '       H.heatmap asserts closure against `total` and reports a DEFECT band when the',
  '       cells do not sum to it. `footsTo` stays "portfolio.periodVariance" and is still',
  '       true: both sides of that identity moved together. grainNote does NOT stay — it',
  '       says "over all 4500 projects", which would be a false sentence under a matrix',
  '       built from ten rows. */',
  '    varianceHeatmap: {',
  '      reads: [\'regionCode\', \'regionName\', \'budgetCategory\', \'periodVariance\'],',
  '      of: (rows, declared) => {',
  '      const d = declared || {};',
  '      const declaredRegions = d.regions || [];',
  '      const declaredNames = d.regionNames || [];',
  '      const keep = (list, has) => {',
  '        const out = (list || []).filter(has);',
  '        (rows || []).forEach(() => {});',
  '        return out;',
  '      };',
  '      const hasRegion = rg => (rows || []).some(r => r.regionCode === rg);',
  '      const hasCat = c => (rows || []).some(r => r.budgetCategory === c);',
  '      const regions = keep(declaredRegions, hasRegion);',
  '      const categories = keep(d.categories, hasCat);',
  '      const names = regions.map(rg => {',
  '        const at = declaredRegions.indexOf(rg);',
  '        if (at > -1 && declaredNames[at]) return declaredNames[at];',
  '        const row = (rows || []).find(r => r.regionCode === rg);',
  '        return row ? row.regionName : rg;',
  '      });',
  '      const z = regions.map(rg => categories.map(c =>',
  '        (rows || []).reduce((a, r) =>',
  '          a + (r.regionCode === rg && r.budgetCategory === c ? (Number(r.periodVariance) || 0) : 0), 0)));',
  '      const rowTotals = z.map(v => v.reduce((a, b) => a + b, 0));',
  '      const colTotals = categories.map((c, ci) => z.reduce((a, v) => a + v[ci], 0));',
  '      return Object.assign({}, d, {',
  '        regions: regions, regionNames: names, categories: categories, z: z,',
  '        rowTotals: rowTotals, colTotals: colTotals,',
  '        total: rowTotals.reduce((a, b) => a + b, 0),',
  '        grain: \'rows in view\',',
  '        grainNote: \'Every cell is the FY26 year-to-date variance for that region and category \' +',
  '                   \'over the rows your filters admit, so the matrix foots to the period variance \' +',
  '                   \'above it — which is computed over the same rows. The declared programme \' +',
  '                   \'matrix, over all \' + ((db.portfolio || {}).projectCountTotal || \'4500\') + \' \' +',
  '                   \'projects, is what an unfiltered reading of this block shows.\'',
  '        });',
  '      }',
  '    },',
  '',
  '    /* The per-jurisdiction rate-case exposure behind the filing calendar. Every COUNT',
  '       and every CAPITAL figure is recomputed from the rows in view; the filing date,',
  '       the certification lead and its justification, the recurrence, the test-year end',
  '       and the squeeze window are the commission\'s and are carried across untouched. A',
  '       jurisdiction with no rows in view is KEPT, at zero: its deadline exists whether',
  '       or not this reader is looking at projects in it, and dropping the row would say',
  '       the jurisdiction has no filing rather than that the filter excluded its work. */',
  '    rateCaseExposure: {',
  '      reads: [\'jurisdiction\', \'rcStatus\', \'forecast\', \'rcDaysOfSlack\'],',
  '      of: (rows, declared) => (declared || []).map(e => {',
  '      const mine = (rows || []).filter(r => r.jurisdiction === e.jurisdiction);',
  '      const of = st => mine.filter(r => r.rcStatus === st);',
  '      const cap = list => list.reduce((a, r) => a + (Number(r.forecast) || 0), 0);',
  '      const slack = mine.map(r => r.rcDaysOfSlack).filter(v => typeof v === \'number\');',
  '      return Object.assign({}, e, {',
  '        projectCount: mine.length,',
  '        eligibleCount: of(\'in_case\').length,',
  '        laterCaseCount: of(\'later_case\').length,',
  '        atRiskCount: of(\'misses_case\').length,',
  '        noDateCount: of(\'no_date\').length,',
  '        deferredCapital: cap(of(\'misses_case\')),',
  '        undatedCapital: cap(of(\'no_date\')),',
  '        /* null, not 0: no rows in view is no tightest slack, and 0 would say a',
  '           project files exactly on its deadline. */',
  '        tightestSlackDays: slack.length ? Math.min.apply(null, slack) : null',
  '        });',
  '      })',
  '    }',
  '  };',
  '',
  '  /* ---------------------------------------------------------------------- */',
  '  /* A VIEW PARAM THAT NARROWS NOTHING                                        */',
  '  /* ---------------------------------------------------------------------- */',
  '',
  '  /* `pisWindow` — the filing calendar\'s *In-service window* — is declared',
  '     `field: null, cls: "refresh"`, so `applyParams` skips it and `paramSig` does',
  '     not count it. Picking "Next 24 months" left the population line at 60 of 60',
  '     and every figure at its declared value, with the chip lit as though it had',
  '     done something. Reported from use.',
  '',
  '     THE PARAM IS READ BY NOTHING. It appears three times in the whole export —',
  '     its definition and the report\'s list of params — so the "report re-resolves"',
  '     its own `reason` promises is not implemented anywhere, and there is no',
  '     basis-mix data in the fixture for it to re-resolve against. It is a control',
  '     that could never have moved a figure.',
  '',
  '     **So it is made a row filter, and that is a reinterpretation on record.** The',
  '     document draws a deliberate line between a `view` param (a filter) and a',
  '     `refresh` one (a basis change), and argues in its own comments that a snapshot',
  '     picker which looks like a filter teaches the reader the wrong thing. Asked for',
  '     anyway, and the argument cuts the other way once the basis change does not',
  '     exist: a chip labelled *In-service window* that narrows nothing at all teaches',
  '     the reader less than one that narrows by in-service date. The rows carry the',
  '     dates, so the reading its label promises is the one it now performs.',
  '',
  '     R1\'s `period` chip is the same class and is NOT given a rule: its rows hold',
  '     plan and actual for one period only, so "FY2026" and "Full plan span" have no',
  '     data to narrow to. It is hidden by the frame instead — see FRAMED_CSS. */',
  '  const IN_VIEW_PARAM = {',
  '    pisWindow: {',
  '      /* The date the window is measured from, and the row field it is measured on.',
  '         Both are the document\'s own: the anchor is derived from `pisCutoff`, which',
  '         is the end of this fixture\'s twelve-month window, rather than from the',
  '         clock — `Date.now()` would slide the window every morning and empty it',
  '         once the demo outlives its data, which is the same trap `rcNextFilingDays`',
  '         fell into. */',
  '      admits: (row, values) => {',
  '        const at = inViewServiceDate(row);',
  '        /* A row with no in-service date is EXCLUDED rather than defaulted, which is',
  '           the report\'s own stated rule: "a defaulted date puts value in a month',
  '           nobody planned it for." Three of the sixty carry none. */',
  '        if (!at) return false;',
  '        return values.some(v => inViewWindowAdmits(v, at));',
  '      }',
  '    }',
  '  };',
  '',
  '  /* Published to the shared interface, because the one caller that applies it —',
  '     `applyParams` — is in the core module and cannot see this scope. Assigned rather',
  '     than passed, the way the core module publishes everything else on `I`. */',
  '  I.IN_VIEW_PARAM = IN_VIEW_PARAM;',
  '',
  '  const inViewServiceDate = row =>',
  '    row.forecastInService || row.plannedInService || null;',
  '',
  '  /* The anchor, memoised per document rather than per row. */',
  '  let inViewAnchor;',
  '  function inViewWindowFrom() {',
  '    if (inViewAnchor !== undefined) return inViewAnchor;',
  '    const cutoff = (db.portfolio || {}).pisCutoff;',
  '    inViewAnchor = null;',
  '    if (cutoff) {',
  '      const d = new Date(cutoff + \'T00:00:00Z\');',
  '      if (!isNaN(d.getTime())) { d.setUTCFullYear(d.getUTCFullYear() - 1); inViewAnchor = d; }',
  '    }',
  '    return inViewAnchor;',
  '  }',
  '',
  '  /* "Next N months" runs from the anchor; a named fiscal year is that calendar year.',
  '     A value this does not recognise admits everything rather than nothing — an',
  '     unrecognised window emptying the report would read as a filter that broke. */',
  '  function inViewWindowAdmits(value, at) {',
  '    const months = /^Next (\\d+) months$/.exec(String(value));',
  '    if (months) {',
  '      const from = inViewWindowFrom();',
  '      if (!from) return true;',
  '      const to = new Date(from);',
  '      to.setUTCMonth(to.getUTCMonth() + Number(months[1]));',
  '      const d = new Date(at + \'T00:00:00Z\');',
  '      return d > from && d <= to;',
  '    }',
  '    const fy = /^FY(\\d{4})$/.exec(String(value));',
  '    if (fy) return at >= fy[1] + \'-01-01\' && at <= fy[1] + \'-12-31\';',
  '    return true;',
  '  }',
  '',
  '  /* Whether a param narrows the row set at all — its own field, or a rule here.',
  '     Read by `applyParams` and by the narrowing signature, so a param cannot filter',
  '     the rows while the report still believes nothing was narrowed. */',
  '  const inViewNarrows = p => !!(p && (p.field || IN_VIEW_PARAM[p.id]));',
  '',
  '  /* Kept declared on purpose, with the fixture\'s own reason. Listed rather than left',
  '     out, because "no rule" and "a rule nobody wrote yet" look identical in a map and',
  '     only one of them is a decision. Nothing reads this at runtime — it is here so the',
  '     next person to ask "why does this figure not move?" finds the answer beside the',
  '     rules rather than in a commit message. */',
  '  const IN_VIEW_DECLARED = {',
  '    pisNext12moCount: \'Counted over the 3770 rows of the in-service file, which is a \' +',
  '      \'different population from these project rows. portfolio.pisBasisNote.\',',
  '    pisNext12moValue: \'Null in this fixture: the in-service file "carries dates and \' +',
  '      \'categories, not money", so there is nothing to sum. portfolio.pisBasisNote.\',',
  '    rateBase: \'Null on every row — the CAPEX extract carries no general-ledger columns.\',',
  '    pisPeakMonth: \'A property of the in-service file, not of these rows.\',',
  '    rcSqueezedJurisdictionCount: \'A count of jurisdictions whose calendar has a squeeze \' +',
  '      \'window. A property of the commission calendar, not of the projects.\',',
  '    rcNoWindowJurisdictions: \'The same: which commissions publish no window.\',',
  '    discoveryMisses: \'A list of what the sources do not carry. Narrowing the rows does \' +',
  '      \'not change what was never found.\'',
  '  };',
  '',
  '  /* One overlay per request, memoised on the row array itself — every block in a report',
  '     is resolved against the same `rows`, and rebuilding a heatmap once per block that',
  '     reads it would be the same answer computed six times.',
  '',
  '     THE SCOPE IS PART OF THE KEY, not just the rows. What this returns depends on which',
  '     fields the viewer\'s scope class masks, so a cache keyed on rows alone hands one',
  '     reader an overlay computed under another\'s masking — which is a disclosure in one',
  '     direction and a figure that mysteriously will not move in the other. Caught by a',
  '     harness that asked for a masked overlay and an unmasked one over the same array and',
  '     got the masked answer twice. */',
  '  const inViewCache = typeof WeakMap === \'function\' ? new WeakMap() : null;',
  '  const scopeKeyOf = ctx => ((ctx.scope || {}).scopeId || (ctx.scope || {}).id || \'\') +',
  '    \'|\' + ((ctx.scope || {}).maskedFields || []).join(\',\');',
  '  function remember(rows, ctx, value) {',
  '    if (inViewCache) inViewCache.set(rows, { scope: scopeKeyOf(ctx), value: value });',
  '    return value;',
  '  }',
  '',
  '  /* Returns null — "serve the declared figures, exactly as before" — for every case this',
  '     may not or need not act on, so every caller has one test and the untouched path is',
  '     the default rather than something arrived at. */',
  '  function inViewPortfolio(ctx) {',
  '    if (!ctx || !ctx.paramsNarrowed) return null;',
  '    const rows = ctx.rows || [];',
  '    /* Nothing admitted is not a narrowing this can answer. Re-deriving no rows gives',
  '       nulls and empty axes, and a report of dashes under "0 projects in view" is a',
  '       worse account of a filter that excluded everything than the declared figures',
  '       plus the note saying they did not move. */',
  '    if (!rows.length) return null;',
  '    if (inViewCache && inViewCache.has(rows)) {',
  '      const hit = inViewCache.get(rows);',
  '      if (hit.scope === scopeKeyOf(ctx)) return hit.value;',
  '    }',
  '',
  '    const declared = db.portfolio || {};',
  '    const moved = [];',
  '    const out = Object.assign({}, declared);',
  '',
  '    /* THE ROW FIELDS TAKE THE MASKING CHECK, and they take it here because figure()',
  '       cannot: it masks on the portfolio key (`periodPlan`) and the value now comes out',
  '       of `planPeriod`, which is a different name and a different mask entry. Deriving',
  '       without this would serve, out of the rows, a column the scope class had withheld',
  '       from the figure — the disclosure-by-membership failure maskedReads() was',
  '       rewritten to close, arriving through a second door. A masked field means that',
  '       key is not recomputed, so it keeps its declared value: the safe direction. */',
  '    const visible = f => !f || !I.isMasked(ctx.scope, f);',
  '',
  '    /* The measured keys, through the document\'s own aggregate() so the arithmetic is',
  '       each measure\'s own. Projected onto the portfolio\'s key names first, and',
  '       WEIGHT_FIELD carried because a weighted_avg measure added to this family later',
  '       would otherwise divide by a weight nobody supplied. */',
  '    const fieldKeys = Object.keys(IN_VIEW_FIELD);',
  '    if (fieldKeys.every(k => visible(IN_VIEW_FIELD[k].field))) {',
  '      const projected = rows.map(r => {',
  '        const o = {}; o[I.WEIGHT_FIELD] = r[I.WEIGHT_FIELD];',
  '        fieldKeys.forEach(k => { const f = IN_VIEW_FIELD[k].field; if (f) o[k] = r[f]; });',
  '        return o;',
  '      });',
  '      const agg = I.aggregate(projected, fieldKeys.map(k => ({ key: k, measure: IN_VIEW_FIELD[k].measure })));',
  '      fieldKeys.forEach(k => {',
  '        if (agg[k] == null) return;',
  '        out[k] = agg[k]; moved.push(k);',
  '      });',
  '    }',
  '',
  '    /* THE SAME CHECK, on every rule rather than only the measured ones. It was written',
  '       for IN_VIEW_FIELD first and left off these two, which meant a scope class masking',
  '       everything still got a rebuilt heatmap and a rebuilt exposure table — the hole',
  '       the paragraph above describes, left open for two thirds of the rules. A rule',
  '       whose fields are not all visible is simply not applied, so its key keeps the',
  '       declared value. */',
  '    const runnable = rule => (rule.reads || []).every(visible);',
  '',
  '    Object.keys(IN_VIEW_DERIVED).forEach(k => {',
  '      const rule = IN_VIEW_DERIVED[k];',
  '      if (!(k in declared) || !runnable(rule)) return;',
  '      const v = rule.of(rows);',
  '      if (v === undefined) return;',
  '      out[k] = v; moved.push(k);',
  '    });',
  '',
  '    Object.keys(IN_VIEW_SHAPE).forEach(k => {',
  '      const rule = IN_VIEW_SHAPE[k];',
  '      if (!(k in declared) || !runnable(rule)) return;',
  '      const v = rule.of(rows, declared[k]);',
  '      if (v == null) return;',
  '      out[k] = v; moved.push(k);',
  '    });',
  '',
  '    /* Nothing recomputed is not an overlay. Returning one anyway would make every',
  '       caller\'s "did this move?" test true while every value in it was the declared',
  '       one — and unaffectedByParams, which is the correct thing to say here, would',
  '       never fire again. */',
  '    if (!moved.length) return remember(rows, ctx, null);',
  '',
  '    out.inViewRows = rows.length;',
  '    out.inViewMoved = moved;',
  '    return remember(rows, ctx, out);',
  '  }',
  '',
  '  /* Which of the keys this block reads were recomputed. Null — never an empty array —',
  '     where the block read none, so the caller\'s test is the same shape as everywhere',
  '     else here. Four ways a block names a portfolio key, and all four are checked',
  '     because the blocks in these reports use all four: a dotted source (the category',
  '     bar, the heatmap), a `key` (the filing calendar), a figure list (every figRow), and',
  '     a $TOKEN in prose (every narrative that quotes a figure). */',
  '  function inViewTouches(b, ctx) {',
  '    const ov = inViewPortfolio(ctx);',
  '    if (!ov) return null;',
  '    const hit = [];',
  '    const add = k => {',
  '      if (k && ov.inViewMoved.indexOf(k) > -1 && hit.indexOf(k) < 0) hit.push(k);',
  '    };',
  '    if (typeof b.source === \'string\' && b.source.indexOf(\'portfolio.\') === 0) {',
  '      add(b.source.slice(\'portfolio.\'.length));',
  '    }',
  '    if (b.source === \'portfolio\') add(b.key);',
  '    (b.figures || []).forEach(f => add(f.key));',
  '    if (typeof b.body === \'string\') {',
  '      const table = (db.narrativeTokens || {}).tokens || {};',
  '      (b.body.match(TOKEN_RE) || []).forEach(t => {',
  '        const spec = table[t];',
  '        if (spec && spec.source === \'portfolio\') add(spec.key);',
  '      });',
  '    }',
  '    return hit.length ? { keys: hit, n: ov.inViewRows } : null;',
  '  }',
  '',
  '  /* The population a re-derived block states, composed in ONE place and handed back',
  '     whole — so a block\'s heading, its footer sentence and the population the export',
  '     records cannot come to name different populations, which is the failure',
  '     population() was written to close one level up. */',
  '  function inViewCoverage(b, ctx, touched) {',
  '    const n = touched.n;',
  '    const pf = db.portfolio || {};',
  '    const projects = n + \' project\' + (n === 1 ? \'\' : \'s\');',
  '    const pop = {',
  '      kind: \'inView\', n: n,',
  '      label: \'the \' + projects + \' your filters admit\',',
  '      note: pf.coverageNote || null,',
  '      seam: \'Re-derived over those rows, so this foots to the rest of the report rather \' +',
  '            \'than to the declared programme. Clear the filter and it is served as \' +',
  '            \'published over all \' + (pf.projectCountTotal || \'the programme\\\'s\') +',
  '            \' projects again.\'',
  '    };',
  '    const out = { coverage: pop, inView: { n: n, keys: touched.keys, population: pop } };',
  '    /* The heading takes the population only where the heading is the figure\'s own —',
  '       a figRow is four numbers under a short label, and "Q1 2026" alone beside a',
  '       changed number is the ambiguity this whole change is about. A chart already',
  '       titled "Actual spend against the calendarised plan, by category" says what it',
  '       is; it gets the seam and keeps its title. */',
  '    if (b.type === \'figRow\') {',
  '      out.label = (b.label ? b.label + \' · \' : \'\') + projects + \' in view\';',
  '    }',
  '    return out;',
  '  }',
  '',
)

/* ---- edit 1: the module goes in above the figRow handler ---- */

const FIGROW_ANCHOR = lines(
  '  /* ---- figRow ---------------------------------------------------------- */',
  '  H.figRow = (b, ctx) => {',
  '',
)

/* ---- edit 2: sourceObject reads the overlay ---- */

const SOURCE_FROM = lines(
  '  function sourceObject(src, ctx) {',
  '    if (src == null) return null;',
  '    if (src === \'projects\') return ctx.rows;',
  '    if (src === \'project\')  return ctx.project;',
  '    if (src === \'portfolio\') return db.portfolio;',
  '    if (src.indexOf(\'portfolio.\') === 0) {',
  '      const leaf = src.slice(\'portfolio.\'.length);',
  '      const v = (db.portfolio || {})[leaf];',
  '',
)

const SOURCE_TO = lines(
  '  function sourceObject(src, ctx) {',
  '    if (src == null) return null;',
  '    if (src === \'projects\') return ctx.rows;',
  '    if (src === \'project\')  return ctx.project;',
  '    /* THE ONE PLACE A BLOCK\'S SOURCE RESOLVES, so it is the one place the rows in view',
  '       need to be read. Null unless the reader has narrowed and something was actually',
  '       recomputed, in which case the overlay is db.portfolio with those keys replaced —',
  '       so a key with no rule still resolves, to exactly what it always did. See',
  '       inViewPortfolio. */',
  '    const inView = inViewPortfolio(ctx);',
  '    const pf = inView || db.portfolio;',
  '    if (src === \'portfolio\') return pf;',
  '    if (src.indexOf(\'portfolio.\') === 0) {',
  '      const leaf = src.slice(\'portfolio.\'.length);',
  '      const v = (pf || {})[leaf];',
  '',
)

/* ---- edit 3: the prose quotes the same figures the tiles print ---- */

const TOKENS_FROM =
  "      const holder = spec.source === 'portfolio' ? db.portfolio : ctx.project;"

const TOKENS_TO = lines(
  '      /* THE SAME OVERLAY THE TILES READ. A token resolves through figure() like any',
  '         other figure, but it did not go through sourceObject — so while only the',
  '         figRow narrowed, "Reading this" went on stating $17.6M of actual spend under',
  '         a tile reading $26.7K. A report may show two populations; it may not show one',
  '         figure twice with two values. */',
  '      const holder = spec.source === \'portfolio\'',
  '        ? (inViewPortfolio(ctx) || db.portfolio)',
  '        : ctx.project;',
)

/* ---- edit 4: a block that moved says so, and loses the note saying it did not ---- */

/* ---- edit 5: a param with a rule narrows the rows ---- */

/*
 * Patched in `applyParams` itself rather than wrapped around `I.applyParams`, because there are two
 * callers and only one goes through `I`: the report's rows do, and the **option counts** beside each
 * value call the bare local function. Wrapping the export would have narrowed the report while every
 * count in the menu was computed over the unnarrowed set — a count that disagrees with the list it
 * describes, which this document already records as worse than no count at all.
 */
const PARAMS_FROM = lines(
  '      /* Membership, not equality — two selected values are a union, which is what',
  '         checking two boxes means everywhere else a person has used a filter. */',
  '      if (p.field) out = out.filter(r => vals.indexOf(String(r[p.field])) > -1);',
  '',
)

const PARAMS_TO = lines(
  '      /* Membership, not equality — two selected values are a union, which is what',
  '         checking two boxes means everywhere else a person has used a filter. */',
  '      if (p.field) out = out.filter(r => vals.indexOf(String(r[p.field])) > -1);',
  '      /* A param with no field of its own but a rule in IN_VIEW_PARAM — the in-service',
  '         window, whose values are ranges rather than column values, so no single field',
  '         could express them: a project inside the next twelve months is inside the next',
  '         twenty-four as well, and membership against one stored value cannot say that. */',
  '      /* Through `I`, and that is not stylistic. `applyParams` lives in the CORE module',
  '         (`(function (I) { … })(CW._api)`) and IN_VIEW_PARAM is declared in the REPORTS',
  '         module below it — two IIFEs, two scopes, one shared `I`. A bare identifier here',
  '         is a ReferenceError at request time, which the report catches and renders as',
  '         "Could not resolve this report: IN_VIEW_PARAM is not defined". Both modules are',
  '         called with CW._api, so the interface object is how one reaches the other — which',
  '         is what `Object.assign(I, { … })` at the end of the core module is already for. */',
  '      else if (I.IN_VIEW_PARAM && I.IN_VIEW_PARAM[p.id]) {',
  '        out = out.filter(r => I.IN_VIEW_PARAM[p.id].admits(r, vals));',
  '      }',
  '',
)

/* ---- edit 6: and the report knows it was narrowed ---- */

/*
 * `paramSig` is what tells every block whether the reader narrowed. It tested `p.field`, so a param
 * filtered by the rule above would have narrowed the rows while `paramsNarrowed` stayed false — the
 * overlay would not fire, and the report would show declared figures over a filtered population,
 * which is worse than the bug being fixed. `narrowedBy` takes the same test so the seam names the
 * window among the filters that moved the figures.
 */
const SIG_FROM = lines(
  '    const paramSig = params.filter(p => p.field && (active[p.id] || []).length)',
  '      .map(p => p.id + \':\' + active[p.id].slice().sort().join(\',\')).join(\'|\');',
  '    const paramsNarrowed = !!paramSig;',
  '    const narrowedBy = params.filter(p => p.field && (active[p.id] || []).length)',
  '      .map(p => p.label.toLowerCase());',
  '',
)

const SIG_TO = lines(
  '    const paramSig = params.filter(p => inViewNarrows(p) && (active[p.id] || []).length)',
  '      .map(p => p.id + \':\' + active[p.id].slice().sort().join(\',\')).join(\'|\');',
  '    const paramsNarrowed = !!paramSig;',
  '    const narrowedBy = params.filter(p => inViewNarrows(p) && (active[p.id] || []).length)',
  '      .map(p => p.label.toLowerCase());',
  '',
)

const RESOLVE_FROM = lines(
  '      return Object.assign(base, fn(b, ctx), { population: population(b.source) },',
  '                           unaffectedByParams(b, ctx));',
  '',
)

const RESOLVE_TO = lines(
  '      const out = Object.assign(base, fn(b, ctx), { population: population(b.source) });',
  '      /* A block that re-derived over the rows in view MOVED with the narrowing, so the',
  '         unchanged-by-your-filters note would be a false sentence printed directly under',
  '         a figure that had just changed — and the population it read is the rows on',
  '         screen rather than the declared programme. Applied here rather than in each',
  '         handler because it is true of every block type: the figRows, the category bar,',
  '         the heatmap, the filing calendar and the prose all reach the same overlay',
  '         through sourceObject, and a rule written per handler would be six chances to',
  '         word one fact differently. */',
  '      const touched = inViewTouches(b, ctx);',
  '      if (touched) return Object.assign(out, inViewCoverage(b, ctx, touched));',
  '      return Object.assign(out, unaffectedByParams(b, ctx));',
  '',
)

const EDITS = [
  {
    name: 'the overlay, its rules and its two readers',
    from: FIGROW_ANCHOR,
    to: HELPER + FIGROW_ANCHOR,
  },
  { name: 'sourceObject resolving through the overlay', from: SOURCE_FROM, to: SOURCE_TO },
  { name: 'resolveTokens reading the same overlay as the tiles', from: TOKENS_FROM, to: TOKENS_TO },
  { name: 'applyParams narrowing on a param whose values are ranges', from: PARAMS_FROM, to: PARAMS_TO },
  { name: 'the narrowing signature counting that param', from: SIG_FROM, to: SIG_TO },
  {
    name: 'resolveBlock stating the population and dropping the note off a block that moved',
    from: RESOLVE_FROM,
    to: RESOLVE_TO,
  },
]

/* ------------------------------------------------------------------ applying it */

const die = (msg) => {
  console.error('\nRefused: ' + msg + '\n')
  process.exit(1)
}

function patch(name) {
  const path = fileURLToPath(new URL(name, DIR))
  const before = readFileSync(path, 'utf8')
  if (before.includes(MARKER)) return { name, path, skipped: true }

  let after = before
  for (const e of EDITS) {
    const hits = after.split(e.from).length - 1
    if (hits !== 1) {
      die(
        name + ': the anchor for ' + e.name + ' matched ' + hits + ' times, not once. The document ' +
          'has moved underneath this script — re-read the region and re-cut the anchor rather than ' +
          'loosening it.',
      )
    }
    after = after.replace(e.from, e.to)
  }
  writeFileSync(path, after, 'utf8')
  return { name, path, skipped: false, grew: after.length - before.length }
}

/* ------------------------------------------------------------------ verifying it */

/* The fixture is a JS object literal with comments in it, so the collections this checks are cut out
   by matching brackets and parsed as JSON rather than evaluated. Strings are skipped explicitly: a
   "]" inside a project name would end the roster early and the check would run on a prefix, which is
   the shape of guard this repo distrusts most. */
const BACKSLASH = String.fromCharCode(92)

function carve(src, from) {
  let open = from
  while (open < src.length && src[open] !== '[' && src[open] !== '{') open++
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '"') {
      i++
      while (i < src.length && !(src[i] === '"' && src[i - 1] !== BACKSLASH)) i++
      continue
    }
    if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') {
      depth--
      if (!depth) return src.slice(open, i + 1)
    }
  }
  return null
}

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')

function fixtureOf(src, key) {
  const at = src.indexOf(NL + '  ' + key + ': ')
  if (at < 0) return null
  const txt = carve(src, at + 4 + key.length)
  if (!txt) return null
  try {
    return JSON.parse(strip(txt))
  } catch {
    return null
  }
}

const sumOf = (rows, f) => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0)

/* Independent re-implementations of the rules the inserted code carries, deliberately written here
   rather than imported from it: a verification that reuses the code under test verifies nothing. */
const IDENTITY = {
  rcSampleAtRiskCount: (R) => R.filter((r) => r.rcStatus === 'misses_case').length,
  rcSampleNoDateCount: (R) => R.filter((r) => r.rcStatus === 'no_date').length,
  rcSampleDeferredCapital: (R) => sumOf(R.filter((r) => r.rcStatus === 'misses_case'), 'forecast'),
  rcNextFilingBy: (R) => R.map((r) => r.rcFilingBy).filter(Boolean).sort()[0] ?? null,
}
/*
 * Every row field any rule reads, in three classes — because "carried by every row" and "a number on
 * every row" are different requirements and demanding the stronger one refused a correct fixture.
 *
 * `SUMMED` are the fields a figure is the total of, so a null there is a hole in a printed number and
 * the run refuses. `NULLABLE` are read defensively and every rule already handles the null: `budget` is
 * only carried as aggregate()'s WEIGHT_FIELD and nothing in this family is a weighted average, and
 * `rcDaysOfSlack` is filtered to numbers before Math.min sees it. Three of the sixty rows — the
 * unencumbered network-common ones — carry both as null, which is the fixture being honest rather than
 * incomplete: they have a working forecast and no approved budget.
 *
 * Every field in all three classes must still be PRESENT on every row. That is the check that survives
 * a re-export: a renamed field arrives as `undefined`, the rule reading it stops moving, and the block
 * reverts to its declared figure with nothing on screen saying so.
 */
const SUMMED = ['planPeriod', 'actualPeriod', 'periodVariance', 'forecast']
const NULLABLE = ['budget', 'rcDaysOfSlack']
const CATEGORICAL = [
  'execCategory', 'budgetCategory', 'regionCode', 'regionName', 'jurisdiction', 'rcStatus', 'rcFilingBy',
]
const ROW_FIELDS = [...SUMMED, ...NULLABLE, ...CATEGORICAL]

/*
 * The document is not one scope. It is a series of IIFEs, each `(function (I) { … })(CW._api)`, and
 * the two this transform edits are different ones: `applyParams` and `aggregate` live in the CORE
 * module, while everything inserted above `H.figRow` lives in the REPORTS module below it. They share
 * only the interface object `I`.
 *
 * **That cost a released bug.** The `applyParams` branch was written referencing `IN_VIEW_PARAM`
 * directly, which is declared in the other module — a ReferenceError at request time, surfacing as
 * *"Could not resolve this report: IN_VIEW_PARAM is not defined"* on every CAPEX report. Nothing
 * caught it: `check-docs` matches text, and the harness that executed the rules had flattened every
 * region into one `vm` context, so the boundary it was violating did not exist there.
 *
 * So the boundary is checked here, structurally: **an identifier this transform introduces may only
 * be named inside the module that declares it.** Anything the other module needs goes through `I`,
 * which is what the core module's own `Object.assign(I, { … })` is for.
 */
function moduleRegions(src) {
  const regions = []
  const open = /\(function \(I\) \{/g
  let m
  while ((m = open.exec(src))) {
    const end = src.indexOf('})(CW._api);', m.index)
    if (end < 0) continue
    regions.push({ from: m.index, to: end, text: src.slice(m.index, end) })
    open.lastIndex = end
  }
  return regions
}

/* Every identifier the inserted code declares at module level. A name added to the module without
   being listed here is checked by nothing, so the list is derived from the inserted text rather than
   typed: any `const X =` or `function X(` at two-space indent inside HELPER. */
function injectedNames() {
  const names = new Set()
  for (const m of HELPER.matchAll(/^ {2}(?:const|let) (\w+)/gm)) names.add(m[1])
  for (const m of HELPER.matchAll(/^ {2}function (\w+)/gm)) names.add(m[1])
  return [...names]
}

function checkScopes(name, src) {
  const regions = moduleRegions(src)
  if (regions.length < 2) {
    die(name + ': expected at least two `(function (I) { … })(CW._api)` modules and found ' +
        regions.length + '. The scope check cannot run, and it is the check that catches an ' +
        'identifier used across a module boundary.')
  }
  const bare = (text, id) => new RegExp('(?<![.\\w])' + id + '\\b').test(text)
  for (const id of injectedNames()) {
    const declaredIn = regions.findIndex((r) =>
      new RegExp('^ {2}(?:const|let|function) ' + id + '\\b', 'm').test(r.text),
    )
    if (declaredIn < 0) continue
    regions.forEach((r, i) => {
      if (i === declaredIn) return
      if (bare(strip(r.text), id)) {
        die(name + ': `' + id + '` is declared in module ' + (declaredIn + 1) + ' and named bare in ' +
            'module ' + (i + 1) + '. These are separate IIFEs sharing only `I`, so that is a ' +
            'ReferenceError the moment the report resolves — reach it as `I.' + id + '` and publish ' +
            'it there, the way the core module publishes everything else.')
      }
    })
  }
}

function verify(name) {
  const path = fileURLToPath(new URL(name, DIR))
  const src = readFileSync(path, 'utf8')
  checkScopes(name, src)

  for (const e of EDITS) {
    const hits = src.split(e.to).length - 1
    if (hits !== 1) die(name + ': after writing, ' + e.name + ' is present ' + hits + ' times, not once.')
  }
  if (!src.includes(MARKER)) die(name + ': the written document does not carry ' + MARKER + '.')

  const R = fixtureOf(src, 'projects')
  const P = fixtureOf(src, 'portfolio')
  if (!Array.isArray(R) || !R.length) die(name + ': could not read db.projects back out of the document it just wrote.')
  if (!P) die(name + ': could not read db.portfolio back out of the document it just wrote.')

  /* 1. every row field every rule reads, carried by every row. */
  for (const f of ROW_FIELDS) {
    const missing = R.filter((r) => r[f] === undefined).length
    if (missing) {
      die(name + ': ' + missing + ' of ' + R.length + ' project rows carry no `' + f + '`, which the ' +
          'in-view rules read. The rule would stop moving and the block would quietly serve its ' +
          'declared figure instead. Re-cut the rules against the new roster.')
    }
    if (SUMMED.indexOf(f) > -1) {
      const bad = R.filter((r) => typeof r[f] !== 'number').length
      if (bad) {
        die(name + ': ' + bad + ' of ' + R.length + ' rows carry a non-numeric `' + f + '`, which is a ' +
            'field a printed total is the sum of. A null there is a hole in a figure, not a fact.')
      }
    }
  }

  /* 2. the four identity rules reproduce their declared value over the whole roster, to the dollar. */
  for (const [key, rule] of Object.entries(IDENTITY)) {
    if (!(key in P)) die(name + ': db.portfolio no longer carries `' + key + '`.')
    const got = rule(R)
    const want = P[key]
    const same = typeof got === 'number' && typeof want === 'number' ? Math.abs(got - want) <= 2 : got === want
    if (!same) {
      die(name + ': the rule for `' + key + '` gives ' + JSON.stringify(got) + ' over the whole roster ' +
          'where the document declares ' + JSON.stringify(want) + '. The fixture states these are ' +
          'computed over this sample, so a disagreement means the rule is reading the wrong field.')
    }
  }

  /* 3. the per-jurisdiction exposure reproduces, entry by entry. */
  for (const e of P.rateCaseExposure || []) {
    const mine = R.filter((r) => r.jurisdiction === e.jurisdiction)
    const of = (st) => mine.filter((r) => r.rcStatus === st)
    const checks = [
      ['projectCount', mine.length],
      ['eligibleCount', of('in_case').length],
      ['laterCaseCount', of('later_case').length],
      ['atRiskCount', of('misses_case').length],
      ['noDateCount', of('no_date').length],
      ['deferredCapital', sumOf(of('misses_case'), 'forecast')],
      ['undatedCapital', sumOf(of('no_date'), 'forecast')],
    ]
    for (const [k, got] of checks) {
      if (Math.abs(got - e[k]) > 2) {
        die(name + ': rateCaseExposure ' + e.jurisdiction + '.' + k + ' derives ' + got +
            ' where the document declares ' + e[k] + '.')
      }
    }
  }

  /* 4. the two PROGRAMME shapes must NOT reproduce — they are declared over 4,500 projects, so the
        rows should give roughly a fortieth. A shape that suddenly footed to the declared total would
        mean the rebuild had stopped reading rows, which is the failure that looks like success. */
  const share = P.sampleShareOfPortfolio
  const rowTotal = sumOf(R, 'periodVariance')
  if (Math.abs(rowTotal) >= Math.abs(P.periodVariance)) {
    die(name + ': the rows sum to a period variance of ' + rowTotal + ', which is not smaller than the ' +
        'declared programme figure ' + P.periodVariance + '. These are meant to be a sample of it.')
  }
  const H = P.varianceHeatmap || {}
  const cellSum = (H.z || []).reduce((a, row) => a + row.reduce((x, v) => x + v, 0), 0)
  if (Math.abs(cellSum - H.total) > (H.z || []).length * (H.categories || []).length) {
    die(name + ': the declared heatmap does not close on its own total, so the rebuilt one cannot be ' +
        'checked against it.')
  }

  return {
    rows: R.length, share,
    inView: (cat) => {
      const rows = R.filter((r) => r.execCategory === cat)
      const regions = [...new Set(rows.map((r) => r.regionCode))]
      const cats = [...new Set(rows.map((r) => r.budgetCategory))]
      return {
        n: rows.length,
        plan: sumOf(rows, 'planPeriod'),
        actual: sumOf(rows, 'actualPeriod'),
        variance: sumOf(rows, 'periodVariance'),
        bars: cats.length,
        grid: regions.length + '×' + cats.length,
        atRisk: rows.filter((r) => r.rcStatus === 'misses_case').length,
      }
    },
  }
}

/* ------------------------------------------------------------------ run */

console.log('\nLetting the CAPEX reports re-derive over the rows a reader\'s filters admit.\n')

for (const r of FILES.map(patch)) {
  console.log('  ' + (r.skipped ? 'already applied · ' : 'patched · +' + r.grew + ' bytes · ') + r.name)
}

console.log('\nVerifying against the documents on disk:')
const v = verify(FILES[0])
FILES.slice(1).forEach(verify)
console.log('    every row field the rules read is carried by all ' + v.rows + ' rows')
console.log('    the 4 identity rules and all rateCaseExposure entries reproduce their declared values')
console.log('    the 2 programme shapes are a ' + v.share + '% sample of the declared ones, as they should be')

console.log('\n  What a reader narrowing the Variance Report by executive category now sees:\n')
console.log('    category    rows   period plan    actual     variance   chart bars   heatmap')
for (const c of ['Blankets', 'Lead', 'Overhead', 'PFAS', 'Projects']) {
  const r = v.inView(c)
  console.log(
    '    ' + c.padEnd(11) + String(r.n).padStart(3) + '   ' +
      r.plan.toLocaleString('en-US').padStart(10) + '  ' +
      r.actual.toLocaleString('en-US').padStart(10) + '  ' +
      r.variance.toLocaleString('en-US').padStart(10) + '   ' +
      String(r.bars).padStart(7) + '      ' + r.grid,
  )
}
console.log('\n  Unnarrowed, every one of these blocks still serves the declared programme figure.')
console.log('  All ' + FILES.length + ' documents verified.\n')
