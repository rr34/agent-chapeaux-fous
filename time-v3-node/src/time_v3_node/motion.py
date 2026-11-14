"""MPU-6050 conversion and a deliberately relative yaw visualization."""

from dataclasses import dataclass
from math import atan2, degrees, sqrt
from time import monotonic

MOTION_PAGE_COUNT = 4


@dataclass(frozen=True)
class MotionSample:
    accel_x: float
    accel_y: float
    accel_z: float
    gyro_x: float
    gyro_y: float
    gyro_z: float
    temperature_c: float | None = None

    @property
    def roll(self) -> float:
        return degrees(atan2(self.accel_y, self.accel_z))

    @property
    def pitch(self) -> float:
        return degrees(atan2(-self.accel_x, sqrt(self.accel_y**2 + self.accel_z**2)))

    def display_page(self, page: int, yaw: float) -> tuple[str, str, str, str]:
        """Render one complete motion page without requiring vertical scrolling."""
        selected = page % MOTION_PAGE_COUNT
        if selected == 0:
            return (
                "ACCELERATION 1/4",
                f"AX {self.accel_x:+.3f} g",
                f"AY {self.accel_y:+.3f} g",
                f"AZ {self.accel_z:+.3f} g",
            )
        if selected == 1:
            return (
                "GYROSCOPE 2/4",
                f"GX {self.gyro_x:+.2f} deg/s",
                f"GY {self.gyro_y:+.2f} deg/s",
                f"GZ {self.gyro_z:+.2f} deg/s",
            )
        if selected == 2:
            return (
                "ORIENTATION 3/4",
                f"ROLL {self.roll:+.1f} deg",
                f"PITCH {self.pitch:+.1f} deg",
                f"YAW {yaw:+.1f} 5=ZERO",
            )
        temperature = "TEMP unavailable" if self.temperature_c is None else f"TEMP {self.temperature_c:+.1f} C"
        return (
            "MOTION HELP 4/4",
            temperature,
            "4/6 CHANGE PAGE",
            "0 HOME 5 ZERO YAW",
        )


class RelativeOrientation:
    def __init__(self) -> None:
        self.yaw = 0.0
        self._last_time: float | None = None

    def update(self, sample: MotionSample, now: float | None = None) -> tuple[float, float, float]:
        instant = monotonic() if now is None else now
        if self._last_time is not None:
            self.yaw = (self.yaw + sample.gyro_z * (instant - self._last_time) + 180.0) % 360.0 - 180.0
        self._last_time = instant
        return sample.roll, sample.pitch, self.yaw

    def zero(self) -> None:
        self.yaw = 0.0
        self._last_time = None

