import { create } from 'zustand'
import {
  computeWhatIfScenario,
  deleteWhatIfScenario,
  getWhatIfFrame,
  resolveWhatIfMeasure,
  saveWhatIfScenario,
  type WhatIfFrame,
  type WhatIfResolution,
  type WhatIfSaved,
  type WhatIfScenario,
} from '../api/client'
import { toMessage, type Result } from './asyncState'

/*
 * The What-if lens.
 *
 * Two halves and the state says which is which. **Authoring holds the frame** — the
 * measures being watched, the pool a scenario may draw from, how many columns to open
 * — and none of it is a scenario. **Runtime holds the columns**, and a column is only
 * ever `{ generatorId, name, savedId }`: the *admitted load*, never the figures.
 *
 * That is the whole reason `computeWhatIfScenario` is a call rather than a calculation
 * here. Every figure on a column is derived on the server from today's graph, so
 * swapping a load recomputes by traversal and a saved scenario re-opened next week
 * shows next week's record. A store that cached the numbers would be storing an answer
 * that quietly went stale — which is exactly what the copy promises it does not do.
 */

/** One column: the admitted load, plus where it is saved. Never the figures. */
export interface ScenarioColumn {
  /** Local id, so a column survives being reordered or renamed. */
  columnId: string
  generatorId: string
  name: string
  /** The library entry this column is linked to, or null while it is a draft. */
  savedId: string | null
}

interface WhatIfState {
  frame: WhatIfFrame | null
  loading: boolean
  error: string | null

  /* ---- authoring ---- */
  step: number
  /** Measure keys being watched. Order is the frame's, not the click order. */
  watch: string[]
  pool: string
  count: number
  /** The graph's verdict on the last typed measure, or null. */
  resolution: WhatIfResolution | null
  resolving: boolean

  /* ---- runtime ---- */
  columns: ScenarioColumn[]
  /** Computed figures per column id. Derived, never authored, never persisted. */
  computed: Record<string, WhatIfScenario>
  computing: string[]
  saved: WhatIfSaved[]
  pending: string | null

  load: () => Promise<void>
  setStep: (step: number) => void
  toggleWatch: (key: string) => void
  setPool: (pool: string) => void
  setCount: (count: number) => void
  resolve: (text: string) => Promise<Result>
  clearResolution: () => void
  /** Opens the Runtime columns the frame asks for, and computes each. */
  startRun: () => Promise<void>
  swapLoad: (columnId: string, generatorId: string) => Promise<Result>
  renameColumn: (columnId: string, name: string) => void
  addColumn: (generatorId: string, name?: string, savedId?: string | null) => Promise<Result>
  removeColumn: (columnId: string) => void
  save: (columnId: string) => Promise<Result>
  remove: (savedId: string) => Promise<Result>
}

let columnSeq = 1
const nextColumnId = () => `col-${columnSeq++}`

/** Stable empty references, so a selector does not allocate on every render. */
const EMPTY_COLUMNS: ScenarioColumn[] = []
const EMPTY_SAVED: WhatIfSaved[] = []

