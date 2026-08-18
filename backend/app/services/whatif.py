"""
The What-if lens: where a load is judged **before** it is accepted.

**It is a read-only overlay and nothing on it writes to the graph.** The copy
says so three times, so the code has to keep it: computing a scenario returns
figures and stores nothing, and the saved library holds **generator ids, never
figures**. That is the whole reason computing is a call rather than a
calculation — a saved scenario re-opened next week shows next week's record, and
a store that cached the numbers would be caching an answer that quietly went
stale.

**Nothing is predicted.** Every figure is a record the graph already holds.
"""

from __future__ import annotations

import math
from typing import Any

from sqlalchemy import select

from ..core import now_iso
from ..models import WhatIfScenario
from ..runtime import Ctx

WHATIF_OPS: dict[str, Any] = {
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    ">=": lambda a, b: a >= b,
}


def whatif_pool(ctx: Ctx, pool_key: str) -> list[dict]:
    pool = next(
        (p for p in ctx.doc["whatif"]["candidate_pools"] if p["key"] == pool_key), None
    )
    if not pool or pool.get("filter") is None:
        return ctx.doc["whatif"]["generators"]
    f = pool["filter"]
    op = WHATIF_OPS[f["op"]]
    return [g for g in ctx.doc["whatif"]["generators"] if op(g[f["field"]], f["value"])]


def whatif_format(value: Any, fmt: str) -> str:
    if fmt == "currency_k":
        return f"${round(float(value) / 1000)}k"
    if fmt == "boolean_yesno":
        return "yes" if value else "no"
    return str(value)


def whatif_readers(ctx: Ctx) -> list[dict[str, Any]]:
    """The tenant's users, with their persona and its declared access note. An
    address outside this directory is refused **naming who is in it** — inventing
    a reader is inventing a user."""
    out = []
    for u in ctx.settings["users"]:
        role = ctx.find_role(u["role_id"])
        out.append(
            {
                "email": u["email"],
                "name": u["name"],
                "role_id": u["role_id"],
                "role_label": (role or {}).get("label") or u["role_id"],
                "access_note": (role or {}).get("access_note") or "",
            }
        )
    return out


def whatif_frame(ctx: Ctx) -> dict[str, Any]:
    """**The keyword list is deliberately absent from this payload** — a client
    holding it could answer for itself, which would make the refusal theatre."""
    from .reports import report_graphs

    w = ctx.doc["whatif"]
    return {
        "facility": w["facility"],
        "generators": w["generators"],
        "transporters": w.get("transporters"),
        "watched_measures": w["watched_measures"],
        "candidate_pools": [
            {**p, "count": len(whatif_pool(ctx, p["key"]))} for p in w["candidate_pools"]
        ],
        "formats": w["formats"],
        "headroom": [{"pool": p["key"], **w["headroom"][p["key"]]} for p in w["candidate_pools"]],
        "copy": w.get("copy"),
        "state_defaults": w.get("state_defaults"),
        "authoring": w.get("authoring"),
        "runtime": w.get("runtime"),
        "graph_reference": w.get("graph_reference"),
        "publishing": w.get("publishing"),
        "readers": whatif_readers(ctx),
        "graphs": report_graphs(ctx),
    }


def whatif_scenario(ctx: Ctx, generator: dict, watch_keys: list[str]) -> dict[str, Any]:
    """A measure reports three different things: `inherited` (what the load
    brings), `baseline` (what the facility already carries) and `value` (the sum,
    judged against the appetite line).

    A measure with no baseline — a consent decree is not something a facility
    keeps a running count of — reports `null` rather than `0`, because 0 would be
    a claim.
    """
    w = ctx.doc["whatif"]
    facility = w["facility"]

    measures = []
    for m in w["watched_measures"]:
        if m["key"] not in watch_keys:
            continue
        inherited = generator[m["field"]]
        baseline = (
            None if m["baseline_field"] is None else facility["baseline"][m["baseline_field"]]
        )
        value = inherited if baseline is None else baseline + inherited
        appetite = (
            None if m["appetite_field"] is None else facility["appetite"][m["appetite_field"]]
        )
        if m.get("breach") is None:
            breached = False
        else:
            against = m["breach"]["against"][len("appetite.") :]
            breached = WHATIF_OPS[m["breach"]["op"]](value, facility["appetite"][against])

        measures.append(
            {
                "key": m["key"],
                "label": m["label"],
                "source": m["source"],
                "grounds": m["grounds"],
                "unit": m["unit"],
                "value": value,
                "value_text": whatif_format(value, m["format"]),
                "inherited": inherited,
                "inherited_text": whatif_format(inherited, m["format"]),
                "baseline": baseline,
                "baseline_text": None if baseline is None else whatif_format(baseline, m["format"]),
                "appetite": appetite,
                "breached": breached,
                # A load that moves nothing says so instead of printing "+0".
                "moved": bool(inherited)
                if m["format"] == "boolean_yesno"
                else float(inherited) > 0,
            }
        )

    filled = []
    for s in w["runtime"]["sources"]:
        line = (
            s["line"]
            .replace("{transporter}", str(generator["transporter"]))
            .replace("{manifests}", str(generator["manifests"]))
            .replace("{tons}", str(round(generator["tons"])))
            .replace("{id}", str(generator["id"]))
            .replace("{evaluations}", str(generator["evaluations"]))
            .replace("{violations}", str(generator["violations"]))
            .replace("{enforcement}", str(generator["enforcement"]))
            .replace("{last_enforcement}", str(generator["last_enforcement"]))
            .replace("{name}", str(generator["name"]))
        )
        parts = line.split("  |  ")
        with_enf = parts[0]
        without_enf = parts[1] if len(parts) > 1 else None

        if s["key"] == "ECHO":
            resolved = with_enf if generator["enforcement"] > 0 else (without_enf or with_enf)
        else:
            resolved = line

        filled.append(
            {
                "key": s["key"],
                "label": s["label"],
                "line": resolved,
                "applies": bool(generator.get("consent_decree")) if s["key"] == "DOC" else True,
            }
        )

    flagged = (
        generator["violations"] > 0
        or generator["enforcement"] > 0
        or bool(generator.get("consent_decree"))
    )

    return {
        "generator": generator,
        "measures": measures,
        "sources": [s for s in filled if s["applies"]],
        "flagged": flagged,
        "clean_note": None if flagged else w["runtime"]["scenario_card"]["clean_note"],
        "residual_note": w["runtime"]["scenario_card"]["residual_note"],
        "subgraph": whatif_subgraph(ctx, generator),
    }


