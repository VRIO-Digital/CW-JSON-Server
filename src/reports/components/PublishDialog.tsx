import { useEffect, useMemo, useRef, useState } from 'react';
import type { Person, Publishing } from '../App';

/*
 * Publishing a report.
 *
 * **Three decisions, and none of them is an approval.** The dialog used to ask for a name and then
 * state that "a Domain Architect approves before the audience sees it" — a sentence the code stopped
 * keeping when the three-act model (publish → approve → activate) was collapsed to publish and
 * unpublish. Promising a sign-off that nothing performs is exactly the claim this section exists to
 * avoid, so the lead now says what actually happens: it goes live to the people you pick, and you can
 * change them or unpublish at any time.
 *
 * What it asks for:
 *
 *  - **A name**, because a published report's name is how its audience refers to it and two published
 *    reports cannot share one. The rule is the caller's (`nameProblem`) so Save draft applies the
 *    same one, and it is checked *as you type* — a collision found after pressing Publish is a dialog
 *    that closes, toasts a refusal, and loses the name.
 *  - **Who can open it**, picked as people and stored as their roles. The directory is served
 *    (`governance.people`, the tenant's users from Settings); a list written here would be a second
 *    answer to "who exists" and could offer somebody the API refuses.
 *  - **How fresh the figures stay**, from the presets the tenant authored, each carrying its own
 *    sentence so the line under the select is their words rather than this component's.
 *
 * Beside each reader is that persona's **declared** data scope — "All facilities, summary grain",
 * "Assigned facility only" — and its masked columns. Stated, never applied: no roster in this
 * section is filtered per persona, so a figure like "sees 32 of 36 generators" would be this dialog
 * claiming a filter that never ran. The note beneath says the rules live in Audit & Governance and
 * that publishing widens nobody's access, which is the whole reason the preview is worth showing.
 */

interface Props {
  /** Prefilled name — the report title, or the existing name when republishing. */
  initialName: string;
  /**
   * The audience this report goes to.
   *
   * **Not a choice here any more.** The dialog used to offer a `<select>` over the three
   * audiences; it was removed, so this arrives already decided — the audience a republished
   * report already had, or the default for a new one — and is passed straight back on confirm.
   * This is the *prototype's* own audience (Operations / Compliance), a different pool from the
   * four personas below; translating one into the other would invent a mapping.
   */
  initialAudience: string;
  /** The roles this report is already meant for, as role ids. Empty means private. */
  initialViewerRoles: string[];
  /** True when the report is already in the library and this is a re-publish. */
  republish: boolean;
  /** The served copy and directory. */
  publishing: Publishing;
  people: Person[];
  /**
   * True where the report lives only in this browser, so its readers are recorded locally and
   * nobody else can see them. Said on the dialog rather than left to be assumed.
   */
  localOnly?: boolean;
  /**
   * Why this name cannot be used, or null. The caller owns the rule — `nameProblem` in `lib/library`
   * — because Save draft has to apply the same one, and two copies of "is this name taken" is how a
   * dialog accepts a name the save then rejects.
   */
  nameProblem?(name: string): string | null;
  onCancel(): void;
  onConfirm(name: string, audience: string, viewerRoles: string[], freshness: string): void;
}

/**
 * The reader picker: the field, and the directory beneath it.
 *
 * **Its own component, and `open` is a prop rather than its own state.** A list behind a parent's
 * `useState` cannot be asserted on — `renderToString` renders the closed one, so every check about
 * what the directory contains would pass over nothing. That is the `ConnectSourceWizard` /
 * `AudiencePicker` rule, and it applies to a dropdown as much as to a drawer.
 *
 * **Focus opens it.** The list used to appear only once something was typed, which asked the reader
 * to guess at a directory only Settings knows: four people, all of them valid, none discoverable
 * from here. Four rows is the whole pool, so there is nothing to page through and no reason to make
 * somebody type first.
 */