export const useWhatIfStore = create<WhatIfState>()((set, get) => ({
  frame: null,
  loading: false,
  error: null,

  step: 1,
  watch: [],
  pool: 'all',
  count: 2,
  resolution: null,
  resolving: false,

  columns: EMPTY_COLUMNS,
  computed: {},
  computing: [],
  saved: EMPTY_SAVED,
  pending: null,

  /*
   * The defaults come from the server, not from this file. Which measures start ticked
   * and which pool starts selected are statements about the tenant's frame, and a
   * second copy here would drift from the one the API serves.
   */
  load: async () => {
    set({ loading: true })
    try {
      const frame = await getWhatIfFrame()
      set({
        frame,
        saved: frame.saved,
        error: null,
        loading: false,
        step: frame.defaults.step,
        watch: frame.defaults.watch,
        pool: frame.defaults.pool,
        count: frame.defaults.count,
      })
    } catch (error) {
      // A failed reload keeps whatever was on screen rather than blanking it.
      set({ error: toMessage(error), loading: false })
    }
  },

  setStep: (step) => set({ step }),

  /* Kept in the frame's order rather than the click order, so the columns list their
     measures the same way however they were ticked. */
  toggleWatch: (key) =>
    set((s) => {
      const on = s.watch.includes(key)
      const order = s.frame?.measures.map((m) => m.key) ?? []
      const next = on ? s.watch.filter((k) => k !== key) : [...s.watch, key]
      return { watch: order.filter((k) => next.includes(k)) }
    }),

  setPool: (pool) => set({ pool }),
  setCount: (count) => set({ count }),

  resolve: async (text) => {
    set({ resolving: true })
    try {
      const resolution = await resolveWhatIfMeasure(text)
      set((s) => ({
        resolution,
        resolving: false,
        /* A resolved measure is added, which is the point of asking. The other two
           verdicts add nothing — and say so — rather than adding something adjacent. */
        watch:
          resolution.verdict === 'resolved' && resolution.measureKey
            ? (s.frame?.measures ?? [])
                .map((m) => m.key)
                .filter((k) => s.watch.includes(k) || k === resolution.measureKey)
            : s.watch,
      }))
      return { ok: true }
    } catch (error) {
      set({ resolving: false })
      return { ok: false, error: toMessage(error) }
    }
  },

  clearResolution: () => set({ resolution: null }),

  /*
   * Entering Runtime. The frame says how many columns to open and which pool they draw
   * from, so the first N of that pool are seeded — a column with no load would be a
   * dropdown the reader has to discover before anything computes.
   */
  startRun: async () => {
    const { frame, pool, count } = get()
    if (!frame) return
    const inPool = poolMembers(frame, pool)
    if (inPool.length === 0) {
      set({ columns: EMPTY_COLUMNS, computed: {} })
      return
    }
    const columns = Array.from({ length: Math.min(count, inPool.length) }, (_, i) => ({
      columnId: nextColumnId(),
      generatorId: inPool[i % inPool.length].id,
      name: '',
      savedId: null,
    }))
    set({ columns, computed: {} })
    await Promise.all(columns.map((c) => computeInto(set, get, c)))
  },

  swapLoad: async (columnId, generatorId) => {
    set((s) => ({
      columns: s.columns.map((c) => (c.columnId === columnId ? { ...c, generatorId } : c)),
    }))
    const column = get().columns.find((c) => c.columnId === columnId)
    if (!column) return { ok: false, error: 'That column is no longer open.' }
    return computeInto(set, get, column)
  },

  renameColumn: (columnId, name) =>
    set((s) => ({
      columns: s.columns.map((c) => (c.columnId === columnId ? { ...c, name } : c)),
    })),

  /*
   * Adding a column never replaces one — that is the library's stated contract, and the
   * cap is the frame's `compare.max`. Refusing with a sentence beats silently doing
   * nothing, which is what the prototype's disabled button did.
   */
  addColumn: async (generatorId, name = '', savedId = null) => {
    const { frame, columns } = get()
    const max = frame?.runtime.compare.max ?? 3
    if (columns.length >= max) {
      return { ok: false, error: `The compare strip is full (${max}). Remove a column to add another.` }
    }
    if (savedId && columns.some((c) => c.savedId === savedId)) {
      return { ok: false, error: 'That saved scenario is already open in the compare strip.' }
    }
    const column = { columnId: nextColumnId(), generatorId, name, savedId }
    set((s) => ({ columns: [...s.columns, column] }))
    return computeInto(set, get, column)
  },

  /* Always at least one column: an empty compare strip is a page with nothing on it,
     and there is no control that would bring one back. */
  removeColumn: (columnId) =>
    set((s) => {
      if (s.columns.length <= (s.frame?.runtime.compare.min ?? 1)) return s
      const { [columnId]: _dropped, ...computed } = s.computed
      return { columns: s.columns.filter((c) => c.columnId !== columnId), computed }
    }),

  save: async (columnId) => {
    const { columns, computed } = get()
    const column = columns.find((c) => c.columnId === columnId)
    if (!column) return { ok: false, error: 'That column is no longer open.' }
    set({ pending: columnId })
    try {
      /* The server names an unnamed scenario from its load, and answers with the whole
         library — so the tray and the column's saved flag move together. */
      const saved = await saveWhatIfScenario({
        savedId: column.savedId,
        name: column.name,
        generatorId: column.generatorId,
      })
      const entry =
        saved.find((s) => s.savedId === column.savedId) ??
        saved.find(
          (s) => s.generatorId === column.generatorId && !columns.some((c) => c.savedId === s.savedId),
        )
      set((s) => ({
        saved,
        pending: null,
        columns: s.columns.map((c) =>
          c.columnId === columnId
            ? { ...c, savedId: entry?.savedId ?? c.savedId, name: entry?.name ?? c.name }
            : c,
        ),
      }))
      // The name may have been filled in by the server, so the figures stay as they are
      // but the column's identity changed — no recompute, nothing about the load moved.
      void computed
      return { ok: true }
    } catch (error) {
      set({ pending: null })
      return { ok: false, error: toMessage(error) }
    }
  },

  /* Deleting a library entry unlinks any column showing it rather than closing it: the
     reader was looking at that load, and losing it would be a surprise. */
  remove: async (savedId) => {
    set({ pending: savedId })
    try {
      const saved = await deleteWhatIfScenario(savedId)
      set((s) => ({
        saved,
        pending: null,
        columns: s.columns.map((c) => (c.savedId === savedId ? { ...c, savedId: null } : c)),
      }))
      return { ok: true }
    } catch (error) {
      set({ pending: null })
      return { ok: false, error: toMessage(error) }
    }
  },
}))

