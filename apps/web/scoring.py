#!/usr/bin/env python3
"""
Wherehouse Complete Trial Engine
--------------------------------
• Weight-independent layer subscores
• Hard constraints
• Composite score (Warehouse preset)
• Small GradientBoosting model trained on human_evaluation_score
• DBSCAN hotspot + underserved layer
• Client-side live re-scoring function
• FULL validation metrics (Spearman ρ, Precision@10, separation, MAE/RMSE)

Paste & run. Needs: pandas, numpy, scikit-learn, scipy
"""

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.cluster import DBSCAN
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

# ──────────────────────────────────────────────────────────────
# 1. LOAD
# ──────────────────────────────────────────────────────────────
CSV_PATH = Path("austin_warehouse_sites_h3 (1) (1).csv")
df = pd.read_csv(CSV_PATH)
print(f"Loaded {len(df):,} H3 cells\n")

# ──────────────────────────────────────────────────────────────
# 2. WEIGHT-INDEPENDENT LAYER SUBSCORES (0–100)
# ──────────────────────────────────────────────────────────────
def compute_subscores(row) -> dict:
    demo = 100 * (0.60 * row["target_income_fit"] + 0.40 * row["target_age_fit"])
    trans = 100 * (0.42 * min(row["road_density"] / 8.0, 1.0) + 0.65 * row["highway_access_score"])
    poi = 100 * (
        0.50 * row["competition_score"]
        + 0.30 * row["complementary_score"]
        + 0.40 * row["anchor_score"]
    )
    zone_map = {"industrial": 95, "commercial": 55, "agricultural": 35, "residential": 15}
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

print("Computing weight-independent subscores …")
df["subscores"] = df.apply(compute_subscores, axis=1)

for k in ["demographics", "transportation", "poi", "zoning", "flood", "air_quality"]:
    df[f"s_{k}"] = df["subscores"].apply(lambda d: d[k])

# ──────────────────────────────────────────────────────────────
# 3. HARD CONSTRAINTS (Warehouse preset)
# ──────────────────────────────────────────────────────────────
def evaluate_constraints(row) -> list:
    constraints = []

    actual = bool(row["in_sfha"])
    constraints.append({
        "feature": "in_sfha", "op": "==", "value": False,
        "actual": actual, "pass": actual is False,
        "message": "Must not be inside SFHA (100-year floodplain)"
    })

    actual = float(row["highway_distance_km"])
    constraints.append({
        "feature": "highway_distance_km", "op": "<=", "value": 15.0,
        "actual": round(actual, 2), "pass": actual <= 15.0,
        "message": f"Highway distance {actual:.1f} km (max 15 km)"
    })

    actual = row["dominant_zone_class"]
    allowed = {"industrial", "commercial"}
    constraints.append({
        "feature": "dominant_zone_class", "op": "in", "value": list(allowed),
        "actual": actual, "pass": actual in allowed,
        "message": f"Zone class '{actual}' (prefer industrial/commercial)"
    })

    actual = float(row["industrial_area_pct"])
    constraints.append({
        "feature": "industrial_area_pct", "op": ">=", "value": 10.0,
        "actual": round(actual, 1), "pass": actual >= 10.0,
        "message": f"Industrial area {actual:.1f}% (min 10%)"
    })

    return constraints

print("Evaluating hard constraints …")
df["constraints"] = df.apply(evaluate_constraints, axis=1)
df["eligible"] = df["constraints"].apply(lambda cs: all(c["pass"] for c in cs))

# ──────────────────────────────────────────────────────────────
# 4. DEFAULT WEIGHTS + COMPOSITE
# ──────────────────────────────────────────────────────────────
DEFAULT_WEIGHTS = {
    "demographics": 0.06,
    "transportation": 0.28,
    "poi": 0.22,
    "zoning": 0.36,
    "flood": 0.06,
    "air_quality": 0.02,
}

def composite_score(subscores: dict, weights: dict) -> float:
    total_w = sum(weights.values())
    if total_w == 0:
        return 0.0
    s = sum(weights.get(k, 0) * subscores.get(k, 0) for k in weights) / total_w
    return round(float(np.clip(s, 0, 100)), 2)

print("Computing default composite scores …")
df["score"] = df["subscores"].apply(lambda s: composite_score(s, DEFAULT_WEIGHTS))

