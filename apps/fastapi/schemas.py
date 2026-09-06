"""Pydantic schemas for the Wherehouse Geo API."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class Point(BaseModel):
    lat: float
    lon: float


class ScoreRequest(BaseModel):
    point: Point
    weights: Optional[Dict[str, float]] = None


class ConstraintResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    label: str = ""
    actual: Any
    required: Any
    pass_: bool = Field(alias="pass")


class ScoreResponse(BaseModel):
    h3_index: str
    lat: float
    lon: float
    score: float
    eligible: bool
    subscores: Dict[str, float]
    constraints: List[ConstraintResult]


class BatchScoreRequest(BaseModel):
    points: List[Point]
    weights: Optional[Dict[str, float]] = None


class BatchScoreResponse(BaseModel):
    results: List[ScoreResponse]
