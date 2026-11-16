import asyncio
import logging
import os
import socket
from pathlib import Path

from .app import NodeApplication
from .audio import AudioPlayer, OpusRecorder
from .client import TimeV3Client
from .hardware import CharacterLcd, Keypad, Mpu6050
from .wifi import NetworkManagerWifi


def required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def state_token_path() -> Path:
    return Path(os.environ.get("TIMEV3_STATE_DIRECTORY", "/var/lib/time-v3-node")) / "node-token"


def load_node_token() -> str:
    configured = os.environ.get("TIMEV3_NODE_TOKEN", "").strip()
    if configured:
        return configured
    try:
        return state_token_path().read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return ""


def persist_node_token(token: str) -> None:
    path = state_token_path()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(f"{token}\n", encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, path)


def hardware_identifier() -> str | None:
    configured = os.environ.get("TIMEV3_HARDWARE_IDENTIFIER", "").strip()
    if configured:
        return configured
    try:
        return Path("/etc/machine-id").read_text(encoding="utf-8").strip() or None
    except FileNotFoundError:
        return None


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    display = CharacterLcd(int(required_environment("TIMEV3_LCD_ADDRESS"), 0))
    keypad = Keypad(required_environment("TIMEV3_KEYPAD_DEVICE"))
    server_url = os.environ.get("TIMEV3_SERVER_URL", "").strip()
    client = TimeV3Client(server_url, load_node_token()) if server_url else None
    device_name = os.environ.get("TIMEV3_DEVICE_NAME", "").strip() or socket.gethostname()
    state_directory = Path(os.environ.get("TIMEV3_STATE_DIRECTORY", "/var/lib/time-v3-node"))
    recorder = OpusRecorder(os.environ.get("TIMEV3_AUDIO_INPUT", "auto").strip() or "auto")
    player = AudioPlayer(os.environ.get("TIMEV3_AUDIO_OUTPUT", "auto").strip() or "auto")
    try:
        motion = Mpu6050()
    except OSError:
        logging.exception("The MPU-6050 is unavailable; starting the remaining node UI")
        motion = None
    asyncio.run(NodeApplication(
        display, keypad, client, motion, device_name, hardware_identifier(), persist_node_token,
        recorder, player, state_directory,
        NetworkManagerWifi(),
    ).run())


if __name__ == "__main__":
    main()

