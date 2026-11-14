import math

def CtoF(temp_C):
    return temp_C * 1.8 + 32


def CtoK(temp_C):
    return temp_C + 274.15


def dewpoint(temp_C, RH):
    # from Wikipedia Magnus formula most accurate between -40 to +50°C
    b = 17.625
    c = 243.04
    gamma_TRH = math.log(RH/100) + (b * temp_C) / (c + temp_C)
    T_dewpoint = (c * gamma_TRH) / (b - gamma_TRH)

    return T_dewpoint