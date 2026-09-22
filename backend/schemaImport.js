/**
 * Reading a schema or data-dictionary file into the shape the Catalog's dictionary holds.
 *
 * **Pure, exported, and in a file of its own — for the reason `reportExport.js` is.** A parser is
 * arithmetic over text: it either read the file the reader meant or it read a different one, and
 * the failure of getting it wrong is a dictionary full of plausible nonsense rather than an error.
 * So none of this touches `db`, the filesystem or a request, `npm run verify:schema-import` replays
 * it over fixtures offline, and `server.js` is left with the part that is genuinely its own —
 * deciding what a parsed table *means* for a project it can see.
 *
 * **What it reads, and what it refuses.** Four formats, because these are the ones a schema
 * actually arrives in that can be read with no dependency:
 *
 *  - **JSON** — either a document with `tables`, or a flat array of column rows.
 *  - **CSV / TSV** — one row per column, with a header naming the fields.
 *  - **SQL DDL** — `CREATE TABLE … ( … )` statements.
 *  - **YAML** — the same two shapes JSON takes (a `tables` document, or a flat list of column
 *    rows), in block style. See the YAML section below for what "block style" means here and why.
 *
 * Anything else is refused **naming these and what to do about it**, which for the format a
 * dictionary most often arrives in — a spreadsheet — is *export the sheet as CSV*. That is a
 * one-click remedy the reader can carry out, and it is the honest answer: `.xlsx` is a zip of XML
 * and needs a reader of its own (the repo's own profiling ingest is a script for exactly that
 * reason). A parser that accepted the file and found nothing in it would be worse than a refusal:
 * "0 columns" reads as an empty dictionary rather than as a file nobody could read.
 *
 * **It parses format and never semantics.** A `class` a file states is passed through as the string
 * it was, because which classes this app knows is `server.js`'s to say — `CLASS_FACET` and
 * `CLASS_UNFACETED` are the union, and a class outside it has no chip, which `check-docs` asserts
 * across every dataset. Validating it here would be a second copy of that union.
 */

/** The extensions this reads, by the format each maps to. */
export const SCHEMA_FORMATS = {
  '.json': 'json',
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.txt': 'csv',
  '.sql': 'sql',
  '.ddl': 'sql',
  '.yaml': 'yaml',
  '.yml': 'yaml',
}

/** What a refusal names, in the order a reader would try them. */
export const SCHEMA_FORMAT_LIST = '.json, .csv, .tsv, .sql (or .ddl), .txt, .yaml (or .yml)'

const extensionOf = (filename) => {
  const dot = String(filename ?? '').lastIndexOf('.')
  return dot < 0 ? '' : String(filename).slice(dot).toLowerCase()
}

/**
 * The class a SQL type implies — **derived from the type and from nothing else.**
 *
 * A type is a mechanical fact about a column and this reads it as one. What it deliberately does
 * *not* do is guess semantics from a name: `customer_id` looks like an identifier and a dictionary
 * that does not say so has not said so, and `identifier` is the class the relationship suggester
 * matches joins on — so inventing it here would put a suggested join in front of a reviewer on the
 * strength of a naming convention. A file that states a class gets its class; one that does not gets
 * the shape of its type.
 */
export function classForType(type) {
  const t = String(type ?? '').trim().toUpperCase()
  if (/^(INT|INTEGER|INT64|SMALLINT|BIGINT|TINYINT|NUMERIC|BIGNUMERIC|DECIMAL|FLOAT|FLOAT64|DOUBLE|REAL|MONEY)/.test(t)) {
    return 'measure'
  }
  if (/^(DATE|DATETIME|TIMESTAMP|TIME|INTERVAL)/.test(t)) return 'date'
  if (/^(BOOL|BOOLEAN|BIT)/.test(t)) return 'flag'
  /* Everything else is the profiler's own fallback class, which is deliberately unfaceted: a
     `text` column answers to no chip, which is the honest state for a column nothing classified. */
  return 'text'
}

/** A reader-facing refusal. Thrown, because every caller reports it verbatim. */
class SchemaParseError extends Error {}

const fail = (message) => {
  throw new SchemaParseError(message)
}

/* ---------------- delimited text ---------------- */

