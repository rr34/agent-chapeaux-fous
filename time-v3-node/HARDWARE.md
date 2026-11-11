# The Time v3 Node hardware

The Time v3 Node is the Raspberry Pi hardware implementation of Time v3.
This document records its working hardware list.

## Components
**Power**, Klunoxj KL5162, 12V/24V DC to DC power converter
    - power1: Red wire 12V/24V DC input
    - power2: Black wire 12V/24V DC input
    - power3: Black  wire 5VDC output
    - power4: Yellow wire 5VDC output
**Computer**, Raspberry Pi Zero 2W
    - pi-1: micro USB power
    - pi-2: micro USB communications
    - pi-3: micro HDMI
    - pi-pinout-1: 3.3V power
    - pi-pinout-2: 5V power
    - pi-pinout-3: GPIO 2, I2C SDA
    - pi-pinout-4: 5V power
    - pi-pinout-5: GPIO 3, I2C SCL
    - pi-pinout-6: GND
    - pi-pinout-7: GPIO 4, GPCLK0
    - pi-pinout-8: GPIO 14, UART TXD
    - pi-pinout-9: GND
    - pi-pinout-10: GPIO 15, UART RXD
    - pi-pinout-11: GPIO 17
    - pi-pinout-12: GPIO 18, PCM clock
    - pi-pinout-13: GPIO 27
    - pi-pinout-14: GND
    - pi-pinout-15: GPIO 22
    - pi-pinout-16: GPIO 23
    - pi-pinout-17: 3.3V power
    - pi-pinout-18: GPIO 24
    - pi-pinout-19: GPIO 10, SPI MOSI
    - pi-pinout-20: GND
    - pi-pinout-21: GPIO 9, SPI MISO
    - pi-pinout-22: GPIO 25
    - pi-pinout-23: GPIO 11, SPI SCLK
    - pi-pinout-24: GPIO 8, SPI CE0
    - pi-pinout-25: GND
    - pi-pinout-26: GPIO 7, SPI CE1
    - pi-pinout-27: GPIO 0, HAT ID_SD
    - pi-pinout-28: GPIO 1, HAT ID_SC
    - pi-pinout-29: GPIO 5
    - pi-pinout-30: GND
    - pi-pinout-31: GPIO 6
    - pi-pinout-32: GPIO 12, PWM0
    - pi-pinout-33: GPIO 13, PWM1
    - pi-pinout-34: GND
    - pi-pinout-35: GPIO 19, PCM frame sync
    - pi-pinout-36: GPIO 16, SPI CE2
    - pi-pinout-37: GPIO 26
    - pi-pinout-38: GPIO 20, PCM data in
    - pi-pinout-39: GND
    - pi-pinout-40: GPIO 21, PCM data out

- **Microphone:** Kiseer USB 2.0 Mini Microphone
    - USB-A male
- **Speakers:** USB to Audio USB Sound Card with 8Ω 5W Speaker, Driver-Free Plug and Play
    - USB-A male to audio
- **Motor:** Basic 5V motor
- **Screen:** 2004A-type screen with I2C backpack
    - screen-GND
    - screen-VCC
    - screen-SDA
    - screen-SCL

- **Temperature and humidity sensor:** Taidacent SHT30 RS485 Modbus RTU Temperature and Humidity Sensor Transmitter for PLC and DCS Room Thermocouple Monitoring
- **Accelerometer:** One module from the HiLetgo 3pcs GY-521 MPU-6050 MPU6050 3 Axis Accelerometer Gyroscope Module, 6 DOF 6-axis Accelerometer Gyroscope Sensor Module, 16 Bit AD Converter Data Output, IIC/I2C for Arduino package
    - accel-VCC
    - accel-GND
    - accel-SCL
    - accel-SDA
    - accel-XDA
    - accel-XCL
    - accel-AD0
    - accel-INT

