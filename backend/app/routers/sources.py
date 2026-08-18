"""
Registered sources: the rows, the allowlist, browsing, profiling and the two
dictionaries.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse

from ..core import now_iso
from ..deps import get_ctx, refuse
from ..runtime import Ctx
from ..services.catalogue import (
    DOC_PIPELINE,
    PIPELINE,
    all_jobs,
    browsable_documents,
    browsable_objects,
    document_dictionary,
    job_view,
    queue_job,
    source_row,
    table_dictionary,
)

router = APIRouter()


def _source_or_404(ctx: Ctx, source_id: str) -> dict[str, Any]:
    source = ctx.source(source_id)
    if not source:
        raise refuse(f"no registered source {source_id}", status=404)
    return source


# ---------------------------------------------------------------------------
# The rows
# ---------------------------------------------------------------------------
@router.get("/sources")
def list_sources(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    rows = [source_row(s) for s in ctx.sources()]
    return {
        "sources": rows,
        "registered_count": len(rows),
        "connected_sources": len(ctx.connected_sources()),
        "profiled_tables": sum(r["profiled_tables"] for r in rows),
        "profiled_columns": sum(r["profiled_columns"] for r in rows),
        "profiled_documents": sum(r["profiled_documents"] or 0 for r in rows),
        "profiled_entities": sum(r["profiled_entities"] or 0 for r in rows),
    }


@router.post("/sources/{source_id}/disconnect")
def disconnect(source_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """A disconnected source counts as not connected but stays listed, so it can
    still be reconnected or deleted."""
    source = _source_or_404(ctx, source_id)
    source["status"] = "disconnected"
    source["credential_handle"] = None
    ctx.save_source(source)
    return source_row(source)


@router.post("/sources/{source_id}/reconnect")
def reconnect(source_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """Re-issues the handle **in place**, so every profiled object survives —
    which is why a disconnected row offers Reconnect rather than Connect."""
    source = _source_or_404(ctx, source_id)
    if source["status"] != "disconnected":
        raise refuse(
            f"{source_id} is already {source['status']} — there is nothing to reconnect"
        )

    if source["kind"] == "bigquery":
        cred = next(
            (c for c in ctx.doc["credentials"] if c["project_id"] == source["project_id"]), None
        )
        if not cred:
            raise refuse(
                f"no credential is on file for {source['project_id']} — connect it again from "
                "Connect source, which will re-run the Google consent"
            )
        source["credential_handle"] = cred["credential_handle"]
    elif source["kind"] == "gdrive":
        cred = next(
            (c for c in ctx.doc["drive_credentials"] if c["drive_id"] == source["drive_id"]),
            None,
        )
        if not cred:
            raise refuse(
                f"no credential is on file for {source['drive_id']} — connect it again from "
                "Connect source, which will re-run the Google consent"
            )
        source["credential_handle"] = cred["credential_handle"]

    # A generic source never had a real handle and disconnect cleared it. Nothing
    # here can re-issue one, and inventing a handle would be worse than the null.
    source["status"] = "syncing" if source["kind"] == "generic" else "connected"
    ctx.save_source(source)
    return source_row(source)


@router.put("/sources/{source_id}/datasets")
def set_datasets(
    source_id: str, body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    source = _source_or_404(ctx, source_id)
    if source["status"] == "disconnected":
        raise refuse(
            f"{source_id} is disconnected — reconnect it before changing its allowlist"
        )

    datasets = body.get("datasets")
    if not isinstance(datasets, list) or not datasets:
        raise refuse("datasets must be a non-empty array")

    project = ctx.find_project(source.get("project_id"))
    known = {d["dataset_id"] for d in (project or {}).get("datasets", [])}
    unknown = [d for d in datasets if d not in known]
    if unknown:
        raise refuse(
            f"dataset(s) not present in {source.get('project_id')}: {', '.join(unknown)}"
        )

    source["datasets"] = datasets
    ctx.save_source(source)
    return source_row(source)


@router.put("/sources/{source_id}/folders")
def set_folders(
    source_id: str, body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    source = _source_or_404(ctx, source_id)
    if source["kind"] != "gdrive":
        raise refuse(
            f"{source_id} is not a Drive source — use PUT /sources/{source_id}/datasets"
        )
    # Checked on both paths: guarding one is how the two come to disagree about
    # what a disconnected source may do.
    if source["status"] == "disconnected":
        raise refuse(
            f"{source_id} is disconnected — reconnect it before changing its allowlist"
        )

    folders = body.get("folders")
    if not isinstance(folders, list) or not folders:
        raise refuse("folders must be a non-empty array")

    drive = ctx.find_drive(source.get("drive_id"))
    known = {f["folder_id"] for f in (drive or {}).get("folders", [])}
    unknown = [f for f in folders if f not in known]
    if unknown:
        raise refuse(f"folder(s) not present in {source.get('drive_id')}: {', '.join(unknown)}")

    source["folders"] = folders
    ctx.save_source(source)
    return source_row(source)


# ---------------------------------------------------------------------------
# Browsing — each path refuses the other connector's source
# ---------------------------------------------------------------------------
@router.get("/sources/{source_id}/browse")
def browse(source_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    source = _source_or_404(ctx, source_id)
    if source["kind"] == "gdrive":
        raise refuse(
            f"{source_id} holds documents, not tables — use GET "
            f"/sources/{source_id}/browse-documents"
        )
    return {"source_id": source_id, **browsable_objects(ctx, source)}


@router.get("/sources/{source_id}/browse-documents")
def browse_documents(source_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    source = _source_or_404(ctx, source_id)
    if source["kind"] != "gdrive":
        raise refuse(f"{source_id} is not a Drive source — use GET /sources/{source_id}/browse")
    return {"source_id": source_id, **browsable_documents(ctx, source)}


# ---------------------------------------------------------------------------
# Profiling
# ---------------------------------------------------------------------------
@router.post("/sources/{source_id}/profile", status_code=202)
def profile_tables(
    source_id: str, body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> Any:
    source = _source_or_404(ctx, source_id)
    if source["kind"] == "gdrive":
        raise refuse(
            f"{source_id} holds documents, not tables — use POST "
            f"/sources/{source_id}/profile-documents"
        )

    objects = body.get("objects")
    force = body.get("force")
    if not isinstance(objects, list) or not objects:
        raise refuse("objects must be a non-empty array")

    project = ctx.find_project(source.get("project_id"))
    allowed = set(source.get("datasets") or [])
    profiled = source.get("profiled") or []

    work = []
    for o in objects:
        dataset_id = o.get("dataset_id")
        table_id = o.get("table_id")
        if dataset_id not in allowed:
            raise refuse(f"dataset {dataset_id} is not in this source's allowlist")
        dataset = next(
            (d for d in (project or {}).get("datasets", []) if d["dataset_id"] == dataset_id),
            None,
        )
        table = next(
            (t for t in (dataset or {}).get("tables", []) if t["table_id"] == table_id), None
        )
        if not table:
            raise refuse(f"table {dataset_id}.{table_id} does not exist")

        already = any(
            p["dataset_id"] == dataset_id and p["table_id"] == table_id for p in profiled
        )
        work.append(
            {
                "parent_id": dataset_id,
                "object_id": table_id,
                "label": table_id,
                "units": table["columns"],
                # Already-profiled objects are skipped unless forced; an
                # all-skipped job completes instantly rather than faking a run.
                "state": "skipped" if already and not force else "pending",
            }
        )

    job = queue_job(ctx, source_id, "bigquery", "table", work, bool(force))
    return JSONResponse(status_code=202, content={"job": job_view(job)})


@router.post("/sources/{source_id}/profile-documents", status_code=202)
def profile_documents(
    source_id: str, body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> Any:
    source = _source_or_404(ctx, source_id)
    if source["kind"] != "gdrive":
        raise refuse(f"{source_id} is not a Drive source — use POST /sources/{source_id}/profile")

    objects = body.get("objects")
    force = body.get("force")
    if not isinstance(objects, list) or not objects:
        raise refuse("objects must be a non-empty array")

    drive = ctx.find_drive(source.get("drive_id"))
    allowed = set(source.get("folders") or [])
    profiled = source.get("profiled_docs") or []

    work = []
    for o in objects:
        folder_id = o.get("folder_id")
        document_id = o.get("document_id")
        if folder_id not in allowed:
            raise refuse(f"folder {folder_id} is not in this source's allowlist")
        document = ctx.find_document(drive, folder_id, document_id)
        if not document:
            raise refuse(f"document {folder_id}/{document_id} does not exist")

        already = any(
            p["folder_id"] == folder_id and p["document_id"] == document_id for p in profiled
        )
        work.append(
            {
                "parent_id": folder_id,
                "object_id": document_id,
                "label": document["name"],
                "units": document["entities"],
                "state": "skipped" if already and not force else "pending",
            }
        )

    job = queue_job(ctx, source_id, "gdrive", "document", work, bool(force))
    return JSONResponse(status_code=202, content={"job": job_view(job)})


# ---------------------------------------------------------------------------
# The column dictionary
# ---------------------------------------------------------------------------
@router.get("/sources/{source_id}/columns")
def columns(source_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    source = _source_or_404(ctx, source_id)
    if source["kind"] == "gdrive":
        raise refuse(
            f"{source_id} has documents, not columns — use GET /sources/{source_id}/documents"
        )

    project = ctx.find_project(source.get("project_id"))
    by_dataset: dict[str, dict[str, Any]] = {}
    facets = {
        "all": 0,
        "needs_review": 0,
        "pii": 0,
        "ids": 0,
        "measures": 0,
        "dates": 0,
        "location": 0,
        "flags": 0,
    }

    for entry in source.get("profiled") or []:
        dataset = next(
            (
                d
                for d in (project or {}).get("datasets", [])
                if d["dataset_id"] == entry["dataset_id"]
            ),
            None,
        )
        meta = next(
            (t for t in (dataset or {}).get("tables", []) if t["table_id"] == entry["table_id"]),
            None,
        )
        rows = (meta or {}).get("rows") or 0
        cols = table_dictionary(
            ctx, source, entry["dataset_id"], entry["table_id"], entry["columns"], rows
        )

        for c in cols:
            facets["all"] += 1
            if c["description_status"] == "needs review":
                facets["needs_review"] += 1
            if c["pii"]:
                facets["pii"] += 1
            if c["class"] == "identifier":
                facets["ids"] += 1
            if c["class"] == "measure":
                facets["measures"] += 1
            if c["class"] == "date":
                facets["dates"] += 1
            if c["class"] in ("address", "geo"):
                facets["location"] += 1
            if c["class"] == "flag":
                facets["flags"] += 1

        bucket = by_dataset.setdefault(
            entry["dataset_id"], {"dataset_id": entry["dataset_id"], "tables": []}
        )
        bucket["tables"].append(
            {
                "table_id": entry["table_id"],
                "label": (meta or {}).get("label") or entry["table_id"],
                "type": (meta or {}).get("type") or "TABLE",
                "grain": (meta or {}).get("grain") or "",
                "rows": rows,
                "column_count": len(cols),
                "columns": cols,
            }
        )

    datasets = [
        {
            **d,
            "table_count": len(d["tables"]),
            "column_count": sum(t["column_count"] for t in d["tables"]),
        }
        for d in by_dataset.values()
    ]

    return {
        "source_id": source_id,
        "profiled_tables": len(source.get("profiled") or []),
        "dataset_count": len(datasets),
        "facets": facets,
        "datasets": datasets,
    }


@router.patch("/sources/{source_id}/columns")
def patch_column(
    source_id: str, body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    source = _source_or_404(ctx, source_id)
    dataset_id = body.get("dataset_id")
    table_id = body.get("table_id")
    column_id = body.get("column_id")
    description = body.get("description")
    if not dataset_id or not table_id or not column_id:
        raise refuse("dataset_id, table_id and column_id are all required")

    notes = dict(source.get("column_notes") or {})
    key = f"{dataset_id}.{table_id}.{column_id}"
    if description:
        notes[key] = description
    else:
        notes.pop(key, None)
    source["column_notes"] = notes
    ctx.save_source(source)
    return {"key": key, "description": description}


# ---------------------------------------------------------------------------
# The document dictionary
# ---------------------------------------------------------------------------
# The map exists twice — here and in the panel — so a facet stuck at 0 reads as
# "none in this corpus" rather than as a broken map.
FACET_FOR_TYPE = {
    "consent_decree": "consent_decrees",
    "complaint": "complaints",
    "settlement": "settlements",
    "cafo": "cafos",
}


@router.get("/sources/{source_id}/documents")
def documents(source_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    source = _source_or_404(ctx, source_id)
    if source["kind"] != "gdrive":
        raise refuse(f"{source_id} is not a Drive source — use GET /sources/{source_id}/columns")

    drive = ctx.find_drive(source.get("drive_id"))
    by_folder: dict[str, dict[str, Any]] = {}
    facets = {
        "all": 0,
        "needs_review": 0,
        "pii": 0,
        "consent_decrees": 0,
        "complaints": 0,
        "settlements": 0,
        "cafos": 0,
    }

    for entry in source.get("profiled_docs") or []:
        meta = ctx.find_document(drive, entry["folder_id"], entry["document_id"])
        if not meta:
            continue
        document = document_dictionary(ctx, source, entry["folder_id"], meta)

        facets["all"] += 1
        if document["summary_status"] == "needs review":
            facets["needs_review"] += 1
        # `pii` means "holds at least one PII entity" — the facets count
        # *documents*, not fields.
        if document["pii_count"] > 0:
            facets["pii"] += 1
        bucket = FACET_FOR_TYPE.get(document["doc_type"])
        if bucket:
            facets[bucket] += 1

        if entry["folder_id"] not in by_folder:
            folder = ctx.find_folder(drive, entry["folder_id"])
            by_folder[entry["folder_id"]] = {
                "folder_id": entry["folder_id"],
                "name": (folder or {}).get("name") or entry["folder_id"],
                "path": (folder or {}).get("path") or "",
                "documents": [],
            }
        by_folder[entry["folder_id"]]["documents"].append(document)

    folders = [
        {
            **f,
            "document_count": len(f["documents"]),
            "entity_count": sum(d["entity_count"] for d in f["documents"]),
        }
        for f in by_folder.values()
    ]

    return {
        "source_id": source_id,
        "profiled_documents": len(source.get("profiled_docs") or []),
        "folder_count": len(folders),
        "entity_count": sum(f["entity_count"] for f in folders),
        "facets": facets,
        "folders": folders,
    }


@router.patch("/sources/{source_id}/documents")
def patch_document(
    source_id: str, body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    """The editable note is the document's `summary` — extracted entities are
    machine output and read-only."""
    source = _source_or_404(ctx, source_id)
    folder_id = body.get("folder_id")
    document_id = body.get("document_id")
    summary = body.get("summary")
    if not folder_id or not document_id:
        raise refuse("folder_id and document_id are both required")

    notes = dict(source.get("document_notes") or {})
    key = f"{folder_id}.{document_id}"
    if summary:
        notes[key] = summary
    else:
        notes.pop(key, None)
    source["document_notes"] = notes
    ctx.save_source(source)
    return {"key": key, "summary": summary}


# ---------------------------------------------------------------------------
# The jobs board
# ---------------------------------------------------------------------------
@router.get("/profiling-jobs")
def profiling_jobs(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """The board polls this while anything is active, and reading it is what moves
    a job on — so there is no worker to fall behind."""
    views = [job_view(j) for j in all_jobs(ctx)]
    active = [j for j in views if j["status"] in ("queued", "running")]
    recent = [j for j in views if j["status"] not in ("queued", "running")]
    running = next((j for j in active if j["status"] == "running"), None)

    if not active:
        status_line = "idle — nothing running"
    elif running:
        status_line = (
            f"running — {len(active)} job(s) · stage {running['stage_index']} of "
            f"{running['stage_total']}: {running['stage_label']}"
        )
    else:
        status_line = f"queued — {len(active)} job(s) waiting to start"

    return {
        "active": active,
        "recent": recent,
        "active_count": len(active),
        "recent_count": len(recent),
        "status_line": status_line,
        "pipelines": {"bigquery": PIPELINE, "gdrive": DOC_PIPELINE},
    }


@router.post("/profiling-jobs/{job_id}/cancel")
def cancel_job(job_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    job = ctx.job(job_id)
    if not job:
        raise refuse(f"no job {job_id}", status=404)
    if job["status"] in ("complete", "cancelled"):
        raise refuse(f"job is already {job['status']}", status=409)

    job["status"] = "cancelled"
    job["finished_at"] = now_iso()
    job["started_at"] = job.get("started_at") or job["triggered_at"]
    job["error"] = f"cancelled at stage {job['stage_index']} of {len(PIPELINE)}"
    ctx.save_job(job)
    return job_view(job)


# Declared last: `/sources/{source_id}` would otherwise match the parent segment
# of every route above it and win.
@router.delete("/sources/{source_id}")
def delete_source(source_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """Takes the profiled tables, columns, documents and every note typed against
    them. `POST /sources` is not the inverse — that starts from nothing profiled."""
    if not ctx.source(source_id):
        raise refuse(f"no registered source {source_id}", status=404)
    ctx.delete_source(source_id)
    return {"deleted": source_id}
