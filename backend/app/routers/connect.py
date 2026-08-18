"""
The connect-a-source flow: the catalogue a wizard picks from, the Google consent,
the preview, and the registration.

**Two connectors, one shape.** BigQuery and Drive are both real, and Drive is
deliberately a mirror rather than a parallel universe: project→dataset→table
becomes drive→folder→document, and every endpoint has a twin.

**Each endpoint refuses the other connector's source with a 400 that names its
twin.** Answering a Drive source's `/browse` with an empty dataset list would read
as "nothing to profile" and send you debugging the allowlist instead of the call.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends, Query

from ..core import display_name_from_email, is_email, now_iso, source_name_problem
from ..deps import (
    CONNECT_STEP_MS,
    CONSENT_MS,
    CONSENT_START_MS,
    DISCOVERY_MS,
    get_ctx,
    pace,
    refuse,
)
from ..models import OAuthSession, OAuthState
from ..runtime import Ctx

router = APIRouter()


# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------
@router.get("/projects")
def projects(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    return {
        "projects": [
            {
                "project_id": p["project_id"],
                "display_name": p["display_name"],
                "location": p["location"],
                "dataset_count": len(p["datasets"]),
            }
            for p in ctx.doc["projects"]
        ]
    }


@router.get("/projects/{project_id}/datasets")
def project_datasets(project_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    project = ctx.find_project(project_id)
    if not project:
        raise refuse(f"unknown project {project_id}", status=404)
    return {"project_id": project["project_id"], "datasets": project["datasets"]}


@router.get("/drives")
def drives(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    return {
        "drives": [
            {
                "drive_id": d["drive_id"],
                "display_name": d["display_name"],
                "kind": d["kind"],
                "folder_count": len(d["folders"]),
            }
            for d in ctx.doc["drives"]
        ]
    }


@router.get("/drives/{drive_id}/folders")
def drive_folders(drive_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """**A drive is a tree, and the nesting is a `parent_id` on a flat list.** One
    array per drive, so every existing walk is unchanged; a root carries
    `parent_id: null`, and the key is on every folder so "no parent" is never
    confused with "seeded before nesting existed"."""
    drive = ctx.find_drive(drive_id)
    if not drive:
        raise refuse(f"unknown drive {drive_id}", status=404)
    return {
        "drive_id": drive["drive_id"],
        "folders": [
            {
                "folder_id": f["folder_id"],
                "parent_id": f.get("parent_id"),
                "name": f["name"],
                "path": f["path"],
                "document_count": len(f["documents"]),
            }
            for f in drive["folders"]
        ],
    }


# ---------------------------------------------------------------------------
# Consent — scoped to the connector
# ---------------------------------------------------------------------------
BIGQUERY_SCOPES = ["https://www.googleapis.com/auth/bigquery.readonly"]
DRIVE_SCOPES = [
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]


@router.get("/sources/oauth/start")
async def oauth_start(
    provider: str = Query(default="bigquery"), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    """The consent screen renders the list **this endpoint returned** rather than
    a copy held in the client, so it cannot describe fewer permissions than are
    being asked for. Drive asks for two; BigQuery for one."""
    resolved = "drive" if provider == "drive" else "bigquery"
    scopes = DRIVE_SCOPES if resolved == "drive" else BIGQUERY_SCOPES
    state = f"state-{uuid.uuid4().hex[:12]}"

    ctx.db.add(OAuthState(state=state, provider=resolved, data={}))
    ctx.db.commit()

    await pace(CONSENT_START_MS)
    return {
        "state": state,
        "provider": resolved,
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth"
        f"?state={state}&scope={' '.join(scopes)}",
        "scopes": scopes,
    }


@router.get("/sources/oauth/callback")
async def oauth_callback(
    state: str | None = Query(default=None),
    provider: str = Query(default="bigquery"),
    as_: str | None = Query(default=None, alias="as"),
    ctx: Ctx = Depends(get_ctx),
) -> dict[str, Any]:
    """A state is remembered *with* its provider, and replaying it against the
    other one is refused.

    **The account it names is whoever is signed in**, passed as `as=` because the
    identity is client-held and the server has nothing to look it up from. A
    malformed `as` is a 400 rather than a quiet fall back to the seeded account.
    """
    row = ctx.db.get(OAuthState, state) if state else None
    if not row:
        raise refuse("invalid or expired state")

    resolved = "drive" if provider == "drive" else "bigquery"
    if row.provider != resolved:
        raise refuse(
            f"this consent was granted for {row.provider}, not {resolved} — start the "
            f"{resolved} sign-in again"
        )

    ctx.db.delete(row)
    ctx.db.commit()

    if as_ is not None and not is_email(as_):
        raise refuse(
            f'"{as_}" is not a valid email address — sign in again and retry the connection.'
        )

    if as_:
        # The display name is derived from the address: the login form collects
        # no name, so one is never invented.
        account = {"email": as_, "name": display_name_from_email(as_), "picture": None}
    else:
        account = ctx.google_account

    session_id = f"session-{uuid.uuid4().hex[:12]}"
    ctx.db.add(
        OAuthSession(
            session_id=session_id,
            provider=resolved,
            account=account["email"],
            data={"account": account},
        )
    )
    ctx.db.commit()

    await pace(CONSENT_MS)
    return {"account": account, "session": session_id, "provider": resolved}


@router.get("/sources/oauth/projects")
async def oauth_projects(
    session: str | None = Query(default=None), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    row = ctx.db.get(OAuthSession, session) if session else None
    if not row:
        raise refuse("invalid or expired session — start the Google sign-in again")
    if row.provider != "bigquery":
        raise refuse(
            "this session was granted for Drive — read its drives with /sources/oauth/drives"
        )

    projects = []
    for p in ctx.doc["projects"]:
        cred = next(
            (c for c in ctx.doc["credentials"] if c["project_id"] == p["project_id"]), None
        )
        projects.append(
            {
                "project_id": p["project_id"],
                "display_name": p["display_name"],
                "location": p["location"],
                "dataset_count": len(p["datasets"]),
                "credential_handle": (cred or {}).get("credential_handle"),
            }
        )

    await pace(DISCOVERY_MS)
    return {"projects": projects, "project_count": len(projects)}


@router.get("/sources/oauth/drives")
async def oauth_drives(
    session: str | None = Query(default=None), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    row = ctx.db.get(OAuthSession, session) if session else None
    if not row:
        raise refuse("invalid or expired session — start the Google sign-in again")
    if row.provider != "drive":
        raise refuse(
            "this session was granted for BigQuery — read its projects with "
            "/sources/oauth/projects"
        )

    drives = []
    for d in ctx.doc["drives"]:
        cred = next(
            (c for c in ctx.doc["drive_credentials"] if c["drive_id"] == d["drive_id"]), None
        )
        drives.append(
            {
                "drive_id": d["drive_id"],
                "display_name": d["display_name"],
                "kind": d["kind"],
                "folder_count": len(d["folders"]),
                "document_count": sum(len(f["documents"]) for f in d["folders"]),
                "credential_handle": (cred or {}).get("credential_handle"),
            }
        )

    await pace(DISCOVERY_MS)
    return {"drives": drives, "drive_count": len(drives)}


# ---------------------------------------------------------------------------
# Preview and register — the two paced acts of step 3
# ---------------------------------------------------------------------------
@router.post("/sources/preview")
async def preview(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    project_id = body.get("project_id")
    handle = body.get("credential_handle")
    if not project_id or not handle:
        raise refuse("project_id and credential_handle are both required")

    cred = ctx.find_credential(handle)
    if not cred:
        raise refuse("unknown credential_handle", status=401)
    if cred["project_id"] != project_id:
        raise refuse(f"credential_handle is not authorised for {project_id}", status=403)

    project = ctx.find_project(project_id)
    if not project:
        raise refuse(f"unknown project {project_id}", status=404)

    payload = {
        "project_id": project_id,
        "dataset_count": len(project["datasets"]),
        "datasets": [
            {
                "dataset_id": d["dataset_id"],
                "location": d.get("location"),
                "description": d.get("description"),
                "table_count": len(d["tables"]),
                "column_count": sum(t.get("columns") or 0 for t in d["tables"]),
            }
            for d in project["datasets"]
        ],
        "registered": False,
    }
    # Only the success reply waits; every refusal above is immediate.
    await pace(CONNECT_STEP_MS)
    return payload


@router.post("/sources/drive/preview")
async def drive_preview(
    body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    drive_id = body.get("drive_id")
    handle = body.get("credential_handle")
    if not drive_id or not handle:
        raise refuse("drive_id and credential_handle are both required")

    cred = ctx.find_drive_credential(handle)
    if not cred:
        raise refuse("unknown credential_handle", status=401)
    if cred["drive_id"] != drive_id:
        raise refuse(f"credential_handle is not authorised for {drive_id}", status=403)

    drive = ctx.find_drive(drive_id)
    if not drive:
        raise refuse(f"unknown drive {drive_id}", status=404)

    payload = {
        "drive_id": drive_id,
        "display_name": drive["display_name"],
        "kind": drive["kind"],
        "folder_count": len(drive["folders"]),
        "document_count": sum(len(f["documents"]) for f in drive["folders"]),
        "folders": [
            {
                "folder_id": f["folder_id"],
                "parent_id": f.get("parent_id"),
                "name": f["name"],
                "path": f["path"],
                "description": f.get("description"),
                "document_count": len(f["documents"]),
                "page_count": sum(d["pages"] for d in f["documents"]),
                "file_types": list(dict.fromkeys(d["mime_type"] for d in f["documents"])),
            }
            for f in drive["folders"]
        ],
        "registered": False,
    }
    await pace(CONNECT_STEP_MS)
    return payload


@router.post("/sources", status_code=201)
async def register_bigquery(
    body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> Any:
    """Profiled counts are deliberately 0 on registration: registration is
    instant, counts only land once the profiler has run."""
    from fastapi.responses import JSONResponse

    project_id = body.get("project_id")
    handle = body.get("credential_handle")
    datasets = body.get("datasets")
    if not project_id or not handle:
        raise refuse("project_id and credential_handle are both required")

    problem = source_name_problem(body.get("source_name"))
    if problem:
        raise refuse(problem)
    if not isinstance(datasets, list) or not datasets:
        raise refuse("datasets must be a non-empty array for Finish")

    if not ctx.find_credential(handle):
        raise refuse("unknown credential_handle", status=401)
    project = ctx.find_project(project_id)
    if not project:
        raise refuse(f"unknown project {project_id}", status=404)

    known = {d["dataset_id"] for d in project["datasets"]}
    unknown = [d for d in datasets if d not in known]
    if unknown:
        raise refuse(f"dataset(s) not present in {project_id}: {', '.join(unknown)}")

    source_id = f"bigquery:{project_id}"
    already = ctx.source(source_id) is not None
    record = {
        "kind": "bigquery",
        "source_id": source_id,
        "source_name": str(body["source_name"]).strip(),
        "connector": "bigquery",
        "project_id": project_id,
        "credential_handle": handle,
        "datasets": datasets,
        "status": "connected",
        "registered_at": now_iso(),
        "newly_connected": not already,
    }
    ctx.save_source(record)

    table_count = 0
    for dataset_id in datasets:
        dataset = next((x for x in project["datasets"] if x["dataset_id"] == dataset_id), None)
        table_count += len((dataset or {}).get("tables") or [])

    await pace(CONNECT_STEP_MS)
    return JSONResponse(
        status_code=200 if already else 201,
        content={
            **record,
            "project": project_id,
            "dataset_count": len(datasets),
            "table_count": table_count,
        },
    )


@router.post("/sources/drive", status_code=201)
async def register_drive(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> Any:
    from fastapi.responses import JSONResponse

    drive_id = body.get("drive_id")
    handle = body.get("credential_handle")
    folders = body.get("folders")
    if not drive_id or not handle:
        raise refuse("drive_id and credential_handle are both required")

    problem = source_name_problem(body.get("source_name"))
    if problem:
        raise refuse(problem)
    if not isinstance(folders, list) or not folders:
        raise refuse("folders must be a non-empty array for Finish")

    if not ctx.find_drive_credential(handle):
        raise refuse("unknown credential_handle", status=401)
    drive = ctx.find_drive(drive_id)
    if not drive:
        raise refuse(f"unknown drive {drive_id}", status=404)

    known = {f["folder_id"] for f in drive["folders"]}
    unknown = [f for f in folders if f not in known]
    if unknown:
        raise refuse(f"folder(s) not present in {drive_id}: {', '.join(unknown)}")

    source_id = f"gdrive:{drive_id}"
    already = ctx.source(source_id) is not None
    record = {
        "kind": "gdrive",
        "source_id": source_id,
        "source_name": str(body["source_name"]).strip(),
        "connector": "gdrive",
        "drive_id": drive_id,
        "credential_handle": handle,
        "folders": folders,
        "status": "connected",
        "registered_at": now_iso(),
        "newly_connected": not already,
    }
    ctx.save_source(record)

    document_count = sum(
        len((ctx.find_folder(drive, fid) or {}).get("documents") or []) for fid in folders
    )

    await pace(CONNECT_STEP_MS)
    return JSONResponse(
        status_code=200 if already else 201,
        content={
            **record,
            "drive": drive_id,
            "display_name": drive["display_name"],
            "folder_count": len(folders),
            "document_count": document_count,
        },
    )


@router.post("/sources/generic", status_code=201)
def register_generic(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> Any:
    """The five stubbed connectors fall through here: a bare row, and the dialog
    closes. Only the two real connectors get a wizard branch.

    The name is checked here too — the label is what the Sources table keys off,
    so a one-character name is no more readable on a stub than on a real source.
    """
    from fastapi.responses import JSONResponse

    from ..core import slugify

    connector = body.get("connector")
    if not connector:
        raise refuse("connector is required")

    problem = source_name_problem(body.get("source_name"))
    if problem:
        raise refuse(problem)

    source_id = f"{connector}:{slugify(body['source_name'])}"
    already = ctx.source(source_id) is not None
    record = {
        "kind": "generic",
        "source_id": source_id,
        "source_name": str(body["source_name"]).strip(),
        "connector": connector,
        "type_label": body.get("type_label") or connector,
        "credential_handle": body.get("credential_ref"),
        "datasets": [],
        "status": "syncing",
        "registered_at": now_iso(),
        "newly_connected": not already,
    }
    ctx.save_source(record)
    return JSONResponse(status_code=200 if already else 201, content=record)
