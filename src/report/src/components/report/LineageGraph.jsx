import React from 'react'
import { gTrim, gJoinShort } from '../../lib/format.js'

/* ══════════════════════════════════ THE GRAPH, DRAWN ═══════════════════════
   Three audiences read this one picture and each needs a different annotation on
   it, so the annotation is a CONTROL rather than three diagrams. A business reader
   wants the population at each step, an analyst wants the object and the join key,
   an architect wants how the link was established and how sure the platform is.
   Same nodes, same edges, same walk — the toggle changes what is written on them,
   which is why it is a toggle and not three tabs of content that would immediately
   drift apart.
   ========================================================================== */
export const GRAPH_LAYERS = [
  { id: 'biz', label: 'In business terms', hint: 'What each thing is, and how many of them your access admits.' },
  { id: 'data', label: 'Where it lives', hint: 'The object in the source system and the key the link is made on.' },
  { id: 'trust', label: 'How certain', hint: 'Whether each link is a source key, a cross-system match, or something read out of a document.' },
]

const GK_COLOR = {
  org: '--purple', core: '--orange', fin: '--cyan', proc: '--blue',
  ops: '--teal', doc: '--amber', reg: '--green',
}

/* Boxes are a fixed readable size and the CANVAS grows to fit them, rather than a
   fixed canvas that shrinks the boxes as more are drawn. The first version had it
   the other way round: a 1000-unit viewBox scaled into a 660px drawer put 11px
   labels on screen at about 7px, so the one thing the reader opened the window to
   look at was the least legible thing in it. */
const GBOX = { W: 198, H: 56, GAPX: 84, GAPY: 20, PAD: 24 }

/* Positions are COMPUTED, not taken from the fixture's x/y, because how many nodes
   are on screen depends on what the reader clicked — a three-node walk drawn on the
   full model's coordinates is three boxes marooned in whitespace. Depth from the
   entry point gives the columns; the curator's own y ordering breaks ties inside a
   column, so the shape stays recognisable when the reader widens from one figure's
   path to the whole model. */
function gLayout(nodes, edges) {
  const { W, H, GAPX, GAPY, PAD } = GBOX
  const byId = {}
  nodes.forEach(n => { byId[n.id] = n })
  const live = edges.filter(e => byId[e.from] && byId[e.to])

  const indeg = {}
  nodes.forEach(n => { indeg[n.id] = 0 })
  live.forEach(e => { indeg[e.to]++ })
  let roots = nodes.filter(n => !indeg[n.id]).map(n => n.id)
  /* Every node having an incoming edge means a cycle. Start somewhere and draw
     something: a diagram that renders slightly oddly beats an empty box where the
     evidence was supposed to be. */
  if (!roots.length) roots = [nodes[0].id]

  const depth = {}
  roots.forEach(r => { depth[r] = 0 })
  const q = roots.slice()
  let guard = nodes.length * live.length + 64
  while (q.length && guard-- > 0) {
    const id = q.shift()
    live.forEach(e => {
      if (e.from !== id) return
      const d = depth[id] + 1
      if (depth[e.to] == null || d > depth[e.to]) { depth[e.to] = d; q.push(e.to) }
    })
  }
  nodes.forEach(n => { if (depth[n.id] == null) depth[n.id] = 0 })

  const cols = []
  nodes.forEach(n => { (cols[depth[n.id]] = cols[depth[n.id]] || []).push(n) })
  cols.forEach(c => c.sort((a, b) => (a.y || 0) - (b.y || 0)))

  const rows = Math.max(...cols.map(c => c.length))
  const totalW = PAD * 2 + cols.length * W + (cols.length - 1) * GAPX
  const totalH = PAD * 2 + rows * H + (rows - 1) * GAPY

  const pos = {}
  cols.forEach((c, ci) => {
    const colH = c.length * H + (c.length - 1) * GAPY
    const top = (totalH - colH) / 2
    c.forEach((n, ri) => {
      pos[n.id] = [PAD + ci * (W + GAPX) + W / 2, top + ri * (H + GAPY) + H / 2]
    })
  })
  return { pos, totalW, totalH }
}

function boxEdge(cx, cy, tx, ty, hw, hh) {
  const dx = tx - cx, dy = ty - cy
  if (!dx && !dy) return [cx, cy]
  const s = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return [cx + dx * s, cy + dy * s]
}

