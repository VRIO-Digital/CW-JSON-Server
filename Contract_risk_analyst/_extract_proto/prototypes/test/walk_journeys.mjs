// Goals and Submissions in the 4 November 2026 flow, walked as an analyst would, for one tenant. Usage:
//   SUBS_FILE=<Submissions-only html> node walk_journeys.mjs <tenant walk settings .mjs> <html with Goals and Submissions> [widths]
// One-off: plan, clarify (Missing turns to Clarified), agree the deliverables and templates, then it runs to the end by itself.
// Standing: the same at set-up plus the actions; when it fires it runs, chooses, builds, acts and notifies.
// Submissions: pick an analysis that has run and make more deliverables from it.
// Adapted from the Waste Stream Analyst walk of 4 November; the tenant's words and figures come from the settings file.
import { createRequire } from 'module'
import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright')
const T = (await import(path.resolve(process.argv[2]))).default
const A = T.once, Wt = T.watch, M = T.more, K = T.walk
const FILE = path.resolve(process.argv[3])
const WIDTHS = (process.argv[4] || '1280,1440,1728').split(',').map(Number)
const PACE = process.env.PACE || '0.08'
const F = 'file://' + FILE + '?pace=' + PACE + '&clock=' + T.clock
const SHOTS = process.env.SHOTS || new URL('./shots', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
const TPL = '/tmp/Board_note_template.txt'
writeFileSync(TPL, 'Board note\n\nDecision asked\nThe decision the board takes.\n\nWhat we found\nThe findings.\n\nWhat it costs\nCost and margin.\n\nRisks and open points\nWhat is not established.\n')
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const b = await chromium.launch()
let fails = 0, checks = 0
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL', m) } else if (process.env.VERBOSE) console.log('  ok  ', m) }
const strip = (t) => { for (const n of [...K.allowDash].sort((x, y) => y.length - x.length)) t = t.split(n).join(''); return t.replace(/(^|\n)\s*—\s*(?=\n|$)/g, '$1') }

for (const W of WIDTHS) {
  console.log(`== ${W}`)
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, acceptDownloads: true, timezoneId: 'UTC' })
  const p = await ctx.newPage()
  const errs = []
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  p.on('pageerror', (e) => errs.push(String(e)))
  const shot = (n) => p.screenshot({ path: `${SHOTS}/j_${W}_${n}.png` })
  const J = () => p.evaluate(() => { const s = window.__cwJourney.useJourney.getState(); const j = s.current ? s.goals[s.current] : null; return j ? { id: j.id, stage: j.stage, status: j.status, findings: j.findings, answers: j.answers, chosen: j.chosen, chosenBy: j.chosenBy, built: j.built, deliv: j.deliv.filter((d) => d.on).map((d) => ({ id: d.id, mode: d.mode })), acts: j.execActs.map((a) => a.state), nodes: j.nodes.map((n) => n.id), acc: Object.entries(j.over).filter(([k]) => k.startsWith('acc:')).map(([, v]) => v), chips: j.chips } : null })
  const subs = () => p.evaluate(() => window.__cwSubs.getState().submissions.map((s) => ({ id: s.id, title: s.title, v: s.version, journeyId: s.journeyId, empty: s.sections.filter((x) => x.included && !x.body.trim()).length, format: s.format })))
  const clean = async (where) => { const t = strip(await p.evaluate(() => document.body.innerText)); const m = t.match(K.banned); ok(!m, `${where}: no other tenant's text and no dash (${m ? t.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, ' ') : ''})`) }
  const rail = async (id) => {
    let peeked = false
    if (!(await p.locator('.hub-rail').count())) { await p.locator('.hub-top .hub-icon[aria-label="Show the list"]').first().click(); await p.waitForTimeout(250); peeked = true }
    const t = await p.locator(`[id="${id}"]`).first().innerText()
    if (peeked) { await p.locator('.hub-veil').click().catch(() => {}); await p.waitForTimeout(200) }
    return t
  }
  const chip = (t) => p.locator('.gc-chip', { hasText: t }).first()
  const tile = (q, t) => p.locator(`.hc[data-q="${q}"] .tile`, { hasText: t }).first()
  const waitFor = async (fn, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await p.waitForTimeout(250) } return false }
  const closeToasts = async () => { for (const x of await p.locator('.ant-notification-notice-close').all()) await x.click().catch(() => {}); await p.waitForTimeout(250) }
  const tab = async (name) => { await p.locator('.gp .tab', { hasText: name }).first().click(); await p.waitForTimeout(350) }
  const newGoal = async (mode) => { await p.goto(F + '#/K/goals').catch(() => {}); await p.evaluate(() => { window.location.hash = '#/K/goals' }); await p.waitForTimeout(500); if (await p.locator('.hub-new').count()) { await p.locator('.hub-new').click(); await p.waitForTimeout(400) } await p.locator('.ns-toggle button', { hasText: mode === 'watch' ? 'Keep watching' : 'Answer once' }).click(); await p.waitForTimeout(200) }
  const point = (k) => p.locator(`.gp .miss[data-point="${k}"]`)
  const overflow = () => p.evaluate(() => {
    const out = []
    for (const c of document.querySelectorAll('.hub-feed, .hub-panel, .panel-body')) {
      if (c.scrollWidth > c.clientWidth + 2) out.push(`${c.className} scrolls sideways (${c.scrollWidth} > ${c.clientWidth})`)
      const cr = c.getBoundingClientRect()
      for (const el of c.querySelectorAll('*')) {
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
        if (r.right > cr.right + 2 || r.left < cr.left - 2) {
          let a = el.parentElement, skip = false
          while (a && a !== c) { const ox = getComputedStyle(a).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { skip = true; break } a = a.parentElement }
          if (!skip) out.push(`${el.tagName}.${String(el.className).slice(0, 40)} "${(el.textContent || '').trim().slice(0, 50)}"`)
        }
      }
    }
    return [...new Set(out)].slice(0, 4)
  })
  const fits = async (where) => { const o = await overflow(); ok(!o.length, `${where}: nothing overflows (${o.join(' | ')})`) }
  const TABS = 'Plan|Workflow|Findings|Deliverables|Data|Log'
  /* A standing goal with a number and a date (11 November 2026) carries the Target tab first; the six others keep their order. */
  const tabsOk = async (where, target = false) => { const t = (await p.locator('.gp .tab').allInnerTexts()).map((x) => x.split('\n')[0]).join('|'); ok(t === (target ? `${K.boardTab ?? 'Target'}|` : '') + TABS, `${where}: tabs in the fixed order (${t})`) }

  /* ---------- 0: start, the list */
  await p.goto(F + '#/K/goals'); await p.waitForTimeout(1200)
  const r0 = await p.locator('.hub').first().innerText()
  ok(/Needs you/.test(r0) && /Running/.test(r0) && /Standing goals/.test(r0) && /Executed/.test(r0) && /Saved plans/.test(r0), 'five groups: Needs you, Running, Standing goals, Executed, Saved plans')
  ok(/Every finished run lands here/.test(await rail('j-executed')), 'Executed starts empty (nothing seeded)')
  ok((await subs()).length === 0, 'Submissions starts empty (nothing seeded)')
  await clean('start')

  /* ---------- 1: one-off */
  await p.getByText(A.example).click(); await p.locator('.composer.is-big .send').click()
  ok(await waitFor(async () => (await p.locator(`.hc[data-q="${A.q1}"]`).count()) > 0), 'once: first clarification appears')
  ok(await p.locator(`.hc[data-q="${A.q1}"] .tile`).count() === 2, 'once: two answers only, no "wait" or "ask me again" (the run does not stop half way)')
  ok(await point(A.q1).locator('.tag', { hasText: 'Missing' }).count() === 1, 'plan: the first open point shows as Missing before the answer')
  ok(await point('deliv').locator('.tag', { hasText: 'Missing' }).count() === 1, 'plan: the deliverables show as Missing before they are agreed')
  await shot('1_q1'); await fits('first question'); await tabsOk('planning')
  await tile(A.q1, A.t1).click()
  ok(await waitFor(async () => (await p.locator(`.hc[data-q="${A.q2}"]`).count()) > 0), 'once: second clarification appears')
  ok(await waitFor(async () => (await point(A.q1).getAttribute('class'))?.includes('is-done')), 'plan: the answered point turns green')
  ok(await point(A.q1).locator('.tag', { hasText: 'Clarified' }).count() === 1 && K.q1Answer.test(await point(A.q1).innerText()), 'plan: it says Clarified, with the answer')
  await tile(A.q2, A.t2).click()
  ok(await waitFor(async () => (await p.locator('[data-card="deliv"]').count()) > 0), 'once: the deliverables are asked in the same step, before the run')
  ok(await p.locator('[data-card="deliv"] .dv-row.is-on').count() === K.ticked, `once: the ${K.ticked} the brief asks for are ticked`)
  ok(await p.locator('[data-card="deliv"] .dv-row').count() >= K.ticked + 2, 'once: more are offered, unticked')
  ok(/2 of 3 clarified/.test(await p.locator('.gp').innerText()), 'plan: 2 of 3 clarified')
  const rowA = p.locator(`[data-card="deliv"] .dv-row[data-deliv="${K.rowA}"]`)
  ok(await rowA.locator('.dv-mode').count() === 4, 'each deliverable offers four template options')
  ok(/Recommended/.test(await rowA.locator('.dv-mode.is-on').innerText()), 'the recommended template is the default')
  await rowA.locator('.dv-mode', { hasText: 'From the library' }).click(); await p.waitForTimeout(200)
  ok(await rowA.locator('.ant-select').count() === 1, 'library: a template picker opens')
  await rowA.locator('.dv-mode', { hasText: 'Create one for me' }).click(); await p.waitForTimeout(200)
  ok(await rowA.locator('.dv-detail input').count() === 1, 'create: asks what it must cover (optional)')
  await rowA.locator('.dv-mode', { hasText: 'Recommended' }).click()
  const rowB = p.locator(`[data-card="deliv"] .dv-row[data-deliv="${K.rowB}"]`)
  await rowB.locator('.dv-mode', { hasText: 'Upload your own' }).click()
  await p.locator('[data-card="deliv"] [data-testid="tpl-upload"]').setInputFiles(TPL)
  ok(await waitFor(async () => /Board_note_template/.test(await rowB.innerText()), 5000), 'upload: your file becomes the template')
  await rowB.locator('.dv-mode', { hasText: 'Recommended' }).click()
  await p.locator('[data-card="deliv"] .dv-addlink').click()
  await p.locator('[data-card="deliv"] .dv-add .dv-mode', { hasText: A.addFmt }).click()
  await p.locator('[data-card="deliv"] .dv-add textarea').fill(A.addText)
  await p.locator('[data-card="deliv"] .dv-add .ant-btn-primary').click()
  ok(await p.locator('[data-card="deliv"] .dv-row.is-on').count() === K.ticked + 1, 'add: your own deliverable is ticked')
  await shot('2_deliv'); await clean('deliverables card'); await fits('deliverables card')
  await p.locator('[data-card="deliv"] [data-testid="deliv-confirm"]').click()
  ok(await waitFor(async () => (await J()).status === 'running'), 'once: one click and it runs (no second agreement)')
  ok(!(await J()).nodes.includes('cp'), 'workflow: no checkpoint')
  ok((await rail('j-ready')).includes(K.onceTitle), 'rail: under Running')
  ok(await waitFor(async () => (await p.locator('.gp [data-testid="activity"]').count()) > 0, 8000), 'running: the panel shows what the agents are doing now')
  await tabsOk('running'); await shot('3_running'); await fits('running')
  ok(await waitFor(async () => (await p.locator('.gp [data-testid="building"]').count()) > 0, 30000), 'building: the panel shows the deliverables being built, part by part')
  await shot('3b_building'); await fits('building')
  ok(await waitFor(async () => (await J()).status === 'delivered', 30000), 'once: delivered without any further click')
  const j1 = await J()
  ok(Object.keys(j1.built).length === K.built, `${K.built} deliverables built`)
  ok(j1.acc.length === K.findings && j1.acc.every((v) => v === 'auto'), 'findings accepted automatically')
  ok(j1.chosen === 'r1' && j1.chosenBy === 'auto', 'top option chosen automatically')
  ok(await waitFor(async () => (await p.locator('.gp .tab.is-on', { hasText: 'Deliverables' }).count()) === 1, 3000), 'the panel opens on the deliverables')
  ok(await p.locator('.gp [data-testid="deliverable"] .sd-part').count() >= 3, 'the deliverable is on screen, part by part')
  ok((await rail('j-executed')).includes(K.onceTitle), 'rail: under Executed')
  const s1 = (await subs()).filter((x) => x.journeyId === j1.id)
  ok(s1.length === K.built && s1.every((x) => x.empty === 0), 'every deliverable complete, nothing left empty')
  ok(s1.some((x) => x.format === A.addFmt), `your ${A.addFmt.toLowerCase()} is built on a designed structure`)
  ok(K.closing.test(await p.locator('.hub-feed').innerText()), 'the closing message carries the figure')
  await p.waitForTimeout(400); await shot('4_delivered'); await clean('delivered'); await fits('delivered'); await tabsOk('delivered')
  const doc1 = await p.locator('.gp [data-testid="deliverable"]').innerText()
  await p.locator('.gp .dl-tab').nth(1).click(); await p.waitForTimeout(300)
  const doc2 = await p.locator('.gp [data-testid="deliverable"]').innerText()
  ok(K.tab2.test(await p.locator('.gp .dl-tab.is-on').innerText()) && doc2 !== doc1, 'deliverables: switch to the second one')
  await tab('Findings')
  ok(await p.locator('.gp .finding .tag', { hasText: 'Accepted automatically' }).count() === K.findings, 'findings: tagged as accepted automatically')
  ok(await p.locator('.gp .reco .tag', { hasText: 'Chosen automatically' }).count() === 1, 'options: the chosen one is tagged')
  await p.locator('.gp .reco .ant-btn', { hasText: 'Why this' }).first().click(); await p.waitForTimeout(500)
  ok(/Hide the path/.test(await p.locator('.gp .reco').first().innerText()), 'why this plays the path')
  await shot('5_findings'); await fits('findings')
  await p.locator(`.gp .reco[data-rec="${A.switchTo}"] .ant-btn`, { hasText: 'Use this instead' }).click()
  ok(await waitFor(async () => (await J()).chosen === A.switchTo, 4000), 'after: another option chosen by you')
  ok(await waitFor(async () => (await subs()).filter((x) => x.journeyId === j1.id).every((x) => x.v === 2), 8000), 'after: every deliverable rebuilt as version 2')
  ok(await waitFor(async () => !(await p.evaluate(() => { const s = window.__cwJourney.useJourney.getState(); return s.goals[s.current].prog })), 15000), 'after: the rebuild is shown, then done')
  ok((await J()).chosenBy === 'you', 'after: chosen by you')
  await chip(A.steer).click(); await p.waitForTimeout(1200)
  await p.locator('.diff .ant-btn-primary').last().click()
  ok(await waitFor(async () => (await subs()).filter((x) => x.journeyId === j1.id).every((x) => x.v === 3), 20000), 'after: a steer re-runs and rebuilds the deliverables (version 3)')
  ok(await waitFor(async () => new RegExp(A.steerDone).test(await p.locator('.hub-feed').innerText()), 15000), 'after: the steer lands')
  ok((await J()).answers[K.steerAnswer[0]] === K.steerAnswer[1], 'after: the plan records the steer as the answer')
  ok((await J()).chosen === 'r1', 'after: the steer goes back to the top option, rebuilt on the new figures')
  await tab('Plan'); ok(/Clarified/.test(await point(K.steerAnswer[0]).innerText()), 'after: that point is still clarified')
  await shot('6_steered'); await clean('steered'); await fits('steered')
  await chip('Make more deliverables in Submissions').click()
  ok(await waitFor(async () => /\/submissions/.test(p.url()) && (await p.locator('[data-card="make"]').count()) > 0, 6000), 'make more: Submissions opens with this analysis picked')
  ok(await p.locator('[data-card="make"] .dv-made').count() === K.built, 'make more: the ones made are marked as made')
  await p.locator(`[data-card="make"] .dv-row[data-deliv="${M.onceExtra}"] .ant-checkbox-input`).check()
  await p.locator('[data-card="make"] [data-testid="deliv-confirm"]').click()
  ok(await waitFor(async () => (await subs()).some((x) => new RegExp(esc(M.onceTitle)).test(x.title)), 5000), 'make more: built at once, no outline step')
  await p.waitForTimeout(3500); await shot('7_more'); await clean('make more'); await fits('make more')
  ok(await p.locator('.hp .sd-part').count() >= 3, 'make more: it opens on the right')
  ok((await rail(`s-a-${j1.id}`)).includes(M.onceTitle.split(':')[0]), 'Submissions list: grouped under the analysis')

  /* ---------- 2: a standing goal built from nothing: four questions, the scorecard on the plan, the dashboard and the rules; then scored and armed */
  await newGoal('watch')
  await p.getByText(Wt.example).click(); await p.locator('.composer.is-big .send').click()
  for (const [k, t] of Wt.answers) { ok(await waitFor(async () => (await p.locator(`.hc[data-q="${k}"]`).count()) > 0), `watch: asks "${k}"`); await tile(k, t).click(); ok(await waitFor(async () => (await point(k).getAttribute('class'))?.includes('is-done')), `watch plan: "${k}" turns green`) }
  ok(await waitFor(async () => (await p.locator('.hc[data-q="design"]').count()) > 0), 'watch: shows how every project will be scored')
  ok(await p.locator('[data-testid="sdz"]').count() === 1, 'watch plan: the scorecard is on the plan')
  await shot('8_design'); await clean('design'); await fits('design'); await tabsOk('watch planning')
  await tile('design', 'Score on it').click()
  ok(await waitFor(async () => (await p.locator('.hc[data-q="check"]').count()) > 0), 'watch: then the data check')
  await tile('check', 'Confirm the assumptions').click()
  ok(await waitFor(async () => (await p.locator('[data-testid="watch-setup"]').count()) > 0), 'watch: the dashboard and the rules are confirmed in one card')
  ok(await p.locator('.sdz-rule').count() === K.newActs, `watch plan: ${K.newActs} rules proposed for when risk goes up`)
  ok(await p.locator(`.sdz-rule[data-rule="${K.askAct}"] button.is-on`, { hasText: 'Ask me first' }).count() === 1, 'watch: one rule asks first by default')
  await shot('9_watch_setup'); await clean('watch set-up'); await fits('watch set-up')
  await p.locator('[data-testid="watch-setup"] .ant-btn-primary').click()
  ok(await waitFor(async () => (await J()).stage === 'armed'), 'watch: scored and armed with one click')
  ok(await waitFor(async () => (await p.locator('[data-testid="dash-deliv"]').count()) === 1, 5000), 'watch: once armed, the dashboard is open under Deliverables, version 1'); await clean('dashboard'); await fits('dashboard'); await tab('Plan')
  ok(await point('deliv').locator('.tag', { hasText: 'Clarified' }).count() === 1, 'watch plan: all clarified')
  ok((await rail('j-standing')).includes('Armed'), 'rail: the standing goal is armed')

  /* ---------- 3: the next morning it fires and does what the rules say */
  await p.locator('.panel-actions .btn', { hasText: 'Simulate' }).click()
  ok(await waitFor(async () => (await p.locator('.ant-notification-notice', { hasText: K.firedToast }).count()) > 0, 4000), 'fired: notification')
  ok(await waitFor(async () => (await J()).status === 'executed', 60000), 'watch: handled without a click')
  const w1 = await J()
  ok(w1.chosen === 'r1' && w1.chosenBy === 'auto' && w1.acc.every((v) => v === 'auto'), 'watch: findings accepted and option 1 chosen by itself')
  ok(Object.keys(w1.built).length === K.watchBuilt, `watch: ${K.watchBuilt} deliverables built`)
  ok(w1.acts.filter((a) => a === 'done').length === K.actsDone && w1.acts.filter((a) => a === 'waiting').length === K.actsWait, `watch: ${K.actsDone} actions from the rules done by itself, ${K.actsWait} held`)
  const toast = p.locator('.ant-notification-notice', { hasText: K.handledToast })
  ok(await waitFor(async () => (await toast.count()) > 0, 3000), 'handled: notification says what it did')
  ok((await rail('j-executed')).includes(K.watchRun), 'rail: the run is under Executed')
  ok((await rail('j-standing')).includes('Armed'), 'rail: the standing goal stays armed')
  await closeToasts(); await shot('10_handled'); await clean('handled'); await fits('handled'); await tabsOk('watch handled')
  ok((await subs()).some((x) => K.watchSub.test(x.title)), 'Submissions holds what the run built')
  await p.locator('button[aria-label="Notifications"]').first().click(); await p.waitForTimeout(700)
  ok(/handled/i.test(await p.locator('.ant-drawer', { hasText: 'Notifications' }).last().innerText()), 'the bell holds the notices')
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)

  /* ---------- 4: a one-off with nothing to clarify */
  await newGoal('once')
  await p.getByText(T.overrun.chip).click(); await p.locator('.composer.is-big .send').click()
  ok(await waitFor(async () => (await p.locator('[data-card="deliv"]').count()) > 0, 15000), 'one-off: straight to the deliverables')
  await p.locator('[data-card="deliv"] [data-testid="deliv-confirm"]').click()
  ok(await waitFor(async () => (await J()).status === 'delivered', 30000), 'one-off: delivered by itself')
  ok(Object.keys((await J()).built).length === K.shortBuilt && (await J()).acts.length === 0, 'one-off: built, nothing executed from a one-off')

  /* ---------- 5: a goal with no recorded analysis */
  await newGoal('once')
  await p.locator('.composer.is-big textarea').fill(T.generic.text)
  await p.locator('.composer.is-big .send').click()
  ok(await waitFor(async () => (await p.locator('[data-card="deliv"]').count()) > 0, 15000), 'generic: deliverables asked, on a designed structure')
  await p.locator('[data-card="deliv"] [data-testid="deliv-confirm"]').click()
  ok(await waitFor(async () => (await J()).status === 'ready', 20000), 'generic: ends on a question')
  ok(Object.keys((await J()).built).length === 0, 'generic: honest, nothing built without a recorded analysis')

  /* ---------- 6: a scheduled standing goal: set up, arm, run now */
  await newGoal('watch')
  await p.getByText(T.schedule.chip).click(); await p.locator('.composer.is-big .send').click()
  ok(await waitFor(async () => (await p.locator('.hc[data-q="tell"]').count()) > 0, 15000), 'schedule: one clarification')
  await tile('tell', T.schedule.tell).click()
  ok(await waitFor(async () => (await p.locator('[data-card="deliv"]').count()) > 0), 'schedule: deliverables and actions')
  await p.locator('[data-card="deliv"] [data-testid="deliv-confirm"]').click()
  ok(await waitFor(async () => (await J()).stage === 'armed'), 'schedule: armed')
  await p.locator('.gp .panel-actions .btn', { hasText: 'Simulate: run now' }).click()
  ok(await waitFor(async () => (await J()).status === 'executed', 30000), 'schedule: run, built and sent by itself')
  ok((await J()).acts.length === 2 && (await J()).acts.every((a) => a === 'done'), 'schedule: both actions done by itself')
  await closeToasts(); await clean('schedule')
  ok(errs.length === 0, `no console errors (${errs.slice(0, 3).join(' | ')})`)
  await ctx.close()

  /* ---------- 7: Submissions on its own */
  if (process.env.SUBS_FILE) {
    const c2 = await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'UTC' })
    const q = await c2.newPage()
    const e2 = []; q.on('pageerror', (e) => e2.push(String(e))); q.on('console', (m) => { if (m.type() === 'error') e2.push(m.text()) })
    await q.goto('file://' + path.resolve(process.env.SUBS_FILE) + '?pace=' + PACE + '&clock=' + T.clock + '#/K/submissions'); await q.waitForTimeout(1500)
    ok(await q.locator('[data-analysis]').count() === 2, 'Submissions-only: two analyses that have run')
    let picked = false
    for (const i of [1, 0]) {
      await q.locator('[data-analysis]').nth(i).click(); await q.waitForTimeout(1000)
      if (await q.locator(`[data-card="make"] .dv-row[data-deliv="${M.watchExtra}"]`).count()) { picked = true; break }
    }
    ok(picked, 'Submissions-only: the standing-goal run offers more')
    ok(await q.locator('[data-card="make"] .dv-made').count() === K.watchBuilt, 'Submissions-only: the run\'s deliverables are marked as made')
    await q.locator(`[data-card="make"] .dv-row[data-deliv="${M.watchExtra}"] .ant-checkbox-input`).check()
    await q.locator('[data-card="make"] [data-testid="deliv-confirm"]').click(); await q.waitForTimeout(3500)
    ok(await q.evaluate((t) => window.__cwSubs.getState().submissions.some((s) => s.title.includes(t)), M.watchTitle), 'Submissions-only: the extra deliverable is built')
    await q.locator('.gc-chip', { hasText: 'Make another from the same analysis' }).click(); await q.waitForTimeout(1000)
    await q.locator('.hub-input textarea').fill(M.dashboard); await q.keyboard.press('Enter')
    ok(await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 8000) { if (await q.evaluate(() => window.__cwSubs.getState().submissions.some((s) => s.format === 'Dashboard'))) return true; await q.waitForTimeout(250) } return false })(), 'Submissions-only: described in words, built at once')
    await q.waitForTimeout(2500); await q.screenshot({ path: `${SHOTS}/j_${W}_10_subs.png` })
    const t = strip(await q.evaluate(() => document.body.innerText)); const m = t.match(K.banned)
    ok(!m, `Submissions-only: clean text (${m ? t.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, ' ') : ''})`)
    ok(e2.length === 0, `Submissions-only: no errors (${e2.slice(0, 2).join(' | ')})`)
    await c2.close()
  }
}
console.log(`${checks} checks, ${fails} failures`)
await b.close()
process.exit(fails ? 1 : 0)
