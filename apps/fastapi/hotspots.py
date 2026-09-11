"""Hotspot analytics for the Wherehouse Geo API.

Three methods (spec section 6), all running on the cached heatmap
subscores for one preset:

- ``gi_star``  - Getis-Ord Gi* statistic: is a cell surrounded by
  high (or low) scores, beyond what chance would produce?
- ``dbscan``   - Density clustering of high-score cells into named
  clusters (with noise points left out).
- ``binning``  - Simple quartile bins of the composite score.

Plus ``underserved`` detection: many residents but few real POIs.
This is general retail/service underservice and must never be
presented as EV charger underservice — no charger data exists.
"""

import math

import h3
import numpy as np
from sklearn.cluster import DBSCAN

EARTH_RADIUS_KM = 6371.0088


def normal_p_value(z: float) -> float:
    """Two-tailed p-value for a z-score under the standard normal."""
    return float(math.erfc(abs(z) / math.sqrt(2)))


def cell_composites(cells, weights) -> np.ndarray:
    """Composite score per cached cell under the given weights."""
    total = sum(weights.values()) or 1.0
    return np.array(
        [sum(weights.get(k, 0) * c["subscores"].get(k, 0) for k in weights) / total
         for c in cells],
        dtype=float,
    )


def gi_star_scores(h3_list: list, scores: np.ndarray, k: int = 2) -> np.ndarray:
    """Getis-Ord Gi* z-score per cell over its k-ring neighbourhood.

    Binary weights, focal cell included. Positive z = hotspot,
    negative z = coldspot. |z| >= 1.96 is significant at p < 0.05.
    """
    n = len(scores)
    index = {h: i for i, h in enumerate(h3_list)}
    mean = float(scores.mean())
    s = float(scores.std())  # population std, Gi* convention
    z = np.zeros(n)
    if s == 0:
        return z
    for i, h in enumerate(h3_list):
        try:
            ring = h3.grid_disk(h, k)
        except ValueError:
            continue
        nbrs = [index[c] for c in ring if c in index]
        if not nbrs:
            continue
        w_sum = float(len(nbrs))
        sum_wx = float(scores[nbrs].sum())
        denom = s * (((n * w_sum - w_sum * w_sum) / (n - 1)) ** 0.5)
        z[i] = (sum_wx - mean * w_sum) / denom if denom else 0.0
    return z


def classify_gi(z: float) -> str:
    if z >= 1.96:
        return "hot"
    if z > 0:
        return "warm"
    if z <= -1.96:
        return "cold"
    return "cool"


def classify_bin(score: float, q1: float, q2: float, q3: float) -> str:
    if score >= q3:
        return "hot"
    if score >= q2:
        return "warm"
    if score >= q1:
        return "cool"
    return "cold"


def dbscan_on_candidates(
    h3_list: list,
    scores: np.ndarray,
    threshold: float = 70.0,
    eps_km: float = 1.5,
    min_samples: int = 4,
):
    """Cluster cells scoring >= threshold.

    Returns (labels, clusters, confidences). labels aligns with h3_list
    (-1 = noise / below threshold). clusters holds one dict per found
    cluster with centroid + members. confidences aligns with h3_list:
    1.0 for core members, 0.75 for border members, 0.0 for noise.
    """
    labels = np.full(len(scores), -1)
    confidence = np.zeros(len(scores))
    mask = scores >= threshold
    idx = np.where(mask)[0]
    clusters = []
    if len(idx) >= min_samples:
        coords = np.array(
            [h3.cell_to_latlng(h3_list[i]) for i in idx]
        )
        radians = np.radians(coords)
        db = DBSCAN(
            eps=eps_km / EARTH_RADIUS_KM,
            min_samples=min_samples,
            metric="haversine",
        ).fit(radians)
        core = np.zeros(len(idx), dtype=bool)
        core[db.core_sample_indices_] = True
        for j, lab in enumerate(db.labels_):
            labels[idx[j]] = int(lab)
            if lab != -1:
                confidence[idx[j]] = 1.0 if core[j] else 0.75
        for lab in sorted(set(db.labels_) - {-1}):
            members = idx[db.labels_ == lab]
            mcoords = coords[db.labels_ == lab]
            clusters.append({
                "cluster_id": int(lab),
                "size": int(len(members)),
                "mean_score": round(float(scores[members].mean()), 2),
                "centroid_lat": round(float(mcoords[:, 0].mean()), 6),
                "centroid_lon": round(float(mcoords[:, 1].mean()), 6),
                "cells": [h3_list[i] for i in members],
            })
    return labels, clusters, confidence


def find_underserved(frame) -> list:
    """Cells with many residents but few real POIs.

    Demand is the prepared ``population_density_percentile`` (0-100) and
    supply is the raw ``poi_count`` — both real fields, never blended
    suitability subscores. General retail/service underservice only:
    do not present this as EV charging underservice, no charger data
    exists.
    """
    demand = frame["population_density_percentile"].to_numpy(dtype=float) * 100.0
    supply = frame["poi_count"].fillna(0).to_numpy(dtype=float)
    d_hi, s_lo = float(np.percentile(demand, 75)), float(np.percentile(supply, 25))
    out = [
        {
            "h3_index": str(h3_index),
            "demand": round(float(d), 1),
            "supply": int(s),
        }
        for h3_index, d, s in zip(frame["h3_index"], demand, supply)
        if d >= d_hi and s <= s_lo
    ]
    out.sort(key=lambda r: r["demand"], reverse=True)
    return out
