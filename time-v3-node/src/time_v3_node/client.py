"""Authenticated Time v3 HTTP client used by the headless node."""

import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class TimeV3Client:
    def __init__(self, server_url: str, token: str) -> None:
        self.server_url = server_url.rstrip("/")
        self.token = token

    def _json(self, path: str, method: str = "GET", body: dict | None = None) -> dict:
        encoded = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(
            f"{self.server_url}{path}", data=encoded, method=method,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        with urlopen(request, timeout=20) as response:
            return json.load(response)

    def messages(self, limit: int = 100) -> list[dict]:
        query = urlencode({"medium": "timev3", "limit": limit})
        return self._json(f"/api/correspondence?{query}").get("items", [])

    def recipients(self) -> list[dict]:
        return self._json("/api/correspondence/timev3-recipients").get("recipients", [])

    def send_text(self, contact_id: int, text: str) -> dict:
        return self._json(
            "/api/correspondence/timev3-messages", "POST",
            {"contactId": contact_id, "text": text},
        )

