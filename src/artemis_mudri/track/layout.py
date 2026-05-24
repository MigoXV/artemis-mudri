from __future__ import annotations
"""赛道静态布局与关键锚点定义。"""

from dataclasses import dataclass
from math import atan2, degrees

import numpy as np
from numpy.typing import NDArray

from artemis_mudri.track.sampling import sample_arc
from artemis_mudri.track.path import FloatArray

FIELD_WIDTH_M = 2.2
FIELD_HEIGHT_M = 1.2
ARC_RADIUS_M = 0.4
ARC_LINE_WIDTH_M = 0.018

ANCHORS: dict[str, FloatArray] = {
    "A": np.array([0.6, 1.0], dtype=np.float64),
    "B": np.array([1.6, 1.0], dtype=np.float64),
    "C": np.array([1.6, 0.2], dtype=np.float64),
    "D": np.array([0.6, 0.2], dtype=np.float64),
}

LEFT_CENTER = np.array([0.6, 0.6], dtype=np.float64)
RIGHT_CENTER = np.array([1.6, 0.6], dtype=np.float64)
CENTER_POINTS: dict[str, FloatArray] = {
    "left_center": LEFT_CENTER,
    "right_center": RIGHT_CENTER,
}


@dataclass(frozen=True)
class ArenaLine:
    """赛道中的一段标准直线。"""

    name: str
    start: FloatArray
    end: FloatArray

    def sample(self, resolution: float) -> NDArray[np.float64]:
        """将直线离散为路径点。"""
        from artemis_mudri.track.sampling import sample_line

        return sample_line(self.start, self.end, resolution)

    def centerline_distance(self, point: FloatArray) -> float:
        """计算点到线段中心线的距离。"""
        segment = self.end - self.start
        segment_length_sq = float(np.dot(segment, segment))
        if segment_length_sq <= 0.0:
            return float(np.linalg.norm(point - self.start))
        t = float(np.clip(np.dot(point - self.start, segment) / segment_length_sq, 0.0, 1.0))
        projection = self.start + t * segment
        return float(np.linalg.norm(point - projection))


@dataclass(frozen=True)
class ArenaArc:
    """赛道中的一段标准圆弧。"""
    name: str
    center: FloatArray
    radius: float
    start_angle_deg: float
    end_angle_deg: float

    def sample(self, resolution: float) -> NDArray[np.float64]:
        """将圆弧离散为路径点。"""
        return sample_arc(
            center=self.center,
            radius=self.radius,
            start_angle_deg=self.start_angle_deg,
            end_angle_deg=self.end_angle_deg,
            resolution=resolution,
        )

    def contains_angle_deg(self, angle_deg: float) -> bool:
        """判断角度是否落在圆弧扫过范围内。"""
        normalized_angle = angle_deg % 360.0
        sweep = self.end_angle_deg - self.start_angle_deg
        if sweep >= 0.0:
            span = sweep % 360.0
            progress = (normalized_angle - (self.start_angle_deg % 360.0)) % 360.0
        else:
            span = (-sweep) % 360.0
            progress = ((self.start_angle_deg % 360.0) - normalized_angle) % 360.0
        return progress <= span + 1e-9

    def centerline_distance(self, point: FloatArray) -> float:
        """计算点到圆弧中心线的距离。"""
        delta = point - self.center
        angle_deg = degrees(atan2(float(delta[1]), float(delta[0])))
        if not self.contains_angle_deg(angle_deg):
            return float("inf")
        return abs(float(np.linalg.norm(delta)) - self.radius)


OFFICIAL_ARCS = (
    ArenaArc(
        name="left_arc",
        center=LEFT_CENTER,
        radius=ARC_RADIUS_M,
        start_angle_deg=90.0,
        end_angle_deg=270.0,
    ),
    ArenaArc(
        name="right_arc",
        center=RIGHT_CENTER,
        radius=ARC_RADIUS_M,
        start_angle_deg=90.0,
        end_angle_deg=-90.0,
    ),
)

OFFICIAL_LINES: tuple[ArenaLine, ...] = ()


def anchor(name: str) -> FloatArray:
    """返回命名锚点坐标的副本。"""
    return ANCHORS[name].copy()


def center_point(name: str) -> FloatArray:
    """返回命名圆心坐标的副本。"""
    return CENTER_POINTS[name].copy()
