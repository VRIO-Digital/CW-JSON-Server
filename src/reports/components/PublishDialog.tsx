import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Prefilled name — the report title, or the existing name when republishing. */
  initialName: string;
  /**
   * The audience this report goes to.
   *
   * **Not a choice here any more.** The dialog used to offer a `<select>` over the three
   * audiences; it was removed, so this arrives already decided — the audience a republished
   * report already had, or the default for a new one — and is passed straight back on confirm.
   * The report still *carries* an audience, and the Library card still names it; what is gone
   * is picking it at the moment of publishing.
   */
  initialAudience: string;
  /** True when the report is already in the library and this is a re-publish. */
  republish: boolean;
  /**
   * Why this name cannot be used, or null. The caller owns the rule — `nameProblem` in `lib/library`
   * — because Save draft has to apply the same one, and two copies of "is this name taken" is how a
   * dialog accepts a name the save then rejects.
   */
  nameProblem?(name: string): string | null;
  onCancel(): void;
  onConfirm(name: string, audience: string): void;
}

/** Publishing needs a name — that's what the audience sees in their library. */
export function PublishDialog({
  initialName,
  initialAudience,
  republish,
  nameProblem,
  onCancel,
  onConfirm,
}: Props) {
  const [name, setName] = useState(initialName);
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
  /*
   * **The name is checked as it is typed, not on submit.** A published report's name is how its
   * audience refers to it, so it has to be unique among published ones — and a collision found only
   * after pressing Publish is a dialog that closes, toasts a refusal, and loses the name. The rule
   * itself is the caller's (`nameProblem`), so the same one governs Save draft.
   */
  const problem = nameProblem?.(trimmed) ?? null;
  const invalid = !!problem;

  function submit() {
    setTouched(true);
    if (invalid) {
      inputRef.current?.focus();
      return;
    }
    /* The audience is passed back unchanged — nothing here can alter it now. */
    onConfirm(trimmed, initialAudience);
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
          {/* The rule's own sentence — "needs a name" and "that name is taken" are different fixes. */}
          {touched && problem && <div className="err2">{problem}</div>}
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
