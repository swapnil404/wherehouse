import unittest

import pandas as pd

from main import _build_heatmap_cells
from schemas import HeatmapResponse
from scoring import PRESET_WEIGHTS, composite_score, compute_subscores, prepare_scoring_data


def sample_frame() -> pd.DataFrame:
    return pd.DataFrame([
        {
            "h3_index": "8828308281fffff",
            "population_density": 100,
            "median_income": 80_000,
            "median_age": 40,
            "road_density": 2,
            "highway_distance_km": 1,
            "competitor_count_1km": 0,
            "competitor_count_5km": 1,
            "complementary_count_1km": 1,
            "complementary_count_5km": 2,
            "anchor_count_2km": 1,
            "anchor_count_5km": 2,
            "dominant_zone_class": "industrial",
            "commercial_area_pct": 5,
            "industrial_area_pct": 80,
            "flood_zone": "X",
            "in_sfha": False,
            "aqi": 40,
        },
        {
            "h3_index": "8828308283fffff",
            "population_density": 1_000,
            "median_income": 70_000,
            "median_age": 38,
            "road_density": 8,
            "highway_distance_km": 5,
            "competitor_count_1km": 3,
            "competitor_count_5km": 8,
            "complementary_count_1km": 8,
            "complementary_count_5km": 10,
            "anchor_count_2km": 5,
            "anchor_count_5km": 6,
            "dominant_zone_class": "commercial",
            "commercial_area_pct": 80,
            "industrial_area_pct": 5,
            "flood_zone": "X",
            "in_sfha": False,
            "aqi": 60,
        },
    ])


class HeatmapContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.frame = prepare_scoring_data(sample_frame())

    def test_subscores_have_exactly_six_named_values(self) -> None:
        expected = {"demographics", "transport", "poi", "zoning", "flood", "aqi"}
        for preset in PRESET_WEIGHTS:
            subscores = compute_subscores(self.frame.iloc[0], preset)
            self.assertEqual(set(subscores), expected)
            self.assertTrue(all(0 <= value <= 100 for value in subscores.values()))

    def test_retail_and_warehouse_invert_zone_preference(self) -> None:
        industrial = self.frame.iloc[0]
        commercial = self.frame.iloc[1]
        self.assertGreater(
            compute_subscores(industrial, "warehouse")["zoning"],
            compute_subscores(industrial, "retail")["zoning"],
        )
        self.assertGreater(
            compute_subscores(commercial, "retail")["zoning"],
            compute_subscores(commercial, "warehouse")["zoning"],
        )

    def test_heatmap_contract_omits_geometry_and_composite_score(self) -> None:
        cells = _build_heatmap_cells(self.frame, "warehouse")
        payload = HeatmapResponse(
            dataset_id="dataset-1",
            h3_resolution=8,
            preset="warehouse",
            cells=cells,
        ).model_dump(by_alias=True)
        self.assertEqual(
            set(payload["cells"][0]),
            {"h3Index", "eligible", "subscores"},
        )
        self.assertNotIn("geometry", payload["cells"][0])
        self.assertNotIn("score", payload["cells"][0])

    def test_client_formula_matches_composite_score(self) -> None:
        subscores = compute_subscores(self.frame.iloc[0], "warehouse")
        weights = PRESET_WEIGHTS["warehouse"]
        expected = round(
            sum(weights[name] * subscores[name] for name in weights) / sum(weights.values()),
            2,
        )
        self.assertEqual(composite_score(subscores, weights), expected)


if __name__ == "__main__":
    unittest.main()
