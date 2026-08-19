import type { CanvasPayload } from '../api/client'
import type { RawGraph, RawNode } from './types'

/**
 * The tenant's canvas, in the shape the vendored viewer reads.
 *
 * The two shapes were already close, which is why vendoring the viewer was possible at
 * all: `element_class` is *exactly* its three classes, and our ontology `type` is the key
 * its `TYPE_COLORS` is written against (Facility, Manifest, Evaluation, Violation,
 * Enforcement, Document, Alias, Measure, Concept). Nothing here invents a field —
 * everything below is a rename or a sentence assembled from values the payload carries.
 *
 * **The seeded positions are handed over as the simulation's starting point.**
 * `x`/`y` come from `npm run ingest:graph`'s force pass, and d3 uses a node's existing
 * `x`/`y` as its initial position — so the run starts from the arrangement the ingest
 * wrote and settles from there, rather than from a random scatter. That keeps the seeded
 * layout doing real work (it is why the picture is recognisably the same graph each time)
 * without the canvas pretending a live simulation is a static drawing.
 *
 * `r` is deliberately *not* passed: the viewer sizes a node by element class and degree
 * (`radiusFor`), which is its own rule, and two radius rules would disagree.
 */
export function fromCanvas(canvas: CanvasPayload, graphName: string): RawGraph {
  const nodes: RawNode[] = canvas.nodes.map((n) => ({
    id: n.nodeId,
    type: n.type,
    /* `measure_element` is the payload's spelling; the viewer's discriminator is
       `measure`, and its radius rule and legend both key on that. */
    element_class: n.elementClass === 'measure_element' ? 'measure' : n.elementClass,
    label: n.label,
    entity_type: n.type,
    /* The viewer's inspect panel prints `provenance`. Ours is the Catalog object the
       node was built from, which is exactly what that field is for — a node whose
       provenance is not on it is a claim the reader has to take on trust. */
    provenance: n.source,
    /* Its detail box reads `subtype`; the payload's `sublabel` is the node's own figure
       line (`46 manifests · 1,061.8 tons`), cached from what Layer 2 would federate. */
    subtype: n.sublabel || undefined,
    /*
     * The amber L2 box is where the viewer puts commentary that is not the graph's own
     * structure — so the studio's review state goes there, and only when there is
     * something to say. A node whose review row is still open is a *proposal*, and that
     * is the one fact a reviewer must not miss on the canvas.
     */
    l2: reviewNote(n),
    x: n.x,
    y: n.y,
  }))

  return {
    nodes,
    links: canvas.edges.map((e) => ({
      source: e.from,
      target: e.to,
      label: e.label,
      provenance: e.detail,
    })),
    /* The viewer's own honesty banner: `faithful` means the values trace back to source
       keys. This graph is ingested from the demo package's extraction run, so it does —
       and the note says which graph, because the banner is read before the canvas is. */
    faithful: true,
    subtitle: `${graphName} · ${canvas.nodeCount} nodes · ${canvas.edgeCount} edges`,
    note: `Ingested from the demo package's extraction run. ${canvas.facets.needsReview} node(s) still need a human; ${canvas.facets.lowConfidence} sit below the confidence floor.`,
  }
}

/** What the studio knows about a node that the graph itself does not. Undefined when
    there is nothing to report — an absence has no note, the same rule the canvas
    followed when it drew no circle for one. */
function reviewNote(n: CanvasPayload['nodes'][number]): string | undefined {
  const parts: string[] = []
  if (n.proposed) parts.push('Proposed — its review row is still open, so it may not survive')
  if (n.origin === 'studio-authored') parts.push('Studio-authored — corrected by a reviewer')
  if (n.rejected) parts.push('Rejected in review')
  if (n.needsReview) parts.push(`Needs review at confidence ${n.confidence.toFixed(2)}`)
  return parts.length > 0 ? `${parts.join('. ')}.` : undefined
}

/**
 * The route an answer walked, in the two sets the viewer's paint pass reads.
 *
 * Both come off the same payload the drawing does — `on_answer_path`, marked server-side
 * by the query — so there is no second request and no second truth about which
 * relationships an answer used. Empty sets when nothing was asked, which the viewer reads
 * as "no highlight" rather than as "highlight nothing".
 */
export function answerPath(canvas: CanvasPayload): {
  nodes: Set<string>
  edges: Set<string>
} {
  return {
    nodes: new Set(canvas.nodes.filter((n) => n.onAnswerPath).map((n) => n.nodeId)),
    /* `from->to`, which is `edgeKey`'s format in the viewer's lib. Keyed the same way or
       the edges of a lit route stay dim while its nodes light up. */
    edges: new Set(
      canvas.edges.filter((e) => e.onAnswerPath).map((e) => `${e.from}->${e.to}`),
    ),
  }
}
