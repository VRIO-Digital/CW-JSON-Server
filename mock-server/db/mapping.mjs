/*
 * ============================================================================
 *  The mapper — a document in, rows out, and the same document back
 * ============================================================================
 *
 * `toRows(document)` flattens `db.json` into `{ [table]: rows[] }`. `fromRows(rows)`
 * rebuilds the document. Nothing here imports `pg`, and that is deliberate: the risky
 * half of moving this app onto PostgreSQL is the *shape*, not the SQL, and a pure
 * mapper can be proved without a database running.
 *
 * The proof is one assertion, and it is the one that matters:
 *
 *     deepEqual(fromRows(toRows(db)), db)
 *
 * `npm run db:verify` runs it against the real `mock-server/db.json` — 25 top-level
 * keys, 189 canvas nodes, 206 column profiles, 40 written answers — and prints the
 * first differing path rather than "not equal". A mapper that loses `tone` on one
 * stat row out of four does not throw anywhere; it renders a chip with no colour, and
 * the only way to catch it is to compare the documents.
 *
 * ---------------------------------------------------------------------------
 *  Column order, and why it is fixed
 * ---------------------------------------------------------------------------
 *
 * Every table's columns are laid out in one order, derived from the spec:
 *
 *     [singleton] [map key] [derived key parts] [parent keys] [ordinal] [data …]
 *
 * so the DDL, the INSERT and the row objects cannot disagree about position. `ordinal`
 * carries the array index: JSON arrays are ordered and rows are not, and an answer
 * read out of order is a different answer.
 */

import { ROOTS, DOC_BLOBS, SCHEMA } from './model.mjs'

const jsonKey = (c) => c.json ?? c.name

/* ---------------------------------------------------------------------------
 *  prepare() — annotate every spec with its full column list and its parent
 *
 *  Run once at import. `_columns` is what the DDL writer, the mapper and the loader
 *  all read, so "what columns does this table have" has exactly one answer.
 * ------------------------------------------------------------------------- */

function prepare() {
  const byTable = new Map()

  const walk = (spec, parentSpec, root) => {
    spec._parent = parentSpec ?? null
    spec._root = root

    const columns = []
    if (spec.singletonCol) {
      columns.push({ name: spec.singletonCol, type: 'integer', role: 'singleton' })
    }
    if (spec.keyCol) columns.push({ name: spec.keyCol, type: 'text', role: 'key' })
    for (const c of spec.keyCols ?? []) columns.push({ ...c, role: 'keyDerived' })

    for (const name of spec.parent ?? []) {
      /* The parent's own definition of the column, so a type cannot be re-guessed here. */
      const from = parentSpec?._columns.find((c) => c.name === name)
      if (!from) {
        throw new Error(
          `mock-server/db/model.mjs: table "${spec.table}" inherits "${name}" from its parent ` +
            `"${parentSpec?.table ?? '(none)'}", which has no such column`,
        )
      }
      columns.push({ name, type: from.type, role: 'parent' })
    }

    if (spec.ordinal) columns.push({ name: 'ordinal', type: 'integer', role: 'ordinal' })
    for (const c of spec.cols) columns.push({ ...c, role: 'data' })

    spec._columns = columns
    spec._data = columns.filter((c) => c.role === 'data')

    if (byTable.has(spec.table)) {
      throw new Error(`mock-server/db/model.mjs: two tables are both named "${spec.table}"`)
    }
    byTable.set(spec.table, spec)

    for (const child of spec.children ?? []) walk(child.spec, spec, root)
  }

  for (const root of ROOTS) if (root.spec) walk(root.spec, null, root)

  DOC_BLOBS._columns = DOC_BLOBS.cols.map((c) => ({ ...c, role: 'data' }))
  DOC_BLOBS._data = DOC_BLOBS._columns
  DOC_BLOBS._parent = null
  byTable.set(DOC_BLOBS.table, DOC_BLOBS)

  return byTable
}

export const SPECS = prepare()

