from __future__ import annotations
"""内置默认路线定义。"""

from dataclasses import dataclass
from typing import Any, Literal

from artemis_mudri.track.layout import ARC_RADIUS_M, anchor, center_point
from artemis_mudri.track.path import FloatArray, ReferencePath, build_reference_path
from artemis_mudri.track.sampling import sample_arc, sample_line

PathSegmentType = Literal["line", "arc"]


@dataclass(frozen=True)
class RoutePlan:
    """仿真使用的完整路线。"""

    path: ReferencePath
    time_limit_s: float

    @property
    def start_pose(self) -> tuple[float, float, float]:
        return self.path.start_pose


DEFAULT_ROUTE_DEFINITION: dict[str, Any] = {
    "time_limit_s": 120.0,
    "path_segments": (
        {"event_name": "B", "type": "line", "start_anchor": "A", "end_anchor": "B"},
        {"event_name": "C", "type": "arc", "center": "right_center", "start_angle_deg": 90.0, "end_angle_deg": -90.0},
        {"event_name": "D", "type": "line", "start_anchor": "C", "end_anchor": "D"},
        {"event_name": "A", "type": "arc", "center": "left_center", "start_angle_deg": -90.0, "end_angle_deg": -270.0},
    ),
}


def build_default_route(resolution: float = 0.02) -> RoutePlan:
    """根据内置默认路线定义构建路线计划。"""
    definition = DEFAULT_ROUTE_DEFINITION
    segments = [
        (str(segment["event_name"]), _build_path_segment(segment, resolution))
        for segment in definition["path_segments"]
    ]
    return RoutePlan(
        path=build_reference_path("default", segments),
        time_limit_s=float(definition["time_limit_s"]),
    )


def _build_path_segment(payload: dict[str, Any], resolution: float) -> FloatArray:
    """将路线段描述转换为离散路径点。"""
    segment_type = payload["type"]
    if segment_type == "line":
        return sample_line(
            anchor(str(payload["start_anchor"])),
            anchor(str(payload["end_anchor"])),
            resolution,
        )
    if segment_type == "arc":
        return sample_arc(
            center=center_point(str(payload["center"])),
            radius=float(payload.get("radius_m", ARC_RADIUS_M)),
            start_angle_deg=float(payload["start_angle_deg"]),
            end_angle_deg=float(payload["end_angle_deg"]),
            resolution=resolution,
        )
    raise ValueError(f"Unsupported path segment type: {segment_type!r}")
