import type {
  DgbEntity,
  DgbRelation,
  SgbGraph,
  TypeLink,
} from '../api/client'
import type { RawGraph, RawLink, RawNode } from '../graph-viewer/types'

/**
 * The two lanes, in the shape the vendored viewer reads.
 *
 * **One viewer, three frames.** The studio draws a structured canvas, a document canvas and a
 * combined one, and all three render `src/graph-viewer` — the same folder the old studio's canvas
 * used. A second force-graph was the obvious alternative and is the thing this repo refuses
 * everywhere else: two drawings of one graph are two answers to what it looks like, and the one that
 * is not being looked at is the one that goes wrong. What differs between the three frames is the
 * *graph handed in*, which is what these functions build.
 *
 * **Pure, and here rather than in a component, for the reason `datasetPathFix` is.** A mapping written
 * inside a canvas tab can only be asserted by rendering the tab — and `renderToString` gives a
 * zustand-driven component its initial state, in which no lane has loaded, so a test written that way
 * would pass over an empty graph and prove nothing.
 *
 * Nothing below invents a field. Every value is a rename, or a sentence assembled from values the
 * payload already carries.
 */

/** A column list as a node's detail line, capped, **with the cap stated.** A table here can carry
 *  ninety columns and a silent truncation is the failure this repo refuses everywhere. */
const COLUMNS_SHOWN = 6

const columnSummary = (names: string[]): string | undefined => {
  if (names.length === 0) return undefined
  const shown = names.slice(0, COLUMNS_SHOWN).join(', ')
  return names.length > COLUMNS_SHOWN
    ? `${shown} … and ${names.length - COLUMNS_SHOWN} more`
    : shown
}

/**
 * The structured lane: **tables and the concepts their columns realise.**
 *
 * Columns are deliberately *not* nodes. The lane's own build count already excludes them, for the
 * reason stated there — the drawing folds a column into its table — and 206 column discs around five
 * tables is a hairball that says less than the five tables do. Each table states its columns as its
 * detail line instead, capped and saying so.
 *
 * Two edge kinds survive the fold. `REALISES` and `DESCRIBES` run column → concept in the payload, so
 * they are collapsed to **table → concept** and de-duplicated: the same table describing one concept
 * through nine columns is one relationship, drawn once, with the count on it. `FK_TO` runs column →
 * column and collapses to table → table the same way. `HAS_COLUMN` and `COVERS` are not drawn at all,
 * because both ends of the first are folded into one node and the second is the story group, which is
 * prose rather than a thing on a canvas.
 */
export function fromSgbGraph(graph: SgbGraph): RawGraph {
  const columnsByTable = new Map<string, string[]>()
  for (const column of graph.columns) {
    const list = columnsByTable.get(column.tableRef) ?? []
    list.push(column.columnName)
    columnsByTable.set(column.tableRef, list)
  }

  const nodes: RawNode[] = [
    ...graph.tables.map((table) => ({
      id: table.tableRef,
      type: 'Table',
      element_class: 'thin_instance' as const,
      label: table.tableName,
      entity_type: 'Table',
      /* The tenant's own label for the view, where it states one — `comment` is the Catalog's
         `label`, which is what a reader recognises the table by. */
      subtype: table.comment ?? undefined,
      /* Where the node came from, which is what the viewer's provenance line is for. A node whose
         provenance is not on it is a claim the reader has to take on trust. */
      provenance: `${table.sourceId} · ${table.schemaName ?? ''}`.replace(/ · $/, ''),
      l2: columnSummary(columnsByTable.get(table.tableRef) ?? []),
      /* Measured or absent. `?? 0` here would say a table is empty when nobody has counted it — the
         `rows: num` pitfall this repo has been bitten by twice. */
      members: table.rowCountEstimate ?? undefined,
    })),
    ...graph.concepts.map((concept) => ({
      id: concept.conceptRef,
      type: 'Concept',
      element_class: 'concept' as const,
      label: concept.name,
      definition: concept.description ?? undefined,
      /* Whether the use case's own brief names this concept, or only the canvas carries it. */
      subtype: concept.declared ? 'declared by the brief' : 'discovered',
    })),
  ]

  const known = new Set(nodes.map((n) => n.id))
  const tableOf = new Map(graph.columns.map((c) => [c.columnRef, c.tableRef]))

  /* Collapsed edges, counted: one relationship per (table, concept) pair, carrying how many columns
     asserted it. A drawing with nine identical lines between two discs says less than one line does. */
  const folded = new Map<string, RawLink & { n: number }>()
  const fold = (source: string, target: string, label: string, detail: string) => {
    if (!known.has(source) || !known.has(target) || source === target) return
    const key = `${source}|${target}|${label}`
    const existing = folded.get(key)
    if (existing) {
      existing.n += 1
      existing.provenance = `${existing.n} columns · ${detail}`
      return
    }
    folded.set(key, { source, target, label, provenance: detail, n: 1 })
  }

  for (const edge of graph.edges) {
    if (edge.edgeType === 'REALISES' || edge.edgeType === 'DESCRIBES') {
      const from = tableOf.get(edge.srcRef)
      if (from) fold(from, edge.dstRef, edge.edgeType, '1 column')
    } else if (edge.edgeType === 'FK_TO') {
      const from = tableOf.get(edge.srcRef)
      const to = tableOf.get(edge.dstRef)
      if (from && to) fold(from, to, 'FK_TO', 'declared join')
    }
  }

  return {
    nodes,
    links: [...folded.values()].map(({ n: _n, ...link }) => link),
  }
}

