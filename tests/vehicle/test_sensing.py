import unittest

from artemis_mudri.vehicle.sensing import LineSensorArray


class LineSensorArrayTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sensor_array = LineSensorArray()

    def test_darkness_at_arc_centerline_is_high(self) -> None:
        self.assertGreater(self.sensor_array.darkness_at(self._point(1.6, 1.0)), 0.6)

    def test_darkness_at_straight_connector_is_zero(self) -> None:
        self.assertEqual(self.sensor_array.darkness_at(self._point(1.1, 1.0)), 0.0)
        self.assertEqual(self.sensor_array.darkness_at(self._point(1.1, 0.2)), 0.0)

    def test_darkness_away_from_track_is_zero(self) -> None:
        self.assertEqual(self.sensor_array.darkness_at(self._point(1.1, 0.6)), 0.0)

    def test_pose_sampling_detects_line_and_centroid_direction(self) -> None:
        reading = self.sensor_array.sense_pose(x=1.53, y=0.98, yaw=0.0)
        self.assertEqual(len(reading.digital_values), 8)
        self.assertEqual(reading.error_weights, (-4, -3, -2, -1, 1, 2, 3, 4))
        self.assertTrue(reading.line_detected)
        self.assertIsNotNone(reading.lateral_error_m)
        self.assertGreater(abs(reading.lateral_error_m or 0.0), 0.005)

    @staticmethod
    def _point(x: float, y: float):
        import numpy as np

        return np.array([x, y], dtype=np.float64)


if __name__ == "__main__":
    unittest.main()
