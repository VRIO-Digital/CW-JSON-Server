/**
 * The one place the CAPEX demo's money scale is declared, and the formatter that applies it to prose.
 *
 * **Why a shared module rather than a constant in each script.** Two surfaces state the same figures:
 * the three rendered report documents carry them in their own fixture, and `ask_answers` quotes them in
 * recorded answers — Ask's *Actuals YTD (to May)* is, to the cent, the Variance Report's `periodActual`.
 * If the two were scaled by different factors the dataset would give two answers to one question, which
 * is the failure this repo refuses everywhere else. So the factor is declared once and read by
 * `scale-capex-reports.js` and `ingest-queries.js` alike, and `check-docs` asserts neither keeps a copy.
 *
 * **Why 250.** The world these documents ship is a $152B, 4,500-project programme; the demo shows a
 * range topping out at $50M. 250 is what brings the figures a reader actually meets — a fiscal year's
 * working budget, its forecast rounds, actuals to date, a project's own position — inside that range:
 * FY26's working budget lands at $48.1M. What stays above it is the *programme-wide* five-year
 * total ($452M authorized, $609M forecast), which is only ever quoted in answers explicitly about the
 * whole programme, and which no report block prints. Taking those under the line too would mean a factor
 * of 3,046, and at that point a filter-rehabilitation programme costs $19K — a world too small to read
 * as capital works, because the sixty projects in the fixture are 1.54% of the programme and a
 * programme-level ceiling shrinks each of them thirty times further.
 *
 * **One factor, so every ratio survives.** Each variance percentage, that 1.54% sample share, the gap as
 * a share of the programme, "5.3% of the year" — all still exactly true after the division, which a
 * figure-by-figure rescale would have quietly falsified while every individual number looked fine.
 */

/** The divisor. Change it here and re-run both `npm run scale:capex` and `npm run ingest:queries`. */
export const FACTOR = 250

/**
 * The range the demo is meant to show, and what `check-docs` holds the report tiles to.
 *
 * Not a hard ceiling over every figure in the dataset — see the note above on the programme-wide
 * totals — which is why the claim that reads it is scoped to the figures a report actually prints.
 */
export const CEILING = 50_000_000

/**
 * A money run in prose, scaled, keeping the shape the author wrote it in.
 *
 * **The shape matters as much as the value.** These documents write the same figure three ways —
 * `$12.03b` in a summary, `$12,028,661,826` in the paragraph under it, `$-130,939,591` in a table cell —
 * and each is a deliberate choice about how precise that sentence is being. So a suffixed figure comes
 * back suffixed and a comma-grouped one comes back comma-grouped, rather than every figure being
 * rewritten into one house style that would flatten the distinction between a headline and a reconciling
 * number.
 *
 * Returns `null` when the run is not something this can scale, so a caller can refuse rather than write
 * a figure it guessed at.
 */
export function scaleMoneyText(run, factor = FACTOR) {
  const m = /^\$\s?(-?)([\d,]+(?:\.\d+)?)\s?(b|bn|billion|m|million|k|thousand)?$/i.exec(run.trim())
  if (!m) return null
  const [, sign, digits, rawSuffix] = m
  const suffix = (rawSuffix ?? '').toLowerCase()
  const unit = suffix.startsWith('b') ? 1e9 : suffix.startsWith('m') ? 1e6 : suffix.startsWith('k') || suffix.startsWith('t') ? 1e3 : 1
  const value = Number(digits.replace(/,/g, '')) * unit
  if (!Number.isFinite(value)) return null
  const scaled = value / factor

  /* Written with a suffix: keep one, and pick the suffix the scaled figure belongs in. A `$12.03b` that
     becomes forty-eight million has to say `m`, or the sentence reads as a thousand-fold error. */
  if (suffix) {
    const cased = (s) => (rawSuffix === rawSuffix.toUpperCase() ? s.toUpperCase() : s)
    /* `$1.6 million` is spelled out; `$1.6M` is not. Kept only where the scaled figure still lands in
       millions or billions — "$6.4 thousand" is not how anybody writes six thousand four hundred, so a
       spelled figure that falls that far drops through to the comma-grouped form below. */
    const spelled = /illion/.test(suffix)
    const pick = (div, short, long) => {
      const n = Math.abs(scaled) / div
      /* Two significant-ish digits, the way these documents write them. */
      const text = n >= 100 ? String(Math.round(n)) : n >= 10 ? n.toFixed(1) : n.toFixed(2)
      /* Trailing zeros go only *after a decimal point* — an early version turned `$200K` into `$2K`,
         because `0+$` matched the zeros in "200" as happily as the one in "60.0". */
      const trimmed = text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
      return `$${sign}${trimmed}${spelled ? ' ' + long : cased(short)}`
    }
    if (Math.abs(scaled) >= 1e9) return pick(1e9, 'b', 'billion')
    if (Math.abs(scaled) >= 1e6) return pick(1e6, 'm', 'million')
    if (!spelled && Math.abs(scaled) >= 1e3) return pick(1e3, 'k', 'thousand')
  }

  /*
   * Written out in full: stay written out in full, at the grain the original had. Whole dollars in,
   * whole dollars out — the fixture's own stated grain, and a cent here would be a precision the source
   * never claimed.
   *
   * A figure that *arrived* suffixed and fell this far keeps no decimals at all: `$1.6 million`'s one
   * decimal place is a statement about millions, and carrying it down to `$6,400.0` claims a tenth of a
   * dollar nobody wrote.
   */
  const decimals = suffix ? 0 : (digits.split('.')[1] ?? '').length
  const rounded = decimals > 0 ? Number(scaled.toFixed(decimals)) : Math.round(scaled)
  return `$${sign}${rounded.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}
