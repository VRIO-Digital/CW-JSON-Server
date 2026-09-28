import { ExportOutlined } from '@ant-design/icons'
import { Alert, Button, Flex, Segmented, Space, Typography } from 'antd'
import { useMemo, useState } from 'react'
import type { DgbEntity, DgbRelation, SgbGraph, TypeLink } from '../../api/client'
import GraphViewer from '../../graph-viewer/App'
import GlobeCanvas from './GlobeCanvas'
import { fromCombined, fromDgbGraph, fromSgbGraph } from '../../data/studioCanvas'
import { globeFromLanes } from '../../data/studioGlobe'
import { SP } from '../../theme'

/**
 * The lanes, drawn — **one viewer, three frames.**
 *
 * The structured canvas, the document canvas and the combined one all render the vendored
 * `src/graph-viewer`, which is the same folder the studio has always drawn with. A second force
 * graph was the alternative and is what this repo refuses everywhere: two drawings of one graph are
 * two answers to what it looks like, and the one nobody is looking at is the one that goes wrong.
 * What differs between the three is the graph handed in, built by the pure adapters in
 * `src/data/studioCanvas.ts`.
 *
 * **The combined frame merges nothing.** Both lanes keep their own nodes and their own ids; what it
 * adds is the Bridge's own claim, drawn as an edge from an entity to the concept it corresponds
 * with — and only where a person has decided it, because an undecided correspondence is a proposal
 * and a line on a canvas reads as a fact.
 *
 * **The fourth frame is the globe, and it is the same graph rather than a second one.** A sphere is
 * a different *arrangement* of the combined frame's nodes and edges, not a different answer to what
 * they are: it is built from `fromSgbGraph`, `fromDgbGraph` and `bridgeLinks`, the same three
 * derivations `fromCombined` is built from, so the two frames cannot come to hold different graphs.
 * What it says that a flat canvas cannot is that the two lanes are **halves of one body** — the
 * structured graph is the upper hemisphere, the documents the lower, and the Bridge is the stitching
 * along the rim where they meet. It is offered only with both lanes present, for the same reason
 * Combined is: one lane is not half of anything.
 */

type Frame = 'structured' | 'documents' | 'combined' | 'globe'

/**
 * The box every frame is drawn in.
 *
 * A fixed height rather than a measured fit: the force viewer owns its own pan and zoom and the
 * globe owns its revolve, so a canvas that grew with its node count would put the page's scrollbar
 * and the drawing's own gesture in the same place. **Both frames take the one number** — the globe
 * derives its radius from the box it is drawn in, and a sphere sized against a different box is a
 * sphere clipped by its own frame.
 */
const CANVAS_BOX = { height: 620 } as const

export default function StudioCanvasTab({
  structured,
  entities,
  relations,
  typeLinks,
  hasStructured,
  hasDocuments,
  fullViewHref,
}: {
  structured: SgbGraph | null
  entities: DgbEntity[]
  relations: DgbRelation[]
  typeLinks: TypeLink[]
  hasStructured: boolean
  hasDocuments: boolean
  /** Where the whole-window view lives. **Passed in, not built here**: the vendored viewer knows
   *  nothing about this app's routes, and neither should a tab that renders it — the dataset prefix
   *  belongs to the page. */
  fullViewHref: string
}) {
  const bothLanes = hasStructured && hasDocuments
  /* The globe where there are two hemispheres to close, because that is the frame that says what
     this studio is for; one lane has no sphere to be half of. */
  const [frame, setFrame] = useState<Frame>(
    bothLanes ? 'globe' : hasStructured ? 'structured' : 'documents',
  )

  const graph = useMemo(() => {
    if (frame === 'structured') return structured ? fromSgbGraph(structured) : { nodes: [], links: [] }
    if (frame === 'documents') return fromDgbGraph(entities, relations)
    return fromCombined({ structured, entities, relations, typeLinks })
  }, [frame, structured, entities, relations, typeLinks])

  /* Built only for the frame that draws it: the layout walks every bridged pair, and a canvas of 843
     entities should not pay for it while a reader is looking at one lane. */
  const globe = useMemo(
    () =>
      frame === 'globe'
        ? globeFromLanes({ structured, entities, relations, typeLinks })
        : { nodes: [], edges: [] },
    [frame, structured, entities, relations, typeLinks],
  )

  const options = [
    ...(hasStructured ? [{ value: 'structured', label: 'Structured' }] : []),
    ...(hasDocuments ? [{ value: 'documents', label: 'Documents' }] : []),
    ...(bothLanes ? [{ value: 'combined', label: 'Combined' }] : []),
    ...(bothLanes ? [{ value: 'globe', label: 'Globe' }] : []),
  ]

  const note =
    frame === 'structured'
      ? 'Tables and the concepts their columns realise. Columns are folded into their table rather than drawn as nodes — 206 discs around five tables says less than five tables do — so each table states its columns on the node.'
      : frame === 'documents'
        ? 'The documents in this corpus and what each was found to be about. Two documents about one facility share a node: that is entity resolution, and the mention count on the node is what says so.'
        : frame === 'globe'
          ? 'One sphere, two hemispheres: the structured lane above the rim, the documents below it, and the Bridge as the stitching across it. Nothing is merged — each lane keeps its own nodes and ids. A sphere has a far side, so not everything is in view at once: revolve it to bring the rest round.'
          : 'Both lanes, with the Bridge between them. Nothing is merged — each lane keeps its own nodes and ids — and a correspondence is drawn only once a person has decided it.'

  return (
    <Space direction="vertical" size={SP.md} style={{ width: '100%' }}>
      <Flex align="center" justify="space-between" gap={SP.sm} wrap>
        {options.length > 1 ? (
          <Segmented
            value={frame}
            options={options}
            onChange={(value) => setFrame(value as Frame)}
          />
        ) : (
          <span />
        )}
        {/* A new tab, so the studio keeps its place — and the only way in besides typing the URL,
            which is why its absence would strand the route rather than merely hide it. */}
        <Button
          size="small"
          icon={<ExportOutlined />}
          href={fullViewHref}
          target="_blank"
          rel="noreferrer"
        >
          Full view
        </Button>
      </Flex>

      <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
        {note}
      </Typography.Text>

      {(frame === 'globe' ? globe.nodes.length : graph.nodes.length) === 0 ? (
        <Alert
          type="info"
          showIcon
          title="Nothing to draw yet"
          description="This lane has not produced a graph. Build it from the Build tab."
        />
      ) : frame === 'globe' ? (
        <GlobeCanvas graph={globe} height={CANVAS_BOX.height} />
      ) : (
        <div style={CANVAS_BOX}>
          <GraphViewer graph={graph} />
        </div>
      )}
    </Space>
  )
}
