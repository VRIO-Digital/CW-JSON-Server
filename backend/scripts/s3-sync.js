/**
 * Move the two JSON databases between this checkout and the bucket.
 *
 *     node scripts/s3-sync.mjs push        both documents, local -> S3
 *     node scripts/s3-sync.mjs pull        both documents, S3 -> local
 *     node scripts/s3-sync.mjs push db     just db.json
 *
 * **This exists because the seeds and ingests write files, and only files.** `npm run ingest:graph`,
 * `seed:governance`, `seed:settings` and the rest all rebuild `backend/db.json` on disk — that
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

import { localDocPath, readDoc, s3Ref, storeKind, writeDoc } from '../store.mjs'
import { DATASETS, PRIMARY } from '../datasets.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/* The same credentials the server signs with, from the same gitignored file — see server.mjs. */
try {
  process.loadEnvFile(join(root, '.env.local'))
} catch {
  /* no .env.local — the environment is expected to carry whatever is needed. */
}

/**
 * The documents, and there is one.
 *
 * **There were three.** `settings.json` held the users and each persona's navigation;
 * `reports_prototype.json` held the authoring prototype's own sample data. Both were folded into
 * `db.json` as the keys `settings` and `reports_prototype`, so syncing is one object per dataset
 * rather than three under the primary and one under everything else.
 *
 * Kept as a map rather than collapsed to a constant: the shape is what makes a second document a
 * one-line change, and this file's whole job is knowing which objects exist.
 */
const DOCS = {
  db: { name: 'db.json', local: join(root, 'db.json') },
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
 * `s3-sync.mjs push EPA` would otherwise be told apart by nothing. It is matched against the
 * declared datasets, and an unknown one is a refusal naming them: the alternative is a push that
 * quietly writes one dataset's document over another's.
 *
 * **The tenant's own two documents are keys in `db.json` now**, so there is no longer a document
 * that has no dataset — the refusal that used to name one is gone with them. What made them
 * tenant-level has not changed: `MERGE_PLAN` marks `settings` and `reports_prototype` `primary`, so
 * a secondary dataset's document carries the primary's answer to "who exists" rather than a second.
 */
const args = process.argv.slice(2)
const direction = args.shift()
const dataset = args.find((a) => DATASETS.some((d) => d.toLowerCase() === a?.toLowerCase()))
const named = args.filter((a) => a !== dataset)
const only = named[0]

const USAGE = `usage: s3-sync.mjs <push|pull> [${Object.keys(DOCS).join('|')}] [${DATASETS.join('|')}]`

if (!['push', 'pull'].includes(direction)) die(USAGE)
if (only && !DOCS[only]) {
  die(
    `unknown argument "${only}" — expected a document (${Object.keys(DOCS).join(', ')}) ` +
      `or a dataset (${DATASETS.join(', ')}).\n  ${USAGE}`,
  )
}
if (named.length > 1) die(`too many arguments: ${named.join(' ')}\n  ${USAGE}`)

const forDataset = DATASETS.find((d) => d.toLowerCase() === dataset?.toLowerCase()) ?? PRIMARY

const documents = only ? [only] : Object.keys(DOCS)
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
  const src = await readFile(join(root, 'server.mjs'), 'utf8')
  const block = /const DB_SHAPE = \{([\s\S]*?)\n\}/.exec(src)
  if (!block) die('could not read DB_SHAPE from server.mjs — has it been renamed?')
  return [...block[1].matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1])
}

for (const key of documents) {
  const { name, local } = DOCS[key]
  /*
   * **`s3Ref`, not `docRef`** — this tool's whole job is the bucket, so it names one directly.
   * `docRef` answers what a *server* reads, and that now defaults to the local file; routing a push
   * through it would resolve to a path and copy the file onto itself, reporting success while
   * uploading nothing. The guard below stays anyway: a ref that is not `s3://` must stop the run,
   * never be synced.
   *
   * `localDocPath` still suffixes for a non-default prefix, so a secondary dataset's push reads its
   * own `db.<PREFIX>.json` and never the primary's `db.json`.
   */
  const ref = s3Ref(name, forDataset)
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
