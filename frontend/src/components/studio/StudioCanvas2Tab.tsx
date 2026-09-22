import { ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Descriptions, Empty, Flex, Select, Space, Tag, Typography } from 'antd'
import { useMemo, useState } from 'react'
import type { DgbEntity, DgbRelation, SgbGraph, TypeLink } from '../../api/client'
import ForceCanvas, { labelCapNote } from './ForceCanvas'
import {
  EMPTY_FILTERS,
  filterForceGraph,
  filterOptions,
  forceGraphFromLanes,
  LABELS_SHOWN,
  type ForceFilters,
} from '../../data/studioForceGraph'
import { SP } from '../../theme'

/**
 * **Canvas 2 — the same graph, settled.**
 *
 * The Canvas tab draws the lanes with the vendored force viewer and arranges them on an authored
 * sphere; this tab lets the graph find its own arrangement and projects the result onto one. It is a
 * third *reading* of one graph rather than a second answer to what the graph holds: every node and
 * every lane edge comes from `fromSgbGraph` and `fromDgbGraph`, the two derivations both existing
 * frames are built from, so the three cannot come to disagree about what this use case contains.
 *
 * **Three things it says that the flat canvas cannot.**
 *
 * - **An entity type is a node**, so the Bridge's claim is drawn at the level the Bridge makes it —
 *   *this type corresponds with this concept* — rather than fanned out to every instance of the
 *   type, which draws an instance-level line for a claim the Bridge does not make.
 * - **The lanes are anchored rather than centred**, so they settle as two halves of one body instead
 *   of collapsing onto one point, which is what a single centring well does to any shared
 *   simulation however unlinked the two clouds are.
 * - **Narrowing removes rows rather than dimming them**, so the layout, the measured spread and the
 *   camera all adapt to what is left. A dimmed node still takes a seat the physics has to settle and
 *   the projection has to measure around, and a sphere of ghosts is harder to read than the whole.
 *
 * The filter row, the reset and the inspector live here; the drawing is `ForceCanvas` and the
 * physics and the projection are `src/data/studioForceGraph.ts`.
 */

/** One number for the box, as on the Canvas tab: the sphere derives its radius from the box it is
 *  drawn in, and a sphere sized against a different box is one clipped by its own frame. */
const CANVAS_BOX = { height: 620 } as const

/** A control with one option is indistinguishable from one that failed to load its others, which is
 *  the fault this repo refuses everywhere — so a filter is offered only where there is a choice. */
const MIN_OPTIONS = 2

