import { useState } from 'react';

interface Props<T extends string> {
  title: string;
  options: { key: T; label: string; d?: string }[];
  selected: T[];
  /** Called with the full next selection; the menu stays open between toggles. */
  onChange(next: T[]): void;
  /** Refuse to remove the last remaining item. */
  minOne?: boolean;
}

/** Multi-select menu that keeps its own mirror of the selection so it can stay open. */
export function TogglePicker<T extends string>({ title, options, selected, onChange, minOne = true }: Props<T>) {
  const [local, setLocal] = useState<T[]>(selected);

  function toggle(key: T) {
    const on = local.includes(key);
    if (on && minOne && local.length === 1) return;
    const next = on ? local.filter((k) => k !== key) : [...local, key];
    setLocal(next);
    onChange(next);
  }

  return (
    <>
      <div className="mq">{title}</div>
      {options.map((o) => {
        const on = local.includes(o.key);
        return (
          <button key={o.key} className={'opt' + (on ? ' sel' : '')} onClick={() => toggle(o.key)}>
            {on ? '✓ ' : '   '}
            {o.label}
            {o.d && <span className="d">{o.d}</span>}
          </button>
        );
      })}
    </>
  );
}
