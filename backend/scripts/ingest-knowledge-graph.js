/*
 * Ingest 05_knowledge_graph/ into db.json's graph_studio.
 *
 * Two files, because the package now ships two:
 *
 *  - `knowledge_graph.json` — the graph itself, rebuilt on the spec-faithful AGB
 *    Layer 1 model. 189 nodes, 241 edges, three element classes.
 *  - `graph_studio.json` — the studio's own two surfaces: the review queue and the
 *    Query & sanity-check set, both grounded in the roster above.
 *
 * **What changed under the previous build, and why it is not a cosmetic reseed.**
 * The old graph turned distinct column values into nodes — 13 `WasteCode`, 9
 * `ViolationType`, 5 `EnforcementType`. The package now lists all three in
 * `not_nodes` with `was_wrongly` beside them: a code carried on a row is an
 * attribute of the shipment, not an entity with its own registry. So the whole
 * `dimension` origin class is gone *by decision*, not by omission, and the events
 * those columns described are nodes instead: 40 Evaluations, 38 Violations, 31
 * Enforcements. A canvas still drawing column-value nodes would be drawing the
 * modelling mistake this package exists to correct.
 *
 * **Thin instances carry no values.** A node is identity + provenance and nothing
 * else (Q39/Q43) — no attributes, no measures, no dates. Everything a sublabel or
 * an edge tooltip wants to say comes from `demo_display`, which is the package's
 * own cache of what Layer 2 would federate at query time. That separation is the
 * point of the model, so this script reads the two apart and only joins them for
 * display.
 *
 * Idempotent: run it again and it writes the same document.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const KG = 'vls_demo_data_package_2026-08-10/05_knowledge_graph/knowledge_graph.json'
const GS = 'vls_demo_data_package_2026-08-10/05_knowledge_graph/graph_studio.json'
/* Resolved against this module rather than the working directory: these are run through npm from
   the package root, and a cwd-relative path breaks the moment they are run from anywhere else. */
const DB = new URL('../db.json', import.meta.url)

const kg = JSON.parse(readFileSync(KG, 'utf8'))
const pkg = JSON.parse(readFileSync(GS, 'utf8'))
const db = JSON.parse(readFileSync(DB, 'utf8'))

const note = (...a) => console.log(' ', ...a)

/*
 * Display text, whitespace-normalised.
 *
 * A repo-wide removal of "VLS" once ran over the demo package and left labels
 * reading "  Texas Molecular" — a doubled space where the word had been. Nothing
 * errors, and a label drawn inside a circle shows every space it has. Ids are
 * deliberately *not* cleaned: they are opaque keys, both ends of an edge carry the
 * same damage, and rewriting them here would unmatch the edges.
 */
const clean = (text) => String(text).replace(/\s{2,}/g, ' ').trim()

/** The same, over every string in a nested literal. */
const cleanDeep = (value) =>
  typeof value === 'string'
    ? clean(value)
    : Array.isArray(value)
      ? value.map(cleanDeep)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDeep(v)]))
        : value

/* ---------------- 1. the roster, and the values that sit beside it ---------------- */

const roster = new Map(kg.nodes.map((n) => [n.id, n]))

/*
 * Every edge endpoint must be a node. The previous package shipped 20 that were
 * not — three alias names and an unitemised enforcement type — and a skipped edge
 * is silent: 17 facilities simply appeared to have no enforcement. This build
 * resolves cleanly, so the materialisation step that used to paper over it is gone.
 * The check stays, because its absence is what made the gap invisible.
 */
const dangling = new Set()
for (const e of kg.edges) {
  for (const end of [e.from, e.to]) if (!roster.has(end)) dangling.add(`${end} (via ${e.type})`)
}
if (dangling.size > 0) {
  throw new Error(
    `${dangling.size} edge endpoint(s) are not in the node roster: ${[...dangling].join(', ')}\n` +
      'Materialise them deliberately or fix the package — a skipped edge draws as nothing at all.',
  )
}
note(`${kg.nodes.length} nodes / ${kg.edges.length} edges · every endpoint resolves`)

/** Layer 2's federation result: what a value *would* be, kept out of Layer 1. */
const displayNode = (id) => kg.demo_display.nodes[id] ?? { attributes: {}, measures: {} }
const displayEdge = (id) => kg.demo_display.edges[id]?.properties ?? null

