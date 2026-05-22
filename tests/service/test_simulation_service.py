import unittest
from math import pi
from pathlib import Path
from unittest.mock import patch

from artemis_mudri.servicer.servicer import VehicleSimulationService
from artemis_mudri.simulation.noise import load_noise_config
from artemis_mudri.track import build_default_route
from artemis_mudri.protos.simulation.v1 import common_pb2
from artemis_mudri.protos.simulation.v1 import event_pb2
from artemis_mudri.protos.simulation.v1 import vehicle_simulation_pb2 as pb2


REPO_ROOT = Path(__file__).resolve().parents[2]


class VehicleSimulationServiceTest(unittest.TestCase):
    def test_proto_message_round_trip_preserves_control_command(self) -> None:
        message = pb2.ClientMessage(
            control_command=pb2.VehicleControlCommand(
                sequence_id=42,
                rear_left_target_speed=6.75,
                rear_right_target_speed=7.25,
            )
        )
        parsed = pb2.ClientMessage.FromString(message.SerializeToString())
        self.assertEqual(parsed.WhichOneof("payload"), "control_command")
        self.assertEqual(parsed.control_command.sequence_id, 42)
        self.assertAlmostEqual(parsed.control_command.rear_left_target_speed, 6.75)
        self.assertAlmostEqual(parsed.control_command.rear_right_target_speed, 7.25)

    def test_stream_episode_starts_observes_and_finishes_on_stop(self) -> None:
        service = VehicleSimulationService()
        requests = iter(
            [
                pb2.ClientMessage(start=pb2.StartEpisodeRequest(control_period_s=0.01)),
                pb2.ClientMessage(stop=pb2.StopEpisodeRequest(reason="test_stop")),
            ]
        )
        responses = list(service.StreamEpisode(requests, None))
        self.assertEqual([response.WhichOneof("payload") for response in responses], ["started", "observation", "finished"])
        self.assertEqual(responses[-1].finished.reason, "test_stop")

    def test_stream_episode_publishes_viewer_state_when_enabled(self) -> None:
        publisher = _FakeStatePublisher()
        service = VehicleSimulationService(state_publisher=publisher)
        requests = iter(
            [
                pb2.ClientMessage(start=pb2.StartEpisodeRequest(max_time_s=0.02, control_period_s=0.01)),
                pb2.ClientMessage(
                    control_command=pb2.VehicleControlCommand(
                        sequence_id=0,
                        rear_left_target_speed=7.0,
                        rear_right_target_speed=7.0,
                    )
                ),
                pb2.ClientMessage(stop=pb2.StopEpisodeRequest(reason="test_stop")),
            ]
        )

        list(service.StreamEpisode(requests, None))

        self.assertEqual(publisher.sequence_ids, [0, 1])

    def test_render_episode_reuses_simulation_between_starts(self) -> None:
        created: list[_FakeRenderEpisode] = []

        def create_episode(*args, **kwargs) -> _FakeRenderEpisode:
            del args, kwargs
            episode = _FakeRenderEpisode()
            created.append(episode)
            return episode

        service = VehicleSimulationService(default_render=True)
        with patch("artemis_mudri.servicer.servicer.DifferentialSimulation", side_effect=create_episode):
            first = service._episode_from_start(pb2.StartEpisodeRequest(initial_progress_index=12), render=True)
            second = service._episode_from_start(pb2.StartEpisodeRequest(initial_progress_index=34), render=True)
            service.close()

        self.assertIs(first, second)
        self.assertEqual(len(created), 1)
        self.assertEqual(first.reset_progress_indices, [12, 34])
        self.assertEqual(first.close_count, 1)

    def test_stream_episode_accepts_manual_initial_pose(self) -> None:
        service = VehicleSimulationService()
        requests = iter(
            [
                pb2.ClientMessage(
                    start=pb2.StartEpisodeRequest(
                        control_period_s=0.01,
                        initial_pose=common_pb2.Pose2D(x_m=1.25, y_m=-0.25, yaw_rad=pi),
                    )
                ),
                pb2.ClientMessage(stop=pb2.StopEpisodeRequest(reason="test_stop")),
            ]
        )

        responses = list(service.StreamEpisode(requests, None))

        observation = responses[1].observation
        self.assertAlmostEqual(observation.imu.yaw_deg, 180.0)
        self.assertAlmostEqual(observation.pose.x_m, 1.25)
        self.assertAlmostEqual(observation.pose.y_m, -0.25)
        self.assertAlmostEqual(observation.pose.yaw_rad, pi)
        final_pose = responses[-1].finished.summary.final_pose
        self.assertAlmostEqual(final_pose.x_m, 1.25)
        self.assertAlmostEqual(final_pose.y_m, -0.25)
        self.assertAlmostEqual(final_pose.yaw_rad, pi)

    def test_stream_episode_accepts_initial_progress_index(self) -> None:
        service = VehicleSimulationService()
        route = build_default_route()
        initial_progress_index = 90
        point = route.path.points[initial_progress_index]
        yaw = route.path.headings[initial_progress_index]
        requests = iter(
            [
                pb2.ClientMessage(
                    start=pb2.StartEpisodeRequest(
                        control_period_s=0.01,
                        initial_pose=common_pb2.Pose2D(x_m=float(point[0]), y_m=float(point[1]), yaw_rad=float(yaw)),
                        initial_progress_index=initial_progress_index,
                    )
                ),
                pb2.ClientMessage(stop=pb2.StopEpisodeRequest(reason="test_stop")),
            ]
        )

        responses = list(service.StreamEpisode(requests, None))

        observation = responses[1].observation
        self.assertEqual(observation.path_progress.completed_event_count, 0)
        self.assertEqual(list(observation.path_progress.completed_events), [])
        self.assertEqual(len(observation.step_trace.events), 1)

        event = observation.step_trace.events[0]
        self.assertEqual(event.name, "")
        self.assertEqual(event.timestamp_s, 0.0)
        self.assertEqual(event.path_index, 0)
        self.assertEqual(event.event_id, 1)
        self.assertEqual(event.step_id, observation.step_trace.step_id)
        self.assertEqual(event.namespace, "path")
        self.assertEqual(event.type, "checkpoint")
        self.assertEqual(event.severity, event_pb2.EVENT_SEVERITY_INFO)
        self.assertEqual(event.labels["name"], "C")
        self.assertEqual(event.metrics["path_index"], float(route.path.events[0].index))
        self.assertIn("timestamp_s", event.metrics)

        summary_event = responses[-1].finished.summary.events[0]
        self.assertEqual(summary_event.event_id, event.event_id)
        self.assertEqual(summary_event.namespace, "path")
        self.assertEqual(summary_event.type, "checkpoint")
        self.assertEqual(summary_event.labels["name"], "C")

    def test_stream_episode_final_step_trace_reports_truncation_reason(self) -> None:
        service = VehicleSimulationService()
        requests = iter(
            [
                pb2.ClientMessage(start=pb2.StartEpisodeRequest(control_period_s=0.01)),
                pb2.ClientMessage(stop=pb2.StopEpisodeRequest(reason="test_stop")),
            ]
        )

        finished = list(service.StreamEpisode(requests, None))[-1].finished

        self.assertEqual(finished.reason, "test_stop")
        self.assertEqual(finished.final_step_trace.reason, "test_stop")
        self.assertFalse(finished.final_step_trace.terminated)
        self.assertTrue(finished.final_step_trace.truncated)
        self.assertEqual(finished.final_step_trace.step_id, finished.summary.total_steps)

    def test_stream_episode_motor_command_advances_time(self) -> None:
        service = VehicleSimulationService()
        requests = iter(
            [
                pb2.ClientMessage(
                    start=pb2.StartEpisodeRequest(max_time_s=0.01, control_period_s=0.01)
                ),
                pb2.ClientMessage(
                    control_command=pb2.VehicleControlCommand(
                        sequence_id=0,
                        rear_left_target_speed=7.0,
                        rear_right_target_speed=7.0,
                    )
                ),
            ]
        )
        responses = list(service.StreamEpisode(requests, None))
        self.assertEqual(responses[-1].WhichOneof("payload"), "finished")
        self.assertGreaterEqual(responses[-1].finished.summary.elapsed_time_s, 0.01)

    def test_stream_episode_reports_kinematics_in_physical_units(self) -> None:
        service = VehicleSimulationService()
        requests = iter(
            [
                pb2.ClientMessage(
                    start=pb2.StartEpisodeRequest(max_time_s=0.02, control_period_s=0.01)
                ),
                pb2.ClientMessage(
                    control_command=pb2.VehicleControlCommand(
                        sequence_id=0,
                        rear_left_target_speed=7.0,
                        rear_right_target_speed=7.0,
                    )
                ),
                pb2.ClientMessage(stop=pb2.StopEpisodeRequest(reason="test_stop")),
            ]
        )

        responses = list(service.StreamEpisode(requests, None))

        initial_kinematics = responses[1].observation.kinematics
        moved_kinematics = responses[2].observation.kinematics
        self.assertAlmostEqual(initial_kinematics.longitudinal_velocity_m_s, 0.0)
        self.assertGreater(moved_kinematics.longitudinal_velocity_m_s, 0.0)
        self.assertAlmostEqual(moved_kinematics.lateral_velocity_m_s, 0.0)
        self.assertAlmostEqual(moved_kinematics.yaw_rate_rad_s, 0.0)

    def test_stream_episode_separates_line_sensor_from_reward_oracle(self) -> None:
        service = VehicleSimulationService()
        requests = iter(
            [
                pb2.ClientMessage(start=pb2.StartEpisodeRequest(control_period_s=0.01)),
                pb2.ClientMessage(stop=pb2.StopEpisodeRequest(reason="test_stop")),
            ]
        )

        observation = list(service.StreamEpisode(requests, None))[1].observation

        self.assertEqual(len(observation.line_sensor_darkness), 8)
        self.assertFalse(hasattr(observation, "line_sensor"))
        self.assertTrue(observation.HasField("oracle"))
        self.assertIsInstance(observation.oracle.cross_track_error_m, float)
        self.assertGreaterEqual(observation.oracle.heading_error_rad, -pi)
        self.assertLessEqual(observation.oracle.heading_error_rad, pi)

    def test_stream_episode_accepts_noise_config(self) -> None:
        service = VehicleSimulationService(
            noise_config=load_noise_config(REPO_ROOT / "examples" / "configs" / "noise" / "weak.yaml")
        )
        requests = iter(
            [
                pb2.ClientMessage(
                    start=pb2.StartEpisodeRequest(
                        control_period_s=0.01,
                    )
                ),
                pb2.ClientMessage(stop=pb2.StopEpisodeRequest(reason="test_stop")),
            ]
        )

        responses = list(service.StreamEpisode(requests, None))

        self.assertEqual([response.WhichOneof("payload") for response in responses], ["started", "observation", "finished"])

    def test_none_noise_config_matches_default_zero_initial_yaw(self) -> None:
        clean_service = VehicleSimulationService()
        none_service = VehicleSimulationService(
            noise_config=load_noise_config(REPO_ROOT / "examples" / "configs" / "noise" / "none.yaml")
        )
        requests = [
            pb2.ClientMessage(
                start=pb2.StartEpisodeRequest(
                    control_period_s=0.01,
                )
            ),
            pb2.ClientMessage(stop=pb2.StopEpisodeRequest(reason="test_stop")),
        ]

        clean_observation = list(clean_service.StreamEpisode(iter(requests), None))[1].observation
        none_observation = list(none_service.StreamEpisode(iter(requests), None))[1].observation

        self.assertAlmostEqual(clean_observation.imu.yaw_deg, 0.0)
        self.assertAlmostEqual(none_observation.imu.yaw_deg, clean_observation.imu.yaw_deg)


class _FakeRenderEpisode:
    timestep_s = 0.02

    def __init__(self) -> None:
        self.reset_progress_indices: list[int] = []
        self.close_count = 0

    def viewer_is_running(self) -> bool:
        return True

    def reset(
        self,
        *,
        initial_pose: tuple[float, float, float] | None = None,
        initial_progress_index: int = 0,
    ) -> None:
        del initial_pose
        self.reset_progress_indices.append(initial_progress_index)

    def close_viewer(self) -> None:
        self.close_count += 1


class _FakeStatePublisher:
    def __init__(self) -> None:
        self.sequence_ids: list[int] = []

    def publish(self, simulation) -> None:
        self.sequence_ids.append(int(simulation.sequence_id))

    def close(self) -> None:
        return None


if __name__ == "__main__":
    unittest.main()
