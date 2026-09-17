import { create } from 'zustand'
import {
  acceptOutstandingTypeLinks,
  draftStory,
  editSgbStory,
  getBridgeBuild,
  getDgbJob,
  getSgbBuild,
  getSgbGraph,
  getSgbStory,
  listBridgeBuilds,
  listDgbEntities,
  listDgbRelations,
  listDgbBuilds,
  listGraphVersions,
  listSgbBuilds,
  listStudioUseCases,
  listTypeLinks,
  overrideTypeLink,
  publishGraphVersion,
  reconcileGraphVersions,
  reviseBridgeBuild,
  triggerBridgeBuild,
  triggerCombinedBuild,
  unpublishGraphVersion,
} from '../api/client'
import type {
  BridgeBuild,
  DgbBuild,
  DgbEntity,
  DgbJob,
  DgbRelation,
  SgbBuild,
  SgbGraph,
  SgbStory,
  StudioUseCase,
  StudioVersion,
  TypeLink,
  TypeLinkDecision,
} from '../api/client'
import { toMessage, type Result } from './asyncState'

/**
 * Graph Studio's state — **one selector governs the whole page.**
 *
 * Every tab reads the use case held here, so no tab carries a picker of its own that could disagree
 * with the one above it. That was the fault the two studios this replaced had between them: a reader
 * had to know which screen a use case belonged to, and nothing on either said that two graphs answer
 * one business question.
 *
 * **Actions never throw.** They return `Result` and put the sentence in `error`, so the page has no
 * `try/catch` — the convention every store here keeps.
 */
interface StudioState {
  useCases: StudioUseCase[]
  /** How many sources this tenant has connected, as the server counted them.
   *
   *  **Nullable until the first load lands**, and the page reads it that way: `0` and "not asked
   *  yet" are opposite facts, and defaulting to 0 would flash "no data source is connected" over a
   *  tenant that has three. */
  connectedSources: number | null
  useCaseId: string | null
  /** Distinct from `useCases.length === 0`, which cannot tell "not fetched yet" from "fetched,
   *  genuinely none" — and the difference is a confident empty dropdown against a spinner. */
  loading: boolean
  error: string | null

  /* the structured lane */
  sgbBuilds: SgbBuild[]
  sgbBuild: SgbBuild | null
  sgbGraph: SgbGraph | null
  story: SgbStory | null
  storyDraft: string | null
  drafting: boolean

  /* the document lane */
  dgbJob: DgbJob | null
  dgbBuilds: DgbBuild[]
  entities: DgbEntity[]
  relations: DgbRelation[]

  /* the Bridge */
  bridges: BridgeBuild[]
  bridgeId: string | null
  typeLinks: TypeLink[]
  unreviewedCount: number
  /** Which row is mid-save, so only that row's button spins. */
  savingLinkId: string | null
  sweeping: boolean

  /* versions */
  versions: StudioVersion[]

  building: boolean
  /** Does a Bridge follow the run in flight? **The server's answer, from the trigger** — a use case
   *  with both lanes forms one when the second lands, and a page that worked this out for itself
   *  would be a second answer to whether a Bridge is coming. Cleared when that formation settles. */
  bridgeFollows: boolean
  busy: boolean

  load: () => Promise<void>
  select: (useCaseId: string | null) => void
  refresh: () => Promise<void>
  build: (story?: string) => Promise<Result>
  poll: () => Promise<void>
  draft: () => Promise<Result>
  saveStory: (story: string) => Promise<Result>
  formBridge: () => Promise<Result>
  selectBridge: (bridgeId: string) => Promise<void>
  /** Record one decision. **Forks when the Bridge is published**: nothing may change underneath
   *  an approval, so the edit lands on a draft copy carrying every other decision, and the
   *  published Bridge keeps answering until that draft is published in its turn. */
  decide: (link: TypeLink, decision: TypeLinkDecision, as: string | null) => Promise<Result>
  acceptAll: (as: string | null) => Promise<Result>
  /** Name whatever has finished with a version, and re-read the list. **Idempotent** — the server
   *  returns the existing row when the artifacts are already named, so this is safe to call before
   *  a publish rather than minting a second one. */
  recordVersion: () => Promise<Result>
  publish: (versionId: string, as: string | null) => Promise<Result>
  unpublish: (versionId: string) => Promise<Result>
}

/** The selected use case's row, or null. */
export const selectUseCase = (s: StudioState) =>
  s.useCases.find((u) => u.useCaseId === s.useCaseId) ?? null

/** A build the reader can watch, which is the newest one — the list is newest first. */
const newest = <T,>(list: T[]): T | null => list[0] ?? null