/* ---------------- helpers ---------------- */

type Setter = (
  partial:
    | Partial<WhatIfState>
    | ((state: WhatIfState) => Partial<WhatIfState>),
) => void

/**
 * Computes one column and files the result under its id.
 *
 * The figures live in `computed`, keyed by column rather than by generator, because two
 * columns may legitimately hold the same load — comparing a saved scenario against a
 * live draft of it is the point of the compare strip.
 */
async function computeInto(
  set: Setter,
  get: () => WhatIfState,
  column: ScenarioColumn,
): Promise<Result> {
  set((s) => ({ computing: [...s.computing, column.columnId] }))
  try {
    const scenario = await computeWhatIfScenario({
      generatorId: column.generatorId,
      watch: get().watch,
    })
    set((s) => ({
      computed: { ...s.computed, [column.columnId]: scenario },
      computing: s.computing.filter((id) => id !== column.columnId),
    }))
    return { ok: true }
  } catch (error) {
    set((s) => ({ computing: s.computing.filter((id) => id !== column.columnId) }))
    return { ok: false, error: toMessage(error) }
  }
}

/**
 * The generators a pool admits.
 *
 * The counts come from the server, but the *membership* has to be known here too so a
 * dropdown can list it. The filters are data on the frame for exactly that reason —
 * one description of the pool, applied in both places, rather than a second rule the
 * client invents.
 */
export function poolMembers(frame: WhatIfFrame, poolKey: string) {
  const pool = frame.pools.find((p) => p.key === poolKey)
  if (!pool) return frame.generators
  /* The server already told us how many qualify. Where the count is everything, skip
     the filter — the common case is "All inbound generators". */
  if (pool.count === frame.generators.length) return frame.generators
  return frame.generators.filter((g) => matchesPool(g, poolKey))
}

/*
 * The four pools the package ships, expressed against the generator's own fields.
 *
 * These mirror `whatif.candidate_pools[].filter` on the server. They are duplicated
 * deliberately and narrowly: the dropdown needs the membership list, not just a count,
 * and shipping the filter operators to the client so it can evaluate them would be a
 * second interpreter. `check-docs` asserts the two lists of pool keys agree, so a pool
 * added to the package without a rule here fails the build rather than silently
 * offering every generator.
 */
function matchesPool(g: WhatIfFrame['generators'][number], poolKey: string) {
  switch (poolKey) {
    case 'enf':
      return g.enforcement > 0
    case 'oos':
      return g.state !== 'TX'
    case 'cd':
      return g.consentDecree
    default:
      return true
  }
}

/** The headroom row for one pool, or null where the frame has none. */
export const headroomFor = (frame: WhatIfFrame, poolKey: string) =>
  frame.headroom.find((h) => h.pool === poolKey) ?? null

export const selectColumns = (s: WhatIfState) => s.columns
export const selectSaved = (s: WhatIfState) => s.saved
