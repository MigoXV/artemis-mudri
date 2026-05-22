import math
import unittest

from artemis_mudri.track import ANCHORS, build_default_route


class RoutePlanTest(unittest.TestCase):
    def test_anchor_coordinates_match_problem_geometry(self) -> None:
        self.assertTupleEqual(tuple(ANCHORS["A"]), (0.6, 1.0))
        self.assertTupleEqual(tuple(ANCHORS["B"]), (1.6, 1.0))
        self.assertTupleEqual(tuple(ANCHORS["C"]), (1.6, 0.2))
        self.assertTupleEqual(tuple(ANCHORS["D"]), (0.6, 0.2))

    def test_default_route_path_length_matches_expected_segments(self) -> None:
        route = build_default_route()
        expected = 1.0 + math.pi * 0.4 + 1.0 + math.pi * 0.4
        self.assertAlmostEqual(route.path.total_length, expected, delta=0.03)

    def test_default_route_event_order_matches_statement(self) -> None:
        route = build_default_route()
        event_names = [event.name for event in route.path.events]
        self.assertEqual(event_names, ["B", "C", "D", "A"])


if __name__ == "__main__":
    unittest.main()
