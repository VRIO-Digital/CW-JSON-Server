"""
Reports.

**A report is a question re-asked, not a stored table.** Nothing here stores a
result: the database holds four rosters, a field dictionary, the assumptions a
report is read under, and each report's *definition*. Every figure — each
chart's series, each table's order, every count on a card — is computed per
request. Arithmetic on a measure in a component would be a second source for it.

**A report is asked of a published graph.** A frame naming one that is not live
is refused, naming the ones that are: defaulting to whatever is newest would
attribute the figures to content nobody picked.
"""

from __future__ import annotations

from typing import Any, Callable

from ..core import round_js
from ..runtime import Ctx
from .studio import (
    ASK_MATCH_MIN,
    ask_tokens,
    built_graphs,
    published_by_for,
    published_version,
)

# ---------------------------------------------------------------------------
# Scopes, labels and rosters
# ---------------------------------------------------------------------------
REPORT_SCOPES: dict[str, Callable[[list[dict]], list[dict]]] = {
    "all": lambda rows: rows,
    "cd": lambda rows: [r for r in rows if r.get("cd") is True],
    "enf": lambda rows: [r for r in rows if (r.get("enf") or 0) > 0],
    "oos": lambda rows: [r for r in rows if r.get("state") != "TX"],
}

REPORT_LABEL_KEY = {
    "generators": "generator",
    "facilities": "facility",
    "quarters": "quarter",
    "traces": "mtn",
}

# Headers for the three rosters the field dictionary does not describe. Headers
# and nothing more: no figure, no claim. The alternative is a header reading
# `gen_state`.
REPORT_LABELS = {
    "facility": "Facility",
    "role": "Role",
    "last_eval": "Last evaluation",
    "quarter": "Quarter",
    "rej": "Rejected loads",
    "res": "Residue manifests",
    "mtn": "Manifest tracking number",
    "gen_state": "Generator state",
    "shipped": "Shipped",
    "received": "Received",
    "days": "Days in possession",
    "transporters": "Custody chain",
    "residue": "Residue",
    "rejected": "Rejected",
    "status": "Status",
}

REPORT_FLAG_TESTS: dict[str, Callable[[dict], bool]] = {
    "rejected": lambda t: t.get("rejected") == "Y",
    "residue": lambda t: t.get("residue") == "Y",
    "out_of_state": lambda t: t.get("gen_state") != "TX",
}

FACET_LABELS = {"role": "Role", "year": "Year", "flag": "Show"}

REPORT_HORIZON_CAVEAT = (
    "The time window is part of the question as stated, not a filter that ran: these "
    "rosters are cumulative — the register carries a generator’s whole federal history and "
    "the quarterly roster is the full 2023–2026 window. Every figure below is over all of it."
)


# ---------------------------------------------------------------------------
# Published graphs — the section's one gate
# ---------------------------------------------------------------------------
def published_graphs(ctx: Ctx) -> list[dict[str, Any]]:
    rows = []
    for use_case in built_graphs(ctx):
        published = published_version(ctx, use_case["use_case_id"])
        if published is not None:
            rows.append({"use_case": use_case, "published": published})
    rows.sort(key=lambda r: r["published"].get("created_at") or "", reverse=True)
    return rows


def report_graphs(ctx: Ctx) -> list[dict[str, Any]]:
    return [
        {
            "use_case_id": r["use_case"]["use_case_id"],
            "name": r["use_case"]["name"],
            "domain_id": r["use_case"].get("domain_id"),
            "version": r["published"]["config_version"],
            "sha256": r["published"]["sha256"],
            "built_at": r["published"].get("created_at"),
            "published_by": published_by_for(ctx, r["use_case"]["use_case_id"]),
            "entity_count": r["published"].get("entities"),
            "relationship_count": r["published"].get("relationships"),
        }
        for r in published_graphs(ctx)
    ]


def report_graph(ctx: Ctx) -> dict[str, Any] | None:
    graphs = report_graphs(ctx)
    return graphs[0] if graphs else None