- **Controllable outlets:** ELEGOO 4 Channel DC 5V Relay Module with Optocoupler for Arduino Projects
- **Timekeeping while unplugged:** Dorhea 4PCS DS3231 Real Time Clock Module RTC Clock Memory Module, 3.3V/5V for Raspberry Pi
    - ds3231-+: VCC
    - ds3231-D: SDA
    - ds3231-C: SCL
    - ds3231-NC: not connected
    - ds3231--: GND

## Outputs and connections

- **RS-485:** USB to RS485 Converter Industrial Adapter, Original FT232RL and SP485EEN
- **Headphone jack:** 5Pcs 3.5mm TRS Audio Jack PCB Adapter to 5Pin Header
- **Bluetooth:** To be determined
- **USB:** Mouse and keyboard
- **HDMI**
**USB Splitter**: Raspberry Pi SKU: 734046 Mfr Part#: SC1636 Raspberry Pi USB 3.0 Hub USB C

## Initial pin and cable connections

Pi pin numbers below are physical positions on the 40-pin header. The screen,
accelerometer, and DS3231 share the Pi's I2C bus. The accelerometer is assigned
address `0x69` so it does not conflict with the DS3231 at `0x68`.

### Shared power, ground, and I2C bus

- `pi-pinout-1` (3.3V) connects to:
    - `accel-VCC`
    - `accel-AD0` (the module's address-select pin)
    - `ds3231-+`
    - the level converter's low-voltage supply (`LV`)
- `pi-pinout-2` (5V) connects to:
    - `screen-2`
    - the level converter's high-voltage supply (`HV`)
- `pi-pinout-3` (GPIO 2, I2C SDA) connects to:
    - `accel-SDA`
    - `ds3231-D`
    - the level converter's low-voltage SDA (`LV-SDA` or `LV1`)
- `pi-pinout-5` (GPIO 3, I2C SCL) connects to:
    - `accel-SCL`
    - `ds3231-C`
    - the level converter's low-voltage SCL (`LV-SCL` or `LV2`)
- `pi-pinout-6` (GND) connects to:
    - `accel-GND`
    - `ds3231--`
    - `screen-1`
    - the level converter's ground

The listed power and ground connections may use a shared distribution rail.
Pins 1, 2, 3, 5, and 6 must retain their stated voltages and signals.

### Screen through the bidirectional I2C level converter

The PCF8574T screen backpack is powered at 5V. Its SDA and SCL lines must not
connect directly to the Pi's 3.3V GPIO pins.

- Level converter high-voltage SDA (`HV-SDA` or `HV1`) connects to `screen-3`.
- Level converter high-voltage SCL (`HV-SCL` or `HV2`) connects to `screen-4`.
- `screen-2` connects to 5V at `pi-pinout-2`.
- `screen-1` connects to the common ground at `pi-pinout-6`.

Use a bidirectional, open-drain-compatible I2C level converter, such as a
BSS138-based module. An ordinary unidirectional logic converter or resistor
divider is not suitable for SDA.

### Accelerometer pins not required initially

- Leave `accel-XDA` and `accel-XCL` disconnected; they are the MPU-6050's
  auxiliary I2C bus.
- Leave `accel-INT` disconnected while the software polls the sensor. It may
  later connect to an unused GPIO if interrupt-driven sampling is required.
- Connecting `accel-AD0` to 3.3V selects I2C address `0x69`.

### DS3231 pins not required initially

- Leave `ds3231-NC` disconnected.

### USB audio connections

- Power the Pi through `pi-1`, its dedicated micro-USB power connector.
- Connect the powered USB hub's upstream USB plug through a micro-USB OTG
  adapter to `pi-2`, the Pi's micro-USB communications port.
- Power the USB hub through the hub's USB-C power input.
- Connect the Kiseer microphone's USB-A plug to one downstream hub port.
- Connect the USB sound card/speaker's USB-A plug to another downstream hub
  port.
- Do not connect either USB audio device to the GPIO header.
