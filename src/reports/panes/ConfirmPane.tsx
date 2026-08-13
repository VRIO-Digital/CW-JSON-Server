import { Fragment, type MouseEvent } from 'react';
import { GENERATORS, META, OPTS, SLICE_DEFAULT } from '../data';
import { fieldLabel } from '../lib/format';
import { hasFilter } from '../lib/select';
import { OptionList, useMenu } from '../components/MenuProvider';
import type { GraphOption } from '../App';
import type { Assumptions, Filter, Generator, SlotKey, Starter } from '../types';

interface Props {
  starter: Starter;
  assumptions: Assumptions;
  /** The published graphs, from the host — see the note on `AskPane`'s copy of this prop. */
  graphOptions: GraphOption[];
  filters: Filter[];
  scopeRows: Generator[];
  onSetSlot(key: SlotKey, value: string, label: string): void;
  onToggleSlice(key: string): void;
  onBack(): void;
  onBuild(): void;
}

const SLOT_TOKEN = /(\{[a-z]+\})/g;

export function ConfirmPane({
  starter,
  assumptions,
  graphOptions,
  filters,
  scopeRows,
  onSetSlot,
  onToggleSlice,
  onBack,
  onBuild,
}: Props) {
  const { open } = useMenu();
  const isGeneratorReport = starter.spine === 'generators';

  function openSlot(e: MouseEvent, key: SlotKey) {
    open(
      e,
      <OptionList
        title={OPTS[key].q}
        /* The graph slot's options are the host's real published graphs; the other three
           slots are the dataset's own vocabulary. */
        items={(key === 'graph' ? graphOptions : OPTS[key].options).map((o) => ({
          label: o.label,
          d: o.d,
          sel: o.value === assumptions[key].value,
          onPick: () => onSetSlot(key, o.value, o.label),
        }))}
      />,
    );
  }

  /** Renders the read-back sentence, turning each {slot} into a clickable assumption. */
  const parts = starter.reading.template.split(SLOT_TOKEN).map((part, i) => {
    const m = /^\{([a-z]+)\}$/.exec(part);
    const key = m?.[1] as SlotKey | undefined;
    if (key && starter.reading.slots.includes(key)) {
      return (
        <span className="slot" key={i} onClick={(e) => openSlot(e, key)}>
          {assumptions[key].label} <i>▾</i>
        </span>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });

  return (
    <div className="pane on">
      <div className="confHead">
        <div className="eyebrow">Here's what I understood</div>
        <h2>Check this reads right, then build it</h2>
      </div>

      <div className="readCard">
        <div className="reading">{parts}</div>

        {isGeneratorReport && (
          <div className="sliceRow">
            <div className="lab">
              I'll add these as <b>filters</b> so you can slice the report once it's built. Turn off any you don't need —
              you can add more later:
            </div>
            <div className="sliceChips">
              {SLICE_DEFAULT.map((k) => {
                const on = hasFilter(filters, k);
                return (
                  <button
                    key={k}
                    className={'sliceChip' + (on ? ' on' : '')}
                    onClick={() => onToggleSlice(k)}
                  >
                    <span className="bx">{on ? '✓' : ''}</span>
                    {fieldLabel(k)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="confMeta">
          <div className="m">
            Runs under your access
            <b>
              {isGeneratorReport
                ? `${scopeRows.length} of ${GENERATORS.length} ${META.entity_plural} you can see`
                : META.scope_line}
            </b>
          </div>
          <div className="m">
            Stays private until you publish<b>Only you can see the draft</b>
          </div>
          <div className="m">
            Every figure is traceable<b>Back to EPA &amp; e-Manifest source</b>
          </div>
        </div>
      </div>

      <div className="confActs">
        <span className="back" onClick={onBack}>
          ← Change my question
        </span>
        <button className="btn pri big" onClick={onBuild}>
          Build the report →
        </button>
      </div>

      <div className="confNote">
        The orange words are my assumptions — click any to change it. Nothing has run against your data yet, so changing
        your mind here is free.
      </div>
    </div>
  );
}
