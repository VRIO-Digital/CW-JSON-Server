import { Alert, Button, Card, Flex, Segmented, Switch, Table, Typography } from 'antd'
import type { SettingsPersona } from '../api/client'
import { NAV_ITEMS, type NavItem, type NavKey } from '../nav'
import StatusTag from './StatusTag'
import { SP } from '../theme'
import './PersonaPermissionsPanel.css'

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
      <Typography.Paragraph type="secondary" style={{ maxWidth: 720, fontSize: 13.5 }}>
        Pick a persona, then switch navigation access on or off. The sidebar updates as you switch — the
        persona chosen here is the one it shows. Every change is <b>saved</b> to the settings store and
        survives a restart; <b>Reset to defaults</b> puts one persona back to how it was authored.
      </Typography.Paragraph>

      {/*
        * The honesty this section owes, in the words every other permission surface here uses. It is
        * the same rule as a report's audience: the persona is held by the browser, and hiding an entry
        * is not authorising anything.
        */}
      <Alert
        type="info"
        showIcon
        title="This controls what is shown, not what is permitted."
        description="Turning an item off removes it from the sidebar. Its page still answers at its own URL, exactly as the routed-but-unlisted pages do — this is a navigation preference, not access control."
        style={{ marginBottom: SP.base }}
      />

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
        title="Persona"
        extra={
          persona ? (
            <Button size="small" onClick={onReset}>
              Reset to defaults
            </Button>
          ) : null
        }
        style={{ padding: SP.base, marginBottom: SP.base }}
      >
        {personas.length === 0 ? (
          <Typography.Text type="secondary">No personas loaded.</Typography.Text>
        ) : (
          <>
            {/* Four long labels do not fit a phone, so the control scrolls inside its own box
                rather than widening the page. */}
            <div className="persona-picker">
              <Segmented
                value={activePersonaId ?? undefined}
                onChange={(value) => onPickPersona(String(value))}
                options={personas.map((p) => ({ value: p.roleId, label: p.label }))}
              />
            </div>

            {/* What the persona may see of the data, served beside its name — the pool carries it,
                so this states it rather than describing personas in its own words. */}
            {persona ? (
              <Typography.Paragraph
                type="secondary"
                style={{ margin: `${SP.sm}px 0 0`, fontSize: 12.5 }}
              >
                {persona.accessNote}
              </Typography.Paragraph>
            ) : null}
          </>
        )}
      </Card>

      {persona ? (
        <Card
          title={`Navigation access — ${persona.label}`}
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              {hiddenCount === 0
                ? 'every item visible'
                : `${hiddenCount} of ${rows.length} hidden`}
            </Typography.Text>
          }
          style={{ padding: SP.base }}
        >
          {/*
            * Said where it can be acted on: a persona with Settings off has no sidebar entry back
            * here. The page is still reachable, and saying so is what keeps the toggle usable rather
            * than a trap. Platform Admin cannot reach this state at all — its Settings row is locked.
            */}
          {settingsHidden ? (
            <Alert
              type="warning"
              showIcon
              title="Settings is hidden for this persona"
              description="It has left the sidebar, so switch it back on here — or reach this page at /settings, which answers whatever the sidebar shows."
              style={{ marginBottom: SP.base }}
            />
          ) : null}

          <Table<PermissionRow>
            dataSource={rows}
            rowKey={(row) => row.item.key}
            pagination={false}
            size="middle"
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
                      <Typography.Text strong>{item.label}</Typography.Text>
                    </Flex>
                  )
                },
              },
              {
                title: 'Access',
                key: 'toggle',
                width: 120,
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
                title: 'Permission status',
                key: 'status',
                width: 210,
                render: (_, { on, locked }) =>
                  locked ? (
                    /* Neither good news nor bad — a guarantee. Stated as one, with the reason. */
                    <StatusTag tone="neutral">On — read only</StatusTag>
                  ) : on ? (
                    <StatusTag tone="good">On — configurable</StatusTag>
                  ) : (
                    <StatusTag tone="warn">Off — configurable</StatusTag>
                  ),
              },
            ]}
          />

          <Typography.Paragraph
            type="secondary"
            style={{ margin: `${SP.base}px 0 0`, fontSize: 12.5 }}
          >
            Settings stays on for Platform Admin and its switch is fixed, because it is the one page
            from which the rest can be switched back on. Every other row, on every persona, is an
            ordinary toggle.
          </Typography.Paragraph>
        </Card>
      ) : null}
    </>
  )
}
