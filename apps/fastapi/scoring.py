"""Formula-only scoring for the active H3 facts."""

from typing import Any, Dict, List

import numpy as np
import pandas as pd


PRESET_WEIGHTS = {
    "warehouse": {
        "demographics": 0.06, "transport": 0.28, "poi": 0.22,
        "zoning": 0.36, "flood": 0.06, "aqi": 0.02,
    },
    "retail": {
        "demographics": 0.28, "transport": 0.12, "poi": 0.30,
        "zoning": 0.14, "flood": 0.10, "aqi": 0.06,
    },
    # EV charging: corridor visibility (transport) and dwell-time amenities
    # (poi: food/retail while charging) dominate; demographics captures
    # passing traffic and local adoption; zoning/flood are secondary.
    # Initial values — Megha to tune against the validation set (spec 8.6).
    "ev": {
        "demographics": 0.20, "transport": 0.30, "poi": 0.22,
        "zoning": 0.14, "flood": 0.08, "aqi": 0.06,
    },
}
DEFAULT_WEIGHTS = PRESET_WEIGHTS["warehouse"]

PRESET_CONFIG = {
    "warehouse": {
        "income_target": 80_000, "income_width": 45_000,
        "age_target": 40, "age_width": 22, "highway_scale_km": 10,
        "competitor_column": "competitor_count_5km", "competitor_target": 0,
        "competitor_width": 3,
        "complementary_column": "complementary_count_5km_percentile",
        "anchor_column": "anchor_count_5km_percentile",
        "zone_scores": {"industrial": 95, "commercial": 55, "agricultural": 35, "residential": 15},
        "zone_bonus_column": "industrial_area_pct", "zone_bonus_scale": 0.50,
    },
    "retail": {
        "income_target": 70_000, "income_width": 30_000,
        "age_target": 38, "age_width": 18, "highway_scale_km": 3,
        "competitor_column": "competitor_count_1km", "competitor_target": 3,
        "competitor_width": 2,
        "complementary_column": "complementary_count_1km_percentile",
        "anchor_column": "anchor_count_2km_percentile",
        "zone_scores": {"industrial": 25, "commercial": 95, "agricultural": 15, "residential": 45},
        "zone_bonus_column": "commercial_area_pct", "zone_bonus_scale": 0.25,
    },
    # EV charging formula. Rationale per layer:
    # - income band set above retail: early EV adoption skews higher-income.
    # - highway scale 5 km: corridor visibility matters, tighter than
    #   warehouse (10 km) but looser than retail (3 km).
    # - competition: competitor_count_2km counts warehouse/industrial
    #   competitors from the ingestion pipeline — NOT charging stations.
    #   We have no charger-location data, so the term peaks at 0 nearby
    #   competitors (avoid industrial friction), and must never be
    #   presented as EV charger coverage.
    # - complementary uses the 2 km ring: amenities worth a charging stop.
    # - commercial frontage preferred; industrial acceptable for depots.
    "ev": {
        "income_target": 85_000, "income_width": 40_000,
        "age_target": 38, "age_width": 18, "highway_scale_km": 5,
        "competitor_column": "competitor_count_2km", "competitor_target": 0,
        "competitor_width": 2,
        "complementary_column": "complementary_count_2km_percentile",
        "anchor_column": "anchor_count_2km_percentile",
        "zone_scores": {"industrial": 60, "commercial": 95, "agricultural": 15, "residential": 40},
        "zone_bonus_column": "commercial_area_pct", "zone_bonus_scale": 0.25,
    },
}

PERCENTILE_COLUMNS = (
    "population_density", "road_density", "complementary_count_1km",
    "complementary_count_2km", "complementary_count_5km", "anchor_count_2km",
    "anchor_count_5km", "aqi",
)


def prepare_scoring_data(frame: pd.DataFrame) -> pd.DataFrame:
    """Add metro-wide percentile ranks once, before serving requests."""
    prepared = frame.copy()
    for column in PERCENTILE_COLUMNS:
        numeric = pd.to_numeric(prepared[column], errors="coerce")
        if numeric.notna().any():
            numeric = numeric.fillna(numeric.median())
            prepared[f"{column}_percentile"] = numeric.rank(method="average", pct=True)
        else:
            prepared[f"{column}_percentile"] = 0.5
    return prepared


def _band_fit(value: Any, target: float, width: float) -> float:
    if value is None or pd.isna(value):
        return 0.5
    return float(np.exp(-((float(value) - target) ** 2) / (2 * width**2)))


