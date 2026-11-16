import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from time_v3_node.audio import (
    OpusRecorder,
    VOICE_MESSAGE_MAX_SECONDS,
    parse_pcm_devices,
    select_audio_device,
)


PCM_FIXTURE = """
00-00: vc4-hdmi-0 : MAI PCM i2s-hifi-0 : playback 1
01-00: USB Audio : USB Audio : capture 1
02-00: USB Audio : USB Audio : playback 1 : capture 1
"""


class AudioDiscoveryTests(unittest.TestCase):
    def test_capture_prefers_the_usb_capture_only_microphone(self):
        devices = parse_pcm_devices(PCM_FIXTURE)
        self.assertEqual(select_audio_device("capture", devices=devices), "plughw:1,0")

    def test_playback_prefers_usb_over_hdmi_and_capture_only_devices(self):
        devices = parse_pcm_devices(PCM_FIXTURE)
        self.assertEqual(select_audio_device("playback", devices=devices), "plughw:2,0")

    def test_discovery_uses_capabilities_after_card_numbers_change(self):
        devices = parse_pcm_devices("""
03-00: USB Audio : USB Audio : playback 1 : capture 1
07-00: USB Audio : USB Audio : capture 1
""")
        self.assertEqual(select_audio_device("capture", devices=devices), "plughw:7,0")
        self.assertEqual(select_audio_device("playback", devices=devices), "plughw:3,0")

    def test_explicit_recovery_override_is_preserved(self):
        self.assertEqual(select_audio_device("capture", "plughw:CARD=Mic,DEV=0", []),
                         "plughw:CARD=Mic,DEV=0")

    def test_recorder_enforces_the_maximum_duration_in_ffmpeg(self):
        process = Mock()
        process.poll.return_value = None
        with TemporaryDirectory() as directory:
            target = Path(directory) / "voice.ogg"
            with patch("time_v3_node.audio.select_audio_device", return_value="plughw:1,0"), \
                    patch("time_v3_node.audio.subprocess.Popen", return_value=process) as popen, \
                    patch("time_v3_node.audio.time.sleep"):
                OpusRecorder().start(target)
        command = popen.call_args.args[0]
        duration_option = command.index("-t")
        self.assertEqual(command[duration_option + 1], str(VOICE_MESSAGE_MAX_SECONDS))

    def test_recorder_stops_ffmpeg_gracefully_and_verifies_the_ogg(self):
        class Stdin:
            def __init__(self):
                self.written = b""

            def write(self, value):
                self.written += value

            def flush(self):
                pass

            def close(self):
                pass

        process = Mock()
        process.stdin = Stdin()
        process.poll.return_value = None
        process.wait.return_value = 0
        with TemporaryDirectory() as directory:
            target = Path(directory) / "voice.ogg"
            target.write_bytes(b"OggS-test")
            recorder = OpusRecorder()
            recorder._process = process
            recorder._target = target
            with patch("time_v3_node.audio.subprocess.run", return_value=Mock(
                returncode=0, stdout="1.0\n", stderr="",
            )):
                self.assertEqual(recorder.stop(), 0)
        self.assertEqual(process.stdin.written, b"q\n")


if __name__ == "__main__":
    unittest.main()
