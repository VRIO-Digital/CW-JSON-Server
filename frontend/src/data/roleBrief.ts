import type { RoleBrief } from '../api/client'
import {
  INDUSTRIES,
  ROLES,
  ROLE_DOMAIN_OF,
  UTILITIES,
  type JdFinding,
  type RoleArea,
  type RoleDef,
  type UtilityDef,
} from './roleLibrary'

/*
 * What the New Role wizard's first two steps decide, and the pure rules over it.
 *
 * Here rather than in the page for the reason `stepIssue` is: a rule written inline can only be
 * asserted by rendering the page, and `renderToString` gives it its initial state, in which nobody
 * has picked a role.
 */

export const roleById = (id: string | null): RoleDef | null =>
  (id && ROLES.find((r) => r.id === id)) || null

export const industryName = (id: string | null): string =>
  INDUSTRIES.find((i) => i.id === id)?.name ?? ''

/** "Northline Water of Ardenia" → "Ardenia": the place is what tells them apart. */
export const shortUtilityName = (name: string): string => name.replace('Northline Water of ', '')

export const utilityByCode = (code: string): UtilityDef | undefined =>
  Object.values(UTILITIES)
    .flatMap((scan) => scan.found)
    .find((u) => u.code === code)

/**
 * Which of a dataset's business domains a role works in. The reference build maps a role to its own
 * three domains; this app's domains belong to the dataset, so each role names the ones it would
 * prefer and the strongest-ranked domain is the fallback — a role must always land on a domain the
 * server knows, because every later step drafts from it.
 */
const ROLE_DOMAINS: Record<string, string[]> = {
  cpa: ['capital-projects', 'capital-program'],
  reg: ['water-wastewater', 'rate-case-recovery'],
  sca: ['commitments', 'contract-change'],
  fa: ['capital-projects', 'capital-program'],
}

export function domainForRole(roleId: string | null, domainIds: string[]): string | null {
  if (!roleId) return null
  /* The shipped library's own answer first, then this app's preferences, then the strongest-ranked. */
  const served = ROLE_DOMAIN_OF[roleId]
  if (served) return served
  return ROLE_DOMAINS[roleId]?.find((d) => domainIds.includes(d)) ?? domainIds[0] ?? null
}

/** The role name, then the places it covers — what the use case is called until the reader renames it. */
export function suggestedRoleName(role: RoleDef | null, utilities: string[]): string {
  if (!role) return ''
  const places = utilities
    .filter((code) => code !== 'SSD')
    .map((code) => utilityByCode(code))
    .filter((u): u is UtilityDef => Boolean(u))
    .map((u) => shortUtilityName(u.name))
  return places.length ? `${role.name} · ${places.join(', ')}` : role.name
}

/**
 * The business need the later steps draft from. There is no free-text box any more: the role, where
 * it works and what it is responsible for *are* the brief, so it is composed from them.
 */
export function roleBusinessNeed(input: {
  role: RoleDef
  industry: string | null
  utilities: string[]
  reportsTo: string
  inScope: RoleArea[]
}): string {
  const places = input.utilities
    .map((code) => utilityByCode(code))
    .filter((u): u is UtilityDef => Boolean(u))
    .map((u) => shortUtilityName(u.name))
  const where = places.length
    ? ` for ${places.length > 1 ? `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}` : places[0]}`
    : ''
  const duties = input.inScope.map((a) => a.name.toLowerCase())
  return (
    `${input.role.name}${where} (${industryName(input.industry).toLowerCase()}). ${input.role.blurb}` +
    `${duties.length ? ` Responsible for ${duties.join('; ')}.` : ''}` +
    `${input.reportsTo.trim() ? ` Reports to ${input.reportsTo.trim()}.` : ''}`
  )
}

/** The job-description findings a reader can act on; a *confirm* only reports a match. */
export const jdFindings = (role: RoleDef): JdFinding[] => role.jd.findings

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** What step 1 is judged on — a subset of the wizard's draft. */
export interface RoleStepDraft {
  roleId: string | null
  industry: string | null
  utilitiesFound: boolean
  utilities: string[]
  reportsTo: string
}

export function roleIssue(d: RoleStepDraft): string | null {
  if (!d.roleId) return 'Pick the role this analyst plays.'
  if (!d.industry) return 'Pick the industry the role works in.'
  if (!d.utilitiesFound) return 'Wait for the utilities to be found in your connected data.'
  if (d.utilities.length === 0) return 'Select at least one utility this role covers.'
  if (!EMAIL.test(d.reportsTo.trim())) return 'Add the email address of the person this role reports to.'
  return null
}

export function responsibilitiesIssue(d: { ready: boolean; inScope: number }): string | null {
  if (!d.ready) return 'Generate the responsibilities first.'
  if (d.inScope === 0) return 'Keep at least one responsibility in scope.'
  return null
}

/** A saved role, back into the editor's shape: the library's areas with the reader's tasks laid over them. */
export function areasFromBrief(role: RoleDef, brief: RoleBrief): {
  areas: RoleArea[]
  dropped: Record<string, string[]>
} {
  const dropped: Record<string, string[]> = {}
  const areas = role.areas.map((a) => {
    const kept = brief.tasks[a.id] ?? []
    const removed = a.tasks.filter((t) => !kept.includes(t))
    if (removed.length) dropped[a.id] = removed
    return { ...a, tasks: [...kept, ...removed] }
  })
  return { areas, dropped }
}
