"""
Graph Studio: where a *built* graph becomes a published one.

The studio lists graphs — it is not one graph. Its decisions, pivot, builds and
publications were keyed maps in memory; they are tables now, so two graphs still
cannot answer each other's rows and a restart no longer clears the queue.

**A version is content-addressed and immutable.** `sha256` is its identity;
publishing flips a pointer and never rewrites a row.
"""

from __future__ import annotations

import math
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from ..core import js_hash, now_iso, round_js
from ..models import StudioBuild, StudioDecision, StudioPivot, StudioPublication
from ..runtime import Ctx

FLOORS = ["schema-changing", "causal", "new entity type"]
CANVAS_GROUPS = ["row", "schema", "document", "alias"]

BUILD_STAGES = [
    {"key": "pin_inputs", "steps": ["resolve_use_case", "seal_coverage_evidence", "pin_source_versions"]},
    {"key": "a01_schema_parsing", "steps": ["read_column_profiles", "infer_column_semantics", "validate_grain"]},
    {"key": "join_matrix", "steps": ["enumerate_shared_keys", "score_join_candidates", "prune_weak_joins"]},
    {"key": "entity_nomination", "steps": ["nominate_from_tables", "dedupe_nominations", "bind_to_hero_questions"]},
    {"key": "a03_relationship_inference", "steps": ["pair_entities", "test_shared_identifiers", "rank_by_evidence"]},
    {"key": "a02_document_entity_extraction", "steps": ["chunk_documents", "extract_entities", "score_extraction_confidence"]},
    {"key": "a02b_document_relationship_mining", "steps": ["mine_cooccurrence", "link_document_entities"]},
    {"key": "a03b_cross_pipeline_reconciliation", "steps": ["align_structured_and_document", "resolve_conflicts", "merge_evidence"]},
    {"key": "a04_entity_resolution", "steps": ["blocking_pass", "pairwise_match", "assign_canonical_ids"]},
    {"key": "a015_comprehension", "steps": ["summarise_entities", "draft_relationship_labels"]},
    {"key": "a05_graph_construction", "steps": ["materialise_nodes", "materialise_edges", "seal_package"]},
]

# Flattened once. A stage index kept alongside a step index is two counters that
# can disagree, and the symptom is a stage reading complete while one of its
# substeps still spins — so a run keeps one cursor into this list and every
# state on screen is derived from it.
BUILD_STEPS = [
    {"stage": stage["key"], "step": step, "stageIndex": i}
    for i, stage in enumerate(BUILD_STAGES)
    for step in stage["steps"]
]
BUILD_STEP_MS = 3_000


# ---------------------------------------------------------------------------
# Decisions, pivot, publication
# ---------------------------------------------------------------------------
def decisions_for(ctx: Ctx, use_case_id: str) -> dict[str, dict[str, Any]]:
    rows = ctx.db.scalars(
        select(StudioDecision).where(StudioDecision.use_case_id == use_case_id)
    ).all()
    return {
        r.item_id: {
            "choice": r.choice,
            "justification": r.justification,
            "decided_at": r.decided_at,
            "decided_by": r.decided_by,
        }
        for r in rows
    }


def record_decision(
    ctx: Ctx, use_case_id: str, item_id: str, choice: str, justification: str | None, by: str
) -> None:
    row = ctx.db.scalar(
        select(StudioDecision).where(
            StudioDecision.use_case_id == use_case_id, StudioDecision.item_id == item_id
        )
    )
    if row is None:
        row = StudioDecision(use_case_id=use_case_id, item_id=item_id)
        ctx.db.add(row)
    row.choice = choice
    row.justification = justification
    row.decided_at = now_iso()
    row.decided_by = by
    ctx.db.commit()


def pivot_choice(ctx: Ctx, use_case_id: str) -> dict[str, Any] | None:
    row = ctx.db.get(StudioPivot, use_case_id)
    if not row:
        return None
    return {
        "option_id": row.option_id,
        "decided_at": row.decided_at,
        "decided_by": row.decided_by,
    }


