import type { ProfilingJob } from '../api/client'

/**
 * The words and the derivations behind Gmail's *Process documents* surface.
 *
 * Out of the component for the reason `profilingOutcome` and `connectSteps` are: a sentence written
 * where it is printed cannot be asserted without rendering the page around it, and `stageStates` is
 * a rule rather than markup — it decides what a reader is told about a run in flight, which is
 * exactly the kind of thing that should be checkable on its own.
 */
export const mailProcessCopy = {
  /**
   * What is happening, above the stage list.
   *
   * Reads the job's **own** counters. A caption composed from a timer, or from the number of
   * documents submitted rather than the number committed, would narrate work that has not happened
   * — which is the fault every paced run in this repo is careful to avoid.
   */
  caption: (job: ProfilingJob) =>
    `${job.stage_label} · ${job.objects_done} of ${job.object_count} processed`,

  /**
   * When processing has to be asked for, stated once under the run.
   *
   * **It answers "why is there a button here at all", which is what a reader asks of it.** A
   * mailbox is not a place a reader files things, so a control over somebody's mail needs to say
   * when pressing it is the act: the first run is manual, a later one is on demand, and between
   * them the mailbox is picked up on the nightly schedule.
   *
   * **What it no longer says is *which* graph the last stage assembles.** The pipeline still ends
   * on *Assembling the graph* — the tenant's own wording — and what it assembles is the document's
   * own entities and relations, held as an observation of that attachment rather than anything
   * merged into the published knowledge graph. **Replaced on request**, so the panel no longer
   * states that destination in words; the rule it described is untouched and is enforced where it
   * lives, which is why the wording could go: `RUNTIME_KINDS` holds `gmail` alone and
   * `selectedProfiledObjects` skips a runtime source **by name**, so step 4 derives nothing from a
   * mailbox and the canvas carries no node from one however a stage is labelled.
   */
  note:
    'You need to process the Document for the first time or if you want it “On Demand” ' +
    'processing. After first time process the process will be scheduled every night at 12 am.',

  /** Said where the table has no rows, rather than antd's bare "No data". */
  empty:
    'Nothing processed yet. Press Process documents to run over every attachment under this ' +
    "mailbox's labels.",

  /**
   * A character count, without its unit — `2k`.
   *
   * Rounded to thousands because that is the grain the *chunk size* tile uses, and a row reading
   * `26,400 chars` beside a tile reading `12k` would be two grains for one unit. Under a thousand
   * prints exactly, since `0k` would say a document has no text.
   *
   * **Split out because the tile and the row print it differently and must round it the same.**
   * The tile sets the figure large and `chars` small beside it, the way every other figure on that
   * strip is set; a table cell says `2k chars` in one run. Two formatters would be two rounding
   * rules one edit apart — so `size` is composed from this rather than written beside it.
   */
  sizeValue: (chars: number) =>
    chars < 1000 ? `${chars}` : `${Math.round(chars / 1000)}k`,

  /** The same count with its unit, as a table cell states it — `2k chars`. */
  size: (chars: number) => `${mailProcessCopy.sizeValue(chars)} chars`,
}

/** What a stage row shows: finished, in flight, or not started. */
export type StageState = 'done' | 'running' | 'pending'

/**
 * Every stage of the run, each with where it has got to.
 *
 * **Derived from one cursor**, which is the rule the graph build's own panel keeps: a stage index
 * tracked beside a step index is two counters that can disagree, and the symptom is a stage
 * reading complete while its own work is still going. The job reports one cursor, `stage_index`,
 * and everything here is computed from it.
 *
 * **A stage can span several steps, which is why this is a span and not an index.** It used to be
 * `i === stage_index`, correct while every pipeline ticked once per stage. Drive and Gmail now
 * narrate two stages over five and seven steps — the list was reduced on request and the pacing
 * deliberately was not — so a stage owns a *range* of the cursor. Left as an index, the first row
 * would have gone from running to done on tick 1 and the panel would have read complete while the
 * bar sat at 20%.
 *
 * **`stage_total` is the denominator, never `stages.length`.** Those are the same number only when
 * a pipeline paces one tick per stage, which is what BigQuery does and what every connector did
 * before this; reading the list's own length would put the spans back on the wrong scale and the
 * bug back with them.
 *
 * The stage *names* and the step count are both the server's, never a list held in the client, so
 * adding a stage on the server adds a row here and the two cannot drift.
 */
export function stageStates(job: ProfilingJob): { label: string; state: StageState }[] {
  const steps = job.stage_total || job.stages.length
  return job.stages.map((label, i) => {
    /* The half-open span of steps this stage covers. Identity when steps === stages.length. */
    const start = Math.round((i * steps) / job.stages.length)
    const end = Math.round(((i + 1) * steps) / job.stages.length)
    return {
      label,
      /* Queued is `stage_index: 0`, which falls in the first stage's span — so the first row
         spins before the first tick rather than sitting pending under a bar that has started. */
      state:
        job.stage_index >= end ? 'done' : job.stage_index >= start ? 'running' : 'pending',
    }
  })
}