/**
 * One line of delimited text, RFC 4180 quoting included.
 *
 * Hand-written for the reason `reportExport.js` writes its own CSV: a comma inside a quoted
 * description splits the row and shifts every later field by one, and nothing errors — the column
 * named "Total, net" becomes a column called "Total" with a type of ` net`. This is the reading half
 * of the rule that file states for the writing half.
 */
function splitDelimited(line, delimiter) {
  const out = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      out.push(field)
      field = ''
    } else field += ch
  }
  out.push(field)
  return out.map((f) => f.trim())
}

/**
 * The header names this recognises, folded to one key each.
 *
 * **Generous on the way in and exact on the way out.** A dictionary exported from a spreadsheet
 * calls the column "Column Name", "Field", "COLUMN_NAME" or "name" depending on who wrote it, and
 * refusing four of those five would be a parser that only reads files it wrote itself. Case,
 * spaces, underscores and hyphens are all folded, so the five are one key.
 */
const HEADER_ALIASES = {
  dataset: 'dataset',
  datasetid: 'dataset',
  schema: 'dataset',
  table: 'table',
  tableid: 'table',
  tablename: 'table',
  entity: 'table',
  column: 'column',
  columnid: 'column',
  columnname: 'column',
  field: 'column',
  fieldname: 'column',
  name: 'column',
  type: 'type',
  datatype: 'type',
  columntype: 'type',
  sqltype: 'type',
  description: 'description',
  comment: 'description',
  definition: 'description',
  meaning: 'description',
  class: 'class',
  semanticclass: 'class',
  category: 'class',
  pii: 'pii',
  sensitive: 'pii',
  label: 'label',
  displayname: 'label',
  tablelabel: 'tablelabel',
  grain: 'grain',
  tablegrain: 'grain',
}

const foldHeader = (raw) =>
  HEADER_ALIASES[String(raw).toLowerCase().replace(/[\s_\-.]/g, '')] ?? null

/** `true`/`yes`/`y`/`1` is true; everything else, including blank, is false. */
const readBoolean = (raw) => /^(true|yes|y|1)$/i.test(String(raw ?? '').trim())

function parseDelimited(text, delimiter, formatName) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length === 0) fail(`this ${formatName} file is empty.`)

  const header = splitDelimited(lines[0], delimiter).map(foldHeader)
  if (!header.includes('table') || !header.includes('column')) {
    fail(
      `this ${formatName} file needs a header naming at least a table and a column — ` +
        `found ${splitDelimited(lines[0], delimiter).join(', ') || '(nothing)'}. ` +
        'One row per column: table, column, type, description, class, pii.',
    )
  }

  const at = (row, key) => {
    const i = header.indexOf(key)
    return i < 0 ? '' : (row[i] ?? '')
  }

  const byTable = new Map()
  let datasetId = null
  lines.slice(1).forEach((line, i) => {
    const row = splitDelimited(line, delimiter)
    const tableId = at(row, 'table')
    const columnId = at(row, 'column')
    /* The row number a reader sees in their editor: the header is line 1. */
    const lineNo = i + 2
    if (!tableId) fail(`line ${lineNo} names no table.`)
    if (!columnId) fail(`line ${lineNo} names no column, on table ${tableId}.`)
    datasetId = datasetId || at(row, 'dataset') || null

    if (!byTable.has(tableId)) {
      byTable.set(tableId, {
        table_id: tableId,
        label: at(row, 'tablelabel') || null,
        grain: at(row, 'grain') || null,
        columns: [],
      })
    }
    const table = byTable.get(tableId)
    /* A later row may carry the table's own label or grain — a dictionary often states them once,
       on the first row of each table, and often on a row further down. First non-empty wins. */
    table.label = table.label || at(row, 'tablelabel') || null
    table.grain = table.grain || at(row, 'grain') || null
    table.columns.push({
      column_id: columnId,
      label: at(row, 'label') || null,
      type: at(row, 'type') || null,
      class: at(row, 'class') || null,
      description: at(row, 'description') || '',
      pii: readBoolean(at(row, 'pii')),
    })
  })

  return { format: formatName, dataset_id: datasetId, tables: [...byTable.values()] }
}

/* ---------------- JSON ---------------- */

