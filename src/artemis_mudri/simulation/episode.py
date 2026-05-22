from __future__ import annotations
"""MuJoCo episode：负责模拟后双驱小车观测与运动学。"""

import time
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from typing import Any

import mujoco
import numpy as np

from artemis_mudri.simulation.noise import DEFAULT_NOISE_CONFIG, NoiseConfig
from artemis_mudri.simulation.summary import SimulationEvent, SimulationSummary
from artemis_mudri.track import RoutePlan
from artemis_mudri.vehicle import (
    DifferentialMotorCommand,
    EncoderConfig,
    EncoderReading,
    GyroReading,
    LineSensorArray,
    LineSensorArrayReading,
    VehicleState,
)
from artemis_mudri.simulation.xml import build_demo_model_xml


@dataclass(frozen=True)
class MotorDriverConfig:
    """电机驱动、编码器和简化动力学配置。"""

    encoder: EncoderConfig = field(default_factory=EncoderConfig)
    wheel_track_m: float = 0.14
    speed_response_alpha: float = 0.65
    max_pulse_speed_per_tick: float = 35.0


@dataclass(frozen=True)
class SimulationObservation:
    """服务端发给小车客户端的一帧观测。"""

    sequence_id: int
    sim_time_s: float
    state: VehicleState
    cross_track_error_m: float
    heading_error_rad: float
    line_sensor: LineSensorArrayReading
    imu: GyroReading
    encoder: EncoderReading
    active_segment_index: int
    progress_index: int
    progress_m: float
    remaining_distance_m: float
    step_events: tuple[SimulationEvent, ...]
    reached_goal: bool


def _wrap_angle(angle: float) -> float:
    """将角度归一化到 [-pi, pi]。"""
    return float(np.arctan2(np.sin(angle), np.cos(angle)))


