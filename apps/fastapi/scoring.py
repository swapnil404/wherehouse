"""
Wherehouse Scoring Engine (Clean - No ML, No Hotspots)
"""

import numpy as np
from typing import Dict, List, Any


DEFAULT_WEIGHTS = {
    "demographics": 0.06,
    "transportation": 0.28,
    "poi": 0.22,
    "zoning": 0.36,
    "flood": 0.06,
    "air_quality": 0.02,
}


def compute_subscores(row) -> Dict[str, float]:
    demo = 100 * (0.60 * row["target_income_fit"] + 0.40 * row["target_age_fit"])
    
    trans = 100 * (
        0.42 * min(row["road_density"] / 8.0, 1.0) + 
        0.65 * row["highway_access_score"]
    )
    
    poi = 100 * (
        0.50 * row["competition_score"]
        + 0.30 * row["complementary_score"]
        + 0.40 * row["anchor_score"]
    )
    
    zone_map = {
        "industrial": 95,
        "commercial": 55,
        "agricultural": 35,
        "residential": 15,
    }
    zoning = zone_map.get(row["dominant_zone_class"], 40)
    zoning = min(100, zoning + 0.70 * row["industrial_area_pct"])
    
    flood = 100 * row["flood_score"]
    air = 100 * row["air_quality_score"]

    return {
        "demographics": round(float(np.clip(demo, 0, 100)), 2),
        "transportation": round(float(np.clip(trans, 0, 100)), 2),
        "poi": round(float(np.clip(poi, 0, 100)), 2),
        "zoning": round(float(np.clip(zoning, 0, 100)), 2),
        "flood": round(float(np.clip(flood, 0, 100)), 2),
        "air_quality": round(float(np.clip(air, 0, 100)), 2),
    }


def evaluate_constraints(row) -> List[Dict[str, Any]]:
    constraints = []

    # 1. Must not be in SFHA
    actual = bool(row["in_sfha"])
    constraints.append({
        "feature": "in_sfha",
        "op": "==",
        "value": False,
        "actual": actual,
        "pass": actual is False,
        "message": "Must not be inside SFHA (100-year floodplain)"
    })

    # 2. Highway distance
    actual = float(row["highway_distance_km"])
    constraints.append({
        "feature": "highway_distance_km",
        "op": "<=",
        "value": 15.0,
        "actual": round(actual, 2),
        "pass": actual <= 15.0,
        "message": f"Highway distance {actual:.1f} km (max 15 km)"
    })

    # 3. Zone class
    actual = row["dominant_zone_class"]
    allowed = {"industrial", "commercial"}
    constraints.append({
        "feature": "dominant_zone_class",
        "op": "in",
        "value": list(allowed),
        "actual": actual,
        "pass": actual in allowed,
        "message": f"Zone class '{actual}' (prefer industrial/commercial)"
    })

    # 4. Industrial area percentage
    actual = float(row["industrial_area_pct"])
    constraints.append({
        "feature": "industrial_area_pct",
        "op": ">=",
        "value": 10.0,
        "actual": round(actual, 1),
        "pass": actual >= 10.0,
        "message": f"Industrial area {actual:.1f}% (min 10%)"
    })

    return constraints


def composite_score(subscores: dict, weights: dict = None) -> float:
    if weights is None:
        weights = DEFAULT_WEIGHTS

    total_w = sum(weights.values())
    if total_w == 0:
        return 0.0

    s = sum(weights.get(k, 0) * subscores.get(k, 0) for k in weights) / total_w
    return round(float(np.clip(s, 0, 100)), 2)


def client_rescore(subscores: dict, new_weights: dict) -> float:
    """Used by frontend for live weight re-scoring"""
    return composite_score(subscores, new_weights)