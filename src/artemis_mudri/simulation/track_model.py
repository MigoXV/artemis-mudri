from __future__ import annotations
"""MuJoCo 赛道模型渲染。"""

from xml.sax.saxutils import escape

from artemis_mudri.track import ANCHORS, ARC_LINE_WIDTH_M, FIELD_HEIGHT_M, FIELD_WIDTH_M, OFFICIAL_ARCS, OFFICIAL_LINES
from artemis_mudri.track import RoutePlan
from artemis_mudri.simulation.config import BoundaryConfig, SiteConfig, WorldConfig
from artemis_mudri.simulation.xml_common import format_floats, site_xml


def _capsule_chain_xml(
    name_prefix: str,
    points,
    radius: float,
    rgba: tuple[float, float, float, float],
    z: float,
) -> str:
    """将离散路径点渲染为 capsule 链条。"""

    rgba_text = " ".join(f"{value:.3f}" for value in rgba)
    geoms: list[str] = []
    for index, (start, end) in enumerate(zip(points[:-1], points[1:])):
        fromto = (
            f"{start[0]:.4f} {start[1]:.4f} {z:.4f} "
            f"{end[0]:.4f} {end[1]:.4f} {z:.4f}"
        )
        geoms.append(
            f'<geom name="{escape(name_prefix)}_{index}" type="capsule" '
            f'fromto="{fromto}" size="{radius:.4f}" '
            f'rgba="{rgba_text}" contype="0" conaffinity="0"/>'
        )
    return "\n".join(geoms)


def _boundary_xml(boundary: BoundaryConfig) -> str:
    """渲染边界几何体。"""

    return (
        f'<geom name="{escape(boundary.name)}" type="capsule" '
        f'fromto="{format_floats(boundary.fromto, precision=3)}" '
        f'size="{boundary.radius:.3f}" rgba="{format_floats(boundary.rgba)}" '
        f'contype="0" conaffinity="0"/>'
    )


def _anchor_sites_xml(world: WorldConfig) -> str:
    """渲染所有锚点 site。"""

    sites: list[str] = []
    for name, position in ANCHORS.items():
        rgba = world.anchor_site_style.rgba_by_name.get(name, world.anchor_site_style.fallback_rgba)
        sites.append(
            site_xml(
                SiteConfig(
                    name=f"anchor_{name}",
                    pos=(float(position[0]), float(position[1]), world.anchor_site_style.z),
                    size=world.anchor_site_style.size,
                    site_type="sphere",
                    rgba=rgba,
                )
            )
        )
    return "\n".join(sites)


def build_track_worldbody_xml(route: RoutePlan, world: WorldConfig, resolution: float) -> str:
    """生成赛道与场地的 worldbody 片段。"""

    boundaries = "\n    ".join(_boundary_xml(boundary) for boundary in world.boundaries)
    official_track = "\n    ".join(
        _capsule_chain_xml(
            segment.name,
            segment.sample(resolution),
            radius=0.5 * ARC_LINE_WIDTH_M,
            rgba=world.track_rgba,
            z=world.track_z,
        )
        for segment in (*OFFICIAL_LINES, *OFFICIAL_ARCS)
    )
    reference_route = _capsule_chain_xml(
        "reference_route",
        route.path.points,
        radius=world.route_line_radius,
        rgba=world.route_rgba,
        z=world.route_z,
    )
    anchor_sites = _anchor_sites_xml(world)

    return f"""
    <geom name="ground" type="plane" pos="{FIELD_WIDTH_M / 2:.3f} {FIELD_HEIGHT_M / 2:.3f} 0" size="3 3 0.1" rgba="{format_floats(world.ground_rgba)}"/>
    <geom name="field" type="box" pos="{FIELD_WIDTH_M / 2:.3f} {FIELD_HEIGHT_M / 2:.3f} {world.field_thickness:.3f}" size="{FIELD_WIDTH_M / 2:.3f} {FIELD_HEIGHT_M / 2:.3f} {world.field_thickness:.3f}" rgba="{format_floats(world.field_rgba)}" contype="0" conaffinity="0"/>
    {boundaries}
    {official_track}
    {reference_route}
    {anchor_sites}
""".strip()