def record_pivot(ctx: Ctx, use_case_id: str, option_id: str, by: str) -> None:
    row = ctx.db.get(StudioPivot, use_case_id)
    if row is None:
        row = StudioPivot(use_case_id=use_case_id)
        ctx.db.add(row)
    row.option_id = option_id
    row.decided_at = now_iso()
    row.decided_by = by
    ctx.db.commit()


def live_sha(ctx: Ctx, use_case_id: str) -> str | None:
    row = ctx.db.scalar(
        select(StudioPublication).where(
            StudioPublication.use_case_id == use_case_id, StudioPublication.live.is_(True)
        )
    )
    return row.sha256 if row else None


def published_version(ctx: Ctx, use_case_id: str) -> dict[str, Any] | None:
    sha = live_sha(ctx, use_case_id)
    if not sha:
        return None
    return next((v for v in versions_for(ctx, use_case_id) if v["sha256"] == sha), None)


def published_by_for(ctx: Ctx, use_case_id: str) -> str:
    """Falls back to the seeded account for a version published before this
    existed — "published by nobody" is not true of a live version."""
    sha = live_sha(ctx, use_case_id)
    if sha:
        row = ctx.db.scalar(
            select(StudioPublication).where(
                StudioPublication.use_case_id == use_case_id,
                StudioPublication.sha256 == sha,
            )
        )
        if row and row.published_by:
            return row.published_by
    return ctx.account_email


def set_publication(ctx: Ctx, use_case_id: str, sha: str, by: str | None) -> None:
    """Publishing flips a pointer. `published_by` is written **or cleared** on
    every publish — a record keyed by content, holding a fact about an act, that
    is only ever set means an anonymous re-publish keeps crediting whoever went
    last."""
    for row in ctx.db.scalars(
        select(StudioPublication).where(StudioPublication.use_case_id == use_case_id)
    ).all():
        row.live = False

    row = ctx.db.scalar(
        select(StudioPublication).where(
            StudioPublication.use_case_id == use_case_id, StudioPublication.sha256 == sha
        )
    )
    if row is None:
        row = StudioPublication(use_case_id=use_case_id, sha256=sha)
        ctx.db.add(row)
    row.live = True
    row.published_by = by
    row.published_at = now_iso()
    ctx.db.commit()


def clear_publication(ctx: Ctx, use_case_id: str) -> None:
    for row in ctx.db.scalars(
        select(StudioPublication).where(StudioPublication.use_case_id == use_case_id)
    ).all():
        row.live = False
    ctx.db.commit()


# ---------------------------------------------------------------------------
# The review queue
# ---------------------------------------------------------------------------
DEFAULT_ACTIONS = [
    {"choice": "approve", "label": "Approve"},
    {"choice": "correct", "label": "Correct…"},
    {"choice": "reject", "label": "Reject"},
]


def studio_items(
    ctx: Ctx, use_case_id: str, bucket: str, total: int, authored: list[dict] | None = None
) -> list[dict[str, Any]]:
    """The must-review lane is entirely authored; the two spot-check buckets are
    synthesised by a hash that **includes the use case id**, so every built graph
    gets its own sample and repeats agree. Confidence is generated inside each
    bucket's band because the cards promise 0.85–0.95 and ≥0.95."""
    gen = ctx.doc["graph_studio"]["generated"]
    subjects = gen["subjects"]
    predicates = gen["predicates"]
    items = list(authored or [])

    for i in range(len(items), total):
        seed = js_hash(f"{use_case_id}:{bucket}:{i}")
        subject_index = seed % len(subjects)
        object_index = (seed >> 7) % len(subjects)
        if object_index == subject_index:
            object_index = (object_index + 1) % len(subjects)
        spread = (seed >> 11) % 100

        if bucket == "auto_approved":
            confidence = 0.95 + spread / 2000
        elif bucket == "confirmed":
            confidence = 0.85 + spread / 1000
        else:
            confidence = 0.7 + spread / 700

        floor = FLOORS[seed % len(FLOORS)] if bucket == "must_review" else None
        score = round_js(confidence, 2)

        items.append(
            {
                "item_id": f"rv-{bucket}-{i}",
                "kind": "relationship",
                "title": f"{subjects[subject_index]} → "
                f"{predicates[(seed >> 3) % len(predicates)]} → {subjects[object_index]}",
                "detail": (
                    f"L/S/T match — lexical {0.7 + ((seed >> 2) % 30) / 100:.2f} · "
                    f"structural {0.6 + ((seed >> 5) % 35) / 100:.2f} · "
                    f"evidence: the join holds on {80 + ((seed >> 9) % 20):.1f}% of sampled rows."
                ),
                "confidence": score,
                "band": "High" if score >= 0.95 else "Medium" if score >= 0.85 else "Low",
                "floor": floor,
                "action_set": "standard",
                "actions": list(DEFAULT_ACTIONS),
                "evidence": [],
                "graph_refs": [],
                "justification": floor == "schema-changing",
            }
        )
    return items