def report_graph_for(ctx: Ctx, use_case_id: str | None) -> dict[str, Any] | None:
    """A row whose graph is no longer published still answers and says so, rather
    than claiming live content."""
    if not use_case_id:
        return None
    live = next((g for g in report_graphs(ctx) if g["use_case_id"] == use_case_id), None)
    if live:
        return {**live, "live": True}
    use_case = next(
        (u for u in ctx.doc["graph_use_cases"] if u["use_case_id"] == use_case_id), None
    )
    if not use_case:
        return None
    return {
        "use_case_id": use_case["use_case_id"],
        "name": use_case["name"],
        "domain_id": use_case.get("domain_id"),
        "version": None,
        "sha256": None,
        "built_at": None,
        "published_by": None,
        "entity_count": None,
        "relationship_count": None,
        "live": False,
    }


def report_graph_counts(ctx: Ctx) -> dict[str, int]:
    """"Publish the build you have" and "finish a draft" are different fixes, so
    the empty page has to name the right one."""
    built = built_graphs(ctx)
    return {
        "published_count": len(published_graphs(ctx)),
        "built_count": len(built),
        "draft_count": len(ctx.doc["graph_use_cases"]) - len(built),
    }


# ---------------------------------------------------------------------------
# Fields, columns and rows
# ---------------------------------------------------------------------------
def report_field(ctx: Ctx, key: str) -> dict | None:
    return next((f for f in ctx.doc["reports"]["fields"] if f["key"] == key), None)


def report_label(ctx: Ctx, key: str) -> str:
    field = report_field(ctx, key)
    if field and field.get("label"):
        return field["label"]
    return REPORT_LABELS.get(key, key)


def report_kind(ctx: Ctx, key: str, rows: list[dict]) -> str:
    field = report_field(ctx, key)
    if field and field.get("kind"):
        return field["kind"]
    first = rows[0] if rows else {}
    return "num" if isinstance(first.get(key), (int, float)) and not isinstance(first.get(key), bool) else "cat"


def report_columns(ctx: Ctx, keys: list[str], rows: list[dict]) -> list[dict[str, Any]]:
    return [
        {"key": key, "label": report_label(ctx, key), "kind": report_kind(ctx, key, rows)}
        for key in keys
    ]


def report_rows(ctx: Ctx, report: dict) -> list[dict]:
    if report.get("rows") is not None:
        return report["rows"]
    return REPORT_SCOPES[report["scope"]](ctx.doc["reports"]["data"][report["spine"]])


def _num(value: Any) -> float:
    try:
        if isinstance(value, bool):
            return 1.0 if value else 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _int_format(value: float) -> str:
    return f"{round(value):,}"


# ---------------------------------------------------------------------------
# Charts — emitted in AnswerChart's payload shape
# ---------------------------------------------------------------------------
def report_share_chart(ctx: Ctx, field: str, title: str, note: str) -> dict[str, Any] | None:
    """The split of the whole register by compliance status — the figure the tile
    beside it states, drawn as a ring."""
    rows = ctx.doc["reports"]["data"]["generators"]
    carrying = [r for r in rows if _num(r.get("viols")) > 0]
    clean = [r for r in rows if _num(r.get("viols")) == 0]
    if not carrying or not clean:
        return None

    def total(rows_in: list[dict]) -> float:
        return sum(_num(r.get(field)) for r in rows_in)

    return {
        "type": "chart",
        "chart": "donut",
        "title": title,
        "width": 420,
        "x_label": "Compliance status",
        "y_label": report_label(ctx, field),
        "series": None,
        "data": [
            {
                "label": "From open-violation generators",
                "value": total(carrying),
                "tone": None,
                "values": None,
            },
            {
                "label": "From clean-record generators",
                "value": total(clean),
                "tone": None,
                "values": None,
            },
        ],
        "note": note,
    }


