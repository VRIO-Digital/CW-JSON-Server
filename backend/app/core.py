"""
The primitives the rest of the API is built from.

`js_hash` is the load-bearing one. The Node server synthesised columns,
entities, confidences and sample sets from an FNV-1a hash of an id, so repeat
requests agreed with each other. Every one of those figures has to come out the
same here or the ported API would answer differently from the one it replaces —
so the hash is reproduced exactly, 32-bit overflow and all, and checked against
Node's output rather than assumed.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Iterable

# ---------------------------------------------------------------------------
# Hashing — FNV-1a as JavaScript computes it
# ---------------------------------------------------------------------------
_MASK = 0xFFFFFFFF


def _to_int32(value: int) -> int:
    value &= _MASK
    return value - 0x100000000 if value >= 0x80000000 else value


def js_hash(text: str) -> int:
    """`hash()` from server.mjs: FNV-1a over UTF-16 code units, `Math.imul`
    wrapping to a signed 32-bit int, then `Math.abs`."""
    # Not coerced to int32 up front: JavaScript leaves the seed a plain Number,
    # so `hash('')` is 2166136261 rather than the 2128831035 the signed
    # reading would give. The coercion happens on the first XOR.
    h = 2166136261
    for unit in _utf16_units(text):
        h = _to_int32(h ^ unit)
        h = _to_int32(h * 16777619)
    return abs(h)


def _utf16_units(text: str) -> Iterable[int]:
    """JavaScript strings are UTF-16, so a character outside the BMP is two
    code units to `charCodeAt`. Iterating Python characters would hash an
    em dash the same but a surrogate pair differently."""
    for ch in text:
        code = ord(ch)
        if code > 0xFFFF:
            code -= 0x10000
            yield 0xD800 + (code >> 10)
            yield 0xDC00 + (code & 0x3FF)
        else:
            yield code


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------
def slugify(text: Any) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(text).lower()))


EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def is_email(value: Any) -> bool:
    return isinstance(value, str) and bool(EMAIL_RE.match(value.strip()))


def email_initials(email: Any) -> str:
    """The avatar is derived from what the login actually collected. There is no
    name field, so nothing is invented."""
    local = str(email).split("@")[0]
    segments = [s for s in re.split(r"[._-]+", local) if s]
    initials = segments[0][0] + segments[-1][0] if len(segments) >= 2 else local[:2]
    return initials.upper() or "?"


def display_name_from_email(email: Any) -> str:
    local = str(email).split("@")[0]
    name = " ".join(s[0].upper() + s[1:] for s in re.split(r"[._-]+", local) if s)
    return name or str(email)


def entity_name(raw: Any) -> str:
    text = re.sub(r"\.[a-z0-9]+$", "", str(raw), flags=re.IGNORECASE)
    text = re.sub(r"[_\-.]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\b\w", lambda m: m.group().upper(), text)


def number_format(value: float | int) -> str:
    """`Number.toLocaleString('en-US')` for the integers these payloads carry."""
    return f"{value:,}"


def round_js(value: float, digits: int = 0) -> float:
    """JavaScript's `toFixed` rounds half away from zero; Python's `round`
    rounds half to even. `(0.5).toFixed(0)` is "1" and `round(0.5)` is 0, which
    is a visible difference on a confidence printed to two places."""
    from decimal import ROUND_HALF_UP, Decimal

    quant = Decimal(1).scaleb(-digits)
    out = float(Decimal(repr(value)).quantize(quant, rounding=ROUND_HALF_UP))
    return int(out) if digits == 0 else out


def now_iso() -> str:
    """`new Date().toISOString()` — milliseconds and a trailing Z."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    )


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c))


# ---------------------------------------------------------------------------
# Normalisers — what the wizard accepts into a draft
# ---------------------------------------------------------------------------
def normalize_drafted(rows: Any) -> list[dict[str, str]]:
    """Personas and KPIs. Accepts the bare string an older draft holds; a member
    with no name is dropped here and refused by the route."""
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for entry in rows if isinstance(rows, list) else []:
        raw = {"name": entry} if isinstance(entry, str) else (entry or {})
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "name": name,
                "description": str(raw.get("description") or "").strip(),
                "source": "ai" if raw.get("source") == "ai" else "user",
            }
        )
        if len(out) >= 12:
            break
    return out


def normalize_questions(rows: Any) -> list[dict[str, str]]:
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for entry in rows if isinstance(rows, list) else []:
        raw = {"text": entry} if isinstance(entry, str) else (entry or {})
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or raw.get("name") or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "text": text,
                "priority": "high" if raw.get("priority") == "high" else "normal",
                "source": "ai" if raw.get("source") == "ai" else "user",
            }
        )
        if len(out) >= 20:
            break
    return out


GAP_DECISIONS = ("accept permanent", "drop question", "connect source", "defer with trigger")


def normalize_gap_decisions(rows: Any) -> list[dict[str, str]]:
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for entry in rows if isinstance(rows, list) else []:
        if not isinstance(entry, dict):
            continue
        element_id = str(entry.get("element_id") or "").strip()
        decision = str(entry.get("decision") or "").strip()
        if not element_id or element_id in seen or decision not in GAP_DECISIONS:
            continue
        seen.add(element_id)
        out.append({"element_id": element_id, "decision": decision})
    return out


def normalize_source_picks(rows: Any) -> list[dict[str, Any]]:
    """`mode: 'all'` is stored rather than expanded, so a table profiled later is
    included without editing the draft."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for entry in rows if isinstance(rows, list) else []:
        if not isinstance(entry, dict):
            continue
        source_id = str(entry.get("source_id") or "").strip()
        if not source_id or source_id in seen:
            continue
        seen.add(source_id)
        mode = "subset" if entry.get("mode") == "subset" else "all"
        objects: list[str] = []
        if mode == "subset":
            raw = entry.get("objects") if isinstance(entry.get("objects"), list) else []
            for o in raw:
                text = str(o).strip()
                if text and text not in objects:
                    objects.append(text)
        out.append({"source_id": source_id, "mode": mode, "objects": objects})
    return out


# ---------------------------------------------------------------------------
# Source naming
# ---------------------------------------------------------------------------
SOURCE_NAME_MIN = 6


def source_name_problem(value: Any) -> str | None:
    """There is no id fallback. `source_name || project_id` made the field
    optional in practice and produced rows named `vrio-contextweave-demo`, which
    reads as a name and is not one."""
    name = value.strip() if isinstance(value, str) else ""
    if name == "":
        return (
            "source_name is required — give this source a name of at least "
            f"{SOURCE_NAME_MIN} characters, so it can be told apart in the Sources table."
        )
    if len(name) < SOURCE_NAME_MIN:
        return f'"{name}" is too short — a source name needs at least {SOURCE_NAME_MIN} characters.'
    return None
