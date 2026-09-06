# main.py
from contextlib import asynccontextmanager
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException, Depends, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from scipy.spatial import cKDTree  # for nearest-cell lookup

from config import ALLOWED_ORIGINS, GEO_SERVICE_TOKEN
from data import load_data, get_df
from schemas import (
    BatchScoreRequest,
    BatchScoreResponse,
    ConstraintResult,
    Point,
    ScoreRequest,
    ScoreResponse,
)
from scoring import (
    compute_subscores,
    evaluate_constraints,
    composite_score,
    DEFAULT_WEIGHTS,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_data()                # load CSV once
    df = get_df()
    # Build a fast nearest-neighbour index for lat/lon → cell
    coords = df[["centroid_lat", "centroid_lon"]].values
    app.state.kdtree = cKDTree(coords)
    app.state.df = df
    print(f"Loaded {len(df):,} cells")
    yield


# ---------- app ----------
app = FastAPI(
    title="Wherehouse Geo API",
    version="0.3.0",
    docs_url="/docs",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
)

security = HTTPBearer()


def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    if credentials.credentials != GEO_SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")
    return credentials


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
                id=c["id"],
                label=c["label"],
                actual=c["actual"],
                required=c["required"],
                pass_=c["pass"],
            )
            for c in constraints
        ],
    )


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
