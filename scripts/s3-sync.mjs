/**
 * Move the two JSON databases between this checkout and the bucket.
 *
 *     node scripts/s3-sync.mjs push        both documents, local -> S3
 *     node scripts/s3-sync.mjs pull        both documents, S3 -> local
 *     node scripts/s3-sync.mjs push db     just db.json
 *
 * **This exists because the seeds and ingests write files, and only files.** `npm run ingest:graph`,
 * `seed:governance`, `seed:settings` and the rest all rebuild `mock-server/db.json` on disk — that
 * is the right thing for them to do, since they read a demo package that is also on disk and they
 * have to be runnable without credentials. So the flow when the server reads S3 is: re-seed
 * locally, look at the diff, push. A seed that wrote straight to the bucket would be a second
 * writer, which is exactly what `If-Match` exists to refuse.
 *
 * **Push validates before it writes, for the same reason `commitDb` does.** The server refuses to
 * boot on a document missing a required key; pushing one would move that failure to the next
 * restart, on the box, where the only symptom is a crash loop. `validateDb` lives in `server.mjs`
 * and importing it would boot a server, so the check here is the shallow one — the required
 * top-level keys, read off `server.mjs` itself so the two lists cannot drift.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { docRef, localDocPath, readDoc, storeKind, writeDoc } from '../mock-server/store.mjs'
import { DATASETS, PRIMARY } from '../mock-server/datasets.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/* The same credentials the server signs with, from the same gitignored file — see server.mjs. */
try {
  process.loadEnvFile(join(root, 'mock-server/.env.local'))
} catch {
  /* no .env.local — the environment is expected to carry whatever is needed. */
}

const DOCS = {
  db: { name: 'db.json', local: join(root, 'mock-server/db.json') },
  settings: { name: 'settings.json', local: join(root, 'mock-server/settings.json') },
  /*
   * The report prototype's own dataset. It used to be `src/reports/data/dataset.json`, compiled into
   * the bundle — so changing a figure on the Authoring tab meant a rebuild, and it was the one thing on
   * screen that no amount of editing the bucket could change. It is a document like the other two now.
   *
   * Not per dataset, and tenant-level like `settings.json`: it is the *prototype's* sample data, not a
   * dataset's rosters — those are `db.reports`, which every published report is computed from.
   */
  prototype: { name: 'reports_prototype.json', local: join(root, 'mock-server/reports_prototype.json') },
}

function die(message) {
  console.error(`\ns3-sync: ${message}\n`)
  process.exit(1)
}

/*
 * ---------------- which dataset, and which document ----------------
 *
 * A dataset is a prefix, so syncing one is the same two calls under a different key — but the
 * argument has to be *named* rather than positional, because `s3-sync.mjs push db` and
 * `s3-sync.mjs push CAPEX` would otherwise be told apart by nothing. It is matched against the
 * declared datasets, and an unknown one is a refusal naming them: the alternative is a push that
 * quietly writes CAPEX's document over EPA's.
 *
 * **`settings.json` has no dataset.** It holds the users and the persona navigation, which is the
 * tenant's rather than a dataset's — the same reason it is not in `MERGE_PLAN` and the server reads
 * it from the primary alone. Asking for it under a secondary dataset is a mistake worth naming.
 */
const args = process.argv.slice(2)
const direction = args.shift()
const dataset = args.find((a) => DATASETS.some((d) => d.toLowerCase() === a?.toLowerCase()))
const named = args.filter((a) => a !== dataset)
const only = named[0]

/**
 * Why a document has no dataset, in its own terms.
 *
 * Both are tenant-level, for different reasons — one holds who may sign in, the other the prototype's
 * sample figures. One sentence covering both said "it holds the users and each persona's navigation"
 * about the dataset file, which is a refusal describing the wrong document.
 */
const TENANT_WHY = {
  settings: "it holds the users and each persona's navigation",
  prototype: "it is the report prototype's own sample data, not a dataset's rosters",
}

const USAGE = `usage: s3-sync.mjs <push|pull> [db|settings] [${DATASETS.join('|')}]`

if (!['push', 'pull'].includes(direction)) die(USAGE)
if (only && !DOCS[only]) {
  die(
    `unknown argument "${only}" — expected a document (${Object.keys(DOCS).join(', ')}) ` +
      `or a dataset (${DATASETS.join(', ')}).\n  ${USAGE}`,
  )
}
if (named.length > 1) die(`too many arguments: ${named.join(' ')}\n  ${USAGE}`)

const forDataset = DATASETS.find((d) => d.toLowerCase() === dataset?.toLowerCase()) ?? PRIMARY

if (forDataset !== PRIMARY && (only === 'settings' || only === 'prototype')) {
  die(
    `${DOCS[only].name} is the tenant's, not ${forDataset}'s — ${TENANT_WHY[only]}, and there ` +
      `is one copy under ${PRIMARY}.
  Sync it with: npm run db:${direction} -- ${only}`,
  )
}

/* A secondary dataset has no settings document, so syncing "everything" means its db.json alone. */
const documents = only ? [only] : forDataset === PRIMARY ? Object.keys(DOCS) : ['db']
/* The bucket is hardcoded in `store.mjs`, so the only way to have no bucket is to have turned it
   off deliberately — which is a different mistake from not having configured one. */
if (process.env.S3_BUCKET === 'off') {
  die('S3_BUCKET=off selects the local files, so there is no bucket to sync with. Unset it.')
}

/*
 * The required keys, read from `server.mjs` rather than listed again here. A copy would go stale
 * the first time a key was added, and a push that skipped the check would put the boot failure on
 * the deployed box instead of on this terminal.
 */
async function requiredDbKeys() {
  const src = await readFile(join(root, 'mock-server/server.mjs'), 'utf8')
  const block = /const DB_SHAPE = \{([\s\S]*?)\n\}/.exec(src)
  if (!block) die('could not read DB_SHAPE from server.mjs — has it been renamed?')
  return [...block[1].matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1])
}

for (const key of documents) {
  const { name, local } = DOCS[key]
  /* `docRef` suffixes the local path for a non-default prefix, so `db.CAPEX.json` is what a
     CAPEX push reads and a CAPEX pull writes — never the primary's `db.json`. */
  const ref = docRef(name, local, forDataset)
  const localPath = localDocPath(local, forDataset)
  if (storeKind(ref) !== 's3') die(`${name} did not resolve to an S3 ref — got ${ref}`)

  if (direction === 'push') {
    const text = await readFile(localPath, 'utf8')

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      die(`${localPath} is not valid JSON, so it was not pushed — ${error.message}`)
    }
    if (key === 'db') {
      const missing = (await requiredDbKeys()).filter((k) => !(k in parsed))
      if (missing.length > 0) {
        die(
          `${localPath} is missing ${missing.length} required key(s) and would stop the server ` +
            `booting: ${missing.join(', ')}. Re-seed before pushing.`,
        )
      }
    }

    /* No `If-Match`: a push is a deliberate overwrite from a person, not a commit from a running
       process, and the whole point is to replace whatever is there. The server holds the old ETag
       and will refuse its next write — which is correct, and says to restart. */
    await writeDoc(ref, text, null)
    console.log(`pushed ${localPath} -> ${ref} (${Buffer.byteLength(text, 'utf8')} bytes)`)
    console.log('  restart the server so it reads the document it will be writing against.')
  } else {
    const { text } = await readDoc(ref)
    await writeFile(localPath, text, 'utf8')
    console.log(`pulled ${ref} -> ${localPath} (${Buffer.byteLength(text, 'utf8')} bytes)`)
  }
}
