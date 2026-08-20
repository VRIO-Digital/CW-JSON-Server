import type { LegendEntry } from "../types";

type Props = {
  legend: LegendEntry[];
  hiddenTypes: Set<string>;
  query: string;
  onQueryChange: (query: string) => void;
  onToggleType: (type: string) => void;
};

export const Controls = ({
  legend,
  hiddenTypes,
  query,
  onQueryChange,
  onToggleType,
}: Props) => (
  <div className="ctrl">
    <input
      value={query}
      placeholder="Search nodes…"
      aria-label="Search nodes"
      onChange={(event) => onQueryChange(event.target.value)}
    />

    {legend.map((entry) => (
      <button
        key={entry.type}
        type="button"
        className={`leg${hiddenTypes.has(entry.type) ? " off" : ""}`}
        aria-pressed={!hiddenTypes.has(entry.type)}
        onClick={() => onToggleType(entry.type)}
      >
        <span className="dot" style={{ background: entry.color }} />
        <span>{entry.type}</span>
        <span className="n">{entry.count}</span>
      </button>
    ))}
  </div>
);
