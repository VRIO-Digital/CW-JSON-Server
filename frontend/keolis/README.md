# Keolis Valmont demo data package — 24 September 2026

A complete dataset for the ContextWeave demo environment, written for a Keolis executive audience. It covers the use case in *ContextWeave Fleet & Infrastructure Information Report*: capital renewal decisions for a transport operator.

The tenant is **Keolis**, running the fictional **Réseau Valmo** for the fictional authority **Valmont Métropole** under contract **DSP-VM-2021**. The contract, city, assets, suppliers, people and figures are all invented, and every document says so in its footer. Amounts are in EUR, excluding VAT (HT).

## What to load

The demo app reads one file per dataset, `backend/db.<DATASET>.json`. CAPEX is `db.CAPEX.json`, served under `/C/`.

1. Copy `json/00_merged/db.KEOLIS.json` to `backend/db.KEOLIS.json`. The dataset letter becomes **K**, which is unique among E, C and B.
2. The same content is also split into one file per key under `json/01_…` to `json/09_…`, grouped by the screen that reads it. Edit those files if you prefer, but the merged file is the one the server loads.
3. The key set and field shapes follow `db.CAPEX.json` as served on 24 September 2026. I compared all 32 keys path by path; they match apart from optional fields CAPEX uses and this package does not.

## Screen-by-screen map

| Screen | Files | What the demo shows |
|---|---|---|
| Sources | `01_sources/*` | Three BigQuery projects (EAM, ERP, PPM & contract register), one shared drive plus a My Drive of working copies, and a Gmail mailbox with 10 exported threads. |
| Data Catalog | `02_data_catalog/*` | 34 tables and 232 columns. `ppm`, `ops` and `contract` are declared from the uploaded dictionaries; the other four datasets are profiled. It also has 27 documents with their extractions, declared data-model relationships and 5 change signals. |
| New Graph | `03_new_graph/*` | Four domains ranked by fit. "Predictive Asset Failure" ranks *none* on purpose. Seven personas, 12 governed metrics, 43 hero questions and one committed use case. |
| Graph Studio | `04_graph_studio/*` | A 230-node, 569-edge canvas; 8 review items with 1 pivot (installed ≠ accepted); 5 sanity checks. The as-built lanes hold 10 structured tables, 406 document entities, 491 relations and 150 Bridge links. |
| Ask | `05_ask/ask_answers.json` | 50 recorded answers: 14 hero, 29 standard and 7 declines. |
| What-if | `06_what_if/whatif.json` | TV-100 overhaul: €33.0M base forecast against a €34.5M PPI envelope. Three levers (price index, labour, contingency); fixed-price lots and the residual are locked. |
| AI Submissions | `07_ai_submissions/ai_submissions_db.json` | A Keolis version of the `DB` object in `ai_submissions_deliverables_demo_9.html`, with the same keys. See the note below. |
| Audit & Governance | `08_audit_governance/*` | Three published reports with readers and data scope, one restricted reader (infrastructure only), the audit log, traces and evals. |
| Platform | `09_platform/*` | Personas, users, nav permissions (Reports stays hidden, as today), the report prototype fixture, `_meta` and `_provenance`. |

## Uploads during the demo

Both upload controls send **only the filename**. No file contents reach the server.

**Data Catalog → Browse table for profiling → Upload Files**, per dataset row:

| Dataset row | Upload |
|---|---|
| `ppm` | `uploads/01_data_catalog/keolis-ppm-dictionary.csv` |
| `ops` | `uploads/01_data_catalog/keolis-ops-dictionary.csv` |
| `contract` | `uploads/01_data_catalog/keolis-contract-dictionary.csv` |

The columns these files describe are already in `column_profiles`, marked "declared in <filename>". Upload them on those rows only, with those exact names. Do **not** upload anything on `eam`, `telemetry`, `fin` or `proc`: applying a dictionary *replaces* a table's column list. `reference/keolis-valmont-warehouse.ddl.sql` is reference material, not an upload.

**New Graph → Upload documents:** `uploads/02_new_graph_wizard/`, which holds the BRD, the user stories and the metrics definitions.

