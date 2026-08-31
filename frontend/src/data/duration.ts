/**
 * A duration a person reads, from milliseconds: "5m 10s", "40s", "0.3s".
 *
 * Sub-second keeps a decimal rather than rounding to zero — the pace is the server's to
 * choose, and "each step takes about 0s" would be this function misreporting it rather than
 * the server pacing badly.
 *
 * One copy, because two surfaces print a build's pace now: Graph Studio's Build tab and the
 * wizard's hand-off dialog. A second formatter is a second answer to how long a run takes.
 */
export const dur = (ms: number) => {
  if (ms < 1000) return `${Math.round(ms / 100) / 5}s`
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`
}
