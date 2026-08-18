"""
What the database has to hold for the API to serve it.

Ported from the Node server's `validateDb` / `validateSettings`, and kept for
the same reason: losing a key here does not throw, it *answers*. Drop
`column_profiles` and the profiler quietly swaps 206 real columns for
synthesised ones; drop `document_extractions` and every document's resolution
becomes "nothing resolved yet". Both read as findings.

So a write that would produce such a document is refused, naming the key.
"""

from __future__ import annotations

import re
from typing import Any, Callable

Json = Any


def is_object(v: Json) -> bool:
    return isinstance(v, dict)


def _every(rows: Json, test: Callable[[Any], bool]) -> bool:
    return isinstance(rows, list) and all(test(r) for r in rows)


def _nonempty(rows: Json, test: Callable[[Any], bool]) -> bool:
    return isinstance(rows, list) and len(rows) > 0 and all(test(r) for r in rows)


REPORT_SCOPES = ("all", "cd", "enf", "oos")

REPORT_LABEL_KEY = {
    "generators": "generator",
    "facilities": "facility",
    "quarters": "quarter",
    "traces": "mtn",
}


def _reports_ok(v: Json) -> bool:
    if not is_object(v):
        return False
    gov = v.get("governance")
    if not is_object(gov):
        return False
    statuses = gov.get("statuses")
    if not _nonempty(statuses, lambda s: is_object(s) and s.get("key") and s.get("label") and s.get("tone")):
        return False
    status_keys = {s["key"] for s in statuses}
    if not _nonempty(
        gov.get("reports"),
        lambda g: is_object(g)
        and g.get("report_id")
        and g.get("status") in status_keys
        and g.get("version")
        and g.get("author")
        and g.get("category")
        and isinstance(g.get("audience"), list),
    ):
        return False
    publishing = gov.get("publishing")
    if not is_object(publishing) or not is_object(publishing.get("readers")):
        return False
    if "not access control" not in str(publishing["readers"].get("caveat", "")):
        return False
    freshness = publishing.get("freshness")
    if not is_object(freshness):
        return False
    presets = freshness.get("presets")
    if not _nonempty(presets, lambda p: is_object(p) and p.get("id") and p.get("label") and p.get("sentence")):
        return False
    if not any(p["id"] == freshness.get("default") for p in presets):
        return False
    audit = gov.get("audit")
    if not is_object(audit) or not is_object(audit.get("copy")):
        return False
    if not re.search(r"recorded, not enforced", str(audit["copy"].get("not_enforced", ""))):
        return False
    if not (isinstance(audit["copy"].get("gates"), list) and audit["copy"]["gates"]):
        return False
    if not (
        isinstance(audit.get("categories"), list)
        and any(c.get("key") == "all" for c in audit["categories"])
    ):
        return False

    return (
        is_object(v.get("meta"))
        and _nonempty(v.get("fields"), is_object)
        and is_object(v.get("assumptions"))
        and is_object(v.get("opts"))
        and isinstance(v.get("slice_default"), list)
        and _nonempty(v.get("summary_catalog"), is_object)
        and isinstance(v.get("summary_default"), list)
        and isinstance(v.get("saved"), list)
        and is_object(v.get("data"))
        and all(isinstance(rows, list) and rows for rows in v["data"].values())
        and _nonempty(gov.get("data_scope"), is_object)
        and is_object(gov.get("gate_notes"))
        and _nonempty(
            v.get("reports"),
            lambda r: is_object(r)
            and r.get("report_id")
            and r.get("heading")
            and r.get("spine")
            and r.get("blocks")
            and r.get("tiles")
            and r.get("footer"),
        )
    )


