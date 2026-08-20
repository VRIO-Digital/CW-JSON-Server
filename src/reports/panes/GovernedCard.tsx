import { OptionList, useMenu } from '../components/MenuProvider';
import { initials, starterForTag } from '../lib/library';
import type { GovernedRow } from '../App';

/**
 * One of the tenant's governed report definitions, as a card in the Library's single list.
 *
 * **Its own component so it can be asserted on**, and because the list now holds two kinds of card:
 * a definition the tenant governs, and a report saved in this browser. What separates them is on the
 * card rather than in a heading above a group of them.
 */
interface Props {
  row: GovernedRow;
  onOpen?(row: GovernedRow): void;
  onEdit?(row: GovernedRow): void;
  onShare?(row: GovernedRow): void;
  onRemove?(row: GovernedRow): void | Promise<void>;
  /**
   * Return this report to the state its audience can open.
   *
   * **One act, not a state menu.** Moving a report between all four of the tenant's lifecycle states
   * was a tab, and the tab was removed on request — but removing it left a `blocked` definition with
   * no way back, which is a report stuck where a reader put it. This is the one direction that
   * unsticks it, so it is offered on the row that needs it and nowhere else: a published row has no
   * state control at all, and there is still no Block or Archive here. Absent with no host.
   */
  onPublish?(row: GovernedRow): void | Promise<void>;
  /**
   * The served label of that state — `governance.statuses`' own word for it, never "Published"
   * written down here. Absent when the prototype stands alone, which is also when `onPublish` is.
   */
  publishLabel?: string;
}

/**
 * A state's tone, in the vendored sheet's own pill vocabulary.
 *
 * The tone is the server's — it comes down beside the label on every state and every row, so a state
 * cannot read `warn` on a chip and `neutral` on the card it counts. This only translates it into the
 * class the prototype's stylesheet already has, and `neutral` is the one it lacks: the prototype had
 * no state that was neither good nor bad, so `rp-neutral` is added beside it.
 */
const PILL_FOR_TONE: Record<string, string> = {
  good: 'ok',
  warn: 'warn',
  crit: 'bad',
  info: 'info',
  neutral: 'rp-neutral',
};

/* Not exported: only this card renders a state pill, and a second exporter of it would be a second
   place a tone could be translated. */
const pillClass = (tone: string) => 'pill ' + (PILL_FOR_TONE[tone] ?? 'rp-neutral');

