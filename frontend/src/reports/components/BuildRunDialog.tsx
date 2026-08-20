import type { BuildStage } from '../lib/buildSteps';

/*
 * What the reader sees while "Build the report" runs.
 *
 * **One dialog, one row per step.** The button already said "Building your report…" and
 * disabled itself, which says *something is happening* and nothing about what — the same
 * complaint that put `ConnectRunPanel` in front of the connect wizard's two paced calls and
 * substep rows on the graph build. A wait that names its steps is a wait a reader can judge;
 * an unnamed one reads as a page that stopped.
 *
 * **Its own component**, like every other dialog in this section: it renders only while a
 * build is in flight, so a check that opened `App` would render it shut and pass over
 * nothing. Its steps arrive as a prop for the same reason — `buildStages` is a pure function
 * a test can call.
 *
 * **Every row is listed from the first frame**, `pending` until it runs. A list that grew a
 * row at a time would hide how much is left, which is the only thing this panel is for; that
 * is `BuildTab`'s rule and it is the same rule here.
 *
 * There is no Cancel and no dismiss-on-backdrop. Nothing is in flight that could be
 * cancelled — the report is composed from the prototype's own dataset — so a Cancel button
 * would offer to stop a request that does not exist, and closing the dialog would leave the
 * run to finish behind it and change the page under the reader.
 */
export function BuildRunDialog({
  stages,
  /** Index of the step running now. Everything before it is done, everything after pending. */
  current,
  reportTitle,
}: {
  stages: BuildStage[];
  current: number;
  reportTitle: string;
}) {
  const running = stages[current];

  return (
    <div className="modalBack">
      <div
        className="modal rp-build"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rp-build-title"
        aria-busy="true"
      >
        <h3 id="rp-build-title">Building your report</h3>
        {/* One expression rather than `text {expr} text`: renderToString splits those into
            separate nodes and an assertion on the sentence would pass over nothing. */}
        <div className="mh">
          {`“${reportTitle}” — this takes a few seconds. It opens as soon as it is composed.`}
        </div>

        <ol className="rp-buildSteps">
          {stages.map((stage, i) => {
            const state = i < current ? 'done' : i === current ? 'run' : 'wait';
            return (
              <li key={stage.id} className={`rp-buildStep is-${state}`}>
                <span className="rp-buildMark" aria-hidden="true">
                  {state === 'done' ? '✓' : state === 'run' ? <span className="rp-spin" /> : ''}
                </span>
                <span className="rp-buildBody">
                  <span className="rp-buildLabel">{stage.label}</span>
                  <span className="rp-buildDetail">{stage.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>

        {/*
          * Said in words as well as drawn, and announced politely: a reader on a screen reader
          * gets the step that is running rather than a spinner nobody can hear. The count is
          * the list's own length, never a number typed here — one more step and this sentence
          * follows it.
          */}
        <div className="rp-buildFoot" role="status" aria-live="polite">
          {running
            ? `Step ${current + 1} of ${stages.length} · ${running.label}`
            : `${stages.length} of ${stages.length} — opening the report`}
        </div>
      </div>
    </div>
  );
}
