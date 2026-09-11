# main.py
from contextlib import asynccontextmanager
from typing import Dict, Optional

import h3
import numpy as np
from fastapi import FastAPI, HTTPException, Depends, Security
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware

from config import ALLOWED_ORIGINS, GEO_SERVICE_TOKEN
from data import get_dataset_id, get_df, get_h3_resolution, load_data
from hotspots import (
    cell_composites,
    classify_bin,
    classify_gi,
    dbscan_on_candidates,
    find_underserved,
    gi_star_scores,
    normal_p_value,
)
from schemas import (
    BatchScoreRequest,
    BatchScoreResponse,
    ConstraintResult,
    HeatmapCell,
    HeatmapResponse,
    HotspotStatCell,
    HotspotsRequest,
    HotspotsResponse,
    Point,
    PresetName,
    ScoreRequest,
    ScoreResponse,
)
from scoring import (
    compute_subscores,
    evaluate_constraints,
    composite_score,
    PRESET_WEIGHTS,
    prepare_scoring_data,
)

MAX_BATCH_POINTS = 5000


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_data()
    app.state.df = prepare_scoring_data(get_df())
    app.state.dataset_id = get_dataset_id()
    app.state.h3_res = get_h3_resolution()
    app.state.cell_index = {
        str(cell): position for position, cell in enumerate(app.state.df["h3_index"])
    }
    print(f"Loaded {len(app.state.df):,} cells at H3 res {app.state.h3_res}")
    app.state.bbox = {
        "min_lat": round(float(app.state.df["centroid_lat"].min()), 6),
        "max_lat": round(float(app.state.df["centroid_lat"].max()), 6),
        "min_lon": round(float(app.state.df["centroid_lon"].min()), 6),
        "max_lon": round(float(app.state.df["centroid_lon"].max()), 6),
    }
    app.state.heatmap_cells = {
        preset: _build_heatmap_cells(app.state.df, preset)
        for preset in PRESET_WEIGHTS
    }
    print(f"Precomputed heatmaps for {', '.join(app.state.heatmap_cells)}")
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


@app.exception_handler(HTTPException)
async def typed_error_handler(request, exc: HTTPException):
    """Spec section 6: errors return {error: {code, message, detail}}."""
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail:
        rest = {k: v for k, v in detail.items() if k not in ("code", "message")}
        body = {
            "error": {
                "code": detail["code"],
                "message": detail.get("message", ""),
                "detail": rest or None,
            }
        }
    else:
        body = {
            "error": {
                "code": f"HTTP_{exc.status_code}",
                "message": str(detail),
                "detail": None,
            }
        }
    return JSONResponse(status_code=exc.status_code, content=body)


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
                "bbox": app.state.bbox,
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
                "bbox": app.state.bbox,
            },
        )
    return app.state.df.iloc[pos]


# ---------- core logic ----------
def _build_heatmap_cells(df, preset: PresetName) -> list[HeatmapCell]:
    """Precompute weight-independent subscores for every cell."""
    return [
        HeatmapCell(
            h3_index=str(row["h3_index"]),
            eligible=all(result["pass"] for result in evaluate_constraints(row, preset)),
            subscores=compute_subscores(row, preset),
        )
        for _, row in df.iterrows()
    ]


def _score_single(
    point: Point,
    preset: PresetName,
    weights: Optional[Dict[str, float]],
) -> ScoreResponse:
    row = _lookup_row(point)

    subs = compute_subscores(row, preset)
    w = weights or PRESET_WEIGHTS[preset]
    score = composite_score(subs, w)

    constraints = evaluate_constraints(row, preset)
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
    return PRESET_WEIGHTS


@app.get("/v1/heatmap", response_model=HeatmapResponse)
def get_heatmap(
    preset: PresetName = "warehouse",
    _: str = Depends(verify_token),
) -> HeatmapResponse:
    return HeatmapResponse(
        dataset_id=app.state.dataset_id,
        h3_resolution=app.state.h3_res,
        preset=preset,
        cells=app.state.heatmap_cells[preset],
    )


@app.post("/v1/score", response_model=ScoreResponse)
def score_point(req: ScoreRequest, _: str = Depends(verify_token)):
    return _score_single(req.point, req.preset, req.weights)


@app.post("/v1/hotspots", response_model=HotspotsResponse)
def compute_hotspots(req: HotspotsRequest, _: str = Depends(verify_token)):
    """Spec section 6: Gi*, DBSCAN, or H3 binning over preset composites.

    Subscores come from the heatmap cache; only the weighted composite
    is recalculated per request.
    """
    df = app.state.df
    h3_list = [str(h) for h in df["h3_index"].values]
    weights = req.weights or PRESET_WEIGHTS[req.preset]
    cached = [
        {"h3_index": cell.h3_index, "subscores": cell.subscores.model_dump()}
        for cell in app.state.heatmap_cells[req.preset]
    ]
    scores = cell_composites(cached, weights)

    cells: list = []
    clusters: list = []
    if req.method == "gi_star":
        z = gi_star_scores(h3_list, scores, k=req.k)
        cells = [
            HotspotStatCell(
                h3_index=h,
                score=round(float(s), 2),
                classification=classify_gi(float(zi)),
                z_score=round(float(zi), 3),
                p_value=round(normal_p_value(float(zi)), 4),
                confidence=round(1.0 - normal_p_value(float(zi)), 4),
            )
            for h, s, zi in zip(h3_list, scores, z)
        ]
    elif req.method == "binning":
        q1, q2, q3 = (round(float(v), 2) for v in np.percentile(scores, [25, 50, 75]))
        cells = [
            HotspotStatCell(
                h3_index=h,
                score=round(float(s), 2),
                classification=classify_bin(float(s), q1, q2, q3),
            )
            for h, s in zip(h3_list, scores)
        ]
    else:  # dbscan
        labels, clusters, confidence = dbscan_on_candidates(
            h3_list,
            scores,
            threshold=req.threshold,
            eps_km=req.eps_km,
            min_samples=req.min_samples,
        )
        cells = [
            HotspotStatCell(
                h3_index=h,
                score=round(float(s), 2),
                classification="noise" if lab == -1 else "cluster",
                confidence=None if lab == -1 else round(float(conf), 2),
                cluster_id=None if lab == -1 else int(lab),
            )
            for h, s, lab, conf in zip(h3_list, scores, labels, confidence)
        ]

    return HotspotsResponse(
        dataset_id=app.state.dataset_id,
        h3_resolution=app.state.h3_res,
        preset=req.preset,
        method=req.method,
        cells=cells,
        clusters=clusters,
        underserved=find_underserved(df),
    )


@app.post("/v1/score/batch", response_model=BatchScoreResponse)
def score_batch(req: BatchScoreRequest, _: str = Depends(verify_token)):
    if not req.points:
        raise HTTPException(400, "points is required for now")
    if len(req.points) > MAX_BATCH_POINTS:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "BATCH_LIMIT_EXCEEDED",
                "message": (
                    f"Batch limited to {MAX_BATCH_POINTS} points per request "
                    f"(got {len(req.points)})."
                ),
            },
        )
    return BatchScoreResponse(
        results=[_score_single(p, req.preset, req.weights) for p in req.points]
    )
