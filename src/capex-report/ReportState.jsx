/* ==========================================================================
   ONE PIECE OF STATE PER SURFACE, AND THE SURFACES ARE NAMED.

   The prototype kept `RS` (the report surface) and `LIN` (the lineage drawer)
   as two module-level objects and repainted by hand. The split was right — a
   drawer that keeps showing the previous selection's population is worse than a
   closed one, and the two have genuinely different lifetimes — so it survives
   here as a reducer and some local state behind one provider rather than
   becoming one bag.

   What did NOT survive is anything that let the client name its own scope.
   `repScopeKey()` and `repRole()` were deleted from the prototype for the reason
   its comments give at length: a caller that declares its own predicate can
   declare a wider one. The persona on these pages is read off the resolved view.
   ========================================================================== */
import React, { createContext, useCallback, useContext, useMemo, useReducer, useState } from 'react'

/* Exported so a test can hold the drawer in a fixed state and reach a branch that
   only exists when it is open on a particular section. Nothing in the app reads
   the context directly — everything goes through the hook. */
export const ReportStateContext = createContext(null)
const Ctx = ReportStateContext

/* ── the lineage drawer ─────────────────────────────────────────────────────
   `hit`  — the measure keys of the figure whose marker was clicked, or null for
            the report-level view. Held as keys rather than as the opaque `prov`
            handle: the handle is only resolvable by the resolver, and every
            served figure carries its `measure` beside it, so the walk can be lit
            without a round trip this build has no server for.
   `full` — widened from the clicked figure's path to the whole model.
   `max`  — the drawer given the full window. A graph is not text. */
const LIN0 = {
  open: false, section: 'population', hit: null, hitLabel: null,
  node: null, layer: 'biz', full: false, max: false,
}

function linReducer(s, a) {
  switch (a.type) {
    /* Toggle, not re-open. Pressing "Sources & lineage" while the drawer is
       already showing sources used to do nothing at all — the same click that
       opened it looked broken the second time. */
    case 'section': {
      if (s.open && s.section === a.section && !s.hit) return { ...LIN0 }
      return { ...s, open: true, section: a.section, hit: null, hitLabel: null, node: null }
    }
    /* A figure's marker lands on the GRAPH, not the glossary. A definition
       answers "what does this word mean"; a click on a number is asking "where
       did this come from", and those are different questions. The glossary row
       is one nav step away. */
    case 'figure':
      return { ...s, open: true, section: 'graph', hit: a.keys, hitLabel: a.label, node: null }
    /* A column header carries no provenance handle but knows its measure key,
       which is enough to land on the right glossary row. */
    case 'measure':
      return { ...s, open: true, section: 'measures', hit: [a.key], hitLabel: a.label, node: null }
    case 'nav': {
      /* Leaving the graph resets what was only meaningful there. */
      const node = (s.section === 'graph' && a.section !== 'graph') ? null : s.node
      return { ...s, section: a.section, node }
    }
    /* Clicking the selected node again clears it: a panel with no way to dismiss
       it is the thing people complain about second. */
    case 'node':  return { ...s, node: s.node === a.id ? null : a.id }
    case 'layer': return { ...s, layer: a.layer }
    case 'full':  return { ...s, full: !s.full }
    case 'max':   return { ...s, max: !s.max }
    case 'close': return { ...LIN0 }
    default:      return s
  }
}

export function ReportStateProvider({ children }) {
  const [lin, linDispatch] = useReducer(linReducer, LIN0)

  /* Toasts. The same shape and the same four seconds as the prototype's. */
  const [toasts, setToasts] = useState([])
  const toast = useCallback((msg, type) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => t.concat([{ id, msg, type: type || 'ok' }]))
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200)
  }, [])

  /* One modal at a time: 'spec' | 'export' | null. Both are report-surface
     overlays and neither is ever wanted alongside the other. */
  const [modal, setModal] = useState(null)

  /* The provenance popover, anchored where it was clicked — the answer to "why
     will this filter not move" belongs next to the control, not in a centred
     dialog. */
  const [pop, setPop] = useState(null)

  const value = useMemo(() => ({
    lin, linDispatch, toasts, toast, modal, setModal, pop, setPop,
  }), [lin, toasts, toast, modal, pop])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useReportState = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useReportState used outside ReportStateProvider')
  return c
}

/* The resolved view travels by context too. Every block renderer in the
   prototype takes `(b, v)` and a handful genuinely need the view — the ask
   binding line reads the scope and the as-of, and the footer reads
   `paramsNarrowed`. Passing it through twenty components as a prop would put it
   in nineteen signatures that do not use it. */
const ViewCtx = createContext(null)
export const ViewProvider = ({ view, children }) =>
  <ViewCtx.Provider value={view}>{children}</ViewCtx.Provider>
export const useView = () => useContext(ViewCtx)
