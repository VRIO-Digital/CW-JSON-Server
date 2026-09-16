import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  login as loginRequest,
  type ConsentIdentity,
  type SessionIdentity,
} from '../api/client'
import { toMessage, type Result } from './asyncState'
import { useSettingsStore } from './settingsStore'

interface AuthState {
  /** null means signed out. Persisted, so a refresh does not force a re-login. */
  identity: SessionIdentity | null
  signingIn: boolean

  /** No role: the persona is the user's own, resolved from the settings store by email. */
  login: (input: { email: string; password: string }) => Promise<Result>
  /**
   * **Become the person a Google consent was granted as.**
   *
   * The sign-in window offers the tenant's directory, so a reader can connect a source as somebody
   * other than whoever signed in — and until this existed only the wizard knew: it said *Connected as
   * Rei Nakamura* while the sidebar, the Library's buttons, Ask's chat history and every "who did
   * this" field went on saying Adaeze Okonjo. One act, two answers.
   *
   * **The whole identity or none of it.** The row comes from the server's `identityFor`, the login's
   * own resolution, so the persona arrives with the address. Swapping the email alone would leave a
   * reader looking at one person's name under another's navigation — worse than not switching, and
   * invisible, because both halves render perfectly.
   *
   * **It moves the active persona too**, which nothing else would: `syncActivePersona` adopts a role
   * only when none is active, so on a live session it would keep the previous persona's sidebar. The
   * cross-store call is the shape `datasetStore` already uses to reach `logout`.
   *
   * **Returns whether it changed hands**, so the caller can say so. Adopting the account already
   * signed in is a no-op rather than a re-stamped session — a toast announcing a switch that did not
   * happen is the settings-toggle fault in a message.
   *
   * It is **not** authentication. This login authenticates by shape and the consent screen proves a
   * request is well-formed; what this records is which directory row granted it.
   */
  adoptIdentity: (identity: ConsentIdentity) => boolean
  /** Purely local — there is no server-side session to revoke. */
  logout: () => void
}

/**
 * Who is using the console. Persisted to localStorage rather than modelled as
 * server state: unlike a registered source, this identity has nothing on the
 * server to survive a restart *for* — it is the browser's own memory of who
 * signed in, and `login()` still round-trips through the server so a bad email,
 * a short password or an unknown role fail the same way any other write does.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      identity: null,
      signingIn: false,

      login: async (input) => {
        set({ signingIn: true })
        try {
          const identity = await loginRequest(input)
          set({ identity, signingIn: false })
          return { ok: true }
        } catch (error) {
          set({ signingIn: false })
          return { ok: false, error: toMessage(error) }
        }
      },

      adoptIdentity: (next) => {
        const current = get().identity
        if (current && current.email.toLowerCase() === next.email.toLowerCase()) return false
        /* Stamped now, because the session for this person begins now. The server has no such moment
           to report — a consent is not a sign-in — so dating it from the row would date a session
           that never started. */
        set({ identity: { ...next, signedInAt: new Date().toISOString() } })
        /* The sidebar follows the person, not the render. `syncActivePersona` deliberately adopts
           once so that previewing a persona in Settings survives the next render; that is exactly
           what would strand this switch on the previous persona's navigation. */
        useSettingsStore.getState().setActivePersona(next.roleId)
        return true
      },

      logout: () => set({ identity: null }),
    }),
    {
      name: 'contextweave.identity',
      partialize: (state) => ({ identity: state.identity }),
    },
  ),
)
