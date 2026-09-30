/**
 * Build the Keolis AI Submissions page from the prototype build + the package's own DB.
 *
 * Inputs:
 *  - `frontend/keolis/keolis-ai-submission.html` — the AI Submissions prototype build (its `const DB`
 *    is the Northline Water Group fixture; everything else is the engine).
 *  - `frontend/keolis/json/07_ai_submissions/ai_submissions_db.json` — "a Keolis version of the DB
 *    object … with the same keys" (the package README), whose `_engine_notes` state exactly what the
 *    engine has to read differently.
 *
 * Output: `frontend/src/Keolis/ai-submissions/keolis_ai_submissions.html` — the same engine over the
 * Keolis DB, with the engine-side strings the notes call out remapped:
 *
 *  - engine ids: `dsic_filing` -> `eligibility_filing`, `board_deck` -> `review_deck`;
 *  - hardcoded row ids: `dsic` -> `ppi_q`, `board_q` -> `ci_q` (the notes' mapping);
 *  - rule tests: `before_test_year` -> `already_claimed`, `startsWith('class')` -> `ger_funded`;
 *  - the DSIC prose the engine composes (check titles, Schedule 2's revenue-requirement rows, the
 *    petition narrative, slide D5) rewritten in the PPI-claim vocabulary, worded from the Keolis
 *    DB's own rules and paramRows — no figure is typed in; every number stays an expression over DB.
 *
 * The arithmetic is deliberately NOT patched: the package aliased its parameters so the prototype's
 * own formula computes the claim exactly (`fixedChargeRate: 1`, `priorClosingPlant = claimedYTD`,
 * `capPct: 100`, `revenues = annualEnvelope`), which its `fixedChargeNote` states in words.
 *
 * **Every replacement is anchored and counted, and the run refuses to write on any drift** — a
 * re-exported prototype that moved a sentence fails loudly instead of shipping half-translated. A
 * final sweep refuses any Northline/DSIC residue in the output, so the page cannot say one tenant's
 * words over another's figures.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const SRC_HTML = join(root, 'frontend', 'keolis', 'keolis-ai-submission.html')
const SRC_DB = join(root, 'frontend', 'keolis', 'json', '07_ai_submissions', 'ai_submissions_db.json')
const OUT = join(root, 'frontend', 'src', 'Keolis', 'ai-submissions', 'keolis_ai_submissions.html')

function fail(message) {
  console.error(`\nbuild-keolis-ai-submissions: refusing to write — ${message}\n`)
  process.exit(1)
}

const html = readFileSync(SRC_HTML, 'utf8')
const dbJson = JSON.parse(readFileSync(SRC_DB, 'utf8'))

/* ---------------- split the document around the DB block ---------------- */

const dbStart = html.indexOf('const DB = {')
if (dbStart < 0) fail('the prototype has no `const DB = {` block')
const dbEndRel = html.slice(dbStart).match(/\n\};/)
if (!dbEndRel) fail('cannot find the end of the DB block')
const dbEnd = dbStart + dbEndRel.index + 3

let head = html.slice(0, dbStart)
let tail = html.slice(dbEnd)

/* ---------------- the Keolis DB, serialised as the new block ---------------- */

const { _about, _engine_notes, ...db } = dbJson
if (db.templates?.ppi_claim?.example !== 'eligibility_filing') {
  fail('the Keolis DB no longer names its filing engine "eligibility_filing" — re-read _engine_notes')
}
/* `<` escaped so the embedded JSON can never close the script element early. */
const dbBlock = 'const DB = ' + JSON.stringify(db).replace(/</g, '\\u003c') + ';'

/* ---------------- the engine-side replacements, each anchored and counted ---------------- */

let code = head + '\u0000DB\u0000' + tail // one string so a rule can hit either side of the block
const counts = []

function rep(from, to, min = 1, max = min) {
  const n = code.split(from).length - 1
  if (n < min || n > max) {
    fail(
      `expected ${min === max ? min : `${min}..${max}`} of ${JSON.stringify(from.slice(0, 90))} in the ` +
        `engine, found ${n} — the prototype build has drifted; re-derive this rule before writing.`,
    )
  }
  code = code.split(from).join(to)
  counts.push([from.slice(0, 60), n])
}