> **Gap to close before the demo.** The wizard's "What we read from your documents" panel and its step-4 "Found in your documents" metrics come from a generic pool built into `src/data/documentReadings.ts` ("Maintenance Cost per Unit", "Permit Cycle Time" …), picked by a hash of the filename. Uploading the Keolis documents will show that generic content.
>
> `03_new_graph/document_readings.PROPOSED.json` holds what each Keolis document actually defines, in the same shape as `MetricDefinition`. If the team reads it by filename and falls back to the built-in pool for other files, the panel will quote the uploaded BRD. This key is **not** in the merged db.

## Corpus files

- `drive_corpus/`: 25 PDFs across 10 folders, plus 2 working copies (DOCX, XLSX) in My Drive. The page, character and chunk counts in `drives.json` were measured from these files. They carry real text, so the document graph builder can run on them.
- `mailbox_export/`: 10 EM-xx PDFs holding 20 messages. Every correspondence citation in Ask points at a message inside one of them.

## The story the data tells

The four worked examples from the report are built in end to end.

| Example | Where it shows | The point |
|---|---|---|
| A — BUS-204 engine after the replacement date | Ask Q05, Q16, Q17, Q27, Q44; Graph Studio sc2 | The contract puts the cost on the authority, and the notice went in time. But an overdue oil analysis may trigger the exclusion, so the answer is a **review item, not a receivable**. Avenant n°3 is checked and does not apply to BUS-204. |
| B — Les Aubiers lift €400k | Ask Q04, Q25, Q26, Q41; Project 360 report | €390k forecast, so on budget. Not on time: the supplier's two-week slip is only in email. The €25k proposal is shown in two scopes: €390k for the project, €415k combined. |
| C — T1 track renewal | Ask Q06, Q18, Q22, Q37, Q50 | Blocked. Access is provisional, drawing revision C put SIG-T1-044 inside the work limit, and the contractor still works from revision B. Contractor readiness ≠ approved access. |
| D — battery campaign | Ask Q07, Q20, Q40; pivot rq1 | Installed 40 · accepted 37 · duty-eligible 37. Warranty starts at acceptance. |

**The misses are first-class.** These answers show what the system will not claim:

- Seven declines: tram failure prediction, legal liability, ROI without a baseline, driver availability, cross-network benchmarks, a final-cost prediction, optimisation.
- Q08 ("all within budget?") answers for only 25 of 29 projects and names the four without a forecast.
- Q32 refuses to treat "expected to be funded" as an approval.

## Things to know

1. **AI Submissions engine ids.** The prototype branches on `example: 'dsic_filing'` and `'board_deck'`, and its filing maths is the US DSIC cap. This JSON renames the engines to `eligibility_filing` (the quarterly PPI claim) and `review_deck` (the investment-committee deck). `_engine_notes` in the file says what `filingCompute` should read instead. The Q3 claim (€4.86M claimable) matches Ask Q12, and the FY2026 programme (€44.5M plan, €40.8M forecast) matches Ask Q29.
2. **One committed use case is pre-seeded** so Graph Studio and Ask work straight away. To build it live, remove it from `graph_use_cases` and empty `data_model.entities`.
3. **Register five sources** before building: `bigquery:keolis_valmont_eam`, `bigquery:keolis_valmont_erp`, `bigquery:keolis_valmont_ppm`, `gdrive:kv-capital-renewal` and the Gmail mailbox. The use case names all five.
4. **Reports stays hidden** in the sidebar for every persona, matching today's settings. `reports.governance` still feeds Audit & Governance.
5. Demo logins stay on `@vriodigital.com`, because the login resolves against `settings.users`.

## Regenerating

Everything is generated from `_build/`, so change a figure there and rebuild. Never hand-edit the JSON.

```
cd _build
python3 render_corpus.py ../     # PDFs + measured stats
python3 uploads.py ../           # dictionaries, wizard DOCX, reference DDL
python3 build_all.py ../         # all JSON + merged db + golden set
python3 verify.py ../            # 44 integrity checks
```

`world.py` holds the organisation, contract, fleet, portfolio and worked examples. `tables.py` holds the warehouse, `corpus.py` and `corpus_enrich.py` hold the documents and mailbox, and `answers.py` holds the Ask answers.

`golden_set/ask_golden_cases_keolis.json` has one validation-harness case per answer: route, expected outcome, labelled answer and must_retrieve.
