/**
 * Checks the schema reader against fixtures — `npm run verify:schema-import`.
 *
 * **Pure, so there is nothing to stand up.** `schemaImport.js` touches no `db`, no filesystem and no
 * request: it takes a filename and a string and answers with tables and columns. That is what makes
 * it checkable offline, for the reason `verify:export` checks the report renderers and
 * `verify:sigv4` replays AWS's own vector — a parser is arithmetic over text, and a wrong answer
 * here is not an error but a dictionary full of plausible nonsense.
 *
 * Every case below is one this reader got wrong at some point while it was being written. The two
 * worth naming, both from the SQL path and both silent:
 *
 *  - a trailing `-- comment` sat *after* the comma that ended its own column, so the split produced
 *    a column literally named `--` **and lost the next one entirely**;
 *  - folding that comment into a `COMMENT '…'` clause then put a comma inside a quoted string at
 *    depth 0, which split the definition in half and left the column with no description.
 *
 * Neither raised anything. A column missing from a dictionary is invisible.
 */

import { classForType, parseSchemaDocument } from '../schemaImport.js'

let failures = 0
const ok = (name, condition, detail = '') => {
  console.log(`${condition ? '  ok  ' : '  FAIL'} ${name}${condition ? '' : ` — ${detail}`}`)
  if (!condition) failures += 1
}

/** Asserts the parse is refused, and that the sentence says something a reader can act on. */
const refuses = (name, input, expected) => {
  try {
    parseSchemaDocument(input)
    ok(name, false, 'it was accepted')
  } catch (error) {
    ok(name, expected.test(error.message), `said "${error.message}"`)
  }
}

console.log('\nverify-schema-import:')

/* ---------------- CSV ---------------- */

const csv = [
  'Table,Column Name,Data Type,Description,Class,PII,Grain,Table Label',
  'plan_project_budget,project_id,STRING,The project key.,identifier,no,one row per project and version,Project budget',
  'plan_project_budget,budget_amount,"NUMERIC(18, 2)","Approved budget, in dollars.",,no,,',
  'plan_project_budget,holder_email,STRING,Budget holder.,person,yes,,',
  'plan_version_master,version_id,STRING,The version key.,identifier,no,one row per version,Versions',
].join('\n')
const fromCsv = parseSchemaDocument({ filename: 'dictionary.csv', text: csv })
ok('CSV reads one row per column, grouped into tables', fromCsv.tables.length === 2, String(fromCsv.tables.length))
ok(
  'the header is matched however it was spelled',
  fromCsv.tables[0].columns[0].column_id === 'project_id' &&
    fromCsv.tables[0].columns[0].type === 'STRING' &&
    fromCsv.tables[0].columns[0].description === 'The project key.',
  JSON.stringify(fromCsv.tables[0].columns[0]),
)
ok(
  'a comma inside a quoted field is not a separator',
  fromCsv.tables[0].columns[1].type === 'NUMERIC(18, 2)' &&
    fromCsv.tables[0].columns[1].description === 'Approved budget, in dollars.',
  JSON.stringify(fromCsv.tables[0].columns[1]),
)
ok(
  "a table's label and grain are taken from whichever row states them",
  fromCsv.tables[0].label === 'Project budget' &&
    fromCsv.tables[0].grain === 'one row per project and version',
  `${fromCsv.tables[0].label} / ${fromCsv.tables[0].grain}`,
)
ok('pii is read as a flag, not a string', fromCsv.tables[0].columns[2].pii === true)
ok('and a blank pii is false rather than missing', fromCsv.tables[0].columns[0].pii === false)

const tsv = 'table\tcolumn\ttype\nt\ta\tSTRING\nt\tb\tDATE'
ok(
  'TSV is the same reader on a tab',
  parseSchemaDocument({ filename: 'd.tsv', text: tsv }).tables[0].columns.length === 2,
)

/* ---------------- JSON ---------------- */

const nested = JSON.stringify({
  dataset: 'plan',
  tables: [
    {
      table: 'plan_monthly_spread',
      label: 'Monthly spread',
      grain: 'one row per project and month',
      columns: [
        { name: 'project_id', type: 'STRING', description: 'The project key.', class: 'identifier' },
        'period',
      ],
    },
  ],
})
const fromJson = parseSchemaDocument({ filename: 'schema.json', text: nested })
ok('JSON names its own dataset', fromJson.dataset_id === 'plan', String(fromJson.dataset_id))
ok(
  'and a bare string in a column list is a column name',
  fromJson.tables[0].columns[1].column_id === 'period' &&
    fromJson.tables[0].columns[1].type === null,
  JSON.stringify(fromJson.tables[0].columns[1]),
)

const flat = JSON.stringify([
  { dataset: 'plan', table: 't', column: 'a', type: 'STRING' },
  { table: 't', column: 'b', type: 'DATE' },
])
const fromFlat = parseSchemaDocument({ filename: 'flat.json', text: flat })
ok(
  'a flat JSON array lands the same way a CSV does',
  fromFlat.dataset_id === 'plan' &&
    fromFlat.tables.length === 1 &&
    fromFlat.tables[0].columns.length === 2,
  JSON.stringify(fromFlat),
)

