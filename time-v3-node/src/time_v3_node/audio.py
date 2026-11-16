"""Capability-based ALSA discovery, Ogg/Opus recording, and playback."""

import logging
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PcmDevice:
    card: int
    device: int
    description: str
    capture: bool
    playback: bool

    @property
    def alsa_name(self) -> str:
        return f"plughw:{self.card},{self.device}"

    @property
    def usb(self) -> bool:
        return "usb" in self.description.casefold()


def parse_pcm_devices(value: str) -> list[PcmDevice]:
    devices = []
    for raw_line in value.splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        prefix, description = line.split(":", 1)
        try:
            card_text, device_text = prefix.strip().split("-", 1)
            card = int(card_text)
            device = int(device_text)
        except (TypeError, ValueError):
            continue
        capture = "capture" in description.casefold()
        playback = "playback" in description.casefold()
        if capture or playback:
            devices.append(PcmDevice(card, device, description.strip(), capture, playback))
    return devices


def discover_pcm_devices(source: Path = Path("/proc/asound/pcm")) -> list[PcmDevice]:
    try:
        return parse_pcm_devices(source.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []


def select_audio_device(direction: str, configured: str = "auto",
                        devices: list[PcmDevice] | None = None) -> str:
    explicit = configured.strip()
    if explicit and explicit.casefold() != "auto":
        return explicit
    candidates = discover_pcm_devices() if devices is None else devices
    if direction == "capture":
        available = [device for device in candidates if device.capture]
        available.sort(key=lambda device: (
            device.usb, device.capture and not device.playback, -device.card, -device.device,
        ), reverse=True)
    elif direction == "playback":
        available = [device for device in candidates if device.playback]
        available.sort(key=lambda device: (
            device.usb, device.playback and not device.capture, -device.card, -device.device,
        ), reverse=True)
    else:
        raise ValueError("Audio direction must be capture or playback")
    if not available:
        raise RuntimeError(f"No ALSA {direction} device is available")
    return available[0].alsa_name


class OpusRecorder:
    def __init__(self, input_device: str = "auto") -> None:
        self.input_device = input_device
        self._process: subprocess.Popen[bytes] | None = None

    def start(self, target: Path) -> None:
        if self._process is not None:
            raise RuntimeError("A recording is already active")
        target.parent.mkdir(parents=True, exist_ok=True)
        selected = select_audio_device("capture", self.input_device)
        logger.info("Recording voice message from ALSA device %s", selected)
        self._process = subprocess.Popen([
            "ffmpeg", "-nostdin", "-loglevel", "error", "-f", "alsa",
            "-i", selected, "-ac", "1", "-ar", "16000",
            "-c:a", "libopus", "-b:a", "24k", "-y", str(target),
        ])
        time.sleep(0.2)
        if self._process.poll() is not None:
            result = self._process.wait()
            self._process = None
            raise RuntimeError(f"The ALSA microphone {selected} could not be opened (ffmpeg exit {result})")

    def stop(self) -> int:
        if self._process is None:
            return 0
        if self._process.poll() is None:
            self._process.terminate()
        try:
            result = self._process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self._process.kill()
            result = self._process.wait(timeout=5)
        self._process = None
        return result


class AudioPlayer:
    def __init__(self, output_device: str = "auto") -> None:
        self.output_device = output_device
        self._process: subprocess.Popen[bytes] | None = None

    @property
    def playing(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def play(self, source: Path) -> None:
        self.stop()
        selected = select_audio_device("playback", self.output_device)
        logger.info("Playing voice message through ALSA device %s", selected)
        self._process = subprocess.Popen([
            "ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(source),
            "-f", "alsa", selected,
        ])
        time.sleep(0.2)
        if self._process.poll() is not None:
            result = self._process.wait()
            self._process = None
            raise RuntimeError(f"The ALSA speaker {selected} could not be opened (ffmpeg exit {result})")

    def stop(self) -> None:
        if self._process is None:
            return
        if self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=5)
        self._process = None

