# main.py
import os
from typing import Dict, List, Optional
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, Depends, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from scipy.spatial import cKDTree  # for nearest-cell lookup

from data import load_data, get_df
from scoring import (
    compute_subscores,
    evaluate_constraints,
    composite_score,
    DEFAULT_WEIGHTS,

)

# ---------- env (must come BEFORE add_middleware) ----------
API_TOKEN = os.getenv("API_TOKEN")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
allowed_origins = [o.strip() for o in CORS_ORIGINS]

# ---------- app ----------
app = FastAPI(
    title="Wherehouse Geo API",
    version="0.3.0",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
)

security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    if credentials.credentials != API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")
    return credentials

# ---------- schemas (inlined, was from model import *) ----------
class Point(BaseModel):
    lat: float
    lon: float

class ScoreRequest(BaseModel):
    point: Point
    weights: Optional[Dict[str, float]] = None

class ConstraintResult(BaseModel):
    feature: str
    op: str
    value: float
    actual: float
    passed: bool
    message: str = ""

class ScoreResponse(BaseModel):
    h3_index: str
    lat: float
    lon: float
    score: float
    eligible: bool
    subscores: Dict[str, float]
    constraints: List[ConstraintResult]
    is_hotspot: bool = False
    is_underserved: bool = False
    cluster_id: int = -1

class BatchScoreRequest(BaseModel):
    points: List[Point]
    weights: Optional[Dict[str, float]] = None

class BatchScoreResponse(BaseModel):
    results: List[ScoreResponse]

# ---------- core logic ----------
def _score_single(point: Point, weights: Optional[Dict[str, float]]) -> ScoreResponse:
    df = app.state.df
    tree = app.state.kdtree

    dist, idx = tree.query([point.lat, point.lon])
    row = df.iloc[idx]

    subs = compute_subscores(row)
    w = weights or DEFAULT_WEIGHTS
    score = composite_score(subs, w)

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

@app.on_event("startup")
def startup():
    load_data()
    df = get_df()
    coords = df[["centroid_lat", "centroid_lon"]].values
    app.state.kdtree = cKDTree(coords)
    app.state.df = df
    print(f"Loaded {len(df):,} cells")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/v1/presets")
def get_presets(_: str = Depends(verify_token)):
    return {"warehouse": DEFAULT_WEIGHTS}

@app.post("/v1/score", response_model=ScoreResponse)
def score_point(req: ScoreRequest, _: str = Depends(verify_token)):
    return _score_single(req.point, req.weights)

@app.post("/v1/score/batch", response_model=BatchScoreResponse)
def score_batch(req: BatchScoreRequest, _: str = Depends(verify_token)):
    if not req.points:
        raise HTTPException(400, "points is required for now")
    return BatchScoreResponse(
        results=[_score_single(p, req.weights) for p in req.points]
    )