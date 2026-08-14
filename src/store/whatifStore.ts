import { create } from 'zustand'
import {
  computeWhatIfScenario,
  deleteWhatIfScenario,
  getWhatIfFrame,
  publishWhatIfScenario,
  resolveWhatIfMeasure,
  saveWhatIfScenario,
  unpublishWhatIfScenario,
  type WhatIfFrame,
  type WhatIfFreshness,
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

/**
 * One column — one *case* of the scenario on screen: the admitted load, and what it is
 * called. Never the figures.
 *
 * A column carries no library id of its own, and that is the v2 model rather than an
 * omission: the publishable object is the whole scenario, so what is linked to a library
 * entry is the runtime (`curId`), not each column separately. A case shared on its own
 * would be a figure without the frame that gives it a question.
 */
export interface ScenarioColumn {
  /** Local id, so a column survives being reordered or renamed. */
  columnId: string
  generatorId: string
  name: string
}

interface WhatIfState {
  frame: WhatIfFrame | null
  loading: boolean
  error: string | null

  /* ---- authoring: the frame, and none of it is a scenario yet ---- */
  step: number
  /** Measure keys being watched. Order is the frame's, not the click order. */
  watch: string[]
  pool: string
  count: number
  /** What the scenario is called. Named in step 3, because naming it is publishing it. */
  name: string
  /** The graph's verdict on the last typed measure, or null. */
  resolution: WhatIfResolution | null
  resolving: boolean

  /* ---- runtime ---- */
  columns: ScenarioColumn[]
  /** Computed figures per column id. Derived, never authored, never persisted. */
  computed: Record<string, WhatIfScenario>
  computing: string[]
  saved: WhatIfSaved[]
  /** The library entry this runtime *is*, or null while it is an unsaved draft. */
  curId: string | null
  pending: string | null

  load: () => Promise<void>
  setStep: (step: number) => void
  toggleWatch: (key: string) => void
  setPool: (pool: string) => void
  setCount: (count: number) => void
  setName: (name: string) => void
  resolve: (text: string) => Promise<Result>
  clearResolution: () => void
  /** Opens the Runtime columns the frame asks for, and computes each. */
  startRun: () => Promise<void>
  swapLoad: (columnId: string, generatorId: string) => Promise<Result>
  renameColumn: (columnId: string, name: string) => void
  addColumn: (generatorId: string, name?: string) => Promise<Result>
  removeColumn: (columnId: string) => void
  /** Save the whole scenario — the frame and its cases — as one library entry. */
  saveCurrent: () => Promise<Result & { savedId?: string }>
  /** Load a library entry back into authoring *and* runtime, and recompute it. */
  openSaved: (savedId: string) => Promise<Result>
  publish: (input: {
    savedId: string
    readers: string[]
    graphUseCaseId: string
    freshness: WhatIfFreshness
    as?: string | null
  }) => Promise<Result>
  unpublish: (savedId: string) => Promise<Result>
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
  name: '',
  resolution: null,
  resolving: false,

  columns: EMPTY_COLUMNS,
  computed: {},
  computing: [],
  saved: EMPTY_SAVED,
  curId: null,
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

  /*
   * Changing the pool invalidates any case whose load it no longer offers. Dropped
   * rather than silently reassigned: a column that swapped its own load while the reader
   * was looking at the pool step would be the page answering a question nobody asked.
   * `startRun` re-seeds from the new pool, which is the visible act that replaces them.
   */
  setPool: (pool) =>
    set((s) => {
      if (pool === s.pool || !s.frame) return { pool }
      const allowed = new Set(poolMembers(s.frame, pool).map((g) => g.id))
      const kept = s.columns.filter((c) => allowed.has(c.generatorId))
      if (kept.length === s.columns.length) return { pool }
      const computed = Object.fromEntries(
        kept.map((c) => [c.columnId, s.computed[c.columnId]]).filter(([, v]) => v !== undefined),
      ) as Record<string, WhatIfScenario>
      return { pool, columns: kept, computed }
    }),
  setCount: (count) => set({ count }),
  setName: (name) => set({ name }),

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
   * Adding a case never replaces one, and the cap is the frame's `compare.max`. Refusing
   * with a sentence beats silently doing nothing, which is what the prototype's disabled
   * button did.
   */
  addColumn: async (generatorId, name = '') => {
    const { frame, columns } = get()
    const max = frame?.runtime.compare.max ?? 3
    if (columns.length >= max) {
      return { ok: false, error: `The compare strip is full (${max}). Remove a case to add another.` }
    }
    const column = { columnId: nextColumnId(), generatorId, name }
    set((s) => ({ columns: [...s.columns, column], count: s.columns.length + 1 }))
    return computeInto(set, get, column)
  },

  /* Always at least one case: an empty compare strip is a page with nothing on it,
     and there is no control that would bring one back. */
  removeColumn: (columnId) =>
    set((s) => {
      if (s.columns.length <= (s.frame?.runtime.compare.min ?? 1)) return s
      const { [columnId]: _dropped, ...computed } = s.computed
      const columns = s.columns.filter((c) => c.columnId !== columnId)
      return { columns, computed, count: columns.length }
    }),

  /*
   * Save the scenario, which is the frame *and* its cases.
   *
   * One entry, not one per column: the frame is what makes a case mean anything, and the
   * publish dialog says as much — a figure without what was watched and which pool it
   * came from is a number without a question. The server answers with the whole library
   * plus the id it touched, so the runtime links to its entry without guessing which row
   * is new; the entry it stores holds generator ids and no figure at all.
   */
  saveCurrent: async () => {
    const { columns, curId, name, watch, pool } = get()
    if (columns.length === 0) {
      return { ok: false, error: 'There is nothing to save yet — run the frame to open its cases first.' }
    }
    set({ pending: 'scenario' })
    try {
      const { saved, savedId } = await saveWhatIfScenario({
        savedId: curId,
        name,
        watch,
        pool,
        cases: columns.map((c) => ({ name: c.name, generatorId: c.generatorId })),
      })
      const entry = saved.find((s) => s.savedId === savedId)
      set((s) => ({
        saved,
        pending: null,
        curId: savedId,
        /* The server names an unnamed scenario and an unnamed case from their loads, so
           the page adopts those names rather than leaving the fields it filled blank. */
        name: entry?.name ?? s.name,
        columns: s.columns.map((c, i) => ({ ...c, name: entry?.cases[i]?.name ?? c.name })),
      }))
      return { ok: true, savedId }
    } catch (error) {
      set({ pending: null })
      return { ok: false, error: toMessage(error) }
    }
  },

  /*
   * Open a library entry: its frame into authoring, its cases into runtime.
   *
   * Every figure is recomputed on the way in rather than restored, which is the whole
   * point of storing the load instead of the numbers — a scenario saved last week shows
   * this week's federal record.
   */
  openSaved: async (savedId) => {
    const entry = get().saved.find((s) => s.savedId === savedId)
    if (!entry) return { ok: false, error: 'That scenario is no longer in the library.' }
    const columns = entry.cases.map((c) => ({
      columnId: nextColumnId(),
      generatorId: c.generatorId,
      name: c.name,
    }))
    set({
      curId: savedId,
      name: entry.name,
      watch: entry.watch,
      pool: entry.pool,
      count: columns.length,
      columns,
      computed: {},
    })
    const results = await Promise.all(columns.map((c) => computeInto(set, get, c)))
    const failed = results.find((r) => !r.ok)
    return failed ?? { ok: true }
  },

  publish: async (input) => {
    set({ pending: input.savedId })
    try {
      const saved = await publishWhatIfScenario(input)
      set({ saved, pending: null })
      return { ok: true }
    } catch (error) {
      set({ pending: null })
      return { ok: false, error: toMessage(error) }
    }
  },

  unpublish: async (savedId) => {
    set({ pending: savedId })
    try {
      const saved = await unpublishWhatIfScenario(savedId)
      set({ saved, pending: null })
      return { ok: true }
    } catch (error) {
      set({ pending: null })
      return { ok: false, error: toMessage(error) }
    }
  },

  /* Deleting a library entry leaves the runtime open, just unlinked: the reader was
     looking at those cases, and closing them out from under them would be a surprise. */
  remove: async (savedId) => {
    set({ pending: savedId })
    try {
      const saved = await deleteWhatIfScenario(savedId)
      set((s) => ({ saved, pending: null, curId: s.curId === savedId ? null : s.curId }))
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
/** The library entry the runtime currently *is*, or null while it is an unsaved draft. */
export const selectCurrent = (s: WhatIfState) =>
  s.curId === null ? null : (s.saved.find((e) => e.savedId === s.curId) ?? null)
