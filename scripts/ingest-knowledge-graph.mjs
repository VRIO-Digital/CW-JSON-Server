/*
 * Ingest 05_knowledge_graph/knowledge_graph.json into db.json's graph_studio.
 *
 * The canvas was still the old utility-maintenance seed (Riverbend WWTP, Pump
 * P-204, MSA-2024-117) — a picture of a graph this tenant does not have. This
 * replaces it with the demo package's real knowledge graph, and reseeds the three
 * things that must agree with it: the review queue (a proposed node exists because
 * a row is open), the pivot, and the pools the rest of the queue is synthesised
 * from.
 *
 * Idempotent: run it again and it writes the same document.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const KG = 'vls_demo_data_package_2026-08-10/05_knowledge_graph/knowledge_graph.json'
const DB = 'mock-server/db.json'

const kg = JSON.parse(readFileSync(KG, 'utf8'))
const db = JSON.parse(readFileSync(DB, 'utf8'))

const note = (...a) => console.log(' ', ...a)

/*
 * Display text, whitespace-normalised.
 *
 * The repo-wide removal of "VLS" ran over the demo package too, so the roster now
 * holds labels like "  Texas Molecular" — a doubled space where the word was. The
 * word is the user's call; the gap it left is not text anybody meant to ship, and a
 * label rendered inside a circle shows every space. Ids are deliberately *not*
 * cleaned: they are opaque keys, both sides of an edge carry the same damage, and
 * rewriting them here would unmatch the edges.
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

/* ---------------- 1. nodes the edges point at but the roster omits ----------------
 *
 * Two kinds, and both are the package's own doing rather than a bug to paper over:
 *
 *  - `NAME:…` alias nodes. `RESOLVES_TO` is declared as "from raw name / alias",
 *    and the Entity Resolution sheet names all three, so the endpoint kind is
 *    specified even though the roster only lists resolved entities.
 *  - `ENF:(various)`. 17 HAS_ENFORCEMENT edges carry it. Dropping them would draw
 *    17 facilities as having no enforcement, which is the opposite of what the
 *    source says; retargeting them at one of the five real types would invent a
 *    fact. It is materialised as the placeholder it is, and says so.
 */
const roster = new Map(kg.nodes.map((n) => [n.id, n]))
const missing = new Map()
for (const e of kg.edges) {
  for (const end of [e.from, e.to]) {
    if (!roster.has(end) && !missing.has(end)) missing.set(end, e.type)
  }
}
note(`edges reference ${missing.size} node(s) the roster omits:`, [...missing.keys()].join(', '))

const resolutionFor = (rawValue) =>
  kg.entity_resolution.find((r) => r.raw_value === rawValue) ?? null

const materialised = [...missing.entries()].map(([id, viaEdgeType]) => {
  if (id.startsWith('NAME:')) {
    const raw = id.slice('NAME:'.length)
    const r = resolutionFor(raw)
    return {
      id,
      type: 'Alias',
      label: raw,
      properties: {
        role: 'alias',
        source_field: r?.source_field ?? 'e_manifest DES FACILITY NAME',
        method: r?.method ?? 'alias table + EPA ID match',
        confidence: r?.confidence ?? 'High (0.98)',
      },
      _via: viaEdgeType,
    }
  }
  return {
    id,
    type: 'EnforcementType',
    label: 'Enforcement (type not itemised)',
    properties: { role: 'placeholder', note: 'RCRA_compliance reports a count and a penalty without the type' },
    _via: viaEdgeType,
  }
})
const nodes = [...kg.nodes, ...materialised]

/* ---------------- 2. degree, which is what a node's size means ---------------- */
const degree = new Map(nodes.map((n) => [n.id, 0]))
for (const e of kg.edges) {
  degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
  degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
}
const isolated = nodes.filter((n) => degree.get(n.id) === 0)
note(
  `${isolated.length} node(s) carry no sampled edge:`,
  `${isolated.filter((n) => n.type === 'WasteCode').length} waste codes,`,
  `${isolated.filter((n) => n.type === 'ViolationType').length} violation types,`,
  `${isolated.filter((n) => !['WasteCode', 'ViolationType'].includes(n.type)).length} other`,
)

