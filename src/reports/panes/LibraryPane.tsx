import { STARTERS } from '../data';
import { audienceLabel, initials } from '../lib/library';
import { OptionList, useMenu } from '../components/MenuProvider';
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
              <div className="cards">
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
                      <div>
                        Audience: <b>{r.entitledRoles.length}</b> of the personas ·{' '}
                        {r.schedule}
                      </div>
                      {/* Null rather than the word "none" pretending to be an approval. */}
                      <div>
                        Approval: <b>{r.approval ?? 'none recorded'}</b>
                      </div>
                      {r.floor && <div>{r.floor}</div>}
                    </div>

                    {/* Why it is in this state, in the tenant's own words, where there is a reason. */}
                    {r.note && <div className="rp-gnote">{r.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <h2 className="rp-shelfHead">Saved in this session</h2>
        </>
      )}

      {reports.length === 0 ? (
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
                      Open
                    </button>
                    <button className="btn sm" onClick={() => onEdit(r)}>
                      ✎ Edit report
                    </button>
                    <span className="spacer" />
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
