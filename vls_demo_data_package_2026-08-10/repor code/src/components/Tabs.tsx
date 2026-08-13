export interface TabDef<T extends string> {
  key: T;
  label: string;
  /** Optional badge — a count of what's behind the tab. */
  count?: number;
  /** Optional text badge, e.g. “Soon” for a tab that isn't finished. */
  badge?: string;
}

interface Props<T extends string> {
  tabs: TabDef<T>[];
  active: T;
  onSelect(key: T): void;
}

export function Tabs<T extends string>({ tabs, active, onSelect }: Props<T>) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === active}
          className={'tab' + (t.key === active ? ' on' : '')}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
          {t.count !== undefined && <span className="ct">{t.count}</span>}
          {t.badge && <span className="bd">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
