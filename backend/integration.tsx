/*
 * Does the app accept what the FastAPI server says?
 *
 * `client.ts` validates every response at its boundary, so a field renamed or a
 * type drifted between the Node server and its Python port surfaces as a toast in
 * the UI and nowhere else. This runs the **real** exported fetchers — their real
 * schemas, their real snake_case-to-camelCase mapping — against payloads recorded
 * from the running API by `python backend/capture.py`.
 *
 *     npm run api:contract
 *
 * Kept rather than deleted after use, unlike the usual scratch assertion: it is
 * the only check that the Python server and the TypeScript client still agree,
 * and that agreement is the whole risk of having rewritten the server.
 */
import { readFileSync } from 'node:fs'
import * as api from '../src/api/client'

type Captured = {
  ids: Record<string, string>
  responses: Record<string, { status: number; body: unknown }>
}

// Read relative to the repo root: the bundle lands in dist-ssr, so a path
// resolved from import.meta.url would look for the capture beside the bundle.
const captured = JSON.parse(
  readFileSync('backend/captured.json', 'utf8'),
) as Captured

const { ids, responses } = captured

/*
 * The stub matches the recorded path exactly, then falls back to a match in which
 * only an **id-shaped** segment may differ — one carrying a colon, a dash or a
 * digit. The first draft let any segment stand in for any other, so
 * `/projects/x/datasets` was served the payload for `/drives/y/folders` and seven
 * fetchers "failed" with every field undefined. A stub that serves the wrong
 * payload is worse than one that serves none: it reports a contract break that
 * does not exist, and hides the two that do.
 */
const keys = Object.keys(responses)

/*
 * Which segments may vary: an opaque id, and nothing else. "id-shaped" was first
 * written as "contains a colon, a dash or a digit", which makes `change-signals`
 * and `graph-domains` interchangeable — so `/change-signals` was served the
 * domains payload and reported a contract break that did not exist. A literal
 * path segment is a literal, however many hyphens it has.
 */
const KNOWN_IDS = new Set(Object.values(ids))
const isId = (segment: string) =>
  KNOWN_IDS.has(segment) ||
  segment.includes(':') ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(segment) ||
  /^(uc|rp|sv|gl)-/.test(segment) ||
  /^[0-9a-f]{12,}$/.test(segment) ||
  /^\d+$/.test(segment)

function lookup(method: string, path: string): { status: number; body: unknown } | null {
  const exact = responses[`${method} ${path}`]
  if (exact) return exact

  const wanted = path.split('/')
  let fallback: { status: number; body: unknown } | null = null
  for (const key of keys) {
    const [m, p] = key.split(' ')
    if (m !== method) continue
    const parts = p.split('/')
    if (parts.length !== wanted.length) continue
    const same = parts.every((part, i) => part === wanted[i] || (isId(part) && isId(wanted[i])))
    if (!same) continue
    // Prefer a success: both connectors' `/browse-documents` are recorded, and one
    // of them is the refusal that names its twin.
    if (responses[key].status < 400) return responses[key]
    fallback = fallback ?? responses[key]
  }
  return fallback
}

let served = 0
const missed: string[] = []

globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
  const url = String(input)
  // Decoded before matching: `client.ts` encodes a source id, so the wire carries
  // `bigquery%3Avrio-…` while the capture is keyed on the colon it stands for.
  const path = decodeURIComponent(
    url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '').split('?')[0],
  )
  const method = (init?.method ?? 'GET').toUpperCase()

  const hit = lookup(method, path)
  if (!hit) {
    missed.push(`${method} ${path}`)
    return new Response(JSON.stringify({ error: `nothing captured for ${method} ${path}` }), {
      status: 599,
      headers: { 'content-type': 'application/json' },
    })
  }
  served += 1
  return new Response(JSON.stringify(hit.body), {
    status: hit.status,
    headers: { 'content-type': 'application/json' },
  })
}) as typeof fetch

const pass: string[] = []
const fail: string[] = []

