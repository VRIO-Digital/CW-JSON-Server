#!/usr/bin/env node
/**
 * Redo, against a freshly restarted `npm run mock`, everything that only lives in that
 * process's memory: connect the two sources the EPA "Hazardous waste compliance" use case
 * already names, profile them, build both Graph Studio lanes (+ the Bridge between them),
 * publish the resulting version, then ask it one of its own hero questions.
 *
 * Why this exists: registered sources, profiling jobs, Graph Studio builds/Bridges/versions
 * and publications are all in-memory state (see CLAUDE.md's "Consequences worth knowing
 * before debugging" and "The in-memory runtime" sections) — a restart empties every one of
 * them even though backend/db.json still carries the committed use case, its hero questions
 * and its ask_answers. Without redoing this by hand in the UI, Sources, the Data Catalog,
 * Graph Studio, Ask, Reports, the What-if lens and Audit & Governance all come back empty.
 *
 * This script is the API-level equivalent of: connect BigQuery, connect Drive, profile both,
 * open Graph Studio, "Build this use case", clear the Bridge review, publish the version, ask
 * a question — for the one use case in db.json that already names real projects/datasets/
 * tables and a real drive/folders/documents, so nothing here invents data the tenant does not
 * have.
 *
 * Usage (with `npm run mock` already running in another terminal):
 *   node backend/scripts/demo-connect-flow.js
 *   node backend/scripts/demo-connect-flow.js --ask "Trace manifest 346581037ELC cradle-to-grave."
 *
 *   MOCK_ORIGIN=http://localhost:4001 node backend/scripts/demo-connect-flow.js   # non-default port
 *
 * Safe to re-run: registering an already-registered source or re-profiling an already-profiled
 * object is a no-op on the server (see sourceRow/queueJob). Re-running while the same server
 * process is still up rebuilds both lanes again and publishes a new version (v2, v3, ...) over
 * the same content, which costs about a minute but is otherwise harmless.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ORIGIN = process.env.MOCK_ORIGIN ?? `http://localhost:${process.env.PORT ?? 4000}`
const BASE = `${ORIGIN}/backend`
const DATASET = 'EPA'

// The reference data (project/dataset/table ids, drive/folder/document ids, credential
// handles, the use case's own text) comes straight out of db.json rather than being typed
// here a second time — the same reason the seeds read the demo package instead of hand-typing
// its contents.
const db = JSON.parse(readFileSync(join(__dirname, '../db.json'), 'utf8'))

function logStep(msg) {
  console.log(msg)
}

async function call(method, path, body) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-dataset': DATASET },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(
      `could not reach ${BASE}${path} (${err.message}). Is "npm run mock" running? ` +
        `This script talks to it over HTTP; it does not start it.`,
    )
  }
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${json.error ?? text}`)
  }
  return json
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls `fn` until `isDone` accepts its result, or throws after `timeoutMs`. */
async function pollUntil(fn, isDone, { intervalMs = 1500, timeoutMs = 60_000, label = 'job' } = {}) {
  const startedAt = Date.now()
  for (;;) {
    const value = await fn()
    if (isDone(value)) return value
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)
    }
    await sleep(intervalMs)
  }
}

/** Reads a `POST /ask` SSE stream to completion and prints it as it arrives. */
async function askStreaming(useCaseId, question) {
  const res = await fetch(`${BASE}/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dataset': DATASET },
    body: JSON.stringify({ use_case_id: useCaseId, question }),
  })
  if (!res.ok) {
    throw new Error(`POST /ask -> ${res.status}: ${await res.text()}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final = null

  while (!final) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const eventLine = chunk.split('\n').find((l) => l.startsWith('event: '))
      const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (!eventLine || !dataLine) continue
      const event = eventLine.slice('event: '.length)
      const data = JSON.parse(dataLine.slice('data: '.length))
      if (event === 'stage') logStep(`      ... ${data.detail}`)
      else if (event === 'summary') logStep(`      ${data.summary}`)
      else if (event === 'done') final = data
    }
  }

  if (!final) throw new Error('the /ask stream ended without a "done" event')
  return final
}

