import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from time_v3_node.app import MOTION_REFRESH_SECONDS, NodeApplication
from time_v3_node.document import LcdDocument, LcdLink, wrap_text
from time_v3_node.hardware import KEY_ACTIONS
from time_v3_node.menu import Menu
from time_v3_node.motion import GyroscopeBias, MotionSample, RelativeOrientation


class DocumentTests(unittest.TestCase):
    def test_text_wraps_at_twenty_cells(self):
        self.assertEqual(wrap_text("A message that wraps cleanly."), ["A message that wraps", "cleanly."])

    def test_long_word_hard_wraps(self):
        self.assertEqual(wrap_text("abcdefghijklmnopqrstuvwxyz"), ["abcdefghijklmnopqrst", "uvwxyz"])

    def test_link_reserves_the_twentieth_cell_for_the_arrow(self):
        link = LcdLink("nineteen characters!", "page:2")
        self.assertEqual(link.row(), "nineteen characters>")
        self.assertEqual(len(link.row()), 20)

    def test_viewport_is_always_twenty_by_four(self):
        viewport = LcdDocument("one\ntwo\nthree\nfour\nfive").viewport(1)
        self.assertEqual(viewport.offset, 1)
        self.assertEqual(len(viewport.rows), 4)
        self.assertTrue(all(len(row) == 20 for row in viewport.rows))


