import { useState } from 'react';

/**
 * Who may see that a report exists.
 *
 * **Its own component, not a block inside `LibraryPane`.** A panel behind a `useState` in its
 * parent cannot be asserted on — `renderToString` renders the closed state, so every check about
 * what the panel contains passes over nothing. That is the `ConnectSourceWizard` rule, and it
 * applies to plain conditional state as much as to a `Modal`.
 *
 * **The roles are the server's pool, never a copy.** `db.auth_roles` is the one place they are
 * declared and `GET /auth/roles` serves them; a hard-coded list here would be a second answer to
 * "who exists" and could offer a role the API refuses — the consent screen learned that the hard
 * way when a client-side scope list described one permission out of two.
 */
export interface ShareRole {
  roleId: string;
  label: string;
  /** What the role may see. Served beside the label, so the picker explains rather than asserts. */
  accessNote?: string | null;
}

interface Props {
  /** Named so a reader knows which report they are about to change. */
  reportTitle: string;
  roles: ShareRole[];
  /** The audience as it stands. Empty means the report is already private. */
  selected: string[];
  saving?: boolean;
  /**
   * Said where the picker cannot claim otherwise: a report saved in this browser has no governance
   * row, so choosing an audience for it records an intention rather than an entitlement.
   */
  localOnly?: boolean;
  onCancel(): void;
  onSave(audience: string[]): void;
}

/** The one option that is not a role: private is the empty audience. */
export const PRIVATE_LABEL = 'No one / Private';

export function SharePicker({
  reportTitle,
  roles,
  selected,
  saving,
  localOnly,
  onCancel,
  onSave,
}: Props) {
  const [picked, setPicked] = useState<string[]>(selected);
  const isPrivate = picked.length === 0;

  const toggle = (roleId: string) =>
    setPicked((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId],
    );

  /* Order is the pool's, so the list reads the same here as it does on the login. */
  const inPoolOrder = roles.filter((r) => picked.includes(r.roleId)).map((r) => r.roleId);
  const changed =
    inPoolOrder.length !== selected.length ||
    inPoolOrder.some((r) => !selected.includes(r));

  return (
    <div className="rp-share">
      <div className="rp-shareHead">
        <h3>Share “{reportTitle}”</h3>
        <p>
          One role, several, or nobody. This is gate 1 — who may see that the report exists. It does
          not widen anyone’s data scope: an entitled reader still sees only the rows their own
          predicate admits.
        </p>
      </div>

      <div className="rp-shareList" role="group" aria-label="Roles this report is shared with">
        {roles.map((role) => (
          <label className="rp-shareRow" key={role.roleId}>
            <input
              type="checkbox"
              checked={picked.includes(role.roleId)}
              onChange={() => toggle(role.roleId)}
            />
            <span>
              <span className="rp-shareName">{role.label}</span>
              {role.accessNote && <span className="rp-shareNote">{role.accessNote}</span>}
            </span>
          </label>
        ))}

        {/*
          * Private is the *absence* of an audience rather than a fifth role, so it is a radio-shaped
          * choice that clears the list — offering it as a checkbox beside the four would let a
          * reader tick "no one" and "Domain Architect" at once and mean nothing by it.
          */}
        <label className={'rp-shareRow rp-private' + (isPrivate ? ' on' : '')}>
          <input
            type="radio"
            name="rp-private"
            checked={isPrivate}
            onChange={() => setPicked([])}
          />
          <span>
            <span className="rp-shareName">{PRIVATE_LABEL}</span>
            <span className="rp-shareNote">
              Nobody but you can see that it exists. Anyone signed in as another role sees it listed
              as one they may request.
            </span>
          </span>
        </label>
      </div>

      {/*
        * The caveat, stated where the decision is made rather than in a doc. The role is held by the
        * browser and this login authenticates by shape, so what this changes is what a reader is
        * *shown* — the API still serves every row to a caller that asks without a role.
        */}
      <p className="rp-shareCaveat">
        {localOnly
          ? 'This report has not been governed yet, so the audience is recorded in this browser and nobody else can see it. It is not access control either: the role comes from the browser, and the API still serves every row to a caller that asks without one.'
          : 'This narrows what a reader is shown. It is not access control: the role comes from the browser, and the API still serves every row to a caller that asks without one.'}
      </p>

      <div className="rp-shareActs">
        <button className="btn sm pri" disabled={saving || !changed} onClick={() => onSave(inPoolOrder)}>
          {saving ? 'Saving…' : isPrivate ? 'Make it private' : `Share with ${inPoolOrder.length}`}
        </button>
        <button className="btn sm" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The picker, in the prototype's own dialog chrome.
 *
 * **It is a dialog because it was not.** Rendered inline under the row it changes, it grew the card
 * by ~400px — and in a card grid whose cards are `height: 100%` with the action row pinned by
 * `margin-top: auto`, that stretched every sibling in the row to match and left four cards with a
 * chasm between their text and their buttons. That is the trap `docs/REGRESSIONS.md` records for the
 * saved-report card, met a second time: **the equal-height card trick breaks a card that expands.**
 *
 * `.modalBack` / `.modal` are the prototype's own, the same shell `PublishDialog` uses, so this
 * looks like the section's other dialog rather than a second idea of one. It is rendered inline in
 * the tree rather than through a portal, which is also what keeps it assertable under
 * `renderToString`.
 */
export function ShareDialog(props: Props) {
  return (
    <div className="modalBack" onClick={props.saving ? undefined : props.onCancel}>
      {/* The backdrop dismisses; a click inside must not, or picking a role closes the dialog. */}
      <div className="modal rp-shareModal" onClick={(e) => e.stopPropagation()}>
        <SharePicker {...props} />
      </div>
    </div>
  );
}
