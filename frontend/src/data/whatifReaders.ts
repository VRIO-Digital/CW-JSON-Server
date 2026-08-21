import type { WhatIfFrame } from '../api/client'

/**
 * A publication's reader addresses, as the names Settings knows them by.
 *
 * **One resolution, in a module of its own.** A publication stores addresses — that is
 * what identifies a person here — and two places turning them into names is how a
 * published card and a publish receipt come to call the same reader two things. It lives
 * beside the other copy helpers rather than inside either component for the reason
 * `sourceActions.ts` does: a function exported from a component file is one a bundler
 * cannot hot-reload, and either component may render without the other.
 *
 * The address is the fallback, never a placeholder: a reader the directory no longer
 * carries is still exactly who the publication named.
 */
export const readerNames = (frame: WhatIfFrame, emails: string[]): string[] =>
  emails.map((email) => frame.readers.find((r) => r.email === email)?.name ?? email)
