import { GovernedCard } from './GovernedCard';
import { PUBLISHED } from '../lib/library';
import { SessionCard } from './SessionCard';
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
   * Definitions the tenant has that nothing governs, and the command that re-authors them. Normally
   * empty; stated above the list when it is not, because a list that is simply *shorter* reads as
   * data loss and leaves a reader counting cards against a file they cannot see.
   */
  ungoverned?: { reportId: string; reportTag: string; title: string }[];
  restore?: string;
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
  /**
   * Return a governed definition to the state its audience can open.
   *
   * Passed down to a card **only where that is the thing missing** — the pane owns that decision
   * because the pane is where the state pool is, and `PUBLISHED` is read off it rather than tested
   * for by key in the card.
   */
  onPublishGoverned?(row: GovernedRow): void | Promise<void>;
  /** Share on a report saved in this session — the same dialog, over the row's local audience. */
  onShareSaved?(report: SavedReport): void;
  onAuthorNew(): void;
  onEdit(report: SavedReport): void;
  onDelete(id: string): void;
  onOpen(report: SavedReport): void;
}

/**
 * The state key a card sits under.
 *
 * **One list, so one vocabulary.** A governed definition carries a lifecycle state the tenant
 * authored; a report saved in this session carries none — it has never been submitted to anybody, so
 * it cannot be `published` in the sense the chip means. It goes under `SESSION` instead, and its own
 * Draft/Published pill still says what it is *locally*. Folding it into the tenant's Published chip
 * would count something ungoverned as governed, which is the one claim this section must not make.
 */
export const SESSION = 'session';

/**
 * Which cards a chip shows — the single rule, used by the chips to count and by the grid to filter.
 *
 * `current` is the one key that is not a stored state: everything not archived, plus everything saved
 * here, because a session report is as current as anything gets. The rule lives once so a chip cannot
 * say five and the grid show six.
 */
/* The served state a Publish button targets, or nothing — see the note at the card. */
const publishedStateOf = (states?: GovernanceState[]) =>
  states?.find((s) => s.key === PUBLISHED) ?? null;