DB_SHAPE: dict[str, Callable[[Json], bool]] = {
    "google_account": lambda v: is_object(v) and isinstance(v.get("email"), str),
    "auth_roles": lambda v: _nonempty(v, lambda r: is_object(r) and r.get("role_id") and r.get("label")),
    "credentials": lambda v: _every(v, lambda c: is_object(c) and c.get("project_id") and c.get("credential_handle")),
    "projects": lambda v: _nonempty(
        v,
        lambda p: is_object(p)
        and p.get("project_id")
        and _every(
            p.get("datasets"),
            lambda d: is_object(d)
            and d.get("dataset_id")
            and _every(
                d.get("tables"),
                lambda t: is_object(t) and t.get("table_id") and t.get("label") and t.get("grain"),
            ),
        ),
    ),
    "drive_credentials": lambda v: _every(v, lambda c: is_object(c) and c.get("drive_id") and c.get("credential_handle")),
    "drives": lambda v: _nonempty(
        v,
        lambda d: is_object(d)
        and d.get("drive_id")
        and _every(
            d.get("folders"),
            lambda f: is_object(f)
            and f.get("folder_id")
            and _every(
                f.get("documents"),
                lambda doc: is_object(doc)
                and doc.get("document_id")
                and doc.get("doc_type")
                and doc.get("doc_type_label")
                and doc.get("linked_entity"),
            ),
        ),
    ),
    "audit": lambda v: is_object(v)
    and isinstance(v.get("stats"), list)
    and isinstance(v.get("events"), list)
    and isinstance(v.get("policies"), list),
    "traces": lambda v: is_object(v) and isinstance(v.get("stats"), list) and isinstance(v.get("items"), list),
    "evals": lambda v: is_object(v)
    and isinstance(v.get("stats"), list)
    and isinstance(v.get("runs"), list)
    and isinstance(v.get("checks"), list),
    "change_signals": lambda v: isinstance(v, list),
    "column_vocabulary": lambda v: _nonempty(v, lambda c: is_object(c) and c.get("name") and c.get("type") and c.get("class")),
    "document_vocabulary": lambda v: _nonempty(v, lambda c: is_object(c) and c.get("name") and c.get("type") and c.get("class")),
    "column_profiles": lambda v: is_object(v)
    and len(v) > 0
    and all(
        _nonempty(
            columns,
            lambda c: is_object(c)
            and isinstance(c.get("column_id"), str)
            and isinstance(c.get("class"), str)
            and isinstance(c.get("description"), str)
            and isinstance(c.get("confidence"), (int, float)),
        )
        for columns in v.values()
    ),
    "document_extractions": lambda v: is_object(v)
    and len(v) > 0
    and all(
        is_object(e)
        and isinstance(e.get("extracted_entity"), str)
        and isinstance(e.get("resolved_node"), str)
        and isinstance(e.get("linked_manifests"), int)
        and isinstance(e.get("confidence"), (int, float))
        for e in v.values()
    ),
    "ask_answers": lambda v: _nonempty(
        v,
        lambda a: is_object(a)
        and isinstance(a.get("answer_id"), str)
        and isinstance(a.get("question"), str)
        and isinstance(a.get("summary"), str)
        and _every(a.get("blocks"), lambda b: is_object(b) and isinstance(b.get("type"), str))
        and isinstance(a.get("confidence"), (int, float)),
    ),
    "graph_domains": lambda v: _nonempty(v, lambda d: is_object(d) and d.get("domain_id") and d.get("name")),
    "graph_personas": lambda v: _nonempty(v, lambda p: is_object(p) and p.get("persona_id") and p.get("name")),
    "graph_kpis": lambda v: _nonempty(v, lambda k: is_object(k) and k.get("kpi_id") and k.get("name")),
    "graph_hero_questions": lambda v: _nonempty(v, lambda q: is_object(q) and q.get("question_id") and q.get("text")),
    "graph_answer_formats": lambda v: _nonempty(v, lambda f: is_object(f) and f.get("format_id") and f.get("name")),
    "graph_use_case_templates": lambda v: _every(
        v,
        lambda t: is_object(t)
        and t.get("template_id")
        and t.get("name")
        and isinstance(t.get("match_phrases"), list)
        and isinstance(t.get("personas"), list)
        and isinstance(t.get("kpis"), list)
        and isinstance(t.get("hero_questions"), list),
    ),
    "graph_use_cases": lambda v: _every(v, lambda u: is_object(u) and u.get("use_case_id") and u.get("name")),
    "graph_studio": lambda v: is_object(v)
    and isinstance(v.get("review_items"), list)
    and is_object(v.get("generated"))
    and is_object(v.get("pivot"))
    and is_object(v.get("canvas"))
    and isinstance(v["canvas"].get("nodes"), list)
    and isinstance(v["canvas"].get("edges"), list)
    and isinstance(v.get("sanity_checks"), list),
    "whatif": lambda v: is_object(v)
    and is_object(v.get("facility"))
    and _nonempty(v.get("generators"), is_object)
    and _nonempty(v.get("watched_measures"), is_object)
    and isinstance(v.get("candidate_pools"), list)
    and isinstance(v.get("resolvable"), list)
    and is_object(v.get("formats"))
    and is_object(v.get("headroom")),
    "reports": _reports_ok,
}


