from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

from typer.testing import CliRunner

from artemis_mudri.simulation import DEFAULT_SIMULATION_PRESET
from artemis_mudri.simulation.state_publisher import build_state_message


REPO_ROOT = Path(__file__).resolve().parents[2]


def load_example_module(name: str):
    module_path = REPO_ROOT / "examples" / "remote_viewer" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


local_viewer = load_example_module("local_viewer")


class RemoteViewerExamplesTest(unittest.TestCase):
    def test_viewer_module_is_importable(self) -> None:
        self.assertTrue(hasattr(local_viewer, "app"))

    def test_state_message_contains_qpos_qvel_and_sequence_id(self) -> None:
        simulation = DEFAULT_SIMULATION_PRESET.build_simulation()

        message = build_state_message(simulation)

        json.dumps(message)
        self.assertEqual(set(message), {"time", "qpos", "qvel", "sequence_id", "pose", "kinematics"})
        self.assertIsInstance(message["qpos"], list)
        self.assertIsInstance(message["qvel"], list)
        self.assertEqual(len(message["qpos"]), simulation.model.nq)
        self.assertEqual(len(message["qvel"]), simulation.model.nv)
        self.assertEqual(message["sequence_id"], simulation.sequence_id)
        self.assertEqual(set(message["pose"]), {"x_m", "y_m", "yaw_rad"})
        self.assertEqual(set(message["kinematics"]), {"longitudinal_velocity_m_s", "yaw_rate_rad_s"})

    def test_apply_state_message_rejects_wrong_vector_lengths(self) -> None:
        simulation = DEFAULT_SIMULATION_PRESET.build_simulation()
        message = build_state_message(simulation)
        message["qpos"] = message["qpos"][:-1]

        with self.assertRaisesRegex(ValueError, "qpos length mismatch"):
            local_viewer.apply_state_message(simulation, message)

    def test_cli_defaults_use_loopback_addresses(self) -> None:
        runner = CliRunner()

        viewer_result = runner.invoke(local_viewer.app, ["--help"])

        self.assertEqual(viewer_result.exit_code, 0)
        self.assertIn("tcp://127.0.0.1:5555", viewer_result.output)


if __name__ == "__main__":
    unittest.main()