def report_grouped_chart(ctx: Ctx, report: dict, keys: list[str], title: str) -> dict[str, Any]:
    """One hue per magnitude is the rule, so a grouped chart carries a legend."""
    rows = report_rows(ctx, report)
    label_key = REPORT_LABEL_KEY[report["spine"]]
    return {
        "type": "chart",
        "chart": "grouped",
        "title": title,
        "width": 900,
        "x_label": report_label(ctx, label_key),
        "y_label": None,
        "series": [{"key": key, "label": report_label(ctx, key)} for key in keys],
        "data": [
            {
                "label": str(r[label_key]),
                "values": {key: _num(r.get(key)) for key in keys},
                "value": _num(r.get(keys[0])),
                "tone": None,
            }
            for r in rows
        ],
        "note": None,
    }


def report_chart(
    ctx: Ctx, report: dict, measure: str, title: str, form: str = "bar"
) -> dict[str, Any]:
    """Rows carrying nothing are dropped rather than drawn as zero-length bars,
    and the note says how many — **no cap is silent**."""
    rows = report_rows(ctx, report)
    label_key = REPORT_LABEL_KEY[report["spine"]]
    carrying = [r for r in rows if _num(r.get(measure)) > 0]

    if form == "line":
        ordered = rows
        dropped = 0
    else:
        ordered = sorted(carrying, key=lambda r: -_num(r.get(measure)))
        dropped = len(rows) - len(carrying)

    def tone(r: dict) -> str | None:
        return {"high": "crit", "med": "warn", "low": "good"}.get(r.get("risk"))

    note = None
    if dropped > 0:
        spine_label = (
            ctx.doc["reports"]["meta"]["entity_plural"]
            if report["spine"] == "generators"
            else report["spine"]
        )
        note = (
            f"{len(ordered)} of {len(rows)} {spine_label} carry "
            f"{report_label(ctx, measure).lower()} on record; the other {dropped} are at zero."
        )

    return {
        "type": "chart",
        "chart": form,
        "title": title,
        "x_label": report_label(ctx, label_key),
        "y_label": report_label(ctx, measure),
        "data": [
            {"label": str(r[label_key]), "value": _num(r.get(measure)), "tone": tone(r)}
            for r in ordered
        ],
        "width": 900,
        "note": note,
    }


def report_block(ctx: Ctx, report: dict, block: dict) -> dict[str, Any]:
    """Five block kinds, and the payload states what each draws.

    The package's bar/column distinction collapses by row count — six rows or
    fewer are drawn as columns, a long register as horizontal bars, whatever the
    block asks for.
    """
    rows = report_rows(ctx, report)

    if block["type"] == "chart":
        form = "column" if len(rows) <= 6 else "bar"
        main = report_chart(ctx, report, block["measure"], block["title"], form)
        share = None
        if report["scope"] != "all" and report["spine"] == "generators":
            share = report_share_chart(
                ctx,
                block["measure"],
                f"Inbound {report_label(ctx, block['measure']).lower()} by generator "
                "compliance status",
                "Share of the whole register, not of this report’s rows — the question a "
                "scoped report raises.",
            )
        return {**main, "companion": share} if share else main

    if block["type"] == "table":
        sort_key = report["measure"] if report["measure"] in block["cols"] else None
        ordered = (
            sorted(rows, key=lambda r: -_num(r.get(sort_key))) if sort_key else rows
        )
        return {
            "type": "table",
            "title": block["title"],
            "columns": report_columns(ctx, block["cols"], rows),
            "rows": ordered,
            "sorted_by": report_label(ctx, sort_key) if sort_key else None,
        }

    if block["type"] == "facilities":
        keys = list(rows[0].keys()) if rows else []
        pair = [key for key in ("evals", "viols") if key in keys]
        if len(pair) > 1:
            title = f"{' & '.join(report_label(ctx, key) for key in pair)} by facility"
            charts = [report_grouped_chart(ctx, report, pair, title)]
        else:
            charts = [
                report_chart(ctx, report, key, f"{report_label(ctx, key)} by facility")
                for key in pair
            ]
        return {
            "type": "facilities",
            "title": block["title"],
            "columns": report_columns(ctx, keys, rows),
            "rows": rows,
            "subject": report.get("subject"),
            "charts": charts,
        }

    if block["type"] == "quarterly":
        keys = list(rows[0].keys()) if rows else []
        charts = [
            report_chart(
                ctx,
                report,
                block["metric"],
                f"{report_label(ctx, block['metric'])} by quarter",
                "line",
            )
        ]
        if block["metric"] != "manifests" and "manifests" in (rows[0] if rows else {}):
            charts.append(
                report_chart(
                    ctx,
                    report,
                    "manifests",
                    f"{report_label(ctx, 'manifests')} by quarter",
                    "column",
                )
            )
        return {
            "type": "quarterly",
            "title": block["title"],
            "columns": report_columns(ctx, keys, rows),
            "rows": rows,
            "charts": charts,
        }

    # A manifest's transporters are *ordered*, and an order laid into a cell
    # reads as a set.
    keys = list(rows[0].keys()) if rows else []
    return {
        "type": "traces",
        "title": block["title"],
        "columns": report_columns(ctx, keys, rows),
        "rows": rows,
    }