def _with_decision(item: dict, decisions: dict) -> dict[str, Any]:
    return {
        **item,
        "floor": item.get("floor"),
        "band": item.get("band"),
        "evidence": item.get("evidence") or [],
        "graph_refs": item.get("graph_refs") or [],
        "actions": item.get("actions") or list(DEFAULT_ACTIONS),
        "decision": decisions.get(item["item_id"]),
    }


def config_version(ctx: Ctx, use_case_id: str) -> str:
    """A brief that has never been built reports v1 — what its first build will
    produce, rather than a claim that a version exists."""
    return f"v{build_count(ctx, use_case_id) or 1}"


def build_count(ctx: Ctx, use_case_id: str) -> int:
    rows = ctx.db.scalars(
        select(StudioBuild.version).where(StudioBuild.use_case_id == use_case_id)
    ).all()
    return max(rows) if rows else 0


def studio_summary(ctx: Ctx, use_case: dict) -> dict[str, Any]:
    gen = ctx.doc["graph_studio"]["generated"]
    use_case_id = use_case["use_case_id"]
    decisions = decisions_for(ctx, use_case_id)

    outstanding = sum(
        1
        for i in studio_items(
            ctx,
            use_case_id,
            "must_review",
            gen["must_review_total"],
            ctx.doc["graph_studio"]["review_items"],
        )
        if i["item_id"] not in decisions
    )
    pivot_open = pivot_choice(ctx, use_case_id) is None
    published = published_version(ctx, use_case_id)

    return {
        "use_case_id": use_case_id,
        "name": use_case["name"],
        "domain_id": use_case.get("domain_id"),
        "business_need": use_case.get("business_need") or "",
        "version": config_version(ctx, use_case_id),
        "live_version": published["config_version"] if published else None,
        "state": "published" if published else "draft",
        "queue_count": outstanding + (1 if pivot_open else 0),
        "must_review_outstanding": outstanding,
        "must_review_count": gen["must_review_total"],
        "version_count": len(versions_for(ctx, use_case_id)),
        "published_count": 1 if published else 0,
        "built_at": use_case.get("updated_at"),
    }


