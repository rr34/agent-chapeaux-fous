"""NetworkManager-backed Wi-Fi discovery and connection for the appliance UI."""

from __future__ import annotations

from dataclasses import dataclass
import subprocess


@dataclass(frozen=True)
class WifiNetwork:
    ssid: str
    signal: int = 0
    secured: bool = True
    connected: bool = False


def _escaped_fields(line: str) -> list[str]:
    fields = []
    current = []
    escaped = False
    for character in line:
        if escaped:
            current.append(character)
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == ":":
            fields.append("".join(current))
            current = []
        else:
            current.append(character)
    if escaped:
        current.append("\\")
    fields.append("".join(current))
    return fields


def parse_nmcli_networks(output: str) -> list[WifiNetwork]:
    """Parse terse nmcli rows, retaining the strongest copy of each visible SSID."""
    networks: dict[str, WifiNetwork] = {}
    for line in output.splitlines():
        fields = _escaped_fields(line)
        if len(fields) != 4 or not fields[1]:
            continue
        active, ssid, signal, security = fields
        try:
            strength = int(signal)
        except ValueError:
            strength = 0
        candidate = WifiNetwork(
            ssid=ssid,
            signal=strength,
            secured=security.strip() not in {"", "--"},
            connected=active.strip() in {"*", "yes"},
        )
        previous = networks.get(ssid)
        if previous is None or candidate.connected or candidate.signal > previous.signal:
            networks[ssid] = candidate
    return sorted(networks.values(), key=lambda network: (
        not network.connected, -network.signal, network.ssid.casefold(),
    ))


class NetworkManagerWifi:
    def __init__(self, executable: str = "nmcli") -> None:
        self.executable = executable

    def scan(self) -> list[WifiNetwork]:
        result = subprocess.run(
            [self.executable, "--terse", "--fields", "IN-USE,SSID,SIGNAL,SECURITY",
             "device", "wifi", "list", "--rescan", "yes"],
            check=True, capture_output=True, text=True, timeout=20,
        )
        return parse_nmcli_networks(result.stdout)

    def connect(self, network: WifiNetwork, password: str = "") -> None:
        command = [self.executable, "--wait", "30"]
        input_text = None
        if network.secured:
            # --ask reads the secret from stdin, keeping it out of the process list.
            command.append("--ask")
            input_text = f"{password}\n"
        command.extend(["device", "wifi", "connect", network.ssid])
        subprocess.run(
            command, check=True, capture_output=True, text=True,
            input=input_text, timeout=35,
        )