async function main() {
  const project = db.projects.find((p) => p.project_id === 'vrio-contextweave-demo')
  if (!project) throw new Error('db.json has no project "vrio-contextweave-demo" to connect')
  const credential = db.credentials.find((c) => c.project_id === project.project_id)
  if (!credential) throw new Error(`db.json has no credential for ${project.project_id}`)
  const dataset = project.datasets[0]
  const tableIds = dataset.tables.map((t) => t.table_id)

  const drive = db.drives.find((d) => d.drive_id === 'compliance-docs')
  if (!drive) throw new Error('db.json has no drive "compliance-docs" to connect')
  const driveCredential = db.drive_credentials.find((c) => c.drive_id === drive.drive_id)
  if (!driveCredential) throw new Error(`db.json has no drive credential for ${drive.drive_id}`)
  const folderIds = drive.folders.map((f) => f.folder_id)

  const useCase =
    db.graph_use_cases.find((u) => u.use_case_id === 'uc-hazardous-waste-compliance-mt364xage') ??
    db.graph_use_cases.find((u) => u.name === 'Hazardous waste compliance' && u.status === 'committed')
  if (!useCase) {
    throw new Error(
      'no committed "Hazardous waste compliance" use case in db.json. This script rebuilds ' +
        'that one; if it was renamed, deleted or replaced, point it at another committed ' +
        'use_case_id from GET /graph-use-cases.',
    )
  }
  const useCaseId = useCase.use_case_id
  const publishAs = db.google_account?.email ?? 'demo@vriodigital.com'

  logStep(`Target dataset: ${DATASET}`)
  logStep(`Target use case: "${useCase.name}" (${useCaseId})\n`)

  logStep('[1/7] Connecting the BigQuery source...')
  const bqSource = await call('POST', '/sources', {
    project_id: project.project_id,
    credential_handle: credential.credential_handle,
    datasets: [dataset.dataset_id],
    source_name: `${project.display_name} BigQuery`,
  })
  logStep(`      connected: ${bqSource.source_name} (${bqSource.source_id})`)

  logStep('[2/7] Profiling its tables...')
  const bqJob = await call(
    'POST',
    `/sources/${encodeURIComponent(bqSource.source_id)}/profile`,
    { objects: tableIds.map((table_id) => ({ dataset_id: dataset.dataset_id, table_id })) },
  )
  await pollUntil(
    () => call('GET', '/profiling-jobs'),
    (r) => [...r.active, ...r.recent].find((j) => j.job_id === bqJob.job.job_id)?.status === 'complete',
    { label: 'BigQuery profiling job', timeoutMs: 30_000 },
  )
  logStep(`      profiled ${tableIds.length} tables`)

  logStep('[3/7] Connecting the Drive source...')
  const driveSource = await call('POST', '/sources/drive', {
    drive_id: drive.drive_id,
    credential_handle: driveCredential.credential_handle,
    folders: folderIds,
    source_name: `${drive.display_name} Drive`,
  })
  logStep(`      connected: ${driveSource.source_name} (${driveSource.source_id})`)

  logStep('[4/7] Profiling its documents...')
  const driveJob = await call(
    'POST',
    `/sources/${encodeURIComponent(driveSource.source_id)}/profile-documents`,
    {},
  )
  await pollUntil(
    () => call('GET', '/profiling-jobs'),
    (r) => [...r.active, ...r.recent].find((j) => j.job_id === driveJob.job.job_id)?.status === 'complete',
    { label: 'Drive profiling job', timeoutMs: 30_000 },
  )
  logStep('      profiled every document under its folders')

  logStep('[5/7] Building the structured and document lanes...')
  const build = await call('POST', `/use-cases/${encodeURIComponent(useCaseId)}/combined-builds`, {})

  if (build.sgb_build_id) {
    await pollUntil(
      () => call('GET', `/structured-graph-builder/builds/${build.sgb_build_id}`),
      (r) => r.status === 'complete',
      { label: 'structured lane build', timeoutMs: 60_000 },
    )
    logStep('      structured lane: complete')
  }
  if (build.dgb_job_id) {
    await pollUntil(
      () => call('GET', `/document-graph-builder/jobs/${build.dgb_job_id}`),
      (r) => r.status === 'complete',
      { label: 'document lane build', timeoutMs: 60_000 },
    )
    logStep('      document lane: complete')
  }

  if (build.bridge_follows) {
    logStep('[6/7] Forming the Bridge and clearing its review queue...')
    const bridgeList = await pollUntil(
      () => call('GET', `/use-cases/${encodeURIComponent(useCaseId)}/bridge-builds`),
      (r) => ['succeeded', 'failed'].includes(r.bridge_builds[0]?.status),
      { label: 'Bridge formation', timeoutMs: 30_000 },
    )
    const bridgeBuild = bridgeList.bridge_builds[0]
    logStep(`      Bridge: ${bridgeBuild.status}`)

    if (bridgeBuild.status === 'succeeded') {
      const links = await call(
        'GET',
        `/use-cases/${encodeURIComponent(useCaseId)}/bridge-builds/${bridgeBuild.bridge_build_id}/type-links`,
      )
      if (links.unreviewed_count > 0) {
        logStep(`      accepting ${links.unreviewed_count} outstanding correspondence(s) as derived...`)
        await call(
          'POST',
          `/use-cases/${encodeURIComponent(useCaseId)}/bridge-builds/${bridgeBuild.bridge_build_id}` +
            `/type-links/accept-outstanding?as=${encodeURIComponent(publishAs)}`,
        )
      }
    }
  } else {
    logStep('[6/7] No Bridge to form (only one lane built).')
  }

  logStep('[7/7] Recording and publishing a version...')
  const recorded = await call('POST', `/use-cases/${encodeURIComponent(useCaseId)}/graph-versions`, {})
  const published = await call(
    'POST',
    `/use-cases/${encodeURIComponent(useCaseId)}/graph-versions/${recorded.version.graph_version_id}` +
      `/publish?as=${encodeURIComponent(publishAs)}`,
  )
  logStep(`      published v${published.version.version_number} as ${publishAs}`)

  const askFlagIndex = process.argv.indexOf('--ask')
  const question =
    askFlagIndex !== -1
      ? process.argv[askFlagIndex + 1]
      : (useCase.hero_questions.find((q) => !q.text.includes('[')) ?? useCase.hero_questions[0]).text

  logStep(`\nAsking: "${question}"`)
  const answer = await askStreaming(useCaseId, question)
  logStep(`      answered: ${answer.answered}${answer.answered ? '' : ` (${answer.reason})`}`)
  if (answer.answer) logStep(`      -> ${answer.answer}`)

  logStep(
    '\nDone. Sources, the Data Catalog, Graph Studio (Build/Bridge/Versions), Ask, Reports, ' +
      'the What-if lens and Audit & Governance are populated for this server run. Restarting ' +
      '"npm run mock" clears all of it again — re-run this script afterwards.',
  )
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`)
  process.exit(1)
})