/** The resolution row for a raw name, which is where an alias's confidence lives. */
const resolutionByRaw = new Map(kg.entity_resolution.map((r) => [r.raw_value, r]))
/** …and by file, which is where an extracted document's confidence lives. */
const resolutionByFile = new Map(
  kg.entity_resolution
    .filter((r) => r.source_field.startsWith('unstructured: '))
    .map((r) => [r.source_field.slice('unstructured: '.length), r]),
)

/* ---------------- 2. degree, which is what a node's size means ---------------- */
const degree = new Map(kg.nodes.map((n) => [n.id, 0]))
for (const e of kg.edges) {
  degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
  degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
}
const isolated = kg.nodes.filter((n) => degree.get(n.id) === 0)
note(`${isolated.length} node(s) carry no edge:`, isolated.map((n) => n.id).join(', ') || 'none')

/* ---------------- 3. origin class: where the node came from ----------------
 *
 * Four classes, and they are the package's own build model rather than its type
 * list. Three of them are the thin instances split by what was read — a source row,
 * an uploaded document, a raw name resolved through the alias table — and the
 * fourth is the pair of element classes that are *not* instances at all: the
 * type-level concepts and the measure elements. Nine types would need nine hues,
 * and a categorical palette stops being reliably distinguishable past four while
 * any two nodes here can end up adjacent. The type rides on the sublabel and the
 * inspector instead.
 *
 * `dimension` (column value → node) used to be one of these. It is not a class
 * that lost its members by accident: `not_nodes` records the decision.
 */
const ROW_TYPES = ['Facility', 'Manifest', 'Evaluation', 'Violation', 'Enforcement']
function originClass(n) {
  if (n.element_class === 'concept' || n.element_class === 'measure_element') return 'schema'
  if (n.type === 'Document') return 'document'
  if (n.type === 'Alias') return 'alias'
  if (ROW_TYPES.includes(n.type)) return 'row'
  throw new Error(`no origin class for ${n.id} (${n.type} / ${n.element_class})`)
}

/* ---------------- 4. provenance: the Catalog object, named as the Catalog names it ----
 *
 * A node whose provenance is not on it is a claim the reader has to take on trust.
 * The document files come from `demo_display` rather than a map maintained here —
 * the old script carried a hand-written id → filename table, which is a second copy
 * of something the package already states.
 */
function sourceFor(n) {
  switch (n.type) {
    case 'Facility':
      return displayNode(n.id).attributes?.role === 'transporter'
        ? 'epa_hazwaste.e_manifest_all'
        : 'epa_hazwaste.FRS_Facility_profile'
    case 'Manifest':
      return 'epa_hazwaste.e_manifest'
    /* All three compliance events are rows of one view. RCRA_compliance carries the
       evaluation, the violations found in it and the enforcement that followed. */
    case 'Evaluation':
    case 'Violation':
    case 'Enforcement':
      return 'epa_hazwaste.RCRA_compliance'
    case 'Document':
      return `Compliance Docs · 08_unstructured/${displayNode(n.id).attributes.file}`
    case 'Alias':
      return `epa_hazwaste · ${resolutionByRaw.get(n.label)?.source_field ?? 'e_manifest DES FACILITY NAME'}`
    /* A concept was nominated, not read — there is no row behind it, and saying so
       is more honest than naming a table it did not come from. */
    case 'Concept':
      return 'epa_hazwaste · A-02 concept nomination'
    case 'Measure':
      return `epa_hazwaste · ${n.source}`
    default:
      throw new Error(`no provenance rule for ${n.type}`)
  }
}

/* ---------------- 5. what a node is, in one line ----------------
 *
 * Read out of `demo_display`, so every figure on a sublabel is the package's own
 * federated value and never a number this script decided.
 */
