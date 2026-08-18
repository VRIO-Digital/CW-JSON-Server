"""
Ask: where a *published* graph gets used.

Ask queries the published version and only that one — a draft is absent, a
built-but-unpublished graph is absent, and unpublishing takes a graph out of Ask
immediately.

**An abstention is an answer.** When nothing matches, `answered` is false,
`reason` says which, and `answer`/`confidence` are null — no number is invented
to fill the field. A query engine that always produces a paragraph is a search
box with better manners.
"""

from __future__ import annotations

from typing import Any

from ..core import (
    entity_name,
    normalize_questions,
    normalize_source_picks,
    now_iso,
    round_js,
    slugify,
)
from ..runtime import Ctx
from .graph import match_score, selected_profiled_objects
from .studio import (
    ASK_MATCH_MIN,
    ask_tokens,
    published_by_for,
    published_version,
    studio_canvas,
    studio_query,
)

ASK_STAGE_MS = 420
ASK_BLOCK_MS = 5_000

CITATION_OPTIONS = [
    {"value": "required", "label": "Required — every claim cites its source"},
    {"value": "optional", "label": "Optional"},
]
DEFAULT_CITATIONS = "required"

GAP_CAVEAT = {
    "accept permanent": "unavailable — no connected source covers it",
    "drop question": "out of scope for this graph",
    "connect source": "unavailable until the promised source is connected",
    "defer with trigger": "deferred — unavailable until its trigger fires",
}


def ask_answer_formats(ctx: Ctx) -> list[dict[str, Any]]:
    return [
        {"format_id": f["format_id"], "name": f["name"], "format": str(f.get("format") or "")}
        for f in ctx.doc.get("graph_answer_formats") or []
    ]


def ask_caveats(ctx: Ctx, use_case: dict) -> list[str]:
    """The standing caveats are the coverage step's gap decisions read back —
    not written copy pretending to be data."""
    from ..core import normalize_gap_decisions

    questions = normalize_questions(use_case.get("hero_questions"))
    out = []
    for g in normalize_gap_decisions(use_case.get("gap_decisions")):
        if not g["element_id"].startswith("gap:") or g["decision"] not in GAP_CAVEAT:
            continue
        slug = g["element_id"][len("gap:") :]
        q = next((h for h in questions if slugify(h["text"])[:48] == slug), None)
        out.append(f"{q['text'] if q else slug} — {GAP_CAVEAT[g['decision']]}")
    return out


def askable_graph(ctx: Ctx, use_case: dict) -> dict[str, Any] | None:
    """Reports the content it answered from — "which build answered this" is a
    question a reader is entitled to ask."""
    published = published_version(ctx, use_case["use_case_id"])
    if not published:
        return None
    canvas = studio_canvas(ctx, use_case["use_case_id"])
    return {
        "use_case_id": use_case["use_case_id"],
        "name": use_case["name"],
        "domain_id": use_case.get("domain_id"),
        "version": published["config_version"],
        "published_at": published["created_at"],
        "published_by": published_by_for(ctx, use_case["use_case_id"]),
        "graph_id": published["graph_id"],
        "sha256": published["sha256"],
        "caveats": ask_caveats(ctx, use_case),
        "suggested_questions": [
            q["text"] for q in normalize_questions(use_case.get("hero_questions"))
        ],
        "entity_count": canvas["node_count"],
        "relationship_count": canvas["edge_count"],
    }


def match_ask_answer(ctx: Ctx, question: str) -> dict | None:
    """The recorded answer wins, and every one names **which** it was — so a
    written answer is never read as something the walk derived. A tie matches
    nothing."""
    answers = ctx.doc.get("ask_answers") or []
    asked = ask_tokens(question)
    if not answers or not asked:
        return None

    joined = " ".join(asked)
    exact = next((a for a in answers if " ".join(ask_tokens(a["question"])) == joined), None)
    if exact:
        return {"answer": exact, "how": "the same question"}

    scored = []
    for a in answers:
        own = set(ask_tokens(a["question"]))
        shared = [w for w in asked if w in own]
        scored.append({"answer": a, "score": len(shared) / len(asked), "shared": shared})
    scored.sort(key=lambda s: -s["score"])

    best = scored[0]
    runner_up = scored[1] if len(scored) > 1 else None
    if best["score"] < ASK_MATCH_MIN:
        return None
    if runner_up and runner_up["score"] == best["score"]:
        return None
    return {
        "answer": best["answer"],
        "how": f"it matches a recorded question on {', '.join(best['shared'][:4])}",
    }