/* -- engine ids and hardcoded row ids (the notes' own mapping) -- */
rep("'dsic_filing'", "'eligibility_filing'", 9)
rep("'board_deck'", "'review_deck'", 2)
rep("dsicSub", "claimSub", 3, 8)
rep("'dsic'", "'ppi_q'", 3)
rep("'board_q'", "'ci_q'", 2)

/* -- rule tests (the notes: before_test_year -> already_claimed, class* -> ger_funded) -- */
rep("r.rule.startsWith('class')", "r.rule === 'ger_funded'", 1)
rep("r.rule === 'before_test_year'", "r.rule === 'already_claimed'", 1)

/* -- the filing checks, retitled in the claim's vocabulary -- */
rep("'Asset class eligibility'", "'Eligible scope — Annex 7 renewal'", 1)
rep('included in stipulated classes', 'included in the eligible scope', 1)
rep('excluded by class.', 'excluded — GER, inside the contract price.', 1)
rep("'Construction start after the prior test year (30 Jun 2024)'", "'Not claimed in an earlier quarter'", 1)
rep('excluded — presumed in base rates.', 'excluded — already claimed in Q1 or Q2.', 1)
rep(
  'register date 27 Aug 2026, no certificate attached',
  'register date ${fdate(p.inService)}, no acceptance record attached',
  1,
)
rep('Annual DSIC revenues within the ${DB.params.capPct}% cap', 'Claim within the annual PPI appropriation', 1)
rep(
  'Revenue requirement ${money(c.rr)} against a cap of ${money(c.cap)} — ${pct(c.capUse)} of cap used.',
  'Claimed to date plus this claim ${money(c.rr)} against the ${money(c.cap)} appropriation — ${pct(c.capUse)} used.',
  1,
)
rep("'Minimum annual eligible spend met'", "'Minimum quarterly claim met'", 1)
rep(
  'this period against a ${money(DB.params.minSpend)} annual floor (Stipulation ¶9).',
  'this quarter against a ${money(DB.params.minSpend)} quarterly minimum (Convention §4.3).',
  1,
)
rep('agree to PeopleSoft at the August close', 'agree to the finance ERP at the August close', 1)

/* -- the schedules -- */
rep("'Project master (northline_pmo.attributes)'", "'Project master (keolis_valmont_ppm.project)'", 1, 4)
rep(
  "'Schedule 1 — Eligible plant additions placed in service'",
  "'Schedule 1 — Eligible renewal milestones achieved in the quarter'",
  1,
)
rep("PAR('eligible classes (Stipulation Schedule A)')", "PAR('eligible scope (Convention §2 · Annex 7)')", 1)
rep("'GL postings (PeopleSoft), account 331'", "'GL postings (finance ERP), capital accounts'", 3)
rep("'GL postings (PeopleSoft), capital accounts'", "'GL postings (finance ERP), capital accounts'", 2)
rep("'GL postings (PeopleSoft)'", "'GL postings (finance ERP)'", 1)
rep("'Total additions this period'", "'Total claimed this quarter'", 1)
rep("'Schedule 2 — Revenue requirement and cap test'", "'Schedule 2 — Claim against the annual appropriation'", 1)
rep(
  'sub: `Fixed charge rate ${pct(P.fixedChargeRate * 100, 2)} (${P.fixedChargeNote}) · cap ${P.capPct}% of water revenues`',
  'sub: `${P.fixedChargeNote} · annual appropriation ${money(P.revenues)} (Convention Annex 2)`',
  1,
)
rep(
  "'Opening cumulative eligible plant (closing balance of prior submission)'",
  "'Claimed to date in 2026 (Q1 + Q2, as submitted)'",
  1,
)
rep("asOf: '2026-04-10'", "asOf: '2026-07-15'", 1)
rep("'Additions this period (Schedule 1)'", "'This claim (Schedule 1)'", 1)
rep("'<b>Cumulative eligible plant</b>'", "'<b>Claimed including this claim</b>'", 1)
rep(
  'v: `× Fixed charge rate ${pct(P.fixedChargeRate * 100, 2)}`',
  "v: 'Claim basis — cost reimbursed, no return applied'",
  1,
)
rep("DER('r3 × fixed charge rate')", "DER('r3 — cost basis, no rate applied')", 1)
rep(
  'v: `Annual cap — ${P.capPct}% of water revenues ${money(P.revenues)}`',
  'v: `Annual PPI appropriation — ${money(P.revenues)}`',
  1,
)
rep("PAR('cap % and revenues (Stipulation ¶7)')", "PAR('Convention Annex 2 — 2026 line')", 1)
rep("'Headroom under cap'", "'Appropriation remaining'", 2)
rep('of cap used)', 'of appropriation used)', 1)
rep("'DSIC as a percentage of the customer bill'", "'Claim as a share of the annual appropriation'", 1)
rep("DER('r4 ÷ revenues')", "DER('r4 ÷ appropriation')", 1)

