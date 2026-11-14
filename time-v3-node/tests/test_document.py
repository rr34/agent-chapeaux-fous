import asyncio
import unittest

from time_v3_node.app import MOTION_REFRESH_SECONDS, NodeApplication
from time_v3_node.document import LcdDocument, LcdLink, wrap_text
from time_v3_node.menu import Menu
from time_v3_node.motion import MotionSample, RelativeOrientation


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
            "ACCELERATION 1/4", "GYROSCOPE 2/4", "ORIENTATION 3/4", "MOTION HELP 4/4",
        ])
        self.assertEqual([row[:2] for row in pages[0][1:]], ["AX", "AY", "AZ"])
        self.assertEqual([row[:2] for row in pages[1][1:]], ["GX", "GY", "GZ"])
        self.assertTrue(pages[2][3].startswith("YAW "))
        self.assertTrue(all(len(page) == 4 and all(len(row) <= 20 for row in page) for page in pages))

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
        asyncio.run(application.action("select"))
        self.assertEqual(application.orientation.yaw, 0)
        self.assertIn("+0.0", display.rows[3])

    def test_motion_refresh_interval_is_five_hertz(self):
        self.assertEqual(MOTION_REFRESH_SECONDS, 0.2)


if __name__ == "__main__":
    unittest.main()