const firstString = (row, keys) => {
  for (const key of keys) {
    const value = row?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function jsonColumn(raw, tableId, index) {
  /* A bare string is a column name — the shortest form a schema list takes, and refusing it would
     mean refusing `{"tables":[{"table":"x","columns":["a","b"]}]}`, which is a schema. */
  if (typeof raw === 'string') {
    return {
      column_id: raw.trim(),
      label: null,
      type: null,
      class: null,
      description: '',
      pii: false,
    }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`column ${index + 1} of ${tableId} is not an object or a name.`)
  }
  const columnId = firstString(raw, ['column_id', 'column', 'column_name', 'name', 'field'])
  if (!columnId) fail(`column ${index + 1} of ${tableId} names no column.`)
  return {
    column_id: columnId,
    label: firstString(raw, ['label', 'display_name']),
    type: firstString(raw, ['type', 'data_type', 'column_type', 'sql_type']),
    class: firstString(raw, ['class', 'semantic_class', 'category']),
    description: firstString(raw, ['description', 'comment', 'definition']) ?? '',
    pii: readBoolean(raw.pii ?? raw.sensitive),
  }
}

/**
 * A parsed value — from `JSON.parse` or from `parseYamlValue` — walked into `{ tables }`.
 *
 * **One walk for both formats, because it is the same shape either way.** JSON and YAML differ in
 * how the text turns into objects and arrays; once it has, "a document naming `tables`" and "a flat
 * array of column rows" mean the same thing whichever format wrote them, so a dictionary exported
 * either way lands identically. `formatName` is only for the messages this throws.
 */
function docToTables(doc, formatName) {
  /*
   * A bare array is the flat form: one entry per column, each naming its table. The same shape the
   * delimited reader produces, which is why a dictionary exported either way lands identically.
   */
  if (Array.isArray(doc)) {
    const byTable = new Map()
    let datasetId = null
    doc.forEach((row, i) => {
      if (row === null || typeof row !== 'object') fail(`entry ${i + 1} is not an object.`)
      const tableId = firstString(row, ['table_id', 'table', 'table_name', 'entity'])
      if (!tableId) fail(`entry ${i + 1} names no table.`)
      datasetId = datasetId || firstString(row, ['dataset_id', 'dataset', 'schema'])
      if (!byTable.has(tableId)) {
        byTable.set(tableId, {
          table_id: tableId,
          label: firstString(row, ['table_label']),
          grain: firstString(row, ['grain']),
          columns: [],
        })
      }
      const table = byTable.get(tableId)
      table.label = table.label || firstString(row, ['table_label'])
      table.grain = table.grain || firstString(row, ['grain'])
      table.columns.push(jsonColumn(row, tableId, i))
    })
    return { format: formatName, dataset_id: datasetId, tables: [...byTable.values()] }
  }

  if (doc === null || typeof doc !== 'object') {
    fail(`this ${formatName.toUpperCase()} is not an object or an array.`)
  }

  const rawTables = doc.tables ?? doc.entities
  if (!Array.isArray(rawTables)) {
    fail(
      `this ${formatName.toUpperCase()} has no "tables" array. Either { "dataset": "…", "tables": ` +
        '[ { "table": "…", "columns": [ … ] } ] }, or a flat array with a "table" on every column row.',
    )
  }
  const tables = rawTables.map((raw, i) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      fail(`table ${i + 1} is not an object.`)
    }
    const tableId = firstString(raw, ['table_id', 'table', 'table_name', 'name', 'entity'])
    if (!tableId) fail(`table ${i + 1} names no table.`)
    const columns = raw.columns ?? raw.fields
    if (!Array.isArray(columns) || columns.length === 0) {
      fail(`table ${tableId} lists no columns.`)
    }
    return {
      table_id: tableId,
      label: firstString(raw, ['label', 'table_label', 'display_name']),
      grain: firstString(raw, ['grain', 'grain_description']),
      columns: columns.map((c, j) => jsonColumn(c, tableId, j)),
    }
  })
  return {
    format: formatName,
    dataset_id: firstString(doc, ['dataset_id', 'dataset', 'schema']),
    tables,
  }
}

function parseJson(text) {
  let doc
  try {
    doc = JSON.parse(text)
  } catch (error) {
    fail(`this is not valid JSON — ${error.message}`)
  }
  return docToTables(doc, 'json')
}