def whatif_subgraph(ctx: Ctx, generator: dict) -> dict[str, Any]:
    """**An absence has no circle.** A clean load draws no enforcement node and
    one under no decree draws no document — the same rule the studio canvas
    follows. Every edge label is taken from the graph's own relationship list."""
    relationships = ctx.doc["whatif"]["graph_reference"]["relationships"]

    def rel(name: str) -> str | None:
        return name if name in relationships else None

    has_enforcement = generator["enforcement"] > 0
    has_violations = generator["violations"] > 0

    nodes: list[dict[str, Any]] = [
        {"key": "evaluation", "label": "Evaluations", "count": generator["evaluations"], "risk": None}
    ]
    if has_violations:
        nodes.append(
            {"key": "violation", "label": "Violations", "count": generator["violations"], "risk": None}
        )
    if has_enforcement:
        nodes.append(
            {
                "key": "enforcement",
                "label": "Enforcement",
                "count": generator["enforcement"],
                "risk": None,
            }
        )
    if generator.get("consent_decree"):
        nodes.append({"key": "document", "label": "Consent decree", "count": None, "risk": None})
    nodes.append(
        {"key": "generator", "label": generator["name"], "count": None, "risk": generator["risk"]}
    )
    nodes.append(
        {"key": "facility", "label": ctx.doc["whatif"]["facility"]["name"], "count": None, "risk": None}
    )

    edges: list[dict[str, Any]] = []
    if has_violations:
        edges.append({"from": "violation", "to": "evaluation", "label": rel("FOUND_IN")})
    edges.append({"from": "evaluation", "to": "generator", "label": rel("EVALUATION_OF")})
    if has_enforcement:
        edges.append(
            {"from": "enforcement", "to": "generator", "label": rel("ENFORCEMENT_AGAINST")}
        )
    if generator.get("consent_decree"):
        edges.append({"from": "document", "to": "generator", "label": rel("DESCRIBED_BY")})
    edges.append({"from": "generator", "to": "facility", "label": rel("SHIPS_TO")})

    return {
        "nodes": nodes,
        "edges": [e for e in edges if e["label"] is not None],
        "relationships": relationships,
    }




# ---------------------------------------------------------------------------
# Resolving a measure against the graph
# ---------------------------------------------------------------------------
def whatif_resolve(ctx: Ctx, text: str) -> dict[str, Any]:
    """Three verdicts, and **the graph decides**: `resolved` names the measure it
    grounded to, `grounds_not_inherited` explains that the measure is real but
    measures the wrong thing (tonnage measures the Manifest, not inherited risk),
    and `refused` says nothing in this graph resolves it.

    The wording is the tenant's — `resolve_copy` supplies every title and body,
    interpolated rather than restated, so the component puts no words in its
    mouth.
    """
    asked = str(text or "").strip()
    w = ctx.doc["whatif"]

    hit = next(
        (
            r
            for r in w["resolvable"]
            if any(k in asked.lower() for k in r["keywords"])
        ),
        None,
    )
    copy = w["resolve_copy"]
    measure_label = next(
        (
            m["label"]
            for m in w["watched_measures"]
            if hit and m["key"] == hit.get("resolves_to")
        ),
        "",
    )

    def fill(s: Any) -> str:
        return str(s or "").replace("{q}", asked).replace("{label}", measure_label)

    if not hit:
        block = copy["refused"]
        return {
            "text": asked,
            "verdict": "refused",
            "measure_key": None,
            "tone": block["tone"],
            "title": fill(block["title"]),
            "body": fill(block["body"]),
        }

    if hit.get("verdict") == "grounds_not_inherited":
        block = copy["grounds_not_inherited"]
        return {
            "text": asked,
            "verdict": "grounds_not_inherited",
            "measure_key": None,
            "tone": block["tone"],
            "title": fill(block["title"]),
            "body": f"{hit['note']}.",
        }

    block = copy["resolved"]
    return {
        "text": asked,
        "verdict": "resolved",
        "measure_key": hit["resolves_to"],
        "tone": block["tone"],
        "title": fill(block["title"]),
        "body": f"{hit['note']}.",
    }