/** Is either lane still running? Read in one place so the tab locks and the poll cannot disagree. */
export const selectBuildRunning = (s: StudioState) =>
  (s.sgbBuild !== null && s.sgbBuild.status === 'running') ||
  (s.dgbJob !== null && s.dgbJob.status === 'running')

/**
 * Has either lane ever finished?
 *
 * **The canvas, the Bridge and Versions all read a build's output**, so they are locked until one
 * exists — and locked again while a rebuild runs, because what they would otherwise show is the
 * *previous* build's output with nothing saying so. A reader settling a correspondence against a
 * canvas that is being superseded is deciding on stale evidence.
 */
export const selectOutputReadable = (s: StudioState) =>
  (s.sgbBuilds.some((b) => b.status === 'complete') || s.dgbBuilds.length > 0) &&
  !selectBuildRunning(s)

/** The Bridge formation in flight, or null. The open one rather than any of them: a reader watching
 *  a run is watching the Bridge the selector holds. */
export const selectFormingBridge = (s: StudioState) => {
  const open = s.bridges.find((b) => b.bridgeBuildId === s.bridgeId) ?? null
  return open !== null && open.status === 'running' ? open : null
}

/**
 * Is the combined act still going?
 *
 * **The lanes and the Bridge are one run, and this is what says so.** A Bridge is formed FROM two
 * finished graphs, so it starts exactly when the lanes stop — and a watch that ended with the lanes
 * would leave the formation to be discovered by a reader pressing reload. It stays true across the
 * gap between the lanes settling and the formation appearing in the list, which is why it reads
 * `bridgeFollows` as well as the list itself.
 */
export const selectBridgeForming = (s: StudioState) =>
  selectFormingBridge(s) !== null || (s.bridgeFollows && !selectBuildRunning(s))

