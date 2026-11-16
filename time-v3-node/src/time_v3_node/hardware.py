"""Thin adapters for only the devices declared in HARDWARE.md."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

from .motion import MotionSample

RECORD_DOT = "●"
LEFT_ARROW = "←"
RIGHT_ARROW = "→"

CUSTOM_GLYPHS = {
    RECORD_DOT: (0b00000, 0b01110, 0b11111, 0b11111, 0b11111, 0b01110, 0b00000, 0b00000),
    LEFT_ARROW: (0b00100, 0b01100, 0b11111, 0b01100, 0b00100, 0b00000, 0b00000, 0b00000),
    RIGHT_ARROW: (0b00100, 0b00110, 0b11111, 0b00110, 0b00100, 0b00000, 0b00000, 0b00000),
}


class Display(Protocol):
    def show(self, rows: tuple[str, str, str, str]) -> None: ...


class ConsoleDisplay:
    def show(self, rows: tuple[str, str, str, str]) -> None:
        print("+--------------------+")
        for row in rows:
            print(f"|{row[:20]:<20}|")
        print("+--------------------+")


class CharacterLcd:
    def __init__(self, address: int, port: int = 1) -> None:
        from RPLCD.i2c import CharLCD
        self._lcd = CharLCD(
            i2c_expander="PCF8574", address=address, port=port,
            cols=20, rows=4, dotsize=8,
            auto_linebreaks=False, backlight_enabled=True,
        )
        for index, pattern in enumerate(CUSTOM_GLYPHS.values()):
            self._lcd.create_char(index, pattern)

    def show(self, rows: tuple[str, str, str, str]) -> None:
        for index, row in enumerate(rows):
            self._lcd.cursor_pos = (index, 0)
            for character in row[:20].ljust(20):
                glyph = list(CUSTOM_GLYPHS).index(character) if character in CUSTOM_GLYPHS else None
                self._lcd.write(glyph if glyph is not None else ord(character))


class Mpu6050:
    ADDRESS = 0x69

    def __init__(self, bus_number: int = 1) -> None:
        from smbus2 import SMBus
        self._bus = SMBus(bus_number)
        self._bus.write_byte_data(self.ADDRESS, 0x6B, 0)

    def _signed(self, register: int) -> int:
        value = (self._bus.read_byte_data(self.ADDRESS, register) << 8) | self._bus.read_byte_data(self.ADDRESS, register + 1)
        return value - 65536 if value >= 32768 else value

    def read(self) -> MotionSample:
        return MotionSample(
            self._signed(0x3B) / 16384.0,
            self._signed(0x3D) / 16384.0,
            self._signed(0x3F) / 16384.0,
            self._signed(0x43) / 131.0,
            self._signed(0x45) / 131.0,
            self._signed(0x47) / 131.0,
            self._signed(0x41) / 340.0 + 36.53,
        )


KEY_ACTIONS = {
    "KEY_KP0": "digit_0", "KEY_0": "digit_0", "KEY_INSERT": "digit_0",
    "KEY_KP1": "digit_1", "KEY_1": "digit_1", "KEY_END": "digit_1",
    "KEY_KP2": "digit_2", "KEY_2": "digit_2", "KEY_DOWN": "digit_2",
    "KEY_KP3": "digit_3", "KEY_3": "digit_3", "KEY_PAGEDOWN": "digit_3",
    "KEY_KP4": "digit_4", "KEY_4": "digit_4", "KEY_LEFT": "digit_4",
    "KEY_KP5": "digit_5", "KEY_5": "digit_5", "KEY_KPBEGIN": "digit_5",
    "KEY_KP6": "digit_6", "KEY_6": "digit_6", "KEY_RIGHT": "digit_6",
    "KEY_KP7": "digit_7", "KEY_7": "digit_7", "KEY_HOME": "digit_7",
    "KEY_KP8": "digit_8", "KEY_8": "digit_8", "KEY_UP": "digit_8",
    "KEY_KP9": "digit_9", "KEY_9": "digit_9", "KEY_PAGEUP": "digit_9",
    "KEY_KPENTER": "select", "KEY_ENTER": "select",
    "KEY_BACKSPACE": "back",
    "KEY_KPPLUS": "plus", "KEY_KPMINUS": "minus",
    "KEY_KPASTERISK": "asterisk", "KEY_KPSLASH": "slash",
    "KEY_KPDOT": "dot", "KEY_DOT": "dot", "KEY_DELETE": "dot",
}


@dataclass
class Keypad:
    device_path: str

    async def actions(self) -> AsyncIterator[str]:
        from evdev import InputDevice, categorize, ecodes
        device = InputDevice(self.device_path)
        async for event in device.async_read_loop():
            if event.type != ecodes.EV_KEY:
                continue
            key = categorize(event)
            if key.keystate != key.key_down:
                continue
            names = key.keycode if isinstance(key.keycode, list) else [key.keycode]
            # KEY_NUMLOCK is intentionally absent: it is always a dead application key.
            action = next((KEY_ACTIONS[name] for name in names if name in KEY_ACTIONS), None)
            if action:
                yield action

