import { STARTERS } from '../data';
import { audienceLabel, initials } from '../lib/library';
import { OptionList, useMenu } from '../components/MenuProvider';
import type { SavedReport } from '../types';

interface Props {
  /** 'library' is the author's own shelf; 'audience' is the read-only consumer view. */
  mode: 'library' | 'audience';
  /** Audience mode: the tab's own wording, and the group being previewed. */
  heading?: string;
  audienceName?: string;
  reports: SavedReport[];
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

export function LibraryPane({
  mode,
  heading,
  audienceName = 'Operations',
  reports,
  onAuthorNew,
  onEdit,
  onDelete,
  onOpen,
}: Props) {
  const { open } = useMenu();
  const isAudience = mode === 'audience';

  return (
    <div className="pane on">
      <div className="pageHead">
        <div className="phRow">
          <div>
            <h1>{isAudience ? heading ?? `${audienceName} audience` : 'Library'}</h1>
            <p>
              {isAudience
                ? `What the ${audienceName} group sees. Published reports only, read-only — no filters to change, nothing to edit.`
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
