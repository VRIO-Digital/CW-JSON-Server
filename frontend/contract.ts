/*
 * Every Graph Studio fetcher, against a LIVE server, through the real validators.
 *
 * **This is the gap that let a real bug through.** The server was driven end to end with raw `fetch`
 * (so every route answered 200) and the components were rendered against fabricated payloads (so
 * every panel drew) — and neither of those runs the thing in between. `SGB_STORY` required a
 * `build_id` the embedded story group does not carry, so every structured graph was refused at the
 * boundary with a message telling the reader to restart a mock server that was answering perfectly.
 *
 * A schema is a claim about what the server sends, and only a real response can check it.
 *
 * Run: start `npm run mock`, then
 *   VITE_API_BASE=http://localhost:4000 npx vite build --ssr contract.ts --outDir dist-ssr \
 *     --logLevel warn && node dist-ssr/contract.js
 */
import {
  acceptOutstandingTypeLinks,
  editSgbStory,
  getBridgeBuild,
  getChunkEvidence,
  getDgbJob,
  getPlayground,
  getPublishedBridge,
  getSgbBuild,
  getSgbGraph,
  getSgbStory,
  getStudioUseCase,
  getGraphVersionDetail,
  listBridgeBuilds,
  listCorpusDocuments,
  listDgbBuilds,
  listDgbClasses,
  listDgbEntities,
  listDgbRelations,
  listGraphVersions,
  listSgbBuilds,
  listStudioSources,
  listStudioUseCases,
  listTypeLinks,
  overrideTypeLink,
  publishGraphVersion,
  reconcileGraphVersions,
  reviseBridgeBuild,
  savePlayground,
  triggerBridgeBuild,
  triggerCombinedBuild,
  triggerDgbBuild,
  triggerSgbBuild,
  unpublishGraphVersion,
} from './src/api/client'
import { setCurrentDataset } from './src/api/dataset'

/* The dataset every request carries. Both are worth a run: the primary has two lanes, and the
   secondary has one — which is the branch where a Bridge is refused, `story_group` can be the
   only thing a lane produces, and every document-side field is legitimately absent. */
const DATASET = process.env.CONTRACT_DATASET ?? 'EPA'
setCurrentDataset(DATASET)

console.log(`dataset: ${DATASET}`)

let failures = 0
const seen = new Set<string>()