export default function LineageGraph({ gNodes, gEdges, litN, litE, layer, selected, onNode }) {
  if (!gNodes.length) return <div className="mini">Nothing to draw for this figure.</div>

  const HW = GBOX.W / 2, HH = GBOX.H / 2
  /* Dim the surroundings only when there ARE surroundings — in the default focused
     view every box on screen is on the path, and dimming nothing while brightening
     everything just makes the picture noisy. */
  const dim = litN.size > 0 && gNodes.some(n => !litN.has(n.id))
  const { pos, totalW, totalH } = gLayout(gNodes, gEdges)
  const litOrder = [...litN]

  return (
    <svg className="linGraphSvg" viewBox={`0 0 ${totalW} ${totalH}`} role="img"
         style={{ maxWidth: totalW + 'px' }}
         aria-label="The path these figures were resolved through">
      <defs>
        <marker id="gArrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="var(--line2)" />
        </marker>
        <marker id="gArrowOn" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="var(--orange)" />
        </marker>
      </defs>

      {gEdges.filter(e => pos[e.from] && pos[e.to]).map(e => {
        const [ax, ay] = pos[e.from], [bx, by] = pos[e.to]
        const [x1, y1] = boxEdge(ax, ay, bx, by, HW, HH)
        const [x2, y2] = boxEdge(bx, by, ax, ay, HW, HH)
        const on = litE.has(e.id), fade = dim && !on
        /* The label is the ANNOTATION LAYER's answer for this edge, not a fixed
           caption: the relationship in business terms, the join it is made on, or
           how it was established and how sure. */
        const lab = layer === 'data' ? gJoinShort(e.join)
          : layer === 'trust' ? `${e.methodLabel} · ${(e.conf * 100).toFixed(0)}%`
          : e.label
        /* Colour is the METHOD. A key the source maintains, a match across
           systems, and something read out of a document are three different
           strengths of evidence, and the dash pattern carries it too so the
           distinction survives a greyscale print. */
        const col = e.method === 'extracted' ? 'var(--amber)'
          : e.method === 'resolved' ? 'var(--purple)' : 'var(--line2)'
        return (
          <g className={'gEdge' + (on ? ' on' : '')} opacity={fade ? 0.22 : 1} key={e.id}>
            <line x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)}
                  stroke={on ? 'var(--orange)' : col}
                  strokeWidth={on ? 2.4 : 1.4}
                  strokeDasharray={e.method === 'extracted' ? '5 3'
                    : e.method === 'resolved' ? '1 3' : undefined}
                  markerEnd={`url(#gArrow${on ? 'On' : ''})`} />
            <text x={((x1 + x2) / 2).toFixed(1)} y={((y1 + y2) / 2 - 4).toFixed(1)}
                  textAnchor="middle" fontSize="9"
                  fill={on ? 'var(--orange-hi)' : 'var(--dim)'}
                  style={{ paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: '3px' }}>
              {lab}
            </text>
          </g>
        )
      })}

      {gNodes.map(n => {
        const [cx, cy] = pos[n.id]
        const on = litN.has(n.id), fade = dim && !on, sel = selected === n.id
        const col = `var(${GK_COLOR[n.kind] || '--cyan'})`
        const sub = n.withheld ? 'withheld from you'
          : layer === 'data' ? gTrim(n.object, 30)
          : layer === 'trust' ? `${(n.conf * 100).toFixed(0)}% confident`
          : (n.recordsDisplay || '—')
        return (
          <g className={'gNode' + (sel ? ' sel' : '')} opacity={fade ? 0.32 : 1}
             onClick={() => onNode(n.id)} style={{ cursor: 'pointer' }} key={n.id}>
            <title>{n.biz}</title>
            <rect x={(cx - HW).toFixed(1)} y={(cy - HH).toFixed(1)}
                  width={HW * 2} height={HH * 2} rx="10"
                  fill={n.withheld ? 'var(--inset)' : 'var(--card2)'}
                  stroke={sel ? 'var(--orange-hi)' : on ? 'var(--orange-line)' : 'var(--line2)'}
                  strokeWidth={sel ? 2.4 : on ? 1.8 : 1}
                  strokeDasharray={n.withheld ? '4 3' : undefined} />
            <rect x={(cx - HW).toFixed(1)} y={(cy - HH).toFixed(1)}
                  width="5" height={HH * 2} rx="2.5" fill={col} />
            {/* The step number. A reader following a walk needs to know which end
                it starts at, and an arrowhead alone does not survive a fan-out. */}
            {on && litN.size > 1 ? (
              <>
                <circle cx={(cx + HW - 15).toFixed(1)} cy={(cy - HH + 15).toFixed(1)} r="9"
                        fill="var(--orange-soft)" stroke="var(--orange-line)" />
                <text x={(cx + HW - 15).toFixed(1)} y={(cy - HH + 18.5).toFixed(1)}
                      textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--orange-hi)">
                  {litOrder.indexOf(n.id) + 1}
                </text>
              </>
            ) : null}
            <text x={(cx - HW + 17).toFixed(1)} y={(cy - 4).toFixed(1)}
                  fontSize={n.label.length > 21 ? 12 : 13.5} fontWeight="600" fill="var(--text)">
              {gTrim(n.label, 24)}
            </text>
            <text x={(cx - HW + 17).toFixed(1)} y={(cy + 14).toFixed(1)} fontSize="11"
                  fill={n.withheld ? 'var(--amber)' : 'var(--mut)'}>
              {sub}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