def ask_requested(ctx: Ctx, body: dict) -> dict[str, Any]:
    """The pool is served, never written into the component — a client-held list
    can offer a value the API refuses. An unknown `format_id` is a plain 400
    naming the pool, before the stream opens."""
    citations = body.get("citations", DEFAULT_CITATIONS)
    if not any(o["value"] == citations for o in CITATION_OPTIONS):
        allowed = ", ".join(o["value"] for o in CITATION_OPTIONS)
        return {"error": f"citations must be one of: {allowed}"}

    asked = [] if body.get("formats") is None else body["formats"]
    if not isinstance(asked, list):
        return {"error": "formats must be an array of format_id"}

    pool = ask_answer_formats(ctx)
    unknown = [i for i in asked if not any(f["format_id"] == i for f in pool)]
    if unknown:
        offered = ", ".join(f["format_id"] for f in pool)
        return {
            "error": f"unknown answer format(s): {', '.join(unknown)} — this graph offers {offered}"
        }

    return {
        "citations": citations,
        "formats": [f for f in pool if f["format_id"] in asked],
    }


def ask_requirements(requested: dict, citations: list, answered: bool) -> dict[str, Any]:
    """Computed rather than asserted.

    **Citations really apply**: asking for them and getting an answer that cites
    nothing is a fact, so `satisfied` is false. **A format is stated, not
    applied** — a recorded answer holds the blocks the tenant wrote, so claiming
    it was rendered to order is a claim the screen underneath disproves.
    """
    cited = len(citations)
    satisfied = requested["citations"] != "required" or cited > 0

    if requested["citations"] == "required":
        if cited > 0:
            citation_note = (
                f"Citations required — {cited} attached, one per claim this answer rests on."
            )
        elif answered:
            citation_note = (
                "Citations required, and this answer carries none: nothing on the route "
                "names a source."
            )
        else:
            citation_note = (
                "Citations required, but nothing was answered, so there is nothing to cite."
            )
    else:
        citation_note = f"Citations optional — {cited} attached."

    if requested["formats"]:
        names = ", ".join(f["name"] for f in requested["formats"])
        format_note = (
            f" Requested render: {names} — stated, not applied: an answer renders as the "
            "blocks it holds."
        )
    else:
        format_note = ""

    return {
        "citations": requested["citations"],
        "formats": requested["formats"],
        "satisfied": satisfied,
        "note": f"{citation_note}{format_note}",
    }


