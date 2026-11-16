import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from time_v3_node.app import NodeApplication
from time_v3_node.wifi import NetworkManagerWifi, WifiNetwork, parse_nmcli_networks


class Display:
    def __init__(self):
        self.rows = ()

    def show(self, rows):
        self.rows = rows


class WifiTests(unittest.TestCase):
    def test_nmcli_parser_handles_escaped_ssids_and_deduplicates_by_strength(self):
        networks = parse_nmcli_networks(
            "*:Home\\: Upstairs:72:WPA2\n"
            ":Cafe:40:--\n"
            ":Cafe:80:--\n"
            ":Hidden:bad:WPA3\n"
        )
        self.assertEqual(networks, [
            WifiNetwork("Home: Upstairs", 72, True, True),
            WifiNetwork("Cafe", 80, False, False),
            WifiNetwork("Hidden", 0, True, False),
        ])

    def test_connection_passes_password_over_stdin_not_the_process_arguments(self):
        with patch("time_v3_node.wifi.subprocess.run") as run:
            NetworkManagerWifi().connect(WifiNetwork("Birthday", 90, True), "Secret7!")
        command = run.call_args.args[0]
        self.assertNotIn("Secret7!", command)
        self.assertIn("--ask", command)
        self.assertEqual(run.call_args.kwargs["input"], "Secret7!\n")

    def test_scan_requests_refresh_waits_and_then_reads_the_completed_results(self):
        with patch("time_v3_node.wifi.time.sleep") as sleep, \
                patch("time_v3_node.wifi.subprocess.run") as run:
            run.side_effect = [
                object(),
                type("Result", (), {"stdout": "*:Home:90:WPA2\n:Phone:80:WPA2\n"})(),
            ]
            networks = NetworkManagerWifi().scan()
        self.assertEqual(run.call_args_list[0].args[0][-3:], ["device", "wifi", "rescan"])
        self.assertEqual(run.call_args_list[1].args[0][-2:], ["--rescan", "no"])
        sleep.assert_called_once()
        self.assertEqual([network.ssid for network in networks], ["Home", "Phone"])

    def test_password_alphabet_numbers_numeric_overflow_and_symbols(self):
        display = Display()
        application = NodeApplication(display, object())
        application.wifi_networks = [WifiNetwork("Birthday", 90, True)]
        application.screen = "wifi_password"

        application.wifi_password_action("digit_2")
        application.wifi_password_action("minus")
        self.assertEqual(application.wifi_password, "b")

        application.wifi_password_action("digit_2")
        application.wifi_password_action("digit_0")
        application.wifi_password_action("plus")
        self.assertEqual(application.wifi_password, "bT")

        application.wifi_password_action("digit_2")
        application.wifi_password_action("digit_7")
        application.wifi_password_action("plus")
        self.assertEqual(application.wifi_password, "bT")
        self.assertEqual(application.wifi_pending_digits, "27")
        self.assertIn("NUMBER ONLY", display.rows[2])
        application.wifi_password_action("asterisk")
        self.assertEqual(application.wifi_password, "bT27")

        application.wifi_password_action("slash")
        self.assertEqual(application.screen, "wifi_symbol")
        application.wifi_symbol_action("digit_6")
        application.wifi_symbol_action("select")
        self.assertEqual(application.wifi_password, 'bT27!')

    def test_scan_select_and_connect_do_not_put_password_in_ui_state_after_success(self):
        class Wifi:
            def __init__(self):
                self.connected = None

            def scan(self):
                return [WifiNetwork("Birthday", 90, True)]

            def connect(self, network, password):
                self.connected = (network.ssid, password)

        async def exercise():
            display = Display()
            wifi = Wifi()
            application = NodeApplication(display, object(), wifi=wifi)
            await application.open_wifi()
            self.assertEqual(application.screen, "wifi_networks")
            await application.choose_wifi_network()
            application.wifi_password = "Secret7!"
            await application.action("select")
            self.assertEqual(wifi.connected, ("Birthday", "Secret7!"))
            self.assertEqual(application.screen, "document")
            self.assertEqual(application.wifi_password, "")
            self.assertEqual(display.rows[0].strip(), "WIFI CONNECTED")

        with patch("time_v3_node.app.asyncio.to_thread", new=AsyncMock(
            side_effect=lambda function, *arguments: function(*arguments),
        )):
            asyncio.run(exercise())


if __name__ == "__main__":
    unittest.main()
