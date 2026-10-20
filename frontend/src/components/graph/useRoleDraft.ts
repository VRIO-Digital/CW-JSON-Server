import { useEffect, useMemo, useRef, useState } from 'react'
import type { RoleBrief } from '../../api/client'
import {
  areasFromBrief,
  responsibilitiesIssue,
  roleBusinessNeed,
  roleById,
  roleIssue,
  suggestedRoleName,
} from '../../data/roleBrief'
import { OUT_REASONS, UTILITIES, type JdFinding, type RoleArea } from '../../data/roleLibrary'

/*
 * Everything the New Role wizard's first two steps hold, and every act on it.
 *
 * One hook rather than a dozen `useState`s in the page, because the two steps are one decision seen
 * twice: picking a different role discards the responsibilities drafted for the last one, and the
 * business need every later step drafts from is composed out of both. The three waits are paced on
 * the client for the reason the report prototype's authoring steps are — nothing here has a request
 * whose return could advance them, so the alternative to a hold is a step that completes before the
 * reader has seen it start.
 */

/** One line of the utilities scan appears per this long. */
const SCAN_STEP_MS = 850
/** Drafting the responsibilities of a role. */
const DRAFT_MS = 2600
/** Reading an uploaded job description. */
const JD_READ_MS = 3200

export type FindingStatus = 'open' | 'accepted' | 'dismissed'

export interface JdState {
  file: string
  reading: boolean
  status: Record<string, FindingStatus>
}

