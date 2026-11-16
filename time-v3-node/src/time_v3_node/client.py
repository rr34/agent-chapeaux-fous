"""Authenticated Time v3 HTTP client used by the headless node."""

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class TimeV3RequestError(RuntimeError):
    def __init__(self, status_code: int, message: str, code: str = "", reference: str = "") -> None:
        super().__init__(f"Time v3 server returned HTTP {status_code}: {message}")
        self.status_code = status_code
        self.server_message = message
        self.code = code
        self.reference = reference


class TimeV3Client:
    def __init__(self, server_url: str, token: str = "") -> None:
        self.server_url = server_url.rstrip("/")
        self.token = token

    def _json(self, path: str, method: str = "GET", body: dict | None = None) -> dict:
        encoded = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(f"{self.server_url}{path}", data=encoded, method=method, headers=headers)
        return self._request_json(request, timeout=20)

    @staticmethod
    def _request_json(request: Request, timeout: int) -> dict:
        try:
            with urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except HTTPError as error:
            try:
                body = json.loads(error.read().decode("utf-8"))
                message = str(body.get("error") or error.reason)
                code = str(body.get("code") or "")
                reference = str(body.get("reference") or "")
            except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                message = str(error.reason)
                code = ""
                reference = ""
            raise TimeV3RequestError(error.code, message, code, reference) from error

    def messages(self, limit: int = 100) -> list[dict]:
        query = urlencode({"medium": "timev3", "limit": limit})
        return self._json(f"/api/correspondence?{query}").get("items", [])

    def recipients(self) -> list[dict]:
        return self._json("/api/correspondence/timev3-recipients").get("recipients", [])

    def conversation(self, person_id: int, limit: int = 200) -> list[dict]:
        query = urlencode({"personId": person_id, "limit": limit})
        return self._json(f"/api/correspondence/timev3-conversation?{query}").get("items", [])

    def send_text(self, contact_id: int, text: str) -> dict:
        return self._json(
            "/api/correspondence/timev3-messages", "POST",
            {"contactId": contact_id, "text": text},
        )

    def send_voice(self, contact_id: int, recording: Path) -> dict:
        request = Request(
            f"{self.server_url}/api/correspondence/timev3-voice-messages?{urlencode({'contactId': contact_id})}",
            data=recording.read_bytes(), method="POST",
            headers={"Content-Type": "audio/ogg", "Authorization": f"Bearer {self.token}"},
        )
        return self._request_json(request, timeout=60)

    def download_recording(self, correspondence_id: int, target: Path) -> Path:
        request = Request(
            f"{self.server_url}/api/correspondence/{correspondence_id}/recording",
            headers={"Authorization": f"Bearer {self.token}"},
        )
        with urlopen(request, timeout=30) as response:
            target.write_bytes(response.read())
        return target

    def begin_pairing(self, device_name: str, hardware_identifier: str | None = None) -> dict:
        body = {"deviceName": device_name}
        if hardware_identifier:
            body["hardwareIdentifier"] = hardware_identifier
        return self._json("/api/node/pairings", "POST", body)

    def poll_pairing(self, device_code: str) -> dict:
        return self._json("/api/node/pairings/token", "POST", {"deviceCode": device_code})