async function check<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  seen.add(name)
  try {
    const value = await run()
    console.log(`PASS  ${name}`)
    return value
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${name}\n        ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const { useCases } = (await check('listStudioUseCases', () => listStudioUseCases())) ?? {
  useCases: [],
}
await check('listStudioSources', () => listStudioSources())

const useCase = useCases.find((u) => u.hasStructured && u.hasDocuments) ?? useCases[0]
if (!useCase) {
  console.log('\nNo use case in this dataset — nothing to check.')
  process.exit(1)
}
const id = useCase.useCaseId
console.log(`\nusing ${id} (structured=${useCase.hasStructured} documents=${useCase.hasDocuments})\n`)

await check('getStudioUseCase', () => getStudioUseCase(id))
await check('listSgbBuilds (before)', () => listSgbBuilds(id))
await check('listDgbBuilds (before)', () => listDgbBuilds(id))
await check('listBridgeBuilds (before)', () => listBridgeBuilds(id))
await check('listGraphVersions (before)', () => listGraphVersions(id))
await check('getPublishedBridge', () => getPublishedBridge(id))
await check('listCorpusDocuments', () => listCorpusDocuments(id))

/*
 * The Playground reads and writes the **brief**, not a build, so it is checked here before anything
 * is triggered — a use case with nothing built still has metrics and hero questions to serve.
 *
 * The write sends the lists straight back, which is the round trip worth checking: what the server
 * normalised on the way out has to be something it accepts on the way in, or the first edit a reader
 * makes is refused for a row they never touched.
 */
const playground = await check('getPlayground', () => getPlayground(id))
if (playground) {
  await check('savePlayground', () =>
    savePlayground({
      useCaseId: id,
      metrics: playground.metrics,
      goldenQueries: playground.goldenQueries,
      files: playground.files,
      as: 'contract@example.com',
    }),
  )
}

const triggered = await check('triggerCombinedBuild', () =>
  triggerCombinedBuild({ useCaseId: id, story: 'A contract run.' }),
)

/* Poll both lanes to completion through the real fetchers — which is also what exercises the build
   payload's schema on every tick rather than only once. */
if (triggered?.sgbBuildId) {
  for (let i = 0; i < 60; i++) {
    const build = await getSgbBuild(triggered.sgbBuildId)
    if (build.status !== 'running') break
    await sleep(1000)
  }
  await check('getSgbBuild', () => getSgbBuild(triggered.sgbBuildId as string))
  await check('getSgbGraph', () => getSgbGraph(triggered.sgbBuildId as string))
  await check('getSgbStory', () => getSgbStory(triggered.sgbBuildId as string))
}
if (triggered?.dgbJobId) {
  for (let i = 0; i < 60; i++) {
    const job = await getDgbJob(triggered.dgbJobId)
    if (job.status !== 'running') break
    await sleep(1000)
  }
  await check('getDgbJob', () => getDgbJob(triggered.dgbJobId as string))
}

/*
 * The story edit, and then the per-lane triggers.
 *
 * The combined build above is the one press a reader makes, but each lane keeps its own route —
 * re-forming a Bridge without rebuilding a graph is a different act — and a route with no contract
 * coverage is a schema nothing has checked against a real response.
 */
if (triggered?.sgbBuildId) {
  await check('editSgbStory', () =>
    editSgbStory({ buildId: triggered.sgbBuildId as string, story: 'Rewritten by the contract run.' }),
  )
  /* The edit puts the build back to `running`; wait it out so the per-lane trigger below is not
     racing a re-extraction. */
  for (let i = 0; i < 60; i++) {
    const build = await getSgbBuild(triggered.sgbBuildId)
    if (build.status !== 'running') break
    await sleep(1000)
  }
}
if (useCase.hasStructured) {
  await check('triggerSgbBuild', () => triggerSgbBuild({ useCaseId: id }))
}
if (useCase.hasDocuments) {
  await check('triggerDgbBuild', () => triggerDgbBuild(id))
}

await check('listDgbBuilds (after)', () => listDgbBuilds(id))
if (useCase.hasDocuments) {
  const entities = await check('listDgbEntities', () => listDgbEntities({ useCaseId: id }))
  const relations = await check('listDgbRelations', () => listDgbRelations({ useCaseId: id }))
  await check('listDgbClasses', () => listDgbClasses(id))
  const chunkId = relations?.[0]?.chunkId
  if (chunkId) await check('getChunkEvidence', () => getChunkEvidence({ useCaseId: id, chunkId }))
  console.log(`        (${entities?.length ?? 0} entities, ${relations?.length ?? 0} relations)`)
}

if (useCase.hasStructured && useCase.hasDocuments) {
  const bridge = await check('triggerBridgeBuild', () => triggerBridgeBuild(id))
  if (bridge) {
    for (let i = 0; i < 40; i++) {
      const b = await getBridgeBuild({ useCaseId: id, bridgeBuildId: bridge.bridgeBuildId })
      if (b.status !== 'running') break
      await sleep(800)
    }
    await check('getBridgeBuild', () =>
      getBridgeBuild({ useCaseId: id, bridgeBuildId: bridge.bridgeBuildId }),
    )
    const links = await check('listTypeLinks', () =>
      listTypeLinks({ useCaseId: id, bridgeBuildId: bridge.bridgeBuildId }),
    )
    const first = links?.typeLinks.find((l) => l.decision !== 'reject')
    if (first) {
      await check('overrideTypeLink', () =>
        overrideTypeLink({
          useCaseId: id,
          bridgeBuildId: bridge.bridgeBuildId,
          typeLinkId: first.typeLinkId,
          decision: 'attribute',
          as: 'contract@example.com',
        }),
      )
    }
    await check('acceptOutstandingTypeLinks', () =>
      acceptOutstandingTypeLinks({
        useCaseId: id,
        bridgeBuildId: bridge.bridgeBuildId,
        as: 'contract@example.com',
      }),
    )
    await check('reviseBridgeBuild', () =>
      reviseBridgeBuild({ useCaseId: id, bridgeBuildId: bridge.bridgeBuildId }),
    )
  }
}

await check('reconcileGraphVersions', () => reconcileGraphVersions(id))
const versions = await check('listGraphVersions (after)', () => listGraphVersions(id))
const version = versions?.[0]
if (version) {
  await check('getGraphVersionDetail', () =>
    getGraphVersionDetail({ useCaseId: id, graphVersionId: version.graphVersionId }),
  )
  await check('publishGraphVersion', () =>
    publishGraphVersion({
      useCaseId: id,
      graphVersionId: version.graphVersionId,
      as: 'contract@example.com',
    }),
  )
  await check('getPublishedBridge (after publish)', () => getPublishedBridge(id))
  await check('unpublishGraphVersion', () =>
    unpublishGraphVersion({ useCaseId: id, graphVersionId: version.graphVersionId }),
  )
}

console.log(
  `\n${seen.size - failures}/${seen.size} studio fetchers validated a real response` +
    (failures ? ` — ${failures} FAILED` : ''),
)
process.exit(failures === 0 ? 0 : 1)
