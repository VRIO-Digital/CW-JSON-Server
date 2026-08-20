import type { MouseEvent } from 'react';
import { META, OPTS, STARTERS } from '../data';
import { OptionList, useMenu } from '../components/MenuProvider';
import type { GraphOption } from '../App';
import type { Assumption } from '../types';

interface Props {
  prompt: string;
  error: boolean;
  /** The published graph the question will run against. */
  graph: Assumption;
  /**
   * The graphs on offer — **the ones actually published**, passed down by the host.
   *
   * The dataset's own four are a fallback for the prototype standing alone. Listing them inside
   * the app would offer four graphs described as "Published" that nobody published.
   */
  graphOptions: GraphOption[];
  onChange(v: string): void;
  onSetGraph(value: string, label: string): void;
  onRead(): void;
  /** True while the question is being read back — the button says so and refuses a second click. */
  reading?: boolean;
  onPickStarter(index: number): void;
  /**
   * Whether this prototype is mounted inside a host that has a tenant of its own.
   *
   * The only thing it changes is the standard-report chips: they are this prototype's bundled sample,
   * and inside another tenant's console they are reports that do not exist. Same rule the host already
   * applies to the prototype's four fictional library rows.
   */
  hosted?: boolean;
}

export function AskPane({
  prompt,
  error,
  graph,
  graphOptions,
  onChange,
  onSetGraph,
  onRead,
  reading,
  onPickStarter,
  hosted,
}: Props) {
  const { open } = useMenu();

  /** Chips show the compact name; the read-back sentence uses the long label. */
  const shortName = (value: string) => {
    const o = graphOptions.find((x) => x.value === value);
    return o?.short ?? o?.label ?? value;
  };

  function openGraph(e: MouseEvent) {
    open(
      e,
      <OptionList
        title={OPTS.graph.q}
        items={graphOptions.map((o) => ({
          label: o.label,
          d: o.d,
          sel: o.value === graph.value,
          onPick: () => onSetGraph(o.value, o.label),
        }))}
      />,
    );
  }

  return (
    <div className="pane on">
      <div className="askHead">
        <h1>What report do you need?</h1>
        {/*
          * **The tenant's own noun, not this prototype's.** The sentence said "your compliance data"
          * and the placeholder asked about inbound generators — EPA's corpus, printed inside whichever
          * console mounts this. `META.entity_plural` is the served word for what the tenant's reports
          * are about ("capital projects"), so the copy follows the data rather than the sample it was
          * written against.
          */}
        <p>
          Ask for it the way you'd ask a colleague. I'll read it back in one plain sentence first — nothing runs against
          your {META.entity_plural} until you're happy with it.
        </p>
      </div>

      <div className={'askBox' + (error ? ' err' : '')}>
        <textarea
          rows={2}
          value={prompt}
          placeholder={`e.g. Which of your ${META.entity_plural} need attention first?`}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onRead();
          }}
        />
        <div className="askFoot">
          <button className="fSel" onClick={openGraph} title="Choose which published graph this runs against">
            <span className="k">Graph:</span> <span className="v">{shortName(graph.value)}</span> <i>▾</i>
          </button>
          <span className="hint">Plain English is fine — no filters or field names to set up.</span>
          <span className="spacer" />
          {/* Disabled while it runs: a second click would start a second read of the same question. */}
          <button className="btn pri" onClick={onRead} disabled={reading}>
            {reading ? (
              <>
                <span className="rp-spin" aria-hidden="true" /> Reading your question…
              </>
            ) : (
              <>Read my question →</>
            )}
          </button>
        </div>
      </div>

      {/*
        * **The standard-report chips are this prototype's own sample, so they are offered only where
        * it is standing alone.**
        *
        * `STARTERS` comes from the prototype's bundled dataset — five EPA compliance reports. Inside a
        * host serving another tenant they are five reports that do not exist, one click from composing
        * a draft about inbound generators in a capital-programme console. Exactly the same reasoning
        * already governs the prototype's four fictional library rows, which the host drops for the
        * same reason: other people's reports with bylines nobody here has.
        *
        * Standing alone the prototype keeps them, because there is no real list for them to stand
        * beside. Hosted, the authoring flow starts from the question — which is what the page's own
        * heading asks for.
        */}
      {!hosted && (
        <div className="starters">
          <div className="lbl">Or start from one of your standard reports:</div>
          <div className="chips">
            {STARTERS.map((s, i) => (
              <button className="chip" key={s.id} onClick={() => onPickStarter(i)}>
                {s.label}
                <span className="rp">{s.report_tag}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