/* ---------------- 3. where each node came from ----------------
 *
 * The catalogue object, named as the catalogue names it. This is the answer to
 * "which source is this?" — a node whose provenance is not on the node is a claim
 * the reader has to take on trust.
 */
const DOC_FILES = {
  'DOC:denka_cafo': 'rcra-06-2025-0910-denka-performance-elastomer-llc-cafo.pdf',
  'DOC:chemours_cd': 'chemours-cd.pdf',
  'DOC:chemours_cp': 'chemours-cp.pdf',
  'DOC:pcs_cd': 'pcsnitrogenfertilizerlp-cd.pdf',
  'DOC:simplot_cd': 'simplot-don-cd-app9-modification-june-2025-cbi-redacted.pdf',
  'DOC:stericycle_cp': 'u.s._v._stericycle_complaint.pdf',
  'DOC:stericycle_set': 'united-states-v-stericycle-stipulation-and-order-of-settlement-jan-17-2025.pdf',
}

/** `origin` is the colour class; `source` is the catalogue object, verbatim. */
function provenance(n) {
  switch (n.type) {
    case 'Facility':
      return n.properties.role === 'transporter'
        ? { origin_class: 'row', source: 'epa_hazwaste.e_manifest_all' }
        : { origin_class: 'row', source: 'epa_hazwaste.FRS_Facility_profile' }
    case 'Manifest':
      return { origin_class: 'row', source: 'epa_hazwaste.e_manifest' }
    case 'WasteCode':
      return { origin_class: 'dimension', source: 'epa_hazwaste.e_manifest · WASTE CODE' }
    case 'EnforcementType':
      return { origin_class: 'dimension', source: 'epa_hazwaste.RCRA_compliance · ENF_TYPE_DESC' }
    case 'ViolationType':
      return { origin_class: 'dimension', source: 'epa_hazwaste.RCRA_compliance · VIOL_TYPE' }
    case 'Document':
      return {
        origin_class: 'document',
        source: `Compliance Docs · 08_unstructured/${DOC_FILES[n.id] ?? n.properties.role}`,
      }
    case 'Alias':
      return { origin_class: 'alias', source: `epa_hazwaste · ${n.properties.source_field}` }
    default:
      throw new Error(`no provenance rule for ${n.type}`)
  }
}

/* ---------------- 4. what a node is, in one line ---------------- */
const money = (n) => `$${Number(n).toLocaleString('en-US')}`
function sublabelFor(n) {
  const p = n.properties ?? {}
  switch (n.type) {
    case 'Facility': {
      const role =
        p.role === 'receiver_tsdf'
          ? 'receiving TSDF'
          : p.role === 'comparator_tsdf'
            ? 'comparator TSDF'
            : p.role
      const bits = [`${role} · ${p.state}`]
      if (p.inbound_manifests) bits.push(`${p.inbound_manifests} manifests · ${p.inbound_tons} t`)
      else if (p.penalty_usd) bits.push(money(p.penalty_usd))
      return bits.join(' · ')
    }
    case 'Manifest':
      return `received · ${p.inbound_tons} t`
    /* The roster's own label for a document is its *type*, and three of the seven
       are "Consent Decree" — three identical circles. The file name is what the
       Drive catalogue calls it, so that becomes the label and the type the sublabel. */
    case 'Document':
      return n.label
    case 'Alias':
      return `alias · ${p.confidence?.toLowerCase() ?? 'resolved'}`
    case 'WasteCode':
      return 'EPA waste code'
    case 'EnforcementType':
      return p.role === 'placeholder' ? 'placeholder · type not itemised' : 'enforcement type'
    case 'ViolationType':
      return 'violation type'
    default:
      throw new Error(`no sublabel rule for ${n.type}`)
  }
}

/** A document is labelled by its file, which is how the catalogue lists it. */
const labelFor = (n) => (n.type === 'Document' ? (DOC_FILES[n.id] ?? n.label) : n.label)

/* ---------------- 5. confidence ----------------
 *
 * Not invented: a row or a distinct column value is a read fact (1.00); a document
 * entity carries the extraction's own confidence; an alias carries the resolution's.
 * A proposed element carries the deriver's, and those are the only ones under 0.85 —
 * which is why the "conf < 0.85" chip is small rather than empty.
 */
