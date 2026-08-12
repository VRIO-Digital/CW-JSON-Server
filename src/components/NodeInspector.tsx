import { Button } from 'antd'
import type { CanvasNode } from '../api/client'
import StatusTag from './StatusTag'

/*
 * What one node on the canvas actually is.
 *
 * Its own component because two views draw the same canvas — the studio's Canvas tab
 * and the full-window view at `/graph-studio/:id/canvas` — and a second copy of this
 * panel would be a second account of what a node is. It keeps the `gs-inspector-*`
 * classes it was written with, which live in `GraphStudioPage.css`; both pages load
 * that stylesheet.
 */

/**
 * The build model's three element classes, in a reader's words.
 *
 * The graph is an index, not a copy: a thin instance carries identity and provenance
 * and nothing else, and the attributes and measures a reader wants federate from the
 * source at query time. Spelling that out on the node is the difference between "the
 * graph has no tonnage" and "the tonnage is not the graph's to hold".
 */
const ELEMENT_CLASS: Record<CanvasNode['elementClass'], string> = {
  thin_instance: 'thin instance — identity only, values federate at query time',
  concept: 'concept — type-level, one node however many rows',
  measure_element: 'measure element — a quantity relationships can point at',
}

export default function NodeInspector({
  node,
  onReview,
}: {
  node: CanvasNode | null
  /** Where "Open in review queue" goes. The two views reach it differently. */
  onReview: () => void
}) {
  if (!node) {
    return (
      <div className="gs-inspector">
        <div className="gs-inspector-title">Inspector</div>
        <div className="gs-inspector-empty">Select a node on the canvas</div>
      </div>
    )
  }
  return (
    <div className="gs-inspector">
      <div className="gs-inspector-title">Inspector</div>
      <div className="gs-inspector-name">{node.label}</div>
      <div className="gs-inspector-sub">{node.sublabel}</div>

      <dl className="gs-inspector-facts">
        <dt>Type</dt>
        <dd>{node.type}</dd>
        {/* The element class, because the colour cannot say it: `schema` covers both
            concepts and measure elements, and "an index entry" versus "a type" versus
            "a quantity relationships can point at" is the distinction the whole graph
            model turns on. A thin instance holds identity only — its values federate
            at query time and are deliberately not in the graph. */}
        <dt>Element</dt>
        <dd>{ELEMENT_CLASS[node.elementClass]}</dd>
        {/* Which table or file this node was built from. A node whose provenance
            is not on it is a claim the reader has to take on trust. */}
        <dt>Source</dt>
        <dd className="gs-inspector-source">{node.source}</dd>
        <dt>Relationships</dt>
        <dd>{node.degree}</dd>
        <dt>Confidence</dt>
        <dd>{node.confidence.toFixed(2)}</dd>
        <dt>Built from</dt>
        <dd>{node.group}</dd>
        <dt>Origin</dt>
        <dd>{node.origin}</dd>
        <dt>State</dt>
        <dd>
          <StatusTag tone={node.proposed ? 'warn' : 'good'}>
            {node.proposed ? 'under review' : 'confirmed'}
          </StatusTag>
        </dd>
      </dl>

      {/* A proposed node exists because a row in the queue is open. Saying so,
          and linking there, is what keeps the two views one truth. */}
      {node.proposed ? (
        <>
          <div className="gs-inspector-note">
            This is proposed because its review item is still open. Decide it in
            the review queue and the node stops being provisional.
          </div>
          <Button size="small" onClick={onReview}>
            Open in review queue
          </Button>
        </>
      ) : null}
    </div>
  )
}