class MenuAndMotionTests(unittest.TestCase):
    def test_flat_menu_wraps(self):
        menu = Menu()
        menu.move(-1)
        self.assertEqual(menu.current, "Device status")
        self.assertTrue(all(len(row) == 20 for row in menu.rows()))

    def test_relative_yaw_begins_at_zero(self):
        orientation = RelativeOrientation()
        sample = MotionSample(0, 0, 1, 0, 0, 10)
        self.assertEqual(orientation.update(sample, 5)[2], 0)
        self.assertEqual(orientation.update(sample, 6)[2], 10)
        orientation.zero()
        self.assertEqual(orientation.update(sample, 9)[2], 0)

    def test_motion_display_has_four_complete_pages(self):
        sample = MotionSample(0.1, -0.2, 1.0, 2.0, -3.0, 4.0, 22.5)
        pages = [sample.display_page(index, 5.0) for index in range(4)]
        self.assertEqual([page[0] for page in pages], [
            "ACCELERATION 1/4", "GYROSCOPE 2/4", "ORIENTATION 3/4", "TEMPERATURE 4/4",
        ])
        self.assertEqual([row[:2] for row in pages[0][1:]], ["AX", "AY", "AZ"])
        self.assertEqual([row[:2] for row in pages[1][1:]], ["GX", "GY", "GZ"])
        self.assertTrue(pages[2][3].startswith("YAW "))
        self.assertFalse(any(token in row for page in pages for row in page
            for token in (" HOME", "=ZERO", "CHANGE PAGE")))
        self.assertTrue(all(len(page) == 4 and all(len(row) <= 20 for row in page) for page in pages))

    def test_stationary_gyro_bias_is_removed_from_all_three_axes(self):
        calibration = GyroscopeBias()
        calibration.calibrate([
            MotionSample(0, 0, 1, 0.4, -0.2, 0.6),
            MotionSample(0, 0, 1, 0.6, 0.0, 0.4),
        ])
        corrected = calibration.apply(MotionSample(0, 0, 1, 0.5, -0.1, 0.5))
        self.assertAlmostEqual(corrected.gyro_x, 0)
        self.assertAlmostEqual(corrected.gyro_y, 0)
        self.assertAlmostEqual(corrected.gyro_z, 0)

    def test_numbers_do_not_navigate_and_zero_is_a_sensor_action(self):
        self.assertNotIn("home", KEY_ACTIONS.values())
        self.assertNotIn("KEY_KP5", KEY_ACTIONS)
        self.assertEqual(KEY_ACTIONS["KEY_KP0"], "zero")
        self.assertEqual(KEY_ACTIONS["KEY_BACKSPACE"], "back")
        self.assertEqual(KEY_ACTIONS["KEY_KPPLUS"], "record")
        self.assertNotIn("stop", KEY_ACTIONS.values())

    def test_motion_view_navigation_and_yaw_reset(self):
        class Display:
            def __init__(self):
                self.rows = ()

            def show(self, rows):
                self.rows = rows

        class Motion:
            def read(self):
                return MotionSample(0, 0, 1, 0, 0, 0, 21)

        display = Display()
        application = NodeApplication(display, object(), motion=Motion())
        application.menu.selected = 1
        asyncio.run(application.open_current())
        self.assertEqual(application.screen, "motion")
        self.assertTrue(display.rows[0].startswith("ACCELERATION"))
        asyncio.run(application.action("right"))
        asyncio.run(application.action("right"))
        self.assertTrue(display.rows[0].startswith("ORIENTATION"))
        application.orientation.yaw = 42
        asyncio.run(application.action("zero"))
        self.assertEqual(application.orientation.yaw, 0)
        self.assertIn("+0.0", display.rows[3])

    def test_motion_refresh_interval_is_five_hertz(self):
        self.assertEqual(MOTION_REFRESH_SECONDS, 0.2)

    def test_node_pairing_displays_code_and_persists_credential(self):
        class Display:
            def __init__(self):
                self.rows = ()

            def show(self, rows):
                self.rows = rows

        class Client:
            token = ""

            def begin_pairing(self, device_name, hardware_identifier):
                self.started_with = (device_name, hardware_identifier)
                return {"userCode": "ABCD-2345", "deviceCode": "private", "interval": 0}

            def poll_pairing(self, device_code):
                self.polled_with = device_code
                return {"pending": False, "token": "tv3n_private", "personId": 1}

        async def exercise():
            display = Display()
            client = Client()
            persisted = []
            application = NodeApplication(
                display, object(), client=client, device_name="vince-node",
                hardware_identifier="machine-id", persist_node_token=persisted.append,
            )
            application.menu.selected = 3
            await application.open_current()
            self.assertEqual(application.screen, "pairing")
            self.assertEqual(display.rows[1].strip(), "ABCD-2345")
            await application._pairing_task
            self.assertEqual(client.started_with, ("vince-node", "machine-id"))
            self.assertEqual(client.polled_with, "private")
            self.assertEqual(client.token, "tv3n_private")
            self.assertEqual(persisted, ["tv3n_private"])
            self.assertEqual(display.rows[0].strip(), "NODE LINKED")

        with patch("time_v3_node.app.asyncio.to_thread", new=AsyncMock(
            side_effect=lambda function, *arguments: function(*arguments),
        )):
            asyncio.run(exercise())

    def test_messages_choose_alphabetical_contact_and_browse_newest_to_oldest(self):
        class Display:
            def __init__(self):
                self.rows = ()

            def show(self, rows):
                self.rows = rows

        class Client:
            def recipients(self):
                return [
                    {"display_name": "Zelda", "person_id": 9},
                    {"display_name": "Alex", "person_id": 2},
                ]

            def conversation(self, person_id, limit):
                self.requested = (person_id, limit)
                return [
                    {"direction": "inbound", "body": "Newest message\nline two\nline three\nline four\nline five"},
                    {"direction": "outbound", "body": "Older message"},
                ]

        async def exercise():
            display = Display()
            client = Client()
            application = NodeApplication(display, object(), client=client)
            await application.open_current()
            self.assertEqual(application.screen, "message_contacts")
            self.assertEqual(display.rows[0].strip(), ">Alex")
            self.assertEqual(display.rows[1].strip(), "Zelda")

            await application.action("select")
            self.assertEqual(client.requested, (2, 200))
            self.assertEqual(application.screen, "message_item")
            self.assertEqual(display.rows[0].strip(), "Newest message")
            self.assertEqual(display.rows[3].strip(), "line four")
            await application.action("down")
            self.assertEqual(display.rows[0].strip(), "line two")
            self.assertEqual(display.rows[3].strip(), "line five")

            await application.action("right")
            self.assertEqual(display.rows[0].strip(), "Older message")
            await application.action("right")
            self.assertEqual(display.rows[0].strip(), "Older message")
            await application.action("left")
            self.assertEqual(display.rows[0].strip(), "Newest message")

            await application.action("back")
            self.assertEqual(application.screen, "message_contacts")
            await application.action("back")
            self.assertEqual(application.screen, "home")

        with patch("time_v3_node.app.asyncio.to_thread", new=AsyncMock(
            side_effect=lambda function, *arguments: function(*arguments),
        )):
            asyncio.run(exercise())

    def test_plus_records_reviews_and_sends_a_voice_message(self):
        class Display:
            def __init__(self):
                self.rows = ()

            def show(self, rows):
                self.rows = rows

        class Client:
            def __init__(self):
                self.sent = []

            def recipients(self):
                return [{"display_name": "Alex", "person_id": 2, "contact_id": 7}]

            def conversation(self, person_id, limit):
                if not self.sent:
                    return []
                return [{
                    "correspondence_id": 41, "direction": "outbound", "body": None,
                    "recordings": [{"duration_ms": 1000, "stream_url": "/voice"}],
                }]

            def send_voice(self, contact_id, recording):
                self.sent.append((contact_id, recording.read_bytes()))
                return {"sent_correspondence_id": 41}

        class Recorder:
            def start(self, target):
                target.write_bytes(b"OggS-test")

            def stop(self):
                return 0

        class Player:
            playing = False

            def play(self, source):
                self.source = source
                self.playing = True

            def stop(self):
                self.playing = False

        async def exercise(state_directory):
            display = Display()
            client = Client()
            application = NodeApplication(
                display, object(), client=client, recorder=Recorder(), player=Player(),
                state_directory=state_directory,
            )
            await application.open_messages()
            await application.action("select")
            await application.action("record")
            self.assertEqual(application.screen, "message_recording")
            self.assertTrue(display.rows[0].startswith("● Alex"))
            await application.action("record")
            self.assertEqual(application.screen, "message_review")
            self.assertIn("+ SEND", display.rows[2])
            await application.action("record")
            self.assertEqual(client.sent, [(7, b"OggS-test")])
            self.assertEqual(application.screen, "message_item")
            self.assertTrue(display.rows[0].startswith("→ VOICE MESSAGE"))

        with tempfile.TemporaryDirectory() as directory, patch(
            "time_v3_node.app.asyncio.to_thread", new=AsyncMock(
                side_effect=lambda function, *arguments: function(*arguments),
            ),
        ):
            asyncio.run(exercise(Path(directory)))


if __name__ == "__main__":
    unittest.main()

