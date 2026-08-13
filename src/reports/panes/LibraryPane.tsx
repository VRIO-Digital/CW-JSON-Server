import { STARTERS } from '../data';
import { audienceLabel, initials, starterForTag } from '../lib/library';
import { OptionList, useMenu } from '../components/MenuProvider';
import type { ShareRole } from '../components/SharePicker';
import type { GovernanceState, GovernedRow } from '../App';
import type { SavedReport } from '../types';

interface Props {
  /** 'library' is the author's own shelf; 'audience' is the read-only consumer view. */
  mode: 'library' | 'audience';
  /** Audience mode: the tab's own wording, and the group being previewed. */
  heading?: string;
  audienceName?: string;
  reports: SavedReport[];
  /**
   * The tenant's lifecycle states and the definitions in them, served. Both absent when the
   * prototype stands alone with no host, and the pane is then what it always was.
   */
  states?: GovernanceState[];
  governed?: GovernedRow[];
  activeState?: string;
  onPickState?(key: string): void;
  /** The role pool, served — used to name the roles a row is shared with. */
  shareRoles?: ShareRole[];
  /**
   * The five acts on a governed row. All optional and all absent together, because the host is what
   * carries them out — a row offers only what can actually happen.
   *
   * **Share only opens the dialog.** The dialog itself is `App`'s, not this pane's: rendered inside a
   * card it stretched every sibling in the grid row, which is the equal-height-card trap.
   */
  onOpenGoverned?(row: GovernedRow): void;
  onEditGoverned?(row: GovernedRow): void;
  onShareGoverned?(row: GovernedRow): void;
  onRemoveGoverned?(row: GovernedRow): void | Promise<void>;
  onRequestGovernedAccess?(row: GovernedRow): void | Promise<void>;
  /** Share on a report saved in this session — the same dialog, over the row's local audience. */
  onShareSaved?(report: SavedReport): void;
  onAuthorNew(): void;
  onEdit(report: SavedReport): void;
  onDelete(id: string): void;
  onOpen(report: SavedReport): void;
}

function blockSummary(r: SavedReport): string {
  const n = r.blocks.length;
  const spine = STARTERS.find((s) => s.id === r.starterId)?.spine ?? 'generators';
  return `${n} block${n === 1 ? '' : 's'} · ${spine}`;
}

/**
 * A state's tone, in the vendored sheet's own pill vocabulary.
 *
 * The tone is the server's — it comes down beside the label on every state and every row, so a
 * state cannot read `warn` on a chip and `neutral` on the card it counts. This only translates it
 * into the class the prototype's stylesheet already has, and `neutral` is the one it lacks: the
 * prototype had no state that was neither good nor bad, so `rp-neutral` is added beside it.
 */
const PILL_FOR_TONE: Record<string, string> = {
  good: 'ok',
  warn: 'warn',
  crit: 'bad',
  info: 'info',
  neutral: 'rp-neutral',
};

const pillClass = (tone: string) => 'pill ' + (PILL_FOR_TONE[tone] ?? 'rp-neutral');

/**
 * The definitions a chip shows.
 *
 * `current` is the one key that is not a stored state, and the rule matches the server's own
 * `count`: everything not archived. A blocked definition is current — it is this quarter's
 * problem, not last quarter's record — so the two agree by construction rather than by comment.
 */
const inState = (rows: GovernedRow[], key: string) =>
  key === 'current' ? rows.filter((r) => r.status !== 'archived') : rows.filter((r) => r.status === key);

