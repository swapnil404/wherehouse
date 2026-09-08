"""Pydantic schemas for the Wherehouse Geo API."""

from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

PresetName = Literal["warehouse", "retail"]
WeightName = Literal["demographics", "transport", "poi", "zoning", "flood", "aqi"]
WeightValue = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Weights = Dict[WeightName, WeightValue]


class Point(BaseModel):
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    lon: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]


class ScoreRequest(BaseModel):
    point: Point
    preset: PresetName = "warehouse"
    weights: Optional[Weights] = None


class Subscores(BaseModel):
    demographics: float
    transport: float
    poi: float
    zoning: float
    flood: float
    aqi: float


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
    subscores: Subscores
    constraints: List[ConstraintResult]


class BatchScoreRequest(BaseModel):
    points: Annotated[List[Point], Field(min_length=1, max_length=5000)]
    preset: PresetName = "warehouse"
    weights: Optional[Weights] = None


class BatchScoreResponse(BaseModel):
    results: List[ScoreResponse]


class HeatmapCell(BaseModel):
    """One heatmap cell: identity + weight-independent subscores only.

    No composite score, no geometry — the frontend derives boundaries
    with h3-js and recomputes the weighted composite locally.
    """

    model_config = ConfigDict(populate_by_name=True)

    h3_index: str = Field(alias="h3Index")
    eligible: bool
    subscores: Subscores


class HeatmapResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    dataset_id: str = Field(alias="datasetId")
    h3_resolution: int = Field(alias="h3Resolution")
    preset: PresetName
    cells: List[HeatmapCell]
