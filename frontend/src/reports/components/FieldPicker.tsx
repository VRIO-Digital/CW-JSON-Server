import { useEffect, useRef, useState } from 'react';
import { useMenu } from './MenuProvider';
import type { Field } from '../types';

interface Props {
  title: string;
  fields: Field[];
  onPick(key: string): void;
}

/**
 * The field picker. Fields the graph can't serve on this spine stay visible but
 * unpickable, with the reason attached — the point is that the user learns why,
 * rather than the field silently not existing.
 */
export function FieldPicker({ title, fields, onPick }: Props) {
  const { close } = useMenu();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const needle = q.toLowerCase().trim();
  const matched = fields.filter((f) => f.label.toLowerCase().includes(needle));

  return (
    <>
      <div className="mq">{title}</div>
      <input
        ref={inputRef}
        className="psearch"
        placeholder="Search fields…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="plist">
        {matched.length === 0 && (
          <div className="pEmpty">
            No field called “{q}”. Try another name — I can only build from fields in your graph.
          </div>
        )}
        {matched.map((f) =>
          f.avail === false ? (
            <div key={f.key} className="opt na">
              <div className="optRow">
                <span className={'pDot ' + f.kind} />
                <div>
                  {f.label}
                  <span className="d err">⚠ {f.note}</span>
                </div>
              </div>
            </div>
          ) : (
            <button
              key={f.key}
              className="opt"
              onClick={() => {
                close();
                onPick(f.key);
              }}
            >
              <div className="optRow">
                <span className={'pDot ' + f.kind} />
                <div>
                  {f.label}
                  <span className="d">{f.kind === 'num' ? 'number' : f.kind === 'cat' ? 'category' : 'text'}</span>
                </div>
              </div>
            </button>
          ),
        )}
      </div>
    </>
  );
}