# ---------------------------------------------------------------------------
# Summary tiles — ten tiles expressed as data
# ---------------------------------------------------------------------------
REPORT_AGGS: dict[str, Callable[[list[dict], str], float]] = {
    "rows": lambda rows, field: len(rows),
    "sum": lambda rows, field: sum(_num(r.get(field)) for r in rows),
    "count_positive": lambda rows, field: sum(1 for r in rows if _num(r.get(field)) > 0),
    "count_true": lambda rows, field: sum(1 for r in rows if r.get(field) is True),
    "count_high": lambda rows, field: sum(1 for r in rows if r.get(field) == "high"),
    "count_out_of_state": lambda rows, field: sum(1 for r in rows if r.get(field) != "TX"),
}

REPORT_FORMATS: dict[str, Callable[[float], str]] = {
    "int": lambda v: _int_format(v),
    "money": lambda v: f"${_int_format(v)}",
    "tons": lambda v: f"{round_js(float(v), 1):,} t".replace(".0 t", " t"),
}


def report_summary(ctx: Ctx, keys: list[str], rows: list[dict]) -> list[dict[str, Any]]:
    catalog = ctx.doc["reports"]["summary_catalog"]
    out = []
    for key in keys:
        tile = next((t for t in catalog if t["key"] == key), None)
        if not tile:
            continue
        value = REPORT_AGGS[tile["agg"]](rows, tile["field"])
        out.append(
            {
                "label": tile["label"],
                "value": REPORT_FORMATS[tile["format"]](value),
                "unit": "computed for this frame",
                "tone": tile["tone"],
            }
        )
    return out


# ---------------------------------------------------------------------------
# The frame — the question, in values
# ---------------------------------------------------------------------------
def report_frame_from(body: dict) -> dict[str, Any]:
    return {
        "report_id": str(body.get("report_id") or ""),
        "use_case_id": str(body["use_case_id"]) if body.get("use_case_id") else None,
        "scope": str(body.get("scope") or ""),
        "measure": str(body.get("measure") or ""),
        "horizon": str(body.get("horizon") or ""),
        "filters": body["filters"] if isinstance(body.get("filters"), list) else [],
    }


def report_facet_label(key: str, value: Any) -> str:
    if key == "cd":
        return "Yes" if str(value) == "true" else "No"
    return str(value)