def graph_studio(ctx: Ctx, use_case: dict) -> dict[str, Any]:
    studio = ctx.doc["graph_studio"]
    gen = studio["generated"]
    use_case_id = use_case["use_case_id"]
    decisions = decisions_for(ctx, use_case_id)

    must_review = [
        _with_decision(i, decisions)
        for i in studio_items(
            ctx, use_case_id, "must_review", gen["must_review_total"], studio["review_items"]
        )
    ]
    confirmed = [
        _with_decision(i, decisions)
        for i in studio_items(ctx, use_case_id, "confirmed", gen["sample_size"])
    ]
    auto_approved = [
        _with_decision(i, decisions)
        for i in studio_items(ctx, use_case_id, "auto_approved", gen["sample_size"])
    ]

    outstanding = sum(1 for i in must_review if not i["decision"])
    chosen = pivot_choice(ctx, use_case_id)
    pivot_open = chosen is None

    # Computed once, here. The button's `disabled`, its tooltip, the banner and
    # the publish refusal all read this one list.
    reasons = []
    if outstanding > 0:
        reasons.append(f"{outstanding} must-review relationship(s) unresolved")
    if pivot_open:
        reasons.append(
            f"1 pivot decision open ({studio['pivot']['pivot_id']} / "
            f"{studio['pivot']['alternative_id']})"
        )

    decided = len(must_review) - outstanding
    live = live_sha(ctx, use_case_id)

    return {
        **studio_summary(ctx, use_case),
        "graph_name": use_case["name"],
        "status": "draft",
        "decision_memory": "synced",
        "must_review": must_review,
        "must_review_count": len(must_review),
        "must_review_outstanding": outstanding,
        "confirmed_sample": confirmed,
        "confirmed_count": gen["confirmed_total"],
        "auto_approved_sample": auto_approved,
        "auto_approved_count": gen["auto_approved_total"],
        # `chosen` is the option id and nothing else — the client's schema is
        # `nullable(str)`, and handing it the whole decision record fails the
        # validator with "pivot.chosen should be a string, got object", which
        # reaches a reviewer as "the review queue could not be read".
        "pivot": {
            **studio["pivot"],
            "open": pivot_open,
            "chosen": chosen["option_id"] if chosen else None,
        },
        "pivot_count": 1 if pivot_open else 0,
        "sanity_checks": [
            {
                "check_id": c["check_id"],
                "hero_question_id": c.get("hero_question_id"),
                "question": c["question"],
            }
            for c in studio["sanity_checks"]
        ],
        "batch_resolved": decided + (0 if pivot_open else 1),
        "batch_total": gen["must_review_total"] + 1 + gen["spot_check_quota"],
        "publish": {
            "blocked": len(reasons) > 0,
            "reasons": reasons,
            "explanation": (
                "The pivot is a separate precondition from the queue — resolving every row "
                "still leaves publish blocked while an entity-resolution pivot is open, "
                "because a pivot changes what the other decisions mean."
            ),
        },
        "versions": [
            {**v, "published": v["sha256"] == live} for v in versions_for(ctx, use_case_id)
        ],
    }


def find_built_graph(ctx: Ctx, use_case_id: str) -> dict[str, Any]:
    """"Not built yet" is a different problem from "no such graph", and only one
    of them is solved by finishing the wizard."""
    use_case = next(
        (u for u in ctx.doc["graph_use_cases"] if u["use_case_id"] == use_case_id), None
    )
    if not use_case:
        return {"error": f"no graph {use_case_id}", "status": 404}
    if use_case.get("status") != "committed":
        return {
            "error": f"{use_case['name']} has not been built yet — finish it in New Graph "
            'and use "Save & build graph"',
            "status": 400,
        }
    return {"use_case": use_case}


