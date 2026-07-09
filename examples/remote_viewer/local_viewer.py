from __future__ import annotations
"""订阅主程序发布的 ZeroMQ 状态并用本地 MuJoCo passive viewer 渲染。"""

import logging
import time
from typing import Annotated, Any

import mujoco
import typer
import zmq

from artemis_mudri.simulation import DifferentialSimulation
from artemis_mudri.simulation.presets import DEFAULT_SIMULATION_PRESET

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = typer.Typer(add_completion=False, help="订阅远程 MuJoCo 状态并在本地渲染。")


def apply_state_message(simulation: DifferentialSimulation, message: dict[str, Any]) -> None:
    """把远程状态写入本地 MuJoCo data。"""

    qpos = message["qpos"]
    qvel = message["qvel"]
    if len(qpos) != simulation.model.nq:
        raise ValueError(f"qpos length mismatch: expected {simulation.model.nq}, got {len(qpos)}")
    if len(qvel) != simulation.model.nv:
        raise ValueError(f"qvel length mismatch: expected {simulation.model.nv}, got {len(qvel)}")
    simulation.data.time = float(message["time"])
    simulation.data.qpos[:] = qpos
    simulation.data.qvel[:] = qvel
    mujoco.mj_forward(simulation.model, simulation.data)


def run_viewer(*, connect: str, idle_hz: float) -> None:
    """连接远程 PUB socket，并在本地 viewer 中刷新最新状态。"""

    if idle_hz <= 0.0:
        raise ValueError("idle_hz must be greater than 0")

    import mujoco.viewer

    simulation = DEFAULT_SIMULATION_PRESET.build_simulation()
    ctx = zmq.Context.instance()
    socket = ctx.socket(zmq.SUB)
    socket.setsockopt(zmq.CONFLATE, 1)
    socket.setsockopt_string(zmq.SUBSCRIBE, "")
    socket.connect(connect)
    idle_interval_s = 1.0 / idle_hz
    logger.info("Subscribing MuJoCo state connect=%s idle_hz=%s", connect, idle_hz)

    try:
        with mujoco.viewer.launch_passive(
            simulation.model,
            simulation.data,
            show_left_ui=False,
            show_right_ui=False,
        ) as viewer:
            simulation._configure_viewer(viewer)
            while viewer.is_running():
                try:
                    message = socket.recv_json(flags=zmq.NOBLOCK)
                except zmq.Again:
                    time.sleep(idle_interval_s)
                    continue

                with viewer.lock():
                    apply_state_message(simulation, message)
                viewer.sync()
                time.sleep(idle_interval_s)
    except KeyboardInterrupt:
        logger.info("Viewer interrupted")
    finally:
        socket.close(linger=0)


@app.command()
def main(
    connect: Annotated[
        str,
        typer.Option(
            "--connect",
            help="ZeroMQ SUB 连接地址；配合 SSH 隧道时保持默认值。",
            envvar="ARTEMIS_REMOTE_VIEWER_CONNECT",
            show_envvar=True,
        ),
    ] = "tcp://127.0.0.1:5555",
    idle_hz: Annotated[
        float,
        typer.Option(
            "--idle-hz",
            help="无新消息时的 viewer 轮询频率，单位 Hz。",
            envvar="ARTEMIS_REMOTE_VIEWER_IDLE_HZ",
            show_envvar=True,
        ),
    ] = 60.0,
) -> None:
    """启动本地远程状态 viewer。"""

    try:
        run_viewer(connect=connect, idle_hz=idle_hz)
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc


if __name__ == "__main__":
    app()