/**
 * The document lane: **the documents, and what each was found to be about.**
 *
 * Both kinds are read rather than synthesised — the corpus states its documents and the extraction
 * map states what each resolved to. Two documents about one facility share a node, which is entity
 * resolution rather than duplication and is the single most important thing this lane demonstrates;
 * the mention count on the shared node is what says so.
 */
export function fromDgbGraph(entities: DgbEntity[], relations: DgbRelation[]): RawGraph {
  const nodes: RawNode[] = entities.map((entity) => ({
    id: entity.entityId,
    type: entity.entityType,
    element_class: 'thin_instance' as const,
    label: entity.canonicalName,
    entity_type: entity.entityType,
    /* A document's filing label, or — for a resolved entity — what the extractor called it before
       resolution. Both are the data's own words. */
    subtype: entity.resolvedType ?? undefined,
    members: entity.mentionCount,
    l2:
      entity.aliases.length > 0
        ? `also extracted as: ${entity.aliases.join(', ')}`
        : undefined,
  }))

  const known = new Set(nodes.map((n) => n.id))
  const links: RawLink[] = relations
    .filter((r) => known.has(r.subjectEntityId) && known.has(r.objectEntityId))
    .map((r) => ({
      source: r.subjectEntityId,
      target: r.objectEntityId,
      label: r.relationType,
      /* The extractor's own confidence where it stated one, and nothing where it did not — a number
         invented here would be this app scoring somebody else's assertion. */
      provenance:
        r.confidence !== null ? `extraction confidence ${r.confidence.toFixed(2)}` : undefined,
    }))

  return { nodes, links }
}

/**
 * Both lanes on one canvas, with the Bridge drawn between them.
 *
 * **The two graphs are still two graphs.** Nothing is merged: no node is rewritten, no entity is
 * resolved across the seam, and both lanes keep their own ids. What is added is the Bridge's own
 * claim — an `identity` or `attribute` correspondence between a document entity type and a structured
 * concept — drawn from each entity of that type to the concept it corresponds with.
 *
 * **Only decided, non-reject links are drawn.** A reject asserts nothing, so drawing it would put a
 * line on the canvas for a correspondence somebody declined; and an undecided row is a *proposal*,
 * which is the one thing a reviewer must not mistake for a fact — it stays off the drawing until the
 * Bridge tab has been through.
 */
export function fromCombined(input: {
  structured: SgbGraph | null
  entities: DgbEntity[]
  relations: DgbRelation[]
  typeLinks: TypeLink[]
}): RawGraph {
  const sgb = input.structured ? fromSgbGraph(input.structured) : { nodes: [], links: [] }
  const dgb = fromDgbGraph(input.entities, input.relations)

  const conceptByName = new Map(
    sgb.nodes.filter((n) => n.type === 'Concept').map((n) => [n.label.toLowerCase(), n.id]),
  )
  const entitiesByType = new Map<string, string[]>()
  for (const entity of input.entities) {
    const key = entity.resolvedType ?? entity.entityType
    const list = entitiesByType.get(key) ?? []
    list.push(entity.entityId)
    entitiesByType.set(key, list)
  }
  /* The lane derives an entity's type from the extractor and its resolved type from the graph, so a
     Type Link's `entityType` may name either. Both are looked up rather than one being assumed. */
  for (const entity of input.entities) {
    const list = entitiesByType.get(entity.entityType) ?? []
    if (!list.includes(entity.entityId)) list.push(entity.entityId)
    entitiesByType.set(entity.entityType, list)
  }

  const bridge: RawLink[] = []
  for (const link of input.typeLinks) {
    if (link.decision === 'reject') continue
    if (link.decidedBy === 'llm') continue
    const conceptId = conceptByName.get(link.conceptName.toLowerCase())
    if (!conceptId) continue
    for (const entityId of entitiesByType.get(link.entityType) ?? []) {
      bridge.push({
        source: entityId,
        target: conceptId,
        label: link.decision === 'identity' ? 'IS_A' : 'ATTRIBUTE_OF',
        provenance: `Bridge · ${link.entityType} ⇔ ${link.conceptName}`,
      })
    }
  }

  return {
    nodes: [...sgb.nodes, ...dgb.nodes],
    links: [...sgb.links, ...dgb.links, ...bridge],
  }
}
