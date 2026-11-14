import asyncio
import logging
import os

from .app import NodeApplication
from .client import TimeV3Client
from .hardware import CharacterLcd, Keypad, Mpu6050


def required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    display = CharacterLcd(int(required_environment("TIMEV3_LCD_ADDRESS"), 0))
    keypad = Keypad(required_environment("TIMEV3_KEYPAD_DEVICE"))
    server_url = os.environ.get("TIMEV3_SERVER_URL", "").strip()
    token = os.environ.get("TIMEV3_NODE_TOKEN", "").strip()
    client = TimeV3Client(server_url, token) if server_url and token else None
    try:
        motion = Mpu6050()
    except OSError:
        logging.exception("The MPU-6050 is unavailable; starting the remaining node UI")
        motion = None
    asyncio.run(NodeApplication(display, keypad, client, motion).run())


if __name__ == "__main__":
    main()