async function check(name: string, run: () => Promise<unknown>) {
  try {
    await run()
    pass.push(name)
    console.log(`  ok   ${name}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A path the capture does not hold is a gap in the capture, not a failure of
    // the contract — reported separately so the two are never confused.
    if (message.includes('nothing captured for')) {
      console.log(`  --   ${name} (not captured)`)
      return
    }
    fail.push(`${name} — ${message}`)
    console.log(`  FAIL ${name} — ${message}`)
  }
}

const bq = ids.bigquerySourceId
const gd = ids.driveSourceId
const uc = ids.useCaseId

async function main() {
  console.log('\n— identity and settings —')
  await check('listAuthRoles', () => api.listAuthRoles())
  await check('getSettings', () => api.getSettings())

  console.log('\n— sources and the catalogue —')
  await check('listSources', () => api.listSources())
  await check('listProjectDatasets', () => api.listProjectDatasets('vrio-contextweave-demo'))
  await check('listDriveFolders', () => api.listDriveFolders('compliance-docs'))
  await check('browseSource', () => api.browseSource(bq))
  await check('browseDocuments', () => api.browseDocuments(gd))
  await check('getProfiledColumns', () => api.getProfiledColumns(bq))
  await check('getProfiledDocuments', () => api.getProfiledDocuments(gd))
  await check('listProfilingJobs', () => api.listProfilingJobs())
  await check('listChangeSignals', () => api.listChangeSignals())

  console.log('\n— the wizard —')
  await check('listGraphDomains', () => api.listGraphDomains())
  await check('listGraphSources', () => api.listGraphSources())
  await check('listUseCases', () => api.listUseCases())

  console.log('\n— the studio —')
  await check('listStudioGraphs', () => api.listStudioGraphs())
  await check('getGraphStudio', () => api.getGraphStudio(uc))
  await check('getStudioCanvas', () => api.getStudioCanvas(uc))
  await check('listGraphBuilds', () => api.listGraphBuilds(uc))

  console.log('\n— Ask —')
  await check('listAskGraphs', () => api.listAskGraphs())

  console.log('\n— the What-if lens —')
  await check('getWhatIfFrame', () => api.getWhatIfFrame())

  console.log('\n— reports and governance —')
  await check('getReports', () => api.getReports())
  await check('getReport', () => api.getReport(ids.reportId ?? 'risk'))

  console.log('\n— telemetry —')
  await check('getAudit', () => api.getAudit())
  await check('getTraces', () => api.getTraces())
  await check('getEvals', () => api.getEvals())

  console.log('\n— the db editor —')
  await check('getDb', () => api.getDb())

  /*
   * The writes, which are validated exactly like the reads — a registration, a
   * queued job or a saved section is rendered the same way a fetched list is, and
   * a stale server answers a write with the old shape as readily as a read.
   */
  console.log('\n— writes answer with a shape too —')
  await check('login', () => api.login('adaeze.okonjo@vriodigital.com', 'secret1'))
  await check('setPersonaNav', () =>
    api.setPersonaNav('business_user_executive', { reports: false }))
  await check('resetPersonaNav', () => api.resetPersonaNav('business_user_executive'))
  await check('previewSource', () =>
    api.previewSource('vrio-contextweave-demo', 'handle'))
  await check('registerSource', () =>
    api.registerSource({
      projectId: 'vrio-contextweave-demo',
      credentialHandle: 'handle',
      datasets: ['epa_hazwaste'],
      sourceName: 'EPA Hazwaste register',
    }))
  await check('profileTables', () =>
    api.profileTables(bq, [{ datasetId: 'epa_hazwaste', tableId: 'e_manifest' }]))
  await check('profileDocuments', () =>
    api.profileDocuments(gd, [{ folderId: 'f_08_unstructured', documentId: 'd_chemours_cd' }]))
  await check('setColumnDescription', () =>
    api.setColumnDescription(bq, 'epa_hazwaste', 'e_manifest', 'mtn', 'A note.'))
  await check('reviewCoverage', () =>
    api.reviewCoverage({ name: 'x', sources: [], heroQuestions: [] }))
  await check('saveUseCase', () =>
    api.saveUseCase({
      name: 'x',
      domainId: 'hazardous-waste',
      businessNeed: '',
      personas: [],
      kpis: [],
      sources: [],
      heroQuestions: [],
      gapDecisions: [],
      step: 1,
    }))
  await check('startGraphBuild', () => api.startGraphBuild(uc))
  await check('decideReviewItem', () =>
    api.decideReviewItem({ useCaseId: uc, itemId: 'rq2', choice: 'approve' }))
  await check('resolvePivot', () => api.resolvePivot(uc, 'opt-merge'))
  await check('askStudio', () => api.askStudio(uc, 'a question'))
  await check('computeWhatIfScenario', () =>
    api.computeWhatIfScenario('g01', ['enf']))
  await check('resolveWhatIfMeasure', () => api.resolveWhatIfMeasure('tonnage'))

  /*
   * The streamed answer. `askQuestionStreaming` validates **every** event and
   * `done` as one object, and the object it keeps is what reaches the screen — so
   * nothing on Ask was assembled from unchecked fragments. A JSON payload cannot
   * exercise that half, which is why the raw event stream is recorded too.
   */
  console.log('\n— the streamed answer —')
  const stream = captured.sse['POST /ask']
  if (!stream) {
    console.log('  --   askQuestionStreaming (no stream captured)')
  } else {
    const events: string[] = []
    await check('askQuestionStreaming', async () => {
      globalThis.fetch = (async () =>
        new Response(new TextEncoder().encode(stream), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })) as typeof fetch

      const answer = await api.askQuestionStreaming(
        uc,
        'anything',
        { citations: 'required', formats: [] },
        (event) => events.push(event.kind),
      )
      if (!answer) throw new Error('the stream produced no answer envelope')
      if (!events.includes('summary')) throw new Error('no summary event reached the page')
      if (!events.includes('stage')) throw new Error('no stage event reached the page')
    })
    console.log(`       ${events.length} events parsed: ${[...new Set(events)].join(', ')}`)
  }

  console.log('\n' + '='.repeat(62))
  console.log(`  ${pass.length} payloads validated, ${fail.length} rejected`)
  console.log(`  (${served} stubbed responses served)`)
  if (fail.length > 0) {
    console.log('='.repeat(62))
    for (const f of fail) console.log(`  · ${f}`)
  }
  if (missed.length > 0) {
    console.log(`  paths the capture does not hold: ${[...new Set(missed)].join(', ')}`)
  }
  console.log('='.repeat(62) + '\n')
  process.exitCode = fail.length > 0 ? 1 : 0
}

void main()
