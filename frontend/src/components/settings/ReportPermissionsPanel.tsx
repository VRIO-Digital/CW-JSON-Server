import { Alert, Button, Card, Segmented, Switch, Table, Typography } from 'antd'
import type { SettingsPersona } from '../../api/client'
import { SP } from '../../theme'

/**
 * The Report View tab: pick a persona, and choose which of a Library row's three acts it is offered.
 *
 * **Pure, like `UsersPanel` and `PersonaPermissionsPanel`** — the personas, the actions, the live set
 * and the handlers all arrive as props, so every row and every switch is assertable under
 * `renderToString`. A panel behind a parent's `useState` renders closed and every check about its
 * contents passes over nothing.
 *
 * **The action list is the payload's, never this file's.** `GET /settings` serves `report_actions`, the
 * same three `REPORT_ACTIONS` the `PATCH` route validates against — so this cannot offer a column the
 * API refuses, nor omit one the server stores and the Library card reads. The rule the consent screen's
 * scope list established.
 *
 * **What it is not.** Turning an act off removes the *button* from the row. It is the same kind of
 * decision as hiding a sidebar item: recorded, honoured by the UI, and not authorisation. The persona
 * arrives from a browser whose login authenticates by shape, and the API still serves every report to a
 * caller that names no role. This is said on the tab in those words, because a page that lets somebody
 * switch off "delete" and stays quiet about enforcement is implying one runs.
 *
 * **There is no lock here, unlike Navigation access.** Settings is fixed on Platform Admin because a
 * persona that could hide its own way back in would be stranded. Nothing on this tab can strand
 * anybody: a persona that loses `edit` still reaches this page and can hand it back. A fixed row nobody
 * could explain is worse than none.
 */
export interface ReportActionRow {
  action: string
  label: string
  detail: string
  on: boolean
}

/**
 * What each act *is*, in the reader's terms rather than the key's.
 *
 * Held here as copy because the server sends the action's **key** and nothing else — an endpoint that
 * also sent the prose would be authoring UI text, and a table printing `open` / `edit` / `delete` as
 * headings describes the storage rather than the acts. An action with no entry still renders, labelled
 * by its own key, because the served list is the authority on which exist: a column vanishing because
 * this map was not updated would hide a permission the server holds.
 */
const ACTION_COPY: Record<string, { label: string; detail: string }> = {
  open: {
    label: 'Open report',
    detail: 'Read the published report — the tenant’s figures, in the format its audience sees.',
  },
  edit: {
    label: 'Edit report',
    detail: 'Load the authoring definition behind the row and change what the report asks.',
  },
  delete: {
    label: 'Delete report',
    detail:
      'Remove the row from the governed set. The definition is the package’s, so a re-seed restores it.',
  },
}

export default function ReportPermissionsPanel({
  personas,
  actions,
  rolesError,
  activePersonaId,
  permissions,
  onPickPersona,
  onToggle,
  onReset,
}: {
  personas: SettingsPersona[]
  actions: string[]
  rolesError?: string | null
  activePersonaId: string | null
  permissions: Record<string, boolean>
  onPickPersona: (roleId: string) => void
  onToggle: (action: string, next: boolean) => void
  onReset: () => void
}) {
  const persona = personas.find((p) => p.roleId === activePersonaId) ?? null

  const rows: ReportActionRow[] = actions.map((action) => ({
    action,
    label: ACTION_COPY[action]?.label ?? action,
    detail: ACTION_COPY[action]?.detail ?? '',
    /* Absent means on, exactly as the navigation panel reads it: a persona the config never named
       should be offered the row's actions, not stripped of them. */
    on: permissions[action] !== false,
  }))

  const offCount = rows.filter((r) => !r.on).length
  const cannotOpen = rows.some((r) => r.action === 'open' && !r.on)

  return (
    <>
      {/*
        * The standing caveat, in the words this section owes — and a quiet rule rather than an `Alert`,
        * for the reason the navigation tab's is: `colorInfo` is the brand orange, so an info Alert reads
        * warm and looks like a warning about something, which is wrong for a sentence that is always
        * true. Amber is kept for the one thing below that really is a warning.
        */}
      <div className="settings-note">
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          <b>This controls which buttons a reader is offered, not what they are permitted.</b> The
          persona travels from the browser and the login authenticates by shape, so the API still serves
          every report to a caller that names no role. Changes are saved and survive a restart.
        </Typography.Text>
      </div>

      {rolesError ? (
        <Alert
          type="warning"
          showIcon
          title="Could not load the personas"
          description={`${rolesError} There is nothing to configure until the list loads.`}
          style={{ marginBottom: SP.base }}
        />
      ) : null}

      <Card
        className="settings-card"
        title="Persona"
        extra={
          persona ? (
            <Button size="small" onClick={onReset}>
              Reset to defaults
            </Button>
          ) : null
        }
      >
        {personas.length === 0 ? (
          <Typography.Text type="secondary">No personas loaded.</Typography.Text>
        ) : (
          <>
            <div className="persona-picker">
              <Segmented
                value={activePersonaId ?? undefined}
                onChange={(value) => onPickPersona(String(value))}
                options={personas.map((p) => ({ value: p.roleId, label: p.label }))}
              />
            </div>

            {/* The persona's own data scope, served beside its name. Stated rather than paraphrased,
                and it is the reason the authoring acts start where they do: a persona that cannot see
                the figures has no business defining what a report asserts about them. */}
            {persona ? (
              <Typography.Paragraph type="secondary" className="persona-note" style={{ fontSize: 12.5 }}>
                {persona.accessNote}
              </Typography.Paragraph>
            ) : null}
          </>
        )}
      </Card>

      {persona ? (
        <Card
          className="settings-card settings-table"
          title="Report access"
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              {offCount === 0 ? 'every action offered' : `${offCount} of ${rows.length} withheld`}
            </Typography.Text>
          }
        >
          {/*
            * Said where it can be acted on, and this one really is a warning: with Open off, every row
            * in the Library loses its way into a report, so the section reads as a list of cards that do
            * nothing. That is a legitimate configuration — it is what "this persona does not read
            * reports" looks like — so it is stated rather than prevented, the same way a hidden Settings
            * item is.
            */}
          {cannotOpen ? (
            <Alert
              type="warning"
              showIcon
              title="This persona cannot open a report"
              description="Every governed row will still be listed, with no way into the report itself. Consider hiding the Reports item for this persona on the Persona Configuration tab instead."
              className="settings-alert"
            />
          ) : null}

          <Table<ReportActionRow>
            dataSource={rows}
            rowKey={(row) => row.action}
            pagination={false}
            size="small"
            scroll={{ x: 'max-content' }}
            columns={[
              {
                title: 'Action',
                key: 'action',
                render: (_, { label, detail }) => (
                  <div>
                    <Typography.Text>{label}</Typography.Text>
                    {detail ? (
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {detail}
                        </Typography.Text>
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: 'Offered',
                key: 'toggle',
                width: 96,
                align: 'right',
                render: (_, { action, label, on }) => (
                  <Switch
                    checked={on}
                    onChange={(next) => onToggle(action, next)}
                    aria-label={`${label} access`}
                  />
                ),
              },
            ]}
          />
        </Card>
      ) : null}
    </>
  )
}
