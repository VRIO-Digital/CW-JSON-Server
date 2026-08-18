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

import { docRef, readDoc, storeKind, writeDoc } from '../mock-server/store.mjs'

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
}

const [, , direction, only] = process.argv

function die(message) {
  console.error(`\ns3-sync: ${message}\n`)
  process.exit(1)
}

if (!['push', 'pull'].includes(direction)) die('usage: s3-sync.mjs <push|pull> [db|settings]')
if (only && !DOCS[only]) die(`unknown document "${only}" — one of: ${Object.keys(DOCS).join(', ')}`)
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

for (const key of only ? [only] : Object.keys(DOCS)) {
  const { name, local } = DOCS[key]
  const ref = docRef(name, local)
  if (storeKind(ref) !== 's3') die(`${name} did not resolve to an S3 ref — got ${ref}`)

  if (direction === 'push') {
    const text = await readFile(local, 'utf8')

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      die(`${local} is not valid JSON, so it was not pushed — ${error.message}`)
    }
    if (key === 'db') {
      const missing = (await requiredDbKeys()).filter((k) => !(k in parsed))
      if (missing.length > 0) {
        die(
          `${local} is missing ${missing.length} required key(s) and would stop the server ` +
            `booting: ${missing.join(', ')}. Re-seed before pushing.`,
        )
      }
    }

    /* No `If-Match`: a push is a deliberate overwrite from a person, not a commit from a running
       process, and the whole point is to replace whatever is there. The server holds the old ETag
       and will refuse its next write — which is correct, and says to restart. */
    await writeDoc(ref, text, null)
    console.log(`pushed ${local} -> ${ref} (${Buffer.byteLength(text, 'utf8')} bytes)`)
    console.log('  restart the server so it reads the document it will be writing against.')
  } else {
    const { text } = await readDoc(ref)
    await writeFile(local, text, 'utf8')
    console.log(`pulled ${ref} -> ${local} (${Buffer.byteLength(text, 'utf8')} bytes)`)
  }
}