/* ---------------- SQL DDL ---------------- */

const sql = [
  '/* a block comment holding a CREATE TABLE nobody wrote */',
  '-- a section header, which describes no column',
  'CREATE TABLE IF NOT EXISTS `plan.plan_actuals` (',
  "  project_id STRING NOT NULL COMMENT 'it''s the project key, really',",
  '  amount NUMERIC(18,2), -- dollars, unrounded',
  '  period DATE, -- calendar month',
  '  approved BOOL,',
  '  PRIMARY KEY (project_id, period)',
  ');',
].join('\n')
const fromSql = parseSchemaDocument({ filename: 'ddl.sql', text: sql })
const sqlColumns = fromSql.tables[0].columns
ok('the dataset comes off a qualified table name', fromSql.dataset_id === 'plan', String(fromSql.dataset_id))
ok('the table is the last segment', fromSql.tables[0].table_id === 'plan_actuals', fromSql.tables[0].table_id)
ok(
  'every column survives a trailing comment — the one that lost `amount`',
  sqlColumns.map((c) => c.column_id).join(',') === 'project_id,amount,period,approved',
  sqlColumns.map((c) => c.column_id).join(','),
)
ok(
  'a `--` comment becomes the description of the column it sits beside',
  sqlColumns[1].description === 'dollars, unrounded' && sqlColumns[2].description === 'calendar month',
  JSON.stringify(sqlColumns.map((c) => c.description)),
)
ok(
  "a comma inside a COMMENT does not split the definition — the one that lost the description",
  sqlColumns[0].description === "it's the project key, really" && sqlColumns[0].type === 'STRING',
  JSON.stringify(sqlColumns[0]),
)
ok('a key line is not a column', !sqlColumns.some((c) => /PRIMARY/i.test(c.column_id)))
ok('and a whole-line comment describes nothing', sqlColumns.every((c) => !/section header/.test(c.description)))
ok(
  'a parenthesised type keeps its comma',
  sqlColumns[1].type === 'NUMERIC(18,2)',
  sqlColumns[1].type,
)

/* ---------------- the class a type implies ---------------- */

ok(
  'a type maps to the class its shape implies',
  ['INT64', 'NUMERIC(18,2)', 'FLOAT64'].every((t) => classForType(t) === 'measure') &&
    ['DATE', 'TIMESTAMP', 'TIME'].every((t) => classForType(t) === 'date') &&
    classForType('BOOL') === 'flag' &&
    classForType('STRING') === 'text',
)
ok(
  'and nothing infers an identifier from a name',
  /* `identifier` is what the relationship suggester matches joins on, so guessing it from a naming
     convention would put a suggested join in front of a reviewer on no evidence at all. */
  classForType('STRING') === 'text' && classForType(null) === 'text',
)

/* ---------------- refusals ---------------- */

refuses(
  'a spreadsheet is refused, naming the formats and the remedy',
  { filename: 'dictionary.xlsx', text: 'PK' },
  /not a format this reads[\s\S]*export the sheet as CSV/,
)
refuses(
  'a file with no extension is refused rather than guessed at',
  { filename: 'dictionary', text: 'a,b' },
  /no extension/,
)
refuses('an empty file is refused', { filename: 'd.csv', text: '   ' }, /is empty/)
refuses(
  'a CSV with no table or column header is refused, naming what it found',
  { filename: 'd.csv', text: 'foo,bar\n1,2' },
  /needs a header naming at least a table and a column — found foo, bar/,
)
refuses(
  'a row naming no column is refused, by line number',
  { filename: 'd.csv', text: 'table,column\nt,\n' },
  /line 2 names no column/,
)
refuses(
  'a duplicate column is refused — it would collide in the dictionary',
  { filename: 'd.csv', text: 'table,column\nt,a\nt,a\n' },
  /declares a twice/,
)
refuses(
  'JSON that is not JSON says so',
  { filename: 'd.json', text: '{ nope' },
  /not valid JSON/,
)
refuses(
  'JSON with no tables array names the two shapes it takes',
  { filename: 'd.json', text: '{"foo":1}' },
  /no "tables" array/,
)
refuses(
  'a table with no columns is refused',
  { filename: 'd.json', text: '{"tables":[{"table":"t","columns":[]}]}' },
  /lists no columns/,
)
refuses(
  'SQL with no CREATE TABLE is refused',
  { filename: 'd.sql', text: 'SELECT 1;' },
  /no CREATE TABLE statement/,
)

console.log(
  failures === 0
    ? '\nverify-schema-import: OK — CSV/TSV quoting, JSON in both shapes, DDL comments and every refusal.\n'
    : `\nverify-schema-import: ${failures} FAILED\n`,
)
process.exit(failures === 0 ? 0 : 1)
