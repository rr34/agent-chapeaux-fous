"""Thin adapters for only the devices declared in HARDWARE.md."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

from .motion import MotionSample


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

    def show(self, rows: tuple[str, str, str, str]) -> None:
        for index, row in enumerate(rows):
            self._lcd.cursor_pos = (index, 0)
            self._lcd.write_string(row[:20].ljust(20))


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
    "KEY_KP8": "up", "KEY_UP": "up",
    "KEY_KP2": "down", "KEY_DOWN": "down",
    "KEY_KP4": "left", "KEY_LEFT": "left",
    "KEY_KP6": "right", "KEY_RIGHT": "right",
    "KEY_KP5": "select", "KEY_KPENTER": "select", "KEY_ENTER": "select",
    "KEY_BACKSPACE": "back", "KEY_KP0": "home", "KEY_0": "home",
    "KEY_KPPLUS": "record", "KEY_KPDOT": "stop",
}


@dataclass
class Keypad:
    device_path: str

    async def actions(self) -> AsyncIterator[str]:
        from evdev import InputDevice, categorize, ecodes
        device = InputDevice(self.device_path)
        try:
            device.set_led(ecodes.LED_NUML, 1)
        except OSError:
            pass
        async for event in device.async_read_loop():
            if event.type != ecodes.EV_KEY:
                continue
            key = categorize(event)
            if key.keystate != key.key_down:
                continue
            names = key.keycode if isinstance(key.keycode, list) else [key.keycode]
            action = next((KEY_ACTIONS[name] for name in names if name in KEY_ACTIONS), None)
            if action:
                yield action

