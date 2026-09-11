import unittest

import h3
import numpy as np

from hotspots import (
    classify_bin,
    classify_gi,
    dbscan_on_candidates,
    find_underserved,
    gi_star_scores,
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
        labels, clusters = dbscan_on_candidates(
            cells, scores, threshold=70.0, eps_km=1.5, min_samples=2
        )
        pocket_labels = {labels[cells.index(c)] for c in pocket}
        self.assertEqual(len(pocket_labels), 1)
        self.assertNotIn(-1, pocket_labels)
        self.assertTrue(all(
            labels[cells.index(c)] == -1 for c in cells if c not in pocket
        ))
        self.assertEqual(clusters[0]["size"], len(pocket))

    def test_no_candidates_no_clusters(self) -> None:
        cells = disk_cells()
        labels, clusters = dbscan_on_candidates(
            cells, np.full(len(cells), 10.0), threshold=70.0
        )
        self.assertEqual(clusters, [])
        self.assertTrue((labels == -1).all())


class UnderservedTests(unittest.TestCase):
    def test_high_demand_low_supply_flagged(self) -> None:
        cells = [
            {"h3_index": "cell-a", "subscores": {"demographics": 95, "poi": 5}},
            {"h3_index": "cell-b", "subscores": {"demographics": 93, "poi": 6}},
            {"h3_index": "cell-c", "subscores": {"demographics": 10, "poi": 90}},
            {"h3_index": "cell-d", "subscores": {"demographics": 50, "poi": 50}},
            {"h3_index": "cell-e", "subscores": {"demographics": 20, "poi": 20}},
        ]
        flagged = {r["h3_index"] for r in find_underserved(cells)}
        self.assertEqual(flagged, {"cell-a", "cell-b"})


if __name__ == "__main__":
    unittest.main()
