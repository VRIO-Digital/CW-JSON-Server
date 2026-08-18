"""
Settings and identity.

Settings has its own small store, separate from the tenant's document: that one
holds sources, profiles, the graph and the reports, this one holds only what the
page administers — the users, each persona's navigation access, and the authored
defaults those reset to. Two stores, two validators, one job each, so a settings
write cannot touch a report and an ingest that rebuilds the reports cannot drop a
permission.
"""

from __future__ import annotations

from typing import Any

from ..core import email_initials
from ..runtime import Ctx

# The sidebar's own keys. A key here that the sidebar does not have is a
# permission nobody can exercise; one the sidebar has that this lacks is an item
# no persona can hide.
NAV_KEYS = [
    "new-graph",
    "ask",
    "reports",
    "sources",
    "catalogue",
    "graph-studio",
    "what-if",
    "audit",
    "settings",
]


def nav_permissions_for(ctx: Ctx, role_id: str) -> dict[str, bool]:
    """Defaults underneath, live permissions over the top. An absent key means
    "not configured", which reads as visible — never as denied."""
    return {
        **(ctx.settings["defaults"].get(role_id) or {}),
        **(ctx.settings["nav_permissions"].get(role_id) or {}),
    }


def nav_read_only(ctx: Ctx, role_id: str, key: str) -> bool:
    return key in (ctx.settings["read_only"].get(role_id) or [])


def settings_view(ctx: Ctx) -> dict[str, Any]:
    """Names personas by `role_id` and never by label — the label is resolved on
    the way out, so a rename reaches every surface at once."""
    return {
        "users": [
            {
                "id": u.get("id"),
                "name": u["name"],
                "email": u["email"],
                "role_id": u["role_id"],
                "role_label": (ctx.find_role(u["role_id"]) or {}).get("label") or u["role_id"],
            }
            for u in ctx.settings["users"]
        ],
        "personas": [
            {
                "role_id": role["role_id"],
                "label": role["label"],
                "access_note": role.get("access_note") or "",
                "nav": nav_permissions_for(ctx, role["role_id"]),
                "read_only": ctx.settings["read_only"].get(role["role_id"]) or [],
                "defaults": ctx.settings["defaults"].get(role["role_id"]) or {},
            }
            for role in ctx.doc["auth_roles"]
        ],
    }


def login(ctx: Ctx, email: Any, password: Any) -> dict[str, Any]:
    """**This is a persona demo.** There is no credential store, so the password
    is length-checked and no more — but the *persona* is looked up rather than
    claimed: the address has to be one of the users Settings knows, and the role
    on that row is the one you sign in as.

    Raises `LoginRefused` with the sentence the page shows.
    """
    from ..core import EMAIL_RE

    if not email or not EMAIL_RE.match(str(email)):
        raise LoginRefused("Enter a valid email address.")
    if not password or len(str(password)) < 6:
        raise LoginRefused("Password must be at least 6 characters.")

    address = str(email).strip()
    user = next(
        (u for u in ctx.settings["users"] if str(u["email"]).lower() == address.lower()), None
    )
    if not user:
        known = ", ".join(u["email"] for u in ctx.settings["users"])
        raise LoginRefused(
            f"No user is set up for {address}. This prototype signs in the people Settings "
            f"knows: {known}."
        )

    role = ctx.find_role(user["role_id"])
    if not role:
        raise LoginRefused(
            f'{address} is set up as "{user["role_id"]}", which is not one of this tenant\'s '
            "personas. Re-author the settings store."
        )

    from ..core import now_iso

    return {
        "email": user["email"],
        "name": user["name"],
        "role_id": role["role_id"],
        "role_label": role["label"],
        "access_note": role.get("access_note") or "",
        "initials": email_initials(user["email"]),
        "signed_in_at": now_iso(),
    }


class LoginRefused(Exception):
    pass
