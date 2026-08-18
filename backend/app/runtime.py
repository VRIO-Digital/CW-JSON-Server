"""
One request's view of the world.

The Node server closed every route over a module-level `db` object. Here the
document is read from Postgres per request and carried in a `Ctx`, which is
what lets the ported logic read `ctx.doc["projects"]` where the original read
`db.projects` — a translation rather than a rewrite.

`Ctx` also owns the source rows, which were a `Map` in memory before and are a
table now. Same accessors, different home.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import store
from .models import ProfilingJob, Source


class Ctx:
    def __init__(self, db: Session):
        self.db = db
        self.doc: dict[str, Any] = store.load(db)
        self.settings: dict[str, Any] = store.load_settings(db)

    # -- the tenant's document ------------------------------------------------
    def commit(self, document: dict[str, Any] | None = None) -> None:
        store.commit(self.db, document if document is not None else self.doc)
        self.doc = store.load(self.db)

    def commit_settings(self, settings: dict[str, Any]) -> None:
        store.commit_settings(self.db, self.doc, settings)
        self.settings = store.load_settings(self.db)

    @property
    def google_account(self) -> dict[str, Any]:
        return self.doc.get("google_account") or {}

    @property
    def account_email(self) -> str:
        return str(self.google_account.get("email") or "")

    # -- catalogue lookups ----------------------------------------------------
    def find_project(self, project_id: str) -> dict | None:
        return next((p for p in self.doc["projects"] if p["project_id"] == project_id), None)

    def find_credential(self, handle: str) -> dict | None:
        return next(
            (c for c in self.doc["credentials"] if c["credential_handle"] == handle), None
        )

    def find_drive(self, drive_id: str) -> dict | None:
        return next((d for d in self.doc["drives"] if d["drive_id"] == drive_id), None)

    def find_drive_credential(self, handle: str) -> dict | None:
        return next(
            (c for c in self.doc["drive_credentials"] if c["credential_handle"] == handle), None
        )

    def find_folder(self, drive: dict | None, folder_id: str) -> dict | None:
        return next(
            (f for f in (drive or {}).get("folders", []) if f["folder_id"] == folder_id), None
        )

    def find_document(self, drive: dict | None, folder_id: str, document_id: str) -> dict | None:
        folder = self.find_folder(drive, folder_id)
        return next(
            (d for d in (folder or {}).get("documents", []) if d["document_id"] == document_id),
            None,
        )

    def find_role(self, role_id: str) -> dict | None:
        return next((r for r in self.doc["auth_roles"] if r["role_id"] == role_id), None)

    # -- registered sources ---------------------------------------------------
    #
    # Every accessor here hands back a **copy**, and that is load-bearing rather
    # than defensive. A JSON column is a plain dict once loaded, so mutating it in
    # place and then assigning it back is a no-op for SQLAlchemy's change
    # detection: old and new compare equal, no UPDATE is emitted, and the write
    # is silently lost. It cost a build its content hash exactly once — the row
    # said `complete` (a String column, which did change) while the hash inside
    # its JSON stayed null, so the version list came back empty with nothing
    # erroring. Copy on read, assign on write.
    def sources(self) -> list[dict[str, Any]]:
        rows = self.db.scalars(select(Source).order_by(Source.registered_at)).all()
        return [deepcopy(r.data) for r in rows]

    def source(self, source_id: str) -> dict[str, Any] | None:
        row = self.db.get(Source, source_id)
        return deepcopy(row.data) if row else None

    def connected_sources(self) -> list[dict[str, Any]]:
        return [s for s in self.sources() if s.get("status") == "connected"]

    def save_source(self, source: dict[str, Any]) -> None:
        """A source's whole state is one row. Written back after any mutation —
        the JSONB column is replaced rather than edited in place, because
        SQLAlchemy cannot see a mutation inside a dict it already holds."""
        row = self.db.get(Source, source["source_id"])
        if row is None:
            row = Source(
                source_id=source["source_id"],
                source_name=source["source_name"],
                kind=source["kind"],
                connector=source["connector"],
                status=source.get("status", "connected"),
                registered_at=source["registered_at"],
                data=source,
            )
            self.db.add(row)
        else:
            row.source_name = source["source_name"]
            row.status = source.get("status", "connected")
            row.data = dict(source)
        self.db.commit()

    def delete_source(self, source_id: str) -> None:
        row = self.db.get(Source, source_id)
        if row:
            self.db.delete(row)
            self.db.commit()

    # -- profiling jobs -------------------------------------------------------
    def jobs(self) -> list[dict[str, Any]]:
        """Newest first — the board reads as a stack, and the Node server
        `unshift`ed onto its array."""
        rows = self.db.scalars(
            select(ProfilingJob).order_by(ProfilingJob.triggered_at.desc())
        ).all()
        return [deepcopy(r.data) for r in rows]

    def job(self, job_id: str) -> dict[str, Any] | None:
        row = self.db.get(ProfilingJob, job_id)
        return deepcopy(row.data) if row else None

    def save_job(self, job: dict[str, Any]) -> None:
        row = self.db.get(ProfilingJob, job["job_id"])
        if row is None:
            self.db.add(
                ProfilingJob(
                    job_id=job["job_id"],
                    source_id=job["source_id"],
                    status=job["status"],
                    triggered_at=job["triggered_at"],
                    data=job,
                )
            )
        else:
            row.status = job["status"]
            row.data = dict(job)
        self.db.commit()
