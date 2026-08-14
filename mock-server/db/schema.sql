--
-- ContextWeave — the relational shape of mock-server/db.json.
--
-- GENERATED FILE. Do not edit: run `npm run db:schema` after changing
-- mock-server/db/model.mjs. `npm run check-docs` fails if the two disagree.
--
-- Applied by `npm run db:migrate`. Dropping the schema is how a rebuild starts,
-- because the seed is a whole document rather than a set of changes.
--

DROP SCHEMA IF EXISTS "contextweave" CASCADE;
CREATE SCHEMA "contextweave";

CREATE TABLE "contextweave"."google_account" (
  "id" integer NOT NULL CHECK ("id" = 1),
  "email" text,
  "name" text,
  "picture" text,
  CONSTRAINT "google_account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contextweave"."auth_roles" (
  "ordinal" integer,
  "role_id" text NOT NULL,
  "label" text,
  "access_note" text,
  CONSTRAINT "auth_roles_pkey" PRIMARY KEY ("role_id")
);

CREATE TABLE "contextweave"."projects" (
  "ordinal" integer,
  "project_id" text NOT NULL,
  "display_name" text,
  "location" text,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("project_id")
);

CREATE TABLE "contextweave"."datasets" (
  "project_id" text,
  "ordinal" integer,
  "dataset_id" text NOT NULL,
  "location" text,
  "description" text,
  "semantic_layer" text,
  CONSTRAINT "datasets_pkey" PRIMARY KEY ("dataset_id")
);

CREATE TABLE "contextweave"."dataset_tables" (
  "dataset_id" text NOT NULL,
  "ordinal" integer,
  "table_id" text NOT NULL,
  "label" text,
  "type" text,
  "grain" text,
  "rows" integer,
  "columns" integer,
  "size_gb" double precision,
  "partitioned" boolean,
  CONSTRAINT "dataset_tables_pkey" PRIMARY KEY ("dataset_id", "table_id")
);

CREATE TABLE "contextweave"."credentials" (
  "ordinal" integer,
  "project_id" text NOT NULL,
  "credential_handle" text,
  CONSTRAINT "credentials_pkey" PRIMARY KEY ("project_id")
);

CREATE TABLE "contextweave"."column_profiles" (
  "profile_key" text NOT NULL,
  "dataset_id" text,
  "table_id" text,
  "ordinal" integer,
  "column_id" text NOT NULL,
  "label" text,
  "type" text,
  "class" text,
  "description" text,
  "derivation" text,
  "confidence" double precision,
  "pii" boolean,
  "null_pct" double precision,
  "distinct_count" integer,
  CONSTRAINT "column_profiles_pkey" PRIMARY KEY ("profile_key", "column_id")
);

CREATE TABLE "contextweave"."drives" (
  "ordinal" integer,
  "drive_id" text NOT NULL,
  "display_name" text,
  "kind" text,
  "owner" text,
  CONSTRAINT "drives_pkey" PRIMARY KEY ("drive_id")
);

CREATE TABLE "contextweave"."folders" (
  "drive_id" text,
  "ordinal" integer,
  "folder_id" text NOT NULL,
  "name" text,
  "path" text,
  "description" text,
  CONSTRAINT "folders_pkey" PRIMARY KEY ("folder_id")
);

CREATE TABLE "contextweave"."documents" (
  "folder_id" text,
  "ordinal" integer,
  "document_id" text NOT NULL,
  "name" text,
  "mime_type" text,
  "doc_type" text,
  "doc_type_label" text,
  "linked_entity" text,
  "pages" integer,
  "size_mb" double precision,
  "entities" integer,
  "modified" text,
  CONSTRAINT "documents_pkey" PRIMARY KEY ("document_id")
);

CREATE TABLE "contextweave"."drive_credentials" (
  "ordinal" integer,
  "drive_id" text NOT NULL,
  "credential_handle" text,
  CONSTRAINT "drive_credentials_pkey" PRIMARY KEY ("drive_id")
);

CREATE TABLE "contextweave"."document_extractions" (
  "document_id" text NOT NULL,
  "ordinal" integer,
  "extraction_id" text,
  "extracted_entity" text,
  "entity_type" text,
  "resolved_node" text,
  "resolved_facility" text,
  "state" text,
  "linked_manifests" integer,
  "confidence" double precision,
  CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("document_id")
);

CREATE TABLE "contextweave"."column_vocabulary" (
  "ordinal" integer NOT NULL,
  "name" text,
  "type" text,
  "class" text,
  "confidence" double precision,
  "pii" boolean,
  CONSTRAINT "column_vocabulary_pkey" PRIMARY KEY ("ordinal")
);

CREATE TABLE "contextweave"."document_vocabulary" (
  "ordinal" integer NOT NULL,
  "name" text,
  "type" text,
  "class" text,
  "confidence" double precision,
  "pii" boolean,
  CONSTRAINT "document_vocabulary_pkey" PRIMARY KEY ("ordinal")
);

CREATE TABLE "contextweave"."change_signals" (
  "ordinal" integer,
  "signal_id" text NOT NULL,
  "kind" text,
  "severity" text,
  "dataset" text,
  "table_name" text,
  "detail" text,
  "action" text,
  "detected" text,
  CONSTRAINT "change_signals_pkey" PRIMARY KEY ("signal_id")
);

CREATE TABLE "contextweave"."audit_stats" (
  "ordinal" integer NOT NULL,
  "label" text,
  "value" text,
  "note" text,
  "tone" text,
  CONSTRAINT "audit_stats_pkey" PRIMARY KEY ("ordinal")
);

CREATE TABLE "contextweave"."audit_events" (
  "ordinal" integer NOT NULL,
  "actor" text,
  "action" text,
  "resource" text,
  "severity" text,
  "tone" text,
  "at" text,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("ordinal")
);

CREATE TABLE "contextweave"."audit_policies" (
  "ordinal" integer NOT NULL,
  "name" text,
  "description" text,
  "status" text,
  "tone" text,
  CONSTRAINT "audit_policies_pkey" PRIMARY KEY ("ordinal")
);

CREATE TABLE "contextweave"."trace_stats" (
  "ordinal" integer NOT NULL,
  "label" text,
  "value" text,
  "note" text,
  "tone" text,
  CONSTRAINT "trace_stats_pkey" PRIMARY KEY ("ordinal")
);

CREATE TABLE "contextweave"."trace_items" (
  "ordinal" integer,
  "id" text NOT NULL,
  "operation" text,
  "service" text,
  "duration" integer,
  "spans" integer,
  "status" text,
  "tone" text,
  "at" text,
  CONSTRAINT "trace_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contextweave"."trace_waterfall" (
  "trace_id" text NOT NULL,
  "operation" text,
  "total_ms" integer,
  CONSTRAINT "trace_waterfall_pkey" PRIMARY KEY ("trace_id")
);

CREATE TABLE "contextweave"."trace_waterfall_spans" (
  "trace_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "name" text,
  "start_ms" integer,
  "duration_ms" integer,
  CONSTRAINT "trace_waterfall_spans_pkey" PRIMARY KEY ("trace_id", "ordinal")
);

CREATE TABLE "contextweave"."eval_stats" (
  "ordinal" integer NOT NULL,
  "label" text,
  "value" text,
  "note" text,
  "tone" text,
  CONSTRAINT "eval_stats_pkey" PRIMARY KEY ("ordinal")
);

CREATE TABLE "contextweave"."eval_runs" (
  "ordinal" integer NOT NULL,
  "suite" text,
  "target" text,
  "checks" integer,
  "pass_rate" double precision,
  "status" text,
  "tone" text,
  "ran_at" text,
  CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("ordinal")
);

CREATE TABLE "contextweave"."eval_checks" (
  "ordinal" integer NOT NULL,
  "name" text,
  "dataset" text,
  "result" text,
  "tone" text,
  "detail" text,
  CONSTRAINT "eval_checks_pkey" PRIMARY KEY ("ordinal")
);

CREATE TABLE "contextweave"."graph_domains" (
  "ordinal" integer,
  "domain_id" text NOT NULL,
  "name" text,
  "expected_sources" text[],
  "fit" text,
  "note" text,
  "unmet_note" text,
  "rank" integer,
  CONSTRAINT "graph_domains_pkey" PRIMARY KEY ("domain_id")
);

CREATE TABLE "contextweave"."graph_personas" (
  "ordinal" integer,
  "persona_id" text NOT NULL,
  "name" text,
  "domains" text[],
  "keywords" text[],
  "focus" text,
  "top_questions" text[],
  CONSTRAINT "graph_personas_pkey" PRIMARY KEY ("persona_id")
);

CREATE TABLE "contextweave"."graph_kpis" (
  "ordinal" integer,
  "kpi_id" text NOT NULL,
  "name" text,
  "domains" text[],
  "keywords" text[],
  "definition" text,
  CONSTRAINT "graph_kpis_pkey" PRIMARY KEY ("kpi_id")
);

CREATE TABLE "contextweave"."graph_hero_questions" (
  "ordinal" integer,
  "question_id" text NOT NULL,
  "question_text" text,
  "domains" text[],
  "keywords" text[],
  "priority" text,
  "rationale" text,
  CONSTRAINT "graph_hero_questions_pkey" PRIMARY KEY ("question_id")
);

CREATE TABLE "contextweave"."graph_answer_formats" (
  "ordinal" integer,
  "format_id" text NOT NULL,
  "name" text,
  "format" text,
  "domains" text[],
  "keywords" text[],
  CONSTRAINT "graph_answer_formats_pkey" PRIMARY KEY ("format_id")
);

CREATE TABLE "contextweave"."graph_use_case_templates" (
  "ordinal" integer,
  "template_id" text NOT NULL,
  "use_case_id" text,
  "name" text,
  "description" text,
  "match_phrases" text[],
  CONSTRAINT "graph_use_case_templates_pkey" PRIMARY KEY ("template_id")
);

CREATE TABLE "contextweave"."template_personas" (
  "template_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "persona_id" text,
  CONSTRAINT "template_personas_pkey" PRIMARY KEY ("template_id", "ordinal")
);

CREATE TABLE "contextweave"."template_kpis" (
  "template_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "kpi_id" text,
  CONSTRAINT "template_kpis_pkey" PRIMARY KEY ("template_id", "ordinal")
);

CREATE TABLE "contextweave"."template_hero_questions" (
  "template_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "question_id" text,
  CONSTRAINT "template_hero_questions_pkey" PRIMARY KEY ("template_id", "ordinal")
);

CREATE TABLE "contextweave"."graph_use_cases" (
  "ordinal" integer,
  "use_case_id" text NOT NULL,
  "name" text,
  "status" text,
  "domain_id" text,
  "business_need" text,
  "citations" text,
  "step" integer,
  "updated_at" text,
  CONSTRAINT "graph_use_cases_pkey" PRIMARY KEY ("use_case_id")
);

CREATE TABLE "contextweave"."use_case_personas" (
  "use_case_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "name" text,
  "description" text,
  "source" text,
  CONSTRAINT "use_case_personas_pkey" PRIMARY KEY ("use_case_id", "ordinal")
);

CREATE TABLE "contextweave"."use_case_kpis" (
  "use_case_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "name" text,
  "description" text,
  "source" text,
  CONSTRAINT "use_case_kpis_pkey" PRIMARY KEY ("use_case_id", "ordinal")
);

CREATE TABLE "contextweave"."use_case_sources" (
  "use_case_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "source_id" text,
  "mode" text,
  "objects" text[],
  CONSTRAINT "use_case_sources_pkey" PRIMARY KEY ("use_case_id", "ordinal")
);

CREATE TABLE "contextweave"."use_case_hero_questions" (
  "use_case_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "question_text" text,
  "priority" text,
  "source" text,
  CONSTRAINT "use_case_hero_questions_pkey" PRIMARY KEY ("use_case_id", "ordinal")
);

CREATE TABLE "contextweave"."use_case_answer_formats" (
  "use_case_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "format_id" text,
  "name" text,
  "format" text,
  CONSTRAINT "use_case_answer_formats_pkey" PRIMARY KEY ("use_case_id", "ordinal")
);

CREATE TABLE "contextweave"."use_case_gap_decisions" (
  "use_case_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "decision" jsonb,
  CONSTRAINT "use_case_gap_decisions_pkey" PRIMARY KEY ("use_case_id", "ordinal")
);

CREATE TABLE "contextweave"."canvas_nodes" (
  "ordinal" integer,
  "node_id" text NOT NULL,
  "label" text,
  "sublabel" text,
  "type" text,
  "element_class" text,
  "node_group" text,
  "source" text,
  "confidence" double precision,
  "degree" integer,
  "r" double precision,
  "x" double precision,
  "y" double precision,
  "review_item_id" text,
  CONSTRAINT "canvas_nodes_pkey" PRIMARY KEY ("node_id")
);

CREATE TABLE "contextweave"."canvas_edges" (
  "ordinal" integer,
  "edge_id" text NOT NULL,
  "from_node" text,
  "to_node" text,
  "label" text,
  "detail" text,
  "review_item_id" text,
  CONSTRAINT "canvas_edges_pkey" PRIMARY KEY ("edge_id")
);

CREATE TABLE "contextweave"."review_items" (
  "ordinal" integer,
  "item_id" text NOT NULL,
  "kind" text,
  "title" text,
  "detail" text,
  "confidence" double precision,
  "band" text,
  "floor" text,
  "action_set" text,
  "evidence" text[],
  "graph_refs" text[],
  "justification" text,
  CONSTRAINT "review_items_pkey" PRIMARY KEY ("item_id")
);

CREATE TABLE "contextweave"."review_item_actions" (
  "item_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "choice" text,
  "label" text,
  CONSTRAINT "review_item_actions_pkey" PRIMARY KEY ("item_id", "ordinal")
);

CREATE TABLE "contextweave"."studio_pivot" (
  "pivot_id" text NOT NULL,
  "alternative_id" text,
  "title" text,
  "detail" text,
  "why_pivot" text,
  "confidence" double precision,
  "band" text,
  "floor" text,
  "evidence" text[],
  "graph_refs" text[],
  CONSTRAINT "studio_pivot_pkey" PRIMARY KEY ("pivot_id")
);

CREATE TABLE "contextweave"."studio_pivot_options" (
  "pivot_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "option_id" text,
  "label" text,
  "consequence" text,
  CONSTRAINT "studio_pivot_options_pkey" PRIMARY KEY ("pivot_id", "ordinal")
);

CREATE TABLE "contextweave"."sanity_checks" (
  "ordinal" integer,
  "check_id" text NOT NULL,
  "hero_question_id" text,
  "question" text,
  "verdict" text,
  "verdict_body" text,
  "plan" text,
  "cost_usd" double precision,
  "budget_usd" double precision,
  "path" text[],
  "edges_used" text[],
  CONSTRAINT "sanity_checks_pkey" PRIMARY KEY ("check_id")
);

CREATE TABLE "contextweave"."sanity_check_context" (
  "check_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "chip" text,
  "label" text,
  "meta" text,
  "ok" boolean,
  CONSTRAINT "sanity_check_context_pkey" PRIMARY KEY ("check_id", "ordinal")
);

CREATE TABLE "contextweave"."studio_generated" (
  "id" integer NOT NULL CHECK ("id" = 1),
  "must_review_total" integer,
  "confirmed_total" integer,
  "auto_approved_total" integer,
  "spot_check_quota" integer,
  "sample_size" integer,
  "subjects" text[],
  "predicates" text[],
  CONSTRAINT "studio_generated_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contextweave"."ask_answers" (
  "ordinal" integer,
  "answer_id" text NOT NULL,
  "persona" text,
  "kind" text,
  "question" text,
  "hero_ref" text,
  "summary" text,
  "confidence_level" text,
  "confidence" double precision,
  CONSTRAINT "ask_answers_pkey" PRIMARY KEY ("answer_id")
);

CREATE TABLE "contextweave"."ask_answer_blocks" (
  "answer_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "type" text,
  "markdown" text,
  "title" text,
  "chart" text,
  "x_label" text,
  "y_label" text,
  "items" jsonb,
  "data" jsonb,
  "columns" text[],
  "rows" jsonb,
  "note" text,
  CONSTRAINT "ask_answer_blocks_pkey" PRIMARY KEY ("answer_id", "ordinal")
);

CREATE TABLE "contextweave"."ask_answer_evidence" (
  "answer_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "source" text,
  "detail" text,
  CONSTRAINT "ask_answer_evidence_pkey" PRIMARY KEY ("answer_id", "ordinal")
);

CREATE TABLE "contextweave"."whatif_facility" (
  "id" text NOT NULL,
  "name" text,
  "role" text,
  "baseline" jsonb,
  "appetite" jsonb,
  CONSTRAINT "whatif_facility_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contextweave"."whatif_transporters" (
  "ordinal" integer NOT NULL,
  "name" text,
  CONSTRAINT "whatif_transporters_pkey" PRIMARY KEY ("ordinal")
);

CREATE TABLE "contextweave"."whatif_generators" (
  "ordinal" integer,
  "id" text NOT NULL,
  "name" text,
  "state" text,
  "risk" text,
  "transporter" text,
  "evaluations" integer,
  "violations" integer,
  "enforcement" integer,
  "penalty" integer,
  "tons" double precision,
  "manifests" integer,
  "consent_decree" boolean,
  "last_enforcement" text,
  CONSTRAINT "whatif_generators_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contextweave"."whatif_watched_measures" (
  "ordinal" integer,
  "key" text NOT NULL,
  "label" text,
  "unit" text,
  "source" text,
  "grounds" text,
  "field" text,
  "format" text,
  "inherited" boolean,
  "baseline_field" text,
  "appetite_field" text,
  "breach" jsonb,
  CONSTRAINT "whatif_watched_measures_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "contextweave"."whatif_candidate_pools" (
  "ordinal" integer,
  "key" text NOT NULL,
  "label" text,
  "filter" jsonb,
  CONSTRAINT "whatif_candidate_pools_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "contextweave"."whatif_resolvable" (
  "ordinal" integer NOT NULL,
  "keywords" text[],
  "resolves_to" text,
  "verdict" text,
  "note" text,
  CONSTRAINT "whatif_resolvable_pkey" PRIMARY KEY ("ordinal")
);

CREATE TABLE "contextweave"."whatif_headroom" (
  "key" text NOT NULL,
  "ordinal" integer,
  "room" double precision,
  "avg" double precision,
  "carrying" double precision,
  "appetite" double precision,
  CONSTRAINT "whatif_headroom_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "contextweave"."report_fields" (
  "ordinal" integer,
  "key" text NOT NULL,
  "label" text,
  "kind" text,
  "filterable" boolean,
  "avail" boolean,
  "note" text,
  CONSTRAINT "report_fields_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "contextweave"."report_summary_catalog" (
  "ordinal" integer,
  "key" text NOT NULL,
  "label" text,
  "tone" text,
  "agg" text,
  "field" text,
  "format" text,
  CONSTRAINT "report_summary_catalog_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "contextweave"."report_generators" (
  "ordinal" integer,
  "generator" text NOT NULL,
  "state" text,
  "risk" text,
  "evals" integer,
  "viols" integer,
  "enf" integer,
  "penalty" integer,
  "tons" double precision,
  "manifests" integer,
  "cd" boolean,
  "last_enf" text,
  CONSTRAINT "report_generators_pkey" PRIMARY KEY ("generator")
);

CREATE TABLE "contextweave"."report_facilities" (
  "ordinal" integer,
  "facility" text NOT NULL,
  "role" text,
  "state" text,
  "evals" integer,
  "viols" integer,
  "enf" integer,
  "penalty" integer,
  "last_eval" text,
  CONSTRAINT "report_facilities_pkey" PRIMARY KEY ("facility")
);

CREATE TABLE "contextweave"."report_quarters" (
  "ordinal" integer,
  "quarter" text NOT NULL,
  "manifests" integer,
  "tons" double precision,
  "rej" integer,
  "res" integer,
  CONSTRAINT "report_quarters_pkey" PRIMARY KEY ("quarter")
);

CREATE TABLE "contextweave"."report_traces" (
  "ordinal" integer,
  "mtn" text NOT NULL,
  "generator" text,
  "gen_state" text,
  "shipped" text,
  "received" text,
  "days" integer,
  "transporters" text[],
  "tons" double precision,
  "residue" boolean,
  "rejected" boolean,
  "status" text,
  CONSTRAINT "report_traces_pkey" PRIMARY KEY ("mtn")
);

CREATE TABLE "contextweave"."report_definitions" (
  "ordinal" integer,
  "report_id" text NOT NULL,
  "report_tag" text,
  "subject" text,
  "title" text,
  "question" text,
  "spine" text,
  "scope" text,
  "scope_label" text,
  "measure" text,
  "measure_label" text,
  "reading" jsonb,
  "heading" text,
  "subtitle" text,
  "badge" text,
  "note" text,
  "source_file" text,
  "summary_keys" text[],
  CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("report_id")
);

CREATE TABLE "contextweave"."report_definition_blocks" (
  "report_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "type" text,
  "chart_type" text,
  "measure" text,
  "metric" text,
  "title" text,
  "cols" text[],
  CONSTRAINT "report_definition_blocks_pkey" PRIMARY KEY ("report_id", "ordinal")
);

CREATE TABLE "contextweave"."report_definition_tiles" (
  "report_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "label" text,
  "value" text,
  "unit" text,
  "tone" text,
  CONSTRAINT "report_definition_tiles_pkey" PRIMARY KEY ("report_id", "ordinal")
);

CREATE TABLE "contextweave"."report_definition_footer" (
  "report_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "label" text,
  "body" text,
  CONSTRAINT "report_definition_footer_pkey" PRIMARY KEY ("report_id", "ordinal")
);

CREATE TABLE "contextweave"."report_saved" (
  "ordinal" integer,
  "saved_id" text NOT NULL,
  "name" text,
  "question" text,
  "report_id" text,
  "use_case_id" text,
  "scope" text,
  "measure" text,
  "horizon" text,
  "filters" jsonb,
  "saved_by" text,
  "viewer_roles" text[],
  "saved_at" text,
  CONSTRAINT "report_saved_pkey" PRIMARY KEY ("saved_id")
);

CREATE TABLE "contextweave"."governance_statuses" (
  "ordinal" integer,
  "key" text NOT NULL,
  "label" text,
  "tone" text,
  CONSTRAINT "governance_statuses_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "contextweave"."governance_reports" (
  "ordinal" integer,
  "report_id" text NOT NULL,
  "status" text,
  "version" text,
  "author" text,
  "category" text,
  "as_of" text,
  "schedule" text,
  "approval" text,
  "note" text,
  CONSTRAINT "governance_reports_pkey" PRIMARY KEY ("report_id")
);

CREATE TABLE "contextweave"."governance_audience" (
  "report_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "role_id" text,
  CONSTRAINT "governance_audience_pkey" PRIMARY KEY ("report_id", "ordinal")
);

CREATE TABLE "contextweave"."governance_data_scope" (
  "ordinal" integer,
  "role_id" text NOT NULL,
  "scope" text,
  "predicate" text,
  "grain" text,
  "masked" text,
  "may_author" boolean,
  "full" boolean,
  "mask" boolean,
  "rule" jsonb,
  CONSTRAINT "governance_data_scope_pkey" PRIMARY KEY ("role_id")
);

CREATE TABLE "contextweave"."doc_blobs" (
  "path" text NOT NULL,
  "value" jsonb,
  CONSTRAINT "doc_blobs_pkey" PRIMARY KEY ("path")
);

--
-- Foreign keys. Each one is a failure that used to answer instead of throwing;
-- see the note at the top of mock-server/db/schema.mjs.
--

ALTER TABLE "contextweave"."datasets" ADD CONSTRAINT "datasets_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "contextweave"."projects" ("project_id");
ALTER TABLE "contextweave"."dataset_tables" ADD CONSTRAINT "dataset_tables_dataset_id_fkey"
  FOREIGN KEY ("dataset_id") REFERENCES "contextweave"."datasets" ("dataset_id");
ALTER TABLE "contextweave"."credentials" ADD CONSTRAINT "credentials_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "contextweave"."projects" ("project_id");
ALTER TABLE "contextweave"."column_profiles" ADD CONSTRAINT "column_profiles_dataset_id_table_id_fkey"
  FOREIGN KEY ("dataset_id", "table_id") REFERENCES "contextweave"."dataset_tables" ("dataset_id", "table_id");
ALTER TABLE "contextweave"."folders" ADD CONSTRAINT "folders_drive_id_fkey"
  FOREIGN KEY ("drive_id") REFERENCES "contextweave"."drives" ("drive_id");
ALTER TABLE "contextweave"."documents" ADD CONSTRAINT "documents_folder_id_fkey"
  FOREIGN KEY ("folder_id") REFERENCES "contextweave"."folders" ("folder_id");
ALTER TABLE "contextweave"."drive_credentials" ADD CONSTRAINT "drive_credentials_drive_id_fkey"
  FOREIGN KEY ("drive_id") REFERENCES "contextweave"."drives" ("drive_id");
ALTER TABLE "contextweave"."document_extractions" ADD CONSTRAINT "document_extractions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "contextweave"."documents" ("document_id");
ALTER TABLE "contextweave"."trace_waterfall_spans" ADD CONSTRAINT "trace_waterfall_spans_trace_id_fkey"
  FOREIGN KEY ("trace_id") REFERENCES "contextweave"."trace_waterfall" ("trace_id");
ALTER TABLE "contextweave"."template_personas" ADD CONSTRAINT "template_personas_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "contextweave"."graph_use_case_templates" ("template_id");
ALTER TABLE "contextweave"."template_personas" ADD CONSTRAINT "template_personas_persona_id_fkey"
  FOREIGN KEY ("persona_id") REFERENCES "contextweave"."graph_personas" ("persona_id");
ALTER TABLE "contextweave"."template_kpis" ADD CONSTRAINT "template_kpis_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "contextweave"."graph_use_case_templates" ("template_id");
ALTER TABLE "contextweave"."template_kpis" ADD CONSTRAINT "template_kpis_kpi_id_fkey"
  FOREIGN KEY ("kpi_id") REFERENCES "contextweave"."graph_kpis" ("kpi_id");
ALTER TABLE "contextweave"."template_hero_questions" ADD CONSTRAINT "template_hero_questions_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "contextweave"."graph_use_case_templates" ("template_id");
ALTER TABLE "contextweave"."template_hero_questions" ADD CONSTRAINT "template_hero_questions_question_id_fkey"
  FOREIGN KEY ("question_id") REFERENCES "contextweave"."graph_hero_questions" ("question_id");
ALTER TABLE "contextweave"."graph_use_cases" ADD CONSTRAINT "graph_use_cases_domain_id_fkey"
  FOREIGN KEY ("domain_id") REFERENCES "contextweave"."graph_domains" ("domain_id");
ALTER TABLE "contextweave"."use_case_personas" ADD CONSTRAINT "use_case_personas_use_case_id_fkey"
  FOREIGN KEY ("use_case_id") REFERENCES "contextweave"."graph_use_cases" ("use_case_id");
ALTER TABLE "contextweave"."use_case_kpis" ADD CONSTRAINT "use_case_kpis_use_case_id_fkey"
  FOREIGN KEY ("use_case_id") REFERENCES "contextweave"."graph_use_cases" ("use_case_id");
ALTER TABLE "contextweave"."use_case_sources" ADD CONSTRAINT "use_case_sources_use_case_id_fkey"
  FOREIGN KEY ("use_case_id") REFERENCES "contextweave"."graph_use_cases" ("use_case_id");
ALTER TABLE "contextweave"."use_case_hero_questions" ADD CONSTRAINT "use_case_hero_questions_use_case_id_fkey"
  FOREIGN KEY ("use_case_id") REFERENCES "contextweave"."graph_use_cases" ("use_case_id");
ALTER TABLE "contextweave"."use_case_answer_formats" ADD CONSTRAINT "use_case_answer_formats_use_case_id_fkey"
  FOREIGN KEY ("use_case_id") REFERENCES "contextweave"."graph_use_cases" ("use_case_id");
ALTER TABLE "contextweave"."use_case_gap_decisions" ADD CONSTRAINT "use_case_gap_decisions_use_case_id_fkey"
  FOREIGN KEY ("use_case_id") REFERENCES "contextweave"."graph_use_cases" ("use_case_id");
ALTER TABLE "contextweave"."canvas_edges" ADD CONSTRAINT "canvas_edges_from_node_fkey"
  FOREIGN KEY ("from_node") REFERENCES "contextweave"."canvas_nodes" ("node_id");
ALTER TABLE "contextweave"."canvas_edges" ADD CONSTRAINT "canvas_edges_to_node_fkey"
  FOREIGN KEY ("to_node") REFERENCES "contextweave"."canvas_nodes" ("node_id");
ALTER TABLE "contextweave"."review_item_actions" ADD CONSTRAINT "review_item_actions_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "contextweave"."review_items" ("item_id");
ALTER TABLE "contextweave"."studio_pivot_options" ADD CONSTRAINT "studio_pivot_options_pivot_id_fkey"
  FOREIGN KEY ("pivot_id") REFERENCES "contextweave"."studio_pivot" ("pivot_id");
ALTER TABLE "contextweave"."sanity_check_context" ADD CONSTRAINT "sanity_check_context_check_id_fkey"
  FOREIGN KEY ("check_id") REFERENCES "contextweave"."sanity_checks" ("check_id");
ALTER TABLE "contextweave"."ask_answer_blocks" ADD CONSTRAINT "ask_answer_blocks_answer_id_fkey"
  FOREIGN KEY ("answer_id") REFERENCES "contextweave"."ask_answers" ("answer_id");
ALTER TABLE "contextweave"."ask_answer_evidence" ADD CONSTRAINT "ask_answer_evidence_answer_id_fkey"
  FOREIGN KEY ("answer_id") REFERENCES "contextweave"."ask_answers" ("answer_id");
ALTER TABLE "contextweave"."report_definition_blocks" ADD CONSTRAINT "report_definition_blocks_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "contextweave"."report_definitions" ("report_id");
ALTER TABLE "contextweave"."report_definition_tiles" ADD CONSTRAINT "report_definition_tiles_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "contextweave"."report_definitions" ("report_id");
ALTER TABLE "contextweave"."report_definition_footer" ADD CONSTRAINT "report_definition_footer_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "contextweave"."report_definitions" ("report_id");
ALTER TABLE "contextweave"."report_saved" ADD CONSTRAINT "report_saved_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "contextweave"."report_definitions" ("report_id");
ALTER TABLE "contextweave"."governance_reports" ADD CONSTRAINT "governance_reports_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "contextweave"."report_definitions" ("report_id");
ALTER TABLE "contextweave"."governance_reports" ADD CONSTRAINT "governance_reports_status_fkey"
  FOREIGN KEY ("status") REFERENCES "contextweave"."governance_statuses" ("key");
ALTER TABLE "contextweave"."governance_audience" ADD CONSTRAINT "governance_audience_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "contextweave"."governance_reports" ("report_id");
ALTER TABLE "contextweave"."governance_audience" ADD CONSTRAINT "governance_audience_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "contextweave"."auth_roles" ("role_id");
ALTER TABLE "contextweave"."governance_data_scope" ADD CONSTRAINT "governance_data_scope_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "contextweave"."auth_roles" ("role_id");

-- A child is always read by its parent key, and PostgreSQL does not index that side.

CREATE INDEX "datasets_project_id_fkey_idx" ON "contextweave"."datasets" ("project_id");
CREATE INDEX "dataset_tables_dataset_id_fkey_idx" ON "contextweave"."dataset_tables" ("dataset_id");
CREATE INDEX "credentials_project_id_fkey_idx" ON "contextweave"."credentials" ("project_id");
CREATE INDEX "column_profiles_dataset_id_table_id_fkey_idx" ON "contextweave"."column_profiles" ("dataset_id", "table_id");
CREATE INDEX "folders_drive_id_fkey_idx" ON "contextweave"."folders" ("drive_id");
CREATE INDEX "documents_folder_id_fkey_idx" ON "contextweave"."documents" ("folder_id");
CREATE INDEX "drive_credentials_drive_id_fkey_idx" ON "contextweave"."drive_credentials" ("drive_id");
CREATE INDEX "document_extractions_document_id_fkey_idx" ON "contextweave"."document_extractions" ("document_id");
CREATE INDEX "trace_waterfall_spans_trace_id_fkey_idx" ON "contextweave"."trace_waterfall_spans" ("trace_id");
CREATE INDEX "template_personas_template_id_fkey_idx" ON "contextweave"."template_personas" ("template_id");
CREATE INDEX "template_personas_persona_id_fkey_idx" ON "contextweave"."template_personas" ("persona_id");
CREATE INDEX "template_kpis_template_id_fkey_idx" ON "contextweave"."template_kpis" ("template_id");
CREATE INDEX "template_kpis_kpi_id_fkey_idx" ON "contextweave"."template_kpis" ("kpi_id");
CREATE INDEX "template_hero_questions_template_id_fkey_idx" ON "contextweave"."template_hero_questions" ("template_id");
CREATE INDEX "template_hero_questions_question_id_fkey_idx" ON "contextweave"."template_hero_questions" ("question_id");
CREATE INDEX "graph_use_cases_domain_id_fkey_idx" ON "contextweave"."graph_use_cases" ("domain_id");
CREATE INDEX "use_case_personas_use_case_id_fkey_idx" ON "contextweave"."use_case_personas" ("use_case_id");
CREATE INDEX "use_case_kpis_use_case_id_fkey_idx" ON "contextweave"."use_case_kpis" ("use_case_id");
CREATE INDEX "use_case_sources_use_case_id_fkey_idx" ON "contextweave"."use_case_sources" ("use_case_id");
CREATE INDEX "use_case_hero_questions_use_case_id_fkey_idx" ON "contextweave"."use_case_hero_questions" ("use_case_id");
CREATE INDEX "use_case_answer_formats_use_case_id_fkey_idx" ON "contextweave"."use_case_answer_formats" ("use_case_id");
CREATE INDEX "use_case_gap_decisions_use_case_id_fkey_idx" ON "contextweave"."use_case_gap_decisions" ("use_case_id");
CREATE INDEX "canvas_edges_from_node_fkey_idx" ON "contextweave"."canvas_edges" ("from_node");
CREATE INDEX "canvas_edges_to_node_fkey_idx" ON "contextweave"."canvas_edges" ("to_node");
CREATE INDEX "review_item_actions_item_id_fkey_idx" ON "contextweave"."review_item_actions" ("item_id");
CREATE INDEX "studio_pivot_options_pivot_id_fkey_idx" ON "contextweave"."studio_pivot_options" ("pivot_id");
CREATE INDEX "sanity_check_context_check_id_fkey_idx" ON "contextweave"."sanity_check_context" ("check_id");
CREATE INDEX "ask_answer_blocks_answer_id_fkey_idx" ON "contextweave"."ask_answer_blocks" ("answer_id");
CREATE INDEX "ask_answer_evidence_answer_id_fkey_idx" ON "contextweave"."ask_answer_evidence" ("answer_id");
CREATE INDEX "report_definition_blocks_report_id_fkey_idx" ON "contextweave"."report_definition_blocks" ("report_id");
CREATE INDEX "report_definition_tiles_report_id_fkey_idx" ON "contextweave"."report_definition_tiles" ("report_id");
CREATE INDEX "report_definition_footer_report_id_fkey_idx" ON "contextweave"."report_definition_footer" ("report_id");
CREATE INDEX "report_saved_report_id_fkey_idx" ON "contextweave"."report_saved" ("report_id");
CREATE INDEX "governance_reports_report_id_fkey_idx" ON "contextweave"."governance_reports" ("report_id");
CREATE INDEX "governance_reports_status_fkey_idx" ON "contextweave"."governance_reports" ("status");
CREATE INDEX "governance_audience_report_id_fkey_idx" ON "contextweave"."governance_audience" ("report_id");
CREATE INDEX "governance_audience_role_id_fkey_idx" ON "contextweave"."governance_audience" ("role_id");
CREATE INDEX "governance_data_scope_role_id_fkey_idx" ON "contextweave"."governance_data_scope" ("role_id");
