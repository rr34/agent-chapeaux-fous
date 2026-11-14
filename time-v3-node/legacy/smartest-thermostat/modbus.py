"""
######################################################################

Simple Modbus Sensor Polling Code
Coded By "The Intrigued Engineer" over a coffee

Minimal Modbus Library Documentation
https://minimalmodbus.readthedocs.io/en/stable/

Thanks For Watching!!!

######################################################################
"""

import minimalmodbus # Don't forget to import the library!!

 # Modbus address of sensor, should scale this 
def read_temphumidity_1(mb_address=0x01):
    sensy_boi = minimalmodbus.Instrument('/dev/ttyUSB0', mb_address)	# Make an "instrument" object called sensy_boi (port name, slave address (in decimal))

    sensy_boi.serial.baudrate = 2400				# BaudRate
    sensy_boi.serial.bytesize = 8					# Number of data bits to be requested
    sensy_boi.serial.parity = minimalmodbus.serial.PARITY_NONE	# Parity Setting here is NONE but can be ODD or EVEN
    sensy_boi.serial.stopbits = 1					# Number of stop bits
    sensy_boi.serial.timeout  = 0.5					# Timeout time in seconds
    sensy_boi.mode = minimalmodbus.MODE_RTU				# Mode to be used (RTU or ascii mode)

    # Good practice to clean up before and after each execution
    sensy_boi.clear_buffers_before_each_transaction = True
    sensy_boi.close_port_after_each_call = True

    # Uncomment this line to print out all the properties of the setup at the begining of the loop
    # print(sensy_boi) 

    # NOTE-- Register addresses are offset from 40001 so inputting register 0 in the code is actually 40001, 3 = 40004 etc...
    # Arguments - (register address, number of decimals, function code, Is the value signed or unsigned) 
    # Uncomment to run this to just get temperature data

    #single_data= sensy_boi.read_register(1, 1, 3, False) 
    #print (f"Single register data = {single_data}")

    # Get list of values from MULTIPLE registers 
    # Arguments - (register start address, number of registers to read, function code)
    # Example of reading SINGLE register
    # start address starts at standard offset of 40001, so 0 is 40001
    # each register can handle values from 0x0000 to 0xFFFF
    offset_correction = -40001
    try:
        data = sensy_boi.read_registers(offset_correction + 40001, 2, 3)
        # print(f"Raw data is {[hex(datum) for datum in data]}") # Shows the raw data list for the lolz

        # temp is given 100x the actual value
        # negative values given in the form of complement, so greater than 0x8000 means negative, so subtract 0xFFFF to get the correct negative value
        if data[0] <= 0x8000:
            temperature = data[0]/100
        elif data[0] > 0x8000:
            temperature = (0xFFFF - data[0]) / 100

        humidity = data[1]/100

        # Pro-tip > \u00B0 is the unicode value for the degree symbol which you can see before the "C" in temperature
        print(f"Sensor {hex(mb_address)} Temperature = {temperature}\u00B0C")
        print(f"Sensor {hex(mb_address)} Relative Humidity = {humidity}%")
    except:
        print(f'Failed to read sensor at address {hex(mb_address)} this time.')

    # Peace of mind close out
    sensy_boi.serial.close()

    try:
        return [temperature, humidity]
    except:
        return False


def find_devices():

    device_list = []
    for mb_address in range(0x01, 0x10):
        try:
            sensy_boi = minimalmodbus.Instrument('/dev/ttyUSB0', mb_address)	# Make an "instrument" object called sensy_boi (port name, slave address (in decimal))

            sensy_boi.serial.baudrate = 9600				# BaudRate
            sensy_boi.serial.bytesize = 8					# Number of data bits to be requested
            sensy_boi.serial.parity = minimalmodbus.serial.PARITY_NONE	# Parity Setting here is NONE but can be ODD or EVEN
            sensy_boi.serial.stopbits = 1					# Number of stop bits
            sensy_boi.serial.timeout  = 0.5					# Timeout time in seconds
            sensy_boi.mode = minimalmodbus.MODE_RTU				# Mode to be used (RTU or ascii mode)

            # Good practice to clean up before and after each execution
            sensy_boi.clear_buffers_before_each_transaction = True
            sensy_boi.close_port_after_each_call = True

            # read registers 40001 + 100 = 40101 to 40106
            offset_correction = -40001
            data = sensy_boi.read_registers(offset_correction + 40101, 6, 3)

            # Peace of mind close out
            sensy_boi.serial.close()
            print("Ports Now Closed")

            print("")
            print(f"Raw data is {[hex(datum) for datum in data]}") # Shows the raw data list for the lolz
            register_values = {}
            register_values['model code'] = data[0]
            register_values['total number of measuring points'] = data[1]
            register_values['device address'] = data[2]
            register_values['baud rate'] = data[3]
            register_values['communication mode'] = data[4]
            register_values['protocol type'] = data[5]

            for key, value in register_values.items():
                print(key + ': ' + hex(value))
            device_list.append(register_values)

        except:
            print(f"No device found at address: {hex(mb_address)}")

    try:
        return register_values
    except:
        return False


def write_value(sensor_address, register_number, value_towrite):
    sensy_boi = minimalmodbus.Instrument('/dev/ttyUSB0', sensor_address)	# Make an "instrument" object called sensy_boi (port name, slave address (in decimal))

    sensy_boi.serial.baudrate = 2400				# BaudRate
    sensy_boi.serial.bytesize = 8					# Number of data bits to be requested
    sensy_boi.serial.parity = minimalmodbus.serial.PARITY_NONE	# Parity Setting here is NONE but can be ODD or EVEN
    sensy_boi.serial.stopbits = 1					# Number of stop bits
    sensy_boi.serial.timeout  = 0.5					# Timeout time in seconds
    sensy_boi.mode = minimalmodbus.MODE_RTU				# Mode to be used (RTU or ascii mode)

    # Good practice to clean up before and after each execution
    sensy_boi.clear_buffers_before_each_transaction = True
    sensy_boi.close_port_after_each_call = True

    ## Uncomment this line to print out all the properties of the setup at the begining of the loop
    # print(sensy_boi) 

    print("")
    print("Writing new address to sensor ...")	# Makes it look cool...

    offset_correction = -40001
    sensy_boi.write_register(registeraddress=offset_correction + register_number, value=value_towrite, functioncode=6)

    return