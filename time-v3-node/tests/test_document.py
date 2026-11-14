import unittest

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

    def test_motion_display_contains_six_channels_and_orientation(self):
        sample = MotionSample(0.1, -0.2, 1.0, 2.0, -3.0, 4.0, 22.5)
        rows = sample.display_text(5.0).splitlines()
        self.assertEqual([row[:2] for row in rows[:6]], ["AX", "AY", "AZ", "GX", "GY", "GZ"])
        self.assertTrue(any(row.startswith("ROLL ") for row in rows))
        self.assertTrue(any(row.startswith("PITCH ") for row in rows))
        self.assertTrue(any(row.startswith("YAW ") for row in rows))
        self.assertTrue(all(len(row) <= 20 for row in rows))


if __name__ == "__main__":
    unittest.main()

