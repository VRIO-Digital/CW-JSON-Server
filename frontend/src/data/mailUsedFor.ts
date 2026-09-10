/**
 * What a mailbox is **used for**, written at the step that picks it.
 *
 * **Two mailboxes look alike.** An address says whose mail it is and nothing about what it holds,
 * so a use case drawing on one has to be able to say which — and the person picking it at step 4 is
 * the one who knows. This is the only thing the wizard asks a reader to *write* about a source,
 * which is why the prompt is specific about the register: a sentence the way a question would be
 * asked, not a job title.
 *
 * Copy and the length rule live here rather than in the component for the reason `sourceActions`
 * does: a `Modal` renders through a portal `renderToString` will not traverse, so a sentence
 * written inside one cannot be asserted at all.
 */

/**
 * The longest a description may be — **the server's own cap**, restated here so the counter under
 * the box is the real limit rather than a number chosen for the UI.
 *
 * `USED_FOR_MAX` in `server.js` is the one that refuses; a client cap is a courtesy, and if the two
 * drift the reader is told at the wrong moment. `check-docs` holds them to the same number.
 */
export const USED_FOR_MAX = 1000

export const mailUsedForCopy = {
  /** The dialog's title — names the mailbox, because a reader may have two connected. */
  title: (account: string) => `What is ${account} used for?`,

  /**
   * **The register matters more than the length.** "Contractor progress claims and gate reviews"
   * is what a question-time reader needs; "Finance" is a job title and tells them nothing about
   * which mailbox holds what.
   */
  prompt:
    'Describe the kind of thing this mailbox holds, in your own words. Write it the way the ' +
    'questions will be asked, not as a job title.',

  placeholder: 'e.g. contractor progress claims, gate review packs and scope change requests',

  /** The label over the value on the card. */
  fieldLabel: 'USED FOR',

  /**
   * Said where nothing has been written. **Not an empty box**: a blank line under a heading reads
   * as a value that failed to load rather than as a question nobody has answered yet.
   */
  empty: 'Not described yet — two mailboxes look alike, so say what this one holds.',

  /**
   * Said when the browser refuses to store it — the one case where reporting success would be a
   * lie. `localStorage` does not merely come back empty in a private window or with site data
   * blocked; the accessor itself can throw, and there is no server copy to fall back to.
   */
  storeFailed:
    'Could not save it in this browser — private browsing, or site data is blocked. It is kept ' +
    'here rather than on the server, so there is nowhere else for it to go.',

  /** Said under the box, because where a value lives is part of what it promises. */
  scopeNote: 'Kept in this browser only — it does not travel with the draft.',

  editLabel: 'Edit',
  saveLabel: 'Save',
  cancelLabel: 'Cancel',

  /** The counter under the box, in the form the reader sees it. */
  counter: (value: string) => `${value.trim().length} / ${USED_FOR_MAX}`,
}

/**
 * Why this description cannot be saved, or `null`.
 *
 * Only the length: an empty value is **allowed**, because clearing what was written is a real act
 * and refusing it would leave a reader unable to undo a description they no longer stand behind.
 * The server clears rather than storing `''`, so the two agree about what "nothing" is.
 */
export function usedForProblem(value: string): string | null {
  const length = value.trim().length
  if (length > USED_FOR_MAX) {
    return `That is ${length} characters, over the ${USED_FOR_MAX} this field holds — describe what the mailbox holds rather than listing what is in it.`
  }
  return null
}

/**
 * A mail document's line beside its name: `1 page · 2 chunks · 2k chars`.
 *
 * **Every part is dropped where the catalogue does not state it**, rather than printed as 0 — a
 * synthesised document has no page count, and "0 pages" would say it is empty rather than
 * uncounted. That is the same rule the Catalog's own table follows with its em dashes.
 */
export function mailDocumentMeta(o: {
  pages: number | null
  units: number | null
  sizeChars: number | null
}): string {
  const parts: string[] = []
  if (o.pages != null) parts.push(`${o.pages} page${o.pages === 1 ? '' : 's'}`)
  if (o.units != null) parts.push(`${o.units} chunk${o.units === 1 ? '' : 's'}`)
  if (o.sizeChars != null) {
    parts.push(
      o.sizeChars < 1000 ? `${o.sizeChars} chars` : `${Math.round(o.sizeChars / 1000)}k chars`,
    )
  }
  return parts.join(' · ')
}


/* ---------------- where it is kept ---------------- */

/**
 * The one key this lives under, beside `contextweave.identity` and `contextweave.dataset`.
 *
 * **It is the browser's, and that is the whole design now.** It was a `PATCH` onto the registered
 * source; the write never reached the server in the environment this runs in — four attempts, all
 * failing before a byte moved, while the same request succeeded from `curl` — so it is stored here
 * instead, on request. The server no longer serves or accepts it, because two homes for one value
 * is how they come to disagree.
 *
 * **What that costs, plainly.** It is per-browser and per-profile: it does not travel with a saved
 * draft, another reader of the same brief does not see it, and clearing site data loses it. That is
 * a real reduction from a value stored against the connection, and it is the trade that was asked
 * for.
 */
const STORAGE_KEY = 'contextweave.mailboxUsedFor'

/**
 * Keyed by dataset **and** source, because a source id alone is not unique across them.
 *
 * A mailbox id is `gmail:<address>` and the address is whoever signed in — so two datasets can
 * produce the same id for what are, as far as this console is concerned, two different connections.
 * Switching dataset signs the reader out, which makes the collision hard to reach; keying on both
 * makes it impossible rather than unlikely.
 */
export const usedForKey = (dataset: string, sourceId: string) => `${dataset}:${sourceId}`

/**
 * Read the whole map, or `{}`.
 *
 * **Every access is wrapped**, because `localStorage` does not merely come back empty in a private
 * window or with site data blocked — the accessor itself throws in some contexts. A description
 * nobody can read is not worth a broken page, so anything unreadable is treated as "nothing
 * written", which is a state this card already draws.
 */
function readAll(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    /* Hand-editable, like every other browser store here, so a shape that is not a flat object of
       strings is discarded rather than spread into the card. */
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, v]) => typeof v === 'string',
      ),
    ) as Record<string, string>
  } catch {
    return {}
  }
}

/** What this mailbox is used for in this browser, or `null` where nothing has been written. */
export function readUsedFor(key: string): string | null {
  const value = readAll()[key]
  return value && value.trim() ? value : null
}

/**
 * Write it, or clear it where the text is empty.
 *
 * Cleared rather than stored as `''` — "nobody has said" and "somebody said nothing" are the same
 * fact here, and one of the two would leave an empty box where the prompt belongs. Returns whether
 * the write landed, so the caller can say so rather than assuming: a storage that throws is exactly
 * the case where a silent success would be a lie.
 */
export function writeUsedFor(key: string, value: string): boolean {
  const next = readAll()
  const trimmed = value.trim()
  if (trimmed) next[key] = trimmed
  else delete next[key]
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}
