"""
Governance — for reports, and for Audit & Governance.

**Governance is authored; everything about it is computed.** The database holds
only the decisions: state, version, author, category, as-of, schedule, approval,
and which personas each definition's audience names. Every number and every cell
here is computed per request — a count taken from its own filtered array would be
a second answer to "how many are published".

**A rule is recorded, not enforced**, and the page says so in those words. No
roster in this app is filtered per persona, so `resolution` states what a rule
*would* admit — never what a reader saw.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from ..core import now_iso
from ..models import GovernanceEvent, GovernanceScope, WhatIfScenario
from ..runtime import Ctx
from .reports import (
    REPORT_LABELS,
    published_graphs,
    report_facets_for,
    report_field,
    report_graph_counts,
    report_rows,
    report_saved_view,
    report_viewer_roles,
)


# ---------------------------------------------------------------------------
# States — declared once, read from there by everything
# ---------------------------------------------------------------------------
def report_state(ctx: Ctx, key: str) -> dict | None:
    return next(
        (s for s in ctx.doc["reports"]["governance"]["statuses"] if s["key"] == key), None
    )


def report_status_label(ctx: Ctx, key: str) -> str:
    return (report_state(ctx, key) or {}).get("label") or key


def report_status_tone(ctx: Ctx, key: str) -> str:
    """Read from the pool rather than a second literal map beside it — that is how
    a state ends up `warn` on a card and `neutral` on the chip counting it."""
    return (report_state(ctx, key) or {}).get("tone") or "neutral"


def report_entitlement_cell(ctx: Ctx, governance_row: dict, role_id: str) -> dict[str, Any]:
    """Every declared state but `archived` has a branch naming it. A state added
    without one would fall into "entitled - archived, opens by link only", which
    tells an audience it can open something nobody published."""
    if role_id not in governance_row["audience"]:
        return {"state": "not_entitled", "label": "not entitled", "tone": "crit"}
    status = governance_row["status"]
    if status == "published":
        return {"state": "entitled_published", "label": "entitled - published", "tone": "good"}
    if status == "pending_approval":
        return {
            "state": "entitled_pending",
            "label": "entitled once published - awaiting approval",
            "tone": "warn",
        }
    if status == "blocked":
        return {
            "state": "entitled_blocked",
            "label": "entitled once published - blocked, nothing to open",
            "tone": "crit",
        }
    return {
        "state": "entitled_archived",
        "label": "entitled - archived, opens by link only",
        "tone": "neutral",
    }


def report_floor_line(ctx: Ctx, report: dict) -> str:
    rows = len(report_rows(ctx, report))
    total = len(ctx.doc["reports"]["data"][report["spine"]])
    roster = report["spine"]
    if rows == total:
        return f"floor set by the {roster} of {total} rows"
    return f"floor set by {rows} of {total} rows in the {roster}"


# ---------------------------------------------------------------------------
# The Library's rows
# ---------------------------------------------------------------------------
def report_governance_row(ctx: Ctx, governance_row: dict) -> dict[str, Any]:
    report = next(
        (
            r
            for r in ctx.doc["reports"]["reports"]
            if r["report_id"] == governance_row["report_id"]
        ),
        None,
    )
    entitled = []
    for role_id in governance_row["audience"]:
        role = ctx.find_role(role_id)
        if role:
            entitled.append({"role_id": role_id, "label": role["label"]})

    return {
        "report_id": governance_row["report_id"],
        "kind": "written",
        "report_tag": report["report_tag"],
        "title": report["heading"],
        "question": report.get("question"),
        "lead": report.get("note") or report.get("subtitle") or "",
        "status": governance_row["status"],
        "status_label": report_status_label(ctx, governance_row["status"]),
        "tone": report_status_tone(ctx, governance_row["status"]),
        "version": governance_row["version"],
        "author": governance_row["author"],
        "category": governance_row["category"],
        "as_of": governance_row.get("as_of"),
        "schedule": governance_row.get("schedule"),
        "approval": governance_row.get("approval"),
        "note": governance_row.get("note"),
        "floor": report_floor_line(ctx, report),
        "parameterized": len(report_facets_for(ctx, report["spine"])) > 0,
        "row_count": len(report_rows(ctx, report)),
        "spine_total": len(ctx.doc["reports"]["data"][report["spine"]]),
        # `[]` is private, and private is a decision.
        "private": len(governance_row["audience"]) == 0,
        "audience_named": len(governance_row["audience"]),
        "entitled_roles": entitled,
    }


def report_saved_governance_row(ctx: Ctx, saved: dict) -> dict[str, Any]:
    """A session report answers to its own chip. It has been submitted to nobody,
    so counting it as Published would be the one claim this section exists to
    avoid."""
    view = report_saved_view(ctx, saved)
    report = next(
        (r for r in ctx.doc["reports"]["reports"] if r["report_id"] == saved["report_id"]), None
    )
    graph = view.get("graph")

    return {
        "report_id": saved["saved_id"],
        "kind": "saved",
        "saved_id": saved["saved_id"],
        "report_tag": view["report_tag"],
        "title": saved["name"],
        "question": saved.get("question") or (report or {}).get("question") or "",
        "lead": (report or {}).get("note") or "",
        "status": "published",
        "status_label": report_status_label(ctx, "published"),
        "tone": "good",
        "version": (graph or {}).get("version"),
        "author": view.get("saved_by"),
        "category": "Composed",
        "as_of": str(saved["saved_at"])[:10] if saved.get("saved_at") else None,
        "schedule": "On demand",
        "approval": None,
        "note": (
            "Asked of a graph nobody has published now, so it re-asks against the current "
            "rosters and says so in its caveats."
            if graph and not graph.get("live")
            else None
        ),
        "floor": report_floor_line(ctx, report) if report else None,
        "parameterized": len(report_facets_for(ctx, report["spine"])) > 0 if report else False,
        "row_count": len(report_rows(ctx, report)) if report else 0,
        "spine_total": len(ctx.doc["reports"]["data"][report["spine"]]) if report else 0,
        "private": len(view["viewer_roles"]) == 0,
        "audience_named": len(view["viewer_roles"]),
        "entitled_roles": view["viewer_roles"],
    }


def report_governance_view(ctx: Ctx, as_role: str | None) -> dict[str, Any]:
    doc_gov = ctx.doc["reports"]["governance"]
    written = [report_governance_row(ctx, g) for g in doc_gov["reports"]]
    saved_rows = ctx.doc["reports"].get("saved") or []
    saved = [report_saved_governance_row(ctx, s) for s in saved_rows]
    rows = [*written, *saved]

    def count(key: str) -> int:
        if key == "current":
            return sum(1 for r in rows if r["status"] != "archived")
        return sum(1 for r in rows if r["status"] == key)

    def entitled_to(row: dict) -> bool:
        return not as_role or any(r["role_id"] == as_role for r in row["entitled_roles"])

    scope_raw = next((s for s in doc_gov["data_scope"] if s["role_id"] == as_role), None)
    scope_row = None
    if scope_raw:
        role = ctx.find_role(scope_raw["role_id"])
        scope_row = {**scope_raw, "label": (role or {}).get("label") or scope_raw["role_id"]}

    # A list that is merely shorter is not a message: if a UI can remove a row,
    # it has to be able to say the row is gone.
    ungoverned = [
        {"report_id": r["report_id"], "report_tag": r["report_tag"], "title": r["heading"]}
        for r in ctx.doc["reports"]["reports"]
        if not any(g["report_id"] == r["report_id"] for g in doc_gov["reports"])
    ]

    people = []
    for u in ctx.settings["users"]:
        role = ctx.find_role(u["role_id"])
        scope = next((s for s in doc_gov["data_scope"] if s["role_id"] == u["role_id"]), None)
        people.append(
            {
                "email": u["email"],
                "name": u["name"],
                "role_id": u["role_id"],
                "role_label": (role or {}).get("label") or u["role_id"],
                "scope": (scope or {}).get("scope"),
                "masked": (scope or {}).get("masked"),
            }
        )

    categories = sorted({r["category"] for r in rows})

    audit = []
    for r in written:
        audit.append(
            {
                "report_id": r["report_id"],
                "title": r["title"],
                "act": f"defined {r['version']}",
                "actor": r["author"],
                "at": r["as_of"],
                "detail": (
                    f"{r['status_label'].lower()} · {r['approval']}"
                    if r["approval"]
                    else f"{r['status_label'].lower()} · no approval recorded"
                ),
                "tone": r["tone"],
            }
        )
    for s in saved_rows:
        view = report_saved_view(ctx, s)
        graph = view.get("graph")
        if graph:
            detail = f"asked of {graph['name']} {graph.get('version') or ''}".strip()
            if not graph.get("live"):
                detail += " - not published now"
        else:
            detail = "no graph recorded"
        audit.append(
            {
                "report_id": s["saved_id"],
                "title": s["name"],
                "act": "saved a composed report",
                "actor": view.get("saved_by") or "unknown",
                "at": str(s["saved_at"])[:10] if s.get("saved_at") else None,
                "detail": detail,
                "tone": "good" if (graph or {}).get("live") else "warn",
            }
        )

    live_count = len(published_graphs(ctx))
    publish_checks = []
    for r in rows:
        publish_checks.append(
            {
                "report_id": r["report_id"],
                "title": r["title"],
                "checks": [
                    {
                        "key": "audience",
                        "label": "Every persona the audience names still exists",
                        "pass": r["audience_named"] == len(r["entitled_roles"]),
                        "detail": (
                            "private - shared with nobody, which is a decision rather than a gap"
                            if r["private"]
                            else f"{len(r['entitled_roles'])} of "
                            f"{len(ctx.doc['auth_roles'])} personas"
                            if r["audience_named"] == len(r["entitled_roles"])
                            else f"names {r['audience_named']}, {len(r['entitled_roles'])} "
                            "resolve - a persona was renamed or removed under this audience"
                        ),
                    },
                    {
                        "key": "floor",
                        "label": "Spine roster resolves to rows",
                        "pass": r["row_count"] > 0,
                        "detail": r["floor"] or "no roster",
                    },
                    {
                        "key": "approval",
                        "label": "Approval recorded",
                        "pass": r["approval"] is not None,
                        "detail": r["approval"]
                        or "none - a definition may not be published unapproved",
                    },
                    {
                        "key": "graph",
                        "label": "A published graph to ask it of",
                        "pass": live_count > 0,
                        "detail": (
                            f"{live_count} published"
                            if live_count > 0
                            else "nothing published - publication lives in memory, so a "
                            "restart closes this"
                        ),
                    },
                ],
            }
        )

    entitlement_roles = []
    for role in ctx.doc["auth_roles"]:
        cells = [
            {"report_id": g["report_id"], **report_entitlement_cell(ctx, g, role["role_id"])}
            for g in doc_gov["reports"]
        ]
        for s in saved_rows:
            cells.append(
                {
                    "report_id": s["saved_id"],
                    **report_entitlement_cell(
                        ctx,
                        {
                            "audience": [
                                r["role_id"] for r in report_viewer_roles(ctx, s)
                            ],
                            "status": "published",
                        },
                        role["role_id"],
                    ),
                }
            )
        entitlement_roles.append(
            {"role_id": role["role_id"], "label": role["label"], "cells": cells}
        )

    return {
        "reports": rows,
        "ungoverned": ungoverned,
        "restore": "python -m backend.seed governance",
        "publishing": doc_gov["publishing"],
        "people": people,
        "statuses": [
            {"key": "current", "label": "All current", "tone": "neutral", "count": count("current")},
            *[{**s, "count": count(s["key"])} for s in doc_gov["statuses"]],
        ],
        "categories": categories,
        "viewer": {
            "role_id": as_role,
            "label": (ctx.find_role(as_role) or {}).get("label") or as_role if as_role else None,
            "entitled_count": sum(1 for r in rows if entitled_to(r)),
            "not_entitled_count": sum(1 for r in rows if not entitled_to(r)),
            "scope": scope_row,
        },
        "author": {
            # A persona that cannot see the underlying figures cannot define what
            # a report asserts about them, and the refusal names who can.
            "may_author": scope_row["may_author"] is True if scope_row else True,
            "note": doc_gov["gate_notes"]["author"],
            "authors": [
                (ctx.find_role(s["role_id"]) or {}).get("label") or s["role_id"]
                for s in doc_gov["data_scope"]
                if s.get("may_author")
            ],
        },
        "gates": {
            # The two gates are never merged: gate 1 is audience entitlement,
            # gate 2 is data scope — and gate 2 is declared, not applied.
            "note": doc_gov["gate_notes"]["both"],
            "entitlement": {
                "note": doc_gov["gate_notes"]["entitlement"],
                "columns": [
                    {
                        "report_id": r["report_id"],
                        "title": r["title"],
                        "report_tag": r["report_tag"],
                        "status": r["status"],
                    }
                    for r in rows
                ],
                "roles": entitlement_roles,
            },
            "data_scope": {
                "note": doc_gov["gate_notes"]["data_scope"],
                "rows": [
                    {**s, "label": (ctx.find_role(s["role_id"]) or {}).get("label") or s["role_id"]}
                    for s in doc_gov["data_scope"]
                ],
            },
        },
        "schedule": [
            {
                "report_id": r["report_id"],
                "title": r["title"],
                "schedule": r["schedule"],
                "as_of": r["as_of"],
                "floor": r["floor"],
                "parameterized": r["parameterized"],
                "status_label": r["status_label"],
                "tone": r["tone"],
            }
            for r in rows
        ],
        "audit": audit,
        "publish_checks": publish_checks,
    }


# ---------------------------------------------------------------------------
# Audit & Governance — the trail, the bases, the artifacts
# ---------------------------------------------------------------------------
def log_governance(
    ctx: Ctx, category: str, actor: str | None, text: str, detail: Any
) -> None:
    ctx.db.add(
        GovernanceEvent(
            at=now_iso(),
            actor=actor or ctx.account_email,
            action=category,
            subject=text,
            detail={"detail": detail},
        )
    )
    ctx.db.commit()


def governance_log(ctx: Ctx) -> list[dict[str, Any]]:
    rows = ctx.db.scalars(
        select(GovernanceEvent).order_by(GovernanceEvent.id.desc())
    ).all()
    return [
        {
            "event_id": f"gl-{r.id}",
            "at": r.at,
            "category": r.action,
            "actor": r.actor,
            "text": r.subject,
            "detail": (r.detail or {}).get("detail"),
        }
        for r in rows
    ]


GOVERNANCE_IDENTITY = "generator"


def governance_bases(ctx: Ctx) -> list[dict[str, Any]]:
    """**The basis list is derived, never written**: the register's identity
    column plus every field the dictionary declares `filterable`. `enf` is
    deliberately absent because the dictionary does not declare it — a basis
    nobody could slice a report by is not one."""
    rows = ctx.doc["reports"]["data"]["generators"]
    first = rows[0] if rows else {}

    keys: list[str] = []
    for key in [GOVERNANCE_IDENTITY] + [
        f["key"] for f in ctx.doc["reports"]["fields"] if f.get("filterable")
    ]:
        if key not in keys and key in first:
            keys.append(key)

    out = []
    for key in keys:
        field = report_field(ctx, key)
        seen: dict[str, int] = {}
        for row in rows:
            raw = row.get(key)
            value = str(raw) if isinstance(raw, bool) else str(raw if raw is not None else "")
            seen[value] = seen.get(value, 0) + 1

        label_base = (field or {}).get("label") or REPORT_LABELS.get(key, key)
        values = []
        for value, count in sorted(seen.items(), key=lambda kv: kv[0]):
            sample = next((r for r in rows if str(r.get(key)) == value), None)
            is_bool = isinstance((sample or {}).get(key), bool)
            if is_bool:
                label = label_base if value == "true" else f"No {label_base.lower()}"
            else:
                label = value
            values.append({"value": value, "label": label, "count": count})

        out.append(
            {
                "basis": key,
                "label": label_base,
                "identity": key == GOVERNANCE_IDENTITY,
                "values": values,
            }
        )
    return out


def governance_rows(ctx: Ctx, rule: dict | None) -> list[dict]:
    if not rule or not rule.get("basis") or not isinstance(rule.get("values"), list):
        return []
    if not rule["values"]:
        return []
    return [
        row
        for row in ctx.doc["reports"]["data"]["generators"]
        if any(str(row.get(rule["basis"]) or "") == str(v) for v in rule["values"])
    ]


def governance_resolution(ctx: Ctx, scope: dict) -> dict[str, Any]:
    """States what a rule *would* admit — and names the rows as well as counting
    them, because "32 of 36" is not checkable and a list is."""
    total = len(ctx.doc["reports"]["data"]["generators"])
    basis = None
    if scope.get("rule"):
        basis = next(
            (b for b in governance_bases(ctx) if b["basis"] == scope["rule"]["basis"]), None
        )

    if scope.get("full") and scope.get("mask"):
        return {
            "kind": "mask",
            "count": total,
            "total": total,
            "summary": "Totals only — row figures masked",
            "sample": [],
        }
    if scope.get("full"):
        return {
            "kind": "full",
            "count": total,
            "total": total,
            "summary": f"All {total} generators",
            "sample": [],
        }
    if not scope.get("rule") or not basis:
        # "No rule authored yet" rather than "opens empty", which would itself be
        # a claim about enforcement.
        return {
            "kind": "none",
            "count": 0,
            "total": total,
            "summary": "No rule authored yet",
            "sample": [],
        }

    rows = governance_rows(ctx, scope["rule"])
    if not rows:
        return {
            "kind": "none",
            "count": 0,
            "total": total,
            "summary": f"{basis['label']}: no value picked yet",
            "sample": [],
        }

    def label_for(v: Any) -> str:
        return next(
            (x["label"] for x in basis["values"] if x["value"] == str(v)), str(v)
        )

    return {
        "kind": "part",
        "count": len(rows),
        "total": total,
        "summary": f"{basis['label']}: "
        + ", ".join(label_for(v) for v in scope["rule"]["values"]),
        "sample": [str(r[GOVERNANCE_IDENTITY]) for r in rows],
    }


def _scope_for(ctx: Ctx, role_id: str) -> dict[str, Any]:
    """The seeded `data_scope` row, with any rule authored here layered over it."""
    seeded = next(
        (s for s in ctx.doc["reports"]["governance"]["data_scope"] if s["role_id"] == role_id),
        {},
    )
    row = ctx.db.get(GovernanceScope, role_id)
    if row is None:
        return dict(seeded)
    return {
        **seeded,
        "rule": {"basis": row.basis, "values": row.values} if row.basis else None,
        "full": False if row.basis else seeded.get("full"),
        "updated_at": row.updated_at,
        "updated_by": row.updated_by,
    }


def governance_people(ctx: Ctx) -> list[dict[str, Any]]:
    out = []
    for u in ctx.settings["users"]:
        role = ctx.find_role(u["role_id"])
        scope = _scope_for(ctx, u["role_id"])
        out.append(
            {
                "email": u["email"],
                "name": u["name"],
                "role_id": u["role_id"],
                "role_label": (role or {}).get("label") or u["role_id"],
                "declared": scope.get("scope"),
                "masked_columns": scope.get("masked"),
                "full": scope.get("full") is True,
                "mask": scope.get("mask") is True,
                "rule": scope.get("rule"),
                "resolution": governance_resolution(ctx, scope),
            }
        )
    return out


def governance_person(ctx: Ctx, email: str | None) -> dict[str, Any] | None:
    target = str(email or "").lower()
    return next((p for p in governance_people(ctx) if p["email"].lower() == target), None)


def governance_artifacts(ctx: Ctx) -> list[dict[str, Any]]:
    """**A report's audience is persona ids and a scenario's is addresses**, and
    the two are never merged: each row states which it is, so one is not read as
    the other."""
    people = governance_people(ctx)
    out: list[dict[str, Any]] = []

    for row in ctx.doc["reports"]["governance"]["reports"]:
        definition = next(
            (r for r in ctx.doc["reports"]["reports"] if r["report_id"] == row["report_id"]),
            None,
        )
        audience = row["audience"] if isinstance(row.get("audience"), list) else []
        out.append(
            {
                "artifact_id": row["report_id"],
                "kind": "report",
                "kind_label": "Report",
                "name": (definition or {}).get("heading") or row["report_id"],
                "published_by": row.get("author"),
                "live": row["status"] == "published",
                "status_label": (report_state(ctx, row["status"]) or {}).get("label")
                or row["status"],
                "freshness": row.get("schedule"),
                "cases": None,
                "readers": [p["email"] for p in people if p["role_id"] in audience],
                "audience_note": (
                    "Stored as personas, so adding somebody names their persona — anyone else "
                    "holding it is named too."
                ),
                # Unpublish is offered only where the server has that act.
                "can_unpublish": False,
            }
        )

    presets = ctx.doc["whatif"]["publishing"]["freshness"]["presets"]
    for row in ctx.db.scalars(select(WhatIfScenario)).all():
        if row.publication is None:
            continue
        publication = row.publication
        preset = next(
            (p for p in presets if p["id"] == publication["freshness"]["preset"]), None
        )
        out.append(
            {
                "artifact_id": row.scenario_id,
                "kind": "whatif",
                "kind_label": "What-if scenario",
                "name": row.data["name"],
                "published_by": publication["published_by"],
                "live": True,
                "status_label": "Published",
                "freshness": (preset or {}).get("label"),
                "cases": [c["name"] for c in row.data["cases"]],
                "readers": publication["readers"],
                "audience_note": "Stored as addresses — a scenario names people, not personas.",
                "can_unpublish": True,
            }
        )
    return out


def governance_artifact(ctx: Ctx, artifact_id: str) -> dict[str, Any] | None:
    return next(
        (a for a in governance_artifacts(ctx) if a["artifact_id"] == artifact_id), None
    )


def governance_add_reader(ctx: Ctx, artifact: dict, person: dict) -> None:
    if artifact["kind"] == "report":
        doc = ctx.doc
        rows = doc["reports"]["governance"]["reports"]
        row = next((r for r in rows if r["report_id"] == artifact["artifact_id"]), None)
        if row is None or person["role_id"] in row["audience"]:
            return
        doc["reports"] = {
            **doc["reports"],
            "governance": {
                **doc["reports"]["governance"],
                "reports": [
                    {**r, "audience": [*r["audience"], person["role_id"]]}
                    if r["report_id"] == artifact["artifact_id"]
                    else r
                    for r in rows
                ],
            },
        }
        ctx.commit()
        return

    row = ctx.db.get(WhatIfScenario, artifact["artifact_id"])
    publication = dict(row.publication)
    if person["email"] not in publication["readers"]:
        publication["readers"] = [*publication["readers"], person["email"]]
        row.publication = publication
        ctx.db.commit()


def governance_remove_reader(ctx: Ctx, artifact: dict, email: str) -> str | None:
    """The last reader of a published scenario cannot be removed: a published
    scenario names at least one, so the refusal points at unpublish instead."""
    person = governance_person(ctx, email)

    if artifact["kind"] == "report":
        doc = ctx.doc
        rows = doc["reports"]["governance"]["reports"]
        doc["reports"] = {
            **doc["reports"],
            "governance": {
                **doc["reports"]["governance"],
                "reports": [
                    {
                        **r,
                        "audience": [
                            rid for rid in r["audience"] if rid != (person or {}).get("role_id")
                        ],
                    }
                    if r["report_id"] == artifact["artifact_id"]
                    else r
                    for r in rows
                ],
            },
        }
        ctx.commit()
        return None

    row = ctx.db.get(WhatIfScenario, artifact["artifact_id"])
    publication = dict(row.publication)
    readers = [e for e in publication["readers"] if e != email]
    if not readers:
        who = (person or {}).get("name") or email
        return (
            f"{who} is the only reader of “{artifact['name']}”. A published scenario names at "
            "least one — unpublish it instead, which withdraws it and keeps the author’s draft."
        )
    publication["readers"] = readers
    row.publication = publication
    ctx.db.commit()
    return None


def governance_view(ctx: Ctx) -> dict[str, Any]:
    return {
        "connected_sources": len(ctx.connected_sources()),
        **report_graph_counts(ctx),
        "roster_total": len(ctx.doc["reports"]["data"]["generators"]),
        "bases": governance_bases(ctx),
        "people": governance_people(ctx),
        "artifacts": governance_artifacts(ctx),
        "log": governance_log(ctx),
        "log_categories": ctx.doc["reports"]["governance"]["audit"]["categories"],
        "copy": ctx.doc["reports"]["governance"]["audit"]["copy"],
    }
