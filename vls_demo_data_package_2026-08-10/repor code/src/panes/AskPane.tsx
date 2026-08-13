import type { MouseEvent } from 'react';
import { OPTS, STARTERS } from '../data';
import { OptionList, useMenu } from '../components/MenuProvider';
import type { Assumption } from '../types';

interface Props {
  prompt: string;
  error: boolean;
  /** The published graph the question will run against. */
  graph: Assumption;
  onChange(v: string): void;
  onSetGraph(value: string, label: string): void;
  onRead(): void;
  onPickStarter(index: number): void;
}

/** Chips show the compact name; the read-back sentence uses the long label. */
function shortName(value: string): string {
  const o = OPTS.graph.options.find((x) => x.value === value);
  return o?.short ?? o?.label ?? value;
}

export function AskPane({ prompt, error, graph, onChange, onSetGraph, onRead, onPickStarter }: Props) {
  const { open } = useMenu();

  function openGraph(e: MouseEvent) {
    open(
      e,
      <OptionList
        title={OPTS.graph.q}
        items={OPTS.graph.options.map((o) => ({
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
        <p>
          Ask for it the way you'd ask a colleague. I'll read it back in one plain sentence first — nothing runs against
          your compliance data until you're happy with it.
        </p>
      </div>

      <div className={'askBox' + (error ? ' err' : '')}>
        <textarea
          rows={2}
          value={prompt}
          placeholder="e.g. Which inbound generators carry the most compliance risk?"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onRead();
          }}
        />
        <div className="askFoot">
          <button className="fSel" onClick={openGraph} title="Choose which published graph this runs against">
            <span className="k">Graph:</span> <span className="v">{shortName(graph.value)}</span> <i>▾</i>
          </button>
          <span className="hint">Plain English is fine — no filters or waste codes to set up.</span>
          <span className="spacer" />
          <button className="btn pri" onClick={onRead}>
            Read my question →
          </button>
        </div>
      </div>

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
    </div>
  );
}