def report_facets_for(ctx: Ctx, spine: str) -> list[dict[str, Any]]:
    """**Facets are per spine.** The register's are declared; the other three are
    derived from the column that distinguishes their rows — a facility's `role`,
    a quarter's `year`, a trace's `flag`."""
    rows = ctx.doc["reports"]["data"].get(spine) or []

    def facet(key: str, label: str, values: list[dict]) -> dict[str, Any]:
        return {"key": key, "label": label, "values": [v for v in values if v["count"] > 0]}

    def distinct(pick: Callable[[dict], Any]) -> list[str]:
        return sorted({str(pick(r)) for r in rows})

    if spine == "generators":
        out = []
        for key in ctx.doc["reports"]["slice_default"]:
            field = report_field(ctx, key)
            if not field or not field.get("filterable"):
                continue
            values = [
                {
                    "value": value,
                    "label": report_facet_label(field["key"], value),
                    "count": sum(1 for g in rows if str(g.get(field["key"])) == value),
                }
                for value in distinct(lambda g: g.get(field["key"]))
            ]
            out.append(facet(field["key"], field["label"], values))
        return [f for f in out if len(f["values"]) > 1]

    if spine == "facilities":
        out = [
            facet(
                "role",
                FACET_LABELS["role"],
                [
                    {
                        "value": value,
                        "label": value,
                        "count": sum(1 for f in rows if f.get("role") == value),
                    }
                    for value in distinct(lambda f: f.get("role"))
                ],
            )
        ]
        return [f for f in out if len(f["values"]) > 1]

    if spine == "quarters":
        out = [
            facet(
                "year",
                FACET_LABELS["year"],
                [
                    {
                        "value": value,
                        "label": value,
                        "count": sum(1 for q in rows if str(q["quarter"]).startswith(value)),
                    }
                    for value in distinct(lambda q: str(q["quarter"])[:4])
                ],
            )
        ]
        return [f for f in out if len(f["values"]) > 1]

    if spine == "traces":
        flags = [
            {"value": "rejected", "label": "Rejected", "test": REPORT_FLAG_TESTS["rejected"]},
            {"value": "residue", "label": "Residue", "test": REPORT_FLAG_TESTS["residue"]},
            {
                "value": "out_of_state",
                "label": "Out-of-state",
                "test": REPORT_FLAG_TESTS["out_of_state"],
            },
        ]
        out = [
            facet(
                "flag",
                FACET_LABELS["flag"],
                [
                    {
                        "value": f["value"],
                        "label": f["label"],
                        "count": sum(1 for r in rows if f["test"](r)),
                    }
                    for f in flags
                ],
            )
        ]
        return [f for f in out if len(f["values"]) > 0]

    return []


def report_facets(ctx: Ctx) -> list[dict[str, Any]]:
    return report_facets_for(ctx, "generators")


def report_frame_problem(ctx: Ctx, frame: dict) -> str | None:
    """Asks the same `report_facets_for` the facets came from, so a filter a UI
    could offer cannot be one the API refuses."""
    rep = ctx.doc["reports"]
    report = next((r for r in rep["reports"] if r["report_id"] == frame["report_id"]), None)
    if not report:
        known = ", ".join(r["report_id"] for r in rep["reports"])
        return f'no report "{frame["report_id"]}" — this section has {known}'

    if frame["use_case_id"]:
        published = report_graphs(ctx)
        if not any(g["use_case_id"] == frame["use_case_id"] for g in published):
            if not published:
                return "no graph is published — publish one in Graph Studio, then ask it"
            names = ", ".join(g["use_case_id"] for g in published)
            return (
                f'"{frame["use_case_id"]}" is not a published graph — published: {names}'
            )

    for slot in ("scope", "measure", "horizon"):
        value = frame[slot]
        options = rep["opts"][slot]["options"]
        if not any(o["value"] == value for o in options):
            offered = ", ".join(o["value"] for o in options)
            return f'"{value}" is not one of the {slot} options — pick one of {offered}'

    facets = report_facets_for(ctx, report["spine"])
    for f in frame.get("filters") or []:
        facet = next((x for x in facets if x["key"] == f.get("key")), None)
        if not facet:
            offered = ", ".join(x["key"] for x in facets) or "nothing"
            return (
                f'"{f.get("key")}" cannot be filtered on for {report["spine"]} — this report '
                f"slices by {offered}"
            )
        if not any(v["value"] == str(f.get("value")) for v in facet["values"]):
            offered = ", ".join(v["value"] for v in facet["values"])
            return (
                f'"{f.get("value")}" is not a {f.get("key")} in this report — it has {offered}'
            )
    return None


