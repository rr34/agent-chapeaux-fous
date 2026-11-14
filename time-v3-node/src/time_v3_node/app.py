"""Small appliance state machine; every start deliberately returns home."""

import asyncio
import logging
from contextlib import suppress
from html import unescape
from re import sub
from typing import Callable

from .client import TimeV3Client
from .document import LcdDocument
from .hardware import Display, Keypad, Mpu6050
from .menu import Menu
from .motion import GyroscopeBias, MOTION_PAGE_COUNT, RelativeOrientation

logger = logging.getLogger(__name__)
MOTION_REFRESH_SECONDS = 0.2
GYRO_CALIBRATION_SAMPLES = 100
GYRO_CALIBRATION_INTERVAL_SECONDS = 0.01


def plain_body(value: str | None) -> str:
    return unescape(sub(r"<[^>]+>", lambda match: "\n" if match.group(0).lower() == "<br>" else "", value or ""))


class NodeApplication:
    def __init__(self, display: Display, keypad: Keypad, client: TimeV3Client | None = None,
                 motion: Mpu6050 | None = None, device_name: str = "Time v3 node",
                 hardware_identifier: str | None = None,
                 persist_node_token: Callable[[str], None] | None = None) -> None:
        self.display = display
        self.keypad = keypad
        self.client = client
        self.motion = motion
        self.device_name = device_name
        self.hardware_identifier = hardware_identifier
        self.persist_node_token = persist_node_token
        self.menu = Menu()
        self.screen = "home"
        self.offset = 0
        self.document = LcdDocument()
        self.orientation = RelativeOrientation()
        self.gyroscope_bias = GyroscopeBias()
        self.motion_page = 0
        self._motion_read_failed = False
        self._calibrating_gyroscope = False
        self._pairing_task: asyncio.Task | None = None

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
            self.screen = "motion"
            self.motion_page = 0
            self.orientation.zero()
            self.show_motion()
            return
        elif selected == "Internet":
            self.document = LcdDocument("NO APPROVED PAGES\nLOADED")
            self.screen = "document"
        elif selected == "Pair node":
            await self.start_pairing()
            return
        else:
            self.document = LcdDocument("TIME V3 NODE\nREADY")
            self.screen = "document"
        self.show_document()

    async def start_pairing(self) -> None:
        if not self.client:
            self.document = LcdDocument("SERVER NOT SET")
            self.screen = "document"
            self.show_document()
            return
        if self.client.token:
            self.document = LcdDocument(f"NODE LINKED\n{self.device_name}")
            self.screen = "document"
            self.show_document()
            return
        try:
            pairing = await asyncio.to_thread(
                self.client.begin_pairing, self.device_name, self.hardware_identifier,
            )
        except Exception:
            logger.exception("Could not begin Time v3 node pairing")
            self.document = LcdDocument("PAIRING UNAVAILABLE")
            self.screen = "document"
            self.show_document()
            return
        self.screen = "pairing"
        self.display.show(tuple(row[:20].ljust(20) for row in (
            "PAIR NODE", str(pairing["userCode"]), "APPROVE IN ACCOUNT", "WAITING",
        )))
        if self._pairing_task:
            self._pairing_task.cancel()
        self._pairing_task = asyncio.create_task(self.wait_for_pairing(
            str(pairing["deviceCode"]), float(pairing.get("interval", 5)),
        ))

    async def wait_for_pairing(self, device_code: str, interval: float) -> None:
        try:
            while True:
                await asyncio.sleep(max(0, interval))
                result = await asyncio.to_thread(self.client.poll_pairing, device_code)
                if result.get("pending"):
                    interval = float(result.get("interval", interval))
                    continue
                token = str(result["token"])
                if self.persist_node_token:
                    self.persist_node_token(token)
                self.client.token = token
                if self.screen == "pairing":
                    self.document = LcdDocument(f"NODE LINKED\n{self.device_name}")
                    self.screen = "document"
                    self.show_document()
                return
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Could not complete Time v3 node pairing")
            if self.screen == "pairing":
                self.document = LcdDocument("PAIRING EXPIRED\nTRY AGAIN")
                self.screen = "document"
                self.show_document()

    def show_document(self) -> None:
        viewport = self.document.viewport(self.offset)
        self.offset = viewport.offset
        self.display.show(viewport.rows)

    def show_motion(self) -> None:
        if not self.motion:
            self.display.show(("MOTION SENSOR       ", "NOT READY           ", "                    ", "                    "))
            return
        if self._calibrating_gyroscope:
            return
        try:
            sample = self.gyroscope_bias.apply(self.motion.read())
            _, _, yaw = self.orientation.update(sample)
            self._motion_read_failed = False
            self.display.show(tuple(row[:20].ljust(20) for row in sample.display_page(self.motion_page, yaw)))
        except OSError:
            if not self._motion_read_failed:
                logger.exception("Could not read the MPU-6050")
            self._motion_read_failed = True
            self.display.show(("MOTION SENSOR       ", "READ FAILED         ", "RETRYING...         ", "                    "))

    async def zero_gyroscope(self) -> None:
        if not self.motion or self._calibrating_gyroscope:
            return
        self._calibrating_gyroscope = True
        self.display.show(("GYROSCOPE ZERO      ", "KEEP DEVICE STILL   ", "SAMPLING...         ", "                    "))
        samples = []
        try:
            for _ in range(GYRO_CALIBRATION_SAMPLES):
                samples.append(self.motion.read())
                await asyncio.sleep(GYRO_CALIBRATION_INTERVAL_SECONDS)
            self.gyroscope_bias.calibrate(samples)
            self.orientation.zero()
            self._motion_read_failed = False
        except OSError:
            logger.exception("Could not calibrate the MPU-6050 gyroscope")
            self._motion_read_failed = True
        finally:
            self._calibrating_gyroscope = False
            self.show_motion()

    async def refresh_motion(self) -> None:
        while True:
            await asyncio.sleep(MOTION_REFRESH_SECONDS)
            if self.screen == "motion":
                self.show_motion()

    async def action(self, action: str) -> None:
        if self.screen == "home":
            if action == "up": self.menu.move(-1)
            elif action == "down": self.menu.move(1)
            elif action in {"select", "right"}: await self.open_current()
            self.display.show(self.menu.rows()) if self.screen == "home" else None
        elif self.screen == "motion":
            if action == "back":
                self.home()
            elif action == "left":
                self.motion_page = (self.motion_page - 1) % MOTION_PAGE_COUNT
                self.show_motion()
            elif action == "right":
                self.motion_page = (self.motion_page + 1) % MOTION_PAGE_COUNT
                self.show_motion()
            elif action == "zero" and self.motion_page == 1:
                await self.zero_gyroscope()
            elif action == "zero" and self.motion_page == 2:
                self.orientation.zero()
                self.show_motion()
        elif action == "back":
            self.home()
        elif action == "up":
            self.offset -= 1
            self.show_document()
        elif action == "down":
            self.offset += 1
            self.show_document()

    async def run(self) -> None:
        self.home()
        refresh_task = asyncio.create_task(self.refresh_motion())
        try:
            async for action in self.keypad.actions():
                await self.action(action)
        finally:
            refresh_task.cancel()
            if self._pairing_task:
                self._pairing_task.cancel()
            with suppress(asyncio.CancelledError):
                await refresh_task
            if self._pairing_task:
                with suppress(asyncio.CancelledError):
                    await self._pairing_task

