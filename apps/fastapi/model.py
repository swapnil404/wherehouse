from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field

class Point(BaseModel):
    lat: float
    lon: float

class ScoreRequest(BaseModel):
    point: Point
    weights: Optional[Dict[str, float]] = None   # if None → use default warehouse weights
    include_ml: bool = False

class ConstraintResult(BaseModel):
    feature: str
    op: str
    value: Any
    actual: Any
    passed: bool
    message: str

class ScoreResponse(BaseModel):
    h3_index: str
    lat: float
    lon: float
    score: float
    eligible: bool
    subscores: Dict[str, float]
    constraints: List[ConstraintResult]
    is_hotspot: bool
    is_underserved: bool
    cluster_id: int

class BatchScoreRequest(BaseModel):
    points: Optional[List[Point]] = None
    # later you can also accept area_wkt or geojson
    weights: Optional[Dict[str, float]] = None
    include_ml: bool = False

class BatchScoreResponse(BaseModel):
    results: List[ScoreResponse]