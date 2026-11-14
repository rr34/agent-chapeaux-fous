"""MPU-6050 conversion and a deliberately relative yaw visualization."""

from dataclasses import dataclass
from math import atan2, degrees, sqrt
from time import monotonic


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

    def display_text(self, yaw: float) -> str:
        """Render the six motion channels and their orientation interpretation."""
        rows = [
            f"AX {self.accel_x:+.3f} g",
            f"AY {self.accel_y:+.3f} g",
            f"AZ {self.accel_z:+.3f} g",
            f"GX {self.gyro_x:+.2f} deg/s",
            f"GY {self.gyro_y:+.2f} deg/s",
            f"GZ {self.gyro_z:+.2f} deg/s",
            f"ROLL {self.roll:+.1f} deg",
            f"PITCH {self.pitch:+.1f} deg",
            f"YAW {yaw:+.1f} deg",
        ]
        if self.temperature_c is not None:
            rows.append(f"TEMP {self.temperature_c:+.1f} C")
        rows.append("+ TO REFRESH")
        return "\n".join(rows)


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

