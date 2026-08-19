# CAPEX demo -- reports

Northline Water Group. Generated 2026-08-18 from the report layer of `latest_html_prototype/context_weave_prototype_v2.html`.

## What these are

Three published reports, and they are the reports the product ships -- extracted from the prototype rather than written for this package. An earlier draft of this deliverable carried five reports invented here; they were plausible and they were not the reports the development team will build a frontend around, so they have been moved to `/archive/`.

The prototype's report layer holds seven specs. Four are not rendered as pages here: two archived, one pending approval, one blocked at publish validation. They are lifecycle states rather than reports a viewer opens, and a library of seven where four cannot be opened spends the first minute of a demo explaining statuses instead of answering the question. The specs stay in the prototype; only the pages are scoped to the three.

Each report drops the trailing meta-commentary blocks -- *What was not found*, *Reading this*, *What we have not asked*, *Reading the schedule*, *What this excludes*. Charts, filters, coordinate statements, coverage seams and layout are otherwise unchanged from the prototype. Analytical narrative stays: *Why underspend is not good news* is a finding, and *Notes on this project* is the annotation thread.

A report in Context Weave is a saved, governed, re-executable question. The spec holds no figures. It names which measure, at which coordinate, at which grain, over which filter; the numbers exist only when the resolver runs the spec against the fact set under the viewer's scope predicate. Everything in `report_resolved.json` and in the three HTML pages is the output of the product's own resolver. Nothing was computed by this package, which is the point: a second implementation of the same rules agrees with the first only until one of them is edited.

## The coordinate model

A measure reference without a basis and a period frame does not identify a figure. Three independent axes: basis (commitment, projection, record), period frame (single, full span), and vintage. `active`, `latest` and `working` are reserved selectors and are never vintage members. Every figure on every page carries its coordinate. The prototype also ships a spec (`rep_mixed_coord`) that is blocked at publish validation for adding three measures at three different coordinates; it is not one of the three pages here, but the rule it demonstrates is the reason every figure on these pages states where it sits.

## The reports

### 1. Variance Report

`rep_q_variance` &middot; published &middot; Controls &middot; grain: region × execCategory &middot; v13 &middot; 8 blocks



Blocks: figRow, bar, heatmap, bubble, varianceRows, reasonMix, narrative, ask.

Caveats carried on the report itself: asof -- GL postings sync daily; the approval extract syncs weekly. The as-of shown is the older of the two. Correspondence has no cadence and no as-of of its own — the as-of of the explanation blocks belongs to the read, and re-running the report will move it.; definition -- Variance % is non-additive and is recomputed at the displayed grain. The portfolio figure is not the average of the rows.; extraction -- Every reason on this report is an inference from a document, not a field anybody filled in. The confidence on each row is the extractor's, the binding to a project is the extractor's, and one of the rows below was bound wrongly at a confidence that looked decisive until a person who knew the contract moved it.; coverage -- The corpus is one mailbox class over one month. It is not the whole of what was written, and the projects listed as having no stated reason may have one in a system this connector does not read. The count is honest about what was searched, not about what exists.

### 2. Project 360

`rep_proj_360` &middot; published &middot; Delivery &middot; grain: project &middot; v15 &middot; 11 blocks



Blocks: header, chain, figRow, bar, bar, progressSplit, schedule, vendors, lineItems, annotations, ask.

Caveats carried on the report itself: asof -- Authorised amount resolves from the plan-version chain in the weekly approval extract. It is the oldest contributing source and it sets the as-of for the whole card.

### 3. Rate-Case Filing Calendar

`rep_pis_calendar` &middot; published &middot; Regulatory &middot; grain: month &middot; v7 &middot; 7 blocks



Blocks: figRow, filingCalendar, bar, bubble, header, figRow, calendar.

Caveats carried on the report itself: definition -- Value shown per month is approved budget, not estimate at completion. The regulatory question is what was authorised to enter rate base.; definition -- “In service by” is derived — filing date minus the jurisdiction's certification lead — and appears in no source system. The filing date comes from the commission docket; the lead days are tenant configuration on the calendar entry and are shown with their reason on every row so they can be disputed.; asof -- Filing verdicts read forecast in-service dates from the current plan adoption. A re-forecast at the next cut moves dates and therefore moves verdicts; the at-risk set is a statement about this vintage, not a standing property of the projects.

## Removed

**Why the Plan Moved** (`rep_variance_reasons`). 

## The sample seam

The fixture holds 60 projects against a declared programme of 4,500. The 60 are drawn in proportion to the programme's budget-category mix and represent 1.54% of it. Tables foot to the sample; headline cards foot to the declared programme figures. The two do not reconcile to each other and are not meant to -- a 60-row sample does not sum to $113.1B, and captioning it as though it did is the failure the labelled seam exists to prevent.

