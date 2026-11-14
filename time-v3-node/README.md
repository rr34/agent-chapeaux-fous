# Time v3 Node software

This directory owns the headless Raspberry Pi Zero 2 W appliance described by
`HARDWARE.md`. That hardware document is the only hardware and pinout authority.

The first software slice provides one flat keypad menu, the canonical 20×4
text-and-link renderer, Time v3 message reading, MPU-6050 motion display, and
Ogg/Opus recording support. Every process start returns to the top of the root
menu; navigation state is deliberately not restored.

## Headless Wi-Fi workflow

Use Raspberry Pi Imager during the one-time SD-card setup to configure Wi-Fi,
the host name, user, and SSH. After the Pi first joins Wi-Fi, ordinary coding,
installation, logs, and service management can happen over SSH. HDMI and a full
keyboard remain recovery tools rather than normal UI requirements.

Create a virtual environment and install the package on the Pi:

```sh
python3 -m venv .venv
.venv/bin/pip install -e '.[hardware]'
```

The node also expects `ffmpeg` for Ogg/Opus recording and Raspberry Pi I2C to be
enabled. The systemd unit is a deployment template; installing or enabling it
is a separate live-system action. Its service user needs access to the Pi's I2C,
input, and audio devices.

`/etc/time-v3-node.env` supplies:

```text
TIMEV3_LCD_ADDRESS=0xNN
TIMEV3_KEYPAD_DEVICE=/dev/input/by-id/replace-with-the-keypad
TIMEV3_SERVER_URL=https://agent.example.com
TIMEV3_NODE_TOKEN=tv3n_replace_after_pairing
```

Replace `0xNN` with the LCD backpack address observed on the assembled hardware;
`HARDWARE.md` does not currently declare that address, so the software does not
guess it. The MPU-6050 address is `0x69` as declared there. The keypad adapter
requests Num Lock on and also accepts navigation key codes, so either reported
Num Lock form produces the same actions.

## Local tests

```sh
PYTHONPATH=src python3 -m unittest discover -s tests
```

