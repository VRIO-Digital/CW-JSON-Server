import { create } from 'zustand'
import {
  addGovernanceReader,
  getGovernance,
  removeGovernanceReader,
  setGovernanceScope,
  unpublishGovernanceArtifact,
  type GovernanceView,
} from '../api/client'
import { toMessage, type Result } from './asyncState'

/*
 * Audit & Governance.
 *
 * **Every writer answers with the whole view, and this store adopts that reply** — one path into
 * the state on screen rather than a local edit plus a re-read that might disagree. It is the same
 * arrangement the report section's Share uses, for the same reason: the server computes each
 * person's resolution against the live register, so a rule edited here changes numbers this store
 * has no business deriving.
 *
 * Nothing is cached that the server computes. `resolution` in particular is never recalculated
 * locally — it is what a rule *would* admit against today's roster, and a second opinion about
 * that is a second answer.
 */

interface GovernanceState {
  view: GovernanceView | null
  loading: boolean
  error: string | null
  /** Which write is in flight, keyed by whatever it acts on. Null when idle. */
  pending: string | null

  load: () => Promise<void>
  setScope: (input: {
    roleId: string
    rule?: { basis: string; values: string[] } | null
    full?: boolean
    mask?: boolean
    as?: string | null
  }) => Promise<Result>
  addReader: (input: { artifactId: string; email: string; as?: string | null }) => Promise<Result>
  removeReader: (input: { artifactId: string; email: string; as?: string | null }) => Promise<Result>
  unpublish: (input: { artifactId: string; as?: string | null }) => Promise<Result>
}

export const useGovernanceStore = create<GovernanceState>()((set) => ({
  view: null,
  loading: false,
  error: null,
  pending: null,

  load: async () => {
    set({ loading: true })
    try {
      set({ view: await getGovernance(), error: null, loading: false })
    } catch (error) {
      /* A failed reload keeps whatever is on screen rather than blanking it. */
      set({ error: toMessage(error), loading: false })
    }
  },

  /*
   * The three writers are the same shape on purpose: mark what is pending, call, adopt the reply,
   * and return a `Result` the page turns into a message. A refusal arrives as the server's own
   * sentence — "no restriction basis …", "is the only reader …" — which is what a reader can act
   * on, so none of them is rewritten here.
   */
  setScope: async (input) => {
    set({ pending: input.roleId })
    try {
      set({ view: await setGovernanceScope(input), pending: null })
      return { ok: true }
    } catch (error) {
      set({ pending: null })
      return { ok: false, error: toMessage(error) }
    }
  },

  addReader: async (input) => {
    set({ pending: input.artifactId })
    try {
      set({ view: await addGovernanceReader(input), pending: null })
      return { ok: true }
    } catch (error) {
      set({ pending: null })
      return { ok: false, error: toMessage(error) }
    }
  },

  removeReader: async (input) => {
    set({ pending: `${input.artifactId}|${input.email}` })
    try {
      set({ view: await removeGovernanceReader(input), pending: null })
      return { ok: true }
    } catch (error) {
      set({ pending: null })
      return { ok: false, error: toMessage(error) }
    }
  },

  unpublish: async (input) => {
    set({ pending: input.artifactId })
    try {
      set({ view: await unpublishGovernanceArtifact(input), pending: null })
      return { ok: true }
    } catch (error) {
      set({ pending: null })
      return { ok: false, error: toMessage(error) }
    }
  },
}))

/** Stable empty references, so a selector does not allocate on every render. */
const EMPTY_PEOPLE: GovernanceView['people'] = []
const EMPTY_ARTIFACTS: GovernanceView['artifacts'] = []
const EMPTY_LOG: GovernanceView['log'] = []

export const selectPeople = (s: GovernanceState) => s.view?.people ?? EMPTY_PEOPLE
export const selectArtifacts = (s: GovernanceState) => s.view?.artifacts ?? EMPTY_ARTIFACTS
export const selectLog = (s: GovernanceState) => s.view?.log ?? EMPTY_LOG

/** The person a reader address names, or null where the directory does not have them. */
export const personFor = (view: GovernanceView, email: string) =>
  view.people.find((p) => p.email === email) ?? null
