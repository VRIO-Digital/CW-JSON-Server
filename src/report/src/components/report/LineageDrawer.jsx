import React from 'react'
import { useReportState } from '../../state/ReportState.jsx'
import LineageGraph, { GRAPH_LAYERS } from './LineageGraph.jsx'
import { asSecond } from '../../lib/format.js'

/* ════════════════════════════ LINEAGE & LIMITS — ONE DRAWER ════════════════
   The report used to answer "where did this number come from" thirty times, once
   per figure, in a popover that restated the same six rows of metadata with one
   word changed. A reader who wants to trust a report does not want to audit thirty
   figures; they want to understand the report once.

   So there is one drawer, and it reads top to bottom as an argument:

     Which projects are in these numbers   ← the funnel, in narrowing order
     What these numbers were walked through← the graph
     Where the data comes from             ← systems, with the floor-setter named
     How each figure is computed           ← the measure glossary
     Rules applied to get the numbers      ← why a spreadsheet disagrees
     What this report cannot tell you      ← the limits, formerly a body block
     Audit detail                          ← predicate, digests, traces

   ONE SECTION AT A TIME, NOT SEVEN IN A SCROLL. All seven exist — the nav's job is
   to show that the full account exists, and a reader can still take the whole
   thing in order — but only the selected one is displayed. A reader who clicked a
   figure asked one question; making them scroll a seven-section document to find
   its answer is why the window read as long.
   ========================================================================== */
const SECTIONS = [
  { id: 'population', nav: 'Population', h: 'Which projects are in these numbers',
    q: 'A business reader’s first lineage question is almost never “which system”. It is “why is this number smaller than the one I had last week”.' },
  { id: 'graph', nav: 'The graph', h: 'What these numbers were walked through',
    q: 'A list of source systems is not evidence — a dozen measures that mean completely different things share the same one. This is the path through the business model that produced the figures, scoped to what you are allowed to see.' },
  { id: 'sources', nav: 'Sources', h: 'Where the data comes from',
    q: 'Four systems, four refresh cadences. The report is only as current as the slowest of them.' },
  { id: 'measures', nav: 'Measures', h: 'How each figure is computed',
    q: 'One definition per measure, resolved from the graph glossary — which is what stops two reports disagreeing about the word “variance”.' },
  { id: 'transforms', nav: 'Rules', h: 'Rules applied between the rows and the numbers',
    q: 'These are the reasons a hand-recalculation in a spreadsheet comes out different. Stated here rather than left for someone to discover in a board meeting.' },
  { id: 'limits', nav: 'Limits', h: 'What this report cannot tell you',
    q: 'Deliberate exclusions, withheld figures and weaker evidence, in one place. A limit you have to hunt for is a limit nobody reads.' },
  { id: 'audit', nav: 'Audit', h: 'Audit detail',
    q: 'The predicate, the digests and the trace ids. Needed for an audit, and taxing on the reading path — so they live here.' },
]

