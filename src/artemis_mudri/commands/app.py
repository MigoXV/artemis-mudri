"""标准命令行入口：启动 ZMQ JSON 仿真服务。"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated

import typer

from artemis_mudri.api import JsonSimulationService
from artemis_mudri.runtime import SimulationEpisodeRunner
from artemis_mudri.simulation.noise import NoiseConfig, enabled_noise_modules, load_noise_config
from artemis_mudri.simulation.state_publisher import ZmqSimulationStatePublisher
from artemis_mudri.transport import ZmqJsonSimulationServer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

app = typer.Typer(
    add_completion=False,
    help="启动自动行驶小车 MuJoCo 仿真 ZMQ JSON 服务。",
)


def create_simulation_service(
    *,
    bind: str = "tcp://127.0.0.1:5556",
    default_render: bool = False,
    noise_config: NoiseConfig | None = None,
    viewer_state_bind: str | None = None,
) -> ZmqJsonSimulationServer:
    """装配 ZMQ JSON 仿真服务。"""

    state_publisher = None
    if viewer_state_bind is not None:
        state_publisher = ZmqSimulationStatePublisher(viewer_state_bind)
        state_publisher.start()
    runner = SimulationEpisodeRunner(
        default_render=default_render,
        noise_config=noise_config,
        state_publisher=state_publisher,
    )
    json_service = JsonSimulationService(runner)
    return ZmqJsonSimulationServer(
        bind=bind,
        handler=json_service.handle,
        close_handler=runner.close,
    )


def serve_simulation(
    bind: str = "tcp://127.0.0.1:5556",
    render: bool = False,
    noise_config_path: Path | None = None,
    viewer_state_bind: str | None = None,
) -> None:
    """启动阻塞式 ZMQ JSON 仿真服务。"""

    noise_config = load_noise_config(noise_config_path) if noise_config_path is not None else None
    if noise_config is not None:
        logger.info(
            "Loaded noise config preset=%s path=%s enabled=%s",
            noise_config.preset,
            noise_config_path,
            ",".join(enabled_noise_modules(noise_config)) or "none",
        )
    server = create_simulation_service(
        bind=bind,
        default_render=render,
        noise_config=noise_config,
        viewer_state_bind=viewer_state_bind,
    )
    if viewer_state_bind is not None:
        logger.info("Remote viewer state publisher enabled at %s", viewer_state_bind)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Stopping vehicle simulation service")
    finally:
        server.close()


@app.command("serve")
def serve_command(
    bind: Annotated[
        str,
        typer.Option(
            "--bind",
            help="ZMQ REP 监听地址。",
            envvar="ARTEMIS_ZMQ_BIND",
            show_envvar=True,
        ),
    ] = "tcp://127.0.0.1:5556",
    render: Annotated[
        bool,
        typer.Option(
            "--render/--no-render",
            help="是否在 episode 中启动 MuJoCo viewer。",
            envvar="ARTEMIS_RENDER",
            show_envvar=True,
        ),
    ] = False,
    noise_config: Annotated[
        Path | None,
        typer.Option(
            "--noise-config",
            help="噪声 YAML 配置路径；不传时保持兼容默认仿真。",
            envvar="ARTEMIS_NOISE_CONFIG",
            show_envvar=True,
        ),
    ] = None,
    viewer_state_bind: Annotated[
        str | None,
        typer.Option(
            "--viewer-state-bind",
            help="可选 ZeroMQ PUB 监听地址，用于发布 MuJoCo qpos/qvel 给远程 viewer。",
            envvar="ARTEMIS_VIEWER_STATE_BIND",
            show_envvar=True,
        ),
    ] = None,
) -> None:
    """启动仿真服务，等待小车客户端连接。"""

    logger.info(
        "Starting simulation service bind=%s render=%s",
        bind,
        render,
    )
    try:
        serve_simulation(
            bind=bind,
            render=render,
            noise_config_path=noise_config,
            viewer_state_bind=viewer_state_bind,
        )
    except (FileNotFoundError, ValueError, TypeError) as exc:
        raise typer.BadParameter(str(exc), param_hint="--noise-config") from exc


def main() -> None:
    """CLI 主入口。"""
    app()


if __name__ == "__main__":
    app()