def ask_answer(
    ctx: Ctx, use_case: dict, question: str, requested: dict | None = None
) -> dict[str, Any]:
    """The walk is the studio's, deliberately: the sanity check that passed
    before publishing cannot then disagree with the answer after it.

    What Ask adds is the part a reader can audit — the entities the question was
    grounded in, the relationships that carried it, and a confidence that is the
    **weakest node on the route**, not a flourish.
    """
    requested = requested or {"citations": DEFAULT_CITATIONS, "formats": []}
    use_case_id = use_case["use_case_id"]
    graph = askable_graph(ctx, use_case)
    walk = studio_query(ctx, use_case_id, question)
    canvas = studio_canvas(ctx, use_case_id)

    picks = normalize_source_picks(use_case.get("sources"))
    routed = (
        f"{len(picks)} source pick(s) behind this graph: "
        f"{', '.join(p['source_id'] for p in picks)}."
        if picks
        else "No source picks are recorded on this brief."
    )

    grounding = {
        "step": "Grounded the question in the graph",
        "detail": (
            f"Matched {len(walk['matched'])} entity(ies) in {use_case['name']} "
            f"{graph['version']}: {', '.join(walk['matched'])}."
            if walk["matched"]
            else f"Nothing in {use_case['name']} {graph['version']} is named in the question."
        ),
    }

    base = {
        "question": question,
        "use_case_id": use_case_id,
        "graph_name": use_case["name"],
        "version": graph["version"],
        "entities": walk["matched"],
        "hops": walk["hops"],
        "caveats": [*graph["caveats"], *walk["caveats"]],
        "asked_at": now_iso(),
    }

    recorded = match_ask_answer(ctx, question)
    if recorded:
        a = recorded["answer"]
        reasoning = [
            grounding,
            {
                "step": "Answered from the recorded query set",
                "detail": f"{a['answer_id']} ({a['kind']}"
                + (f", {a['hero_ref']}" if a.get("hero_ref") else "")
                + f") — {recorded['how']}.",
            },
        ]
        citations = [
            {"label": e["source"], "detail": e.get("detail"), "confidence": None}
            for e in (a.get("evidence") or [])
            if e.get("source") and e["source"] != "—"
        ]

        if a["kind"] == "decline":
            return {
                **base,
                "answered": False,
                "reason": a["summary"],
                "answer": None,
                "confidence": None,
                "path": [],
                "reasoning": [*reasoning, {"step": "Declined", "detail": a["summary"]}],
                "citations": citations,
                "requirements": ask_requirements(requested, citations, False),
                "summary": a["summary"],
                "blocks": a["blocks"],
                "answer_id": a["answer_id"],
            }

        return {
            **base,
            "answered": True,
            "reason": f"Answered from {a['answer_id']} — {a['persona']}'s question, "
            f"recorded against {graph['version']}.",
            "answer": a["summary"],
            "confidence": a["confidence"],
            "path": walk["path_labels"] if walk["answerable"] else [],
            "reasoning": reasoning,
            "citations": citations,
            "requirements": ask_requirements(requested, citations, True),
            "summary": a["summary"],
            "blocks": a["blocks"],
            "answer_id": a["answer_id"],
        }

    if not walk["answerable"]:
        return {
            **base,
            "answered": False,
            "reason": walk["reason"],
            "answer": None,
            "confidence": None,
            "path": [],
            "reasoning": [grounding, {"step": "Abstained", "detail": walk["reason"]}],
            "citations": [],
            "requirements": ask_requirements(requested, [], False),
            "summary": None,
            "blocks": [],
            "answer_id": None,
        }

    labels = walk["path_labels"]
    by_id = {n["node_id"]: n for n in canvas["nodes"]}

    def confidence_of(node_id: str) -> float:
        return by_id.get(node_id, {}).get("confidence", 1)

    def label_for(node_id: str) -> str:
        return by_id.get(node_id, {}).get("label", node_id)

    confidence = round_js(min(confidence_of(i) for i in walk["path"]), 2)

    citations = [
        {
            "label": f"{label_for(e['from'])} → {e['label']} → {label_for(e['to'])}",
            "detail": f"relationship in {graph['version']}, settled in review before publish",
            "confidence": round_js(min(confidence_of(e["from"]), confidence_of(e["to"])), 2),
        }
        for e in walk["edges_used"]
    ]

    for o in selected_profiled_objects(ctx, use_case.get("sources")):
        if entity_name(o["label"]) not in labels:
            continue
        citations.append(
            {
                "label": f"{o['label']} ({o['size']})",
                "detail": f"{o['sourceName']} · {o['evidenceKind']}",
                "confidence": match_score(f"{o['sourceName']}:{o['objectId']}"),
            }
        )

    return {
        **base,
        "answered": True,
        "reason": f"Answered over {walk['hops']} relationship(s) that exist in {graph['version']}.",
        "answer": (
            f"{labels[0]} connects to {labels[-1]} over {walk['hops']} relationship(s) in "
            f"{use_case['name']} {graph['version']}: {' → '.join(labels)}."
        ),
        "confidence": confidence,
        "path": labels,
        "reasoning": [
            grounding,
            {
                "step": "Planned the route",
                "detail": f"Walked {walk['hops']} relationship(s) that exist in "
                f"{graph['version']}: {' → '.join(labels)}.",
            },
            {"step": "Routed to source systems", "detail": routed},
            {
                "step": "Composed the answer",
                "detail": f"Confidence {confidence:.2f} — the weakest entity on the route. "
                f"{len(citations)} citation(s); citations are {requested['citations']} "
                "for this question.",
            },
        ],
        "citations": citations,
        "requirements": ask_requirements(requested, citations, True),
        "summary": None,
        "blocks": [],
        "answer_id": None,
    }
