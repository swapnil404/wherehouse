from fastapi import FastAPI, HTTPException, Depends, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from scipy.spatial import cKDTree   # for nearest-cell lookup

from model import *
from data import load_data, get_df
from scoring import (
    compute_subscores,
    evaluate_constraints,
    composite_score,
    DEFAULT_WEIGHTS,
    DEFAULT_WEIGHTS_WITH_ML,
)

app = FastAPI(
    title="Wherehouse Geo API",
    version="0.3.0",
    docs_url="/docs",          # interactive Swagger UI
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # tighten later
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

# Shared secret (put in env in real deploy)
API_TOKEN = "your-secret-token-here"

def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    if credentials.credentials != API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")
    return credentials

@app.on_event("startup")
def startup():
    load_data()                # load CSV once
    df = get_df()
    # Build a fast nearest-neighbour index for lat/lon → cell
    coords = df[["centroid_lat", "centroid_lon"]].values
    app.state.kdtree = cKDTree(coords)
    app.state.df = df
    print(f"Loaded {len(df):,} cells")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/v1/presets")
def get_presets(_: str = Depends(verify_token)):
    return {
        "warehouse": DEFAULT_WEIGHTS,
        "warehouse_with_ml": DEFAULT_WEIGHTS_WITH_ML,
    }

@app.post("/v1/score", response_model=ScoreResponse)
def score_point(
    req: ScoreRequest,
    _: str = Depends(verify_token),
):
    df = app.state.df
    tree = app.state.kdtree

    # 1. Find nearest H3 cell
    dist, idx = tree.query([req.point.lat, req.point.lon])
    row = df.iloc[idx]

    # 2. Compute (or reuse) subscores
    subs = compute_subscores(row)
    if req.include_ml:
        # you already have s_ml in the dataframe from training
        subs["ml"] = float(row.get("s_ml", 0))

    # 3. Weights
    weights = req.weights or (DEFAULT_WEIGHTS_WITH_ML if req.include_ml else DEFAULT_WEIGHTS)

    # 4. Composite
    score = composite_score(subs, weights)

    # 5. Constraints
    constraints = evaluate_constraints(row)
    eligible = all(c["pass"] for c in constraints)

    return ScoreResponse(
        h3_index=row["h3_index"],
        lat=float(row["centroid_lat"]),
        lon=float(row["centroid_lon"]),
        score=score,
        eligible=eligible,
        subscores=subs,
        constraints=[
            ConstraintResult(
                feature=c["feature"],
                op=c["op"],
                value=c["value"],
                actual=c["actual"],
                passed=c["pass"],
                message=c["message"],
            )
            for c in constraints
        ],
        is_hotspot=bool(row.get("is_hotspot", False)),
        is_underserved=bool(row.get("is_underserved", False)),
        cluster_id=int(row.get("cluster_id", -1)),
    )

@app.post("/v1/score/batch", response_model=BatchScoreResponse)
def score_batch(
    req: BatchScoreRequest,
    _: str = Depends(verify_token),
):
    if not req.points:
        raise HTTPException(400, "points is required for now")

    results = []
    for p in req.points:
        # reuse the single-point logic
        single = score_point(
            ScoreRequest(point=p, weights=req.weights, include_ml=req.include_ml),
            _="dummy",   # auth already checked
        )
        results.append(single)

    return BatchScoreResponse(results=results)