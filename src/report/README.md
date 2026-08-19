# CAPEX reports — React port

The report layer of the Context Weave prototype, as a Vite + React app reading a
single `db.json`.

```
npm install
npm run dev      # http://localhost:5173
npm run smoke    # render + fidelity checks (78 checks)
npm run build
```

## What this is

`R1_variance_report.html`, `R2_project_360.html` and `R3_rate_case_filing_calendar.html`
are one 2.5 MB file — the whole prototype — repeated three times with a different
`REPORT_ID` on one line and ninety lines appended to sign in and hide the app
chrome. This is that file's report layer, extracted: one renderer, one route, three
reports.

That worked because of a property worth keeping: **dispatch is on block type and no
renderer looks at the report id.** A fourth report added to `db.json` gets a page
without a line of code changing.

## Routes

| Route              | Page                                                       |
| ------------------ | ---------------------------------------------------------- |
| `/`                | The library — the three published reports, the two drafts, the one removed report |
| `/reports/:slug`   | One report: `variance-report`, `project-360`, `placed-in-service-calendar` |

## db.json

`src/data/db.json` (1.5 MB) is assembled from the three fixture files the demo
package shipped with:

| Source                 | Becomes                                                  |
| ---------------------- | -------------------------------------------------------- |
| `report_data.json`     | `tenant`, `personas`, `people`, `sources`, `datasets`, `measures`, `projects`, `contracts`, … |
| `report_specs.json`    | `reports`, `reportDrafts`, `removedReports`, `blockTypes` |
| `report_resolved.json` | `resolved` — the resolver's output per report id          |

Read through `src/lib/db.js`. Static import, no server.

**Nothing in this app computes a figure.** `resolved` is the product's own resolver
output, copied verbatim, and every number on screen comes from a served `display` or
`exact` string. Geometry is derived from `raw` — a bar's width is not a number a
reader reads — but no currency, sign or scale is formatted anywhere in `src/`. A
second implementation of the aggregation rules agrees with the first only until one
of them is edited.

## Layout

```
src/
  data/db.json                    the fixture store
  lib/db.js                       selectors over it
  lib/format.js                   dates, bands, signs — no number formatting
  state/ReportState.jsx           lineage drawer, toasts, modals, popover
  styles/prototype.css            the prototype's stylesheet, copied unchanged
  styles/app.css                  the ~30 lines the React shell needs
  components/
    Shell.jsx                     sidebar, topbar, theme
    Primitives.jsx                ProvMark, Masked, Note, NeedsResolver, Modal, Toasts
    blocks/                       19 block renderers + the dispatcher
    report/                       FilterBar, TrustBar, ReportView, LineageDrawer,
                                  LineageGraph, SpecModal, ExportModal
  pages/                          LibraryPage, ReportPage
scripts/smoke.jsx                 the render + fidelity check
```

### Block renderers

`figRow` `chain` `bar` `heatmap` `bubble` `varianceRows` `reasonMix` `narrative`
`header` `progressSplit` `schedule` `vendors` `lineItems` `annotations` `calendar`
`filingCalendar` `ask` `table` `pivot`

`table`/`pivot` are not on any of the three pages. They are live types in the spec
vocabulary, and a report that added one should draw it rather than fall through to
"unsupported" — a silently dropped block is a wrong report that looks right.

## What needs the resolver, and says so

This build ships **one resolved run per report**. Four things in the product reach
past that, and each states what it would take instead of failing quietly or
pretending it worked:

- **Refresh** — re-runs the spec against the sources and moves the as-of.
- **Filter selections and view types** — re-aggregate the served rows, or re-resolve
  when the param is a coordinate. The menus still open and still show the served
  domains with their per-value row counts, because that is information a reader
  wants before spending a click.
- **Export** — the pre-flight is entirely real (formats, row counts, masked-figure
  count, and the server's own watermark line). Generating the file is not.
- **Ask** — the binding line, the suggested questions and the disabled-with-reason
  state are served and real. Answering needs the supervisor agent.

Annotation write actions are absent for the same reason: the refusals that go with
them (an assignment with no due date is rejected) belong to the annotation service,
and a button that recorded nothing would be the worst kind of stub on a surface
whose promise is that it shows its evidence.

Arriving at `project-360` with a `?project=` other than the one this run resolved
is named on the page rather than ignored — the calendar drills into Project 360 at
one project's coordinate, and showing a different project's figures under the name
that was clicked would be worse than saying so.

## npm run smoke

78 checks. Every block renderer on every real payload; the library; all seven
lineage sections; the graph at three annotation layers × two tiers × a selected
node; both modals. Then the fidelity check: **every `display`/`exact` string in
each payload must appear in the rendered HTML** — 674, 118 and 304 figures
respectively.

That last check exists because of a failure the prototype's own comments describe:
`bVendors` read `b.allowed` and `b.values` after the api had stopped serving either,
so a whole block of the project report rendered as a masking notice for a masking
that was not happening. It rendered, so nothing failed. A build that compiles proves
nothing about that.

Three served figures are deliberately never drawn, listed with their reasons in
`scripts/smoke.jsx` (`chain.steps`, `lineItems…outsidePackages`, and the baseline
line's per-point values). Anything else that goes missing fails.

## One known defect, reproduced rather than fixed

`bar.chartType` in the fixtures uses `column` and `group`; the renderer's vocabulary
is `stacked | grouped | share`. Neither spec value matches, so both charts fall to
stacked — which is what the source HTML draws.

It matters on `rep_proj_360` block `b3b`, captioned "how it moved between
adoptions", whose two series are Working plan and Mid-term plan: two vintages of the
same money, to be compared rather than summed. No wrong number is printed —
`stackTotalCombines` is false, so no column total appears — but the picture reads as
composition when it is a comparison. See the comment in `src/components/blocks/Bar.jsx`;
accepting the two aliases is a one-line change, and it is a behaviour change from
the source.