export const useStudioStore = create<StudioState>()((set, get) => ({
  useCases: [],
  connectedSources: null,
  useCaseId: null,
  loading: true,
  error: null,
  sgbBuilds: [],
  sgbBuild: null,
  sgbGraph: null,
  story: null,
  storyDraft: null,
  drafting: false,
  dgbJob: null,
  dgbBuilds: [],
  entities: [],
  relations: [],
  bridges: [],
  bridgeId: null,
  typeLinks: [],
  unreviewedCount: 0,
  savingLinkId: null,
  sweeping: false,
  versions: [],
  building: false,
  bridgeFollows: false,
  busy: false,

  load: async () => {
    set({ loading: true })
    try {
      const { useCases, connectedSources } = await listStudioUseCases()
      set({ useCases, connectedSources, error: null, loading: false })
      /* Land on something rather than an empty selector: a reader arriving from New Graph's last
         step has just committed one, and making them find it again is what made that wizard grow a
         build button of its own. */
      if (get().useCaseId === null && useCases.length > 0) {
        get().select(useCases[0].useCaseId)
      }
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  select: (useCaseId) => {
    /* Everything below the selector belongs to the previous use case, so it is cleared rather than
       left to be overwritten field by field — a lane that failed to load would otherwise show the
       last one's graph under this one's name. */
    set({
      useCaseId,
      sgbBuilds: [],
      sgbBuild: null,
      sgbGraph: null,
      story: null,
      storyDraft: null,
      dgbJob: null,
      dgbBuilds: [],
      entities: [],
      relations: [],
      bridges: [],
      bridgeId: null,
      typeLinks: [],
      unreviewedCount: 0,
      versions: [],
      bridgeFollows: false,
      error: null,
    })
    if (useCaseId) void get().refresh()
  },

  refresh: async () => {
    const id = get().useCaseId
    if (!id) return
    try {
      /* Concurrent: none of these depends on another, and the tab shell waits on all of them. */
      const [sgbBuilds, dgbBuilds, bridges] = await Promise.all([
        listSgbBuilds(id),
        listDgbBuilds(id),
        listBridgeBuilds(id),
      ])
      const sgbBuild = newest(sgbBuilds)
      set({ sgbBuilds, dgbBuilds, bridges, sgbBuild })

      /* Reconciling names whatever has finished with a version. Idempotent and safe on every load —
         which is the point: opening the studio settles the build you just ran rather than waiting. */
      await reconcileGraphVersions(id)
      const versions = await listGraphVersions(id)
      set({ versions, error: null })

      if (sgbBuild && sgbBuild.status === 'complete') {
        const [graph, story] = await Promise.all([
          getSgbGraph(sgbBuild.buildId),
          getSgbStory(sgbBuild.buildId),
        ])
        set({ sgbGraph: graph, story })
      }
      if (dgbBuilds.length > 0) {
        const [entities, relations] = await Promise.all([
          listDgbEntities({ useCaseId: id }),
          listDgbRelations({ useCaseId: id }),
        ])
        set({ entities, relations })
      }
      const bridge = newest(bridges)
      if (bridge) await get().selectBridge(bridge.bridgeBuildId)
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  build: async (story) => {
    const id = get().useCaseId
    if (!id) return { ok: false, error: 'Pick a use case first.' }
    set({ building: true })
    try {
      const { sgbBuildId, dgbJobId, bridgeFollows } = await triggerCombinedBuild({
        useCaseId: id,
        story,
      })
      /* Read the run back immediately rather than waiting for the first poll, so the panel draws its
         stage list on arrival instead of a blank second. */
      const sgbBuild = sgbBuildId ? await getSgbBuild(sgbBuildId) : null
      const dgbJob = dgbJobId ? await getDgbJob(dgbJobId) : null
      set({ sgbBuild, dgbJob, bridgeFollows, building: false, error: null })
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ building: false, error: message })
      return { ok: false, error: message }
    }
  },

  /** One tick of the build watch. Keyed on nothing: the page decides when to call it, and it reads
   *  whichever runs are in flight. */
  poll: async () => {
    const { sgbBuild, dgbJob, useCaseId } = get()
    if (!useCaseId) return
    try {
      const lanesRunning =
        sgbBuild?.status === 'running' || dgbJob?.status === 'running'
      if (lanesRunning) {
        const next: Partial<StudioState> = {}
        if (sgbBuild && sgbBuild.status === 'running') {
          next.sgbBuild = await getSgbBuild(sgbBuild.buildId)
        }
        if (dgbJob && dgbJob.status === 'running') {
          next.dgbJob = await getDgbJob(dgbJob.jobId)
        }
        set(next)
        const settled =
          (!next.sgbBuild || next.sgbBuild.status !== 'running') &&
          (!next.dgbJob || next.dgbJob.status !== 'running')
        /* A finished run changes what every other tab shows, so the whole studio is re-read once —
           which is also what records the version, and what picks up the Bridge the server formed at
           the moment the second lane landed. A poll that stops is not a subscription. */
        if (settled) await get().refresh()
        return
      }

      /*
       * The lanes are done, and the run is not: **a Bridge is formed FROM two finished graphs**, so
       * the formation starts exactly where they stop and the same watch follows it. Re-read through
       * `selectBridge`, which is the one path that reads a Bridge and its links together — a second
       * reader here would be a second answer to how many correspondences are still outstanding.
       */
      const forming = selectFormingBridge(get())
      if (forming) {
        await get().selectBridge(forming.bridgeBuildId)
        if (selectFormingBridge(get()) === null) {
          /* Landed. The version that names all three is recorded by the same refresh every other
             finished run goes through. */
          set({ bridgeFollows: false })
          await get().refresh()
        }
        return
      }

      /* Settled a beat before the formation appeared in the list — re-read once. A run that forms no
         Bridge (a lane failed, or the pair was already formed) clears the flag rather than leaving
         the watch ticking against nothing. */
      if (get().bridgeFollows) {
        await get().refresh()
        if (selectFormingBridge(get()) === null) set({ bridgeFollows: false })
      }
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  draft: async () => {
    const id = get().useCaseId
    if (!id) return { ok: false, error: 'Pick a use case first.' }
    set({ drafting: true })
    try {
      const drafted = await draftStory(id)
      set({ storyDraft: drafted.story, drafting: false, error: null })
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ drafting: false, error: message })
      return { ok: false, error: message }
    }
  },

  saveStory: async (story) => {
    const build = get().sgbBuild
    if (!build) return { ok: false, error: 'There is no build to edit the story of.' }
    set({ busy: true })
    try {
      await editSgbStory({ buildId: build.buildId, story })
      /* The build goes back to `running` while it re-extracts, so it is re-read here and the page's
         own poll takes it from there — exactly as for a fresh trigger. */
      const next = await getSgbBuild(build.buildId)
      set({ sgbBuild: next, busy: false, error: null })
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ busy: false, error: message })
      return { ok: false, error: message }
    }
  },

  formBridge: async () => {
    const id = get().useCaseId
    if (!id) return { ok: false, error: 'Pick a use case first.' }
    set({ busy: true })
    try {
      const { bridgeBuildId } = await triggerBridgeBuild(id)
      const bridges = await listBridgeBuilds(id)
      set({ bridges, busy: false, error: null })
      await get().selectBridge(bridgeBuildId)
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ busy: false, error: message })
      return { ok: false, error: message }
    }
  },

  selectBridge: async (bridgeBuildId) => {
    const id = get().useCaseId
    if (!id) return
    try {
      const [build, links] = await Promise.all([
        getBridgeBuild({ useCaseId: id, bridgeBuildId }),
        listTypeLinks({ useCaseId: id, bridgeBuildId }),
      ])
      set((s) => ({
        bridgeId: bridgeBuildId,
        typeLinks: links.typeLinks,
        unreviewedCount: links.unreviewedCount,
        bridges: s.bridges.map((b) => (b.bridgeBuildId === bridgeBuildId ? build : b)),
      }))
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  decide: async (link, decision, as) => {
    const { useCaseId, bridgeId, versions } = get()
    if (!useCaseId || !bridgeId) return { ok: false, error: 'There is no Bridge open.' }
    const frozen = versions.some((v) => v.publishedAt !== null && v.bridgeBuildId === bridgeId)
    set({ savingLinkId: link.typeLinkId })
    try {
      let target = bridgeId
      if (frozen) {
        /*
         * **The fork happens on the edit, not on a Revise button.** A button pressed before changing
         * anything means one exploratory click creates a Bridge byte-identical to its parent, and this
         * list is what somebody uses to find the draft they were working on — so litter in it is
         * expensive. No change, no copy.
         */
        const clone = await reviseBridgeBuild({ useCaseId, bridgeBuildId: bridgeId })
        target = clone.bridgeBuildId
      }
      /*
       * The clone's rows are new rows with new ids, so the original id addresses nothing there —
       * but `(entityType, conceptRef)` identifies the counterpart exactly. Matching on the concept
       * *name* would be wrong: two concepts can share a display name and only the ref separates them.
       */
      const onTarget = frozen
        ? (await listTypeLinks({ useCaseId, bridgeBuildId: target })).typeLinks.find(
            (l) => l.entityType === link.entityType && l.conceptRef === link.conceptRef,
          )
        : link
      if (!onTarget) {
        const message =
          'The draft was created, but this pair could not be found in it — open it from the list above and change the decision there.'
        set({ savingLinkId: null, error: message })
        return { ok: false, error: message }
      }
      await overrideTypeLink({
        useCaseId,
        bridgeBuildId: target,
        typeLinkId: onTarget.typeLinkId,
        decision,
        as,
      })
      if (frozen) {
        const bridges = await listBridgeBuilds(useCaseId)
        set({ bridges })
      }
      set({ savingLinkId: null, error: null })
      /* Re-read rather than patched in place: the count that gates publishing is the server's, and a
         second expression of it here is a screen reading "nothing left" over a refused publish. */
      await get().selectBridge(target)
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ savingLinkId: null, error: message })
      return { ok: false, error: message }
    }
  },

  acceptAll: async (as) => {
    const { useCaseId, bridgeId } = get()
    if (!useCaseId || !bridgeId) return { ok: false, error: 'There is no Bridge open.' }
    set({ sweeping: true })
    try {
      await acceptOutstandingTypeLinks({ useCaseId, bridgeBuildId: bridgeId, as })
      const links = await listTypeLinks({ useCaseId, bridgeBuildId: bridgeId })
      set({
        typeLinks: links.typeLinks,
        unreviewedCount: links.unreviewedCount,
        sweeping: false,
        error: null,
      })
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ sweeping: false, error: message })
      return { ok: false, error: message }
    }
  },

  recordVersion: async () => {
    const id = get().useCaseId
    if (!id) return { ok: false, error: 'Pick a use case first.' }
    set({ busy: true })
    try {
      await reconcileGraphVersions(id)
      const versions = await listGraphVersions(id)
      set({ versions, busy: false, error: null })
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ busy: false, error: message })
      return { ok: false, error: message }
    }
  },

  publish: async (versionId, as) => {
    const id = get().useCaseId
    if (!id) return { ok: false, error: 'Pick a use case first.' }
    set({ busy: true })
    try {
      await publishGraphVersion({ useCaseId: id, graphVersionId: versionId, as })
      const versions = await listGraphVersions(id)
      set({ versions, busy: false, error: null })
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ busy: false, error: message })
      return { ok: false, error: message }
    }
  },

  unpublish: async (versionId) => {
    const id = get().useCaseId
    if (!id) return { ok: false, error: 'Pick a use case first.' }
    set({ busy: true })
    try {
      await unpublishGraphVersion({ useCaseId: id, graphVersionId: versionId })
      const versions = await listGraphVersions(id)
      set({ versions, busy: false, error: null })
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ busy: false, error: message })
      return { ok: false, error: message }
    }
  },
}))
