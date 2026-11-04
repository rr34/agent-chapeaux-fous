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
    - pi1: micro USB power
    - pi1: micro USB communications
    - pi3: micro HDMI
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
- **Motor:** Basic 5V motor
- **Screen:** 2004A-type screen
    - screen1: GND
    - screen2: VCC
    - screen3: SDA
    - screen4: SCL

- **Temperature and humidity sensor:** Taidacent SHT30 RS485 Modbus RTU Temperature and Humidity Sensor Transmitter for PLC and DCS Room Thermocouple Monitoring
- **Accelerometers:** HiLetgo 3pcs GY-521 MPU-6050 MPU6050 3 Axis Accelerometer Gyroscope Module, 6 DOF 6-axis Accelerometer Gyroscope Sensor Module, 16 Bit AD Converter Data Output, IIC/I2C for Arduino
- **Controllable outlets:** ELEGOO 4 Channel DC 5V Relay Module with Optocoupler for Arduino Projects
- **Timekeeping while unplugged:** Dorhea 4PCS DS3231 Real Time Clock Module RTC Clock Memory Module, 3.3V/5V for Raspberry Pi

## Outputs and connections

- **RS-485:** USB to RS485 Converter Industrial Adapter, Original FT232RL and SP485EEN
- **Headphone jack:** 5Pcs 3.5mm TRS Audio Jack PCB Adapter to 5Pin Header
- **Bluetooth:** To be determined
- **USB:** Mouse and keyboard
- **HDMI**
**USB Splitter**: Raspberry Pi SKU: 734046 Mfr Part#: SC1636 Raspberry Pi USB 3.0 Hub USB C