export default function LineageDrawer({ view: v, onShowSpec }) {
  const { lin, linDispatch } = useReportState()
  const linData = v.lineage || {}
  const lim = v.limits || { count: 0, items: [] }

  const BODY = {
    population: <Population v={v} lin={linData} />,
    graph: <Graph v={v} lin={linData} />,
    sources: <Sources v={v} lin={linData} />,
    measures: <Measures lin={linData} hit={lin.hit} />,
    transforms: <Transforms lin={linData} />,
    limits: <Limits lim={lim} />,
    audit: <Audit v={v} onShowSpec={onShowSpec} />,
  }

  return (
    <div className={'drawer wide' + (lin.open ? ' open' : '') + (lin.max ? ' max' : '')} id="d-lin">
      {/* Title, close button and section nav are ONE sticky unit. They were two
          independently sticky things and the taller one won: the nav pinned at
          top:0 while the title scrolled under it, taking the only close button
          with it. A reader six sections into the lineage had no way out of the
          drawer except the browser. */}
      <div className="drawerStick">
        <div className="drawerHead">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontSize: 15 }}>
              {lin.hitLabel && lin.hit ? lin.hitLabel : 'How this report was produced'}
            </h3>
            <div className="mini">
              {lin.hit
                ? `Lineage for one figure, in the context of the whole report — ${v.name}`
                : `${v.name} · v${v.version} · ${(linData.sources || []).length} source systems · `
                  + `${(linData.measures || []).length} measures · ${lim.count} limit${lim.count === 1 ? '' : 's'}`}
            </div>
          </div>
          <button className="modalX" onClick={() => linDispatch({ type: 'close' })}
                  title="Close (Esc)" aria-label="Close">×</button>
        </div>
        <div className="linNav">
          {SECTIONS.map(s => (
            <button key={s.id} className={s.id === lin.section ? 'on' : ''}
                    onClick={() => linDispatch({ type: 'nav', section: s.id })}>
              {s.nav}{s.id === 'limits' && lim.count ? <> <b>{lim.count}</b></> : null}
            </button>
          ))}
        </div>
      </div>

      <div>
        {SECTIONS.map(s => (
          <div className={'linSect' + (s.id === lin.section ? ' on' : '')} key={s.id}>
            <h4>{s.h}</h4>
            <div className="lq">{s.q}</div>
            {BODY[s.id]}
          </div>
        ))}
      </div>
    </div>
  )
}

/* THE FUNNEL. Every step says how many rows survived it, and the scope step says
   how many it REMOVED — because "N of M" without the M is not an explanation, it
   is a number. */
function Population({ v, lin }) {
  return (
    <>
      <div className="funnel">
        {(lin.population || []).map((p, i) => (
          <div className={'fnStep k-' + p.kind} key={i}>
            <div className="fnI">
              {p.kind === 'spec' ? '§' : p.kind === 'scope' ? '⛨' : p.kind === 'param' ? '◧' : '✓'}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="fnB">
                {p.label}
                {p.rows != null ? (
                  <span className="fnN">
                    {p.rows} row{p.rows === 1 ? '' : 's'}
                    {p.removed ? <> · <em>−{p.removed} removed</em></> : null}
                  </span>
                ) : null}
              </div>
              {p.detail ? <div className="fnD">{p.detail}</div> : null}
            </div>
          </div>
        ))}
      </div>
      {v.paramsNarrowed ? (
        <div className="pvRule" style={{ marginTop: 12 }}>
          Your filter selections re-aggregated the run that was already served. Same as-of, same
          figures underneath — no source was queried again, which is why the change was instant.
        </div>
      ) : null}
    </>
  )
}

/* THE SEMANTIC LAYER, as the thing it is rather than as a version string. Reading
   order is deliberate: the sentence first, because most readers want one sentence
   and nothing else; then the picture; then the detail for the two readers who came
   for the detail. */