const extractionConfidence = new Map()
for (const e of kg.edges) {
  if (e.type !== 'DESCRIBED_BY') continue
  const c = Number(/confidence=([\d.]+)/.exec(e.properties)?.[1] ?? 0.9)
  extractionConfidence.set(e.to, c)
}
function confidenceFor(n) {
  if (n.type === 'Document') return extractionConfidence.get(n.id) ?? 0.9
  if (n.type === 'Alias') {
    const m = /\(([\d.]+)\)/.exec(n.properties.confidence ?? '')
    return m ? Number(m[1]) : 0.98
  }
  if (n.properties?.role === 'placeholder') return 0.58
  return 1
}

/* ---------------- 6. the review queue, and what it makes provisional ----------------
 *
 * Every one of these is a real question this package raises, not a fabricated row:
 * the enforcement placeholder, the transporter flow read out of a names column, two
 * documents resolving to one node by name, and a causal reading of penalties.
 */
const STERICYCLE = 'FAC:ILR000067890'
const reviewItems = [
  {
    item_id: 'rv-enf-unitemised',
    kind: 'entity',
    title: 'EnforcementType — "type not itemised"',
    detail:
      '17 HAS_ENFORCEMENT edges name a facility, a count and a penalty but no type, so they land on a placeholder rather than one of the five real values. Approving keeps it as an explicit unknown; correcting means splitting it by re-reading ENF_TYPE_DESC. Adding a dimension member changes the schema → floor review.',
    confidence: 0.58,
    floor: 'schema-changing',
    action_set: 'standard',
    justification: true,
  },
  {
    item_id: 'rv-transports-to',
    kind: 'relationship',
    title: 'Facility (transporter) → TRANSPORTS_TO → Facility (receiving TSDF)',
    detail:
      'Aggregated custody flow read out of e_manifest_all TRANSPORTER_NAMES, a semicolon-separated free-text column — the loads_carried totals are name-matched, not EPA-ID-matched. Evidence: 8 transporters, 196–220 loads each.',
    confidence: 0.81,
    floor: 'aggregate from free text',
    action_set: 'standard',
    justification: false,
  },
  {
    item_id: 'rv-stericycle-resolution',
    kind: 'entity',
    title: 'Stericycle Environmental Solutions — one node, two documents',
    detail:
      'A complaint and a settlement both resolve onto this Facility by NER name match at 0.90; no EPA ID appears in either document. If the complaint names a different Stericycle site, the settlement evidence is attached to the wrong facility.',
    confidence: 0.79,
    floor: 'entity resolution',
    action_set: 'standard',
    justification: false,
  },
  {
    item_id: 'rv-penalty-causal',
    kind: 'relationship',
    title: 'Enforcement penalty → drives → inbound tonnage',
    detail:
      'Causal claims always see a human. Generators with recorded penalties ship more tonnage into the receiving TSDF in the sampled period, but both track facility size; the correlational reading is available and is probably the right one.',
    confidence: 0.74,
    floor: 'causal',
    action_set: 'causal',
    justification: false,
  },
]

/** node id → the review item that makes it provisional. */
const nodeReview = new Map([
  ['ENF:(various)', 'rv-enf-unitemised'],
  [STERICYCLE, 'rv-stericycle-resolution'],
])
/** `from|to` → review item, for the edges the same rows make provisional. */
const edgeReview = new Map()
for (const e of kg.edges) {
  if (e.type === 'TRANSPORTS_TO') edgeReview.set(`${e.from}|${e.to}`, 'rv-transports-to')
  /* The 17 edges that land on the placeholder are provisional *because of it* — the
     causal row is a claim about two properties, not about an edge, so it deliberately
     marks nothing here rather than borrowing an edge that means something else. */
  if (e.type === 'HAS_ENFORCEMENT' && e.to === 'ENF:(various)')
    edgeReview.set(`${e.from}|${e.to}`, 'rv-enf-unitemised')
  if (e.type === 'DESCRIBED_BY' && e.from === STERICYCLE)
    edgeReview.set(`${e.from}|${e.to}`, 'rv-stericycle-resolution')
}

/* ---------------- 7. layout ----------------
 *
 * A deterministic force layout, run here rather than in the browser: positions come
 * from the server so a reload draws the same picture, and a layout that settled
 * differently on every load would move a node the reader had just found. No
 * randomness anywhere — seeds are the node's index and type sector.
 */