/* -- the petition narrative, one line per paragraph -- */
function repLine(marker, newLine, expected = 1) {
  const lines = code.split('\n')
  const hits = lines.map((l, n) => (l.includes(marker) ? n : -1)).filter((n) => n >= 0)
  if (hits.length !== expected) {
    fail(`expected ${expected} line(s) containing ${JSON.stringify(marker.slice(0, 60))}, found ${hits.length}`)
  }
  for (const n of hits) lines[n] = newLine
  code = lines.join('\n')
  counts.push(['line: ' + marker.slice(0, 50), hits.length])
}

repLine(
  'Northline Water Group (the Company) submits',
  "      `Keolis Valmont (the delegate) submits this quarterly PPI claim under Convention ${P.docket} for the claim period 1 July to 30 September 2026, pursuant to DSP-VM-2021 Article 34.3 ${CD('Convention VM-PPI-2024')}. During the quarter the delegate achieved ${c.included.length} eligible renewal milestones with a total cost of ${money(c.additions)} ${C('S1', 'total', 'cost', 'S1 total')}.`,",
)
repLine(
  'Cumulative eligible plant since the foundational filing',
  "      `Claimed against the 2026 appropriation, including this claim, is ${money(c.cumulative)} ${C('S2', 'r3', 'amt')} — claims reimburse recorded cost and no return is applied ${C('S2', 'r4', 'amt')}. This is ${pct(c.capUse)} of the annual appropriation of ${money(c.cap)} ${C('S2', 'r5', 'amt')}, leaving ${money(c.headroom)} available for the Q4 claim ${C('S2', 'r6', 'amt')}.`,",
)
repLine(
  'The Company evaluated ${DB.projects.length} candidate projects',
  "      `The delegate evaluated ${DB.projects.length} candidate lines and did not include ${c.excluded.length} of them. Each exclusion and the rule that produced it is stated in Schedule 3 ${C('S3', (c.excluded[0] || c.na[0]).p.id, 'rule', 'S3')}: works finishing after the quarter closed, GER-funded maintenance inside the contract price, grid works the authority reads as outside the delegated scope, a change request submitted but not approved, and a cost pursued under Article 34.4 rather than the PPI.${c.na.length ? ` ${c.na.length} line could not be evaluated at the date of this draft because the register carries an installation date with no acceptance record; the delegate does not claim a line on the strength of a register date alone.` : ''}`,",
)
repLine(
  'All Schedule 1 costs are recorded in the general ledger',
  '      `All Schedule 1 costs are recorded in the general ledger at the amounts stated, at the August 2026 close. September postings are open and are not read by any figure in this claim.`,',
)

/* -- the deck -- */
rep("'Programme at a glance — FY2026, New Jersey'", "'Programme at a glance — FY2026, Réseau Valmo'", 1)
rep(
  "Forecast is ${spct(c.fcDeltaPct)} above budget ${C('D1', 'kpi', 'fc', 'forecast')}, driven by treatment plant and the Selby Point Phase 4 acceleration — detail on D3.",
  "Forecast is ${spct(c.fcDeltaPct)} against budget ${C('D1', 'kpi', 'fc', 'forecast')}, driven by the bus tranche 2 phasing and the TV-100 frame allowance — detail on D3.",
  1,
)
rep(
  'Four register entries in the quarter to 15 September.',
  '${c.q3.length} register entries in the quarter to ${fdate(DB.asOf.register)}.',
  1,
)
rep(
  'The domestic services tranche has a register date but no certificate; Project Controls has been asked for it.',
  'The battery campaign entry is a register date with no acceptance record; the certificate has been requested.',
  1,
)
rep('cost from GL account 331 at', 'cost from the finance ERP at', 1)
/*
 * The whole quoted branch, swapped for a nested template literal — the class name has to be read
 * off the run (`needsCommentary[0].cls`), and `${}` does not interpolate inside the single-quoted
 * string the prototype used. A nested template inside the ternary is valid where it sits.
 */
