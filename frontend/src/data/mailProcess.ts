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
   * What processing does, stated once under the run.
   *
   * **It says *which* graph the last stage assembles, and that is the whole job of this sentence.**
   * The pipeline ends on *Assembling the graph* — the tenant's own wording — and what it assembles
   * is the document's own entities and relations, held together as an observation of that
   * attachment. It is not the published knowledge graph, and nothing here reaches one.
   *
   * **Without this the panel would argue with itself**, which is the fault the *Curated by AI*
   * rename records one section over: a label crediting something and a note one line below denying
   * it. The resolution there was that each keeps the half with teeth, and it is the same here — the
   * stage keeps the tenant's word, and this states the destination, which is the falsifiable part
   * (step 4 says this source derives no entities, and the canvas carries no node from it).
   */
  note:
    'Processing chunks and embeds each document, then extracts its entities and relations and ' +
    'assembles them into that document’s own graph — once per document. Documents are identified ' +
    'by the mailbox and the label they were filed under, so the same file is processed once ' +
    'however it arrives. That graph stays with the document as an observation, read at question ' +
    'time: none of it is merged into the published knowledge graph.',

  /** Said where the table has no rows, rather than antd's bare "No data". */
  empty:
    'Nothing processed yet. Press Process documents to run over every attachment under this ' +
    "mailbox's labels.",

  /**
   * A character count as the tile states it — `2k chars`, matching *"of extracted chunk text"*.
   *
   * Rounded to thousands because that is the grain the tile above uses, and a row reading
   * `26,400 chars` beside a tile reading `12k` would be two grains for one unit. Under a thousand
   * prints exactly, since `0k` would say a document has no text.
   */
  size: (chars: number) =>
    chars < 1000 ? `${chars} chars` : `${Math.round(chars / 1000)}k chars`,
}

/** What a stage row shows: finished, in flight, or not started. */
export type StageState = 'done' | 'running' | 'pending'

/**
 * Every stage of the run, each with where it has got to.
 *
 * **Derived from one cursor**, which is the rule the graph build's own panel keeps: a stage index
 * tracked beside a step index is two counters that can disagree, and the symptom is a stage
 * reading complete while its own work is still going. Here the job reports `stageIndex` and the
 * list is `stages`, so a stage is done before the cursor, running at it, and pending after.
 *
 * The stage *names* are the server's — `MAIL_PIPELINE` as the job reports it — never a list held
 * in the client, so adding a stage on the server adds a row here and the two cannot drift.
 */
export function stageStates(job: ProfilingJob): { label: string; state: StageState }[] {
  return job.stages.map((label, i) => ({
    label,
    state: i < job.stage_index ? 'done' : i === job.stage_index ? 'running' : 'pending',
  }))
}