const money = (n) => `$${Number(n).toLocaleString('en-US')}`
const ROLE_LABEL = {
  receiver_tsdf: 'receiving TSDF',
  comparator_tsdf: 'comparator TSDF',
  generator: 'generator',
  transporter: 'transporter',
}
function sublabelFor(n) {
  const { attributes: a = {}, measures: m = {} } = displayNode(n.id)
  switch (n.type) {
    case 'Facility': {
      const bits = [ROLE_LABEL[a.role] ?? a.role, [a.city, a.state].filter(Boolean).join(', ')]
      if (m.penalty_usd) bits.push(money(m.penalty_usd))
      return bits.filter(Boolean).join(' · ')
    }
    case 'Manifest':
      return `manifest · ${m.total_quantity_tons} t · ${String(a.status ?? '').toLowerCase()}`
    case 'Evaluation':
      return `evaluation · lead agency ${a.lead_agency}`
    case 'Violation':
      return `violation · ${a.open ? 'open' : 'returned to compliance'}`
    case 'Enforcement':
      return `enforcement · ${a.agency} · ${money(m.penalty_usd ?? 0)}`
    /* The roster labels a document by its *type*, and three of the seven are
       "Consent Decree" — three identical circles. The file is what the Drive
       Catalog calls it, so that becomes the label and the type the sublabel. */
    case 'Document':
      return `${a.doc_type} · ${a.state}`
    case 'Alias':
      return `alias · resolved ${resolutionByRaw.get(n.label)?.confidence ?? '0.98'}`
    case 'Concept':
      return `concept · ${n.members} members`
    case 'Measure':
      return `measure · ${n.summable ? 'summable' : 'not summable'}`
    default:
      throw new Error(`no sublabel rule for ${n.type}`)
  }
}

/** A document is labelled by its file, which is how the Catalog lists it. */
const labelFor = (n) =>
  n.type === 'Document' ? displayNode(n.id).attributes.file : n.label

/* ---------------- 6. confidence ----------------
 *
 * Not invented. A row read out of a registry is a read fact (1.00), and so is a
 * concept somebody nominated; a document entity and an alias carry the resolution's
 * own number. The only elements below 0.85 are the ones a review row is open about,
 * and they take that row's confidence in step 7 — which is why the "conf < 0.85"
 * chip is small rather than empty.
 */
function confidenceFor(n) {
  if (n.type === 'Document') {
    return Number(resolutionByFile.get(displayNode(n.id).attributes.file)?.confidence ?? 0.9)
  }
  if (n.type === 'Alias') return Number(resolutionByRaw.get(n.label)?.confidence ?? 0.98)
  return 1
}

/* ---------------- 7. the review queue, and what it makes provisional ----------------
 *
 * The rows are the package's, not this script's: `graph_studio.json` states six
 * must-review decisions with their confidence, band, floor, evidence and their own
 * three action labels.
 *
 * **rq1 is the pivot, not a seventh row.** It is the identity merge — "Texas
 * Molecular LP ⇄ VLS Texas Molecular, merge to one facility?" — which is the one
 * decision that changes what every other row in the queue *means*, because it
 * decides whether pre-acquisition tonnage is this facility's history. The studio
 * already models exactly that as a separate precondition, so it is ingested as the
 * pivot and the queue holds the remaining five. The package's arithmetic agrees:
 * `lanes.mustReviewTotal` is 6, which is these 5 rows plus the pivot, and
 * `lanes.trust.pivot` is 1. Listing it in both places would ask one question twice
 * and let a reviewer answer it two ways.
 */
const PIVOT_ROW = 'rq1'

/*
 * Which canvas elements each row makes **provisional** — dashed on the canvas until
 * that row is decided.
 *
 * This is deliberately not `graph_refs`. A row's refs are the nodes it is *about*
 * (rq5 names the receiving TSDF because that is where the tonnage lands); the
 * elements below are the ones whose existence the row is still deciding. Marking
 * refs would draw the receiving TSDF as a 0.68-confidence proposal because a
 * waste-code modelling question mentioned it.
 *
 * Two rows deliberately mark nothing, and that is the honest answer for both:
 *  - rq5 *declines* a promotion. There is no WasteCode node to dash — its whole
 *    point is that the graph does not contain one.
 *  - rq6 is about three SHIPS_TO attachments that fell **below** the 0.60 floor, so
 *    they were never drawn. An orphan is an absence, and an absence has no circle.
 */
