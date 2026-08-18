"""
The catalogue: what a source holds, what has been profiled, and the two
dictionaries that describe columns and documents.

**The profiler is paced, and the pacing is derived rather than driven.** The
Node server advanced a job on `setTimeout`, which works only while one process
owns the job. Here a job records when it was triggered and its stage is computed
from elapsed wall-clock time on every read — same 1.2s queue and 2.2s stages,
same five-stage pipeline, but a restart no longer strands a job half-run and two
workers cannot advance it twice.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from ..core import js_hash, now_iso, round_js
from ..runtime import Ctx

HIGH_CONFIDENCE = 0.85


# ---------------------------------------------------------------------------
# The column dictionary
# ---------------------------------------------------------------------------
def table_dictionary(
    ctx: Ctx, source: dict, dataset_id: str, table_id: str, column_count: int, table_rows: int
) -> list[dict[str, Any]]:
    """The profiled columns are real — 206 of them, ingested from the demo
    package. `synthesise_columns` is the fallback for a table with no entry, and
    it is a fallback: the workbook is the source of truth."""
    profiled = (ctx.doc.get("column_profiles") or {}).get(f"{dataset_id}.{table_id}")
    if isinstance(profiled, list) and profiled:
        notes = source.get("column_notes") or {}
        out = []
        for c in profiled:
            note = notes.get(f"{dataset_id}.{table_id}.{c['column_id']}")
            out.append(
                {
                    "column_id": c["column_id"],
                    "label": c["label"],
                    "type": c["type"],
                    "class": c["class"],
                    "confidence": c["confidence"],
                    "derivation": c["derivation"],
                    "pii": bool(c.get("pii")),
                    "null_pct": c["null_pct"],
                    "distinct": c["distinct"],
                    "description": note if note else c["description"],
                    "description_status": (
                        "described"
                        if note or c["confidence"] >= HIGH_CONFIDENCE
                        else "needs review"
                    ),
                }
            )
        return out
    return synthesise_columns(ctx, source, dataset_id, table_id, column_count, table_rows)


def synthesise_columns(
    ctx: Ctx, source: dict, dataset_id: str, table_id: str, column_count: int, table_rows: int
) -> list[dict[str, Any]]:
    """Sliced from the vocabulary at a hashed offset, with statistics hashed
    from table+column so repeat requests agree.

    A repeated name is suffixed `_2` only when *that* table has already used it —
    never on the vocabulary's second lap, because the slice starts at a hashed
    offset and lap-based suffixing printed a `_2` whose `_1` appeared nowhere.
    """
    vocab = ctx.doc["column_vocabulary"]
    offset = js_hash(table_id) % len(vocab)
    notes = source.get("column_notes") or {}
    used: dict[str, int] = {}
    out = []

    for i in range(column_count):
        v = vocab[(offset + i) % len(vocab)]
        seen = used.get(v["name"], 0) + 1
        used[v["name"]] = seen
        column_id = f"{v['name']}_{seen}" if seen > 1 else v["name"]
        seed = js_hash(f"{table_id}:{column_id}")

        null_pct = 0 if v["class"] == "identifier" else round_js((seed % 430) / 100, 1)

        if v["class"] == "identifier":
            distinct = table_rows
        elif v["class"] == "date":
            distinct = max(1, _js_round(table_rows / 90))
        elif v["class"] == "measure":
            distinct = max(1, _js_round(table_rows / 7))
        elif v["class"] == "text":
            distinct = max(1, _js_round(table_rows * 0.86))
        elif v["class"] == "entity":
            distinct = max(1, (seed % 2600) + 40)
        else:
            distinct = max(1, (seed % 1180) + 18)

        description = notes.get(f"{dataset_id}.{table_id}.{column_id}")
        out.append(
            {
                "column_id": column_id,
                "label": column_id.replace("_", " ").upper(),
                "type": v["type"],
                "class": v["class"],
                "confidence": v["confidence"],
                "derivation": "llm",
                "pii": bool(v.get("pii")),
                "null_pct": null_pct,
                "distinct": min(distinct, max(table_rows, 1)),
                "description": description,
                "description_status": "described" if description else "needs review",
            }
        )
    return out


def _js_round(value: float) -> int:
    """`Math.round` rounds half *up* (towards +infinity), not half to even."""
    import math

    return math.floor(value + 0.5)


# ---------------------------------------------------------------------------
# The document dictionary
# ---------------------------------------------------------------------------
def document_dictionary(ctx: Ctx, source: dict, folder_id: str, doc: dict) -> dict[str, Any]:
    """Reviews files, not fields.

    `resolution` is read from `document_extractions` and is **not** folded into
    the synthesised entity list: a read fact and a hashed one must not sit in one
    column looking alike.
    """
    vocab = ctx.doc["document_vocabulary"]
    offset = js_hash(doc["document_id"]) % len(vocab)
    notes = source.get("document_notes") or {}
    chunks = max(1, _js_round(doc["pages"] * 2.5))
    used: dict[str, int] = {}
    entities = []

    for i in range(doc["entities"]):
        v = vocab[(offset + i) % len(vocab)]
        seen = used.get(v["name"], 0) + 1
        used[v["name"]] = seen
        entity_id = f"{v['name']}_{seen}" if seen > 1 else v["name"]
        seed = js_hash(f"{doc['document_id']}:{entity_id}")

        if v["class"] == "identifier":
            occurrences = 1 + (seed % 2)
        elif v["class"] == "text":
            occurrences = max(1, (seed % chunks) + 1)
        else:
            occurrences = max(1, (seed % 9) + 1)

        entities.append(
            {
                "entity_id": entity_id,
                "type": v["type"],
                "class": v["class"],
                "confidence": v["confidence"],
                "pii": bool(v.get("pii")),
                "occurrences": occurrences,
                "coverage_pct": round_js(min(100, (occurrences / chunks) * 100), 1),
            }
        )

    summary = notes.get(f"{folder_id}.{doc['document_id']}")
    return {
        "document_id": doc["document_id"],
        "name": doc["name"],
        "mime_type": doc["mime_type"],
        "doc_type": doc["doc_type"],
        "doc_type_label": doc["doc_type_label"],
        "linked_entity": doc["linked_entity"],
        "resolution": (ctx.doc.get("document_extractions") or {}).get(doc["document_id"]),
        "pages": doc["pages"],
        "size_mb": doc["size_mb"],
        "modified": doc["modified"],
        "chunks": chunks,
        "entity_count": len(entities),
        "pii_count": sum(1 for e in entities if e["pii"]),
        "summary": summary,
        "summary_status": "described" if summary else "needs review",
        "entities": entities,
    }


# ---------------------------------------------------------------------------
# Rows and browsing
# ---------------------------------------------------------------------------
def source_row(source: dict) -> dict[str, Any]:
    is_drive = source.get("kind") == "gdrive"
    if is_drive:
        scope = f"{len(source.get('folders') or [])} folder(s)"
    elif source.get("kind") == "bigquery":
        scope = f"{len(source.get('datasets') or [])} dataset(s)"
    else:
        scope = "—"

    return {
        "source_id": source["source_id"],
        "source_name": source["source_name"],
        "connector": source["connector"],
        "status": source["status"],
        "project_account": source.get("project_id")
        or source.get("drive_id")
        or source.get("account")
        or "—",
        "scope": scope,
        "connected_at": source["registered_at"],
        "profiled_tables": source.get("profiled_tables") or 0,
        "profiled_columns": source.get("profiled_columns") or 0,
        "profiled_documents": (source.get("profiled_documents") or 0) if is_drive else None,
        "profiled_entities": (source.get("profiled_entities") or 0) if is_drive else None,
        "datasets": source.get("datasets") or [],
        "folders": source.get("folders") or [],
        "kind": source.get("kind"),
    }


def browsable_objects(ctx: Ctx, source: dict) -> dict[str, Any]:
    project = ctx.find_project(source.get("project_id"))
    datasets = []
    for dataset_id in source.get("datasets") or []:
        dataset = next(
            (d for d in (project or {}).get("datasets", []) if d["dataset_id"] == dataset_id),
            None,
        )
        tables = [
            {
                "table_id": t["table_id"],
                "label": t["label"],
                "type": t.get("type"),
                "grain": t["grain"],
                "columns": t["columns"],
                "rows": t["rows"],
                "profiled": any(
                    p["dataset_id"] == dataset_id and p["table_id"] == t["table_id"]
                    for p in source.get("profiled") or []
                ),
            }
            for t in (dataset or {}).get("tables", [])
        ]
        datasets.append(
            {"dataset_id": dataset_id, "table_count": len(tables), "tables": tables}
        )

    return {
        "datasets": datasets,
        "dataset_count": len(datasets),
        "object_count": sum(d["table_count"] for d in datasets),
    }


def browsable_documents(ctx: Ctx, source: dict) -> dict[str, Any]:
    drive = ctx.find_drive(source.get("drive_id"))
    profiled = source.get("profiled_docs") or []
    folders = []
    for folder_id in source.get("folders") or []:
        folder = ctx.find_folder(drive, folder_id)
        documents = [
            {
                "document_id": d["document_id"],
                "name": d["name"],
                "mime_type": d["mime_type"],
                "doc_type": d["doc_type"],
                "doc_type_label": d["doc_type_label"],
                "linked_entity": d["linked_entity"],
                "pages": d["pages"],
                "size_mb": d["size_mb"],
                "entities": d["entities"],
                "modified": d["modified"],
                "profiled": any(
                    p["folder_id"] == folder_id and p["document_id"] == d["document_id"]
                    for p in profiled
                ),
            }
            for d in (folder or {}).get("documents", [])
        ]
        folders.append(
            {
                "folder_id": folder_id,
                "name": (folder or {}).get("name") or folder_id,
                "path": (folder or {}).get("path") or "",
                "document_count": len(documents),
                "documents": documents,
            }
        )

    return {
        "folders": folders,
        "folder_count": len(folders),
        "object_count": sum(f["document_count"] for f in folders),
    }


# ---------------------------------------------------------------------------
# The profiling pipeline
# ---------------------------------------------------------------------------
PIPELINE = [
    "Schema fetch",
    "Statistics sampling",
    "Class inference",
    "PII detection",
    "Candidate keys",
]
DOC_PIPELINE = [
    "Text extraction",
    "Chunking",
    "Entity extraction",
    "Document PII detection",
    "Topic classification",
]
QUEUE_MS = 1200
STAGE_MS = 2200


def pipeline_for(job: dict) -> list[str]:
    return DOC_PIPELINE if job["kind"] == "gdrive" else PIPELINE


def _parse_iso(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def _elapsed_ms(since: str) -> float:
    return (datetime.now(timezone.utc) - _parse_iso(since)).total_seconds() * 1000


def elapsed_seconds(job: dict) -> int:
    if not job.get("started_at"):
        return 0
    end = (
        _parse_iso(job["finished_at"])
        if job.get("finished_at")
        else datetime.now(timezone.utc)
    )
    return max(0, _js_round((end - _parse_iso(job["started_at"])).total_seconds()))


def job_view(job: dict) -> dict[str, Any]:
    stages = pipeline_for(job)
    return {
        "job_id": job["job_id"],
        "short_id": job["short_id"],
        "source_id": job["source_id"],
        "kind": job["kind"],
        "unit": job["unit"],
        "status": job["status"],
        "stage_index": job["stage_index"],
        "stage_total": len(stages),
        "stage_label": job["stage_label"],
        "pipeline": f"{job['stage_index']}/{len(stages)}: {job['stage_label']}",
        "progress": job["progress"],
        "objects": job["objects"],
        "object_count": len(job["objects"]),
        "objects_done": sum(1 for o in job["objects"] if o["state"] != "pending"),
        "force": job["force"],
        "triggered_at": job["triggered_at"],
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
        "elapsed_seconds": elapsed_seconds(job),
        "triggered_by": job["triggered_by"],
        "error": job.get("error"),
    }


def recount(source: dict) -> None:
    if source.get("kind") == "gdrive":
        docs = source.get("profiled_docs") or []
        source["profiled_documents"] = len(docs)
        source["profiled_entities"] = sum(p["entities"] for p in docs)
        return
    profiled = source.get("profiled") or []
    source["profiled_tables"] = len(profiled)
    source["profiled_columns"] = sum(p["columns"] for p in profiled)


def _commit_next_object(job: dict, source: dict) -> bool:
    """A forced commit updates the existing record **in place** rather than
    pushing a second one, so `profiled_tables` cannot double while
    `profiled_at` still moves."""
    nxt = next((o for o in job["objects"] if o["state"] == "pending"), None)
    if not nxt:
        return False
    at = now_iso()

    if job["kind"] == "gdrive":
        source.setdefault("profiled_docs", [])
        existing = next(
            (
                p
                for p in source["profiled_docs"]
                if p["folder_id"] == nxt["parent_id"] and p["document_id"] == nxt["object_id"]
            ),
            None,
        )
        if existing:
            existing["entities"] = nxt["units"]
            existing["profiled_at"] = at
        else:
            source["profiled_docs"].append(
                {
                    "folder_id": nxt["parent_id"],
                    "document_id": nxt["object_id"],
                    "entities": nxt["units"],
                    "profiled_at": at,
                }
            )
    else:
        source.setdefault("profiled", [])
        existing = next(
            (
                p
                for p in source["profiled"]
                if p["dataset_id"] == nxt["parent_id"] and p["table_id"] == nxt["object_id"]
            ),
            None,
        )
        if existing:
            existing["columns"] = nxt["units"]
            existing["profiled_at"] = at
        else:
            source["profiled"].append(
                {
                    "dataset_id": nxt["parent_id"],
                    "table_id": nxt["object_id"],
                    "columns": nxt["units"],
                    "profiled_at": at,
                }
            )

    nxt["state"] = "profiled"
    recount(source)
    return True


def advance_job(ctx: Ctx, job: dict) -> dict:
    """Bring a job up to date with the clock, committing whatever its stages
    have passed. Idempotent — calling it twice at the same instant commits
    nothing the first call did not."""
    if job["status"] in ("complete", "cancelled"):
        return job

    stages = pipeline_for(job)
    elapsed = _elapsed_ms(job["triggered_at"])
    if elapsed < QUEUE_MS:
        return job

    stage_index = min(len(stages), int((elapsed - QUEUE_MS) // STAGE_MS) + 1)
    if stage_index < 1:
        return job

    source = ctx.source(job["source_id"])
    if source is None:
        return job

    if not job.get("started_at"):
        job["started_at"] = job["triggered_at"]

    job["status"] = "running"
    job["stage_index"] = stage_index
    job["stage_label"] = stages[stage_index - 1]
    job["progress"] = _js_round(stage_index / len(stages) * 100)

    target = (len(job["objects"]) * stage_index) // len(stages)
    changed = False
    while sum(1 for o in job["objects"] if o["state"] == "profiled") < target:
        if not _commit_next_object(job, source):
            break
        changed = True

    if stage_index >= len(stages):
        while any(o["state"] == "pending" for o in job["objects"]):
            if not _commit_next_object(job, source):
                break
            changed = True
        job["status"] = "complete"
        job["progress"] = 100
        job["finished_at"] = job.get("finished_at") or now_iso()

    if changed:
        ctx.save_source(source)
    ctx.save_job(job)
    return job


def queue_job(
    ctx: Ctx, source_id: str, kind: str, unit: str, objects: list[dict], force: bool
) -> dict:
    """An all-skipped job completes instantly rather than faking a run."""
    job_id = str(uuid.uuid4())
    triggered_at = now_iso()
    job = {
        "job_id": job_id,
        "short_id": job_id[:8],
        "source_id": source_id,
        "kind": kind,
        "unit": unit,
        "status": "queued",
        "stage_index": 0,
        "stage_label": "queued",
        "progress": 0,
        "objects": objects,
        "force": bool(force),
        "triggered_at": triggered_at,
        "started_at": None,
        "finished_at": None,
        "triggered_by": f"{ctx.account_email} (Tenant Admin)",
        "error": None,
    }

    if objects and all(o["state"] == "skipped" for o in objects):
        job["status"] = "complete"
        job["stage_index"] = len(pipeline_for(job))
        job["stage_label"] = "nothing to profile"
        job["progress"] = 100
        job["started_at"] = triggered_at
        job["finished_at"] = triggered_at

    ctx.save_job(job)
    return job


def all_jobs(ctx: Ctx) -> list[dict]:
    """Every read advances every live job — a poll is what moves the board, so
    there is no worker to fall behind."""
    return [advance_job(ctx, job) for job in ctx.jobs()]
