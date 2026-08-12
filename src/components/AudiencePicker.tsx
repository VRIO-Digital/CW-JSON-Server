import { Checkbox } from 'antd'
import type { AuthRole } from '../api/client'
import '../pages/ReportsPage.css'

/*
 * Who may see a saved report.
 *
 * Its own component rather than a block inside `SavedReportCard`, for the same reason
 * `ConnectSourceWizard` is separate from its modal: it renders behind a `useState`, and a
 * `renderToString` of the card gives the card its initial state — closed — so every assertion
 * about the checkboxes would pass over a panel that was never drawn.
 *
 * **The audience is a demo control, and this says so where it is set.** The signed-in role is
 * client-held and the login authenticates by shape, so ticking a box narrows what the section
 * *shows* a reader with that role. It is not access control: anything asking the API directly
 * still gets every row, and the panel prints that sentence rather than implying a permission the
 * mock cannot keep. The roles are the tenant's own, from `auth_roles`.
 */
export default function AudiencePicker({
  roles,
  chosen,
  onChange,
  busy,
}: {
  /** Every role this tenant has. */
  roles: AuthRole[]
  /** The role ids that may view it now. */
  chosen: string[]
  /** Called with the full set, never a delta — the API takes the whole audience. */
  onChange: (roleIds: string[]) => void
  busy?: boolean
}) {
  const everyRole = roles.length > 0 && chosen.length === roles.length

  return (
    <div className="rp-audience">
      <div className="rp-picker-q">Who can view this report</div>

      {/*
       * All roles, as a checkbox rather than a button — it is the same kind of choice as the
       * five below it, and a button beside checkboxes reads as a different kind of act. It shows
       * **indeterminate** while some are ticked, which is the only honest third state: `checked`
       * would claim every role can view it and `unchecked` would claim none can, and a partial
       * selection is neither.
       */}
      <label className="rp-audience-role rp-audience-all">
        <Checkbox
          checked={everyRole}
          indeterminate={chosen.length > 0 && !everyRole}
          disabled={busy}
          onChange={(e) => onChange(e.target.checked ? roles.map((r) => r.roleId) : [])}
        />
        <span>
          <b>All roles</b>
          <span className="rp-dim"> every role this tenant has — {roles.length} of them</span>
        </span>
      </label>

      <div className="rp-audience-roles">
        {roles.map((role) => (
          <label key={role.roleId} className="rp-audience-role">
            <Checkbox
              checked={chosen.includes(role.roleId)}
              disabled={busy}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...chosen, role.roleId]
                    : chosen.filter((id) => id !== role.roleId),
                )
              }
            />
            <span>
              <b>{role.label}</b>
              {/* What the role may see, in the tenant's own words. It was collected on the login
                  and rendered nowhere until now. */}
              <span className="rp-dim"> {role.accessNote}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="rp-audience-foot">
        <span className="rp-dim">
          A demo control: the section shows a reader only the reports their role is named on. It
          is not access control — the API serves any caller that asks, and the role comes from the
          browser.
        </span>
      </div>
    </div>
  )
}