export function LibraryPane({
  mode,
  heading,
  audienceName = 'Operations',
  reports,
  states,
  governed,
  activeState = 'current',
  onPickState,
  shareRoles,
  onOpenGoverned,
  onEditGoverned,
  onShareGoverned,
  onRemoveGoverned,
  onRequestGovernedAccess,
  onShareSaved,
  onAuthorNew,
  onEdit,
  onDelete,
  onOpen,
}: Props) {
  const { open } = useMenu();
  const isAudience = mode === 'audience';
  /*
   * The chip bar is the tenant's governance, so it appears only where there is tenant governance
   * to show and only on the author's own shelf. The audience view is published-only by definition
   * — a consumer filtering by "Pending approval" would be filtering to things they cannot open.
   */
  const showStates = !isAudience && !!states?.length && !!governed;
  const inView = showStates ? inState(governed ?? [], activeState) : [];
  const activeLabel =
    states?.find((s) => s.key === activeState)?.label ?? 'All current';

  return (
    <div className="pane on">
      <div className="pageHead">
        <div className="phRow">
          <div>
            <h1>{isAudience ? heading ?? `${audienceName} audience` : 'Library'}</h1>
            <p>
              {isAudience
                ? `What the ${audienceName} group sees. Published reports only, read-only — no filters to change, nothing to edit.`
                : showStates
                  ? 'The tenant’s governed report definitions, filtered by the state they are in, and below them the reports saved in this session. Published reports carry the name and byline your audience sees.'
                  : 'Every report you and your team have saved or published. Published reports carry the name and byline your audience sees.'}
            </p>
          </div>
          {!isAudience && (
            <button className="btn pri" onClick={onAuthorNew}>
              ＋ Author a report
            </button>
          )}
        </div>
      </div>

      {showStates && (
        <>
          {/*
            * The chip bar. Every label and every count is the server's `governance.statuses` —
            * the component chooses neither, because a count computed beside the grid is a second
            * answer to "how many are published" and this is the worst place to have one.
            */}
          <div className="rp-chipRow" role="group" aria-label="Report lifecycle state">
            {states?.map((s) => (
              <button
                key={s.key}
                type="button"
                className={
                  'rp-chip' + (s.key === activeState ? ' on' : '') + (s.count === 0 ? ' zero' : '')
                }
                aria-pressed={s.key === activeState}
                onClick={() => onPickState?.(s.key)}
              >
                <span className="rp-chipLabel">{s.label}</span>
                <span className="rp-chipCount">{s.count}</span>
              </button>
            ))}
          </div>

          <section className="rp-group">
            <h2>Governed definitions</h2>
            {/*
              * Two sentences the code has to keep true: the counts are served, and the chips do
              * not reach the shelf below. A report saved in this browser has never been submitted
              * to anyone, so calling it governed would be the claim this section exists to avoid.
              */}
            <p>
              The tenant’s report definitions and the state each one is in, counted by the server.
              A state changes by approval, not by editing — nothing here is editable. Reports you
              save in this session are on the shelf below and are not governed definitions.
            </p>

            {inView.length === 0 ? (
              <div className="emptyState">
                {/* One expression, not text around an interpolation: `renderToString` splits the
                    second into separate nodes, which is only ever felt by whatever asserts on it. */}
                <div className="t">
                  {activeState === 'current'
                    ? 'No definition is current'
                    : `No definition is ${activeLabel.toLowerCase()}`}
                </div>
                <div className="d2">
                  Nothing is wrong: this is a lifecycle state with no members right now. Pick
                  another state to see what exists.
                </div>
              </div>
            ) : (
              /* `.cards` plus a wider minimum column — four actions do not fit in 330px. */
              <div className="cards rp-govGrid">
                {inView.map((r) => (
                  <div className="rcard" key={r.reportId}>
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
                          {[r.version, r.category, r.asOf ? `as of ${r.asOf}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                    </div>

                    <div className="rmeta">
                      {/*
                        * Who it is shared with, by name. A count alone ("3 of 4") does not answer
                        * the question Share exists to answer, and private is stated as a decision
                        * rather than left to be inferred from a zero.
                        */}
                      <div>
                        Shared with:{' '}
                        <b>
                          {r.private
                            ? 'nobody — private'
                            : r.entitledRoles.map((role) => role.label).join(', ')}
                        </b>
                      </div>
                      <div>
                        {r.schedule} · Approval: <b>{r.approval ?? 'none recorded'}</b>
                      </div>
                      {r.floor && <div>{r.floor}</div>}
                    </div>

                    {/* Why it is in this state, in the tenant's own words, where there is a reason. */}
                    {r.note && <div className="rp-gnote">{r.note}</div>}

                    {/*
                      * **The access state, where the actions would be.** A reader whose role is not
                      * in the audience is not shown Open — they are shown what they can do about
                      * it, and once they have done it, that it is with somebody. `crit` is wrong for
                      * both: not being entitled is a state of the world, not a fault.
                      */}
                    {!r.access.entitled ? (
                      <div className="rp-access">
                        {r.access.request ? (
                          <>
                            <span className="pill warn">Access pending approval</span>
                            <div className="rmeta">
                              <div>
                                Requested by <b>{r.access.request.by}</b>
                                {r.access.request.requestedAt
                                  ? ` on ${r.access.request.requestedAt.slice(0, 10)}`
                                  : ''}
                              </div>
                              {/* Named, because "pending" with no addressee is a dead end. */}
                              <div>
                                With <b>{r.access.request.approvers.join(', ') || 'nobody yet'}</b> —
                                nothing in this demo grants it, so it stays pending until an audience
                                is widened from Share.
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="pill rp-neutral">Not shared with your role</span>
                            <div className="rmeta">
                              <div>
                                You can see that it exists and not what it says. Ask to be added to
                                its audience.
                              </div>
                            </div>
                          </>
                        )}
                        {r.access.mayRequest && onRequestGovernedAccess && (
                          <div className="racts2">
                            <button
                              className="btn sm pri"
                              onClick={() => void onRequestGovernedAccess(r)}
                            >
                              Request access
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      /*
                       * Four actions, and each is offered only where it can be carried out: Open and
                       * Edit need a starter behind the row, Share and Delete are the governance row's
                       * own and a composed report has none. A button that 404s is worse than absent.
                       */
                      <div className="racts2">
                        {onOpenGoverned && starterForTag(r.reportTag, r.reportId) && (
                          <button className="btn sm" onClick={() => onOpenGoverned(r)}>
                            Open report
                          </button>
                        )}
                        {onEditGoverned && starterForTag(r.reportTag, r.reportId) && (
                          <button className="btn sm" onClick={() => onEditGoverned(r)}>
                            ✎ Edit report
                          </button>
                        )}
                        {onShareGoverned && r.kind === 'written' && (
                          <button className="btn sm" onClick={() => onShareGoverned(r)}>
                            ↗ Share
                          </button>
                        )}
                        {onRemoveGoverned && r.kind === 'written' && (
                          <>
                            {/*
                              * No `.spacer` before Delete. `flex: 1` pushed it to the far edge, which
                              * in a 275px column forced the row to wrap and broke every label across
                              * two lines. Four buttons reading left to right, wrapping as a row.
                              */}
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
                                        /* What actually happens, not "gone for good": the
                                           definition is the package's and a re-seed restores it. */
                                        d: 'It stops being a governed definition and leaves this list. Re-seeding the governance rows brings it back.',
                                        danger: true,
                                        onPick: () => void onRemoveGoverned(r),
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
                    )}

                  </div>
                ))}
              </div>
            )}
          </section>

          <h2 className="rp-shelfHead">Saved in this session</h2>
        </>
      )}

      {/*
        * Hosted, the shelf starts empty and says so in one line rather than with the full empty
        * state — a second dashed panel under a grid of five real reports reads as a broken section.
        * Standing alone the shelf *is* the page, and keeps the panel that tells you where to start.
        */}
      {showStates && reports.length === 0 ? (
        <p className="rp-shelfNote">
          Nothing here yet. A report you save or publish from <b>Author a report</b> is listed under
          this heading — it stays yours until somebody governs it.
        </p>
      ) : reports.length === 0 ? (
        <div className="emptyState">
          <div className="t">{isAudience ? `Nothing published to ${audienceName} yet` : 'Your library is empty'}</div>
          <div className="d2">
            {isAudience
              ? `Reports appear here once someone publishes them to the ${audienceName} audience.`
              : 'Ask a question, check the read-back, then save or publish the report you get.'}
          </div>
          {!isAudience && (
            <button className="btn pri" onClick={onAuthorNew}>
              ＋ Author a report
            </button>
          )}
        </div>
      ) : (
        <div className="cards">
          {reports.map((r) => (
            <div className="rcard" key={r.id}>
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
                <div>
                  Audience: <b>{audienceLabel(r.audience)}</b> · {blockSummary(r)}
                </div>
                {/*
                  * The roles Share put on this row, where it has been used. Absent until then rather
                  * than shown as "nobody", because a report nobody has shared yet and one deliberately
                  * made private are different facts — and only the second is a decision.
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
                      * Share, on the same four actions the governed rows offer, so the row reads the
                      * same wherever it sits. What it writes is local — this report has no governance
                      * row to change — and the dialog and the row both say so.
                      */}
                    {onShareSaved && (
                      <button className="btn sm" onClick={() => onShareSaved(r)}>
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
          ))}
        </div>
      )}
    </div>
  );
}