const PROVISIONAL = {
  rq2: { nodes: [], edges: ['DESC:FAC:NCD844706749:DOC:chemours_cd'] },
  rq3: {
    nodes: ['DOC:stericycle_cp', 'DOC:stericycle_set'],
    edges: [
      'DESC:FAC:ILR000067890:DOC:stericycle_cp',
      'DESC:FAC:ILR000067890:DOC:stericycle_set',
    ],
  },
  rq4: { nodes: ['MEAS:quantity_tons'], edges: ['AGG:quantity_tons'] },
  rq5: { nodes: [], edges: [] },
  rq6: { nodes: [], edges: [] },
}

/*
 * A row states its own three buttons, so the choice a reviewer makes is named in
 * that row's terms — "Keep distinct", not "Reject". The *choice* behind each button
 * is still one of the fixed set the server validates, because what the studio
 * records has to mean the same thing on every row: `approve` keeps the element,
 * `correct` marks it studio-authored, `reject` drops it. The mapping is here rather
 * than by position, because the package orders its labels by what a reviewer is most
 * likely to pick and that is not the order of the choices.
 */
const ACTION_CHOICES = {
  rq1: { 'Approve merge': 'approve', 'Keep distinct': 'reject', 'Correct alias…': 'correct' },
  rq2: { Approve: 'approve', 'Correct…': 'correct', Reject: 'reject' },
  rq3: {
    'Attach to transporter': 'approve',
    'Route to entity-map owner…': 'correct',
    Reject: 'reject',
  },
  rq4: {
    'Declare basis = manifest': 'approve',
    'Declare basis = summary': 'correct',
    'Reject — keep separate': 'reject',
  },
  rq5: {
    'Keep as manifest attribute': 'approve',
    'Promote to dimension nodes': 'correct',
    Defer: 'reject',
  },
  rq6: {
    'Confirm match': 'approve',
    'Pick a different facility…': 'correct',
    'Leave orphaned': 'reject',
  },
}

/** The package writes `why` as HTML; the studio renders text. */
const stripTags = (html) =>
  clean(String(html).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))

const actionsFor = (row) => {
  const map = ACTION_CHOICES[row.id]
  if (!map) throw new Error(`no action mapping for ${row.id} — add one rather than guessing`)
  return row.actions.map((label) => {
    const choice = map[label]
    if (!choice) throw new Error(`${row.id} offers "${label}", which maps to no recorded choice`)
    return { choice, label: clean(label) }
  })
}

const queueRows = pkg.review_queue.filter((r) => r.id !== PIVOT_ROW)
const reviewItems = queueRows.map((r) => ({
  item_id: r.id,
  kind: r.kind,
  title: clean(r.title),
  detail: stripTags(r.why),
  confidence: r.conf,
  /* The package's own band. It is not derived from `conf` here: a band is the
     reviewer's triage lane and the number is the deriver's — deriving one from the
     other would let a threshold edit silently re-triage the queue. */
  band: r.band,
  floor: clean(r.floor),
  /* Kept for the shape the rest of the studio reads, and for a row that arrives
     without its own labels. Every ingested row states its actions. */
  action_set: 'standard',
  actions: actionsFor(r),
  evidence: cleanDeep(r.evidence),
  graph_refs: r.graph_refs,
  justification: Boolean(r.justify),
}))

/** node/edge id → the review row that makes it provisional. */
const nodeReview = new Map()
const edgeReview = new Map()
for (const [rowId, marks] of Object.entries(PROVISIONAL)) {
  if (!reviewItems.some((i) => i.item_id === rowId)) {
    throw new Error(`PROVISIONAL names ${rowId}, which is not a queue row`)
  }
  for (const id of marks.nodes) {
    if (!roster.has(id)) throw new Error(`${rowId} marks node ${id}, which is not in the roster`)
    nodeReview.set(id, rowId)
  }
  for (const id of marks.edges) {
    if (!kg.edges.some((e) => e.id === id)) {
      throw new Error(`${rowId} marks edge ${id}, which is not in the graph`)
    }
    edgeReview.set(id, rowId)
  }
}
const confidenceOfRow = new Map(reviewItems.map((i) => [i.item_id, i.confidence]))

/* ---------------- 8. layout ----------------
 *
 * A deterministic force layout, run here rather than in the browser: positions come
 * from the server so a reload draws the same picture, and a layout that settled
 * differently on every load would move a node the reader had just found. No
 * randomness anywhere — the seeds are the node's index and its type's sector.
 *
 * The box grew with the roster. 189 circles needing 26px of clearance do not fit in
 * the 1240×780 the 93-node graph used — at that size the separation pass cannot
 * converge, and it says so rather than shipping overlapping circles. The component
 * measures its viewBox from what the server sent, so this is one number here.
 */
