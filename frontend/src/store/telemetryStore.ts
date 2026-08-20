import { getAudit, getEvals, getTraces } from '../api/client'
import { createReadStore } from './asyncState'

/*
 * Audit, traces and evals are read-only single-fetch payloads with identical
 * lifecycles, so they share the createReadStore factory rather than repeating
 * the same try/catch three times.
 */

export const useAuditStore = createReadStore(getAudit)
export const useTracesStore = createReadStore(getTraces)
export const useEvalsStore = createReadStore(getEvals)
