from __future__ import annotations
"""gRPC 仿真服务。"""

import logging
import threading
from collections.abc import Iterator

import grpc

from artemis_mudri.simulation import (
    DifferentialSimulation,
    MotorDriverConfig,
    SimulationEvent,
    SimulationObservation,
    SimulationSummary,
)
from artemis_mudri.simulation.noise import NoiseConfig
from artemis_mudri.simulation.presets import DEFAULT_SIMULATION_PRESET, SimulationPreset
from artemis_mudri.simulation.state_publisher import SimulationStatePublisher
from artemis_mudri.protos.simulation.v1 import common_pb2
from artemis_mudri.protos.simulation.v1 import event_pb2
from artemis_mudri.protos.simulation.v1 import observation_pb2
from artemis_mudri.protos.simulation.v1 import vehicle_simulation_pb2 as pb2
from artemis_mudri.protos.simulation.v1 import vehicle_simulation_pb2_grpc as pb2_grpc
from artemis_mudri.vehicle import DifferentialMotorCommand

logger = logging.getLogger(__name__)


class VehicleSimulationService(pb2_grpc.VehicleSimulationServiceServicer):
    """差速小车仿真流式服务。"""

    def __init__(
        self,
        default_render: bool = False,
        motor_driver: MotorDriverConfig | None = None,
        noise_config: NoiseConfig | None = None,
        state_publisher: SimulationStatePublisher | None = None,
        preset: SimulationPreset = DEFAULT_SIMULATION_PRESET,
    ) -> None:
        self.default_render = default_render
        self.motor_driver = motor_driver or MotorDriverConfig()
        self.noise_config = noise_config
        self.state_publisher = state_publisher
        self.preset = preset
        self._render_lock = threading.Lock()
        self._render_episode: DifferentialSimulation | None = None

    def StreamEpisode(
        self,
        request_iterator: Iterator[pb2.ClientMessage],
        context: grpc.ServicerContext,
    ) -> Iterator[pb2.ServerMessage]:
        """按 start/observation/command 的节奏运行一次 episode。"""

        del context
        if self.default_render:
            with self._render_lock:
                yield from self._stream_episode(request_iterator, render=True)
            return
        yield from self._stream_episode(request_iterator, render=False)

    def _stream_episode(
        self,
        request_iterator: Iterator[pb2.ClientMessage],
        *,
        render: bool,
    ) -> Iterator[pb2.ServerMessage]:
        try:
            first_message = next(request_iterator)
        except StopIteration:
            yield _error_message("StreamEpisode requires an initial StartEpisodeRequest.")
            return

        if first_message.WhichOneof("payload") != "start":
            yield _error_message("First client message must be StartEpisodeRequest.")
            return

        start = first_message.start
        route = self.preset.build_route()
        episode = self._episode_from_start(start, render=render)
        control_period_s = start.control_period_s or episode.timestep_s
        time_budget_s = start.max_time_s or route.time_limit_s
        reason = "client_disconnected"

        try:
            if render:
                episode.open_viewer()
            logger.info(
                "Started simulation episode render=%s control_period=%s max_time=%s",
                render,
                control_period_s,
                time_budget_s,
            )
            yield pb2.ServerMessage(
                started=pb2.EpisodeStarted(
                    time_limit_s=route.time_limit_s,
                    control_period_s=control_period_s,
                )
            )

            observation = episode.observe()
            self._publish_viewer_state(episode)
            yield _observation_message(observation)

            while episode.data.time < time_budget_s and episode.viewer_is_running():
                try:
                    client_message = next(request_iterator)
                except StopIteration:
                    break

                payload = client_message.WhichOneof("payload")
                if payload == "stop":
                    reason = client_message.stop.reason or "client_stopped"
                    break
                if payload != "control_command":
                    yield _error_message(f"Unsupported client message during episode: {payload!r}.")
                    return

                control_command = client_message.control_command
                velocity = 0.5 * (
                    control_command.rear_left_target_speed + control_command.rear_right_target_speed
                )
                turn = 0.5 * (
                    control_command.rear_right_target_speed - control_command.rear_left_target_speed
                )
                observation = episode.step_control_command(
                    DifferentialMotorCommand(
                        velocity=velocity,
                        turn=turn,
                        rear_left_target_speed=control_command.rear_left_target_speed,
                        rear_right_target_speed=control_command.rear_right_target_speed,
                    ),
                    dt=control_period_s,
                )
                self._publish_viewer_state(episode)

                if episode.reached_goal:
                    reason = "goal_reached"
                    break
                if episode.data.time >= time_budget_s:
                    reason = "time_limit"
                    break
                if not episode.viewer_is_running():
                    reason = "viewer_closed"
                    break

                yield _observation_message(observation)

            yield _finished_message(episode.summary(), reason)
        except Exception as exc:  # pragma: no cover - converted to protocol error for clients.
            logger.exception("Simulation episode failed")
            yield _error_message(str(exc))
        finally:
            if not render:
                episode.close_viewer()

    def _publish_viewer_state(self, episode: DifferentialSimulation) -> None:
        """按需把 MuJoCo 状态发布给远程 viewer。"""

        if self.state_publisher is None:
            return
        self.state_publisher.publish(episode)

    def _episode_from_start(
        self,
        start: pb2.StartEpisodeRequest,
        *,
        render: bool,
    ) -> DifferentialSimulation:
        route = self.preset.build_route()
        initial_pose = _initial_pose_from_request(start) if start.HasField("initial_pose") else None
        initial_progress_index = int(start.initial_progress_index)
        if not render:
            return DifferentialSimulation(
                route=route,
                route_resolution=self.preset.model_resolution,
                motor_driver=self.motor_driver,
                noise_config=self.noise_config,
                initial_pose=initial_pose,
                initial_progress_index=initial_progress_index,
            )

        if self._render_episode is not None and not self._render_episode.viewer_is_running():
            self._render_episode.close_viewer()
            self._render_episode = None
        if self._render_episode is None:
            self._render_episode = DifferentialSimulation(
                route=route,
                route_resolution=self.preset.model_resolution,
                motor_driver=self.motor_driver,
                noise_config=self.noise_config,
            )
        self._render_episode.reset(
            initial_pose=initial_pose,
            initial_progress_index=initial_progress_index,
        )
        return self._render_episode

    def close(self) -> None:
        """关闭服务级复用的渲染 episode。"""

        with self._render_lock:
            if self._render_episode is None:
                if self.state_publisher is not None:
                    self.state_publisher.close()
                return
            self._render_episode.close_viewer()
            self._render_episode = None
            if self.state_publisher is not None:
                self.state_publisher.close()


