/**
 * Writes `mail_corpus` into `backend/risk/risk_sources.json`, from the Contract Risk Analyst
 * package's own real correspondence (`Contract_risk_analyst/json/05_sources_and_catalog/mail.json`).
 *
 *   node backend/scripts/ingest-risk-mail.mjs
 *
 * **Ten real messages, mapped the same way Arcwood's and CAPEX's shipped mail is** — each message
 * becomes one `mail_corpus.documents[]` entry, `mime_type: message/rfc822`, under `label_id: Inbox`
 * (RISK is a Microsoft-brand dataset like both of those, so Outlook's folder name, not Gmail's).
 * `name` is built from the source's own `thread`/`n`/`subject` — `"${thread}-${n} ${subject}.eml"` —
 * which is exactly Arcwood's own naming convention (`"A1-1 Halden Biopharma: quote by Friday 6
 * November.eml"`), not invented here. `snippet`/`size_chars`/`chunks` are read straight off the
 * message's own `text`.
 *
 * **One simplification, stated rather than hidden**: the source names five informal shared
 * mailboxes (`legal-notices`, `southeast-ops`, …), but this app's mail connector models exactly one
 * mailbox — "whoever signed in" — with no picker between several. All ten messages are filed under
 * that one mailbox's Inbox rather than invented as five separate connections.
 *
 * **One genuinely invented field**: `entities`, a bare count with no extraction behind it (nothing
 * here ran an entity extractor). Set to `1` for every message — the one entity link that really is
 * confirmed for each: the `project` code it is filed under — rather than a precise-looking number
 * with nothing real behind the extra precision.
 *
 * This ships the mailbox's *catalogue*. It does not connect it — nothing in this app pre-connects a
 * source; a reader still has to go through Sources → Connect → Microsoft Outlook, the same live step
 * every dataset's mail requires every session (registered sources are in-memory and never persist).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const pkg = join(backend, '..', 'Contract_risk_analyst', 'json')
const out = join(backend, 'risk', 'risk_sources.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const mail = readJson(join(pkg, '05_sources_and_catalog', 'mail.json'))

const problems = []
const documents = []

for (const m of mail) {
  if (!m.thread || m.n == null || !m.subject || !m.text) {
    problems.push(`${m.id ?? '(no id)'}: missing thread/n/subject/text`)
    continue
  }
  const name = `${m.thread}-${m.n} ${m.subject}.eml`
  const size_chars = m.text.length
  documents.push({
    document_id: m.id,
    label_id: 'Inbox',
    name,
    mime_type: 'message/rfc822',
    pages: 1,
    size_chars,
    chunks: Math.max(1, Math.ceil(size_chars / 1500)),
    snippet: m.text.slice(0, 250),
    entities: 1,
  })
}

if (problems.length > 0) {
  console.error(`refusing to write — ${problems.length} problem(s):\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

const existing = readJson(out)
existing.mail_corpus = { documents }
writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

console.log(`wrote ${documents.length} mail_corpus documents into backend/risk/risk_sources.json`)
