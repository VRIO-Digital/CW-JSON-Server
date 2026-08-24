import type { DatasetsPayload, ServerHealth } from '../api/client'

/*
 * The diagnosis behind `/doctor`, as a pure function.
 *
 * **Every verdict is decidable, so it lives where it can be asserted.** The page renders what
 * `diagnose` returns and decides nothing itself — the same split as `datasetPathFix`, and for the same
 * reason: a rule inside a component is a rule a render test has to reach through the component's own
 * state to read at all.
 *
 * **It reports what it was told and never asks a second time.** Each check names the fact it read (the
 * base the bundle was built with, the store the server said it used, the dataset the server said it
 * answered from) and the fix for the state it found. A check that inferred an answer the payload does
 * not carry would be this page guessing, which is the one thing a diagnostics screen must not do — a
 * wrong diagnosis costs more than a missing one.
 *
 * **Three tones, meaning what they mean everywhere else here.** `crit` is broken and nothing will
 * work; `warn` is a precondition somebody has not taken yet — an unsigned session, an unpublished
 * graph — which is a state rather than a fault; `good` is the fact, stated so a reader can check it
 * rather than infer it from an absence of red.
 */

export type DoctorTone = 'good' | 'warn' | 'crit'

export interface DoctorCheck {
  key: string
  label: string
  tone: DoctorTone
  /** What was read. Always populated — a check with no value is a claim with no evidence. */
  value: string
  /** What to do about it, or null when there is nothing to do. */
  fix: string | null
}