DB_HINTS = {
    "google_account": 'object with at least an "email" string',
    "auth_roles": "non-empty array of { role_id, label }",
    "credentials": "array of { project_id, credential_handle }",
    "projects": "non-empty array of { project_id, datasets: [{ dataset_id, tables: [{ table_id, label, grain }] }] }",
    "drive_credentials": "array of { drive_id, credential_handle }",
    "drives": "non-empty array of { drive_id, folders: [{ folder_id, documents: [{ document_id, doc_type, doc_type_label, linked_entity }] }] }",
    "audit": "object with stats[], events[], policies[]",
    "traces": "object with stats[], items[]",
    "evals": "object with stats[], runs[], checks[]",
    "change_signals": "array",
    "column_vocabulary": "non-empty array of { name, type, class }",
    "document_vocabulary": "non-empty array of { name, type, class }",
    "column_profiles": 'object keyed "<dataset>.<table>", each a non-empty array of { column_id, label, type, class, description, derivation, confidence, pii, null_pct, distinct }',
    "document_extractions": "object keyed by document_id, each { extraction_id, extracted_entity, entity_type, resolved_node, resolved_facility, state, linked_manifests, confidence }",
    "ask_answers": "non-empty array of { answer_id, question, summary, blocks[], evidence[], confidence } — the recorded answers Ask serves",
    "graph_domains": "non-empty array of { domain_id, name }",
    "graph_personas": "non-empty array of { persona_id, name }",
    "graph_kpis": "non-empty array of { kpi_id, name }",
    "graph_hero_questions": "non-empty array of { question_id, text }",
    "graph_answer_formats": "non-empty array of { format_id, name }",
    "graph_use_case_templates": "array of { template_id, name, match_phrases[], personas[], kpis[], hero_questions[] }",
    "graph_use_cases": "array of { use_case_id, name }",
    "graph_studio": "object with review_items[], generated{}, pivot{}, canvas{ nodes[], edges[] }, sanity_checks[]",
    "whatif": "object with facility{}, generators[], watched_measures[], candidate_pools[], formats{}, resolvable[], headroom{}",
    "reports": "object with meta{}, fields[], assumptions{}, opts{}, slice_default[], summary_catalog[], summary_default[], saved[], data{}, reports[] and governance{}",
}


def validate_db(candidate: Json) -> list[str]:
    problems: list[str] = []
    if not is_object(candidate):
        return ["the document must be a JSON object"]

    for key, check in DB_SHAPE.items():
        if key not in candidate:
            problems.append(f'"{key}" is missing — {DB_HINTS[key]}')
        elif not check(candidate[key]):
            problems.append(f'"{key}" is the wrong shape — expected {DB_HINTS[key]}')

    if problems:
        return problems

    problems += _check_canvas(candidate)
    if problems:
        return problems
    problems += _check_drives(candidate)
    if problems:
        return problems
    problems += _check_whatif(candidate)
    if problems:
        return problems
    problems += _check_reports(candidate)
    if problems:
        return problems
    problems += _check_templates(candidate)
    return problems


