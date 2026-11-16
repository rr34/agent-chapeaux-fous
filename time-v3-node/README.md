# Time v3 Node software

This directory owns the headless Raspberry Pi Zero 2 W appliance described by
`HARDWARE.md`. That hardware document is the only hardware and pinout authority.

The first software slice provides one flat keypad menu, the canonical 20×4
text-and-link renderer, Time v3 message reading, MPU-6050 motion display, and
Ogg/Opus recording support. Every process start returns to the top of the root
menu; navigation state is deliberately not restored.

Messages opens the approved Time v3 contacts in alphabetical order. Enter or
right opens the selected contact at the most recent message. Right moves toward
older messages, left moves back toward newer messages, and up/down scrolls a
long current message. The message body uses all four display rows; direction and
contact are intentionally not repeated on that content screen. Backspace first
returns to the contact list and then to the root menu. Sent and received
messages share the same history.

Within a conversation, `+` starts voice recording and the same key stops it.
The LCD uses a recording-dot glyph and elapsed time rather than spelling
"recording." The stopped recording is reviewed before delivery: Enter plays or
stops it, `+` sends it, and Backspace discards it. The code-owned one-minute
limit stops into review and never sends automatically. Incoming and outgoing
voice messages use left and right arrow glyphs; Enter plays or stops the
selected message. Navigation stops playback.

The motion view refreshes five times per second and has four fixed pages. The
keypad's left and right arrow keys move between acceleration, gyroscope,
orientation, and temperature. Backspace returns toward the root menu. Number
keys are not navigation controls. On the gyroscope page, `0` samples the
stationary sensor for about one second and subtracts the resulting three-axis
bias. On the orientation page, `0` resets relative yaw to zero. The MPU-6050
has no magnetometer, so yaw remains relative and will still accumulate some
residual drift after calibration.

## Headless Wi-Fi workflow

Use Raspberry Pi Imager during the one-time SD-card setup to configure Wi-Fi,
the host name, user, and SSH. After the Pi first joins Wi-Fi, ordinary coding,
installation, logs, and service management can happen over SSH. HDMI and a full
keyboard remain recovery tools rather than normal UI requirements.

The root menu's **Wi-Fi setup** item scans visible networks through
NetworkManager. A `*` beside an SSID means connected and a `+` means secured.
Select a network with the normal up/down keys and Enter. For a secured network,
type an alphabet position from `1` through `26`, then press `+` for uppercase or
`-` for lowercase. Press `*` to commit pending digits literally, `/` to choose a
symbol, Backspace to edit, and Enter to connect. The entered password remains
visible on the LCD. Values outside `1` through `26` are numeric-only: `+` and `-` do
nothing until Backspace returns the value to the letter range or `*` commits it.
The Num Lock key is deliberately ignored; its LED state is not an input mode.

The service account needs the checked-in narrow NetworkManager policy. Install
it during deployment before restarting the service:

```sh
sudo install -m 0644 \
  /opt/time-v3-node/polkit/60-time-v3-node-wifi.rules \
  /etc/polkit-1/rules.d/60-time-v3-node-wifi.rules
```

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
TIMEV3_SERVER_URL=https://agent.timev3tech.com
```

Microphone and speaker selection defaults to `auto`. On every recording or
playback, the node reads the current ALSA capabilities rather than retaining a
USB card number: capture prefers a USB capture-only device, and playback
prefers a USB playback-capable device. Moving either device to another USB port
therefore requires no configuration. Recovery overrides remain available as
`TIMEV3_AUDIO_INPUT` and `TIMEV3_AUDIO_OUTPUT`, each accepting an ALSA device
such as `plughw:1,0`.

Replace `0xNN` with the LCD backpack address observed on the assembled hardware;
`HARDWARE.md` does not currently declare that address, so the software does not
guess it. The MPU-6050 address is `0x69` as declared there. The keypad adapter
ignores Num Lock and accepts both numeric and navigation key codes, so either
reported Num Lock form produces the same actions.

## Pair a node with an account

Pairing requires `TIMEV3_SERVER_URL`, but it does not require a token in the
environment file. After deploying the current source and systemd unit:

1. On the node, use the arrow keys and Enter to open **Pair node**. The LCD
   displays a short code for ten minutes.
2. Sign in at `https://agent.timev3tech.com/login`. Open **Account**, then
   **Agent identities**, and find **Node devices** for the currently selected
   Agent identity.
3. Enter the LCD code in **Pairing code** and select **Approve node**. The node
   detects approval automatically and changes to **NODE LINKED**.

The node credential is written with mode `0600` to
`/var/lib/time-v3-node/node-token`. The systemd unit creates and preserves that
private state directory, so normal WSL-to-Pi source updates do not replace the
credential. Do not copy the token into Git. `TIMEV3_NODE_TOKEN` remains
available as an explicit environment override for recovery or diagnostics.

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
LCD address, keypad path, and server URL are not part of this copy. The private
node credential is also outside the copy in the systemd state directory, and
must never be committed. The currently assembled node was
observed at LCD address `0x27`, MPU-6050 address `0x69`, RTC address `0x68`,
and keypad path `/dev/input/by-id/usb-13ba_0001-event-kbd`.