const inState = <T extends { stateKey: string }>(rows: T[], key: string) =>
  key === 'current' ? rows.filter((r) => r.stateKey !== 'archived') : rows.filter((r) => r.stateKey === key);

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
  ungoverned,
  restore,
  onOpenGoverned,
  onEditGoverned,
  onShareGoverned,
  onRemoveGoverned,
  onPublishGoverned,
  onShareSaved,
  onAuthorNew,
  onEdit,
  onDelete,
  onOpen,
}: Props) {
  const isAudience = mode === 'audience';
  /*
   * The chip bar is the tenant's governance, so it appears only where there is tenant governance
   * to show and only on the author's own shelf. The audience view is published-only by definition
   * — a consumer filtering by "Pending approval" would be filtering to things they cannot open.
   */
  const showStates = !isAudience && !!states?.length && !!governed;

  /*
   * **One list.** The governed definitions and the reports saved in this session were two grids under
   * two headings; they are now one, tagged by where each came from, because a reader looking for a
   * report should not have to know which of two collections it landed in.
   *
   * Both are normalised to the same shape here so the chips, the filter and the grid all read one
   * list — the cards still differ, because a definition and a local draft carry different facts.
   */
  const cards = [
    ...(governed ?? []).map((row) => ({
      key: `g:${row.reportId}`,
      stateKey: row.status,
      governed: row,
      saved: undefined as SavedReport | undefined,
    })),
    ...(showStates ? reports : []).map((row) => ({
      key: `s:${row.id}`,
      stateKey: SESSION,
      governed: undefined as GovernedRow | undefined,
      saved: row,
    })),
  ];

  /*
   * The chip bar's pool is the server's — its keys, labels, tones and order — and **the counts are
   * this list's**, computed by the same `inState` the grid filters with.
   *
   * That is a change from counting on the server, and it is the merge that forced it: the server
   * cannot count rows it has never been told about, so a served count beside a list holding session
   * reports would be a count of something else. One rule, one place, so bar and grid cannot disagree.
   * The server still computes its own counts for the Operations tab, over its own rows.
   */
  const sessionCount = cards.filter((c) => c.stateKey === SESSION).length;
  const chips = [
    ...(states ?? []),
    /* Only where there is something in it — an always-present "Saved here 0" is a dead chip. */
    ...(sessionCount > 0
      ? [{ key: SESSION, label: 'Saved here', tone: 'neutral', count: 0 }]
      : []),
  ].map((s) => ({ ...s, count: inState(cards, s.key).length }));

  const publishedState = publishedStateOf(states);

  const inView = showStates ? inState(cards, activeState) : [];
  const activeLabel = chips.find((s) => s.key === activeState)?.label ?? 'All current';

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
                  ? 'Every report in one list — the tenant’s governed definitions and anything you have saved here — filtered by the state each one is in. Published reports carry the name and byline your audience sees.'
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
            * The chip bar. The pool — keys, labels, tones, order — is the server's
            * `governance.statuses`; the counts are this list's, from the same `inState` the grid
            * filters with. See the note on `chips` above for why the count moved off the server.
            */}
          <div className="rp-chipRow" role="group" aria-label="Report lifecycle state">
            {chips.map((s) => (
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

          {/*
            * **Why the list is shorter than the tenant's own set of reports.**
            *
            * Normally absent. A definition that nothing governs — deleted, or missing from a server
            * process that is serving an older `db.json` from memory — would otherwise just be a row
            * that is not there, which reads as data loss and leaves a reader counting cards. Named,
            * with the command that ends it, and the command is the server's string rather than one
            * spelled here.
            */}
          {!!ungoverned?.length && (
            <div className="rp-missing">
              <b>
                {ungoverned.length === 1
                  ? '1 of this tenant’s report definitions is not governed'
                  : `${ungoverned.length} of this tenant’s report definitions are not governed`}
              </b>
              <div>
                {ungoverned.map((r) => `${r.reportTag} — ${r.title}`).join(', ')}. Its definition still
                exists; only the decision to govern it is gone, so it is not listed here.
              </div>
              {restore && (
                <div>
                  Run <code>{restore}</code> to re-author it. If it reappears in the file but not here,
                  the mock server is serving an older copy from memory — restart it.
                </div>
              )}
            </div>
          )}

          <section className="rp-group">
            {/*
              * No heading and no second grid. What used to be two sections is one list, and the
              * distinction that mattered — governed by the tenant, or saved in this browser — is on
              * each card instead of in a heading above a group of them.
              */}
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
              /* **One grid, both kinds.** `.cards` plus a wider minimum column, because four
                 actions do not fit in the vendored 330px. */
              <div className="cards rp-govGrid">
                {inView.map((c) =>
                  c.governed ? (
                    <GovernedCard
                      key={c.key}
                      row={c.governed}
                      onOpen={onOpenGoverned}
                      onEdit={onEditGoverned}
                      onShare={onShareGoverned}
                      onRemove={onRemoveGoverned}
                      /*
                       * Offered only where the report is not already there, so a published row has no
                       * state control — and `publishLabel` absent takes the button with it, which is
                       * what makes a tenant whose pool does not declare the state offer nothing
                       * rather than a button its API would refuse.
                       */
                      onPublish={
                        c.governed.status === PUBLISHED ? undefined : onPublishGoverned
                      }
                      publishLabel={publishedState?.label}
                    />
                  ) : c.saved ? (
                    <SessionCard
                      key={c.key}
                      report={c.saved}
                      shareRoles={shareRoles}
                      onOpen={onOpen}
                      onEdit={onEdit}
                      onShare={onShareSaved}
                      onDelete={onDelete}
                    />
                  ) : null,
                )}
              </div>
            )}
          </section>
        </>
      )}

      
      {!showStates &&
        (reports.length === 0 ? (
          <div className="emptyState">
            <div className="t">
              {isAudience ? `Nothing published to ${audienceName} yet` : 'Your library is empty'}
            </div>
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
              <SessionCard
                key={r.id}
                report={r}
                shareRoles={shareRoles}
                isAudience={isAudience}
                onOpen={onOpen}
                onEdit={onEdit}
                onShare={onShareSaved}
                onDelete={onDelete}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
