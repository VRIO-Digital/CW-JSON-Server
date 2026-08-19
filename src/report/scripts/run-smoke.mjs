/* Bundles the smoke test with esbuild (already present as a Vite dependency) and
   runs it in node. Bundling rather than a loader hook keeps this to one moving
   part: JSX and the db.json import are handled by the same tool the dev server
   uses. */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'cw-smoke-'))
const out = join(dir, 'smoke.cjs')

await build({
  entryPoints: ['scripts/smoke.jsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: out,
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  logLevel: 'error',
})

const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
rmSync(dir, { recursive: true, force: true })
process.exit(r.status ?? 1)
