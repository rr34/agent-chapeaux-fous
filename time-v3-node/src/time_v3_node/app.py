"""Small appliance state machine; every start deliberately returns home."""

import asyncio
import logging
from html import unescape
from re import sub

from .client import TimeV3Client
from .document import LcdDocument
from .hardware import Display, Keypad, Mpu6050
from .menu import Menu
from .motion import RelativeOrientation

logger = logging.getLogger(__name__)


def plain_body(value: str | None) -> str:
    return unescape(sub(r"<[^>]+>", lambda match: "\n" if match.group(0).lower() == "<br>" else "", value or ""))


class NodeApplication:
    def __init__(self, display: Display, keypad: Keypad, client: TimeV3Client | None = None, motion: Mpu6050 | None = None) -> None:
        self.display = display
        self.keypad = keypad
        self.client = client
        self.motion = motion
        self.menu = Menu()
        self.screen = "home"
        self.offset = 0
        self.document = LcdDocument()
        self.orientation = RelativeOrientation()

    def home(self) -> None:
        self.screen = "home"
        self.offset = 0
        self.display.show(self.menu.rows())

    async def open_current(self) -> None:
        selected = self.menu.current
        if selected == "Messages":
            if not self.client:
                self.document = LcdDocument("NETWORK NOT SET UP")
            else:
                try:
                    messages = await asyncio.to_thread(self.client.messages, 20)
                    latest = messages[0] if messages else None
                    self.document = LcdDocument(plain_body(latest.get("body")) if latest else "NO MESSAGES")
                except Exception:
                    logger.exception("Could not load Time v3 messages")
                    self.document = LcdDocument("MESSAGES UNAVAILABLE")
            self.screen = "document"
        elif selected == "Accelerometer":
            if not self.motion:
                self.document = LcdDocument("SENSOR NOT READY")
            else:
                try:
                    sample = self.motion.read()
                    _, _, yaw = self.orientation.update(sample)
                    self.document = LcdDocument(sample.display_text(yaw))
                except OSError:
                    logger.exception("Could not read the MPU-6050")
                    self.document = LcdDocument("SENSOR READ FAILED\n+ TO RETRY")
            self.screen = "document"
        elif selected == "Internet":
            self.document = LcdDocument("NO APPROVED PAGES\nLOADED")
            self.screen = "document"
        else:
            self.document = LcdDocument("TIME V3 NODE\nREADY\n0 RETURNS HOME")
            self.screen = "document"
        self.show_document()

    def show_document(self) -> None:
        viewport = self.document.viewport(self.offset)
        self.offset = viewport.offset
        self.display.show(viewport.rows)

    async def action(self, action: str) -> None:
        if action == "home":
            self.home()
        elif self.screen == "home":
            if action == "up": self.menu.move(-1)
            elif action == "down": self.menu.move(1)
            elif action in {"select", "right"}: await self.open_current()
            self.display.show(self.menu.rows()) if self.screen == "home" else None
        elif action == "back":
            self.home()
        elif action == "up":
            self.offset -= 1
            self.show_document()
        elif action == "down":
            self.offset += 1
            self.show_document()
        elif action == "record" and self.menu.current == "Accelerometer":
            await self.open_current()

    async def run(self) -> None:
        self.home()
        async for action in self.keypad.actions():
            await self.action(action)