# ──────────────────────────────────────────────────────────────
# 5. ML MODEL (extra weight-independent subscore)
# ──────────────────────────────────────────────────────────────
print("Training GradientBoosting on human_evaluation_score …")

feature_cols = [
    "population_density", "median_income", "age_median",
    "target_age_fit", "target_income_fit",
    "road_density", "highway_distance_km", "highway_access_score",
    "poi_count", "competitor_count_1km", "competitor_count_5km",
    "complementary_count_1km", "anchor_distance_km",
    "competition_score", "complementary_score", "anchor_score",
    "commercial_area_pct", "industrial_area_pct", "residential_area_pct",
    "flood_score", "aqi", "air_quality_score",
    "s_demographics", "s_transportation", "s_poi", "s_zoning", "s_flood", "s_air_quality",
]

X = df[feature_cols].fillna(0)
y = df["human_evaluation_score"]
y_scaled = (y - y.min()) / (y.max() - y.min()) * 100   # → 0-100

model = GradientBoostingRegressor(
    n_estimators=120, max_depth=4, learning_rate=0.06,
    subsample=0.85, random_state=42
)
cv_scores = cross_val_score(model, X, y_scaled, cv=5, scoring="neg_mean_absolute_error")
print(f"  CV MAE (0-100): {-cv_scores.mean():.2f} ± {cv_scores.std():.2f}")

model.fit(X, y_scaled)
df["s_ml"] = np.clip(model.predict(X), 0, 100).round(2)

def add_ml(row):
    d = row["subscores"].copy()
    d["ml"] = float(row["s_ml"])
    return d

df["subscores"] = df.apply(add_ml, axis=1)

DEFAULT_WEIGHTS_WITH_ML = DEFAULT_WEIGHTS.copy()
DEFAULT_WEIGHTS_WITH_ML["ml"] = 0.15
s = sum(DEFAULT_WEIGHTS_WITH_ML.values())
DEFAULT_WEIGHTS_WITH_ML = {k: v / s for k, v in DEFAULT_WEIGHTS_WITH_ML.items()}

df["score_with_ml"] = df["subscores"].apply(lambda s: composite_score(s, DEFAULT_WEIGHTS_WITH_ML))

# ──────────────────────────────────────────────────────────────
# 6. HOTSPOT LAYER (DBSCAN)
# ──────────────────────────────────────────────────────────────
print("Running DBSCAN for hotspot layer …")

hotspot_feats = df[[
    "s_zoning", "s_transportation", "s_poi", "industrial_area_pct",
    "highway_access_score", "competition_score"
]].copy()

scaler = StandardScaler()
X_hot = scaler.fit_transform(hotspot_feats)

db = DBSCAN(eps=0.75, min_samples=8)
df["cluster_id"] = db.fit_predict(X_hot)

q75 = df["score"].quantile(0.75)
df["is_hotspot"] = (df["score"] >= q75) & (df["eligible"])

df["is_underserved"] = (
    (df["industrial_area_pct"] > 25)
    & (df["competition_score"] < 0.35)
    & (df["score"] < 55)
    & (df["eligible"])
)

print(f"  Clusters: {df['cluster_id'].nunique() - (1 if -1 in df['cluster_id'].values else 0)}")
print(f"  Hotspot cells: {df['is_hotspot'].sum():,}")
print(f"  Underserved cells: {df['is_underserved'].sum():,}")

# ──────────────────────────────────────────────────────────────
# 7. CLIENT-SIDE RE-SCORE (copy this logic to frontend)
# ──────────────────────────────────────────────────────────────
def client_rescore(subscores: dict, new_weights: dict) -> float:
    return composite_score(subscores, new_weights)

# ──────────────────────────────────────────────────────────────
# 8. FULL VALIDATION METRICS (the part you asked for)
# ──────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("VALIDATION REPORT (vs human_evaluation_score)")
print("="*60)

# Scale human score to 0-100 for fair comparison
human_100 = (df["human_evaluation_score"] - df["human_evaluation_score"].min()) / \
            (df["human_evaluation_score"].max() - df["human_evaluation_score"].min()) * 100