def report_frame_rows(ctx: Ctx, report: dict, frame: dict) -> list[dict]:
    rows = REPORT_SCOPES[frame["scope"]](ctx.doc["reports"]["data"][report["spine"]])
    for f in frame.get("filters") or []:
        if f.get("key") == "flag":
            test = REPORT_FLAG_TESTS.get(str(f.get("value")))
            rows = [r for r in rows if test(r)] if test else rows
        else:
            rows = [r for r in rows if str(r.get(f["key"])) == str(f["value"])]
    return rows


def report_frame_asked(ctx: Ctx, report: dict, frame: dict) -> dict[str, Any]:
    def label(slot: str, value: str) -> str | None:
        return next(
            (
                o["label"]
                for o in ctx.doc["reports"]["opts"][slot]["options"]
                if o["value"] == value
            ),
            None,
        )

    return {
        **report,
        "scope": frame["scope"],
        "measure": frame["measure"],
        "scope_label": label("scope", frame["scope"]) or report.get("scope_label"),
        "measure_label": label("measure", frame["measure"]) or report.get("measure_label"),
        "horizon_label": label("horizon", frame["horizon"]),
        "graph": report_graph_for(ctx, frame["use_case_id"]) or report_graph(ctx),
        "rows": report_frame_rows(ctx, report, frame),
    }


def report_reading(ctx: Ctx, report: dict) -> dict[str, Any]:
    used = []
    for slot in report["reading"]["slots"]:
        if slot == "scope":
            label = report.get("scope_label")
        elif slot == "measure":
            label = report.get("measure_label")
        else:
            label = report.get("horizon_label") or ctx.doc["reports"]["assumptions"][slot]["label"]
        used.append({"slot": slot, "label": label})

    text = report["reading"]["template"]
    for entry in used:
        text = text.replace(f"{{{entry['slot']}}}", str(entry["label"]))
    return {"text": text, "assumptions": used}


def report_view(ctx: Ctx, report: dict) -> dict[str, Any]:
    reading = report_reading(ctx, report)
    opts = ctx.doc["reports"]["opts"]
    assumptions = ctx.doc["reports"]["assumptions"]

    if report.get("horizon_label"):
        horizon = next(
            (
                o["value"]
                for o in opts["horizon"]["options"]
                if o["label"] == report["horizon_label"]
            ),
            assumptions["horizon"]["value"],
        )
    else:
        horizon = assumptions["horizon"]["value"]

    return {
        "report_id": report["report_id"],
        "report_tag": report.get("report_tag"),
        "heading": report.get("heading"),
        "subtitle": report.get("subtitle"),
        "badge": report.get("badge"),
        "note": report.get("note"),
        "title": report.get("title"),
        "question": report.get("question"),
        "spine": report["spine"],
        "row_count": len(report_rows(ctx, report)),
        "spine_total": len(ctx.doc["reports"]["data"][report["spine"]]),
        "reading": reading["text"],
        "assumptions": reading["assumptions"],
        "frame": {
            "report_id": report["report_id"],
            "use_case_id": (report.get("graph") or {}).get("use_case_id")
            or (report_graph(ctx) or {}).get("use_case_id"),
            "scope": report["scope"],
            "measure": report["measure"],
            "horizon": horizon,
            "filters": [
                {"key": f["key"], "value": str(f["value"])}
                for f in report.get("applied_filters") or []
            ],
        },
        "facets": report_facets_for(ctx, report["spine"]),
        "tiles": report.get("tiles"),
        "footer": report.get("footer"),
        "blocks": [report_block(ctx, report, block) for block in report["blocks"]],
        "source_trace": ctx.doc["reports"]["meta"]["source_trace"],
        "graph": report.get("graph") or report_graph(ctx),
    }