const W = 1900
const H = 1180
/* sqrt of degree, so the area is roughly proportional to the relationships carried
   rather than the diameter — a linear radius would draw the 61-edge hub as fifteen
   times the width of a 4-edge generator and read as a claim about importance. */
const radiusFor = (id) => Math.min(66, Math.max(17, 17 + 6.5 * Math.sqrt(degree.get(id) ?? 0)))

/*
 * Each type starts in its own sector, so the settled picture is legible rather than
 * merely valid: the custody chain inside, the compliance events out at the rim, the
 * schema elements in their own quadrant.
 */
const SECTOR = {
  Manifest: { from: 250, to: 320, ring: 200 },
  Facility: { from: 20, to: 340, ring: 360 },
  Alias: { from: 165, to: 205, ring: 150 },
  Document: { from: 330, to: 20, ring: 470 },
  Evaluation: { from: 30, to: 130, ring: 560 },
  Violation: { from: 130, to: 230, ring: 560 },
  Enforcement: { from: 230, to: 320, ring: 560 },
  Concept: { from: 200, to: 250, ring: 300 },
  Measure: { from: 145, to: 165, ring: 260 },
}
const HUB = 'FAC:TXD000719518'
const seeded = []
const perType = new Map()
for (const n of kg.nodes) {
  const list = perType.get(n.type) ?? []
  list.push(n)
  perType.set(n.type, list)
}
for (const [type, list] of perType) {
  const s = SECTOR[type]
  if (!s) throw new Error(`no layout sector for ${type}`)
  const span = ((s.to - s.from + 360) % 360) || 360
  list.forEach((n, i) => {
    if (n.id === HUB) {
      seeded.push({ id: n.id, x: W / 2, y: H / 2, r: radiusFor(n.id), pinned: true })
      return
    }
    const t = list.length === 1 ? 0.5 : i / (list.length - 1)
    const rad = ((s.from + span * t) * Math.PI) / 180
    /* The crowded types alternate across three rings — 49 facilities on one circle
       would collide with every neighbour and the relaxation would spend its whole
       budget untangling them instead of settling. */
    const ring = list.length > 12 ? s.ring + (i % 3) * 105 : s.ring
    seeded.push({
      id: n.id,
      x: W / 2 + Math.cos(rad) * ring,
      y: H / 2 + Math.sin(rad) * ring * 0.62,
      r: radiusFor(n.id),
      pinned: false,
    })
  })
}

const pos = new Map(seeded.map((p) => [p.id, p]))
const springs = kg.edges.map((e) => [pos.get(e.from), pos.get(e.to)])

const clamp = () => {
  for (const p of seeded) {
    p.x = Math.min(W - p.r - 6, Math.max(p.r + 6, p.x))
    p.y = Math.min(H - p.r - 6, Math.max(p.r + 6, p.y))
  }
}

for (let step = 0; step < 600; step += 1) {
  const cool = 1 - step / 600
  // Repulsion: every pair, weighted by the two radii so big nodes claim more room.
  for (let i = 0; i < seeded.length; i += 1) {
    for (let j = i + 1; j < seeded.length; j += 1) {
      const a = seeded[i]
      const b = seeded[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.01
      const want = a.r + b.r + 26
      if (d > want * 2.4) continue
      const push = ((want - d) / d) * (d < want ? 0.5 : 0.06) * cool
      dx *= push
      dy *= push
      if (!a.pinned) {
        a.x -= dx
        a.y -= dy
      }
      if (!b.pinned) {
        b.x += dx
        b.y += dy
      }
    }
  }
  // Attraction along the edges that exist.
  for (const [a, b] of springs) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 0.01
    const want = a.r + b.r + 90
    const pull = ((d - want) / d) * 0.045 * cool
    if (!a.pinned) {
      a.x += dx * pull
      a.y += dy * pull
    }
    if (!b.pinned) {
      b.x -= dx * pull
      b.y -= dy * pull
    }
  }
  // Keep everything on the canvas; a node half off the edge is a broken drawing.
  clamp()
}

