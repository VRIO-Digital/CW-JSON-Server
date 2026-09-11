import { create } from 'zustand'
import {
  acceptAllRelationships,
  deleteDataModelEntity,
  getProfiledColumns,
  listDataModel,
  saveDataModelEntity,
  setColumnDescription,
  suggestDataModel,
  type ModelEntity,
  type ModelEntityInput,
  type ModelSuggestionsPayload,
  type ProfiledColumn,
} from '../api/client'
import type { RelationshipWrite } from '../data/dataModelRelationships'
import { toMessage, type Result } from './asyncState'

/**
 * One profiled table, as the Data Modeling tab works with it.
 *
 * Flattened out of the column dictionary's dataset → table nesting, because this tab models tables
 * rather than datasets: a canvas node is a table, and the dataset it sits in is part of its key.
 * Flattened **here** rather than in the component so the array's reference is stable — a selector
 * that re-derives it every render defeats every memo downstream of it.
 */
export interface ModelTable {
  /** `"<dataset>.<table>"` — how a declaration addresses this table. */
  tableKey: string
  datasetId: string
  tableId: string
  label: string
  type: string
  grain: string
  rows: number | null
  columns: ProfiledColumn[]
}

interface DataModelState {
  /** The selected source's profiled tables. Empty until a source with a profile is loaded. */
  tables: ModelTable[]
  /** Every declaration in the dataset — the tab filters to the tables in front of it. */
  entities: ModelEntity[]
  loading: boolean
  error: string | null
  /** True while a save, a confirm or a delete is in flight; every action button reads it. */
  saving: boolean

  load: (sourceId: string) => Promise<void>
  /** Re-reads the declarations alone — what every write does afterwards. */
  reloadEntities: () => Promise<void>
  /**
   * Writes a curator's note onto one profiled column, then re-reads this tab's tables.
   *
   * The same endpoint the column dictionary's pencil writes to, and it lands in the mock server's
   * **memory** beside the registration rather than in the document — which is the existing
   * behaviour of a column note, not something this tab changed. A declaration is a different matter
   * and does persist.
   */
  describe: (
    sourceId: string,
    input: { dataset_id: string; table_id: string; column_id: string; description: string },
  ) => Promise<Result>
  save: (input: ModelEntityInput) => Promise<Result>
  /** Posts a relationship's writes in the order `relationshipWrites` put them in. */
  saveWrites: (writes: RelationshipWrite[]) => Promise<Result>
  /**
   * Accepts every undecided stored relation across these tables, in **one** request.
   *
   * Its own action rather than a loop over `saveWrites`, because it is one act on the server: the
   * whole scope is resolved before anything is written and lands in a single commit, so a refusal
   * leaves the document as it was instead of half-accepted. The count it resolves with is the
   * server's, so the sentence the tab prints is what landed.
   */
  acceptAll: (
    tableKeys: string[],
    as: string,
  ) => Promise<{ ok: true; accepted: number } | { ok: false; error: string }>
  remove: (entityId: string) => Promise<Result>
  suggest: (
    sourceId: string,
  ) => Promise<{ ok: true; data: ModelSuggestionsPayload } | { ok: false; error: string }>
  reset: () => void
}

const NO_TABLES: ModelTable[] = []
const NO_ENTITIES: ModelEntity[] = []

export const useDataModelStore = create<DataModelState>()((set, get) => ({
  tables: NO_TABLES,
  entities: NO_ENTITIES,
  loading: false,
  error: null,
  saving: false,

  /**
   * Both reads at once, and the failure of either is the tab's error.
   *
   * `Promise.all` rather than two awaits: the two waits overlap, and neither is useful alone — a
   * canvas with no tables and a declaration list with no canvas are both blank pages.
   */
  load: async (sourceId) => {
    set({ loading: true })
    try {
      const [columns, model] = await Promise.all([
        getProfiledColumns(sourceId),
        listDataModel(),
      ])
      const tables = columns.datasets.flatMap((d) =>
        d.tables.map((t) => ({
          tableKey: `${d.dataset_id}.${t.table_id}`,
          datasetId: d.dataset_id,
          tableId: t.table_id,
          label: t.label,
          type: t.type,
          grain: t.grain,
          rows: t.rows,
          columns: t.columns,
        })),
      )
      set({ tables, entities: model.entities, error: null, loading: false })
    } catch (error) {
      /* The previous data stays put — a failed reload must not blank a canvas somebody is reading. */
      set({ error: toMessage(error), loading: false })
    }
  },

  reloadEntities: async () => {
    try {
      set({ entities: (await listDataModel()).entities, error: null })
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  describe: async (sourceId, input) => {
    try {
      await setColumnDescription(sourceId, input)
      await get().load(sourceId)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    }
  },

  save: async (input) => {
    set({ saving: true })
    try {
      await saveDataModelEntity(input)
      await get().reloadEntities()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ saving: false })
    }
  },

  saveWrites: async (writes) => {
    if (writes.length === 0) return { ok: true }
    set({ saving: true })
    try {
      /*
       * Sequential, not `Promise.all`. Each write hands the server one whole entity, so two writes
       * that touch the same one in parallel would have the second overwrite the first — the same
       * read-modify-write hazard `commitDb`'s own write chain exists for, one layer up.
       */
      for (const write of writes) await saveDataModelEntity(write.input)
      await get().reloadEntities()
      return { ok: true }
    } catch (error) {
      /* Whatever landed before the failure is real, so the list is re-read either way. */
      await get().reloadEntities()
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ saving: false })
    }
  },

  acceptAll: async (tableKeys, as) => {
    set({ saving: true })
    try {
      const result = await acceptAllRelationships({ tableKeys, as })
      /* One path into the state on screen: the list is re-read rather than patched from the reply,
         which is what the governance section does with its own writes. */
      await get().reloadEntities()
      return { ok: true, accepted: result.accepted }
    } catch (error) {
      /* Nothing landed — the route commits once, so there is no partial write to re-read for. The
         list is re-read anyway, because a refusal this caller cannot interpret may be a stale one. */
      await get().reloadEntities()
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ saving: false })
    }
  },

  remove: async (entityId) => {
    set({ saving: true })
    try {
      await deleteDataModelEntity(entityId)
      await get().reloadEntities()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ saving: false })
    }
  },

  suggest: async (sourceId) => {
    try {
      return { ok: true, data: await suggestDataModel(sourceId) }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    }
  },

  reset: () =>
    set({
      tables: NO_TABLES,
      entities: NO_ENTITIES,
      loading: false,
      error: null,
      saving: false,
    }),
}))

/** The declaration anchored to one table, or `null` where nobody has written one. */
export const entityForTable = (
  entities: ModelEntity[],
  tableKey: string,
): ModelEntity | null => entities.find((e) => e.table_key === tableKey) ?? null