def _observation_message(observation: SimulationObservation) -> pb2.ServerMessage:
    line_sensor = observation.line_sensor

    state = observation.state
    observation_frame = observation_pb2.ObservationFrame(
        sequence_id=observation.sequence_id,
        sim_time_s=observation.sim_time_s,
        line_sensor_darkness=[float(value) for value in line_sensor.darkness],
        imu=observation_pb2.ImuFrame(
            yaw_deg=observation.imu.yaw,
            yaw_rate_deg_s=observation.imu.yaw_rate,
        ),
        path_progress=observation_pb2.PathProgressFrame(
            active_segment_index=observation.active_segment_index,
            reached_goal=observation.reached_goal,
            progress_index=observation.progress_index,
            progress_m=observation.progress_m,
            remaining_distance_m=observation.remaining_distance_m,
        ),
        kinematics=observation_pb2.KinematicsFrame(
            longitudinal_velocity_m_s=state.longitudinal_speed,
            lateral_velocity_m_s=state.lateral_speed,
            yaw_rate_rad_s=state.yaw_rate,
        ),
        oracle=observation_pb2.OracleFrame(
            cross_track_error_m=observation.cross_track_error_m,
            heading_error_rad=observation.heading_error_rad,
            progress_index=observation.progress_index,
            progress_m=observation.progress_m,
            remaining_distance_m=observation.remaining_distance_m,
        ),
        step_trace=observation_pb2.StepTrace(
            step_id=observation.sequence_id,
            events=[_event_message(event) for event in observation.step_events],
        ),
        pose=common_pb2.Pose2D(
            x_m=state.x,
            y_m=state.y,
            yaw_rad=state.yaw,
        ),
    )

    return pb2.ServerMessage(observation=observation_frame)


def _finished_message(summary: SimulationSummary, reason: str) -> pb2.ServerMessage:
    final_x, final_y, final_yaw = summary.final_pose
    return pb2.ServerMessage(
        finished=pb2.EpisodeFinished(
            summary=pb2.SimulationSummary(
                reached_goal=summary.reached_goal,
                elapsed_time_s=summary.elapsed_time_s,
                route_length_m=summary.route_length_m,
                max_cross_track_error_m=summary.max_cross_track_error_m,
                rms_cross_track_error_m=summary.rms_cross_track_error_m,
                final_pose=common_pb2.Pose2D(
                    x_m=final_x,
                    y_m=final_y,
                    yaw_rad=final_yaw,
                ),
                events=[_event_message(event) for event in summary.events],
                total_steps=summary.total_steps,
            ),
            reason=reason,
            final_step_trace=observation_pb2.StepTrace(
                step_id=summary.total_steps,
                terminated=reason == "goal_reached",
                truncated=reason != "goal_reached",
                reason=reason,
            ),
        )
    )


def _event_message(event: SimulationEvent) -> event_pb2.SimulationEvent:
    severity_by_name = {
        "info": event_pb2.EVENT_SEVERITY_INFO,
        "warning": event_pb2.EVENT_SEVERITY_WARNING,
        "failure": event_pb2.EVENT_SEVERITY_FAILURE,
    }
    x_m, y_m, yaw_rad = event.pose
    return event_pb2.SimulationEvent(
        event_id=event.event_id,
        step_id=event.step_id,
        namespace=event.namespace,
        type=event.type,
        severity=severity_by_name.get(event.severity, event_pb2.EVENT_SEVERITY_UNSPECIFIED),
        pose=common_pb2.Pose2D(x_m=x_m, y_m=y_m, yaw_rad=yaw_rad),
        metrics=event.metrics,
        labels=event.labels,
    )


def _error_message(message: str) -> pb2.ServerMessage:
    return pb2.ServerMessage(error=message)


def _initial_pose_from_request(start: pb2.StartEpisodeRequest) -> tuple[float, float, float]:
    pose = start.initial_pose
    return (pose.x_m, pose.y_m, pose.yaw_rad)