/** Everything the page fetched, plus the facts only the browser holds. */
export interface DoctorInput {
  /** `apiBase()` — the value this bundle was built with, never re-read from the environment. */
  apiBase: string
  /** `import.meta.env.MODE` — which .env file supplied it. */
  mode: string
  /** `window.location.protocol`, for the mixed-content check. */
  pageProtocol: string
  health: ServerHealth | null
  healthError: string | null
  datasets: DatasetsPayload | null
  datasetsError: string | null
  /** What the browser sends on every request — `currentDataset()`. */
  sending: string
  identity: { email: string; roleId: string } | null
  /** The persona pool, or null when it could not be read. */
  roleIds: string[] | null
  gate: {
    connectedSources: number
    publishedCount: number
    builtCount: number
    draftCount: number
  } | null
  gateError: string | null
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export function diagnose(input: DoctorInput): DoctorCheck[] {
  const checks: DoctorCheck[] = []

  /*
   * 1. The address in the bundle.
   *
   * `VITE_API_BASE` is inlined at build time, so changing it is a rebuild rather than a restart —
   * which is why an app pointing at the wrong API keeps pointing there through every restart of the
   * right one. The mixed-content case is `crit` because it has no server-side symptom at all: the
   * browser blocks the call and the server never hears it.
   */
  const absolute = /^https?:\/\//.test(input.apiBase)
  const mixed = input.pageProtocol === 'https:' && input.apiBase.startsWith('http://')
  checks.push({
    key: 'api-base',
    label: 'Where this bundle calls the API',
    tone: mixed ? 'crit' : 'good',
    value: `${input.apiBase || '(empty — the page origin)'} · built in ${input.mode} mode`,
    fix: mixed
      ? 'This page is https and that API is http, so the browser blocks every call before it is sent ' +
        '— there is no server-side symptom at all. Put a proxy in front and rebuild with ' +
        'VITE_API_BASE=/api. VITE_* values are inlined at build time, so that is a rebuild, not a ' +
        'restart.'
      : null,
  })

  /*
   * 2. Whether it answers at all. Asked of `/health`, because that route names every dataset rather
   * than the selected one — so it cannot fail on a wrong header, which is what makes it the one call
   * that tells "the server is down" apart from "the server refused my dataset".
   */
  checks.push({
    key: 'api-reachable',
    label: 'The API answers',
    tone: input.health ? 'good' : 'crit',
    value: input.health
      ? `yes — port ${input.health.port}, up ${plural(input.health.uptimeS, 'second')}, ` +
        `${plural(input.health.datasets.length, 'dataset')} read at boot ` +
        `(${input.health.datasets.join(', ')})`
      : (input.healthError ?? 'no answer'),
    fix: input.health
      ? null
      : 'The app has no data without it: run `npm run mock` in a second terminal. If it is already ' +
        'running, check that this page is calling the API named above and not a different one.',
  })

  /*
   * 3. Which store answered. Local files are correct locally and a frozen copy after a deploy, and
   * those are the same word — so the verdict is drawn from *where* the server is rather than left as a
   * rule the reader has to apply.
   */
  if (input.health) {
    const file = input.health.store !== 's3'
    checks.push({
      key: 'store',
      label: 'Which store the server read',
      tone: file && absolute ? 'warn' : 'good',
      value: input.health.store,
      fix:
        file && absolute
          ? 'A remote server reading local files is serving the documents frozen into its bundle at ' +
            'deploy time — every figure plausible and as old as the deploy. S3_BUCKET never reached ' +
            'the process: set it in .ebextensions/02-credentials.config and deploy again.'
          : file
            ? 'Local files, which is the default when S3_BUCKET is unset. `npm run db:pull` makes this ' +
              'checkout agree with the bucket.'
            : null,
    })
  }

  /*
   * 4. The header. The selection travels on `x-dataset`, and a custom request header makes a
   * cross-origin request preflighted — so a server that does not name it in
   * `access-control-allow-headers` fails every call in the browser while `curl` keeps answering 200.
   * When the requests do arrive, this is also where a selector showing one dataset while every figure
   * came from another becomes visible.
   */
  if (input.datasets) {
    const agrees = input.datasets.selected === input.sending
    const pool = input.datasets.datasets.map((d) => d.dataset).join(', ')
    checks.push({
      key: 'dataset-header',
      label: 'The dataset this browser sends, and the one the server answered from',
      tone: agrees ? 'good' : 'crit',
      value: `sending ${input.sending} · answered from ${input.datasets.selected}`,
      fix: agrees
        ? null
        : 'The x-dataset header is not arriving, so every page is showing another dataset’s figures ' +
          'under this one’s name. A custom request header is preflighted cross-origin: the server’s ' +
          'OPTIONS reply has to name it in access-control-allow-headers.',
    })

    /* A persisted selection can outlive the dataset it names — which bricked this app once, because
       the value survives a reload and a sign-out and every request was refused. */
    const known =
      input.datasets.datasets.some((d) => d.dataset === input.sending) ||
      input.datasets.both.dataset === input.sending
    checks.push({
      key: 'dataset-known',
      label: 'The selected dataset is one the server has',
      tone: known ? 'good' : 'crit',
      value: known
        ? `${input.sending} · this tenant has ${pool}`
        : `${input.sending} is not a dataset — the server has ${pool}`,
      fix: known
        ? null
        : 'The selection is persisted, so it survives a reload and a sign-out. request() discards a ' +
          'refused one and retries on the primary; if every page is still failing, change it on ' +
          'Settings → Dataset.',
    })

    /* An empty dataset is a fact about the data, not a fault — stated so "this page is blank" has an
       answer that is not a bug hunt. */
    const empty = input.datasets.datasets.filter((d) => !d.populated).map((d) => d.dataset)
    if (empty.length > 0) {
      checks.push({
        key: 'dataset-empty',
        label: 'Datasets holding no data yet',
        tone: 'good',
        value: empty.join(', '),
        fix: 'A page reading one of these is empty because the dataset is, not because it failed.',
      })
    }
  } else if (input.datasetsError !== null) {
    checks.push({
      key: 'dataset-header',
      label: 'The dataset this browser sends, and the one the server answered from',
      tone: 'crit',
      value: `sending ${input.sending} · ${input.datasetsError}`,
      fix: 'Until /datasets answers, nothing can confirm which dataset a page is showing.',
    })
  }

  /*
   * 5. Who this browser thinks it is. The identity is client-held, so a persona removed from the pool
   * strands a signed-in browser — the same hazard the persisted dataset has, and the reason every
   * persisted reference here needs an answer to "what if the thing is gone".
   */
  const identity = input.identity
  const strandedRole =
    identity !== null && input.roleIds !== null && !input.roleIds.includes(identity.roleId)
  checks.push({
    key: 'identity',
    label: 'Who this browser is signed in as',
    tone: identity === null ? 'warn' : strandedRole ? 'crit' : 'good',
    value:
      identity === null
        ? 'signed out'
        : `${identity.email} · ${identity.roleId}${strandedRole ? ' — no such persona' : ''}`,
    fix:
      identity === null
        ? 'Every page but this one and /login is behind the sign-in. Sign in to reach them.'
        : strandedRole
          ? 'This browser holds a persona the tenant no longer has, so anything resolved against it ' +
            'will fail. Sign out and back in.'
          : null,
  })

  /*
   * 6. The two preconditions that make pages empty on purpose. Reported together because "no source is
   * connected" and "nothing is published" produce the same blank screen and have different fixes —
   * which is the whole reason those empty states name counts rather than just saying no.
   */
  if (input.gate) {
    checks.push({
      key: 'sources',
      label: 'Connected sources',
      tone: input.gate.connectedSources > 0 ? 'good' : 'warn',
      value: String(input.gate.connectedSources),
      fix:
        input.gate.connectedSources > 0
          ? null
          : 'Nothing exists until a source is connected: the Data Catalog, Profiling jobs, Traces and ' +
            'Validation render their empty state. Connect one on Sources.',
    })
    checks.push({
      key: 'published',
      label: 'Published graphs',
      tone: input.gate.publishedCount > 0 ? 'good' : 'warn',
      value:
        `${input.gate.publishedCount} published · ${input.gate.builtCount} built · ` +
        `${input.gate.draftCount} draft`,
      fix:
        input.gate.publishedCount > 0
          ? null
          : input.gate.builtCount > 0
            ? 'Ask, Reports, the What-if lens and Audit & Governance all read a published graph. ' +
              'Publish a build from its row on Graph Studio’s Versions tab.'
            : 'Ask, Reports, the What-if lens and Audit & Governance all read a published graph, and ' +
              'nothing is built yet. Build one in New Graph, then publish it in Graph Studio. ' +
              'Publication lives in memory, so a restart closes those pages again.',
    })
  } else if (input.gateError !== null) {
    checks.push({
      key: 'published',
      label: 'Published graphs',
      tone: 'crit',
      value: input.gateError,
      fix: 'The publish gate cannot be read, so those four pages cannot say why they are empty.',
    })
  }

  return checks
}

/** The worst tone present — what the page leads with, so a reader needs no scan to know. */
export function overallTone(checks: DoctorCheck[]): DoctorTone {
  if (checks.some((c) => c.tone === 'crit')) return 'crit'
  if (checks.some((c) => c.tone === 'warn')) return 'warn'
  return 'good'
}

/**
 * The diagnosis as text, for pasting into a ticket.
 *
 * Rendered from the same checks the page shows, so a pasted report cannot say something the screen
 * does not. `at` is passed in rather than read here, which is what keeps this pure and assertable.
 */
export function doctorReport(checks: DoctorCheck[], at: string): string {
  return [
    `Context Weave diagnostics — ${at}`,
    ...checks.map(
      (c) =>
        `[${c.tone.toUpperCase()}] ${c.label}: ${c.value}` + (c.fix ? `\n    fix: ${c.fix}` : ''),
    ),
  ].join('\n')
}
