import type { ReactNode } from 'react';

interface Props {
  tag: string;
  editMode: boolean;
  selected: boolean;
  onSelect(): void;
  toolbar?: ReactNode;
  children: ReactNode;
}

export function BlockShell({ tag, editMode, selected, onSelect, toolbar, children }: Props) {
  return (
    <div
      className={'block' + (selected ? ' sel' : '')}
      onClick={(e) => {
        if (!editMode) return;
        e.stopPropagation();
        onSelect();
      }}
    >
      <span className="blockTag">{tag}</span>
      {selected && editMode && <div className="blockBar">{toolbar}</div>}
      {children}
    </div>
  );
}

export function ToolbarDivider() {
  return <span className="div" />;
}

interface MoveProps {
  canUp: boolean;
  canDown: boolean;
  onUp(): void;
  onDown(): void;
}

export function MoveSeg({ canUp, canDown, onUp, onDown }: MoveProps) {
  return (
    <span className="seg mv">
      <button
        className={canUp ? '' : 'mvOff'}
        title="Move up"
        onClick={(e) => {
          e.stopPropagation();
          if (canUp) onUp();
        }}
      >
        ↑
      </button>
      <button
        className={canDown ? '' : 'mvOff'}
        title="Move down"
        onClick={(e) => {
          e.stopPropagation();
          if (canDown) onDown();
        }}
      >
        ↓
      </button>
    </span>
  );
}

export function RemoveBtn({ onRemove }: { onRemove(): void }) {
  return (
    <button
      className="danger"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      ✕ Remove
    </button>
  );
}
