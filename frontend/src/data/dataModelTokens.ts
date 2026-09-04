/**
 * The Data Modeling tab's own visual constants.
 *
 * **This is the one surface in the app that states its colours and its px directly**, and it is
 * deliberate rather than an oversight: the tab was ported from a reference build whose fidelity —
 * exact hexes, half-pixel type sizes, a 168px node card — *is* the spec, and expressing a 10.5px
 * label or a 1.5px selected border on the `--sp-*` scale would mean redrawing somebody else's
 * design rather than reproducing it. The same reasoning that exempts the two vendored stylesheets,
 * applied to a surface that carries its styles inline instead.
 *
 * `check-docs` reads the `--sp-*` rule off stylesheets, so nothing here can drift into one: the tab
 * has no `.css` file at all. Everything else in the app keeps `src/theme.ts` untouched.
 *
 * **Two colour dimensions the reference keeps apart — do not collapse them:**
 *  - STATUS (what): confirmed = green, suggested/pending = amber, gap = red.
 *  - PROVENANCE (who): a human = green, a machine = **purple**. Purple rather than the app's usual
 *    gold, because on this surface a suggestion's provenance sits next to a *status* chip and two
 *    amber marks side by side would read as one fact.
 *
 * The orange is the brand's (`theme.ts`'s `colorPrimary`), so a selected card here and a selected
 * menu item elsewhere are the same colour.
 */

export const MT = {
  card: '#ffffff',
  card2: '#f7f7f8',
  inset: '#f7f7f8',
  line: '#e2e2e4',
  line2: '#d1d1d4',
  text: '#1b1e22',
  mut: '#5c636b',
  dim: '#9aa0a8',

  orange: '#f2691d',
  orangeHi: '#ff7d33',
  orangeSoft: 'rgba(242,105,29,.09)',
  orangeLine: 'rgba(242,105,29,.30)',

  green: '#0d9f6e',
  greenSoft: 'rgba(16,150,110,.10)',

  amber: '#b47d0a',
  amberSoft: 'rgba(180,120,10,.12)',

  red: '#dc4444',
  redSoft: 'rgba(220,60,60,.09)',

  purple: '#7c3aed',
  purpleSoft: 'rgba(124,58,237,.08)',

  shadow: '0 8px 28px rgba(20,25,35,.10)',

  rS: 7,
  rM: 11,
  rL: 16,

  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
} as const
