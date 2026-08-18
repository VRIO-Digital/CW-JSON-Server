"""
The document editor, health, identity and settings.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Depends

from .. import store
from ..deps import get_ctx, refuse
from ..runtime import Ctx
from ..services.admin import (
    LoginRefused,
    login,
    nav_permissions_for,
    nav_read_only,
    settings_view,
)
from ..validate import DB_SHAPE, validate_db

router = APIRouter()


@router.get("/health")
def health(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    return {
        "ok": True,
        "projects": len(ctx.doc["projects"]),
        "registered_sources": len(ctx.sources()),
        "database": "postgresql",
    }


@router.get("/db")
def read_db(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    return {
        "path": "postgresql://localhost:5432/postgres",
        "bytes": len(json.dumps(ctx.doc, indent=2).encode("utf-8")),
        "sections": store.sections(ctx.db),
        "required": list(DB_SHAPE.keys()),
        "db": ctx.doc,
    }


@router.put("/db")
def write_db(body: Any = Body(...), ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    nxt = body["db"] if isinstance(body, dict) and "db" in body else body
    problems = validate_db(nxt)
    if problems:
        raise refuse("; ".join(problems))
    try:
        ctx.commit(nxt)
    except store.Refused as error:
        raise refuse(str(error)) from error
    return {"saved": True, "sections": store.sections(ctx.db)}


@router.put("/db/{section}")
def write_section(
    section: str, body: Any = Body(...), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    if not isinstance(body, dict) or "value" not in body:
        raise refuse('body must be { "value": ... }')
    nxt = {**ctx.doc, section: body["value"]}
    problems = validate_db(nxt)
    if problems:
        raise refuse("; ".join(problems))
    try:
        ctx.commit(nxt)
    except store.Refused as error:
        raise refuse(str(error)) from error
    return {"saved": True, "section": section, "sections": store.sections(ctx.db)}


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------
@router.get("/auth/roles")
def auth_roles(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """The roles come from the database, not a hardcoded union — adding a fifth
    is a data edit."""
    roles = [
        {
            "role_id": r["role_id"],
            "label": r["label"],
            "access_note": r.get("access_note") or "",
        }
        for r in ctx.doc["auth_roles"]
    ]
    return {"roles": roles, "count": len(roles)}


@router.post("/auth/login")
def auth_login(body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    try:
        return login(ctx, body.get("email"), body.get("password"))
    except LoginRefused as error:
        raise refuse(str(error)) from error


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
@router.get("/settings")
def read_settings(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    return settings_view(ctx)


@router.patch("/settings/personas/{role_id}/nav")
def patch_nav(
    role_id: str, body: dict = Body(default={}), ctx: Ctx = Depends(get_ctx)
) -> dict[str, Any]:
    """The lock is enforced **here**, not merely by a disabled switch: a disabled
    control is a courtesy to whoever is looking at it, and any other path into
    the store could otherwise strand the one persona that can grant everything.

    A change to a fixed key is refused with a sentence rather than ignored,
    because silently keeping a value the caller asked to change is how a UI comes
    to disagree with the server.
    """
    role = ctx.find_role(role_id)
    if not role:
        known = ", ".join(r["role_id"] for r in ctx.doc["auth_roles"])
        raise refuse(f'no persona "{role_id}" — this tenant has {known}', status=404)

    nav = body.get("nav")
    if not isinstance(nav, dict):
        raise refuse("send nav as an object of { navigationKey: true | false }")

    current = nav_permissions_for(ctx, role_id)
    known_keys = list(current.keys())
    nxt = dict(current)

    for key, value in nav.items():
        if key not in known_keys:
            raise refuse(f'no navigation item "{key}" — this app has {", ".join(known_keys)}')
        if not isinstance(value, bool):
            raise refuse(f'"{key}" must be true or false')
        if nav_read_only(ctx, role_id, key) and value != current[key]:
            raise refuse(
                f'"{key}" is fixed for {role["label"]} and cannot be changed. It is the page '
                "that grants every other permission, so the persona that administers it keeps it."
            )
        nxt[key] = value

    try:
        ctx.commit_settings(
            {
                **ctx.settings,
                "nav_permissions": {**ctx.settings["nav_permissions"], role_id: nxt},
            }
        )
    except store.Refused as error:
        raise refuse(str(error)) from error
    return settings_view(ctx)


@router.post("/settings/personas/{role_id}/reset")
def reset_nav(role_id: str, ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    """Copies the defaults over the live set, so a key missing from the defaults
    is a permission that silently becomes "not configured" the first time anybody
    resets — which is why both blocks are validated."""
    if not ctx.find_role(role_id):
        known = ", ".join(r["role_id"] for r in ctx.doc["auth_roles"])
        raise refuse(f'no persona "{role_id}" — this tenant has {known}', status=404)
    try:
        ctx.commit_settings(
            {
                **ctx.settings,
                "nav_permissions": {
                    **ctx.settings["nav_permissions"],
                    role_id: dict(ctx.settings["defaults"].get(role_id) or {}),
                },
            }
        )
    except store.Refused as error:
        raise refuse(str(error)) from error
    return settings_view(ctx)