export default function StudioCanvas2Tab({
  structured,
  entities,
  relations,
  typeLinks,
}: {
  structured: SgbGraph | null
  entities: DgbEntity[]
  relations: DgbRelation[]
  typeLinks: TypeLink[]
}) {
  const [filters, setFilters] = useState<ForceFilters>(EMPTY_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /* A counter rather than a flag: it is folded into the layout's identity, which is what makes Reset
     actually re-seed rather than only moving the camera back over a graph that did not move. */
  const [resets, setResets] = useState(0)

  const full = useMemo(
    () => forceGraphFromLanes({ structured, entities, relations, typeLinks }),
    [structured, entities, relations, typeLinks],
  )
  const options = useMemo(() => filterOptions(full), [full])
  const graph = useMemo(() => filterForceGraph(full, filters), [full, filters])

  /* Each option carries its OWN swatch — `filterOptions` reads it off the same `typeColor` the
     canvas paints the node with, so the control and the drawing cannot come to disagree about what
     a type looks like. A plain string label would leave the dropdown listing names a reader then
     has to go match against dots on the sphere by eye. */
  const typeOptions = useMemo(
    () =>
      options.types.map((option) => ({
        value: option.value,
        label: (
          <Space size={6}>
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: option.color,
                flex: 'none',
              }}
            />
            {option.label}
          </Space>
        ),
      })),
    [options.types],
  )

  const selected = useMemo(
    () => graph.nodes.find((node) => node.id === selectedId) ?? null,
    [graph.nodes, selectedId],
  )

  /* Resolved from the graph already in hand rather than fetched per selection: this tab holds every
     relationship and can name both endpoints, so a request here would be a second answer to
     something already on the page. */
  const neighbours = useMemo(() => {
    if (!selected) return []
    const labelOf = new Map(graph.nodes.map((node) => [node.id, node.label]))
    return graph.edges
      .filter((edge) => !edge.layoutOnly)
      .filter((edge) => edge.source === selected.id || edge.target === selected.id)
      .map((edge) => ({
        id: edge.id,
        label: edge.label,
        kind: edge.kind,
        other:
          edge.source === selected.id
            ? (labelOf.get(edge.target) ?? edge.target)
            : (labelOf.get(edge.source) ?? edge.source),
        inbound: edge.target === selected.id,
      }))
  }, [graph, selected])

  const reset = () => {
    setFilters(EMPTY_FILTERS)
    setSelectedId(null)
    setResets((n) => n + 1)
  }

  const narrowed = filters.concepts.length > 0 || filters.classes.length > 0 || filters.types.length > 0
  const bridgeCount = graph.edges.filter((edge) => edge.kind === 'bridge').length

  if (full.nodes.length === 0) {
    return (
      <Alert
        type="info"
        showIcon
        title="Nothing to draw yet"
        description="No lane has produced a graph. Build it from the Build tab."
      />
    )
  }

  return (
    <Space direction="vertical" size={SP.md} style={{ width: '100%' }}>
      <Flex align="center" justify="space-between" gap={SP.sm} wrap>
        <Flex align="center" gap={SP.sm} wrap>
          {options.concepts.length >= MIN_OPTIONS ? (
            <Select
              mode="multiple"
              allowClear
              style={{ minWidth: 240 }}
              placeholder={`Concepts · all ${options.concepts.length}`}
              value={filters.concepts}
              options={options.concepts}
              maxTagCount={2}
              onChange={(concepts: string[]) => setFilters((f) => ({ ...f, concepts }))}
            />
          ) : null}
          {options.classes.length >= MIN_OPTIONS ? (
            <Select
              mode="multiple"
              allowClear
              style={{ minWidth: 240 }}
              placeholder={`Classes · all ${options.classes.length}`}
              value={filters.classes}
              options={options.classes}
              maxTagCount={2}
              onChange={(classes: string[]) => setFilters((f) => ({ ...f, classes }))}
            />
          ) : null}
          {typeOptions.length >= MIN_OPTIONS ? (
            <Select
              mode="multiple"
              allowClear
              style={{ minWidth: 240 }}
              placeholder={`Types · all ${typeOptions.length}`}
              value={filters.types}
              options={typeOptions}
              maxTagCount={2}
              onChange={(types: string[]) => setFilters((f) => ({ ...f, types }))}
            />
          ) : null}
        </Flex>
        {/* Clears the filters, the selection and the layout together — a reset that restored the
            camera over a graph holding every dragged position is a button that visibly does
            nothing, which is exactly what a camera-only reset is. */}
        <Button size="small" icon={<ReloadOutlined />} onClick={reset}>
          Reset view
        </Button>
      </Flex>

      <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
        Both lanes, settled and projected onto one sphere: the structured graph and the document
        corpus keep their own nodes and ids, and an entity type is drawn as a node so the Bridge is
        stated where it is claimed — type to concept, never to an individual row. Revolve to bring the
        far side round; drag a node to place it, click it to trace what it touches. It carries{' '}
        {labelCapNote}, so revolving and filtering are what reveal the rest.
      </Typography.Text>

      <Flex align="center" gap={SP.sm} wrap>
        {/* One expression each, never `{n} text`: `renderToString` splits that into separate nodes,
            so a check on the sentence would pass over nothing — the trap this repo has already been
            caught by once. */}
        <Tag>{`${graph.nodes.length} nodes`}</Tag>
        <Tag>{`${graph.edges.filter((edge) => !edge.layoutOnly).length} relationships`}</Tag>
        <Tag color={bridgeCount > 0 ? 'orange' : undefined}>{`${bridgeCount} bridged`}</Tag>
        {narrowed ? (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            {`Narrowed from ${full.nodes.length} nodes. Rows are removed rather than dimmed, so the layout and the camera fit what is left.`}
          </Typography.Text>
        ) : null}
        {bridgeCount === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            No correspondence has been decided yet, so nothing is stitched across the seam — an
            undecided Type Link is a proposal, and a line here would read as a fact. Decide them on
            the Bridge tab.
          </Typography.Text>
        ) : null}
      </Flex>

      <Flex gap={SP.md} align="stretch" wrap={false} style={{ width: '100%' }}>
        {/* A stated 60/40 split, both sides in the same unit — a fixed-px sibling against a
            flex-grow canvas is not a percentage at all, it is whatever is left over once the fixed
            side is subtracted, which is why the canvas kept reading as a different size depending on
            how wide the surrounding card happened to be. Two percentages that sum with the gap to
            100% are what make the ratio the same regardless of the container. */}
        <div style={{ flex: '0 1 60%', minWidth: 0 }}>
          <ForceCanvas
            graph={graph}
            height={CANVAS_BOX.height}
            resets={resets}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReset={reset}
          />
        </div>

        <div style={{ flex: '0 1 40%', minWidth: 0, overflow: 'auto', maxHeight: CANVAS_BOX.height }}>
          {selected ? (
            <Space direction="vertical" size={SP.sm} style={{ width: '100%' }}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                {selected.label}
              </Typography.Title>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Lane">
                  {selected.lane === 'structured' ? 'Structured' : 'Documents'}
                </Descriptions.Item>
                <Descriptions.Item label="Type">{selected.type}</Descriptions.Item>
                {selected.subtype ? (
                  <Descriptions.Item label="Stated as">{selected.subtype}</Descriptions.Item>
                ) : null}
                {typeof selected.members === 'number' ? (
                  <Descriptions.Item label="Members">
                    {selected.members.toLocaleString()}
                  </Descriptions.Item>
                ) : null}
                {selected.provenance ? (
                  <Descriptions.Item label="From">{selected.provenance}</Descriptions.Item>
                ) : null}
                {/*
                 * A structured concept carries no classification of its own, and the row says so
                 * rather than being dropped — fabricating a field to make both lanes look
                 * symmetrical is the one thing an inspector must not do.
                 */}
                {selected.kind === 'concept' && !selected.detail ? (
                  <Descriptions.Item label="Classification">
                    none — a concept states no class
                  </Descriptions.Item>
                ) : null}
              </Descriptions>
              {selected.detail ? (
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  {selected.detail}
                </Typography.Text>
              ) : null}
              <Typography.Text strong style={{ fontSize: 12.5 }}>
                {`${neighbours.length} relationship${neighbours.length === 1 ? '' : 's'}`}
              </Typography.Text>
              <Space direction="vertical" size={SP.xs} style={{ width: '100%' }}>
                {neighbours.slice(0, 40).map((row) => (
                  <Typography.Text key={row.id} style={{ fontSize: 12 }}>
                    <Tag color={row.kind === 'bridge' ? 'orange' : undefined}>{row.label}</Tag>
                    {row.inbound ? '← ' : '→ '}
                    {row.other}
                  </Typography.Text>
                ))}
                {neighbours.length > 40 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {`and ${neighbours.length - 40} more`}
                  </Typography.Text>
                ) : null}
              </Space>
            </Space>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`Click a node to trace what it touches. ${LABELS_SHOWN} labels are drawn at a time; revolve or filter to reach the rest.`}
            />
          )}
        </div>
      </Flex>
    </Space>
  )
}
