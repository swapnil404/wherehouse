from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import numpy as np
import pandas as pd

from wherehouse_pipeline import reachability


def sample_cells() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"h3_index": "a", "centroid_lat": 30.1, "centroid_lon": -97.1, "population": 10},
            {"h3_index": "b", "centroid_lat": 30.2, "centroid_lon": -97.2, "population": 20},
            {"h3_index": "c", "centroid_lat": 30.3, "centroid_lon": -97.3, "population": 30},
        ]
    )


class RequestBlockTests(unittest.TestCase):
    def test_osrm_nulls_become_nan(self) -> None:
        response = Mock()
        response.json.return_value = {"code": "Ok", "durations": [[0, None], [5, 10]]}
        session = Mock()
        session.get.return_value = response

        result = reachability.request_duration_block(
            session,
            "http://localhost:5000",
            sample_cells().iloc[:2],
            sample_cells().iloc[1:],
        )

        self.assertEqual(result.shape, (2, 2))
        self.assertTrue(np.isnan(result[0, 1]))
        session.get.assert_called_once()
        response.raise_for_status.assert_called_once()


class CheckpointTests(unittest.TestCase):
    def test_second_matrix_build_reuses_checkpoint(self) -> None:
        cells = sample_cells()
        block = np.array([[0, 60, 120], [60, 0, 60], [120, 60, 0]], dtype=np.float32)
        session = Mock()
        with tempfile.TemporaryDirectory() as directory:
            original = reachability.REACHABILITY_CHECKPOINT_DIR
            reachability.REACHABILITY_CHECKPOINT_DIR = Path(directory)
            try:
                with unittest.mock.patch.object(
                    reachability, "request_duration_block", return_value=block
                ) as request:
                    first = reachability.build_duration_matrix(
                        cells,
                        "dataset",
                        "car",
                        "http://localhost:5000",
                        source_chunk_size=3,
                        destination_chunk_size=3,
                        session=session,
                    )
                    second = reachability.build_duration_matrix(
                        cells,
                        "dataset",
                        "car",
                        "http://localhost:5000",
                        source_chunk_size=3,
                        destination_chunk_size=3,
                        session=session,
                    )
                self.assertEqual(request.call_count, 1)
                np.testing.assert_array_equal(first, second)
            finally:
                reachability.REACHABILITY_CHECKPOINT_DIR = original


class PackingAndValidationTests(unittest.TestCase):
    def test_rows_are_inclusive_and_population_is_summed(self) -> None:
        cells = sample_cells()
        durations = np.array(
            [[0, 500, 1500], [500, 0, 700], [1500, 700, 0]], dtype=np.float32
        )
        rows = reachability.reachability_rows("dataset", cells, "car", durations)
        source_a = {row["band_minutes"]: row for row in rows if row["source_h3_index"] == "a"}

        self.assertEqual(source_a[10]["destination_h3_indexes"], ["a", "b"])
        self.assertEqual(source_a[10]["catchment_population"], 30)
        self.assertEqual(source_a[30]["destination_h3_indexes"], ["a", "b", "c"])
        self.assertEqual(source_a[30]["catchment_population"], 60)

    def test_complete_car_and_foot_rows_validate(self) -> None:
        cells = sample_cells()
        durations = np.zeros((3, 3), dtype=np.float32)
        rows = []
        for mode in reachability.MODE_BANDS:
            rows.extend(reachability.reachability_rows("dataset", cells, mode, durations))

        checks = reachability.validate_reachability_frame(
            pd.DataFrame(rows), "dataset", cells
        )

        self.assertTrue(all(check.passed for check in checks), checks)

    def test_validation_rejects_non_nested_bands(self) -> None:
        cells = sample_cells()
        durations = np.zeros((3, 3), dtype=np.float32)
        rows = []
        for mode in reachability.MODE_BANDS:
            rows.extend(reachability.reachability_rows("dataset", cells, mode, durations))
        frame = pd.DataFrame(rows)
        target = (frame["source_h3_index"] == "a") & (frame["mode"] == "car")
        target &= frame["band_minutes"] == 20
        frame.loc[target, "destination_h3_indexes"] = pd.Series([["a"]], index=frame.index[target])
        frame.loc[target, "destination_count"] = 1
        frame.loc[target, "catchment_population"] = 10

        checks = reachability.validate_reachability_frame(frame, "dataset", cells)
        nested = next(check for check in checks if check.name == "reach_nested_bands")

        self.assertFalse(nested.passed)


if __name__ == "__main__":
    unittest.main()
