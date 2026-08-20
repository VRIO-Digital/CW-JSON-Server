#!/usr/bin/env node
/**
 * Doc-drift gate.
 *
 * CLAUDE.md and SKILLS.md state facts about the code — how many connectors
 * exist, what the pipeline stages are called, which db.json keys are required.
 * Those go stale silently as features land, and a confidently wrong doc is worse
 * than no doc, because the next session trusts it.
 *
 * This asserts the claims against the source. When it fails, the code and the
 * docs disagree: fix whichever is wrong. Do not delete the assertion to pass.
 *
 *   node scripts/check-docs.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

/**
 * The two JSON databases live in S3 now, so neither is necessarily on disk.
 *
 * **A missing one must not crash the run.** This file is one long script and the summary prints at
 * the end, so an exception at line 239 takes every claim with it and prints nothing — the
 * "claim total stops moving" failure this repo has already been bitten by twice, where correct
 * guards look broken and every break test reports MISSED. So an absent document falls back to `{}`
 * and one loud claim names the command that fetches it. The claims that read it then fail
 * individually, which is noisy and honest, rather than silently passing over an empty object.
 *
 * The fallback's *keys* matter: a partial fallback moves the crash rather than removing it, which
 * is exactly how the demo-package guard failed. Everything dereferenced below is defaulted at its
 * site with `?? {}` / `?? []`, so `{}` is sufficient here.
 */
const readJson = (p) => {
  try {
    return { value: JSON.parse(read(p)), here: true }
  } catch {
    return { value: {}, here: false }
  }
}

/*
 * **Comments stripped before asserting an absence.**
 *
 * Claims below say a file does *not* say something — "Approval", "gone for good", a
 * hard-coded email domain — and several passed over the file's own prose the first time,
 * because the comment explaining a removal names the thing removed. This repo's rule is
 * to assert the fact at its site; for an absence, the site is the code, so the prose
 * comes out first.
 *
 * Defined here, beside `read`, rather than beside its first user: it is a `const`, so a
 * claim earlier in the file that reached for it would die in the temporal dead zone —
 * and a check-docs that crashes is a check-docs whose claim total silently stops moving.
 */
/*
 * **The `{` and the `/*` must be adjacent**, and that is not cosmetic.
 *
 * This rule was `\{\s*\/\*`, which let the `{` of any *block* match a doc comment on the next
 * line: `interface Props {` followed by `/** … *\/` matched, and the non-greedy tail then ran to
 * the first `*\/}` anywhere below — swallowing 139 lines of real code out of one component. The
 * damage is silent and exactly the shape this helper exists to prevent: an absence claim over a
 * file whose middle has been deleted passes over nothing, and four claims written against that
 * region reported themselves stale only because they were *positive* ones. A JSX comment is
 * written `{/* … *\/}` with nothing between the brace and the star, so requiring adjacency loses
 * none of them; the block-comment rule below then empties the comment and leaves a bare `{}`,
 * which no claim searches for.
 */
const codeOnly = (src) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\s*\}/g, '') // JSX comment blocks
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/^\s*\/\/.*$/gm, '') // line comments

const problems = []
const checked = []

const ok = (label, detail) => checked.push(`${label} — ${detail}`)
const bad = (label, detail) => problems.push(`${label}: ${detail}`)

/** Asserts a condition, recording either way. */
function expect(label, condition, detail) {
  if (condition) ok(label, detail)
  else bad(label, detail)
}

/* ---------------- the documents must exist ---------------- */

for (const file of ['CLAUDE.md', 'SKILLS.md', 'docs/REGRESSIONS.md']) {
  if (!existsSync(join(root, file))) {
    bad(file, 'is missing — the work loop depends on it')
  }
}
if (problems.length > 0) {
  console.error('check-docs: FAILED\n')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

const claude = read('CLAUDE.md')
const skills = read('SKILLS.md')
const server = read('mock-server/server.mjs')
/* Where the two JSON documents are read from and written to — the filesystem, or S3. Declared here
   beside `server` because several claims below read both, and a `const` reached from above its
   declaration dies in the temporal dead zone, which kills the run before it prints a summary. */
const store = read('mock-server/store.mjs')
/*
 * Which dataset is the primary, read off `datasets.mjs` rather than written here.
 *
 * Two claims further down used to pin the literal `'EPA'` — in `DATASETS`, in `PRIMARY` and in
 * `store.mjs`'s `DEFAULT_PREFIX`. That made a tenant swap look like three broken claims instead of
 * one fact changing, and it guarded the wrong thing: what matters is that the three **agree**, since
 * a `DEFAULT_PREFIX` that disagrees with `PRIMARY` makes the boot read `db.<PREFIX>.json` while every
 * seed keeps writing `db.json`, and a re-seed then appears to do nothing at all.
 */
const primaryDataset =
  /export const PRIMARY = '([A-Z]+)'/.exec(read('mock-server/datasets.mjs'))?.[1] ?? ''
const connectors = read('src/data/connectors.ts')
const indexCss = read('src/index.css')
const theme = read('src/theme.ts')
const nav = read('src/nav.ts')
const jobsTab = read('src/components/ProfilingJobsTab.tsx')
const client = read('src/api/client.ts')
const wizard = read('src/components/ConnectSourceWizard.tsx')

/* ---------------- connectors ---------------- */

/*
 * Asserted by name rather than by a count in prose: a count can be written as a
 * word, and a stale hardcoded fallback would make the check pass forever. Adding
 * a connector fails this until SKILLS.md mentions it, which is the point.
 */
// `\r?\n` on both sides: git checks these files out with CRLF on Windows, and a
// split that assumed LF found zero connectors and reported "0 of 0 available"
// — a stale-doc failure that was really a stale regex.
const connectorBlocks = connectors.split(/\r?\n {2}\{\r?\n/).slice(1)
const connectorList = connectorBlocks
  .map((block) => ({
    name: (block.match(/name: '([^']+)'/) ?? [])[1],
    available: /available: true/.test(block),
    hasReason: /reason:/.test(block),
  }))
  .filter((c) => c.name)

/**
 * Prose says "BigQuery", not "Google BigQuery" — so match the distinctive part
 * of the name, not the whole vendor string. Still fails for a connector nobody
 * mentioned, which is what this is for.
 */
const distinctive = (name) =>
  name.replace(/^Google /, '').replace(/ bucket$/, '').trim()

for (const c of connectorList) {
  const token = distinctive(c.name)
  expect(
    `connector "${c.name}" documented`,
    skills.includes(c.name) ||
      claude.includes(c.name) ||
      skills.includes(token) ||
      claude.includes(token),
    `${c.available ? 'available' : 'vision'} — "${token}" must appear in SKILLS.md flow 1`,
  )
  if (!c.available) {
    expect(
      `connector "${c.name}" explains itself`,
      c.hasReason,
      'an unavailable connector needs a `reason`, or the card does nothing when clicked',
    )
  }
}

expect(
  'at least one connector is usable',
  connectorList.some((c) => c.available),
  `${connectorList.filter((c) => c.available).length} of ${connectorList.length} available`,
)

/*
 * Every connector needs its own mark.
 *
 * `ConnectorIcon` used to fall back to `BigQueryIcon`, so the five connectors
 * without one were each drawn as BigQuery — a card claiming to be a product it is
 * not, and invisible while nothing rendered those five. The fallback is neutral
 * now, but a missing mark would still be a grey cylinder where a logo belongs, so
 * adding a connector fails this until it has one.
 */
const iconSource = read('src/components/ConnectorIcon.tsx')
/* Found in two steps, not one pattern: the declaration's type annotation is
   `Record<string, (props: { size?: number }) => JSX.Element>`, which carries both
   an `=` and a `{`, so `[^=]*= \{` stopped inside it and reported zero marks —
   the same false-empty a bare `\n` split once caused for connectors. */
const marksStart = iconSource.indexOf('const MARKS')
const marksBody =
  marksStart < 0
    ? ''
    : iconSource.slice(iconSource.indexOf('= {', marksStart) + 3).split('\n}')[0]
const markedKeys = [...marksBody.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
const connectorKeys = [...connectors.matchAll(/^ {4}key: '(\w+)',/gm)].map((m) => m[1])
expect(
  'every connector key has a mark',
  connectorKeys.length > 0 &&
    connectorKeys.every((k) => markedKeys.includes(k)),
  `keys ${connectorKeys.join(',')} · marks ${markedKeys.join(',')}`,
)
expect(
  'an unknown connector falls back to the neutral mark, not a vendor one',
  /GenericSourceIcon size=\{size\} label=\{connector\}/.test(iconSource) &&
    !/return <BigQueryIcon size=\{size\} \/>\s*\n\}/.test(iconSource),
  'a wrong vendor logo is a claim, not a default',
)

/* ---------------- profiling pipeline ---------------- */

const pipelineBlock = server.match(/const PIPELINE = \[([\s\S]*?)\]/)
const stages = pipelineBlock
  ? [...pipelineBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : []

expect('pipeline stage count', stages.length === 5, `${stages.length} stages in server.mjs`)

for (const stage of stages) {
  expect(
    `stage "${stage}" documented`,
    skills.includes(stage) || claude.includes(stage),
    'must appear in SKILLS.md flow 3',
  )
}

expect(
  'pipeline stage total in docs',
  skills.includes(`${stages.length} stages`) || skills.includes(`5/5`),
  `SKILLS.md should reflect ${stages.length}`,
)

/* ---------------- db.json required keys ---------------- */

const shapeBlock = server.match(/const DB_SHAPE = \{([\s\S]*?)\n\}/)
const requiredKeys = shapeBlock
  ? [...shapeBlock[1].matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])
  : []

expect('db required-key count', requiredKeys.length > 0, `${requiredKeys.length} keys guarded`)

/*
 * Every document that states the number must state the right one.
 *
 * This used to be one `||` across both files, so a true claim in CLAUDE.md
 * covered for a stale "19 required keys" in SKILLS.md — the check passed while a
 * doc was wrong, which is the exact failure it exists to catch. Now each file is
 * asserted where it makes the claim, and a file that does not make it is not
 * required to.
 */
for (const [file, text] of [
  ['CLAUDE.md', claude],
  ['SKILLS.md', skills],
]) {
  const stated = [...text.matchAll(/(\d+) required keys?/g)].map((m) => Number(m[1]))
  if (stated.length === 0) continue
  expect(
    `${file} states the right required-key count`,
    stated.every((n) => n === requiredKeys.length),
    `code guards ${requiredKeys.length}, ${file} says ${stated.join(', ')}`,
  )
}
expect(
  'the required-key count is documented somewhere',
  /\d+ required keys?/.test(claude) || /\d+ required keys?/.test(skills),
  `code guards ${requiredKeys.length}: ${requiredKeys.join(', ')}`,
)

const dbDoc = readJson('mock-server/db.json')
/*
 * ---------------- the documents have to be here to be checked ----------------
 *
 * Both live in S3 now and the local copies were deleted, so neither is necessarily on disk. This
 * stops the run rather than falling back, and the distinction is the point: roughly forty claims
 * below walk `db.projects`, `db.graph_studio.canvas`, `db.whatif.generators` and so on, and an
 * empty-object fallback does not survive the first `.every()` — it moves the crash a few hundred
 * lines down, which is precisely how the demo-package fallback failed. A crash mid-file prints no
 * summary, so every claim reads as MISSED and correct guards look broken.
 *
 * Refusing early, by name, with the command that fixes it, is what the mock server itself does when
 * a document will not load. A checker that cannot reach what it checks must say so, not answer.
 */
if (!dbDoc.here) {
  console.error('\ncheck-docs: cannot run — mock-server/db.json is not in this checkout.')
  console.error('\n  The two JSON databases live in S3 (s3://contextweave.com/EPA/). Fetch them:')
  console.error('      npm run db:pull\n')
  console.error('  They are gitignored, so pulling them cannot commit tenant data by accident.\n')
  process.exit(1)
}
const db = dbDoc.value
const dbKeys = Object.keys(db)
for (const key of requiredKeys) {
  expect(`db.json has "${key}"`, dbKeys.includes(key), 'DB_SHAPE requires it')
}

/* ---------------- a required name is a shown name ---------------- */

/*
 * The rule below makes a source name mandatory. That is only worth anything if
 * the name is then visible where a source is identified — the Catalog card and
 * its detail header, which otherwise show `bigquery:<project>` and nothing a user
 * chose. Matched on the field being read, not on a class name, so a restyle does
 * not fail this and a deletion does.
 */
const catalogPage = read('src/pages/CatalogPage.tsx')
/* A local binding, not the component: three claims below read it as `catalogPage`, and a
   whole-file rename of the component caught this declaration and left them behind. */
expect(
  'the Catalog names each source, not just its id',
  (catalogPage.match(/\{s\.sourceName\}|\{selected\.sourceName\}/g) ?? []).length >= 2,
  'the card and the detail header both render sourceName',
)

/* ---------------- the source-name rule is one rule ---------------- */

/*
 * The floor is written twice — once in `server.mjs`, which refuses the write, and
 * once in `src/data/sourceName.ts`, which refuses before the round trip. Drift
 * between them is invisible in the worst direction: a client that allows 4 turns
 * a typed name into a 400 the user cannot act on, and a client stricter than the
 * server just blocks work for no stated reason.
 */
const serverMin = Number(server.match(/const SOURCE_NAME_MIN = (\d+)/)?.[1] ?? NaN)
const sourceNameData = read('src/data/sourceName.ts')
const clientMin = Number(sourceNameData.match(/SOURCE_NAME_MIN = (\d+)/)?.[1] ?? NaN)
expect(
  'the source-name floor agrees on both sides',
  Number.isFinite(serverMin) && serverMin === clientMin,
  `server ${serverMin} · client ${clientMin}`,
)

/*
 * And it must actually be enforced where a source gets registered. All three
 * endpoints, because the stubbed connectors land in the same Sources table — and
 * no id fallback, which is what made the field optional in practice even while
 * the form asked for it.
 */
for (const route of ['/sources', '/sources/drive', '/sources/generic']) {
  const block = (server.split(`p === '${route}'`)[1] ?? '').slice(0, 2600)
  expect(
    `POST ${route} refuses a bad source_name`,
    /sourceNameProblem\(source_name\)/.test(block),
    'every register endpoint runs the shared validator',
  )
}
expect(
  'no register endpoint falls back to an id for the name',
  !/source_name \|\| (project|drive)\./.test(server) &&
    !/sourceName: sourceName \|\|/.test(wizard),
  'a row named after its project id reads as a name and is not one',
)

/* ---------------- the consent screen lists every scope ---------------- */

/*
 * The sign-in dialog renders the scopes `/sources/oauth/start` returned, and
 * looks their wording up by URL. An unmapped scope still renders — as its bare
 * URL, which is honest but unexplained — so the failure is silent by design.
 * This catches it: every scope the server can issue must have copy.
 *
 * Drive is why this exists. It asks for two scopes, and the first version of the
 * dialog described one.
 */
const serverScopes = [
  ...new Set(
    [...server.matchAll(/'(https:\/\/www\.googleapis\.com\/auth\/[\w.]+)'/g)].map(
      (m) => m[1],
    ),
  ),
]
const consentData = read('src/data/consentStages.ts')
expect(
  'the server issues scopes the dialog can describe',
  serverScopes.length > 0,
  `${serverScopes.length} scope(s) found in server.mjs`,
)
for (const scope of serverScopes) {
  expect(
    `scope ${scope.replace('https://www.googleapis.com/auth/', '')} has consent copy`,
    consentData.includes(`'${scope}'`),
    'add it to CONSENT_GRANT_COPY or the consent screen shows a bare URL',
  )
}

/*
 * And the panel must list what the response reported, not a per-provider
 * constant. `CONSENT_SCOPES` stays as the fallback for the moment before that
 * first call returns; what must not come back is a footer that renders only it.
 */
expect(
  'the consent panel lists the reported scopes',
  /scopes\?: string\[\]/.test(read('src/components/GoogleConsentPanel.tsx')) &&
    /scopes=\{oauthScopes\}/.test(wizard),
  'the wizard holds start.scopes and the panel renders them',
)

/*
 * The sign-in window is the click-through the consent happens in, and the same rule binds it: it
 * renders the scopes the *response* carried. A window with its own list can describe fewer
 * permissions than are being asked for, which is the one failure a consent screen exists to
 * prevent — and it is silent, because a window listing one scope looks exactly like a connector
 * that asks for one.
 *
 * `codeOnly`, and keyed on the rendered form rather than the bare identifier: this file's own
 * comments name the constant it must not read from.
 */
const signInWindow = read('src/components/GoogleSignInWindow.tsx')
const signInCode = codeOnly(signInWindow)
expect(
  'the sign-in window renders the scopes the endpoint returned',
  /scopes: string\[\]/.test(signInCode) && /scopes\.map\(\(scope\)/.test(signInCode),
  'one row per scope in the payload, not per scope this file knows about',
)
expect(
  'and keeps no list of its own to render instead',
  !/CONSENT_SCOPES/.test(signInCode) &&
    !/googleapis\.com\/auth\/[\w.]+'/.test(signInCode),
  'CONSENT_GRANT_COPY supplies wording only; an unmapped scope still renders',
)
/*
 * Two halves of "nothing is granted until Allow is pressed". The first call runs on the button —
 * the window has to have the scopes to render — and the callback runs on Allow. A window opened
 * before `/oauth/start` returned could only open blank or guess, and a callback fired on open
 * would make the Allow button decoration.
 */
const openFn = (wizard.split('async function openGoogleSignIn()')[1] ?? '').slice(0, 900)
const grantFn = (wizard.split('async function grantGoogleConsent()')[1] ?? '').slice(0, 1600)
expect(
  'the sign-in window opens on the response, not on the click',
  /await oauthStart\(/.test(openFn) &&
    /setSignInPhase\('account'\)/.test(openFn) &&
    !/[oO]authCallback\(/.test(openFn),
  'it renders start.scopes, so it cannot open before that call returns',
)
expect(
  'and Allow is what spends the consent',
  /driveOauthCallback\(oauthState, signedInAs\)/.test(grantFn) &&
    /oauthCallback\(oauthState, signedInAs\)/.test(grantFn) &&
    /onAllow=\{\(\) => void grantGoogleConsent\(\)\}/.test(wizard),
  'cancelling grants nothing and connects nobody',
)

/* ---------------- step 3's two acts are paced, and paced on the server ---------------- */

/*
 * `1. Run preview` and `2. Finish` are the two calls in this wizard that would really
 * talk to Google, and both returned before their spinner drew a frame. They are held
 * on `CONNECT_STEP_MS`, and the hold is on the **server** for the reason every other
 * paced act here is: a stage advances when its request returns, never on a timer the
 * client keeps. Two halves, and each fails silently on its own — a component timer
 * beside an instant response paces nothing real, and an unpaced endpoint leaves the
 * button flashing.
 */
const step3Handlers = [
  ['/sources/preview', 'BigQuery preview'],
  ['/sources/drive/preview', 'Drive preview'],
  ['/sources', 'BigQuery register'],
  ['/sources/drive', 'Drive register'],
]
/* Cut at the next route rather than at a character count: the BigQuery preview handler is
   short enough that a 4000-char slice reached into the Drive one, and a break test that
   deleted its own hold still found the neighbour's — the claim could not fail. */
const handlerBody = (path) =>
  (server.split(`match: (p) => p === '${path}',`)[1] ?? '').split('match: (p) =>')[0]
for (const [path, what] of step3Handlers) {
  const body = handlerBody(path)
  expect(
    `${what} is held on CONNECT_STEP_MS`,
    body.length > 0 && /CONNECT_STEP_MS/.test(body),
    `POST ${path} answers instantly, so its button cannot be seen working`,
  )
  /* And only the success reply. A refusal is a 400 the reader has to read and act on —
     pacing it would make a mistyped handle take five seconds to report itself. */
  expect(
    `and ${what} refusals are not`,
    body.length > 0 &&
      !/setTimeout\([\s\S]{0,200}?send\(res, 4\d\d/.test(body) &&
      /return send\(res, 4\d\d/.test(body),
    'errors are never paced',
  )
}
for (const fn of ['runPreview', 'finishBigQuery', 'runDrivePreview', 'finishDrive']) {
  /* Cut at the next declaration, for the reason handlerBody does: these four sit next to
     each other, so a fixed-length slice finds a neighbour's timer instead of its own. */
  const body = (codeOnly(wizard).split(`async function ${fn}()`)[1] ?? '').split(
    /\n  (?:async )?function /,
  )[0]
  expect(
    `${fn} keeps no timer of its own`,
    body.length > 0 && !/setTimeout/.test(body),
    'the button advances when its request returns, not on a client timer',
  )
}

/* ---------------- and the run in flight is named, not just spun ---------------- */

/*
 * Five seconds behind a button spinner reads as a wedged dialog, so each of step 3's acts
 * opens its own small modal naming that call — `ConnectRunPanel`. One dialog per act, and
 * the reason is the failure the first version had: a panel listing both acts said
 * "registering the source" while nothing was being registered.
 */
const runPanel = read('src/components/ConnectRunPanel.tsx')
const runPanelCode = codeOnly(runPanel)
const connectSteps = read('src/data/connectSteps.ts')

/* Two dialogs, each gated on its own act. `busy` is the flag the buttons' own spinners read,
   so neither can be on screen for a call that has already returned — separate state could. */
const runModals = [
  ...wizard.matchAll(/busy === '(preview|finish)' \? \(\r?\n\s*<Modal/g),
].map((m) => m[1])
expect(
  'each act opens its own dialog, from busy',
  runModals.includes('preview') &&
    runModals.includes('finish') &&
    runModals.length === 2 &&
    /act="preview"/.test(wizard) &&
    /act="finish"/.test(wizard),
  `${runModals.length} run dialog(s) found — one flag, one dialog per act`,
)
/* Google only: the generic connectors' step 3 is a stubbed test and one unpaced call, so a
   progress dialog over it would narrate work that is not happening. */
expect(
  'and only over the two connectors that make those calls',
  (wizard.match(/\{step === 2 && isGoogle && busy === '(?:preview|finish)' \?/g) ?? [])
    .length === 2,
  'the generic branch has no paced request behind a dialog',
)
/* The body is its own component because antd portals out of `renderToString`: written
   inline, every assertion about this copy would pass over nothing. */
expect(
  'the panel is a component, not a body inlined in the modal',
  (wizard.match(/<ConnectRunPanel\s+kind=/g) ?? []).length === 2 &&
    /export default function ConnectRunPanel/.test(runPanel),
  'a panel written inside the Modal cannot be asserted on',
)
/* And the words are the module's, per act and in the connector's own unit. Copy held in the
   component is the consent screen's mistake one level down: it can describe an act the
   wizard does not make. */
expect(
  'the copy comes from connectSteps.ts, per act',
  /CONNECT_ACT_COPY\[kind\]\[act\]\.replace\('\{subject\}', subject\)/.test(runPanelCode) &&
    !/Discovering|Registering/.test(runPanelCode),
  'the panel renders the message, it does not author it',
)
/*
 * And the message names what the call is made against — the project or the drive. Two halves:
 * every template has the slot, and the wizard fills it from the id the request itself carries.
 * A slot nobody fills renders the literal `{subject}` on screen, and an id from somewhere else
 * would name a project the call is not reading.
 */
const actTemplates = [...connectSteps.matchAll(/(?:preview|finish): '([^']+)'/g)].map(
  (m) => m[1],
)
expect(
  'every message names its subject',
  actTemplates.length === 4 && actTemplates.every((t) => t.includes('{subject}')),
  `${actTemplates.filter((t) => t.includes('{subject}')).length} of ${actTemplates.length} carry the slot`,
)
expect(
  'and the wizard fills it with the id the request is made with',
  (wizard.match(/subject=\{isDrive \? driveId : projectId\}/g) ?? []).length === 2,
  'one per dialog — a subject from elsewhere would name the wrong project',
)
for (const [kind, unit, notThis] of [
  ['bigquery', 'dataset', 'folder'],
  ['gdrive', 'folder', 'dataset'],
]) {
  const block = (connectSteps.match(new RegExp(`${kind}: \\{([\\s\\S]*?)\\n  \\},`)) ??
    [])[1] ?? ''
  const preview = (block.split('finish:')[0] ?? '').toLowerCase()
  const finish = (block.split('finish:')[1] ?? '').toLowerCase()
  expect(
    `${kind} says what each act is doing, in its own unit`,
    /preview:/.test(block) &&
      /finish:/.test(block) &&
      /* Per act, both halves. The unit has to be right on *every* line of the pair: a claim
         that only checked the unit appeared passed a break test that renamed the second
         one's, because the first still carried the word. A Drive source has no datasets. */
      preview.includes(unit) &&
      !preview.includes(notThis) &&
      finish.includes(unit) &&
      !finish.includes(notThis) &&
      /* And neither act describes the other's work — the failure this replaced. */
      !preview.includes('registering') &&
      !finish.includes('discovering'),
    `one message per request — ${kind} counts ${unit}s and nothing else`,
  )
}
/* The sign-in window's rows are `StageList`'s, and the styling that came with them moved out
   of the consent sheet. Two sheets styling one row is how a state ends up looking like two.
   (The run dialogs draw a single act, so they are not stage rows and do not use it.) */
expect(
  'the consent panel draws its rows through StageList',
  /<StageList stages=\{stages\} stage=\{stage\} \/>/.test(
    read('src/components/GoogleConsentPanel.tsx'),
  ) && /\.cs-stage\.is-active/.test(read('src/components/StageList.css')),
  'one interaction, one component',
)
expect(
  'and no second sheet styles those rows',
  !/\.cs-consent-stage/.test(read('src/components/GoogleConsentPanel.css')),
  'the classes live with the component that renders them',
)

/* ---------------- more than one project, and both kinds of Drive ---------------- */

/*
 * The wizard's pickers only mean something against data that has something to pick between. A
 * single project renders a Select with one option — indistinguishable from a picker that failed
 * to load its others — and a My Drive / Shared drives control with nothing on one side reads as a
 * broken toggle rather than as an account with no shared drives.
 */
expect(
  'the account can read more than one GCP project',
  (db.projects ?? []).length >= 3,
  `${(db.projects ?? []).length} project(s) — npm run seed:workspaces authors the extra ones`,
)
const driveKinds = new Set((db.drives ?? []).map((d) => d.kind))
/*
 * **Both kinds are always offered, and a kind the account has none of says so.**
 *
 * This required the *data* to hold a My Drive and a shared drive, which was a claim about the EPA
 * workspace seed rather than about the wizard — Northline connects one shared drive, and having none
 * of a kind is an ordinary fact about an account. The behaviour that has to hold either way is the
 * one CLAUDE.md states: the control offers both, and an empty side is offered with the sentence that
 * explains it rather than hidden, because a toggle that silently drops an option reads as broken.
 */
expect(
  'both kinds of Drive are always offered, and an empty one says so',
  /options=\{Object\.entries\(DRIVE_KIND\)/.test(wizard) &&
    /This account can read no \$\{\(DRIVE_KIND\[driveKind\]/.test(wizard),
  `kinds seeded: ${[...driveKinds].join(', ')} — the picker lists both regardless`,
)
/* A kind with no label renders its raw key — "shared_drive" — as a control's own text. The map is
   the wizard's; the kinds are the data's, and only one of the two can be wrong silently. */
const driveKindBlock = wizard.match(/const DRIVE_KIND[^=]*= \{([\s\S]*?)\n\}/)
const labelledKinds = driveKindBlock
  ? [...driveKindBlock[1].matchAll(/(\w+):/g)].map((m) => m[1])
  : []
expect(
  'every seeded drive kind has a label in the wizard',
  labelledKinds.length > 0 && [...driveKinds].every((k) => labelledKinds.includes(k)),
  `labelled: ${labelledKinds.join(', ')} · seeded: ${[...driveKinds].join(', ')}`,
)

/* ---------------- a drive is a tree, and it is drawn as one ---------------- */

/*
 * Nesting is a `parent_id` on a flat list. Four things have to hold together or a subfolder is
 * quietly drawn as a top-level folder — which reads as an allowlist covering more of the drive
 * than it does: the data has to nest, the server has to send the pointer on both folder payloads,
 * the client has to validate it, and the wizard has to draw the tree rather than a flat list.
 */
const allFolders = (db.drives ?? []).flatMap((d) =>
  (d.folders ?? []).map((f) => ({ ...f, drive_id: d.drive_id })),
)
/*
 * **Every folder carries the pointer, and that is the fact — not that some drive happens to nest.**
 *
 * The claim was that the data nests, which was true of the EPA seed and is a property of a tenant's
 * Drive rather than of this app: Northline's five folders are flat, and a flat drive is not a
 * defect. What must hold for either is that `parent_id` is present on **every** folder including a
 * root, so "no parent" can never be confused with "seeded before nesting existed" — the distinction
 * the key was added to make. The tree picker, the validator and the payload are each asserted
 * separately below.
 */
expect(
  'every folder carries parent_id, so a root is stated rather than inferred',
  allFolders.length > 0 && allFolders.every((f) => 'parent_id' in f),
  `${allFolders.filter((f) => f.parent_id).length} of ${allFolders.length} folders sit inside another`,
)
expect(
  'every parent_id names a folder of the same drive',
  allFolders.every(
    (f) =>
      !f.parent_id ||
      (db.drives ?? [])
        .find((d) => d.drive_id === f.drive_id)
        ?.folders.some((o) => o.folder_id === f.parent_id),
  ),
  'an unresolved parent is drawn at the root, not refused',
)
expect(
  'and the server refuses one at boot rather than drawing it at the root',
  /names parent \$\{parentId\}|names parent \r?\n?\s*`\$\{parentId\}`|which is not a folder of that drive/.test(
    server,
  ),
  'validateDb checks parent_id across the drive, like a canvas edge endpoint',
)
expect(
  'both folder payloads carry the parent pointer',
  (server.match(/parent_id: f\.parent_id \?\? null/g) ?? []).length === 2,
  '/drives/:id/folders and /sources/drive/preview',
)
expect(
  'the client validates it as nullable, so a root folder still reads',
  (client.match(/parent_id: nullable\(str\)/g) ?? []).length === 2,
  'DRIVE_PREVIEW_PAYLOAD and DRIVE_FOLDERS_PAYLOAD',
)
expect(
  'the wizard picks folders from a tree, not a flat checkbox list',
  /* `\b` and the prop that follows: `<FolderTreePicker` alone matched a renamed
     `<FolderTreePickerX` in a break test, so the guard could not fail. */
  /<FolderTreePicker\s+folders=\{drivePreview\.folders\}/.test(wizard) &&
    !/options=\{drivePreview\.folders\.map/.test(codeOnly(wizard)),
  'a subfolder and the folder holding it are not peers',
)

/* ---------------- the Catalog's two actions are toggles, and the panels have no ✕ ---------------- */

/*
 * The four Catalog panels used to carry their own "✕ close", which meant two controls for one
 * piece of state and only one of them showed what the state was. The ✕ is gone and the button that
 * opened a panel closes it — which only works if the button *says* it is the open one.
 *
 * Asserted across every layer the removal touched, because half of it is worse than all of it: a
 * panel still rendering a ✕ wired to a prop nobody passes is a button that does nothing, and a
 * toggle with no pressed state is a panel a reader cannot close.
 */
/* `catalogPage` is already read at the top of this file — one binding, reused. */
const panelFiles = [
  'src/pages/CatalogPage.tsx',
  'src/components/ProfiledColumnsPanel.tsx',
  'src/components/ProfiledDocumentsPanel.tsx',
  'src/components/DocumentBrowsePanel.tsx',
]
for (const path of panelFiles) {
  const src = codeOnly(read(path))
  expect(
    `${path.split('/').pop()} has no close button left in it`,
    !/CloseOutlined/.test(src) && !/onClose/.test(src),
    'the ✕, its handler and the prop all go together or none of them do',
  )
}
expect(
  'the open action is the orange one and the closed one is white',
  (catalogPage.match(
    /type=\{(browseOpen|dictionaryOpen) \? 'primary' : 'default'\}/g,
  ) ?? []).length === 2,
  'the fill is the state — neither button is permanently the primary',
)
/* Colour alone is never a state anywhere in this app, and here it is the *only* thing saying which
   panel is open, since the panels lost their ✕. Both non-visual halves are asserted with it. */
expect(
  'and open is not signalled by colour alone',
  /aria-pressed=\{browseOpen\}/.test(catalogPage) &&
    /aria-pressed=\{dictionaryOpen\}/.test(catalogPage),
  'aria-pressed for a screen reader, the note below in words for everyone',
)
/* Scoped to the action row's own rules — the source card's `is-active` border is a different,
   older use of the brand and not what this claim is about. A whole-file search would have failed
   against correct code, which is the broad-claim trap this file records five times over. */
expect(
  'the action row paints no button fill of its own',
  ![...read('src/pages/CatalogPage.css').matchAll(/\.cat-actions[^{]*\{([^}]*)\}/g)].some(
    /* A fill or the brand itself. Not "any hex": the hint line's own text colour is a hex and is
       not a button fill, and a claim that fails on correct code is a claim nobody re-reads. */
    (rule) => /background/i.test(rule[1]) || /#f4562b|#9e3819/i.test(rule[1]),
  ),
  'open is antd primary, which reads the brand from theme.ts',
)
expect(
  'the open state is derived from the panel, not tracked beside it',
  /const browseOpen = panel === /.test(catalogPage) &&
    /const dictionaryOpen = panel === /.test(catalogPage),
  'two pieces of state for one fact is a pressed button with nothing open under it',
)
expect(
  'and the way to close a panel is stated while one is open',
  /Click the same button again to close the panel\./.test(catalogPage) &&
    /\{browseOpen \|\| dictionaryOpen \?/.test(catalogPage),
  'the ✕ is gone, so the way back has to be said somewhere',
)
/* ---------------- a run that profiled nothing says which objects, and offers the re-run ---------------- */

/*
 * "Nothing to profile — 2 table(s) already profiled. Use Force on the run in Profiling jobs to redo
 * them." never said *which* two, and sent the reader to another tab to act on the job that had just
 * done nothing. Both halves are now answered where the question is asked, and both are asserted:
 * a message that counts without naming is the failure this replaced.
 */
const outcomeSrc = read('src/data/profilingOutcome.ts')
const outcomeCode = codeOnly(outcomeSrc)
expect(
  'a skipped-everything run names the objects it skipped',
  /already profiled: \$\{namedObjects\(skipped\)\}/.test(outcomeCode),
  'a count with no names leaves the reader to work out whether theirs ran',
)
expect(
  'and a partial run names them too',
  /already profiled, skipped: \$\{namedObjects\(skipped\)\}/.test(outcomeCode),
  'same question, same answer, whether or not something else was queued',
)
expect(
  'the cap on that list is stated, never a silent truncation',
  /\+ \$\{names\.length - NAMES_SHOWN\} more/.test(outcomeCode),
  'the rule the report charts follow: no cap is silent',
)
expect(
  'and it no longer sends the reader to the jobs tab to act',
  !/Profiling jobs/.test(outcomeCode) && !/Force/.test(outcomeCode),
  'the decision is offered on the dialog that reports the outcome',
)
/*
 * `force` from a browse panel is a *second* act — the confirm on that dialog — never the first
 * click. Asserted as a pair: the Start Profiling button must not force, and the only `force: true`
 * is the confirm's `onOk`.
 */
for (const [label, path] of [
  ['BrowsePanel', 'src/pages/CatalogPage.tsx'],
  ['DocumentBrowsePanel', 'src/components/DocumentBrowsePanel.tsx'],
]) {
  const src = codeOnly(read(path))
  expect(
    `${label} starts unforced and offers the re-run on the confirm`,
    /onClick=\{\(\) => void startProfiling\(\)\}/.test(src) &&
      /onOk: \(\) => startProfiling\(true\)/.test(src) &&
      (src.match(/startProfiling\(true\)/g) ?? []).length === 1,
    'one deliberate path to force, and it is not the button',
  )
  expect(
    `and ${label} words the outcome from the shared module`,
    /profilingOutcome\(job\.objects, '(table|document)', job\.short_id\)/.test(src) &&
      !/Nothing to profile/.test(src),
    'BigQuery and Drive differ by a noun, so the wording is written once',
  )
  /* Both buttons, not just the one that acts: the cancel was written twice as a literal while
     the claim above said the wording was written once, which is how the two dialogs come to
     offer one pair of acts in two different words. And the confirm carries the width the
     module states, because antd wraps a footer it cannot fit rather than shrinking it. */
  expect(
    `and ${label} takes both button labels and the width from it`,
    /cancelText: outcome.cancelText/.test(src) &&
      !/Leave them as they are/.test(src) &&
      /width: CONFIRM_WIDTH/.test(src),
    'a footer that cannot fit its labels wraps, and reads as a misaligned pair',
  )
}

/* ---------------- what Disconnect and Delete ask ---------------- */

/*
 * **Both confirmations are one question and nothing else.**
 *
 * They used to state their consequences — what happened to the row, whether the act could be
 * undone, and which pages closed if it was the last connected source. All three were removed on
 * request; `docs/REGRESSIONS.md` records what that costs. What is guarded now is the shape that
 * replaced them, and the guard is **one cross-layer claim rather than one per file**, because the
 * dangerous state is a partial revival: a `description` back on one Popconfirm and not the other is
 * two dialogs telling a reader different amounts about the same pair of acts.
 *
 * Four legs, each of which fails by *answering* rather than by throwing:
 *
 *  - the sentence is **interpolated from the act**, so "delete" can never appear over a disconnect.
 *    Two hardcoded strings render perfectly well, which is why this keys on the template;
 *  - it is written **once**, in `src/data/sourceActions.ts` — copy rather than a component, so a
 *    test can call it, since a `Popconfirm` portals out of `renderToString`;
 *  - **both** dialogs read it, and neither carries a `description`;
 *  - the deleted component is gone from disk, not merely unreferenced.
 *
 * Read off `codeOnly`, or the comment in the page explaining that it carries *no* description would
 * satisfy the absence leg on its own — the self-documenting-file trap, recorded seven times now.
 */
const sourcesPage = read('src/pages/SourcesPage.tsx')
const sourcesCode = codeOnly(sourcesPage)
const sourceActions = codeOnly(read('src/data/sourceActions.ts'))
expect(
  'both confirmations ask one interpolated question and say nothing else',
  /Are you sure you want to \$\{action\} this source\?/.test(sourceActions) &&
    (sourcesCode.match(/title=\{confirmSourceAction\('(disconnect|delete)'\)\}/g) ?? [])
      .length === 2 &&
    !/description=/.test(sourcesCode) &&
    !/SourceImpactNotice/.test(sourcesCode) &&
    !existsSync(join(root, 'src/components/SourceImpactNotice.tsx')) &&
    !existsSync(join(root, 'src/components/SourceImpactNotice.css')),
  'one sentence, from one place, on both acts — and the consequence copy gone from every layer',
)
/*
 * **The undo still exists, and nothing on screen promises it any more.**
 *
 * That is the honest position rather than an oversight: the disconnect dialog used to say "Reconnect
 * on this row undoes it", and a promise in a dialog has to be performed by something — the publish
 * dialog's "a Domain Architect approves" mistake. The sentence is gone; the *act* is not, so all
 * four legs stay asserted. A reader now discovers it from the button on the row instead of being
 * told, which is why the button is the fourth leg.
 */
expect(
  'the undo the warning used to promise still exists, button included',
  server.includes("/reconnect$/.test(p)") &&
    /export async function reconnectSource/.test(client) &&
    /reconnect: async \(sourceId\)/.test(read('src/store/sourcesStore.ts')) &&
    /onClick=\{\(\) => void handleReconnect\(row\)\}/.test(sourcesPage),
  'route, fetcher, store action and the button on a disconnected row',
)
/* Sliced from a string only that handler carries, and the slice is asserted non-empty first: a
   split that finds nothing leaves `''`, and "this text is absent" passes over an empty string. */
const reconnectHandler = (
  server.split('there is nothing to reconnect')[1] ?? ''
).slice(0, 2000)
expect(
  'and it is an undo rather than a re-registration',
  reconnectHandler.length > 500 && !/registered\.set\(/.test(reconnectHandler),
  'it mutates the record in place, so the profiled objects survive',
)
/*
 * **Which precondition each page gates on, asserted per page.**
 *
 * These two loops used to have a second half each, cross-checking every page named in the
 * disconnect warning against the gate it actually rendered — the warning is gone, and with it the
 * risk of a dialog naming the wrong pages. The page half is kept, because it guards something
 * independent and still live: **the two gates are different preconditions**, and a page that
 * swapped one for the other would be right-looking and wrong. Ask on `NoSourceConnected` would go
 * dark with the last source while still answering from published content; the Data Catalog on
 * `NoPublishedGraph` would demand a publish before it would show a table to profile.
 */
const publicationGated = [
  ['Ask', 'src/pages/AskPage.tsx'],
  ['Reports', 'src/pages/ReportsPage.tsx'],
  ['What-if', 'src/pages/WhatIfPage.tsx'],
  ['Audit', 'src/pages/AuditPage.tsx'],
]
for (const [label, path] of publicationGated) {
  const page = read(path)
  expect(
    `${label} gates on publication, not on a connected source`,
    /<NoPublishedGraph/.test(page) && !/<NoSourceConnected/.test(codeOnly(page)),
    'it answers from published content, so the last source going does not close it',
  )
}
const connectionGated = [
  ['Data Catalog', 'src/pages/CatalogPage.tsx'],
  ['Traces', 'src/pages/TracePage.tsx'],
  ['Validation', 'src/pages/ValidationPage.tsx'],
]
for (const [label, path] of connectionGated) {
  expect(
    `${label} really closes with no source connected`,
    /<NoSourceConnected/.test(read(path)),
    'its data comes from the source, so it has nothing to show without one',
  )
}
/*
 * A disconnected source has no credential, so its allowlist cannot be edited — and the refusal is
 * the server's, not just a greyed-out button. Both halves are asserted: the button alone leaves
 * every other path into the route storing an allowlist nothing can act on, and the route alone
 * leaves a live-looking button that 400s. The same reasoning as the fixed Settings permission.
 */
expect(
  'a disconnected source cannot have its allowlist edited',
  (server.match(/is disconnected — reconnect it before changing its allowlist/g) ?? [])
    .length === 2,
  'refused on both /datasets and /folders, or the two connectors disagree',
)
expect(
  'and the button says so rather than only being greyed out',
  /disabled=\{\r?\n?\s*row\.status === 'disconnected'/.test(sourcesPage) &&
    /Disconnected — reconnect this source before changing its allowlist\./.test(sourcesPage),
  'a disabled control with no reason on it reads as broken',
)
/* The claim that stood here — "the warning counts the other connected sources rather than
   asserting" — guarded `othersConnected`, which the notice took with it. Deleted rather than
   loosened: a claim kept alive against a feature that is gone is the vacuous assertion this file
   exists to prevent. Its replacement is the cross-layer absence claim at the top of this section. */

/* ---------------- the real column profile is the one served ---------------- */

/*
 * `column_profiles` holds the 206 columns ingested from
 * `02_profiling/Metadata_Profiling.xlsx`. Losing the branch that reads it does
 * not throw — `tableDictionary` falls back to synthesis, and the Catalog serves
 * invented columns that look exactly as plausible. So both halves are asserted:
 * the data is there, and the code prefers it.
 */
expect(
  'tableDictionary prefers the real profile',
  /db\.column_profiles\?\.\[`\$\{datasetId\}\.\$\{tableId\}`\]/.test(server) &&
    /function synthesiseColumns/.test(server),
  'real columns first, synthesis only as the fallback',
)

const profiles = db.column_profiles ?? {}
const profileKeys = Object.keys(profiles)
const catalogued = (db.projects ?? []).flatMap((p) =>
  (p.datasets ?? []).flatMap((d) =>
    (d.tables ?? []).map((t) => ({ key: `${d.dataset_id}.${t.table_id}`, table: t })),
  ),
)
/*
 * **A profiled table has to match the count the Catalog advertises; an unprofiled one is a state,
 * not a fault.**
 *
 * This required a profile for *every* catalogued table, which was true of the EPA package — five
 * views, five profiles — and is a claim about that package rather than about the app. Northline
 * catalogues 64 tables across three systems and ships real profiles for the two views it built the
 * demo on, which is exactly the case `synthesiseColumns` exists for and which CLAUDE.md describes as
 * the fallback being a fallback. Asserting otherwise produced 62 red claims saying "column_profiles
 * has 0" about tables nobody profiled, which buries the one that would matter.
 *
 * So the claim is now the pair that actually guards the data: at least one table carries a real
 * profile — losing them all is the silent swap to synthesis — and every profile that exists agrees
 * with its table's advertised count.
 */
const profiledTablesInCatalog = catalogued.filter((c) => profileKeys.includes(c.key))
expect(
  'the Catalog is backed by real column profiles, not synthesis alone',
  profiledTablesInCatalog.length > 0,
  `${profiledTablesInCatalog.length} of ${catalogued.length} catalogued tables carry a profile · ` +
    `keys: ${profileKeys.join(', ')}`,
)

for (const { key, table } of profiledTablesInCatalog) {
  const columns = profiles[key] ?? []
  expect(
    `${table.table_id} profiles exactly the ${table.columns} columns it claims`,
    columns.length === table.columns,
    `catalogue says ${table.columns}, column_profiles has ${columns.length}`,
  )
  expect(
    `${table.table_id} column ids are unique`,
    new Set(columns.map((c) => c.column_id)).size === columns.length,
    'a duplicate id would collide in the dictionary and in column_notes',
  )
}

/*
 * Class facets fold classes together (`location` is `address` + `geo`), so the
 * server's arithmetic and the panel's filter have to agree on which classes go in
 * which chip — otherwise a chip counts 69 and lists 41.
 */
const columnsPanel = read('src/components/ProfiledColumnsPanel.tsx')
const profiledClasses = [
  ...new Set(Object.values(profiles).flatMap((cs) => cs.map((c) => c.class))),
].sort()
expect(
  'every class in the data is in the client union',
  profiledClasses.every((c) => new RegExp(`\\| '${c}'|'${c}',`).test(client)),
  `classes in use: ${profiledClasses.join(', ')}`,
)
const facetBlockCols = server.match(/const facets = \{([\s\S]*?)\n {6}\}/)
const serverColumnFacets = facetBlockCols
  ? [...facetBlockCols[1].matchAll(/^\s*(\w+): 0,/gm)].map((m) => m[1])
  : []
const panelFacetKeys = [
  ...(columnsPanel.match(/const FACETS[\s\S]*?\n\]/)?.[0] ?? '').matchAll(
    /key: '(\w+)'/g,
  ),
].map((m) => m[1])
expect(
  'the column facets match end to end',
  serverColumnFacets.length > 0 &&
    JSON.stringify([...serverColumnFacets].sort()) ===
      JSON.stringify([...panelFacetKeys].sort()),
  `server ${serverColumnFacets.join(',')} · panel ${panelFacetKeys.join(',')}`,
)
/*
 * **Every class the data uses has to be placed, and placing them is now a map rather than a chain of
 * `===` comparisons.**
 *
 * The chips fold classes together (`location` is `address` + `geo`), and the folding was five inline
 * comparisons naming EPA's vocabulary. Northline's profiler classes its 194 columns
 * `measure_record`, `geography`, `lifecycle_state` and thirteen others, none of which those
 * comparisons mention — so Measures and Location read 0 over a full dictionary, which is a statement
 * about the data rather than about the map. `CLASS_FACET` states the bucket per class for both
 * vocabularies, `null` where a class is deliberately in no chip, and `validateDb` refuses a document
 * using a class it has never heard of.
 */
const classFacetBody = /const CLASS_FACET = \{([\s\S]*?)\r?\n\}/.exec(server)?.[1] ?? ''
const placedClasses = new Set([...classFacetBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]))
const unplaced = profiledClasses.filter((c) => !placedClasses.has(c))
expect(
  'every profiled class lands in a facet or is deliberately unfaceted',
  classFacetBody.length > 0 && unplaced.length === 0,
  classFacetBody.length === 0
    ? 'CLASS_FACET was not found in server.mjs — this check cannot run'
    : unplaced.length > 0
      ? `no bucket for: ${unplaced.join(', ')}`
      : `${placedClasses.size} classes placed · ${profiledClasses.length} in use here`,
)
expect(
  'and a class with no bucket stops the boot rather than going uncounted',
  /has no entry in CLASS_FACET/.test(server),
  'an uncounted class reads as a chip that is empty because nothing is in it',
)

/* ---------------- the canvas ---------------- */

/*
 * The canvas draws the demo package's knowledge graph, and the package is the source
 * of truth. Every claim here compares db.json against
 * 05_knowledge_graph/knowledge_graph.json, so a hand-edit to either side shows up as
 * a disagreement rather than as a picture that quietly no longer matches the data.
 */
/*
 * The path is asserted, not merely tried.
 *
 * It read ` _demo_data_package_…` for a whole session — the repo-wide removal of
 * "VLS" ate the directory name here too — so `kg` was null and all eight claims
 * below passed while comparing against nothing, each one reporting "the package is
 * not in this checkout". A guard whose good answer is its own inability to run is
 * describing itself. The package is in the repo, so its absence is now a failure
 * rather than a skip, and the claims below can drop their null branches.
 */
const pkgDir = 'vls_demo_data_package_2026-08-10/05_knowledge_graph'
const kgPath = `${pkgDir}/knowledge_graph.json`
const studioPkgPath = `${pkgDir}/graph_studio.json`
expect(
  'the knowledge-graph package is where the ingest reads it from',
  existsSync(join(root, kgPath)) && existsSync(join(root, studioPkgPath)),
  `${kgPath} + graph_studio.json — the canvas, the queue and the checks all come from here`,
)
expect(
  'and the ingest reads exactly those two paths',
  [kgPath, studioPkgPath].every((p) => read('scripts/ingest-knowledge-graph.mjs').includes(p)),
  'a path this check does not share is a path this check cannot verify',
)
/*
 * **Parsed only if it is there.** The claim above already fails when the package is absent; parsing it
 * regardless turned that into a *crash*, which took the whole run down and hid the other 350-odd claims
 * behind an ENOENT stack. A check-docs that cannot report at all is worse than one red claim — and the
 * package is only the ingests' source, so a checkout without it is a legitimate state to be told about.
 *
 * The fallbacks are **empty rather than absent**, which is deliberate: every claim below compares the
 * package against `db.json`, so empty makes them fail loudly (`0` against the canvas's 189) instead of
 * passing vacuously over `null`. A guard whose answer is "0 of 0" is describing itself, and this file has
 * been bitten by that before.
 */
const kgHere = existsSync(join(root, kgPath)) && existsSync(join(root, studioPkgPath))
const kg = kgHere
  ? JSON.parse(read(kgPath))
  : /*
     * **Every key the claims below reach for**, not just the obvious ones. `counts` was missing
     * from this fallback, so the guard worked exactly as far as the first claim that walked into
     * `kg.counts.by_element_class` — and then threw, taking the whole run down with an ENOENT-shaped
     * TypeError. That is the failure this fallback was written to prevent, reintroduced by an
     * incomplete version of it: a partial guard is a guard that moves the crash rather than
     * removing it. Adding a claim that reads a new package key means adding that key here.
     */
    {
      nodes: [],
      edges: [],
      not_nodes: [],
      demo_display: {},
      counts: { by_element_class: {}, by_type: {} },
    }
const studioPkg = kgHere
  ? JSON.parse(read(studioPkgPath))
  : /* Same rule: the keys the claims below actually walk into, which are not the keys the real
       file leads with. `lanes`, `review_queue` and `sanity_checks` are what they read. */
    {
      trustLanes: {},
      mustReview: [],
      sanityChecks: [],
      synthesis: {},
      lanes: { trust: {}, mustReviewTotal: 0 },
      review_queue: [],
      sanity_checks: [],
    }
const canvas = db.graph_studio.canvas

expect(
  'the canvas holds every relationship the knowledge graph states',
  canvas.edges.length === kg.edges.length,
  `${canvas.edges.length} edges vs ${kg.edges.length} in the package`,
)
/*
 * Exactly the roster, with nothing materialised. The previous package shipped 20
 * edges pointing at ids its node list omitted, and the ingest had to invent four
 * nodes to keep them drawable; this build resolves cleanly, so a canvas larger than
 * the roster means something is being invented again.
 */
expect(
  'and every node it lists, with nothing invented to keep an edge drawable',
  canvas.nodes.length === kg.nodes.length,
  `${canvas.nodes.length} vs ${kg.nodes.length} in the package`,
)
expect(
  'every element class the package ships reaches the canvas',
  Object.entries(kg.counts.by_element_class).every(
    ([cls, n]) => canvas.nodes.filter((x) => x.element_class === cls).length === n,
  ),
  Object.entries(kg.counts.by_element_class)
    .map(([c, n]) => `${c} ${n}`)
    .join(' · '),
)
/*
 * The column-value node types are gone by decision, not by omission — `not_nodes`
 * records all three with `was_wrongly` beside them. A canvas that still drew them
 * would be drawing the modelling mistake the rebuild exists to correct, and the
 * `dimension` legend hue would come back with it.
 */
expect(
  'the column-value node types the package retired are absent from the canvas',
  ['WasteCode', 'ViolationType', 'EnforcementType'].every(
    (t) => !canvas.nodes.some((n) => n.type === t),
  ),
  `not_nodes lists ${kg.not_nodes.length} routed columns; a code on a row is an attribute`,
)
expect(
  'and no node carries a value Layer 1 does not hold',
  kg.nodes.every((n) => !('properties' in n)) &&
    /demo_display/.test(read('scripts/ingest-knowledge-graph.mjs')),
  'a thin instance is identity + provenance; the figures come from demo_display',
)
/*
 * The failure this replaces: 20 edges pointed at ids the roster did not contain, so
 * they were skipped while drawing and 17 facilities appeared to have no enforcement
 * at all. Silence is the wrong answer for a missing relationship, so it fails at boot.
 */
const canvasNodeIds = new Set(canvas.nodes.map((n) => n.node_id))
expect(
  'no canvas edge points at a node that is not there',
  canvas.edges.every((e) => canvasNodeIds.has(e.from) && canvasNodeIds.has(e.to)),
  'an unresolved endpoint is drawn as nothing at all',
)
expect(
  'and the server refuses a document with one, rather than drawing nothing',
  /graph_studio\.canvas has an edge whose \$\{side\} is/.test(server),
  'validateDb checks the endpoints across keys',
)
/*
 * **Provenance is required of everything the graph read, and a measure element read nothing.**
 *
 * `source` is the Catalog object a node was built from, and the claim used to require it on all of
 * them — which held only while the graph had no `measure_element` nodes carrying `null`. Those are
 * type-level: a measure is *derived over* rows rather than read off one table, so naming a source
 * would be inventing a provenance rather than reporting one. Requiring it everywhere crashed this
 * checker outright on `n.source.includes` — and a crash prints no summary at all, so every claim
 * after it went unread.
 */
const provenanced = canvas.nodes.filter((n) => n.element_class !== 'measure_element')
expect(
  'every node carries its type and its own size, and everything read off a source names it',
  canvas.nodes.every((n) => n.type && typeof n.degree === 'number' && typeof n.r === 'number') &&
    provenanced.length > 0 &&
    provenanced.every((n) => n.source),
  `source is the Catalog object; r is the degree, not a styling choice · ${provenanced.length} of ` +
    `${canvas.nodes.length} nodes are read off one`,
)
/*
 * **How a package spells provenance is its own; that every built node carries some is not.**
 *
 * This listed EPA's four profiled views and required the canvas to name them, which was a claim
 * about that package rather than about the app. The two conventions are genuinely different and both
 * are legitimate: EPA names the Catalog object a node was read off
 * (`epa_hazwaste.FRS_Facility_profile`), while Northline names the build step and the source system
 * that produced it (`A-02; ds_proj_attr.program_affiliation`, `A-05 document extraction; src_drive`).
 * A reader of either can say where the node came from, which is the whole point — a node whose
 * provenance is not on it is a claim taken on trust.
 *
 * So what is asserted is that provenance is *shared vocabulary rather than per-node prose*: far
 * fewer distinct strings than nodes, none of them blank. A generator writing a unique sentence per
 * node, or an empty string, is the failure that would leave the inspector saying nothing.
 */
const provenanceStrings = canvas.nodes.map((n) => n.source).filter((s) => typeof s === 'string')
const distinctProvenance = new Set(provenanceStrings)
expect(
  'provenance is a shared vocabulary of sources, not prose per node',
  provenanceStrings.length > 0 &&
    provenanceStrings.every((s) => s.trim().length > 0) &&
    distinctProvenance.size < provenanceStrings.length,
  `${distinctProvenance.size} distinct sources across ${provenanceStrings.length} nodes that name one`,
)
/*
 * **The corpus reaches the canvas, and every node built from it says so.**
 *
 * This required a document node's provenance to read `<drive> · <folder>/<file>` — EPA's spelling,
 * and also its `group`, which is the node's *type* in the other package (`Document`, not
 * `document`), so it matched nothing and reported "0 document nodes" as a failure about provenance.
 * The durable fact is that the unstructured side is represented on the canvas at all — a graph whose
 * documents never made it is the bridge from unstructured to structured silently missing — and that
 * each of those nodes names where it came from.
 */
const documentNodes = canvas.nodes.filter(
  (n) => n.type === 'Document' || n.group === 'document',
)
expect(
  'the document corpus reaches the canvas, and each node names where it came from',
  documentNodes.length > 0 && documentNodes.every((n) => String(n.source ?? '').trim().length > 0),
  `a node whose provenance is not on it is a claim taken on trust · ${documentNodes.length} ` +
    'document nodes',
)
/*
 * Rendered text has no doubled or edge spaces.
 *
 * A repo-wide find/replace of "VLS" ran over the demo package as well as the app and
 * left labels reading "  Texas Molecular" — a gap where the word had been. Nothing
 * errors, and a label drawn inside a circle shows every space it has. Node *ids* are
 * exempt: they are opaque keys carrying the same damage on both ends of an edge, so
 * cleaning them would unmatch the edges.
 */
/* An absent sublabel or provenance is `null` and there is nothing to render, so nothing to check —
   filtered rather than coerced, because `String(null)` would assert about the word "null". */
const renderedText = canvas.nodes
  .flatMap((n) => [n.label, n.sublabel, n.source])
  .filter((t) => typeof t === 'string')
expect(
  'no canvas label, sublabel or source has a doubled or edge space',
  renderedText.every((t) => t === t.trim() && !/ {2}/.test(t)),
  renderedText.filter((t) => t !== t.trim() || / {2}/.test(t)).slice(0, 3).join(' | ') ||
    `${renderedText.length} strings clean`,
)

/*
 * ---- the canvas is the vendored viewer ----
 *
 * The hand-written inline SVG is gone, and with it the decisions this block used to
 * recompute: a four-hue origin-class fill, an ontology ring inside it, labels gated on
 * `LABEL_AT_ZOOM`, a `getScreenCTM` pan/zoom, and positions drawn exactly where the ingest
 * put them. What replaced it is `src/graph-viewer`, vendored whole from `src/grap` — a
 * d3-force viewer with its own simulation, sidebar, legend and search — because a fixed
 * layout of 189 nodes reads as a hairball no palette can rescue.
 *
 * The claims below are the ones that still have a subject. Everything about *the data* is
 * unchanged and still checked further down: the roster, the edge endpoints, the retired
 * types, the review ids.
 */
const relLum = (hex) => {
  const chan = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2]
}
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/* One canvas component, rendered by both surfaces. A full view with its own drawing would
   be a second truth — the thing this surface exists to avoid — and it was a real risk
   while two canvases existed side by side. */
const viewerApp = read('src/graph-viewer/App.tsx')
const studioPageSrc = read('src/pages/GraphStudioPage.tsx')
const fullPageSrc = read('src/pages/GraphCanvasFullPage.tsx')
expect(
  'the studio tab and the full view render one viewer, on one payload',
  /<GraphViewer/.test(studioPageSrc) &&
    /<GraphViewer/.test(fullPageSrc) &&
    [studioPageSrc, fullPageSrc].every((p) => /fromCanvas\(canvas/.test(p)),
  'both read GET /graph-studio/:id/canvas and hand it to the same component',
)
expect(
  'and the retired drawing is gone from disk, not left unrendered',
  !existsSync(join(root, 'src/components/GraphCanvas.tsx')) &&
    !existsSync(join(root, 'src/components/NodeInspector.tsx')) &&
    !existsSync(join(root, 'src/data/canvasLegend.ts')),
  'an unreachable second canvas is the second truth waiting to be re-imported',
)
/* d3 is a real dependency now — the repo's rule is to prefer ~100 lines to a package, and
   this is the deliberate exception. It has to be declared, and the gate has to still pass
   (that half is `npm run audit`, which preflight runs). */
expect(
  'the viewer’s d3 dependency is declared rather than transitive',
  /"d3": "\^7/.test(read('package.json')) && /"@types\/d3": "\^7/.test(read('package.json')),
  'the force layout is d3’s; vendoring the folder is what brought it in',
)

/*
 * **Every ontology type on the canvas has a colour in the viewer's palette.**
 *
 * `colorFor` falls through to a grey default for an unknown type — which is honest but
 * silent: a new node type renders as "some grey thing" and its legend row reads the same.
 * This is the fill claim's replacement, keyed to the palette that now draws.
 */
const viewerLib = read('src/graph-viewer/lib/graph.ts')
const typeColors = new Map(
  [...viewerLib.matchAll(/^\s{2}(\w+): "(#[0-9a-f]{6})",$/gm)].map((m) => [m[1], m[2]]),
)
const canvasTypes = [...new Set(canvas.nodes.map((n) => n.type))]
expect(
  'every type the canvas draws has a hue in the viewer’s palette',
  typeColors.size > 0 && canvasTypes.every((t) => typeColors.has(t)),
  canvasTypes.filter((t) => !typeColors.has(t)).length > 0
    ? `no hue for: ${canvasTypes.filter((t) => !typeColors.has(t)).join(', ')}`
    : `${canvasTypes.length} types, all coloured`,
)
/* And each of those hues has to read on the viewer's own ground, which is dark — the
   earlier palette was measured against a white page, and reusing either set on the other
   ground is exactly how the ring hues failed twelve ways the first time. */
const viewerBg = (read('src/graph-viewer/styles.css').match(/--bg:\s*(#[0-9a-f]{6})/) ?? [])[1]
expect(
  'the viewer’s ground is declared, so its marks can be measured against it',
  Boolean(viewerBg),
  `--bg parsed as ${viewerBg ?? 'nothing — check the token'}`,
)
for (const type of canvasTypes) {
  const hex = typeColors.get(type)
  if (!hex || !viewerBg) continue
  expect(
    `the ${type} hue reads on the viewer’s ground (${hex} on ${viewerBg})`,
    contrast(hex, viewerBg) >= 3,
    `${contrast(hex, viewerBg).toFixed(2)}:1`,
  )
}

/*
 * **The adapter renames; it does not invent.**
 *
 * Two shapes met here, and the temptation is to fill the viewer's optional fields with
 * something plausible. Every field it sets has to come off the payload — and `r` must *not*
 * be passed, because the viewer sizes a node by class and degree and two radius rules
 * disagree silently.
 */
const adapter = codeOnly(read('src/graph-viewer/fromCanvas.ts'))
expect(
  'the adapter maps the payload’s own fields, and passes no second radius',
  /element_class: n\.elementClass === 'measure_element' \? 'measure' : n\.elementClass/.test(
    adapter,
  ) &&
    /provenance: n\.source/.test(adapter) &&
    /x: n\.x/.test(adapter) &&
    /y: n\.y/.test(adapter) &&
    !/\br: n\.r\b/.test(adapter),
  'the seeded positions seed the simulation; the radius is the viewer’s own rule',
)
/* The Query tab promises an answer's evidence lights up on the canvas. It is the same
   `on_answer_path` the payload already carries, fed to the highlight the viewer's paint
   pass already had — not a second highlight with its own rules. */
expect(
  'the answer path still lights up, through the viewer’s own dim/highlight pass',
  /onAnswerPath/.test(adapter) &&
    /highlight=\{answerPath\(canvas\)\}/.test(studioPageSrc) &&
    /highlight=\{answerPath\(canvas\)\}/.test(fullPageSrc) &&
    /highlight && highlight\.nodes\.size > 0/.test(read('src/graph-viewer/hooks/useForceGraph.ts')),
  'the Query tab’s hint is a promise about this',
)
/* It is fed a graph rather than importing one: the folder shipped with a demo dataset, and
   a viewer still reading that would draw a graph nobody published. */
expect(
  'the viewer takes its graph as a prop, and none of the demo data came with it',
  /graph: raw \}: \{/.test(viewerApp.replace(/\s+/g, ' ')) === false &&
    /graph: RawGraph/.test(viewerApp) &&
    !existsSync(join(root, 'src/graph-viewer/data')),
  'the demo dataset stayed in src/grap; this one reads the tenant’s canvas',
)

/*
 * A proposed element exists because a review row is open — that is what makes the
 * canvas and the queue one truth rather than two pictures. An id on an element with
 * no row behind it would draw a dashed node nobody can ever settle.
 */
const reviewIds = new Set(db.graph_studio.review_items.map((i) => i.item_id))
expect(
  'every review_item_id on the canvas has a row in the queue',
  [...canvas.nodes, ...canvas.edges]
    .filter((x) => x.review_item_id)
    .every((x) => reviewIds.has(x.review_item_id)),
  `${[...canvas.nodes, ...canvas.edges].filter((x) => x.review_item_id).length} provisional elements`,
)
expect(
  'the queue is about this graph — its pools are the graph’s own types',
  Object.keys(kg.counts.by_type).every((t) =>
    db.graph_studio.generated.subjects.includes(t),
  ),
  'synthesised rows must not name entities the canvas has never heard of',
)
/*
 * The queue is the package's, and the pivot is one of its rows promoted.
 *
 * rq1 is the identity merge, which is the one decision that changes what every other
 * row *means* — so it is the pivot, and the queue holds the other five. Listing it in
 * both places would ask one question twice and let a reviewer answer it two ways, so
 * this asserts the split rather than the count alone: 5 + 1 is the package's own
 * `mustReviewTotal`.
 */
const pivot = db.graph_studio.pivot
const queueIds = db.graph_studio.review_items.map((i) => i.item_id)
expect(
  'the queue is the package’s rows, less the one promoted to the pivot',
  db.graph_studio.review_items.length + 1 === studioPkg.lanes.mustReviewTotal &&
    queueIds.length === studioPkg.review_queue.length - 1,
  `${queueIds.join(', ')} + 1 pivot = ${studioPkg.lanes.mustReviewTotal} must-review decisions`,
)
expect(
  'and the identity merge is in exactly one of the two, never both',
  /Texas Molecular/.test(pivot.title) &&
    pivot.options.length === 2 &&
    !db.graph_studio.review_items.some((i) => /merge to one facility/.test(i.title)),
  pivot.title,
)
expect(
  'the lane totals are the package’s trust lanes, not numbers chosen here',
  db.graph_studio.generated.confirmed_total === studioPkg.lanes.trust.confirmedFyi &&
    db.graph_studio.generated.auto_approved_total === studioPkg.lanes.trust.autoApprove &&
    db.graph_studio.generated.must_review_total === db.graph_studio.review_items.length,
  `auto-approve ${studioPkg.lanes.trust.autoApprove} · confirmed ${studioPkg.lanes.trust.confirmedFyi} · ` +
    `must-review ${db.graph_studio.generated.must_review_total} (all authored, none padded)`,
)
/*
 * A row states its buttons in its own terms, and every label still resolves to one
 * of the recorded choices. A row offering a fourth outcome would be a button the
 * server refuses, which is the failure `action_set` was introduced to stop.
 */
/*
 * **A package words its buttons its own way, so the claim is that every one of them *means*
 * something — not that it is spelled one of five ways.**
 *
 * This listed the five choice strings the EPA package uses. Northline words its buttons for the
 * decision being taken — "Keep as selector", "Approve merge", "Reject as sentinel" — carrying
 * `keep`, `approve_merge` and `reject_as_sentinel`, and the server validates a decision against the
 * *row's own* list, so all of them were accepted and then honoured nowhere: "Reject as sentinel"
 * left the element on the canvas while the row showed as settled. `CHOICE_MEANING` translates each
 * to one of the three outcomes, and `validateDb` refuses a row offering one it cannot translate.
 */
const meaningBody = /const CHOICE_MEANING = \{([\s\S]*?)\r?\n\}/.exec(server)?.[1] ?? ''
const translatedChoices = new Set(
  [...meaningBody.matchAll(/^\s{2}'?([\w-]+)'?:/gm)].map((m) => m[1]),
)
const untranslated = [
  ...new Set(db.graph_studio.review_items.flatMap((i) => i.actions.map((a) => a.choice))),
].filter((c) => !translatedChoices.has(c))
expect(
  'every row offers its own labels, and every label means one of the three outcomes',
  meaningBody.length > 0 &&
    db.graph_studio.review_items.every((i) => i.actions.length > 0) &&
    untranslated.length === 0 &&
    /item\.actions\s*\n?\s*\? item\.actions\.map\(\(a\) => a\.choice\)/.test(server),
  untranslated.length > 0
    ? `no meaning for: ${untranslated.join(', ')}`
    : db.graph_studio.review_items
        .map((i) => `${i.item_id}: ${i.actions.map((a) => a.label).join(' / ')}`)
        .join(' · '),
)
expect(
  'and the canvas reads that meaning rather than the choice string',
  /origin: meaning === 'correct'/.test(server) &&
    /rejected: meaning === 'reject'/.test(server) &&
    /which CHOICE_MEANING does not translate/.test(server),
  'a decision recorded and honoured nowhere is the worst outcome on this surface',
)
expect(
  'and the page reads the row’s actions rather than a list of its own',
  /item\.actions\.length > 0 \? item\.actions/.test(read('src/components/ReviewQueueItem.tsx')),
  'a page that kept its own list could offer a button the API refuses',
)

/*
 * The recorded sanity checks. These are the second surface the package ships, and
 * they are served the way `ask_answers` is — matched, named as recorded, falling
 * through to the walk. Three things have to hold, and each one failed silently
 * before it was checked: every walked id has to exist, no verdict may name an edge
 * type the graph does not have, and the threshold has to be Ask's.
 */
const checks = db.graph_studio.sanity_checks
const canvasEdgeIds = new Set(canvas.edges.map((e) => e.edge_id))
expect(
  'every recorded sanity check the package ships is ingested',
  checks.length === studioPkg.sanity_checks.length,
  `${checks.length} checks · ${checks.map((c) => c.hero_question_id).join(', ')}`,
)
expect(
  'each one walks nodes and edges that are on the canvas',
  checks.every(
    (c) =>
      c.path.every((id) => canvasNodeIds.has(id)) &&
      c.edges_used.every((id) => canvasEdgeIds.has(id)),
  ),
  `${checks.reduce((n, c) => n + c.edges_used.length, 0)} hops, all resolvable`,
)
expect(
  'and the server refuses a check that walks something absent',
  /sanity_checks "\$\{check\.check_id\}" walks node/.test(server),
  'a highlight one hop short of the answer it claims is silent otherwise',
)
/*
 * The package's sc3 states `HAS_ENFORCEMENT` and an `EnforcementType` node in its
 * prose while its own traversal walks `ENFORCEMENT_AGAINST` to an `Enforcement`
 * event. Only the traversal resolves, so the ingest corrects the prose — and this is
 * what stops the correction being dropped on the next re-ingest.
 */
/*
 * Keyed to the retired names, not to "any SCREAMING_SNAKE word" — the first attempt
 * was the latter and failed on `EPA_ID` and a `LDR_SET` inside a Cypher comment,
 * neither of which is a claim about the ontology. What must never survive is a
 * *retired* type: those are the ones that read as a relationship the graph has.
 */
const RETIRED_TYPES = ['HAS_ENFORCEMENT', 'WasteCode', 'ViolationType', 'EnforcementType']
const checkProse = checks
  .flatMap((c) => [c.verdict, c.verdict_body, c.plan, ...c.context.flatMap((x) => [x.label, x.meta])])
  .join(' ')
/*
 * Only ever in a negation. Refusing the names outright was the second attempt and it
 * failed on sc5, which says "no WasteCode node" and "not WasteCode nodes" — telling
 * the reader the promotion was declined is the whole point of that check, and it is
 * the opposite of the mistake being guarded against. What must not survive is a
 * retired type named as something the graph *has*, which is what sc3's prose did.
 */
const assertedRetired = RETIRED_TYPES.filter((t) =>
  [...checkProse.matchAll(new RegExp(`(\\S+\\s+)?${t}`, 'g'))].some(
    (m) => !/\b(no|not|never|without)\s+$/i.test(m[1] ?? ''),
  ),
)
expect(
  'a retired type is named only to say it is absent, never as one the graph has',
  assertedRetired.length === 0,
  assertedRetired.join(', ') ||
    `${RETIRED_TYPES.length} retired names, each negated wherever it appears`,
)
expect(
  'and every relationship a plan matches on is one the graph has',
  [...checkProse.matchAll(/\[\w*:([A-Z_]+)\]/g)].every((m) =>
    new Set(kg.edges.map((e) => e.type)).has(m[1]),
  ),
  [...new Set([...checkProse.matchAll(/\[\w*:([A-Z_]+)\]/g)].map((m) => m[1]))].join(', '),
)
expect(
  'a recorded check is matched at Ask’s threshold, not one of its own',
  /const checks = db\.graph_studio\.sanity_checks/.test(server) &&
    /best\.score < ASK_MATCH_MIN/.test(
      server.slice(server.indexOf('function matchSanityCheck')),
    ),
  'two thresholds over one tenant’s questions would let the studio pass what Ask declines',
)
expect(
  'and the answer says which route produced it',
  /recorded: true/.test(server) && /const NO_RECORDED_CHECK = \{/.test(server),
  'a written verdict read as a derived one is the one thing this tab must not do',
)
/*
 * The query matcher. Both of its guards were paid for: a *kind* word ("facility",
 * "waste") once matched instances and answered about a pair nobody asked for, and a
 * uniqueness rule once refused to match "chemours" because the facility and its
 * consent decree share the name — the bridge the graph exists for.
 */
expect(
  'the query matcher stops type words and common words, not rare ones',
  /const kindWords = new Set\(\)/.test(server) &&
    /!kindWords\.has\(w\) && seenIn\.get\(w\) <= rareMax/.test(server),
  'rarity, plus the ontology’s own vocabulary as a stoplist',
)
/*
 * And a concept node cannot be an instance. The rebuild put the seven type-level
 * nodes on the canvas labelled exactly "Facility", "Manifest", "Document" — and the
 * whole-label shortcut matched them, so "the Denka facility" resolved to
 * CONCEPT:Facility and reported the two had nothing between them. The word was
 * already stopped; the node whose entire label *is* that word was not.
 */
expect(
  'a concept node is never matched as an instance, whole label or not',
  /n\.element_class !== 'concept'/.test(server) &&
    /asked\.includes\(own\) && !kindWords\.has\(own\)/.test(server),
  `${canvas.nodes.filter((n) => n.element_class === 'concept').length} concept nodes are ` +
    'labelled with bare type names, which is why the shortcut needed the stoplist too',
)
expect(
  'the canvas has an ingest to re-run, and the docs name it',
  existsSync(join(root, 'scripts/ingest-knowledge-graph.mjs')) &&
    /"ingest:graph": "node scripts\/ingest-knowledge-graph\.mjs"/.test(read('package.json')) &&
    claude.includes('npm run ingest:graph'),
  `hand-editing ${canvas.nodes.length} laid-out nodes is not a maintenance path`,
)
/* The ingest's layout is not decoration now that the drawing is a live simulation: the
   seeded `x`/`y` are handed to d3 as each node's starting position, so a run settles from
   the arrangement the ingest wrote rather than from a random scatter. That is why the
   picture is recognisably the same graph every time, and why re-running the ingest is still
   the way to change the layout. */
expect(
  'the seeded positions are still served, and still do work',
  /x: n\.x/.test(server) && /y: n\.y/.test(server) && /x: n\.x/.test(adapter),
  'they seed the simulation — d3 reads a node’s existing x/y as its initial position',
)

/* ---------------- a version per build ---------------- */

/*
 * **Every build takes the next number — v1, v2, v3 — and keeps it.**
 *
 * Two halves, and the second is the one the previous scheme existed to protect. The counter
 * moves at `startBuildFor`, so each run has its own label; and the label is *stored on the run*
 * rather than derived, so a published `v2` cannot be recomputed into something else by a later
 * rebuild. A counter read at render time would relabel history the moment the fourth build
 * finished.
 *
 * The third claim is the one that would have caught the old bug in reverse: committing a brief
 * must not bump anything. Two counters over one label is how a published version comes to be
 * called by a number nothing built.
 */
expect(
  'a build takes the next version number, once, when it starts',
  /function nextBuildVersion\(useCaseId\)/.test(server) &&
    /studioBuildCount\.set\(useCaseId, next\)/.test(server) &&
    /config_version: nextBuildVersion\(id\)/.test(server),
  'assigned at the start of the run, so the label is the build’s own',
)
expect(
  'and every surface reads the stored label rather than recomputing one',
  /config_version: run\.config_version/.test(server) &&
    /version: published\.config_version/.test(server) &&
    !/config_version: configVersion\(/.test(server),
  'a label derived at render time would relabel a published version on the next build',
)
expect(
  'committing a brief moves no version, so there is only one counter',
  !/bumpConfigVersion/.test(codeOnly(server)),
  'two counters over one label is how a published v2 gets called v3',
)

/* ---------------- the build pipeline ---------------- */

/*
 * `BUILD_STAGES` is what the Build tab renders verbatim and what SKILLS.md lists.
 * A stage added to the server without being documented shows up on screen as an
 * unexplained row — and printing the platform's own names is the whole reason they
 * can be looked up.
 */
const buildStagesBlock = server.match(/const BUILD_STAGES = \[([\s\S]*?)\r?\n\]/)
const buildStageEntries = buildStagesBlock
  ? [...buildStagesBlock[1].matchAll(/\{ key: '(\w+)', steps: \[([^\]]*)\] \}/g)].map((m) => ({
      key: m[1],
      steps: [...m[2].matchAll(/'(\w+)'/g)].map((s) => s[1]),
    }))
  : []
const buildStages = buildStageEntries.map((s) => s.key)
expect(
  'the build pipeline has stages',
  buildStages.length > 0,
  `${buildStages.length}: ${buildStages.join(' → ')}`,
)
for (const stage of buildStages) {
  expect(
    `build stage \`${stage}\` documented`,
    skills.includes(stage),
    'name it in SKILLS.md flow 8',
  )
}
/*
 * Every stage owns inner work, and no substep name is reused.
 *
 * A stage with no substeps renders as a row claiming work nobody can see — the
 * thing the substeps were added to fix. A duplicated name is worse than cosmetic:
 * the substep rows are keyed by it, so two rows in one stage would collide in
 * React and one of them would silently stop updating.
 */
const buildSteps = buildStageEntries.flatMap((s) => s.steps)
expect(
  'every build stage names its own substeps',
  buildStageEntries.length > 0 && buildStageEntries.every((s) => s.steps.length > 0),
  `${buildSteps.length} substeps across ${buildStageEntries.length} stages`,
)
expect(
  'no two build substeps share a name',
  new Set(buildSteps).size === buildSteps.length,
  'the rows are keyed by it',
)
expect(
  'the substeps are what advances, driven by one cursor',
  /const BUILD_STEPS = BUILD_STAGES\.flatMap/.test(server) &&
    /run\.cursor \+= 1/.test(server) &&
    !/run\.stage_index \+= 1[\s\S]{0,200}BUILD_STAGES\.length/.test(server),
  'a stage index kept alongside a step index is two counters that can disagree',
)
/*
 * **Build first: the studio's other four tabs are locked until a build has completed —
 * and locked again while any run is in flight.**
 *
 * They all read a build's output, and the review queue is the loudest case — its rows are
 * the package's, so it looks populated whether or not anything has been built. A *rebuild*
 * has the same problem one level up: while it runs, those tabs show the previous build's
 * output with nothing saying so, which reads as this run's result arriving early. So the
 * flag is `builtOnce && !buildRunning`, and the two halves are asserted separately —
 * dropping the second is the silent half, because the tabs still lock on a fresh graph.
 *
 * The active-tab redirect is the half that fails worst: a *disabled* tab that is also the
 * *active* one renders its pane with no way to leave it, and the studio's default arrival
 * tab is the queue, so that is the normal path rather than an edge case.
 */
const studioPage = read('src/pages/GraphStudioPage.tsx')
const studioCode = codeOnly(studioPage)
const lockedTabs = ['queue', 'canvas', 'query', 'versions']
expect(
  'every studio tab but Build is locked until a build completes',
  /const builtOnce = builds\.some\(\(b\) => b\.status === 'complete'\)/.test(studioCode) &&
    (studioCode.match(/disabled: !outputReadable/g) ?? []).length === lockedTabs.length,
  `${(studioCode.match(/disabled: !outputReadable/g) ?? []).length} of ${lockedTabs.length} tabs carry the flag`,
)
expect(
  'and a run in flight locks them again, so a rebuild cannot be read as its own result',
  /const buildRunning = builds\.some\(\(b\) => b\.status === 'running'\)/.test(studioCode) &&
    /const outputReadable = builtOnce && !buildRunning/.test(studioCode),
  'without the second half these tabs show the superseded build while the new one runs',
)
expect(
  'and Build itself never is',
  !/key: 'build',\s*label: 'Build',\s*disabled/.test(studioCode),
  'locking the one tab that unlocks the others is a dead end',
)
expect(
  'a locked tab cannot stay the active one',
  /if \(!outputReadable && tab !== 'build'\) setTab\('build'\)/.test(studioCode),
  'the default arrival tab is the queue, so this is the normal path',
)
/* And it says why, where the tabs are, only while they are locked — and it says something
   different while a run is in flight, because "start one" is the wrong instruction for
   somebody already watching one. That in-flight sentence is now the only one a rebuild can
   carry, so the gate has to be the same flag the tabs use. */
expect(
  'the lock explains itself and names the act that lifts it',
  /\{outputReadable \? null : \(/.test(studioPage) &&
    /Build this graph first/.test(studioPage) &&
    /buildRunning\s*\?/.test(studioPage),
  'a row of disabled tabs with no sentence beside them reads as a broken page',
)

/*
 * **The Quality report tab is gone, on every layer at once.**
 *
 * It recomputed the three preconditions `publish.blocked` already reports, so it was a
 * second surface for one gate. Half a removal is the shape that fails silently — a store
 * still holding `report` behind a page that cannot show it, or a `POST …/quality-check`
 * nothing calls — so this is one claim over the server, the client, the store, the page
 * and the stylesheet rather than one per file. `codeOnly` first: the paragraphs above
 * name the tab in explaining its removal.
 */
const studioStoreCode = codeOnly(read('src/store/graphStudioStore.ts'))
const studioCssCode = read('src/pages/GraphStudioPage.css')
expect(
  'the Quality report tab is gone from every layer',
  !/quality-check/.test(codeOnly(server)) &&
    !/QUALITY_CHECK_MS/.test(server) &&
    !/runQualityCheck|QualityReport|QUALITY_REPORT_PAYLOAD/.test(codeOnly(client)) &&
    !/runQualityCheck|checking|report:/.test(studioStoreCode) &&
    !/key: 'quality'/.test(studioCode) &&
    !/\.gs-check|\.gs-quality-head/.test(studioCssCode),
  'a store field behind a page that cannot show it is the shape that fails silently',
)
/* Paired with a presence claim over the same region: the gate the tab reported on is
   untouched, and an absence claim alone passes just as well over a deleted file. */
expect(
  'and the publish gate it duplicated still states those checks',
  /gate\.blocked \?/.test(studioCode) &&
    /gate\.reasons\.join/.test(studioCode) &&
    /publish: \{ blocked/.test(client) &&
    /must_review_outstanding/.test(server),
  'the gate is computed once on the server and read by the banner and the refusal',
)

/*
 * The pace is documented, and the page derives from it rather than restating it.
 *
 * A build now takes minutes, not seconds, so the duration on screen is load-bearing:
 * a five-minute spinner with no estimate reads as wedged. That figure has to come
 * from the server's own number — the earlier band check asserted a total instead,
 * and a deliberate change to the pace would have failed it as if it were a bug.
 */
const buildStepMs = Number(
  ((server.match(/const BUILD_STEP_MS = ([\d_]+)/) ?? [])[1] ?? '0').replace(/_/g, ''),
)
const buildRunSecs = (buildStepMs * buildSteps.length) / 1000
/* "2m 35s" — the same shape `dur()` prints, so the docs quote the page. */
const buildRunLabel =
  buildRunSecs < 60
    ? `${buildRunSecs}s`
    : `${Math.floor(buildRunSecs / 60)}m${buildRunSecs % 60 ? ` ${buildRunSecs % 60}s` : ''}`
/* `\b` on the pace, because plain `includes('5s')` is satisfied by the "35s" in the
   total beside it — a claim that passes for the wrong reason is not a claim. */
const pacePattern = new RegExp(`\\b${buildStepMs / 1000}s\\b`)
expect(
  'the substep pace and the run length are documented as the server has them',
  buildStepMs > 0 &&
    [claude, skills].every((doc) => pacePattern.test(doc) && doc.includes(buildRunLabel)),
  `BUILD_STEP_MS ${buildStepMs} · ${buildSteps.length} substeps ≈ ${buildRunLabel}`,
)
/* Comments stripped first: the `dur()` doc comment shows "5m 10s" as an example of
   its own output, and a claim that read that as a hardcoded pace would cry wolf —
   which is how a real red claim gets ignored. */
const buildTabCode = read('src/components/BuildTab.tsx')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*/g, '')
expect(
  'and the page reports the pace rather than hardcoding it',
  /step_ms: BUILD_STEP_MS/.test(server) &&
    /step_ms: num/.test(client) &&
    /shown\.stepTotal \* shown\.stepMs/.test(buildTabCode) &&
    !/\d+\s?s\b/.test(buildTabCode),
  'a duration on screen is derived from what the server sent',
)
expect(
  'and the panel renders the substeps under their stage',
  /className="bt-steps"/.test(read('src/components/BuildTab.tsx')) &&
    /stage\.steps\.map/.test(read('src/components/BuildTab.tsx')),
  'BuildTab nests them rather than flattening the pipeline',
)
expect(
  'a build is a run the page polls, not an instant commit',
  /match: \(p\) => \/\^\\\/graph-studio\\\/\[\^\/\]\+\\\/builds\$\/\.test\(p\)/.test(server) &&
    /send\(res, 202, buildView\(startBuildFor/.test(server),
  '202 + a queued run, like a profiling job',
)
expect(
  'the build lives in the studio, where rebuilding does',
  /BuildTab/.test(read('src/pages/GraphStudioPage.tsx')) &&
    /useGraphBuildStore/.test(read('src/store/graphStudioStore.ts')),
  'the tab and its store are the studio’s',
)
expect(
  'and the wizard starts it at the click rather than committing and leaving',
  /startBuild\(result\.useCase\.useCaseId\)/.test(read('src/pages/NewGraphPage.tsx')) &&
    /state: \{ tab: 'build' \}/.test(read('src/pages/NewGraphPage.tsx')),
  'Save & build starts the run, then hands over to the Build tab',
)
/*
 * A version *is* a build: every finished run records one, and building must never
 * publish. `studioLive` is the publish pointer, so a build touching it would mean
 * a rebuild silently went live.
 */
const startBuildBody = (server.match(/function startBuildFor[\s\S]*?\n\}/) ?? [''])[0]
const runBuildBody = (server.match(/function runGraphBuild[\s\S]*?\n\}/) ?? [''])[0]
/*
 * The build payload's field names, server against client schema.
 *
 * TypeScript cannot see across this boundary: `RawGraphBuild` is a *claim* about
 * what the server sends, so renaming a field in `buildView` compiles cleanly and
 * fails at runtime instead — `draft_version should be a string, got undefined`,
 * which reads like a stale server and is not one. This compares the two lists.
 */
const buildViewBody = (server.match(/const buildView = \(run\) => \(\{[\s\S]*?\n\}\)/) ?? [''])[0]
const serverBuildFields = [...buildViewBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
const buildSchemaBody = (client.match(/const GRAPH_BUILD = shape\(\{[\s\S]*?\n\}\)/) ?? [''])[0]
const clientBuildFields = [...buildSchemaBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
expect(
  'the build payload and its schema name the same fields',
  serverBuildFields.length > 0 &&
    JSON.stringify([...serverBuildFields].sort()) ===
      JSON.stringify([...clientBuildFields].sort()),
  `server ${serverBuildFields.join(',')} · schema ${clientBuildFields.join(',')}`,
)

expect(
  'a finished build records a version',
  /recordVersion\(run,/.test(runBuildBody),
  'runGraphBuild records one on completion, not on start',
)
expect(
  'building never publishes',
  !/studioLive\.set/.test(startBuildBody) && !/studioLive\.set/.test(runBuildBody),
  'publishing stays behind its own gate',
)
expect(
  'publishing names a content hash, and unpublishing exists',
  /versions\\\/\[0-9a-f\]\+\\\/publish/.test(server) &&
    /versions\\\/\[0-9a-f\]\+\\\/unpublish/.test(server),
  'a version is identified by what it contains, not by a counter',
)
expect(
  'the version rows are never rewritten',
  !/studioVersions\.get\([^)]*\)\[[^\]]*\]\s*=/.test(server) &&
    /published: v\.sha256 === studioLive\.get\(id\)/.test(server),
  'publishing flips a pointer, it does not mutate a row',
)
expect(
  'Ask serves the published version and nothing else',
  /const published = publishedVersion\(useCase\.use_case_id\)/.test(server) &&
    /if \(!published\) return null/.test(server),
  'unpublishing takes the graph out of Ask',
)
/*
 * A finished build has to *appear* on Versions.
 *
 * The rows come from the studio payload, which is otherwise fetched once on
 * arrival — so without a refresh keyed to the completed run, the build a user just
 * watched finish is absent from the list until they reload. Nothing errors; the
 * list is simply one run behind, which is the kind of staleness nobody reports.
 */
expect(
  'a completed build refreshes the version list',
  /refreshedForBuild/.test(read('src/pages/GraphStudioPage.tsx')) &&
    /shownBuild\?\.status !== 'complete'/.test(read('src/pages/GraphStudioPage.tsx')),
  'the row appears without a reload, once per run',
)

/* The header must not carry a publish button: it could not say which build it
   meant, which is the whole reason publishing moved onto the rows. */
expect(
  'publishing happens on a version row, not in the header',
  /onPublish\(sha256: string\)/.test(read('src/pages/GraphStudioPage.tsx')) &&
    !/Publish \{data\.version\}/.test(read('src/pages/GraphStudioPage.tsx')),
  'the header shows the loaded job instead',
)

/* ---------------- Ask's recorded answers are renderable ---------------- */

/*
 * `ask_answers` is the tenant's 40 written answers. Every block kind in them needs
 * a branch in `AnswerBlocks` and a case in the client's `variant`, or a block
 * silently disappears mid-answer — the reader sees a shorter answer, not an error.
 */
const answers = db.ask_answers ?? []
const blockKinds = [...new Set(answers.flatMap((a) => a.blocks.map((b) => b.type)))].sort()
const answerBlocks = read('src/components/AnswerBlocks.tsx')
expect(
  'every recorded block kind has a renderer',
  blockKinds.length > 0 &&
    blockKinds.every((k) => new RegExp(`block\\.type === '${k}'`).test(answerBlocks)),
  `kinds in the data: ${blockKinds.join(', ')}`,
)
expect(
  'and a case in the block validator',
  blockKinds.every((k) => new RegExp(`^\\s*${k}: shape\\(`, 'm').test(client)),
  'ANSWER_BLOCK is a tagged union over exactly these',
)
const chartKinds = [
  ...new Set(
    answers.flatMap((a) => a.blocks.filter((b) => b.type === 'chart').map((b) => b.chart)),
  ),
].sort()
expect(
  'every chart kind is one the client accepts',
  chartKinds.every((k) => new RegExp(`'${k}'`).test(client)),
  `chart kinds: ${chartKinds.join(', ')}`,
)

/*
 * The confidence band and the score must agree. The query set states both, and a
 * "High" chip over a 0.62 would misreport the answer's own certainty.
 */
for (const a of answers) {
  const band = a.confidence >= 0.85 ? 'High' : a.confidence >= 0.6 ? 'Medium' : 'Low'
  expect(
    `${a.answer_id} states a band that matches its score`,
    a.confidence_level === band,
    `${a.confidence_level} for ${a.confidence}`,
  )
}

/* No two recorded answers may answer the same question, or the matcher's
   tie-breaker decides which one a user gets. */
const askQuestions = answers.map((a) => a.question.trim().toLowerCase())
expect(
  'no question is recorded twice',
  new Set(askQuestions).size === askQuestions.length,
  `${answers.length} answers`,
)

/* The stream is the contract: refusals before it opens, events after. */
expect(
  'the answer is streamed as events, not one blob',
  /sseOpen\(res\)/.test(server) &&
    /sseSend\(res, 'block'/.test(server) &&
    /sseSend\(res, 'done'/.test(server),
  'stage → summary → block… → done',
)
expect(
  'and the client validates each event',
  /ASK_STAGE_EVENT/.test(client) &&
    /ASK_BLOCK_EVENT/.test(client) &&
    /ASK_ANSWER_PAYLOAD\)/.test(client),
  'per-event schemas plus the whole envelope on done',
)

/* ---------------- every document resolves into the graph ---------------- */

/*
 * `document_extractions` is the join from an uploaded PDF to a facility node in
 * the graph, ingested from `08_unstructured/Entity_Extraction_Map.xlsx`. A
 * document missing an entry renders "no graph entity resolved" — correct for a
 * file nothing matched, and indistinguishable from an ingestion that quietly
 * skipped a row. So every seeded document must have one.
 */
const extractions = db.document_extractions ?? {}
const resolvedNodeIds = new Set((db.graph_studio?.canvas?.nodes ?? []).map((n) => n.node_id))
/* Whether this corpus uses one name for the party and the resolved entity, decided by the corpus
   rather than assumed — see the note on the claim below. */
const oneNameCorpus = (db.drives ?? []).some((drive) =>
  (drive.folders ?? []).some((folder) =>
    (folder.documents ?? []).some(
      (doc) => extractions[doc.document_id]?.extracted_entity === doc.linked_entity,
    ),
  ),
)
for (const drive of db.drives ?? []) {
  for (const folder of drive.folders ?? []) {
    for (const doc of folder.documents ?? []) {
      const resolution = extractions[doc.document_id]
      expect(
        `document "${doc.document_id}" resolves to a graph node`,
        Boolean(resolution?.resolved_node),
        resolution ? `→ ${resolution.resolved_node}` : 'no entry in document_extractions',
      )
      /*
       * **`linked_entity` and the resolution are the same fact in one corpus and two in another, so
       * the guard is which corpus this is.**
       *
       * EPA's documents are enforcement papers *about* a facility, so the entity the browse tree
       * names and the entity the graph resolved to are one and the same — and a stale name on either
       * side would read as agreement while pointing at a different company, which is what this was
       * written to catch. Northline's are contracts: the tree names the counterparty the agreement
       * is *with* (Kelso Ridge Constructors) and the extraction resolves the project it *belongs to*
       * (`PRJ:C25B315_658`). Both are right, and requiring them equal reported all 36 as broken.
       *
       * So: where the corpus uses one name for both, every document must — a corpus agreeing on 35
       * of 36 is the stale row. Where it uses two, the fact worth asserting is that each side is real:
       * the tree names somebody, and the resolution lands on a node the canvas actually has.
       */
      const sameName = resolution && resolution.extracted_entity === doc.linked_entity
      expect(
        oneNameCorpus
          ? `"${doc.document_id}" names the same entity in both places`
          : `"${doc.document_id}" names a party and resolves to a node the canvas has`,
        oneNameCorpus
          ? !resolution || sameName
          : Boolean(String(doc.linked_entity ?? '').trim()) &&
            (!resolution || resolvedNodeIds.has(resolution.resolved_node)),
        oneNameCorpus
          ? `tree "${doc.linked_entity}" vs resolution "${resolution?.extracted_entity}"`
          : `tree "${doc.linked_entity}" · resolves to ${resolution?.resolved_node}`,
      )
    }
  }
}
expect(
  'no extraction points at a document that no longer exists',
  Object.keys(extractions).every((id) =>
    (db.drives ?? []).some((dr) =>
      (dr.folders ?? []).some((f) => (f.documents ?? []).some((d) => d.document_id === id)),
    ),
  ),
  `${Object.keys(extractions).length} extractions`,
)
expect(
  'the resolution is served, not synthesised',
  /resolution: db\.document_extractions\?\.\[doc\.document_id\] \?\? null/.test(server),
  'documentDictionary reads it from db.json',
)

/* ---------------- document type facets are counted, not declared ---------------- */

/*
 * **The type chips are the corpus's kinds, and now they are built by counting them.**
 *
 * They used to be four slugs written into the server's `FACET_FOR_TYPE`, again into the panel's
 * `TYPE_FOR_FACET`, and again as four `num` fields in the client schema — three copies of EPA's
 * enforcement taxonomy, kept in step by this claim. A corpus of any other kind then drew four chips
 * reading 0 above a full list of documents, which reads as "none of those here" rather than as a map
 * that has never heard of what is in it. Northline's kinds are `scope_document` and `contract`, and
 * it had exactly that failure.
 *
 * So the three copies are gone and the server counts `doc_type` off the profiled documents. What is
 * asserted now is that no copy has come back: the server derives the buckets, the panel renders the
 * served list, and the schema validates it as an array rather than as named fields. A revived
 * literal map is the failure worth catching, because it would work for whichever tenant it was
 * written for.
 */
const docsPanel = read('src/components/ProfiledDocumentsPanel.tsx')
expect(
  'the document type facets are counted from the corpus, not declared against one',
  /const typeFacets = new Map\(\)/.test(server) &&
    /typeFacets\.set\(document\.doc_type/.test(server) &&
    !/FACET_FOR_TYPE/.test(codeOnly(server)) &&
    !/TYPE_FOR_FACET/.test(codeOnly(docsPanel)),
  'a doc_type slug written into either side can only fit the corpus it was written for',
)
expect(
  'the panel renders the served facets rather than a list of its own',
  /\.\.\.data\.type_facets/.test(docsPanel) && /type_facets: arrayOf\(/.test(client),
  'the same rule as the consent screen rendering the scopes the endpoint returned',
)

const seededDocTypes = [
  ...new Set(
    (db.drives ?? []).flatMap((d) =>
      (d.folders ?? []).flatMap((f) => (f.documents ?? []).map((doc) => doc.doc_type)),
    ),
  ),
]
expect(
  'every seeded doc_type can reach a facet, because a facet is one of them',
  seededDocTypes.length > 0 && seededDocTypes.every((t) => typeof t === 'string' && t.trim()),
  `kinds in this corpus: ${seededDocTypes.join(', ')}`,
)
expect(
  'the three fixed facets are still validated by name',
  ['all', 'needs_review', 'pii'].every((bucket) => client.includes(`${bucket}: num`)),
  'every corpus has these three; only the kinds vary',
)

/*
 * Both fields are read straight through to the browse tree and the dictionary,
 * so a document or view missing one renders a blank rather than raising. The
 * server refuses such a document at boot; this refuses it before boot.
 */
for (const drive of db.drives ?? []) {
  for (const folder of drive.folders ?? []) {
    for (const doc of folder.documents ?? []) {
      expect(
        `document "${doc.document_id}" names its type and entity`,
        Boolean(doc.doc_type_label && doc.linked_entity),
        `doc_type_label=${doc.doc_type_label} linked_entity=${doc.linked_entity}`,
      )
    }
  }
}
for (const project of db.projects ?? []) {
  for (const dataset of project.datasets ?? []) {
    for (const table of dataset.tables ?? []) {
      expect(
        `view "${table.table_id}" states its label and grain`,
        Boolean(table.label && table.grain),
        `label=${table.label} grain=${table.grain}`,
      )
    }
  }
}

/* ---------------- use-case templates resolve ---------------- */

/*
 * A template is nothing but ids into three other pools, so a typo does not
 * throw — the member drops out and the step drafts five personas where the use
 * case names six. A short list reads as an answer, which is why this is checked
 * here as well as in `validateDb`: the server catches it at boot, and this
 * catches it before the server is ever started.
 */
for (const [memberKey, poolKey, idKey] of [
  ['personas', 'graph_personas', 'persona_id'],
  ['kpis', 'graph_kpis', 'kpi_id'],
  ['hero_questions', 'graph_hero_questions', 'question_id'],
]) {
  for (const template of db.graph_use_case_templates ?? []) {
    const missing = template[memberKey].filter(
      (id) => !db[poolKey].some((entry) => entry[idKey] === id),
    )
    expect(
      `template "${template.template_id}" ${memberKey} all resolve`,
      missing.length === 0,
      `not in ${poolKey}: ${missing.join(', ')}`,
    )
  }
}

/*
 * A phrase that appears in two templates' descriptions makes both score it, and
 * a tie deliberately matches neither — so a well-meaning edit here silently
 * turns a template off rather than breaking anything visible.
 */
const normalise = (s) => s.toLowerCase().replace(/\s+/g, ' ')
for (const template of db.graph_use_case_templates ?? []) {
  const own = normalise(template.description)
  const shared = template.match_phrases.filter((phrase) =>
    (db.graph_use_case_templates ?? []).some(
      (other) =>
        other.template_id !== template.template_id &&
        normalise(other.description).includes(phrase),
    ),
  )
  expect(
    `template "${template.template_id}" phrases are unique to it`,
    shared.length === 0,
    shared.length > 0
      ? `also in another template's description: ${shared.join(', ')}`
      : `${template.match_phrases.length} phrases, none shared`,
  )
  /*
   * **Whether the phrases are drawn *from* the description is the package's business, and it is
   * reported rather than refused.**
   *
   * The rule the matcher depends on is uniqueness — a phrase two templates score makes the round a
   * tie, and a tie deliberately matches neither, so a well-meaning edit silently turns a template
   * off. That is asserted above and is not negotiable. The verbatim half was a separate convenience:
   * EPA's phrases are lifted from its own description, so pasting that description in hits all of
   * them. Northline's are its vocabulary — "rate case", "change order", "forecast vintage" — and its
   * one-sentence description contains none of them, so pasting *it* matches nothing while a brief
   * that talks about the work matches fine. That is a weaker demo path, not a broken matcher, so it
   * is stated with the count rather than failed.
   */
  const fromDescription = template.match_phrases.filter((phrase) => own.includes(phrase))
  expect(
    `template "${template.template_id}" says how many of its phrases its own description carries`,
    template.match_phrases.length > 0,
    `${fromDescription.length} of ${template.match_phrases.length} appear verbatim in the ` +
      'description — pasting it matches the template only when at least TEMPLATE_MIN_PHRASES do',
  )
}

/* ---------------- every response is validated ---------------- */

/*
 * CLAUDE.md promises a schema for every endpoint, and the promise was quietly
 * broken for fourteen fetchers — mostly writes, whose results are rendered just
 * like a read's. A doc line cannot enforce this, so the shape of the code does:
 * an exported fetcher that calls `request<...>` must also call `validate(`.
 *
 * Deliberately crude — it reads each exported function/const body up to the next
 * export. A false positive means writing the schema, which is the point.
 */

/** Every top-level declaration, exported or not, with its body. */
const declarations = client
  .split(/\n(?:export )?(?:async function|function|const) /)
  .slice(1)
  .map((chunk) => ({
    name: chunk.match(/^(\w+)/)?.[1] ?? '(anonymous)',
    exported: false,
    body: chunk,
  }))

// Helpers that validate on a fetcher's behalf — `withStudio` is one. A fetcher
// delegating to one of these is checked, just not in its own body.
const validators = new Set(
  declarations.filter((d) => /\bvalidate[<(]/.test(d.body)).map((d) => d.name),
)

// `request` is the transport itself — it has no shape of its own to check.
const fetchers = declarations.filter(
  (d) => d.name !== 'request' && /\brequest[<(]/.test(d.body),
)

expect(
  'client fetchers are found',
  fetchers.length > 20,
  `${fetchers.length} fetchers call request()`,
)

const unvalidated = fetchers.filter((f) => {
  if (/\bvalidate[<(]/.test(f.body)) return false
  // Delegating to a helper that validates counts, as long as it is not itself.
  return ![...validators].some(
    (helper) => helper !== f.name && new RegExp(`\\b${helper}\\s*\\(`).test(f.body),
  )
})
expect(
  'every fetcher validates its response',
  unvalidated.length === 0,
  unvalidated.length === 0
    ? `${fetchers.length} fetchers, all checked at the boundary`
    : `no schema in: ${unvalidated.map((f) => f.name).join(', ')} — ` +
      'add one in client.ts; a write answers with a shape too',
)

/* ---------------- where the API lives ---------------- */

/*
 * The API origin is per-environment, so it lives in .env.development /
 * .env.production and nowhere else. Two ways that quietly stops being true, and
 * both are cheap to catch:
 *
 *   · someone hardcodes the deployed host in client.ts to unblock themselves,
 *     and every developer's `npm run dev` starts writing to the shared box;
 *   · the .env files are deleted or renamed, and `VITE_API_BASE` silently
 *     resolves to undefined — which falls back to /api, so development still
 *     works and only the production build is broken, in a browser, later;
 *   · the two are collapsed into one plain `.env`, which Vite loads in *every*
 *     mode. That is the worst of the three, because it fails in the opposite
 *     direction: `npm run dev` starts calling the deployed box, the local mock
 *     server is bypassed, and every db.json edit and server.mjs change appears
 *     to do nothing. Nothing errors — the page just serves production's answers.
 *     This one has actually happened; see docs/REGRESSIONS.md.
 */
/*
 * A remote origin has to be available to the production build — from
 * `.env.production`, or from a plain `.env` if the two have been consolidated.
 * Without one, `VITE_API_BASE` is undefined, falls back to `/api`, and the
 * deployed SPA has no API: broken in a browser, later, silently.
 */
const prodEnv = existsSync(join(root, '.env.production'))
  ? read('.env.production')
  : ''
const plainEnvRaw = existsSync(join(root, '.env')) ? read('.env') : ''
const remoteRe = /^\s*VITE_API_BASE\s*=\s*https?:\/\/(?!localhost|127\.0\.0\.1|\[::1\])/m
expect(
  'a remote origin is available to the production build',
  remoteRe.test(prodEnv) || remoteRe.test(plainEnvRaw),
  '.env.production, or a plain .env carrying it',
)

/*
 * Development's origin may live in `.env.development` or in a plain `.env` —
 * what must never happen is a plain `.env` naming a *remote* origin, because
 * Vite loads it in every mode and `npm run dev` silently starts answering from
 * the deployed box. That is the failure that actually happened, and it is the
 * value, not the filename, that causes it: a plain `.env` pointing at localhost
 * cannot bypass the local mock server.
 *
 * Asserted this way rather than by banning the key outright so the check tracks
 * the hazard instead of a convention — a red claim nobody can act on gets
 * dismissed, and this one already sat red for a whole session.
 */
const plainEnv = plainEnvRaw
/*
 * The **last** assignment, because that is the one dotenv keeps — and a file with
 * two of them is worse than either, since the effective value is invisible.
 * An earlier version of this check read the *first* match and passed a `.env`
 * whose second line pointed at the deployed box: the guard agreed with the wrong
 * half of the file.
 */
const plainBases = [...plainEnv.matchAll(/^\s*VITE_API_BASE\s*=\s*(.+)$/gm)].map((m) =>
  m[1].trim(),
)
expect(
  '.env assigns VITE_API_BASE at most once',
  plainBases.length <= 1,
  plainBases.length > 1
    ? `${plainBases.length} assignments (${plainBases.join(' then ')}) — the last one wins, so the first is a decoy`
    : 'one or none',
)
const plainBase = plainBases.at(-1) ?? ''
const isLocal = (value) =>
  value === '' ||
  value.startsWith('/') ||
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(value)
expect(
  'a plain .env names no remote origin',
  isLocal(plainBase),
  plainBase
    ? `.env sets VITE_API_BASE=${plainBase} for every mode, development included`
    : 'no VITE_API_BASE in .env',
)
expect(
  'development has an API base',
  existsSync(join(root, '.env.development')) || plainBase !== '',
  'either .env.development or a local origin in .env — otherwise it falls back to /api',
)

expect(
  'client.ts reads the API base from the environment',
  /import\.meta\.env\.VITE_API_BASE/.test(client),
  'BASE must come from VITE_API_BASE, defaulting to /api',
)

const hardcodedOrigins = [...client.matchAll(/'https?:\/\/[^']+'/g)].map((m) => m[0])
expect(
  'no hardcoded API origin in client.ts',
  hardcodedOrigins.length === 0,
  hardcodedOrigins.length === 0
    ? 'the origin is environment-owned'
    : `${hardcodedOrigins.join(', ')} — move it to .env.production`,
)

/* ---------------- the consent connects the signed-in user ---------------- */

/*
 * `/sources/oauth/callback` used to answer every caller with `db.google_account`,
 * so the wizard's "Connected as …" named one seeded person no matter who was
 * signed in. The identity is client-held, so the fix has four legs and all four
 * have to hold: the server must read `as`, the client must send it, the wizard
 * must take it from the auth store, and the alert must *render* the signed-in
 * email rather than whatever the payload echoed — that last one is what makes the
 * page right against an older or deployed server too. Asserted here rather than
 * noted, because any one going missing restores the seeded email silently — nothing
 * errors, it just shows the wrong human.
 */
const callbackRoute = (server.split("p === '/sources/oauth/callback'")[1] ?? '').slice(
  0,
  3000,
)
expect(
  'consent callback reads the connecting account from the request',
  /query\.get\('as'\)/.test(callbackRoute) &&
    !/account: db\.google_account/.test(callbackRoute),
  '`as` names who signed in; db.google_account is the no-caller fallback only',
)
expect(
  'client.ts sends the signed-in email with the consent callback',
  /&as=\$\{encodeURIComponent\(signedInAs\)\}/.test(client) &&
    (client.match(/callbackPath\(state, '(bigquery|drive)', signedInAs\)/g) ?? [])
      .length === 2,
  'both oauthCallback and driveOauthCallback go through callbackPath',
)
expect(
  'the connect wizard takes that email from the auth store',
  /useAuthStore\(\(s\) => s\.identity\?\.email\)/.test(wizard) &&
    /* Matched on the argument, not on the local holding the state: the wizard
       renamed `start.state` to `oauthState` when the consent became a
       click-through, and this failed for a variable name while the fact it
       guards — both connectors send the signed-in email — was still true. */
    (wizard.match(/(?:drive)?[oO]authCallback\([\w.]+, signedInAs\)/g) ?? []).length === 2,
  'BigQuery and Drive both pass signedInAs to their callback',
)
expect(
  'the "Connected as" alert renders the signed-in email',
  /signedInAs \?\? account\.email/.test(wizard) &&
    (wizard.match(/Connected as <strong>\{connectedAs\}<\/strong>/g) ?? []).length === 2 &&
    !/Connected as <strong>\{account\.email\}/.test(wizard),
  'connectedAs prefers the auth store, so a stale server cannot name a stranger',
)

/* ---------------- spacing scale ---------------- */

const tokens = [...indexCss.matchAll(/--sp-(\d):/g)].map((m) => Number(m[1]))
expect('spacing scale present', tokens.length >= 9, `--sp-1..--sp-${Math.max(...tokens, 0)}`)
expect('SP mirror in theme.ts', /export const SP = \{/.test(theme), 'JSX side of the scale')

/*
 * Every stylesheet, found on disk rather than listed here.
 *
 * The list this replaced named nine files and had stopped covering six — including three
 * added in the last month — so the rule it enforced was quietly true of two thirds of the
 * app. A guard whose scope is maintained by hand beside the thing it describes drifts from
 * it, which is the same failure as a client-side copy of a server's scope list.
 *
 * **Sub-scale insets are exempt.** The scale starts at `--sp-1: 4px`, so a 1px or 2px pill
 * inset cannot be expressed with it and is a border-ish detail rather than layout spacing.
 * Anything 4px or over must come from the scale.
 */
const cssFiles = (function walkCss(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walkCss(`${dir}/${entry.name}`)
      : entry.name.endsWith('.css')
        ? [`${dir}/${entry.name}`]
        : [],
  )
})('src')
/*
 * **Two exemptions, and both are vendored code.**
 *
 * `src/reports/reports-prototype.css` is the report prototype's own stylesheet and
 * `src/graph-viewer/styles.css` is the graph viewer's — each carried over with its figures
 * and its own rhythm intact, together some 200 spacing declarations a 4px scale cannot
 * express without redrawing two designs. They are design source material, not something
 * authored here, and the rule this check enforces is about what the team writes.
 *
 * The exemptions are **narrowed rather than taken on trust**: each file must stay scoped
 * under its own class (both checked below), and this list must contain nothing but the two
 * vendored sheets — so nothing authored in this repo can quietly join it, and neither sheet
 * can quietly go global.
 */
const SPACING_EXEMPT = [
  'src/reports/reports-prototype.css',
  'src/graph-viewer/styles.css',
]
expect(
  'the spacing rule is exempt for the two vendored stylesheets and nothing else',
  SPACING_EXEMPT.length === 2 &&
    SPACING_EXEMPT.every((f) => cssFiles.includes(f)) &&
    /* Vendored means it sits in a directory this repo did not author the design of. Both
       are named, so "vendored" cannot come to mean "inconvenient to convert". */
    SPACING_EXEMPT.every(
      (f) => f.startsWith('src/reports/') || f.startsWith('src/graph-viewer/'),
    ),
  'anything authored here comes from --sp-*; these two are carried over unchanged',
)
const rawPx = []
for (const file of cssFiles.filter((f) => !SPACING_EXEMPT.includes(f))) {
  const hits =
    read(file).match(
      /^\s*(margin|padding|gap|row-gap|column-gap)[^:]*:\s*[^;]*\b\d+px/gm,
    ) ?? []
  for (const hit of hits) {
    const overScale = [...hit.matchAll(/(\d+(?:\.\d+)?)px/g)].some((m) => Number(m[1]) >= 4)
    if (overScale) rawPx.push(`${file}: ${hit.trim()}`)
  }
}
expect(
  'no raw px spacing, in any stylesheet',
  cssFiles.length > 10 && rawPx.length === 0,
  rawPx.length === 0
    ? `${cssFiles.length} stylesheets, all layout spacing from --sp-*`
    : rawPx.join(' | '),
)

/*
 * **The vendored stylesheet is scoped, and that is not tidiness.**
 *
 * It was written for a page it owned outright: `*{margin:0;padding:0}`, `body`, `button`,
 * `h1,h2,h3`, `table`, `th`, `td` and `:root` were all bare. Unscoped, it resets every antd
 * component's margins and restyles every table on Sources, Ask, Catalog, Graph Studio and
 * What-if — and it would do it silently, on pages nobody was editing.
 *
 * So: every selector in the file starts with the scope, its tokens sit on that class rather
 * than `:root`, and the page mounts it inside a matching wrapper. A `@`-rule or a keyframe stop
 * is not a selector and is skipped — which is how the first version of the transform failed,
 * latching on a single-line `@keyframes` and leaving two thirds of the file global.
 */
const protoCss = read('src/reports/reports-prototype.css')
/* Comments stripped first: the file's own header quotes `*{margin:0;padding:0}` while
   explaining why that rule had to be scoped, and scanning the raw text reported the
   explanation as an unscoped selector. */
const unscoped = protoCss
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((line) => /\{/.test(line))
  .map((line) => line.slice(0, line.indexOf('{')).trim())
  .filter((sel) => sel && !sel.startsWith('@') && !/^(from|to|\d+%)$/.test(sel))
  .filter((sel) => !sel.split(',').every((one) => one.trim().startsWith('.cw-reports')))
expect(
  'the vendored report stylesheet is scoped, so it cannot restyle the rest of the app',
  protoCss.length > 0 &&
    unscoped.length === 0 &&
    /* Its tokens moved off `:root` — left there they would win over the host's on every page. */
    !/^:root\s*\{/m.test(protoCss) &&
    /* And the page really wraps it in that class. */
    /className="cw-reports"/.test(read('src/pages/ReportsPage.tsx')),
  unscoped.length > 0
    ? `unscoped selectors: ${unscoped.slice(0, 3).join(' | ')}`
    : 'every selector under .cw-reports, tokens on the wrapper, page wraps in it',
)

/*
 * **And the graph viewer's stylesheet, by the same rule and for worse reasons.**
 *
 * It was written for a page it owned outright — `*{box-sizing}`, `html, body`, `#root` — and
 * its class names are as generic as a stylesheet gets: `.link`, `.tab`, `.dot`, `.n`,
 * `.side`, `.banner`, `.reset`, `.hint`. Unscoped, `.link` restyles every anchor in the app
 * and `.tab` fights the studio's own tabs, silently, on pages nobody edited. It is also
 * *dark*: its tokens on `:root` would repaint the whole app's ground.
 *
 * Same three-part check as the report sheet: every selector under the scope, tokens off
 * `:root`, and the component really wrapping itself in that class. It has no portal, so
 * there is no fourth part — but if it ever grows one, the report prototype's menu bug is
 * what happens next.
 */
const viewerCss = read('src/graph-viewer/styles.css')
const viewerUnscoped = viewerCss
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((line) => /\{/.test(line))
  .map((line) => line.slice(0, line.indexOf('{')).trim())
  .filter((sel) => sel && !sel.startsWith('@') && !/^(from|to|\d+%)$/.test(sel))
  .filter((sel) => !sel.split(',').every((one) => one.trim().startsWith('.cw-graph')))
expect(
  'the vendored viewer stylesheet is scoped, so it cannot restyle the rest of the app',
  viewerCss.length > 0 &&
    viewerUnscoped.length === 0 &&
    !/^:root\s*\{/m.test(viewerCss) &&
    /className="cw-graph"/.test(read('src/graph-viewer/App.tsx')),
  viewerUnscoped.length > 0
    ? `unscoped selectors: ${viewerUnscoped.slice(0, 3).join(' | ')}`
    : 'every selector under .cw-graph, tokens on the wrapper, root wraps in it',
)
/* And the three document-level rules are gone rather than scoped: a `height: 100vh` root
   inside a tab is a viewer taller than the page it sits in, which is why the container sets
   the height instead. */
/*
 * **The viewer's root fills whatever contains it, and the simulation measures that box.**
 *
 * Both halves of one bug, reported from the full view: the root was the document's own flex
 * root in the folder it came from, so it declared no width — dropped into `.gcf-body`'s flex
 * row it sized to *content*, the drawing collapsed to min-content beside a 360px sidebar,
 * and two thirds of the page stayed blank. The simulation then centred itself on that narrow
 * measurement, so the graph sat off-screen left as well.
 *
 * A width alone is not enough, which is why the second half is asserted too: the centre was
 * read once at build time, and a panel that has not been laid out yet measures 0 — every node
 * piles into the corner and nothing errors.
 */
/* Comments stripped before the match — **eighth** time this trap has been paid for. The rule
   carries a comment explaining *why* it declares a width, so the raw text contains the string
   `width: 100%`, and a break test that deleted the real declaration still passed. */
const viewerCssNoComments = viewerCss.replace(/\/\*[\s\S]*?\*\//g, '')
const viewerCssRoot = (viewerCssNoComments.match(/\.cw-graph \{[\s\S]*?\n\}/) ?? [''])[0]
expect(
  'the viewer root fills a block container and a flex one',
  /width:\s*100%/.test(viewerCssRoot) &&
    /flex:\s*1 1 auto/.test(viewerCssRoot) &&
    /min-width:\s*0/.test(viewerCssRoot) &&
    /height:\s*100%/.test(viewerCssRoot),
  'without a width it sizes to content, and two thirds of the full view is blank',
)
expect(
  'and width pressure comes out of the drawing, not the panel',
  /\.cw-graph \.side \{[\s\S]*?flex-shrink:\s*0/.test(viewerCssNoComments) &&
    /\.cw-graph \.graph \{[\s\S]*?min-width:\s*0/.test(viewerCssNoComments),
  'a 360px panel squeezed to 200 is unreadable; the drawing just has less room',
)
const forceHook = read('src/graph-viewer/hooks/useForceGraph.ts')
expect(
  'the simulation centres on a measured box, with a fallback for the unlaid-out case',
  /const box = \(svgEl: SVGSVGElement\)/.test(forceHook) &&
    /svgEl\.clientWidth \|\| rect\.width/.test(forceHook) &&
    /d3\.forceCenter\(\.\.\.box\(svgEl\)\)/.test(forceHook),
  'clientWidth is 0 before layout, and forceCenter(0, 0) piles every node in the corner',
)
expect(
  'and it re-centres when the panel is resized, rather than keeping a stale centre',
  /new ResizeObserver\(/.test(forceHook) &&
    /centre\.x\(cx\)\.y\(cy\)/.test(forceHook) &&
    /observer\.disconnect\(\)/.test(forceHook),
  'a window resize otherwise leaves the graph centred on a width it no longer has',
)

/* Comments stripped — for the seventh recorded time: the header explains *which* document
   rules were dropped, so it names `html, body`, `#root` and `100vh`, and the raw text
   satisfied every absence below. */
const viewerCssCode = viewerCss.replace(/\/\*[\s\S]*?\*\//g, '')
expect(
  'and it owns no document-level rule any more',
  !/^html,?\s*$/m.test(viewerCssCode) &&
    !/^#root/m.test(viewerCssCode) &&
    !/height:\s*100vh/.test(viewerCssCode) &&
    /\.gs-viewer \{[\s\S]*?height:/.test(read('src/pages/GraphStudioPage.css')),
  'the same component renders in a tab and full-window, so the frame sets the height',
)

/*
 * **A portal leaves the scope, so the scope has to travel with it.**
 *
 * Scoping the stylesheet broke every menu in the prototype and nothing said so. `MenuProvider`
 * portals to `document.body`, outside the page's `.cw-reports` wrapper, so none of the scoped
 * rules matched: no `position: absolute`, no `z-index`, no background. The popover rendered as
 * unstyled text below the whole page — and a Delete button whose confirmation is invisible looks
 * precisely like a button that does nothing.
 *
 * So: every portal out of the vendored tree carries the class, and it carries it boxlessly —
 * `.cw-reports` holds the prototype's `height: 100%` and opaque background, which at body level
 * would cover the app, and any box would change the containing block the menu positions against.
 */
const portalFiles = (function walkTsx(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walkTsx(`${dir}/${entry.name}`)
      : entry.name.endsWith('.tsx')
        ? [`${dir}/${entry.name}`]
        : [],
  )
})('src/reports').filter((f) => read(f).includes('createPortal('))
const unscopedPortals = portalFiles.filter(
  (f) => !/createPortal\(\s*(?:\/\*[\s\S]*?\*\/\s*)?<div className="cw-reports cw-portal">/.test(read(f)),
)
expect(
  'every portal out of the vendored tree carries the scope class, boxlessly',
  portalFiles.length > 0 &&
    unscopedPortals.length === 0 &&
    /\.cw-reports\.cw-portal\s*\{\s*display:\s*contents;?\s*\}/.test(read('src/pages/ReportsPage.css')),
  portalFiles.length === 0
    ? 'no portal was found in src/reports — this check cannot run'
    : unscopedPortals.length > 0
      ? `portals outside the scope: ${unscopedPortals.join(', ')}`
      : `${portalFiles.length} portal file(s), each scoped`,
)

/* ---------------- poll interval ---------------- */

const pollMs = Number((jobsTab.match(/POLL_MS = (\d+)/) ?? [])[1])
expect(
  'poll interval matches the UI copy',
  jobsTab.includes('refreshing every ${POLL_MS / 1000}s'),
  `POLL_MS=${pollMs} is interpolated into the status line, so they cannot drift`,
)

/*
 * And the board is **told** when a run is queued, rather than left to notice.
 *
 * It loads on mount and polls only while something is active, so the poll that sees 0 stops
 * the loop — right for a board nobody is adding to, wrong the moment a second run is queued
 * with the tab already open. That is the re-profile confirm exactly: the first click lands
 * here with an all-skipped job that completes instantly, the loop stops, and pressing
 * "Profile N table(s) again" queues a run this list never asks about. It reads as a button
 * that did nothing, and nothing errors — the run is real.
 *
 * Both halves, because the poll's stop condition is what makes the refresh load-bearing.
 */
const queuedHandler = (catalogPage.split('const handleQueued = useCallback(')[1] ?? '')
  .split('}, [')[0]
expect(
  'queueing a run re-reads the jobs board',
  /void loadJobs\(\)/.test(queuedHandler) &&
    /const loadJobs = useJobsStore\(\(s\) => s\.load\)/.test(catalogPage),
  'its own poll has already stopped by then, so a queued run would never appear',
)
expect(
  'and the poll it cannot rely on is the one that stops at zero',
  /if \(activeCount === 0\) return/.test(jobsTab),
  'if this loop ever polls while idle, say so here — the claim above assumes it does not',
)

/* ---------------- a paragraph every 5s, and a shimmer for the ones still out ---------------- */

/*
 * **The pace is the server's, and the shimmer count is a promise it made.**
 *
 * A block lands every `ASK_BLOCK_MS`, now 5s — long enough that an empty gap reads as a page
 * that stopped, which is why each paragraph still to come gets a placeholder. The count comes
 * from the summary event's `block_count`: the answer is composed before the stream opens, so
 * the server knows the number, and a client-side guess would draw a placeholder under an
 * answer that had already finished. That is the same lie as a stage that ticks without a
 * request, one component down.
 */
/* Its own binding: `askPage` is declared further down and reading it from here is a temporal
   dead zone, which kills the whole run rather than failing one claim. Twice now. */
const askPagePaced = read('src/pages/AskPage.tsx')
const askBlockMs = Number(
  ((server.match(/const ASK_BLOCK_MS = ([\d_]+)/) ?? [])[1] ?? '0').replace(/_/g, ''),
)
expect(
  'a paragraph is paced at 5s, on the server',
  askBlockMs === 5000 && /await pause\(ASK_BLOCK_MS\)/.test(server),
  `ASK_BLOCK_MS is ${askBlockMs}ms`,
)
expect(
  'and the summary states how many paragraphs are coming',
  /block_count: \(answer\.blocks \?\? \[\]\)\.length/.test(server) &&
    /block_count: num/.test(client) &&
    /blockCount: e\.block_count/.test(client),
  'validated at the boundary like every other event field',
)
/* The count reaches the page from the store, and the page subtracts what has landed — so a
   shimmer stands for a specific paragraph rather than for a hope. */
const blocksComponent = read('src/components/AnswerBlocks.tsx')
expect(
  'the shimmers are the promised paragraphs minus the landed ones',
  /streamedBlockCount: event\.blockCount/.test(read('src/store/askStore.ts')) &&
    /pending=\{streamedBlockCount - streamedBlocks\.length\}/.test(askPagePaced) &&
    /Math\.max\(0, pending\)/.test(blocksComponent),
  'a placeholder for a paragraph nobody promised is an animation over nothing',
)
expect(
  'and the shimmer is decoration, so it yields to reduced motion',
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/.test(
    read('src/components/AnswerBlocks.css'),
  ) && /aria-hidden="true"/.test(blocksComponent),
  'the page states the same fact in words — a screen reader has it already',
)

/* ---------------- Ask is a conversation, kept for the session ---------------- */

/*
 * **New chat, chat history, and both stored in `sessionStorage` keyed by the signed-in
 * address.**
 *
 * Three things make this honest rather than merely convenient, and each fails quietly on its
 * own: the key names the user (two people share a browser), the value is *validated* on read
 * (`sessionStorage` is hand-editable, exactly like the `/db` editor, and a restored chat is
 * rendered by the same components a validated answer is), and the rail says the history lives
 * in the tab — a list that looked like an archive would promise a server-side one that does
 * not exist.
 */
/* Its own binding, declared here: `askPage` below is a `const` in the temporal dead zone
   from this block's point of view, and reading it from above killed the whole run — the
   "claim total stops moving" failure, already recorded once. */
const askPageSrc = read('src/pages/AskPage.tsx')
const askChats = read('src/data/askChats.ts')
const askChatsCode = codeOnly(askChats)
const askStoreSrc = read('src/store/askStore.ts')
const chatRail = read('src/components/AskChatRail.tsx')

expect(
  'the chat key names the signed-in address, and the store reads it at call time',
  /export const chatsKey = \(email: string\)/.test(askChatsCode) &&
    /contextweave\.ask\.chats\./.test(askChatsCode) &&
    /useAuthStore\.getState\(\)\.identity\?\.email/.test(askStoreSrc),
  'two people share a browser; a filter applied on read is one somebody can forget',
)
/* Session, not local: a chat is a working session, the same reasoning that keeps registered
   sources and review decisions in the mock server's memory. */
expect(
  'it is session storage, and nothing else',
  /sessionStorage/.test(askChatsCode) && !/localStorage/.test(askChatsCode),
  'localStorage would outlive the tab and imply an archive nobody keeps',
)
expect(
  'a signed-out caller reads and writes nothing',
  /if \(!s \|\| !email\) return \[\]/.test(askChatsCode) &&
    /if \(!s \|\| !email\) return$/m.test(askChatsCode),
  '"signed out" is not a user, and a shared bucket is how one reader sees another’s questions',
)
/* Validated on the way in, per chat rather than all-or-nothing: one unreadable entry costs
   that entry, and a turn with no answer is dropped rather than restored as a spinner nobody
   can end. */
expect(
  'a restored chat is validated before it is rendered',
  /parsed\.filter\(validChat\)/.test(askChatsCode) &&
    /v\.turns\.every\(validTurn\)/.test(askChatsCode) &&
    /return v\.answer !== null && validAnswer\(v\.answer\)/.test(askChatsCode),
  'sessionStorage is as reachable a malformed payload as any response',
)
expect(
  'and a corrupt history is dropped rather than thrown',
  (askChatsCode.match(/catch \{/g) ?? []).length >= 4,
  'a bad key must not take the page down; a tab close would have taken it anyway',
)
/* The rail is its own component — a list behind a page's state cannot be asserted on — and
   it states the limit rather than implying an archive. */
expect(
  'the rail is a component, and offers New chat plus the history',
  /export default function AskChatRail/.test(chatRail) &&
    /^\s*New chat$/m.test(codeOnly(chatRail)) &&
    /<AskChatRail/.test(askPageSrc),
  'a panel behind a parent’s state renders as whatever the initial state says',
)
/*
 * **It collapses, and collapsed means absent rather than styled away.**
 *
 * The panel is a 260px column the thread pays for on every screen, so it starts shut and the
 * toggle carries the count — a collapsed control with no number says nothing about what is
 * behind it. The early return is what makes "shut" real: hiding the rows in CSS would leave
 * them in the markup, which is the difference between a narrower page and a lighter one, and
 * the difference an assertion can see.
 */
expect(
  'History collapses to its toggle, and the rows are gone rather than hidden',
  /collapsed: boolean/.test(chatRail) &&
    /if \(collapsed\) \{\s*return \(/.test(chatRail) &&
    /aria-expanded=\{!collapsed\}/.test(chatRail) &&
    /className="ask-rail is-collapsed"/.test(chatRail),
  'a shut panel still in the DOM is a narrower page, not a lighter one',
)
expect(
  'and the toggle names the panel and counts what is in it',
  /ask-rail-toggle-label">History</.test(chatRail) &&
    /\{chats\.length\}<\/span>/.test(chatRail) &&
    /\.ask-rail\.is-collapsed \{[\s\S]*?width: auto/.test(read('src/pages/AskPage.css')),
  'shut with no count is a control with nothing to say',
)
/* Shut by default, and shut again by the two acts that mean "now I am reading": starting a
   thread and picking one. */
expect(
  'the thread has the width until the reader asks for the history',
  /useState\(false\)/.test(askPageSrc) &&
    /collapsed=\{!historyOpen\}/.test(askPageSrc) &&
    (askPageSrc.match(/setHistoryOpen\(false\)/g) ?? []).length === 2,
  'New chat and opening a thread both end in reading, and reading wants the width',
)
expect(
  'and it says the history lives in the tab, not on the server',
  /Closing the tab ends the session; nothing is stored on the server/.test(chatRail) &&
    /\$\{CHATS_KEPT\} chats/.test(chatRail),
  'a rail that looked like an archive promises one that does not exist',
)
/*
 * A chat is created *by asking*. "New chat" only clears the active id, so the list never
 * fills with empty threads somebody opened and left — and the store keeps no second copy of
 * the last answer: the thread is the history, read through one selector.
 */
expect(
  'a chat is created by asking, and the thread is the only home for an answer',
  /newChat: \(\) => set\(\{ activeChatId: null \}\)/.test(askStoreSrc) &&
    /export const selectActiveChat/.test(askStoreSrc) &&
    !/^\s*answer: AskAnswer \| null$/m.test(codeOnly(askStoreSrc)),
  'two homes for one answer is how the thread and the history disagree',
)
/* Switching graphs starts a new thread: an answer belongs to the version that produced it,
   and reading it under another graph's heading is a claim about content that never answered. */
expect(
  'switching graphs starts a new thread rather than continuing one',
  /set\(\{ useCaseId, activeChatId: null \}\)/.test(askStoreSrc),
  'an answer belongs to the version that produced it',
)
/* The agent's own messages are the streamed stages, paced by the server between the pieces.
   The page must not animate ahead of them — the consent panel's stage-versus-timer rule. */
expect(
  'the working turn renders the server’s stages, and holds no timer of its own',
  /streamedSteps\.map/.test(askPageSrc) &&
    /aria-busy="true"/.test(askPageSrc) &&
    !/setTimeout|setInterval/.test(codeOnly(askPageSrc)),
  'a stage appears because a stage happened, never on a client timer',
)

/* ---------------- answer requirements moved from the wizard to Ask ---------------- */

/*
 * 'Answer requirements' was step 6 of the New Graph wizard: the brief declared the
 * citation policy and the render format once, for every answer the graph would ever
 * give. It is asked for **per question** now, on Ask's own tab.
 *
 * A removal spanning this many layers fails worst *half-done* — the rule this repo
 * already learned from the report access gate. So the absence is asserted on every one
 * of them at once, and the presence of what replaced it in the same pass: an absence
 * claim over a file whose middle has gone missing passes without meaning anything.
 */
const askPage = read('src/pages/AskPage.tsx')
const askPageCode = codeOnly(askPage)
const reqPanel = read('src/components/AnswerRequirementsPanel.tsx')
const wizardRules = read('src/data/wizardSteps.ts')
const newGraphPage = read('src/pages/NewGraphPage.tsx')
const graphStore = read('src/store/graphStore.ts')

/* Six steps, and the server's list is the one the stepper renders and the API validates. */
const wizardSteps = (server.match(/const WIZARD_STEPS = \[([\s\S]*?)\n\]/) ?? [])[1] ?? ''
const stepLabels = [...wizardSteps.matchAll(/'([^']+)'/g)].map((m) => m[1])
expect(
  'the New Graph wizard is six steps, ending on the coverage review',
  stepLabels.length === 6 && stepLabels[5] === 'Entities & relationships',
  `${stepLabels.length} step(s): ${stepLabels.join(' · ')}`,
)
expect(
  'and none of them is Answer requirements',
  !stepLabels.includes('Answer requirements'),
  'the step is gone — its choice is asked for on Ask',
)
/* The page's fallback and its effects key on the same last step. A literal 7 left behind
   would show a locked seventh step the server never sends. */
expect(
  'the page names the last step once, and derives from it',
  /const LAST_STEP = 6/.test(newGraphPage) &&
    /step !== LAST_STEP \|\| derivation/.test(newGraphPage) &&
    /stepIssue\(LAST_STEP, draft\)/.test(newGraphPage) &&
    !/stepIssue\(7,/.test(codeOnly(newGraphPage)),
  'a hardcoded 7 renders a step the API would reject',
)
/*
 * And nothing on the wizard side still stores, drafts or judges the old answers.
 *
 * The server's two brief-shaped regions rather than the whole file: `graph_answer_formats`
 * is still a required `db.json` key — it is the pool Ask's tab now reads — so a whole-file
 * search for `answer_formats` matches the thing that is *supposed* to be there. This is the
 * same trap as keying an absence claim on a token the file mentions in a comment.
 */
/* `codeOnly` first: the comment above the step clamp *names* the two fields it no longer
   reads, and a raw slice matched that — the self-documenting-file trap, for the sixth time. */
const savedUseCaseFn = (
  codeOnly(server).split('const savedUseCase = (u) => ({')[1] ?? ''
).split('})')[0]
/* The POST handler, cut at the next route — the GET on the same path comes first, so
   the split has to key on the method that follows it. */
const useCaseCommit = (
  codeOnly(server).split(/match: \(p\) => p === '\/graph-use-cases',\s*handle: async/)[1] ??
  ''
).split(/\n {2}\{/)[0]
for (const [label, code] of [
  ['a saved brief', savedUseCaseFn],
  ['the use-case commit', useCaseCommit],
  ['the wizard page', codeOnly(newGraphPage)],
  ['the step rules', codeOnly(wizardRules)],
  ['the graph store', codeOnly(graphStore)],
]) {
  expect(
    `${label} keeps no answer formats or citation policy`,
    code.length > 0 &&
      !/answer_formats|answerFormats|suggestAnswerFormats/.test(code) &&
      !/citations/.test(code),
    'half a removal is worse than none: a stored field nothing writes reads as data',
  )
}
expect(
  'and normalizeFormats is gone with them',
  !/normalizeFormats/.test(codeOnly(server)),
  'a normaliser for a field nothing stores is dead weight that invites its return',
)
expect(
  'the formats suggester is gone from every layer',
  !/graph-answer-formats/.test(codeOnly(server)) &&
    !/graph-answer-formats/.test(codeOnly(client)) &&
    !/useAnswerFormatStore/.test(codeOnly(graphStore)),
  'a route with no caller, or a caller with no route, is a 404 waiting to happen',
)
/* The step's own component was deleted rather than left unrendered. */
expect(
  'and its wizard step component with it',
  !existsSync(join(root, 'src/components/AnswerRequirementsStep.tsx')),
  'AnswerRequirementsStep.tsx is still on disk, unreachable',
)

/* --- what replaced it, asserted over the same region --- */

/*
 * **The tab is currently switched off**, and the claim says so rather than passing over a
 * comment — which is exactly what it did at first: `/label: 'Answer requirements'/` matched
 * the commented-out tab item and reported a feature that is not on screen. `codeOnly` is the
 * difference, for the ninth recorded time.
 *
 * Everything behind it is still wired and still asserted below: the panel, the served pool,
 * the request fields and the per-answer verdict. What this pins is that the *whole* switch is
 * off together — a commented tab beside live hooks is a build failure, and a commented tab
 * beside a live panel import is a component nothing renders.
 */
expect(
  'the Answer requirements tab is off, and off in one piece',
  !/label: 'Answer requirements'/.test(askPageCode) &&
    !/<AnswerRequirementsPanel/.test(askPageCode) &&
    !/selectRequirementOptions/.test(askPageCode) &&
    !/selectCitations/.test(askPageCode),
  'switch it back on by uncommenting the tab item and the five hooks beside it',
)
expect(
  'and what it fed is untouched, so turning it back on is two uncomments',
  existsSync(join(root, 'src/components/AnswerRequirementsPanel.tsx')) &&
    /export const selectCitations/.test(read('src/store/askStore.ts')) &&
    /answer_requirements: \{/.test(server) &&
    /citations: requested\.citations/.test(server),
  'the pool, the request fields and the verdict all still exist',
)
/* Its own component, because `renderToString` renders the tab that is open: a panel
   written inline makes every assertion about its contents pass over nothing. */
expect(
  'and the panel is a component, not a branch inside the page',
  /export default function AnswerRequirementsPanel/.test(reqPanel) &&
    !/ask-req-toggle|ask-req-format/.test(askPageCode),
  'a panel behind a parent’s tab state cannot be asserted on',
)
/* The pool is served. A client-side list can offer a value POST /ask refuses — which is
   exactly what a hand-kept copy of the consent scopes did. */
expect(
  'the options come from the payload, never from the component',
  /options\.citationsOptions\.map/.test(codeOnly(reqPanel)) &&
    /options\.formats\.map/.test(codeOnly(reqPanel)) &&
    /\{options\.note\}/.test(codeOnly(reqPanel)) &&
    !/Required — every claim|narrative \+|scalar \+/.test(codeOnly(reqPanel)),
  'the server owns what may be asked for',
)
expect(
  'and the server serves them with the graph list',
  /answer_requirements: \{/.test(server) &&
    /citations_options: CITATION_OPTIONS/.test(server) &&
    /formats: askAnswerFormats\(\)/.test(server),
  'GET /ask carries the pool the tab renders',
)
/* One definition of the effective value, or the control shows one thing and the request
   carries another. */
expect(
  'the pick and the request read one selector',
  /export const selectCitations/.test(read('src/store/askStore.ts')) &&
    /citations \?\? s\.data\?\.answerRequirements\.defaultCitations/.test(
      read('src/store/askStore.ts'),
    ) &&
    /citations=\{citations\}/.test(askPage),
  'the served default fills in, and it is defined in one place',
)
/* The honesty of the feature: citations are checked, a format is only stated — and the
   answer reports both rather than the page asserting them. */
const requirementsFn = (server.split('function askRequirements(')[1] ?? '').split(
  '\nfunction ',
)[0]
expect(
  'satisfied is computed from the citations the answer really carries',
  /const satisfied = requested\.citations !== 'required' \|\| cited > 0/.test(
    requirementsFn,
  ),
  'a requirement reported as met without checking is theatre',
)
/* The rendering half moved into `AskAnswerView` when Ask became a conversation: the page
   draws a turn per question, and a copy of the markup per turn would drift. The claim follows
   the markup rather than the filename it used to be in. */
const answerView = read('src/components/AskAnswerView.tsx')
expect(
  'and a render format says it was stated, not applied',
  /stated, not applied/.test(requirementsFn) &&
    /\{answer\.requirements\.note\}/.test(answerView) &&
    /answer\.requirements\.citations/.test(answerView),
  'a recorded answer holds the blocks the tenant wrote; claiming otherwise is disprovable on screen',
)
expect(
  'an unknown format is refused, naming the pool',
  /unknown answer format\(s\)/.test(server) &&
    /citations must be one of/.test(server) &&
    /if \(requested\.error\) return send\(res, 400/.test(server),
  'refused before the stream opens — an error must not arrive inside a 200',
)
/* A brief that had reached the removed step has to land somewhere real. */
expect(
  'a saved brief past the new last step is clamped, not left pointing at nothing',
  /step: Math\.min\(Math\.max\(Number\(u\.step \?\? 1\), 1\), WIZARD_STEPS\.length\)/.test(
    server,
  ),
  'db.json still holds a brief saved on the old step 7',
)

/* ---------------- routes vs the server's own route list ---------------- */

const declared = new Set(
  [...server.matchAll(/^ \* {3}(GET|POST|PUT|PATCH|DELETE) +(\S+)/gm)].map(
    (m) => `${m[1]} ${m[2]}`,
  ),
)
const routeCount = (server.match(/^ {4}method: '/gm) ?? []).length
expect(
  'server documents its routes',
  declared.size > 0 && routeCount >= declared.size,
  `${routeCount} routes implemented, ${declared.size} listed in the header comment`,
)

/* ---------------- the What-if lens ---------------- */

/*
 * The package is the source of truth, the same rule the canvas follows. Every claim
 * here compares `db.whatif` against
 * "09 What if lens"/whatif_vls_data.json, so a hand-edit to either shows up as a
 * disagreement rather than as a page that quietly no longer matches its data.
 */
const whatifPkgPath = 'vls_demo_data_package_2026-08-10/09_What if lens/whatif_vls_data.json'
const whatifPkgHere = existsSync(join(root, whatifPkgPath))
expect(
  'the What-if package is where its ingest reads it from',
  whatifPkgHere && read('scripts/ingest-whatif.mjs').includes(whatifPkgPath),
  whatifPkgHere ? whatifPkgPath : `${whatifPkgPath} is not in this checkout`,
)
/* Read only once its presence is a claim of its own, so a wrong path is a red claim
   naming the file rather than a stack trace nobody reads as a doc failure. */
const whatifPkg = whatifPkgHere ? JSON.parse(read(whatifPkgPath)) : null
const whatif = db.whatif

expect(
  'every generator the package ships reaches db.whatif',
  whatifPkg !== null && whatif.generators.length === whatifPkg.generators.length,
  `${whatif.generators.length} generators`,
)
/*
 * The four reference classes the ingest checks, re-checked against the *document being
 * served*. Each fails silently: a measure on a missing field renders as no inherited
 * risk, a pool on a missing field offers nobody, a resolvable naming no measure reports
 * success and adds nothing.
 */
/*
 * **A tenant may have no candidate roster at all, and that is a declaration rather than a gap.**
 *
 * These four claims cross-check the lens's references against the generator roster, which assumed
 * every tenant has one — reading `generators[0]` outright, so an empty roster crashed the whole
 * checker and printed no summary. Northline's capital programme genuinely has none: it exposes
 * continuous cost levers instead of a pool of swappable loads, and `whatif._not_applicable` says so
 * per key, which is what `validateDb` now reads before permitting the emptiness.
 *
 * So the claims below hold where there is a roster, and where there is not, the fact being asserted
 * becomes the *declaration* — a stated reason, not silence. Skipping them outright would be the
 * vacuous assertion this file exists to avoid.
 */
const hasRoster = whatif.generators.length > 0
const notApplicable = whatif._not_applicable ?? {}
expect(
  'an absent candidate roster is declared with its reason, never merely empty',
  hasRoster || String(notApplicable.generators ?? '').trim().length > 0,
  hasRoster
    ? `${whatif.generators.length} generators, so the references below are checked against them`
    : `no roster, declared: ${String(notApplicable.generators ?? '(nothing said)').slice(0, 80)}`,
)

const genFields = new Set(Object.keys(whatif.generators[0] ?? {}))
const measureKeys = new Set(whatif.watched_measures.map((m) => m.key))
expect(
  'every watched measure reads a field a generator actually carries',
  hasRoster
    ? whatif.watched_measures.every((m) => genFields.has(m.field))
    : whatif.watched_measures.length > 0,
  hasRoster
    ? whatif.watched_measures.map((m) => `${m.key}→${m.field}`).join(' · ')
    : `no roster to read — ${whatif.watched_measures.length} measures still declared`,
)
expect(
  'and names a format the package defines',
  whatif.watched_measures.every((m) => m.format in whatif.formats),
  Object.keys(whatif.formats).join(', '),
)
expect(
  'every pool filters on a real field and has a headroom row',
  whatif.candidate_pools.length > 0
    ? whatif.candidate_pools.every(
        (p) => (p.filter === null || genFields.has(p.filter.field)) && p.key in whatif.headroom,
      )
    : String(notApplicable.candidate_pools ?? '').trim().length > 0,
  whatif.candidate_pools.length > 0
    ? whatif.candidate_pools.map((p) => p.key).join(', ')
    : `no pools, declared: ${String(notApplicable.candidate_pools ?? '(nothing said)').slice(0, 80)}`,
)
expect(
  'every resolvable phrasing resolves to a measure or to nothing on purpose',
  whatif.resolvable.every((r) => r.resolves_to === null || measureKeys.has(r.resolves_to)),
  `${whatif.resolvable.length} phrasings`,
)
/* A keyword on two entries makes the verdict depend on list order — the same "a tie
   matches nothing" problem `matchTemplate` has. */
const whatifKeywords = whatif.resolvable.flatMap((r) => r.keywords)
expect(
  'and no keyword appears on two of them, so no verdict is order-dependent',
  new Set(whatifKeywords).size === whatifKeywords.length,
  `${whatifKeywords.length} keywords, ${new Set(whatifKeywords).size} distinct`,
)
expect(
  'the server refuses a document that breaks any of those',
  /whatif\.watched_measures "\$\{m\.key\}" reads generator field/.test(server) &&
    /whatif\.candidate_pools "\$\{p\.key\}" filters on/.test(server) &&
    /whatif\.resolvable ".*" resolves to/.test(server),
  'validateDb checks whatif across keys, like the studio canvas',
)

/*
 * The premise of the authoring step: the *graph* decides what grounds. A client holding
 * the keyword list could answer for itself, and the refusal would be theatre.
 */
expect(
  'the resolvable keyword list never reaches the client',
  /\*\*`resolvable` is deliberately not in this payload\.\*\*/.test(server) &&
    !/resolvable: db\.whatif\.resolvable/.test(server) &&
    !read('src/api/client.ts').includes('resolvable:'),
  'POST /whatif/resolve is the only way to ask',
)
/*
 * The library's contract, and the reason a scenario is computed rather than stored: it
 * keeps the admitted load so every figure recomputes against today's graph.
 */
/*
 * The stored scenario, sliced to the two writers rather than searched for whole-file:
 * both `POST /whatif/saved` and the publish route rewrite an entry, and a measure
 * leaking into either would be a cached figure the copy promises does not exist.
 */
const whatifWriters = codeOnly(server)
  .split('whatifSaved.set(')
  .slice(1)
  .map((s) => s.slice(0, s.indexOf('\n  })') + 1 || 400))
expect(
  'the saved library stores the admitted loads and never the figures',
  whatifWriters.length >= 2 &&
    whatifWriters.every((w) => !/measures|value_text|inherited_text|baseline_text/.test(w)) &&
    /cases: nextCases/.test(server) &&
    /nextCases\.push\(\{ name: [^,]+, generator_id: generator\.id \}\)/.test(server),
  `${whatifWriters.length} writers, none carrying a computed measure`,
)
expect(
  'and a saved entry is the whole scenario — its frame as well as its cases',
  /watch: watchKeys/.test(server) && /pool: poolKey/.test(server),
  'a case re-opened without its frame is a load with no question attached',
)
expect(
  'and the store keeps a column as its load, not its numbers',
  /export interface ScenarioColumn \{/.test(read('src/store/whatifStore.ts')) &&
    /generatorId: string/.test(read('src/store/whatifStore.ts')),
  'figures live in `computed`, derived on every swap',
)

/*
 * Publishing a scenario. Both pools are the app's own — the tenant's users and the
 * graphs that are actually published — and a client-side copy of either is the mistake
 * the consent screen made when its scope list described one permission out of two.
 * Asserted on both halves: served by the server, and *not* written into the dialog.
 */
const publishSrc = read('src/components/PublishScenarioDialog.tsx')
expect(
  'the publish dialog renders the served reader directory rather than a copy',
  /const whatifReaders = \(\) =>/.test(server) &&
    /readers: whatifReaders\(\)/.test(server) &&
    /settings\.users\.map/.test(server.slice(server.indexOf('const whatifReaders'))) &&
    /frame\.readers\.map/.test(publishSrc) &&
    !/@vriodigital\.com|@vls\.com/.test(codeOnly(publishSrc)),
  'settings.json is the one answer to "who exists"',
)
expect(
  'and binds only to a graph that is currently published',
  /graphs: reportGraphs\(\)/.test(server) &&
    /no published graph "\$\{graph_use_case_id\}"/.test(server) &&
    /frame\.graphs\.map/.test(publishSrc),
  'a scenario bound to a draft would promise figures nobody published',
)
/* A reader outside the directory would be an invented user, so the route refuses it
   naming who is in it — the same refusal the login makes for an unknown address. */
expect(
  'a reader outside the directory is refused naming the directory',
  /is not in the directory — Settings knows/.test(server),
  'inventing a reader is inventing a user',
)
/* Gate 1 is who is *told*, and the role is client-held. CLAUDE.md requires any UI built
   on that to say so in those words; this is where the What-if lens says it. */
expect(
  'the publish dialog says sharing is not access control',
  whatif.publishing.readers.caveat.includes('not access control') &&
    /pub\.readers\.caveat/.test(publishSrc),
  'the role comes from the browser and the API serves every scenario without one',
)
/* Reader scope is declared, never applied — no roster here is filtered per persona, so
   a filtered count would claim a filter that never ran. */
expect(
  'and states each reader’s scope rather than filtering by it',
  /accessNote/.test(publishSrc) &&
    !/\.filter\(\(g\) => .*access|scopeFor|readerScope/.test(codeOnly(publishSrc)),
  'gate 2 is declared, not applied',
)
/* Every freshness sentence is the tenant's. A recurrence line assembled in the component
   would be this app writing copy in the tenant's voice. */
expect(
  'the recurrence line is the tenant’s sentence, interpolated',
  whatif.publishing.freshness.presets.every((p) => p.sentence.length > 0) &&
    /preset\?\.sentence/.test(publishSrc) &&
    /\.replace\('\{n\}'/.test(publishSrc),
  `${whatif.publishing.freshness.presets.length} presets, each stating its own sentence`,
)
/* `published_by` holds a fact about an *act* under a key that is a *thing*, which is how
   `studioPublishedBy` kept crediting the previous publisher. It is written every time. */
expect(
  'publishing records who, from the address the browser sent',
  /* `.email` explicitly: the seeded account is an object, and dropping the field
     produced `published_by should be a string, got object` at the validator — the one
     place it could still be caught. Every other "published by" path reads `.email`. */
  /published_by: as \?\? db\.google_account\.email/.test(server) &&
    /is not an email — send the signed-in address as \?as=/.test(server) &&
    /as: signedInAs/.test(read('src/pages/WhatIfPage.tsx')),
  'the identity is client-held, so the route has to be told',
)
/* The publish dialog's body is extracted for the reason ConnectSourceWizard is: antd's
   Modal portals, and renderToString does not traverse a portal — so a claim about what
   this dialog contains would pass over nothing. */
expect(
  'the publish panel is extracted from its Modal, so it can be asserted on',
  /export function PublishScenarioPanel\(/.test(publishSrc) &&
    publishSrc.indexOf('export function PublishScenarioPanel(') <
      publishSrc.indexOf('<Modal'),
  'the Modal/Drawer rule, applied to the newest dialog',
)
/*
 * The pool filters exist twice — as data on the server, and as a switch in the store so
 * the dropdown can list membership rather than only count it. The two must agree, or a
 * pool offers loads the frame excluded.
 */
const storeSrc = read('src/store/whatifStore.ts')
expect(
  'the client has a membership rule for every pool the package ships',
  whatif.candidate_pools
    .filter((p) => p.filter !== null)
    .every((p) => new RegExp(`case '${p.key}':`).test(storeSrc)),
  whatif.candidate_pools.map((p) => p.key).join(', '),
)
/* The breach rule is real but unreachable against this roster — the appetite is 10 and
   the largest single load carries 4. Asserted so nobody "fixes" the styling by inventing
   a breach, and so a data change that *does* make it reachable is noticed. */
const enfMeasure = whatif.watched_measures.find((m) => m.key === 'enf')
/*
 * **The breach arithmetic needs a roster and the measure it is about; without both, the claim
 * becomes that CLAUDE.md does not make it.**
 *
 * This computed the largest single load against the appetite line and compared the verdict to a
 * sentence in CLAUDE.md. Both halves are EPA's: `enf` is its measure and the loads are its roster,
 * and a tenant with no candidate roster has no "largest single load" to compute — reading
 * `enfMeasure.field` off `undefined` crashed the run before any summary printed. So where the data
 * cannot answer the question, the guard is that the prose does not answer it either, which is the
 * failure actually worth catching: a paragraph describing a breach rule against a roster that is
 * not there.
 */
if (enfMeasure && whatif.generators.length > 0) {
  /* Read off the measure rather than hardcoded here, so this stays a claim about the
     breach rule the data declares and not about the word "enf". */
  const maxLoad = Math.max(...whatif.generators.map((g) => g[enfMeasure.field]))
  const enfBaseline = whatif.facility.baseline[enfMeasure.baseline_field]
  const enfAppetite = whatif.facility.appetite[enfMeasure.appetite_field]
  expect(
    'CLAUDE.md states whether one load can breach the appetite line',
    maxLoad + enfBaseline < enfAppetite ===
      claude.includes('The breach rule is real but currently unreachable'),
    `max load ${maxLoad} + baseline ${enfBaseline} vs appetite ${enfAppetite}`,
  )
} else {
  expect(
    'CLAUDE.md claims no breach arithmetic this dataset cannot support',
    !claude.includes('The breach rule is real but currently unreachable'),
    'no candidate roster and no enforcement measure — there is no largest single load to compute',
  )
}
expect(
  'and headroom is the package formula, computed once on the server',
  whatifPkg !== null &&
    whatifPkg.runtime.headroom.formula.includes('floor((appetite.enf - baseline.enf)') &&
    /Math\.floor\(\(appetite - pkg\.facility\.baseline/.test(read('scripts/ingest-whatif.mjs')) &&
    !/Math\.floor/.test(read('src/pages/WhatIfPage.tsx')),
  'a break point computed in the page would be arithmetic on a measure',
)
/*
 * The connection gate replaces the lens rather than sitting under it.
 *
 * The page printed its header chrome above `NoSourceConnected`: the banner naming 36
 * inbound generators and the provenance note naming the package the figures came from,
 * both above the sentence "No data source is connected". Nothing errored — a claim about
 * data that is not there reads as data.
 *
 * Guarded structurally: the whole lens lives in one component rendered only on the
 * connected branch, so the gate has no source-derived copy to leak. Asserted both ways —
 * absent from the gate, present in the lens — because deleting the strings would
 * otherwise satisfy half of it.
 */
const whatIfSrc = read('src/pages/WhatIfPage.tsx')
const gateAt = whatIfSrc.indexOf('export default function WhatIfPage(')
const lensAt = whatIfSrc.indexOf('\nfunction ', gateAt)
const gatedCopy = ['copy.banner', 'copy.overlayPill', 'copy.dataNote']
expect(
  'the What-if gate replaces the lens rather than rendering beside it',
  gateAt !== -1 &&
    lensAt > gateAt &&
    /* Whichever empty state the gate renders — it was the source one, it is now the
       publish one — the fact guarded here is that the gate *replaces* the lens. */
    /No(Source Connected|PublishedGraph|SourceConnected)/.test(whatIfSrc.slice(gateAt, lensAt)) &&
    gatedCopy.every(
      (k) => !whatIfSrc.slice(gateAt, lensAt).includes(k) && whatIfSrc.slice(lensAt).includes(k),
    ),
  `${gatedCopy.join(', ')} render only inside the lens`,
)

/*
 * ---------------- the two JSON databases are read diagnostically ----------------
 *
 * `JSON.parse` on a broken file reports a byte offset and nothing else — not the file, not the
 * line, not the fix — and it runs *before* `validateDb`, so the careful refusal that names the
 * missing key never gets a chance. A deployed box crash-looped on
 * `Expected double-quoted property name in JSON at position 2464` while the real problem was
 * `<<<<<<< Updated upstream` sitting at line 113 of `db.json`.
 *
 * `db.json` is generated *and* committed, so that conflict is a recurring event rather than a
 * one-off: the marker case is checked by name, before parsing.
 */
expect(
  'both JSON databases are read through the diagnostic loader, not JSON.parse',
  /function readJsonDb\(/.test(server) &&
    /* One document per dataset, and it is the only kind there is — `settings` and `reports_prototype`
       are keys inside it rather than files beside it. The fact this guards is unchanged: nothing
       reaches `JSON.parse` directly, so a byte offset never stands in for a conflict marker. */
    /readJsonDb\(\s*\n\s*DB_PATHS\[name\],/.test(server) &&
    /const loadedDocs = await Promise\.all\(/.test(server) &&
    /* The raw parse must not come back, and neither may the paths that were deleted with the files. */
    !/JSON\.parse\(readFileSync\(DB_PATH/.test(codeOnly(server)) &&
    !/SETTINGS_PATH|PROTOTYPE_PATH/.test(codeOnly(server)),
  'a byte offset names nothing a person can act on',
)
/*
 * ---------------- the writes are async, and serialized ----------------
 *
 * `db.json` is 450 KB and was stringified and written with `writeFileSync` on every commit, with
 * every other request waiting behind it. Asynchronous writing gives that back — and takes away the
 * one thing the synchronous version had for free: with an `await` in the middle, two commits can be
 * in flight at once and they share a temp path, so the file that lands is neither document.
 *
 * Three things have to hold together, so all three are asserted: the writes are async, they are
 * chained per path, and the in-memory swap happens *before* the first await — which is what stops a
 * second handler reading a stale document and silently dropping the first edit.
 */
expect(
  'the JSON databases are written asynchronously, one write at a time per file',
  /from 'node:fs\/promises'/.test(store) &&
    /function writeJsonAtomic\(/.test(server) &&
    /const previous = writeChains\.get\(ref\)/.test(server) &&
    /* The synchronous writers must not come back, in either file. */
    !/writeFileSync|renameSync/.test(codeOnly(server)) &&
    !/writeFileSync|renameSync/.test(codeOnly(store)),
  'a 450 KB synchronous write blocked every other request',
)
expect(
  'and the in-memory swap happens before the write yields, not after',
  /async function commitDb\(/.test(server) &&
    /async function commitSettings\(/.test(server) &&
    /* Swap, then await — the order is the guarantee. The target is the selected dataset's own
       document (`docs[selected]`) rather than a single `db`, which is what made room for CAPEX; the
       ordering it has to keep is identical. */
    server.indexOf('Object.assign(target, next)') < server.indexOf('await writeJsonAtomic(DB_PATHS[selected]') &&
    /* And a failed write puts memory back, so the two cannot diverge. */
    /Object\.assign\(target, previous\)/.test(server) &&
    /* `commitSettings` no longer implements any of this. It validates for the sake of its own message
       — which names `npm run seed:settings` rather than "restart the server" — and hands the whole
       document to `commitDb`, where the ordering lives. One implementation of the guarantee is the
       point: the copy it used to keep was a second thing that could get the order wrong. */
    /await commitDb\(\{ \.\.\.db, settings: next \}\)/.test(server) &&
    !/settings = previous|writeJsonAtomic\(SETTINGS_PATH/.test(codeOnly(server)),
  'swapping after the write would let two edits each read the pre-edit document',
)
/* Every writer is awaited, or a rejected write becomes an unhandled rejection and a 200. */
expect(
  'every commit call site awaits',
  !/(^|[^a-zA-Z.])commit(Db|Settings)\(/m.test(
    codeOnly(server).replace(/await commit(Db|Settings)\(/g, '').replace(/async function commit(Db|Settings)\(/g, ''),
  ),
  `${(server.match(/await commit(Db|Settings)\(/g) ?? []).length} awaited call sites`,
)
/*
 * ---------------- nothing is served before the data is in ----------------
 *
 * This used to be spelled `readFileSync`, and the claim was keyed to that call. The guarantee was
 * never the *synchrony* though — it was the ordering: no request may be answered before both
 * documents are loaded. An object in S3 has no synchronous read, so the spelling had to change and
 * the guarantee did not. It is kept by top-level `await` in an ES module, where source order is
 * execution order: both reads are awaited above `server.listen`, so `listen` cannot run first.
 *
 * Asserted as ordering rather than as a call, which is the rule this file keeps everywhere —
 * a claim keyed to a spelling fails on a rename while the fact it guards is still true.
 */
expect(
  'both documents are read, awaited together, before the server listens',
  /* One `db.json` per dataset, and that is now every document there is — the tenant's settings and the
     report prototype's sample data are keys inside it. Still one `Promise.all`, still awaited above
     `listen`. **The guarantee was never the count of documents**: it is that none of them is served
     before all of them are in, which is why the parallel read is kept for a list of one. */
  /const loadedDocs = await Promise\.all\(/.test(server) &&
    /DATASETS\.map\(\(name\) =>/.test(server) &&
    /* Both former documents are read off the selected one at call time, never captured at boot. */
    /return db\.settings\.users/.test(server) &&
    /const prototypeData = \(\) => db\.reports_prototype/.test(server) &&
    server.indexOf('await Promise.all(') < server.indexOf('server.listen(') &&
    /* Top-level await is what makes source order execution order — inside a function it would not. */
    !/async function main\(|\.then\(\(\) => server\.listen/.test(codeOnly(server)),
  'nothing may be served before db.json is loaded',
)
/*
 * ---------------- the store is the local file, and the bucket's address is committed ----------------
 *
 * **The default has been both ways round, and the reason changed under it.** It was the local file;
 * it became S3 once the documents were pushed and the local copies deleted, because then there was
 * no file to fall back to and a silent fallback would have served an *empty* app rather than saying
 * why. Committing the JSON documents on 2026-08-19 retired that premise — every checkout now has a
 * complete, valid `db.json` — so it is the local file again, and a fresh clone starts with no AWS
 * credentials at all.
 *
 * **What the flip costs is a different hazard, not none.** The fallback is no longer empty, so a box
 * that meant to read the bucket and left `S3_BUCKET` unset serves plausible but possibly stale
 * figures. Two things are asserted against that: the deployed process names the bucket explicitly in
 * `ecosystem.config.js` rather than relying on any default, and the boot banner prints the ref it
 * actually read every time.
 *
 * **And the sync tool must never follow this default.** `npm run db:push` exists to move bytes to the
 * bucket; resolved through `docRef` it would now get a path and copy the file onto itself, reporting
 * success while uploading nothing. It calls `s3Ref` instead, which always names an object.
 *
 * **The bucket, the prefix and the region are committed; the credentials are not.** An address
 * appears in every log line and in `GET /db`'s reply, so hardcoding it costs nothing. An access key
 * in a tracked file is scraped off GitHub within minutes, so the claim asserts both halves: the
 * addresses are present, and nothing shaped like a key is.
 */
expect(
  'the bucket and prefix are committed, and switchable, and no credential is',
  /const DEFAULT_BUCKET = 'contextweave\.com'/.test(store) &&
    /* Asserted to *agree with* `PRIMARY` rather than to be a particular word — see the note on
       `primaryDataset` above for what a disagreement does. */
    primaryDataset.length > 0 &&
    new RegExp(`const DEFAULT_PREFIX = '${primaryDataset}'`).test(store) &&
    /* Unset is the local file: no `?? DEFAULT_BUCKET` on the server's own resolver, or a clone with
       no credentials cannot start. `off` stays as the *explicit* way to say the same thing. */
    /const bucket = process\.env\.S3_BUCKET$/m.test(store) &&
    !/process\.env\.S3_BUCKET \?\? DEFAULT_BUCKET/.test(store) &&
    /bucket === 'off'/.test(store) &&
    /* The sync tool names an object directly, so a push cannot resolve to a local path. */
    /export function s3Ref\(name, prefix\)/.test(store) &&
    /const ref = s3Ref\(name, forDataset\)/.test(read('scripts/s3-sync.mjs')) &&
    !/docRef/.test(codeOnly(read('scripts/s3-sync.mjs'))) &&
    /* The deployed process asks for the bucket rather than inheriting a default.
       **`codeOnly`, and it was needed**: the line above it was commented out for a long time, so a
       plain search matched `// S3_BUCKET: "contextweave.com"` and the claim passed against a
       deployment that would have read the local file. Sixth time this file has been caught by a
       comment naming the thing it is not doing. */
    /^\s*S3_BUCKET: "contextweave\.com",/m.test(codeOnly(read('ecosystem.config.js'))) &&
    /* And every boot says which store it read, since the wrong one is now plausible rather than empty. */
    /set S3_BUCKET to read the bucket instead/.test(server) &&
    /* The prefix is still environment-defaulted, but it is now an *argument*, because a prefix is a
       dataset and a dataset cannot be a property of the process — see mock-server/datasets.mjs. */
    /export function docRef\(name, localPath, prefix\)/.test(store) &&
    /prefix \?\? process\.env\.S3_PREFIX \?\? DEFAULT_PREFIX/.test(store) &&
    /* One `docRef` call, because a dataset has one document. */
    /docRef\('db\.json', join\(here, 'db\.json'\), name\)/.test(server),
  'an address can be committed; a key cannot',
)
/*
 * The one that would actually cost something. A long-term key is `AKIA…` + 16 more characters, and
 * a secret is 40 of base64 — both are greppable, and both are permanent once pushed. Checked across
 * every file the repo tracks that could plausibly carry one, not just the store.
 */
for (const path of [
  'mock-server/store.mjs',
  'mock-server/server.mjs',
  'scripts/s3-sync.mjs',
  'ecosystem.config.js',
  'package.json',
]) {
  const src = read(path)
  expect(
    `${path} carries no AWS credential`,
    !/AKIA[0-9A-Z]{16}/.test(src) &&
      !/aws_secret_access_key\s*[=:]\s*['"][A-Za-z0-9/+=]{40}/i.test(src),
    'a key in a tracked file is public the moment it is pushed',
  )
}
/* And the file that does hold them must stay ignored. */
expect(
  'the credential file is gitignored',
  /\*\.local/.test(read('.gitignore')),
  'mock-server/.env.local holds the access key and secret',
)
/*
 * ---------------- one process, every dataset, one selected per request ----------------
 *
 * A prefix is a dataset, and the prefix used to be read once at module load — so a second dataset
 * meant a second server and `both` was not expressible at all. Every dataset is loaded at boot now
 * and the selection arrives per request, in an `AsyncLocalStorage` scope entered by the dispatcher.
 *
 * The claims below guard the things that fail *by answering* rather than by throwing: a request that
 * names nothing getting somebody else's data, a write under the merged view vanishing, a key dropping
 * silently out of the merge, and one dataset's in-memory state showing under another's name.
 */
const datasets = read('mock-server/datasets.mjs')
const dsPanel = read('src/components/DatasetPanel.tsx')
const dsSwitch = read('src/data/datasetSwitch.ts')

/*
 * ---------------- the authoring flow speaks the tenant's vocabulary ----------------
 *
 * **The flow was one tenant's, field by field.** Its register row was EPA's generator, its measures
 * were `penalty|tons|viols|enf|evals|manifests`, its tiles were four closures over those fields, its
 * table defaulted to `generator/state/risk/cd` and its bars were tinted by `p.risk`. Pointed at
 * Northline it kept composing "Penalty exposure by generator" over rows that have neither — reported
 * from use, and visible in the report step as EPA's register under a CAPEX graph name.
 *
 * What a renderer needs to know about the register is **declared by the dataset** now: which field
 * names a row, how each one is written, which are plottable, and what the summary tiles are. None of
 * it is derivable — `kind: 'num'` cannot tell money from a percentage — so it is served, and the
 * prototype's own dataset carries it.
 */
const protoData = read('src/reports/data.ts')
const protoFormat = read('src/reports/lib/format.ts')
const protoBlocks = read('src/reports/lib/blocks.ts')
const chartBlock = read('src/reports/components/blocks/ChartBlock.tsx')
const tableBlock = read('src/reports/components/blocks/TableBlock.tsx')
const proto = db.reports_prototype ?? {}

expect(
  'the authoring register, its label field and its measures are the served dataset’s',
  /LABEL_FIELD = DATA\.label_field/.test(protoData) &&
    /GENERATORS = DATA\.register \?\? DATA\.generators/.test(protoData) &&
    /MEASURE_KEYS =/.test(protoData) &&
    Array.isArray(proto.register) &&
    proto.register.length > 0 &&
    typeof proto.label_field === 'string',
  proto.label_field
    ? `${proto.register.length} rows, named by "${proto.label_field}", ${(proto.measures ?? []).length} measures`
    : 'the dataset declares no register',
)
expect(
  'and no EPA field name decides how a value is written or a row is drawn',
  /*
   * **Keyed on field *access*, not on any quoted string.** `tons` is still a word in `format.ts` — as
   * the name of a `ValueFormat`, which is a tenant-neutral way to write a number and exactly what the
   * dataset is meant to declare. What must be gone is a renderer *reading a field by name*: `p.risk`,
   * `p.generator`, `key === 'penalty'`. The first version searched for the strings and failed on the
   * format name, which is this file's own "assert the fact, not the spelling" trap.
   */
  !/key === '(penalty|tons|viols|enf|cd|risk|last_enf)'/.test(codeOnly(protoFormat)) &&
    !/\bp\.(risk|generator|cd|penalty|tons|viols)\b/.test(codeOnly(protoFormat)) &&
    !/\bp\.(risk|generator|cd|penalty|tons)\b|riskTone|riskPill/.test(codeOnly(chartBlock)) &&
    !/col === 'generator'|\bp\.(risk|generator|cd|penalty|tons|evals|last_enf)\b/.test(
      codeOnly(tableBlock),
    ),
  'a renderer that reads a field by name is a renderer that serves one tenant',
)
expect(
  'the summary tiles are data rather than closures over one tenant’s fields',
  /export function kpiDef\(spec: KpiSpec\)/.test(protoBlocks) &&
    !/KPI_DEFS/.test(codeOnly(protoBlocks)) &&
    Array.isArray(proto.kpis) &&
    proto.kpis.length > 0 &&
    proto.kpis.every((k) => k.key && k.label && k.agg),
  `${(proto.kpis ?? []).length} tiles, each an { agg, field, format } the dataset states`,
)
/*
 * And a tone is only drawn where the tenant nominates a field to carry one. A bar tinted by a state
 * the data does not hold is the same mistake as a facet chip stuck at zero — a claim made in colour.
 */
expect(
  'a row is tinted only where the dataset nominates a state field',
  /export function rowTone/.test(protoFormat) &&
    /if \(!TONE_FIELD\) return null/.test(protoFormat),
  'one colour is honest where the register carries no state; a hue is not',
)

/*
 * ---------------- authorize: moving a report between lifecycle states ----------------
 *
 * **The act exists and nothing currently calls it**, which is a state this repo already keeps
 * deliberately — see `/change-signals`. `governance.statuses` is a real pool: the Library's chips
 * count it and every card tints itself from its tone. `PATCH /reports/governance/:id/status` moves a
 * report between those states, validated against that pool and attributed to `?as=`. The tab that
 * drove it was removed on request; the endpoint, its fetcher and the two fields it writes stay,
 * because deleting a working API to "finish" a UI removal is how the next caller finds a half-built
 * one. The claims below hold it to the same rules it was written under.
 */
const authServer = server
expect(
  'a report can be moved between the states its tenant declares, and the pool is the authority',
  /match: \(p\) => \/\^\\\/reports\\\/governance\\\/\[\^\/\]\+\\\/status\$\//.test(authServer) &&
    /is not a lifecycle state — this tenant declares/.test(authServer) &&
    /export async function setReportStatus/.test(client),
  'an unknown state has no label and matches no chip, so it is refused rather than stored',
)
/*
 * Who did it is **told**, never guessed — the rule the consent callback established, and written on
 * every change rather than only when absent: an anonymous re-authorization that kept the previous
 * name is the `studioPublishedBy` failure recorded in this repo.
 */
expect(
  'the change records who made it, and refuses a malformed address',
  /authorized_by: who,/.test(authServer) &&
    /is not an email address — pass \?as=/.test(authServer) &&
    /authorizedBy: r\.authorized_by \?\? null,/.test(client),
  'a state change nobody is attached to is worse than none',
)
/*
 * And the computed chip is not a destination. `All current` filters the Library and is not somewhere
 * a report goes; the menu excludes it by the **served flag** rather than by testing for its key, so
 * neither reader of the list keeps a second copy of the vocabulary.
 */
/*
 * **There is no Authorize surface, and the layers under it are deliberately still here.**
 *
 * A tab listed the governed definitions and moved each between states; it was removed on request,
 * along with the button that briefly sat on each card before it. What stays is everything below:
 * `PATCH /reports/governance/:id/status`, `setReportStatus`, `authorize` on `GovernanceActions` and
 * `authorized_by` / `authorized_at` on every row — the same waiting-for-a-caller state
 * `/change-signals` is in, and for the same reason: half a removal is the shape that fails silently,
 * and so is deleting a working API because nothing currently calls it.
 *
 * The `computed` flag stays too. It is a fact about the payload — `All current` is counted, not
 * declared — and the endpoint refuses it whether or not a menu ever offers it.
 */
expect(
  'no surface offers a state change, and the act underneath it is intact',
  !existsSync(join(root, 'src/reports/panes/AuthorizePane.tsx')) &&
    !/Authorize/.test(codeOnly(read('src/reports/panes/GovernedCard.tsx'))) &&
    !/'authorize'/.test(codeOnly(read('src/reports/types.ts'))) &&
    /* Still there, still refusing the computed chip. */
    /computed: true,/.test(authServer) &&
    /is not a lifecycle state — this tenant declares/.test(authServer) &&
    /export async function setReportStatus/.test(client) &&
    /computed: bool,/.test(client),
  'a removed tab is not a reason to delete the endpoint it called',
)

/*
 * ---------------- the rendered reports: one page, three entry points ----------------
 *
 * The package ships `R1_variance_report.html`, `R2_project_360.html` and
 * `R3_rate_case_filing_calendar.html` — 2.4 MB each and, normalise the one `REPORT_ID` line, byte
 * identical. They are one prototype three times, each copy pinned to a different report. The ingest
 * writes **one** page whose id comes from the query string, and refuses if the three ever differ
 * anywhere else, because then one file could not stand for all of them.
 */
const capexIngest = read('scripts/ingest-capex-reports.mjs')
const renderedRows = (db.reports.reports ?? []).filter((r) => r.rendered_href)
expect(
  'each report names its own rendered page, and they all point at one file',
  renderedRows.length > 0 &&
    renderedRows.every((r) => r.rendered_href === `/report/capex-report.html?report=${r.report_id}`),
  renderedRows.length > 0
    ? `${renderedRows.length} reports, one page`
    : 'no report carries a rendered page',
)
expect(
  'and the ingest refuses to ship one page if the sources differ anywhere but the id',
  /differ somewhere other than REPORT_ID/.test(capexIngest) &&
    /new URLSearchParams\(location\.search\)\.get\("report"\)/.test(capexIngest),
  'one file standing for three is a claim, so it is checked rather than assumed',
)
/*
 * **The key must be present even when its value is null.** Every writer hands `commitDb` the whole
 * document, so a process that started before the ingest added this field writes its stale rows back
 * and the Library loses Open on every card — which happened once, during this feature's own
 * verification, and nothing noticed because an unvalidated key has nothing to fail against.
 */
expect(
  'a report row without the rendered_href key is refused as a stale write',
  /'rendered_href' in r,/.test(server),
  'null is a real answer here; only absence means a process older than the field',
)
/*
 * **The href is served, and Open does not use it.**
 *
 * It briefly did: Open loaded the package's rendered HTML in a new tab. That page is the tenant's,
 * but it is a *whole separate console* — its own sidebar, wordmark and persona — so opening it left
 * the app instead of showing the report in it, and nothing there can be edited or governed. Open
 * renders `PublishedReport` in this tab, which is what makes Edit, Share and the lifecycle state
 * mean anything.
 *
 * The href stays on the row and the page stays written, because it is the reference for what these
 * blocks are meant to look like — but it is served rather than assembled in a component, for the
 * reason every pool here is: a path built in the client can name a file this deployment lacks.
 */
expect(
  'the rendered page is served on the row, and Open renders in this tab rather than leaving',
  /rendered_href: report\.rendered_href \?\? null,/.test(server) &&
    /renderedHref: r\.rendered_href \?\? null,/.test(client) &&
    /onOpenPublished=\{\(reportId\) => void openReport\(reportId\)\}/.test(
      read('src/pages/ReportsPage.tsx'),
    ) &&
    !/window\.open\(/.test(codeOnly(read('src/pages/ReportsPage.tsx'))),
  'a report opened outside the app cannot be edited or governed inside it',
)

/*
 * ---------------- opening a governed report, and whose sample the chips are ----------------
 *
 * **Open and Edit are two acts and were gated as one.** `GovernedCard` tested
 * `starterForTag(reportTag, reportId)` for both, which held while the governed definitions and the
 * prototype's starters were the same reports out of the same file. They are not for every tenant:
 * Northline's rows are tagged `variance-report` and its starters are the prototype's own EPA sample,
 * so nothing matched and **every card lost both buttons** — a Library with three reports in it and no
 * way to open one, which is what was reported.
 *
 * Open hands an id to the host, which renders the published report from the tenant's figures; it
 * never reads a starter. Edit loads the authoring definition, which *is* a starter. So Open is
 * offered wherever the host can render, and Edit only where a definition exists.
 */
const openCardSrc = read('src/reports/panes/GovernedCard.tsx')
expect(
  'Open report does not require an authoring starter, and Edit does',
  /const editable = !!starterForTag/.test(openCardSrc) &&
    /\{onOpen && \(/.test(openCardSrc) &&
    /\{onEdit && editable && \(/.test(openCardSrc) &&
    !/onOpen && openable/.test(openCardSrc),
  'Open renders through the host; only Edit needs a definition to load',
)
/*
 * And the Library tab's badge counts the list rather than the shelf. Hosted, the session shelf is
 * deliberately empty, so counting it read **Library 0** above three real cards.
 */
const openAppSrc = read('src/reports/App.tsx')
expect(
  'the Library badge counts the governed rows as well as the session shelf',
  /count: library\.length \+ \(governance\?\.reports\.length \?\? 0\)/.test(openAppSrc),
  'a badge that counts one half of a merged list is a number about something else',
)
/*
 * **The prototype's standard-report chips are its own sample, and a host has its own tenant.**
 *
 * `STARTERS` is the bundled EPA dataset — five compliance reports that do not exist in another
 * tenant's console, one click from composing a draft about inbound generators in a capital programme.
 * Hidden when hosted, kept standing alone, which is exactly the rule already applied to the
 * prototype's four fictional library rows. The Ask copy follows the same principle: it names
 * `META.entity_plural`, and the ingest points the prototype's `meta` at the tenant's own.
 */
const openAskSrc = read('src/reports/panes/AskPane.tsx')
expect(
  'the prototype offers its own starters only when it is standing alone',
  /\{!hosted && \(/.test(openAskSrc) &&
    /hosted=\{!!governance\}/.test(openAppSrc),
  'five reports that do not exist here is worse than no shortcut at all',
)
expect(
  'and the Ask copy names the tenant’s own entity rather than the sample’s',
  /your \{META\.entity_plural\}/.test(openAskSrc) &&
    /META\.entity_plural\} need attention first/.test(openAskSrc) &&
    !/inbound generators/.test(codeOnly(openAskSrc)) &&
    !/waste codes/.test(codeOnly(openAskSrc)) &&
    /reports_prototype\.meta: taken from the tenant/.test(read('scripts/ingest-capex-reports.mjs')),
  'the prototype prints this noun in its own sentence, so it has to be the tenant’s',
)

/*
 * ---------------- the CAPEX reports: one renderer per kind the resolver emits ----------------
 *
 * **The failure this guards is a block that renders as nothing.** Northline's reports arrive already
 * resolved — seventeen block kinds, each carrying its own figures, coordinates and refusal text — and
 * a kind the payload has and `CapexBlocks.tsx` does not is a report that is quietly one section
 * short. On screen that is indistinguishable from a report with that much to say, which is why the
 * renderer names an unknown kind rather than skipping it, and why the two lists are compared here.
 *
 * Checked in three places because they can drift apart in three directions: the document holds the
 * kinds, `client.ts` decides which ones validate, and `CapexBlocks.tsx` decides which ones draw.
 */
const capexBlocks = read('src/components/report/CapexBlocks.tsx')
const rendererKinds = new Set(
  [...(/const RENDERERS: Record<string, [\s\S]*?\n\}/.exec(capexBlocks)?.[0] ?? '').matchAll(
    /^\s{2}(\w+):/gm,
  )].map((m) => m[1]),
)
const schemaKinds = new Set(
  [...(/const RESOLVED_BLOCK_TYPES = \[([\s\S]*?)\r?\n\] as const/.exec(client)?.[1] ?? '').matchAll(
    /'([\w]+)'/g,
  )].map((m) => m[1]),
)
const documentKinds = new Set(
  (db.reports.reports ?? []).flatMap((r) => (r.blocks ?? []).map((b) => b.type)),
)

expect(
  'every block kind the document holds has a renderer',
  rendererKinds.size > 0 &&
    documentKinds.size > 0 &&
    [...documentKinds].every((k) => rendererKinds.has(k)),
  [...documentKinds].filter((k) => !rendererKinds.has(k)).length > 0
    ? `no renderer for: ${[...documentKinds].filter((k) => !rendererKinds.has(k)).join(', ')}`
    : `${documentKinds.size} kinds in the document, ${rendererKinds.size} renderers`,
)
expect(
  'and the validator admits exactly the kinds the renderers draw',
  schemaKinds.size > 0 &&
    schemaKinds.size === rendererKinds.size &&
    [...schemaKinds].every((k) => rendererKinds.has(k)),
  `schema ${schemaKinds.size} · renderers ${rendererKinds.size}` +
    ([...schemaKinds].filter((k) => !rendererKinds.has(k)).join(', ') ||
      [...rendererKinds].filter((k) => !schemaKinds.has(k)).join(', ')
      ? ` — differ on ${[...new Set([...schemaKinds, ...rendererKinds])]
          .filter((k) => !schemaKinds.has(k) || !rendererKinds.has(k))
          .join(', ')}`
      : ''),
)
expect(
  'an unknown kind is named on the page rather than dropped',
  /This report contains a/.test(capexBlocks) && /no renderer for/.test(capexBlocks),
  'a skipped block is a report one section short, and nothing on screen says so',
)
/*
 * **The resolved reports are served as written and never recomputed.** They are the tenant resolver's
 * output; the register they are asked of carries a project's region and phase, not its actuals, so a
 * "generated" variant of one would be weaker figures under the same heading. `reportBlock` passes
 * them through and the ingest lifts each report's tiles out of its own `figRow` rather than
 * transcribing them, so a tile and the block beneath it cannot come to disagree.
 */
expect(
  'a resolved block is passed through, and the tiles are lifted from the block rather than copied',
  /const RESOLVED_BLOCKS = new Set\(/.test(server) &&
    /if \(RESOLVED_BLOCKS\.has\(block\.type\)\) return block/.test(server) &&
    /figRow\.figures\.map/.test(read('scripts/ingest-capex-reports.mjs')),
  'the tile strip is the block, so there is one copy of each headline figure rather than two',
)

/*
 * **A figure the document does not hold must stay absent all the way to the screen, and a default is
 * how it stops being absent.**
 *
 * The CAPEX package records three things EPA's does not: no row count on 62 of its 64 catalogued
 * tables (it says why, per table, in `rows_basis`), no derivation on any profiled column, and no
 * per-element confidence anywhere — it scores its *lanes* instead. Each arrived as `null`, and each
 * broke in a different way that a schema alone would not have caught:
 *
 * - `rows: num` and `derivation: str` refused the payload at the boundary, so the Data Catalog
 *   rendered its error state. Visible, at least.
 * - `n.confidence.toFixed(2)` threw **inside the server**, so the whole canvas endpoint 500'd.
 * - and `confidenceOf`'s `?? 1` did not throw at all: it turned every unscored node into **1.00**,
 *   the maximum, and Ask reports that number as "the weakest entity on the route". Every walked
 *   answer would have claimed total certainty *because* nothing was scored.
 *
 * The last one is the reason this claim exists rather than just widening three schemas. A default
 * that fills an absent figure is indistinguishable from a real one on screen. So: the three fields
 * are nullable end to end, and nothing formats them without checking.
 */
const nullsCatalogPage = read('src/pages/CatalogPage.tsx')
const nullsColumnsPanel = read('src/components/ProfiledColumnsPanel.tsx')
const nullsFromCanvas = read('src/graph-viewer/fromCanvas.ts')
expect(
  'a figure the package does not record stays absent rather than defaulting',
  /rows: nullable\(num\)/.test(client) &&
    /derivation: nullable\(str\)/.test(client) &&
    /confidence: nullable\(num\)/.test(client) &&
    /* Every site that formats one checks first. */
    /t\.rows === null \? 'rows not counted'/.test(nullsCatalogPage) &&
    /t\.rows === null \? 'rows not counted'/.test(nullsColumnsPanel) &&
    /col\.derivation \?/.test(nullsColumnsPanel) &&
    /n\.confidence === null/.test(nullsFromCanvas),
  'rows, derivation and per-element confidence are nullable, and no site formats one unchecked',
)
expect(
  'and an unscored node contributes nothing to a route confidence rather than counting as certain',
  /* `?? 1` made an unscored node the most confident one there is. The route reports `null` when
     nothing on it was scored, which every reader of the field already handles. */
  !/confidence \?\? 1/.test(server) &&
    /* Keyed to the line that decides it, not to the comment beside it: replacing the `null` here
       with a number is exactly the regression, and a claim that survives that mutation is a
       comment. Break-tested by doing precisely that. */
    /const value = nodeOf\(nodeId\)\?\.confidence\r?\n\s*return typeof value === 'number' \? value : null/.test(
      server,
    ) &&
    /scored\.length === 0 \? null : Number\(Math\.min\(\.\.\.scored\)/.test(server) &&
    /records no per-element score/.test(server),
  'a node scored 1.00 because nobody scored it is the most confident possible lie',
)

/*
 * **The client's default selection must be the server's primary, and nothing degraded gracefully
 * when it was not.**
 *
 * `DEFAULT_DATASET` is what every request carries before anybody has chosen — including the very
 * first call, before a store has hydrated — and the server *refuses* a selector it does not
 * recognise rather than falling back, because serving one tenant's figures under another's name is
 * the failure this whole split exists to prevent. Those two rules are right individually and lethal
 * together if they disagree: retiring EPA while this constant still said `'EPA'` meant **every page
 * in a fresh browser** got `"EPA" is not a dataset`, surfaced as "the JSON server is not
 * responding" — which sends you to restart a server that is up and is the thing refusing.
 *
 * Nothing compared the two, so it was invisible until a page was opened. It is one claim now.
 */
const datasetClient = read('src/api/dataset.ts')
const clientDefault = /export const DEFAULT_DATASET = '([^']+)'/.exec(datasetClient)?.[1] ?? ''
expect(
  "the client's default dataset is the server's primary",
  primaryDataset.length > 0 && clientDefault === primaryDataset,
  clientDefault === primaryDataset
    ? `both are ${primaryDataset}`
    : `client sends "${clientDefault}", server's primary is "${primaryDataset}" — every first ` +
      'request would be refused',
)
/*
 * And a *stored* selection naming a retired dataset has to be recoverable. It is not a caller asking
 * for another tenant — it is a preference for one that no longer exists, and honouring it forever
 * locks that browser out of every page with no way back but developer tools.
 */
expect(
  'a stored selection the server rejects is dropped once, not retried forever',
  /export function forgetStaleDataset\(\): boolean/.test(datasetClient) &&
    /if \(current === DEFAULT_DATASET\) return false/.test(datasetClient) &&
    /is not a dataset/.test(client) &&
    /&& forgetStaleDataset\(\)\) \{/.test(client),
  'it returns false when there was nothing stale, so the retry cannot loop',
)

expect(
  'every dataset is loaded at boot and a request selects one',
  /* **One dataset today, and the machinery is still per dataset.** CAPEX's document was removed on
     request; a name in this list with no document behind it stops the boot, so removing the file
     meant removing the name. What is asserted is the shape, not the count — a boot that loads every
     dataset and a request that selects one is what makes a second dataset a two-line change. */
  /export const DATASETS = \[('[A-Z]+'(, )?)+\]/.test(datasets) &&
    /export const PRIMARY = '[A-Z]+'/.test(datasets) &&
    /* The primary must be one of the datasets actually loaded, or the boot reads a document
       nothing selects. */
    new RegExp(`export const DATASETS = \\[[^\\]]*'${primaryDataset}'`).test(datasets) &&
    /* The refs are built per dataset, so each reads its own prefix. */
    /DATASETS\.map\(\(name\) => \[name, docRef\('db\.json', join\(here, 'db\.json'\), name\)\]\)/.test(
      server,
    ) &&
    /* `db` resolves to the selected document, which is what left the ~280 `db.<key>` reads alone. */
    /const db = documentProxy\(currentDoc\)/.test(server) &&
    /* And the dispatcher is the one place a selection is entered. */
    /await withDataset\(dataset, \(\) => route\.handle\(/.test(server),
  'a prefix read at module load is a property of the process, so "both" cannot exist',
)

expect(
  'an unrecognised dataset is refused, never quietly served as the primary',
  /const match = SELECTORS\.find\(\(s\) => s\.toLowerCase\(\) === asked\.toLowerCase\(\)\)/.test(
    datasets,
  ) &&
    /return match \?\? null/.test(datasets) &&
    /is not a dataset — this tenant has/.test(server),
  'a typo in ?dataset= would serve EPA under CAPEX’s name, which reads as data',
)

/*
 * The merged view refuses **writes**, and where that refusal lives is the whole point.
 *
 * It began as a method check in the dispatcher — refuse every non-GET — which is wrong here because
 * **most reads in this API are POSTs**: `/auth/login` is a lookup, `/ask` is a query,
 * `/whatif/scenario` computes and stores nothing. The one that mattered was login: switching to `both`
 * signs the reader out, so a refused login made it a state they could never leave. The refusal is at
 * the two things that actually write now, so the verb decides nothing.
 */
expect(
  'the merged view refuses writes at the write, not by the verb',
  /* The document writer. */
  /cannot write while dataset=/.test(server) &&
    /* And every live container, which under `both` is a snapshot a write would be lost in. */
    /cannot change \$\{name\} while dataset=/.test(server) &&
    /const MAP_WRITERS = \['set', 'delete', 'clear'\]/.test(server) &&
    /return readOnly\(merged, name, MAP_WRITERS\)/.test(server) &&
    /return readOnly\(sorted, name, ARRAY_WRITERS\)/.test(server) &&
    /* The blanket method check must not come back — it is what broke signing in. */
    !/req\.method !== 'GET'/.test(codeOnly(server)) &&
    /* And the panel says so where the switch is, not as a surprise toast on another page. */
    /Connecting a source, profiling, building and publishing all need a single dataset selected/.test(
      dsPanel,
    ),
  'refusing by verb refuses the login, and `both` becomes a state a signed-out reader cannot leave',
)

/*
 * ---------------- a container proxy has to *be* what it stands for ----------------
 *
 * **Two proxy faults, both silent until a route tried to serialise one.**
 *
 * `containerProxy` passed the resolved descriptor straight through with a bare `{}` target. A proxy
 * may not report a property as non-configurable unless its own target really holds it that way —
 * and every array has a `length` that is `configurable: false`. So `JSON.stringify`, `Object.keys`
 * and `{ ...spread }` all threw *"trap reported non-configurability for property 'length'"*, while
 * `.length`, `.push` and `.filter` worked perfectly, because only the first three walk descriptors.
 * `GET /governance` sends its log directly, so that one endpoint 500'd — and on a page whose only
 * fetch that is, the result reads as the whole server being down.
 *
 * Fixing that exposed the second: `Array.isArray` and `JSON.stringify` read the *target*, not the
 * traps, so an array container behind a `{}` target serialised as `{"0":…,"1":…}` — which the client
 * validator refuses as `log should be an array, got object`, reading as a stale server.
 */
expect(
  'a live container proxies as the kind it is, and its descriptors satisfy the invariant',
  /export function containerProxy\(resolve, kind = 'map'\)/.test(datasets) &&
    /kind === 'array' \? \[\] : \{\}/.test(datasets) &&
    /\}, LIVE_SHAPE\[name\]\)/.test(server) &&
    /* The trap answers the invariant in both directions — see `descriptorFor`. */
    /function descriptorFor\(resolved, key, proxyTarget = \{\}\)/.test(datasets) &&
    /if \(own && !own\.configurable\) return descriptor/.test(datasets) &&
    /return \{ \.\.\.descriptor, configurable: true \}/.test(datasets) &&
    /* Both proxies answer it the same way — two traps disagreeing is how one stays broken. */
    (datasets.match(/descriptorFor\(resolve\(\), key/g) ?? []).length === 2,
  'a container that throws on JSON.stringify reads as the server being down',
)

expect(
  'every required key has a merge rule, and one without it stops the boot',
  /* The plan is checked against the shape, so a key added to one and forgotten in the other fails
     here rather than dropping out of the merged document at request time. */
  requiredKeys.every((key) => new RegExp(`\\r?\\n  ${key}:`).test(datasets)) &&
    requiredKeys.length > 20 &&
    /export function unplannedKeys\(/.test(datasets) &&
    /would silently drop/.test(server) &&
    /Add each one to MERGE_PLAN in mock-server\/datasets\.mjs/.test(server),
  'a key with no rule drops out of the merged document, which reads as an empty dataset',
)

expect(
  'the in-memory state is per dataset, and no container is shared',
  /* All twelve, named in one place rather than each declaring its own container. */
  [
    'registered',
    'profilingJobs',
    'graphBuildsByUseCase',
    'derivations',
    'studioVersions',
    'studioBuildCount',
    'studioDecisions',
    'studioPivotChoice',
    'studioLive',
    'studioPublishedBy',
    'whatifSaved',
    'governanceLog',
  ].every(
    (name) =>
      new RegExp(`  ${name}: '(map|array)',`).test(server) &&
      new RegExp(`const ${name} = liveContainer\\('${name}'\\)`).test(server),
  ) &&
    /* And none is a bare container any more, which is what sharing would look like. */
    !/const (registered|studioLive|whatifSaved|studioDecisions) = new Map\(\)/.test(
      codeOnly(server),
    ),
  'a registration keyed by source id shows under every dataset if the Map is shared',
)

expect(
  'an empty collection is allowed only in a secondary dataset',
  /const empty = activeDataset\(\) !== PRIMARY/.test(server) &&
    /* Passed to the shape checks, which is how the relaxation reaches them. */
    /!check\(candidate\[key\], empty\)/.test(server) &&
    /* The primary still may not lose its rows: the flag is false for it, so `empty ||` cannot fire. */
    /\(empty \|\| v\.length > 0\)/.test(server) &&
    /* The boot refusal names the seed rather than the primary's restore command. */
    /npm run seed:dataset --/.test(server),
  'seeding a secondary dataset with the primary’s rows shows EPA’s figures under CAPEX’s name',
)

/*
 * ---------------- a custom header is a CORS decision ----------------
 *
 * Only four request headers are CORS-safelisted, and `x-dataset` is not one of them — so it makes
 * every cross-origin request *preflighted*, and the browser blocks it unless the `OPTIONS` reply lists
 * the header in `access-control-allow-headers`. The deployed app calls this server directly on another
 * origin (see the environment table in CLAUDE.md), so adding the header to `request()` without adding
 * it to the allow-list broke **every** call in the browser with `TypeError: Failed to fetch`.
 *
 * It survived a full round of testing because `curl` does not enforce CORS: the server answered 200 to
 * everything while the app could not reach it at all. Asserted here as the two halves agreeing — the
 * name the client sends is the name the server allows, and both reply paths allow it.
 */
/* To end of line, not to the first comma: the value is a template literal that contains one,
   so `[^,]+` truncated it before `${DATASET_HEADER}` and the claim failed against fixed code. */
const corsBlocks = server.match(/'access-control-allow-headers': .*$/gm) ?? []
const clientHeader = /'(x-[a-z-]+)': currentDataset\(\)/.exec(client)?.[1] ?? ''
expect(
  'every custom request header the client sends is allowed by the preflight',
  clientHeader.length > 0 &&
    /* The server declares the name once; the client's literal has to be that same string. */
    new RegExp(`export const DATASET_HEADER = '${clientHeader}'`).test(datasets) &&
    /* Both reply paths — the JSON one and the event-stream one, which is also cross-origin. */
    corsBlocks.length === 2 &&
    corsBlocks.every((b) => b.includes('${DATASET_HEADER}')) &&
    /* And nothing is left allowing content-type alone, which is what blocked every request. */
    !corsBlocks.some((b) => /'content-type',$/.test(b)),
  'curl ignores CORS, so a missing allow-list header passes every server-side test and blocks the app',
)

expect(
  'the dataset pool is served, and the selection is sent from one place',
  /* Served, never a list in the component — the rule the consent scopes and the role picker follow. */
  /match: \(p\) => p === '\/datasets'/.test(server) &&
    /export async function listDatasets\(\)/.test(client) &&
    /const DATASETS_PAYLOAD = shape\(\{/.test(client) &&
    /* Two senders and no more: `request` for every endpoint, and the Ask stream's own fetch. */
    (client.match(/'x-dataset': currentDataset\(\)/g) ?? []).length === 2 &&
    /* And the panel renders what came back rather than a pair written into it. */
    !/CAPEX/.test(codeOnly(dsPanel).replace(/^[\s\S]*?export default/, '')),
  'a client-held pool can offer a dataset the API refuses',
)

/*
 * ---------------- changing the dataset ends the session ----------------
 *
 * It is not a view toggle. Every page reads the selected dataset and so does everything the session
 * built — a registered source, a profiling job, a studio decision, a publication — all held in the
 * mock server's memory under one dataset. So the switch is asked for in Settings, confirmed in words
 * that name both datasets, and carried out by signing the reader out and reloading the document.
 *
 * **The reload is the mechanism, and it is the only one that cannot half-work.** An `<Outlet>` key
 * remounted the components and left the module-level zustand stores holding the previous dataset's
 * rows — a guarantee in appearance only. Asserted as: the store performs all three acts, the panel
 * only ever *asks*, and no remount key came back.
 */
/*
 * Ordering is read off the **code**, not the file: the comment explaining why the selection is
 * persisted first names `logout()`, and matching the file put that mention 300 characters ahead of
 * the call — the claim failed against correct code. The same self-documenting-file trap this file
 * has been caught by five times, so `codeOnly` goes on every claim that reasons about position.
 */
const dsStore = read('src/store/datasetStore.ts')
const dsCode = codeOnly(dsStore)
expect(
  'changing the dataset signs the reader out and reloads, from one place',
  /* Persist first — the selection must survive the reload, and logging out does not touch its key. */
  dsCode.indexOf('setCurrentDataset(dataset)') < dsCode.indexOf('logout()') &&
    dsCode.indexOf('logout()') < dsCode.indexOf("window.location.assign('/login')") &&
    /* The panel opens the dialog; it never switches on the control's own change event. */
    /onChange=\{\(next\) => setPending\(next\)\}/.test(dsPanel) &&
    /if \(pending\) switchDataset\(pending\)/.test(dsPanel) &&
    /* And the retired key did not come back beside it. */
    !/epoch/.test(dsCode) &&
    !/<Outlet key=/.test(codeOnly(read('src/App.tsx'))),
  'a remount clears components, not module-level stores — the rows would survive the switch',
)

/*
 * The confirmation names both datasets, and it is copy rather than markup for the reason
 * `sourceActions` is: a `Modal` portals out of `renderToString`. Interpolated from the two names, so
 * the CAPEX dialog cannot come to ask about EPA — and it states the sign-out, which is the one
 * consequence a reader cannot undo by switching back.
 */
expect(
  'the switch confirmation names both datasets and states the sign-out',
  /export const datasetSwitchTitle = \(\{ from, to \}: DatasetSwitch\)/.test(dsSwitch) &&
    /\$\{from\} to \$\{to\}/.test(dsSwitch) &&
    /You will be signed out/.test(dsSwitch) &&
    /* Rendered from that module, never restated in the panel. */
    /datasetSwitchTitle\(switching\)/.test(dsPanel) &&
    /datasetSwitchBody\(switching\)/.test(dsPanel) &&
    !/Change dataset from/.test(codeOnly(dsPanel)),
  'two hardcoded sentences let the CAPEX dialog ask about EPA',
)

/*
 * And it is administered in Settings, not offered in the sidebar. A control that ends the session
 * does not belong beside the page links; the sidebar's copy of it was removed when the sign-out was
 * added, and half a removal is the shape that fails silently.
 */
expect(
  'the dataset control is a Settings tab, and is gone from the sidebar',
  /key: 'dataset',/.test(read('src/pages/SettingsPage.tsx')) &&
    /children: <DatasetPanel \/>/.test(read('src/pages/SettingsPage.tsx')) &&
    !/DatasetP(icker|anel)/.test(read('src/components/Sidebar.tsx')) &&
    !existsSync(join(root, 'src/components/DatasetPicker.tsx')) &&
    /* The login says which dataset it lands in, since a switch drops the reader there. */
    /Signing in to the <strong>\{dataset\}<\/strong> dataset/.test(read('src/pages/LoginPage.tsx')),
  'a switcher in the nav is one mis-click from ending the session',
)

expect(
  'a secondary dataset can be seeded, and the seed reads the merge plan',
  /"seed:dataset": "node scripts\/seed-dataset\.mjs"/.test(read('package.json')) &&
    /* Derived from MERGE_PLAN rather than a second list, so the seed cannot disagree with `both`.
       Keyed on the assignment that builds the document, not on the loop header: that header appears
       twice in the file (the build and the pre-write check), so a whole-file match for it passed a
       break test that emptied the build — the self-documenting-file trap, one more time. */
    /seeded\[key\] = seedValue\(rule, source\[key\]\)/.test(read('scripts/seed-dataset.mjs')) &&
    /import \{ DATASETS, MERGE_PLAN, PRIMARY \} from '\.\.\/mock-server\/datasets\.mjs'/.test(
      read('scripts/seed-dataset.mjs'),
    ) &&
    /* And it refuses to empty the primary, which holds the tenant's real data. */
    /is the primary dataset and holds the tenant/.test(read('scripts/seed-dataset.mjs')),
  'a seed with its own idea of what is shared double-counts a key under both',
)

/*
 * ---------------- the dataset is the first segment of every in-app URL ----------------
 *
 * `/E/sources`, `/C/reports` — the selected dataset's first letter, so the address says which dataset
 * the page is showing.
 *
 * **The selection is the authority and the URL is its rendering, which is the opposite of the usual
 * arrangement and is the point.** Adopting a typed letter would make the URL a second way to change
 * dataset — one that skips the confirmation and the sign-out that make the switch safe, and that would
 * leave the letter disagreeing with the `x-dataset` header every request carries. So a wrong or missing
 * letter is *corrected*, never obeyed.
 */
const dsApi = read('src/api/dataset.ts')
const dsGate = read('src/components/DatasetPathGate.tsx')

expect(
  'the dataset segment is derived from the selection, and the URL never sets it',
  /export const datasetSegment = \(name: string = current\): string =>/.test(dsApi) &&
    /export const appPath = \(path: string\): string => `\/\$\{datasetSegment\(\)\}\$\{path\}`/.test(dsApi) &&
    /* The gate renders a decision made elsewhere; it must not write the selection. */
    /const fix = datasetPathFix\(location\.pathname, location\.search, location\.hash\)/.test(dsGate) &&
    /return fix \? <Navigate to=\{fix\} replace \/> : <Outlet \/>/.test(dsGate) &&
    !/setCurrentDataset/.test(codeOnly(dsGate)),
  'a URL that could change the dataset would skip the confirmation and the sign-out',
)

expect(
  'the correction is a pure function, because a redirect cannot be seen through a render',
  /* `<Navigate>` navigates in a `useLayoutEffect`, which `renderToString` never runs — a test that
     mounted the table and read the router's location reported every redirect as broken, including
     `RequireAuth`'s, which has always worked. The decidable part moved to where it can be asserted,
     the same reason a `Modal`'s copy lives in `src/data/`. */
  /export function datasetPathFix\(/.test(dsApi) &&
    /if \(segment === expected\) return null/.test(dsApi) &&
    /return `\/\$\{expected\}\$\{rest\}\$\{search\}\$\{hash\}`/.test(dsApi),
  'a redirect asserted through renderToString passes over nothing',
)

expect(
  'a single-letter first segment is the dataset, and anything longer is the route',
  /* Which is what lets an old unprefixed bookmark be corrected rather than 404 on a dataset whose name
     happens to be "sources". */
  /if \(first\.length !== 1\) return \{ segment: null, rest: pathname \}/.test(dsApi) &&
    /return \{ segment: first\.toUpperCase\(\), rest: tail \?\? '\/' \}/.test(dsApi),
  'a missing prefix and a wrong one need the same repair',
)

expect(
  'every dataset has a distinct letter',
  /* One letter was asked for and is only unambiguous while the initials differ: two datasets sharing one
     would share an address, and the URL would name neither. Read off the server's own list.
     **The rule matters most while it looks vacuous.** There is one dataset today, so no two letters can
     collide — which is exactly when a check like this stops being read, and exactly when the next
     dataset gets added. The denominator is the declared list plus `both`, so it re-acquires teeth the
     moment a second name appears rather than having to be remembered then. */
  (() => {
    const declared = /export const DATASETS = \[([^\]]+)\]/.exec(datasets)?.[1] ?? ''
    const names = [...declared.matchAll(/'([^']+)'/g)].map((m) => m[1])
    const both = /export const BOTH = '([^']+)'/.exec(datasets)?.[1] ?? ''
    const all = [...names, both].filter(Boolean)
    const letters = all.map((n) => n.slice(0, 1).toUpperCase())
    /* At least the primary and `both` must have parsed, or this is asserting over an empty list. */
    return all.length >= 2 && new Set(letters).size === letters.length
  })(),
  'two datasets sharing an initial would share a URL',
)

expect(
  'no in-app navigation is left unprefixed',
  /* One helper on every `navigate`, `Link` and `href` that points inside the app, so the prefix cannot be
     present on most routes and missing on one — which is a page that loads and then jumps. `/login` is
     deliberately outside, being the one address that exists without a dataset. */
  [
    'src/pages/GraphStudioListPage.tsx',
    'src/pages/GraphStudioPage.tsx',
    'src/pages/NewGraphPage.tsx',
    'src/pages/GraphCanvasFullPage.tsx',
    'src/pages/NotFoundPage.tsx',
    'src/components/NoPublishedGraph.tsx',
    'src/components/NoSourceConnected.tsx',
    'src/components/SourcesStep.tsx',
    'src/components/Sidebar.tsx',
  ].every((file) => {
    const src = codeOnly(read(file))
    /* Every literal in-app target is wrapped: no bare `navigate('/x')` or `to="/x"` survives, except
       `/login`, which has no dataset. */
    const bare = [
      ...src.matchAll(/navigate\('(\/[a-z-]+)'/g),
      ...src.matchAll(/to="(\/[a-z-]+)"/g),
    ].map((m) => m[1])
    return src.includes('appPath') && bare.every((p) => p === '/login')
  }),
  'a prefix on most routes and missing on one is a page that loads and then jumps',
)

/*
 * ---------------- an export is a snapshot, and never a cache ----------------
 *
 * `db.reports` stores no result and `GET /reports/saved/:id` rebuilds from the frame, so a stale
 * figure can never be served as a current one. `POST /reports/export` is the one place a figure is
 * written down, and the rule that keeps it from becoming a second source is simple: **nothing reads
 * an export back**. The moment a read path points at `exports/`, the section has a cache with none
 * of a cache's honesty about staleness.
 *
 * Asserted as the absence of a reader, and as the presence of the three things that make a written
 * figure honest — when it was generated, under what frame, and which graph answered it.
 */
const exporter = read('mock-server/reportExport.mjs')
expect(
  'an export is written and never read back',
  /POST/.test(server) &&
    /match: \(p\) => p === '\/reports\/export'/.test(server) &&
    /* No route, and no call anywhere, fetches an export. */
    !/readDoc\([^)]*export/i.test(codeOnly(server)) &&
    !/exports\//.test(codeOnly(server).replace(/exportKey\([^)]*\)/g, '')),
  'a read path into exports/ turns a snapshot into a cache with no staleness story',
)
expect(
  'and it carries the moment, the frame and the graph that answered it',
  /generated_at: generatedAt/.test(server) &&
    /generatedAt/.test(exporter) &&
    /report\.graph/.test(exporter) &&
    /row_count/.test(exporter),
  'a figure detached from its question is a number nobody can check',
)
/*
 * The renderers are pure so `verify-report-export` can assert what a report renders to without a
 * bucket, a network or a published graph. Reaching for `db` here would make the exporter checkable
 * only by exporting, which is the "assert a fact at its site" rule applied to a whole module.
 */
expect(
  'the renderers are pure, so they can be checked without a bucket',
  !/\bdb\./.test(codeOnly(exporter)) &&
    !/readDoc|writeDoc|fetch\(/.test(codeOnly(exporter)) &&
    /"verify:export": "node scripts\/verify-report-export\.mjs"/.test(read('package.json')) &&
    /verify:export/.test(read('package.json').match(/"preflight": "[^"]+"/)?.[0] ?? ''),
  'an exporter that can only be checked by exporting is one nobody checks',
)
/*
 * A private bucket makes an export unreachable to the person it is for, so the reply carries a
 * presigned link — and the link *is* the permission, so its lifetime is the whole access decision
 * and has to be stated rather than implied. The same rule the section states about sharing: it
 * narrows who is told, and it is not access control.
 */
expect(
  'an export comes back with a link that states its own lifetime',
  /presignGet\(ref, expiresIn\)/.test(server) &&
    /expires_in: expiresIn/.test(server) &&
    /const REPORT_EXPORT_LINK_MS/.test(server) &&
    /* And the duration is never written down in the renderer or the route. */
    !/3600|60 \* 60/.test(codeOnly(exporter)),
  'a link that has quietly stopped working reads as a broken report',
)
/*
 * A file write is temp-then-rename because a crashed write truncates; an S3 write is not, because
 * `PutObject` is atomic per object. What S3 adds is the check a file could never have: `If-Match`
 * turns a second writer into a refused write instead of a lost update, which is the failure the
 * three PM2 workers were producing silently.
 */
expect(
  'an S3 write is conditional on the version this process read',
  /'if-match': etag/.test(store) &&
    /res\.status === 412/.test(store) &&
    /docEtags\.set\(ref, etag\)/.test(server) &&
    /* And the refusal says the process is stale rather than reporting a generic failure. */
    /was changed by something else since this server read it/.test(store),
  'two writers of a whole document means the last one silently wins',
)
/*
 * PM2 ran three workers in cluster mode. Every writer hands `commitDb` the whole document and the
 * write chain is per-process, so two workers meant a lost update; and the live state that never
 * reaches disk (`registered`, `studioLive`, `profilingJobs`) was three independent copies behind a
 * round-robin. Neither is visible in a log — the first is a silent overwrite and the second is a
 * feature that works one request in three.
 */
const pm2 = read('ecosystem.config.js')
expect(
  'the mock server runs as a single instance',
  /instances: 1\b/.test(pm2) &&
    !/exec_mode: "cluster"/.test(codeOnly(pm2)) &&
    /* The reason is recorded where the number is, or it grows back. */
    /commitDb/.test(pm2),
  'a whole-document writer and in-memory state cannot be replicated by running more of it',
)

expect(
  'and a merge conflict is named as one, before the parse',
  /still has merge conflict markers/.test(server) &&
    /\^\(<<<<<<<\|=======\|>>>>>>>\)/.test(server) &&
    /* Each file names the command that rebuilds it — they are different commands. */
    /npm run seed:governance/.test(server) &&
    /npm run seed:settings/.test(server),
  'db.json is generated and committed, so a pull over a re-seeded copy conflicts every time',
)

/*
 * ---------------- one precondition, one screen ----------------
 *
 * Four pages need a published graph — Ask, Reports, the What-if lens and Audit & Governance — and
 * every one of them renders `NoPublishedGraph`, whose single action is **Open Graph Studio**, which
 * is where the publish button actually is.
 *
 * Ask did not, for a long time: it kept a private `EmptyState` with the same precondition under a
 * different title ("No graph is live yet" against "No graph has been published"), its own three
 * steps, and its own copy of the button. Nothing broke — two screens describing one gate is exactly
 * the kind of drift that reads as two different problems, and sends somebody looking for a second
 * fix. Asserted both ways: every gated page uses the component, and none of them hand-rolls a
 * second empty state for the same branch.
 */
const PUBLISH_GATED_PAGES = [
  'src/pages/AskPage.tsx',
  'src/pages/ReportsPage.tsx',
  'src/pages/WhatIfPage.tsx',
  'src/pages/AuditPage.tsx',
]
expect(
  'every page gated on publication renders the one empty state',
  PUBLISH_GATED_PAGES.every((p) => /<NoPublishedGraph\b/.test(codeOnly(read(p)))),
  `${PUBLISH_GATED_PAGES.length} pages: ${PUBLISH_GATED_PAGES.map((p) => p.split('/').pop()).join(', ')}`,
)
expect(
  'and none of them hand-rolls a second one for the same branch',
  PUBLISH_GATED_PAGES.every((p) => !/<EmptyState\b/.test(codeOnly(read(p)))),
  'one precondition, one screen, one next action',
)
/* The action is the point of the request that prompted this: a gated page has to say where the
   publish button is, and only Graph Studio has one. */
const gateSrc = codeOnly(read('src/components/NoPublishedGraph.tsx'))
expect(
  'the gate sends a reader to Graph Studio when there is something to publish',
  /hasBuilt \? '\/graph-studio' : '\/new-graph'/.test(gateSrc) &&
    /Open Graph Studio/.test(gateSrc) &&
    /* The two branches are different fixes; offering one for both sends half the readers
       to the wrong screen. */
    /Describe a business need/.test(gateSrc),
  'built -> publish it; nothing built -> build one first',
)

/* ---------------- Audit & Governance ---------------- */

/*
 * The page that lets somebody author a data-access rule. Its claims fall into two families: the
 * pools it offers are the app's own, and **the rule it authors is not enforced** — which is the
 * one sentence that stops the whole page implying a filter runs.
 */
/*
 * Comments stripped, and not only for the absence claims below.
 *
 * The first version of the "recorded, not enforced" claim searched the raw file for
 * `copy.notEnforced` and could not be broken: the component's own doc comment explains that the
 * sentence is served and names the field, so replacing the *rendered* one with a literal left the
 * claim satisfied by prose. That is the same trap this file records for absence claims, met by a
 * presence claim — a token in a comment proves nothing about what renders.
 */
const auditPage = codeOnly(read('src/pages/AuditPage.tsx'))
const ruleEditor = read('src/components/AccessRuleEditor.tsx')
const artifactCard = read('src/components/GovernedArtifactCard.tsx')
const auditCopy = db.reports.governance.audit.copy

expect(
  'the governance page states that a rule is recorded, not enforced',
  auditCopy.not_enforced.includes('recorded, not enforced') &&
    /description=\{view\.copy\.notEnforced\}/.test(auditPage) &&
    /* And the server refuses a document that drops it — the phrase, not merely the key. */
    /recorded, not enforced/.test(server),
  'no roster here is filtered per persona, so silence would imply one is',
)
/*
 * A restriction basis is the register's own: its identity column plus the fields the dictionary
 * declares filterable. A written list here could offer a field no report can slice by, and would
 * stop matching the moment the dictionary changed.
 */
expect(
  'the restriction bases are derived from the register, never written',
  /registerFields\(\)\.filter\(\(f\) => f\.filterable\)/.test(server) &&
    /* The identity column is the document's declaration, not a constant here — EPA's register is
       keyed `generator` and Northline's `n`, and a literal named one of them. */
    /registerIdentity\(\)/.test(server) &&
    !/const GOVERNANCE_IDENTITY/.test(server) &&
    /* The page renders what it was served rather than a copy of the field list. */
    /bases\.map\(/.test(ruleEditor) &&
    !/'state'|'risk'|'generator'/.test(codeOnly(ruleEditor)),
  (db.reports.register?.fields ?? db.reports.fields)
    .filter((f) => f.filterable)
    .map((f) => f.key)
    .join(', ') + ' + the identity column',
)
/*
 * The two audience models stay apart. A report keeps persona ids and a scenario keeps addresses;
 * the server writes to whichever the artifact actually has, and translating one into the other
 * would invent a mapping — the rule `viewer_roles` was introduced under.
 */
expect(
  'the server owns the mapping from a person to an artifact’s audience',
  /const governanceAddReader = /.test(server) &&
    /artifact\.kind === 'report'/.test(server) &&
    /audience: \[\.\.\.r\.audience, person\.role_id\]/.test(server) &&
    /readers: \[\.\.\.entry\.published\.readers, person\.email\]/.test(server) &&
    /* The card states which pool it is, so one is never read as the other. */
    /audienceNote/.test(artifactCard),
  'a report names personas, a scenario names addresses',
)
/* Unpublish exists for a scenario and not for a report, and the row must not offer what 404s. */
expect(
  'unpublish is offered only where the server has that act',
  /can_unpublish: false/.test(server) &&
    /is a report definition — this section has no unpublish/.test(server) &&
    /artifact\.canUnpublish \?/.test(artifactCard),
  'a report has no unpublish; its equivalent is an audience of nobody',
)
/*
 * The resolution is computed once, on the server, against the live register. A page that
 * recalculated it would be a second answer to what a rule admits.
 */
expect(
  'the resolution is the server’s, and the page never recomputes it',
  /const governanceResolution = /.test(server) &&
    /person\.resolution\.count/.test(ruleEditor) &&
    !/\.filter\(\(g\)|\.length \/|Math\.round/.test(codeOnly(ruleEditor)),
  'what a rule would admit has one source',
)
/* The trail records what this server saw. An "opened" row would be an event that never happened. */
expect(
  'the audit trail says why opens are not in it',
  auditCopy.log_note.includes('Opens are not in this trail') &&
    /copy\.logNote/.test(auditPage) &&
    !/'open'/.test(codeOnly(server).slice(codeOnly(server).indexOf('const governanceLog'), codeOnly(server).indexOf('const governanceBases'))),
  'nothing here serves a report to a reader',
)
/* The rule panel is a prop-driven component for the reason every other panel here is. */
expect(
  'the rule editor is its own component, so its contents can be asserted on',
  /export default function AccessRuleEditor\(/.test(ruleEditor) &&
    /openFor: string \| null/.test(artifactCard),
  'renderToString cannot open a panel a parent is holding shut',
)
/* The directory the "give somebody access" control offers is served, not written. */
expect(
  'the governance page offers the served directory',
  /people\.filter\(\(p\) => !artifact\.readers\.includes\(p\.email\)\)/.test(artifactCard) &&
    !/@vriodigital\.com|@vls\.com/.test(codeOnly(artifactCard)) &&
    /settings\.users\.map/.test(server.slice(server.indexOf('const governancePeople'))),
  'settings.json is the one answer to "who exists"',
)

/* ---------------- the report section ---------------- */

/*
 * The reports are the one section whose *copy* is extracted from the package's rendered
 * HTML, so the claims here fall into two families: the extraction resolved (a report has
 * its heading, tiles and footer), and the authored figures still match the roster they
 * were transcribed from.
 *
 * The path is asserted to exist first. A claim keyed to a package path that is not in the
 * checkout answers "not here" and passes — that has already swallowed eight canvas claims
 * for a session.
 */
const reportsDir = 'vls_demo_data_package_2026-08-10/07_reports'
const reportsPkgPath = `${reportsDir}/report_authoring_data.json`
const reportsPkgHere = existsSync(join(root, reportsPkgPath))
const reportsIngest = read('scripts/ingest-reports.mjs')
expect(
  'the reports package is where its ingest reads it from',
  reportsPkgHere && reportsIngest.includes(reportsDir),
  reportsPkgHere ? reportsPkgPath : `${reportsPkgPath} is not in this checkout`,
)

const reports = db.reports
const reportsPkg = reportsPkgHere ? JSON.parse(read(reportsPkgPath)) : null

expect(
  'every report the package defines reached db.reports',
  reportsPkg !== null && reports.reports.length === reportsPkg.starters.length,
  `${reports.reports.length} reports · ${reports.reports.map((r) => r.report_id).join(', ')}`,
)

/* The extraction resolved. A report with no tiles or no footer would render as a heading
   over a table, losing both the figures it is quoted for and the source it is cited by. */
expect(
  'every report carries the copy its page prints',
  reports.reports.every(
    (r) => r.heading && r.subtitle && r.badge && r.tiles.length > 0 && r.footer.length > 0,
  ),
  reports.reports.map((r) => `${r.report_tag} ${r.tiles.length} tiles`).join(' · '),
)

/*
 * A `kpis` block must not reach db.reports: its four keys and the report's four authored
 * tiles are the same summary, and rendering both would print it twice — two truths about
 * one figure, which is the failure this repo keeps guarding.
 */
expect(
  'no report renders its summary twice',
  reports.reports.every((r) => r.blocks.every((b) => b.type !== 'kpis')),
  'the tiles are report-level; the kpis block is dropped at ingest',
)

/*
 * The authored tiles against the roster, recomputed here from `db.reports.data` — the
 * same identities the ingest checks against the package, so a hand-edit to db.json is
 * caught as well as a package change. A tile is the most quotable figure on a report and
 * the least likely to be re-derived by hand.
 */
/*
 * **These identities are EPA's, and they are checked where EPA's rosters are.**
 *
 * Each entry recomputes one authored tile from `db.reports.data` — the generator register and the
 * quarterly roster — so a tile transcribed from a rendered page cannot quietly go stale. Both the
 * rosters and the figures are that tenant's: Northline's register carries a project's region,
 * category, business unit, phase and compliance constraint and **no financial column at all**, so
 * its tiles ($5.00B period plan, −11.8% variance) are not recomputable from it by design — they are
 * authored against the plan cube, which `db.reports.data` does not hold.
 *
 * Recomputing them from something else would be inventing an identity, and asserting nothing would
 * be the vacuous pass this file exists to prevent. So the identities run against the roster they were
 * written for, and every tenant gets the structural claim below, which is the one that holds for all
 * of them.
 */
const repGen = reports.data.generators ?? []
const repQ = reports.data.quarters ?? []
const repSum = (rows, key) => rows.reduce((t, r) => t + r[key], 0)
const repInt = (v) => Math.round(v).toLocaleString('en-US')
const repCd = repGen.filter((g) => g.cd === true)
const tileOf = (reportId, label) =>
  reports.reports
    .find((r) => r.report_id === reportId)
    ?.tiles.find((t) => t.label.toLowerCase().includes(label.toLowerCase()))?.value ?? null

const TILE_IDENTITIES = [
  ['risk', 'Distinct generators', repInt(repGen.length)],
  /* The register's headline figure, and the one a roster edit moves first: the other
     counts survive a changed penalty, so without this the whole set passed over a
     generator whose exposure had been edited. */
  ['risk', 'Total penalty exposure', `$${(repSum(repGen, 'penalty') / 1e6).toFixed(2)}M`],
  ['risk', 'With enforcement history', repInt(repGen.filter((g) => g.enf > 0).length)],
  ['risk', 'Consent-decree generators', repInt(repCd.length)],
  ['cd', 'Tonnage exposure', repInt(repSum(repCd, 'tons'))],
  ['cd', 'Their combined penalty', `$${Math.round(repSum(repCd, 'penalty') / 1000)}k`],
  ['quarterly', 'Total inbound manifests', repInt(repSum(repQ, 'manifests'))],
  ['quarterly', 'Total tonnage', repInt(repSum(repQ, 'tons'))],
  ['quarterly', 'Rejections / residue', `${repInt(repSum(repQ, 'rej'))} / ${repInt(repSum(repQ, 'res'))}`],
]
const checkedTiles = repGen.length > 0 && repQ.length > 0 ? TILE_IDENTITIES : []
const staleTiles = checkedTiles.filter(([id, label, want]) => tileOf(id, label) !== want)
expect(
  'every checked tile still agrees with the roster it was transcribed from',
  staleTiles.length === 0,
  checkedTiles.length === 0
    ? 'this tenant authors its tiles against figures db.reports.data does not carry — nothing to recompute'
    : staleTiles.length === 0
      ? `${checkedTiles.length} identities: ${checkedTiles.map(([, l, v]) => `${l} ${v}`).join(' · ')}`
      : staleTiles
          .map(([id, label, want]) => `${id}/${label} reads ${tileOf(id, label)}, roster computes ${want}`)
          .join('; '),
)

/*
 * The claim every tenant's reports have to satisfy, and the one `validateDb` refuses a boot over:
 * a report reads a spine that exists and is scoped by a filter this server implements. Both fail by
 * *rendering* — a missing spine gives tiles above an empty table, an unknown scope throws inside the
 * route — so catching them at build time is better than at boot, and far better than in a page.
 */
/* `\r?\n`, never a bare `\n`: these files check out with CRLF on Windows, and a bare newline finds
   nothing — which reports an empty scope list as though the server declared none. */
const reportScopeBody = /const REPORT_SCOPES = \{([\s\S]*?)\r?\n\}/.exec(server)?.[1] ?? ''
const reportScopeKeys = new Set(
  [...reportScopeBody.matchAll(/^\s{2}([\w-]+):/gm)].map((m) => m[1]),
)
const brokenRefs = reports.reports.filter(
  (r) => !Array.isArray(reports.data[r.spine]) || !reportScopeKeys.has(r.scope),
)
expect(
  'every report reads a roster that exists and a scope the server implements',
  reportScopeKeys.size > 0 && reports.reports.length > 0 && brokenRefs.length === 0,
  brokenRefs.length > 0
    ? brokenRefs.map((r) => `${r.report_id} spine=${r.spine} scope=${r.scope}`).join(' · ')
    : `${reports.reports.length} reports over ${reportScopeKeys.size} declared scopes`,
)

/*
 * A scoped report has to select what its own tiles count. Without this the
 * consent-decree report could widen to all 36 generators while its tiles still said 4 —
 * and a wider report reads as a bigger exposure.
 */
const SCOPE_FILTERS = {
  all: (rows) => rows,
  cd: (rows) => rows.filter((r) => r.cd === true),
  enf: (rows) => rows.filter((r) => r.enf > 0),
  oos: (rows) => rows.filter((r) => r.state !== 'TX'),
}
/*
 * **A scope that admits the whole roster is not a scoped report**, and testing `scope !== 'all'`
 * assumed only one spelling of "everything". Northline's three reports carry `sc_author_all` — the
 * author scope, which admits all of it — so all three were read as scoped and then failed for having
 * no narrowed count in their tiles. The test is now what the scope *does*: a report is scoped when
 * its filter selects fewer rows than the spine holds.
 */
const scoped = reports.reports.filter((r) => {
  const all = reports.data[r.spine] ?? []
  const admitted = SCOPE_FILTERS[r.scope]?.(all)
  return Array.isArray(admitted) && admitted.length < all.length
})
expect(
  'a scoped report selects exactly what its tiles claim',
  scoped.every((r) => {
    const rows = SCOPE_FILTERS[r.scope]?.(reports.data[r.spine]) ?? []
    return r.tiles.some((t) => t.value === repInt(rows.length))
  }),
  scoped.length > 0
    ? scoped.map((r) => `${r.report_id} scope=${r.scope}`).join(' · ')
    : 'every report on this tenant is asked of its whole spine — nothing to narrow',
)

/*
 * **Every column that reaches a table header has one, and only the columns that reach one are
 * checked.**
 *
 * This walked *every* key of *every* roster, which was right when every roster was tabulated by a
 * report. Two things break that here. A roster can be a list of plain strings — Northline's
 * `regions`, `categories` and `business_units` are — and `Object.keys` of a string is its character
 * indices, so the failure list filled with `0, 1, 2 … 25`: not columns, and not missing headers. And
 * a roster can be carried for reference without any report tabulating it, which `contracts` and
 * `changeOrders` are; a header is only owed where a header is printed.
 *
 * So the denominator is the columns a report's spine really exposes, and the sources of a label now
 * include `reports.register.fields` — the register's own dictionary, which is where a tenant whose
 * rows carry short keys (`reg`, `cat`, `bu`) declares what they are called.
 */
const labelMapBody = /const REPORT_LABELS = \{([\s\S]*?)\r?\n\}/.exec(server)?.[1] ?? ''
const labelledKeys = new Set([
  ...reports.fields.map((f) => f.key),
  ...(reports.register?.fields ?? []).map((f) => f.key),
  ...[...labelMapBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]),
])
/* The spines reports actually read, and only those whose rows are objects with named columns. */
const tabulatedSpines = [...new Set(reports.reports.map((r) => r.spine))]
const unlabelled = [
  ...new Set(
    tabulatedSpines.flatMap((spine) => {
      const first = (reports.data[spine] ?? [])[0]
      return first && typeof first === 'object' && !Array.isArray(first) ? Object.keys(first) : []
    }),
  ),
].filter((key) => !labelledKeys.has(key))
expect(
  'every tabulated roster column has a header, from the field dictionary, the register or REPORT_LABELS',
  labelMapBody.length > 0 && tabulatedSpines.length > 0 && unlabelled.length === 0,
  labelMapBody.length === 0
    ? 'REPORT_LABELS was not found in server.mjs — this check cannot run'
    : unlabelled.length > 0
      ? `no header for: ${unlabelled.join(', ')} — they would print as raw keys`
      : `${labelledKeys.size} labelled keys over ${tabulatedSpines.join(', ')}`,
)

/* Every block reference resolves against the spine it reads. The server refuses these at
   boot; asserted here so it fails the build first. */
const badBlocks = []
for (const r of reports.reports) {
  const rows = reports.data[r.spine] ?? []
  const rowKeys = new Set(Object.keys(rows[0] ?? {}))
  if (rows.length === 0) badBlocks.push(`${r.report_id} reads spine "${r.spine}", which has no rows`)
  for (const b of r.blocks) {
    if (b.type === 'chart' && !rowKeys.has(b.measure)) badBlocks.push(`${r.report_id} charts ${b.measure}`)
    if (b.type === 'quarterly' && !rowKeys.has(b.metric)) badBlocks.push(`${r.report_id} trends ${b.metric}`)
    for (const c of b.type === 'table' ? b.cols : []) {
      if (!rowKeys.has(c)) badBlocks.push(`${r.report_id} tabulates ${c}`)
    }
  }
}
expect(
  'every block reads a column its spine carries',
  badBlocks.length === 0,
  badBlocks.length === 0
    ? `${reports.reports.reduce((t, r) => t + r.blocks.length, 0)} blocks over ${Object.keys(reports.data).length} rosters`
    : badBlocks.join('; '),
)
expect(
  'and validateDb refuses one that does not',
  /reports "\$\{r\.report_id\}" charts/.test(server) &&
    /reports "\$\{r\.report_id\}" tabulates/.test(server),
  'a blank column reads as "no data" rather than as a broken reference',
)

/*
 * One chart component for the whole app. A report's chart payload is an answer's chart
 * payload, so `ReportBlock` draws nothing itself — a second chart file would be a second
 * set of rules about what a bar means, and this repo has already had two truths about one
 * drawing.
 */


/*
 * **The report section is one route and a published-graph gate.**
 *
 * The prototype owns its own navigation — three tabs and its own library — so there is no
 * per-report URL the way the React section had. What this app contributes is the shell mount
 * and the precondition: available once a graph is published, the same rule Ask and the lens
 * follow, through the same component that states it.
 */
const reportRoutes = read('src/routes.tsx')
const reportsPage = read('src/pages/ReportsPage.tsx')
expect(
  'the report section is one route, gated on a published graph',
  /\{ path: 'reports', element: <ReportsPage \/> \}/.test(reportRoutes) &&
    /* One route, not the four the React section had. */
    !/path: 'reports\//.test(reportRoutes) &&
    /publishedCount === 0/.test(reportsPage) &&
    /<NoPublishedGraph/.test(reportsPage) &&
    /* The gate reads the API; it does not guess from something local. */
    /createReadStore\(getReports\)/.test(reportsPage),
  'one page, and it opens only once something is published',
)
expect(
  'and the endpoints behind it are still served',
  server.includes("match: (p) => p === '/reports'") &&
    /match: \(p\) => \/\^\\\/reports\\\/\[\^\/\]\+\$\/\.test\(p\)/.test(server),
  'the section reads published_count from it; the rest is waiting for a UI that asks',
)

/* ---------------- the report section: gates and authoring ---------------- */

/*
 * Both gates, and neither serves the reports' copy.
 *
 * A card headed "Inbound Generator Risk Register · 36 generators" above "No data source is
 * connected" is a claim about data that is not there — the mistake the What-if page had to
 * be corrected for — and the same is true above "No graph has been published". The server
 * is where it cannot come back: the gated branch nulls the persona, the picker set and the
 * graph, not only the figures.
 */
/*
 * Asserted field by field rather than as one sequence: the first version of this claim
 * matched the whole literal in order, so adding `graphs: []` to the gated payload broke it
 * while the fact it guards was still true. A claim keyed to the order of an object literal
 * is keyed to the spelling.
 */
/* Sliced from the section route by name. The first version of this slice matched on the
   condition alone and found the What-if branch, which has the same gate and none of these
   fields — a claim that reads the wrong function is not reading the code it names. */
const reportsIndexRoute =
  /match: \(p\) => p === '\/reports',[\s\S]*?\n  \},/.exec(server)?.[0] ?? ''
const gatedBranch =
  /if \(counts\.published_count === 0\) \{[\s\S]*?\}\)\r?\n\s*\}/.exec(reportsIndexRoute)?.[0] ?? ''
const withheld = ['graph: null', 'graphs: []', 'saved: []', 'authoring: null']
expect(
  'the report endpoints send no copy while nothing is published',
  gatedBranch.length > 0 &&
    withheld.every((field) => gatedBranch.includes(field)) &&
    /connected_sources: connected, \.\.\.counts, report: null/.test(server),
  gatedBranch.length === 0
    ? 'the gated branch was not found — this check cannot run'
    : 'the gate withholds the copy, the graphs and the pickers, not just the figures',
)
/*
 * **Publication is the only precondition**, on all four gated routes — the section, one
 * report, a saved report and the What-if frame. A connected source is deliberately *not*
 * one: publishing a graph is already downstream of having something to build it from, and
 * a second gate in front of it only tells the reader to fix something that is not stopping
 * them. Counting occurrences alone was too weak once — weakening the lens's gate left the
 * others behind and the claim passed — so the lens is checked by name as well.
 */
const whatifRoute = /match: \(p\) => p === '\/whatif',[\s\S]*?\n  \},/.exec(server)?.[0] ?? ''
expect(
  'all four gated routes check publication, and nothing else',
  (server.match(/if \(counts\.published_count === 0\)/g) ?? []).length >= 4 &&
    !/connected === 0 \|\| counts\.published_count/.test(server) &&
    whatifRoute.length > 0 &&
    whatifRoute.includes('counts.published_count === 0'),
  whatifRoute.length === 0
    ? 'the /whatif route was not found — this check cannot run'
    : 'reports, one report, a saved report and the lens share one rule',
)
/*
 * ---------------- the report prototype's dataset is a document, not a bundle ----------------
 *
 * It was `src/reports/data/dataset.json`, imported into the JS — so it was the one thing on screen that
 * editing the bucket could not change: a figure on the Authoring tab needed a rebuild and a redeploy, and
 * it could not follow the dataset switch either. It lives at
 * `s3://contextweave.com/EPA/reports_prototype.json` now, served by `GET /reports/prototype`.
 *
 * Asserted at both ends and in the middle, because the dangerous shape is a partial move: the file gone
 * from `src/` while something still imports it fails the build, but the file still in `src/` while the
 * endpoint exists is two copies that drift.
 */
const protoDoc = read('src/reports/data.ts')
const s3sync = read('scripts/s3-sync.mjs')

expect(
  'the prototype dataset is fetched, not bundled',
  /* Gone from the bundle: nothing imports a JSON file anywhere in the app any more. */
  !existsSync(join(root, 'src/reports/data/dataset.json')) &&
    /* `codeOnly`: the comment explaining the move quotes the import it replaced, so a whole-file search
       finds it and the claim fails against correct code. Fourth time this file has been caught that way. */
    !/from '\.\/data\/dataset\.json'/.test(codeOnly(protoDoc)) &&
    /* **It is a key of `db.json` now rather than a document beside it**, so it arrives with the boot
       read instead of on a fetch of its own. The fact this claim guards is unchanged and is the
       reason the move was safe: it is still *served*, so editing the bucket still changes what the
       Authoring tab shows, with no rebuild. */
    /const prototypeData = \(\) => db\.reports_prototype/.test(server) &&
    /reports_prototype: \(v\) => validatePrototype\(v\)\.length === 0,/.test(server) &&
    /* Served, and validated on the way in on both sides. */
    /match: \(p\) => p === '\/reports\/prototype'/.test(server) &&
    /export async function getReportsPrototypeDataset\(\)/.test(client) &&
    /const PROTOTYPE_PAYLOAD = shape\(\{/.test(client),
  'a bundled figure needs a rebuild to change, and cannot follow the dataset switch',
)

expect(
  'its route is declared before the one that would swallow it',
  /* `/^\/reports\/[^/]+$/` matches `prototype`, so declared after it the request would come back as
     `no report "prototype"` — a 404 naming five report ids, none of them the thing asked for. Same hazard
     as `graph-studio/:useCaseId` matching the canvas route's parent segment, and asserted the same way. */
  server.indexOf("p === '/reports/prototype'") > 0 &&
    server.indexOf("p === '/reports/prototype'") <
      server.indexOf('match: (p) => /^\\/reports\\/[^/]+$/.test(p)'),
  'a prefix matcher declared first turns the dataset into a missing report id',
)

expect(
  'the module publishes the dataset through live bindings, and says nothing renders before it lands',
  /* `let`, not `const`: ES module bindings are live, so one assignment reaches every consumer without any
     of them changing. It holds only because no consumer reads these at module scope — checked before the
     change, and this asserts the shape that makes it true. */
  /export let GENERATORS: Generator\[\] = \[\]/.test(protoDoc) &&
    /export function hydrate\(payload: unknown\): void \{/.test(protoDoc) &&
    /export let isHydrated = false/.test(protoDoc) &&
    /* Still validated deeply by the prototype's own walker, which now guards a network payload. */
    /DATA = validateDataset\(payload as Dataset\)/.test(protoDoc) &&
    /* And the host renders it only once it has landed. */
    /hydratePrototype\(prototypePayload\.dataset\)/.test(reportsPage) &&
    /openReportId \|\| !hydrated \|\| prototypeError \|\| hydrationError \? null : \(/.test(reportsPage),
  'rendering before the fetch draws a register with no rows, which reads as "nothing ships here"',
)

expect(
  'a failed fetch and a malformed document are told apart',
  /* Three states, not one spinner: unreachable, malformed, or arrived. The malformed branch names the
     file, because "the authoring tab is empty" is not something a reader can act on. */
  /const \[hydrationError, setHydrationError\] = useState<string \| null>\(null\)/.test(reportsPage) &&
    /db\.reports_prototype is malformed/.test(reportsPage) &&
    /* And the server refuses to boot on one rather than serving it. Named as the key it now is:
       a refusal naming a file nobody has is a refusal nobody can act on. */
    /function validatePrototype\(candidate\)/.test(server) &&
    /is empty — the prototype would render nothing/.test(server) &&
    /refusing to start — db\.reports_prototype cannot be served/.test(server),
  'an empty Authoring tab reads as a section that failed to load',
)

expect(
  'it is tenant-level, and the sync tool has one document to move',
  /* **Still tenant-level, and now expressed as a merge rule rather than as a refusal.** It was a
     document of its own that a secondary dataset was refused a copy of, in its own words. It is a key
     of `db.json` now, so the thing that keeps it the tenant's is `MERGE_PLAN` marking it — and
     `settings` beside it — `primary`: a secondary dataset's document carries the primary's answer
     rather than a second one. The sync tool therefore moves one object per dataset, and the refusal
     it used to carry is gone with the document it was about. */
  /settings: 'primary',/.test(datasets) &&
    /reports_prototype: 'primary',/.test(datasets) &&
    /const DOCS = \{\n  db: \{ name: 'db\.json'/.test(s3sync) &&
    !/TENANT_WHY|reports_prototype\.json|settings\.json/.test(codeOnly(s3sync)) &&
    /* **Committed, by decision, and that is a change of mind worth naming.** It was gitignored like the
       two databases, on the reasoning that a committed copy beside a served one is two answers to what the
       figures are. It travels in git now because the repo is how these documents reach a box that has no
       bucket credentials. The bucket is still what the *server* reads — nothing fetches the committed copy
       — so the risk is not a wrong figure, it is a stale one: `db.json` is generated *and* committed, and a
       pull over a re-seeded copy conflicts inside the JSON, which has already crash-looped a deployed box
       on `<<<<<<< Updated upstream`. `readJsonDb` checks for markers before parsing for exactly that.
       Asserted as the credential rule surviving instead, since that one is not a preference. */
    /^\*\.local$/m.test(read('.gitignore')) &&
    /^mock-server\/\.env\.local$/m.test(read('.gitignore')) &&
    /^mock-server\/\.env\.local\.backup$/m.test(read('.gitignore')),
  'a committed copy beside a served one is two answers to what the figures are',
)

/*
 * ---------------- the tenant's five reports, rendered ----------------
 *
 * The demo package's `07_reports/Report_N_*.html` are the tenant's *rendered* reports — they were dropped
 * into this checkout to port, and are not part of it. Their layout is now React —
 * crumb, heading and badge, lead note, four tiles, the facet bar, a card per block, the footnotes — and
 * their **figures are not**: every number comes from `reportView`, computed per request from
 * `db.reports` in the EPA bucket. Pasting a rendered figure into a component is the one change that
 * would break the section's whole premise, and it would look right on screen while doing it.
 *
 * Asserted as: the components exist and read the payload, nothing in them does arithmetic, and neither
 * of the two things the HTML did — Chart.js from a CDN, clickable filter chips — came across.
 */
const prReport = read('src/components/report/PublishedReport.tsx')
const prBlocks = read('src/components/report/ReportBlocks.tsx')
const prPane = read('src/components/report/PublishedReportPane.tsx')
const prUi = read('src/components/report/ui.tsx')
const prStore = read('src/store/reportsStore.ts')

expect(
  'the five rendered reports are React, and every figure is the server’s',
  /* Each renders what the payload states, by name. */
  /report\.tiles\.map/.test(prReport) &&
    /report\.blocks\.map/.test(prReport) &&
    /report\.footer\.map/.test(prReport) &&
    /report\.facets\.map/.test(prReport) &&
    /* No arithmetic on a measure: a component that summed a column would be a second answer to a
       figure the report already states. `rows.length` is a count of what was rendered, not of data. */
    !/\.reduce\(|\+=|Math\.(sum|round)\(/.test(codeOnly(prBlocks)) &&
    !/\.reduce\(|\+=/.test(codeOnly(prReport)),
  'a figure pasted from the rendered HTML looks right and is a stored result',
)

expect(
  'no chart library came across from the rendered HTML',
  /* The files load Chart.js from a CDN. Charts here are `AnswerChart`, which is why an answer and a
     report cannot disagree about what a bar means — and why the audit gate is not widened by a port. */
  /import AnswerChart from '\.\.\/AnswerChart'/.test(prBlocks) &&
    !/canvas|chart\.js|Chart\.js|cdn\.jsdelivr/i.test(codeOnly(prBlocks)) &&
    !/"chart\.js"/.test(read('package.json')),
  'transcribing a script tag is a dependency decision made by accident',
)

/*
 * **The facet chips filter, and they filter on the server.**
 *
 * They were rendered as labels — "stated, not applied" — because `POST /reports/build` had no caller and a
 * clickable chip would have promised a slice nothing ran. It has a caller now: a chip re-asks the report
 * through the frame, so the table, the chart *and* the tiles recompute together. The prototype these were
 * ported from hid table rows and left its chart and its four KPIs describing the unfiltered set, which is
 * two readings of one screen; that is the bug this does not reproduce.
 *
 * **Values on one facet are OR-ed, facets are AND-ed.** A plain reduce over the filter list ANDed
 * everything, so picking High *and* Medium selected nothing — the arithmetic a multi-select chip bar needs
 * was unexpressible until `reportFrameRows` grouped by key.
 */
expect(
  'a facet is a multi-select that re-asks the report, and the server groups by facet',
  /* A dropdown per facet, not a row of chips: the values come from the roster, so how many there are is
     the data's business — four states fit on a line and twenty do not, and a control that wraps onto
     three lines is the layout deciding how much data is reasonable. */
  /mode="multiple"/.test(prReport) &&
    /onChange=\{\(next: string\[\]\) => void setFacet\(facet\.key, next\)\}/.test(prReport) &&
    /* An empty selection *is* that facet's "All", so there is no second control to keep in step. */
    /placeholder="All"/.test(prReport) &&
    !/toggleFilter|clearFacet/.test(codeOnly(prReport)) &&
    /* The label is tied to the control, since the facet's name is not inside it. */
    /aria-labelledby=\{`pr-facet-\$\{facet\.key\}`\}/.test(prReport) &&
    /* A number rather than `responsive`, which measures and so collapses every tag before layout. */
    /maxTagCount=\{2\}/.test(prReport) &&
    /* One action, because a multi-select reports its whole selection rather than a change. */
    /setFacet: async \(key, values\)/.test(prStore) &&
    /* The re-ask goes through the frame the server last reported, so scope and measure are its own. */
    /await buildReport\(\{ \.\.\.current\.frame, filters \}\)/.test(prStore) &&
    /* Grouped: OR within a key, AND across. One filter per key behaves exactly as it did. */
    /const byKey = new Map\(\)/.test(server) &&
    /rows = rows\.filter\(\(r\) => values\.includes\(String\(r\[key\]\)\)\)/.test(server) &&
    /tests\.some\(\(test\) => test\(r\)\)/.test(server) &&
    /* And a filtered report says its figures are for the slice rather than showing authored ones. */
    /recomputed for this slice/.test(prReport),
  'a chip that hides rows while the chart and the tiles describe the whole set is two readings of one screen',
)

expect(
  'a custody chain renders in order, and a report’s columns align as declared',
  /* A manifest's transporters are ordered: "an order laid into a cell reads as a set", and a comma is
     exactly that. Alignment comes from the column's own `kind`, never from sniffing this slice's cells —
     which is how one report right-aligns a column another leaves ragged. */
  /* The chain lives in the ported primitives now, so the arrow is asserted there and the routing to it
     here — a `Chain` nothing hands a list to draws no chain at all. */
  /className="arw"/.test(prUi) &&
    /'node dest' : 'node'/.test(prUi) &&
    /if \(Array\.isArray\(value\)\) return <Chain nodes=\{value\} \/>/.test(prBlocks) &&
    /* Alignment is read **once**, into the one flag `DataTable` takes, so the header and the cell can no
       longer be changed apart — the old pair of `c.kind === 'num'` tests passed a break test that
       changed one of them and left the other, right-aligning a header over a ragged column. */
    (prBlocks.match(/c\.kind === 'num'/g) ?? []).length === 1 &&
    (prUi.match(/column\.num \? 'num' : undefined/g) ?? []).length === 2 &&
    /* And nothing decides alignment from the value: `typeof` in `cellOf` only chooses a format. */
    !/typeof value === 'number' \? 'num'/.test(codeOnly(prBlocks)),
  'a chain joined with commas is a set, and sniffed alignment differs per slice',
)

/*
 * **The published report wears the standalone port's design and none of its data.**
 *
 * `src/ddd` was a second React port of the same five reports — one component per report with its rosters
 * compiled in as TypeScript constants. The design came across into `./ui` and `report.css`; the data did
 * not, because `db.reports` stores no result and every figure is `reportView`'s per request. A component
 * holding a roster is the one change that breaks this section's premise while looking right on screen.
 *
 * Asserted on every layer at once, because half a port is the shape that fails silently: the second copy
 * is gone, the primitives are here and are what the report renders through, the sheet is scoped, and no
 * component under `src/components/report` declares a row of its own.
 */
expect(
  'the report design is ported, and the standalone copy with its compiled-in figures is gone',
  /* Two ports of one report is two answers to what it looks like. */
  !existsSync(join(root, 'src/ddd')) &&
    /* The primitives it carried are here, and they are what the report renders through. */
    /export function ReportShell\(/.test(prUi) &&
    /export function KpiRow\(/.test(prUi) &&
    /export function DataTable</.test(prUi) &&
    /<ReportShell/.test(prReport) &&
    /<KpiRow items=\{tiles\} \/>/.test(prReport) &&
    /* Its sheet is scoped, like the vendored prototype's: bare `table`, `th` and `h1` rules unscoped
       restyle every antd table in the app, silently, on pages nobody touched. */
    /* Comments stripped first — the block at the top of that file explains the scoping, so its own
       `*`-prefixed lines read as selectors to a line filter. The self-documenting-file trap, in CSS. */
    read('src/components/report/report.css')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[.*]/.test(line))
      .every((line) => line.startsWith('.cw-report')) &&
    /* Its Google Fonts import did not come with it: a network fetch on every report open, which nothing
       else in this app does. */
    !/fonts\.googleapis\.com/.test(read('src/components/report/report.css')) &&
    /* And no component here declares a roster — the tell is a row literal naming a spine's own column. */
    !/generator: '|facility: '|quarter: '/.test(prReport + prBlocks + prUi),
  'a figure compiled into a component is a stored result wearing a live report’s chrome',
)

expect(
  'the report store keeps the requested id beside the report',
  /* Opening one report and then another before the first returns would leave the slower reply on screen
     under the newer heading — one report's tiles below another's title, which reads as data. */
  /openId: reportId/.test(prStore) &&
    (prStore.match(/if \(get\(\)\.openId !== reportId\) return/g) ?? []).length === 2 &&
    /* And it holds no figures of its own. */
    !/\.reduce\(/.test(codeOnly(prStore)),
  'a slow fetch would put one report’s figures under another’s heading',
)

/*
 * **One list, and it is the Library's.**
 *
 * The published reports were briefly a card grid of their own beside the prototype, reachable from a
 * switch at the top of the page — two lists of the same five definitions, which is two answers to "what
 * reports exist". The Library already lists them with an **Open report** button, so that button hands the
 * id over and the pane renders it. Asserted as the absence of a second list *and* the presence of the
 * hand-over, because half of this is a Library whose Open button does nothing.
 */
expect(
  'the published report opens out of the Library, and there is no second list',
  /* The pane renders one report and nothing else — no grid, no summaries, no card. */
  /const openId = useReportsStore\(\(s\) => s\.openId\)/.test(prPane) &&
    /<PublishedReport report=\{report\} \/>/.test(prPane) &&
    /Back to Library/.test(prPane) &&
    !/selectReportSummaries|prs-grid|Open report/.test(codeOnly(prPane)) &&
    /* Nothing open renders nothing, so the Library is what the reader sees. */
    /if \(!openId\) return null/.test(prPane) &&
    /* The deleted grid stays deleted: a partial revival is a second list again. */
    !existsSync(join(root, 'src/components/report/PublishedReports.tsx')),
  'two lists of one set of definitions is two answers to what exists',
)

expect(
  'Open report reads the published one and Edit still authors',
  /* Two buttons that ran the same function now do what their labels say. `Open` on a governed row hands
     the id to the host, which renders the tenant's own figures; `Edit` still loads the authoring
     definition behind the row. Absent the callback the prototype behaves exactly as it did standing
     alone, which is what keeps the vendored folder honest. */
  /*
     * The callback now carries the row's rendered page beside its id, because Open has two honest
     * destinations: the tenant's own rendered document where the package ships one, and the in-app
     * render where it does not. Both are still *reading* — Edit is the one that authors — so the fact
     * this claim guards is unchanged and only the signature grew.
     */
  /onOpenPublished\?: \(reportId: string, renderedHref: string \| null\) => void;/.test(
    read('src/reports/App.tsx'),
  ) &&
    /if \(!forEdit && onOpenPublished\) \{/.test(read('src/reports/App.tsx')) &&
    /onOpenPublished=\{\(reportId\) => void openReport\(reportId\)\}/.test(reportsPage) &&
    /* One of the two is mounted, never both: the prototype's toast and popover hosts portal to
       `document.body`, and a second copy is how Delete came to look like a dead button once already. */
    /\{openReportId \? <PublishedReportPane \/> : null\}/.test(reportsPage) &&
    /* The prototype branch also waits on its dataset now, so the condition names all four states. */
    /openReportId \|\| !hydrated \|\| prototypeError \|\| hydrationError \? null : \(/.test(reportsPage) &&
    /* No switch came back, and no route per report: `/reports` is one address. */
    !/Segmented/.test(codeOnly(reportsPage)) &&
    !/path: 'reports\//.test(read('src/routes.tsx')),
  'a page per report is the section that was deliberately removed',
)

/*
 * **The persona is not served to the section.** It was a strip above the grid; that was
 * removed, so the payload stopped carrying it. `db.reports.meta` is still read on this side —
 * `entity_plural` labels a computed tile and names the rows a chart dropped, `source_trace`
 * is on every report — which is exactly why the *unrendered* half must not be sent: a
 * payload field nothing prints is the one that gets printed later by accident.
 */
/* `reportsList` takes the reading role now, so the slice cannot assume an empty parameter
   list — a claim keyed to a signature breaks the moment the function grows an argument. */
const reportsListBody =
  /const reportsList = \([^)]*\) => \(\{[\s\S]*?\n\}\)/.exec(server)?.[0] ?? ''
expect(
  'the section payload carries no persona, and the server still uses one',
  reportsListBody.length > 0 &&
    !/^\s*meta:/m.test(reportsListBody) &&
    !client.includes('personaName') &&
    /db\.reports\.meta\.entity_plural/.test(server) &&
    /source_trace: db\.reports\.meta\.source_trace/.test(server),
  reportsListBody.length === 0
    ? 'reportsList was not found — this check cannot run'
    : 'nothing renders the persona, so nothing is sent it',
)

/*
 * **The Library is one grid of governed definitions.**
 *
 * Written and composed reports are the same kind of thing here — a question somebody is
 * accountable for — so they are listed together, from the server's governance list, and told
 * apart by `kind` rather than by which array they arrived in. Two grids was the earlier model and
 * it put the same composed report in both when the second one was added.
 *
 * Each still opens at its own URL: a written definition at `/reports/:reportId`, a composed one at
 * `/reports/saved/:savedId`.
 */

/*
 * **Three tabs, and the governance behind them is the server's arithmetic.**
 *
 * Library says what exists, Author says who may write one, Operations & audience says how both are
 * governed. Every count, cell and check on them is computed in `reportGovernanceView` on each
 * request — a chip that counted its own filtered array would be a second answer to "how many are
 * published", and a governance grid is the worst place to have two.
 */
const govBody = /const reportGovernanceView = \(asRole\) => \{[\s\S]*?\n\}/.exec(server)?.[0] ?? ''
expect(
  'the governance figures are computed per request, not stored',
  govBody.length > 0 &&
    /const count = \(key\) =>/.test(govBody) &&
    /entitled_count: rows\.filter\(entitledTo\)\.length/.test(govBody) &&
    /* And `db.reports.governance` holds decisions only — no count, no cell, no check. */
    !/count:\s*\d/.test(JSON.stringify(db.reports.governance)),
  govBody.length === 0
    ? 'reportGovernanceView was not found — this check cannot run'
    : 'a chip that counted its own filtered array would be a second answer',
)

/*
 * **The two gates are never collapsed into one, and gate 2 admits it is not applied.**
 *
 * Gate 1 is who may see that a report exists; gate 2 is which rows a predicate admits. The notes
 * that say so are served, so the components render them rather than holding a second copy — and
 * gate 2's says **declared, not applied**, because no roster in this prototype is filtered per
 * persona and a silent predicate would claim a filter that never ran.
 */

/*
 * `db.reports.governance` is required, and nested — the same reason
 * `graph_studio.sanity_checks` is. Losing it does not throw: the Library would render with no
 * lifecycle chips and the Operations tab with no gates, and an ungoverned report section reads as
 * a section with nothing to govern.
 */
expect(
  'the governance block is required at boot, and the seed refuses to write a broken one',
  /isObject\(v\.governance\) &&/.test(server) &&
    /Array\.isArray\(v\.governance\.data_scope\)/.test(server) &&
    /seed-report-governance: refusing to write/.test(read('scripts/seed-report-governance.mjs')) &&
    /has no data scope row/.test(read('scripts/seed-report-governance.mjs')),
  'refused at boot, and refused at the seam that writes it',
)

/*
 * **The Library's lifecycle chips: one pool, one count, and no state without a home.**
 *
 * The chip bar is `governance.statuses` — the states the tenant declares, plus a leading
 * `current` the server computes as everything not archived. Three ways this goes quietly wrong,
 * so three claims.
 */
const seed = read('scripts/seed-report-governance.mjs')
const stateKeys = db.reports.governance.statuses.map((s) => s.key)
expect(
  'every governed report sits in a declared lifecycle state',
  stateKeys.length > 0 &&
    db.reports.governance.reports.length > 0 &&
    db.reports.governance.reports.every((r) => stateKeys.includes(r.status)) &&
    /* Refused at boot and at the seam that writes it — a status with no state has no label, so
       the card prints the raw key, and it matches no chip, so every other chip under-counts. */
    /v\.governance\.statuses\.some\(\(s\) => s\.key === g\.status\)/.test(server) &&
    /which is not one of the lifecycle states/.test(seed),
  `${stateKeys.length} states, ${db.reports.governance.reports.length} definitions: ` +
    db.reports.governance.reports.map((r) => `${r.report_id}=${r.status}`).join(' '),
)
expect(
  'a state declares its own label and tone, and the server keeps no second copy',
  db.reports.governance.statuses.every((s) => s.key && s.label && s.tone) &&
    /* Read from the pool, not from a map beside it: a state tinted `warn` on a card and
       `neutral` on the chip counting it is two answers to what the state is. */
    /const reportStatusTone = \(key\) => reportState\(key\)\?\.tone/.test(server) &&
    !/REPORT_STATUS_TONE/.test(server) &&
    /* And each state the pool declares needs its own entitlement cell, or it falls through the
       chain into the archived one — which tells an audience it can open something unpublished. */
    stateKeys
      .filter((k) => k !== 'archived')
      .every((k) => new RegExp(`governanceRow\\.status === '${k}'`).test(server)),
  `tones from the pool: ${db.reports.governance.statuses.map((s) => `${s.key}/${s.tone}`).join(' ')}`,
)
/*
 * **One list, and one rule that both counts it and filters it.**
 *
 * The Library was two grids under two headings — governed definitions, then reports saved in this
 * session — and is now a single list holding both. That merge is what moved the chip counts off the
 * server: it cannot count rows nobody has told it about, so a served count beside a list holding
 * session reports would be counting something else. The *pool* is still the server's — keys, labels,
 * tones, order — and the count comes from the same `inState` the grid filters with, so a chip cannot
 * say five while the grid shows six.
 *
 * A session report is deliberately **not** folded into the tenant's Published chip: it has been
 * submitted to nobody, so it answers to `SESSION` and its own pill still says what it is locally.
 */
const libraryPane = read('src/reports/panes/LibraryPane.tsx')
const chipBar = /<div className="rp-chipRow"[\s\S]*?\n {10}<\/div>/.exec(libraryPane)?.[0] ?? ''
expect(
  'the chip bar and the grid read one rule, over one list',
  chipBar.length > 0 &&
    /* Both call sites derive from `inState`, which is declared once. */
    (libraryPane.match(/inState\(cards, /g) ?? []).length === 2 &&
    /const inState = <T extends \{ stateKey: string \}>/.test(libraryPane) &&
    /const inView = showStates \? inState\(cards, activeState\)/.test(libraryPane) &&
    /\.map\(\(s\) => \(\{ \.\.\.s, count: inState\(cards, s\.key\)\.length \}\)\)/.test(libraryPane) &&
    /* The pool is still served, and a session row gets its own key rather than Published's. */
    /\.\.\.\(states \?\? \[\]\)/.test(libraryPane) &&
    /export const SESSION = 'session'/.test(libraryPane) &&
    /stateKey: SESSION/.test(libraryPane) &&
    /* And the two headings are gone — one grid, both kinds of card. */
    !/Governed definitions|Saved in this session/.test(libraryPane) &&
    /<GovernedCard/.test(libraryPane) &&
    /<SessionCard/.test(libraryPane) &&
    /* The page still hands the payload down; the prototype declares its shape rather than
       importing the client's, so it stands alone with no host. */
    /governance=\{data\?\.governance\}/.test(read('src/pages/ReportsPage.tsx')),
  chipBar.length === 0
    ? 'the chip bar was not found — this check cannot run'
    : 'one rule, one list, and the pool still the server’s',
)

/*
 * **A list that is merely shorter is not an answer.**
 *
 * A report is a definition (`db.reports.reports`, ingested) plus the decision to govern it
 * (`governance.reports`, seeded). Delete drops the second and the row leaves the Library with nothing
 * saying why — which reads as data loss, and twice sent "Report N is missing" at a section whose own
 * file still held it. So the gap is computed and named, with the command that ends it, and the page
 * states it above the list. It covers the stale-process case too: a server serving an older `db.json`
 * from memory reports which definition it is short.
 */
expect(
  'a definition nothing governs is named, with the way to restore it',
  /* Computed from the two collections, never stored. */
  /const ungoverned = db\.reports\.reports\r?\n\s*\.filter\(\(r\) => !db\.reports\.governance\.reports\.some/.test(server) &&
    /restore: 'npm run seed:governance'/.test(server) &&
    /* Typed and validated, so a stale server that omits it fails at the boundary rather than in a
       render — and the field is not `nullable`, because an empty list is the normal answer. */
    /ungoverned: arrayOf\(shape\(\{ report_id: str, report_tag: str, title: str \}\)\)/.test(client) &&
    /* Rendered, and the component keeps no copy of the command. */
    /ungoverned\.map\(\(r\) => `\$\{r\.reportTag\} — \$\{r\.title\}`\)/.test(libraryPane) &&
    /<code>\{restore\}<\/code>/.test(libraryPane) &&
    !/npm run seed:governance/.test(codeOnly(libraryPane)) &&
    /* And it says the other thing that causes it, because a re-seed does not fix a stale process. */
    /older copy from memory/.test(libraryPane),
  'computed, served, rendered — and the command is the server’s string',
)

/*
 * **A published report's name is how its audience refers to it, so two cannot share one.**
 *
 * Checked across the whole list — governed definitions and session reports alike, because they sit in
 * one grid — and in **one** place, because two copies of "is this name taken" is how a dialog accepts
 * a name the save then rejects. The dialog checks as you type: a collision found only on submit closes
 * the dialog and loses the name.
 */
const libraryLib = read('src/reports/lib/library.ts')
const reportsAppSrc = read('src/reports/App.tsx')
expect(
  'a name already published is refused, by one rule both writers use',
  /export function nameProblem\(/.test(libraryLib) &&
    /* Only published names are reserved, and case and space do not make a name different. */
    /t\.published && t\.id !== excludeId && t\.name\.trim\(\)\.toLowerCase\(\) === key/.test(libraryLib) &&
    /* Both halves of the list feed it. */
    /\.\.\.\(governance\?\.reports \?\? \[\]\)\.map/.test(reportsAppSrc) &&
    /\.\.\.library\.map\(\(r\) => \(\{ id: r\.id, name: r\.name, published: r\.status === 'published' \}\)\)/.test(reportsAppSrc) &&
    /* And both writers ask it — the dialog live, Save draft before it writes. */
    /nameProblem=\{problemFor\}/.test(reportsAppSrc) &&
    (reportsAppSrc.match(/problemFor\(name\)/g) ?? []).length === 2 &&
    /const problem = nameProblem\?\.\(trimmed\) \?\? null/.test(read('src/reports/components/PublishDialog.tsx')),
  'one rule, checked live in the dialog and again by the writer',
)

/*
 * The approval is off the card, and only off the card. It is still on the payload, and the Operations
 * tab's audit rows and publish checks still read it — what was removed is restating it in a list whose
 * job is to say what each report is and who can see it.
 */
const governedCard = read('src/reports/panes/GovernedCard.tsx')
const governedCardCode = codeOnly(governedCard)
expect(
  'the report card states no approval, and the server still records one',
  /*
   * The *field* is not read and the label is not printed. Not a bare search for "approval": the card
   * still says **Access pending approval**, which is a different thing entirely — the access state a
   * reader who is not in the audience sees, and one this section is required to show.
   */
  !/r\.approval/.test(governedCardCode) &&
    !/Approval:/.test(governedCardCode) &&
    /\{r\.schedule\}/.test(governedCardCode) &&
    /* Still computed and still served, so removing it from the card removed nothing else. */
    /approval: governanceRow\.approval/.test(server) &&
    /label: 'Approval recorded'/.test(server),
  'removed from the card, kept in the payload',
)

/*
 * **`db.reports` is rebuilt wholesale by the ingest, so everything else that writes into it has to
 * be carried forward there.**
 *
 * `db.reports = { … }` is a delete of every key not listed. `saved` was carried by hand; `governance`
 * was added later by a different script and was not, so a re-ingest would have dropped every
 * audience and data-scope row. The list is read off the validator rather than remembered, so a key
 * required later is covered without editing this claim.
 */
const ingestReports = read('scripts/ingest-reports.mjs')
const ingestLiteral = /db\.reports = \{[\s\S]*?\n\}/.exec(ingestReports)?.[0] ?? ''
/*
 * The keys `validateDb` demands under `reports` — read from that branch of `DB_SHAPE` and nowhere
 * else, so the list is the validator's rather than one kept here. It is the last entry in the
 * object, so the slice is anchored on the *next declaration* rather than on a brace: a brace at that
 * indent appears several times inside the branch itself.
 *
 * `\r?\n`, never a bare `\n` — these files check out with CRLF on Windows, and the first version of
 * this claim matched nothing and reported it as "0 of 0 keys, all carried" until the cannot-run
 * guard caught it.
 */
const reportsBranch =
  /* `(v, empty)` since a secondary dataset may hold an empty collection where the primary may not —
     matched loosely on the parameter list so the branch is still found if that changes again. */
  /\r?\n {2}reports: \(v[^)]*\) =>[\s\S]*?\r?\n\}\r?\n\r?\nconst DB_HINTS/.exec(server)?.[0] ?? ''
const requiredUnderReports = [...reportsBranch.matchAll(/\bv\.([a-z_]+)\b/g)].map((m) => m[1])
expect(
  'every key the report section requires survives a re-ingest',
  ingestLiteral.length > 0 &&
    requiredUnderReports.length > 5 &&
    /* `key:` or the shorthand `key,` — the ingest writes `reports,` from a local of that name. */
    [...new Set(requiredUnderReports)].every((key) =>
      new RegExp(`\\b${key}\\s*[:,]`).test(ingestLiteral),
    ) &&
    /* And it refuses rather than writing a document the server cannot boot. */
    /refusing to write — db\.reports\.governance is missing/.test(ingestReports),
  ingestLiteral.length === 0 || requiredUnderReports.length <= 5
    ? 'the ingest literal or the validator branch was not found — this check cannot run'
    : 'dropped by the re-ingest: ' +
      ([...new Set(requiredUnderReports)]
        .filter((key) => !new RegExp(`\\b${key}\\s*[:,]`).test(ingestLiteral))
        .join(', ') ||
        'nothing, so it is the refusal message that is missing'),
)

/*
 * **A private audience is a decision, and the two surfaces that touch it want different rules.**
 *
 * Share can set `audience: []`, so the server has to boot with one — while the seed still refuses an
 * empty audience, because there it can only be a typo. And the publish check tests that every
 * persona the audience *names* resolves, so private passes and what fails is an audience naming a
 * persona that was removed under it.
 */
expect(
  'an empty audience boots, the seed still refuses one, and the publish check reads integrity',
  /* Not `length > 0` any more — a Share-to-nobody would have failed the commit. */
  !/governance\.reports\.every\([\s\S]*?g\.audience\.length > 0/.test(server) &&
    /Array\.isArray\(g\.audience\),/.test(server) &&
    /is entitled to nobody — seed an audience/.test(seed) &&
    /pass: r\.audience_named === r\.entitled_roles\.length/.test(server) &&
    /private - shared with nobody/.test(server),
  'the seed and the API want different invariants on one field, deliberately',
)

/*
 * **The three acts on a row, and the claims they cannot be built without.**
 *
 * Share, Authorize and Delete. All three commit, because all three are somebody's decision — a
 * restart clears which graph is live and it must not clear who a report was shared with, what state
 * it is in, or that it was removed. None of them is access control, which the picker says on the page
 * in those words.
 */
const sharePicker = read('src/reports/components/SharePicker.tsx')
const reportsApp = read('src/reports/App.tsx')
const reportsCss = read('src/pages/ReportsPage.css')
expect(
  'Share and Delete both commit, and each answers with the governance view',
  /match: \(p\) => \/\^\\\/reports\\\/governance\\\/\[\^\/\]\+\\\/audience\$\//.test(server) &&
    /match: \(p\) => \/\^\\\/reports\\\/governance\\\/\[\^\/\]\+\\\/status\$\//.test(server) &&
    /match: \(p\) => \/\^\\\/reports\\\/governance\\\/\[\^\/\]\+\$\//.test(server) &&
    /* Committed rather than in memory: a restart must not forget who a report was shared with. */
    (server.match(/commitDb\(\{/g) ?? []).length > 0 &&
    /*
     * **Three writes, and one reader of the role.** A write cannot answer with somebody else's view,
     * so each one re-reads through `reportRoleFrom(query)`. Counted rather than merely present: the
     * number is what catches a fourth act added without that reader, which would serve the caller a
     * governance view filtered for nobody.
     */
    (server.match(/governance: reportGovernanceView\(reportRoleFrom\(query\)\)/g) ?? []).length === 3 &&
    /* Delete drops the governance row and says how to get it back. */
    /restore: 'node scripts\/seed-report-governance\.mjs'/.test(server) &&
    /this is the last governed definition/.test(server),
  'two writes, one reader of the role, and a delete that admits it is reversible',
)
expect(
  'the picker renders the served role pool and says it is not access control',
  /* No copy of the four personas here — the pool arrives as a prop from `GET /auth/roles`. */
  !/business_user_executive|domain_architect|platform_admin/.test(sharePicker) &&
    /roles\.map\(\(role\) =>/.test(sharePicker) &&
    /not access control/.test(sharePicker) &&
    /createReadStore\(listAuthRoles\)/.test(read('src/pages/ReportsPage.tsx')) &&
    /* Its own component, or `renderToString` renders it closed and every assertion about it is
       vacuous — the `ConnectSourceWizard` rule. */
    /import \{ ShareDialog, type ShareRole \} from '\.\/components\/SharePicker'/.test(reportsApp),
  'the pool is served, the caveat is on the page, and the panel is assertable',
)

/*
 * **The Share picker is a dialog at the page's root, and nothing in a card may expand.**
 *
 * It began as a panel inline under the row it changed. The grid's cards are equal-height with their
 * action row pinned by `margin-top: auto`, so a card that grew by 400px stretched every sibling in
 * its row and left four cards with a chasm between their text and their buttons — the second time
 * this repo has met that trap. The guard is structural: the pane must hold neither the picker nor a
 * dialog, and `App` must render it beside `PublishDialog`.
 */
expect(
  'the share picker cannot stretch the grid it was opened from',
  /*
   * The pane opens it and never *renders* it — keyed on the JSX and on the dialog chrome, not on the
   * module name: the pane still imports `ShareRole` as a type to name the roles a row is shared with,
   * and forbidding that would be keying the claim to a spelling rather than to the fact.
   */
  !/<SharePicker|<ShareDialog|modalBack/.test(libraryPane) &&
    /onShareGoverned\?\(row: GovernedRow\): void/.test(libraryPane) &&
    /<ShareDialog/.test(reportsApp) &&
    /* Held at App level beside the other dialog, not inside the pane. */
    /const \[sharing, setSharing\] = useState/.test(reportsApp) &&
    /* And a label may wrap the row, never itself — four buttons in a 275px column broke every one. */
    /white-space: nowrap/.test(reportsCss) &&
    /minmax\(400px, 1fr\)/.test(reportsCss) &&
    /cards rp-govGrid/.test(libraryPane),
  'a dialog at the root, a wider column, and labels that do not break',
)

/*
 * **The pending-approval state was removed, and it must not creep back half-built.**
 *
 * A row once carried an `access` block — whether the calling role could open it, and what it had
 * requested — and a reader outside the audience saw *Request access* / *Access pending approval*
 * instead of the four actions. It was removed on request. What is dangerous is a partial revival: a
 * card that gates on `access` while the payload no longer sends one renders a row with no actions at
 * all, which is exactly the symptom that prompted the removal.
 *
 * So this asserts the absence on every layer at once. Re-adding it deliberately means deleting this
 * claim in the same commit; `docs/REGRESSIONS.md` records what it looked like.
 */
expect(
  'the pending-approval state is gone from the payload, the client and the card',
  /*
   * Server: no per-row access, and no endpoint to ask on. **Comments stripped** — the note in
   * `validateDb` explaining that `access_requests` is no longer required names the key it removed,
   * and this claim failed on that prose the first time it ran. Same lesson as the approval claim.
   */
  !/reportAccessFor|access-requests|access_requests|may_request/.test(codeOnly(server)) &&
    /* Client: no schema field, no type, no fetcher — a stale one would fail every read. */
    !/requestReportAccess|may_request|mayRequest/.test(codeOnly(client)) &&
    /* Card: the state is gone and the actions are unconditional. */
    !/Access pending approval|Request access|rp-access|r\.access/.test(governedCardCode) &&
    /* And the styles that positioned it went too, rather than sitting dead in the sheet. */
    !/rp-access/.test(reportsCss) &&
    /* The audience is still *stated* — removing the gate must not remove the fact. */
    /nobody — private/.test(governedCardCode) &&
    /entitledRoles\.map/.test(governedCardCode),
  'removed on every layer; the audience is stated and gates nothing',
)

/*
 * Delete drops a governance row, and the confirmation says what actually happens rather than "gone for
 * good" — the definition is the package's and `npm run seed:governance` re-authors every row. The copy
 * lives in an `OptionList` inside a popover that does not exist until clicked, so nothing rendered can
 * assert it; this is the guard.
 */
expect(
  'Delete promises only what it does, and names the way back',
  /npm run seed:governance/.test(governedCardCode) &&
    !/gone for good/.test(governedCardCode) &&
    /* And the script it names exists. */
    /"seed:governance": "node scripts\/seed-report-governance\.mjs"/.test(read('package.json')) &&
    /* The server says the same thing in its reply. */
    /restore: 'node scripts\/seed-report-governance\.mjs'/.test(server),
  'the confirmation, the script and the server’s reply all name one command',
)

/*
 * The four report surfaces that used to be checked here — the section, one report, a saved
 * report and the wizard — are gone with the UI. The rule they enforced (publication is the
 * only gate; a connected source is never a second one) now has one surface left, checked
 * below, plus the server-side claim above that all the gated routes test publication alone.
 */

/*
 * The What-if lens is gated on publication too, and shares the empty state. Two components
 * describing one precondition drift; one cannot.
 */
const noPublished = 'src/components/NoPublishedGraph.tsx'
expect(
  'the publish gate is one component, and the lens still uses it',
  existsSync(join(root, noPublished)) &&
    read('src/pages/WhatIfPage.tsx').includes('NoPublishedGraph'),
  'the report pages that shared it are gone; the wrapper and the lens remain',
)
expect(
  'and it names the fix that applies, which differs by what exists',
  read(noPublished).includes('builtCount') && read(noPublished).includes('draftCount'),
  '"publish the build you have" and "nothing is built yet" are different next actions',
)

/*
 * The summary Catalog is the prototype's ten tiles re-expressed as data, so the server
 * has to implement every aggregation and format it names. One it does not would render as
 * a blank tile beside three figures, which reads as a zero.
 */
/* `
?
`, never a bare `
` — these files check out with CRLF, so a bare newline matched
   nothing and this reported "REPORT_AGGS was not found" while the constant sat right there. */
const aggBody = /const REPORT_AGGS = \{([\s\S]*?)\r?\n\}/.exec(server)?.[1] ?? ''
const fmtBody = /const REPORT_FORMATS = \{([\s\S]*?)\r?\n\}/.exec(server)?.[1] ?? ''
const implemented = {
  aggs: new Set([...aggBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])),
  formats: new Set([...fmtBody.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])),
}
/*
 * **A tile's aggregation and format are the server's to implement; the field it reads is the
 * roster's to carry, and those are two different claims.**
 *
 * This checked all three against the generator register, which assumed the register carries every
 * measure the summary Catalog names. Northline's does not, and is not meant to: its register is a
 * dimension roster (region, budget category, business unit, phase) while its 24 tiles read plan-cube
 * measures — `m_actual`, `m_eac_variance` — that `reports.data` does not hold. That is why
 * `reportBuild` withholds a generated summary there rather than summing absent fields to a confident
 * zero.
 *
 * So the *implementation* half is checked for every tenant, and the *field* half only against a
 * roster that carries any of them at all.
 */
const registerRosterKey = reports.register?.roster ?? 'generators'
const tileRow = (reports.data[registerRosterKey] ?? [])[0] ?? {}
const tileFieldsCarried = reports.summary_catalog.some((t) => t.field !== null && t.field in tileRow)
/*
 * **A tile only has to be implementable if it could ever be computed.**
 *
 * Northline's 24 tiles name aggregations and formats this server does not have (`derived`, `usd`,
 * `pct`) — and it never reaches them, because their fields are not on the register and `reportBuild`
 * withholds the summary rather than summing absent columns to zero. Implementing them would be dead
 * code written to satisfy a check. So the implementation half is asserted where a summary can
 * actually be produced, and where it cannot, the assertion is that the server really does withhold it
 * — which the claim below states, and which is the fact that makes the rest safe.
 */
const brokenTiles = !tileFieldsCarried
  ? []
  : reports.summary_catalog.filter(
      (t) =>
        !implemented.aggs.has(t.agg) ||
        !implemented.formats.has(t.format) ||
        (t.field !== null && !(t.field in tileRow)),
    )
expect(
  'every summary tile aggregates and formats in a way the server implements',
  aggBody.length > 0 && fmtBody.length > 0 && brokenTiles.length === 0,
  aggBody.length === 0
    ? 'REPORT_AGGS was not found in server.mjs — this check cannot run'
    : brokenTiles.length > 0
      ? `broken: ${brokenTiles.map((t) => t.key).join(', ')}`
      : `${reports.summary_catalog.length} tiles · ${implemented.aggs.size} aggregations · ` +
        `${implemented.formats.size} formats` +
        (tileFieldsCarried
          ? ''
          : ` · the ${registerRosterKey} register carries none of their measures`),
)
/*
 * And where the rows carry none of them, the server has to *withhold* the summary rather than
 * compute one. `REPORT_AGGS.sum` coerces an absent field to 0, so the failure this guards is a full
 * strip of confident zeros under a real heading — a wrong figure where an absent one was available.
 */
expect(
  'a summary the rows cannot support is withheld, not summed to zero',
  /\? reportSummary\(summaryKeys, asked\.rows\)/.test(server) &&
    /read measures the \$\{report\.spine\} rows do not carry/.test(server),
  'reportBuild checks every tile field against a row before offering a generated summary',
)
/*
 * **A default summary naming a tile the Catalog does not have would render as a blank strip**, so the
 * names are checked rather than assumed. An **empty** default is a different fact and a legitimate
 * one: this tenant's reports each name their own `summary_keys`, and `adopt:capex` drops any default
 * key the Catalog cannot serve rather than leaving it to fail at render.
 */
expect(
  'and the default summary names tiles that exist',
  reports.summary_default.every((k) => reports.summary_catalog.some((t) => t.key === k)),
  reports.summary_default.length > 0
    ? reports.summary_default.join(', ')
    : 'no section default — each report names its own summary keys',
)

/*
 * A generated report's tiles are computed, and say so. The authored tiles describe the
 * written report over the whole register; showing them against a narrowed frame would
 * attribute the tenant's figures to a question they never answered.
 */
expect(
  'a computed tile is labelled as computed',
  /unit: 'computed for this frame'/.test(server),
  'the built payload labels every tile it recomputed for a frame',
)

/*
 * The horizon is the one assumption that filters nothing, and the app says so twice —
 * where it is chosen and in the built report's caveats. Claiming a time filter that never
 * ran would be the most quotable false statement on the page.
 */
const scopesBody = /const REPORT_SCOPES = \{([\s\S]*?)\n\}/.exec(server)?.[1] ?? ''
const frameRowsBody = /function reportFrameRows\([\s\S]*?\n\}/.exec(server)?.[0] ?? ''
expect(
  'the horizon is declared, not applied — and nothing filters by it',
  /const REPORT_HORIZON_CAVEAT =/.test(server) &&
    /* Twice: on the read-back and on the built report. The built one now leads a list —
       a saved report's graph can add a caveat of its own — so the count is of the
       constant's *use*, not of one exact line. */
    (server.match(/REPORT_HORIZON_CAVEAT,?\r?\n?\s*\]?/g) ?? []).length >= 3 &&
    scopesBody.length > 0 &&
    !scopesBody.includes('horizon') &&
    frameRowsBody.length > 0 &&
    !frameRowsBody.includes('horizon') &&
    claude.includes('The horizon is declared, not applied'),
  'stated on the read-back and on the built report; the row filters never read it',
)

/*
 * A saved report is a question. Storing a figure would cache an answer that goes stale
 * silently — the same rule the What-if library follows, and the reason both are stored as
 * ids rather than results.
 */
const savedRow = /const row = \{([\s\S]*?)\n      \}/.exec(server)?.[1] ?? ''
expect(
  'a saved report stores its frame and no figures',
  savedRow.length > 0 &&
    savedRow.includes('...frame') &&
    !/tiles|blocks|rows|value/.test(savedRow) &&
    /commitDb\(\{ \.\.\.db, reports: \{ \.\.\.db\.reports, saved \} \}\)/.test(server),
  savedRow.length === 0
    ? 'the saved row literal was not found — this check cannot run'
    : 'the frame and the question, through commitDb, so it survives a restart',
)
expect(
  'and a re-ingest carries the library forward',
  /saved: db\.reports\?\.saved \?\? \[\]/.test(reportsIngest),
  'overwriting it would delete saved questions on the next ingest',
)

/*
 * Reading a question back is paced; building is not. The first is the model-shaped act the
 * copy promises ("I'll read it back"); the second is a read over the rosters, like a
 * What-if scenario, and pacing it would teach that a traversal costs what a model does.
 */
const readRoute = /match: \(p\) => p === '\/reports\/read'[\s\S]*?\n  \},/.exec(server)?.[0] ?? ''
const buildRoute = /match: \(p\) => p === '\/reports\/build'[\s\S]*?\n  \},/.exec(server)?.[0] ?? ''
expect(
  'the read-back is paced and the build is not',
  readRoute.includes('SUGGEST_MS') && buildRoute.length > 0 && !/_MS/.test(buildRoute),
  'a picked standard report is not paced either — the chip is the answer',
)
expect(
  'and the read-back returns no figures',
  readRoute.length > 0 && !/tiles|blocks/.test(readRoute),
  'nothing runs against the data until the sentence is confirmed',
)

/* The wizard's route-order claim went with the wizard. The rule it followed — declare the
   specific path before the dynamic one, never rely on ranking — is still asserted by the
   full-window canvas claim further down, which is where this repo learned it. */

/* ---------------- reports: the graph, the template, and a saved report ---------------- */

/*
 * A report is asked *of a published graph*, so the graph is part of the frame and the
 * server refuses one that is not live. Defaulting silently to whatever is newest would
 * attribute the figures to content nobody picked — the same class of quiet substitution as
 * a matcher answering a question nobody asked.
 */
expect(
  'the frame names the graph a report is asked of, and an unpublished one is refused',
  /use_case_id: body\.use_case_id \? String\(body\.use_case_id\) : null/.test(server) &&
    /is not a published graph — published:/.test(server) &&
    client.includes('use_case_id: frame.useCaseId'),
  'chosen on step 1, carried through read → build → save',
)
expect(
  'and the API offers every published graph, not just the newest',
  /const reportGraphs = \(\) =>/.test(server) &&
    /graphs: reportGraphs\(\)/.test(server),
  'the payload lists them; a frame naming an unpublished one is refused',
)

/*
 * **One report template.** The package ships five rendered reports with a fixed anatomy,
 * and a report composed in the wizard is that same anatomy asked under a different frame.
 * When the layout lived in two files the wizard's copy had already drifted — no badge, its
 * own tag row, a different footer — which is two answers to "what does a report look like".
})

/*
 * Taking a standard report directly reads and builds it — and **stops there**, because the
 * one thing the app must not decide is what to call it. A row named by the app is one nobody
 * recognises a week later, and three of them read as duplicates rather than as three
 * questions. So `generate` does not save; the page asks for a name and the save is the
 * reader's act.
 */

/*
 * Who saved a report. The identity is client-held, so the route has to be *told* — the rule
 * the consent callback established, and the reason a malformed saved_by is a 400 rather
 * than a quietly recorded name.
 */
expect(
  'a saved report records who saved it, and is told rather than guessing',
  /is not an email — send the signed-in address as saved_by/.test(server) &&
    /saved_by: savedBy \?\? saved\[existing\]\?\.saved_by \?\? null/.test(server),
  'the identity is client-held, so the route has to be told',
)

/*
 * **And so does publishing.** Every "published by" line in the app — Ask, a report's footer,
 * the wizard's graph cards, the section's graph list — used to read `db.google_account`, the
 * seeded account, with no way for a reader to know it was not the person who pressed the
 * button. The publish route is now told `?as=`, keeps it per `useCaseId:sha`, and one helper
 * reports it: a second place deriving a publisher would be a second answer to "who".
 */
expect(
  'publishing records who did it, and every line reads that one record',
  /* One record per dataset — a publication is keyed by `useCaseId:sha256`, never by dataset, so a
     shared Map would let a CAPEX graph report an EPA publisher. See LIVE_SHAPE. */
  /const studioPublishedBy = liveContainer\('studioPublishedBy'\)/.test(server) &&
    /studioPublishedBy: 'map'/.test(server) &&
    /const publishedByFor = \(useCaseId\)/.test(server) &&
    /* Set *or cleared* on every publish: merging would credit the previous publisher for
       an anonymous re-publish, which a smoke run caught it doing. */
    /studioPublishedBy\.set\(`\$\{id\}:\$\{sha\}`, as\)/.test(server) &&
    /studioPublishedBy\.delete\(`\$\{id\}:\$\{sha\}`\)/.test(server) &&
    !/published_by: db\.google_account\.email/.test(server) &&
    (server.match(/published_by: publishedByFor\(/g) ?? []).length >= 2 &&
    client.includes('as ? `${path}?as=${encodeURIComponent(as)}`') &&
    read('src/store/graphStudioStore.ts').includes('useAuthStore.getState().identity?.email'),
  'told at publish time, with the tenant account as the fallback for an untold one',
)

/*
 * Opening a saved report re-asks it, and one whose graph has since been unpublished says so
 * instead of claiming live content answered it. Publication is in memory, so that is the
 * state after every restart.
 */
expect(
  'a saved report is re-asked, and an unpublished graph is reported not hidden',
  server.includes("match: (p) => /^\\/reports\\/saved\\/[^/]+$/.test(p)") &&
    /which is not published right now/.test(server),
  'the row holds a frame, so opening it and generating it are one act',
)
/* Its route-order claim went with the route — see the note where the report routes used to be
   asserted. The endpoint itself is still checked, above. */

/* ---------------- the What-if lens draws its graph references ---------------- */

/*
 * Two drawings — the pool's frame and one load's traversal — and **neither invents anything
 * it asserts**. The node types, their labels and their colours are the package's
 * (`graph_reference.node_types`); the frame's centre, its edge name and its cap are
 * `graph_reference.frame`; and a scenario's edges are built server-side with every label
 * taken from the graph's declared relationship list. A component picking a hue would be
 * inventing a legend, and an edge named in a component would claim a relationship the graph
 * may not have.
 */
const whatIfGraphSrc = read('src/components/WhatIfGraph.tsx')
const declaredRelationships = new Set(db.whatif.graph_reference.relationships)
const subgraphFn = /function whatifSubgraph\(generator\)[\s\S]*?\n\}/.exec(server)?.[0] ?? ''
const edgeLabels = [...subgraphFn.matchAll(/rel\('([A-Z_]+)'\)/g)].map((m) => m[1])
/*
 * **The traversal is only drawn for a tenant that has loads to admit, so that is what decides
 * whether its edge labels are checked.**
 *
 * `whatifSubgraph` builds one admitted load's traversal and names every edge from the graph's own
 * relationship list. Its labels are the hazardous-waste ontology's — `SHIPS_TO`, `ENFORCEMENT_AGAINST`
 * — and Northline's capital graph declares `AWARDED_TO`, `ISSUED_AT_VINTAGE` and twenty-one others,
 * none of them these. That is not a mismatch to fix by renaming: the function is never called there,
 * because the lens has no candidate roster and no load to traverse. Building the capital equivalent
 * is what the lever model is for.
 *
 * So where a roster exists the labels must all be declared, and where it does not the claim is that
 * the function has nothing to draw — never a silent skip.
 */
expect(
  'every edge the traversal draws is a relationship the graph declares',
  subgraphFn.length > 0 &&
    (db.whatif.generators.length > 0
      ? edgeLabels.length >= 4 && edgeLabels.every((l) => declaredRelationships.has(l))
      : String(db.whatif._not_applicable?.generators ?? '').trim().length > 0),
  subgraphFn.length === 0
    ? 'whatifSubgraph was not found — this check cannot run'
    : db.whatif.generators.length > 0
      ? `${edgeLabels.join(' · ')} — all in graph_reference.relationships`
      : 'no candidate roster, so no load is traversed and no edge is drawn — declared, not silent',
)
/*
 * Both readers of the palette, checked separately: the fill lookup and the legend. Asserting
 * the expression once passed while the *fill* had been swapped for a local palette and only
 * the legend still read the data — a claim that finds an expression somewhere does not say
 * where.
 */
const fillFn = /function fillFor\([\s\S]*?\n\}/.exec(whatIfGraphSrc)?.[0] ?? ''
const legendFn = /function Legend\([\s\S]*?\n\}/.exec(whatIfGraphSrc)?.[0] ?? ''
expect(
  'and the drawing takes its palette and its cap from the package',
  fillFn.includes('frame.graphReference.nodeTypes') &&
    fillFn.includes('riskColors') &&
    legendFn.includes('frame.graphReference.nodeTypes') &&
    whatIfGraphSrc.includes('rules.maxDrawn') &&
    whatIfGraphSrc.includes('rules.edge') &&
    /* The cap is stated on the drawing: seven standing for twenty-four is otherwise a
       silent sample, which is the rule the answer charts and the studio queue also keep. */
    whatIfGraphSrc.includes('first ${drawn.length} drawn'),
  'node types, their colours, the centre, the edge and the 7-node cap are all data',
)
/* Scoped to *this component*, not to the whole app's dependency list. `d3` is now a real
   dependency — the vendored graph viewer's force layout — so a package.json search says
   nothing about whether the lens draws its own SVG, which is the fact this guards. The
   rule still holds where it was written: nothing in the What-if drawing imports a
   library. */
expect(
  'the lens draws its own SVG rather than pulling a chart library',
  whatIfGraphSrc.includes('<svg') &&
    !/from '(?!\.|react)/.test(whatIfGraphSrc.replace(/from '\.\.\/api\/client'/g, '')) &&
    !/from '(d3|chart\.js|recharts)/.test(whatIfGraphSrc),
  'the same rule the answer charts follow — the studio canvas is now the one exception',
)
/* An absence has no circle: the nodes a scenario draws are conditional on what the
   generator carries, which is decided on the server and asserted here. */
expect(
  'a clean load draws no enforcement node and no document',
  /* Conditional on both sides: the node *and* its edge. Asserting only the node would pass
     over a diagram that drew an edge to something absent. */
  subgraphFn.includes('...(hasEnforcement') &&
    subgraphFn.includes('...(generator.consent_decree') &&
    (subgraphFn.match(/\.\.\.\(hasEnforcement/g) ?? []).length === 2 &&
    (subgraphFn.match(/\.\.\.\(generator\.consent_decree/g) ?? []).length === 2,
  'the same rule the studio canvas keeps for a relationship nobody proposed',
)

/* ---------------- a report's chip bar, and what a chip does ---------------- */

/*
 * **A chip re-asks the report; it never hides rows.**
 *
 * The tiles and the charts above a table are the server's figures. Filtering rows in the page
 * would leave them describing a set the table no longer shows — two answers on one screen,
 * which is the failure this whole section is built to avoid. So the chip hands the slice up,
 * the report is rebuilt under **the frame it states**, and every figure comes back computed
 * for that slice. `frame` exists on the payload in *values* for exactly this: reconstructing
 * a scope from its printed label would be guessing at what the report had already been told.
 */
expect(
  'a chip re-asks the report with its own frame, in values',
  /frame: \{[\s\S]*?report_id: report\.report_id/.test(server) &&
    /facets: reportFacetsFor\(report\.spine\)/.test(server),
  'recovering a scope from its printed label would be guessing at what it was told',
)
/* The claim that every report surface offered the chip bar went with those surfaces. What the
   server still owes a future UI is asserted above: the frame in values, and the facets. */

/*
 * Facets are per spine, and the frame validator asks the same function the chips came from.
 * Checking only the generator dictionary refused a facility's role and a quarter's year —
 * facets the report itself renders — so a chip would have offered a filter the API rejected.
 */
expect(
  'the facets the chips render are the facets a frame may filter by',
  /const reportFacetsFor = \(spine\) =>/.test(server) &&
    /const facets = reportFacetsFor\(report\.spine\)/.test(server) &&
    /facets: reportFacetsFor\(report\.spine\)/.test(server),
  'one function behind the chips and the refusal, so they cannot disagree',
)
/* The one facet whose value is not a column of its own still filters by the same rule. */
expect(
  'the trace flags filter by test, and the tests are the values the chips offer',
  /const REPORT_FLAG_TESTS = \{/.test(server) &&
    ['rejected', 'residue', 'out_of_state'].every((v) =>
      new RegExp(`${v}: \\(t\\) =>`).test(server),
    ),
  'rejected · residue · out-of-state — three columns, one control',
)

/*
 * The column form. Vertical bars exist for the one case horizontal loses — a short label over
 * a series that reads left to right — and the guard is that the *form* is still chosen by the
 * data: a long label falls back to bars however the payload asks.
 */
const answerChartSrc = read('src/components/AnswerChart.tsx')
expect(
  'a column chart falls back to bars when there are too many of them',
  /* The rule moved from label length to row count: a name is elided to fit under four
     columns, which is how the package draws its decree-bound generators, and thirty-six
     of them is what horizontal bars exist for. */
  answerChartSrc.includes("block.chart === 'column' && data.length <= 8") &&
    /function Columns\(/.test(answerChartSrc) &&
    /d\.label\.length > 16/.test(answerChartSrc) &&
    claude.includes('column'),
  'the form comes from the data’s job, not only from the field',
)

/* ---------------- a report renders like the rendered report ---------------- */

/*
 * Three ways the app's register drifted from the package's, all of them visible side by side:
 * the table showed the starter's six columns where the rendered report prints ten, every bar
 * was one hue where the package colours by risk tier, and the drawing sat at answer width in a
 * card twice as wide with its title printed above it a second time.
 */
/*
 * **This is a claim about EPA's `risk` report, and it runs where that report is.** It compares the
 * app's register table to the columns the package's rendered HTML prints. A tenant without that
 * report has nothing to compare, and asserting it anyway reported an empty column list as a drift.
 * The resolved reports carry their own column labels inside each block, which the claim below covers.
 */
const riskReport = db.reports.reports.find((r) => r.report_id === 'risk')
const registerCols = riskReport?.blocks.find((b) => b.type === 'table')?.cols ?? []
expect(
  'the register tabulates the columns its rendered report prints',
  riskReport
    ? registerCols.length === 10 &&
      ['evals', 'enf', 'tons', 'manifests'].every((k) => registerCols.includes(k)) &&
      reportsIngest.includes('const TABLE_COLS')
    : true,
  riskReport ? registerCols.join(', ') : 'this tenant has no "risk" register report to compare',
)
expect(
  'a bar may carry its row’s risk tier, and only a state may vary the hue',
  /tone: r\.risk === 'high' \? 'crit'/.test(server) &&
    /const TONE_HUE = \{/.test(answerChartSrc) &&
    /fill=\{d\.tone \? TONE_HUE\[d\.tone\] : DATA_HUE\}/.test(answerChartSrc),
  'length still encodes the value; the table beside it repeats the tier with an icon',
)
/*
 * The scorecard is **one grouped chart**, not one per measure.
 *
 * Evaluations beside violations per facility *is* the comparison the report makes; two separate
 * charts make it two findings a reader has to hold at once. Two hues here encode two series and
 * the legend names both — the second of the two things allowed to vary a magnitude chart's hue,
 * the other being a point's state. And it keeps **roster order**: sorting by size would bury
 * the facility the scorecard is about wherever its number falls.
 */
expect(
  'the facility scorecard draws one grouped chart in roster order',
  /function reportGroupedChart\(report, keys, title\)/.test(server) &&
    /chart: 'grouped'/.test(server) &&
    /series: keys\.map/.test(server) &&
    /* No sort in it: the rows are the roster's, unlike the ranked bars. */
    !/reportGroupedChart[\s\S]{0,600}\.sort\(/.test(server) &&
    /function Grouped\(\{ block \}/.test(answerChartSrc) &&
    answerChartSrc.includes("block.chart === 'grouped' && (block.series?.length ?? 0) > 1"),
  'two series, a legend, and the subject first',
)
expect(
  'and its values table carries every series',
  /block\.series && block\.series\.length > 1/.test(answerChartSrc) &&
    (answerChartSrc.match(/block\.series && block\.series\.length > 1/g) ?? []).length === 2,
  'the header row and the value cells both, or the table describes one measure of two',
)

expect(
  'a report’s chart is drawn at report width, and the cap follows it',
  /width: 900,/.test(server) &&
    answerChartSrc.includes('const width = block.width ?? 520') &&
    /* Every SVG form caps its own upscale — bars, columns and the line. Asserting the
       expression once passed while one of the three had had its cap removed. */
    /* Every drawing caps its own upscale. The ring caps at its own size rather than a
       `width` prop, so the count is of caps, not of the one spelling. */
    (answerChartSrc.match(/maxWidth: (width|size)/g) ?? []).length ===
      (answerChartSrc.match(/<svg/g) ?? []).length,
  'the viewBox grows rather than the cap being lifted, so the text stays its own size',
)

/*
 * The decree report draws a ranking **and the share it raises**.
 *
 * A scoped report says "four generators, 1,876 tons" and immediately provokes "out of what?" —
 * a question its own four rows cannot answer. So a scoped chart carries a companion computed
 * over the whole register, and its 79.3% is the same figure as the tile beside it. The ring
 * replaced a meter: a meter reads as progress toward something, and a share of inbound tonnage
 * is not progress.
 */
expect(
  'a scoped chart carries the share it raises, computed over the whole register',
  /function reportShareChart\(field, title, note\)/.test(server) &&
    /* The register, whichever roster that is — it was `db.reports.data.generators`, which is
       `undefined` in a tenant whose register is named otherwise, and this function reads `.filter`
       on it immediately. */
    /const rows = registerRows\(\)/.test(
      /function reportShareChart[\s\S]*?\n\}/.exec(server)?.[0] ?? '',
    ) &&
    /companion: share/.test(server),
  'the share is of the register, not of the report’s own rows',
)
expect(
  'and a two-to-four slice donut is drawn as a ring, not a meter',
  /function Ring\(\{ block \}/.test(answerChartSrc) &&
    !/function Meter\(/.test(answerChartSrc) &&
    !read('src/components/AnswerBlocks.css').includes('ab-meter') &&
    answerChartSrc.includes("block.chart === 'donut' && data.length >= 2 && data.length <= 4"),
  'every slice named in the legend, so the ring is never colour-alone',
)
/*
 * Colour: identity at four columns or fewer, state beyond. The package colours its four
 * decree-bound generators by which generator and its thirty-six-row register by risk tier, and
 * the readable form decides — the same rule that makes a long register horizontal bars whatever
 * its block asks for.
 */
expect(
  'a handful of columns are coloured by identity, a long register by state',
  /data\.length <= 4\r?\n\s*\? CATEGORICAL\[i % CATEGORICAL\.length\]\r?\n\s*: d\.tone/.test(
    answerChartSrc,
  ) && /const form = rows\.length <= 6 \? 'column' : 'bar'/.test(server),
  'the block states a preference; the readable form decides',
)

/*
 * **Who a saved report is for — and the honest name for it.**
 *
 * The roles are the tenant's own (`auth_roles`, the login's pool), stored as ids so a renamed
 * role does not leave a stale label behind, and resolved on the way out. An empty audience is
 * refused: it would hide the report from everyone including whoever set it, which is deletion
 * with extra steps.
 *
 * It is **not** access control, and the panel that sets it says so in those words. The role is
 * client-held and the login authenticates by shape, so this narrows what the section *shows* a
 * reader; anything asking the API without a role still gets every row. A control that implied a
 * permission this mock cannot keep would be the worst kind of claim in the app.
 */
expect(
  'a saved report names the roles it is for, from the tenant’s own pool',
  /const reportViewerRoles = \(saved\) =>/.test(server) &&
    /db\.auth_roles\.map\(\(r\) => \(\{ role_id: r\.role_id, label: r\.label \}\)\)/.test(server) &&
    /viewer_roles: reportViewerRoles\(saved\)/.test(server) &&
    /a report no role can view is a report you have deleted/.test(server) &&
    /no such role: \$\{unknown\.join\(', '\)\}/.test(server),
  'ids stored, labels resolved, and both refusals name the fix',
)

/*
 * **The theme sets `Card.bodyPadding: 0`**, so a card in this section has to state its own.
 *
 * It is not a style preference: a body at 0 beside a head at antd's default left every saved
 * report's content flush against the card's left edge while its title sat 24px in, which is the
 * misalignment a reader sees first. Both edges are set from one token, and every card class in
 * the section is listed — a new card that forgets is a new card that looks broken.
 */
/*
 * The card-padding, select-all and card-height claims that stood here read
 * `src/pages/ReportsPage.css` and the components it styled. All of them went with the report
 * UI. The lessons they encoded are not lost — they are entries in `docs/REGRESSIONS.md` and
 * lines in `CLAUDE.md`'s pitfalls, and they will apply again to whatever renders these
 * endpoints next: a card body at 0 beside a default head, a select-all that needs three
 * states, and the equal-height trick breaking a card that expands.
 */


/* ---------------- nav / route parity ---------------- */

/*
 * `[\w-]` and not `\w`: every hyphenated key — `new-graph`, `graph-studio`, `what-if` — was
 * invisible to this, so it parsed 4 of 8 and the `>= 5` below passed by a single entry. Taking
 * one entry out of the sidebar dropped it to 4 and failed the claim, which is the only reason
 * anyone looked. A parse that silently sees half the file is the "0 of N" failure again.
 */
const navKeys = [...nav.matchAll(/^ *\{ key: '([\w-]+)'|^ *key: '([\w-]+)',/gm)]
  .map((m) => m[1] ?? m[2])
  .filter(Boolean)
const dbInNav = /^\s*\{ key: 'db'/m.test(nav)
expect(
  'CLAUDE.md matches whether /db is in the sidebar',
  dbInNav
    ? !claude.includes('commented out of')
    : claude.includes('commented out of'),
  dbInNav ? '/db is in NAV_ITEMS' : '/db is routed but not in NAV_ITEMS',
)
/* Against the paths, which parse independently — if the two disagree, one regex is wrong,
   which is exactly what was true here for however long. */
const navPathCount = [...nav.matchAll(/^ *path: '([^']+)',/gm)].length
expect(
  'nav items parse, and the keys and paths agree on how many there are',
  navKeys.length >= 5 && navKeys.length === navPathCount,
  `${navKeys.length} nav keys, ${navPathCount} nav paths`,
)


/*
 * The two counts in CLAUDE.md's routing paragraph, pinned.
 *
 * They had drifted: the paragraph said "13 entries, eight of them served" long after
 * six keys were commented out, leaving 8 live and 5 served. Prose about a count is the
 * easiest kind of doc to falsify and the hardest to notice, so both numbers are read
 * off the source here.
 */
const routesSrc = read('src/routes.tsx')
const navPaths = [...nav.matchAll(/^ *path: '([^']+)',/gm)].map((m) => m[1])
const routedPaths = [...routesSrc.matchAll(/path: '([^']+)'/g)].map((m) => m[1])
const navServed = navPaths.filter(
  (p) => routedPaths.includes(p) || routedPaths.includes(p.replace(/^\//, '')),
)
expect(
  'CLAUDE.md states how many sidebar entries exist',
  new RegExp(`\`NAV_ITEMS\` has \\*\\*${navPaths.length}\\*\\* live entries`).test(claude),
  `${navPaths.length} live nav entries`,
)
expect(
  'and how many of them have a page',
  new RegExp(`a page for \\*\\*${navServed.length}\\*\\* of them`).test(claude),
  `${navServed.length} served: ${navServed.join(', ')}`,
)

/*
 * ---------------- Settings: its own store, and the one fixed toggle ----------------
 *
 * Five claims, each guarding a rule that fails by *answering* rather than by throwing.
 */
const settingsSeed = read('scripts/seed-settings.mjs')
const settingsStore = read('src/store/settingsStore.ts')
const personaPanel = read('src/components/PersonaPermissionsPanel.tsx')
const sidebarSrc = read('src/components/Sidebar.tsx')

/*
 * **Every sidebar entry sits under a heading, and the headings are built from what a persona can
 * actually see.**
 *
 * Two ways this fails silently. An item whose `group` is not in `NAV_GROUPS` is grouped under a
 * heading the menu never renders, so the item simply vanishes from the sidebar — no error, and the
 * page is still reachable by URL, which is exactly the shape that took a session to notice when
 * Knowledge Graphs fell through to `NotFoundPage`. And a menu built by mapping `NAV_GROUPS` over the
 * *unfiltered* list would draw `EXPLORE` above nothing for a persona with no Explore item, which
 * reads as a section that failed to load rather than as one they may not open.
 *
 * So both halves are asserted: the counts agree here, and the sidebar filters before it groups.
 */
const navGroupsDeclared = [
  ...(/const NAV_GROUPS: NavGroup\[\] = \[([\s\S]*?)\]/.exec(nav)?.[1] ?? '').matchAll(
    /'([^']+)'/g,
  ),
].map((m) => m[1])
const navItemGroups = [...nav.matchAll(/^ *group: '([^']+)',/gm)].map((m) => m[1])
expect(
  'every nav item names a declared group, and the sidebar groups what it filtered',
  navGroupsDeclared.length >= 2 &&
    navItemGroups.length === navPaths.length &&
    navItemGroups.every((g) => navGroupsDeclared.includes(g)) &&
    /* Drawn only where something survived the filter — `items`, never `NAV_ITEMS`. */
    /NAV_GROUPS\.map\(\(group\) => \({/.test(sidebarSrc) &&
    /members: items\.filter\(\(item\) => item\.group === group\)/.test(sidebarSrc) &&
    /\.filter\(\(\{ members \}\) => members\.length > 0\)/.test(sidebarSrc),
  navItemGroups.length === 0
    ? 'no nav item groups parsed — this check cannot run'
    : `${navPaths.length} items across ${navGroupsDeclared.length} groups`,
)

const loginPage = read('src/pages/LoginPage.tsx')
/*
 * **`settings` is a key of `db.json`, not a file beside it.** It was `mock-server/settings.json`, and
 * `db.reports_prototype` was `mock-server/reports_prototype.json`; both were folded in on request. The
 * refusal at the top of this file already covers them — a missing `db.json` stops the run naming
 * `npm run db:pull` — so what is needed here is the key alone, and a document that has lost it is a
 * *claim* failure rather than a reason the checker cannot run.
 *
 * `settingsRaw` is the subtree's text, which is what the claims below search: several check that a
 * persona *label* appears nowhere in it, since this store names personas by `role_id` and never by
 * label. Serialising the subtree rather than the whole document keeps that search honest — every other
 * key legitimately carries labels, and searching all of `db.json` would fail on `auth_roles`.
 */
const settingsFile = db.settings ?? {}
const settingsRaw = JSON.stringify(settingsFile, null, 2)
/*
 * Comments stripped for every absence claim below — by now a habit, not a fix. A file that explains why
 * it does *not* do something names the thing it does not do: `App.tsx`'s comment says it deliberately
 * avoids `visibleNavItems`, and the login's says it no longer has a `roleId`.
 */
const appCode = codeOnly(read('src/App.tsx'))

/*
 * **A separate store from `db.json`, holding only what Settings administers.**
 *
 * That separation is the point: a settings write cannot touch a report, and an ingest that rebuilds
 * `db.reports` cannot drop a permission — which is not hypothetical, since the reports ingest silently
 * dropped `governance` for exactly that reason. It has its own validator and its own writer, and the
 * server refuses to boot on a bad one rather than serving a sidebar nobody configured.
 */
expect(
  'the settings store is its own key, with its own validator, writer and seed',
  /* **It was its own file and the separation is by key now.** Two files meant a settings write could
     not touch a report and an ingest could not drop a permission; folding it in on request moved that
     guarantee to a stronger place rather than losing it — `settings` is a `DB_SHAPE` key, so
     `validateDb` refuses a document without it and `commitDb` validates it before *every* write, not
     just this page's. That covers the case the two files never did: a writer that rebuilds some other
     subtree wholesale and forgets to carry this one, which is how `db.reports.governance` was nearly
     lost. Asserted across all of it, because a half-move is what fails quietly. */
  /settings: \(v\) => validateSettings\(v\)\.length === 0,/.test(server) &&
    /function validateSettings\(candidate\)/.test(server) &&
    /function commitSettings\(next\)/.test(server) &&
    /* Its own message still, naming the seed rather than "restart the server". */
    /refusing to start — db\.settings cannot be served/.test(server) &&
    /npm run seed:settings/.test(server) &&
    /"seed:settings": "node scripts\/seed-settings\.mjs"/.test(read('package.json')) &&
    /* And the seed replaces one key rather than rewriting the document — the failure above, again. */
    /writeFileSync\(DB, JSON\.stringify\(\{ \.\.\.db, settings \}, null, 2\)/.test(
      read('scripts/seed-settings.mjs'),
    ) &&
    /* The file itself is gone, so nothing can read a stale copy of it. */
    !existsSync(join(root, 'mock-server/settings.json')),
  'the settings are validated, committed and re-authorable on their own',
)

/*
 * **It names personas by `role_id` and never by label.** `db.auth_roles` is the pool — what report
 * audiences validate against, what the login echoes back — so one answer to "who exists". A label stored
 * here would go stale the moment a role is renamed, in a file nobody would think to look at.
 */
const settingsRoleIds = [
  ...settingsFile.users.map((u) => u.role_id),
  ...Object.keys(settingsFile.defaults),
  ...Object.keys(settingsFile.nav_permissions),
  ...Object.keys(settingsFile.read_only),
]
expect(
  'every persona the settings store names is one this tenant has, and no label is stored',
  settingsRoleIds.length > 0 &&
    settingsRoleIds.every((id) => db.auth_roles.some((r) => r.role_id === id)) &&
    !db.auth_roles.some((r) => settingsRaw.includes(r.label)) &&
    /* Resolved on the way out, so a rename reaches every surface at once. */
    /role_label: db\.auth_roles\.find\(\(r\) => r\.role_id === u\.role_id\)\?\.label/.test(server) &&
    /* And the seed refuses a role id `db.json` does not have. */
    /which db\.auth_roles does not have/.test(settingsSeed),
  `${new Set(settingsRoleIds).size} personas referenced, all by id`,
)

/*
 * **The configurable items are the sidebar's own.** The seed cannot import a `.tsx` module, so its list is
 * written once and compared here: a key it has that the sidebar does not is a permission nobody can
 * exercise, and one the sidebar has that it lacks is an item no persona can hide.
 */
const seededNavKeys = (/const NAV_KEYS = \[([\s\S]*?)\]/.exec(settingsSeed)?.[1] ?? '')
  .split(',')
  .map((s) => s.trim().replace(/^'|'$/g, ''))
  .filter(Boolean)
expect(
  'the settings store configures exactly the sidebar’s navigation items',
  seededNavKeys.length > 0 &&
    seededNavKeys.join(',') === navKeys.join(',') &&
    /*
     * Every persona carries every one of them in **both** blocks. `defaults` matters as much as the live
     * set, because Reset copies it over: a key missing there is a permission that silently becomes
     * "not configured" — visible — the first time anybody resets. The break test found that gap by
     * mutating the defaults, where an earlier version of this claim was not looking.
     */
    [settingsFile.nav_permissions, settingsFile.defaults].every((block) =>
      Object.values(block).every((perms) =>
        seededNavKeys.every((k) => typeof perms[k] === 'boolean'),
      ),
    ) &&
    /key: 'settings',[\s\S]{0,80}path: '\/settings',/.test(nav) &&
    /\{ path: 'settings', element: <SettingsPage \/> \}/.test(routesSrc),
  seededNavKeys.length === 0
    ? 'the seed’s NAV_KEYS were not parsed — this check cannot run'
    : `${seededNavKeys.length} keys, matching nav.ts`,
)

/*
 * ---------------- every in-app link points at a route that exists ----------------
 *
 * **A renamed route leaves working-looking links behind.** `/catalogue` became `/catalog` in
 * `nav.ts` and `routes.tsx` and nowhere else, so the New Graph step-4 button — *"Open the Data
 * Catalog to profile a source"*, the one exit from that dead end — fell through to `NotFoundPage`.
 * Nothing errored: a `<Link>` to a path no route matches is a 404 rendered as a page, and only
 * clicking it tells you.
 *
 * Derived from `routes.tsx` rather than listed, and walked rather than given a file list — a
 * hand-kept list is how the spacing sweep came to cover nine of fifteen stylesheets unnoticed.
 */
{
  const declared = new Set(
    [...routesSrc.matchAll(/\{ path: '([^']+)', element:/g)].map((m) => m[1]),
  )
  /* The addresses that exist without a dataset, plus the catch-all. */
  const outside = new Set(['login', 'login/data', '*', ''])
  const tsFiles = (function walkTs(dir) {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walkTs(`${dir}/${entry.name}`)
        : /\.tsx?$/.test(entry.name)
          ? [`${dir}/${entry.name}`]
          : [],
    )
  })('src')
  const linked = []
  for (const file of tsFiles) {
    for (const m of read(file).matchAll(/appPath\('\/([^']*)'\)/g)) linked.push([file, m[1]])
  }
  const broken = linked.filter(
    ([, p]) => !declared.has(p) && !outside.has(p) && !declared.has(p.split('/')[0]),
  )
  expect(
    'every in-app link points at a route that exists',
    declared.size > 5 && linked.length > 0 && broken.length === 0,
    broken.length === 0
      ? `${linked.length} appPath links across ${declared.size} declared routes`
      : broken.map(([f, p]) => `${f.split(/[\\/]/).pop()} → /${p}`).join(' | '),
  )
}

/*
 * **One place decides what the sidebar shows, and the lock is the server's.**
 *
 * Two filters would drift the first time a rule changed. And a disabled switch is a courtesy to whoever
 * is looking at it — if that were the only rule, any other path into the store could turn Settings off
 * and strand the persona that administers everything. `/settings` is routed unconditionally for the
 * same reason.
 */
expect(
  'the sidebar filters in one place, and the server enforces the fixed toggle',
  /export const visibleNavItems =/.test(settingsStore) &&
    /visibleNavItems\(settings, activePersonaId\)/.test(sidebarSrc) &&
    !/NAV_ITEMS\.filter/.test(codeOnly(sidebarSrc)) &&
    /* `App` looks up the unfiltered list on purpose — it names the page, it does not gate it. The
       comparison is against the route *beneath* the dataset segment, since the URL is `/E/sources`
       while `NAV_ITEMS` holds `/sources`. */
    /NAV_ITEMS\.find\(\(item\) => splitDatasetPath\(pathname\)\.rest\.startsWith\(item\.path\)\)/.test(
      appCode,
    ) &&
    !/visibleNavItems/.test(appCode) &&
    /* Refused server-side, with the reason, before anything is written. */
    /if \(navReadOnly\(roleId, key\) && value !== current\[key\]\)/.test(server) &&
    /is fixed for \$\{role\.label\} and cannot be changed/.test(server) &&
    /* The lock is on, not off: a locked-off item could never be granted, and both writers refuse it. */
    /a locked-off item can never be granted/.test(server) &&
    /a locked-off item can never be turned on/.test(settingsSeed) &&
    /Reset would make it unreachable/.test(server) &&
    /* True in the live set *and* in the defaults, or Reset would make the locked row unreachable. */
    Object.entries(settingsFile.read_only).every(([roleId, keys]) =>
      keys.every(
        (k) =>
          settingsFile.nav_permissions[roleId][k] === true &&
          settingsFile.defaults[roleId][k] === true,
      ),
    ) &&
    /disabled=\{locked\}/.test(personaPanel) &&
    /* Hiding is not authorising, said on the page and true of the route. */
    /not what is permitted/.test(personaPanel),
  'one filter, one enforcer, and a page that stays reachable',
)

/*
 * **The login asks for two fields, and the persona is looked up.**
 *
 * It used to ask which persona you were, which meant one address could sign in as any of them. Now the
 * settings store answers that, so an unknown address is refused rather than admitted as whatever it
 * claimed — and the role picker, and the roles fetch that filled it, are gone.
 */
/*
 * **A selected item must be readable, not just tinted.**
 *
 * The persona picker's selected option is a brand-soft fill with brand-coloured text — the language the
 * sidebar already uses for "this one". Straight `BRAND` on `BRAND_SOFT` measures 2.91:1, which would make
 * the *selected* label the hardest thing on the control to read: the opposite of the point. `BRAND_INK` is
 * the same hue darkened until it clears 4.5, and this recomputes it rather than trusting the comment.
 *
 * Weight is asserted too, because colour alone is what this repo refuses everywhere else.
 */
const themeSrc = read('src/theme.ts')
const hexOf = (name) => new RegExp(`${name} = '(#[0-9a-f]{6})'`, 'i').exec(themeSrc)?.[1] ?? ''
const brandInk = hexOf('BRAND_INK')
const brandSoft = hexOf('BRAND_SOFT')
expect(
  'the selected persona is readable on its own fill, and carries weight as well as colour',
  brandInk !== '' &&
    brandSoft !== '' &&
    contrast(brandInk, brandSoft) >= 4.5 &&
    /* The fill itself only has to separate from the card, which is a 3:1 job it does not need to pass —
       what matters is that it is not the *same* as the card, or there is no selected state at all. */
    contrast(brandSoft, '#ffffff') > 1.05 &&
    /itemSelectedColor: BRAND_INK/.test(themeSrc) &&
    /font-weight: 600/.test(read('src/pages/SettingsPage.css')),
  brandInk === '' || brandSoft === ''
    ? 'BRAND_INK or BRAND_SOFT was not parsed — this check cannot run'
    : `${contrast(brandInk, brandSoft).toFixed(2)}:1 for the label, ` +
      `${contrast(brandSoft, '#ffffff').toFixed(2)}:1 for the fill`,
)

/*
 * **`/login/data` frames a file that has to be there.**
 *
 * The route names a document in `public/` by filename. Renaming or moving the file would leave the path
 * answering with an empty frame — a blank page, no error, nothing in the console — so the name is checked
 * against the directory. It is also deliberately *outside* `RequireAuth`: it is a document to be read, and
 * behind the gate a typed URL would bounce to the login and never show it.
 */
const docRoutePath = /path: '\/login\/data',[\s\S]{0,400}?file="([^"]+)"/.exec(routesSrc)?.[1] ?? ''
expect(
  'the /login/data document route names a file that exists, and is reachable signed out',
  docRoutePath.length > 0 &&
    existsSync(join(root, 'public', docRoutePath)) &&
    /* Declared at the top level, so no `RequireAuth` parent wraps it. */
    routesSrc.indexOf("path: '/login/data'") < routesSrc.indexOf('<RequireAuth />') &&
    /* Framed rather than inlined: the document sets bare `*`, `body` and heading rules. */
    /<iframe/.test(read('src/pages/StaticDocPage.tsx')) &&
    /* The filename is the route's, not the component's — it takes any file. Comments stripped: the
       component's own doc comment names the document it was written for, and this claim failed on that
       prose first time out. Fifth time in this file; `codeOnly` is the habit, not the fix. */
    !codeOnly(read('src/pages/StaticDocPage.tsx')).includes(docRoutePath),
  docRoutePath.length === 0
    ? 'the document route was not parsed — this check cannot run'
    : `public/${docRoutePath}`,
)

/*
 * **The landing page is one place, named twice, and the two must agree.**
 *
 * Signing in with nowhere particular to go and visiting a bare `/` are the same question, answered in two
 * files — `LANDING` in `LoginPage` and the index redirect in `routes.tsx`. Two answers is not a crash; it
 * is a fresh sign-in and a bookmark of `/` quietly landing on different pages. Read off both rather than
 * pinned to a value, so changing the landing page needs one edit in each and no edit here.
 */
const landing = /export const LANDING = '([^']+)'/.exec(nav)?.[1] ?? ''
expect(
  'the login’s landing page and the index redirect are the same declaration, and it is routed',
  landing.length > 0 &&
    /* **One declaration now, not two agreeing ones.** It used to be a `const` in `LoginPage` and a
       literal in the index redirect, checked against each other; it lives in `nav.ts` and both import
       it, which is the stronger version of the same guarantee — they cannot disagree because there is
       nothing to disagree with. In `nav.ts` rather than `routes.tsx` so `LoginPage` can read it without
       the two modules importing each other. */
    /import \{ LANDING \} from '\.\/nav'/.test(routesSrc) &&
    /import \{ LANDING \} from '\.\.\/nav'/.test(loginPage) &&
    !/const LANDING =/.test(codeOnly(loginPage)) &&
    !/const LANDING =/.test(codeOnly(routesSrc)) &&
    /* Both readers use it, and both are dataset-relative — the letter goes on the front. */
    /\{ index: true, element: <DatasetRedirect to=\{LANDING\} \/> \}/.test(routesSrc) &&
    /\{ path: '\/', element: <DatasetRedirect to=\{LANDING\} \/> \}/.test(routesSrc) &&
    /\?\?\s*appPath\(LANDING\)/.test(loginPage) &&
    /* And it exists — a landing page with no route lands on NotFoundPage. */
    navPaths.includes(landing) &&
    routedPaths.includes(landing.replace(/^\//, '')) &&
    /* Still a fallback: a visitor bounced off a protected page goes back there instead. */
    /state as \{ from\?: Location \}/.test(loginPage),
  landing.length === 0
    ? 'LANDING was not parsed out of nav.ts — this check cannot run'
    : `login and the index redirect both land on ${landing}`,
)

expect(
  'the login collects no role, and the server resolves one from the settings users',
  !/roleId/.test(codeOnly(loginPage)) &&
    !/listAuthRoles/.test(loginPage) &&
    /const \{ email, password \} = await readJson\(req\)/.test(server) &&
    /settings\.users\.find\(/.test(server) &&
    /No user is set up for/.test(server) &&
    /* Still not authentication: the password is length-checked and nothing else. */
    /Password must be at least 6 characters/.test(server) &&
    /* And the identity now carries the user's own name, which it had no way to know before. */
    /name: user\.name/.test(server) &&
    /name: str,/.test(client),
  'two fields in, a looked-up persona out',
)


/*
 * The full-window canvas route. Its declaration order is load-bearing:
 * `graph-studio/:useCaseId` matches the parent segment of `graph-studio/x/canvas`, so
 * declared after the `App` tree the studio page would render at the full view's URL —
 * a wrong page with no error anywhere.
 */
const canvasRoute = "{ path: 'graph-studio/:useCaseId/canvas'"
expect(
  'the full-window canvas route exists and is declared before the App tree',
  /* Relative to `/:ds` now, like every other page — the dataset's letter is the first segment of every
     in-app URL. The ordering hazard is unchanged and so is the guard: `graph-studio/:useCaseId` matches
     the parent segment of `graph-studio/x/canvas`, so the studio page would render at the full view's
     URL if the App tree were declared first. */
  routesSrc.includes(canvasRoute) &&
    routesSrc.indexOf(canvasRoute) < routesSrc.indexOf("element: <App />") &&
    /* And both sit under the segment, so neither can be reached without one. */
    routesSrc.indexOf("path: '/:ds'") < routesSrc.indexOf(canvasRoute),
  'a prefix pattern declared first would match it and win',
)
/* The button moved out of the retired canvas component and onto the tab: the vendored
   viewer knows nothing about this app's routes, so app chrome stays outside it. It is
   still the only way in besides typing the URL, which is why its absence would strand the
   route rather than merely hide it. */
expect(
  'and it is URL-only, reached by the Full view button rather than the sidebar',
  !navPaths.some((p) => p.includes('/canvas')) &&
    /const fullViewHref = appPath\(`\/graph-studio\//.test(read('src/pages/GraphStudioPage.tsx')) &&
    /href=\{fullViewHref\}/.test(read('src/pages/GraphStudioPage.tsx')),
  'the same rule as /db: routed, not advertised',
)
/*
 * One canvas component, two frames. A full view that rendered its own drawing would be
 * a second truth about the same graph, which is the failure the whole studio is built
 * to avoid — and the button must not appear on the page it points at.
 */
expect(
  'the full view reuses the viewer rather than copying it',
  [
    read('src/pages/GraphCanvasFullPage.tsx'),
    read('src/pages/GraphStudioPage.tsx'),
  ].every(
    (page) =>
      page.includes("from '../graph-viewer/App'") &&
      page.includes("from '../graph-viewer/fromCanvas'"),
  ),
  'both views import one component, so neither can drift — and the inspector is inside it',
)
/*
 * Keyed to the prop being *passed* (`fullViewHref=`), not to the word appearing. The
 * first version searched for the bare name and failed on the comment that explains why
 * the prop is absent — the same trap as the `dimension` claim and the retired-type
 * claim: assert the fact, never the spelling.
 */
expect(
  'and the full view offers no Full view button of its own',
  !/fullViewHref/.test(read('src/pages/GraphCanvasFullPage.tsx')),
  'a link to the page you are on is a dead control',
)

/* ---------------- audit allowlist ---------------- */

const gate = read('scripts/audit-gate.mjs')
const waivers = [...gate.matchAll(/id: '(GHSA-[\w-]+)'/g)].map((m) => m[1])
for (const id of waivers) {
  expect(
    `waiver ${id} documented`,
    claude.includes(id),
    'CLAUDE.md must explain why it is waived',
  )
}

/*
 * And the inverse, which the loop above cannot see: an emptied ALLOWLIST makes
 * every claim above vanish rather than fail, so CLAUDE.md kept describing a
 * waiver that no longer existed and the count silently dropped by one. A GHSA id
 * named in CLAUDE.md must either still be waived or be described as removed.
 */
for (const match of [...claude.matchAll(/GHSA-[\w-]+/gi)]) {
  const id = match[0]
  const stillWaived = waivers.some((w) => w.toLowerCase() === id.toLowerCase())
  /* Sentence-scoped matching breaks on the dots in a version number, so this
     reads a window around the mention instead. */
  const around = claude.slice(
    Math.max(0, (match.index ?? 0) - 300),
    (match.index ?? 0) + id.length + 300,
  )
  const describedAsGone = /\b(removed|no longer|pinned|overrides)\b/i.test(around)
  expect(
    `${id} in CLAUDE.md matches the gate`,
    stillWaived || describedAsGone,
    stillWaived
      ? 'still in ALLOWLIST'
      : 'not in ALLOWLIST — say it was removed or pinned, or restore the entry',
  )
}

/*
 * **The graph picker offers the graphs that are actually published.**
 *
 * The vendored dataset ships four graphs, every one described as "Published", and none of them
 * exists. Left as the picker's source it asserted four live graphs on a tenant that may have
 * none — and the seeded library rows said "Reads from the VLS Compliance graph" alongside. So
 * the host passes `publishedGraphs()` down and both pickers and the library seed take it.
 *
 * Asserted at three sites because the fallback is what makes it silent: with no list passed,
 * everything still renders, just naming graphs nobody published.
 */
const reportsHost = read('src/pages/ReportsPage.tsx')
const askPane = read('src/reports/panes/AskPane.tsx')
const confirmPane = read('src/reports/panes/ConfirmPane.tsx')
const graphMapper = /const graphOptions = useMemo\([\s\S]*?\n  \)/.exec(reportsHost)?.[0] ?? ''
expect(
  'the report graph picker lists only published graphs, from the server',
  graphMapper.length > 0 &&
    /data\?\.graphs \?\? \[\]/.test(graphMapper) &&
    /* No invented freshness: the payload reports size and publisher, not a refresh time. */
    !/refreshed/.test(graphMapper) &&
    /* Both pickers read the passed list rather than the dataset's. */
    /items=\{graphOptions\.map/.test(askPane) &&
    !/items=\{OPTS\.graph\.options/.test(askPane) &&
    /key === 'graph' \? graphOptions : OPTS\[key\]\.options/.test(confirmPane) &&
    /* And the seeded library rows read from it too, or every card names a fictional graph. */
    /seedLibrary\(first \?/.test(read('src/reports/App.tsx')) &&
    /export function seedLibrary\(graph\?: Assumption\)/.test(read('src/reports/lib/library.ts')),
  graphMapper.length === 0
    ? 'the graph mapper was not found — this check cannot run'
    : 'picker, confirm slot and library seed all take the published list',
)

/*
 * **Every chart form the toolbar offers actually draws.**
 *
 * `line` was on the package prototype's toolbar and existed nowhere here: `ChartType` was
 * `'bar' | 'column'`, `ChartBlock` had no branch for it, and the button was absent. A form a
 * reader can pick and cannot see is the "control with nothing behind it" rule, one layer down —
 * and it fails silently, because the block falls through to bars and looks like it ignored the
 * click.
 */
const chartBlockSrc = read('src/reports/components/blocks/ChartBlock.tsx')
const reportPaneSrc = read('src/reports/panes/ReportPane.tsx')
const chartForms = [
  ...(/\['bar', 'column', 'line'\] as const/.exec(reportPaneSrc) ? ['bar', 'column', 'line'] : []),
]
expect(
  'every chart form the toolbar offers has a renderer',
  chartForms.length === 3 &&
    /export type ChartType = 'bar' \| 'column' \| 'line'/.test(read('src/reports/types.ts')) &&
    /* A branch each: line by name, column by name, bars as the fallback. */
    /block\.chartType === 'line'/.test(chartBlockSrc) &&
    /block\.chartType === 'column'/.test(chartBlockSrc) &&
    /* And the line branch really draws — a polyline, not a placeholder. */
    /<polyline/.test(chartBlockSrc) &&
    /* Named for what it changes, not for the maths it used to imply. */
    reportPaneSrc.includes('⇄ Change data'),
  chartForms.length !== 3
    ? 'the toolbar form list was not found — this check cannot run'
    : 'bar, column and line each have a branch that draws',
)

/*
 * **The publish dialog picks readers, and still carries the prototype's own audience untouched.**
 *
 * Two pools, deliberately not merged. `audience` is the prototype's group vocabulary (Operations /
 * Compliance); its `<select>` was removed on request and the *value* did not go with it — a
 * republished report keeps what it had, a new one takes the default, and the dialog hands that
 * back. Drop that forwarding and `onConfirm` publishes `undefined`, `audienceLabel` falls through
 * to the raw key, and every Library card reads "Audience:" followed by nothing. Nothing throws.
 *
 * What the dialog *does* pick is `viewerRoles` — the app's four personas, chosen as people from
 * the served directory. Guarded together, because the danger is one becoming the other: a person's
 * address stored where a role id belongs would be a second audience model beside the one the
 * entitlement matrix and `?as_role=` read.
 */
/* Comments stripped: the prop's own doc comment explains that a `<select>` *used to* be here,
   and searching the raw file matched that explanation. Fourth time in this file — if the string
   could legitimately appear in prose, strip the prose. */
const publishDialog = codeOnly(read('src/reports/components/PublishDialog.tsx'))
expect(
  'the publish dialog carries the prototype’s audience it was given, and offers no picker for it',
  /onConfirm\(trimmed, initialAudience, roles, fresh\)/.test(publishDialog) &&
    /* The pool is still read, by the label lookup the Library cards use. */
    /AUDIENCES\.find\(\(a\) => a\.key === key\)/.test(read('src/reports/lib/library.ts')),
  'removed as a control, kept as a value',
)
expect(
  'and picks readers as people while storing their roles',
  /people\.filter\(\(p\) => roles\.includes\(p\.roleId\)\)/.test(publishDialog) &&
    /setRoles\(\(prev\) => \(prev\.includes\(person\.roleId\)/.test(publishDialog) &&
    /* An address must never reach the audience list — that is the second-model failure. */
    !/roles.*\.push\(.*email|setRoles\(\[.*email/.test(publishDialog),
  'viewer_roles stays the one audience model',
)
/*
 * The directory and every string in the dialog are served. A list written into the component
 * would be a second answer to "who exists" and could offer somebody the API refuses — the
 * mistake the consent screen made when its scope list described one permission out of two.
 */
expect(
  'the publish dialog renders the served directory and the served copy',
  /people\.filter\(/.test(publishDialog) &&
    /publishing\.readers\.placeholder/.test(publishDialog) &&
    /publishing\.freshness\.presets\.map/.test(publishDialog) &&
    !/@vriodigital\.com|Maria Torres|@vls\.com/.test(publishDialog),
  'governance.people + governance.publishing, from npm run seed:governance',
)
/*
 * **Focusing the field shows the directory.** It offered nothing until something was typed, which
 * asked the reader to guess at a list only Settings knows — four people, all valid, none of them
 * discoverable from the dialog. Guarded on both halves: the list is gated on *focus* rather than on
 * a non-empty query, and the filter admits everyone when the query is empty.
 */
expect(
  'the reader directory opens on focus, not only once something is typed',
  /onFocus=\{\(\) => onOpen\(true\)\}/.test(publishDialog) &&
    /* The list is gated on being open, never on the query — that is the whole fix. */
    /\{open && \(/.test(publishDialog) &&
    /!q \|\|/.test(publishDialog) &&
    /* Picking must not close it: a blur before the click would swallow the first pick. */
    /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/.test(publishDialog),
  'four people are the whole pool — there is nothing to page through',
)
/*
 * And the list is its own component with `open` as a *prop*, so a check about what the directory
 * contains renders it rather than passing over a closed one — the `ConnectSourceWizard` rule,
 * which a dropdown behind the dialog's own `useState` would have broken.
 */
expect(
  'the reader picker is extracted, so its contents can be asserted on',
  /export function ReaderFinder\(/.test(publishDialog) &&
    /open: boolean/.test(publishDialog) &&
    /<ReaderFinder\b/.test(publishDialog),
  'renderToString cannot open a panel a parent is holding shut',
)
/*
 * The claim the old dialog made and the code never kept: publish → approve → activate was
 * collapsed to publish/unpublish, so a Domain Architect approving before an audience sees it
 * describes a step nothing performs. Guarded on the dialog *and* the toast, because the sentence
 * lived in both — and asserted positively too, so deleting the copy does not satisfy it.
 */
const reportsAppCode = codeOnly(read('src/reports/App.tsx'))
expect(
  'neither the publish dialog nor its toast claims an approval step',
  !/Domain Architect approves/.test(publishDialog) &&
    !/Domain Architect approves/.test(reportsAppCode) &&
    db.reports.governance.publishing.lead.includes('no approval step'),
  'publishing here is immediate, and the lead says so',
)
/* Each preset states its own sentence, so the line under the select is the tenant's words. */
expect(
  'the freshness line is the tenant’s sentence, not assembled in the component',
  db.reports.governance.publishing.freshness.presets.every((p) => p.sentence.length > 0) &&
    db.reports.governance.publishing.freshness.presets.some(
      (p) => p.id === db.reports.governance.publishing.freshness.default,
    ) &&
    /presets\.find\(\(p\) => p\.id === fresh\)\?\.sentence/.test(publishDialog),
  `${db.reports.governance.publishing.freshness.presets.length} presets, each with its own sentence`,
)
/*
 * Gate 2 beside a name: the persona's *declared* scope, never a filtered count. "Sees 32 of 36
 * generators" would be this dialog claiming a filter no roster here runs — the rule the
 * Operations tab's own note states.
 */
expect(
  'a reader’s scope is stated, never counted',
  /p\.scope/.test(publishDialog) &&
    /publishing\.readers\.note/.test(publishDialog) &&
    !/of \{?36|\.filter\(\(g\)/.test(publishDialog) &&
    db.reports.governance.publishing.readers.caveat.includes('not access control'),
  'declared, not applied — and the server refuses a document that drops the caveat',
)

/*
 * **Building the report is narrated, one step at a time, and the pace is per step.**
 *
 * It was a single 3s hold behind a button that could only say "Building your report…", which
 * says *something is happening* and nothing about what — the complaint that put `ConnectRunPanel`
 * in front of the connect wizard's paced calls and substep rows on the graph build. Three halves,
 * and the third is the one that fails silently: the run length has to be the **step list's**
 * length times the pace, never a duration typed into the component, or adding a step leaves the
 * dialog narrating five rows through four steps' worth of time.
 */
const buildStepsLib = read('src/reports/lib/buildSteps.ts')
const buildDialog = read('src/reports/components/BuildRunDialog.tsx')
const buildDialogCode = codeOnly(buildDialog)
expect(
  'the report build is paced per step, and its length is the step list’s',
  /const BUILD_STAGE_MS = /.test(reportsAppCode) &&
    !/\bBUILD_MS\b/.test(reportsAppCode) &&
    /runStages\(buildSteps\.length,/.test(reportsAppCode) &&
    /working === 'build' && \(/.test(reportsAppCode) &&
    /* No duration of its own: the component states no number the pace could disagree with. */
    !/_MS|\d+\s*ms|\d+ seconds/.test(buildDialogCode),
  'a duration typed into the dialog is one the server-side rule cannot move',
)
/*
 * And every step states a value **this** run used. A dialog describing building in general is a
 * spinner with more words; these name the graph, the rows the selection returned, the measure
 * they are ordered by and the blocks about to be made.
 *
 * The negative limb matters as much: `selectRows` only ever selects generators, so a facilities
 * or quarterly report counting "36 of 36 inbound generators" would name a selection that never
 * ran against it — the same claim `ConfirmPane` avoids for those spines.
 */
expect(
  'every build step names a value the build actually used',
  /graphLabel\}/.test(buildStepsLib) &&
    /\$\{rowCount\} of \$\{totalCount\} \$\{entityPlural\}/.test(buildStepsLib) &&
    /Ranking by \$\{measureLabel\}/.test(buildStepsLib) &&
    /Composing \$\{plural\(blocks\.length/.test(buildStepsLib) &&
    /spine === 'generators'\s*\?/.test(buildStepsLib) &&
    /* Fed from the state the build is about to use, not from constants in the dialog. */
    /buildStages\(\{[\s\S]*?graphLabel: assumptions\.graph\.label/.test(reportsAppCode) &&
    /rowCount: rows\.length/.test(reportsAppCode),
  'a step describing building in general is a spinner with more words',
)
/*
 * **The pace is documented as the code has it, and the run length is derived from it.**
 *
 * A number in prose drifts unless something reads it — this repo has already had a routing note
 * claiming 13 nav entries against 8. The docs quote both the per-step pace and the total, and the
 * total is the step count times the pace, so raising the pace fails here rather than quietly
 * leaving two paragraphs describing a build nobody has any more.
 */
/* Named apart from the graph build's `buildStepMs` / `buildRunSecs` — this file is one long
   script, so a second `const` of the same name is a redeclaration that kills the whole run
   before its summary, which is the failure where every claim looks broken at once. */
const reportStageMs = Number(
  ((reportsAppCode.match(/const BUILD_STAGE_MS = ([\d_]+)/) ?? [])[1] ?? '0').replace(/_/g, ''),
)
/* The step count comes from the list itself: `buildStages` returns one object per `id:`. */
const reportStageCount = (buildStepsLib.match(/^\s+id: '/gm) ?? []).length
const reportRunSecs = (reportStageMs * reportStageCount) / 1000
expect(
  'the build’s pace and run length are documented as the code has them',
  reportStageMs > 0 &&
    reportStageCount > 0 &&
    [claude, skills].every(
      (doc) =>
        doc.includes(`(**${reportStageMs / 1000}s**)`) && doc.includes(`**${reportRunSecs}s**`),
    ),
  reportStageMs === 0 || reportStageCount === 0
    ? 'the constant or the step list was not found — this check cannot run'
    : `BUILD_STAGE_MS ${reportStageMs} · ${reportStageCount} steps ≈ ${reportRunSecs}s`,
)
/* Paired presence: the dialog really renders both halves of every step and lists them all from
   the first frame, because an absence claim alone passes just as well over a gutted component. */
expect(
  'and the dialog renders every step from the first frame',
  /stages\.map\(\(stage, i\) =>/.test(buildDialogCode) &&
    /\{stage\.label\}/.test(buildDialogCode) &&
    /\{stage\.detail\}/.test(buildDialogCode) &&
    /Step \$\{current \+ 1\} of \$\{stages\.length\}/.test(buildDialogCode) &&
    /* State is never colour alone: a tick on what is done, a spinner on what is running. */
    /rp-spin/.test(buildDialogCode),
  'a list that grew a row at a time would hide how much is left',
)

/* ---------------- report ---------------- */

if (problems.length === 0) {
  console.log(`check-docs: OK — ${checked.length} claims verified.`)
  process.exit(0)
}

console.error(`\ncheck-docs: FAILED — ${problems.length} of ${checked.length + problems.length} claims are stale.\n`)
for (const p of problems) console.error(`  ✗ ${p}`)
console.error(
  '\nThe code and the docs disagree. Fix whichever is wrong — do not remove the\n' +
    'assertion to make this pass. See .claude/skills/contextweave-flow/SKILL.md.\n',
)
process.exit(1)
