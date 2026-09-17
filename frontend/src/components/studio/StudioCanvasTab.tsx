import { ExportOutlined } from '@ant-design/icons'
import { Alert, Button, Flex, Segmented, Space, Typography } from 'antd'
import { useMemo, useState } from 'react'
import type { DgbEntity, DgbRelation, SgbGraph, TypeLink } from '../../api/client'
import GraphViewer from '../../graph-viewer/App'
import { fromCombined, fromDgbGraph, fromSgbGraph } from '../../data/studioCanvas'
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
 */

type Frame = 'structured' | 'documents' | 'combined'

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
  const [frame, setFrame] = useState<Frame>(
    bothLanes ? 'combined' : hasStructured ? 'structured' : 'documents',
  )

  const graph = useMemo(() => {
    if (frame === 'structured') return structured ? fromSgbGraph(structured) : { nodes: [], links: [] }
    if (frame === 'documents') return fromDgbGraph(entities, relations)
    return fromCombined({ structured, entities, relations, typeLinks })
  }, [frame, structured, entities, relations, typeLinks])

  const options = [
    ...(hasStructured ? [{ value: 'structured', label: 'Structured' }] : []),
    ...(hasDocuments ? [{ value: 'documents', label: 'Documents' }] : []),
    ...(bothLanes ? [{ value: 'combined', label: 'Combined' }] : []),
  ]

  const note =
    frame === 'structured'
      ? 'Tables and the concepts their columns realise. Columns are folded into their table rather than drawn as nodes — 206 discs around five tables says less than five tables do — so each table states its columns on the node.'
      : frame === 'documents'
        ? 'The documents in this corpus and what each was found to be about. Two documents about one facility share a node: that is entity resolution, and the mention count on the node is what says so.'
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

      {graph.nodes.length === 0 ? (
        <Alert
          type="info"
          showIcon
          title="Nothing to draw yet"
          description="This lane has not produced a graph. Build it from the Build tab."
        />
      ) : (
        /* A fixed height rather than a measured fit: the viewer owns its own pan and zoom, and a
           canvas that grows with its node count would put the page's scrollbar and the drawing's
           own gesture in the same place. */
        <div style={{ height: 620 }}>
          <GraphViewer graph={graph} />
        </div>
      )}
    </Space>
  )
}
