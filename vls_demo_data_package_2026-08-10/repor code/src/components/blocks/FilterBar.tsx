import { catValues, fieldLabel } from '../../lib/format';
import { OptionList, useMenu } from '../MenuProvider';
import type { Filter, Generator } from '../../types';

interface Props {
  filters: Filter[];
  /** Scope before filtering — the value list shouldn't shrink as you narrow. */
  scopeRows: Generator[];
  /** The audience sees what the author fixed, with no way to change it. */
  readOnly?: boolean;
  onSet(key: string, val: string): void;
  onRemove(key: string): void;
}

export function FilterBar({ filters, scopeRows, readOnly = false, onSet, onRemove }: Props) {
  const { open } = useMenu();

  if (readOnly) {
    return (
      <div className="filterBar">
        <span className="fl">Filtered to</span>
        {filters.map((f) => (
          <span className="fSel static" key={f.key}>
            <span className="k">{fieldLabel(f.key)}:</span> <span className="v">{f.val}</span>
          </span>
        ))}
      </div>
    );
  }

  if (filters.length === 0) {
    return (
      <div className="filterBar">
        <span className="fl">Filters</span>
        <span className="fNone">No filters yet — select this bar and add one.</span>
      </div>
    );
  }

  return (
    <div className="filterBar">
      <span className="fl">Filter</span>
      {filters.map((f) => (
        <button
          key={f.key}
          className="fSel"
          onClick={(e) =>
            open(
              e,
              <OptionList
                title={fieldLabel(f.key)}
                items={[
                  { label: 'All', sel: f.val === 'All', onPick: () => onSet(f.key, 'All') },
                  ...catValues(scopeRows, f.key).map((v) => ({
                    label: v,
                    sel: f.val === v,
                    onPick: () => onSet(f.key, v),
                  })),
                  { label: 'Remove this filter', danger: true, onPick: () => onRemove(f.key) },
                ]}
              />,
            )
          }
        >
          <span className="k">{fieldLabel(f.key)}:</span> <span className="v">{f.val}</span> <i>▾</i>
        </button>
      ))}
    </div>
  );
}