def report_build(ctx: Ctx, report: dict, frame: dict) -> dict[str, Any]:
    """**`variant` is the honesty of the flow.** `written` when the frame is the
    one the report was written for, so the authored tiles still describe it;
    `generated` otherwise — and a generated report's tiles are recomputed and
    carry "computed for this frame". The tenant's authored figures are never
    returned against a frame they do not describe."""
    written = (
        frame["scope"] == report["scope"]
        and frame["measure"] == report["measure"]
        and len(frame.get("filters") or []) == 0
    )
    asked = {
        **report_frame_asked(ctx, report, frame),
        "applied_filters": frame.get("filters") or [],
    }

    if written:
        tiles = report["tiles"]
    else:
        keys = (
            report["summary_keys"]
            if report.get("summary_keys")
            else ctx.doc["reports"]["summary_default"]
        )
        tiles = report_summary(ctx, keys, asked["rows"])

    caveats = [REPORT_HORIZON_CAVEAT]
    graph = asked.get("graph")
    if graph and graph.get("live") is False:
        caveats.append(
            f"This was saved against {graph['name']}, which is not published right now. "
            "The figures are current — they come from the connected rosters — but nothing "
            "live answered it. Publish that graph again in Graph Studio to restore the link."
        )

    return {
        **report_view(ctx, asked),
        "variant": "written" if written else "generated",
        "filters": [
            {
                "key": f["key"],
                "label": report_label(ctx, f["key"]),
                "value": str(f["value"]),
                "value_label": report_facet_label(f["key"], f["value"]),
            }
            for f in frame.get("filters") or []
        ],
        "tiles": tiles,
        "summary_note": None
        if written or report["spine"] == "generators"
        else f"This summary is only defined for the "
        f"{ctx.doc['reports']['meta']['entity_plural']} register, so a re-asked "
        f"{report['spine']} report states none.",
        "caveats": caveats,
    }


def report_build_reading(ctx: Ctx, report: dict, frame: dict) -> dict[str, Any]:
    reading = report_reading(ctx, report_frame_asked(ctx, report, frame))
    return {"reading": reading["text"], "assumptions": reading["assumptions"]}


def report_match(ctx: Ctx, question: str) -> dict[str, Any]:
    """Reuses the same tokens, threshold and tie rule as Ask, so two surfaces
    cannot disagree about whether a sentence names something. A miss is read as
    the register and **says it was not recognised** rather than presenting a
    guess as an understanding."""
    rep = ctx.doc["reports"]
    asked = ask_tokens(question)
    fallback = rep["reports"][0]

    if not asked:
        return {
            "report": fallback,
            "matched": False,
            "why": "No words to match — start from a standard report or say more.",
        }

    joined = " ".join(asked)
    exact = next(
        (r for r in rep["reports"] if " ".join(ask_tokens(r["question"])) == joined), None
    )
    if exact:
        return {
            "report": exact,
            "matched": True,
            "why": f"This is {exact['report_tag']}’s own question.",
        }

    scored = []
    for r in rep["reports"]:
        own = set(ask_tokens(r["question"]))
        shared = [w for w in asked if w in own]
        scored.append({"report": r, "score": len(shared) / len(asked), "shared": shared})
    scored.sort(key=lambda s: -s["score"])

    best = scored[0]
    runner_up = scored[1] if len(scored) > 1 else None
    if best["score"] < ASK_MATCH_MIN or (runner_up and runner_up["score"] == best["score"]):
        return {
            "report": fallback,
            "matched": False,
            "why": (
                f"That does not match one of the {len(rep['reports'])} standard reports closely "
                f"enough to be sure, so it is being read as {fallback['report_tag']} — the "
                f"{rep['meta']['entity_plural']} register. Change any underlined part below, or "
                "start from a standard report."
            ),
        }

    return {
        "report": best["report"],
        "matched": True,
        "why": f"Read as {best['report']['report_tag']} — it matches on "
        f"{', '.join(best['shared'][:4])}.",
    }


