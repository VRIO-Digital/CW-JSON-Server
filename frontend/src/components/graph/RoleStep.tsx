import { CheckCircleFilled } from '@ant-design/icons'
import { Checkbox, Input, Spin } from 'antd'
import { INDUSTRIES, ROLES, UTILITIES } from '../../data/roleLibrary'
import { industryName } from '../../data/roleBrief'
import type { RoleDraft } from './useRoleDraft'
import '../../pages/NewGraphPage.css'

/**
 * Step 1 of the New Role wizard — which role this analyst plays, the industry it works in, and the
 * utilities that industry has in the connected data. Replaces the *Domain* step: the business domain
 * is not asked for any more, it follows from the role (`domainForRole`).
 *
 * The utilities are *found*, not typed: choosing an industry starts a short, paced scan of the
 * connected data and the reader keeps or drops what it turned up. An industry the data does not
 * carry says so, with the fix, rather than offering an empty list.
 */
export default function RoleStep({
  draft,
  name,
  onName,
}: {
  draft: RoleDraft
  name: string
  onName: (value: string) => void
}) {
  const { role, industry, scan, utilities } = draft
  const scanned = industry ? UTILITIES[industry] : null

  return (
    <div>
      <div className="ng-field">
        <span className="ng-label">Role</span>
        <div className="nr-pick">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`nr-opt${role?.id === r.id ? ' is-on' : ''}`}
              onClick={() => draft.pickRole(r.id)}
              aria-pressed={role?.id === r.id}
            >
              <b>{r.name}</b>
              <span>{r.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      {role ? (
        <div className="ng-field">
          <span className="ng-label">Industry</span>
          <div className="nr-inds">
            {INDUSTRIES.map((i) => (
              <button
                key={i.id}
                type="button"
                className={`nr-ind${industry === i.id ? ' is-on' : ''}`}
                onClick={() => draft.pickIndustry(i.id)}
                aria-pressed={industry === i.id}
              >
                <b>{i.name}</b>
                <span>{i.note}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {scanned ? (
        <div className="ng-field">
          <span className="ng-label">Utilities this role covers</span>
          <div className="nr-disc">
            <div className="nr-disc-head">
              {scan.done ? <CheckCircleFilled className="nr-ok" /> : <Spin size="small" />}
              <span>
                {scan.done
                  ? 'Read from your connected data'
                  : `Finding the ${industryName(industry).toLowerCase()} utilities in your connected data`}
              </span>
            </div>
            <ol className="nr-disc-steps">
              {scanned.steps.slice(0, scan.shown).map((s) => (
                <li key={s}>
                  <CheckCircleFilled /> {s}
                </li>
              ))}
            </ol>
            {scan.done ? (
              scanned.found.length > 0 ? (
                <div className="nr-utils">
                  {scanned.found.map((u) => (
                    <label key={u.code} className={`nr-util${utilities.includes(u.code) ? ' is-on' : ''}`}>
                      <Checkbox
                        checked={utilities.includes(u.code)}
                        onChange={(e) => draft.toggleUtility(u.code, e.target.checked)}
                      />
                      <span className="nr-util-body">
                        <b>{u.name}</b>
                        <span>
                          {u.region} · {u.commission}
                        </span>
                        <span className="nr-util-n">
                          {u.projects.toLocaleString('en-US')} projects · ${u.approvedB.toFixed(2)}B approved
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="nr-none">{scanned.none}</div>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      {scan.done && utilities.length > 0 ? (
        <>
          <div className="ng-field">
            <label className="ng-label" htmlFor="nr-reports">
              Reports to
            </label>
            <Input
              id="nr-reports"
              type="email"
              value={draft.reportsTo}
              onChange={(e) => draft.setReportsTo(e.target.value)}
              placeholder="name@company.com"
              style={{ maxWidth: 360 }}
            />
            <span className="ng-help">The person this role reports its work to. Any email address.</span>
          </div>
          <div className="ng-field">
            <label className="ng-label" htmlFor="ng-name">
              Role name
            </label>
            <Input id="ng-name" value={name} onChange={(e) => onName(e.target.value)} style={{ maxWidth: 520 }} />
          </div>
        </>
      ) : null}
    </div>
  )
}