/** Every table, parents before children — CREATE, INSERT and DELETE order all read it. */
export function tableOrder() {
  const out = []
  const walk = (spec) => {
    out.push(spec)
    for (const child of spec.children ?? []) walk(child.spec)
  }
  for (const root of ROOTS) if (root.spec) walk(root.spec)
  out.push(DOC_BLOBS)
  return out
}

/* ---------------------------------------------------------------------------
 *  Reading and writing a nested path
 * ------------------------------------------------------------------------- */

function readPath(doc, path) {
  let node = doc
  for (const part of path.split('.')) {
    if (node === undefined || node === null) return undefined
    node = node[part]
  }
  return node
}

function writePath(doc, path, value) {
  const parts = path.split('.')
  let node = doc
  for (const part of parts.slice(0, -1)) {
    if (node[part] === undefined) node[part] = {}
    node = node[part]
  }
  node[parts[parts.length - 1]] = value
}

/* ---------------------------------------------------------------------------
 *  document → rows
 * ------------------------------------------------------------------------- */

/**
 * One JSON item → one row, plus its children's rows.
 *
 * `fixed` carries the values this row inherits — the singleton 1, a map key and its
 * split parts, the parent's key — so a child row can always be found again by the
 * parent key alone.
 */
function itemToRow(spec, item, fixed, ordinal, out) {
  const row = {}
  for (const c of spec._columns) {
    if (c.role === 'ordinal') {
      row.ordinal = ordinal
    } else if (c.role === 'data') {
      if (spec.scalar) {
        /* A bare string in the document — the whole item is this one column. */
        row[c.name] = item
      } else if (spec.whole) {
        row[c.name] = item
      } else {
        const v = item[jsonKey(c)]
        row[c.name] = v === undefined ? null : v
      }
    } else {
      row[c.name] = fixed[c.name]
    }
  }

  ;(out[spec.table] ??= []).push(row)

  const childFixed = {}
  for (const c of spec._columns) {
    if (c.role !== 'ordinal' && c.role !== 'data') childFixed[c.name] = row[c.name]
    else if (c.role === 'data') childFixed[c.name] = row[c.name]
  }

  for (const child of spec.children ?? []) {
    const list = item[child.json]
    if (!Array.isArray(list)) continue
    list.forEach((sub, n) => itemToRow(child.spec, sub, childFixed, n, out))
  }

  return row
}

/** Flatten the whole document. Returns `{ [table]: rows[] }`, every table present. */
export function toRows(doc) {
  const out = {}
  for (const spec of tableOrder()) out[spec.table] = []

  for (const root of ROOTS) {
    const value = readPath(doc, root.path)

    if (root.kind === 'blob') {
      out[DOC_BLOBS.table].push({ path: root.path, value: value === undefined ? null : value })
      continue
    }
    if (value === undefined || value === null) continue

    const spec = root.spec
    const base = spec.singletonCol ? { [spec.singletonCol]: 1 } : {}

    if (root.kind === 'array') {
      value.forEach((item, n) => itemToRow(spec, item, base, n, out))
    } else if (root.kind === 'singleton') {
      itemToRow(spec, value, base, 0, out)
    } else if (root.kind === 'map') {
      Object.entries(value).forEach(([key, list], k) => {
        const fixed = { ...base, [spec.keyCol]: key, ...(spec.splitKey?.(key) ?? {}) }
        list.forEach((item, n) => itemToRow(spec, item, fixed, n, out))
        void k
      })
    } else if (root.kind === 'mapObject') {
      Object.entries(value).forEach(([key, item], n) => {
        const fixed = { ...base, [spec.keyCol]: key, ...(spec.splitKey?.(key) ?? {}) }
        itemToRow(spec, item, fixed, n, out)
      })
    } else {
      throw new Error(`mock-server/db/model.mjs: "${root.path}" has unknown kind "${root.kind}"`)
    }
  }

  return out
}

/* ---------------------------------------------------------------------------
 *  rows → document
 * ------------------------------------------------------------------------- */

const byOrdinal = (rows) => [...rows].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))