def _check_canvas(candidate: Json) -> list[str]:
    """An edge whose endpoint is not a node is skipped while drawing, silently —
    20 of them once made 17 facilities appear to have no enforcement."""
    problems = []
    canvas = candidate["graph_studio"]["canvas"]
    node_ids = {n.get("node_id") for n in canvas["nodes"]}
    for e in canvas["edges"]:
        for side in ("from", "to"):
            end = e.get(side)
            if end not in node_ids:
                problems.append(
                    f'graph_studio.canvas has an edge whose {side} is "{end}", which is not '
                    "a node — add the node or remove the edge, or it will be drawn as nothing"
                )
    edge_ids = {e.get("edge_id") for e in canvas["edges"]}
    for check in candidate["graph_studio"]["sanity_checks"]:
        for node_id in check.get("path") or []:
            if node_id not in node_ids:
                problems.append(
                    f'graph_studio.sanity_checks "{check.get("check_id")}" walks node '
                    f'"{node_id}", which is not on the canvas — re-ingest rather than '
                    "editing either by hand"
                )
        for edge_id in check.get("edges_used") or []:
            if edge_id not in edge_ids:
                problems.append(
                    f'graph_studio.sanity_checks "{check.get("check_id")}" walks edge '
                    f'"{edge_id}", which is not on the canvas — re-ingest rather than '
                    "editing either by hand"
                )
    return problems


def _check_drives(candidate: Json) -> list[str]:
    """A parent that is not a folder of the same drive draws the child at the
    root, which reads as an allowlist covering more than it does; a cycle leaves
    it off the tree entirely. Neither throws."""
    problems = []
    for drive in candidate["drives"]:
        own = {f["folder_id"]: f for f in drive["folders"]}
        for folder in drive["folders"]:
            parent_id = folder.get("parent_id")
            if parent_id is not None and parent_id not in own:
                problems.append(
                    f'drive "{drive["drive_id"]}" folder "{folder["folder_id"]}" names parent '
                    f'"{parent_id}", which is not a folder of that drive — it would be drawn '
                    "at the root instead"
                )
                continue
            seen = {folder["folder_id"]}
            cursor = parent_id
            while cursor is not None:
                if cursor in seen:
                    problems.append(
                        f'drive "{drive["drive_id"]}" folder "{folder["folder_id"]}" is its own '
                        "ancestor — a cycle in parent_id leaves the folder off the tree entirely"
                    )
                    break
                seen.add(cursor)
                cursor = own.get(cursor, {}).get("parent_id")
    return problems


def _check_whatif(candidate: Json) -> list[str]:
    problems = []
    w = candidate["whatif"]
    gen_fields = set(w["generators"][0].keys())
    measure_keys = {m.get("key") for m in w["watched_measures"]}

    for m in w["watched_measures"]:
        if m.get("field") not in gen_fields:
            problems.append(
                f'whatif.watched_measures "{m.get("key")}" reads generator field '
                f'"{m.get("field")}", which no generator carries — it would show as no '
                "inherited risk rather than as an error"
            )
        if m.get("format") not in w["formats"]:
            problems.append(
                f'whatif.watched_measures "{m.get("key")}" wants format "{m.get("format")}", '
                "which whatif.formats does not define — its figure would print raw"
            )

    for p in w["candidate_pools"]:
        f = p.get("filter")
        if f and f.get("field") not in gen_fields:
            problems.append(
                f'whatif.candidate_pools "{p.get("key")}" filters on "{f.get("field")}", which '
                'no generator carries — the pool would offer nobody, which reads as "none qualify"'
            )
        if p.get("key") not in w["headroom"]:
            problems.append(
                f'whatif.headroom has no entry for pool "{p.get("key")}" — the inverse question '
                'would print an em dash, which reads as "no limit"'
            )

    for r in w["resolvable"]:
        if r.get("resolves_to") is not None and r["resolves_to"] not in measure_keys:
            keyword = (r.get("keywords") or [None])[0]
            problems.append(
                f'whatif.resolvable "{keyword}" resolves to "{r["resolves_to"]}", which is not a '
                "watched measure — authoring would report success and add nothing"
            )

    pub = w.get("publishing")
    freshness = (pub or {}).get("freshness") or {}
    presets = freshness.get("presets")
    if not pub or not isinstance(presets, list) or not presets:
        problems.append(
            "whatif.publishing declares no freshness presets — the publish dialog would offer "
            "an empty schedule control"
        )
    else:
        for p in presets:
            if not p.get("sentence"):
                problems.append(
                    f'whatif.publishing freshness preset "{p.get("id")}" states no sentence — '
                    'picking it would print a blank recurrence line, which reads as "no schedule"'
                )
        default = (freshness.get("default") or {}).get("preset")
        if not any(p.get("id") == default for p in presets):
            problems.append(
                f'whatif.publishing freshness default names preset "{default}", which is not '
                "offered — the dialog would open on nothing"
            )
        if not (pub.get("readers") or {}).get("empty_error") or not freshness.get("no_day_error"):
            problems.append(
                "whatif.publishing is missing a refusal sentence (readers.empty_error / "
                "freshness.no_day_error) — the publish route sends those verbatim, so a "
                "refusal would arrive blank"
            )
    return problems


