#!/usr/bin/env node
/**
 * Vulnerability gate.
 *
 * Runs `npm audit --json` and fails the command if any advisory at or above
 * THRESHOLD is present. Unlike bare `npm audit`, a registry/network failure is
 * reported as a warning instead of a hard failure, so offline installs and CI
 * runners without registry access don't break for the wrong reason.
 *
 *   node scripts/audit-gate.mjs [low|moderate|high|critical]
 *
 * Threshold defaults to `low` (i.e. fail on anything).
 *
 * ALLOWLIST below waives individual advisories by GHSA id. It is deliberately
 * per-advisory rather than a raised threshold: waiving one known-inapplicable
 * finding must not also admit the next unrelated one at the same severity.
 * Every entry needs a reason, and the gate nags when an entry goes stale.
 */
import { spawnSync } from 'node:child_process'

/**
 * @type {{id: string, package: string, reason: string}[]}
 */
const ALLOWLIST = [
  // Empty on purpose. The react-router RSC-mode CSRF waiver
  // (GHSA-qwww-vcr4-c8h2) was removed on 2026-08-11 once the gate reported it
  // matched no advisory — upstream had patched, and a waiver that no longer
  // waives anything is a standing licence for the next unrelated finding at the
  // same severity. Add an entry only with a reason and a removal condition.
]

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical']
const threshold = (process.argv[2] ?? process.env.AUDIT_LEVEL ?? 'low').toLowerCase()

if (!LEVELS.includes(threshold)) {
  console.error(`audit-gate: unknown threshold "${threshold}" (expected ${LEVELS.join(', ')})`)
  process.exit(2)
}

const result = spawnSync('npm', ['audit', '--json', '--audit-level=none'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
})

let report
try {
  report = JSON.parse(result.stdout)
} catch {
  console.warn('audit-gate: could not parse `npm audit` output — skipping (registry unreachable?)')
  process.exit(0)
}

// npm reports registry problems as an `error` object rather than a vuln report.
if (report.error) {
  const why =
    report.error.summary || report.error.detail || report.error.code || 'registry unreachable'
  console.warn(`audit-gate: audit unavailable (${why}) — skipping`)
  process.exit(0)
}

const gated = LEVELS.slice(LEVELS.indexOf(threshold))
const waived = new Map(ALLOWLIST.map((entry) => [entry.id.toUpperCase(), entry]))
const seenWaived = new Set()

/** Pull the GHSA id out of an advisory's URL. */
const advisoryId = (advisory) =>
  (/GHSA-[\w-]+/i.exec(advisory.url ?? '')?.[0] ?? '').toUpperCase()

/**
 * Group blocking advisories by package. A package whose `via` holds only
 * strings is vulnerable *through* another package — the advisory is reported
 * against that parent, so it is not double-counted here.
 */
const offenders = []

for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  const blocking = (vuln.via ?? [])
    .filter((via) => typeof via === 'object')
    .filter((advisory) => gated.includes(advisory.severity))
    .filter((advisory) => {
      const id = advisoryId(advisory)
      if (waived.has(id)) {
        seenWaived.add(id)
        return false
      }
      return true
    })

  if (blocking.length > 0) offenders.push({ name, vuln, blocking })
}

// Report active waivers so they stay visible rather than becoming invisible policy.
for (const id of seenWaived) {
  const entry = waived.get(id)
  console.warn(`audit-gate: WAIVED ${id} (${entry.package}) — ${entry.reason}`)
}

// A waiver that no longer matches anything is dead weight — nag to remove it.
for (const [id, entry] of waived) {
  if (!seenWaived.has(id)) {
    console.warn(
      `audit-gate: allowlist entry ${id} (${entry.package}) no longer matches any ` +
        'advisory — delete it from scripts/audit-gate.mjs.',
    )
  }
}

const failing = offenders.reduce((sum, o) => sum + o.blocking.length, 0)

if (failing === 0) {
  const suffix = seenWaived.size > 0 ? ` (${seenWaived.size} waived)` : ''
  console.log(`audit-gate: OK — 0 vulnerabilities at or above "${threshold}"${suffix}.`)
  process.exit(0)
}

console.error(`\naudit-gate: FAILED — ${failing} vulnerability(ies) at or above "${threshold}".\n`)

for (const { name, vuln, blocking } of offenders) {
  for (const advisory of blocking) {
    console.error(`  [${advisory.severity}] ${name} ${advisory.range ?? vuln.range}`)
    console.error(`      ${advisory.title ?? 'vulnerable dependency'}`)
    if (advisory.url) console.error(`      ${advisory.url}`)
  }
  if (vuln.fixAvailable) {
    const fix = vuln.fixAvailable
    console.error(
      typeof fix === 'object'
        ? `      fix: upgrade to ${fix.name}@${fix.version}${fix.isSemVerMajor ? ' (breaking)' : ''}`
        : '      fix: available via `npm audit fix`',
    )
  } else {
    console.error('      fix: none published — pick a different package or add an `overrides` pin')
  }
}

console.error('\nResolve with `npm run audit:fix`, an `overrides` entry, or a different package.\n')
process.exit(1)
