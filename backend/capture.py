"""
Record every payload the API answers with, for the frontend to validate.

The smoke test proves the API answers; it does not prove the *app* can read what
it answers. `client.ts` validates every response at its boundary, so a field
renamed or a type drifted surfaces as a toast in the UI and nowhere else — which
is exactly the failure a Python rewrite of a JavaScript server invites.

So: replay the smoke walk, record `(method, path) -> payload`, and hand the file
to a script that runs the real fetchers against it.

    python backend/capture.py            # writes backend/captured.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import backend.smoke as smoke  # noqa: E402

RECORDED: dict[str, dict] = {}
IDS: dict[str, str] = {}
# The streamed answer, kept as the raw event-stream text. Its client-side parser
# validates *every* event and `done` as one object, and that half of Ask cannot be
# exercised by a JSON payload.
SSE: dict[str, str] = {}


class Recording(smoke.TestClient):
    """A TestClient that keeps every JSON response it saw."""

    def request(self, method, url, *args, **kwargs):  # type: ignore[override]
        response = super().request(method, url, *args, **kwargs)
        path = str(url).split("?")[0]
        if response.headers.get("content-type", "").startswith("text/event-stream"):
            SSE[f"{method.upper()} {path}"] = response.text
            return response
        if response.headers.get("content-type", "").startswith("application/json"):
            try:
                body = response.json()
            except ValueError:
                return response
            # Keep the *successful* read of each path: a refusal recorded over a
            # payload would hand the validator an error envelope to check.
            key = f"{method.upper()} {path}"
            if response.status_code < 400 or key not in RECORDED:
                RECORDED[key] = {"status": response.status_code, "body": body}
        return response


def main() -> int:
    smoke.TestClient = Recording  # type: ignore[assignment]
    code = smoke.main()

    # The ids the harness needs to call the same paths.
    for key in RECORDED:
        path = key.split(" ", 1)[1]
        if path.startswith("/sources/bigquery:"):
            IDS["bigquerySourceId"] = path.split("/")[2]
        if path.startswith("/sources/gdrive:"):
            IDS["driveSourceId"] = path.split("/")[2]
        if path.startswith("/graph-studio/") and path.count("/") == 2:
            IDS["useCaseId"] = path.split("/")[2]
        if path.startswith("/reports/") and path.count("/") == 2 and "governance" not in path:
            IDS.setdefault("reportId", path.split("/")[2])

    out = ROOT / "backend" / "captured.json"
    out.write_text(
        json.dumps({"ids": IDS, "responses": RECORDED, "sse": SSE}, indent=1),
        encoding="utf-8",
    )
    print(
        f"\ncaptured {len(RECORDED)} payloads and {len(SSE)} stream(s) "
        f"-> {out.relative_to(ROOT)}"
    )
    print(f"ids: {IDS}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
