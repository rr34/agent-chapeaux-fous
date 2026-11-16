"""Small appliance state machine; every start deliberately returns home."""

import asyncio
import logging
import time
from pathlib import Path
from uuid import uuid4
from contextlib import suppress
from html import unescape
from re import sub
from typing import Callable

from .client import TimeV3Client
from .audio import AudioPlayer, OpusRecorder
from .document import LcdDocument
from .hardware import Display, Keypad, Mpu6050, LEFT_ARROW, RECORD_DOT, RIGHT_ARROW
from .menu import Menu
from .motion import GyroscopeBias, MOTION_PAGE_COUNT, RelativeOrientation

logger = logging.getLogger(__name__)
MOTION_REFRESH_SECONDS = 0.2
GYRO_CALIBRATION_SAMPLES = 100
GYRO_CALIBRATION_INTERVAL_SECONDS = 0.01
VOICE_MESSAGE_MAX_SECONDS = 60


def plain_body(value: str | None) -> str:
    return unescape(sub(r"<[^>]+>", lambda match: "\n" if match.group(0).lower() == "<br>" else "", value or ""))


class NodeApplication:
    def __init__(self, display: Display, keypad: Keypad, client: TimeV3Client | None = None,
                 motion: Mpu6050 | None = None, device_name: str = "Time v3 node",
                 hardware_identifier: str | None = None,
                 persist_node_token: Callable[[str], None] | None = None,
                 recorder: OpusRecorder | None = None, player: AudioPlayer | None = None,
                 state_directory: Path | None = None) -> None:
        self.display = display
        self.keypad = keypad
        self.client = client
        self.motion = motion
        self.device_name = device_name
        self.hardware_identifier = hardware_identifier
        self.persist_node_token = persist_node_token
        self.recorder = recorder
        self.player = player
        self.state_directory = state_directory or Path("/tmp/time-v3-node")
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
        self.message_contacts: list[dict] = []
        self.message_contact_index = 0
        self.message_items: list[dict] = []
        self.message_index = 0
        self.message_notice = ""
        self.recording_path: Path | None = None
        self.recording_started_at = 0.0
        self.recording_duration_seconds = 0
        self._recording_task: asyncio.Task | None = None
        self.playback_path: Path | None = None

    def home(self) -> None:
        self.screen = "home"
        self.offset = 0
        self.display.show(self.menu.rows())

    async def open_current(self) -> None:
        selected = self.menu.current
        if selected == "Messages":
            await self.open_messages()
            return
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

    async def open_messages(self) -> None:
        self.message_contacts = []
        self.message_contact_index = 0
        self.message_items = []
        self.message_index = 0
        self.message_notice = ""
        if not self.client:
            self.message_notice = "NETWORK NOT SET UP"
        else:
            try:
                contacts = await asyncio.to_thread(self.client.recipients)
                self.message_contacts = sorted(
                    contacts,
                    key=lambda contact: (str(contact.get("display_name", "")).casefold(),
                                         int(contact.get("person_id", 0))),
                )
            except Exception:
                logger.exception("Could not load Time v3 contacts")
                self.message_notice = "CONTACTS UNAVAILABLE"
        self.screen = "message_contacts"
        self.show_message_contacts()

    def show_message_contacts(self) -> None:
        if self.message_notice:
            self.display.show(LcdDocument(self.message_notice).viewport().rows)
            return
        if not self.message_contacts:
            self.display.show(LcdDocument("NO TIME V3 CONTACTS").viewport().rows)
            return
        selected = min(self.message_contact_index, len(self.message_contacts) - 1)
        first = min(max(0, selected - 1), max(0, len(self.message_contacts) - 4))
        rows = []
        for index in range(first, first + 4):
            if index >= len(self.message_contacts):
                rows.append(" " * 20)
                continue
            marker = ">" if index == selected else " "
            name = str(self.message_contacts[index].get("display_name") or "UNKNOWN CONTACT")
            rows.append(f"{marker}{name[:19]:<19}")
        self.display.show(tuple(rows))

    async def open_message_contact(self) -> None:
        if not self.client or not self.message_contacts:
            return
        contact = self.message_contacts[self.message_contact_index]
        self.message_items = []
        self.message_index = 0
        self.offset = 0
        self.message_notice = ""
        try:
            self.message_items = await asyncio.to_thread(
                self.client.conversation, int(contact["person_id"]), 200,
            )
        except Exception:
            logger.exception("Could not load Time v3 conversation")
            self.message_notice = "MESSAGES UNAVAILABLE"
        self.screen = "message_item"
        self.show_message_item()

    def show_message_item(self) -> None:
        if self.message_notice:
            body_rows = LcdDocument(self.message_notice).render_rows()
        elif not self.message_items:
            body_rows = ["NO MESSAGES"]
        else:
            item = self.message_items[self.message_index]
            recordings = item.get("recordings") or []
            if recordings:
                recording = recordings[0]
                arrow = RIGHT_ARROW if item.get("direction") == "outbound" else LEFT_ARROW
                duration = self.format_duration(round(int(recording.get("duration_ms") or 0) / 1000))
                body_rows = [f"{arrow} VOICE MESSAGE", duration, "ENTER PLAY / STOP", "+ RECORD REPLY"]
            else:
                body_rows = LcdDocument(plain_body(item.get("body"))).render_rows()
        maximum = max(0, len(body_rows) - 4)
        self.offset = min(maximum, max(0, self.offset))
        visible = [
            (body_rows[self.offset + index] if self.offset + index < len(body_rows) else "")[:20].ljust(20)
            for index in range(4)
        ]
        self.display.show(tuple(visible))

    @staticmethod
    def format_duration(seconds: int) -> str:
        return f"{max(0, seconds) // 60}:{max(0, seconds) % 60:02d}"

    def show_recording(self) -> None:
        contact = self.message_contacts[self.message_contact_index]
        name = str(contact.get("display_name") or "CONTACT")[:18]
        elapsed = min(VOICE_MESSAGE_MAX_SECONDS, max(0, round(time.monotonic() - self.recording_started_at)))
        self.display.show(tuple(row[:20].ljust(20) for row in (
            f"{RECORD_DOT} {name}",
            f"{self.format_duration(elapsed)} / 1:00",
            "+ STOP",
            "BACKSPACE CANCEL",
        )))

    def show_recording_review(self, error: str = "") -> None:
        self.display.show(tuple(row[:20].ljust(20) for row in (
            f"{RECORD_DOT} VOICE {self.format_duration(self.recording_duration_seconds)}",
            error or "ENTER PLAY / STOP",
            "+ SEND",
            "BACKSPACE CANCEL",
        )))

    async def recording_clock(self) -> None:
        try:
            while time.monotonic() - self.recording_started_at < VOICE_MESSAGE_MAX_SECONDS:
                await asyncio.sleep(0.25)
                if self.screen == "message_recording":
                    self.show_recording()
            if self.screen == "message_recording":
                await self.stop_voice_recording(from_timer=True)
        except asyncio.CancelledError:
            raise

    async def start_voice_recording(self) -> None:
        if not self.recorder or not self.message_contacts:
            self.message_notice = "MICROPHONE NOT READY"
            self.show_message_item()
            return
        self.stop_playback()
        self.state_directory.mkdir(parents=True, exist_ok=True)
        self.recording_path = self.state_directory / f"voice-{uuid4()}.ogg"
        try:
            await asyncio.to_thread(self.recorder.start, self.recording_path)
        except Exception:
            logger.exception("Could not start voice-message recording")
            self.recording_path = None
            self.message_notice = "RECORDING FAILED"
            self.show_message_item()
            return
        self.recording_started_at = time.monotonic()
        self.screen = "message_recording"
        self.show_recording()
        self._recording_task = asyncio.create_task(self.recording_clock())

    async def stop_voice_recording(self, from_timer: bool = False) -> None:
        if self.screen != "message_recording" or not self.recording_path:
            return
        if not from_timer and self._recording_task:
            task = self._recording_task
            self._recording_task = None
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        elif from_timer:
            self._recording_task = None
        self.recording_duration_seconds = min(
            VOICE_MESSAGE_MAX_SECONDS, max(1, round(time.monotonic() - self.recording_started_at)),
        )
        try:
            await asyncio.to_thread(self.recorder.stop)
            if not self.recording_path.exists() or self.recording_path.stat().st_size == 0:
                raise RuntimeError("ffmpeg did not produce a recording")
        except Exception:
            logger.exception("Could not finish voice-message recording")
            self.recording_path.unlink(missing_ok=True)
            self.recording_path = None
            self.screen = "message_item"
            self.message_notice = "RECORDING FAILED"
            self.show_message_item()
            return
        self.screen = "message_review"
        self.show_recording_review()

    async def cancel_voice_recording(self) -> None:
        if self._recording_task:
            task = self._recording_task
            self._recording_task = None
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        if self.screen == "message_recording" and self.recorder:
            with suppress(Exception):
                await asyncio.to_thread(self.recorder.stop)
        self.stop_playback()
        if self.recording_path:
            self.recording_path.unlink(missing_ok=True)
        self.recording_path = None
        self.screen = "message_item"
        self.show_message_item()

    async def send_voice_recording(self) -> None:
        if not self.client or not self.recording_path or not self.message_contacts:
            return
        self.stop_playback()
        self.screen = "message_sending"
        self.display.show(("SENDING...          ", "                    ", "                    ", "                    "))
        contact = self.message_contacts[self.message_contact_index]
        try:
            await asyncio.to_thread(self.client.send_voice, int(contact["contact_id"]), self.recording_path)
            self.recording_path.unlink(missing_ok=True)
            self.recording_path = None
            self.message_items = await asyncio.to_thread(self.client.conversation, int(contact["person_id"]), 200)
            self.message_index = 0
            self.offset = 0
            self.screen = "message_item"
            self.show_message_item()
        except Exception:
            logger.exception("Could not send voice message")
            self.screen = "message_review"
            self.show_recording_review("SEND FAILED - RETRY")

    def stop_playback(self) -> None:
        if self.player:
            self.player.stop()
        if self.playback_path:
            if self.playback_path != self.recording_path:
                self.playback_path.unlink(missing_ok=True)
            self.playback_path = None

    async def toggle_message_playback(self) -> None:
        if not self.player:
            return
        if self.playback_path and self.player.playing:
            self.stop_playback()
            if self.screen == "message_review":
                self.show_recording_review()
            else:
                self.show_message_item()
            return
        if self.playback_path:
            self.stop_playback()
        source = self.recording_path
        if self.screen == "message_item":
            item = self.message_items[self.message_index] if self.message_items else None
            if not item or not item.get("recordings") or not self.client:
                return
            self.state_directory.mkdir(parents=True, exist_ok=True)
            source = self.state_directory / f"play-{uuid4()}.ogg"
            self.display.show(("LOADING VOICE...    ", "                    ", "                    ", "                    "))
            try:
                await asyncio.to_thread(self.client.download_recording, int(item["correspondence_id"]), source)
            except Exception:
                logger.exception("Could not download voice message")
                source.unlink(missing_ok=True)
                self.message_notice = "PLAYBACK UNAVAILABLE"
                self.show_message_item()
                return
        if source:
            self.playback_path = source
            self.player.play(source)

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
        elif self.screen == "message_contacts":
            if action == "back":
                self.home()
            elif action == "up" and self.message_contacts:
                self.message_contact_index = (self.message_contact_index - 1) % len(self.message_contacts)
                self.show_message_contacts()
            elif action == "down" and self.message_contacts:
                self.message_contact_index = (self.message_contact_index + 1) % len(self.message_contacts)
                self.show_message_contacts()
            elif action in {"select", "right"}:
                await self.open_message_contact()
        elif self.screen == "message_item":
            if action == "back":
                self.stop_playback()
                self.screen = "message_contacts"
                self.message_notice = ""
                self.show_message_contacts()
            elif action == "right" and self.message_index < len(self.message_items) - 1:
                self.stop_playback()
                self.message_index += 1
                self.offset = 0
                self.show_message_item()
            elif action == "left" and self.message_index > 0:
                self.stop_playback()
                self.message_index -= 1
                self.offset = 0
                self.show_message_item()
            elif action == "up":
                self.offset -= 1
                self.show_message_item()
            elif action == "down":
                self.offset += 1
                self.show_message_item()
            elif action == "record":
                await self.start_voice_recording()
            elif action == "select":
                await self.toggle_message_playback()
        elif self.screen == "message_recording":
            if action == "record":
                await self.stop_voice_recording()
            elif action == "back":
                await self.cancel_voice_recording()
        elif self.screen == "message_review":
            if action == "record":
                await self.send_voice_recording()
            elif action == "select":
                await self.toggle_message_playback()
            elif action == "back":
                await self.cancel_voice_recording()
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
            if self.screen in {"message_recording", "message_review", "message_sending"}:
                await self.cancel_voice_recording()
            self.stop_playback()
            refresh_task.cancel()
            if self._pairing_task:
                self._pairing_task.cancel()
            with suppress(asyncio.CancelledError):
                await refresh_task
            if self._pairing_task:
                with suppress(asyncio.CancelledError):
                    await self._pairing_task