# ---------------------------------------------------------------------------
# The saved library — a scenario is the frame plus its cases
# ---------------------------------------------------------------------------
def saved_view(row: WhatIfScenario) -> dict[str, Any]:
    return {**row.data, "saved_id": row.scenario_id, "published": row.publication}


def saved_all(ctx: Ctx) -> list[dict[str, Any]]:
    rows = ctx.db.scalars(
        select(WhatIfScenario).order_by(WhatIfScenario.saved_at)
    ).all()
    return [saved_view(r) for r in rows]


def next_scenario_id(ctx: Ctx) -> str:
    """`sv-1`, `sv-2`, … The Node server kept a counter in memory; here the
    highest id already stored is the counter, so a restart does not start
    handing out ids that are already taken."""
    used = []
    for row in ctx.db.scalars(select(WhatIfScenario.scenario_id)).all():
        if row.startswith("sv-") and row[3:].isdigit():
            used.append(int(row[3:]))
    return f"sv-{(max(used) if used else 0) + 1}"


class ScenarioRefused(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def save_scenario(ctx: Ctx, body: dict) -> tuple[list[dict], str]:
    """Refuses a pool the package does not ship, a measure nobody authored, a
    scenario watching nothing, a scenario holding nothing, and a case whose load
    the frame excludes.

    Every one of those is a figure without its question, which is what makes the
    scenario rather than the column the publishable object.
    """
    w = ctx.doc["whatif"]

    pool_key = str(body.get("pool") or "")
    if not any(p["key"] == pool_key for p in w["candidate_pools"]):
        offered = ", ".join(p["key"] for p in w["candidate_pools"])
        raise ScenarioRefused(
            f'no candidate pool "{pool_key}" — pick one of: {offered}'
        )

    watch = body.get("watch")
    watch_keys = [str(k) for k in watch] if isinstance(watch, list) else []
    unknown = [
        k for k in watch_keys if not any(m["key"] == k for m in w["watched_measures"])
    ]
    if unknown:
        raise ScenarioRefused(
            f"not a watched measure: {', '.join(unknown)} — author it in step 1 first"
        )
    if not watch_keys:
        raise ScenarioRefused(
            "a scenario watches at least one measure — pick one in step 1 before saving"
        )

    rows = body.get("cases") if isinstance(body.get("cases"), list) else []
    if not rows:
        raise ScenarioRefused(
            "a scenario holds at least one case — open a column in Runtime first"
        )

    admitted = whatif_pool(ctx, pool_key)
    admitted_ids = {g["id"] for g in admitted}
    template = w["runtime"]["saved_library"]["default_name_template"]

    next_cases = []
    for row in rows:
        generator = next(
            (g for g in w["generators"] if g["id"] == (row or {}).get("generator_id")), None
        )
        if not generator:
            raise ScenarioRefused(
                f"no generator {(row or {}).get('generator_id')}", status=404
            )
        if generator["id"] not in admitted_ids:
            raise ScenarioRefused(
                f'{generator["name"]} is not in the "{pool_key}" pool — a case may only '
                "admit a load the frame allows"
            )
        # A case is named rather than listed as an empty row.
        fallback = template.replace(
            "{first_two_words_of_generator}",
            " ".join(generator["name"].split()[:2]),
        )
        next_cases.append(
            {
                "name": str((row or {}).get("name") or "").strip() or fallback,
                "generator_id": generator["id"],
            }
        )

    saved_id = str(body.get("saved_id") or "")
    existing = ctx.db.get(WhatIfScenario, saved_id) if saved_id else None
    if existing is None:
        saved_id = next_scenario_id(ctx)

    pool_label = next(
        (p.get("label") or pool_key for p in w["candidate_pools"] if p["key"] == pool_key),
        pool_key,
    )
    label = (
        str(body.get("name") or "").strip()
        or (existing.data.get("name") if existing else None)
        or f"What-if — {pool_label.lower()}"
    )

    data = {
        "saved_id": saved_id,
        "name": label,
        "watch": watch_keys,
        "pool": pool_key,
        "cases": next_cases,
    }

    if existing is None:
        ctx.db.add(
            WhatIfScenario(
                scenario_id=saved_id,
                saved_at=now_iso(),
                data=data,
                publication=None,
            )
        )
    else:
        existing.data = data
    ctx.db.commit()

    return saved_all(ctx), saved_id
