import { CHATS_KEPT, type AskChat } from './askChats'

/**
 * Session history — the Ask threads this browser tab is holding.
 *
 * ## What it is, and the thing it must not be mistaken for
 *
 * It sits on Audit & Governance, beside a trail whose whole argument is *"nothing here is
 * editable — the trail is the record"*. These rows are the opposite kind of thing: Ask's chats,
 * held in `sessionStorage` under the signed-in address, capped at {@link CHATS_KEPT}, and gone
 * when the tab closes. **Nothing here is posted anywhere and no server has seen it.**
 *
 * So the panel says so, in its own words, above the list rather than under it. A list of named
 * sessions on a governance page reads as a server-side record of who was doing what — which is
 * precisely the false implication this section refuses everywhere else, from a rule that is
 * *recorded, not enforced* to an audience that is *stated, not applied*. The disclaimer is the
 * price of putting the list here at all.
 *
 * ## Why the shaping is a pure function
 *
 * `renderToString` gives a component its initial state and will not traverse a `Modal`; a page's
 * own `useState` is no more assertable. So everything decidable — the ordering, the counts, the
 * empty answer — lives here and the panel renders what it returns, the rule `askAvailability`,
 * `datasetPathFix` and `diagnose` already follow.
 */

export const sessionHistoryCopy = {
  tabLabel: 'Session history',

  title: 'Ask sessions in this browser tab',

  /**
   * The sentence that keeps the list from reading as a trail.
   *
   * **Three facts, because each one alone is misleading.** That it is this tab's (not the
   * account's history); that it is keyed to the signed-in address (so it is not everyone's);
   * and that no server holds it (so it is not a record anybody could audit). Dropping any one
   * of them leaves a reader on a governance page with a plausible wrong conclusion.
   */
  notARecord:
    'These are the Ask threads open in this browser tab — held in session storage under your own signed-in address, never posted anywhere and never seen by a server. Closing the tab ends them. This is not part of the audit trail below, and nothing here is a record of what anyone else did.',

  /** Stated because a list that silently stops growing is a list a reader will trust too far. */
  cap: `The newest ${CHATS_KEPT} are kept; older threads fall off the end.`,

  emptyTitle: 'No sessions in this tab yet',
  emptyDetail:
    'Ask a question on the Ask page and the thread appears here. A thread is created by asking — an empty one is never filed.',

  /** What stands where nobody is signed in. Chats are keyed by address, so there is nothing to key on. */
  signedOutTitle: 'Not signed in',
  signedOutDetail:
    'Ask sessions are kept under the signed-in address, so that two people sharing a browser cannot read each other’s questions. There is nothing to show without one.',

  /** Column headings, here rather than in the markup so the panel's words are all in one file. */
  colSession: 'Session',
  colSubject: 'Asked of',
  colTurns: 'Questions',
  colStarted: 'Started',
  colUpdated: 'Last asked',
} as const

/** One row as the panel prints it. Nothing is computed in the component. */
export interface SessionHistoryRow {
  chatId: string
  /** The chat's title — its first question, already truncated by `chatTitle` when it was filed. */
  name: string
  /** What it was asked of: a graph's name, or the sources'. Served on the chat, never inferred. */
  subject: string
  /**
   * Answered turns, and the total.
   *
   * A turn whose answer is null is one that was still streaming when the tab was closed — it is
   * counted in `turns` because it was asked, and excluded from `answered` because it was not
   * answered. Reporting only the total would overstate what the session got back.
   */
  turns: number
  answered: number
  createdAt: string
  updatedAt: string
}

/**
 * The rows, newest activity first.
 *
 * **Ordered by `updatedAt`, not `createdAt`**: a thread returned to an hour ago is the one a
 * reader is looking for, and ordering by when it started would bury it under threads nobody has
 * touched since. The list on Ask's own rail is ordered the same way, so the two cannot disagree
 * about which session is the current one.
 *
 * A chat with no title is dropped rather than drawn as a blank row — a nameless session is
 * indistinguishable from a rendering fault, and `loadChats` has already discarded anything
 * malformed on the way in.
 */
/**
 * The same list as markup, for the tab injected into a **framed** governance screen.
 *
 * ## Why there is a second renderer at all
 *
 * A dataset that ships its governance screen puts its tabs inside the document, and the app cannot
 * render React into somebody else's export. So the rows are built as a string and handed to
 * `injectSessionTab`. The two renderers draw the same rows from the same `sessionHistoryRows`, which
 * is what stops them becoming two answers to what a session is.
 *
 * ## Why it borrows the document's own class names
 *
 * `audCard`, `evt`, `eIc`, `eTx`, `eSub`, `eT`, `audNote` are the governance document's, and using
 * them is what makes the pane look like part of the screen rather than a panel dropped into it. It
 * is a real coupling and the same one `.apiFab` and `#v-reports` already are — the price of not
 * editing a generated file. It fails *visibly*: a re-export that renames them leaves an unstyled
 * list, not a missing one, and `check-docs` asserts the document still carries every class named
 * here.
 *
 * ## Escaping is not optional here
 *
 * A session's name is the reader's own typed question. It reaches this string unescaped from
 * `sessionStorage`, which is hand-editable — so every interpolation goes through `escapeHtml`, and
 * the one place that would be easy to forget is the empty state, which interpolates nothing and is
 * written as a constant for that reason.
 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export const escapeHtml = (value: string): string =>
  String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)

/** How a date reads on a row. The document's own timestamps are terse, so these are too. */
const stamp = (at: string): string => {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export function sessionTabHtml(rows: SessionHistoryRow[]): string {
  const list = rows.length
    ? rows
        .map(
          (r) =>
            '<div class="evt">' +
            '<div class="eIc open">✦</div>' +
            '<div><div class="eTx"><b>' +
            escapeHtml(r.name) +
            '</b></div><div class="eSub">' +
            escapeHtml(r.subject) +
            ' · ' +
            (r.answered === r.turns
              ? `${r.turns} question${r.turns === 1 ? '' : 's'}`
              : `${r.answered} of ${r.turns} answered`) +
            ' · started ' +
            escapeHtml(stamp(r.createdAt)) +
            '</div></div>' +
            '<span class="eT">' +
            escapeHtml(stamp(r.updatedAt)) +
            '</span>' +
            '</div>',
        )
        .join('')
    : '<div class="evt"><div class="eTx" style="color:var(--dim)">' +
      escapeHtml(sessionHistoryCopy.emptyTitle) +
      ' — ' +
      escapeHtml(sessionHistoryCopy.emptyDetail) +
      '</div></div>'

  return (
    '<div class="audCard">' +
    list +
    '</div><div class="audNote">' +
    escapeHtml(sessionHistoryCopy.notARecord) +
    ' ' +
    escapeHtml(sessionHistoryCopy.cap) +
    '</div>'
  )
}

export function sessionHistoryRows(chats: AskChat[]): SessionHistoryRow[] {
  return chats
    .filter((c) => c.title.trim().length > 0)
    .map((c) => ({
      chatId: c.chatId,
      name: c.title,
      subject: c.subject,
      turns: c.turns.length,
      answered: c.turns.filter((t) => t.answer !== null).length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