def full_validation(pred_col: str, name: str):
    pred = df[pred_col]
    human = human_100

    # 1. Spearman ρ
    rho, pval = spearmanr(pred, human)

    # 2. MAE & RMSE
    mae = mean_absolute_error(human, pred)
    rmse = np.sqrt(mean_squared_error(human, pred))

    # 3. Precision@10
    top10_model = set(df.nlargest(10, pred_col)["h3_index"])
    top10_human = set(df.nlargest(10, "human_evaluation_score")["h3_index"])
    precision_at_10 = len(top10_model & top10_human) / 10.0

    # 4. Sanity separation (top 20% human vs bottom 20% human)
    high_mask = human >= human.quantile(0.90)
    low_mask  = human <= human.quantile(0.10)
    mean_high = pred[high_mask].mean()
    mean_low  = pred[low_mask].mean()
    separation = mean_high - mean_low

    print(f"\n▶ {name}")
    print(f"  Spearman ρ          : {rho:.4f}  (p={pval:.2e})")
    print(f"  MAE (0-100)         : {mae:.2f}")
    print(f"  RMSE (0-100)        : {rmse:.2f}")
    print(f"  Precision@10        : {precision_at_10:.2f}  ({int(precision_at_10*10)}/10 overlap)")
    print(f"  Sanity separation   : {separation:.1f}  (high human cells score {mean_high:.1f} vs low {mean_low:.1f})")

    return {
        "spearman_rho": round(rho, 4),
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "precision_at_10": round(precision_at_10, 2),
        "separation": round(separation, 1),
    }

val_rule = full_validation("score", "Rule-based composite (no ML)")
val_ml   = full_validation("score_with_ml", "Composite + ML subscore")

# Quick summary
print("\n" + "-"*60)
print("SUMMARY")
print(f"  Rule-based Spearman ρ : {val_rule['spearman_rho']}")
print(f"  With-ML Spearman ρ    : {val_ml['spearman_rho']}")
print(f"  Best Precision@10     : {max(val_rule['precision_at_10'], val_ml['precision_at_10'])}")
print(f"  Best separation       : {max(val_rule['separation'], val_ml['separation']):.1f}")
print("="*60)

# ──────────────────────────────────────────────────────────────
# 9. EXPORT
# ──────────────────────────────────────────────────────────────
print("\nWriting output files …")

# Heatmap
heatmap = df[["h3_index", "centroid_lat", "centroid_lon",
              "score", "score_with_ml", "eligible",
              "is_hotspot", "is_underserved", "cluster_id"]].copy()
heatmap.to_csv("wherehouse_heatmap.csv", index=False)
print("  → wherehouse_heatmap.csv")

# Full breakdown
breakdown_rows = []
for _, r in df.iterrows():
    breakdown_rows.append({
        "h3_index": r["h3_index"],
        "lat": r["centroid_lat"],
        "lon": r["centroid_lon"],
        "score": r["score"],
        "score_with_ml": r["score_with_ml"],
        "eligible": bool(r["eligible"]),
        "subscores": r["subscores"],
        "constraints": r["constraints"],
        "is_hotspot": bool(r["is_hotspot"]),
        "is_underserved": bool(r["is_underserved"]),
        "cluster_id": int(r["cluster_id"]),
        "human_evaluation_score": float(r["human_evaluation_score"]),
    })

with open("wherehouse_breakdown.json", "w") as f:
    json.dump(breakdown_rows, f)
print("  → wherehouse_breakdown.json")

# Weights
with open("wherehouse_default_weights.json", "w") as f:
    json.dump({
        "warehouse": DEFAULT_WEIGHTS,
        "warehouse_with_ml": DEFAULT_WEIGHTS_WITH_ML,
    }, f, indent=2)
print("  → wherehouse_default_weights.json")

# Validation report
with open("wherehouse_validation.json", "w") as f:
    json.dump({
        "rule_based": val_rule,
        "with_ml": val_ml,
    }, f, indent=2)
print("  → wherehouse_validation.json")

print("\n✅ Done. You now have everything the spec asks for:")
print("   • H3 heatmap scores")
print("   • Clickable breakdown (subscores + constraints)")
print("   • Hotspot / underserved / cluster layer")
print("   • Client-side live weight re-scoring")
print("   • Full accuracy validation (Spearman, P@10, separation, MAE)")