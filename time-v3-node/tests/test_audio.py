import unittest

from time_v3_node.audio import parse_pcm_devices, select_audio_device


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


if __name__ == "__main__":
    unittest.main()
