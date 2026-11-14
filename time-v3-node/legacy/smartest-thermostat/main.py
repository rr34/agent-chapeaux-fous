import time, datetime, os, csv
import modbus, weather_calcs
from RPLCD.i2c import CharLCD

# modbus.find_devices()

# modbus.write_value(1, 40104, 1)

# print('\nLoop starting...')

sensor_dict = {}
sensor_dict[0x01] = 'Attic Middle'
sensor_dict[0x02] = 'Attic Peak Vent'
sensor_dict[0x03] = 'Outside (Soffit)'
sensor_dict[0x04] = 'Attic Over Bthrm'

columns = ['Time']
for key, value in sensor_dict.items():
    idstr = str(key) + ' ' + value + ' '
    columns.append(idstr + 'deg C')
    columns.append(idstr + 'RH')
    columns.append(idstr + 'dewpoint C')
    columns.append(idstr + 'spread C')
    columns.append(idstr + 'deg F')
    columns.append(idstr + 'dewpoint F')
    columns.append(idstr + 'spread F')

ISO8601_datetime_format = "%Y-%m-%dT%H:%M:%SZ" # ISO 8601
time_str = datetime.datetime.now(datetime.timezone.utc).strftime(ISO8601_datetime_format)

output_filename = 'output ' + time_str + '.csv'
output_dir = os.path.join(os.getcwd(), 'output')
output_fullpath = os.path.join(output_dir, output_filename)


with open(output_fullpath, 'w', newline='') as csvfile:
    rowwriter = csv.writer(csvfile, delimiter=',')
    rowwriter.writerow(columns)


while True:
    time_str = datetime.datetime.now(datetime.timezone.utc).strftime(ISO8601_datetime_format)
    print(time_str)
    col_i = 0
    row = [time_str]
    display_strs = []
    for key, value in sensor_dict.items():
        # temp_humidity = modbus.read_temphumidity_1(mb_address=key)
        
        # ---------------------------------------------------------------------------------
        if key == 0x01:
            temp_humidity = [29.5, 30.0] # example test data
        elif key == 0x02:
            temp_humidity = [27.5, 30.0] # example test data
        elif key == 0x03:
            temp_humidity = False # example test data
        elif key == 0x04:
            temp_humidity = [27.5, 45.0] # example test data
        # ---------------------------------------------------------------------------------

        if isinstance(temp_humidity, list):
            temp_C = temp_humidity[0]
            RH = temp_humidity[1]
            DP_C = weather_calcs.dewpoint(temp_C, RH)
            temp_F = weather_calcs.CtoF(temp_C)
            DP_F = weather_calcs.CtoF(DP_C)
            display_str = value + '\n' + f'{round(temp_F)}F RH{round(RH)}% DP{round(DP_F)}F' # temp 4 digits + RH 5 digits + dewpoint 5 digits + 2 spaces
            spread_C = temp_C - DP_C
            spread_F = temp_F - DP_F

            row.append(round(temp_C,2))
            row.append(round(RH,2))
            row.append(round(DP_C,2))
            row.append(round(spread_C,2))
            row.append(round(temp_F,2))
            row.append(round(DP_F,2))
            row.append(round(spread_F,2))
        else:
            display_str = value + '\n' + 'Failed to read.'
            row.append('false')
            row.append('false')
            row.append('false')
            row.append('false')
            row.append('false')
            row.append('false')
            row.append('false')
        
        col_i += 7
        display_strs.append(display_str)

    with open(output_fullpath, 'a', newline='') as csvfile:
        rowwriter = csv.writer(csvfile, delimiter=',')
        rowwriter.writerow(row)

    lcd_output = CharLCD(i2c_expander='PCF8574', address=0x27, port=1, cols=16, rows=2, dotsize=8, charmap='A02', auto_linebreaks=True, backlight_enabled=True)
    display_iterations = 3
    for i in range(display_iterations):
        display_strlist = time_str.split('T')
        lcd_output.clear()
        lcd_output.write_string(display_strlist[0])
        lcd_output.cursor_pos = (1,0)
        lcd_output.write_string(display_strlist[1])
        time.sleep(5)
        for ds in display_strs:
            display_strlist = ds.split('\n')
            lcd_output.clear()
            lcd_output.write_string(display_strlist[0])
            lcd_output.cursor_pos = (1,0)
            lcd_output.write_string(display_strlist[1])
            time.sleep(5)
    lcd_output.clear()
    lcd_output.write_string('Rereading...')
