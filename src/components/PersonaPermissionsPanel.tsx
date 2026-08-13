import { Alert, Button, Card, Flex, Segmented, Switch, Table, Tag, Typography } from 'antd'
import type { SettingsPersona } from '../api/client'
import { NAV_ITEMS, type NavItem, type NavKey } from '../nav'
import { SP } from '../theme'

/**
 * The Persona Configuration tab: pick a persona, see every navigation item, switch access on or off.
 *
 * **Pure, like `UsersPanel`** — the persona, the permissions and the handlers all arrive as props, so
 * every row and every disabled switch is assertable under `renderToString`.
 *
 * **The only rule with a lock is Settings on Platform Admin.** Every other row on every persona is an
 * ordinary toggle. A row's switch is disabled from the persona's **served** `readOnly` list — the same
 * list the server enforces with, so the control and the rule cannot disagree, and the rule holds even if
 * a click reaches the API some other way.
 */
export interface PermissionRow {
  item: NavItem
  on: boolean
  locked: boolean
}

export default function PersonaPermissionsPanel({
  personas,
  rolesError,
  activePersonaId,
  permissions,
  onPickPersona,
  onToggle,
  onReset,
}: {
  personas: SettingsPersona[]
  rolesError?: string | null
  activePersonaId: string | null
  permissions: Record<string, boolean>
  onPickPersona: (roleId: string) => void
  onToggle: (key: NavKey, next: boolean) => void
  onReset: () => void
}) {
  const persona = personas.find((p) => p.roleId === activePersonaId) ?? null

  const rows: PermissionRow[] = NAV_ITEMS.map((item) => ({
    item,
    /* Absent means on: a persona the config never named should be visible, not invisible. */
    on: permissions[item.key] !== false,
    locked: persona ? persona.readOnly.includes(item.key) : false,
  }))

  const hiddenCount = rows.filter((r) => !r.on).length
  const settingsHidden = rows.some((r) => r.item.key === 'settings' && !r.on)

  return (
    <>
      {/*
        * The standing caveat, in the words this section owes — and **not** an `Alert`. `colorInfo` is the
        * brand orange, so an info Alert renders warm and reads as a warning about something, which is
        * wrong for a sentence that is always true. A quiet rule says "read me once" instead, and leaves
        * amber for the one thing here that really is a warning.
        */}
      <div className="settings-note">
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          <b>This controls what is shown, not what is permitted.</b> Turning an item off removes it from
          the sidebar; its page still answers at its own URL. Changes are saved and survive a restart.
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

            {/* What the persona may see of the data, served beside its name — the pool carries it, so
                this states it rather than describing personas in its own words. */}
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
          title="Navigation access"
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              {hiddenCount === 0
                ? 'every item visible'
                : `${hiddenCount} of ${rows.length} hidden`}
            </Typography.Text>
          }
        >
          {/*
            * Said where it can be acted on, and this one *is* a warning: a persona with Settings off has
            * no sidebar entry back here. The page is still reachable, and saying so is what keeps the
            * toggle usable rather than a trap. Platform Admin cannot reach this state — its row is fixed.
            */}
          {settingsHidden ? (
            <Alert
              type="warning"
              showIcon
              title="Settings is hidden for this persona"
              description="It has left the sidebar, so switch it back on here — or reach this page at /settings, which answers whatever the sidebar shows."
              className="settings-alert"
            />
          ) : null}

          <Table<PermissionRow>
            dataSource={rows}
            rowKey={(row) => row.item.key}
            pagination={false}
            /* Nine rows at the default height ran past a screen; dense fits the whole set at once, which
               is what makes a permission set readable as a set. */
            size="small"
            scroll={{ x: 'max-content' }}
            columns={[
              {
                title: 'Navigation item',
                key: 'item',
                render: (_, { item }) => {
                  const Icon = item.icon
                  return (
                    <Flex align="center" gap={SP.sm}>
                      <Icon />
                      <Typography.Text>{item.label}</Typography.Text>
                    </Flex>
                  )
                },
              },
              {
                title: 'Access',
                key: 'toggle',
                width: 96,
                align: 'right',
                render: (_, { item, on, locked }) => (
                  <Switch
                    checked={on}
                    disabled={locked}
                    onChange={(next) => onToggle(item.key, next)}
                    aria-label={`${item.label} navigation access`}
                  />
                ),
              },
              {
                /*
                 * "Status", not "Permission status" — and the values are `On` / `Off` rather than
                 * "On — configurable" nine times over. Repeating the same word down every row is noise
                 * that made the column look like a wall; that every other row *is* configurable is said
                 * once, below, and shown by the switch being enabled.
                 */
                title: 'Status',
                key: 'status',
                width: 130,
                align: 'right',
                render: (_, { on, locked }) => (
                  /*
                   * **Plain text, not nine coloured pills.** The switch beside it is already the colour
                   * signal — orange on, grey off — so a tag repeating that in green was a second signal
                   * for the same fact, and stacked nine deep it was the loudest thing on the page. The
                   * one thing the switch cannot say is that a row *cannot change*, so that row, and only
                   * that row, carries a chip.
                   */
                  <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                    {on ? 'On' : 'Off'}
                    {locked ? <Tag style={{ marginInlineStart: SP.sm }}>Fixed</Tag> : null}
                  </Typography.Text>
                ),
              },
            ]}
          />

          <Typography.Paragraph type="secondary" className="settings-foot" style={{ fontSize: 12.5 }}>
            Every row is configurable except <b>Settings</b> on <b>Platform Admin</b>, which stays on and
            fixed — it is the one page from which the rest can be switched back on.
          </Typography.Paragraph>
        </Card>
      ) : null}
    </>
  )
}
