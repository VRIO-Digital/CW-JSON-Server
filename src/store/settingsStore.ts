import { create } from 'zustand'
import {
  getSettings,
  resetPersonaNav,
  setPersonaNav,
  setPersonaReports,
  type SettingsPayload,
  type SettingsPersona,
} from '../api/client'
import { NAV_ITEMS, type NavItem } from '../nav'
import { toMessage, type Result } from './asyncState'

/**
 * The Settings store: the users, each persona's navigation access, and which persona the sidebar shows.
 *
 * **Server-derived now, not hardcoded.** It reads `GET /settings`, which is served from
 * `mock-server/settings.json` — a separate store from `db.json` holding only what this section
 * administers. Writes go back to the server and it **persists**: a permission survives a restart,
 * because a decision about who sees what is somebody's work rather than session state.
 *
 * **One source for navigation visibility.** The sidebar filters `NAV_ITEMS` through `visibleNavItems`
 * and nothing else decides what appears — a component that filtered as well would be a second answer to
 * "can this persona see Reports", and the two would drift the first time a rule changed.
 *
 * **And not access control.** Turning an item off hides it from the sidebar; the route is still there and
 * still reachable by URL, exactly as `/db` and `/audit` are. Nothing here authorises anything, the page
 * says so in those words, and no feature should assume otherwise.
 *
 * Follows this repo's two store conventions: actions return `Result` and never throw, and `load()` sets
 * `error` in state rather than throwing — a failed reload leaves the previous data in place instead of
 * blanking the sidebar.
 */
interface SettingsState {
  data: SettingsPayload | null
  loading: boolean
  error: string | null
  /**
   * The persona whose access the sidebar is showing. Defaults to whoever signed in — see
   * `syncActivePersona` — and changes when one is picked in the Settings page.
   */
  activePersonaId: string | null

  load: () => Promise<void>
  setActivePersona: (roleId: string) => void
  /**
   * Adopts the signed-in role **once**, so that previewing another persona is not undone by the next
   * render. Sign-out clears it, so the next sign-in adopts theirs.
   */
  syncActivePersona: (roleId: string | null) => void
  /** Saves one key for one persona. The server refuses a fixed key, and its sentence comes back here. */
  setPermission: (roleId: string, key: string, next: boolean) => Promise<Result>
  /**
   * Saves one report action for one persona — the twin of `setPermission`, with the same one-key-per-
   * call, whole-view-back contract and the same re-read on a failed write.
   */
  setReportPermission: (roleId: string, action: string, next: boolean) => Promise<Result>
  resetPersona: (roleId: string) => Promise<Result>
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,
  activePersonaId: null,

  load: async () => {
    set({ loading: true })
    try {
      set({ data: await getSettings(), error: null, loading: false })
    } catch (error) {
      /* The previous data stays: a failed reload must not empty the sidebar. */
      set({ error: toMessage(error), loading: false })
    }
  },

  setActivePersona: (roleId) => set({ activePersonaId: roleId }),

  syncActivePersona: (roleId) =>
    set((state) => {
      if (roleId === null) return { activePersonaId: null }
      return state.activePersonaId === null ? { activePersonaId: roleId } : state
    }),

  setPermission: async (roleId, key, next) => {
    try {
      /* One key per call, whole set on the wire — the server answers with the whole view, so what is
         on screen is what it last said rather than a local patch of it. */
      const data = await setPersonaNav(roleId, { [key]: next })
      set({ data, error: null })
      return { ok: true }
    } catch (error) {
      /*
       * **Re-read after a failed write.** A write that is refused leaves the server unchanged and this
       * is a no-op; a write whose *response* is lost — the connection dropping, the server restarting
       * mid-request — may well have been applied, and the page would then show the old value while the
       * store held the new one. That happened: a toggle reported "cannot reach the mock server" and had
       * saved. Asking the server what is true costs one GET and removes the ambiguity.
       */
      await get().load()
      return { ok: false, error: toMessage(error) }
    }
  },

  setReportPermission: async (roleId, action, next) => {
    try {
      const data = await setPersonaReports(roleId, { [action]: next })
      set({ data, error: null })
      return { ok: true }
    } catch (error) {
      /* Same reasoning as `setPermission`: a lost response is not a failed write, so ask the server
         what is true rather than reporting a failure for something that may have saved. */
      await get().load()
      return { ok: false, error: toMessage(error) }
    }
  },

  resetPersona: async (roleId) => {
    try {
      set({ data: await resetPersonaNav(roleId), error: null })
      return { ok: true }
    } catch (error) {
      await get().load()
      return { ok: false, error: toMessage(error) }
    }
  },
}))

/** One persona's row from the payload, or null while it is still loading. */
export const personaFor = (
  data: SettingsPayload | null,
  roleId: string | null,
): SettingsPersona | null =>
  (roleId ? data?.personas.find((p) => p.roleId === roleId) : null) ?? null

/**
 * The navigation items the active persona may see.
 *
 * **Everything is visible until the answer is known** — before the fetch returns, or with no persona
 * active. A sidebar that started empty and filled in would read as a broken app rather than as a
 * permission model, and an absent key means "not configured", never "denied".
 */
export const visibleNavItems = (
  data: SettingsPayload | null,
  activePersonaId: string | null,
): NavItem[] => {
  const persona = personaFor(data, activePersonaId)
  if (!persona) return NAV_ITEMS
  return NAV_ITEMS.filter((item) => persona.nav[item.key] !== false)
}

/**
 * What the active persona may do to a report in the Library.
 *
 * **One place decides it, exactly as `visibleNavItems` is the one place deciding the sidebar.** The
 * Library card, the page that passes the props and anything added later all read this, so they cannot
 * come to disagree about whether an Executive may delete.
 *
 * **Everything is offered until the answer is known**, the same rule the sidebar follows: before the
 * fetch returns, or with no persona active, every action is allowed. An absent key means "not
 * configured" and never "denied" — a Library whose buttons appeared a moment after the cards would
 * read as a broken page, and a row with no actions at all is the precise symptom that got the old
 * access gate removed.
 *
 * **And it is not access control.** It decides which controls a reader is *offered*; the API still
 * serves every report to a caller that names no role, and the panel that sets it says so in words.
 */
export const reportActionsFor = (
  data: SettingsPayload | null,
  activePersonaId: string | null,
): Record<string, boolean> => {
  const persona = personaFor(data, activePersonaId)
  const actions = data?.reportActions ?? []
  if (!persona) return Object.fromEntries(actions.map((a) => [a, true]))
  return Object.fromEntries(actions.map((a) => [a, persona.reports[a] !== false]))
}
