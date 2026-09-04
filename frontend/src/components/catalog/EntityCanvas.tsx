import {
  CalendarOutlined,
  FontSizeOutlined,
  KeyOutlined,
  MinusOutlined,
  NumberOutlined,
  PlusOutlined,
  RightOutlined,
  TableOutlined,
} from '@ant-design/icons'
import { Tooltip } from 'antd'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { ModelEntity, ModelMetric, ProfiledColumn } from '../../api/client'
import {
  MAX_COLUMN_ROWS,
  NODE_W,
  contentBoundingBox,
  layoutPositions,
  nodeContentHeight,
  rectBoundaryToward,
  type CanvasEdgeVM,
  type NodeRect,
} from '../../data/dataModelCanvas'
import { columnGlyph } from '../../data/dataModelMetrics'
import { confirmedIdentifier } from '../../data/dataModelRelationships'
import { MT } from '../../data/dataModelTokens'
import { entityForTable, type ModelTable } from '../../store/dataModelStore'
import { ProvenanceBadge } from './ModelMarks'

/**
 * The centre canvas: absolutely-positioned React cards over a bare `<svg>` that draws only the
 * lines.
 *
 * **Cards are HTML, not `foreignObject`.** A node here is a header, a few rows and two collapsible
 * sections — a card, which SVG has no primitive for — so the drawing is split: the lines that need
 * geometry live in an SVG layer, and everything a reader interacts with is ordinary DOM. That is
 * also why this is not the vendored `graph-viewer`: that one draws a settling force layout of 189
 * identity-only nodes, and this one draws a schema whose cards state their columns.
 *
 * **Selection is the tab's, not this component's.** `selectedTableKey` and `onSelect` are the same
 * pair the table list gets. Pan, zoom and a dragged card *are* this component's, because they are
 * DOM state nobody outside needs to read — which is why **Fit** is handed in as a ref rather than
 * lifted out as state.
 */

interface EntityCanvasProps {
  tables: ModelTable[]
  entities: ModelEntity[]
  edges: CanvasEdgeVM[]
  selectedTableKey: string | null
  onSelect: (tableKey: string) => void
  /** Clicking an edge label, or a relationship row inside a card, opens that relationship. */
  onSelectEdge?: (edgeId: string) => void
  /** A card's `+` jumps to the matching sub-tab for that table rather than editing on the canvas. */
  onAddRelationshipFor?: (tableKey: string) => void
  onAddMetricFor?: (tableKey: string) => void
  /** The toolbar's **Fit** button, which lives above this component, calls what this assigns. */
  fitRef?: MutableRefObject<(() => void) | null>
}

interface ColumnRowVM {
  column: ProfiledColumn
  tagLabel?: string
  tagColor?: string
  isIdentifier?: boolean
}

const GLYPHS: Record<ReturnType<typeof columnGlyph>, ReactNode> = {
  date: <CalendarOutlined />,
  number: <NumberOutlined />,
  key: <KeyOutlined />,
  text: <FontSizeOutlined />,
}

/**
 * Up to `MAX_COLUMN_ROWS` rows per card: the confirmed identifier first, tagged `PK`, then the rest
 * in column order with a `described` tag where the column carries a description.
 *
 * Anything past the cap collapses into one "and N more" line. A profiled table here can carry ninety
 * columns, and the cap is **stated** rather than a silent truncation.
 */
function nodeColumnRows(
  table: ModelTable,
  entity: ModelEntity | null,
): { shown: ColumnRowVM[]; moreCount: number } {
  const identifierName = confirmedIdentifier(entity)
  const ordered: ColumnRowVM[] = []
  const identifierCol = identifierName
    ? table.columns.find((c) => c.column_id === identifierName)
    : undefined
  if (identifierCol) {
    ordered.push({
      column: identifierCol,
      tagLabel: 'PK',
      tagColor: MT.orangeHi,
      isIdentifier: true,
    })
  }
  for (const c of table.columns) {
    if (c.column_id === identifierName) continue
    ordered.push(
      c.description
        ? { column: c, tagLabel: 'described', tagColor: MT.green }
        : { column: c },
    )
  }
  const shown = ordered.slice(0, MAX_COLUMN_ROWS)
  return { shown, moreCount: Math.max(0, ordered.length - shown.length) }
}

