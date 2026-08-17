import type { AskAnswer } from '../api/client'

/**
 * Ask's chat history — the turns a reader has taken, per graph, kept for **this browser
 * session only**.
 *
 * ## Why session storage, and why keyed by user
 *
 * `sessionStorage`, not `localStorage`: a chat is a working session, the same reasoning that
 * keeps registered sources and review decisions in the mock server's memory. Closing the tab
 * ends it, and the page says so rather than implying a server-side archive that does not
 * exist — nothing here is posted anywhere.
 *
 * Keyed by the signed-in address, because the identity is client-held and two people using
 * one browser must not read each other's questions. A key with no address is refused rather
 * than pooled into a shared bucket: "signed out" is not a user.
 *
 * ## Why it is validated on the way in
 *
 * `sessionStorage` is hand-editable, exactly like the `/db` editor, so a restored chat is as
 * reachable a malformed payload as any response — and it is rendered by the same components
 * that render a validated answer. So it is checked here, and anything that fails is dropped
 * rather than thrown: a corrupt history must not take the page down with it, and the reader
 * has lost only what a tab close would have taken anyway.
 */

/** One turn: the question, and the answer it got. */
export interface AskTurn {
  turnId: string
  question: string
  /** Null while the answer is still streaming — this turn is the one in flight. */
  answer: AskAnswer | null
  askedAt: string
}

export interface AskChat {
  chatId: string
  /** The graph this chat is against. A chat cannot span graphs: an answer belongs to the
      version that produced it, so switching graphs starts a new chat. */
  useCaseId: string
  graphName: string
  /** The first question, which is what the history list shows. */
  title: string
  turns: AskTurn[]
  createdAt: string
  updatedAt: string
}

/** How many chats a session keeps. The oldest fall off the end. */
export const CHATS_KEPT = 20

/** How much of a first question becomes a chat's title in the list. */
export const TITLE_CHARS = 60

export const chatTitle = (question: string): string => {
  const clean = question.trim().replace(/\s+/g, ' ')
  return clean.length > TITLE_CHARS ? `${clean.slice(0, TITLE_CHARS - 1)}…` : clean
}

/**
 * The storage key for one user.
 *
 * Namespaced like `contextweave.identity` is, and the address is part of the key rather than
 * a field inside the value — a filter applied on read is a filter somebody can forget.
 */
export const chatsKey = (email: string): string =>
  `contextweave.ask.chats.${email.trim().toLowerCase()}`

/* ---------------- validation ---------------- */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown): v is string => typeof v === 'string'

/**
 * An answer as stored. Only the fields the thread renders are required — a session written
 * by an older build is kept if it can still be drawn, because dropping a readable chat is a
 * worse outcome than tolerating a missing field the UI treats as absent anyway.
 */
function validAnswer(v: unknown): v is AskAnswer {
  if (!isRecord(v)) return false
  return (
    str(v.question) &&
    typeof v.answered === 'boolean' &&
    str(v.reason) &&
    Array.isArray(v.reasoning) &&
    Array.isArray(v.citations) &&
    Array.isArray(v.blocks) &&
    Array.isArray(v.caveats) &&
    Array.isArray(v.path) &&
    isRecord(v.requirements)
  )
}

function validTurn(v: unknown): v is AskTurn {
  if (!isRecord(v)) return false
  if (!str(v.turnId) || !str(v.question) || !str(v.askedAt)) return false
  /* A turn with no answer is one that was in flight when the tab was closed. It is dropped
     on read rather than restored as a question with an eternal spinner. */
  return v.answer !== null && validAnswer(v.answer)
}

function validChat(v: unknown): v is AskChat {
  if (!isRecord(v)) return false
  return (
    str(v.chatId) &&
    str(v.useCaseId) &&
    str(v.graphName) &&
    str(v.title) &&
    str(v.createdAt) &&
    str(v.updatedAt) &&
    Array.isArray(v.turns) &&
    v.turns.every(validTurn)
  )
}

/* ---------------- read / write ---------------- */

/** The session's storage, or null where there is none (SSR, and a smoke test in node). */
const store = (): Storage | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    /* A browser with storage blocked throws on access rather than returning null. The page
       then runs without history, which is the same state as a fresh tab. */
    return null
  }
}

/**
 * Every chat this user has in this session, newest first. `[]` for a signed-out caller, a
 * missing key, unreadable JSON, or anything that fails validation.
 */
export function loadChats(email: string | null | undefined): AskChat[] {
  const s = store()
  if (!s || !email) return []
  try {
    const raw = s.getItem(chatsKey(email))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    /* Per chat, not all-or-nothing: one unreadable entry costs that entry. */
    return parsed.filter(validChat).slice(0, CHATS_KEPT)
  } catch {
    return []
  }
}

/** Writes the list back, newest first and capped. Silent on a full or blocked store —
    losing history is not worth an error a reader cannot act on. */
export function saveChats(email: string | null | undefined, chats: AskChat[]): void {
  const s = store()
  if (!s || !email) return
  try {
    s.setItem(chatsKey(email), JSON.stringify(chats.slice(0, CHATS_KEPT)))
  } catch {
    /* Quota, or storage disabled mid-session. The chat on screen is unaffected. */
  }
}

/** Drops this user's history — what Clear history does, and what signing out leaves behind
    for the *next* address rather than the current one. */
export function clearChats(email: string | null | undefined): void {
  const s = store()
  if (!s || !email) return
  try {
    s.removeItem(chatsKey(email))
  } catch {
    /* Nothing to do: the list in memory is cleared by the caller either way. */
  }
}

/**
 * A new id. `Math.random` is deliberate and fine here: this is a client-side key for a
 * session-scoped list, not something the server ever sees or orders by.
 */
export const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
