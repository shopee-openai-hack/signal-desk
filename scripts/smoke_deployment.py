"""Check a deployment; reuse private state after restart to prove persistence.

Usage: uv run python scripts/smoke_deployment.py HTTPS_URL /tmp/smoke-state.json
First invocation creates one synthetic plan (may use model quota in live mode).
Subsequent invocations only read the saved run. State contains a session cookie;
keep it outside the repository and remove it when verification is complete.
"""
import json
import os
from pathlib import Path
import sys

import httpx


def main():
    url, state_file = sys.argv[1:]
    if not url.startswith("https://"):
        raise SystemExit("Use the deployment's HTTPS URL")
    state_path = Path(state_file)
    with httpx.Client(base_url=url.rstrip("/"), timeout=90) as client:
        health = client.get("/healthz")
        health.raise_for_status()
        assert health.json()["database"] == "ok"
        page = client.get("/")
        page.raise_for_status()
        assert "<html" in page.text.lower()
        if state_path.exists():
            state = json.loads(state_path.read_text())
            assert state["url"] == url, "State belongs to another deployment"
            client.cookies.update(state["cookies"])
        else:
            response = client.post("/api/plans", headers={"Origin": url},
                                   json={"goal": "Infra smoke test: prepare a demo checklist"})
            response.raise_for_status()
            assert response.status_code == 201
            cookie = health.headers.get("set-cookie", "").lower()
            assert "secure" in cookie and "httponly" in cookie
            state = {"url": url, "id": response.json()["id"],
                     "cookies": dict(client.cookies)}
            fd = os.open(state_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as output:
                json.dump(state, output)
        run = client.get("/api/runs/" + state["id"])
        run.raise_for_status()
        assert run.json()["status"] == "completed"
        history = client.get("/api/runs")
        history.raise_for_status()
        assert any(item["id"] == state["id"] for item in history.json())
        with httpx.Client(base_url=url, timeout=30) as stranger:
            assert stranger.get("/api/runs/" + state["id"]).status_code == 404
        print(json.dumps({"health": health.json(), "run_id": state["id"],
                          "history": "ok", "isolation": "ok"}))


if __name__ == "__main__":
    main()