export function useRoleDraft() {
  const [roleId, setRoleId] = useState<string | null>(null)
  const [industry, setIndustry] = useState<string | null>(null)
  const [scan, setScan] = useState({ shown: 0, done: false })
  const [utilities, setUtilities] = useState<string[]>([])
  const [reportsTo, setReportsTo] = useState('')
  const [areas, setAreas] = useState<RoleArea[]>([])
  const [drafting, setDrafting] = useState(false)
  const [ready, setReady] = useState(false)
  /** Area id → why it is out of scope; absent means in scope. */
  const [out, setOut] = useState<Record<string, string>>({})
  /** Area id → tasks the reader unticked. */
  const [dropped, setDropped] = useState<Record<string, string[]>>({})
  const [openArea, setOpenArea] = useState<string | null>(null)
  const [newTask, setNewTask] = useState<Record<string, string>>({})
  const [jd, setJd] = useState<JdState | null>(null)

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms))
  }
  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  useEffect(() => clearTimers, [])

  const role = roleById(roleId)
  const inScope = useMemo(() => areas.filter((a) => !out[a.id]), [areas, out])

  function resetResponsibilities() {
    setAreas([])
    setReady(false)
    setOut({})
    setDropped({})
    setJd(null)
    setOpenArea(null)
  }

  function pickRole(id: string) {
    if (id === roleId) return
    setRoleId(id)
    resetResponsibilities()
  }

  /** Choosing an industry starts the scan of the connected data for its utilities. */
  function pickIndustry(id: string) {
    if (id === industry) return
    clearTimers()
    setIndustry(id)
    setUtilities([])
    setScan({ shown: 0, done: false })
    const found = UTILITIES[id]
    if (!found) return
    found.steps.forEach((_, i) => later(() => setScan({ shown: i + 1, done: false }), SCAN_STEP_MS * (i + 1)))
    later(() => {
      setScan({ shown: found.steps.length, done: true })
      setUtilities(found.found.filter((u) => u.preselect).map((u) => u.code))
    }, SCAN_STEP_MS * (found.steps.length + 1))
  }

  function toggleUtility(code: string, on: boolean) {
    setUtilities((prev) => (on ? [...prev, code] : prev.filter((c) => c !== code)))
  }

  function draftResponsibilities() {
    if (!role) return
    setDrafting(true)
    setReady(false)
    later(() => {
      setAreas(role.areas.map((a) => ({ ...a, tasks: [...a.tasks] })))
      setOut({})
      setDropped({})
      setJd(null)
      setDrafting(false)
      setReady(true)
      setOpenArea(role.areas[0]?.id ?? null)
    }, DRAFT_MS)
  }

  function setScope(areaId: string, keep: boolean) {
    setOut((prev) => {
      const next = { ...prev }
      if (keep) delete next[areaId]
      else next[areaId] = OUT_REASONS[0]
      return next
    })
  }

  function setReason(areaId: string, reason: string) {
    setOut((prev) => ({ ...prev, [areaId]: reason }))
  }

  function toggleTask(areaId: string, task: string, keep: boolean) {
    setDropped((prev) => {
      const list = prev[areaId] ?? []
      return { ...prev, [areaId]: keep ? list.filter((t) => t !== task) : [...list, task] }
    })
  }

  function addTask(areaId: string) {
    const task = (newTask[areaId] ?? '').trim()
    if (!task) return
    setAreas((prev) =>
      prev.map((a) => (a.id === areaId && !a.tasks.includes(task) ? { ...a, tasks: [...a.tasks, task] } : a)),
    )
    setNewTask((prev) => ({ ...prev, [areaId]: '' }))
  }

  /** Only the name travels — nothing here opens the file; what it "says" is the role library's. */
  function readJobDescription(file: string) {
    if (!role) return
    setJd({ file, reading: true, status: {} })
    later(
      () =>
        setJd({
          file,
          reading: false,
          status: Object.fromEntries(role.jd.findings.map((f) => [f.id, 'open' as FindingStatus])),
        }),
      JD_READ_MS,
    )
  }

  function decideFinding(finding: JdFinding, accept: boolean) {
    setJd((prev) =>
      prev ? { ...prev, status: { ...prev.status, [finding.id]: accept ? 'accepted' : 'dismissed' } } : prev,
    )
    if (!accept) return
    if (finding.kind === 'task' && finding.area && finding.value) {
      const value = finding.value
      setAreas((prev) =>
        prev.map((a) => (a.id === finding.area && !a.tasks.includes(value) ? { ...a, tasks: [...a.tasks, value] } : a)),
      )
      setOpenArea(finding.area)
    }
    if (finding.kind === 'scope' && finding.area) {
      setOut((prev) => ({ ...prev, [finding.area as string]: finding.reason || OUT_REASONS[0] }))
    }
  }

  function reset() {
    clearTimers()
    setRoleId(null)
    setIndustry(null)
    setScan({ shown: 0, done: false })
    setUtilities([])
    setReportsTo('')
    setNewTask({})
    resetResponsibilities()
    setDrafting(false)
  }

  /** Re-open a saved role: the library's areas with the reader's tasks laid back over them. */
  function hydrate(brief: RoleBrief | null) {
    reset()
    const lib = brief ? roleById(brief.roleId) : null
    if (!brief || !lib) return
    setRoleId(brief.roleId)
    setIndustry(brief.industry || null)
    setUtilities(brief.utilities)
    setScan({ shown: (UTILITIES[brief.industry]?.steps.length ?? 0), done: Boolean(brief.industry) })
    setReportsTo(brief.reportsTo)
    if (Object.keys(brief.tasks).length > 0 || brief.responsibilities.length > 0) {
      const restored = areasFromBrief(lib, brief)
      setAreas(restored.areas)
      setDropped(restored.dropped)
      setOut(brief.out)
      setReady(true)
    }
  }

  /** What is saved with the draft; `null` until a role is picked. */
  function toBrief(): RoleBrief | null {
    if (!role || !industry) return null
    return {
      roleId: role.id,
      roleName: role.name,
      industry,
      utilities,
      reportsTo: reportsTo.trim(),
      responsibilities: inScope.map((a) => a.id),
      tasks: Object.fromEntries(areas.map((a) => [a.id, a.tasks.filter((t) => !(dropped[a.id] ?? []).includes(t))])),
      out,
      jobDescription: jd?.file ?? null,
    }
  }

  const businessNeed = useMemo(
    () =>
      role && industry && ready
        ? roleBusinessNeed({ role, industry, utilities, reportsTo, inScope })
        : '',
    [role, industry, ready, utilities, reportsTo, inScope],
  )

  const defaultName = suggestedRoleName(role, utilities)

  return {
    // what step 1 / 2 are judged on
    roleId,
    industry,
    utilitiesFound: scan.done,
    utilities,
    reportsTo,
    ready,
    inScopeCount: inScope.length,
    roleProblem: roleIssue({ roleId, industry, utilitiesFound: scan.done, utilities, reportsTo }),
    responsibilitiesProblem: responsibilitiesIssue({ ready, inScope: inScope.length }),
    // what the steps draw
    role,
    scan,
    areas,
    drafting,
    out,
    dropped,
    openArea,
    newTask,
    jd,
    inScope,
    businessNeed,
    defaultName,
    // acts
    setReportsTo,
    setOpenArea,
    setNewTask,
    pickRole,
    pickIndustry,
    toggleUtility,
    draftResponsibilities,
    setScope,
    setReason,
    toggleTask,
    addTask,
    readJobDescription,
    decideFinding,
    reset,
    hydrate,
    toBrief,
  }
}

export type RoleDraft = ReturnType<typeof useRoleDraft>