/* ---------------- SQL DDL ---------------- */

/**
 * `CREATE TABLE` statements, read for their column names, types and comments.
 *
 * Deliberately a **shallow** read: it takes the identifier and the type off each line inside the
 * parens and a `COMMENT '…'` or a trailing `--` where one is there. What it does not do is parse
 * SQL — constraints, keys, partitioning and options are skipped by name rather than understood,
 * because a dictionary is what this is for and a DDL is the form it sometimes arrives in.
 */
/**
 * A `--` comment folded onto the column it is written beside, as a `COMMENT` clause.
 *
 * **This is the fix for a real parse fault, and the fault is worth stating.** Column definitions are
 * split on commas, and a comment sits *after* the comma that ends its own column:
 *
 *     period DATE, -- calendar month
 *     amount NUMERIC(18,2),
 *
 * split naively gives `period DATE` and then `-- calendar month\n amount NUMERIC(18,2)` — whose
 * first token is `--`, so the reader produced a column literally named `--` with the type `calendar`
 * **and lost `amount` entirely**. A column silently missing from a dictionary is exactly the
 * plausible-nonsense failure this module is arranged to avoid.
 *
 * So the comment is moved to the left of the comma, into the clause the same reader already handles
 * — one code path for both comment styles rather than two. A whole-line comment is **dropped**: in a
 * hand-written DDL it is as often a section header or a note about the *next* column as about the
 * previous one, and attaching it to either would be a guess printed as a description.
 */
function foldSqlComments(body) {
  return body
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--')
      if (at < 0) return line
      const comment = line.slice(at + 2).trim()
      let code = line.slice(0, at).trim()
      if (code === '') return ''
      const hadComma = code.endsWith(',')
      if (hadComma) code = code.slice(0, -1)
      if (comment === '') return `${code}${hadComma ? ',' : ''}`
      /* Only where the line does not already carry one — a definition with both is not two
         descriptions, and the clause the author wrote explicitly wins. */
      if (/COMMENT\s+'/i.test(code)) return `${code}${hadComma ? ',' : ''}`
      return `${code} COMMENT '${comment.replace(/'/g, "''")}'${hadComma ? ',' : ''}`
    })
    .join('\n')
}

