"""
Audit & Governance — one page for **who sees what**.

**Two gates and a trail, and the page is honest about which of them is real.** A
rule is *recorded, not enforced*: no roster in this app is filtered per persona,
so the resolution states what a rule would admit, never what a reader saw.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Query

from .. import store
from ..core import is_email, now_iso
from ..deps import get_ctx, refuse
from ..models import GovernanceScope, WhatIfScenario
from ..runtime import Ctx
from ..services.governance import (
    governance_add_reader,
    governance_artifact,
    governance_bases,
    governance_people,
    governance_person,
    governance_remove_reader,
    governance_resolution,
    governance_view,
    log_governance,
)

router = APIRouter()


@router.get("/governance")
def read(ctx: Ctx = Depends(get_ctx)) -> dict[str, Any]:
    return governance_view(ctx)


@router.patch("/governance/scope/{role_id}")
def patch_scope(
    role_id: str,
    body: dict = Body(default={}),
    as_: str | None = Query(default=None, alias="as"),
    ctx: Ctx = Depends(get_ctx),
) -> dict[str, Any]:
    """A persona's access rule: a restriction **basis** plus the values it admits,
    resolved against the live register.

    The basis list is derived, never written — the identity column plus every
    field the dictionary declares filterable. A basis nobody could slice a report
    by is not one.
    """
    scope = next(
        (
            s
            for s in ctx.doc["reports"]["governance"]["data_scope"]
            if s["role_id"] == role_id
        ),
        None,
    )
    if not scope:
        known = ", ".join(
            s["role_id"] for s in ctx.doc["reports"]["governance"]["data_scope"]
        )
        raise refuse(f'no persona "{role_id}" — this tenant governs {known}', status=404)

    if as_ is not None and not is_email(as_):
        raise refuse(f'"{as_}" is not an email — send the signed-in address as ?as=, or nothing')

    nxt = dict(scope)
    if "full" in body:
        nxt["full"] = body["full"] is True
    if "mask" in body:
        nxt["mask"] = body["mask"] is True

    if "rule" in body:
        if body["rule"] is None:
            nxt["rule"] = None
        else:
            bases = governance_bases(ctx)
            basis = next(
                (b for b in bases if b["basis"] == (body["rule"] or {}).get("basis")), None
            )
            if not basis:
                offered = ", ".join(b["basis"] for b in bases)
                raise refuse(
                    f'no restriction basis "{(body["rule"] or {}).get("basis")}" — the register '
                    f"offers {offered}. Only fields the dictionary declares filterable, plus "
                    "the spine's identity column, can restrict anything"
                )

            raw = body["rule"].get("values")
            values = list(dict.fromkeys(str(v) for v in raw)) if isinstance(raw, list) else []
            strangers = [v for v in values if not any(x["value"] == v for x in basis["values"])]
            if strangers:
                raise refuse(
                    f"{basis['label']} has no value {', '.join(strangers)} in this register — "
                    "the values come from the roster itself, so one that is not on it would "
                    "admit nothing"
                )

            nxt["rule"] = {"basis": basis["basis"], "values": values}
            # A rule replaces "the whole roster" rather than leaving a rule that
            # nothing reads.
            nxt["full"] = False

    # Masking is a treatment, not a scope of its own, so it implies the full
    # roster when there is nothing else.
    if nxt.get("mask") and not nxt.get("full") and not (nxt.get("rule") and nxt["rule"]["values"]):
        nxt["full"] = True

    try:
        ctx.commit(
            {
                **ctx.doc,
                "reports": {
                    **ctx.doc["reports"],
                    "governance": {
                        **ctx.doc["reports"]["governance"],
                        "data_scope": [
                            nxt if s["role_id"] == role_id else s
                            for s in ctx.doc["reports"]["governance"]["data_scope"]
                        ],
                    },
                },
            }
        )
    except store.Refused as error:
        raise refuse(str(error)) from error

    # Mirrored into the scope table so a rule authored here survives a re-seed of
    # the authored block.
    row = ctx.db.get(GovernanceScope, role_id)
    if row is None:
        row = GovernanceScope(role_id=role_id)
        ctx.db.add(row)
    row.basis = (nxt.get("rule") or {}).get("basis")
    row.values = (nxt.get("rule") or {}).get("values") or []
    row.updated_at = now_iso()
    row.updated_by = as_ or ctx.account_email
    ctx.db.commit()

    resolved = governance_resolution(ctx, nxt)
    label = (ctx.find_role(role_id) or {}).get("label") or role_id
    log_governance(
        ctx,
        "rule",
        as_,
        f"changed the access rule for {label}",
        f"{resolved['summary']} — resolves to {resolved['count']} of {resolved['total']} "
        "generators today. Recorded, not enforced: no roster here is filtered per persona.",
    )
    return governance_view(ctx)


@router.post("/governance/artifacts/{artifact_id}/readers")
def add_reader(
    artifact_id: str,
    body: dict = Body(default={}),
    as_: str | None = Query(default=None, alias="as"),
    ctx: Ctx = Depends(get_ctx),
) -> dict[str, Any]:
    """The page names a *person*, and the server writes to whichever pool that
    artifact actually keeps — persona ids for a report, addresses for a scenario.
    The two are never merged."""
    artifact = governance_artifact(ctx, artifact_id)
    if not artifact:
        raise refuse(f'no published artifact "{artifact_id}"', status=404)

    if as_ is not None and not is_email(as_):
        raise refuse(f'"{as_}" is not an email — send the signed-in address as ?as=, or nothing')

    email = body.get("email")
    person = governance_person(ctx, email)
    if not person:
        known = ", ".join(p["email"] for p in governance_people(ctx))
        raise refuse(f"{email} is not in the directory — Settings knows {known}")

    if person["email"] in artifact["readers"]:
        raise refuse(f'{person["name"]} can already open “{artifact["name"]}”.')

    governance_add_reader(ctx, artifact, person)
    log_governance(
        ctx,
        "reader",
        as_,
        f'gave {person["name"]} access to “{artifact["name"]}”',
        artifact["audience_note"],
    )
    return governance_view(ctx)


@router.delete("/governance/artifacts/{artifact_id}/readers/{email}")
def remove_reader(
    artifact_id: str,
    email: str,
    as_: str | None = Query(default=None, alias="as"),
    ctx: Ctx = Depends(get_ctx),
) -> dict[str, Any]:
    artifact = governance_artifact(ctx, artifact_id)
    if not artifact:
        raise refuse(f'no published artifact "{artifact_id}"', status=404)
    if email not in artifact["readers"]:
        raise refuse(f'{email} is not a reader of “{artifact["name"]}”', status=404)

    if as_ is not None and not is_email(as_):
        raise refuse(f'"{as_}" is not an email — send the signed-in address as ?as=, or nothing')

    person = governance_person(ctx, email)
    problem = governance_remove_reader(ctx, artifact, email)
    if problem:
        raise refuse(problem)

    log_governance(
        ctx,
        "reader",
        as_,
        f'removed {(person or {}).get("name") or email} from “{artifact["name"]}”',
        "The link stops working for them on the next read.",
    )
    return governance_view(ctx)


@router.post("/governance/artifacts/{artifact_id}/unpublish")
def unpublish(
    artifact_id: str,
    as_: str | None = Query(default=None, alias="as"),
    ctx: Ctx = Depends(get_ctx),
) -> dict[str, Any]:
    """Offered only where the server has that act — a scenario's publication is a
    record this server keeps, a report definition's is not, and the refusal names
    the equivalent."""
    artifact = governance_artifact(ctx, artifact_id)
    if not artifact:
        raise refuse(f'no published artifact "{artifact_id}"', status=404)

    if not artifact["can_unpublish"]:
        raise refuse(
            f'“{artifact["name"]}” is a report definition — this section has no unpublish. '
            "Remove every reader instead, which makes it private and is a decision the row "
            "records."
        )

    if as_ is not None and not is_email(as_):
        raise refuse(f'"{as_}" is not an email — send the signed-in address as ?as=, or nothing')

    row = ctx.db.get(WhatIfScenario, artifact_id)
    row.publication = None
    ctx.db.commit()

    log_governance(
        ctx,
        "publish",
        as_,
        f'unpublished “{artifact["name"]}”',
        "It stays in the author’s library — unpublishing withdraws the readers, not the "
        "scenario.",
    )
    return governance_view(ctx)