/*
 * Separation pass. The force loop balances pull against push and settles with a few
 * circles still touching; this only ever pushes overlapping pairs apart, so it
 * converges. Two circles that overlap read as one node with a bite out of it — the
 * drawing has to be clear before it can be pretty.
 */
let converged = 0
for (let pass = 1; pass <= 900; pass += 1) {
  let moved = false
  for (let i = 0; i < seeded.length; i += 1) {
    for (let j = i + 1; j < seeded.length; j += 1) {
      const a = seeded[i]
      const b = seeded[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.01
      /* 26px, not a hair's breadth: a node too small to hold its own label is
         labelled underneath, and that text needs somewhere to go.
         The tolerance is what lets this terminate: a pair pushed to exactly 26px
         apart lands a rounding step short on the next read, so an exact test reports
         "did not converge" over a gap that is in fact satisfied. */
      const gap = a.r + b.r + 26 - d
      if (gap <= 0.01) continue
      moved = true
      // The pinned hub does not move, so its neighbour takes the whole correction.
      const share = a.pinned || b.pinned ? 1 : 0.5
      const ux = (dx / d) * gap * share
      const uy = (dy / d) * gap * share
      if (!a.pinned) {
        a.x -= ux
        a.y -= uy
      }
      if (!b.pinned) {
        b.x += ux
        b.y += uy
      }
    }
  }
  clamp()
  if (!moved) {
    converged = pass
    break
  }
}

/* Reported as the tightest gap, not as "overlap ≥ 0": a check whose good answer is
   its own initial value cannot tell you it ran. */
let tightest = Infinity
for (let i = 0; i < seeded.length; i += 1) {
  for (let j = i + 1; j < seeded.length; j += 1) {
    const a = seeded[i]
    const b = seeded[j]
    tightest = Math.min(tightest, Math.hypot(b.x - a.x, b.y - a.y) - a.r - b.r)
  }
}
note(
  `layout ${W}×${H} · separation ${converged ? `converged after ${converged} pass(es)` : 'did NOT converge'}` +
    ` · tightest gap between two circles ${tightest.toFixed(1)}px`,
)
if (tightest < 0) {
  throw new Error(
    'circles overlap — the separation pass did not converge. Grow W/H rather than ' +
      'lowering the clearance: the clearance is what the beneath-labels need.',
  )
}

/*
 * The other way this drawing goes wrong: a node too small to hold its own label is
 * labelled *underneath*, and that text can land on the next circle. Counted here
 * because the browser will not tell me — an SSR render shows the markup, not the
 * collisions. LABEL_INSIDE_AT and the 9.5px beneath-label in GraphCanvas.tsx are
 * what these numbers describe.
 */
const INSIDE_AT = 27
const labels = seeded
  .filter((p) => p.r < INSIDE_AT)
  .map((p) => {
    const label = labelFor(roster.get(p.id))
    return { ...p, w: Math.min(22, label.length) * 5.1, mid: p.y + p.r + 9.5 }
  })
let hits = 0
for (const l of labels) {
  for (const other of seeded) {
    if (other.id === l.id) continue
    if (Math.abs(other.x - l.x) < other.r + l.w / 2 && Math.abs(other.y - l.mid) < other.r + 6) {
      hits += 1
    }
  }
}
note(
  `${labels.length} nodes are too small to hold their label · ${hits} of those labels ` +
    'would cross another circle if all were drawn at once (which is why the component ' +
    'draws them on hover or once a filter cuts the view to 28 nodes)',
)

/* ---------------- 9. write the canvas ---------------- */
const round = (n) => Math.round(n * 10) / 10

const canvasNodes = kg.nodes.map((n) => {
  const p = pos.get(n.id)
  const item = nodeReview.get(n.id) ?? null
  return {
    node_id: n.id,
    label: clean(labelFor(n)),
    sublabel: clean(sublabelFor(n)),
    type: n.type,
    /* The package's own element class, carried through so the inspector can say
       whether a node is an instance, a type or a measure — the distinction the whole
       rebuild is about, and one the origin colour folds two of together. */
    element_class: n.element_class,
    group: originClass(n),
    source: clean(sourceFor(n)),
    // A proposed element carries the deriver's confidence, which is its row's.
    confidence: item ? confidenceOfRow.get(item) : confidenceFor(n),
    degree: degree.get(n.id) ?? 0,
    r: round(p.r),
    x: round(p.x),
    y: round(p.y),
    ...(item ? { review_item_id: item } : {}),
  }
})

/* Structural facts for the three edge kinds Layer 2 has no values for. A
   relationship with no evidence on it is an assertion, and for these the evidence is
   topological rather than numeric — so it says that instead of showing an empty
   tooltip. */
const STRUCTURAL_DETAIL = {
  FOUND_IN: 'violation carried on this evaluation’s row',
  VIOLATION_AT: 'violation recorded at this facility',
  AGGREGATES_OVER: 'measure element aggregates over this concept',
}
const canvasEdges = kg.edges.map((e) => {
  const props = displayEdge(e.id)
  const item = edgeReview.get(e.id) ?? null
  return {
    edge_id: e.id,
    from: e.from,
    to: e.to,
    label: e.type,
    detail: props
      ? clean(
          Object.entries(props)
            .map(([k, v]) => `${k}=${v}`)
            .join('; '),
        )
      : (STRUCTURAL_DETAIL[e.type] ?? ''),
    ...(item ? { review_item_id: item } : {}),
  }
})

db.graph_studio.canvas = { nodes: canvasNodes, edges: canvasEdges }
db.graph_studio.review_items = reviewItems

/* ---------------- 10. the pivot ----------------
 *
 * rq1, promoted. Its `why` is the package's account of the merge; the two options
 * are its own first two actions, and each states the consequence the package's
 * roster makes checkable — 3 RESOLVES_TO edges either stand or they do not.
 */
const pivotRow = pkg.review_queue.find((r) => r.id === PIVOT_ROW)
if (!pivotRow) throw new Error(`the package no longer ships ${PIVOT_ROW} — the pivot came from it`)
const resolvesTo = kg.edges.filter((e) => e.type === 'RESOLVES_TO').length

db.graph_studio.pivot = cleanDeep({
  pivot_id: 'ER-TXD000719518',
  alternative_id: 'ER-TXD000719518-SPLIT',
  title: 'Entity resolution: Texas Molecular LP vs VLS Texas Molecular',
  detail: stripTags(pivotRow.why),
  /* Why it is a pivot and not a queue row: it is measured against, not decided
     alongside. Stated here because the page prints it. */
  why_pivot:
    'Every inbound-flow row in this queue is measured against this facility’s history, ' +
    'so the queue cannot be read until the merge is settled.',
  confidence: pivotRow.conf,
  band: pivotRow.band,
  floor: clean(pivotRow.floor),
  evidence: cleanDeep(pivotRow.evidence),
  graph_refs: pivotRow.graph_refs,
  options: [
    {
      option_id: 'ER-TXD000719518',
      label: 'One facility — the alias table resolves both names',
      consequence:
        `Pre- and post-acquisition manifests roll up to one node; the ${resolvesTo} RESOLVES_TO ` +
        'edges stand and inbound totals span the whole sampled period.',
    },
    {
      option_id: 'ER-TXD000719518-SPLIT',
      label: 'Two facilities — split at the acquisition date',
      consequence:
        'Pre-2023 shipments attach to a separate legacy node; every SHIPS_TO total is ' +
        're-scoped and the comparator set changes.',
    },
  ],
})

/* ---------------- 11. the sanity-check set ----------------
 *
 * The package ships five questions with the sub-graph each one walks. They are
 * recorded answers, and they are served the way `ask_answers` is: matched on the
 * question, named as recorded, and falling through to the live walk when nothing
 * matches. A canned answer that could not be told from a derived one would be the
 * one thing this tab exists to rule out.
 *
 * **sc3's prose is corrected, and only its prose.** Its verdict body, one context
 * chip and its Cypher plan still name `HAS_ENFORCEMENT` and an `EnforcementType`
 * node — the previous build's shape. Its own traversal correctly walks
 * `ENFORCEMENT_AGAINST` to an `Enforcement` event, and the roster has no
 * EnforcementType at all, so the package contradicts itself here and only the
 * traversal resolves. A plan naming an edge type the graph does not have is a
 * second truth, and `check-docs` now refuses one.
 */
const PROSE_FIXES = [
  ['HAS_ENFORCEMENT edges (count + total_penalty)', 'ENFORCEMENT_AGAINST edges from Enforcement events'],
  ['generator → HAS_ENFORCEMENT → EnforcementType', 'Enforcement → ENFORCEMENT_AGAINST → generator'],
  ["(f:Facility)-[:HAS_ENFORCEMENT]-&gt;(:EnforcementType)", "(e:Enforcement)-[:ENFORCEMENT_AGAINST]-&gt;(f:Facility)"],
  ['count · total_penalty', 'enf_type_desc · penalty_usd'],
]
const fixProse = (text) => {
  let out = String(text)
  for (const [was, now] of PROSE_FIXES) out = out.split(was).join(now)
  return out
}

const decodeEntities = (text) =>
  String(text).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const edgeById = new Map(kg.edges.map((e) => [e.id, e]))
const sanityChecks = pkg.sanity_checks.map((s) => {
  for (const n of s.traversal.nodes) {
    if (!roster.has(n.id)) throw new Error(`${s.id} walks node ${n.id}, which is not in the roster`)
  }
  for (const e of s.traversal.edges) {
    if (!edgeById.has(e.id)) throw new Error(`${s.id} walks edge ${e.id}, which is not in the graph`)
  }
  return cleanDeep({
    check_id: s.id,
    /* The hero question it is a check *on*. A sanity check is one question you
       already know the answer to, and these are the ones the brief committed to. */
    hero_question_id: s.hero_ref,
    question: s.question,
    verdict: fixProse(s.verdict),
    verdict_body: fixProse(s.verdictBody),
    context: s.context.map((c) => ({
      chip: c.chip,
      label: fixProse(c.label),
      meta: fixProse(c.meta),
      ok: c.ok,
    })),
    // Cypher, as the package wrote it, with its HTML entities decoded for a <pre>.
    plan: decodeEntities(fixProse(s.plan)),
    cost_usd: s.cost,
    budget_usd: s.budget,
    // The sub-graph the answer walked; this is what lights up on the canvas.
    path: s.traversal.nodes.map((n) => n.id),
    edges_used: s.traversal.edges.map((e) => e.id),
  })
})
db.graph_studio.sanity_checks = sanityChecks

/* ---------------- 12. the lanes, and the pools the samples are drawn from ----------------
 *
 * The totals are the package's trust lanes, not numbers chosen here. `must_review`
 * is exactly the five ingested rows, so nothing synthesised pads the lane a reviewer
 * has to clear — the spot-check samples below it are still generated, and are named
 * samples for that reason.
 */
const { trust } = pkg.lanes
db.graph_studio.generated = {
  ...db.graph_studio.generated,
  must_review_total: reviewItems.length,
  confirmed_total: trust.confirmedFyi,
  auto_approved_total: trust.autoApprove,
  spot_check_quota: 9,
  sample_size: 6,
  /* The subjects and predicates a synthesised spot-check row names are this graph's
     own types, so a sampled row reads as belonging to the same graph as the canvas. */
  subjects: [...new Set(kg.nodes.map((n) => n.type))],
  predicates: [...new Set(kg.edges.map((e) => e.type))],
}

writeFileSync(DB, `${JSON.stringify(db, null, 2)}\n`, 'utf8')

const byClass = {}
for (const n of canvasNodes) byClass[n.group] = (byClass[n.group] ?? 0) + 1
note(`wrote ${canvasNodes.length} nodes / ${canvasEdges.length} edges`, JSON.stringify(byClass))
note(
  `queue: ${reviewItems.length} rows + 1 pivot = ${pkg.lanes.mustReviewTotal} must-review decisions` +
    ` · confirmed ${trust.confirmedFyi} · auto-approved ${trust.autoApprove}`,
)
note(
  `proposed: ${canvasNodes.filter((n) => n.review_item_id).length} nodes, ` +
    `${canvasEdges.filter((e) => e.review_item_id).length} edges` +
    ` · conf < 0.85: ${canvasNodes.filter((n) => n.confidence < 0.85).length}`,
)
note(`sanity checks: ${sanityChecks.length} recorded, ${sanityChecks.reduce((n, s) => n + s.edges_used.length, 0)} edges walked`)
console.log('ok')