const W = 1240
const H = 780
/* sqrt of degree, so the area is roughly proportional to the relationships carried
   rather than the diameter — a linear radius would draw the 53-edge hub as thirteen
   times the width of a 4-edge generator and read as a claim about importance. */
const radiusFor = (id) =>
  Math.min(66, Math.max(17, 17 + 6.5 * Math.sqrt(degree.get(id) ?? 0)))

/* Each type starts in its own sector so the settled picture is legible rather than
   merely valid: manifests inside, dimensions out at the rim. */
const SECTOR = {
  Facility: { from: 20, to: 340, ring: 260 },
  Manifest: { from: 250, to: 320, ring: 140 },
  Document: { from: 330, to: 30, ring: 330 },
  Alias: { from: 160, to: 200, ring: 110 },
  WasteCode: { from: 100, to: 175, ring: 360 },
  ViolationType: { from: 185, to: 250, ring: 360 },
  EnforcementType: { from: 40, to: 95, ring: 340 },
}
const seeded = []
const perType = new Map()
for (const n of nodes) {
  const list = perType.get(n.type) ?? []
  list.push(n)
  perType.set(n.type, list)
}
for (const [type, list] of perType) {
  const s = SECTOR[type]
  const span = ((s.to - s.from + 360) % 360) || 360
  list.forEach((n, i) => {
    if (n.id === 'FAC:TXD000719518') {
      seeded.push({ id: n.id, x: W / 2, y: H / 2, r: radiusFor(n.id), pinned: true })
      return
    }
    const t = list.length === 1 ? 0.5 : i / (list.length - 1)
    const deg = s.from + span * t
    const rad = (deg * Math.PI) / 180
    /* Facilities alternate between two rings — 36 on one circle would collide with
       every neighbour and the relaxation would spend its budget untangling them. */
    const ring = type === 'Facility' ? s.ring + (i % 2 ? 95 : 0) : s.ring
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
const springs = kg.edges
  .map((e) => [pos.get(e.from), pos.get(e.to)])
  .filter(([a, b]) => a && b)

for (let step = 0; step < 600; step += 1) {
  const cool = 1 - step / 600
  // Repulsion: every pair, weighted by the two radii so big nodes claim more room.
  for (let i = 0; i < seeded.length; i += 1) {
    for (let j = i + 1; j < seeded.length; j += 1) {
      const a = seeded[i]
      const b = seeded[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let d = Math.hypot(dx, dy) || 0.01
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
  for (const p of seeded) {
    p.x = Math.min(W - p.r - 6, Math.max(p.r + 6, p.x))
    p.y = Math.min(H - p.r - 6, Math.max(p.r + 6, p.y))
  }
}

/*
 * Separation pass. The force loop balances pull against push and settles with a few
 * circles still touching; this only ever pushes overlapping pairs apart, so it
 * converges. Two circles that overlap read as one node with a bite out of it —
 * the drawing has to be clear before it can be pretty.
 */
for (let pass = 0; pass < 400; pass += 1) {
  let moved = false
  for (let i = 0; i < seeded.length; i += 1) {
    for (let j = i + 1; j < seeded.length; j += 1) {
      const a = seeded[i]
      const b = seeded[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 0.01
      /* 26px, not a hair's breadth: a node too small to hold its own label is
         labelled underneath, and that text needs somewhere to go. */
      const gap = a.r + b.r + 26 - d
      if (gap <= 0) continue
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
  for (const p of seeded) {
    p.x = Math.min(W - p.r - 6, Math.max(p.r + 6, p.x))
    p.y = Math.min(H - p.r - 6, Math.max(p.r + 6, p.y))
  }
  if (!moved) {
    note(`separation converged after ${pass} pass(es)`)
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
note(`layout settled · tightest gap between two circles ${tightest.toFixed(1)}px`)
if (tightest < 0) throw new Error('circles overlap — the separation pass did not converge')

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
    const label = labelFor(roster.get(p.id) ?? materialised.find((m) => m.id === p.id))
    const chars = Math.min(22, label.length)
    return { ...p, w: chars * 5.1, top: p.y + p.r + 4, bottom: p.y + p.r + 15 }
  })
let hits = 0
for (const l of labels) {
  for (const other of seeded) {
    if (other.id === l.id) continue
    const dx = Math.abs(other.x - l.x)
    const dy = Math.abs(other.y - (l.top + l.bottom) / 2)
    if (dx < other.r + l.w / 2 && dy < other.r + 6) hits += 1
  }
}
note(
  `${labels.length} nodes are too small to hold their label · ${hits} of those labels ` +
    'would cross another circle if all were drawn at once (which is why the component ' +
    'draws them on hover or once a filter cuts the view to 28 nodes)',
)

/* ---------------- 8. write the canvas ---------------- */
const round = (n) => Math.round(n * 10) / 10
const canvasNodes = nodes.map((n) => {
  const p = pos.get(n.id)
  const prov = provenance(n)
  const item = nodeReview.get(n.id) ?? null
  return {
    node_id: n.id,
    label: clean(labelFor(n)),
    sublabel: clean(sublabelFor(n)),
    type: n.type,
    group: prov.origin_class,
    source: clean(prov.source),
    confidence: confidenceFor(n),
    degree: degree.get(n.id) ?? 0,
    r: round(p.r),
    x: round(p.x),
    y: round(p.y),
    ...(item ? { review_item_id: item } : {}),
  }
})

const canvasEdges = kg.edges.map((e) => {
  const item = edgeReview.get(`${e.from}|${e.to}`) ?? null
  return {
    from: e.from,
    to: e.to,
    label: e.type,
    detail: clean(e.properties),
    ...(item ? { review_item_id: item } : {}),
  }
})

db.graph_studio.canvas = { nodes: canvasNodes, edges: canvasEdges }
db.graph_studio.review_items = reviewItems.map((r) => ({ ...r, title: clean(r.title), detail: clean(r.detail) }))

/* ---------------- 9. the pivot ----------------
 *
 * Straight out of the package: the acquisition rename is the one resolution that
 * changes what every other row means, because it decides whether pre-2023 tonnage
 * belongs to the facility the queue is about.
 */
db.graph_studio.pivot = cleanDeep({
  pivot_id: 'ER-TXD000719518',
  alternative_id: 'ER-TXD000719518-SPLIT',
  title: 'Entity resolution: Texas Molecular LP vs Texas Molecular',
  detail:
    'TXD000719518 is one EPA ID with two names: manifests shipped before the 2023-01-05 acquisition carry "Texas Molecular LP" in DES FACILITY NAME. Resolving both names to one Facility node decides whether pre-acquisition tonnage counts as this facility\'s history, which is what every inbound-flow row in this queue is measured against — so the queue cannot be read until it is settled.',
  options: [
    {
      option_id: 'ER-TXD000719518',
      label: 'One facility — the alias table resolves both names',
      consequence:
        'All 1,200 manifests roll up to one node; the 3 RESOLVES_TO edges stand and inbound totals span 2023–2026.',
    },
    {
      option_id: 'ER-TXD000719518-SPLIT',
      label: 'Two facilities — split at the acquisition date',
      consequence:
        'Pre-2023 shipments attach to a separate legacy node; every SHIPS_TO total is re-scoped and the comparator set changes.',
    },
  ],
})

/* ---------------- 10. the pools the rest of the queue is drawn from ----------------
 *
 * `studioItems` synthesises the buckets the four real rows sit in. Its subjects and
 * predicates are this graph's own node and edge types, so a spot-checked row reads
 * as belonging to the same graph as the canvas.
 */
db.graph_studio.generated = {
  ...db.graph_studio.generated,
  must_review_total: 14,
  confirmed_total: 92,
  auto_approved_total: 318,
  spot_check_quota: 9,
  sample_size: 6,
  subjects: kg.node_types.map((t) => t.type).concat('Alias'),
  predicates: kg.edge_types.map((t) => t.type),
}

writeFileSync(DB, `${JSON.stringify(db, null, 2)}\n`, 'utf8')

const byClass = {}
for (const n of canvasNodes) byClass[n.group] = (byClass[n.group] ?? 0) + 1
note(`wrote ${canvasNodes.length} nodes / ${canvasEdges.length} edges`, JSON.stringify(byClass))
note(`proposed: ${canvasNodes.filter((n) => n.review_item_id).length} nodes, ${canvasEdges.filter((e) => e.review_item_id).length} edges`)
note(`conf < 0.85: ${canvasNodes.filter((n) => n.confidence < 0.85).length}`)
console.log('ok')
