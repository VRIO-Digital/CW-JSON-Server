import React from 'react'
import { BlockFrame, Defect, Unknown } from './BlockFrame.jsx'

import FigRow from './FigRow.jsx'
import Chain from './Chain.jsx'
import Bar from './Bar.jsx'
import Heatmap from './Heatmap.jsx'
import Bubble from './Bubble.jsx'
import VarianceRows from './VarianceRows.jsx'
import ReasonMix from './ReasonMix.jsx'
import Narrative from './Narrative.jsx'
import Header from './Header.jsx'
import ProgressSplit from './ProgressSplit.jsx'
import Schedule from './Schedule.jsx'
import Vendors from './Vendors.jsx'
import LineItems from './LineItems.jsx'
import Annotations from './Annotations.jsx'
import Calendar from './Calendar.jsx'
import FilingCalendar from './FilingCalendar.jsx'
import Ask from './Ask.jsx'
import Table from './Table.jsx'

/* ══════════════════════════════════════════════════════════ BLOCK DISPATCH ══
   DISPATCH IS ON `block.type`. No renderer looks at the report id, and no report
   is special-cased — which is the rule that lets a spec add a block and get it
   drawn, and the reason the three pages in this build share one code path rather
   than being three pages.

   `pivot` shares the table renderer: it is the same payload shape with the rows
   already grouped by the resolver.
   ========================================================================== */
const RENDERERS = {
  figRow: FigRow,
  chain: Chain,
  bar: Bar,
  heatmap: Heatmap,
  bubble: Bubble,
  varianceRows: VarianceRows,
  reasonMix: ReasonMix,
  narrative: Narrative,
  header: Header,
  progressSplit: ProgressSplit,
  schedule: Schedule,
  vendors: Vendors,
  lineItems: LineItems,
  annotations: Annotations,
  calendar: Calendar,
  filingCalendar: FilingCalendar,
  ask: Ask,
  table: Table,
  pivot: Table,
}

export default function Block({ block: b }) {
  /* Listed in the withheld section instead. */
  if (b.withheld) return null

  /* A block the RESOLVER refused is not a block this client cannot draw. It keeps
     its original type, so without this guard it dispatches into a renderer whose
     payload was never produced and throws part-way through the report. */
  if (b.defect) {
    return <BlockFrame block={b}><Defect block={b} /></BlockFrame>
  }

  const R = RENDERERS[b.type]
  return (
    <BlockFrame block={b}>
      {R ? <R block={b} /> : <Unknown block={b} />}
    </BlockFrame>
  )
}

/* THE ASK BLOCK LEADS THE REPORT, WHEREVER THE SPEC PUT IT.

   Reordering here rather than in the fixtures means it holds for every report and
   anything a user assembles later — there is no spec that can forget to do it.
   The block keeps its id and its spec position; only the PAINT order moves, so a
   spec edit that removes "b6" still removes the right block. */
export function orderBlocks(blocks) {
  const bs = blocks || []
  const ask = bs.filter(b => b.type === 'ask')
  return ask.length ? ask.concat(bs.filter(b => b.type !== 'ask')) : bs
}
