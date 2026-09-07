"""Pydantic schemas for the Wherehouse Geo API."""

from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

WeightName = Literal["demographics", "transport", "poi", "zoning", "flood", "aqi"]
WeightValue = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Weights = Dict[WeightName, WeightValue]


class Point(BaseModel):
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    lon: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]


class ScoreRequest(BaseModel):
    point: Point
    weights: Optional[Weights] = None


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
    points: Annotated[List[Point], Field(min_length=1, max_length=5000)]
    weights: Optional[Weights] = None


class BatchScoreResponse(BaseModel):
    results: List[ScoreResponse]
