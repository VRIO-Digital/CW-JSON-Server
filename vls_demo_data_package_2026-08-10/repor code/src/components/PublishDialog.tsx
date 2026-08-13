import { useEffect, useRef, useState } from 'react';
import { AUDIENCES } from '../data';

interface Props {
  /** Prefilled name — the report title, or the existing name when republishing. */
  initialName: string;
  initialAudience: string;
  /** True when the report is already in the library and this is a re-publish. */
  republish: boolean;
  onCancel(): void;
  onConfirm(name: string, audience: string): void;
}

/** Publishing needs a name — that's what the audience sees in their library. */
export function PublishDialog({ initialName, initialAudience, republish, onCancel, onConfirm }: Props) {
  const [name, setName] = useState(initialName);
  const [audience, setAudience] = useState(initialAudience);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const trimmed = name.trim();
  const invalid = trimmed.length === 0;

  function submit() {
    setTouched(true);
    if (invalid) {
      inputRef.current?.focus();
      return;
    }
    onConfirm(trimmed, audience);
  }

  return (
    <div className="modalBack" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{republish ? 'Publish your changes' : 'Publish this report'}</h3>
        <div className="mh">
          Give it a name your audience will recognise in their library. You can rename it later.
        </div>

        <div className="fld">
          <label htmlFor="pubName">Report name</label>
          <input
            id="pubName"
            ref={inputRef}
            value={name}
            placeholder="e.g. Inbound generator risk — Q3 2026"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          {touched && invalid && <div className="err2">A report needs a name before it can be published.</div>}
        </div>

        <div className="fld">
          <label htmlFor="pubAud">Audience</label>
          <select id="pubAud" value={audience} onChange={(e) => setAudience(e.target.value)}>
            {AUDIENCES.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label} — {a.d}
              </option>
            ))}
          </select>
        </div>

        <div className="modalActs">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn pri" onClick={submit}>
            {republish ? 'Publish update' : 'Publish'}
          </button>
        </div>

        <div className="modalNote">
          A Domain Architect approves before the audience sees it. Until then the report stays in your library marked as
          published-pending.
        </div>
      </div>
    </div>
  );
}