Within the 60, two populations are not interchangeable. Five carry contract packs -- packages, contractors, change orders, contingency, document counts. The other 55 have a spreadsheet row and nothing else, so `committed`, `vendors`, `documentCount`, `openPOs` and the rest are null rather than zero. A renderer that finds a null draws a hole; a renderer that finds an invented number draws a number, and nobody downstream can tell which figures were ever real.

## What is absent, and stated as absent

Rate base is not in the dataset and cannot be derived from it. `db.valueChain` names a source for all seven links of the capital value chain -- budget, authorization, commitment, actual, CWIP, capitalized, rate base -- but that entry declares where such a figure *would* come from, not that one exists. In the data, `committed` is non-null only on the five contract-pack projects, and `cwip`, `capitalized` and `rateBase` are null on all sixty. A demo reader who takes the value-chain metadata as a claim that those figures exist will be wrong, and the chain block says so on screen.

Forecast rounds 6+6 and 9+3 are null in `fy26PlanCuts`, not zero. The rounds have not been issued. That is an absence, not a forecast of zero.

## Governance

The workbook's **Scope matrix** sheet carries the entitlement picture: the same three reports through 4 scope classes, 9 of 12 outcomes served. The Platform Admin is refused all three at entitlement -- an admin exception in the presentation layer is how admin backdoors get built. Every refusal carries text written for the viewer, naming which of the two questions failed: whether they are an audience for the report, or which rows their predicate admits.

There is no report *library* screen in this package. It was dropped on August 18 2026: the brief is three published reports, and the library page was a fourth screen drawn by a hand-written renderer rather than by the product's own. Its data file went with it. The cards, the activity events and the annotation set it carried are still in the prototype's fixture if a frontend wants that screen, and both files are in `/archive/`.

## How the three pages are drawn

Each of `R1_variance_report.html`, `R2_project_360.html` and `R3_rate_case_filing_calendar.html` **is** `context_weave_prototype_v2.html`, byte for byte, with ninety lines appended before `</body>` that sign in as the Domain Architect, call `repOpen()` on one report, and hide the app chrome around it. No part of the presentation is re-implemented here. The charts, the sticky filter bar and its per-value row counts, the trust bar, the view-type chips, re-aggregation, the lineage drawer and export are the product's own code running -- which is why each file is 2.5 MB. That is what "exactly the same layout" costs, and it is the right trade for an artifact that is opened rather than deployed.

The earlier version of these pages was a Python re-implementation of the renderer. It got the figures right, because they come from the resolver either way, and the presentation wrong -- it had no filter bar at all. It is kept in `/archive/` as `*_2026-08-18_python_rendered_superseded.html` rather than deleted.

## Blocks dropped from the prototype's layout

On instruction, the trailing meta-commentary sections are not rendered. They are dropped where the view is SERVED rather than where it is painted, so a reader who changes a filter does not see them return; and they are not removed from the spec -- `report_specs.json` still carries them, so a frontend that wants them back has them.

- `rep_q_variance` &middot; What was not found (`discoveryMisses`)
- `rep_q_variance` &middot; Reading this (`narrative`)
- `rep_pis_calendar` &middot; Reading this (`narrative`)
- `rep_pis_calendar` &middot; What we have not asked (`narrative`)
- `rep_pis_calendar` &middot; Reading the schedule (`narrative`)
- `rep_pis_calendar` &middot; What this excludes (`narrative`)

## Files

- `report_specs.json` -- 68,151 bytes
- `report_data.json` -- 499,331 bytes
- `report_resolved.json` -- 946,482 bytes
- `CAPEX_Reports.xlsx` -- 18,465 bytes
- `R1_variance_report.html`, `R2_project_360.html`, `R3_rate_case_filing_calendar.html` -- ~2.5 MB each, written by `_build/build_report_pages.py`
- `report_authoring_simplified_v3.html` + `report_authoring_data.json` -- written by `_build/build_report_authoring_v3.py`

## Regenerating

```
python3 _build/build_reports_v2.py        # specs, resolved data, workbook, this file
python3 _build/build_report_pages.py     # the three pages -- run second
node    _build/verify_report_pages.js    # boots each page in jsdom and checks the DOM
```

The first shells out to `_build/extract_prototype.js`, which loads the prototype's own db and api files and resolves every report. The second carries the prototype into three standalone pages. The third is the only check that can see the filter bar, because the filter bar does not exist until the page runs. Never hand-edit anything in `07_reports/` -- it is all build output, and a hand edit is a figure that no longer traces to a spec.
