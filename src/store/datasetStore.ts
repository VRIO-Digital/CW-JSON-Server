/**
 * Which dataset the app is reading, and which ones the tenant has.
 *
 * **The selection itself lives in `src/api/dataset.ts`, not here**, because `client.ts` has to read
 * it from module scope when it builds a request — including the first request, which happens before
 * any store has hydrated. This store is the subscribable half: it mirrors the value so components
 * re-render when it changes, and it holds the served pool.
 *
 * **Changing it signs the reader out and reloads the app, and that is the whole mechanism.** It is
 * not a view toggle. Every page reads the selected dataset, and so does everything the session has
 * built: a registered source, a profiling job, a studio decision and a publication all live in the
 * mock server's memory *under one dataset*, and the signed-in persona was resolved against the
 * tenant directory the primary dataset serves. Repainting in place would leave every store holding
 * the previous dataset's rows — zustand stores are module-level singletons, so unmounting the page
 * tree does not clear them — and the symptom is one page showing EPA's figures under CAPEX's
 * heading, which reads as data rather than as a bug.
 *
 * A full document reload is the one thing that cannot half-work: every module is constructed again,
 * so no store can carry a row across. It replaced an `epoch` counter used as the `<Outlet>` key,
 * which remounted the *components* and left the stores exactly as they were — a mechanism that
 * looked like a guarantee and was not one.
 */

import { create } from 'zustand'

import { listDatasets, type DatasetsPayload } from '../api/client'
import { BOTH_DATASET, currentDataset, setCurrentDataset } from '../api/dataset'
import { useAuthStore } from './authStore'
import { toMessage } from './asyncState'

type DatasetState = {
  /** The dataset every request is carrying. Mirrors `src/api/dataset.ts`. */
  active: string
  /** The served pool — never a list written into a component. */
  data: DatasetsPayload | null
  loading: boolean
  error: string | null

  load: () => Promise<void>
  /**
   * Persist the new dataset, drop the identity, and return to the login.
   *
   * Called only from the confirmation's OK — never from the control's `onChange`, because the change
   * event fires on a click and this signs the reader out.
   */
  switchDataset: (dataset: string) => void
}

export const useDatasetStore = create<DatasetState>()((set, get) => ({
  active: currentDataset(),
  data: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true })
    try {
      const data = await listDatasets()
      set({ data, error: null, loading: false })
    } catch (error) {
      /* The pool failing to load is not a reason to blank the control: the active dataset is still
         whatever it was, and every request still carries it. The error is shown beside the select. */
      set({ error: toMessage(error), loading: false })
    }
  },

  switchDataset: (dataset) => {
    if (dataset === get().active) return

    /*
     * Order matters, and it is: persist, then forget who is signed in, then reload.
     *
     * The selection is written **first** so it survives the reload — it is in `localStorage` under
     * its own key, which `logout()` does not touch. Writing it after the reload was requested would
     * be a race against the navigation, and losing it would bring the app back up on the dataset the
     * reader had just left, with a sign-out to show for it.
     */
    setCurrentDataset(dataset)
    set({ active: dataset })
    useAuthStore.getState().logout()

    /*
     * `assign`, not react-router navigation: routing to `/login` would unmount the tree and leave
     * every store's data in place. This is also why it is here rather than in the panel — one path
     * changes the dataset, so a caller cannot get half of it.
     */
    window.location.assign('/login')
  },
}))

/** Whether the current selection is the merged reading view, which refuses writes. */
export const selectIsBoth = (s: DatasetState): boolean => s.active === BOTH_DATASET

const NO_ROWS: DatasetsPayload['datasets'] = []

/** Stable reference — `data?.datasets ?? []` would allocate every render. */
export const selectDatasetRows = (s: DatasetState): DatasetsPayload['datasets'] =>
  s.data?.datasets ?? NO_ROWS