export function ReaderFinder({
  label,
  placeholder,
  query,
  open,
  hits,
  onQuery,
  onOpen,
  onPick,
}: {
  label: string;
  placeholder: string;
  query: string;
  open: boolean;
  /** Who is still available, already filtered by the query and by who is named. */
  hits: Person[];
  onQuery(value: string): void;
  onOpen(open: boolean): void;
  onPick(person: Person): void;
}) {
  return (
    <div className="rp-pubFind">
      <input
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={label}
        onChange={(e) => onQuery(e.target.value)}
        onFocus={() => onOpen(true)}
        /* Blur closes it, but picking somebody must not: the option's `onMouseDown` preventDefault
           keeps focus in the field, so the list stays open for a second pick. */
        onBlur={() => onOpen(false)}
      />
      {open && (
        <div className="rp-pubDrop">
          {hits.map((p) => (
            <button
              type="button"
              className="rp-pubOpt"
              key={p.email}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(p)}
            >
              <span>
                <span className="rp-pubOptName">{p.name}</span>
                <span className="rp-pubOptRole">{p.roleLabel}</span>
              </span>
              <span className="rp-pubOptMail">{p.email}</span>
            </button>
          ))}
          {/*
            * Two different empty lists, and they are different facts: nobody *matches* what was
            * typed, or everybody is already named. Neither offers an invite — the directory is
            * Settings' and a report audience is one of the four personas, so offering to invite an
            * address would promise a reader this app cannot create.
            */}
          {hits.length === 0 && (
            <div className="rp-pubOpt rp-pubNone">
              {query.trim()
                ? `No one in Settings matches “${query.trim()}”`
                : 'Everyone in Settings is already named on this report.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Initials for the avatar, from the name the directory gave — never invented from an address. */
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

export function PublishDialog({
  initialName,
  initialAudience,
  initialViewerRoles,
  republish,
  publishing,
  people,
  localOnly,
  nameProblem,
  onCancel,
  onConfirm,
}: Props) {
  const [name, setName] = useState(initialName);
  const [touched, setTouched] = useState(false);
  /* Roles, not people: one person stands for their persona, so picking two people who share a
     persona is one audience entry. Seeded from what the report already names. */
  const [roles, setRoles] = useState<string[]>(initialViewerRoles);
  const [query, setQuery] = useState('');
  /** Whether the directory is open. Focus opens it — the four people are the whole pool. */
  const [finding, setFinding] = useState(false);
  const [fresh, setFresh] = useState(publishing.freshness.default);
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
  const problem = nameProblem?.(trimmed) ?? null;
  const invalid = !!problem;

  /* Who is picked, in the directory's order — so the rows read the same however they were added. */
  const picked = useMemo(() => people.filter((p) => roles.includes(p.roleId)), [people, roles]);

  /*
   * **Focusing the field shows the directory; typing narrows it.**
   *
   * It offered nothing until something was typed, which asked the reader to guess at a list only
   * Settings knows — four people, all of them valid, and no way to discover them from here. The
   * whole directory is four rows, so there is nothing to page through and nothing to protect: an
   * empty query is "show me who there is", not "match everything".
   *
   * Matched on name, address or persona, because a reader looking for whoever holds a role knows
   * the role and not always the person.
   */
  const q = query.trim().toLowerCase();
  const hits = people.filter(
    (p) =>
      !roles.includes(p.roleId) &&
      (!q ||
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.roleLabel.toLowerCase().includes(q)),
  );

  const sentence =
    publishing.freshness.presets.find((p) => p.id === fresh)?.sentence ?? '';

  function add(person: Person) {
    setRoles((prev) => (prev.includes(person.roleId) ? prev : [...prev, person.roleId]));
    setQuery('');
  }

  function submit() {
    setTouched(true);
    if (invalid) {
      inputRef.current?.focus();
      return;
    }
    /* The prototype's own audience is passed back unchanged — nothing here can alter it. */
    onConfirm(trimmed, initialAudience, roles, fresh);
  }

  return (
    <div className="modalBack" onClick={onCancel}>
      <div className="modal rp-pub" onClick={(e) => e.stopPropagation()}>
        <h3>{republish ? publishing.republishTitle : publishing.title}</h3>
        <div className="mh">{republish ? publishing.name.help : publishing.lead}</div>

        <div className="fld">
          <label htmlFor="pubName">{publishing.name.label}</label>
          <input
            id="pubName"
            ref={inputRef}
            value={name}
            placeholder={publishing.name.placeholder}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          {/* The rule's own sentence — "needs a name" and "that name is taken" are different fixes. */}
          {touched && problem && <div className="err2">{problem}</div>}
        </div>

        <div className="rp-pubSec">
          <div className="rp-pubLabel">{publishing.readers.label}</div>

          <ReaderFinder
            label={publishing.readers.label}
            placeholder={publishing.readers.placeholder}
            query={query}
            open={finding}
            hits={hits}
            onQuery={setQuery}
            onOpen={setFinding}
            onPick={add}
          />

          {picked.length === 0 ? (
            <div className="rp-pubEmpty">{publishing.readers.empty}</div>
          ) : (
            <div className="rp-pubList">
              {picked.map((p) => (
                <div className="rp-pubRow" key={p.email}>
                  <span className="rp-pubAv" aria-hidden="true">
                    {initials(p.name)}
                  </span>
                  <span className="rp-pubWho">
                    <span className="rp-pubName">{p.name}</span>
                    <span className="rp-pubMail">{p.email}</span>
                  </span>
                  <span className="rp-pubScope">
                    {/* The persona's *declared* scope. A category, so it carries no state colour. */}
                    {p.scope && <span className="rp-pubPill">{p.scope}</span>}
                    {p.masked && <span className="rp-pubMasked">Masked: {p.masked}</span>}
                  </span>
                  <button
                    type="button"
                    className="rp-pubX"
                    title={`Remove ${p.name}`}
                    aria-label={`Remove ${p.name}`}
                    onClick={() => setRoles((prev) => prev.filter((r) => r !== p.roleId))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rp-pubNote">{publishing.readers.note}</div>
          {/* Gate 1's caveat, at the point the decision is made. */}
          <div className="rp-pubCaveat">
            {localOnly ? publishing.readers.localCaveat : publishing.readers.caveat}
          </div>
        </div>

        <div className="rp-pubSec">
          <div className="rp-pubLabel">{publishing.freshness.label}</div>
          <select
            className="rp-pubSel"
            value={fresh}
            aria-label={publishing.freshness.label}
            onChange={(e) => setFresh(e.target.value)}
          >
            {publishing.freshness.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="rp-pubNote">{sentence}</div>
        </div>

        <div className="modalActs rp-pubActs">
          {/* What publishing does, where the button that does it is. */}
          <span className="rp-pubFoot">{publishing.foot}</span>
          <button className="btn" onClick={onCancel}>
            {publishing.buttons.cancel}
          </button>
          <button className="btn pri" onClick={submit}>
            {republish ? publishing.buttons.republish : publishing.buttons.publish}
          </button>
        </div>
      </div>
    </div>
  );
}
