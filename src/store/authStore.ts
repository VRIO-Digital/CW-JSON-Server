import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { login as loginRequest, type SessionIdentity } from '../api/client'
import { toMessage, type Result } from './asyncState'

interface AuthState {
  /** null means signed out. Persisted, so a refresh does not force a re-login. */
  identity: SessionIdentity | null
  signingIn: boolean

  login: (input: { email: string; password: string; roleId: string }) => Promise<Result>
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
    (set) => ({
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

      logout: () => set({ identity: null }),
    }),
    {
      name: 'contextweave.identity',
      partialize: (state) => ({ identity: state.identity }),
    },
  ),
)
