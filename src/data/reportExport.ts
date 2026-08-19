/**
 * What the report's export control promises, as copy rather than markup.
 *
 * **A `Tooltip` portals out of `renderToString`**, exactly as a `Modal` and a `Popconfirm` do, so a
 * sentence written inline in `PublishedReportPane` cannot be asserted on — a check for it would pass
 * over nothing while the component rendered whatever it liked. Held here it can be called directly by a
 * test, which is why `sourceActions.ts` and `connectSteps.ts` exist in this folder.
 *
 * **The sentence is load-bearing, not decoration.** A button labelled *Export PDF* that opens a print
 * dialog is a surprise, and the reader has to be told two things before they click: that the browser is
 * doing the rendering, and that what comes out is the report rather than the application around it. The
 * second is a real promise — `PublishedReportPane.css` keeps it with `@media print` rules — so it must
 * not be worded as a guess.
 *
 * **And nothing here names a file.** The reader chooses the destination in their own print dialog, so
 * promising a filename would be a claim about something this app does not control.
 */
export const REPORT_EXPORT_HINT =
  'Opens your browser’s print dialog — choose “Save as PDF”. Only the report prints, not the app around it.'

/**
 * Why there is no server-side PDF, in the words the repo has already settled on.
 *
 * Not currently rendered anywhere: it is here so the reason travels with the control rather than living
 * only in CLAUDE.md, and so a future "add a real PDF endpoint" reads this first. Server-side PDF means a
 * headless browser — some forty transitive packages and a Chromium download — through an audit gate that
 * fails on any advisory at `low`. `POST /reports/export` renders HTML and CSV instead, and the HTML
 * carries the same print stylesheet, so *Print → Save as PDF* produces the same document either way.
 */
export const REPORT_PDF_RATIONALE =
  'PDF is produced by the browser rather than the server: a server-side renderer means a headless ' +
  'browser and some forty transitive packages, through a gate that fails on any advisory at low.'
