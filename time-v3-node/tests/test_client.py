import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError
from unittest.mock import patch

from time_v3_node.client import TimeV3Client, TimeV3RequestError


class ClientErrorTests(unittest.TestCase):
    def test_voice_upload_preserves_the_server_error_message(self):
        response = HTTPError(
            "https://agent.test/api/correspondence/timev3-voice-messages",
            400, "Bad Request", {}, io.BytesIO(b'{"error":"The voice message is not valid audio."}'),
        )
        with TemporaryDirectory() as directory:
            recording = Path(directory) / "voice.ogg"
            recording.write_bytes(b"OggS-test")
            client = TimeV3Client("https://agent.test", "private")
            with patch("time_v3_node.client.urlopen", side_effect=response):
                with self.assertRaisesRegex(
                    RuntimeError, "HTTP 400: The voice message is not valid audio",
                ):
                    client.send_voice(7, recording)

    def test_voice_upload_preserves_diagnostic_code_and_reference(self):
        response = HTTPError(
            "https://agent.test/api/correspondence/timev3-voice-messages",
            400, "Bad Request", {}, io.BytesIO(
                b'{"error":"Conversion failed.","code":"VOICE_CONVERT","reference":"A1B2C3D4"}',
            ),
        )
        with TemporaryDirectory() as directory:
            recording = Path(directory) / "voice.ogg"
            recording.write_bytes(b"OggS-test")
            client = TimeV3Client("https://agent.test", "private")
            with patch("time_v3_node.client.urlopen", side_effect=response):
                with self.assertRaises(TimeV3RequestError) as raised:
                    client.send_voice(7, recording)
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.code, "VOICE_CONVERT")
        self.assertEqual(raised.exception.reference, "A1B2C3D4")


if __name__ == "__main__":
    unittest.main()