class DifferentialSimulation:
    """由外部速度目标命令驱动的后双驱小车仿真 episode。"""

    def __init__(
        self,
        route: RoutePlan,
        route_resolution: float = 0.03,
        motor_driver: MotorDriverConfig | None = None,
        random_seed: int | None = None,
        noise_config: NoiseConfig | None = None,
        initial_pose: tuple[float, float, float] | None = None,
        initial_progress_index: int = 0,
    ) -> None:
        self.route = route
        self.motor_driver = motor_driver or MotorDriverConfig()
        self.noise_config = noise_config or DEFAULT_NOISE_CONFIG
        self.sensor_array = LineSensorArray()
        self.model = mujoco.MjModel.from_xml_string(build_demo_model_xml(route, resolution=route_resolution))
        self.data = mujoco.MjData(self.model)
        self._joint_state_handles = self._resolve_joint_state_handles(("car_x", "car_y", "car_yaw"))
        self._led_site_ids = self._resolve_led_site_ids()
        self._led_off_rgba = np.array([0.16, 0.16, 0.16, 1.0], dtype=np.float32)
        self._led_on_rgba = np.array([0.0, 1.0, 0.2, 1.0], dtype=np.float32)
        self._led_on_delay_s = 0.03
        self._led_off_delay_s = 0.12
        self._led_brightness = np.zeros(len(self._led_site_ids), dtype=np.float32)
        self._viewer_context: AbstractContextManager[Any] | None = None
        self._viewer: Any | None = None
        self._last_command = DifferentialMotorCommand(
            velocity=0.0,
            turn=0.0,
            rear_left_target_speed=0.0,
            rear_right_target_speed=0.0,
        )
        self._rng_initial_pose = np.random.default_rng(0)
        self._rng_line_sensor = np.random.default_rng(0)
        self._rng_imu = np.random.default_rng(0)
        self._rng_encoder = np.random.default_rng(0)
        self._rng_actuator = np.random.default_rng(0)
        self._rear_left_actuator_gain = 1.0
        self._rear_right_actuator_gain = 1.0
        self._imu_yaw_bias_deg = 0.0
        self._last_imu_observe_time_s = 0.0
        self._noisy_line_previous_error = 0.0
        self.reset(
            random_seed=random_seed,
            initial_pose=initial_pose,
            initial_progress_index=initial_progress_index,
        )

    @property
    def timestep_s(self) -> float:
        """返回控制层默认 tick。"""

        return self.motor_driver.encoder.control_tick_s

    @property
    def reached_goal(self) -> bool:
        """判断是否已经完成所有路径事件。"""

        return len(self.logged_events) == len(self.route.path.events)

    @property
    def active_segment_index(self) -> int:
        """返回服务端根据路径进度估计的当前路径段。"""

        return min(len(self.logged_events), len(self.route.path.events))

    def reset(
        self,
        *,
        random_seed: int | None = None,
        initial_pose: tuple[float, float, float] | None = None,
        initial_progress_index: int = 0,
    ) -> None:
        """重置仿真状态和统计量。"""

        mujoco.mj_resetData(self.model, self.data)
        self._reset_noise_generators(random_seed=random_seed)
        initial_pose_noise = self.noise_config.initial_pose
        if initial_pose is None:
            start_x, start_y, _ = self.route.start_pose
            yaw_rad = 0.0
        else:
            start_x, start_y, yaw_rad = initial_pose
            yaw_rad = float(yaw_rad)
        if initial_pose_noise.enabled:
            start_x += float(self._rng_initial_pose.normal(0.0, initial_pose_noise.x_std_m))
            start_y += float(self._rng_initial_pose.normal(0.0, initial_pose_noise.y_std_m))
            yaw_rad = _wrap_angle(
                yaw_rad
                + float(
                    np.deg2rad(
                        self._rng_initial_pose.uniform(
                            -initial_pose_noise.yaw_uniform_deg,
                            initial_pose_noise.yaw_uniform_deg,
                        )
                    )
                )
            )
        self.sequence_id = 0
        self.progress_index = int(np.clip(initial_progress_index, 0, len(self.route.path.points) - 1))
        self.cross_track_errors: list[float] = []
        self.logged_events: list[SimulationEvent] = []
        self._last_step_events: tuple[SimulationEvent, ...] = ()
        self._rear_left_speed = 0.0
        self._rear_right_speed = 0.0
        self._rear_left_total_pulses = 0.0
        self._rear_right_total_pulses = 0.0
        self._last_rear_left_pulses = 0.0
        self._last_rear_right_pulses = 0.0
        self._last_yaw_rate = 0.0
        self._imu_yaw_bias_deg = self.noise_config.imu.yaw_bias_deg
        self._last_imu_observe_time_s = 0.0
        self._noisy_line_previous_error = 0.0
        self._rear_left_actuator_gain = self._sample_actuator_gain(self.noise_config.actuator.left_gain_std)
        self._rear_right_actuator_gain = self._sample_actuator_gain(self.noise_config.actuator.right_gain_std)
        self._led_brightness[:] = 0.0
        self._sync_mujoco_state(
            VehicleState(
                x=float(start_x),
                y=float(start_y),
                yaw=yaw_rad,
            )
        )
        self._update_metrics(self.current_state().position)
        self._last_step_events = self._record_completed_events()
        self._update_sensor_leds((0,) * len(self._led_site_ids), dt=0.0)

    def open_viewer(self) -> None:
        """启动 MuJoCo 交互式查看器。"""

        if self._viewer is not None:
            return
        import mujoco.viewer

        self._viewer_context = mujoco.viewer.launch_passive(
            self.model,
            self.data,
            show_left_ui=False,
            show_right_ui=False,
        )
        self._viewer = self._viewer_context.__enter__()
        self._configure_viewer(self._viewer)

    def close_viewer(self) -> None:
        """关闭已启动的 MuJoCo viewer。"""

        if self._viewer_context is None:
            return
        self._viewer_context.__exit__(None, None, None)
        self._viewer_context = None
        self._viewer = None

    def viewer_is_running(self) -> bool:
        """返回 viewer 是否仍处于运行状态。"""

        return self._viewer is None or bool(self._viewer.is_running())

    def sync_viewer(self) -> None:
        """把当前状态同步到 viewer。"""

        if self._viewer is None:
            return
        self._viewer.sync()
        time.sleep(min(self.timestep_s, 0.02))

    def current_state(self) -> VehicleState:
        """返回底盘当前真值状态。"""

        x_addr, x_dof = self._joint_state_handles["car_x"]
        y_addr, y_dof = self._joint_state_handles["car_y"]
        yaw_addr, yaw_dof = self._joint_state_handles["car_yaw"]
        yaw = float(self.data.qpos[yaw_addr])
        cos_yaw = float(np.cos(yaw))
        sin_yaw = float(np.sin(yaw))
        world_vx = float(self.data.qvel[x_dof])
        world_vy = float(self.data.qvel[y_dof])
        longitudinal_speed = world_vx * cos_yaw + world_vy * sin_yaw
        lateral_speed = -world_vx * sin_yaw + world_vy * cos_yaw
        return VehicleState(
            x=float(self.data.qpos[x_addr]),
            y=float(self.data.qpos[y_addr]),
            yaw=yaw,
            longitudinal_speed=longitudinal_speed,
            lateral_speed=lateral_speed,
            yaw_rate=float(self.data.qvel[yaw_dof]),
        )

    def current_gyro_reading(self) -> GyroReading:
        """从底盘真值生成 MS901M 风格航向观测。"""

        state = self.current_state()
        imu_noise = self.noise_config.imu
        if not imu_noise.enabled:
            return GyroReading(
                yaw=float(np.rad2deg(state.yaw) % 360.0),
                yaw_rate=float(np.rad2deg(state.yaw_rate)),
            )

        dt = max(0.0, float(self.data.time) - self._last_imu_observe_time_s)
        self._last_imu_observe_time_s = float(self.data.time)
        if imu_noise.yaw_bias_random_walk_std_deg_per_sqrt_s > 0.0 and dt > 0.0:
            self._imu_yaw_bias_deg += float(
                self._rng_imu.normal(
                    0.0,
                    imu_noise.yaw_bias_random_walk_std_deg_per_sqrt_s * np.sqrt(dt),
                )
            )
        return GyroReading(
            yaw=float(
                (
                    np.rad2deg(state.yaw)
                    + self._imu_yaw_bias_deg
                    + self._rng_imu.normal(0.0, imu_noise.yaw_std_deg)
                )
                % 360.0
            ),
            yaw_rate=float(
                np.rad2deg(state.yaw_rate)
                + imu_noise.yaw_rate_bias_deg_s
                + self._rng_imu.normal(0.0, imu_noise.yaw_rate_std_deg_s)
            ),
        )

    def observe(self) -> SimulationObservation:
        """采样当前传感器并返回一帧观测。"""

        state = self.current_state()
        line_sensor = self._line_sensor_reading(state)
        self._update_sensor_leds(line_sensor.digital_values, dt=self.timestep_s)
        mujoco.mj_forward(self.model, self.data)
        self.sync_viewer()
        return SimulationObservation(
            sequence_id=self.sequence_id,
            sim_time_s=float(self.data.time),
            state=state,
            cross_track_error_m=self.cross_track_errors[-1] if self.cross_track_errors else 0.0,
            heading_error_rad=_wrap_angle(state.yaw - float(self.route.path.headings[self.progress_index])),
            line_sensor=line_sensor,
            imu=self.current_gyro_reading(),
            encoder=self._encoder_reading(),
            active_segment_index=self.active_segment_index,
            progress_index=self.progress_index,
            progress_m=float(self.route.path.arc_length[self.progress_index]),
            remaining_distance_m=self.route.path.remaining_distance(self.progress_index),
            step_events=self._last_step_events,
            reached_goal=self.reached_goal,
        )

    def step_control_command(
        self,
        command: DifferentialMotorCommand,
        dt: float | None = None,
    ) -> SimulationObservation:
        """按一帧固件速度目标命令推进仿真。"""

        step_dt = dt or self.timestep_s
        self._last_command = command
        self._rear_left_speed = self._next_motor_speed(
            current=self._rear_left_speed,
            target=command.rear_left_target_speed,
            side="left",
        )
        self._rear_right_speed = self._next_motor_speed(
            current=self._rear_right_speed,
            target=command.rear_right_target_speed,
            side="right",
        )

        scale = step_dt / self.motor_driver.encoder.control_tick_s
        self._last_rear_left_pulses = self._rear_left_speed * scale
        self._last_rear_right_pulses = self._rear_right_speed * scale
        self._rear_left_total_pulses += self._last_rear_left_pulses
        self._rear_right_total_pulses += self._last_rear_right_pulses

        left_mps = self._pulse_speed_to_mps(self._rear_left_speed)
        right_mps = self._pulse_speed_to_mps(self._rear_right_speed)
        linear_speed = 0.5 * (left_mps + right_mps)
        yaw_rate = (right_mps - left_mps) / self.motor_driver.wheel_track_m
        self._integrate_planar(linear_speed=linear_speed, yaw_rate=yaw_rate, dt=step_dt)
        self.sequence_id += 1
        self._update_metrics(self.current_state().position)
        self._last_step_events = self._record_completed_events()
        return self.observe()

    def summary(self) -> SimulationSummary:
        """生成当前 episode 的汇总统计。"""

        state = self.current_state()
        errors = np.abs(np.asarray(self.cross_track_errors, dtype=np.float64))
        return SimulationSummary(
            reached_goal=self.reached_goal,
            elapsed_time_s=float(self.data.time),
            route_length_m=self.route.path.total_length,
            max_cross_track_error_m=float(errors.max(initial=0.0)),
            rms_cross_track_error_m=float(np.sqrt(np.mean(errors * errors))) if len(errors) else 0.0,
            final_pose=(state.x, state.y, state.yaw),
            events=tuple(self.logged_events),
            total_steps=self.sequence_id,
        )

    def _next_motor_speed(
        self,
        *,
        current: float,
        target: float,
        side: str,
    ) -> float:
        """将目标速度转换为下一 tick 的编码器测量速度。"""

        desired = float(target)
        actuator_noise = self.noise_config.actuator
        if actuator_noise.enabled:
            gain = self._rear_left_actuator_gain if side == "left" else self._rear_right_actuator_gain
            desired = desired * gain + float(
                self._rng_actuator.normal(0.0, actuator_noise.command_std_pulse_per_tick)
            )
        response_alpha = self.motor_driver.speed_response_alpha
        if actuator_noise.enabled:
            response_alpha += float(
                self._rng_actuator.normal(0.0, actuator_noise.speed_response_alpha_std)
            )
        response_alpha = float(np.clip(response_alpha, 0.0, 1.0))
        next_speed = current + (desired - current) * response_alpha
        return float(np.clip(next_speed, -self.motor_driver.max_pulse_speed_per_tick, self.motor_driver.max_pulse_speed_per_tick))

    def _pulse_speed_to_mps(self, pulse_speed: float) -> float:
        """将脉冲/20ms 速度换算为 m/s。"""

        distance_cm_per_tick = pulse_speed / self.motor_driver.encoder.cm_to_pulse
        return float(distance_cm_per_tick / 100.0 / self.motor_driver.encoder.control_tick_s)

    def _integrate_planar(self, *, linear_speed: float, yaw_rate: float, dt: float) -> None:
        """用平面约束动力学推进 MuJoCo 状态。"""

        state = self.current_state()
        yaw_mid = state.yaw + 0.5 * yaw_rate * dt
        new_state = VehicleState(
            x=state.x + linear_speed * float(np.cos(yaw_mid)) * dt,
            y=state.y + linear_speed * float(np.sin(yaw_mid)) * dt,
            yaw=_wrap_angle(state.yaw + yaw_rate * dt),
            longitudinal_speed=linear_speed,
            lateral_speed=0.0,
            yaw_rate=yaw_rate,
        )
        self._last_yaw_rate = yaw_rate
        self.data.time += dt
        self._sync_mujoco_state(new_state)

    def _encoder_reading(self) -> EncoderReading:
        """返回当前编码器读数。"""

        rear_left_pulses = self._last_rear_left_pulses
        rear_right_pulses = self._last_rear_right_pulses
        rear_left_total_pulses = self._rear_left_total_pulses
        rear_right_total_pulses = self._rear_right_total_pulses
        rear_left_speed = self._rear_left_speed
        rear_right_speed = self._rear_right_speed

        encoder_noise = self.noise_config.encoder
        if encoder_noise.enabled:
            rear_left_pulses = self._noisy_encoder_pulses(rear_left_pulses, encoder_noise.dropout_prob)
            rear_right_pulses = self._noisy_encoder_pulses(rear_right_pulses, encoder_noise.dropout_prob)
            rear_left_total_pulses += float(self._rng_encoder.normal(0.0, encoder_noise.pulse_std))
            rear_right_total_pulses += float(self._rng_encoder.normal(0.0, encoder_noise.pulse_std))
            rear_left_speed += float(self._rng_encoder.normal(0.0, encoder_noise.speed_std))
            rear_right_speed += float(self._rng_encoder.normal(0.0, encoder_noise.speed_std))
            if encoder_noise.quantize:
                rear_left_pulses = float(np.round(rear_left_pulses))
                rear_right_pulses = float(np.round(rear_right_pulses))
                rear_left_total_pulses = float(np.round(rear_left_total_pulses))
                rear_right_total_pulses = float(np.round(rear_right_total_pulses))

        pulse_avg = 0.5 * (rear_left_total_pulses + rear_right_total_pulses)
        return EncoderReading(
            rear_left_pulses=rear_left_pulses,
            rear_right_pulses=rear_right_pulses,
            rear_left_total_pulses=rear_left_total_pulses,
            rear_right_total_pulses=rear_right_total_pulses,
            rear_left_measure_speed=rear_left_speed,
            rear_right_measure_speed=rear_right_speed,
            forward_distance_cm=pulse_avg / self.motor_driver.encoder.cm_to_pulse,
        )

    def _reset_noise_generators(self, *, random_seed: int | None) -> None:
        """根据 episode seed 派生各噪声源的独立随机流。"""

        episode_seed = self.noise_config.seed if self.noise_config.seed is not None else random_seed
        seed_sequence = np.random.SeedSequence(0 if episode_seed is None else int(episode_seed))
        (
            initial_pose_seed,
            line_sensor_seed,
            imu_seed,
            encoder_seed,
            actuator_seed,
        ) = seed_sequence.spawn(5)
        self._rng_initial_pose = np.random.default_rng(initial_pose_seed)
        self._rng_line_sensor = np.random.default_rng(line_sensor_seed)
        self._rng_imu = np.random.default_rng(imu_seed)
        self._rng_encoder = np.random.default_rng(encoder_seed)
        self._rng_actuator = np.random.default_rng(actuator_seed)

    def _sample_actuator_gain(self, std: float) -> float:
        """采样单侧电机本 episode 固定增益。"""

        if not self.noise_config.actuator.enabled:
            return 1.0
        return float(max(0.0, 1.0 + self._rng_actuator.normal(0.0, std)))

    def _line_sensor_reading(self, state: VehicleState) -> LineSensorArrayReading:
        """返回可能带噪声的巡线传感器观测。"""

        reading = self.sensor_array.sense_pose(state.x, state.y, state.yaw)
        line_noise = self.noise_config.line_sensor
        if not line_noise.enabled:
            return reading

        darkness = np.clip(
            reading.darkness + self._rng_line_sensor.normal(0.0, line_noise.darkness_std, size=reading.darkness.shape),
            0.0,
            1.0,
        )
        threshold = self.sensor_array.config.sensor_threshold + self._rng_line_sensor.normal(
            0.0,
            line_noise.threshold_std,
            size=darkness.shape,
        )
        digital = darkness >= threshold
        if line_noise.dropout_prob > 0.0:
            digital = np.where(
                self._rng_line_sensor.random(size=digital.shape) < line_noise.dropout_prob,
                False,
                digital,
            )
        if line_noise.false_positive_prob > 0.0:
            false_positive = self._rng_line_sensor.random(size=digital.shape) < line_noise.false_positive_prob
            digital = np.logical_or(digital, false_positive)

        line_detected = bool(np.any(digital))
        lateral_error_m = None
        error = self._noisy_line_previous_error
        if line_detected:
            lateral_positions = reading.local_sensor_positions[:, 1]
            digital_weights = digital.astype(np.float64)
            lateral_error_m = float(np.dot(digital_weights, lateral_positions) / digital_weights.sum())
            error = float(
                np.dot(digital_weights, np.asarray(reading.error_weights, dtype=np.float64))
                / digital_weights.sum()
            )
            self._noisy_line_previous_error = error

        return LineSensorArrayReading(
            local_sensor_positions=reading.local_sensor_positions,
            world_sensor_positions=reading.world_sensor_positions,
            darkness=darkness,
            digital_values=tuple(int(value) for value in digital),
            error_weights=reading.error_weights,
            line_detected=line_detected,
            error=error,
            lateral_error_m=lateral_error_m,
        )

    def _noisy_encoder_pulses(self, pulses: float, dropout_prob: float) -> float:
        """返回单侧本 tick 编码器脉冲观测。"""

        if dropout_prob > 0.0 and self._rng_encoder.random() < dropout_prob:
            return 0.0
        return float(pulses + self._rng_encoder.normal(0.0, self.noise_config.encoder.pulse_std))

    def _resolve_joint_state_handles(self, joint_names: tuple[str, ...]) -> dict[str, tuple[int, int]]:
        """解析关节 qpos/dof 地址。"""

        handles: dict[str, tuple[int, int]] = {}
        for joint_name in joint_names:
            joint_id = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, joint_name)
            if joint_id < 0:
                raise RuntimeError(f"MuJoCo joint not found: {joint_name}")
            handles[joint_name] = (
                int(self.model.jnt_qposadr[joint_id]),
                int(self.model.jnt_dofadr[joint_id]),
            )
        return handles

    def _resolve_led_site_ids(self) -> tuple[int, ...]:
        """解析 LED site 在 MuJoCo 模型中的索引。"""

        return tuple(
            mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_SITE, f"led_{index}")
            for index in range(len(self.sensor_array.local_sensor_positions))
        )

    def _set_joint_state(self, joint_name: str, *, qpos: float, qvel: float) -> None:
        """写入单个关节的 qpos/qvel。"""

        qpos_addr, dof_addr = self._joint_state_handles[joint_name]
        self.data.qpos[qpos_addr] = qpos
        self.data.qvel[dof_addr] = qvel

    def _sync_mujoco_state(self, state: VehicleState) -> None:
        """将平面状态同步到 MuJoCo 数据。"""

        cos_yaw = float(np.cos(state.yaw))
        sin_yaw = float(np.sin(state.yaw))
        world_vx = state.longitudinal_speed * cos_yaw - state.lateral_speed * sin_yaw
        world_vy = state.longitudinal_speed * sin_yaw + state.lateral_speed * cos_yaw

        self._set_joint_state("car_x", qpos=state.x, qvel=world_vx)
        self._set_joint_state("car_y", qpos=state.y, qvel=world_vy)
        self._set_joint_state("car_yaw", qpos=state.yaw, qvel=state.yaw_rate)
        mujoco.mj_forward(self.model, self.data)

    def _update_metrics(self, position: np.ndarray) -> None:
        """更新路径进度和横向误差统计。"""

        self.progress_index = self.route.path.progress_index(
            position=position,
            start_index=self.progress_index,
            window=160,
        )
        nearest_point = self.route.path.points[self.progress_index]
        heading = float(self.route.path.headings[self.progress_index])
        left_normal = np.array([-np.sin(heading), np.cos(heading)], dtype=np.float64)
        signed_error = float(np.dot(position - nearest_point, left_normal))
        self.cross_track_errors.append(signed_error)

    def _record_completed_events(self) -> tuple[SimulationEvent, ...]:
        """按路径进度记录已完成的路径事件。"""

        completed_names = {event.labels["name"] for event in self.logged_events}
        new_events: list[SimulationEvent] = []
        for event in self.route.path.events:
            if event.name in completed_names:
                continue
            if self.progress_index < event.index:
                break
            state = self.current_state()
            simulation_event = SimulationEvent(
                event_id=len(self.logged_events) + 1,
                step_id=self.sequence_id,
                namespace="path",
                type="checkpoint",
                severity="info",
                pose=(state.x, state.y, state.yaw),
                metrics={
                    "timestamp_s": float(self.data.time),
                    "path_index": float(event.index),
                },
                labels={"name": event.name},
            )
            self.logged_events.append(simulation_event)
            new_events.append(simulation_event)
        return tuple(new_events)

    def _update_sensor_leds(self, digital_values: tuple[int, ...], dt: float) -> None:
        """根据数字量传感器结果更新带延迟的 LED 亮度。"""

        for index, (site_id, value) in enumerate(zip(self._led_site_ids, digital_values)):
            if site_id < 0:
                continue
            target = 1.0 if value else 0.0
            delay_s = self._led_on_delay_s if value else self._led_off_delay_s
            alpha = 1.0 if delay_s <= 0.0 else min(1.0, dt / delay_s)
            self._led_brightness[index] = float(
                self._led_brightness[index] + (target - self._led_brightness[index]) * alpha
            )
            brightness = self._led_brightness[index]
            self.model.site_rgba[site_id] = self._led_off_rgba + (
                self._led_on_rgba - self._led_off_rgba
            ) * brightness

    def _configure_viewer(self, viewer: Any) -> None:
        """设置 MuJoCo viewer 的俯视相机。"""

        viewer.cam.lookat[:] = [1.1, 0.6, 0.0]
        viewer.cam.distance = 2.8
        viewer.cam.azimuth = 0.0
        viewer.cam.elevation = -90.0