# ---------------------------------------------------------------------------
# The canvas
# ---------------------------------------------------------------------------
def studio_canvas(
    ctx: Ctx,
    use_case_id: str,
    answer_path: list[str] | None = None,
    answer_edges: list[str] | None = None,
) -> dict[str, Any]:
    """**An element is "proposed" exactly while its review item is undecided**,
    so settling a row in the queue changes what this shows."""
    answer_path = answer_path or []
    decisions = decisions_for(ctx, use_case_id)

    def state(review_item_id: str | None) -> dict[str, Any]:
        if not review_item_id:
            return {"proposed": False, "origin": "derived", "rejected": False}
        decision = decisions.get(review_item_id)
        if not decision:
            return {"proposed": True, "origin": "derived", "rejected": False}
        return {
            "proposed": False,
            "origin": "studio-authored" if decision["choice"] == "correct" else "derived",
            "rejected": decision["choice"] == "reject",
        }

    nodes = []
    for n in ctx.doc["graph_studio"]["canvas"]["nodes"]:
        s = state(n.get("review_item_id"))
        nodes.append(
            {
                "node_id": n["node_id"],
                "label": n["label"],
                "sublabel": f"proposed · {n['confidence']:.2f}" if s["proposed"] else n["sublabel"],
                "type": n["type"],
                "element_class": n["element_class"],
                "source": n["source"],
                "degree": n["degree"],
                "r": n["r"],
                "group": n["group"],
                "confidence": n["confidence"],
                "proposed": s["proposed"],
                "origin": s["origin"],
                "rejected": bool(s["rejected"]),
                "needs_review": s["proposed"],
                "review_item_id": n.get("review_item_id"),
                "on_answer_path": n["node_id"] in answer_path,
                "x": n["x"],
                "y": n["y"],
            }
        )

    edges = []
    for e in ctx.doc["graph_studio"]["canvas"]["edges"]:
        s = state(e.get("review_item_id"))
        edges.append(
            {
                "edge_id": e["edge_id"],
                "from": e["from"],
                "to": e["to"],
                "label": f"{e['label']} · proposed" if s["proposed"] else e["label"],
                "detail": e.get("detail") or "",
                "proposed": s["proposed"],
                "review_item_id": e.get("review_item_id"),
                "on_answer_path": (
                    e["edge_id"] in answer_edges
                    if answer_edges is not None
                    else (e["from"] in answer_path and e["to"] in answer_path)
                ),
            }
        )

    types = []
    for n in nodes:
        if n["type"] not in types:
            types.append(n["type"])

    return {
        "nodes": nodes,
        "edges": edges,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "facets": {
            "all": len(nodes),
            "low_confidence": sum(1 for n in nodes if n["confidence"] < 0.85),
            "needs_review": sum(1 for n in nodes if n["needs_review"]),
            "studio_authored": sum(1 for n in nodes if n["origin"] == "studio-authored"),
            "groups": [
                {"key": key, "count": sum(1 for n in nodes if n["group"] == key)}
                for key in CANVAS_GROUPS
            ],
            "types": [
                {"key": key, "count": sum(1 for n in nodes if n["type"] == key)}
                for key in types
            ],
        },
    }


# ---------------------------------------------------------------------------
# Query & sanity-check
# ---------------------------------------------------------------------------
ASK_MATCH_MIN = 0.6

ASK_STOPWORDS = set(
    (
        "a an and are as at by did do does for from has have how in into is it its me my of on or our "
        "show shows tell that the their them then there these this to us was we what when where which "
        "who why will with you your every each are"
    ).split(" ")
)


def ask_tokens(text: Any) -> list[str]:
    import re

    cleaned = re.sub(r"[^a-z0-9\s]", " ", str(text).lower())
    return [w for w in cleaned.split() if len(w) > 2 and w not in ASK_STOPWORDS]


def match_sanity_check(ctx: Ctx, question: str) -> dict | None:
    """Matched at **the same threshold** Ask uses, so the studio cannot pass a
    question Ask then declines. A tie matches nothing."""
    checks = ctx.doc["graph_studio"].get("sanity_checks") or []
    asked = ask_tokens(question)
    if not checks or not asked:
        return None

    joined = " ".join(asked)
    exact = next((c for c in checks if " ".join(ask_tokens(c["question"])) == joined), None)
    if exact:
        return {"check": exact, "how": "the same question"}

    scored = []
    for c in checks:
        own = set(ask_tokens(c["question"]))
        shared = [w for w in asked if w in own]
        scored.append({"check": c, "score": len(shared) / len(asked), "shared": shared})
    scored.sort(key=lambda s: -s["score"])

    best = scored[0]
    runner_up = scored[1] if len(scored) > 1 else None
    if best["score"] < ASK_MATCH_MIN:
        return None
    if runner_up and runner_up["score"] == best["score"]:
        return None
    return {
        "check": best["check"],
        "how": f"it matches a recorded check on {', '.join(best['shared'][:4])}",
    }


NO_RECORDED_CHECK = {
    "recorded": False,
    "check_id": None,
    "hero_question_id": None,
    "matched_how": None,
    "verdict": None,
    "verdict_body": None,
    "context": [],
    "plan": None,
    "cost_usd": None,
    "budget_usd": None,
}


