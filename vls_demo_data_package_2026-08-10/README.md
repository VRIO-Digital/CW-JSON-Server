# VLS Demo Data Package — Deer Park (VLS Texas Molecular)

Built 2026-08-10. This folder is the **use-case content package** for the VLS Environmental
Solutions demo. NS authors it in **business formats — Excel, Word, and (for the graph) JSON** — and
ships it to the development team, who convert it into the JSON that drives the shared React frontend
behind the HTML prototype. This package is **content only** — not design, not development, and it does
not touch the component specs or the dev repo.

## What the demo is

A **fully simulated** run of Context Weave for **VLS-as-operator**: cradle-to-grave compliance and
liability intelligence for VLS's own Deer Park facility (VLS Texas Molecular, formerly Texas
Molecular). Scope is Deer Park only.

The Source Connector *simulates* a BigQuery connection. The Metadata Profiler shows **columns and
schema**, not live query results. Every value in this package is **cooked** — schema-faithful and
internally consistent, never pulled live from EPA. Where entities are named, the **names are real**
(real EPA facilities, generators, transporters); the **values are synthetic** (volumes, violations,
penalties, dates, counts).

## The simulated source

- **Project / dataset (placeholder):** `vrio-contextweave-demo.epa_hazwaste`
  — *Open item: confirm the real BigQuery project/dataset name with NS. Swap in one place.*
- **Five Gold views** (NS's demo-facing names), 206 columns total:
  - `e_manifest` (50) — cradle-to-grave shipment manifests
  - `e_manifest_all` (92) — manifests enriched with generator/receiver/transporter profiles (the graph-in-a-table)
  - `RCRA_compliance` (30) — evaluation / violation / enforcement line items
  - `RCRA_Compliance_Summary` (9) — one compliance-360 row per facility
  - `FRS_Facility_profile` (25) — facility identity + RCRA/FRS attributes

## Folder layout — numbered in demo pipeline order

Walk the folders top to bottom; they follow the exact order the UI surfaces them.

| Folder | Screen it feeds | Deliverable |
|---|---|---|
| `01_source_connector/` | Source Connector → BigQuery (simulated) | `Demo_Source_and_Data_Overview.docx` — connection profile, table catalog, simulated OAuth handshake, document list |
| `02_profiling/` | Metadata Profiler ("View Profile Columns") | `Metadata_Profiling.xlsx` — Overview sheet + one sheet per view; all 206 columns with description, semantic class, confidence, PII, null %, distinct |
| `03_use_case_wizard/` | Use Case Wizard | `Use_Case_Wizard.docx` — business domain, use case, **13 hero questions**, KPIs, personas |
| `04_structured_data/` | Data behind the graph, traces & reports | `VLS_Structured_Data.xlsx` — Entity Roster sheet (canonical numbers) + all 5 tables, schema-faithful |
| `05_knowledge_graph/` | Knowledge Graph view | `knowledge_graph.json` — nodes/edges from columns, rows, and extracted document entities + Texas Molecular entity resolution; `Knowledge_Graph_Overview.docx` narrative |
| `06_queries/` | Ask / Query | `query_set.json` — **40 queries with rich, frontier-model-style responses** (text + metric + chart + table blocks), evidence, confidence chips, graph refs, and 5 decline cases; `VLS_Query_Set_Index.xlsx` — a flat human-readable index of the same 40 |
| `07_reports/` | Reports | **5 report HTML files** (`Report_1..5_*.html`) styled to match the prototype, each with filters, Chart.js charts, KPI cards and tables; `VLS_Reports.xlsx` — the same report data in tabular form + a Report Queries sheet; `Reports_Overview.docx` narrative |
| `08_unstructured/` | "Uploaded" documents | Public enforcement PDFs + `Entity_Extraction_Map.xlsx` linking each document to its graph node |

**Format note.** Profiling and structured data ship as Excel; narratives ship as Word. Two screens
ship richer formats the dev team ingests directly: the **knowledge graph as JSON** (a node/edge
structure a spreadsheet flattens badly), and the **query set as JSON** (each answer is a mix of prose
and chart/table blocks that a spreadsheet cell cannot hold — the flat `VLS_Query_Set_Index.xlsx` is a
human-readable companion, not the source of truth). The **reports also ship as standalone HTML** so the
team can see exactly how a rendered report should look; `VLS_Reports.xlsx` carries the same figures for
ingestion. Each Excel/Word/JSON/HTML file carries the content the dev team turns into their own JSON.

**Query set schema (`06_queries/query_set.json`).** Each query has an ordered `response.blocks`
array; every block is one of four types — `text` (markdown), `metric` (labelled figure cards), `chart`
(`bar` | `line` | `pie` | `donut`, with `data` points), or `table` (columns + rows). The block schema
is embedded at the top of the file under `block_schema`. Charts carry demo data derived from the
canonical roster; the dev team renders them with its own chart library. Confidence bands follow
CLAUDE.md §7 (High ≥0.85, Medium 0.60–0.85, Low <0.60).

**Reports (`07_reports/`).** Report 5 (Consent-Decree & Out-of-State Exposure) is the graph-payoff
report added alongside the original four. The HTML files load Chart.js from CDN and embed their data
inline, so each opens standalone in a browser. Colours and typography are lifted from the prototype
(`latest_html_prototype/context_weave_prototype_v2.html`) so the team sees the intended look, not a
placeholder.

**Canonical numbers.** The **Entity Roster** sheet in `04_structured_data/VLS_Structured_Data.xlsx`
holds the per-facility figures (volumes, evaluations, violations, penalties) that every query, report,
and graph rollup cites. Change a number there and it changes everywhere. Reports and query responses
are **canned** (frozen demo outputs), consistent with the roster but not recomputed at render time.

## Unstructured documents — two large files to drop in manually

`08_unstructured/` contains five of the seven enforcement PDFs. Two source files exceeded the transfer
limit and could not be copied programmatically — **copy them by hand from the parent
`Unstructured Data/` folder into `08_unstructured/`:**

- `chemours-cd.pdf` (Chemours Consent Decree — the hero-question document for hq4)
- `rcra-06-2025-0910-denka-performance-elastomer-llc-cafo.pdf` (Denka CAFO)

Both are already referenced in `Entity_Extraction_Map.xlsx` and in the graph, so once dropped in the
package is complete.

## Consumption note for the dev team

Files are keyed to the table/column names above and to stable node/edge IDs (`FAC:<EPA_ID>`,
`DOC:<slug>`, `MAN:<MTN>`, etc.). The React frontend and its JSON transforms are the dev team's
artifacts (CLAUDE.md §18) — this package is the source content they build those from.
