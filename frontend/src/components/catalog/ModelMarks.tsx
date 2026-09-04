import { CheckOutlined, ThunderboltFilled } from '@ant-design/icons'
import type { ReactNode } from 'react'
import { MT } from '../../data/dataModelTokens'

/**
 * The Data Modeling tab's two marks, which answer two different questions and must not be merged:
 *
 *  - `ProvenanceBadge` — **who**. A person declared this, or this server derived it from the profile.
 *    Square-ish, 5px radius, sits beside a field's own label or on a row.
 *  - `StatusPill` — **what**. Confirmed, suggested, a gap, or nothing yet. Fully rounded, carries
 *    counts and states.
 *
 * They are separate components rather than one with a `kind`, because collapsing them is exactly the
 * confusion the colour scheme is arranged to prevent: provenance is green/purple, status is
 * green/amber/red, and a single mark would have to pick one meaning for green.
 *
 * The status marks carry **an icon or a word**, never colour alone — the app's rule everywhere else,
 * and it is why `confirmed` gets a tick.
 */

interface ProvenanceBadgeProps {
  /**
   * `human` is somebody's declaration. `derived` is this server's own reading of the profiled
   * columns — deliberately not called "AI": there is no model behind it, the suggestions payload
   * says so with `degraded`, and a badge claiming one would be the only untrue thing on the page.
   */
  kind: 'human' | 'derived'
  /** The long form for a card or a legend; the short one for an inline field label. */
  full?: boolean
}

export function ProvenanceBadge({ kind, full }: ProvenanceBadgeProps) {
  const isHuman = kind === 'human'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        borderRadius: 5,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.02em',
        background: isHuman ? MT.greenSoft : MT.purpleSoft,
        color: isHuman ? MT.green : MT.purple,
        whiteSpace: 'nowrap',
      }}
    >
      {isHuman ? (
        <CheckOutlined style={{ fontSize: 9 }} />
      ) : (
        <ThunderboltFilled style={{ fontSize: 9 }} />
      )}
      {isHuman
        ? full
          ? 'Confirmed by you'
          : 'You'
        : full
          ? 'Derived from the schema'
          : 'Derived'}
    </span>
  )
}

export type PillVariant = 'confirmed' | 'suggested' | 'gap' | 'mut'

interface StatusPillProps {
  variant: PillVariant
  children: ReactNode
  /** A confirmed pill carries a tick; the other three are text-only. */
  icon?: boolean
}

export function StatusPill({ variant, children, icon }: StatusPillProps) {
  const styles: Record<PillVariant, { bg: string; fg: string }> = {
    confirmed: { bg: MT.greenSoft, fg: MT.green },
    suggested: { bg: MT.amberSoft, fg: MT.amber },
    gap: { bg: MT.redSoft, fg: MT.red },
    mut: { bg: MT.card2, fg: MT.dim },
  }
  const s = styles[variant]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2.5px 8px',
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.02em',
        background: s.bg,
        color: s.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {icon && variant === 'confirmed' ? <CheckOutlined style={{ fontSize: 10 }} /> : null}
      {children}
    </span>
  )
}

/** The card/panel frame every column of this tab sits in. */
export function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: MT.card,
        border: `1px solid ${MT.line}`,
        borderRadius: MT.rL,
        overflow: 'hidden',
        height: '100%',
      }}
    >
      {children}
    </div>
  )
}