def studio_query(ctx: Ctx, use_case_id: str, question: str) -> dict[str, Any]:
    """A recorded check wins and names itself; anything unrecognised falls
    through to a real breadth-first walk, which abstains rather than inventing
    a route."""
    import re

    canvas = studio_canvas(ctx, use_case_id)
    asked = str(question).lower()
    by_id = {n["node_id"]: n for n in canvas["nodes"]}

    def label(node_id: str) -> str:
        return by_id.get(node_id, {}).get("label", node_id)

    def edge_type(e: dict) -> str:
        return re.sub(r" · proposed$", "", e["label"])

    def caveats_for(edges: list[dict]) -> list[str]:
        return [
            f"{label(e['from'])} → {edge_type(e)} → {label(e['to'])} is still under review"
            for e in edges
            if e["proposed"]
        ]

    def as_hop(e: dict) -> dict[str, Any]:
        return {
            "edge_id": e["edge_id"],
            "from": e["from"],
            "to": e["to"],
            "label": edge_type(e),
            "from_label": label(e["from"]),
            "to_label": label(e["to"]),
            "proposed": e["proposed"],
        }

    recorded = match_sanity_check(ctx, question)
    if recorded:
        check = recorded["check"]
        by_edge = {e["edge_id"]: e for e in canvas["edges"]}
        hops = [by_edge[i] for i in check["edges_used"] if i in by_edge]
        # `path_labels` is empty on a recorded check and the hops are listed from
        # `edges_used` instead: a recorded traversal is a sub-graph, not a chain,
        # and arrow-joining ids would claim a route nobody walked.
        return {
            "question": question,
            "answerable": True,
            "reason": f"{check['verdict']} Walked {len(hops)} relationship(s) that exist in the draft.",
            "matched": [label(i) for i in check["path"]],
            "path": check["path"],
            "path_labels": [],
            "edges_used": [as_hop(e) for e in hops],
            "hops": len(hops),
            "caveats": caveats_for(hops),
            "recorded": True,
            "check_id": check["check_id"],
            "hero_question_id": check.get("hero_question_id"),
            "matched_how": recorded["how"],
            "verdict": check["verdict"],
            "verdict_body": check.get("verdict_body"),
            "context": check.get("context") or [],
            "plan": check.get("plan"),
            "cost_usd": check.get("cost_usd"),
            "budget_usd": check.get("budget_usd"),
        }

    def words_of(text: str) -> list[str]:
        return [w for w in re.split(r"[^a-z0-9#]+", text.lower()) if len(w) > 3]

    # A word from the ontology's own vocabulary cannot name an instance — read
    # off the node types and edge labels rather than a hand-written list.
    kind_words: set[str] = set()
    for text in [n["type"] for n in canvas["nodes"]] + [e["label"] for e in canvas["edges"]]:
        for w in re.split(r"(?=[A-Z])|[^A-Za-z0-9]+", str(text)):
            if len(w) > 2:
                kind_words.add(w.lower())

    seen_in: dict[str, int] = {}
    for n in canvas["nodes"]:
        for w in set(words_of(n["label"])):
            seen_in[w] = seen_in.get(w, 0) + 1

    rare_max = max(1, round_js(len(canvas["nodes"]) * 0.05))
    # A concept node's label *is* a bare type name, so the whole-label shortcut
    # has to clear the same stoplist or "the Denka facility" resolves to
    # CONCEPT:Facility.
    instances = [n for n in canvas["nodes"] if n["element_class"] != "concept"]

    matched = []
    for n in instances:
        own = n["label"].lower()
        if own in asked and own not in kind_words:
            matched.append(n)
            continue
        if any(
            w not in kind_words and seen_in.get(w, 0) <= rare_max and w in asked
            for w in words_of(n["label"])
        ):
            matched.append(n)

    if len(matched) < 2:
        return {
            "question": question,
            "answerable": False,
            "reason": (
                "No entity in this graph is named in the question."
                if not matched
                else f"Only {matched[0]['label']} is named — a question needs two things to relate."
            ),
            "matched": [n["label"] for n in matched],
            "path": [],
            "path_labels": [],
            "edges_used": [],
            "hops": 0,
            "caveats": [],
            **NO_RECORDED_CHECK,
        }

    start, goal = matched[0], matched[1]

    neighbours: dict[str, list[dict]] = {}
    for e in canvas["edges"]:
        neighbours.setdefault(e["from"], []).append({"to": e["to"], "edge": e})
        neighbours.setdefault(e["to"], []).append({"to": e["from"], "edge": e})

    queue = [[start["node_id"]]]
    seen = {start["node_id"]}
    path = None
    while queue and not path:
        here = queue.pop(0)
        last = here[-1]
        if last == goal["node_id"]:
            path = here
            break
        for step in neighbours.get(last, []):
            if step["to"] in seen:
                continue
            seen.add(step["to"])
            queue.append(here + [step["to"]])

    if not path:
        return {
            "question": question,
            "answerable": False,
            "reason": f"{start['label']} and {goal['label']} are both in the graph, but "
            "nothing connects them yet.",
            "matched": [n["label"] for n in matched],
            "path": [],
            "path_labels": [],
            "edges_used": [],
            "hops": 0,
            "caveats": [],
            **NO_RECORDED_CHECK,
        }

    edges_used = []
    for i in range(len(path) - 1):
        edge = next(
            (
                e
                for e in canvas["edges"]
                if (e["from"] == path[i] and e["to"] == path[i + 1])
                or (e["to"] == path[i] and e["from"] == path[i + 1])
            ),
            None,
        )
        if edge:
            edges_used.append(edge)

    return {
        "question": question,
        "answerable": True,
        "reason": f"Answered over {len(edges_used)} relationship(s) that exist in the draft.",
        "matched": [n["label"] for n in matched],
        "path": path,
        "path_labels": [label(i) for i in path],
        "edges_used": [as_hop(e) for e in edges_used],
        "hops": len(edges_used),
        "caveats": caveats_for(edges_used),
        **NO_RECORDED_CHECK,
    }