export interface SectionRow {
  id: string
  label: string
  onClick?: () => void
}

/**
 * A card's collapsible Relationships / Metrics section.
 *
 * Open by default when it has rows and shut when it does not, because a shut section with a count of
 * zero is a control that opens onto nothing. Its `+` opens the section *and* fires `onAdd`, which
 * takes the reader to the sub-tab where the thing is actually declared — this canvas edits nothing
 * inline.
 *
 * Every interactive part carries `data-node-interactive`, which is what stops a press on a chevron
 * from also dragging the whole card.
 */
function CardSection({
  label,
  rows,
  onAdd,
}: {
  label: string
  rows: SectionRow[]
  onAdd?: () => void
}) {
  const [open, setOpen] = useState(rows.length > 0)
  return (
    <div style={{ borderTop: `1px solid ${MT.line}` }}>
      <div
        role="button"
        tabIndex={0}
        data-node-interactive="1"
        onClick={(ev) => {
          ev.stopPropagation()
          setOpen((o) => !o)
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault()
            ev.stopPropagation()
            setOpen((o) => !o)
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '5px 10px',
          fontSize: 10.5,
          color: MT.mut,
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <RightOutlined
            style={{
              fontSize: 9,
              transform: open ? 'rotate(90deg)' : undefined,
              transition: 'transform .1s',
            }}
          />
          {label}
          {rows.length > 0 ? <span style={{ color: MT.dim }}>({rows.length})</span> : null}
        </span>
        <span
          role="button"
          tabIndex={0}
          data-node-interactive="1"
          aria-label={`Add ${label.toLowerCase()}`}
          onClick={(ev) => {
            ev.stopPropagation()
            setOpen(true)
            onAdd?.()
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault()
              ev.stopPropagation()
              setOpen(true)
              onAdd?.()
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            borderRadius: 4,
            color: MT.dim,
            cursor: 'pointer',
          }}
        >
          <PlusOutlined style={{ fontSize: 10 }} />
        </span>
      </div>
      {open ? (
        <div data-node-interactive="1" style={{ padding: '0 10px 7px' }}>
          {rows.length === 0 ? (
            <div style={{ fontSize: 10.5, color: MT.dim }}>None yet.</div>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                role={row.onClick ? 'button' : undefined}
                tabIndex={row.onClick ? 0 : undefined}
                onClick={
                  row.onClick
                    ? (ev) => {
                        ev.stopPropagation()
                        row.onClick?.()
                      }
                    : undefined
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '3px 0',
                  fontSize: 10.5,
                  color: MT.text,
                  cursor: row.onClick ? 'pointer' : undefined,
                }}
              >
                <Tooltip title={row.label}>
                  <span
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                    }}
                  >
                    {row.label}
                  </span>
                </Tooltip>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * A press that never travels more than `CLICK_SLOP` screen pixels is a click, and selects the card;
 * past that it is a drag, and repositions it. Without the slop a reader who twitches while clicking
 * loses the ability to select a card at all.
 */
const CLICK_SLOP = 4

interface NodeCardProps {
  table: ModelTable
  entity: ModelEntity | null
  rect: NodeRect
  selected: boolean
  confirmedCount: number
  pendingCount: number
  relationshipRows: SectionRow[]
  metricRows: SectionRow[]
  /** The canvas's zoom. A pointer delta is in screen pixels; a card's position is in world units. */
  scale: number
  onSelect: () => void
  onDrag: (x: number, y: number) => void
  onAddRelationship?: () => void
  onAddMetric?: () => void
}

function NodeCard({
  table,
  entity,
  rect,
  selected,
  confirmedCount,
  pendingCount,
  relationshipRows,
  metricRows,
  scale,
  onSelect,
  onDrag,
  onAddRelationship,
  onAddMetric,
}: NodeCardProps) {
  const { shown, moreCount } = nodeColumnRows(table, entity)
  const displayName = entity?.entity_name ?? table.tableId
  const hasSummary = confirmedCount > 0 || pendingCount > 0

  const pressRef = useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
    dragging: boolean
  } | null>(null)

  const handlePointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).closest('[data-node-interactive]')) return
    pressRef.current = {
      startX: ev.clientX,
      startY: ev.clientY,
      origX: rect.x,
      origY: rect.y,
      dragging: false,
    }
    ev.currentTarget.setPointerCapture(ev.pointerId)
  }
  const handlePointerMove = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const p = pressRef.current
    if (!p) return
    if (!p.dragging && Math.hypot(ev.clientX - p.startX, ev.clientY - p.startY) < CLICK_SLOP) {
      return
    }
    p.dragging = true
    onDrag(
      p.origX + (ev.clientX - p.startX) / scale,
      p.origY + (ev.clientY - p.startY) / scale,
    )
  }
  const handlePointerUp = () => {
    const p = pressRef.current
    pressRef.current = null
    if (p && !p.dragging) onSelect()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-canvas-interactive="1"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        pressRef.current = null
      }}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault()
          onSelect()
        }
      }}
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: NODE_W,
        /* Below every edge label (which sits at 5) so a card near another's edge never covers its
           midpoint label. */
        zIndex: 1,
        background: MT.card,
        border: `1.5px solid ${selected ? MT.orange : MT.line2}`,
        borderRadius: MT.rM,
        boxShadow: selected ? `0 0 0 3px ${MT.orangeSoft}, ${MT.shadow}` : MT.shadow,
        cursor: 'grab',
        touchAction: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '9px 10px',
          borderBottom: `1px solid ${MT.line}`,
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            background: MT.orangeSoft,
            color: MT.orangeHi,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          <TableOutlined style={{ fontSize: 11 }} />
        </span>
        <Tooltip title={displayName}>
          <b
            style={{
              fontSize: 12.5,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {displayName}
          </b>
        </Tooltip>
      </div>

      <div style={{ padding: '8px 10px 10px', fontSize: 10.5, color: MT.mut }}>
        {shown.map((row) => (
          <div
            key={row.column.column_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              justifyContent: 'space-between',
              padding: '1.5px 0',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 10.5,
                  color: row.isIdentifier ? MT.orangeHi : MT.dim,
                  flex: 'none',
                }}
              >
                {row.isIdentifier ? <KeyOutlined /> : GLYPHS[columnGlyph(row.column.facet)]}
              </span>
              <span
                style={{
                  fontFamily: MT.mono,
                  color: MT.dim,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {row.column.column_id}
              </span>
            </span>
            {row.tagLabel ? (
              <span style={{ color: row.tagColor, flex: 'none' }}>{row.tagLabel}</span>
            ) : null}
          </div>
        ))}
        {moreCount > 0 ? (
          <div style={{ padding: '1.5px 0', fontStyle: 'italic', color: MT.dim }}>
            and {moreCount} more
          </div>
        ) : null}
        {hasSummary ? (
          <div
            style={{ padding: '1.5px 0', color: confirmedCount > 0 ? MT.green : MT.amber }}
          >
            {confirmedCount > 0
              ? `${confirmedCount} confirmed rel${confirmedCount === 1 ? '' : 's'}`
              : `${pendingCount} suggested rel${pendingCount === 1 ? '' : 's'}`}
          </div>
        ) : null}
      </div>

      <CardSection
        label="Relationships"
        rows={relationshipRows}
        onAdd={onAddRelationship}
      />
      <CardSection label="Metrics" rows={metricRows} onAdd={onAddMetric} />
    </div>
  )
}

const MIN_SCALE = 0.4
const MAX_SCALE = 2.5
/**
 * A fallback for the handful of numbers needed before the `ResizeObserver` reports a real height.
 * Every actual geometry calculation reads the measured box instead — an unmeasured panel is 0 wide,
 * and fitting to 0 piles every card into the corner.
 */
const CANVAS_H_GUESS = 600
const CANVAS_CSS_HEIGHT = 'calc(100vh - 360px)'
const CANVAS_MIN_HEIGHT = 420
const MM_W = 130
const MM_H = 88
/**
 * Extra margin beyond a plain node-rect fit, so an edge label anchored near the outermost card — its
 * own shrink-wrapped box extends past the rect — has clearance from the viewport's clipped edge.
 */
const EDGE_LABEL_CLEARANCE = 56

export default function EntityCanvas({
  tables,
  entities,
  edges,
  selectedTableKey,
  onSelect,
  onSelectEdge,
  onAddRelationshipFor,
  onAddMetricFor,
  fitRef,
}: EntityCanvasProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const panRef = useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)
  const [panning, setPanning] = useState(false)
  /* Tracked in state purely so the minimap's viewport rectangle can be drawn from it — never read
     from the ref during a render. */
  const [viewportSize, setViewportSize] = useState({ w: 640, h: CANVAS_H_GUESS })
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const update = () => setViewportSize({ w: vp.clientWidth, h: vp.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [])

  /* A dragged card's own position, for this session only. There is no stored-position field on a
     declaration, and inventing one to persist a layout would be a claim about the model. */
  const [manualPositions, setManualPositions] = useState<
    Record<string, { x: number; y: number }>
  >({})

  /* The table *set*'s identity, sorted before joining: a re-fetch returning the same tables in a
     different order must not read as a change, or it would wipe every dragged position and re-fit
     the view under somebody's hands. */
  const tableKeySet = useMemo(() => new Set(tables.map((t) => t.tableKey)), [tables])
  const tablesKey = useMemo(
    () => Array.from(tableKeySet).sort().join('|'),
    [tableKeySet],
  )

  /* Only *prunes* — a table added or removed mid-session must not cost every other card its
     placement. */
  const [lastTablesKey, setLastTablesKey] = useState(tablesKey)
  if (tablesKey !== lastTablesKey) {
    setLastTablesKey(tablesKey)
    setManualPositions((prev) => {
      const next: Record<string, { x: number; y: number }> = {}
      let dropped = false
      for (const [key, pos] of Object.entries(prev)) {
        if (tableKeySet.has(key)) next[key] = pos
        else dropped = true
      }
      return dropped ? next : prev
    })
  }

  const rects = useMemo(() => {
    const heights: Record<string, number> = {}
    for (const t of tables) {
      const entity = entityForTable(entities, t.tableKey)
      const { shown, moreCount } = nodeColumnRows(t, entity)
      const touching = edges.filter(
        (e) => e.fromTableKey === t.tableKey || e.toTableKey === t.tableKey,
      )
      heights[t.tableKey] = nodeContentHeight({
        columnRowCount: shown.length,
        hasMoreLine: moreCount > 0,
        hasSummaryLine: touching.length > 0,
      })
    }
    const positions = layoutPositions(
      tables.map((t) => t.tableKey),
      (key) => heights[key] ?? 0,
    )
    const out: Record<string, NodeRect> = {}
    for (const t of tables) {
      const pos = manualPositions[t.tableKey] ?? positions[t.tableKey] ?? { x: 0, y: 0 }
      out[t.tableKey] = { x: pos.x, y: pos.y, w: NODE_W, h: heights[t.tableKey] ?? 0 }
    }
    return out
  }, [tables, entities, edges, manualPositions])

  const contentW = Math.max(0, ...Object.values(rects).map((r) => r.x + r.w)) + 24
  const contentH = Math.max(0, ...Object.values(rects).map((r) => r.y + r.h)) + 24
  const box = useMemo(() => contentBoundingBox(rects, EDGE_LABEL_CLEARANCE), [rects])

  /** Frames every current node — the toolbar's **Fit**, and the view a source opens on. */
  const fitToView = useCallback(() => {
    const vp = viewportRef.current
    const vw = vp?.clientWidth || 640
    const vh = vp?.clientHeight || CANVAS_H_GUESS
    const scale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(vw / box.w, vh / box.h, 1)),
    )
    setTransform({
      scale,
      x: (vw - box.w * scale) / 2 - box.x * scale,
      y: (vh - box.h * scale) / 2 - box.y * scale,
    })
  }, [box])

  useEffect(() => {
    if (!fitRef) return
    fitRef.current = fitToView
    return () => {
      fitRef.current = null
    }
  }, [fitRef, fitToView])

  /* Auto-fit once per table set — a different source. Not on every `rects` recompute, or expanding a
     card's section would yank the reader's own pan and zoom. */
  const [fittedKey, setFittedKey] = useState<string | null>(null)
  useEffect(() => {
    if (fittedKey === tablesKey) return
    setFittedKey(tablesKey)
    fitToView()
  }, [fittedKey, tablesKey, fitToView])

  const zoomAround = (cx: number, cy: number, factor: number) => {
    setTransform((t) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor))
      const worldX = (cx - t.x) / t.scale
      const worldY = (cy - t.y) / t.scale
      return { scale, x: cx - worldX * scale, y: cy - worldY * scale }
    })
  }
  const zoomButton = (factor: number) => {
    const vp = viewportRef.current
    zoomAround(
      (vp?.clientWidth ?? 640) / 2,
      (vp?.clientHeight ?? CANVAS_H_GUESS) / 2,
      factor,
    )
  }

  /*
   * Wheel-zoom needs a native, non-passive listener. React registers `onWheel` as passive, and a
   * passive listener cannot `preventDefault` — so the JSX prop would zoom the canvas *and* scroll
   * the page behind it.
   */
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const rect = vp.getBoundingClientRect()
      zoomAround(ev.clientX - rect.left, ev.clientY - rect.top, ev.deltaY > 0 ? 0.9 : 1.1)
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    return () => vp.removeEventListener('wheel', onWheel)
  }, [])

  /* Drag-to-pan the background. A press that started on a card or an edge label is excluded, so its
     own click still fires instead of being swallowed by a pan. */
  const onPointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).closest('[data-canvas-interactive]')) return
    panRef.current = {
      startX: ev.clientX,
      startY: ev.clientY,
      origX: transform.x,
      origY: transform.y,
    }
    setPanning(true)
    ev.currentTarget.setPointerCapture(ev.pointerId)
  }
  const onPointerMove = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const p = panRef.current
    if (!p) return
    setTransform((t) => ({
      ...t,
      x: p.origX + (ev.clientX - p.startX),
      y: p.origY + (ev.clientY - p.startY),
    }))
  }
  const endPan = () => {
    panRef.current = null
    setPanning(false)
  }

  const mmScale = Math.min(MM_W / Math.max(1, contentW), MM_H / Math.max(1, contentH))
  const viewportWorld = {
    x: -transform.x / transform.scale,
    y: -transform.y / transform.scale,
    w: viewportSize.w / transform.scale,
    h: viewportSize.h / transform.scale,
  }
  const jumpToMinimapPoint = (clickX: number, clickY: number) => {
    const vp = viewportRef.current
    const vw = vp?.clientWidth ?? 640
    const vh = vp?.clientHeight ?? CANVAS_H_GUESS
    setTransform((t) => ({
      ...t,
      x: vw / 2 - (clickX / mmScale) * t.scale,
      y: vh / 2 - (clickY / mmScale) * t.scale,
    }))
  }

  if (tables.length === 0) {
    return (
      <div
        style={{
          height: CANVAS_CSS_HEIGHT,
          minHeight: CANVAS_MIN_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: MT.dim,
          fontSize: 13,
          backgroundColor: MT.inset,
          textAlign: 'center',
          padding: 24,
        }}
      >
        No profiled tables yet for this source. Browse and profile it on the Catalog tab — a
        model is drawn over the columns a run recorded, not over a table nobody has read.
      </div>
    )
  }

  return (
    <div>
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        style={{
          position: 'relative',
          height: CANVAS_CSS_HEIGHT,
          minHeight: CANVAS_MIN_HEIGHT,
          overflow: 'hidden',
          backgroundColor: MT.inset,
          backgroundImage: `radial-gradient(${MT.line} 1px, transparent 1px)`,
          backgroundSize: `${22 * transform.scale}px ${22 * transform.scale}px`,
          backgroundPosition: `${transform.x}px ${transform.y}px`,
          cursor: panning ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
          }}
        >
          <div style={{ position: 'relative', width: contentW, height: contentH }}>
            <svg
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
              }}
            >
              {edges.map((e) => {
                const from = rects[e.fromTableKey]
                const to = rects[e.toTableKey]
                if (!from || !to) return null
                const p1 = rectBoundaryToward(from, to)
                const p2 = rectBoundaryToward(to, from)
                const confirmed = e.status === 'confirmed'
                return (
                  <line
                    key={e.id}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={confirmed ? MT.green : MT.amber}
                    strokeWidth={1.8}
                    /* Dashed as well as amber: a suggestion and a declaration must be told apart
                       without relying on colour, the app's rule everywhere else. */
                    strokeDasharray={confirmed ? undefined : '5 4'}
                  />
                )
              })}
            </svg>

            {edges.map((e) => {
              const from = rects[e.fromTableKey]
              const to = rects[e.toTableKey]
              if (!from || !to) return null
              const p1 = rectBoundaryToward(from, to)
              const p2 = rectBoundaryToward(to, from)
              const confirmed = e.status === 'confirmed'
              return (
                <div
                  key={e.id}
                  role={onSelectEdge ? 'button' : undefined}
                  tabIndex={onSelectEdge ? 0 : undefined}
                  data-canvas-interactive={onSelectEdge ? '1' : undefined}
                  onClick={onSelectEdge ? () => onSelectEdge(e.id) : undefined}
                  onKeyDown={
                    onSelectEdge
                      ? (ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault()
                            onSelectEdge(e.id)
                          }
                        }
                      : undefined
                  }
                  style={{
                    position: 'absolute',
                    left: (p1.x + p2.x) / 2,
                    top: (p1.y + p2.y) / 2,
                    /* Above every card regardless of paint order: a label between two close cards
                       must never render behind one. */
                    zIndex: 5,
                    transform: 'translate(-50%, -50%)',
                    background: MT.card,
                    border: `1px solid ${confirmed ? MT.line2 : 'rgba(251,191,36,.5)'}`,
                    borderRadius: 999,
                    padding: '3px 9px',
                    fontSize: 10,
                    fontFamily: MT.mono,
                    color: confirmed ? MT.mut : MT.amber,
                    whiteSpace: 'nowrap',
                    width: 'max-content',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: onSelectEdge ? 'pointer' : undefined,
                    pointerEvents: onSelectEdge ? 'auto' : 'none',
                  }}
                >
                  {confirmed ? (
                    <>
                      <span style={{ color: MT.green }}>✓</span>
                      {e.name} · {e.cardinality ?? ''}
                    </>
                  ) : (
                    <>⋯ {e.name}? · pending</>
                  )}
                </div>
              )
            })}

            {tables.map((t) => {
              const entity = entityForTable(entities, t.tableKey)
              const touching = edges.filter(
                (e) => e.fromTableKey === t.tableKey || e.toTableKey === t.tableKey,
              )
              const relationshipRows: SectionRow[] = touching.map((e) => {
                const otherKey =
                  e.fromTableKey === t.tableKey ? e.toTableKey : e.fromTableKey
                const other = tables.find((x) => x.tableKey === otherKey)
                const otherEntity = other
                  ? entityForTable(entities, other.tableKey)
                  : null
                return {
                  id: e.id,
                  label: otherEntity?.entity_name ?? other?.tableId ?? otherKey,
                  onClick: onSelectEdge ? () => onSelectEdge(e.id) : undefined,
                }
              })
              const metricRows: SectionRow[] = (entity?.metrics ?? []).map(
                (m: ModelMetric) => ({ id: m.metric_id, label: m.name }),
              )
              return (
                <NodeCard
                  key={t.tableKey}
                  table={t}
                  entity={entity}
                  rect={rects[t.tableKey]}
                  selected={t.tableKey === selectedTableKey}
                  confirmedCount={touching.filter((e) => e.status === 'confirmed').length}
                  pendingCount={touching.filter((e) => e.status === 'pending').length}
                  relationshipRows={relationshipRows}
                  metricRows={metricRows}
                  scale={transform.scale}
                  onSelect={() => onSelect(t.tableKey)}
                  onDrag={(x, y) =>
                    setManualPositions((prev) => ({ ...prev, [t.tableKey]: { x, y } }))
                  }
                  onAddRelationship={
                    onAddRelationshipFor
                      ? () => onAddRelationshipFor(t.tableKey)
                      : undefined
                  }
                  onAddMetric={
                    onAddMetricFor ? () => onAddMetricFor(t.tableKey) : undefined
                  }
                />
              )
            })}
          </div>
        </div>

        {/* Zoom, bottom-left, so it never collides with the minimap bottom-right. */}
        <div
          style={{
            position: 'absolute',
            left: 10,
            bottom: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            background: MT.card,
            border: `1px solid ${MT.line2}`,
            borderRadius: MT.rS,
            boxShadow: MT.shadow,
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomButton(1.25)}
            style={{
              width: 26,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              borderBottom: `1px solid ${MT.line}`,
              color: MT.mut,
              cursor: 'pointer',
            }}
          >
            <PlusOutlined style={{ fontSize: 12 }} />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomButton(0.8)}
            style={{
              width: 26,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: 'none',
              color: MT.mut,
              cursor: 'pointer',
            }}
          >
            <MinusOutlined style={{ fontSize: 12 }} />
          </button>
        </div>

        {/* The minimap: the same rectangles at a scale, plus the region currently in view. */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Canvas minimap — click to jump"
          onClick={(ev) => {
            const rect = ev.currentTarget.getBoundingClientRect()
            jumpToMinimapPoint(ev.clientX - rect.left, ev.clientY - rect.top)
          }}
          style={{
            position: 'absolute',
            right: 10,
            bottom: 10,
            width: MM_W,
            height: MM_H,
            background: 'rgba(255,255,255,0.92)',
            border: `1px solid ${MT.line2}`,
            borderRadius: MT.rS,
            boxShadow: MT.shadow,
            cursor: 'pointer',
            overflow: 'hidden',
          }}
        >
          {Object.entries(rects).map(([tableKey, r]) => (
            <div
              key={tableKey}
              style={{
                position: 'absolute',
                left: r.x * mmScale,
                top: r.y * mmScale,
                width: Math.max(2, r.w * mmScale),
                height: Math.max(2, r.h * mmScale),
                background: tableKey === selectedTableKey ? MT.orange : MT.line2,
                borderRadius: 1,
              }}
            />
          ))}
          <div
            style={{
              position: 'absolute',
              left: viewportWorld.x * mmScale,
              top: viewportWorld.y * mmScale,
              width: viewportWorld.w * mmScale,
              height: viewportWorld.h * mmScale,
              border: `1.5px solid ${MT.orangeHi}`,
              background: MT.orangeSoft,
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          padding: '9px 14px',
          borderTop: `1px solid ${MT.line}`,
          fontSize: 11,
          color: MT.mut,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 16, height: 2, borderRadius: 2, background: MT.green }} />
          Confirmed relationship
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 16,
              height: 2,
              borderRadius: 2,
              backgroundImage: `repeating-linear-gradient(90deg, ${MT.amber} 0 4px, transparent 4px 7px)`,
            }}
          />
          Suggested, awaiting review
        </span>
        <ProvenanceBadge kind="human" full />
        <ProvenanceBadge kind="derived" full />
      </div>
    </div>
  )
}
