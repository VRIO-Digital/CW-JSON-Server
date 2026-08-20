/**
 * Check the report exporters, without a bucket, a network or a published graph.
 *
 *     node scripts/verify-report-export.mjs
 *
 * `toHtml` and `toCsv` are pure, which is what makes this possible — and what makes it worth
 * doing. Their failure modes are all silent: a comma inside a facility name splits a CSV row and
 * shifts every later column by one; an unescaped `<` swallows the rest of an HTML document; a
 * block kind nobody handled simply does not appear. None of the three throws, and all three
 * produce a file that opens.
 *
 * The block **kinds** are read out of `server.mjs` rather than listed here, so a kind added there
 * and not handled in the exporter fails this rather than exporting as nothing.
 *
 * Runs in `preflight`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { exportKey, toCsv, toHtml } from '../reportExport.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const failures = []
const check = (what, ok, detail) => {
  if (!ok) failures.push(`${what}${detail ? `\n    ${detail}` : ''}`)
}

/*
 * A report shaped like the ones `reportBuild` returns, carrying the values that break exporters:
 * a comma, a double quote, a newline, and a tag. Synthetic on purpose — this asserts the
 * renderer's mechanics, and real data would not reliably contain any of these.
 */
const HOSTILE = 'Denka, "Performance" <script>alert(1)</script>\nElastomers'

const report = {
  report_id: 'risk',
  heading: 'Inbound Generator Risk Register',
  subtitle: 'Ranked by penalty exposure',
  badge: 'Compliance',
  question: 'Which generators carry the most exposure?',
  reading: 'All 36 inbound generators, by penalty total.',
  row_count: 2,
  spine_total: 36,
  variant: 'written',
  assumptions: { scope: 'All inbound', measure: 'Penalty total' },
  frame: { scope: 'all', measure: 'penalty_total' },
  graph: { name: 'Cradle-to-Grave', version: 'v2', sha256: 'abc123def456abc123def456' },
  tiles: [{ label: 'Distinct generators', value: '36', unit: 'shipping to Deer Park' }],
  source_trace: 'RCRA_Compliance_Summary joined to e_manifest_all.',
  footer: [{ label: 'Source', text: 'RCRA rollups' }],
  caveats: ['The horizon is declared, not applied.'],
  blocks: [
    {
      type: 'chart',
      chart: 'bar',
      title: 'Penalty by generator',
      x_label: 'Generator',
      y_label: 'Penalty',
      data: [
        { label: HOSTILE, value: 540000, tier: 'High' },
        { label: 'Chemours', value: 120000 },
      ],
      note: 'Rows carrying nothing are dropped.',
    },
    {
      type: 'table',
      title: 'Register',
      columns: [
        { key: 'name', label: 'Generator', kind: 'text' },
        { key: 'penalty', label: 'Penalty', kind: 'number' },
      ],
      rows: [
        { name: HOSTILE, penalty: 540000 },
        { name: 'Chemours', penalty: 120000 },
      ],
      sorted_by: 'Penalty',
    },
    {
      type: 'traces',
      title: 'Custody chains',
      columns: [{ key: 'manifest', label: 'Manifest', kind: 'text' }],
      rows: [{ manifest: 'MAN-001' }],
    },
  ],
}

const html = toHtml(report, { generatedAt: '2026-08-18T16:40:02Z', generatedBy: 'a@b.com' })
const csv = toCsv(report, { generatedAt: '2026-08-18T16:40:02Z', generatedBy: 'a@b.com' })

/* ---------------- HTML ---------------- */

check(
  'HTML escapes a tag in a data value',
  !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'),
  'an unescaped value ends the document early and the rest of the report vanishes',
)
check(
  'HTML is self-contained',
  !/(src|href)\s*=\s*["']?https?:/i.test(html) && !/@import|url\(\s*https?:/i.test(html),
  'the bucket is private and the viewer is remote — an external asset simply fails',
)
check('HTML carries a print stylesheet', /@media print/.test(html), 'PDF is print-to-PDF here')
check(
  'HTML states when it was generated and against which graph',
  html.includes('2026-08-18T16:40:02Z') && html.includes('abc123def456'),
  'a figure detached from its moment and its graph is a number with no question',
)
check(
  'every chart value is printed, not only drawn',
  html.includes('540,000') && html.includes('120,000'),
  'a bar with no number beside it encodes magnitude by length alone',
)
check(
  'every tabular block reaches the HTML',
  html.includes('Register') && html.includes('Custody chains'),
  'a block that renders as nothing is a silent truncation',
)

/* ---------------- CSV ---------------- */

check(
  'CSV quotes a value holding a comma, a quote and a newline',
  csv.includes('"Denka, ""Performance"" <script>alert(1)</script>\nElastomers"'),
  'an unquoted comma shifts every later column by one, silently',
)
check(
  'every tabular block reaches the CSV',
  csv.includes('Register') && csv.includes('Custody chains'),
  'exporting one table of several is a silent truncation of the rest',
)
check(
  'CSV carries the frame, not just the figures',
  csv.includes('Generated') && csv.includes('Rows in view') && csv.includes('abc123def456'),
  'the same rule as the HTML: a figure travels with its question',
)
check('CSV uses CRLF', csv.includes('\r\n'), 'RFC 4180, and what Excel expects')

/* ---------------- keys ---------------- */

check(
  'an export key is timestamped and safe in a bucket listing',
  exportKey(report, 'html', '2026-08-18T16:40:02.123Z') === 'exports/risk-2026-08-18T16-40-02Z.html',
  `got ${exportKey(report, 'html', '2026-08-18T16:40:02.123Z')}`,
)

/* ---------------- no kind goes unhandled ---------------- */

/*
 * The denominator comes from the server: every `type:` a `reportBlock` branch returns. A kind added
 * there and not handled here renders as nothing at all, which is the failure this whole file exists
 * to catch — and listing the kinds here instead would go stale the moment one was added.
 */
const server = read('server.mjs')
const fnStart = server.indexOf('function reportBlock(')
/* To the closing brace in column 0, which is where a top-level function ends. Slicing to "the next
   function declaration" broke the moment one was declared above rather than below: it cut the body
   short and the check passed over three of the four kinds. */
const fnEnd = server.indexOf('\n}', fnStart)
const blockFn = fnStart >= 0 && fnEnd > fnStart ? server.slice(fnStart, fnEnd) : ''
const kinds = [...blockFn.matchAll(/^\s+type: '([a-z]+)',$/gm)].map((m) => m[1])
const exporter = read('reportExport.mjs')

check(
  'the exporter handles every block kind the server emits',
  kinds.length >= 4 &&
    kinds.every((k) => k === 'chart' || exporter.includes(`'${k}'`)),
  `server emits: ${kinds.join(', ') || '(none found — did reportBlock move?)'}`,
)

if (failures.length > 0) {
  console.error('\nverify-report-export: FAILED')
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}

console.log(
  `verify-report-export: OK — HTML escaped and self-contained, CSV quoted, ` +
    `${kinds.length} block kinds all handled.`,
)