# ---------------------------------------------------------------------------
# Builds and versions
# ---------------------------------------------------------------------------
def _stage_index_at(cursor: int) -> int:
    return BUILD_STEPS[cursor]["stageIndex"] if cursor < len(BUILD_STEPS) else len(BUILD_STAGES)


def build_view(run: dict) -> dict[str, Any]:
    """`step_ms` is reported so the panel's "…left" figure derives from the
    server's pace rather than restating it."""
    cursor = run["cursor"]
    stages = []
    for i, stage in enumerate(BUILD_STAGES):
        flat = [
            {**s, "index": index}
            for index, s in enumerate(BUILD_STEPS)
            if s["stageIndex"] == i
        ]
        done = all(s["index"] < cursor for s in flat)
        started = any(s["index"] < cursor for s in flat)
        stages.append(
            {
                "key": stage["key"],
                "state": "complete"
                if done
                else "running"
                if started or i == _stage_index_at(cursor)
                else "pending",
                "steps": [
                    {
                        "key": s["step"],
                        "state": "complete"
                        if s["index"] < cursor
                        else "running"
                        if s["index"] == cursor
                        else "pending",
                    }
                    for s in flat
                ],
            }
        )

    return {
        "build_id": run["build_id"],
        "use_case_id": run["use_case_id"],
        "status": run["status"],
        "stage_index": _stage_index_at(cursor),
        "stage_total": len(BUILD_STAGES),
        "step_index": cursor,
        "step_total": len(BUILD_STEPS),
        "step_ms": BUILD_STEP_MS,
        "stages": stages,
        "package_id": run["package_id"],
        "graph_version": run["graph_version"],
        "config_version": run["config_version"],
        "started_at": run["started_at"],
        "finished_at": run.get("finished_at"),
    }


