import { OptionList, useMenu } from '../components/MenuProvider';
import type { GovernedRow, GovernanceState } from '../App';

/**
 * Authorize — moving the tenant's report definitions between the lifecycle states it declares.
 *
 * **Its own tab, not a button on a card, and the difference is what the surface is for.** The Library
 * answers "what reports exist and what is each one"; a card there carries the acts that belong to
 * *that* report — read it, edit it, say who sees it. Authorizing is a different job: it is done
 * across the set, usually in one sitting, and the question a reader has is "what is waiting on me",
 * which a grid of cards cannot answer because the states are scattered through it. So the states are
 * the rows here, the whole set is in one table, and the current state is a column rather than a pill
 * you go hunting for.
 *
 * **Nothing here is enforced, and the tab says so.** A lifecycle state is a decision this app records;
 * it does not gate who can open a report, because the role is client-held and the API serves every row
 * to a caller that names none. That is the same sentence Share carries, for the same reason, and it
 * belongs on any surface that lets somebody set one of these.
 */
export function AuthorizePane({
  governed,
  states,
  onAuthorize,
}: {
  governed?: GovernedRow[];
  /** The states the tenant declares, served. The computed chip is filtered out — see below. */
  states?: GovernanceState[];
  onAuthorize?(row: GovernedRow, status: string): void | Promise<void>;
}) {
  const { open } = useMenu();
  const rows = governed ?? [];

  /*
   * **The computed chip is not a destination.** `All current` is everything not archived — it filters
   * the Library and is not somewhere a report goes, so offering it would be a menu item that always
   * fails. Excluded by the served flag rather than by testing for its key, so a second computed chip
   * needs no change here.
   */
  const movable = (states ?? []).filter((s) => !s.computed);

  if (rows.length === 0) {
    return (
      <div className="pane on">
        <div className="paneHead">
          <h1>Authorize</h1>
          <p>
            Nothing to authorize — this tenant has no governed report definitions yet. Re-seed them
            with <code>npm run seed:governance</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pane on">
      <div className="paneHead">
        <h1>Authorize</h1>
        <p>
          Move a report between the states this tenant declares. The state is recorded against the
          report with whoever changed it — it is <b>not access control</b>: who can open a report is
          its audience, set from Share, and nothing in this app filters a reader&rsquo;s rows by it.
        </p>
      </div>

      <div className="rp-authTable">
        <div className="rp-authHead">
          <span>Report</span>
          <span>State</span>
          <span>Last authorized</span>
          <span>Audience</span>
          <span />
        </div>

        {rows.map((r) => {
          const state = movable.find((s) => s.key === r.status);
          return (
            <div className="rp-authRow" key={r.reportId}>
              <span className="rp-authName">
                <b>{r.title}</b>
                <em>
                  {[r.version, r.category].filter(Boolean).join(' · ')}
                </em>
              </span>

              {/* The served label and tone, never a colour decided here. */}
              <span>
                <span className={'pill ' + (state?.tone === 'good' ? 'ok' : state?.tone === 'crit' ? 'bad' : state?.tone === 'warn' ? 'warn' : 'rp-neutral')}>
                  {r.statusLabel}
                </span>
              </span>

              {/*
                * Who last moved it, and when. Absent until somebody has — an unattributed state change
                * is worse than none, and this app does not invent an actor.
                */}
              <span className="rp-authWho">
                {r.authorizedBy ? (
                  <>
                    {r.authorizedBy}
                    {r.authorizedAt ? <em> · {r.authorizedAt.slice(0, 10)}</em> : null}
                  </>
                ) : (
                  <em>not authorized here yet</em>
                )}
              </span>

              <span className="rp-authAud">
                {r.private ? <em>nobody — private</em> : r.entitledRoles.map((role) => role.label).join(', ')}
              </span>

              <span>
                {onAuthorize && movable.length > 0 && (
                  <button
                    className="btn sm"
                    onClick={(e) =>
                      open(
                        e,
                        <OptionList
                          title={`Move “${r.title}” to`}
                          items={movable.map((st) => ({
                            label: st.label,
                            d:
                              st.key === r.status
                                ? 'Its current state'
                                : `Move it to ${st.label.toLowerCase()}`,
                            onPick: () => {
                              if (st.key !== r.status) void onAuthorize(r, st.key);
                            },
                          }))}
                        />,
                      )
                    }
                  >
                    Change state ▾
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
