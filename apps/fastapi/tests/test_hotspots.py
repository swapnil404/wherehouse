import unittest

import h3
import numpy as np
import pandas as pd

from hotspots import (
    classify_bin,
    classify_gi,
    dbscan_on_candidates,
    find_underserved,
    gi_star_scores,
    normal_p_value,
)

CENTER = "8848984041fffff"


def disk_cells(k: int = 2) -> list:
    return sorted(h3.grid_disk(CENTER, k))


class GiStarTests(unittest.TestCase):
    def test_uniform_scores_give_zero_z(self) -> None:
        cells = disk_cells()
        z = gi_star_scores(cells, np.full(len(cells), 50.0))
        self.assertTrue((z == 0).all())

    def test_hot_pocket_outscores_background(self) -> None:
        cells = disk_cells(k=3)
        pocket = set(h3.grid_disk(CENTER, 1))
        scores = np.array([100.0 if c in pocket else 10.0 for c in cells])
        z = gi_star_scores(cells, scores, k=1)
        hot = np.array([c in pocket for c in cells])
        self.assertGreater(z[hot].mean(), z[~hot].mean())
        self.assertIn(cells[int(z.argmax())], pocket)

    def test_p_value_falls_with_z(self) -> None:
        self.assertAlmostEqual(normal_p_value(0.0), 1.0)
        self.assertLess(normal_p_value(1.96), 0.05)
        self.assertLess(normal_p_value(-2.5), normal_p_value(-1.0))

    def test_classify_thresholds(self) -> None:
        self.assertEqual(classify_gi(2.5), "hot")
        self.assertEqual(classify_gi(0.5), "warm")
        self.assertEqual(classify_gi(-0.5), "cool")
        self.assertEqual(classify_gi(-2.5), "cold")
        self.assertEqual(classify_bin(90, 25, 50, 75), "hot")
        self.assertEqual(classify_bin(10, 25, 50, 75), "cold")


class DbscanTests(unittest.TestCase):
    def test_adjacent_high_cells_cluster(self) -> None:
        cells = disk_cells(k=2)
        pocket = set(h3.grid_disk(CENTER, 1))
        scores = np.array([90.0 if c in pocket else 10.0 for c in cells])
        labels, clusters, confidence = dbscan_on_candidates(
            cells, scores, threshold=70.0, eps_km=1.5, min_samples=2
        )
        pocket_labels = {labels[cells.index(c)] for c in pocket}
        self.assertEqual(len(pocket_labels), 1)
        self.assertNotIn(-1, pocket_labels)
        self.assertTrue(all(
            labels[cells.index(c)] == -1 for c in cells if c not in pocket
        ))
        self.assertEqual(clusters[0]["size"], len(pocket))
        pocket_idx = [cells.index(c) for c in pocket]
        self.assertTrue((confidence[pocket_idx] > 0).all())
        self.assertTrue(
            (confidence[[i for i in range(len(cells)) if i not in pocket_idx]] == 0).all()
        )

    def test_no_candidates_no_clusters(self) -> None:
        cells = disk_cells()
        labels, clusters, confidence = dbscan_on_candidates(
            cells, np.full(len(cells), 10.0), threshold=70.0
        )
        self.assertEqual(clusters, [])
        self.assertTrue((labels == -1).all())
        self.assertTrue((confidence == 0).all())


class UnderservedTests(unittest.TestCase):
    def test_real_supply_fields_flag_dense_poi_poor_cells(self) -> None:
        frame = pd.DataFrame([
            {"h3_index": "cell-a", "population_density_percentile": 0.95, "poi_count": 1},
            {"h3_index": "cell-b", "population_density_percentile": 0.93, "poi_count": 2},
            {"h3_index": "cell-c", "population_density_percentile": 0.10, "poi_count": 40},
            {"h3_index": "cell-d", "population_density_percentile": 0.50, "poi_count": 20},
            {"h3_index": "cell-e", "population_density_percentile": 0.20, "poi_count": 5},
        ])
        flagged = {r["h3_index"] for r in find_underserved(frame)}
        self.assertEqual(flagged, {"cell-a", "cell-b"})

    def test_underserved_output_carries_raw_supply_counts(self) -> None:
        frame = pd.DataFrame([
            {"h3_index": "cell-a", "population_density_percentile": 0.99, "poi_count": 3},
            {"h3_index": "cell-b", "population_density_percentile": 0.01, "poi_count": 100},
        ])
        out = find_underserved(frame)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["supply"], 3)
        self.assertNotIn("subscores", out[0])


if __name__ == "__main__":
    unittest.main()