def _check_reports(candidate: Json) -> list[str]:
    problems = []
    rep = candidate["reports"]
    field_keys = {f.get("key") for f in rep["fields"]}

    for r in rep["reports"]:
        rows = rep["data"].get(r["spine"])
        if not isinstance(rows, list):
            problems.append(
                f'reports "{r["report_id"]}" reads spine "{r["spine"]}", which reports.data '
                "does not have — its report would render its tiles above an empty table"
            )
            continue
        row_keys = set(rows[0].keys())

        if r.get("scope") not in REPORT_SCOPES:
            problems.append(
                f'reports "{r["report_id"]}" is scoped "{r.get("scope")}", which this server has '
                f"no filter for — known scopes: {', '.join(REPORT_SCOPES)}"
            )
        label_key = REPORT_LABEL_KEY.get(r["spine"])
        if not label_key:
            problems.append(
                f'reports.data."{r["spine"]}" has no label column declared, so every chart bar '
                "and table row on that spine would be unnamed"
            )
        elif label_key not in row_keys:
            problems.append(
                f'reports.data."{r["spine"]}" rows do not carry "{label_key}", the column their '
                "labels come from"
            )

        for block in r["blocks"]:
            if block.get("type") == "chart" and block.get("measure") not in row_keys:
                problems.append(
                    f'reports "{r["report_id"]}" charts "{block.get("measure")}", which its '
                    f"{r['spine']} rows do not carry — every bar would be zero, which reads as "
                    "no exposure"
                )
            if block.get("type") == "quarterly" and block.get("metric") not in row_keys:
                problems.append(
                    f'reports "{r["report_id"]}" trends "{block.get("metric")}", which its '
                    f"{r['spine']} rows do not carry"
                )
            for col in block.get("cols", []) if block.get("type") == "table" else []:
                if col not in field_keys or col not in row_keys:
                    why = (
                        f"its {r['spine']} rows do not carry"
                        if col in field_keys
                        else "reports.fields does not describe"
                    )
                    problems.append(
                        f'reports "{r["report_id"]}" tabulates "{col}", which {why} — the column '
                        "would render with blank cells"
                    )

        for key in r.get("summary_keys") or []:
            if not any(t.get("key") == key for t in rep["summary_catalog"]):
                problems.append(
                    f'reports "{r["report_id"]}" summarises "{key}", which '
                    "reports.summary_catalog does not define"
                )

    for s in rep.get("saved") or []:
        if not any(r["report_id"] == s.get("report_id") for r in rep["reports"]):
            problems.append(
                f'reports.saved "{s.get("name") or s.get("saved_id")}" is saved against report '
                f'"{s.get("report_id")}", which no longer exists — it would open onto nothing'
            )
        if s.get("scope") not in REPORT_SCOPES:
            problems.append(
                f'reports.saved "{s.get("name") or s.get("saved_id")}" is scoped '
                f'"{s.get("scope")}", which this server has no filter for'
            )
    return problems