# ---------------------------------------------------------------------------
# Saved reports — a question, not a result
# ---------------------------------------------------------------------------
def report_viewer_roles(ctx: Ctx, saved: dict) -> list[dict[str, Any]]:
    """Defaults to every role. **It is not access control**: the role is
    client-held, so it narrows what a reader is shown while the API still serves
    every row to a caller that asks without a role."""
    all_roles = [{"role_id": r["role_id"], "label": r["label"]} for r in ctx.doc["auth_roles"]]
    ids = saved.get("viewer_roles")
    if not isinstance(ids, list) or not ids:
        return all_roles
    return [r for r in all_roles if r["role_id"] in ids]


def report_viewer_roles_problem(ctx: Ctx, ids: Any) -> str | None:
    if ids is None:
        return None
    pool = ", ".join(r["role_id"] for r in ctx.doc["auth_roles"])
    if not isinstance(ids, list) or not ids:
        return (
            "name at least one role — a report no role can view is a report you have "
            f"deleted. Roles: {pool}"
        )
    unknown = [i for i in ids if not any(r["role_id"] == i for r in ctx.doc["auth_roles"])]
    if unknown:
        return f"no such role: {', '.join(unknown)} — this tenant has {pool}"
    return None


def report_saved_view(ctx: Ctx, saved: dict) -> dict[str, Any]:
    rep = ctx.doc["reports"]
    report = next((r for r in rep["reports"] if r["report_id"] == saved["report_id"]), None)

    def label(slot: str, value: Any) -> Any:
        return next(
            (o["label"] for o in rep["opts"][slot]["options"] if o["value"] == value), value
        )

    return {
        **saved,
        "report_tag": (report or {}).get("report_tag") or saved["report_id"],
        "heading": (report or {}).get("heading") or saved["report_id"],
        "graph": report_graph_for(ctx, saved.get("use_case_id")),
        "saved_by": saved.get("saved_by"),
        "viewer_roles": report_viewer_roles(ctx, saved),
        "scope_label": label("scope", saved["scope"]),
        "measure_label": label("measure", saved["measure"]),
        "horizon_label": label("horizon", saved["horizon"]),
        "filters": [
            {
                "key": f["key"],
                "label": report_label(ctx, f["key"]),
                "value": str(f["value"]),
                "value_label": report_facet_label(f["key"], f["value"]),
            }
            for f in saved.get("filters") or []
        ],
    }


def reports_list(ctx: Ctx, as_role: str | None) -> dict[str, Any]:
    from .governance import report_governance_view

    rep = ctx.doc["reports"]
    saved = [report_saved_view(ctx, s) for s in rep.get("saved") or []]
    if as_role:
        saved = [
            row for row in saved if any(r["role_id"] == as_role for r in row["viewer_roles"])
        ]

    return {
        "governance": report_governance_view(ctx, as_role),
        "graphs": report_graphs(ctx),
        "graph": report_graph(ctx),
        "saved": saved,
        "authoring": {
            "opts": rep["opts"],
            "facets": report_facets(ctx),
            "defaults": {slot: chosen["value"] for slot, chosen in rep["assumptions"].items()},
        },
        "reports": [
            {
                "report_id": r["report_id"],
                "report_tag": r["report_tag"],
                "heading": r["heading"],
                "subtitle": r.get("subtitle"),
                "question": r.get("question"),
                "spine": r["spine"],
                "row_count": len(report_rows(ctx, r)),
                "spine_total": len(rep["data"][r["spine"]]),
                "block_kinds": [b["type"] for b in r["blocks"]],
                "tiles": r["tiles"],
            }
            for r in rep["reports"]
        ],
    }


def report_role_from(as_role: str | None, ctx: Ctx) -> str | None:
    if as_role and any(r["role_id"] == as_role for r in ctx.doc["auth_roles"]):
        return as_role
    return None
