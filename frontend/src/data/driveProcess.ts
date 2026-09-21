import type { ProfilingJob } from '../api/client'

/**
 * What `DriveProcessPanel` says, held here for the reason every other panel's copy is: a sentence
 * written inside a component can only be asserted by rendering the component, and a run panel
 * renders only while there is a run.
 *
 * **A drive's own words, not the mailbox's.** The two surfaces look alike deliberately, which is
 * exactly why the copy must not be shared: a mailbox's note explains a nightly schedule this repo
 * performs nowhere and describes attachments under labels, and printing either over a drive would
 * state something untrue of it. `mailProcessCopy.size` *is* reused, because that is one rounding
 * rule for one unit rather than a claim about either connector.
 */
export const driveProcessCopy = {
  /**
   * What is happening, above the stage list.
   *
   * The job's **own** counters, like the mail caption's — a figure taken from the number of
   * documents submitted rather than committed would narrate work that has not happened.
   */
  caption: (job: ProfilingJob) =>
    `${job.stage_label} · ${job.objects_done} of ${job.object_count} processed`,

  /**
   * What the button covers, stated once under the run.
   *
   * **It names the allowlist, because that is what really bounds a drive run.** A mailbox's note
   * answers "why is there a button here at all"; a drive's has a different question to answer,
   * since the reader chose these folders in the connect wizard and the run reaches exactly them.
   * It deliberately claims **no schedule**: nothing here runs a timer, and Gmail's note says one
   * only because that is the product's stated intent for mail.
   */
  note:
    'Process documents runs over every document in the folders this drive was connected with. ' +
    'Run it again any time — a document already profiled is re-read only when you force the run.',

  /** Said where the table has no rows, rather than antd's bare "No data". */
  empty:
    'Nothing processed yet. Press Process documents to run over every document in the folders ' +
    'this drive was connected with.',
}
