"""Ogg/Opus recording through the declared USB microphone."""

import subprocess
from pathlib import Path


class OpusRecorder:
    def __init__(self, input_device: str = "default") -> None:
        self.input_device = input_device
        self._process: subprocess.Popen[bytes] | None = None

    def start(self, target: Path) -> None:
        if self._process is not None:
            raise RuntimeError("A recording is already active")
        target.parent.mkdir(parents=True, exist_ok=True)
        self._process = subprocess.Popen([
            "ffmpeg", "-nostdin", "-loglevel", "error", "-f", "alsa",
            "-i", self.input_device, "-ac", "1", "-ar", "16000",
            "-c:a", "libopus", "-b:a", "24k", "-y", str(target),
        ])

    def stop(self) -> int:
        if self._process is None:
            return 0
        self._process.terminate()
        result = self._process.wait(timeout=10)
        self._process = None
        return result