function parseSql(text) {
  /* Block comments first, so a commented-out CREATE TABLE is not read as a table. */
  const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const statements = [
    ...cleaned.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?(?:EXTERNAL\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w.$-]+)\s*\(([\s\S]*?)\)\s*(?:;|$)/gi,
    ),
  ]
  if (statements.length === 0) {
    fail('no CREATE TABLE statement in this file.')
  }

  /* Constraint and key lines, skipped by their leading word rather than parsed. */
  const notAColumn =
    /^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|KEY|INDEX|CHECK|PARTITION|CLUSTER|OPTIONS|WITH)\b/i

  let datasetId = null
  const tables = statements.map(([, rawName, body]) => {
    const parts = rawName.replace(/[`"[\]]/g, '').split('.')
    const tableId = parts[parts.length - 1]
    /* `dataset.table` or `project.dataset.table` — the segment before the table is the dataset. */
    if (parts.length > 1) datasetId = datasetId || parts[parts.length - 2]

    /*
     * Split on commas that separate column definitions — **not on the ones inside parentheses, and
     * not on the ones inside a quoted comment.**
     *
     * The parens half is `NUMERIC(12, 2)`, which is obvious. The quotes half was a real fault found
     * by running this: `amount NUMERIC(18,2), -- dollars, unrounded` folds to a `COMMENT 'dollars,
     * unrounded'` clause, whose comma is at depth 0 — so the definition split in half, the
     * `COMMENT '` had no closing quote for the reader below to match, and the column landed with
     * **no description at all** while a fragment named ` unrounded'` was skipped in silence. The same
     * shape as the CSV rule one function up: a comma inside a quoted field is not a separator.
     */
    const lines = []
    let depth = 0
    let quoted = false
    let current = ''
    const folded = foldSqlComments(body)
    for (let i = 0; i < folded.length; i += 1) {
      const ch = folded[i]
      if (quoted) {
        current += ch
        if (ch === "'") {
          /* `''` is an escaped quote inside the string, not the end of it. */
          if (folded[i + 1] === "'") {
            current += "'"
            i += 1
          } else quoted = false
        }
        continue
      }
      if (ch === "'") {
        quoted = true
        current += ch
        continue
      }
      if (ch === '(') depth += 1
      if (ch === ')') depth -= 1
      if (ch === ',' && depth === 0) {
        lines.push(current)
        current = ''
      } else current += ch
    }
    lines.push(current)

    const columns = []
    for (const raw of lines) {
      const line = raw.trim()
      if (line === '' || notAColumn.test(line)) continue
      const match = /^([`"[\]\w$-]+)\s+([A-Za-z][\w]*(?:\s*\([^)]*\))?)/.exec(line)
      if (!match) continue
      /* One source for the description now: `foldSqlComments` has already turned a `--` into this
         clause, so a second branch reading `--` would be a path nothing can reach. */
      const comment =
        /COMMENT\s+'((?:[^']|'')*)'/i.exec(line)?.[1]?.replace(/''/g, "'") ?? ''
      columns.push({
        column_id: match[1].replace(/[`"[\]]/g, ''),
        label: null,
        type: match[2].replace(/\s+/g, ''),
        class: null,
        description: comment.trim(),
        pii: false,
      })
    }
    if (columns.length === 0) fail(`CREATE TABLE ${tableId} declares no columns this can read.`)
    return { table_id: tableId, label: null, grain: null, columns }
  })

  return { format: 'sql', dataset_id: datasetId, tables }
}

/* ---------------- YAML ---------------- */

/**
 * Block-style YAML — mappings, sequences and scalars, nested by indentation — read into the same
 * plain-object shape `JSON.parse` gives, then walked by the **same** `docToTables` the JSON reader
 * uses. A schema exported to YAML states the same two shapes JSON does — a document naming
 * `tables`, or a flat list of column rows — so there is no second table/column reader to keep in
 * step with the first; only the text-to-value step differs.
 *
 * **Deliberately not a general YAML engine.** No dependency, on purpose — `backend/` ships zero
 * runtime dependencies, so a YAML library is off the table for one upload screen, the same argument
 * `parseSql`'s hand-written DDL reader and `splitDelimited`'s hand-written CSV reader already make.
 * And no *need* for one: this reads block mappings, block sequences and plain or quoted scalars,
 * because that is everything the two shapes above are built from. Flow style (`[a, b]`, `{a: b}`),
 * anchors, tags, multi-document streams and folded/literal block scalars (`|`, `>`) are refused
 * rather than guessed at — naming the block-style shape this does read, the same remedy the DDL
 * reader gives for a construct it does not parse.
 *
 * **Only a whole-line comment is dropped.** Telling an inline `# comment` apart from a `#` inside an
 * unquoted description needs a real tokenizer this is deliberately not; a dictionary's own text
 * keeping a stray `#` is a far smaller fault than a description silently losing its second half.
 */
function yamlLines(text) {
  const out = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return
    if (trimmed === '---' || trimmed === '...') return
    if (/^\t/.test(line)) fail(`line ${i + 1} is indented with a tab — YAML needs spaces.`)
    const indent = /^ */.exec(line)[0].length
    out.push({ indent, content: line.slice(indent), lineNo: i + 1 })
  })
  return out
}

