/* ==========================================================================
   Presentation arithmetic only.

   THE RULE THE PROTOTYPE'S RENDERERS FOLLOW, KEPT HERE: geometry may be
   computed, characters may not. A bar's width is not a number a reader reads,
   so deriving it from `raw` is fine. Turning 4996377632 into "$5.00B" is a
   formatting decision that belongs to the resolver, and every string these
   components print comes from a served `display` or `exact`.

   Which is why there is no currency formatter in this file, and why adding one
   would be the bug rather than the feature.
   ========================================================================== */

/* Freshness, said the way the trust bar and the ask binding line say it. This
   one IS composed in the client in the prototype too — it is a statement about
   when the page is being read, which the resolver cannot know. */
export const fmtWhen = at => {
  if (!at) return '—'
  const d = new Date(at)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  const stamp = d.toISOString().replace('T', ' ').slice(0, 16)
  if (days <= 0) return 'today, ' + stamp.slice(11) + ' UTC'
  if (days === 1) return 'yesterday, ' + stamp.slice(11) + ' UTC'
  return days + ' days ago (' + stamp.slice(0, 10) + ')'
}

/* Timestamps as the block renderers print them: a date, or a date and a clock. */
export const asDate = t => String(t || '').replace('T', ' ').slice(0, 10)
export const asMinute = t => String(t || '').replace('T', ' ').slice(0, 16)
export const asSecond = t => String(t || '').replace('T', ' ').slice(0, 19)

export const plural = (n, one, many) => (n === 1 ? one : (many !== undefined ? many : one + 's'))

/* Confidence bands. Three names, one place. */
export const band = x => (x === 'hi' ? 'hi' : x === 'lo' ? 'lo' : 'md')

/* Sign class for a figure that carries one. The sign is information — a
   variance of +$4M and −$4M are opposite facts — so it is never dropped. */
export const signClass = f => {
  const raw = f && f.raw
  if (typeof raw !== 'number') return ''
  return raw > 0 ? ' up' : raw < 0 ? ' dn' : ''
}
export const signCell = c => {
  if (!c || !c.signed || c.raw == null) return ''
  return c.raw > 0 ? ' neg' : c.raw < 0 ? ' pos' : ''
}

export const gTrim = (s, n) => (!s ? '' : (s.length > n ? s.slice(0, n - 1) + '…' : s))

/* The full join is `PO_LINE.PROJECT_REF ↔ PROJECT_DIM.PROJ_ID`, which does not
   fit between two columns at a size anyone can read. The table names are
   already on the two boxes the arrow connects, so the arrow needs only the
   columns — and the operator is kept, because `=` and `↔` are the difference
   between a key and a match. */
export const gJoinShort = j => {
  if (!j) return ''
  const op = j.indexOf(' ↔ ') > -1 ? ' ↔ ' : j.indexOf(' = ') > -1 ? ' = ' : null
  if (!op) return gTrim(j, 26)
  const tail = s => (s.indexOf('.') > -1 ? s.slice(s.lastIndexOf('.') + 1) : s)
  const [l, r] = j.split(op)
  return gTrim(tail(l.trim()) + op + tail(r.trim()), 34)
}
