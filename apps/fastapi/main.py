# main.py
from contextlib import asynccontextmanager
from typing import Dict, Optional

import h3
from fastapi import FastAPI, HTTPException, Depends, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware

from config import ALLOWED_ORIGINS, GEO_SERVICE_TOKEN
from data import get_cell_index, get_df, get_h3_resolution, load_data
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

MAX_BATCH_POINTS = 5000


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_data()                # load CSV once
    app.state.df = get_df()
    app.state.h3_res = get_h3_resolution()
    app.state.cell_index = get_cell_index()  # exact h3_index -> row
    print(f"Loaded {len(app.state.df):,} cells at H3 res {app.state.h3_res}")
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


def _lookup_row(point: Point):
    """Exact H3 containing-cell lookup. Raises 422 when uncovered."""
    try:
        cell = h3.latlng_to_cell(point.lat, point.lon, app.state.h3_res)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "POINT_OUT_OF_BOUNDS",
                "message": f"Point ({point.lat}, {point.lon}) is out of bounds.",
            },
        )
    pos = app.state.cell_index.get(cell)
    if pos is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "POINT_OUT_OF_BOUNDS",
                "message": f"Point ({point.lat}, {point.lon}) is outside the covered area.",
                "cell": cell,
            },
        )
    return app.state.df.iloc[pos]


# ---------- core logic ----------
def _score_single(point: Point, weights: Optional[Dict[str, float]]) -> ScoreResponse:
    row = _lookup_row(point)

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


@app.get("/v1/presets", response_model=Dict[str, Dict[str, float]])
def get_presets(_: str = Depends(verify_token)) -> Dict[str, Dict[str, float]]:
    return {"warehouse": DEFAULT_WEIGHTS}


@app.post("/v1/score", response_model=ScoreResponse)
def score_point(req: ScoreRequest, _: str = Depends(verify_token)):
    return _score_single(req.point, req.weights)


@app.post("/v1/score/batch", response_model=BatchScoreResponse)
def score_batch(req: BatchScoreRequest, _: str = Depends(verify_token)):
    if not req.points:
        raise HTTPException(400, "points is required for now")
    if len(req.points) > MAX_BATCH_POINTS:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "BATCH_LIMIT_EXCEEDED",
                "message": f"Batch limited to {MAX_BATCH_POINTS} points per request (got {len(req.points)}).",
            },
        )
    return BatchScoreResponse(
        results=[_score_single(p, req.weights) for p in req.points]
    )
