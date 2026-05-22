from __future__ import annotations
"""车辆线传感器阵列模型。"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from artemis_mudri.track import ARC_LINE_WIDTH_M, OFFICIAL_ARCS, OFFICIAL_LINES


@dataclass(frozen=True)
class LineSensorArrayConfig:
    """线传感器阵列的几何与检测参数。"""

    forward_offset_m: float = 0.085
    lateral_offsets_m: tuple[float, ...] = (0.04, 0.03, 0.02, 0.01, -0.01, -0.02, -0.03, -0.04)
    error_weights: tuple[int, ...] = (-4, -3, -2, -1, 1, 2, 3, 4)
    line_half_width_m: float = 0.5 * ARC_LINE_WIDTH_M
    line_softness_m: float = 0.004
    sensor_threshold: float = 0.55


@dataclass(frozen=True)
class LineSensorArrayReading:
    """一次传感器采样结果。"""

    local_sensor_positions: NDArray[np.float64]
    world_sensor_positions: NDArray[np.float64]
    darkness: NDArray[np.float64]
    digital_values: tuple[int, ...]
    error_weights: tuple[int, ...]
    line_detected: bool
    error: float
    lateral_error_m: float | None


DEFAULT_LINE_SENSOR_ARRAY_CONFIG = LineSensorArrayConfig()


class LineSensorArray:
    """基于赛道圆弧定义的简化线传感器。"""

    def __init__(self, config: LineSensorArrayConfig | None = None) -> None:
        self.config = config or DEFAULT_LINE_SENSOR_ARRAY_CONFIG
        if len(self.config.lateral_offsets_m) != len(self.config.error_weights):
            raise ValueError("lateral_offsets_m and error_weights must have the same length")
        self._previous_error = 0.0
        # 预先生成车体系下的探头坐标，减少重复计算。
        self._local_sensor_positions = np.column_stack(
            (
                np.full(
                    len(self.config.lateral_offsets_m),
                    self.config.forward_offset_m,
                    dtype=np.float64,
                ),
                np.asarray(self.config.lateral_offsets_m, dtype=np.float64),
            )
        )

    @property
    def local_sensor_positions(self) -> NDArray[np.float64]:
        """返回传感器在车体系下的位置。"""
        return self._local_sensor_positions.copy()

    def darkness_at(self, point: NDArray[np.float64]) -> float:
        """计算某一点落在线上的“黑度”。"""
        max_darkness = 0.0
        support_radius = self.config.line_half_width_m + self.config.line_softness_m
        for segment in (*OFFICIAL_LINES, *OFFICIAL_ARCS):
            distance = segment.centerline_distance(point)
            if distance >= support_radius:
                continue
            darkness = max(0.0, 1.0 - distance / support_radius)
            max_darkness = max(max_darkness, darkness)
        return float(max_darkness)

    def sense_pose(self, x: float, y: float, yaw: float) -> LineSensorArrayReading:
        """根据车辆位姿生成一帧线传感器读数。"""
        cos_yaw = float(np.cos(yaw))
        sin_yaw = float(np.sin(yaw))
        rotation = np.array(
            [
                [cos_yaw, -sin_yaw],
                [sin_yaw, cos_yaw],
            ],
            dtype=np.float64,
        )
        origin = np.array([x, y], dtype=np.float64)
        # 将车体系下的传感器坐标旋转到世界系。
        world_sensor_positions = origin + self._local_sensor_positions @ rotation.T
        darkness = np.array(
            [self.darkness_at(point) for point in world_sensor_positions],
            dtype=np.float64,
        )
        digital = darkness >= self.config.sensor_threshold
        line_detected = bool(np.any(digital))
        lateral_error_m = None
        error = self._previous_error
        if line_detected:
            lateral_positions = self._local_sensor_positions[:, 1]
            digital_weights = digital.astype(np.float64)
            lateral_error_m = float(np.dot(digital_weights, lateral_positions) / digital_weights.sum())
            error = float(
                np.dot(digital_weights, np.asarray(self.config.error_weights, dtype=np.float64))
                / digital_weights.sum()
            )
            self._previous_error = error
        return LineSensorArrayReading(
            local_sensor_positions=self.local_sensor_positions,
            world_sensor_positions=world_sensor_positions,
            darkness=darkness,
            digital_values=tuple(int(value) for value in digital),
            error_weights=self.config.error_weights,
            line_detected=line_detected,
            error=error,
            lateral_error_m=lateral_error_m,
        )