rep(
  "'Treatment plant is over the threshold with no commentary from the PMO — do not present this slide until it has one or is stated as unexplained.'",
  '`${c.needsCommentary[0].cls} is over the threshold with no commentary from the PMO — do not present this slide until it has one or is stated as unexplained.`',
  1,
)
rep(
  "'One decision: re-phasing Dunmoor East. The contractor\\'s shipment note is a claim from an email and is presented as one; the register has not moved. The PFAS item is a proposed rule and changes nothing yet.'",
  "'One decision: the TV-100 frame change request RC-005-009. The supplier\\'s delivery date is a claim from an email and is presented as one; the ERP has not moved. The T1 closure stays provisional until the authority decides on 1 October.'",
  1,
)
rep("'Regulatory recovery outlook — DSIC'", "'Funding recovery outlook — PPI claim'", 1)
rep('The same governed figures as the DSIC submission', 'The same governed figures as the PPI claim', 1)
rep('no DSIC draft exists yet', 'no PPI claim draft exists yet', 1)
rep('Resolved from the same graph as the DSIC filing:', 'Resolved from the same graph as the PPI claim:', 1)
rep('stipulation parameters`', 'convention parameters`', 1)
rep("'Eligible additions, Mar–Aug 2026'", "'Eligible milestones, Jul–Sep 2026'", 1)
rep('(as the DSIC submission resolves them)', '(as the PPI claim resolves them)', 1)
rep("'Annualised revenue requirement'", "'Claimed to date incl. this claim'", 1)
rep("DER('cumulative eligible plant × 11.74%')", "DER('claimed to date + this claim')", 1)
rep('of the ${mM(f.cap)} cap', 'of the ${mM(f.cap)} appropriation', 1)
rep("PAR('period end + 45 days (Stipulation ¶11)')", "PAR('period end + 15 days (Convention §4)')", 1)
rep("DER('cap − revenue requirement')", "DER('appropriation − claimed')", 1)
repLine(
  'Hydrant renewals',
  "  D5.blocks.push({ type: 'bullets', items: [`Reimbursement of ${mM(f.additions)} ${C('D5', 'kpi', 'add', 'additions')} eligible milestones is claimed quarterly; the October claim takes the year to ${pct(f.capUse)} of the appropriation ${C('D5', 'kpi', 'rr', 'claimed')}.`, `The Les Aubiers lift stays outside the claim — GER, funded inside the contract price — and the BUS-204 engine is pursued under Article 34.4, not the PPI.`] });",
)
rep("'threshold, board dates, DSIC parameters'", "'threshold, committee dates, PPI parameters'", 1)
rep('rate base, CWIP and AFUDC', 'GER spend and grant income', 1)

/* -- forecast-round vocabulary: the notes say fcJan is round R1 (April) and fc66 the working R2 -- */
rep('6+6', 'R2', 6, 20)
rep('the movement from the January calendarisation is a column', 'the movement from the R1 round is a column', 1)
rep("PRJ('January calendarisation of the approved budget', '2026-01-31')", "PRJ('R1 forecast round of the approved budget', '2026-04-30')", 1)
rep('Movement since the January calendarisation', 'Movement since the R1 round', 1)
rep('· January calendarisation ·', '· R1 round (April) ·', 1)
rep("'Jan fcst'", "'R1 fcst'", 1)
rep("'FY2026 capital budget, approved by the board 20 Nov 2025'", "'FY2026 capital budget, as approved'", 1)
rep('Budget approved November 2025.', 'Budget as approved.', 1)
rep('Budget: board approval 20 Nov 2025', 'Budget: as approved', 1)
rep('Budget: approved 20 Nov 2025', 'Budget: as approved', 1)

/* -- the calendar rows the engine hardcodes for its own ids -- */
rep(
  "period: 'Recovery period 1 Mar – 31 Aug 2026', due: '2026-10-15', leadDays: 30, status: 'not_started', ref: 'WR24050321'",
  "period: 'Claim period 1 Jul – 30 Sep 2026', due: '2026-10-15', leadDays: 15, status: 'not_started', ref: 'VM-PPI-2024'",
  1,
)
rep("label: 'Board capital review — Q3 2026'", "label: 'Investment committee review — Q3 2026'", 1)
rep("'WR24050321'", "'VM-PPI-2024'", 1) /* the remaining one, on the foundational row */
rep("'Stipulation parameters (stream setup)'", "'Convention parameters (stream setup)'", 2)
rep(
  "'Cap, fixed charge rate, eligible classes, filing lag — each cited to the stipulation.'",
  "'Appropriation, minimum claim, eligible scope, filing lag — each cited to the convention.'",
  1,
)
rep("'Prior filing (archive, filed 10 Apr 2026)'", "'Prior claim (archive, submitted 15 Jul 2026)'", 1)
rep("['Prior filing (as filed)', '2026-04-10']", "['Prior claim (as submitted)', '2026-07-15']", 1)