def _check_templates(candidate: Json) -> list[str]:
    """A template holds nothing but ids into three pools. An id that does not
    resolve drops out of the bundle, so the step drafts five personas where the
    use case names six — a short list reads as an answer."""
    problems = []
    for template in candidate["graph_use_case_templates"]:
        for member_key, pool_key, id_key in (
            ("personas", "graph_personas", "persona_id"),
            ("kpis", "graph_kpis", "kpi_id"),
            ("hero_questions", "graph_hero_questions", "question_id"),
        ):
            for member_id in template[member_key]:
                if not any(entry.get(id_key) == member_id for entry in candidate[pool_key]):
                    problems.append(
                        f'graph_use_case_templates "{template["template_id"]}" names '
                        f'{member_key[:-1]} "{member_id}", which is not in {pool_key}'
                    )
    return problems


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
def validate_settings(document: Json, candidate: Json) -> list[str]:
    problems: list[str] = []
    if not is_object(candidate):
        return ["settings must be a JSON object"]

    role_ids = [r["role_id"] for r in document.get("auth_roles", [])]
    users = candidate.get("users")
    defaults = candidate.get("defaults")
    read_only = candidate.get("read_only")
    perms = candidate.get("nav_permissions")

    if not isinstance(users, list) or not users:
        problems.append('"users" must be a non-empty array — the login resolves a role from it')
    else:
        for u in users:
            if not is_object(u) or not u.get("email") or not u.get("name") or not u.get("role_id"):
                problems.append("every user needs { id, name, email, role_id }")
                continue
            if u["role_id"] not in role_ids:
                problems.append(
                    f'user "{u["email"]}" is role "{u["role_id"]}", which auth_roles does not '
                    f"have ({', '.join(role_ids)})"
                )
        seen = [str(u.get("email", "")).lower() for u in users]
        if len(set(seen)) != len(seen):
            problems.append("two users share an email — the login resolves a role by address")

    for label, block in (("defaults", defaults), ("nav_permissions", perms)):
        if not is_object(block):
            problems.append(f'"{label}" must be an object keyed by role_id')
            continue
        for role_id in role_ids:
            if not is_object(block.get(role_id)):
                problems.append(f'"{label}" has no entry for persona "{role_id}"')
        for role_id, entry in block.items():
            if role_id not in role_ids:
                problems.append(f'"{label}" names persona "{role_id}", which is not one')
            if not is_object(entry):
                continue
            for key, value in entry.items():
                if not isinstance(value, bool):
                    problems.append(f'"{label}.{role_id}.{key}" must be true or false')

    if is_object(defaults) and is_object(perms):
        for role_id in role_ids:
            a = sorted((defaults.get(role_id) or {}).keys())
            b = sorted((perms.get(role_id) or {}).keys())
            missing = [k for k in a if k not in b]
            extra = [k for k in b if k not in a]
            if missing or extra:
                problems.append(
                    f'"{role_id}" has different navigation keys in defaults and nav_permissions'
                    + (f" (missing: {', '.join(missing)})" if missing else "")
                    + (f" (unknown: {', '.join(extra)})" if extra else "")
                )

    if not is_object(read_only):
        problems.append('"read_only" must be an object keyed by role_id')
    else:
        for role_id, keys in read_only.items():
            if role_id not in role_ids:
                problems.append(f'"read_only" names persona "{role_id}", which is not one')
            if not isinstance(keys, list):
                problems.append(f'"read_only.{role_id}" must be an array of navigation keys')
                continue
            for key in keys:
                if (perms or {}).get(role_id, {}).get(key) is not True:
                    problems.append(
                        f'"{role_id}" locks "{key}" but it is not on — a locked-off item can '
                        "never be granted"
                    )
                if (defaults or {}).get(role_id, {}).get(key) is not True:
                    problems.append(
                        f'"{role_id}" locks "{key}" but its default is off — Reset would make '
                        "it unreachable"
                    )

    if is_object(perms) and not any(
        is_object(p) and p.get("settings") is True for p in perms.values()
    ):
        problems.append('no persona has "settings" — nobody could open the page that grants it')

    return problems
