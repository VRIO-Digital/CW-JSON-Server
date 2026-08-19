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
   * The host can render this report even though no starter in this folder backs it — a **rendered
   * document** rather than an authoring definition. It enables `Open` *and* `Edit`, because the host is
   * what knows which surfaces it has; `App.openGoverned` hands such a row back rather than trying to load
   * a starter that does not exist.
   *
   * Absent means the original rule, so the prototype standing alone behaves exactly as it did.
   */
  hostOpenable?: boolean;
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

export function GovernedCard({ row: r, onOpen, onEdit, onShare, onRemove, hostOpenable }: Props) {
  const { open } = useMenu();
  /*
   * **Open and Edit need something behind the row, and a starter is only one of the two things it can
   * be.**
   *
   * The rule was "no authoring starter, no buttons", which was right while every report in the Library
   * was one of this prototype's own definitions. A host can also serve reports that are *rendered
   * documents*: a finished file, with no starter here at all. Applying the starter test to those hid
   * both buttons on rows that the host can render perfectly well.
   *
   * `hostOpenable` is the host saying "I can render this id" — for reading *and* for authoring, because
   * it is the host that knows what surfaces it has. It makes no claim that a starter exists, which is why
   * `App.openGoverned` hands such a row straight back instead of trying to load one. Absent the prop this
   * is exactly the rule it always was, so the folder standing alone is unchanged.
   */
  const openable = !!starterForTag(r.reportTag, r.reportId) || hostOpenable === true;

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
        {onOpen && openable && (
          <button className="btn sm" onClick={() => onOpen(r)}>
            Open report
          </button>
        )}
        {onEdit && openable && (
          <button className="btn sm" onClick={() => onEdit(r)}>
            ✎ Edit report
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
