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
   * Three, and the two non-human ones are **different facts about where a suggestion came from**.
   *
   * `human` is somebody's declaration. `derived` is this server's own reading of the profiled
   * columns — two tables sharing an identifier. `recorded` is a suggestion written into this
   * dataset's document, carrying the relationship's own name, the alternatives somebody weighed and
   * their reasoning.
   *
   * **`derived` is labelled *Curated by AI*, and that is a product decision rather than a
   * description of the mechanism.** Renamed on request. What actually produces one of these is a
   * column-name scan in `dataModelSuggestions` — no model runs, and the payload's `degraded` stays
   * `true` for that reason, so the server has not been made to agree with the label. Worth knowing
   * before reading a rationale as a model's reasoning: the figures in one are the profiler's.
   *
   * **The relabel stops here and must not spread to `recorded`.** That kind is somebody's authored
   * row, carrying a name, weighed alternatives and a paragraph of reasoning — it has an AI
   * suggester's shape, which is exactly why calling it one would be the tempting mistake, and the
   * one the `evidence_kind` is `recorded` rather than `llm` to prevent.
   */
  kind: 'human' | 'derived' | 'recorded'
  /** The long form for a card or a legend; the short one for an inline field label. */
  full?: boolean
}

const PROVENANCE_WORDS: Record<
  ProvenanceBadgeProps['kind'],
  { short: string; long: string }
> = {
  human: { short: 'You', long: 'Confirmed by you' },
  derived: { short: 'Curated by AI', long: 'Curated by AI' },
  recorded: { short: 'Recorded', long: 'Recorded in this dataset' },
}

export function ProvenanceBadge({ kind, full }: ProvenanceBadgeProps) {
  const isHuman = kind === 'human'
  const words = PROVENANCE_WORDS[kind]
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
      {full ? words.long : words.short}
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