/** One scalar's text into a value — quoted, boolean, null, or the plain string it is. */
function yamlScalar(raw) {
  const s = raw.trim()
  if (s === '' || s === '~' || /^null$/i.test(s)) return null
  if (/^"(?:[^"\\]|\\.)*"$/.test(s)) {
    return s.slice(1, -1).replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
  }
  if (/^'(?:[^']|'')*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'")
  if (/^(true|yes)$/i.test(s)) return true
  if (/^(false|no)$/i.test(s)) return false
  if (/^[[{]/.test(s)) {
    fail(
      `"${s}" uses flow-style YAML ([ ] or { }) — this reads block style only: one item per ` +
        'line, indented under its key.',
    )
  }
  return s
}

/** A mapping key, quoted or bare, folded to its plain text — the same key a JSON reader gets. */
function yamlKey(raw) {
  const k = raw.trim()
  if (/^".*"$/.test(k) || /^'.*'$/.test(k)) return k.slice(1, -1)
  return k
}

function parseYamlValue(text) {
  const lines = yamlLines(text)
  if (lines.length === 0) fail('this YAML file is empty.')
  let pos = 0
  const isSeqLine = (l) => l.content === '-' || l.content.startsWith('- ')
  const mapKeyLine = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:#]+):(\s+(.*)|)$/

  function parseBlock(minIndent) {
    if (pos >= lines.length || lines[pos].indent < minIndent) return null
    const at = lines[pos].indent
    return isSeqLine(lines[pos]) ? parseSeq(at) : parseMap(at)
  }

  function parseSeq(indent) {
    const arr = []
    while (pos < lines.length && lines[pos].indent === indent && isSeqLine(lines[pos])) {
      const line = lines[pos]
      const rest = line.content === '-' ? '' : line.content.slice(2)
      pos += 1
      if (rest === '') {
        arr.push(parseBlock(indent + 1))
        continue
      }
      /* "- key: value" opens a mapping whose first pair is on this line; further pairs, where
         there are any, follow indented to line up with where that key started — which is what
         a block sequence of mappings looks like in every YAML export this is for. A synthetic
         line carries that first pair back into `parseMap` rather than duplicating its logic. */
      if (mapKeyLine.test(rest)) {
        const itemIndent = indent + 2
        lines.splice(pos, 0, { indent: itemIndent, content: rest, lineNo: line.lineNo })
        arr.push(parseMap(itemIndent))
      } else {
        arr.push(yamlScalar(rest))
      }
    }
    return arr
  }

  function parseMap(indent) {
    const obj = {}
    while (pos < lines.length && lines[pos].indent === indent && !isSeqLine(lines[pos])) {
      const line = lines[pos]
      const match = mapKeyLine.exec(line.content)
      if (!match) fail(`line ${line.lineNo} is not "key: value" — found "${line.content}".`)
      const key = yamlKey(match[1])
      const valueText = (match[3] ?? '').trim()
      pos += 1
      obj[key] = valueText === '' ? parseBlock(indent + 1) : yamlScalar(valueText)
    }
    return obj
  }

  const doc = parseBlock(lines[0].indent)
  if (pos < lines.length) {
    fail(`line ${lines[pos].lineNo} does not fit under what came before it — check the indentation.`)
  }
  return doc
}

function parseYaml(text) {
  const doc = parseYamlValue(text)
  return docToTables(doc, 'yaml')
}

/* ---------------- the one entry point ---------------- */

/**
 * Reads one uploaded file into `{ format, dataset_id, tables }`.
 *
 * Throws with a **reader-facing sentence** rather than returning a partial parse: a file that was
 * half understood produces a dictionary that is half wrong, and the whole point of the preview step
 * above this is that nothing lands until somebody has seen what was read.
 */
export function parseSchemaDocument({ filename, text }) {
  const extension = extensionOf(filename)
  const format = SCHEMA_FORMATS[extension]
  if (!format) {
    fail(
      `${extension || 'a file with no extension'} is not a format this reads. ` +
        `It reads ${SCHEMA_FORMAT_LIST}. ` +
        'A spreadsheet is the usual case — export the sheet as CSV and upload that; ' +
        '.xlsx is a zip of XML and needs a reader of its own.',
    )
  }
  if (typeof text !== 'string' || text.trim() === '') {
    fail(`${filename} is empty.`)
  }

  const parsed =
    format === 'json'
      ? parseJson(text)
      : format === 'sql'
        ? parseSql(text)
        : format === 'yaml'
          ? parseYaml(text)
          : parseDelimited(text, format === 'tsv' ? '\t' : ',', format)

  if (parsed.tables.length === 0) fail(`${filename} declares no tables.`)
  for (const table of parsed.tables) {
    if (table.columns.length === 0) fail(`${table.table_id} declares no columns.`)
    const seen = new Set()
    for (const column of table.columns) {
      if (seen.has(column.column_id)) {
        /* A duplicate would collide in the dictionary and in `column_notes`, which is keyed
           `dataset.table.column` — and `check-docs` asserts ids are unique per table. */
        fail(`${table.table_id} declares ${column.column_id} twice.`)
      }
      seen.add(column.column_id)
    }
  }
  return parsed
}
