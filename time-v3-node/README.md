# Time v3 Node software

This directory owns the headless Raspberry Pi Zero 2 W appliance described by
`HARDWARE.md`. That hardware document is the only hardware and pinout authority.

The first software slice provides one flat keypad menu, the canonical 20×4
text-and-link renderer, Time v3 message reading, MPU-6050 motion display, and
Ogg/Opus recording support. Every process start returns to the top of the root
menu; navigation state is deliberately not restored.

The motion view refreshes five times per second and has four fixed pages. Use
keypad `4` and `6` to move between acceleration, gyroscope, orientation, and
temperature/help. Keypad `5` resets relative yaw to zero, and `0` returns home.

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

## Manual WSL-to-Pi updates

Keep the repository in WSL as the source of truth. Do not make an independent
clone or edit a separate source tree on the Pi. The Pi receives a staged copy
of only this directory, while its device configuration remains outside the
deployment at `/etc/time-v3-node.env`.

The examples below use the Pi's numeric LAN address because WSL may not resolve
the Pi's `.local` mDNS name. Replace `192.168.1.X` with the current address, or
replace the target with a working SSH alias.

### Test and stage from WSL

Run from the repository root in WSL:

```sh
cd ~/code/agent-chapeaux-fous

PYTHONPATH=time-v3-node/src \
  python3 -m unittest discover \
  -s time-v3-node/tests \
  -v

rsync -av \
  --exclude='.venv/' \
  --exclude='__pycache__/' \
  time-v3-node/ \
  nate@192.168.1.X:~/time-v3-node-stage/
```

This intentionally does not use `--delete`. A normal update overwrites changed
files without risking the virtual environment or future device state. If a
source file is intentionally removed, inspect and remove that exact obsolete
file separately.

### Promote and verify on the Pi

Connect from WSL:

```sh
ssh nate@192.168.1.X
```

Then run on the Pi:

```sh
sudo rsync -a \
  --exclude='.venv/' \
  ~/time-v3-node-stage/ \
  /opt/time-v3-node/

sudo chown -R timev3:timev3 /opt/time-v3-node

sudo -u timev3 \
  /opt/time-v3-node/.venv/bin/pip install \
  -e '/opt/time-v3-node[hardware]'

sudo -u timev3 \
  /opt/time-v3-node/.venv/bin/python \
  -m unittest discover \
  -s /opt/time-v3-node/tests \
  -v
```

The editable installation means ordinary Python source changes take effect on
the next process start. Re-running `pip install` every time is harmless and
also applies a changed `pyproject.toml` or dependency set. If installation or
tests fail, do not restart or reboot the node; correct the update and repeat
these steps first.

### Refresh systemd and restart

After the Pi tests pass, run on the Pi:

```sh
sudo install -m 0644 \
  /opt/time-v3-node/systemd/time-v3-node.service \
  /etc/systemd/system/time-v3-node.service

sudo systemctl daemon-reload
sudo systemctl restart time-v3-node.service

systemctl status time-v3-node.service --no-pager
sudo journalctl -u time-v3-node.service -n 50 --no-pager
```

Reinstalling the unit and reloading systemd are safe when it has not changed
and ensure that service changes are never accidentally omitted. The persistent
LCD address, keypad path, server URL, and private node credential are not part
of this copy and must never be committed. The currently assembled node was
observed at LCD address `0x27`, MPU-6050 address `0x69`, RTC address `0x68`,
and keypad path `/dev/input/by-id/usb-13ba_0001-event-kbd`.

