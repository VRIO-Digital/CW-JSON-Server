/*
 * Builds the Elastic Beanstalk source bundle, and refuses to write one that would fail or leak.
 *
 *     npm run bundle:eb        ->  backend-eb.zip at the repo root
 *
 * **This exists because a hand-made zip got all three of these wrong**, and only one of them announced
 * itself:
 *
 *  1. **The app files must be at the archive root.** Zipping the *folder* puts `backend/server.js` inside
 *     the zip; EB looks at the root, finds one directory, and fails with *"failed to generate a
 *     'Procfile'... Provide one of these files: 'package.json', 'server.js', or 'app.js'"*.
 *  2. **`.ebignore` does not apply to a manual zip** — it is read by the `eb` CLI only. So a hand-rolled
 *     bundle happily included `backend/.env.local`, and uploaded the AWS credentials to the environment's
 *     S3 bucket. Silent. This is the one that matters, which is why the file list here is **explicit**:
 *     a secret is excluded by construction rather than by a filter that might miss a new one.
 *  3. **`Compress-Archive` writes backslash separators.** EB then does not recognise `.ebextensions\…`
 *     and ignores the whole directory — so the environment comes up with none of its configuration and
 *     nothing says so. Also silent.
 *
 * **Zero dependencies, like the rest of this package.** Node has `zlib.deflateRawSync` and `zlib.crc32`,
 * so the ~40 lines of ZIP container below are cheaper than admitting an archiver through a gate that
 * fails on any advisory at `low`. It writes one entry per file, deflated, with POSIX separators.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'

const pkgDir = fileURLToPath(new URL('..', import.meta.url))
const outPath = join(pkgDir, '..', 'backend-eb.zip')

/**
 * What ships, named one by one.
 *
 * **Not a directory walk with exclusions.** The credential file lives in this directory, and the
 * difference between "everything except a deny-list" and "exactly these" is whether a *new* secret
 * dropped in here tomorrow ends up in AWS. `scripts/` is absent because the seeds and ingests read a demo
 * package that is not on the instance — they are development tools.
 */
const FILES = [
  'server.js',
  'store.js',
  'datasets.js',
  'reportExport.js',
  'package.json',
  /*
   * **`Procfile` must contain nothing but `web: node server.js`.**
   *
   * EB's parser treats every non-empty line as `name: command` and **does not support comments**. A `#`
   * explanation at the top of it — which is the house style everywhere else in this repo — fails the
   * deploy with `failed to generate rsyslog file with error Procfile could not be parsed`, after
   * `npm install` has already succeeded. So the file is one line and its reasoning lives here:
   *
   * It exists at all, rather than relying on `npm start`, because with a Procfile the platform runs the
   * command directly instead of through npm. That removes a process from the tree, so a SIGTERM on deploy
   * or scale-in reaches node itself rather than being swallowed by the npm wrapper — which is what lets
   * the server's own shutdown handler run.
   */
  'Procfile',
  /* Both documents travel so the box boots even with S3_BUCKET unset — it then serves a copy frozen at
     bundle time, which is why /health reports the store it actually read. */
  'db.json',
  'db.CAPEX.json',
  '.ebextensions/01-app.config',
]

/* Built from a character class so no editor or heredoc can turn the escapes into real newlines —
   which is exactly how this line was broken once. */
const SPLIT_LINES = new RegExp('[\r\n]+')

const problems = []
for (const f of FILES) {
  if (!existsSync(join(pkgDir, f))) problems.push(`${f} is missing`)
}
/* The three EB looks for at the root. Asserted rather than assumed, because the failure names the bundle
   rather than the missing file. */
for (const f of ['server.js', 'package.json', 'Procfile']) {
  if (!FILES.includes(f)) problems.push(`${f} must be in the bundle root`)
}
/* Belt and braces on the thing that must never happen. */
for (const f of FILES) {
  if (/\.env/.test(f)) problems.push(`${f} looks like an environment file and must not ship`)
}
/*
 * The Procfile's own grammar, checked here because EB checks it too late — after `npm install`, with an
 * error naming rsyslog rather than the line it choked on. Every non-empty line must be `name: command`,
 * and a `#` comment is not one: this repo comments everything, and that habit broke a deploy exactly
 * once.
 */
for (const line of readFileSync(join(pkgDir, 'Procfile'), 'utf8').split(SPLIT_LINES)) {
  if (line.trim() === '') continue
  if (line.trimStart().startsWith('#')) problems.push('Procfile has a comment — EB cannot parse one')
  else if (!/^[A-Za-z0-9_-]+:\s+\S/.test(line)) problems.push(`Procfile line is not "name: command": ${line}`)
}
if (problems.length > 0) {
  console.error('\nbundle-eb: refusing to write —')
  for (const p of problems) console.error('  · ' + p)
  console.error('')
  process.exit(1)
}

const chunks = []
const central = []
let offset = 0

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

for (const name of FILES) {
  const data = readFileSync(join(pkgDir, name))
  const deflated = deflateRawSync(data)
  const sum = crc32(data)
  /* POSIX separator, always — see note 3 at the top. */
  const entry = Buffer.from(name.split('\\').join('/'), 'utf8')

  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(sum), u32(deflated.length), u32(data.length),
    u16(entry.length), u16(0), entry,
  ])
  chunks.push(local, deflated)

  central.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(sum), u32(deflated.length), u32(data.length),
    u16(entry.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), entry,
  ]))
  offset += local.length + deflated.length
}

const dir = Buffer.concat(central)
const zip = Buffer.concat([
  ...chunks,
  dir,
  Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(FILES.length), u16(FILES.length),
    u32(dir.length), u32(offset), u16(0),
  ]),
])

writeFileSync(outPath, zip)
console.log(`bundle-eb: wrote backend-eb.zip (${zip.length.toLocaleString()} bytes)`)
for (const f of FILES) console.log('  ' + f)
console.log('\n  root layout: server.js · package.json · Procfile')
console.log('  no environment file, POSIX separators, scripts/ excluded')
