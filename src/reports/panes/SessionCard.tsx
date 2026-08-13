import { STARTERS } from '../data';
import { OptionList, useMenu } from '../components/MenuProvider';
import { audienceLabel, initials } from '../lib/library';
import type { ShareRole } from '../components/SharePicker';
import type { SavedReport } from '../types';

/**
 * A report saved in this browser, as a card in the Library's single list.
 *
 * It sits beside the tenant's governed definitions rather than under a heading of its own, and what
 * marks it out is on the card: its Draft/Published pill is *local* status, its audience roles say
 * "in this browser only", and the lifecycle chip it answers to is **Saved here** — not Published,
 * because nothing here has been submitted to anybody.
 */
interface Props {
  report: SavedReport;
  /** The role pool, served — used only to name the roles Share put on this row. */
  shareRoles?: ShareRole[];
  /** The read-only consumer view: one action, and no editing. */
  isAudience?: boolean;
  onOpen(report: SavedReport): void;
  onEdit(report: SavedReport): void;
  onShare?(report: SavedReport): void;
  onDelete(id: string): void;
}

function blockSummary(r: SavedReport): string {
  const n = r.blocks.length;
  const spine = STARTERS.find((s) => s.id === r.starterId)?.spine ?? 'generators';
  return `${n} block${n === 1 ? '' : 's'} · ${spine}`;
}

export function SessionCard({
  report: r,
  shareRoles,
  isAudience,
  onOpen,
  onEdit,
  onShare,
  onDelete,
}: Props) {
  const { open } = useMenu();

  return (
    <div className="rcard">
      <div className="rtop">
        <div className="rname">{r.name}</div>
        <span className={'pill ' + (r.status === 'published' ? 'ok' : 'warn')}>
          {r.status === 'published' ? 'Published' : 'Draft'}
        </span>
      </div>

      <div className="rq2">“{r.question}”</div>

      <div className="byline">
        <div className="av">{initials(r.publishedBy)}</div>
        <div className="rmeta">
          <div>
            {r.status === 'published' ? 'Published by' : 'Saved by'} <b>{r.publishedBy}</b>
          </div>
          <div>
            {r.publishedRole} · {r.savedAt}
          </div>
        </div>
      </div>

      <div className="rmeta">
        {/* Said plainly, because this card sits in the same list as the tenant's own definitions. */}
        <div>Saved in this browser · {blockSummary(r)}</div>
        <div>
          Audience: <b>{audienceLabel(r.audience)}</b>
        </div>
        {/*
          * The roles Share put on this row, where it has been used. Absent until then rather than
          * shown as "nobody", because a report nobody has shared yet and one deliberately made
          * private are different facts — and only the second is a decision.
          */}
        {r.viewerRoles && (
          <div>
            Shared with:{' '}
            <b>
              {r.viewerRoles.length === 0
                ? 'nobody — private'
                : (shareRoles ?? [])
                    .filter((role) => r.viewerRoles?.includes(role.roleId))
                    .map((role) => role.label)
                    .join(', ')}
            </b>{' '}
            · in this browser only
          </div>
        )}
        <div>
          Reads from <b>{r.assumptions.graph.label}</b>
        </div>
      </div>

      <div className="racts2">
        {isAudience ? (
          <button className="btn sm pri" onClick={() => onOpen(r)}>
            Open report
          </button>
        ) : (
          <>
            <button className="btn sm" onClick={() => onOpen(r)}>
              Open report
            </button>
            <button className="btn sm" onClick={() => onEdit(r)}>
              ✎ Edit report
            </button>
            {/*
              * The same four actions the governed rows offer, so a row reads the same wherever it
              * sits. What Share writes here is local — this report has no governance row to change —
              * and the dialog and the row both say so.
              */}
            {onShare && (
              <button className="btn sm" onClick={() => onShare(r)}>
                ↗ Share
              </button>
            )}
            <button
              className="btn sm danger"
              onClick={(e) =>
                open(
                  e,
                  <OptionList
                    title={`Delete “${r.name}”?`}
                    items={[
                      {
                        label: 'Yes, delete it',
                        d:
                          r.status === 'published'
                            ? 'It disappears from every audience that can see it.'
                            : 'The draft is gone for good.',
                        danger: true,
                        onPick: () => onDelete(r.id),
                      },
                      { label: 'Keep it', onPick: () => {} },
                    ]}
                  />,
                )
              }
            >
              ✕ Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