function Graph({ v, lin }) {
  const { lin: L, linDispatch } = useReportState()
  const g = lin.graph
  if (!g) return <div className="mini">No graph binding is recorded for this report.</div>

  /* When a figure was clicked, its own walk is lit and everything else in the
     report's graph is dimmed but still drawn — the surroundings are how a reader
     tells whether the figure took the short path or the long one. */
  const focus = L.hit ? g.measures.filter(m => L.hit.indexOf(m.key) > -1) : []
  const litN = new Set(), litE = new Set()
  focus.forEach(m => { m.nodes.forEach(n => litN.add(n)); m.edges.forEach(e => litE.add(e)) })

  /* THREE TIERS, AND THE SERVER SUPPLIES ALL THREE. `g.nodes` is the whole model,
     each node flagged with whether this report walked it:
       · a figure clicked, not widened → that figure's own path
       · no figure in hand             → everything this report walked
       · widened                       → the whole model
     The default with no figure in hand is the report's WALK and not the model: a
     reader who opened the drawer from the trust bar asked how this report was
     produced, and the entities it never touched are not an answer to that. */
  const walkedN = g.nodes.filter(n => n.walked)
  const walkedE = g.edges.filter(e => e.walked)
  const showAll = L.full
  const focusMode = focus.length > 0 && !L.full
  const drawN = showAll ? g.nodes : focusMode ? walkedN.filter(n => litN.has(n.id)) : walkedN
  const drawE = showAll ? g.edges : focusMode ? walkedE.filter(e => litE.has(e.id)) : walkedE

  /* Resolved against what is DRAWN, not the whole model: a panel describing a box
     that is no longer on screen is a panel about nothing. The id is kept, so
     widening brings the selection back rather than silently dropping it. */
  const sel = L.node ? drawN.find(n => n.id === L.node) : null
  /* Only the relationships that are ON SCREEN. A core entity like Project sits on
     six relationships in the model, and listing all six under a two-step walk
     buries the two that produced the number in four that did not. */
  const selAll = sel ? g.edges.filter(e => e.from === sel.id || e.to === sel.id) : []
  const selEdges = sel ? selAll.filter(e => drawE.indexOf(e) > -1) : []
  const selRest = selAll.length - selEdges.length
  const nameOf = id => (g.nodes.find(n => n.id === id) || {}).label || id

  /* Captions the SET ON SCREEN, and each tier has its own. The report's weakest
     edge under a three-edge walk that does not contain it is a true sentence about
     the wrong number, and the model's weakest edge under the report's walk is a
     true sentence about another report. */
  const weakest = focusMode ? focus[0].weakest : showAll ? g.weakestModel : g.weakest
  const weakestOf = focusMode ? 'this figure’s path' : showAll ? 'the whole model' : 'this report’s paths'

  return (
    <>
      <div className="gBar">
        <div className="gLayers" role="group" aria-label="How to annotate the graph">
          {GRAPH_LAYERS.map(l => (
            <button key={l.id} className={l.id === L.layer ? 'on' : ''}
                    onClick={() => linDispatch({ type: 'layer', layer: l.id })}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="gBarR">
          <button className={'tinyBtn' + (L.full ? ' on' : '')}
                  onClick={() => linDispatch({ type: 'full' })}>
            {L.full
              ? (focus.length ? '◑ Just this figure’s path'
                : `◑ Just what this report walks (${g.walkedNodes})`)
              : `◍ Whole model (${g.modelNodes})`}
          </button>
          <button className={'tinyBtn' + (L.max ? ' on' : '')}
                  onClick={() => linDispatch({ type: 'max' })}
                  title="Give the graph the full window">
            {L.max ? '⤡ Narrow' : '⤢ Widen'}
          </button>
        </div>
      </div>

      <div className="linGraphWrap">
        <LineageGraph gNodes={drawN} gEdges={drawE} litN={litN} litE={litE}
                      layer={L.layer} selected={L.node}
                      onNode={id => linDispatch({ type: 'node', id })} />
      </div>

      <div className="gKey">
        <span>{(GRAPH_LAYERS.find(l => l.id === L.layer) || {}).hint || ''}</span>
        <span><i className="k-resolved" />matched across systems</span>
        <span><i className="k-extracted" />read from documents</span>
        {drawN.some(n => n.withheld)
          ? <span><i className="k-withheld" />withheld by your access</span> : null}
      </div>

      {focus.length ? (
        <div className="gRead hit"><span>↳</span><div>
          <b>{focus[0].label}</b> — {focus[0].reading}
          {focus[0].masked ? (
            <div className="gWarn">
              This figure is withheld from you on this report. The path is still shown, because how a
              number would be built is not itself confidential.
            </div>
          ) : null}
          <div className="gReadA">
            <button className="tinyBtn" onClick={() => linDispatch({ type: 'nav', section: 'measures' })}>
              Its definition</button>
            <button className="tinyBtn" onClick={() => linDispatch({ type: 'nav', section: 'population' })}>
              Which projects are in it</button>
          </div>
        </div></div>
      ) : (
        <div className="gRead"><span>↳</span><div>
          {g.scopedNote} Every figure on this report was produced by walking some part of the{' '}
          <b>{g.name}</b> model above. Click a figure’s evidence marker to see its own path on its
          own.
        </div></div>
      )}

      {sel ? (
        <div className="gNodeCard">
          <div className="gnT">
            <b>{sel.label}</b>
            <span className={'pill ' + sel.confBand}>{(sel.conf * 100).toFixed(0)}% confident</span>
            {sel.withheld ? <span className="pill lo">withheld from you</span> : null}
            <button className="tinyBtn" style={{ marginLeft: 'auto' }}
                    onClick={() => linDispatch({ type: 'node', id: sel.id })}>Close</button>
          </div>
          <div className="gnBiz">{sel.biz}</div>
          {sel.withheld ? <div className="gWarn">{sel.withheldReason}</div> : null}
          {sel.note ? <div className="gnNote">{sel.note}</div> : null}
          <dl className="dl gnDl">
            <dt>How many, for you</dt>
            <dd>
              {sel.withheld ? '—' : sel.recordsDisplay}
              {sel.scaled && !sel.withheld ? (
                <span className="dim"> · narrowed by your access, not by a filter you set</span>
              ) : null}
            </dd>
            <dt>Lives in</dt>
            <dd>
              {sel.source ? (
                <><span className={'srcTag ' + (sel.source.tag || '')}>{sel.source.name}</span>{' '}</>
              ) : null}
              <span className="mono" style={{ fontSize: 11 }}>{sel.object}</span>
            </dd>
            <dt>Identified by</dt>
            <dd className="mono" style={{ fontSize: 11 }}>{sel.keyAttr}</dd>
          </dl>

          {selEdges.length ? (
            <div className="gnRel">
              <div className="gnRelH">Connected to</div>
              {selEdges.map(e => (
                <div className={'gnRelR m-' + e.method} key={e.id}>
                  <div className="grT">
                    <b>{e.from === sel.id ? sel.label : nameOf(e.from)}</b>
                    <span className="grA">{e.label} →</span>
                    <b>{e.to === sel.id ? sel.label : nameOf(e.to)}</b>
                    <span className={'pill ' + e.confBand}>
                      {e.methodLabel} · {(e.conf * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="grB">{e.biz}</div>
                  <div className="grJ mono">{e.join}</div>
                  {e.note ? <div className="grN">{e.note}</div> : null}
                </div>
              ))}
              {selRest ? (
                <div className="gnMore">
                  {selRest} further relationship{selRest === 1 ? '' : 's'} on <b>{sel.label}</b> in
                  this model are not part of the walk above.{' '}
                  <button className="tinyBtn" onClick={() => linDispatch({ type: 'full' })}>
                    Widen the graph</button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mini">
          Select any box above for what it is, where it lives, and how it connects.
        </div>
      )}

      {weakest ? (
        <div className="linRule sev-warn"><i>⚠</i><div>
          <div className="lrB">Weakest link on {weakestOf}</div>
          <div className="lrD">{weakest.say}</div>
        </div></div>
      ) : (
        <div className="note ok" style={{ padding: '10px 13px', marginTop: 11 }}>
          <span>✓</span><div className="body">
            <b>Every link drawn above is a key the source systems maintain</b>
            Nothing on the way to {focusMode ? 'this figure' : 'these figures'} was inferred or
            matched across systems.
          </div>
        </div>
      )}

      {!focus.length && g.measures.length ? (
        <div className="gWalks">
          <div className="gnRelH">What each figure walked</div>
          {g.measures.map(m => (
            <div className="gWalk" key={m.key}>
              <div className="gwT">
                <b>{m.label}</b>
                {m.masked ? <span className="pill lo">withheld from you</span> : null}
                <span className="gwP">{m.nodes.map(id => nameOf(id)).join(' → ')}</span>
              </div>
              <div className="gwD">{m.reading}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="pvRule" style={{ marginTop: 12 }}>
        This model is curated, versioned and approved like the reports that read it —{' '}
        <b>{g.name} {g.version}</b>, {g.pack}, last approved by {g.curatedByName}
        {g.curatedByTitle ? ` (${g.curatedByTitle})` : ''} on {(g.approvedAt || '').slice(0, 10)}.
        {g.notWalked ? (
          <> {g.notWalked} further {g.notWalked === 1 ? 'entity is' : 'entities are'} defined in it
            that this report does not touch. {showAll
              ? 'They are drawn above, dimmed — you asked for the model, and this is how much of it '
                + 'this report is not evidence about.'
              : 'They are not drawn, because a part of the model no figure here walked is not '
                + 'evidence for anything on this page.'}</>
        ) : null}
      </div>
    </>
  )
}

/* The floor-setter is sorted to the top and visually separated, because it is the
   single fact that determines how current the whole report is. */
function Sources({ v, lin }) {
  const srcs = lin.sources || []
  return (
    <>
      {srcs.length ? srcs.map(s => (
        <div className={'linSrc' + (s.setsFloor ? ' floor' : '')} key={s.id || s.name}>
          <div className="lsB">
            <div className="lsT">
              <span className={'srcTag ' + (s.tag || '')}>{s.tag || ''}</span>
              <b>{s.name}</b>
              {s.setsFloor ? <span className="floorTag">sets the as-of floor</span> : null}
              {s.status && s.status !== 'connected'
                ? <span className="pill lo">{s.status}</span> : null}
            </div>
            <div className="lsM">
              as-of {s.asOf || '—'} · {s.freshness || '—'} old · syncs {s.cadence || '—'}
              {s.via ? ` · through ${s.via}` : ''}
            </div>
            {(s.feeds || []).length ? (
              <div className="lsF">Feeds <b>{s.feeds.join(', ')}</b></div>
            ) : null}
            {s.note ? <div className="lsF" style={{ color: 'var(--dim)' }}>{s.note}</div> : null}
          </div>
        </div>
      )) : (
        <div className="mini">No dated dataset contributes to this report.</div>
      )}
      <div className="pvRule" style={{ marginTop: 12 }}>
        {v.asOf.line} The stamp is the age of the <b>oldest</b> dataset above, never the newest — and
        it is a dataset rather than a connector, because three of these can be current while the
        fourth holds the whole report back. A figure stamped with its freshest input is lying about
        the others.
      </div>
    </>
  )
}

/* The anchor target. A figure's lineage marker lands on its row here. */
function Measures({ lin, hit }) {
  const ms = lin.measures || []
  if (!ms.length) return <div className="mini">This report composes no glossary measures.</div>
  return ms.map(m => {
    const isHit = hit && hit.indexOf(m.key) > -1
    return (
      <div className={'linM' + (isHit ? ' hit' : '')} id={'lm_' + m.key} key={m.key}>
        <div className="lmT">
          <b>{m.label}</b>
          <span className="lmX">{m.key}</span>
          {!m.additive ? (
            <span className="pill neu" title="Recomputed at the grain on screen, never summed">
              {m.scopeClass || 'non-additive'}</span>
          ) : null}
          {m.derived ? <span className="pill md">derived</span> : null}
          {m.masked ? <span className="pill lo">withheld from you</span> : null}
          {isHit ? (
            <span className="floorTag" style={{ color: 'var(--orange-hi)', background: 'none' }}>
              the figure you clicked</span>
          ) : null}
        </div>
        <div className="lmD">{m.def || 'No glossary definition recorded.'}</div>
        <div className="lmS">
          {m.source ? <span className={'srcTag ' + (m.source.tag || '')}>{m.source.name}</span> : null}
          {m.glossary ? <span>glossary <span className="mono">{m.glossary}</span></span> : null}
          <span>{m.unit || ''}</span>
        </div>
      </div>
    )
  })
}

function Transforms({ lin }) {
  const ts = lin.transforms || []
  if (!ts.length) return <div className="mini">No rule is applied between the rows and the numbers.</div>
  return ts.map((t, i) => (
    <div className="linRule" key={i}><i>ƒ</i><div>
      <div className="lrB">{t.label}</div>
      <div className="lrD">{t.detail}</div>
    </div></div>
  ))
}

/* Author-declared exclusions used to render as a body block titled "What this
   report will not tell you", sitting between two blocks of data that DO exist. The
   content was right; its position in the reading path was not. */
function Limits({ lim }) {
  if (!lim.count) return (
    <div className="note ok" style={{ padding: '11px 13px' }}><span>✓</span><div className="body">
      <b>Nothing is withheld from you on this report</b>
      Every figure the spec asks for resolved, and your entitlement masks none of them.
    </div></div>
  )
  return lim.items.map((it, i) => (
    <div className={'linRule sev-' + it.severity} key={i}>
      <i>{it.severity === 'warn' ? '⚠' : 'ⓘ'}</i>
      <div>
        <div className="lrB">{it.title}</div>
        <div className="lrD">{it.text}</div>
      </div>
    </div>
  ))
}

/* Everything that used to sit on the business surface in a cyan strip. */
function Audit({ v, onShowSpec }) {
  return (
    <>
      <dl className="dl">
        <dt>Report</dt><dd>{v.reportId} · v{v.version} · {String(v.status).replace(/_/g, ' ')}</dd>
        <dt>Graph binding</dt><dd>{v.binding.graph} {v.binding.graphVersion || ''}</dd>
        <dt>Your scope</dt>
        <dd>{v.scope.label}{' '}
          <span className="mono" style={{ fontSize: '10.5px' }}>({v.scope.id})</span></dd>
        <dt>Grain ceiling</dt><dd>{v.grainCeiling}</dd>
        <dt>Figures masked</dt><dd>{v.masked}</dd>
        <dt>Blocks withheld</dt><dd>{(v.withheldBlocks || []).length}</dd>
        <dt>Rows: spec / scope / screen</dt>
        <dd className="mono" style={{ fontSize: 11 }}>
          {v.rowsTotal} → {v.rowsScoped} → {v.rowsAdmitted}</dd>
        <dt>Run trace</dt>
        <dd className="mono" style={{ fontSize: '10.5px' }}>{v.traceId}</dd>
        <dt>View trace</dt>
        <dd className="mono" style={{ fontSize: '10.5px' }}>{v.viewTrace}</dd>
        <dt>Resolved at</dt>
        <dd className="mono" style={{ fontSize: '10.5px' }}>{asSecond(v.generatedAt)} UTC</dd>
      </dl>
      <div className="pvExpr" style={{ marginTop: 11 }}>{v.scope.predicate}</div>
      <div className="dl" style={{ marginTop: 2 }}>
        <dt>Predicate digest</dt>
        <dd className="mono" style={{ fontSize: '10.5px' }}>{v.scope.digest}</dd>
      </div>
      <div className="pvRule" style={{ marginTop: 12 }}>
        The predicate is compiled into the source query. Rows it excludes never reach this page —
        there is no client-side filter to bypass, and an export runs the same resolver under the same
        digest. A <b>view</b> trace is not a <b>run</b> trace: re-aggregating the served rows under
        different filters gets its own view id while the run id and the as-of stay put.
      </div>
      <div className="mini" style={{ marginTop: 10 }}>
        <button className="tinyBtn" onClick={onShowSpec}>View the full specification</button>
      </div>
    </>
  )
}