export function GovernedCard({
  row: r,
  onOpen,
  onEdit,
  onShare,
  onRemove,
  onPublish,
  publishLabel,
}: Props) {
  const { open } = useMenu();
  /*
   * **Open and Edit need different things, and treating them as one hid Open entirely.**
   *
   * They were both gated on `starterForTag` — true while the governed definitions and the prototype's
   * starters were the same five reports out of the same file. They are not any more: Northline's rows
   * are tagged `variance-report`, `project-360`, `rate-case-filing-calendar` and its starters are the
   * prototype's own EPA sample, so nothing matched and **all three reports lost both buttons** — a
   * Library with three cards in it and no way to open one.
   *
   * The split is what the two acts actually are. **Open** hands an id to the host, which renders the
   * published report from the tenant's own figures (`onOpenPublished`); it never touches a starter, so
   * requiring one was always wrong and only looked right while one always existed. **Edit** loads the
   * authoring definition into this prototype, which is exactly a starter — so it stays gated, and a row
   * with no definition behind it offers Open and not Edit. That is the honest pair: the report can be
   * read, and it cannot be edited here, which is true.
   */
  const editable = !!starterForTag(r.reportTag, r.reportId);

  return (
    <div className="rcard">
      <div className="rtop">
        <div className="rname">{r.title}</div>
        {/* State, with its own served label and tone — never a colour chosen here. */}
        <span className={pillClass(r.tone)}>{r.statusLabel}</span>
      </div>

      <div className="rq2">“{r.question}”</div>

      <div className="byline">
        <div className="av">{initials(r.author ?? '')}</div>
        <div className="rmeta">
          <div>
            {r.kind === 'written' ? 'Defined by' : 'Saved by'}{' '}
            <b>{r.author ?? 'nobody recorded'}</b>
          </div>
          <div>
            {[r.version, r.category, r.asOf ? `as of ${r.asOf}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      <div className="rmeta">
        {/*
          * Who it is shared with, by name. A count alone ("3 of 4") does not answer the question
          * Share exists to answer, and private is stated as a decision rather than left to be
          * inferred from a zero.
          */}
        <div>
          Shared with:{' '}
          <b>
            {r.private ? 'nobody — private' : r.entitledRoles.map((role) => role.label).join(', ')}
          </b>
        </div>
        {/*
          * The schedule, and **no approval line**. `approval` is still on the payload and the
          * Operations tab's audit and publish checks still read it; what was removed is restating it
          * here, where "Approval: self-approved" sat between two facts a reader of this list needs.
          */}
        <div>{r.schedule}</div>
        {/*
          * **Who authorized it is on the row and rendered nowhere.** `authorizedBy` / `authorizedAt`
          * came down for the Authorize tab, which stated them per row; the tab is gone and nothing
          * took the record over. That is deliberate rather than an oversight — this card says what
          * the report *is*, and the state pill above already says where it stands. The fields stay
          * because the endpoint still writes them; a surface for them is a decision, not a gap to be
          * filled by adding a line here.
          */}
        {r.floor && <div>{r.floor}</div>}
      </div>

      {/* Why it is in this state, in the tenant's own words, where there is a reason. */}
      {r.note && <div className="rp-gnote">{r.note}</div>}

      {/*
       * Four actions, on every row, and each offered only where it can be carried out: Open and Edit
       * need a starter behind the row, Share and Delete are the governance row's own and a composed
       * report has none. A button that 404s is worse than absent.
       *
       * **There is no access gate here.** A request-access / pending-approval state used to replace
       * this row for a reader whose role the audience did not name; it was removed, so *"Shared with"*
       * above states who the audience is and nothing acts on it. That is honest rather than lax — the
       * role is client-held and the API serves every row to a caller that names none, so what was
       * removed could never have been access control. See `docs/REGRESSIONS.md` for what it looked
       * like, and do not re-add a gate here that the API does not enforce.
       *
       * No `.spacer` before Delete — `flex: 1` pushed it to the far edge, which in a narrow column
       * forced the row to wrap and broke every label across two lines.
       */}
      <div className="racts2">
        {/* No arrow: this renders the report in place, and the arrow is this app's mark for a
            control that leaves the page. */}
        {onOpen && (
          <button className="btn sm" onClick={() => onOpen(r)} title="Opens the report in this console">
            Open report
          </button>
        )}
        {onEdit && editable && (
          <button className="btn sm" onClick={() => onEdit(r)}>
            ✎ Edit report
          </button>
        )}
        {/*
          * **One state change, and it is the only one.** The four-state Authorize menu was a button
          * here, then a tab, and both were removed on request — the reason it wanted a tab still
          * stands, because "what is waiting on me" is a question about the whole set and a grid of
          * cards cannot answer it. What removing it also did was leave a `blocked` definition with
          * nothing that could publish it again: the state was reachable and the way out of it was
          * not. So this is the way out, and only that. **No Block and no Archive**, which is the menu
          * that was rejected; a published row shows nothing here at all.
          *
          * The verb is *Publish* rather than *Republish* because this row does not know its own
          * history — `authorizedAt` dates the last change and not the states before it — and a draft
          * that has never been live would be told it was being re-anything.
          */}
        {onPublish && publishLabel && (
          <button
            className="btn sm"
            title={`Moves this report to ${publishLabel}`}
            onClick={(e) =>
              open(
                e,
                <OptionList
                  title={`Publish “${r.title}”?`}
                  items={[
                    {
                      label: `Yes, move it to ${publishLabel}`,
                      /* What publishing means for a reader, and the private case stated rather than
                         left to be inferred from an empty audience — the rule "Shared with" above
                         keeps. */
                      d: r.private
                        ? 'Its audience is nobody, so this makes it openable and tells no one. Share it to name readers.'
                        : `${r.entitledRoles.map((role) => role.label).join(', ')} can open it.`,
                      onPick: () => void onPublish(r),
                    },
                    { label: 'Leave it as it is', onPick: () => {} },
                  ]}
                />,
              )
            }
          >
            ↻ Publish
          </button>
        )}
        {onShare && r.kind === 'written' && (
          <button className="btn sm" onClick={() => onShare(r)}>
            ↗ Share
          </button>
        )}
        {onRemove && r.kind === 'written' && (
          <button
            className="btn sm danger"
            onClick={(e) =>
              open(
                e,
                <OptionList
                  title={`Remove “${r.title}” from the governed set?`}
                  items={[
                    {
                      label: 'Yes, remove it',
                      /* What actually happens, not "gone for good": the definition is the
                         package's, and `npm run seed:governance` restores every row. */
                      d: 'It stops being a governed definition and leaves this list. "npm run seed:governance" brings it back.',
                      danger: true,
                      onPick: () => void onRemove(r),
                    },
                    { label: 'Keep it', onPick: () => {} },
                  ]}
                />,
              )
            }
          >
            ✕ Delete
          </button>
        )}
      </div>
    </div>
  );
}
