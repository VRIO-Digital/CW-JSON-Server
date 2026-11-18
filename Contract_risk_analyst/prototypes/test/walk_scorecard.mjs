// The contract risk watch, version 3 (17 November 2026), walked as a person who starts with connected sources and nothing else.
// Usage: node walk_scorecard.mjs <Goals and Submissions html> [widths]
// Path 1: upload a scoring template; it is played back as written, checked against the data, scored, published as a
// dashboard deliverable with versions; the morning check; the live goal edited and republished; the dashboard in Submissions.
// Path 2: no template; ONE proposed scorecard (no parts, no sections); drop a signal, add one to a factor with its rule, add a factor, on the panel and in the chat.
import { createRequire } from 'module'
import { mkdirSync } from 'fs'
import path from 'path'
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright')
const FILE = path.resolve(process.argv[2])
const WIDTHS = (process.argv[3] || '1280,1440,1728').split(',').map(Number)
const FIX = new URL('./fixtures/', import.meta.url).pathname
const F = 'file://' + FILE + '?pace=' + (process.env.PACE || '0.05') + '&clock=2026-11-19T14:00:00Z'
const SHOTS = process.env.SHOTS || new URL('./shots_scorecard', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
const b = await chromium.launch()
let fails = 0, checks = 0
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('  FAIL', m) } else if (process.env.VERBOSE) console.log('  ok  ', m) }
for (const W of WIDTHS) {
  console.log(`== ${W}`)
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'UTC', acceptDownloads: true })
  const p = await ctx.newPage()
  const errs = []
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  p.on('pageerror', (e) => errs.push(String(e)))
  const shot = (n) => p.screenshot({ path: `${SHOTS}/s_${W}_${n}.png` })
  const J = () => p.evaluate(() => { const s = window.__cwJourney.useJourney.getState(); const j = s.current ? s.goals[s.current] : null; return j ? { id: j.id, stage: j.stage, status: j.status, acts: j.execActs.map((a) => ({ cat: a.cat, state: a.state, text: a.text })), built: Object.keys(j.built).length } : null })
  const waitFor = async (fn, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await p.waitForTimeout(200) } return false }
  const tab = async (name) => { await p.locator('.gp .tab', { hasText: name }).first().click(); await p.waitForTimeout(350) }
  const tabs = async () => (await p.locator('.gp .tab').allInnerTexts()).map((x) => x.split('\n')[0]).join('|')
  const num = async (id) => Number((await p.locator(`[data-testid="${id}"]`).first().innerText()).replace(/[^0-9.]/g, ''))
  const txt = async (id) => p.locator(`[data-testid="${id}"]`).first().innerText()
  const dist = async (pre) => [await num(`${pre}1`), await num(`${pre}2`), await num(`${pre}3`), await num(`${pre}4`)]
  const tile = (q, t) => p.locator(`.hc[data-q="${q}"] .tile`, { hasText: t }).first()
  const asked = (q) => waitFor(async () => (await p.locator(`.hc[data-q="${q}"]`).count()) > 0)
  const closeToasts = async () => { for (const x of await p.locator('.ant-notification-notice-close').all()) await x.click().catch(() => {}); await p.waitForTimeout(250) }
  const closeDrawer = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(450) }
  const drawerOpen = () => waitFor(async () => (await p.locator('.ant-drawer .ws').count()) > 0, 5000)
  const openS = async (sid) => { const el = p.locator(`[data-part="sheet"] .sdz-sig[data-signal="${sid}"]`).first(); if (!(await el.getAttribute('class')).includes('is-open')) { await el.locator('.sdz-more').click(); await p.waitForTimeout(150) } }
  const overflow = () => p.evaluate(() => { const out = []; for (const c of document.querySelectorAll('.hub-panel, .ant-modal-content')) { if (c.scrollWidth > c.clientWidth + 2) out.push(`${c.className} scrolls sideways`); const cr = c.getBoundingClientRect(); for (const el of c.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; if (r.right > cr.right + 2 || r.left < cr.left - 2) { let a = el.parentElement, skip = false; while (a && a !== c) { const ox = getComputedStyle(a).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { skip = true; break } a = a.parentElement } if (!skip) out.push(`${el.tagName}.${String(el.className).slice(0, 30)} "${(el.textContent || '').trim().slice(0, 40)}"`) } } } return [...new Set(out)].slice(0, 4) })
  const fits = async (where) => { const o = await overflow(); ok(!o.length, `${where}: nothing overflows (${o.join(' | ')})`) }
  const clean = async (where) => { const t = await p.evaluate(() => document.body.innerText); const m = t.match(/[—–]|workbook|Phase 2|Veolia/); ok(!m, `${where}: no long dash and no leftover wording (${m ? t.slice(Math.max(0, m.index - 50), m.index + 30).replace(/\n/g, ' ') : ''})`) }
  const say = async (t) => { await p.locator('.composer textarea').last().fill(t); await p.keyboard.press('Enter'); await p.waitForTimeout(700) }
  const planText = async () => (await p.locator('.panel-body').first().innerText()) + '\n' + (await p.locator('.hub-feed').innerText())
  const counts = async () => { const m = (await txt('sdz-counts')).match(/(\d+) factors · (\d+) signals/); return [Number(m[1]), Number(m[2])] }
  const newWatch = async () => { await p.evaluate(() => { window.location.hash = '#/K/goals' }); await p.waitForTimeout(600); if (await p.locator('.hub-new').count()) { await p.locator('.hub-new').click(); await p.waitForTimeout(400) } await p.locator('.ns-toggle button', { hasText: 'Keep watching' }).click(); await p.waitForTimeout(200); await p.getByText('Use the contract risk example').click(); await p.locator('.composer.is-big .send').click() }
  const build = async () => { ok(await waitFor(async () => (await p.locator('[data-testid="watch-setup"]').count()) > 0), 'the dashboard and the rules are confirmed in one card'); await p.locator('[data-testid="watch-setup"] .ant-btn-primary').click(); ok(await waitFor(async () => (await J())?.stage === 'armed'), 'scored and armed with one click'); await p.waitForTimeout(700) }
  const back = async () => { if (await p.locator('[data-testid="rk-back"]').count()) { await p.locator('[data-testid="rk-back"]').click(); await p.waitForTimeout(250) } }
  const openProject = async (id) => { await back(); await p.locator(`[data-testid="rk-matrix"] circle[data-c="${id}"]`).dispatchEvent('click'); await p.waitForTimeout(450); ok(await p.locator('[data-testid="sb-detail"]').getAttribute('data-c') === id, `${id} opens from its bubble`) }

  /* ================= path 1: a template is uploaded ================= */
  await p.goto(F + '#/K/goals'); await p.waitForTimeout(1000)
  ok(await p.evaluate(() => Object.keys(window.__cwJourney.useJourney.getState().goals).length) === 0, 'start: no goal exists')
  await newWatch()
  ok(await asked('frame'), 'first question: do you have a scoring template')
  const feed = await p.locator('.hub-feed').innerText()
  ok(/300 active operations and maintenance projects/.test(feed) && /profit centers/.test(feed), 'reads: it found the projects and how they are booked')
  ok(/None is connected/.test(feed) && /richstatespoorstates\.org/.test(feed), 'reads: no template found; public sources fetched')
  ok(await p.locator('[data-testid="sdz"]').count() === 0 && await p.locator('[data-testid="sdz-waiting"]').count() === 1, 'before the answer: no scorecard on the plan, only a note that it comes after the answer')
  await tile('frame', 'Yes, I will upload it').click()
  ok(await waitFor(async () => (await p.locator('[data-testid="tpl-upload"]').count()) === 1, 8000) && await p.locator('[data-testid="sdz"]').count() === 0 && await p.locator('[data-testid="sdz-drafting"]').count() === 0, 'after "Yes": a box to hand over the file, and still no scorecard')
  { const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.locator('[data-testid="tpl-download"]').click()]); ok(/Contract_Risk_Scorecard_Template\.xlsx/.test(dl.suggestedFilename()), `the template can be downloaded from the box (${dl.suggestedFilename()})`) }
  await p.locator('[data-testid="tpl-file"]').setInputFiles(FIX + 'Not_a_template.xlsx'); await p.waitForTimeout(700)
  ok(/could not find a scorecard in Not_a_template\.xlsx/.test(await p.locator('.hub-feed').innerText()) && await p.locator('[data-testid="tpl-upload"]').count() === 1 && await p.locator('[data-testid="sdz"]').count() === 0, 'a file that is not a template is refused in plain words, and the box stays')
  await p.locator('[data-testid="tpl-file"]').setInputFiles(FIX + 'My_Risk_Scorecard.xlsx')
  ok(await waitFor(async () => (await p.locator('[data-testid="sdz-drafting"]').count()) === 1, 8000) && await p.locator('[data-testid="sdz"]').count() === 0, 'the file is read step by step before anything is shown')
  ok(await p.locator('[data-testid="sdz-drafting"] li').count() === 6, 'reading the template shows its six steps')
  ok(await asked('design'), 'then: this is how every project will be scored')
  ok(await p.locator('[data-testid="sdz"]').count() === 1 && await p.locator('[data-testid="sdz-drafting"]').count() === 0, 'the template is on the plan once it is read')
  ok(/My_Risk_Scorecard\.xlsx/.test(await p.locator('.hub-feed').innerText()) && /My_Risk_Scorecard\.xlsx/.test(await p.locator('[data-part="sheet"] .sdz-sec-h').innerText()), 'the chat and the plan name the file that was read')

  /* the template, used as written: nothing added, nothing left out */
  ok(/17 factors · 70 signals/.test(await txt('sdz-counts')), `template: its own factors and signals (${await txt('sdz-counts')})`)
  ok(await p.locator('[data-part="sections"]').count() === 0 && await p.locator('.sdz-sect').count() === 0 && (await p.locator('[data-part] .sdz-no').allInnerTexts()).join('') === '1234', 'template: one scorecard, no list of what the template does not have')
  { const t = await planText(); const m = t.match(/does not have|not in your template|\bsheet\b|sections? [A-F]\b|Golden|WIMS|Big 3|\bNOVs?\b/i); ok(!m, `template: nothing is questioned, and no customer-specific wording (${m ? t.slice(Math.max(0, m.index - 50), m.index + 40).replace(/\n/g, ' ') : ''})`) }
  ok(await p.locator('[data-group="impact"] [data-factor="im"]').count() === 1 && await p.locator('[data-group="internal"] [data-factor="fp"]').count() === 1 && await p.locator('[data-group="external"] [data-factor="cp"]').count() === 1, 'template: what is at stake, financial performance and the client side are all in it')
  ok(/average of the two/.test(await txt('sdz-formula')), 'template: says how one score is made')
  { const r4 = await p.locator('.sdz-sig[data-signal="cr2"] .sdz-rule4').first().innerText(); ok(/Under 30 days/.test(r4) && /30 to 60 days/.test(r4) && /90 days or more/.test(r4), `template: the rule I rewrote in the file is used (${r4.replace(/\n/g, ' | ')})`) }
  ok(await p.locator('.sdz-sig[data-signal="cr4"]').count() === 0 && await p.locator('.sdz-sig[data-signal="cp3"]').count() === 0, 'template: the two signals I deleted in the file are not there, and are not offered back')
  { const row = p.locator('[data-factor="cr"] .sdz-sig', { hasText: 'Invoices the client pays late' }); ok(await row.count() === 1 && /More than 5/.test(await row.innerText()), 'template: a signal I added in the file is read with its rule') }
  ok(await p.locator('[data-group="external"] .sdz-f', { hasText: 'Energy market' }).count() === 1 && /Power price against budget/.test(await p.locator('[data-group="external"] .sdz-f', { hasText: 'Energy market' }).innerText()), 'template: a factor I added in the file is read with its signal')
  ok(/2 signals are new to me/.test(await p.locator('.hub-feed').innerText()), 'the chat says which signals were new')
  ok(await p.locator('.sdz-sig[data-signal="in2"] em.is-miss').count() === 1 && await p.locator('[data-testid="sdz-drop-in2"]:disabled').count() === 1, 'template: the one signal with no source is marked')
  /* a rule against three years of history */
  await p.locator('[data-testid="sdz-edit-os3"]').click(); await p.waitForTimeout(250)
  { const h = await txt('sdz-hist-os3'); ok(await p.locator('[data-testid="sdz-hist-os3"] rect').count() >= 10 && /Your history/.test(h) && /in one score/.test(h) && /From the history I would cut at/.test(h), 'a figure shows how the projects are spread, and what history says about its rule') }
  await p.locator('[data-testid="sdz-hist-use-os3"]').click(); await p.waitForTimeout(300)
  ok(/3\.5 or more a year/.test(await p.locator('.sdz-sig[data-signal="os3"] .sdz-rule4').first().innerText()), 'the thresholds from history are taken with one click, and the rule is rewritten')
  await p.locator('[data-testid="sdz-hist-back-os3"]').click(); await p.waitForTimeout(300)
  ok(/2 or more a year/.test(await p.locator('.sdz-sig[data-signal="os3"] .sdz-rule4').first().innerText()), 'and the rule as written comes back with one click')
  await p.locator('[data-testid="sdz-edit-iq1"]').click(); await p.waitForTimeout(200)
  ok(/regulatory or permit limit/.test(await txt('sdz-hist-iq1')) && await p.locator('[data-testid="sdz-hist-use-iq1"]').count() === 0, 'a rule that follows a regulatory limit is left as written')
  const d0 = await dist('sdz-n'); ok(d0.reduce((a, c) => a + c, 0) === 300, `preview: one score per project, 300 in all (${d0.join('+')})`)
  await shot('1_sheet'); await fits('sheet'); await clean('sheet')
  await tile('design', 'Score on it').click()

  /* the data check */
  ok(await asked('check'), 'then: the data check')
  const cc = await txt('sdz-cc')
  ok(/77 signals/.test(cc) && /1 not found/.test(cc) && /2 partly/.test(cc), `data check: every signal of the template tested (${cc.replace(/\n/g, ', ')})`)
  { const h = await p.locator('.sdz-as[data-assume="hist"]').innerText(); ok(/Rules checked against your history/.test(h) && /safety observations per employee/.test(h) && /regulatory or permit limit/.test(h) && /As in your template/.test(h), 'data check: the rules are checked against history, and the weak ones are named') }
  { const n1 = await num('sdz-n1'); await p.locator('.sdz-as[data-assume="hist"] .sdz-as-opts button', { hasText: 'Take the thresholds from history' }).click(); await p.waitForTimeout(300); ok(/3\.5 or more a year/.test(await p.locator('.sdz-sig[data-signal="os3"] .sdz-rule4').first().innerText()) && (await num('sdz-n1')) !== n1, 'taking the thresholds from history rewrites those rules and scores the projects again'); await p.locator('.sdz-as[data-assume="hist"] .sdz-as-opts button', { hasText: 'Keep the rules as written' }).click(); await p.waitForTimeout(300); ok(/2 or more a year/.test(await p.locator('.sdz-sig[data-signal="os3"] .sdz-rule4').first().innerText()), 'and keeping the rules as written puts them back') }
  ok(await p.locator('.sdz-as').count() === 6 && await p.locator('.sdz-as.is-ok').count() === 1, 'data check: six assumptions; only the one I just decided is confirmed')
  ok(/Profit center/.test(await p.locator('[data-testid="sdz-check"] tr[data-signal="cr2"]').innerText()) && /takes the figure of its profit center/.test(await p.locator('[data-testid="sdz-check"] tr[data-signal="cr2"]').innerText()), 'data check: DSO sits at profit center level, and says how it reaches the project')
  ok(/Facility/.test(await p.locator('[data-testid="sdz-check"] tr[data-signal="en2"]').innerText()) && /Client account/.test(await p.locator('[data-testid="sdz-check"] tr[data-signal="cu1"]').innerText()), 'data check: facility level and client account level are named')
  ok(/268 of 300/.test(await p.locator('[data-testid="sdz-check"] tr[data-signal="cu1"]').innerText()), 'data check: the survey covers 268 of 300 projects')
  const co2 = await p.locator('[data-testid="sdz-check"] tr[data-signal="co2"]').innerText()
  ok(/negative reports divided by the total number of reports/.test(co2) && /Under 40% negative/.test(co2) && /80% to 100%/.test(co2), 'data check: media sentiment says how it is measured (share of the total number of reports) and how it scores 1 to 4')
  ok(/Average receivables over revenue/.test(await p.locator('[data-testid="sdz-check"] tr[data-signal="cr2"]').innerText()), 'data check: every row says how the signal is measured')
  ok(/Submissions/.test(await txt('sdz-where')) && /Deliverables/.test(await txt('sdz-where')) && /every morning/.test(await txt('sdz-where')), 'the plan says where the dashboard is opened, every time')
  await p.locator('.sdz-chip[data-filter="missing"]').click(); await p.waitForTimeout(150)
  ok(await p.locator('[data-testid="sdz-check"] tbody tr').count() === 1 && /Not found/.test(await p.locator('[data-testid="sdz-check"] tbody tr').innerText()), 'data check: the filter shows the one signal with no source')
  await p.locator('.sdz-chip[data-filter="all"]').click()
  const negText = () => p.locator('.sdz-as[data-assume="negdso"] p').innerText()
  const dA = (await negText()).match(/score ([0-9.]+) on average/)?.[1]
  await p.locator('.sdz-as[data-assume="negdso"] .sdz-as-opts button', { hasText: 'Score it 1' }).click(); await p.waitForTimeout(250)
  const dB = (await negText()).match(/score ([0-9.]+) on average/)?.[1]
  ok(!!dA && !!dB && Number(dB) < Number(dA) && await p.locator('.sdz-as[data-assume="negdso"].is-ok').count() === 1, `an assumption changed: negative DSO scores 1, those projects drop from ${dA} to ${dB} on average, and it shows as confirmed`)
  await p.locator('.sdz-as[data-assume="fac"] .sdz-as-opts button', { hasText: 'Add the facilities up' }).click(); await p.waitForTimeout(200)
  ok(/facilities of the project are added up/.test(await p.locator('[data-testid="sdz-check"] tr[data-signal="en2"]').innerText()), 'an assumption changed: the table says facilities are added up')
  await shot('2_check'); await fits('data check'); await clean('data check')
  await tile('check', 'Confirm the assumptions').click()
  await build()
  await tab('Plan'); ok(await p.locator('.sdz-as.is-ok').count() === 6, 'all six assumptions are confirmed'); await tab('Deliverables')

  /* the dashboard is a deliverable, version 1 */
  ok((await tabs()) === 'Plan|Workflow|Findings|Deliverables|Data|Log', `no separate scorecard tab (${await tabs()})`)
  ok(await p.locator('[data-testid="dash-deliv"] [data-testid="target-board"]').count() === 1, 'the dashboard is under Deliverables')
  ok(await p.locator('[data-testid="rk-version"] option').count() === 1 && /First scoring/.test(await txt('rk-why')), 'it is version 1, first scoring')
  /* direction of travel: all projects over twelve months */
  { const up = Number((await txt('rk-travel-up')).replace(/[^0-9]/g, '')), down = Number((await txt('rk-travel-down')).replace(/[^0-9]/g, '')), flat = Number((await txt('rk-travel-flat')).replace(/[^0-9]/g, ''))
    ok(up + down + flat === 300 && up > 0 && down > 0, `direction of travel: every project is counted as rose, fell or held (${up} + ${down} + ${flat})`)
    ok(await p.locator('[data-testid="rk-travel"] path[data-line]').count() === up + down && await p.locator('[data-testid="rk-travel"] svg.rk-tr-svg path').count() >= 300, 'one line per project; the ones that rose or fell are picked out')
    ok(await p.locator('[data-testid="rk-travel-rose"] .rk-tr-row').count() === Math.min(5, up) && await p.locator('[data-testid="rk-travel-fell"] .rk-tr-row').count() === Math.min(5, down) && await p.locator('[data-testid="rk-travel"] .rk-tr-lab').count() >= 3, 'the largest movers are named on the chart and listed below it')
    await p.locator('[data-testid="rk-travel-down"]').click(); await p.waitForTimeout(200)
    ok(await p.locator('[data-testid="rk-travel"] path[data-line]').count() === down, 'the chips pick out one direction at a time')
    await p.locator('[data-testid="rk-travel-all"]').click(); await p.waitForTimeout(150)
    const first = await p.locator('[data-testid="rk-travel-rose"] .rk-tr-row').first().getAttribute('data-c')
    await p.locator('[data-testid="rk-travel-rose"] .rk-tr-row').first().click(); await p.waitForTimeout(400)
    ok(await p.locator('[data-testid="sb-detail"]').getAttribute('data-c') === first, 'a project opens from the direction of travel list'); await back() }
  await p.locator('[data-testid="rk-travel"]').scrollIntoViewIfNeeded(); await shot('3b_travel')
  const s0 = await dist('sb-n'); ok(s0.reduce((a, c) => a + c, 0) === 300 && (await num('rk-high')) === s0[2] + s0[3], `dashboard: 300 projects, one score each (${s0.join('+')})`)
  ok(await p.locator('[data-testid="rk-matrix"] circle').count() === 300, 'bubble chart: one bubble per project')
  const chart = await p.locator('[data-panel="matrix"]').innerText()
  ok(/Risk score \(1 good, 4 bad\)/.test(chart) && /Months left on the contract/.test(chart) && /Bubble size: annual revenue/.test(chart), 'bubble chart: both axes and the bubble size are labelled')
  ok(await p.locator('[data-testid="rk-plans"] tbody tr').count() === 10 && (await num('rk-plan-sites')) > 50, 'mitigation plans: every site with a poor signal has one, whether or not its score moved')
  await shot('3_dashboard'); await fits('dashboard'); await clean('dashboard')
  await openProject('NCO-047')
  ok((await num('sb-rating')) === 2 && (await num('sb-score')) < 2.5, 'Harlow Creek: one score, rated 2 today')
  ok(await p.locator('[data-testid="rk-web"] g[data-factor]').count() === 17, 'the web of the site has one spoke per factor')
  ok(await p.locator('[data-testid="rk-drivers"] .rk-driver').count() >= 3, 'why it scores that: the signals at 3 or 4')
  ok(await p.locator('[data-testid="sb-do"] .rk-act').count() >= 3 && await p.locator('[data-testid="sb-do"] .rk-basis').count() >= 3 && await p.locator('[data-testid="rk-effect"]').count() === 1, 'mitigation: actions for the site, each saying what it was written from, and the score the plan would bring')
  await p.locator('[data-testid="rk-assign"]').click(); await p.waitForTimeout(200)
  ok(/Owners told/.test(await txt('rk-assigned')), 'assign the plan: the actions are open and the owners told')
  await p.locator('[data-testid="rk-drivers"] .rk-driver[data-signal="sl1"] .sb-ev').click()
  ok(await drawerOpen() && /Rank 1 is the lowest cost/.test(await p.locator('.ant-drawer .ws').innerText()), 'evidence: the state ranking opens the web page it was read from')
  await closeDrawer(); await shot('4_site'); await fits('site'); await clean('site'); await back()
  await p.locator('[data-testid="rk-plans"] tbody tr').nth(1).click(); await p.waitForTimeout(400)
  const acts = await p.locator('[data-testid="sb-do"] .rk-act p').allInnerTexts()
  ok(acts.length >= 2 && new Set(acts).size === acts.length, 'another site: its own plan, no two actions the same')
  await back()

  /* the morning check */
  await p.locator('.panel-actions .btn', { hasText: 'Simulate' }).click()
  ok(await waitFor(async () => (await p.locator('.ant-notification-notice', { hasText: 'moved up a rating' }).count()) > 0, 5000), 'fired: the notification says who moved')
  ok(await waitFor(async () => (await J()).status === 'executed', 90000), 'check: fired, ran, built and acted by itself')
  await p.waitForTimeout(500); await closeToasts()
  const j = await J()
  ok(j.built === 3 && j.acts.some((a) => a.cat === 'tell') && j.acts.some((a) => a.cat === 'deck') && j.acts.every((a) => a.state === 'done'), 'built the deck and the plans, told the owners, nothing left waiting')
  await tab('Deliverables'); await p.locator('.gp .dl-tab').first().click(); await p.waitForTimeout(400)
  ok(await p.locator('[data-testid="rk-version"] option').count() === 1 && /First scoring/.test(await txt('rk-why')) && /Refreshed 20 Nov, 06:08/.test(await txt('rk-refreshed')), 'the morning check refreshes the dashboard: it is still version 1, because the scoring did not change')
  ok((await p.locator('.gp .dl-tab').first().innerText()).replace(/\s+/g, '') === 'Contractriskdashboardv1' && /keeps its version number/.test(await p.locator('.hub-feed').innerText()), 'the deliverable is still labelled version 1, and the chat says why')
  { const t = await p.locator('[data-testid="rk-travel"]').innerText(); ok(/Harlow Creek/.test((await p.locator('[data-testid="rk-travel-rose"] .rk-tr-row').first().innerText())) && /rose/.test(t) && /fell/.test(t), 'direction of travel after the check: the project that moved this morning leads the list of risers') }
  ok(await p.locator('[data-testid="sb-changed"] .rk-mover.is-up').count() === 1, 'one project moved up a rating')
  await p.locator('.rk-mover[data-c="NCO-047"]').click(); await p.waitForTimeout(450)
  ok((await num('sb-rating')) === 3 && await p.locator('[data-testid="sb-moved"]').count() === 1 && await p.locator('.rk-driver.is-chg').count() === 2, 'Harlow Creek: rated 3, with the two signals that changed first')
  await back(); await p.locator('.rk-mover[data-c="NCO-111"]').click(); await p.waitForTimeout(450)
  ok((await num('sb-rating')) === 2 && await p.locator('[data-testid="rk-add-cp3"]').count() === 1, 'Ashby Falls: still 2; the agenda item is seen, not scored, because the template has no signal for it')
  await back()

  /* the live goal is edited: the signal the template lacks is added from the project, and the dashboard is republished */
  await back(); await p.locator('.rk-mover[data-c="NCO-111"]').click(); await p.waitForTimeout(450)
  await p.locator('[data-testid="rk-add-cp3"]').click(); await p.waitForTimeout(400)
  await tab('Plan')
  ok(/You changed the scoring/.test(await txt('sdz-live')) && await p.locator('.sdz-sig[data-signal="cp3"]').count() === 1, 'the signal is now on the scorecard of the live goal')
  ok(/Publish version 2/.test(await p.locator('[data-testid="sdz-publish"]').innerText()), 'the change is waiting to be published')
  await p.locator('[data-testid="sdz-publish"]').click(); await waitFor(async () => /Published\. \*\*Version 2/.test((await p.evaluate(() => { const st = window.__cwJourney.useJourney.getState(); return st.goals[st.current].chat.slice(-1)[0].text || '' })))); await p.waitForTimeout(700)
  ok(await p.locator('[data-testid="dash-deliv"]').count() === 1 && await p.locator('[data-testid="rk-version"] option').count() === 2 && /signal added/.test(await txt('rk-why')), `published: a change to the scoring makes version 2, and it says why (${await txt('rk-why')})`)
  ok(/Version 2 of the dashboard/.test(await p.locator('.hub-feed').innerText()), 'the chat records the new version')
  await back(); await p.locator('.rk-tr-row[data-c="NCO-111"], .rk-mover[data-c="NCO-111"]').first().click(); await p.waitForTimeout(450)
  ok((await num('sb-rating')) === 3, 'Ashby Falls now rates 3, because the talk of in-house operation is scored')
  await back()
  await p.locator('[data-testid="rk-version"]').selectOption('1'); await p.waitForTimeout(400)
  ok(await p.locator('[data-testid="rk-old"]').count() === 1 && /First scoring/.test(await p.locator('[data-testid="rk-old"]').innerText()), 'version 1 can still be opened')
  await p.locator('[data-testid="rk-latest"]').click(); await p.waitForTimeout(300)
  ok(await p.locator('[data-testid="rk-old"]').count() === 0, 'and the latest opens again')
  await shot('5_versions'); await fits('versions'); await clean('versions')

  /* ---- the live goal is changed in the chat: ask, draft, change plan, publish or discard */
  {
    const jj = () => p.evaluate(() => { const st = window.__cwJourney.useJourney.getState(); return st.goals[st.current] })
    const lastText = async () => (await jj()).chat.slice(-1)[0].text || ''
    const planned = async () => { const r = await waitFor(async () => { const j = await jj(); return !j.changing && (await p.locator('[data-testid="chg-card"]').count()) === 1 }); await p.waitForTimeout(400); return r }
    const cardText = async () => (await p.locator('[data-testid="chg-card"]').innerText()).replace(/\n+/g, ' | ')
    const chipTexts = async () => (await p.locator('.gc-chip').allInnerTexts())
    /* come back to it through the list of standing goals */
    await p.evaluate(() => { window.location.hash = '#/K/ask' }); await p.waitForTimeout(700)
    await p.evaluate(() => { window.location.hash = '#/K/goals' }); await p.waitForTimeout(800)
    if (!(await p.locator('.hub-rail').count())) { await p.locator('.hub-top .hub-icon[aria-label="Show the list"]').first().click(); await p.waitForTimeout(400) }
    ok(await p.locator('#j-standing .rl-item').count() === 1, 'the live goal is in the list of standing goals')
    await p.locator('#j-standing .rl-item').first().click(); await p.waitForTimeout(700)
    ok((await chipTexts()).includes('Change the scorecard'), 'opened from the list, the chat offers to change the scorecard')
    await p.locator('.gc-chip', { hasText: 'Change the scorecard' }).click(); await p.waitForTimeout(600)
    ok(/Tell me in your own words what to change/.test(await lastText()) && /version 3/.test(await lastText()) && (await chipTexts()).length === 4, 'it says what can be changed, that it will be version 3, and gives four examples')
    const n0 = await p.evaluate(() => window.__cwDesign.DESIGN.custom.length)
    await p.locator('.gc-chip', { hasText: 'boil water' }).click()
    ok(await waitFor(async () => (await p.locator('.ap').last().locator('.ap-line').count()) >= 2, 8000), 'the change is worked on step by step')
    ok(await planned(), 'then the change plan is in the chat')
    ok(await p.locator('.ap').last().locator('.ap-line').count() === 6, 'six steps: understand, draft, find the data, score, compare, plans')
    let c = await cardText()
    ok(/Change plan: version 3 of the dashboard/.test(c) && /Draft · not published/.test(c), 'the change plan is for version 3 and says it is a draft')
    ok(/New signal Boil water notices in the last twelve months in Water Quality and Contaminants/.test(c) && /red flag/.test(c), 'it says what changes: the new signal, its factor, its rule, the red flag')
    ok(await p.locator('[data-testid="chg-table"] tbody tr').count() === 8 && /Version 2/.test(await p.locator('[data-testid="chg-table"] thead').innerText()), 'it compares the draft with version 2: ratings, revenue, act now, signals')
    ok(/\d+ of 300 scores move/.test(await txt('chg-line')) && /projects? changes? rating/.test(await txt('chg-line')) && await p.locator('[data-testid="chg-moves"] li').count() >= 1, `it says how many scores move and names the projects that change rating (${await txt('chg-line')})`)
    ok(/Version 2 stays in the version list/.test(c) && /Nobody is alerted/.test(c) && /mitigation plans are written again/.test(c), 'it says what publishing does')
    ok(await p.evaluate(() => window.__cwDesign.DESIGN.custom.length) === n0 + 1 && await p.locator('.sdz-sig', { hasText: 'Boil water notices' }).count() === 1, 'the plan on the right shows the draft: the new signal is on the scorecard')
    ok(/still shows version 2/.test(await txt('sdz-live')) && /Publish version 3/.test(await txt('sdz-publish')) && await p.locator('[data-testid="sdz-discard"]').count() === 1, 'the plan says the dashboard still shows version 2, with publish and discard')
    await shot('5b_change_plan'); await fits('change plan'); await clean('change plan')
    /* a second change joins the same draft */
    await say('Change days sales outstanding: score 4 from 75 days')
    ok(await planned(), 'a second change gets its own pass')
    c = await cardText()
    ok(await p.locator('[data-testid="chg-what"] .diff-row').count() === 2 && /Days sales outstanding: 1 = /.test(c) && /4 = 75 days or more/.test(c) && /The thresholds were/.test(c), 'the change plan now holds both changes, with the rule as it will read')
    ok(await p.locator('.hc-folded', { hasText: 'Carried into the change plan below' }).count() === 1, 'the earlier change plan is folded into the new one')
    /* things it will not do */
    await say('days sales outstanding: score 4 from 50 days'); await p.waitForTimeout(500)
    ok(/out of order/.test(await lastText()), 'thresholds out of order are refused in plain words')
    await say('make nitrogen in effluent score 4 from 70'); await p.waitForTimeout(500)
    ok(/regulatory or permit limit/.test(await lastText()), 'a rule that follows a regulatory limit is left as written')
    await say('change the weight of the scorecard'); await p.waitForTimeout(500)
    ok(/did not catch what to change/.test(await lastText()), 'a request it cannot read gets examples, not a guess')
    /* discard */
    await p.locator('[data-testid="chg-discard"]').click(); await p.waitForTimeout(600)
    ok(/Discarded\. The scorecard is back as in version 2/.test(await lastText()) && await p.locator('[data-testid="chg-card"]').count() === 0 && await p.locator('.hc-folded', { hasText: 'Discarded' }).count() >= 1, 'discard: the draft is gone and the chat says so')
    ok(await p.evaluate(() => window.__cwDesign.DESIGN.custom.length) === n0 && await p.locator('.sdz-sig', { hasText: 'Boil water notices' }).count() === 0 && await p.locator('[data-testid="sdz-publish"]').count() === 0, 'discard: the scorecard is as in version 2 and nothing waits to be published')
    /* ask again and publish */
    await say('Add a signal for boil water notices in the last twelve months, under Water Quality and Contaminants, and make it a red flag')
    ok(await planned(), 'asked again: a new change plan')
    const up = await p.locator('[data-testid="chg-moves"] li.is-up').count()
    await p.locator('.gc-chip', { hasText: 'Publish version 3' }).click()
    ok(await waitFor(async () => /Published\. \*\*Version 3/.test(await lastText())), 'publish from the chat: version 3')
    await p.waitForTimeout(800)
    ok(/Publishing version 3/.test(await p.locator('.hub-feed').innerText()) && /Nobody is alerted/.test(await lastText()), 'publishing runs step by step and says nobody is alerted')
    ok(await p.locator('[data-testid="rk-version"] option').count() === 3 && /new signal: Boil water notices/.test(await txt('rk-why')), `the dashboard is version 3 and says why (${await txt('rk-why')})`)
    ok(await p.locator('.hc-folded', { hasText: 'Published as version 3' }).count() === 1 && await p.locator('[data-testid="chg-card"]').count() === 0, 'the change plan is folded as published')
    { const j = await jj(); const pub = (j.published || []).slice(-1)[0]; ok(pub && pub.v === 3 && pub.changes.length === 1 && pub.effect && pub.effect.up.length === up, 'the goal keeps a record of the version: what changed and which projects moved') }
    await tab('Plan'); ok(/This goal is live and can be edited/.test(await txt('sdz-live')), 'after publishing, nothing waits on the plan'); await tab('Deliverables')
    await shot('5c_version_3'); await clean('version 3')
  }

  /* the same dashboard in Submissions */
  const sid = await p.evaluate(() => window.__cwSubs.getState().submissions.find((s) => s.delivId === 'sub-risk-scorecard')?.id)
  ok(!!sid, 'Submissions holds the dashboard')
  await p.evaluate((id) => { window.location.hash = `#/K/submissions/${id}` }, sid); await p.waitForTimeout(1500)
  ok(await waitFor(async () => (await p.locator('[data-testid="dash-embed"] [data-testid="target-board"]').count()) === 1, 8000), 'opened from Submissions, it is the same live dashboard')
  { const w = await p.evaluate(() => { const e = document.querySelector('[data-testid="dash-embed"]'), c = document.querySelector('.hp-canvas .sd-canvas'); return [Math.round(e.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().width)] }); ok(w[0] >= w[1] - 4, `in Submissions the dashboard takes the full width of the panel (${w.join(' of ')})`) }
  ok(/views · version 3/.test(await txt('dash-meta')), `Submissions labels it with its views and the scoring version (${await txt('dash-meta')})`)
  await p.getByRole('button', { name: /Full screen/ }).click(); await p.waitForTimeout(600)
  ok(await p.locator('[data-testid="dash-full"] [data-testid="target-board"]').count() === 1 && await p.locator('.pr-slide').count() === 0, 'Full screen shows the dashboard itself, not slides')
  ok(await p.locator('[data-testid="dash-full"] [data-testid="rk-matrix"] circle').count() === 300 && await p.locator('[data-testid="dash-full"] [data-testid="rk-travel"]').count() === 1, 'full screen: the bubble chart and the direction of travel are there')
  { const two = await p.evaluate(() => { const a = document.querySelector('[data-testid="dash-full"] [data-panel="travel"]').getBoundingClientRect(), b = document.querySelector('[data-testid="dash-full"] [data-panel="matrix"]').getBoundingClientRect(); return Math.abs(a.top - b.top) < 4 && b.left > a.right - 4 }); ok(two, 'full screen: the two charts sit side by side') }
  await p.locator('[data-testid="dash-full"] .rk-tr-row').first().click(); await p.waitForTimeout(400)
  ok(await p.locator('[data-testid="dash-full"] [data-testid="sb-detail"]').count() === 1, 'full screen: a project opens inside it')
  await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  ok(await p.locator('[data-testid="dash-full"]').count() === 0, 'Esc leaves full screen')
  await clean('submissions')

  /* ================= path 2: no template ================= */
  await newWatch()
  ok(await asked('frame'), 'second goal: asked for a template again')
  await tile('frame', 'No. Propose one').click()
  ok(await waitFor(async () => (await p.locator('[data-testid="sdz-drafting"]').count()) === 1, 8000) && await p.locator('[data-testid="sdz"]').count() === 0, 'proposed: the scorecard is drafted step by step before it is shown')
  ok(await asked('design'), 'proposed: then the scorecard')
  ok(/16 factors · 70 signals/.test(await txt('sdz-counts')), `proposed: 16 factors and 70 signals (${await txt('sdz-counts')})`)
  ok(await p.locator('.sdz-sect').count() === 0 && await p.locator('[data-part="sections"]').count() === 0, 'proposed: one scorecard; no second part and no lettered sections')
  ok(await p.locator('[data-part="sheet"] .sdz-grp[data-group]').count() === 3 && await p.locator('[data-part="sheet"] .sdz-f').count() === 17 && await p.locator('[data-part="sheet"] .sdz-sig').count() === 77, 'proposed: all 17 factors and 77 signals sit in the one scorecard, in three groups')
  ok(await p.locator('[data-group="internal"] [data-factor="fp"]').count() === 1 && await p.locator('[data-group="external"] [data-factor="cp"]').count() === 1 && await p.locator('[data-group="impact"] [data-factor="im"]').count() === 1, 'proposed: financial performance, client and political, and what is at stake are factors of the same scorecard')
  { const t = await planText(); const m = t.match(/\bsheet\b|part [1-9]\b|sections? [A-F]\b|sections A to F|does not cover|not in your template/i); ok(!m, `proposed: no mention of a sheet, a part or a section (${m ? t.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\n/g, ' ') : ''})`) }
  ok(/3 of 3/.test(await txt('sdz-caught')) && (await num('sdz-act')) > 0, 'proposed: catches all three lost contracts, and counts high risk with a lot at stake')
  ok((await p.locator('[data-part] .sdz-no').allInnerTexts()).join('') === '1234', 'proposed: the plan has four parts: scorecard, data check, dashboard, mitigation and rules')
  /* drop and put back, on the panel */
  let [f0, n0] = await counts()
  await p.locator('[data-testid="sdz-drop-cl1"]').click(); await p.waitForTimeout(250)
  ok((await counts())[1] === n0 - 1 && /Put back/.test(await txt('sdz-drop-cl1')) && await p.locator('.sdz-sig[data-signal="cl1"].is-off').count() === 1, 'a signal is dropped from the panel with one click')
  await p.locator('[data-testid="sdz-drop-cl1"]').click(); await p.waitForTimeout(250)
  ok((await counts())[1] === n0 && /Drop/.test(await txt('sdz-drop-cl1')), 'and put back with one click')
  /* a new signal inside a factor, with its own rule for 1 to 4 */
  await p.locator('[data-testid="sdz-addsig-fp"]').click()
  await p.locator('[data-testid="sdz-newsig-name-fp"]').fill('Invoices the client pays late')
  for (const [i, t] of [[1, 'None in 12 months'], [2, '1 or 2 late'], [3, '3 to 5 late'], [4, 'More than 5 late']]) await p.locator(`[data-testid="sdz-newsig-b${i}-fp"]`).fill(t)
  await p.locator('[data-testid="sdz-newsig-add-fp"]').click(); await p.waitForTimeout(300)
  { const row = p.locator('[data-factor="fp"] .sdz-sig', { hasText: 'Invoices the client pays late' }); ok(await row.count() === 1 && /None in 12 months/.test(await row.innerText()) && /More than 5 late/.test(await row.innerText()) && (await counts())[1] === n0 + 1, 'a signal is added inside a factor, with the rule for 1 to 4 you wrote') }
  ok(/Added to Financial Performance/.test(await txt('sdz-newsig-said-fp')) && /rule you wrote/.test(await txt('sdz-newsig-said-fp')), 'the panel confirms where it was added and how it scores')
  /* a new factor, and a signal in it */
  await p.locator('[data-testid="sdz-addfac-internal"]').click(); await p.locator('[data-testid="sdz-newfac-name-internal"]').fill('Energy cost'); await p.locator('[data-testid="sdz-newfac-add-internal"]').click(); await p.waitForTimeout(300)
  ok(await p.locator('[data-group="internal"] [data-factor="uf1"]').count() === 1 && /No signal yet/.test(await p.locator('[data-factor="uf1"]').innerText()) && (await counts())[0] === f0, 'a factor is added; it does not count until it has a signal')
  await p.locator('[data-testid="sdz-newsig-name-uf1"]').fill('Power cost per million gallons against budget'); await p.locator('[data-testid="sdz-newsig-add-uf1"]').click(); await p.waitForTimeout(300)
  ok((await counts())[0] === f0 + 1 && (await counts())[1] === n0 + 2 && !/off/.test(await txt('sdz-fw-uf1')), 'with its first signal the new factor counts and has a share of the score')
  /* the same by saying it */
  await say('drop odor complaints')
  ok(await waitFor(async () => /Dropped Odor complaints from Community Standing/.test(await p.locator('.hub-feed').innerText()), 5000) && await p.locator('.sdz-sig[data-signal="co1"].is-off').count() === 1 && (await counts())[1] === n0 + 1, 'chat: "drop odor complaints" drops the signal')
  await say('put back odor complaints'); await p.waitForTimeout(300)
  ok(await p.locator('.sdz-sig[data-signal="co1"].is-off').count() === 0 && (await counts())[1] === n0 + 2, 'chat: and puts it back')
  await say('add a factor Regulator relationship under what we do not control'); await p.waitForTimeout(300)
  ok(await p.locator('[data-group="external"] [data-factor="uf2"]').count() === 1, 'chat: a factor is added to what we do not control')
  await say('add a signal inspection findings left open to Regulator relationship: 1 = none, 2 = one, 3 = two or three, 4 = more than three'); await p.waitForTimeout(400)
  { const row = p.locator('[data-factor="uf2"] .sdz-sig'); ok(await row.count() === 1 && /Inspection findings left open/.test(await row.innerText()) && /more than three/.test(await row.innerText()) && (await counts())[0] === f0 + 2 && (await counts())[1] === n0 + 3, 'chat: a signal is added to that factor with the rule given in the sentence') }
  ok(/Added Inspection findings left open to Regulator relationship/.test(await p.locator('.hub-feed').innerText()), 'chat: the answer says where it went')
  await shot('6a_edited')
  await openS('cr2')
  const b4 = Number(await p.locator('[data-testid="sdz-bands-cr2"] .sdz-band b').nth(3).innerText())
  await p.locator('[data-testid="sdz-cut-cr2-2"]').fill('120'); await p.waitForTimeout(250)
  ok(Number(await p.locator('[data-testid="sdz-bands-cr2"] .sdz-band b').nth(3).innerText()) < b4 && /120 days or more/.test(await p.locator('.sdz-sig[data-signal="cr2"] .sdz-rule4').first().innerText()), 'a threshold moved: DSO scores 4 from 120 days, and the rule on the scorecard says so')
  /* the rule for 1 to 4 is rewritten, line by line */
  ok(await p.locator('[data-testid="sdz-edit-cr1"]').count() === 1 && /Edit/.test(await txt('sdz-edit-cr1')), 'every signal has an Edit button for its rule')
  await p.locator('[data-testid="sdz-edit-cr1"]').click(); await p.waitForTimeout(200)
  await p.locator('[data-testid="sdz-bt-cr1-1"]').fill('Not in a state with tough prevailing wage rules'); await p.keyboard.press('Enter'); await p.waitForTimeout(250)
  ok(/tough prevailing wage rules/.test(await p.locator('.sdz-sig[data-signal="cr1"] .sdz-rule4').first().innerText()) && /Saved/.test(await txt('sdz-bt-saved-cr1')), 'a written case is rewritten: the new wording is on the scorecard')
  ok(/tough prevailing wage rules/.test(await p.locator('[data-testid="sdz-check"] tr[data-signal="cr1"]').innerText()), 'and the data check shows the new wording too')
  const b1 = Number(await p.locator('[data-testid="sdz-bands-cr2"] .sdz-band b').nth(0).innerText())
  await p.locator('[data-testid="sdz-bt-cr2-1"]').fill('Under 30 days'); await p.keyboard.press('Enter'); await p.waitForTimeout(300)
  { const r4 = await p.locator('.sdz-sig[data-signal="cr2"] .sdz-rule4').first().innerText(); ok(/Under 30 days/.test(r4) && /30 to 60 days/.test(r4) && (await p.locator('[data-testid="sdz-cut-cr2-0"]').inputValue()) === '30', `"Under 45 days" rewritten to "Under 30 days": the threshold moves to 30 and the next case follows (${r4.replace(/\n/g, ' | ')})`) }
  ok(Number(await p.locator('[data-testid="sdz-bands-cr2"] .sdz-band b').nth(0).innerText()) < b1 && /threshold moved/.test(await txt('sdz-bt-saved-cr2')), 'and the projects are sorted again on it')
  const fw0 = await txt('sdz-fw-st'); await p.locator('[data-testid="sdz-fw-st"] button').last().click(); await p.waitForTimeout(200)
  ok((await txt('sdz-fw-st')) !== fw0, 'a factor weight changed')
  await p.locator('[data-testid="sdz-add-input"]').fill('operators working more than two weekends in a row'); await p.locator('[data-testid="sdz-add-btn"]').click(); await p.waitForTimeout(300)
  ok(/Added to Workforce/.test(await txt('sdz-said')) && (await counts())[1] === n0 + 4, 'a signal described in one sentence: placed in a factor, given a source and a rule')
  await p.locator('.sdz-panel[data-panel="heat"] input').click(); await p.waitForTimeout(150)
  await p.locator('[data-testid="sdz-rule-input"]').fill('put it on the agenda of the monthly review'); await p.locator('[data-testid="sdz-rule-btn"]').click(); await p.waitForTimeout(200)
  ok(await p.locator('.sdz-rule').count() === 8, 'rules: your own rule added to the seven proposed')
  await tile('design', 'Score on it').click(); ok(await asked('check'), 'proposed: the data check'); await tile('check', 'Confirm the assumptions').click()
  await build()
  ok(/Where you open it, every time: Submissions in the left menu/.test(await p.locator('.hub-feed').innerText()) && /build the dashboard/.test(await p.locator('.hub-feed').innerText()), 'armed: the chat shows the build step by step and says where the dashboard is opened')
  ok(/Submissions/.test(await txt('rk-where')) && await p.locator('[data-testid="rk-open-sub"]').count() === 1, 'the dashboard itself says where it lives, with a link to Submissions')
  ok(await p.locator('[data-testid="rk-web"]').count() === 0 && await p.locator('.hub-panel').first().evaluate((e) => e.scrollTop) < 5, 'the dashboard opens at its top')
  ok(await p.locator('[data-panel="heat"]').count() === 0 && await p.locator('[data-panel="matrix"]').count() === 1 && (await num('rk-act')) > 0, 'dashboard: the view you unticked is gone; high risk with a lot at stake is counted')
  await p.locator('.panel-actions .btn', { hasText: 'Simulate' }).click()
  ok(await waitFor(async () => (await J()).status === 'executed', 90000), 'proposed: the morning check runs')
  await closeToasts(); await tab('Deliverables'); await p.locator('.gp .dl-tab').first().click(); await p.waitForTimeout(400)
  ok(await p.locator('[data-testid="sb-changed"] .rk-mover.is-up').count() === 2, 'proposed: two projects move up, because the scorecard scores the client side too')
  await shot('6_proposed'); await fits('proposed'); await clean('proposed')
  /* ================= Ask: the same scorecard, answered in words ================= */
  await p.evaluate(() => { window.location.hash = '#/K/ask' }); await p.waitForTimeout(900)
  ok(await p.locator('[data-testid="ask-risk"]').count() === 1 && await p.locator('.aq-q').count() >= 60, `Ask: the questions leaders ask are listed (${await p.locator('.aq-q').count()})`)
  ok(/20 November morning check/.test(await txt('aq-asof')) && /factors/.test(await txt('aq-asof')), `Ask: says which scorecard and which check it answers from (${(await txt('aq-asof')).slice(0, 90)})`)
  const answered = () => waitFor(async () => (await p.locator('.aq-turn').last().locator('.aq-a').count()) === 1, 15000)
  const askQ = async (q) => { await p.locator('[data-testid="aq-input"]').fill(q); await p.keyboard.press('Enter'); await answered(); await p.waitForTimeout(200) }
  await p.locator('.aq-q', { hasText: 'For which projects did the risk increase in the last 90 days' }).click()
  ok(await waitFor(async () => (await p.locator('[data-testid="aq-thinking"]').count()) === 1, 4000), 'Ask: it shows what it reads before it answers')
  await answered()
  { const a = p.locator('.aq-a').last(); ok(/rose in the last 90 days/.test(await a.locator('.aq-head').innerText()) && await a.locator('[data-testid="aq-table"] tbody tr').count() >= 3 && /Ashby Falls|Harlow Creek/.test(await a.innerText()) && await a.locator('.aq-src em').count() >= 1 && await a.locator('.aq-follow button').count() === 3, 'Ask: which projects rose and why, with the projects, the reasons, the sources and what to ask next') }
  await askQ('for Sable Creek wastewater treatment plant, what is the status and why did the risk go up?')
  { const a = p.locator('.aq-a').last(), t = await a.innerText(); ok(/Sable Creek rates \d/.test(t) && /Why it went up in the last 90 days/.test(t) && /What to do/.test(t) && await a.locator('[data-testid="aq-table"] tbody tr').count() >= 3, 'Ask: one project by name: its status, why it rose, what to do') }
  await askQ('tell me which projects have not recorded any safety observation in the last 2 weeks')
  { const a = p.locator('.aq-a').last(); ok(/have not recorded a safety observation in the last two weeks/.test(await a.locator('.aq-head').innerText()) && /days ago/.test(await a.locator('[data-testid="aq-table"]').innerText()), 'Ask: a question about one signal: which sites, since when') }
  await p.locator('.aq-a').last().locator('[data-testid="aq-table"] tbody tr').first().click(); await answered()
  ok(/rates \d \(/.test(await p.locator('.aq-a').last().locator('.aq-head').innerText()), 'Ask: a project in an answer opens with one click')
  await askQ('what is the weather like')
  ok(/cannot answer that/.test(await p.locator('.aq-a').last().innerText()) && await p.locator('.aq-a').last().locator('.aq-follow button').count() === 3, 'Ask: what it cannot answer, it says so')
  await shot('7_ask'); await clean('ask')
  ok(errs.length === 0, `no console errors (${errs.slice(0, 3).join(' | ')})`)
  await ctx.close()
}
await b.close()
console.log(`${checks} checks, ${fails} failures`)
process.exit(fails ? 1 : 0)