/** Index a child table's rows by the parent key they carry. */
function indexByParent(spec, rows) {
  const keys = spec.parent ?? []
  const index = new Map()
  for (const row of rows) {
    const k = keys.map((name) => row[name]).join(' ')
    if (!index.has(k)) index.set(k, [])
    index.get(k).push(row)
  }
  return index
}

function rowToItem(spec, row, indexes) {
  if (spec.scalar) return row[spec.scalar]
  if (spec.whole) return row[spec._data[0].name]

  const item = {}
  for (const c of spec._data) {
    const v = row[c.name]
    /* An optional key that is NULL stays *absent*: `{ tone: null }` is a different
       document from `{}`, and both `validateDb` and the client schemas read presence. */
    if (c.optional && (v === null || v === undefined)) continue
    item[jsonKey(c)] = v === undefined ? null : v
  }

  for (const child of spec.children ?? []) {
    const index = indexes.get(child.spec.table)
    const k = (child.spec.parent ?? []).map((name) => row[name]).join(' ')
    const kids = byOrdinal(index.get(k) ?? [])
    item[child.json] = kids.map((r) => rowToItem(child.spec, r, indexes))
  }

  return item
}

/**
 * Rebuild the document.
 *
 * `tables` is `{ [table]: rows[] }` — exactly what `toRows` produces and exactly what
 * a `SELECT *` per table gives back.
 */
export function fromRows(tables) {
  const indexes = new Map()
  for (const spec of tableOrder()) {
    if (spec._parent) indexes.set(spec.table, indexByParent(spec, tables[spec.table] ?? []))
  }

  const doc = {}

  for (const root of ROOTS) {
    if (root.kind === 'blob') {
      const row = (tables[DOC_BLOBS.table] ?? []).find((r) => r.path === root.path)
      if (row) writePath(doc, root.path, row.value)
      continue
    }

    const spec = root.spec
    const rows = byOrdinal(tables[spec.table] ?? [])

    if (root.kind === 'array') {
      writePath(doc, root.path, rows.map((r) => rowToItem(spec, r, indexes)))
    } else if (root.kind === 'singleton') {
      if (rows.length > 0) writePath(doc, root.path, rowToItem(spec, rows[0], indexes))
    } else if (root.kind === 'map') {
      const map = {}
      for (const r of rows) (map[r[spec.keyCol]] ??= []).push(rowToItem(spec, r, indexes))
      writePath(doc, root.path, map)
    } else if (root.kind === 'mapObject') {
      const map = {}
      for (const r of rows) map[r[spec.keyCol]] = rowToItem(spec, r, indexes)
      writePath(doc, root.path, map)
    }
  }

  return doc
}

/* ---------------------------------------------------------------------------
 *  The difference report
 *
 *  "documents are not equal" is not actionable on a 450 KB document. This names the
 *  first paths that differ and what each side holds, because the mistakes this catches
 *  are all one key wide — a `tone` that became null, a `distinct` that came back a
 *  string, an array that lost its order.
 * ------------------------------------------------------------------------- */

export function diff(a, b, path = '', out = [], limit = 12) {
  if (out.length >= limit) return out

  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)
  if (kind(a) !== kind(b)) {
    out.push(`${path || '(root)'}: ${kind(a)} became ${kind(b)}`)
    return out
  }

  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      out.push(`${path}: ${a.length} item(s) became ${b.length}`)
      return out
    }
    for (let n = 0; n < a.length; n += 1) diff(a[n], b[n], `${path}[${n}]`, out, limit)
    return out
  }

  if (a !== null && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      const at = path ? `${path}.${k}` : k
      if (!(k in a)) out.push(`${at}: absent, but the rebuilt document has ${JSON.stringify(b[k])}`)
      else if (!(k in b)) out.push(`${at}: ${JSON.stringify(a[k])}, but the rebuilt document omits it`)
      else diff(a[k], b[k], at, out, limit)
      if (out.length >= limit) return out
    }
    return out
  }

  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} became ${JSON.stringify(b)}`)
  return out
}

export { SCHEMA }