/* -- tenant framing -- */
rep('Every number is invented for Northline.', 'Every number is invented for Keolis Valmont.', 1)
rep('In this demo the findings are fixtures for New Jersey', 'In this demo the findings are fixtures for Valmont Métropole', 1)
rep('This demo carries discovery content for New Jersey only.', 'This demo carries discovery content for Valmont Métropole only.', 1)
rep('<title>AI Submissions — Context Weave demo</title>', '<title>AI Submissions — Keolis Valmont</title>', 1)

/*
 * -- the embedded app shell, removed --
 *
 * This page is framed inside the console, which already draws the wordmark, the navigation and the
 * signed-in identity — so the prototype's own topbar (a second "Context Weave" and a second persona),
 * its disabled placeholder nav rows for pages that live outside this frame (Sources, Catalogue,
 * Graph, Ask, What-if, Govern), and its demo footer with the Reset link all go. What stays is the
 * one group that is real inside the frame: **AI Submissions**, with Streams, the active streams and
 * Templates — that is this page's own internal navigation. Line-keyed removals, so a re-export that
 * moves the shell fails the anchored count rather than shipping half a shell.
 */
repLine('<div class="topbar"><div class="brand">', '') /* the brand + tenant chip */
repLine('<div class="persona">', '') /* the second signed-in identity, and the topbar's close */
/* The 52px grid row the topbar occupied — left in place it becomes a blank strip above the nav. */
rep('grid-template-rows:52px 1fr', 'grid-template-rows:1fr', 1)
repLine("[['Sources', '⌁']", '') /* the four disabled rows above the AI Submissions group */
repLine("[['What-if', '⇄']", '') /* the two below it */
/* The footer line also closes the nav element, so the close survives the removal. */
repLine('demo build v7.3', '      </nav>')

/* ---------------- reassemble and sweep ---------------- */

let out = code.replace('\u0000DB\u0000', dbBlock)

/*
 * Nothing of the other tenant may survive — a missed string is one tenant's words over another's
 * figures, and it renders perfectly. `stipulation` lowercase survives once, in the generic list of
 * governing-document kinds ("a stipulation or order, a loan agreement…"), which is a kind of
 * document rather than Northline's.
 */
const banned = [
  'dsic',
  'DSIC',
  'Northline',
  'northline',
  'PeopleSoft',
  'New Jersey',
  'NJ BPU',
  'board_deck',
  'before_test_year',
  "startsWith('class')",
  'WR24050321',
  'Dunmoor',
  'Selby',
  'Hydrant',
  '6+6',
  'January calendarisation',
  'water revenues',
  'account 331',
  'the Company',
  'Stipulation',
]
for (const word of banned) {
  const n = out.split(word).length - 1
  if (n > 0) {
    const at = out.indexOf(word)
    fail(
      `${n} occurrence(s) of ${JSON.stringify(word)} survived the transform — first at: ` +
        JSON.stringify(out.slice(Math.max(0, at - 80), at + 100)),
    )
  }
}

/* The claim the README states — €4.86M claimable in Q3 — recomputed from the DB being shipped. */
const additions = db.projects.filter((p) => p.decision === 'include').reduce((a, p) => a + p.cost, 0)
const headroom = db.params.revenues - db.params.priorClosingPlant - additions
console.log(
  `claim recomputed from the DB: €${(additions / 1e6).toFixed(2)}M claimable · ` +
    `€${(headroom / 1e6).toFixed(2)}M of the appropriation left after it`,
)
if (additions !== 4_860_000) {
  fail(`the included milestones sum to €${additions.toLocaleString()}, not the €4,860,000 the package README states`)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, out, 'utf8')
console.log(`build-keolis-ai-submissions: wrote ${OUT}`)
console.log(`  ${counts.length} anchored replacements, ${out.length.toLocaleString()} chars`)
