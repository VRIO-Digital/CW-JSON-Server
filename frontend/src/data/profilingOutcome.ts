import type { JobObject, ProfileUnit } from '../api/client'

/**
 * What a profiling run actually did, in words — and, when it did nothing, which objects it
 * skipped and what to do about it.
 *
 * The message this replaced said "Nothing to profile — 2 table(s) already profiled. Use Force on
 * the run in Profiling jobs to redo them." Two problems, and both are about what the reader does
 * next. It never said **which** two: on a source with five views, "2 already profiled" leaves you
 * to work out whether the ones you actually wanted are among them. And the only way forward it
 * offered was on another tab, against a job row that had just been created for a run that did
 * nothing — a long way round to a decision the reader is already making, with the panel open, in
 * front of the tree they picked from.
 *
 * So the objects are named, and re-profiling is offered where the question is asked. Naming is
 * capped at `NAMES_SHOWN`: a list of 40 documents is not a sentence, and **the cap is stated**
 * ("+ 34 more") rather than silently truncating, which is the rule the report charts follow.
 *
 * Shared by all three browse panels rather than written once each: BigQuery skips tables, Drive
 * skips documents and Gmail skips messages, and the only difference between them is the noun.
 */

/**
 * The dialog is wider than antd's 416px default, because these two buttons do not fit in it.
 *
 * A confirm's footer is `text-align: end` over inline-block buttons, so it does not shrink them
 * to fit — it *wraps*, and because each line is end-aligned separately the narrower button lands
 * on its own line above the wider one. It reads as a misaligned pair rather than as a footer out
 * of room. "Leave them as they are" and "Profile 11 document(s) again" are ~400px together
 * against ~334px of usable width once the modal's padding and the icon indent are taken out.
 *
 * So the width lives here, beside the labels that set it: shortening `confirmText` or
 * `cancelText` is what would make it unnecessary, and both are in this file.
 */
export const CONFIRM_WIDTH = 520

/** How many objects a message names before it starts counting them instead. */
export const NAMES_SHOWN = 6

/** The label a reader picked the object by — its id, which is what the tree leads with. */
const nameOf = (o: JobObject) => o.object_id

/** `a, b and c` — the list separator a sentence needs, not an array's. */
function sentenceList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The named objects, capped — and the cap said out loud, never a silent truncation.
 */
export function namedObjects(objects: JobObject[]): string {
  const names = objects.map(nameOf)
  if (names.length <= NAMES_SHOWN) return sentenceList(names)
  return `${sentenceList(names.slice(0, NAMES_SHOWN))} + ${names.length - NAMES_SHOWN} more`
}

export type ProfilingOutcome =
  | {
      /** Something was queued. Nothing to decide — this is a notification. */
      kind: 'queued'
      text: string
    }
  | {
      /** Everything picked was already profiled, so the run did nothing. This asks a question. */
      kind: 'nothing-to-do'
      title: string
      /** Which objects, by the id the tree shows. */
      detail: string
      /** What profiling them again would mean, said before it is offered. */
      note: string
      confirmText: string
      /** The other way out, worded as the act it is — written here so the two panels cannot
          come to word one pair of acts differently, which is this module's whole job. */
      cancelText: string
      skipped: JobObject[]
    }

/**
 * Reads a queued job's work list. `unit` is the connector's noun and is the only thing that
 * differs between the panels.
 *
 * Typed as `ProfileUnit` rather than as a union written again here: the nouns are the job's own,
 * declared once in `client.ts` beside the schema that checks them, so a fourth connector cannot
 * arrive with a noun this module refuses to describe.
 */
export function profilingOutcome(
  objects: JobObject[],
  unit: ProfileUnit,
  shortId: string,
): ProfilingOutcome {
  const queued = objects.filter((o) => o.state === 'pending')
  const skipped = objects.filter((o) => o.state === 'skipped')

  if (queued.length === 0 && skipped.length > 0) {
    return {
      kind: 'nothing-to-do',
      title: `Already profiled — nothing new to run`,
      /* One expression, not `{n} {unit}` around literal text: React splits an interpolation into
         its own text node, and this string is asserted on as the sentence it renders as. */
      detail: `${skipped.length} ${unit}(s) already profiled: ${namedObjects(skipped)}.`,
      note: `Profiling ${skipped.length === 1 ? 'it' : 'them'} again re-reads the ${unit}(s) and replaces what the profiler wrote — the record is updated in place, so nothing is duplicated.`,
      confirmText: `Profile ${skipped.length} ${unit}(s) again`,
      cancelText: 'Leave them as they are',
      skipped,
    }
  }

  return {
    kind: 'queued',
    text:
      `Queued ${queued.length} ${unit}(s) — job ${shortId} is starting.` +
      /* The skipped ones are named here too: "3 already profiled, skipped" leaves a reader to
         work out whether the one they cared about ran. */
      (skipped.length > 0
        ? ` ${skipped.length} already profiled, skipped: ${namedObjects(skipped)}.`
        : ''),
  }
}
