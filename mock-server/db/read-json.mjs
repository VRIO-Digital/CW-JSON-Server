/*
 * ============================================================================
 *  Reading a JSON file so that a broken one says what is wrong with it
 * ============================================================================
 *
 * Shared, because the two files it serves are no longer read in the same place.
 * `settings.json` is still read by the server at boot; `db.json` is now a **seed** and is
 * read by `npm run db:seed` on its way into PostgreSQL. The diagnosis has to follow the
 * file — a conflicted `db.json` is exactly as fatal to a seed as it was to a boot, and a
 * second copy of this logic in the seed script would be the drift this repo keeps
 * finding.
 */

import { readFileSync } from 'node:fs'

/**
 * Read one of the two JSON databases, and **fail with something a person can act on**.
 *
 * `JSON.parse` on a broken file says `Expected double-quoted property name in JSON at position
 * 2464`, and nothing else — not the file, not the line, not the fix. That is the failure this
 * whole repo guards against everywhere *after* boot: `validateDb` refuses a bad document naming
 * the missing key and the command that restores it, but it never runs, because the parse dies
 * first.
 *
 * **The common cause is a merge conflict, and it is checked for by name.** `db.json` is a
 * generated file that is also committed, so a `git pull` or `git stash pop` on a box where it has
 * been re-seeded leaves conflict markers in it — and a crash-looping server then reports a byte
 * offset while the actual problem is `<<<<<<< Updated upstream` sitting in the middle of the file.
 * Naming the marker and its line turns a puzzle into a one-line fix.
 */
export function readJsonDb(path, label, restore) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    console.error(`\nmock-server: refusing to start — cannot read ${label}.`)
    console.error(`  · ${error.message}`)
    console.error(`\n  Restore it:\n      ${restore}\n`)
    process.exit(1)
  }

  /* Checked before parsing, because a conflicted file is not "bad JSON" — it is two good files
     stacked, and saying so is the difference between a fix and a hunt. */
  const lines = text.split(/\r?\n/)
  const marker = lines.findIndex((l) => /^(<<<<<<<|=======|>>>>>>>)/.test(l))
  if (marker !== -1) {
    console.error(`\nmock-server: refusing to start — ${label} still has merge conflict markers.`)
    console.error(`  · line ${marker + 1}: ${lines[marker].slice(0, 60)}`)
    console.error(
      '\n  This file is generated *and* committed, so a pull or a stash pop over a re-seeded\n' +
        '  copy conflicts every time. Take one side and rebuild it rather than hand-merging:\n' +
        `      git checkout --theirs ${label}   (or --ours)\n` +
        `      ${restore}\n`,
    )
    process.exit(1)
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    /* Turn the byte offset into a line and column — the only two numbers an editor can use. */
    const at = Number(/position (\d+)/.exec(error.message)?.[1] ?? -1)
    const upto = at >= 0 ? text.slice(0, at).split(/\r?\n/) : null
    console.error(`\nmock-server: refusing to start — ${label} is not valid JSON.`)
    console.error(
      upto
        ? `  · line ${upto.length}, column ${upto[upto.length - 1].length + 1}: ${error.message}`
        : `  · ${error.message}`,
    )
    console.error(`\n  Restore it:\n      ${restore}\n`)
    process.exit(1)
  }
}