def compute_subscores(row: Any, preset: str = "warehouse") -> Dict[str, float]:
    config = PRESET_CONFIG[preset]
    income_fit = _band_fit(row["median_income"], config["income_target"], config["income_width"])
    age_fit = _band_fit(row["median_age"], config["age_target"], config["age_width"])
    demographics = 100 * (
        0.40 * row["population_density_percentile"] + 0.35 * income_fit + 0.25 * age_fit
    )

    highway_access = np.exp(-float(row["highway_distance_km"]) / config["highway_scale_km"])
    transport = 100 * (0.40 * row["road_density_percentile"] + 0.60 * highway_access)

    competitor_count = float(row[config["competitor_column"]])
    competition = np.exp(
        -((competitor_count - config["competitor_target"]) ** 2)
        / (2 * config["competitor_width"] ** 2)
    )
    poi = 100 * (
        0.45 * competition
        + 0.30 * row[config["complementary_column"]]
        + 0.25 * row[config["anchor_column"]]
    )

    zone_class = str(row["dominant_zone_class"]).lower()
    zoning = float(config["zone_scores"].get(zone_class, 40))
    bonus = config["zone_bonus_scale"] * float(row[config["zone_bonus_column"]])
    zoning = min(100, zoning + bonus)

    flood = 0 if bool(row["in_sfha"]) else (100 if str(row["flood_zone"]).upper() == "X" else 55)
    aqi = 100 * (1 - float(row["aqi_percentile"]))
    values = {
        "demographics": demographics, "transport": transport, "poi": poi,
        "zoning": zoning, "flood": flood, "aqi": aqi,
    }
    return {name: round(float(np.clip(value, 0, 100)), 2) for name, value in values.items()}


def evaluate_constraints(row: Any, preset: str = "warehouse") -> List[Dict[str, Any]]:
    in_sfha = bool(row["in_sfha"])
    constraints: List[Dict[str, Any]] = [{
        "id": "in_sfha", "label": "Must not be inside SFHA (100-year floodplain)",
        "actual": in_sfha, "required": False, "pass": not in_sfha,
    }]

    zone_class = str(row["dominant_zone_class"]).lower()
    if preset == "warehouse":
        highway_distance = float(row["highway_distance_km"])
        constraints.append({
            "id": "highway_distance_km",
            "label": f"Highway distance {highway_distance:.1f} km (max 15 km)",
            "actual": round(highway_distance, 2), "required": 15.0,
            "pass": highway_distance <= 15.0,
        })
        allowed = ["industrial", "commercial"]
        constraints.append({
            "id": "dominant_zone_class",
            "label": f"Zone class '{zone_class}' (requires industrial/commercial)",
            "actual": zone_class, "required": allowed, "pass": zone_class in allowed,
        })
        industrial_pct = float(row["industrial_area_pct"])
        constraints.append({
            "id": "industrial_area_pct",
            "label": f"Industrial area {industrial_pct:.1f}% (min 10%)",
            "actual": round(industrial_pct, 1), "required": 10.0,
            "pass": industrial_pct >= 10.0,
        })
    else:
        allowed = ["commercial", "residential"]
        constraints.append({
            "id": "dominant_zone_class",
            "label": f"Zone class '{zone_class}' (requires commercial/residential)",
            "actual": zone_class, "required": allowed, "pass": zone_class in allowed,
        })
    if preset == "ev":
        # EV charging constraints. Rationale:
        # - commercial frontage for visibility and dwell amenities;
        #   industrial allowed for fleet/depot charging. This replaces the
        #   retail zone rule above, which does not admit industrial.
        # - 5 km highway cap mirrors the scoring scale: beyond that the
        #   site is not a corridor stop.
        # - No commercial-area floor: it would wrongly reject the
        #   industrial sites this preset explicitly admits.
        constraints = [c for c in constraints if c["id"] != "dominant_zone_class"]
        allowed = ["commercial", "industrial"]
        constraints.append({
            "id": "dominant_zone_class",
            "label": f"Zone class '{zone_class}' (requires commercial/industrial)",
            "actual": zone_class, "required": allowed, "pass": zone_class in allowed,
        })
        highway_distance = float(row["highway_distance_km"])
        constraints.append({
            "id": "highway_distance_km",
            "label": f"Highway distance {highway_distance:.1f} km (max 5 km)",
            "actual": round(highway_distance, 2), "required": 5.0,
            "pass": highway_distance <= 5.0,
        })
    elif preset not in ("warehouse", "retail"):
        raise ValueError(f"Unknown scoring preset: {preset!r}")
    return constraints


def composite_score(subscores: dict, weights: dict | None = None) -> float:
    selected_weights = weights or DEFAULT_WEIGHTS
    total_weight = sum(selected_weights.values())
    if total_weight == 0:
        return 0.0
    score = sum(
        selected_weights.get(name, 0) * subscores.get(name, 0)
        for name in selected_weights
    ) / total_weight
    return round(float(np.clip(score, 0, 100)), 2)