def start_build(ctx: Ctx, use_case: dict) -> dict[str, Any]:
    """`package_id` and `graph_version` are minted per run, so a rebuild is
    visibly a different package — reporting one id for both would say a rebuild
    changed nothing."""
    use_case_id = use_case["use_case_id"]
    build_id = str(uuid.uuid4())
    version = build_count(ctx, use_case_id) + 1

    run = {
        "build_id": build_id,
        "use_case_id": use_case_id,
        "status": "running",
        "cursor": 0,
        "package_id": f"a{js_hash(f'package:{build_id}') % 0xFFFFFFF:07x}",
        "graph_version": f"{js_hash(f'version:{build_id}') % 0xFFFFFFF:07x}f",
        "config_version": f"v{version}",
        "started_at": now_iso(),
        "finished_at": None,
        "sha256": None,
        "gate": None,
    }
    ctx.db.add(
        StudioBuild(
            build_id=build_id,
            use_case_id=use_case_id,
            version=version,
            status="running",
            started_at=run["started_at"],
            data=run,
        )
    )
    ctx.db.commit()
    return run


def advance_build(ctx: Ctx, run: dict, use_case: dict) -> dict:
    if run["status"] != "running":
        return run

    started = datetime.fromisoformat(run["started_at"].replace("Z", "+00:00"))
    elapsed = (datetime.now(timezone.utc) - started).total_seconds() * 1000
    cursor = min(len(BUILD_STEPS), int(elapsed // BUILD_STEP_MS))
    run["cursor"] = cursor

    if cursor >= len(BUILD_STEPS):
        run["status"] = "complete"
        run["finished_at"] = run.get("finished_at") or now_iso()
        run["sha256"] = (
            f"{js_hash(f'sha:{run['build_id']}') % 0xFFFFFFFFFFF:x}"
            f"{js_hash(f'sha2:{run['build_id']}') % 0xFFFFFFF:x}"
        )
        run["gate"] = "passed" if studio_summary(ctx, use_case)["queue_count"] == 0 else "unknown"

    row = ctx.db.get(StudioBuild, run["build_id"])
    if row:
        row.status = run["status"]
        row.data = dict(run)
        ctx.db.commit()
    return run


def builds_for(ctx: Ctx, use_case_id: str, use_case: dict) -> list[dict]:
    """Newest first, and every read advances a live run."""
    rows = ctx.db.scalars(
        select(StudioBuild)
        .where(StudioBuild.use_case_id == use_case_id)
        .order_by(StudioBuild.started_at.desc())
    ).all()
    # `deepcopy`, not `r.data` — see the note in `runtime.Ctx`. Advancing the
    # loaded dict in place would make the write back a no-op and lose the hash.
    return [advance_build(ctx, deepcopy(r.data), use_case) for r in rows]


def versions_for(ctx: Ctx, use_case_id: str) -> list[dict[str, Any]]:
    """Every version, which is to say every build — newest first, one row each.

    The build's *number* is a name; the hash is its identity. Two builds of one
    brief differ at the hash and nowhere else.
    """
    rows = ctx.db.scalars(
        select(StudioBuild)
        .where(StudioBuild.use_case_id == use_case_id, StudioBuild.status == "complete")
        .order_by(StudioBuild.started_at.desc())
    ).all()

    canvas = studio_canvas(ctx, use_case_id)
    gen = ctx.doc["graph_studio"]["generated"]

    out = []
    for r in rows:
        run = r.data
        if not run.get("sha256"):
            continue
        out.append(
            {
                "sha256": run["sha256"],
                "graph_id": run["graph_version"],
                "config_version": run["config_version"],
                "entities": gen.get("entity_total") or canvas["node_count"],
                "relationships": canvas["edge_count"],
                "from_job": run["build_id"],
                "created_at": run["finished_at"],
                "gate": run.get("gate") or "unknown",
            }
        )
    return out


def built_graphs(ctx: Ctx) -> list[dict]:
    return [u for u in ctx.doc["graph_use_cases"] if u.get("status") == "committed"]
