import { create } from 'zustand'
import {
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
